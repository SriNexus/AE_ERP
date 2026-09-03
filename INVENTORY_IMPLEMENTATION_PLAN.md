# INVENTORY_IMPLEMENTATION_PLAN.md

**Neozy ERP — Inventory System Remediation: Master Implementation Roadmap**

> **STATUS: DRAFT — NOT APPROVED. The implementation must not proceed until this plan is reviewed and approved.**
> Planning date: 2026-09-03 · Author role: ERP/Inventory/Firestore Architect + Data-Integrity Engineer
> Inputs: `BRAIN.md` (sole architectural source of truth), `COMPLETE_INVENTORY_INTEGRITY_AUDIT.md`, repository source read during audit + planning.
> Companion docs: `INVENTORY_IMPLEMENTATION_STATE.md` (live checkpoint), `INVENTORY_PHASE_DEPENDENCY_MAP.md`, `INVENTORY_REGRESSION_MATRIX.md`.

**Reading order for any future session (new chat / new agent / lost context):**
1. `BRAIN.md` — §11.3, §13, §15, §18, §23 (INVENTORY/STOCK, ORDERS, DISPATCH, VENDORS/PO/GRN), §25, §27, §28, §33, §34.
2. `INVENTORY_IMPLEMENTATION_PLAN.md` (this file).
3. `INVENTORY_IMPLEMENTATION_STATE.md` — tells you exactly where work stopped.
4. `INVENTORY_REGRESSION_MATRIX.md` — the tests that must stay green.
Then execute **only** the phase named "NEXT PHASE" in the STATE file. Do not touch later phases.

---

## TABLE OF CONTENTS

1. Current-State Architecture (baseline)
2. Audit Findings — carried forward
3. Risk Classification
4. Target Architecture
5. Inventory Invariants (permanent)
6. Stock Lifecycle (frozen definition)
7. Reservation / Allocation Policy
8. Inventory Movement Types
9. Transaction Boundaries
10. Idempotency Architecture
11. Security Model (rules + API)
12. Multi-Company Rules
13. Multi-Warehouse Rules
14. Phase Roadmap (INVENTORY-00 … INVENTORY-11)
15. Phase Dependencies (summary — full graph in the dependency map doc)
16. Migration Strategy (global principles)
17. Regression Strategy
18. Rollback Strategy
19. Completion Criteria — "Inventory Complete" for Neozy
20. Future / Optional Backlog
21. Protected Areas — "DO NOT TOUCH YET"
22. Cross-Module Blast-Radius Matrix
23. Phase Completion Protocol
24. Handoff

---

## 1. CURRENT-STATE ARCHITECTURE (BASELINE)

> Reconstructed from source. Confidence: `VERIFIED` unless marked.

### 1.1 Stack context
- Firebase Firestore (single DB, project `ae-erp-d933d`). `firestore.rules` is the only enforced authorization boundary. A Vercel REST facade (`api/`) is a **second, weaker** authz plane that bypasses `firestore.rules` (`BRAIN.md` §21).
- SPA writes Firestore directly via SDK. Hierarchy: **Group → Company → Warehouse**. Every tenant doc carries `companyId` + `groupId`.
- Verification commands (`BRAIN.md` §2.1): typecheck `npm run lint` (= `tsc --noEmit`); build `npm run build` (= `vite build`); unit `npx vitest run [path]`; rules `firebase emulators:exec --only firestore --project neozy-demo-isolation-test "npx vitest run --config vitest.emulator.config.ts"` (run in 2–3 batches — full cold run flakes).
- **Environment limitation:** `java.exe` is missing from PATH in the current dev environment → the Firestore emulator suite cannot run locally without installing a JDK (Android Studio's bundled JBR is a known workaround — auto-memory `feedback_neozy_environment_notes`). **Phase 00 must resolve this.** CI (`security-rules-tests.yml`) still runs the rules suite.

### 1.2 Products
| Aspect | Current |
|---|---|
| Collection | `products` — **no dedicated rules block**, uses the generic company-scoped fallback (`firestore.rules:2591`; not in `isSpecialCollection` L794). |
| Schema (`PRODUCT_FORM_DEFAULT`, `useInventory.ts:16`) | `name, sku, category (STRING name, not id), price, mrp, cost, discount, tax, unit, hsn, description, trackingType ('none'|'barcode'|'serial'|'barcode_serial'), status, lowStockThreshold, specs`. On create also: `id, companyId, photos[], isDeleted:false, createdBy`. |
| Services / hooks | `src/features/inventory/hooks/useInventory.ts` — `useProducts`, `useSaveProduct`, `useDeleteProduct`, `exportProductsCSV`. No domain service. |
| UI | `src/pages/Products.tsx`, `ProductsWorkspace.tsx`, `src/components/products/ProductPicker.tsx` (returns `{productId, product, category, price}` snapshot), mobile `MobileProductWorkspace.tsx`. |
| Permissions | module `products`. Sales/Warehouse/Operations/Procurement: view. Admin/Manager: full. |
| Rules | generic fallback: read/create/update = any active same-company member; **`delete: if false`**. |
| Delete | `useDeleteProduct` → `deleteDocById` → `softDelete` (`firestore.ts:980,893` — sets `isDeleted:true` via `updateDocById`). Hard delete impossible in prod. **No reference guard.** |
| API | `products` in `api/_lib/registry.ts` → generic REST CRUD, rules bypassed. |
| Identity risks | no SKU / name / hsn / barcode uniqueness anywhere. `genId.generic('PRD')` random + `setDoc(merge:true)` → collision silently merges. |

### 1.3 Category
| Aspect | Current |
|---|---|
| Collection | `product_categories` — **dedicated block** (`firestore.rules:1939`). |
| Schema | `{ ...CategoryForm, id, createdBy }`; `CategoryForm` includes `parentCategory` (**name string**, not id). `companyId`+`groupId` auto-stamped by `createDocWithId`. |
| Services / hooks | `src/features/categories/hooks/useCategories.ts` — `useCategories`, `useSaveCategory`, `useDeleteCategory`. |
| UI | `Categories.tsx`, `CategoriesWorkspace.tsx` (has merge/delete), `CategoryForm.tsx`, mobile. |
| Rules | read/create/update = any active same-company member; **hard `delete` allowed only for `isSuperAdmin() && sameCompany`** (`firestore.rules:1945`). |
| Delete | `useDeleteCategory` → `deleteDocById` → soft delete. **No orphan-product check.** |
| Link to Product | **name-based** — `product.category` holds the category *name*, not `product_categories.id`. |

### 1.4 Warehouse
| Aspect | Current |
|---|---|
| Collection | `warehouses` — **dedicated block** (`firestore.rules:917`). |
| Schema | `{ ...WarehouseForm, id, createdBy }`, `companyId`+`groupId` auto-stamped. Also serves as "branch" for warehouse-restricted roles. |
| Services / hooks | `src/features/warehouses/hooks/useWarehouses.ts` — `useWarehouses`, `useSaveWarehouse`, `useDeleteWarehouse`. Audit-logged (`logCreate/logUpdate/logDelete`). |
| Rules | read/create/update = any active same-company member; `create` requires `data.id == warehouseId` + `hasCompanyId`; `companyIdUnchanged` on update; **`delete: if false`** (soft only). |
| Delete | soft delete; **no FK cascade / no guard** against deleting a warehouse with stock or open dispatches. |
| Transfer | **no warehouse-transfer feature exists.** |

### 1.5 Stock
| Aspect | Current |
|---|---|
| Summary collection | `stock` — **dedicated block** (`firestore.rules:1423`). Doc id = deterministic `SUM-{enc(companyId)}-{enc(productId)}-{enc(warehouseId)}` (`stockSummaryId`, `workflow.ts:60`; **duplicated** at `useInventory.ts:134`). |
| Summary schema | `{ id, companyId, groupId, productId, warehouseId, availableQty, reservedQty, unit, isDeleted, updatedBy, updatedAt, createdAt }`. `availableQty` = the physical on-hand number (misnamed). `reservedQty` = **written by zero production paths — dead field.** `onHandQty` = **does not exist in production docs** (only demo seed + demo test invariant). |
| Ledger collection | `stock_ledger` — **dedicated block** (`firestore.rules:1510`), **`update, delete: if false` (immutable)**. `softDelete()` throws for this collection (`firestore.ts:894`). |
| Ledger schema A (`stockWorkflow` / `useSaveStockEntry`) | `{ id, companyId, groupId, productId, warehouseId, type:'IN'|'OUT', qty, unit, beforeQty, afterQty, transactionId, movementAt, sourceType, sourceId, notes, createdBy, isDeleted }`. |
| Ledger schema B (`dispatchWorkflow` OUT) | `{ id, companyId, productId, product, warehouseId, warehouse, type:'OUT', qty, beforeQty, afterQty, transactionId, movementAt, unit, referenceType:'Dispatch', referenceId, date, notes }` — **no `sourceType`/`sourceId`.** |
| Write paths | (1) `stockWorkflow.stockIn()` — **transactional** IN. (2) `useInventory.useSaveStockEntry()` — **transactional** IN/OUT manual. (3) `dispatchWorkflow.executeAndVerifyDispatch()` — **NON-transactional** OUT (INV-1 / P0-1). (4) REST `PUT /api/stock/:id` — **no ledger, no txn, rules bypassed** (P0-2). |
| Write authz [rules] | `warehouseActorCanCreate/Update` (`firestore.rules:483/494`) — **NOT role-gated**, only `authMap.companyId == data.companyId && companyGroupIsActive && groupIdMatchesCompany`. Field guard on `stock` UPDATE: changing `availableQty`/`reservedQty` on an *existing* summary requires role `~/Warehouse/`, `~/Operations/`, or `Admin|GroupAdmin` (`firestore.rules:1463-1506`). |
| FK | `warehouseBelongsToCompany()` (`firestore.rules:446`) — `stock.warehouseId` must exist & belong to `stock.companyId`. Emulator-tested. |
| Guards | `resolveStockSummaryDocumentId` throws if >1 non-deleted summary for the same triple. Negative guard: IN paths `afterQty<0` (unreachable); `useSaveStockEntry` OUT `nextAvailable<0` throw (in txn); `executeAndVerifyDispatch` only a **non-txn pre-read** `available < verifiedQty`. |
| Reconciliation | **none anywhere.** No engine, no job. |
| UI | `Stock.tsx`, `StockWorkspace.tsx`, `StockLedger.tsx`, `StockLedgerWorkspace.tsx`, mobile. |

### 1.6 Inventory Ledger — see 1.5. Immutable at rules layer; incomplete on the OUT + API paths; two schemas; no reconciliation.

### 1.7 Product → Quotation
- `src/lib/quotationWorkflow.ts`. Collection `quotations` — **generic rule**.
- Items built via `ProductPicker` → `{productId, product, category, price, qty, tax, discount, unit}` **snapshot** (good for history). Engineering-derived items (`quotationItemsFromEngineering`) carry `productId: ''`.
- **No stock effect. No availability check. No reservation.**
- `convertQuotationToOrder` — lock-guarded (`isQuotationLocked` = `status === 'Converted to Order' || convertedOrderId`), preserves items/qty/pricing/tax, resolves `orderType` from Customer (throws if unclassified), sets `dispatchedQty:0/pendingQty` per item, propagates `caseId`. Read-then-write lock (concurrent-convert race — P2-8).

### 1.8 Product → Order → Inventory
- `src/lib/orderWorkflow.ts` `createOrder` = one `createDocWithId(ORDERS)` + `notifyRoleUsers`. **No stock reservation / allocation / availability check. Order carries no `warehouseId`.**
- Order status is set ad-hoc by callers: `'Pending'` (convert), `'Partial Dispatch'` / `'Dispatched'` (dispatch verify), `'Cancelled'` (cancelOrder), `stockBlocked:true` (markPIAsPaid). **No state machine.**
- **`Orders.tsx:289-293` edit path** (`save` mutation, `editId` branch) does a **full `updateDocById(ORDERS, editId, {...d, items, subtotal, taxTotal, discount, total})`** — **no status check, no lock** → line items / quantities can be edited after partial or full dispatch, overwriting `dispatchedQty`/`pendingQty` tracking. **VERIFIED (P1-8, upgraded from NOT VERIFIED during planning).**
- `stockWorkflow.cancelOrder` — non-atomic multi-step; restores dispatched qty (IN, `sourceType:'return'`) for dispatches ∈ {Dispatched, Delivered, Closed, Returned}, idempotent via `sourceId = CANCEL:{orderId}:{dispatchId}:{productId}` + existing-return-ledger set. Does **not** reverse issued PIs / tax invoices.

### 1.9 Product → Order → Invoice → Inventory
- `src/lib/invoiceWorkflow.ts` `generatePIsFromOrder` — dual-entity split only for `companyCode === 'CGPL'`; else one PI. **No stock effect.** Sets `order.piGenerated`, `totalInvoiced = order.total` ("Simplified logic: assumes fully invoiced"), `pendingBilling = 0`. **No `piGenerated` pre-check → repeatable.**
- `markPIAsPaid` — **transactional** (PI + order), sets `order.stockBlocked = true`. **Nothing consumes `stockBlocked`.** Notification says "Stock is now blocked for order" — this is the intended reservation trigger, but no reservation is created.
- `taxInvoiceWorkflow.ts` — GST breakdown, **no stock touch**. Number allocation via `serial_numbers/{tax_invoices:companyId:FY}` counter (overloads `serial_numbers`).
- **No Order→Invoice double-deduction path** — stock only moves at dispatch verification.

### 1.10 Vendor → Procurement → GRN → Stock
- `src/features/procurement/services/purchaseOrderWorkflow.ts`, `goodsReceiptWorkflow.ts`.
- **PO state machine — THREE divergent tables:** `firestore.rules:1879` `validPurchaseOrderTransition`; `purchaseOrderWorkflow.ts:11` `PURCHASE_ORDER_TRANSITIONS`; `ProcurementValidationEngine.ts:110` `VALID_PO_TRANSITIONS` (the odd one — `Draft→[Sent]` only, `Received→[Cancelled]`).
- PO create [rules `firestore.rules:1886`]: `status == 'Draft'`, `vendorId is string`, `items is list`, `purchaseOrderId == docId`. Client validation: qty>0, price≥0, 0≤tax≤100, discount bounds. **No `productId` existence check.**
- GRN (`createGoodsReceipt`): permission `canDo('create','stock') && canDo('edit','purchase_orders')` (client only). `calculateReceiptState` guards **over-receipt** vs `item.qty − previouslyReceived` per line. Per received line → `stockIn({sourceType:'purchase', sourceId:'purchase_order:{PO}:goods_receipt:{GRN}:line:{i}'})`.
  - **`stockIn` never checks `sourceId` for a prior movement → non-idempotent** (P1-1).
  - **Non-atomic** — all `stockIn`s, then GRN doc, then PO update (P1-5).
  - **Concurrent GRNs** read same `previouslyReceivedQty` → both pass → PO `items[]` overwritten last-write-wins → silent over-receipt (P1-2).
  - GRN rules (`firestore.rules:1902`): `warehouseActorCanCreate` + `warehouseBelongsToCompany` + `sameWarehouse` + `receivedBy == actorUserId()` + `receivedItems.size() > 0` + `stockEntries is list`; **`update, delete: if false`.**
  - **Procurement role can create the GRN doc but the `stockIn` summary UPDATE hits the `stock` field guard** for any existing summary (Procurement ∉ `Warehouse|Operations|Admin|GroupAdmin`) → PLAUSIBLE, **not emulator-verified** (P1-3). No emulator test covers Procurement/Accounts/Sales roles moving stock.
- `ProcurementValidationEngine` (read-only) — orphan/duplicate PO/GR detection, `gr.stockEntries.length > 0` check; **never reconciles GRN qty against `stock`/`stock_ledger`**. `repairProcurementChain` can rewrite `purchase_orders.status` (non-dry-run).

### 1.11 Vendors
- `src/features/procurement/hooks/useVendors.ts`. Collection `vendors` — **generic rule**. Fields `name, gstin, contact, bankDetails` `[partial]`. **No GST/PAN validation** (`.toUpperCase()` only).
- Soft delete. `validateVendor` flags soft-deleted vendors with POs/GRNs (detection, not prevention). No stored purchase totals / outstanding — computed on read (`validateVendorFinancials`, `totalGRValue` hard-coded 0). No product↔vendor relationship / last-purchase-price.

### 1.12 Other modules touching inventory
- **Dispatch** (`dispatch`, dedicated rules `firestore.rules:1393`): warehouse-scoped, `warehouseIdUnchanged`, `createdBy == actorUserId`, `warehouseBelongsToCompany`. `requestDispatch` → `confirmDelivery` (txn) → `executeAndVerifyDispatch` (**NON-txn** stock-OUT) → `closeDispatch` (txn). Serials free-text on `dispatch.items[].serials`; dedup = full `getAll(DISPATCH)` company scan (O(n²)).
- **Serial numbers** (`serial_numbers`, generic rules): B2C installation serials (`installationEngine.captureInstallationSerial`) **and** tax-invoice number counters (`taxInvoiceWorkflow`) — same collection, ≥2 doc shapes, **not linked to `stock`**.
- **Cases / Projects**: `caseId` propagated onto orders/dispatch/PO/GRN (`propagateCaseIdFromChain`, best-effort `void`).
- **Payments / Loan**: no stock effect.
- **Dashboards / Reports**: wide multi-collection `getAll` reads (`BRAIN.md` §28).

---

## 2. AUDIT FINDINGS — CARRIED FORWARD

Source: `COMPLETE_INVENTORY_INTEGRITY_AUDIT.md`. All IDs preserved. **One upgrade during planning: P1-8 NOT VERIFIED → VERIFIED** (`Orders.tsx:289-293`).

| ID | Sev | One-line | Verified? |
|---|---|---|---|
| P0-1 | P0 | Dispatch stock-OUT non-transactional RMW → oversell / lost update | VERIFIED |
| P0-2 | P0 | REST API `PUT /api/stock/:id` mutates `availableQty` with no ledger / txn / FK / rules | VERIFIED (registry entry + handler) |
| P0-3 | P0 | No reservation/allocation layer — `reservedQty` unused, `stockBlocked` unread | VERIFIED |
| P1-1 | P1 | GRN not idempotent → duplicate stock IN on retry | VERIFIED |
| P1-2 | P1 | Concurrent GRNs → silent over-receipt (PO items last-write-wins) | VERIFIED |
| P1-3 | P1 | `stock` field guard blocks Procurement (GRN) & Accounts/Sales (cancel restore) | PLAUSIBLE — **must reproduce in emulator (Phase 00)** |
| P1-4 | P1 | Two parallel stock-write implementations, divergent ledger schemas | VERIFIED |
| P1-5 | P1 | Multi-doc stock ops non-atomic (dispatch, GRN) → partial-failure strands stock | VERIFIED |
| P1-6 | P1 | No product/warehouse existence check at order/dispatch/adjust | VERIFIED |
| P1-7 | P1 | `genId` random + `setDoc(merge:true)` → collision silently merges records | VERIFIED |
| P1-8 | P1 | Order items editable after partial dispatch (no lock) — `Orders.tsx:289` | **VERIFIED (upgraded)** |
| P2-1 | P2 | No stock↔ledger reconciliation | VERIFIED |
| P2-2 | P2 | `cancelOrder` non-atomic; doesn't reverse PIs/tax invoices | VERIFIED |
| P2-3 | P2 | Category link by name, not id | VERIFIED |
| P2-4 | P2 | Three divergent PO transition tables | VERIFIED |
| P2-5 | P2 | Master-data soft-delete no FK guard/cascade | VERIFIED |
| P2-6 | P2 | `stock_ledger` create not role-gated / not delta-checked | VERIFIED [rules] |
| P2-7 | P2 | PI generatable repeatedly; `totalInvoiced` "simplified" | VERIFIED |
| P2-8 | P2 | Concurrent quote→order conversion race | VERIFIED (source comment) |
| P2-9 | P2 | Dispatch serial dedup = full `getAll(DISPATCH)` scan (O(n²)) | VERIFIED |
| P3-1..6 | P3 | No opening-stock/import/bulk flow; `lowStockThreshold` unused; no GST/PAN/HSN validation; `serial_numbers` overloaded; `onHandQty` not maintained; missing indexes | VERIFIED |

---

## 3. RISK CLASSIFICATION (for phasing — dependency-aware, not severity-ordered)

| Class | Meaning | Members |
|---|---|---|
| **A — Bleeding now, self-contained fix** | Active corruption risk; fix touches ≤2 modules; no new foundation needed | P0-1 (dispatch txn), P0-2 (API boundary) |
| **B — Bleeding now, needs a small guard** | Active risk; fix is a guard/lock on an existing path | P1-1, P1-2, P1-5 (GRN), P1-8 (order lock), P2-2 (cancel atomicity), P2-4 (PO table) |
| **C — Needs emulator reproduction first** | Cannot design the fix until behavior is confirmed | P1-3 (role gate), P1-6 partial |
| **D — Needs an architectural foundation** | Fix is unsafe until a single-writer engine exists | P1-4 (unify writers), P2-1 (reconciliation), P2-6 (ledger gate) |
| **E — New capability on top of the foundation** | Depends on D | P0-3 (reservation), warehouse transfer, opening stock, damage flow |
| **F — Broad, low structural risk, high form-count** | Touches many UI forms; independent of stock engine | P2-3 (category id), P1-7 (id uniqueness), P2-5 (delete guards), master data |
| **G — Independent hardening** | No dependency; do last | P2-9, P3-6 (scale/indexes), reporting |

---

## 4. TARGET ARCHITECTURE

### 4.1 One controlled write boundary

```
        ┌─────────────────────────────────────────────────────────────┐
        │                 INVENTORY MOVEMENT ENGINE                     │
        │        src/lib/inventory/stockMovementEngine.ts (new)         │
        │                                                              │
        │   applyStockMovement({ movementType, productId, warehouseId, │
        │      companyId, qty, sourceType, sourceId, idempotencyKey,   │
        │      unit, reason?, actorId }) : Promise<MovementResult>      │
        │                                                              │
        │   • ONE runTransaction per (movement × stock summary)        │
        │   • deterministic ledger doc id = hash(idempotencyKey)       │
        │   • idempotent: transaction.get(ledgerRef) → exists ? no-op  │
        │   • invariant checks (see §5) inside the txn                 │
        │   • stamps companyId + groupId manually                     │
        └───────────┬───────────────────────────────────┬─────────────┘
                    │ writes                             │ writes
                    ▼                                    ▼
          stock/{SUM-…}                          stock_ledger/{det-id}
          onHandQty, reservedQty,               movementType, qty,
          availableQty (derived cache),         onHandBefore/After,
          unit, isDeleted                       reservedBefore/After,
                                                sourceType, sourceId,
                                                idempotencyKey, actorId,
                                                movementAt   (IMMUTABLE)
```

Callers (`goodsReceiptWorkflow`, `dispatchWorkflow`, `useSaveStockEntry`, `cancelOrder`, future reservation + transfer) call **only** `applyStockMovement`. Direct `transaction.set(stockRef, …)` outside the engine becomes a lint-enforced anti-pattern.

### 4.2 Quantity model (final)

| Field | Stored? | Source of truth | Who changes it | Which movement |
|---|---|---|---|---|
| `onHandQty` | **stored** (new, additive) | the engine | engine only | PURCHASE_RECEIPT, OPENING_STOCK, ADJUSTMENT_IN/OUT, DAMAGE_OUT, DISPATCH_OUT, SALES_RETURN_IN, TRANSFER_IN/OUT, RECONCILE_ADJUST |
| `reservedQty` | **stored** (currently dead — activated in Phase 07) | the engine | engine only | SALES_RESERVE (+), SALES_RELEASE (−), DISPATCH_OUT (− when consuming a reservation) |
| `availableQty` | **stored cache** (kept during migration) → `= onHandQty − reservedQty` | derived; the engine maintains the cache | engine only | every movement recomputes it |
| `incomingQty` | **derived on read** from open POs (`Σ ordered − received`) | not stored | — | — (report-only) |
| `dispatchedQty` / `inTransitQty` | **derived on read** from dispatches by status | not stored | — | — |

**Migration rule:** during Phases 05–06 the engine writes `onHandQty` AND keeps `availableQty == onHandQty` (reserved still 0). Only Phase 07 makes `availableQty = onHandQty − reservedQty`. This defers the one semantic change to the last possible moment, behind the single writer.

### 4.3 Ledger schema (unified target)

```
stock_ledger/{deterministicId}
{
  id, companyId, groupId,
  productId, warehouseId, unit,
  movementType,            // enum §8
  direction: 'IN'|'OUT'|'RESERVE'|'RELEASE',
  qty,
  onHandBefore, onHandAfter,
  reservedBefore, reservedAfter,
  sourceType, sourceId,     // e.g. 'goods_receipt', 'GRN-123'
  idempotencyKey,           // '{movementType}:{sourceType}:{sourceId}:{lineKey}'
  reasonCode?,              // for ADJUSTMENT/DAMAGE
  actorId, movementAt, createdAt,
  isDeleted: false          // never set true — rules forbid update/delete
  // legacy compatibility (dual-write during migration): type, referenceType, referenceId, date
}
```

### 4.4 Reconciliation (Phase 06)

```
StockReconciliationEngine (read-only, mirrors ProcurementValidationEngine)
   for each stock/{SUM}:
      computed = Σ(ledger IN) + Σ(ledger RESERVE→onHand? no) − Σ(ledger OUT)
      report if computed ≠ onHandQty   (never auto-write)
   surfaces: /stock reconciliation report page + a CLI/script
   correction: a human-triggered RECONCILE_ADJUST movement through the engine (audit-flagged)
```

### 4.5 API boundary (Phase 02)

`stock` and `stock_ledger` removed from `api/_lib/registry.ts` write surface. Options, decided in Phase 02: (a) drop the entries entirely; (b) keep GET only (list/read) and reject POST/PUT/DELETE at the handler; (c) route the API through `applyStockMovement` (only after Phase 05). Recommended: **(b) for Phase 02, revisit to (c) or drop in Phase 05.**

---

## 5. INVENTORY INVARIANTS (PERMANENT — enforced by the engine + reconciliation)

> These become the acceptance oracle for every phase from 05 onward. Phase 00 writes them into tests as assertions against current data (documenting which already hold).

| # | Invariant | Enforced by | Phase it becomes true |
|---|---|---|---|
| INV-1 | `onHandQty >= 0` for every non-deleted `stock` summary (negative stock prohibited for Neozy) | engine txn guard | 05 (today: only partially, OUT path can violate) |
| INV-2 | `reservedQty >= 0` | engine txn guard | 05 |
| INV-3 | `reservedQty <= onHandQty` (cannot reserve more than physically held) — **CONFIRM with business: is over-reservation / backorder allowed?** default = not allowed | engine txn guard | 07 |
| INV-4 | `availableQty == onHandQty - reservedQty` | engine (maintained cache) | 07 (05–06: `availableQty == onHandQty`) |
| INV-5 | For every `stock` summary: `onHandQty == Σ(ledger IN qty) − Σ(ledger OUT qty)` where IN = {PURCHASE_RECEIPT, OPENING_STOCK, ADJUSTMENT_IN, SALES_RETURN_IN, TRANSFER_IN, RECONCILE_ADJUST+}, OUT = {DISPATCH_OUT, ADJUSTMENT_OUT, DAMAGE_OUT, TRANSFER_OUT, RECONCILE_ADJUST−} | reconciliation engine (detect); engine (prevent drift) | 06 (detection), 05 (prevention going forward) |
| INV-6 | Every `stock_ledger` row is immutable after creation | `firestore.rules` (`update, delete: if false`) — already true | already |
| INV-7 | Every physical stock movement has exactly one `stock_ledger` row; every `stock_ledger` row corresponds to exactly one `stock` summary delta of the same magnitude | engine (single writer) | 05 |
| INV-8 | No two `stock_ledger` rows share an `idempotencyKey` | engine (deterministic doc id) | 05 |
| INV-9 | `stock.companyId` immutable; `stock.warehouseId` immutable | `firestore.rules` — already true (`warehouseIdUnchanged`, `companyIdUnchanged`) | already |
| INV-10 | `stock.warehouseId` references a `warehouses` doc with the same `companyId` | `firestore.rules` `warehouseBelongsToCompany` — already true | already |
| INV-11 | A TRANSFER produces exactly two ledger rows (`TRANSFER_OUT` at source, `TRANSFER_IN` at destination) sharing a `transferId`; `Σ` of the pair = 0 | engine (transfer op) | 08 |
| INV-12 | Order line quantities are frozen once `Σ dispatchedQty > 0` for that order | order-lifecycle guard (`orderWorkflow` + `Orders.tsx` + rules) | 04 |
| INV-13 | PO `Σ receivedQty per line <= ordered qty per line` | GRN engine txn | 03 |
| INV-14 | A `commission`/PI/tax-invoice is never the trigger for a physical stock movement (only GRN, dispatch, adjustment, return, transfer are) | design rule + review | already (documented) |
| INV-15 | Cross-company: no `stock`/`stock_ledger` read or write where `data.companyId != actor.companyId` (owner/superadmin/GroupAdmin-in-group excepted) | `firestore.rules` — already true, emulator-tested | already |

---

## 6. STOCK LIFECYCLE (FROZEN DEFINITION FOR NEOZY)

> Derived from `BRAIN.md` §16 (Solar EPC workflow) + the existing `markPIAsPaid → order.stockBlocked` intent + audit. **Every item below must be confirmed with the business owner before Phase 05.**

| Event | Physical on-hand | Reserved | Ledger movement | Trigger (existing code) |
|---|---|---|---|---|
| Goods physically received against a PO | **+received qty** at receiving warehouse | — | `PURCHASE_RECEIPT` (IN) | `goodsReceiptWorkflow.createGoodsReceipt` |
| Opening stock entered for a new tenant/product | **+qty** | — | `OPENING_STOCK` (IN) | *(new flow, Phase 10)* — today done as a manual IN |
| Manual stock adjustment up/down | ±qty | — | `ADJUSTMENT_IN` / `ADJUSTMENT_OUT` (+ `reasonCode`) | `useInventory.useSaveStockEntry` |
| Goods found damaged / written off | **−qty** | — | `DAMAGE_OUT` | *(new, Phase 10)* — today a generic OUT |
| **Quotation created / sent** | — | — | **none** | `quotationWorkflow` — unchanged |
| **Order created / confirmed** | — | — | **none** (Neozy does NOT reserve at order creation) | `orderWorkflow.createOrder` — unchanged |
| **Proforma Invoice marked PAID** (`markPIAsPaid`) | — | **+order line qty** at the order's fulfilment warehouse | `SALES_RESERVE` | `invoiceWorkflow.markPIAsPaid` — **this is the reservation trigger** (replaces the cosmetic `stockBlocked` flag). *Phase 07.* **Business confirm: is it PI-paid, or order-confirmed, or a manual "allocate" action?** |
| Dispatch requested | — | — | none (dispatch is `Pending Verification`) | `dispatchWorkflow.requestDispatch` |
| **Dispatch verified & goods leave the warehouse** (`executeAndVerifyDispatch`) | **−verified qty** | **−verified qty** (consume the reservation, if any) | `DISPATCH_OUT` | `dispatchWorkflow.executeAndVerifyDispatch` — *Phase 01 (txn), Phase 05 (engine), Phase 07 (reservation consume)* |
| Delivery confirmed (OTP) | — | — | none | `confirmDelivery` |
| Order cancelled **before** dispatch | — | **−remaining reservation** (release) | `SALES_RELEASE` | `stockWorkflow.cancelOrder` — *Phase 07* |
| Order cancelled **after** dispatch | **+dispatched qty** (goods come back) | — | `SALES_RETURN_IN` | `stockWorkflow.cancelOrder` — today `sourceType:'return'`; *Phase 04/05* |
| Customer return / RMA (post-delivery) | **+qty** | — | `SALES_RETURN_IN` | *(no dedicated flow today — Phase 10)* |
| Warehouse A → B transfer | A: **−qty**; B: **+qty** (after receipt) | — | `TRANSFER_OUT` + `TRANSFER_IN` (paired, `transferId`), with an in-transit state | *(no flow today — Phase 08)* |
| Reconciliation correction | ±delta | — | `RECONCILE_ADJUST` (audit-flagged, human-approved) | *(Phase 06)* |

**Explicit non-assumptions:**
- Order creation ≠ reservation (Neozy reserves later — at PI payment, pending business confirmation).
- Quotation ≠ any stock effect, ever.
- Invoice generation (PI or tax) ≠ any stock effect, ever (INV-14).
- Physical stock leaves **only** at dispatch verification (B2B and B2C both funnel through dispatch).

---

## 7. RESERVATION / ALLOCATION POLICY (Phase 07 — needs business sign-off)

| Concept | Definition | Field | Lifecycle |
|---|---|---|---|
| **Available** | what a new order can still promise | `availableQty = onHandQty − reservedQty` | recomputed on every movement |
| **Reserved** | on-hand stock earmarked for a specific paid order, not yet dispatched | `reservedQty` (summary) + a `stock_reservations` doc per order line *(new collection, Phase 07)* | created on `SALES_RESERVE`, consumed on `DISPATCH_OUT`, released on `SALES_RELEASE` |
| **Allocated** | (optional, later) reserved stock further pinned to a specific dispatch/loading plan | — | Phase 08+ / Future |
| **Committed** | reserved + dispatched-not-invoiced | derived | report-only |

**Open decisions for business (block Phase 07 until answered):**
1. Reservation trigger: PI paid? order confirmed? explicit "Allocate stock" button? (default assumption: **PI paid**, matching `markPIAsPaid`).
2. Which warehouse does a reservation hit? Orders carry no `warehouseId` today. Options: (a) add `order.fulfilmentWarehouseId` (chosen at order/PI time); (b) reserve at a company default warehouse; (c) defer reservation to dispatch-plan time. **Recommended: (a) — additive field, chosen at PI-payment time.**
3. Is backorder / negative-available allowed? (default: **no** — INV-3 enforced).
4. Partial reservation when stock is short: reserve what's available + flag shortfall, or reject? (default: **reserve available, flag shortfall on the order**).
5. Reservation expiry (e.g. auto-release after N days unpaid/undispatched)? (default: **no auto-expiry in Phase 07**; Future).

---

## 8. INVENTORY MOVEMENT TYPES (enum — frozen at Phase 05)

```
type MovementType =
  | 'PURCHASE_RECEIPT'   // IN   — GRN against PO
  | 'OPENING_STOCK'      // IN   — initial balance
  | 'ADJUSTMENT_IN'      // IN   — manual correction up (reasonCode required)
  | 'ADJUSTMENT_OUT'     // OUT  — manual correction down (reasonCode required)
  | 'DAMAGE_OUT'         // OUT  — damaged / written off (reasonCode required)
  | 'SALES_RESERVE'      // RESERVE  — earmark for a paid order (no onHand change)
  | 'SALES_RELEASE'      // RELEASE  — un-earmark (no onHand change)
  | 'DISPATCH_OUT'       // OUT  — verified dispatch (consumes reservation if present)
  | 'SALES_RETURN_IN'    // IN   — goods returned (cancel-after-dispatch, RMA)
  | 'TRANSFER_OUT'       // OUT  — leg 1 of a warehouse transfer
  | 'TRANSFER_IN'        // IN   — leg 2 of a warehouse transfer
  | 'RECONCILE_ADJUST'   // IN/OUT — reconciliation correction (human-approved, audit-flagged)
```

---

## 9. TRANSACTION BOUNDARIES

> Firestore limits: a `runTransaction` may read ≤ 1 collection-group worth of docs and must complete quickly; contention on hot docs (a single `stock` summary, `document_counters`) serializes. Do **not** put everything in one giant transaction.

| Operation | MUST be atomic (one `runTransaction`) | MAY be a follow-up step (best-effort + compensation) |
|---|---|---|
| **Stock movement (any type)** | `stock` summary read+write **+** `stock_ledger` row write (deterministic id, idempotency check) | `logActivity`, `notifyUsers`, React Query invalidation |
| **GRN** | per line: one `applyStockMovement` txn (summary+ledger). **PO line `receivedQty` increment + PO status** in a **second** txn that re-reads the PO. **GRN doc** create as a third write. | `caseId` propagation, notifications |
| Why not one txn for GRN | a GRN with N lines = N stock summaries + PO + GRN doc → exceeds practical txn scope; instead each line is individually idempotent, and the PO update is idempotent by comparing `Σ ledger for this GRN` | — |
| **Dispatch verify** | per line: one `applyStockMovement('DISPATCH_OUT')` txn. **Order `items[]` dispatchedQty/pendingQty + order status** in a second txn re-reading the order. **Dispatch doc** status in a third. | project stage advance, notifications, serial dedup (move to a `serial_numbers` uniqueness doc — Phase 11) |
| **Order cancel** | per restored line: one `applyStockMovement('SALES_RETURN_IN' or 'SALES_RELEASE')` txn. **Order status + dispatch statuses** in a second txn. | PI/tax-invoice reversal flags, notifications |
| **Warehouse transfer** | leg 1: `TRANSFER_OUT` txn at source (moves to in-transit). leg 2: `TRANSFER_IN` txn at destination on receipt. **Both carry `transferId`; the transfer doc tracks state.** | notifications |
| **Reservation (Phase 07)** | `SALES_RESERVE`: `stock` summary `reservedQty` + `stock_ledger` + `stock_reservations` doc — one txn per line | order flag update, notifications |
| **Doc numbering** | keep existing `document_counters` `runTransaction` — do not touch | — |

**Compensation:** every multi-txn operation records a progress marker on its parent doc (`grnStockApplied: string[]` of applied idempotency keys). On retry the engine's idempotency check makes re-application a no-op, so "resume from where it failed" is safe.

---

## 10. IDEMPOTENCY ARCHITECTURE

**Mechanism:** `stock_ledger` doc id = `hash(idempotencyKey)` (or a sanitized form of the key). The engine, inside its `runTransaction`, does `transaction.get(ledgerRef)`; if it exists, the movement is already applied → return the existing result, apply nothing.

**Idempotency key format:** `{movementType}:{sourceType}:{sourceId}[:{lineKey}]`

| Operation | Duplicate risk | Idempotency key | Expected result on retry |
|---|---|---|---|
| GRN line receipt | double-click / retry / concurrent GRN | `PURCHASE_RECEIPT:goods_receipt:{GRN-id}:{poLineIndex}` — **but GRN id must be deterministic per (PO, session)** or keyed on `{PO-id}:{lineIndex}:{cumulativeReceivedBefore}` | no additional stock; returns prior result |
| Manual stock entry | double submit | `ADJUSTMENT_IN\|OUT:manual:{clientRequestId}` — UI generates a `clientRequestId` per form submission | no additional movement |
| Dispatch OUT (per line) | double-click "Verify" / retry | `DISPATCH_OUT:dispatch:{DSP-id}:{productId}` | no additional OUT; dispatch already `Dispatched` → reject the second verify attempt |
| Order cancel restore | re-run cancel | `SALES_RETURN_IN:order_cancel:{ORD-id}:{DSP-id}:{productId}` (matches today's `CANCEL:` key) | no additional restore |
| Reservation | double PI-paid event | `SALES_RESERVE:proforma_invoice:{PI-id}:{orderLineKey}` | no additional reservation |
| Release | double cancel | `SALES_RELEASE:order_cancel:{ORD-id}:{orderLineKey}` | no additional release |
| Transfer OUT | retry | `TRANSFER_OUT:transfer:{TRF-id}:{productId}` | no additional OUT |
| Transfer IN | retry | `TRANSFER_IN:transfer:{TRF-id}:{productId}` | no additional IN |
| Reconcile adjust | re-run script | `RECONCILE_ADJUST:reconciliation:{run-id}:{SUM-id}` | no additional adjust |

**Rule (permanent):** no stock-changing operation may be merged into `main` without a documented idempotency key and a test that calls it twice and asserts a single effect.

---

## 11. SECURITY MODEL (target)

### 11.1 `firestore.rules`
- `stock` / `stock_ledger` writes: keep the tenant + warehouse FK checks. **Tighten the write role** so only an inventory-operational role (`Warehouse|Operations|Admin|GroupAdmin|Procurement`) can create/update — resolve P1-3 and P2-6 together. **CONFIRM the exact role list against who runs GRN and order-cancel.** (Phase 03 for the role decision, applied with the engine in Phase 05.)
- `stock` update field guard on `availableQty`/`reservedQty`/`onHandQty`: same role list; keep it lean (1000-expression budget — `firestore.rules:1470-1505`). Run the emulator suite on every change.
- `stock_ledger` create: add `movementType` + `idempotencyKey` + `direction` presence checks; keep `update, delete: if false`.
- Mirror any identity/tenant change into `storage.rules` (§34 danger zone).

### 11.2 API (`api/`)
- Phase 02: `stock` + `stock_ledger` → read-only (or removed). Never writable via the generic REST path.
- No inventory security check may be API-only (API-1). The API is a second, weaker plane.

### 11.3 Multi-company (unchanged — already safe)
- `sameCompany(data)` + `warehouseBelongsToCompany(data)` on every stock/dispatch/GRN write. `companyId` auto/manually stamped, sentinels stripped. Emulator-tested (`multiTenantSecurity.emulator.test.ts:1042/1046`). **Do not regress this.**

### 11.4 Multi-warehouse (unchanged — already safe)
- Deterministic `SUM-{companyId}-{productId}-{warehouseId}` key. `warehouseIdUnchanged`. `sameWarehouse(data)` scoping for warehouse-restricted roles + `where('warehouseId','==',…)` in the client query for list provability. **Do not regress this.**
- Warehouse transfer (Phase 08) is the only sanctioned cross-warehouse stock movement, and it is a **paired** movement (never a single re-point).

---

## 12. MULTI-COMPANY RULES (permanent constraints for every phase)
1. Every new inventory collection carries `companyId` + `groupId`; add a dedicated rules block or consciously accept the generic fallback.
2. Every raw `runTransaction` / `writeBatch` that writes a tenant doc **manually stamps `companyId` + `groupId`** (HR-9 — `stockIn`/`useSaveStockEntry` already do; the engine must).
3. No cross-company read/write path may be introduced. Emulator test every rules change.
4. The API scopes by a single `companyId` only — never move a company-isolation check to be API-only.

## 13. MULTI-WAREHOUSE RULES (permanent)
1. Stock is always keyed on `(companyId, productId, warehouseId)`. Never a company-wide product stock row.
2. `warehouseId` immutable on `stock`/`stock_ledger`/`dispatch`/`goods_receipts`.
3. Cross-warehouse movement only via a paired transfer (Phase 08).
4. Warehouse-restricted roles stay scoped by `sameWarehouse` + client `where('warehouseId','==')`.
5. Deleting a warehouse with any non-zero stock summary or open dispatch/GRN is blocked (Phase 09).

---

## 14. PHASE ROADMAP

> Ordering rationale is dependency-first (see §3 risk classes and `INVENTORY_PHASE_DEPENDENCY_MAP.md`). Severity (P0/P1/P2) is a tiebreaker, not the driver.
> Each phase = one reviewable unit ending in a commit + a STATE-file update. Phase 05 is split into sub-phases 05a–05d, each its own commit.

### Phase index

| Phase | Name | Class | Addresses | Blast radius | Reversible? |
|---|---|---|---|---|---|
| **INVENTORY-00** | Baseline & Safety Lock | — | (none — instrumentation) | NONE | n/a |
| **INVENTORY-01** | Dispatch Stock-OUT Transaction Safety | A | P0-1, part of P1-6 | MEDIUM (Dispatch, Stock, Ledger) | Yes (revert commit) |
| **INVENTORY-02** | Inventory Write Boundary (API + direct writes) | A | P0-2, P2-6 (partial) | LOW (API only, if unused) | Yes |
| **INVENTORY-03** | Procurement Role Reproduction + GRN Integrity | B/C | P1-1, P1-2, P1-5, P1-3, P2-4, INV-13 | MEDIUM (Procurement, Stock, Ledger, rules) | Partial |
| **INVENTORY-04** | Order & PO Lifecycle Locks | B | P1-8, P2-2, P2-7, P2-8, INV-12 | MEDIUM (Orders, Quotations, PO, Dispatch read) | Yes |
| **INVENTORY-05a** | Movement Engine + Adapter (no caller migration) | D | P1-4 (foundation), INV-7/8 | LOW (new module, dormant) | Yes |
| **INVENTORY-05b** | Migrate GRN → engine | D | P1-1/2/5 (final), INV-13 | MEDIUM (Procurement, Stock) | Yes |
| **INVENTORY-05c** | Migrate Dispatch OUT → engine | D | P0-1 (final), INV-1/7 | MEDIUM (Dispatch, Stock) | Yes |
| **INVENTORY-05d** | Migrate Manual + Cancel → engine; retire duplicate writer | D | P1-4 (final), P2-2 | MEDIUM (Stock UI, Orders) | Yes |
| **INVENTORY-06** | Stock ↔ Ledger Reconciliation (read-only) | D | P2-1, INV-5 | LOW (new engine + report page) | Yes |
| **INVENTORY-07** | Sales Reservation / Allocation | E | P0-3, INV-3/4 | **HIGH** (Order, PI, Payment, Dispatch, Stock) | Partial |
| **INVENTORY-08** | Warehouse Transfer | E | (missing feature), INV-11 | MEDIUM (Stock, new collection) | Yes |
| **INVENTORY-09** | Master Data Integrity | F | P2-3, P1-7, P2-5 | MEDIUM (many forms; low structural) | Partial |
| **INVENTORY-10** | Inventory Operational Features | E/F | P3-1..5 (opening stock, damage, bulk, low-stock, RMA) | LOW–MEDIUM | Yes |
| **INVENTORY-11** | Scale & Reporting Hardening | G | P2-9, P3-6 | LOW–MEDIUM | Yes |

---

### INVENTORY-00 — Baseline & Safety Lock

**Phase ID:** INVENTORY-00
**Phase Name:** Baseline & Safety Lock
**Objective:** Freeze and record the current behavior of every stock-writing path; establish the regression harness; reproduce the PLAUSIBLE findings; resolve the emulator-environment blocker. **Zero behavior change.**

**Why this phase comes here:** Nothing can be safely changed until (a) we can prove existing behavior with tests, (b) we can run the rules emulator, (c) P1-3's actual behavior is confirmed. This phase produces the safety net every later phase relies on.

**Problems addressed:** none directly. Produces the evidence and harness for all later phases. Confirms/denies P1-3, P1-6 (partial).

**Problems intentionally NOT addressed:** every P0/P1/P2/P3. No fix. No refactor.

**Current behavior:** as documented in §1. Three transactional-or-not stock paths, no reconciliation, dead `reservedQty`.

**Target behavior:** identical runtime behavior. New: a `src/lib/inventory/__tests__/baseline/` suite that pins current behavior (including the known-bad behaviors, marked `// BASELINE: known defect Pxx — do not "fix" here`), and a documented emulator run.

**Files/modules expected to change:** **test files only** + docs.
- New: `src/lib/inventory/__tests__/baseline/stockIn.baseline.test.ts`, `dispatchOut.baseline.test.ts`, `grn.baseline.test.ts`, `manualEntry.baseline.test.ts`, `cancelOrder.baseline.test.ts`.
- New: `src/lib/__tests__/stockRoleMatrix.emulator.test.ts` — Warehouse / Operations / Procurement / Accounts / Sales / Manager / Admin / GroupAdmin each attempting: create new `stock` summary, update `availableQty` on an existing summary, create `stock_ledger` row. **This resolves P1-3.**
- New: `src/lib/inventory/INVENTORY_INVARIANTS.ts` — the §5 invariants as pure predicate functions (no callers yet) + a test asserting which already hold against demo data.
- Update: `INVENTORY_IMPLEMENTATION_STATE.md`.

**Files/modules that must NOT change:** all of `src/lib/stockWorkflow.ts`, `src/lib/dispatchWorkflow.ts`, `src/features/inventory/hooks/useInventory.ts`, `src/features/procurement/**`, `firestore.rules`, `firestore.indexes.json`, any UI.

**Database/schema impact:** none.

**Cross-module impact:** none (tests only).

**Migration strategy:** n/a.

**Backward compatibility:** total — no runtime change.

**Failure scenarios:** emulator still cannot run (no JDK) → escalate; document that Phase 00 is blocked on environment and later rules-touching phases must run the suite in CI only.

**Rollback strategy:** delete the test files.

**Tests required:**
- New baseline suites (must pass, pinning current behavior).
- New `stockRoleMatrix.emulator.test.ts` (records which roles are allowed — expected: some denials that later phases will fix).
- Full existing `npx vitest run` — record the baseline pass/fail count (~29 brittle source-string UI tests fail as a documented baseline per `BRAIN.md` §35).

**Manual verification:** in the running app, exercise: Add Stock, Adjust Stock, create a GRN, verify a dispatch, cancel an order with a dispatch. Screenshot the resulting `stock` + `stock_ledger` docs. Attach to the STATE file.

**TypeScript verification:** `npm run lint` → must match the pre-phase baseline (3 pre-existing attendance-test errors, 0 in inventory).

**Build verification:** `npm run build` → success.

**Firestore verification:** `firebase emulators:exec --only firestore --project neozy-demo-isolation-test "npx vitest run --config vitest.emulator.config.ts"` in 2–3 batches → record result. **This phase's deliverable is a green emulator run.**

**Completion criteria:**
1. All baseline suites written and passing (pinning current behavior, defects included).
2. `stockRoleMatrix.emulator.test.ts` written and passing — **P1-3 confirmed or denied in the STATE file.**
3. Emulator suite runs locally (or documented CI-only).
4. `INVENTORY_INVARIANTS.ts` written; a report of which invariants hold today.
5. STATE file updated with the screenshots + role-matrix result + baseline test counts.

**Commit boundary:** one commit — `test(inventory): baseline harness + role matrix + invariants (INVENTORY-00)`.

---

### INVENTORY-01 — Dispatch Stock-OUT Transaction Safety

**Phase ID:** INVENTORY-01
**Objective:** Make `executeAndVerifyDispatch`'s per-line stock decrement + ledger write **atomic** and **non-oversellable**, without changing what a dispatch does or introducing the movement engine.

**Why here:** P0-1 is the single most dangerous *active* corruption path and the fix is self-contained (one function, mirroring the already-transactional `stockIn`). Doing it before the engine means the worst bleed stops in week 1; the engine migration (05c) later replaces this code but the interim fix is small and reversible.

**Problems addressed:** P0-1. Partial P1-6 (add product/warehouse existence check in the same function).

**Problems intentionally NOT addressed:** P1-4 (still two writers), P0-3 (no reservation), P1-3 (role gate — waits for 00's result), the non-atomicity *between* the stock loop and the order-items/dispatch-doc updates (that's 05c/04).

**Current behavior:** `dispatchWorkflow.executeAndVerifyDispatch` (`:258-321`) — per item: `getDocs(stock query)` → `if (available < verifiedQty) throw` → `updateDocById(STOCK)` → `createDocWithId(STOCK_LEDGER)`. Sequential, no transaction → RMW race, oversell.

**Target behavior:** per item, one `runTransaction`: `get(stockRef)` → recompute `available` from the fresh read → `if (available < verifiedQty) throw` → `transaction.set(stockRef, {availableQty: available - verifiedQty, …})` + `transaction.set(ledgerRef, {…})`. Deterministic `ledgerRef` id = `DISPATCH_OUT:dispatch:{DSP}:{productId}` (sanitized) → **also delivers idempotency for double-click** (a second verify of the same line is a no-op read). Add: reject if `dispatch.status` is already `Dispatched`/`Delivered`/`Closed`. Add: `getOne(PRODUCTS, productId)` / `getOne(WAREHOUSES, warehouseId)` existence + not-`isDeleted` check before the loop.

**Files/modules expected to change:**
- `src/lib/dispatchWorkflow.ts` — `executeAndVerifyDispatch` (both `firebaseEnv.isConfigured` branches).
- `src/lib/__tests__/dispatchWorkflow.test.ts` — add concurrency + idempotency + oversell + deleted-product tests.
- Possibly `firestore.indexes.json` — none expected (query already `productId + warehouseId + companyId`, index exists).

**Files/modules that must NOT change:** `stockWorkflow.ts`, `useInventory.ts`, `goodsReceiptWorkflow.ts`, `firestore.rules` (the existing `stock` rules already permit a Warehouse-role transactional update; **if the emulator test from 00 shows the dispatch actor's role is denied, STOP and fold the role fix into this phase with an emulator test**), UI.

**Database/schema impact:** **additive** — `stock_ledger` rows gain a stable `idempotencyKey` field and a deterministic doc id. Existing random-id rows are untouched and still valid. No migration.

**Cross-module impact:** Dispatch (HIGH — core path rewritten), Stock (HIGH — write shape), Ledger (MEDIUM — new field + id scheme), Orders (LOW — order-items update unchanged in this phase), Products/Warehouse (LOW — read-only existence check), Procurement (NONE), Invoice (NONE), Permissions (LOW — verify no regression), API (NONE).

**Migration strategy:** none needed. New rows use deterministic ids; old rows keep random ids; queries are by `productId`/`warehouseId`/`referenceId`, not by id.

**Backward compatibility:** dispatch verification behaves identically for the happy path; only concurrent/duplicate/oversell cases change (they now fail safely instead of corrupting). Ledger consumers already handle schema B; the new `idempotencyKey` is additive.

**Failure scenarios:** (a) transaction contention under heavy concurrent dispatch of the same product → Firestore retries; if it exhausts retries the verify fails with a clear error (acceptable — better than oversell). (b) deterministic-id collision if two different dispatches verify the same product on the same dispatch id — impossible (dispatch id is unique). (c) the actor's role is silently denied at the rules layer → caught by the new emulator test; if so this phase expands to include the role fix.

**Rollback strategy:** revert the single commit. No data migration to undo. Ledger rows written during the phase remain valid (extra field is harmless).

**Tests required:**
- `dispatchWorkflow.test.ts`: two concurrent verifies of the last unit → exactly one succeeds, `availableQty` never negative, one OUT ledger row.
- Double-click: same verify twice → one OUT movement, second is a no-op or a clean "already dispatched" error.
- Oversell: verifiedQty > available → throws, no write.
- Deleted product / deleted warehouse → clear error, no write.
- Existing dispatch tests still green.
- `dispatchOut.baseline.test.ts` from Phase 00 — **update it** to the new expected behavior (document the change in the commit).

**Manual verification:** verify a real dispatch; open two browser tabs and verify the same line simultaneously; confirm `stock` and `stock_ledger` in Firestore console.

**TypeScript:** `npm run lint` → baseline.
**Build:** `npm run build` → success.
**Firestore:** emulator suite (batched) → green; specifically `stockRoleMatrix` + any dispatch rules test.

**Completion criteria:** all tests green; manual concurrent verify shows no oversell; STATE updated; commit made.

**Commit boundary:** `fix(inventory): atomic + idempotent dispatch stock-out (INVENTORY-01, P0-1)`.

---

### INVENTORY-02 — Inventory Write Boundary

**Phase ID:** INVENTORY-02
**Objective:** Ensure stock quantities cannot be mutated through any path that skips the ledger and the security rules — starting with the REST API.

**Why here:** P0-2 is an *active* bypass with zero audit trail; the fix is tiny and isolated (registry/handler) **if Phase 00 confirmed no live client uses `PUT /api/stock`**. It must land before the engine so the engine is genuinely the only writer.

**Problems addressed:** P0-2. Partial P2-6 (document that `stock_ledger` create needs a role/delta gate — applied in 05).

**Problems intentionally NOT addressed:** the three SDK write paths (that's 05); the `stock` rules role gate (03/05).

**Current behavior:** `api/_lib/registry.ts:22` registers `stock` (and effectively `stock_ledger` is not registered but `stock` is) for generic REST CRUD. `api/[entity]/[id].ts` PUT → arbitrary field update via Admin SDK, rules bypassed, no ledger. `api/[entity].ts` POST → create.

**Target behavior:** `stock` becomes **read-only via the API** — `GET /api/stock`, `GET /api/stock/:id` work; `POST`/`PUT`/`DELETE` on `stock` and `stock_ledger` return `405 Method Not Allowed` with a message pointing to the SPA workflow. Decision recorded in the STATE file: read-only vs. fully removed.

**Files/modules expected to change:**
- `api/_lib/registry.ts` — mark `stock` (and `stock_ledger` if present) as read-only (add a `readOnly: true` flag or a `WRITE_BLOCKED` set).
- `api/[entity].ts`, `api/[entity]/[id].ts` — honor the read-only flag on POST/PUT/DELETE.
- `api/_lib/__tests__/` — new test: `PUT /api/stock/:id` → 405; `GET` still works.

**Files/modules that must NOT change:** `firestore.rules`, all SDK stock code, UI. Other API entities.

**Database/schema impact:** none.

**Cross-module impact:** API (MEDIUM — one entity's write surface removed), everything else NONE. **Phase 00 must confirm no internal tool / integration / mobile path calls `POST|PUT /api/stock`** — grep `api/stock`, check `src/lib/apiClient*`, check any automation. If a caller exists, this phase expands to migrate that caller first.

**Migration strategy:** none. If a caller is found: point it at the SPA workflow or (later) `applyStockMovement` via a thin authenticated endpoint.

**Backward compatibility:** read access unchanged. Write access removed — acceptable because the audit shows no legitimate write client and writes were unsafe.

**Failure scenarios:** an unknown external integration was writing stock via the API and now breaks. Mitigation: Phase 00 inventory of API callers; announce the change; a 405 with a clear message beats silent corruption.

**Rollback strategy:** revert the commit — API write path restored.

**Tests required:** API tests for 405 on write, 200 on read; existing API auth tests green.

**Manual verification:** `curl -X PUT .../api/stock/<id>` with a valid token → 405. `curl .../api/stock` → list works.

**TypeScript / Build / Firestore:** `npm run lint`, `npm run build`, emulator suite (API doesn't touch rules but run it anyway) → all green.

**Completion criteria:** API write on `stock`/`stock_ledger` returns 405; read works; no internal caller broken (verified); STATE updated; commit.

**Commit boundary:** `fix(inventory): make stock read-only via REST API (INVENTORY-02, P0-2)`.

---

### INVENTORY-03 — Procurement Role Reproduction + GRN Integrity

**Phase ID:** INVENTORY-03
**Objective:** (1) Lock in the answer to P1-3 (which roles the rules actually allow to move stock) and align the `stock` write rules with the roles that operationally receive goods and cancel orders. (2) Make GRN idempotent, atomic per line, and consolidate the PO transition table.

**Why here:** GRN is an *active* corruption path (P1-1/2). The role question (P1-3) must be settled before the engine (05) bakes in a role assumption. Consolidating the PO table (P2-4) is cheap and removes a foot-gun before more code touches PO status.

**Problems addressed:** P1-1, P1-2, P1-5 (GRN atomicity), P1-3 (role alignment), P2-4 (PO table), INV-13.

**Problems intentionally NOT addressed:** the movement engine (05 — GRN gets a *local* transactional fix here, then migrates to the engine in 05b), reservation, `incomingQty` reporting.

**Current behavior:** §1.10. `createGoodsReceipt` loops `stockIn` (non-idempotent), then GRN doc, then PO update (full `items[]` replace). Three PO transition tables. Emulator (from Phase 00) shows whether Procurement/Accounts can update an existing `stock` summary.

**Target behavior:**
- GRN receipt runs inside a controlled sequence: per line → one `runTransaction` (stock summary + ledger, deterministic id keyed `PURCHASE_RECEIPT:goods_receipt:{PO}:{lineIndex}:{receivedBeforeThisGRN}`) with an in-txn idempotency check; PO line `receivedQty` updated by a **second** txn that re-reads the PO and increments (not replaces) per line, re-validating `Σ received ≤ ordered` (INV-13); GRN doc written last with a `stockApplied: idempotencyKey[]` marker.
- Concurrent GRNs: the per-line idempotency key includes `receivedBeforeThisGRN`, and the PO-update txn re-reads → the second concurrent GRN either no-ops (same key) or correctly stacks (different key), and can never push `Σ received` over `ordered`.
- `stock` rules: one canonical write-role list `Warehouse|Operations|Admin|GroupAdmin|Procurement` (**final list pending Phase 00 role-matrix + business confirm**) for create/update incl. the `availableQty` field guard. `cancelOrder`'s restore path: decide — either widen the role list to include the roles that cancel, OR route cancel-restore through a privileged callable. (Recommended: widen the rules list; document why.)
- One shared `PURCHASE_ORDER_TRANSITIONS` constant imported by `purchaseOrderWorkflow.ts`, `ProcurementValidationEngine.ts`, and mirrored (not imported — it's a different language) in `firestore.rules` with a comment cross-referencing the TS constant.

**Files/modules expected to change:**
- `src/features/procurement/services/goodsReceiptWorkflow.ts` — `createGoodsReceipt`, `calculateReceiptState`.
- `src/features/procurement/services/purchaseOrderWorkflow.ts` — export the shared transition constant.
- `src/engines/ProcurementValidationEngine.ts` — use the shared constant.
- `firestore.rules` — `stock` create/update role list; `purchase_orders` transition function (align to the shared table).
- `firestore.rules` companion — mirror to `storage.rules` if any identity helper changes (unlikely here).
- Tests: `goodsReceiptWorkflow.test.ts`, `purchaseOrderWorkflow.test.ts`, new `grnConcurrency.emulator.test.ts`, `stockRoleMatrix.emulator.test.ts` (update expectations).

**Files/modules that must NOT change:** `stockWorkflow.stockIn` internals (GRN stops calling it here — or calls a new local `applyReceiptMovement` helper that becomes the engine seed in 05a), dispatch code, reservation (none), UI beyond wiring, Orders.

**Database/schema impact:** **additive** — `stock_ledger` `idempotencyKey`; `goods_receipts.stockApplied[]`; `purchase_orders` unchanged shape. **rules change** — run full emulator suite, watch the 1000-expression budget on `stock`.

**Cross-module impact:** Procurement (HIGH), Stock (HIGH — rules + write shape), Ledger (MEDIUM), Permissions (HIGH — role list change; emulator-gate it), Orders (LOW — cancel-restore role), API (NONE), Products/Warehouse/Quote/Invoice (NONE).

**Migration strategy:** existing GRNs and their random-id ledger rows stay valid. New GRNs write deterministic-id rows + `stockApplied`. No backfill. A one-off **read-only** script (not run automatically) can list POs whose `Σ ledger PURCHASE_RECEIPT` ≠ `Σ line receivedQty` (pre-existing drift) → feeds Phase 06.

**Backward compatibility:** GRN happy path identical. Rules: the new role list is a **superset** of the old for stock writes (adds Procurement) → no legitimate actor loses access; verify with the role matrix.

**Failure scenarios:** (a) budget blow-up on the `stock` rules change → the emulator suite catches it; keep the role check to a single `actorRoleMatches('Warehouse|Operations|Admin|GroupAdmin|Procurement')` call. (b) widening the cancel-restore role opens stock writes to Accounts more broadly than intended → scope carefully; if uncomfortable, use the privileged-callable route instead. (c) concurrent GRN edge case still races → the `receivedBefore` component + PO re-read txn is the guard; test hard.

**Rollback strategy:** revert the commit. **Rules rollback:** re-deploy the prior `firestore.rules` (keep the previous version tagged). Ledger rows written remain valid.

**Tests required:** GRN idempotency (submit twice → one IN); concurrent GRN (two receipts same PO line → `Σ received ≤ ordered`, correct total); over-receipt rejected; partial receipt still works; PO transition table identical across all three sources (a test that imports all three and asserts equality); role matrix — Procurement can now receive into an existing summary.

**Manual verification:** create a PO, send it, receive partial, receive again, attempt over-receipt (rejected); double-click "Receive"; as a Procurement-role user.

**TypeScript / Build / Firestore:** all green; emulator suite mandatory and batched.

**Completion criteria:** GRN idempotent + atomic per line + over-receipt-proof under concurrency; one PO transition table; role matrix green for Procurement; emulator suite green; STATE updated with the P1-3 resolution and the final role list; commit.

**Commit boundary:** `fix(inventory): idempotent+atomic GRN, unified PO transitions, stock write-role alignment (INVENTORY-03)`.

---

### INVENTORY-04 — Order & PO Lifecycle Locks

**Phase ID:** INVENTORY-04
**Objective:** Prevent order line quantities from being edited after dispatch has started; make `cancelOrder` atomic and honest about invoices; guard against repeat PI generation and repeat quote→order conversion.

**Why here:** These are *active* data-integrity holes (P1-8 confirmed) that are self-contained and do **not** depend on the movement engine. Locking the order lifecycle before the engine migration means 05c/07 build on a stable order shape. Low structural risk.

**Problems addressed:** P1-8, P2-2 (cancel atomicity), P2-7 (PI repeat), P2-8 (convert race), INV-12.

**Problems intentionally NOT addressed:** reservation (07), the actual stock restore atomicity inside cancel (that's 05d — here we only make the *order/dispatch status* changes atomic and add the PI-reversal flags), order status *state machine* beyond the dispatch lock (Future / 07).

**Current behavior:** `Orders.tsx:289-293` full-replace edit, no lock. `cancelOrder` non-atomic, flags only, no PI reversal. `generatePIsFromOrder` no `piGenerated` check. `convertQuotationToOrder` read-then-write lock.

**Target behavior:**
- **Order edit lock:** a shared `isOrderLineLocked(order)` = `true` if `Σ order.items[].dispatchedQty > 0` OR `order.status ∈ {Partial Dispatch, Dispatched, Closed, Cancelled}`. `Orders.tsx` save (edit branch) and any `orderWorkflow.updateOrder` (new, extracted) reject line/qty/product changes when locked (non-line fields — notes, customer contact — still editable). Enforce at the workflow layer, not just UI. **Rules:** add an `orders` diff guard — but `orders` is on the generic fallback; adding a dedicated `orders` block is a larger rules change → **decide in this phase**: workflow-layer enforcement now, dedicated rules block deferred to a later rules-consolidation phase (documented as a known client-only gap, like HR-1).
- **`cancelOrder`:** wrap the order-status + dispatch-status writes in one `runTransaction` (re-reading each). Set `piReversalRequired: true` + list affected PI/tax-invoice ids on the order. (Actual stock restore stays as-is here — `stockIn` calls — and migrates to the engine in 05d.) Keep the existing `CANCEL:` idempotency key.
- **PI repeat guard:** `generatePIsFromOrder` → `if (order.piGenerated && order.generatedPIs?.length) throw 'PIs already generated for this order'` unless an explicit `force` flag.
- **Convert race:** `convertQuotationToOrder` → move the lock check + order create into one `runTransaction` on the quotation (re-read `convertedOrderId` inside the txn; if set, return the existing order id).

**Files/modules expected to change:**
- `src/pages/Orders.tsx` — save mutation edit branch.
- `src/lib/orderWorkflow.ts` — new `updateOrder(id, patch)` with the lock; export `isOrderLineLocked`.
- `src/lib/stockWorkflow.ts` — `cancelOrder` status writes → one txn; PI-reversal flags.
- `src/lib/invoiceWorkflow.ts` — `generatePIsFromOrder` repeat guard.
- `src/lib/quotationWorkflow.ts` — `convertQuotationToOrder` txn-guard.
- Tests: `orderWorkflow.test.ts`, `stockWorkflow.test.ts` (cancel), `invoiceWorkflow.test.ts`, `quotationWorkflow` test (new), mobile order edit path check (`MobileOrder*` — must call the same workflow).

**Files/modules that must NOT change:** stock write paths' *quantity* logic, GRN, dispatch OUT internals, reservation, `firestore.rules` `stock` block, Products/Categories/Warehouses.

**Database/schema impact:** **additive** — `orders.piReversalRequired`, `orders.reversalInvoiceIds[]`. No migration (absent = false).

**Cross-module impact:** Orders (HIGH), Quotations (MEDIUM — convert), Invoice (MEDIUM — PI guard + reversal flags), Dispatch (LOW — read status in cancel txn), Stock (LOW — cancel still calls `stockIn` unchanged), Payments (LOW), Procurement (NONE), Permissions (NONE — workflow-layer), API (LOW — `orders` API PUT still bypasses this; document as a known gap → tighten when `orders` gets a dedicated rules block).

**Migration strategy:** none. New flags default false/empty.

**Backward compatibility:** unlocked orders edit exactly as before. Locked orders reject line edits with a clear message (new, desired). Cancel produces the same stock restore + extra flags.

**Failure scenarios:** (a) a legitimate need to edit a dispatched order (e.g. fix a typo in a product name) is now blocked → the lock is line/qty/product only; text fields stay editable; provide an Admin override path if the business needs one (Future). (b) `orders` API PUT still allows the bad edit → documented gap, not a regression (it was already possible). (c) convert txn contention → Firestore retries.

**Rollback strategy:** revert the commit. Flags left on orders are harmless.

**Tests required:** edit a dispatched order's qty → rejected; edit its notes → allowed; cancel an order → order + dispatches all flip in one txn (simulate a mid-write failure → nothing partially applied); generate PIs twice → second rejected; convert a quote twice concurrently → one order, same id returned.

**Manual verification:** dispatch part of an order, then try to change a line qty (blocked); cancel it (check flags + stock restore); try "Generate PI" twice.

**TypeScript / Build / Firestore:** all green.

**Completion criteria:** order line lock enforced at workflow layer + UI; cancel status-atomic + reversal flags; PI + convert guards; tests green; STATE updated (note the `orders` API/rules gap as deferred); commit.

**Commit boundary:** `fix(inventory): order line lock + atomic cancel + PI/convert guards (INVENTORY-04)`.

---

### INVENTORY-05a — Movement Engine + Adapter (dormant)

**Phase ID:** INVENTORY-05a
**Objective:** Introduce `src/lib/inventory/stockMovementEngine.ts` (`applyStockMovement`) and a compatibility adapter, fully tested, **with no caller migrated yet**. The engine is dead code until 05b.

**Why here:** After the active bleeds are stopped (01–04), build the foundation. Landing the engine dormant lets it be reviewed and tested in isolation with zero runtime risk.

**Problems addressed:** foundation for P1-4, INV-1/2/5/7/8. None resolved yet.

**Problems intentionally NOT addressed:** everything — no behavior changes. `stockIn`, `useSaveStockEntry`, dispatch OUT, GRN all still run their own code.

**Current behavior:** three writers, two ledger schemas, `onHandQty` absent, `reservedQty` dead.

**Target behavior:** a new module exporting `applyStockMovement(input): Promise<MovementResult>` implementing §4.1/§9/§10 — one `runTransaction`, deterministic ledger id, in-txn idempotency, invariant guards (INV-1/2/7/8; INV-3/4 gated behind a `reservationsEnabled` flag = false), manual `companyId`/`groupId` stamping, **dual-write** the legacy ledger fields (`type`, `referenceType`/`referenceId`, `date`, `sourceType`/`sourceId`) so existing ledger consumers keep working. Writes `onHandQty` AND `availableQty = onHandQty` (reserved 0). Consolidate the duplicated `stockSummaryId` into one shared export the engine and `useInventory` both import (delete the local copy).

**Files/modules expected to change:**
- New: `src/lib/inventory/stockMovementEngine.ts`, `src/lib/inventory/types.ts`, `src/lib/inventory/idempotency.ts`, `src/lib/inventory/__tests__/stockMovementEngine.test.ts` + an emulator test.
- `src/lib/workflow.ts` — keep `stockSummaryId` as the single source; `src/features/inventory/hooks/useInventory.ts` — import it, delete the local duplicate (the ONLY behavior-adjacent change in 05a; it's a pure de-dup, same string output — covered by a test).

**Files/modules that must NOT change:** `stockWorkflow.ts`, `dispatchWorkflow.ts`, `goodsReceiptWorkflow.ts` logic; `firestore.rules` (the engine's writes must satisfy the *existing* `stock`/`stock_ledger` rules — verify in the emulator test; if they don't, STOP and reconcile).

**Database/schema impact:** **additive only, and only when called** (not called in 05a): `stock.onHandQty`, `stock_ledger.{movementType, direction, idempotencyKey, onHandBefore/After, reservedBefore/After}`. No migration.

**Cross-module impact:** NONE at runtime (dormant). Code review load: HIGH (new critical module).

**Migration strategy:** the engine is the migration *target*; 05b–05d are the migration.

**Backward compatibility:** total — nothing calls it.

**Failure scenarios:** the engine's write shape violates the current `stock_ledger` create rule (e.g. missing `transactionId`) → the emulator test in 05a catches it; the engine must satisfy today's rules unchanged.

**Rollback strategy:** delete the module (and restore the `useInventory` local `stockSummaryId` — trivial).

**Tests required:** unit — every movement type; idempotency (call twice → one effect); INV-1/2/7/8 guards; `companyId`/`groupId` stamping; legacy-field dual-write. Emulator — a Warehouse-role actor calling the engine's write shape succeeds under the current rules; a cross-company attempt fails.

**Manual verification:** none (dormant) — but add a hidden dev-only trigger or a test-only script to fire one movement against the emulator and eyeball the resulting docs.

**TypeScript / Build / Firestore:** all green; emulator mandatory.

**Completion criteria:** engine + tests merged, dormant; `stockSummaryId` de-duplicated; emulator confirms the engine's writes pass current rules; STATE updated; commit.

**Commit boundary:** `feat(inventory): dormant stock movement engine + adapter (INVENTORY-05a)`.

---

### INVENTORY-05b — Migrate GRN → engine

**Objective:** `goodsReceiptWorkflow.createGoodsReceipt` calls `applyStockMovement('PURCHASE_RECEIPT', …)` instead of its Phase-03 local transactional receipt. Behavior-equivalent; now on the shared engine.
**Why here:** GRN is the simplest IN path and already made idempotent/atomic in 03 — lowest-risk first migration, proves the engine end-to-end.
**Problems addressed (final):** P1-1/2/5 now ride the shared engine; INV-13 re-checked in the engine caller.
**Not addressed:** dispatch, manual, cancel (still on old code).
**Files:** `goodsReceiptWorkflow.ts`; its tests; `grnConcurrency.emulator.test.ts`.
**Must NOT change:** dispatch/manual/cancel stock code; rules (engine already rule-compatible from 05a).
**Schema impact:** GRN ledger rows now carry the full new schema (+legacy fields). Additive.
**Cross-module:** Procurement (MEDIUM), Stock/Ledger (MEDIUM). Others NONE.
**Migration:** old GRN ledger rows untouched; new ones full-schema. No backfill.
**Backward compat:** GRN happy path + idempotency + over-receipt all identical (re-run Phase-03 tests unchanged).
**Failure:** engine edge case not covered by 05a → the Phase-03 GRN test suite is the safety net; keep it green.
**Rollback:** revert to the Phase-03 local receipt code (kept in git history / or behind a `USE_MOVEMENT_ENGINE_GRN` flag for one release).
**Tests:** all Phase-03 GRN tests pass **unchanged**; add: GRN ledger row has `movementType:'PURCHASE_RECEIPT'` + `idempotencyKey`.
**Verification:** `npm run lint`, `npm run build`, emulator suite; manual GRN.
**Completion:** GRN fully on the engine; Phase-03 tests green unchanged; commit.
**Commit:** `refactor(inventory): GRN receipt via movement engine (INVENTORY-05b)`.

### INVENTORY-05c — Migrate Dispatch OUT → engine

**Objective:** `executeAndVerifyDispatch` per-line decrement calls `applyStockMovement('DISPATCH_OUT', …)` instead of its Phase-01 local transaction.
**Why here:** after GRN proves the engine, migrate the OUT path. P0-1's interim fix (01) is replaced by the canonical engine.
**Problems addressed (final):** P0-1 on the shared engine; INV-1/7 enforced centrally.
**Not addressed:** reservation-consume (07 — for now `DISPATCH_OUT` only moves `onHandQty`, `reservedQty` still 0).
**Files:** `dispatchWorkflow.ts`; `dispatchWorkflow.test.ts`; dispatch emulator test.
**Must NOT change:** the order-items/dispatch-doc update sequence (that's a separate concern — keep the Phase-01 shape), GRN/manual/cancel.
**Schema impact:** dispatch ledger rows → full new schema + legacy `referenceType`/`referenceId`/`date`. Additive.
**Cross-module:** Dispatch (MEDIUM), Stock/Ledger (MEDIUM). Orders (LOW — item update unchanged).
**Migration:** none; old OUT rows keep schema B, new ones carry both.
**Backward compat:** Phase-01 dispatch tests pass unchanged.
**Failure:** engine's `DISPATCH_OUT` guard rejects a valid dispatch (e.g. rounding) → Phase-01 test suite catches it.
**Rollback:** revert to Phase-01 local transaction (flag `USE_MOVEMENT_ENGINE_DISPATCH`).
**Tests:** all Phase-01 dispatch tests unchanged; ledger row `movementType:'DISPATCH_OUT'`.
**Verification:** full set + emulator; manual concurrent verify.
**Completion:** dispatch OUT on the engine; commit.
**Commit:** `refactor(inventory): dispatch stock-out via movement engine (INVENTORY-05c)`.

### INVENTORY-05d — Migrate Manual + Cancel → engine; retire the duplicate writer

**Objective:** `useInventory.useSaveStockEntry` and `stockWorkflow.cancelOrder`'s restore call the engine. `stockWorkflow.stockIn` becomes a thin deprecated wrapper over `applyStockMovement` (or is deleted if it has no other callers). One writer remains.
**Why here:** last migration — closes P1-4 completely.
**Problems addressed (final):** P1-4; P2-2 (cancel restore now atomic per line via the engine).
**Not addressed:** reservation, reconciliation.
**Files:** `useInventory.ts` (`useSaveStockEntry`, `useDeleteStockEntry`), `stockWorkflow.ts` (`stockIn` → wrapper/delete; `cancelOrder` restore loop), their tests, any other `stockIn` caller (grep — `taxInvoiceWorkflow`? no, that's the counter; check `installationEngine`, `projectWorkflow`).
**Must NOT change:** GRN/dispatch (already migrated), rules.
**Schema impact:** manual + cancel ledger rows → full new schema. Additive.
**Cross-module:** Stock UI (MEDIUM), Orders (LOW — cancel), Procurement (NONE — already migrated).
**Migration:** **decommission the duplicate `stockSummaryId` + the second transaction implementation.** Grep for any remaining `transaction.set(*, {*availableQty*})` outside the engine → must be zero (add an ESLint rule or a test that greps).
**Backward compat:** manual Add/Adjust Stock + order cancel behave identically (happy path); the baseline tests from Phase 00 are updated to the engine's ledger shape (documented).
**Failure:** a hidden `stockIn` caller breaks → the grep in this phase's checklist finds them all first.
**Rollback:** revert the commit; `stockIn` and the local transaction return.
**Tests:** manual IN/OUT via engine; negative OUT rejected; cancel restore idempotent; **a repo-wide test/lint asserting no `stock`-summary write exists outside `stockMovementEngine.ts`**.
**Verification:** full set + emulator; manual Add/Adjust/Cancel.
**Completion:** exactly one code path writes `stock`; `INV-7` holds; commit.
**Commit:** `refactor(inventory): single writer — retire duplicate stock transaction (INVENTORY-05d, P1-4)`.

---

### INVENTORY-06 — Stock ↔ Ledger Reconciliation (read-only)

**Phase ID:** INVENTORY-06
**Objective:** A read-only `StockReconciliationEngine` + a report surface that computes `Σ ledger` per summary and flags mismatches with `onHandQty`. **No automatic correction.**

**Why here:** only meaningful once (a) one writer exists (05) so *new* movements can't drift, and (b) the ledger schema is consistent. The engine surfaces *historical* drift (from the pre-05 non-atomic OUT path and any API writes) for human correction.

**Problems addressed:** P2-1, INV-5 (detection). Enables safe correction of pre-existing drift.

**Problems intentionally NOT addressed:** auto-correction (a human triggers a `RECONCILE_ADJUST` movement through the engine — deliberately manual), scheduled/cron reconciliation (Future — decide frequency then).

**Current behavior:** no reconciliation anywhere.

**Target behavior:** `src/engines/StockReconciliationEngine.ts` (mirrors `ProcurementValidationEngine`) — `reconcileSummary(sumId)`, `reconcileWarehouse(whId)`, `generateStockHealthReport()`. Computes `computedOnHand = Σ(IN qty) − Σ(OUT qty)` from `stock_ledger`, compares to `stock.onHandQty`, returns `{ summaryId, stored, computed, delta, ledgerRowCount, firstMovementAt, lastMovementAt }`. A read-only report page under `/stock` (or a section in `StockWorkspace`) + a runnable script. A **human-approved** "Apply correction" action that calls `applyStockMovement('RECONCILE_ADJUST', { qty: delta, reasonCode, approvedBy })` — audit-logged, one summary at a time, confirmation dialog showing the ledger history.

**Files/modules expected to change:**
- New: `src/engines/StockReconciliationEngine.ts` + `__tests__`.
- New: `src/features/stock/components/StockReconciliationReport.tsx` (read-only) + wire into `StockWorkspace`/`Stock.tsx` behind `canDo('edit','stock')` or Admin.
- New: `scripts/inventory/reconcile.ts` (read-only report).
- `src/lib/inventory/stockMovementEngine.ts` — add `RECONCILE_ADJUST` handling (audit flag).
- Tests + emulator test for the correction path.

**Files/modules that must NOT change:** the engine's core movement logic, GRN/dispatch/manual callers, rules (unless the report needs a new read scope — it reads `stock` + `stock_ledger` which the actor can already read).

**Database/schema impact:** none new (reads existing). `RECONCILE_ADJUST` ledger rows are normal movement rows with a flag.

**Cross-module impact:** Stock (MEDIUM — new report + a new movement type), Ledger (LOW — read + one new movement type), everything else NONE.

**Migration strategy:** the *output* of this phase feeds a one-time **manual** correction campaign: run the report, review each mismatch with a human, apply `RECONCILE_ADJUST` where the physical count is known. Not code migration.

**Backward compatibility:** total — read-only engine + an opt-in correction action.

**Failure scenarios:** the "computed" number is itself wrong because the historical ledger is incomplete (pre-05 OUT gaps) → **this is expected**; the report must present it as "ledger-derived, may be incomplete for movements before <05c commit date>" and the human decides based on a physical count, never blindly trusting `computed`.

**Rollback strategy:** revert; delete the report page and engine. `RECONCILE_ADJUST` rows already written stay valid.

**Tests required:** engine math (opening + IN − OUT = computed); mismatch detection; the correction path applies exactly `delta` and is idempotent per run-id; the report is read-only (no write on load).

**Manual verification:** seed a known mismatch in the emulator; run the report; apply a correction; confirm the ledger + summary.

**TypeScript / Build / Firestore:** all green.

**Completion criteria:** report page live; engine tested; correction path is human-gated + audit-logged + idempotent; STATE updated with the count of current mismatches found; commit.

**Commit boundary:** `feat(inventory): stock-ledger reconciliation engine + report (INVENTORY-06, P2-1)`.

---

### INVENTORY-07 — Sales Reservation / Allocation

**Phase ID:** INVENTORY-07
**Objective:** Implement the frozen reservation policy (§7): reserve stock when a PI is paid, release on cancel, consume on dispatch. Activate `reservedQty` and make `availableQty = onHandQty − reservedQty`.

**Why here:** the highest-business-risk phase. It needs: the single writer (05), reconciliation to trust the numbers (06), the order lifecycle lock (04), and **business sign-off on §7's open decisions**. Doing it last among the "engine" phases contains the blast radius.

**Problems addressed:** P0-3, INV-3, INV-4.

**Problems intentionally NOT addressed:** loading/allocation-to-specific-dispatch (Future), reservation expiry (Future), backorder (default off).

**Current behavior:** `markPIAsPaid` sets a cosmetic `order.stockBlocked`. `reservedQty` dead. `availableQty == onHandQty`.

**Target behavior:**
- New collection `stock_reservations/{RSV-*}` — `{ id, companyId, groupId, orderId, orderLineKey, productId, warehouseId, qtyReserved, qtyConsumed, qtyReleased, status: 'active'|'consumed'|'released'|'partial', piId, createdAt }`. Dedicated rules block.
- New field `order.fulfilmentWarehouseId` (chosen at PI-payment time, or a company-default — **business decision**).
- `markPIAsPaid` → after the PI/order txn, per order line: `applyStockMovement('SALES_RESERVE', { qty, warehouseId: order.fulfilmentWarehouseId, sourceType:'proforma_invoice', sourceId: PI-id, lineKey })` + create the `stock_reservations` doc. Idempotent by `SALES_RESERVE:proforma_invoice:{PI}:{lineKey}`. If available < requested → reserve available, set `order.stockShortfall[]` (default policy — confirm).
- Engine: `SALES_RESERVE` → `reservedQty += qty` (guard INV-3: `reservedQty ≤ onHandQty` unless backorder enabled), `availableQty = onHandQty − reservedQty`, no `onHandQty` change.
- `executeAndVerifyDispatch` (`DISPATCH_OUT`) → now also decrements `reservedQty` by `min(verifiedQty, activeReservationForThisLine)` and updates the `stock_reservations` doc. Idempotent.
- `cancelOrder` → `SALES_RELEASE` for the unconsumed reservation remainder; `stock_reservations.status = 'released'`.
- `availableQty` semantics change: engine now maintains `availableQty = onHandQty − reservedQty` everywhere. **This is the one semantic change in the whole roadmap** — it lands here, behind the single writer, with reconciliation in place.
- UI: order/PI/dispatch screens show `available` vs `on-hand` vs `reserved`; a "reservations" panel per product.

**Files/modules expected to change:**
- New: `src/lib/inventory/reservations.ts`, `stock_reservations` rules block in `firestore.rules`, index in `firestore.indexes.json`.
- `src/lib/invoiceWorkflow.ts` — `markPIAsPaid` (+ `fulfilmentWarehouseId` capture).
- `src/lib/inventory/stockMovementEngine.ts` — `SALES_RESERVE`/`SALES_RELEASE`; `DISPATCH_OUT` reservation consume; flip INV-4 on.
- `src/lib/dispatchWorkflow.ts` — pass reservation context to the engine.
- `src/lib/stockWorkflow.ts` — `cancelOrder` release.
- `src/pages/Orders.tsx`, PI/dispatch UI, `useStockSummary` consumers — show the 3 quantities.
- Many tests + emulator tests.

**Files/modules that must NOT change:** GRN receipt logic (IN unaffected), warehouse transfer (08), master data, reconciliation engine core (it gains reservation awareness but the math is additive), tax invoice.

**Database/schema impact:** **new collection** `stock_reservations` + rules + index. **new field** `order.fulfilmentWarehouseId`, `order.stockShortfall[]`. **semantic change** to `availableQty` (now derived from onHand−reserved) — but the field already exists and is engine-maintained, so no doc migration; a **backfill** is needed to set `onHandQty` on any summary that predates 05 and to recompute `availableQty` (run reconciliation first).

**Cross-module impact:** Order (HIGH), PI (HIGH), Payment (MEDIUM), Dispatch (HIGH), Stock (HIGH — availableQty meaning), Ledger (MEDIUM — RESERVE/RELEASE rows), Reconciliation (MEDIUM — must account for reserved), Quotation (LOW — could show availability now), Procurement (NONE), Permissions (MEDIUM — reservations rules), API (LOW).

**Migration strategy:** **dual-read period** — UI reads `availableQty` but also displays `onHandQty` (fallback `availableQty` for old summaries). **Backfill script** (run once, reviewed): for every `stock` summary, set `onHandQty = availableQty` if `onHandQty` absent, recompute `availableQty = onHandQty − Σ(active reservations)` (0 for all, since reservations start empty). Existing paid orders: **decide** — retro-reserve for currently-paid-undispatched orders, or start clean from the deploy date (recommended: **start clean**, document it).

**Backward compatibility:** orders/PIs created before the phase have no reservation; they dispatch fine (engine consumes `min(verified, 0)` = 0 reservation, just moves onHand). New PIs reserve. `availableQty` for an unreserved product == `onHandQty` (no visible change).

**Failure scenarios:** (a) `fulfilmentWarehouseId` unknown at PI time → fall back to company default warehouse or block payment with a "choose warehouse" prompt (business decision). (b) over-reservation when two PIs pay simultaneously for the last units → engine INV-3 guard + txn serialization on the summary → the second reserves only what's left + shortfall flag. (c) reservation/dispatch/release accounting drifts → reconciliation engine extended to check `reservedQty == Σ(active reservation remainders)`.

**Rollback strategy:** feature-flag `reservationsEnabled`. Off → engine skips RESERVE/RELEASE, `availableQty = onHandQty`, `markPIAsPaid` sets only the old flag. Reverting the flag is instant; the `stock_reservations` docs become inert. Full revert = revert commits + set every `availableQty = onHandQty` (a script).

**Tests required:** reserve on PI paid; reserve caps at available + shortfall flag; dispatch consumes reservation; cancel releases remainder; concurrent PI payment for last units; `availableQty == onHandQty − reservedQty` invariant; idempotency on every new movement; reconciliation includes reserved.

**Manual verification:** full B2B flow — order → PI → pay (stock reserved, available drops) → partial dispatch (reserved + onHand drop) → cancel (remainder released). Same for B2C via project.

**TypeScript / Build / Firestore:** all green; emulator mandatory (new rules block).

**Completion criteria:** reservation lifecycle works end-to-end; INV-3/4 enforced; feature-flagged; backfill script reviewed + run on a copy; business sign-off recorded in STATE; commit(s).

**Commit boundary:** likely 2–3 commits — `feat(inventory): reservation collection + engine RESERVE/RELEASE (07a)`, `feat(inventory): reserve-on-PI-paid + dispatch consume + cancel release (07b)`, `feat(inventory): availableQty = onHand − reserved + UI (07c)`.

---

### INVENTORY-08 — Warehouse Transfer

**Phase ID:** INVENTORY-08
**Objective:** A first-class warehouse-to-warehouse transfer: `TRANSFER_OUT` at source → in-transit → `TRANSFER_IN` at destination, paired and reconcilable.

**Why here:** needs the engine (05). Independent of reservation (07) — could swap order with 07 if the business prioritizes transfers, but 07's risk argues for doing the lower-risk 08 after 07 is stable. **Reorder permitted with justification.**

**Problems addressed:** missing feature; INV-11.

**Problems intentionally NOT addressed:** multi-hop transfers, transfer approval workflow (Future), transfer cost/valuation.

**Current behavior:** no transfer feature; a "transfer" is a manual OUT + manual IN, unlinked.

**Target behavior:** new collection `stock_transfers/{TRF-*}` — `{ id, companyId, groupId, fromWarehouseId, toWarehouseId, items[{productId, qty, unit}], status: 'draft'|'in_transit'|'received'|'cancelled', shippedBy, shippedAt, receivedBy, receivedAt }`. Actions: **Ship** → per item `applyStockMovement('TRANSFER_OUT', { warehouseId: from, transferId })`, status `in_transit`. **Receive** → per item `applyStockMovement('TRANSFER_IN', { warehouseId: to, transferId })`, status `received`. **Cancel** (only while `draft`, or `in_transit` → reverse with `TRANSFER_IN` back to source). In-transit qty is derived (transfers where `status == in_transit`).

**Files/modules expected to change:**
- New: `src/features/warehouses/services/warehouseTransferWorkflow.ts`, `stock_transfers` rules block + index, UI page/section, mobile shell (presentation only).
- `src/lib/inventory/stockMovementEngine.ts` — `TRANSFER_OUT`/`TRANSFER_IN`.
- `src/engines/StockReconciliationEngine.ts` — account for in-transit (Σ of a transfer pair = 0; INV-11).

**Files/modules that must NOT change:** reservation, GRN, dispatch, order lifecycle, master data.

**Database/schema impact:** new collection + rules + index. No migration.

**Cross-module impact:** Stock (MEDIUM), Ledger (LOW — 2 new types), Warehouse (MEDIUM — new UI), everything else NONE.

**Migration:** none.

**Backward compatibility:** total — new feature, opt-in.

**Failure scenarios:** ship succeeds, receive never happens → stock sits "in transit" (visible, reconcilable); provide a cancel/return path. Partial receipt (some items lost in transit) → receive what arrived, flag the shortfall, `RECONCILE_ADJUST` for the loss.

**Rollback strategy:** revert; feature-flag the UI. In-transit transfers at rollback → complete them manually via the engine.

**Tests required:** ship → source drops, in-transit rises; receive → destination rises, in-transit clears; `Σ(TRANSFER_OUT + TRANSFER_IN)` per transfer == 0; cancel in-transit reverses; idempotency on ship + receive; cross-warehouse-same-company only (no cross-company transfer).

**Manual verification:** transfer 5 units A→B; ship; receive; check both summaries + the 2 ledger rows.

**TypeScript / Build / Firestore:** all green; emulator (new rules).

**Completion criteria:** transfer lifecycle works; INV-11 holds; reconciliation accounts for in-transit; commit(s).

**Commit boundary:** `feat(inventory): warehouse transfer with paired movements (INVENTORY-08)`.

---

### INVENTORY-09 — Master Data Integrity

**Phase ID:** INVENTORY-09
**Objective:** Product↔Category ID FK, SKU uniqueness, and delete-reference guards for product / warehouse / category / vendor.

**Why here:** independent of the stock engine structurally, but touches many forms (F-class — high form count, low structural risk). Doing it after the engine avoids competing edits to the same files during the risky phases.

**Problems addressed:** P2-3, P1-7, P2-5.

**Problems intentionally NOT addressed:** batch/expiry, barcode scanning (Future / 10), historical re-linking of old `product.category` strings beyond a best-effort backfill.

**Current behavior:** §1.2/1.3/1.4/1.11. Name-based category link; no uniqueness; soft-delete with no guard.

**Target behavior:**
- **Category:** add `product.categoryId` (keep `category` name as a denormalized display field, engine-maintained). New products set both; a **backfill** maps existing `product.category` strings to `product_categories` by name (unmatched → flagged for manual fix). `parentCategory` → `parentCategoryId` similarly.
- **SKU uniqueness:** a `product_sku_locks/{companyId}_{normalizedSku}` doc written in a transaction on product create/edit (mirrors `customer_phone_locks`), with a `resource == null` rules guard. Blank SKU allowed (no lock).
- **Delete guards:** `useDeleteProduct` → block if any non-deleted `stock` summary has `onHandQty > 0` OR any open order/quotation/PO references the `productId` (query + count; if heavy, a denormalized `productUsageCount` maintained by the engine — decide). `useDeleteWarehouse` → block if any non-deleted `stock` summary for that warehouse has `onHandQty > 0` OR open dispatch/GRN. `useDeleteCategory` → block if any non-deleted product has that `categoryId`. `useVendors` delete → block if any non-cancelled PO references the vendor (or just warn + require confirm).
- `genId` collision: for `products` and other master data, switch create to a real existence check (`getOne` first) or `create` semantics (not `setDoc merge`) — scoped decision per collection.

**Files/modules expected to change:** `useInventory.ts`, `useCategories.ts`, `useWarehouses.ts`, `useVendors.ts`, `ProductForm.tsx`, `CategoryForm.tsx`, `ProductPicker.tsx` (emit `categoryId`), `firestore.rules` (new `product_sku_locks` block), `firestore.indexes.json`, backfill scripts, tests.

**Files/modules that must NOT change:** the stock movement engine, reservation, transfer, dispatch/GRN quantity logic, historical documents' stored line-item snapshots (they keep their `category` string — that's correct history).

**Database/schema impact:** additive fields (`categoryId`, `parentCategoryId`), new `product_sku_locks` collection + rules + index. **Backfill** for `categoryId`. No destructive change.

**Cross-module impact:** Products (HIGH — forms + delete), Categories (MEDIUM), Warehouses (MEDIUM — delete guard), Vendors (LOW), Stock (LOW — delete guard reads summaries), Quotation/Order (LOW — ProductPicker emits categoryId going forward; old lines keep name), Procurement (LOW). Permissions (LOW). API (LOW — `products` API create still skips the lock → documented gap).

**Migration strategy:** dual-field period for category (`category` + `categoryId`); backfill by name; report unmatched. SKU locks created lazily on next edit + a one-time backfill that flags duplicates for manual resolution (does not auto-merge).

**Backward compatibility:** products without `categoryId` still display via the `category` string; the backfill fills most; the picker and forms work either way during transition.

**Failure scenarios:** backfill mis-maps a category due to a duplicate name → the report lists ambiguities for a human; never auto-pick. A delete guard is too aggressive (blocks a legitimate cleanup) → provide an Admin "force archive" with a typed confirmation.

**Rollback strategy:** revert; `categoryId`/lock fields become inert; the `product_sku_locks` collection is ignored.

**Tests required:** duplicate SKU rejected; blank SKU allowed; category rename updates the denormalized `category` on products (or explicitly does not — decide); delete a product with stock → blocked; delete an empty product → allowed; delete a warehouse with stock → blocked.

**Manual verification:** try to create two products with the same SKU; delete a category in use; delete a warehouse with stock.

**TypeScript / Build / Firestore:** all green; emulator (new lock rules).

**Completion criteria:** SKU unique; category by id (backfilled + report); delete guards live; commit(s).

**Commit boundary:** 2–3 commits (`feat(inventory): product SKU uniqueness lock`, `feat(inventory): category id FK + backfill`, `feat(inventory): master-data delete guards`).

---

### INVENTORY-10 — Inventory Operational Features

**Phase ID:** INVENTORY-10
**Objective:** The operational flows a real inventory system needs, now that the core is safe: opening stock, damage/write-off, bulk import/adjustment, low-stock alerts, customer return / RMA.

**Why here:** all depend on the engine (05). None is a corruption risk. Prioritize by business need; each sub-feature is its own commit.

**Problems addressed:** P3-1, P3-2, P3-3 (partial — HSN/GST validation can ride here or 09), P3-5.

**Sub-features (each independently committable):**
- **10a Opening stock:** a dedicated "Opening Stock" entry mode → `applyStockMovement('OPENING_STOCK')`, one per (product, warehouse), guarded against a second opening entry.
- **10b Damage / write-off:** `DAMAGE_OUT` with a `reasonCode` taxonomy (`damaged`, `expired`, `lost`, `theft`, `sample`), an approval threshold (Admin above N units/value).
- **10c Bulk import / bulk adjust:** CSV → validated rows → batched engine calls with a shared `importRunId` for idempotency; a dry-run preview.
- **10d Low-stock alerts:** the engine, after any movement, checks `onHandQty ≤ product.lowStockThreshold` → creates a `notifications` row for Warehouse/Procurement (best-effort). Optional daily digest (Future).
- **10e Customer return / RMA:** a return document → `SALES_RETURN_IN` linked to the original order/dispatch, with a condition flag (resellable → onHand; damaged → `DAMAGE_OUT` immediately).

**Files/modules:** new flows under `src/features/inventory/` + `src/features/stock/`; engine reason-code handling; `CSVImportModal` reuse; notification wiring.
**Must NOT change:** engine core txn logic, reservation, transfer, rules `stock` block (unless a new movement type needs a presence check — additive).
**Schema impact:** additive (`reasonCode`, `importRunId`, return docs collection).
**Cross-module:** Stock (MEDIUM), Notifications (LOW), Orders/Dispatch (LOW — RMA link).
**Migration:** none.
**Backward compat:** total — new opt-in flows.
**Rollback:** per sub-feature revert.
**Tests:** opening-stock double-entry blocked; damage requires reason; bulk import idempotent by run-id + dry-run accurate; low-stock notification fires once per threshold crossing; RMA increases stock and links the order.
**Verification:** full set + emulator; manual each flow.
**Completion:** each sub-feature green + committed independently.
**Commit boundary:** one per sub-feature (10a…10e).

---

### INVENTORY-11 — Scale & Reporting Hardening

**Phase ID:** INVENTORY-11
**Objective:** Remove the scale ceilings: client-side full-collection reads, missing indexes, O(n²) serial scan, and unbounded reporting reads.

**Why here:** independent of everything; pure optimization; last so it doesn't churn files during feature work.

**Problems addressed:** P2-9, P3-6.

**Sub-scope:**
- **11a Serial uniqueness collection:** replace `assertNoDuplicateSerials`' full `getAll(DISPATCH)` scan with a `dispatch_serials/{companyId}_{normalizedSerial}` lock collection (written in the dispatch-verify txn).
- **11b Indexes:** add composite indexes for `product_categories`, `stock_reservations`, `stock_transfers`, and any query the phases above introduced. Remove the API missing-index full-collection fallback (`BRAIN.md` API-6) or make it loud.
- **11c Paginated stock/ledger lists:** `useProducts`/`useStock`/`useStockSummary`/`useCategories`/`useWarehouses` → paginated (`getPage`) with server-side `companyId`/`warehouseId` filters; virtualized tables.
- **11d Ledger volume:** a `stock_ledger` archival/rollup strategy for old movements (monthly summary rows) — **design only in this phase unless volume demands it**; keep raw rows for N months.
- **11e Reporting:** stock reports read from `stock` summaries + reconciliation output, not by scanning `stock_ledger`.

**Files/modules:** hooks, `firestore.indexes.json`, `dispatchWorkflow.ts` (serial lock), report components, `api/[entity].ts` (index fallback).
**Must NOT change:** engine txn logic, movement semantics, rules `stock`/`stock_ledger` write blocks (serial lock is a new block).
**Schema impact:** new `dispatch_serials` collection + rules + indexes; new composite indexes.
**Cross-module:** Dispatch (LOW), Stock/Products UI (MEDIUM — pagination), Reports (MEDIUM), API (LOW).
**Migration:** serial lock — lazy on next dispatch + optional backfill from existing `dispatch.items[].serials`.
**Backward compat:** lists paginate (UI change, same data); serial dedup stricter (a pre-existing duplicate surfaces — desired).
**Rollback:** per sub-feature.
**Tests:** serial lock rejects a reused serial; paginated hooks return correct pages; indexes deployed (no `failed-precondition` in tests).
**Verification:** full set + emulator; manual large-list scroll; `firebase deploy --only firestore:indexes` (with approval).
**Completion:** no client full-collection stock read on a hot path; serial dedup O(1); indexes cover every inventory query; commit(s).
**Commit boundary:** one per sub-feature (11a…11e).

---

## 15. PHASE DEPENDENCIES (summary)

```
INVENTORY-00 (baseline)
   │
   ├──► INVENTORY-01 (dispatch txn)         [needs 00's role matrix]
   ├──► INVENTORY-02 (API boundary)          [needs 00's API-caller inventory]
   │
   ├──► INVENTORY-03 (GRN + role align)      [needs 00 role matrix; independent of 01/02]
   │
   └──► INVENTORY-04 (order/PO locks)        [independent of 01/02/03 — can run in parallel by a second dev]
            │
   01,03,04 ─┴──► INVENTORY-05a (engine, dormant)
                     │
                     ├──► 05b (GRN → engine)      [needs 03]
                     ├──► 05c (dispatch → engine) [needs 01]
                     └──► 05d (manual+cancel → engine; retire dup writer)  [needs 04]
                              │
                     05* ─────┴──► INVENTORY-06 (reconciliation, read-only)
                                        │
                              06 ───────┴──► INVENTORY-07 (reservation)  ◄── BUSINESS SIGN-OFF REQUIRED
                                                 │
                                        05* ─────┴──► INVENTORY-08 (warehouse transfer)  [needs 05*, not 07 — order swappable]
                                                         │
                                                05* ─────┴──► INVENTORY-09 (master data)  [needs 05* only for delete-guard stock reads]
                                                                 │
                                                        05* ─────┴──► INVENTORY-10 (operational features)
                                                                         │
                                                                 (any) ──┴──► INVENTORY-11 (scale/reporting)  [fully independent]
```

Full rationale per edge: `INVENTORY_PHASE_DEPENDENCY_MAP.md`.

---

## 16. MIGRATION STRATEGY (global principles)

1. **Additive first.** New fields (`onHandQty`, `idempotencyKey`, `categoryId`, …) are added and dual-written before any reader depends on them. No field is renamed in place; `availableQty` keeps its name and gains a new derivation only in Phase 07.
2. **Dual-write legacy ledger fields** through Phases 05–08 so existing ledger consumers keep working; drop them only in a dedicated cleanup phase after every reader is migrated (Future).
3. **Feature flags** for the two risky activations: `USE_MOVEMENT_ENGINE_*` (per caller, 05b–05d) and `reservationsEnabled` (07). Flags default off in the same commit that adds the code; flipped on in a follow-up commit after tests + manual verification.
4. **Backfills are scripts, reviewed, run on a copy first, never automatic.** Each backfill has a dry-run mode and a report of what it would change. Backfills needed: `onHandQty` (05d/07), `categoryId` (09), SKU-duplicate report (09), serial locks (11).
5. **No destructive migration.** Soft-delete only; ledger immutable; historical line-item snapshots untouched.
6. **Rules changes** ship with the full emulator suite green (batched) and the previous `firestore.rules` version tagged for instant redeploy.
7. **One phase = one deployable state.** Never leave `main` in a half-migrated state between phases.

---

## 17. REGRESSION STRATEGY

- `INVENTORY_REGRESSION_MATRIX.md` is the canonical checklist; every phase's "Completion criteria" requires the relevant rows green.
- Phase 00 establishes the baseline test counts (unit + emulator) and the ~29 known-brittle failing UI tests (documented, not regressions per `BRAIN.md` §35).
- Every phase runs, at minimum: `npm run lint`, `npm run build`, `npx vitest run` (full), the emulator suite (batched) **if rules changed**, plus the phase-specific tests and the regression matrix rows for touched modules.
- **No commit** if a previously-green test goes red without a documented, reviewed reason.
- Cross-module smoke after each phase from 04 onward: create Lead→Customer→Quotation→Order→PI→pay→Dispatch→verify→TaxInvoice (B2B) and the B2C project variant — end to end, in the running app.

---

## 18. ROLLBACK STRATEGY

| Layer | Rollback mechanism |
|---|---|
| App code | Revert the phase's commit(s). Phases are ordered so a revert never leaves a dependency dangling (05b–05d are independently revertible via their feature flags). |
| `firestore.rules` | Keep every prior version tagged (`rules-pre-INVENTORY-0X`). `firebase deploy --only firestore:rules` the prior version. Rules changes are in 03 and 07/08/09/11 only. |
| `firestore.indexes.json` | Indexes are additive; leaving an unused index costs nothing. No rollback needed. |
| Data | Additive fields → harmless if orphaned. Backfills have a documented inverse (e.g. "unset `categoryId` on all products") but are rarely needed since old readers still use the legacy field. `RECONCILE_ADJUST` / reservation movements are real ledger rows — reverse with a compensating movement, never a delete. |
| Feature flags | `USE_MOVEMENT_ENGINE_*` off → caller reverts to its pre-engine local transaction (kept in code for one release). `reservationsEnabled` off → `availableQty = onHandQty`, reservations inert. |
| The STATE file | Records `LAST VERIFIED COMMIT` — the known-good point to reset to. |

---

## 19. COMPLETION CRITERIA — "INVENTORY COMPLETE" FOR NEOZY

Inventory is "complete and production-trustworthy" when **all** of the following hold (each maps to a phase):

| Domain | Criterion | Phase |
|---|---|---|
| Master data | Product has a stable id + unique SKU; category linked by id; delete guarded by references | 09 |
| Master data | Warehouse delete guarded; company/warehouse isolation intact | 09 (guard), already (isolation) |
| Stock quantities | `onHandQty`, `reservedQty`, `availableQty` all maintained by one writer; `incomingQty`/`inTransitQty` derived | 05, 07, 08 |
| Movement | Every movement type (§8) goes through `applyStockMovement`; each is idempotent (§10) and atomic (§9) | 05 |
| Movement | Opening stock, damage/write-off, RMA, transfer all have dedicated flows | 08, 10 |
| Audit | `stock_ledger` immutable; every physical movement has exactly one ledger row (INV-7); reconciliation detects drift (INV-5) | 06, already |
| Sales | Quotation (no stock effect), Order (no reservation at create), PI-paid → reserve, Dispatch → consume, Cancel → release/return — all wired and tested | 04, 07 |
| Sales | Order line qty frozen after dispatch (INV-12) | 04 |
| Procurement | Vendor → PO (state machine, one table) → GRN (idempotent, atomic, over-receipt-proof, INV-13) → stock IN → ledger | 03, 05b |
| Security | `stock`/`stock_ledger` writes gated to inventory-operational roles; no API write path; company + warehouse isolation emulator-tested | 02, 03 |
| Reliability | Concurrency-safe (all movements transactional); retry-safe (all idempotent); rollback documented per phase | 01, 03, 05 |
| Scale | No client full-collection read on a hot stock path; every inventory query indexed; serial dedup O(1) | 11 |
| Continuity | `INVENTORY_IMPLEMENTATION_STATE.md` current; every phase committed with a clear boundary | all |

---

## 20. FUTURE / OPTIONAL BACKLOG (explicitly out of scope for the core remediation)

- Batch / lot tracking + expiry.
- Barcode scanning UI (field `trackingType` already supports the concept).
- Serial/batch cost layers (FIFO/LIFO/weighted-average valuation).
- Inventory valuation / COGS accounting integration.
- Demand forecasting / auto-reorder / reorder-point suggestions (beyond a simple low-stock alert).
- Multi-hop transfers, transfer approval workflow.
- Reservation expiry / auto-release; allocation-to-specific-dispatch (loading plans).
- Backorder / negative-available with fulfilment-on-receipt.
- Cycle-count scheduling + variance workflow.
- Scheduled (cron) reconciliation — decide frequency after Phase 06 shows drift rates.
- `stock_ledger` cold-storage / rollup archival (Phase 11d design → implement if volume demands).
- AI/analytics on movement history.
- Bin / location tracking within a warehouse.

---

## 21. PROTECTED AREAS — "DO NOT TOUCH YET"

Until the phase that explicitly owns them, **do not modify**:

```
DO NOT modify (until the named phase):
- Invoice/PI money math (subtotal/tax/discount/adjustment)         → not in scope at all; only PI-repeat guard (04) & reserve trigger (07)
- Tax calculation / GST breakdown (gstCalculation.ts)              → not in scope
- taxInvoiceWorkflow number allocation (serial_numbers counter)    → not in scope (note the overload, don't fix here)
- Quotation UI / pricing engine                                    → convert-race guard only (04)
- Customer lifecycle / customer_phone_locks                        → not in scope
- Payment workflow (paymentWorkflow.ts) beyond markPIAsPaid        → markPIAsPaid: PI-repeat (04), reserve trigger (07) ONLY
- Lead / Case / Project lifecycle & CaseEngine                     → not in scope
- Channel Partner / commission / wallet                            → not in scope
- Attendance / biometric / geo                                     → not in scope
- Identity chain (authIdentity/userIdentity/entityProjection)      → not in scope
- firestore.rules blocks other than: stock, stock_ledger, purchase_orders, product_categories(09), + new blocks (reservations 07, transfers 08, sku_locks 09, dispatch_serials 11)
- Any src/components/mobile/** business logic                       → DESKTOP IS THE SOURCE OF TRUTH; mobile shells call the same hooks/workflows, never their own logic (BRAIN.md §22.3)
- The one Cloud Function (onUserDeactivated)                        → architecturally locked; no new Cloud Functions
- API auth / other API entities                                    → only the stock read-only change (02)
```

**Mobile invariant (permanent):** every inventory change goes into the shared hook/workflow/service. A `src/components/mobile/**` file may only render and call the same shared code the desktop page calls. Any validation, transaction, or Firestore write added to a mobile file that isn't identical on desktop is a defect.

---

## 22. CROSS-MODULE BLAST-RADIUS MATRIX

Scale: **NONE / LOW / MEDIUM / HIGH / CRITICAL**

| Phase | Product | Category | Warehouse | Stock | Ledger | Quote | Order | PI/Invoice | Tax Inv | Procurement/PO/GRN | Vendor | Dispatch | Permissions/Rules | API |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **00** Baseline | NONE | NONE | NONE | NONE | NONE | NONE | NONE | NONE | NONE | NONE | NONE | NONE | NONE (read) | NONE (read) |
| **01** Dispatch txn | LOW(read) | NONE | LOW(read) | **HIGH** | MEDIUM | NONE | LOW | NONE | NONE | NONE | NONE | **HIGH** | LOW(verify) | NONE |
| **02** API boundary | NONE | NONE | NONE | LOW | LOW | NONE | NONE | NONE | NONE | NONE | NONE | NONE | **MEDIUM** |
| **03** GRN + role | LOW | NONE | LOW(read) | **HIGH** | MEDIUM | NONE | LOW(cancel role) | NONE | NONE | **HIGH** | LOW | NONE | **HIGH** | NONE |
| **04** Order/PO locks | NONE | NONE | NONE | LOW | NONE | MEDIUM | **HIGH** | MEDIUM | NONE | MEDIUM(PO table) | NONE | LOW(read) | LOW(gap noted) |
| **05a** Engine dormant | NONE | NONE | NONE | LOW(dedup id) | LOW | NONE | NONE | NONE | NONE | NONE | NONE | NONE(verify) | NONE |
| **05b** GRN→engine | NONE | NONE | NONE | MEDIUM | MEDIUM | NONE | NONE | NONE | NONE | MEDIUM | NONE | NONE | NONE |
| **05c** Dispatch→engine | NONE | NONE | NONE | MEDIUM | MEDIUM | NONE | LOW | NONE | NONE | NONE | NONE | MEDIUM | NONE |
| **05d** Manual+cancel→engine | NONE | NONE | NONE | **HIGH** | MEDIUM | NONE | MEDIUM(cancel) | NONE | NONE | NONE | NONE | LOW | NONE |
| **06** Reconciliation | NONE | NONE | NONE | MEDIUM | LOW(read+adjust) | NONE | NONE | NONE | NONE | NONE | NONE | NONE | NONE |
| **07** Reservation | NONE | NONE | LOW(fulfilmentWh) | **HIGH** | MEDIUM | LOW | **HIGH** | **HIGH** | NONE | NONE | NONE | **HIGH** | **MEDIUM**(new rules) | LOW |
| **08** Transfer | NONE | NONE | MEDIUM | MEDIUM | LOW | NONE | NONE | NONE | NONE | NONE | NONE | NONE | **MEDIUM**(new rules) | NONE |
| **09** Master data | **HIGH** | **MEDIUM** | MEDIUM | LOW(delete read) | NONE | LOW | LOW | NONE | NONE | LOW | LOW | NONE | **MEDIUM**(sku lock rules) | LOW(gap) |
| **10** Operational | MEDIUM | NONE | LOW | MEDIUM | LOW | NONE | LOW(RMA) | NONE | NONE | NONE | NONE | LOW(RMA) | LOW | NONE |
| **11** Scale | MEDIUM(pagination) | LOW | LOW | MEDIUM | MEDIUM | NONE | NONE | NONE | NONE | LOW | NONE | LOW(serial lock) | **MEDIUM**(new rules+index) | LOW |

**Reading:** any HIGH/CRITICAL cell = mandatory emulator suite + full regression matrix rows + manual end-to-end smoke before commit.

---

## 23. PHASE COMPLETION PROTOCOL (every phase, in order)

1. Code changes complete, matching surrounding style; no unrelated fixes (log those to the audit/backlog).
2. Phase-specific tests written and green.
3. `npm run lint` — matches or beats the baseline (3 pre-existing attendance-test errors, 0 in inventory).
4. `npm run build` — success.
5. `npx vitest run` — full suite; no new failures vs. the Phase-00 baseline.
6. Firestore emulator suite (batched, 2–3 runs) — **mandatory if `firestore.rules` changed**, otherwise run once.
7. Manual business-flow verification per the phase's list + the cross-module smoke (from Phase 04 on).
8. `INVENTORY_REGRESSION_MATRIX.md` rows for every touched module — green.
9. Git commit at the phase's commit boundary, message `type(inventory): <summary> (INVENTORY-0X[, Pxx])`, co-authored per session rules.
10. Update `INVENTORY_IMPLEMENTATION_STATE.md` — every field.
11. Update `BRAIN.md` **only if the architecture map changed** (§38 protocol): new collection → §11/§27; rules change → §10/§13/§15 + mirror to storage.rules note; new workflow/atomicity → §16/§18; move a fixed bug from §35 to §36 with its covering test.
12. Create the checkpoint: confirm STATE file's `LAST VERIFIED COMMIT` = this commit's hash; `NEXT PHASE` set; `EXACT NEXT ACTION` written.
13. **STOP.** Do not begin the next phase in the same session unless explicitly instructed.

---

## 24. HANDOFF

> **The implementation must not proceed until this plan is reviewed and approved.**

Exact recommended task for the next session:

```
Read, in order:
1. brain.md
2. INVENTORY_IMPLEMENTATION_PLAN.md
3. INVENTORY_IMPLEMENTATION_STATE.md
4. INVENTORY_REGRESSION_MATRIX.md
5. INVENTORY_PHASE_DEPENDENCY_MAP.md

Then:
- If the plan is not yet marked APPROVED in INVENTORY_IMPLEMENTATION_STATE.md → STOP. Ask for approval. Do not write code.
- If approved → execute ONLY the phase named "NEXT PHASE" in INVENTORY_IMPLEMENTATION_STATE.md.
  Follow that phase's spec in INVENTORY_IMPLEMENTATION_PLAN.md §14 exactly.
  Do not start, preview, or "prepare" any later phase.
  End with the Phase Completion Protocol (§23) and update the STATE file.
  Then STOP.
```

Permanent execution discipline: **preserve the working ERP; make inventory safer one verifiable phase at a time.** A slower phase that can be independently verified beats a fast change that touches Products + Orders + Invoices + Procurement + Firestore rules at once.

---
*End of INVENTORY_IMPLEMENTATION_PLAN.md — planning artifact only. No code, rules, schema, or data changed in its creation.*
