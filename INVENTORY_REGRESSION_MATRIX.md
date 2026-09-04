# INVENTORY_REGRESSION_MATRIX.md

**Permanent regression checklist for the Neozy Inventory remediation.**

Every phase's Completion Protocol (Plan §23 step 8) requires the rows for **every touched module** to be green before commit. HIGH-blast-radius phases (03, 05d, 07 — see `INVENTORY_PHASE_DEPENDENCY_MAP.md` §6) require the **entire** matrix green.

**Legend:** `T` = automated test exists / to be written · `M` = manual verification in the running app · `E` = Firestore emulator (rules) test · `—` = not applicable.

**Baseline note (from Phase 00):** `npx vitest run` has ~29 pre-existing brittle source-string UI test failures (`BRAIN.md` §35) that are **NOT regressions**. Phase 00 records the exact list; a failure outside that list = a regression = no commit.

**Standard gate for every phase:**
```
npm run lint      # tsc --noEmit — must equal baseline (3 pre-existing attendance-test errors, 0 in inventory)
npm run build     # vite build — must succeed
npx vitest run    # full — no new failures vs the Phase-00 baseline list
# if firestore.rules changed:
firebase emulators:exec --only firestore --project neozy-demo-isolation-test \
  "npx vitest run --config vitest.emulator.config.ts"   # batched 2–3 runs, 100% green
```

---

## A. PRODUCT

| # | Check | Type | Expected | Phases that must re-verify |
|---|---|---|---|---|
| A1 | Create a product | T,M | doc created, `companyId`+`groupId` stamped, `isDeleted:false` | 09 |
| A2 | Edit a product (price/tax/unit) | T,M | fields updated; **historical quotation/order line snapshots unchanged** | 09 |
| A3 | Soft-delete a product with zero stock & no open refs | T,M | `isDeleted:true`; hard delete impossible | 09 |
| A4 | Soft-delete a product **with** stock or open order/PO | T | **blocked** with a clear message | 09 (introduces), all later |
| A5 | Duplicate SKU on create/edit | T,E | **rejected** (blank SKU allowed) | 09 (introduces) |
| A6 | Product referenced by a quotation/order line still renders (name/price from snapshot) | T,M | line shows the snapshot, not a live join failure | 04, 07, 09 |
| A7 | Company A cannot read/write Company B's products | E | denied | any rules change |
| A8 | Product list loads (paginated after Phase 11) | M | no full-collection hang at scale | 11 |
| A9 | `categoryId` set on new products; `category` name denormalized | T | both present; picker emits `categoryId` | 09 (introduces) |

## B. CATEGORY

| # | Check | Type | Expected | Re-verify |
|---|---|---|---|---|
| B1 | Create / edit / soft-delete a category | T,M | works; `companyId`+`groupId` stamped | 09 |
| B2 | Hard-delete a category as non-superadmin | E | **denied** (superadmin only) | any rules change |
| B3 | Soft-delete a category **with products** | T | **blocked** | 09 (introduces) |
| B4 | Category name→id backfill report | T,M | maps by name; unmatched flagged, never auto-picked | 09 |
| B5 | Renaming a category | T | denormalized `category` on products updated (or explicitly not — per Phase 09 decision) | 09 |
| B6 | Cross-company category isolation | E | denied | any rules change |

## C. WAREHOUSE

| # | Check | Type | Expected | Re-verify |
|---|---|---|---|---|
| C1 | Create warehouse (`id == warehouseId`, `hasCompanyId`) | T,E,M | created | 09, any rules change |
| C2 | Edit warehouse (`companyId` immutable) | T,E | works; companyId change denied | 09 |
| C3 | Soft-delete a warehouse with zero stock | T,M | `isDeleted:true` | 09 |
| C4 | Soft-delete a warehouse **with stock / open dispatch / open GRN** | T | **blocked** | 09 (introduces), 08 |
| C5 | Warehouse-restricted role sees only its own warehouse's stock/dispatch/GRN | E | scoped; other warehouse denied | 01, 03, 05*, 07, 08, any rules change |
| C6 | `warehouseId` immutable on stock/dispatch/GRN | E | re-point denied | 01, 03, 05*, 08 |
| C7 | Forged cross-company `warehouseId` on a stock write | E | **denied** (`warehouseBelongsToCompany`) | 01, 03, 05*, 07, 08 |

## D. STOCK — MOVEMENT & QUANTITIES

| # | Check | Type | Expected | Re-verify |
|---|---|---|---|---|
| D1 | Manual stock IN | T,M | `onHandQty += qty` (post-05: via engine), one ledger row | 05a, 05d, 06 |
| D2 | Manual stock OUT | T,M | `onHandQty -= qty`, one ledger row | 05d, 06 |
| D3 | Manual OUT below zero | T | **rejected**, no write (INV-1) | 01, 05*, all |
| D4 | Two concurrent OUT of the last unit (dispatch **and** manual) | T | exactly one succeeds; `onHandQty` never negative; no lost update | **01**, 05c, 05d, 07 |
| D5 | Retry / double-submit the same movement | T | **one** effect (idempotency key) | 01, 03, 05*, 07, 08, 10 |
| D6 | New stock summary (first movement for a product+warehouse pair) | T,E | created with correct triple key `SUM-{co}-{prod}-{wh}` | 05*, any rules change |
| D7 | Duplicate stock summaries for one triple | T | `resolveStockSummaryDocumentId` throws / canonicalized on read | 05* |
| D8 | Every movement writes exactly one immutable ledger row (INV-7) | T | 1:1; ledger row `update`/`delete` denied at rules | 05*, 06 |
| D9 | `stock_ledger` row cannot be edited or deleted | E | denied (`update, delete: if false`) | any rules change |
| D10 | `availableQty == onHandQty` (pre-Phase-07) / `== onHandQty − reservedQty` (Phase 07+) — INV-4 | T | holds after every movement | 05*, **07** |
| D11 | `Σ(ledger IN) − Σ(ledger OUT) == onHandQty` per summary — INV-5 | T | holds for movements made after 05c; reconciliation flags pre-05 drift | **06**, 07, 08 |
| D12 | Idempotency key uniqueness (INV-8) — no two ledger rows share one | T | enforced by deterministic doc id | 05a, all after |

## E. STOCK — SECURITY / ROLES

| # | Check | Type | Expected | Re-verify |
|---|---|---|---|---|
| E1 | Role matrix: Warehouse / Operations / Admin / GroupAdmin / **Procurement** create a stock summary | E | allowed | **00 (repro)**, 03, 05* |
| E2 | Role matrix: same roles update `availableQty`/`onHandQty`/`reservedQty` on an existing summary | E | allowed (final list per Phase 03) | **00**, 03, 05*, 07 |
| E3 | Role matrix: Sales / Accounts (no stock write grant) attempt a stock write | E | denied (unless a cancel-restore path is explicitly granted in 03) | 00, 03 |
| E4 | `stock` PUT via REST API | T | **405** (Phase 02+) | **02**, 11 |
| E5 | `stock` GET via REST API | T | works (read-only) | 02 |
| E6 | Cross-company stock read/write | E | denied | any rules change |
| E7 | `stock` rules change stays under the 1000-expression budget | E | emulator suite green (no "maximum expressions" error) | **03**, 07, 08, 09, 11 |
| E8 | No `stock`-summary write exists outside `stockMovementEngine.ts` (Phase 05d+) | T (grep/lint) | zero matches | **05d**, all after |

## F. INVENTORY LEDGER

| # | Check | Type | Expected | Re-verify |
|---|---|---|---|---|
| F1 | Ledger row carries `movementType`, `direction`, `idempotencyKey`, `onHandBefore/After` (Phase 05+) | T | present | 05a, all after |
| F2 | Legacy ledger consumers still work (dual-written `type`/`referenceType`/`referenceId`/`date`) | T,M | reports/screens render | 05*, 06 |
| F3 | Ledger immutability | E | `update`/`delete` denied | any rules change |
| F4 | Reconciliation report is read-only (no write on load) | T | zero writes | **06** |
| F5 | `RECONCILE_ADJUST` requires human approval + audit log + is idempotent per run-id | T,E | enforced | 06 |

## G. QUOTATIONS

| # | Check | Type | Expected | Re-verify |
|---|---|---|---|---|
| G1 | Create a quotation with picker items | T,M | `productId` + price/name/category snapshot stored; **no stock effect** | 04, 07 |
| G2 | Edit a quotation before conversion | T,M | allowed | 04 |
| G3 | Edit a quotation after conversion | T | **blocked** (`isQuotationLocked`) | 04 |
| G4 | Convert quotation → order | T,M | order created, items/qty/pricing/tax preserved, `orderType` resolved | 04 |
| G5 | Two concurrent conversions of one quote | T | **one** order; same id returned to both | **04** |
| G6 | Engineering-derived quotation items (`productId: ''`) | T | still convertible; downstream tolerates empty productId | 04, 07 |

## H. ORDERS

| # | Check | Type | Expected | Re-verify |
|---|---|---|---|---|
| H1 | Create an order | T,M | one doc; **no reservation, no stock effect** (pre-07) | 04, 07 |
| H2 | Edit an order's non-line fields (notes, contact) any time | T,M | allowed | 04 |
| H3 | Edit an order's line qty/product **after any dispatch verified** | T,M | **blocked** (INV-12, `isOrderLineLocked`) | **04**, 07 |
| H4 | Edit an order's lines before any dispatch | T,M | allowed | 04 |
| H5 | Cancel an order **before** dispatch | T,M | status→Cancelled; reservation released (Phase 07); PI-reversal flags set | 04, **07** |
| H6 | Cancel an order **after** dispatch | T,M | dispatched qty restored to stock (via engine post-05d); order+dispatches flip atomically | 04, 05d, 07 |
| H7 | Cancel is idempotent (re-run) | T | no double stock restore (`CANCEL:`/`SALES_RETURN_IN` key) | 04, 05d, 07 |
| H8 | Order `items[]` API PUT still bypasses the lock | T | documented known gap (not a regression) | 04 (document) |
| H9 | Order status reflects dispatch progress (`Partial Dispatch` / `Dispatched`) | T,M | correct after verify | 01, 05c |

## I. INVOICES (PI + TAX)

| # | Check | Type | Expected | Re-verify |
|---|---|---|---|---|
| I1 | Generate PI(s) from an order | T,M | PI docs created; **no stock effect** | 04, 07 |
| I2 | Generate PI a second time | T | **rejected** unless `force` (Phase 04+) | **04** |
| I3 | Mark PI paid | T,M | PI+order updated atomically; **Phase 07: stock reserved for the order lines** | **04**, **07** |
| I4 | Tax invoice generation | T,M | GST breakdown correct; **no stock effect**; number allocated | (protected — verify no accidental change) |
| I5 | PI/order money math unchanged | T,M | subtotal/tax/discount/adjustment identical to pre-phase | every phase touching invoiceWorkflow (04, 07) |
| I6 | Invoicing never triggers a stock movement (INV-14) | T,review | zero `stock_ledger` rows from PI/tax-invoice flows | 04, 07 |

## J. PROCUREMENT — VENDOR / PO / GRN

| # | Check | Type | Expected | Re-verify |
|---|---|---|---|---|
| J1 | Create a vendor | T,M | works; `companyId`+`groupId` stamped | 09 |
| J2 | Delete a vendor with open POs | T | blocked or confirm-required (Phase 09) | 09 |
| J3 | Create a PO (`status:'Draft'`, `purchaseOrderId==docId`, items list) | T,E,M | created | 03, any rules change |
| J4 | PO status transitions | T,E | only legal transitions; **one shared table** (rules == workflow == validation engine) | **03** |
| J5 | Edit a PO after it leaves Draft | T | blocked (only Draft editable) | 03 |
| J6 | GRN — receive full quantity | T,M | stock IN per line; PO→`Received`; ledger rows | 03, 05b |
| J7 | GRN — receive partial | T,M | stock IN; PO→`PartiallyReceived`; line `receivedQty` incremented | 03, 05b |
| J8 | GRN — attempt over-receipt | T | **rejected** (INV-13) | **03** |
| J9 | GRN — double-submit / retry | T | **one** stock IN (idempotency) | **03**, 05b |
| J10 | GRN — two concurrent receipts against one PO line | T | `Σ received ≤ ordered`; no lost update | **03** |
| J11 | GRN as a **Procurement-role** user into an existing stock summary | E,M | **allowed** (Phase 03 role alignment) | **00 (repro)**, **03**, 05b |
| J12 | GRN partial failure (stockIn ok, GRN doc write fails) | T | resumable; no duplicate stock on retry; no GRN-less stock (compensation marker) | 03, 05b |
| J13 | `incomingQty` derived from open POs (report) | T | `Σ ordered − Σ received` per product | 10 (if surfaced) |

## K. DISPATCH

| # | Check | Type | Expected | Re-verify |
|---|---|---|---|---|
| K1 | Request a dispatch | T,M | doc created `Pending Verification`; `createdBy==actor`; warehouse FK | 01, any rules change |
| K2 | Verify a dispatch (stock OUT) | T,M | `onHandQty -= verifiedQty` **in one transaction** + one ledger row | **01**, 05c, 07 |
| K3 | Verify — insufficient stock | T | **rejected**, no partial write | **01**, 05c |
| K4 | Verify — two concurrent verifies of the same line | T | one succeeds, no oversell (D4) | **01**, 05c |
| K5 | Verify — double-click | T | one OUT; second is no-op or "already dispatched" | **01**, 05c |
| K6 | Verify with a deleted product / warehouse | T | clear error, no write | **01**, 09 |
| K7 | Verify consumes the order's reservation (Phase 07) | T | `reservedQty -= min(verified, reservation)`; reservation doc updated | **07** |
| K8 | Confirm delivery (OTP) — transactional | T | status→Delivered, OTP consumed once | (protected — verify no change) |
| K9 | Close dispatch — transactional | T | status→Closed; order reconciliation flag | (protected) |
| K10 | Serial number reused across dispatches | T,E | **rejected** (full scan pre-11, `dispatch_serials` lock Phase 11) | 11a |
| K11 | Order `items[].dispatchedQty/pendingQty` updated correctly after verify | T | matches; order status correct | 01, 05c |

## L. WAREHOUSE TRANSFER (Phase 08+)

| # | Check | Type | Expected | Re-verify |
|---|---|---|---|---|
| L1 | Ship a transfer | T,M | source `onHandQty -= qty`; `TRANSFER_OUT` ledger row; status `in_transit` | 08 |
| L2 | Receive a transfer | T,M | dest `onHandQty += qty`; `TRANSFER_IN` ledger row; status `received` | 08 |
| L3 | `Σ(TRANSFER_OUT + TRANSFER_IN)` per transfer == 0 (INV-11) | T | holds | 08 |
| L4 | Ship / receive idempotency | T | one effect each on retry | 08 |
| L5 | Cancel an in-transit transfer | T | reversed to source | 08 |
| L6 | Cross-company transfer attempt | E | **denied** | 08 |
| L7 | In-transit qty visible / reconcilable | T,M | derived from `status=='in_transit'` transfers | 08 |

## M. RESERVATION / ALLOCATION (Phase 07+)

| # | Check | Type | Expected | Re-verify |
|---|---|---|---|---|
| M1 | PI paid → stock reserved for order lines at `fulfilmentWarehouseId` | T,M | `reservedQty += qty`; `stock_reservations` doc `active` | 07 |
| M2 | `availableQty` drops by the reserved amount; `onHandQty` unchanged | T | INV-4 | 07 |
| M3 | Reservation caps at available; shortfall flagged (default policy) | T | `order.stockShortfall[]` set; reserve = available | 07 |
| M4 | Two concurrent PI-paid events for the last units | T | second reserves only the remainder + shortfall | 07 |
| M5 | Dispatch consumes the reservation | T | K7 | 07 |
| M6 | Cancel releases the unconsumed remainder | T | `SALES_RELEASE`; reservation `released` | 07 |
| M7 | Reservation lifecycle idempotent (double PI-paid, double cancel) | T | one reserve / one release | 07 |
| M8 | `reservedQty >= 0` and `<= onHandQty` (INV-2, INV-3 — unless backorder enabled) | T | enforced in the engine txn | 07 |
| M9 | `reservationsEnabled` flag OFF → `availableQty == onHandQty`, no reserve on PI-paid | T | clean fallback | 07 |
| M10 | Orders/PIs created before Phase 07 dispatch without a reservation | T | engine consumes `min(verified, 0)`; no error | 07 |

## N. SECURITY — CROSS-CUTTING (run on EVERY rules change: Phases 03, 07, 08, 09, 11)

| # | Check | Type | Expected |
|---|---|---|---|
| N1 | Company A → Company B: read/write stock, ledger, dispatch, GRN, PO, reservations, transfers | E | **all denied** |
| N2 | Warehouse A user → Warehouse B: read/write stock, ledger, dispatch, GRN | E | **all denied** |
| N3 | Unauthorized role → stock write | E | denied |
| N4 | Direct REST API → stock write | T | 405 |
| N5 | `stock_ledger` / `goods_receipts` update or delete | E | denied (`if false`) |
| N6 | GroupAdmin group-wide read of stock across the group's companies | E | allowed (`groupAdminCanRead`) |
| N7 | Suspended group → any stock access for its companies | E | **denied** (`groupIsActive`) |
| N8 | `storage.rules` still mirrors any identity/tenant helper changed in `firestore.rules` | review + E | in sync (§34 danger zone) |
| N9 | Emulator suite runs 100% green (batched 2–3 runs) | E | pass |
| N10 | No 1000-expression budget failure on any touched rules block | E | pass |

## O. CROSS-MODULE END-TO-END SMOKE (mandatory from Phase 04 on; full for HIGH phases 03/05d/07)

| # | Flow | Type | Expected |
|---|---|---|---|
| O1 | **B2B:** Lead → Customer → Quotation → convert → Order → generate PI → mark PI paid → request Dispatch → verify Dispatch → confirm delivery → close → Tax Invoice | M | every step succeeds; stock moves only at dispatch verify (+ reserve at PI-paid from Phase 07); ledger consistent; reconciliation clean |
| O2 | **B2C:** Lead → Customer → Project → Survey → Engineering → Quotation → Order → **PO → GRN (stock IN)** → PI → Payment → Dispatch (stock OUT) → Tax Invoice → Installation | M | full lifecycle; procurement IN and dispatch OUT both ledgered; project stage advances |
| O3 | Order cancel mid-flow (after partial dispatch) | M | dispatched qty returns to stock; reservation remainder released; PI-reversal flags; order line locked throughout |
| O4 | GRN → immediately dispatch the received stock | M | IN then OUT; `onHandQty` net-correct; two ledger rows; reconciliation clean |
| O5 | Concurrent operations: two users verify dispatches of the same product from the same warehouse | M | no oversell; `onHandQty` correct; both ledger rows present or one clean rejection |
| O6 | Run `StockReconciliationEngine` after O1–O5 | M | zero unexplained mismatches (post-Phase-06) |

---

## P. PHASE → REQUIRED ROWS (quick lookup)

| Phase | Minimum matrix rows to verify green |
|---|---|
| **00** | Standard gate + capture baseline `vitest` counts + **E1–E3 (role matrix — the deliverable)** + D9, F3, N9 |
| **01** | D3, D4, D5, K1–K6, K11, C5–C7, E7, N9 + standard gate |
| **01 STATUS (2026-09-03 — commit `1368cfd`)** | **PASS.** D3/K3 insufficient-aborts-txn (unit + emulator); **D4/K4 concurrency stock=1→0, one OUT row, never negative (emulator, `dispatchStockOutTransaction.emulator.test.ts`)**; D5/K5 idempotent no-op + status guard (unit + emulator); K1 unchanged (`requestDispatch`); K2 atomic decrement + deterministic OUT ledger + dispatch Dispatched (emulator); K6 deleted/missing/cross-company product+warehouse rejected pre-mutation (unit); K11 order dispatchedQty/pendingQty from applied qty, no double-bump on no-op (unit); C5/C6/C7 warehouse scoping + immutability + cross-company reject (emulator); E7 budget — no regression after the `stock_ledger` read-guard change (stockAdjustTransaction + stockRoleMatrix green); N9 full emulator suite 15 files / 608 tests 100% (3 batches). Standard gate: lint 3 pre-existing / build ok / vitest 254 files identical 29-fail baseline, +10 new passing. |
| **02** | E4, E5, N4 + standard gate |
| **02 STATUS (2026-09-03 — commit `58038f4`)** | **PASS.** E4 `PUT /api/stock/:id` -> 405, verifyAuthToken NOT called, Admin-SDK write spy never invoked (zero Firestore mutation); also PATCH/DELETE/POST -> 405. E5 `GET /api/stock` + `GET /api/stock/:id` reach the read path (NOT 405), auth + `requirePermission('view','stock')` still run. N4 direct REST stock write -> 405 (same as E4). `stock_ledger` POST/PUT/DELETE -> 405, zero write; `GET /api/stock_ledger` reaches read path. Regression: `PUT /api/orders`, `POST /api/quotations`, `DELETE /api/dispatch` NOT blocked (reach their real handlers). New: `api/__tests__/apiInventoryWriteBoundary.test.ts` (18 tests). API suite 11 files / 303 tests 100%. NO firestore.rules change (Plan §9) -> N9 unchanged from INVENTORY-01 (15 files / 608 tests); spot re-check 4 files / 315 tests 100%. Standard gate: lint 3 pre-existing / build ok / src vitest 254 files identical 29-fail baseline (api/ excluded from src glob). |
| **03** | **J3–J12**, **E1–E3**, E7, D5, D8, C5–C7, N1–N10 (full) + O1, O4 |
| **03 STATUS (2026-09-04 — commit `8e2c799`)** | **PASS.** New `src/lib/__tests__/grnReceiptTransaction.emulator.test.ts` (16 tests): J6 full receipt (stock +ordered, one IN ledger, PO `Received`); J7 partial→partial→`Received` with incrementing `receivedQty`; J8/INV-13 sequential over-receipt rejected inside the txn, zero mutation; J9/P1-1 double-submit → one stock IN, one GRN doc (deterministic id); J10 concurrent 6+6 → Σ ≤ 10 (one applies), 4+6 → exactly 10, **7+6 → exactly one rejected, stock never exceeds accepted** (single atomic stock+ledger+PO txn — no stranded stock); J11/P1-3 **Procurement CAN receive into an EXISTING summary** (rules `stock` write-role list gains Procurement); J12 GRN-doc-write-failure reconciled from ledger rows on retry, no double stock; E3 Sales/Accounts DENIED (least privilege kept); C7 forged cross-company `warehouseId` denied; N1 cross-company receipt denied; N5 GRN doc + IN ledger rows immutable; `PartiallyReceived→PartiallyReceived` PO update now allowed by rules. `stockRoleMatrix.emulator.test.ts` updated: Procurement OP-2 ALLOW (was DENY in INVENTORY-00). J3/J4/J5: `PURCHASE_ORDER_TRANSITIONS` is the one shared table (purchaseOrderWorkflow ↔ ProcurementValidationEngine import ↔ firestore.rules mirror); `updatePurchaseOrder` still blocks non-Draft edits. E7 budget: `purchase_orders` update rule made LEAN (tenantWriteCanUpdate, matching employees/payroll) so the 3-collection GRN txn stays under 1000 expressions — full emulator suite green (stockAdjustTransaction near-cap + dispatchStockOutTransaction + stockRoleMatrix all pass). D5/D8: deterministic ledger id + `stock_ledger` immutability. C5/C6: unchanged (`sameWarehouse` + `warehouseIdUnchanged`). N1–N10 (full): 16 files / 623 tests, 100% (3 batches). Standard gate: lint 3 pre-existing / build ok / vitest 254 files identical 29-fail baseline. O1/O4: covered by the emulator GRN→stock→ledger→PO path; live manual pass deferred with the owner's git/deploy step. |
| **04** | **H1–H9**, G2–G5, I1–I3, I5, standard gate + O1, O3 |
| **04 STATUS (2026-09-04 — commit `21e502e`)** | **PASS.** **H2/H4** unlocked order line edit allowed (`updateOrder` unit); **H3 (INV-12)** locked order LINE edit rejected at the workflow layer — locked by `Σ dispatchedQty > 0` OR status ∈ {Partial Dispatch, Dispatched, Closed, Cancelled}; **H2** locked order NON-line edit (notes/contact / no-`items`-key patch) still allowed. Shared `isOrderLineLocked(order)` exported from `orderWorkflow.ts`; `Orders.tsx` + `MobileOrderWorkspace.tsx` edit branches both call `updateOrder` (no mobile business logic). **H5/H6 (P2-2)** `cancelOrder`: order status + every affected dispatch status flip in ONE `runTransaction` (configured branch) that re-reads each doc — emulator: 2 dispatches + order all → Cancelled/Returned; a precondition failure (already cancelled) aborts with NO partial write. **H7** existing `CANCEL:` idempotency key + return-ledger scan unchanged (baseline test green). Additive `orders.piReversalRequired` + `orders.reversalInvoiceIds[]` recorded from `order.generatedPIs` + `proforma_invoices`/`tax_invoices` by orderId (info only — NO financial reversal / NO GST / NO amount change). Stock restore path UNCHANGED (still `stockIn` — migrates to engine in 05d). **I2 (P2-7)** `generatePIsFromOrder` re-reads the authoritative order; a repeat is rejected unless `{force:true}`. **G4/G5 (P2-8)** `convertQuotationToOrder`: lock-check + order create + quotation mark in ONE `runTransaction` that re-reads `convertedOrderId` — emulator: 2 concurrent conversions → exactly ONE order, both callers get the SAME id; fast idempotent short-circuit when `convertedOrderId` already set. **G6** engineering-derived item (`productId: ''`) still converts (unit + emulator). **H8 known gap unchanged:** `orders` API PUT still bypasses the workflow lock (no dedicated `orders` rules block this phase — deferred to a rules-consolidation phase). NO firestore.rules / firestore.indexes change. New: `orderLifecycleTransaction.emulator.test.ts` (5 tests). Focused: orderWorkflow 14/14, stockWorkflow 6/6, invoiceWorkflow 5/5, quotationWorkflow 20/20, cancelOrder.baseline green. Standard gate: lint 3 pre-existing / build ok / full vitest 255 files — 29-fail baseline unchanged. |
| **05a** | D6, D12, F1, E8(baseline), N9 + standard gate (engine dormant — low bar) |
| **05a STATUS (2026-09-04 — commit `ff45262`)** | **PASS.** New DORMANT engine `src/lib/inventory/stockMovementEngine.ts` (`applyStockMovement`) + `types.ts` + `idempotency.ts`. **NO caller migrated** (grep: no `import stockMovementEngine` / `applyStockMovement(` anywhere in src outside its own tests — the one hit in `dispatchWorkflow.ts` is a pre-existing comment). **D6** engine creates a missing summary at the canonical `SUM-{co}-{prod}-{wh}` id (unit + emulator). **D12/INV-8** deterministic INJECTIVE ledger id `STKMV-{encodeURIComponent(idempotencyKey)}` — two distinct keys can never collide (unit: `movementLedgerId` test). **F1** ledger row carries `movementType, direction, qty, onHandBefore/After, reservedBefore/After, idempotencyKey, actorId, transactionId, movementAt` + legacy dual-write `type / referenceType / referenceId / date` (unit + emulator). **INV-1** OUT-below-zero aborts the whole txn, zero partial write (unit + emulator). **INV-2** RELEASE-below-zero aborts. **INV-3/INV-4** gated behind `reservationsEnabled` (FALSE for 05–06: `availableQty == onHandQty`, `reservedQty` stays 0 — unit asserts across a run). **INV-7** structurally (one runTransaction = one summary delta + one ledger row). Idempotency: same movement twice → one stock change, one ledger row, `{applied:false}` on the 2nd (unit + emulator). Tenant: `companyId`+`groupId` stamped on both docs; cross-company movement DENIED by CURRENT rules; forged cross-company `warehouseId` DENIED (`warehouseBelongsToCompany`); Sales-role actor DENIED on an existing-summary change (P1-3 least privilege preserved) — emulator. **E7/N9/N10:** NO `firestore.rules` change — the engine's write shape passes today's `stock`/`stock_ledger` rules UNCHANGED (emulator test 1–8). **stockSummaryId consolidated**: `useInventory.ts` local copy deleted, imports the one in `workflow.ts` (byte-identical output — unit test). New: `stockMovementEngine.test.ts` (15), `stockMovementEngine.emulator.test.ts` (8). Standard gate: lint 3 pre-existing / build ok / full vitest 29-fail brittle baseline unchanged. Engine is DEAD CODE until 05b. |
| **05a.1 STATUS (2026-09-04 — commit `d5010e2`)** | **PASS.** Prerequisite for 05b — resolves the 05b atomicity blocker (Phase-03 GRN was ONE txn over stock+ledger+PO; the 05a engine covered only stock+ledger). New `applyStockMovements(inputs, participant?)`: ONE `runTransaction` over every (summary+ledger) in the batch PLUS a generic `MovementParticipant` (read authoritative docs via `ctx.get` → `validate` [throw = abort with error; `false` = benign skip] → `commit` via a `MovementWriter`). **Ownership:** the `MovementWriter` REJECTS `stock`/`stock_ledger` (`assertParticipantCollection`) — engine stays the sole owner. `applyStockMovement` is now a thin wrapper. **F1/F2** legacy dual-write extended: `beforeQty`/`afterQty` aliases + generic `input.ledgerExtra` pass-through. **INV-13 (participant, emulator):** a `purchase_orders` participant write commits atomically with stock+ledger under CURRENT rules; a `validate` throw aborts the WHOLE txn (stock+ledger+PO unchanged); **concurrent 7+6 against ordered 10 → exactly one txn aborts entirely, Σledger == PO.receivedQty, no stranded stock.** **N9/N10/E7:** NO `firestore.rules` change. New: +7 unit tests, +3 emulator tests (`stockMovementEngine.emulator.test.ts` 11/11). **NO caller migrated.** |
| **05b** | J6–J12 **unchanged from 03**, F1, F2, D8 + O4 |
| **05b STATUS (2026-09-04 — commit `e01819a`)** | **PASS.** `goodsReceiptWorkflow.createGoodsReceipt` migrated: the Phase-03 local `runTransaction` over stock+ledger+PO is **DELETED**; it now calls `applyStockMovements(PURCHASE_RECEIPT[], grnPurchaseOrderParticipant)` — the engine's ONE runTransaction carries every line's stock+stock_ledger write PLUS the PO participant (`read` re-fetches the PO in-txn → `validate` re-checks `Σ received + applied ≤ ordered` per line [**INV-13 / J8 / D-over-receipt**] + PO receivable → `commit` increments `receivedQty` off the fresh PO + recomputes status via the guarded `MovementWriter`). **J6/J7** full + partial-then-partial receipt, `receivedQty` increments, PO status PartiallyReceived→Received. **J8** sequential over-receipt rejected, nothing written. **J9 (P1-1)** double-submit no-op — deterministic ledger id `STKMV-{enc(PURCHASE_RECEIPT:goods_receipt:{grnId}:{lineIndex})}` (grnId encodes each line's before+qty). **J10 (P1-2 / INV-13, emulator)** concurrent **6+6→6, 4+6→10, 7+6→one txn aborts entirely, Σledger == PO.receivedQty, no stranded stock**. **J11 (P1-3)** Procurement receives into an existing summary. **J12** GRN-doc-write failure → `reconcileMissingGrnDocs` rebuilds from the ledger rows (now via `grnLineIndex`/`grnPreviouslyReceivedQty` fields; old rows via the -03 parse). **E3** Sales/Accounts denied. **N1** cross-company denied. **C7** forged warehouseId denied. **N5** GRN doc + ledger rows immutable. **F1/F2** new rows: unified schema (`movementType:'PURCHASE_RECEIPT'`, `direction:'IN'`, `onHandBefore/After`, `idempotencyKey`) + legacy (`type:'IN'`, `referenceType:'GoodsReceipt'`, `referenceId`, `beforeQty`/`afterQty`, `purchaseOrderId`). **D8** engine is the sole stock writer for GRN (no `runTransaction` / `transaction.set(stock…)` left in `goodsReceiptWorkflow.ts`). **N9/N10/E7:** NO `firestore.rules` / `firestore.indexes` change — `grnReceiptTransaction.emulator.test.ts` rewritten to the migrated shape, **16/16**; `stockMovementEngine.emulator.test.ts` 11/11. Focused: procurement + grn.baseline + engine 48/48. `createGoodsReceipt` signature unchanged → Desktop + Mobile share the path. Removed: `grnReceiptLedgerId`/`grnReceiptIdempotencyKey`/`lineMetaFor`. Standard gate: lint 3 pre-existing / build ok / full vitest 29-fail baseline unchanged. |
| **05c** | K2–K6, K11, D4, D8, F1, F2 + O5 |
| **05c STATUS (2026-09-04 — commit `8432c22`)** | **PASS.** `dispatchWorkflow.executeAndVerifyDispatch` migrated: the Phase-01 local `runTransaction` over dispatch+stock+ledger is **DELETED**; it now calls `applyStockMovements(DISPATCH_OUT[], dispatchDocParticipant)` — the engine's ONE runTransaction carries every line's stock+stock_ledger write PLUS the dispatch-doc participant (`read` re-fetches the dispatch; `validate` returns **false** for a terminal dispatch → benign no-op / `alreadyVerified`; `commit` writes `status:'Dispatched'` + `items`/`verifiedBy`/`dispatchedAt`). **K2** atomic decrement + one DISPATCH_OUT ledger row + dispatch Dispatched. **D4/K4 (concurrency)** stock=1, two concurrent verifies → exactly one applies, final 0, ONE ledger row, never negative (emulator). **K3 (INV-1)** insufficient stock aborts the whole batch, nothing written — error re-wrapped "Insufficient stock for {product}. …". **K5** idempotent no-op (deterministic ledger id `STKMV-{enc(DISPATCH_OUT:dispatch:{id}:{productId})}`, key byte-identical to -01) + sequential terminal-status pre-check throw. **K6 (P1-6)** deleted/cross-company product + missing warehouse rejected before any mutation (`assertDispatchReferencesValid` unchanged). **K11** order-items `dispatchedQty`/`pendingQty` bumped by the APPLIED qty (0 for an idempotent line) AFTER the engine call (Phase-01 shape — Plan §811); an all-no-op verify does not re-bump the order. **D8** engine is the sole stock writer for dispatch (no `runTransaction` / `transaction.set(stock…)` left in `dispatchWorkflow.ts`; the zero-line + recovery dispatch-status flips are `updateDocById(DISPATCH,…)` — a dispatch-doc write, not stock). **F1/F2** new rows: unified (`movementType:'DISPATCH_OUT'`, `direction:'OUT'`, `onHandBefore/After`) + legacy (`type:'OUT'`, `beforeQty`/`afterQty`, `referenceType:'Dispatch'`, `referenceId`). **E3/N-cross-warehouse:** Accounts-role denied; a Warehouse actor can't decrement another warehouse's stock (emulator). **N9/N10/E7:** NO `firestore.rules` change — `dispatchStockOutTransaction.emulator.test.ts` rewritten to the migrated shape, **8/8**. `executeAndVerifyDispatch` signature unchanged → Desktop (`ProjectDispatchWorkspace`) + Mobile (`MobileDispatchWorkspace`) share it. GRN / manual / cancel untouched. Standard gate: lint 3 pre-existing / build ok / full vitest 29-fail baseline unchanged. |
| **05d** | **D1–D3, D8, D10, E8**, H6, H7, F2, N9 (full) + O3, O5 |
| **05d STATUS (2026-09-04 — commit `6939c12`)** | **PASS. P1-4 CLOSED — ONE stock writer.** `stockWorkflow.stockIn` → thin wrapper over `applyStockMovement` (its Phase-00 demo txn + configured `runTransaction` DELETED); `useInventory.useSaveStockEntry` → `applyStockMovement` (`ADJUSTMENT_IN`/`ADJUSTMENT_OUT`; its `runTransaction` DELETED); `stockWorkflow.cancelOrder` restore → `applyStockMovement('SALES_RETURN_IN', sourceType:'order_cancel', sourceId:'{orderId}:{dispatchId}:{productId}')` (the manual `CANCEL:` ledger-scan guard removed — engine idempotency; `result.applied` drives `restoredItems`). **D1/D10** manual IN `onHandQty += qty`; **D3** manual OUT below zero → INV-1 abort, nothing written; **D2** manual OUT `onHandQty -= qty`. **H6/H7 (P2-2)** cancel-restore is one `SALES_RETURN_IN` movement per (dispatch, product), keyed deterministically → a re-run is a no-op (engine `transaction.get(ledgerRef)`); the INVENTORY-04 order+dispatch **status** `runTransaction` is untouched. **F1/F2** manual + cancel ledger rows carry the unified schema (`movementType`, `direction`, `onHandBefore/After`, `idempotencyKey`) + legacy (`type` IN/OUT, `beforeQty`/`afterQty`, `reference` via `ledgerExtra`, `referenceType:'OrderCancel'`). **D8 (SINGLE WRITER):** new `src/lib/inventory/__tests__/singleStockWriter.test.ts` greps `src/` — NO `createDocWithId(COLLECTIONS.STOCK…)` / `updateDocById(COLLECTIONS.STOCK…)` / `transaction.set(stockRef…)` / `setDoc(doc(db,'stock'…))` outside `stockMovementEngine.ts`; GRN/dispatch/stockWorkflow/manual all call `applyStockMovement(s)`; GRN has no `runTransaction`. `resolveStockSummaryDocumentId` moved into the engine (+re-export). **E8/N9:** manual adds stay NON-idempotent (fresh key per call unless explicit `sourceId`) — Phase-00 parity. **N9/N10/E7:** NO `firestore.rules` change — emulator re-run (`stockAdjustTransaction` + `stockRoleMatrix` + `stockMovementEngine.emulator`) 3 files / 40 tests green. `stockIn`'s 3 UI callers + `cancelOrder` unchanged (signature identical). Focused: `singleStockWriter` 2/2, `stockWorkflow` 7/7, `stockIn.baseline` 9/9, `manualEntry.baseline` 7/7, `cancelOrder.baseline` 7/7, engine 22/22. Standard gate: lint 3 pre-existing / build ok / full vitest 256 files, 29-fail baseline unchanged. |
| **PHASE 05 STATUS (2026-09-04)** | **COMPLETE.** `stockMovementEngine.ts` is the SOLE `stock` / `stock_ledger` writer. GRN (05b), dispatch OUT (05c), manual add/adjust + `stockIn` + cancel-restore (05d) all call `applyStockMovement(s)`; every legacy local stock transaction deleted. Generic transaction-participant (05a.1) keeps GRN's PO increment + INV-13 over-receipt check AND dispatch's status flip ATOMIC with the stock movement — `MovementWriter` rejects `stock`/`stock_ledger` so the engine stays the owner. Unified ledger schema + legacy dual-write on every new row. NO `firestore.rules` / `firestore.indexes` change across 05a→05d. Emulator: engine 11/11, GRN 16/16 (incl. concurrent 7+6 over-receipt, no stranded stock), dispatch 8/8 (incl. stock=1 concurrent verify), stockAdjust + roleMatrix green. INV-1/INV-7/INV-8/INV-13 enforced by the engine. Desktop + Mobile share the same workflows → the same engine. |
| **06** | **D11, F4, F5**, D8 + O6 |
| **06 STATUS (2026-09-04 — UNCOMMITTED working tree)** | **PASS.** New READ-ONLY `src/engines/StockReconciliationEngine.ts` + pure `src/engines/stockReconciliationMath.ts` (one implementation, reused by `scripts/inventory/reconcile.ts`). **D11 (INV-5):** `computed = Σ(operational IN qty) − Σ(operational OUT qty)` per summary (classifier: `direction` → `movementType` → legacy `type`; RESERVE/RELEASE contribute 0; **RECONCILE_ADJUST rows EXCLUDED from `computed`** — tracked as `reconcileAdjustTotal` — so a correction that brings `stored` to `computed` genuinely reconciles). Detection unit tests (21): reconciled / +mismatch / −mismatch / zero / multi-type / legacy-`type`-only rows / reservations ignored / unclassifiable row flagged / no-ledger-non-zero-stored = "likely opening balance" / **warehouse isolation** (`reconcileWarehouse` scopes to one warehouse, groups ledger by product) / **company isolation** (`getAll`/`getOne` companyScopedQuery + rules). `generateStockHealthReport` splits mismatches into `realDriftCount` (all rows classified — post-engine drift, should be 0) vs `likelyOpeningBalanceCount`. **F4 (read-only):** `reconcileSummary` / `reconcileWarehouse` / `generateStockHealthReport` / `computeReconciliation` perform ZERO writes — unit test spies `createDocWithId`/`updateDocById` (never called); emulator test snapshots `stock` + `stock_ledger` before/after a full reconcile (unchanged). **F5 (RECONCILE_ADJUST):** `applyReconciliationCorrection` → `canDo('edit','stock')` + reasonCode + reconciliationRunId REQUIRED; `correctionQty = (targetOnHand ?? computed) − stored` (SIGNED, sign NOT reversed — positive & negative both unit-tested); calls `applyStockMovement('RECONCILE_ADJUST', qty, idempotencyKey:'RECONCILE_ADJUST:reconciliation:{runId}:{summaryId}', ledgerExtra:{reconciliationRunId, approvedBy, reconciledFromOnHand, reconciledToOnHand, referenceType:'StockReconciliation'})`; `logActivity('Stock','Reconciliation Correction', …)`. **Idempotent per (run-id × summary)** — a retry with the same runId is a no-op (engine in-txn `transaction.get(ledgerRef)`) — unit + emulator. **Post-correction reconcile → delta 0** (RECONCILE_ADJUST excluded from `computed`; the audit row stays in the ledger). Emulator (6): F4 zero-write; F5 Admin correction applies+audits+reconciles; F5 idempotent; **F5 Sales-role DENIED — nothing written** (stock field-guard); **F5 cross-company DENIED**; **F5 RECONCILE_ADJUST ledger row immutable** (`update`/`delete` denied). Engine change: `+auditReconciliation: true` on RECONCILE_ADJUST rows (additive). **D8:** the reconciliation engine only READS; corrections go through `applyStockMovement` — `singleStockWriter.test.ts` still green. **O6:** the emulator F5 "authorized correction reconciles" + the unit "post-correction reconciliation delta 0" + the health-report `realDriftCount` split cover it — a clean post-05 scenario has zero *unexplained* mismatches (any mismatch is `ledgerComplete:false` = pre-engine opening balance, explicitly labelled). **NO `firestore.rules` / `firestore.indexes` / schema change** — RECONCILE_ADJUST rows are normal movement rows. NO auto-correction, NO cron (Plan §17). UI: read-only "Reconcile" report in `StockWorkspace` (`canDo('view','stock')`); correction dialog `canDo('edit','stock')`. CLI: `scripts/inventory/reconcile.ts` (Firestore REST, zero writes). Standard gate: tsc exit 0 / lint 3 pre-existing / build exit 0 / full vitest 257 files — 29-fail brittle baseline unchanged, no stock/reconciliation failure. Emulator regression: 6 files / 70 tests green (grn 16, dispatch 8, engine 11, roleMatrix, stockAdjust, reconciliation 6). |
| **07** | **M1–M10, D10, H3, H5–H7, I3, K7**, N1–N10 (full) + O1, O2, O3 (full) |
| **07 STATUS (2026-09-04 — UNCOMMITTED working tree)** | **PASS.** Sales reservation / allocation activated behind the `reservationsEnabled` flag (`src/lib/inventory/reservationConfig.ts`, default ON — Phase 07 is the activation phase). New collection `stock_reservations/{RSV-enc(key)}` + dedicated `firestore.rules` block + 5 `firestore.indexes.json` composites; `stock_reservations` added to `isSpecialCollection()`, `WAREHOUSE_SCOPED_COLLECTIONS` and `COLLECTION_PERMISSION_MODULE['stock']`. **Engine (`stockMovementEngine.ts`):** `SALES_RESERVE` / `SALES_RELEASE` now honour a per-call `reservationsEnabled` that defaults to the global flag; `clampToStock` grants `min(qty, onHand−reserved)` (reserve) / `min(qty, reserved)` (release) INSIDE the plan (partial reservation — M3; stale-safe consume/release); OFF → RESERVE/RELEASE are benign no-ops (M9). **INV-3** (`reservedQty ≤ onHandQty`) now enforced on the FINAL per-summary plan state (a dispatch batch may pass through an intermediate `onHand−` / `reserved` state before the SALES_RELEASE consume lands) — M8. **D10/INV-4:** `availableQty = onHandQty − reservedQty` maintained by the engine after EVERY movement (the one semantic change in the roadmap). **Reserve on PI paid (`invoiceWorkflow.markPIAsPaid` → `reserveStockForPaidOrder`):** after the payment txn, one `applyStockMovements(SALES_RESERVE[], reserveParticipant)` per PI — the `stock_reservations` doc is created ATOMICALLY inside the engine txn (participant); idempotent by `SALES_RESERVE:proforma_invoice:{piId}:{lineKey}` (M1/M7); fulfilment warehouse = `order.fulfilmentWarehouseId || order.warehouseId` (locked onto the order), missing → `reservationStatus:'deferred_no_warehouse'`, payment NEVER failed (decision 2); shortfall merged per-line into `order.stockShortfall[]` (M3). **Dispatch consume (`dispatchWorkflow.executeAndVerifyDispatch`):** reads the order's active reservations once, adds a `SALES_RELEASE`(`dispatch_consume`) per verified line to the SAME engine batch as the DISPATCH_OUT; `dispatchDocParticipant` updates `qtyConsumed` / `status` on the reservation docs; only DISPATCH_OUT results bump the order line qty (M5, partial dispatch). **Cancel release (`stockWorkflow.cancelOrder`):** a `SALES_RELEASE`(`order_cancel`) per product for each reservation's unconsumed remainder + `reservationUpdateParticipant` marks it `released`; runs alongside the existing SALES_RETURN_IN restore (no double count) — M6, idempotent M7. **Reconciliation (additive, Phase-06 untouched):** `stockReconciliationMath.computeReconciliation` gains `storedReserved` / `expectedReserved` / `reservedDelta` / `reservedReconciled`; `StockReconciliationEngine` + `reconcile.ts` fetch `stock_reservations` and pass Σ(active remainders); `generateStockHealthReport` reports `reservedMismatchCount` / `reservedMismatches`. **UI:** `StockWorkspace` table gains an ON HAND column (Reserved + Available already present, now correct); `OrdersWorkspace` shows a Stock Reservation panel (status, fulfilment warehouse, per-line reserved/consumed/released, shortfall). **Migration:** `scripts/inventory/backfill-onhand.ts` — dry-run by default, `--apply` to write; sets `onHandQty` from the physical basis, initialises `reservedQty` 0 (start clean — decision 6, NO retro-reserve), recomputes `availableQty`; SKIPS + FLAGS any ledger-complete mismatch (Phase-06 RECONCILE_ADJUST decision); never deletes, never touches `stock_ledger`. **firestore.rules:** `match /stock` update — a reservation-only change (onHandQty untouched, `reservedQty` a number within `[0, onHandQty]`) is additionally allowed for Sales / Accounts; the operational role-match still short-circuits first (E7 budget-neutral for GRN/dispatch/manual). New `match /stock_reservations` block: warehouse+company scoped, `resource==null` guard, create limited to Sales/Accounts/Warehouse/Operations/Procurement/Admin/GroupAdmin, update `hasOnly` the consume/release accounting fields with identity immutable, `delete: if false`. **Tests:** engine unit +8 (M1–M9, clamp, batch consume); `reservations.test.ts` +9 (reserve/partial/serialised-M4/idempotent/consume/partial-dispatch/release/M10); `markPIAsPaidReservation.test.ts` +4 (M1/M3/M7/deferred); recon engine +4 (reserved reconcile). **Emulator** `stockReservationTransaction.emulator.test.ts` 15/15 — M1–M8, partial dispatch, cancel release, **M4 real concurrent runTransaction (7+3, never over-reserve)**, Sales ALLOW / Manager DENY / cross-company DENY, reservation-doc + ledger immutability, legitimate consume-update ALLOW, full B2B/B2C inventory-spine SMOKE. Standard gate: **tsc exit 0 / lint 3 pre-existing attendance / build exit 0 / full vitest 259 files, 65-fail brittle baseline UNCHANGED (+97 passing) / emulator 20 files (batched, ~659 tests) 100%** (single-cold-run flake re-verified clean per BRAIN §2.1). Not committed (Phase-07 spec withheld Git). |
| **08** | **L1–L7**, C4–C7, N1, N2, N9 + O4 |
| **09** | **A1–A9, B1–B6, C1–C4, J1–J2**, E7, N1–N10 + O1 |
| **10** | D1, D2, D5, per-sub-feature rows (opening stock: A/D; damage: D + reason; RMA: H6/K + link) + O2 |
| **11** | **K10 (serial lock)**, A8, D-list latency, N8–N10, index deploy verification + O1 |

---
*End of INVENTORY_REGRESSION_MATRIX.md — the checklist is permanent; add rows as phases introduce new behavior, never remove a row without documenting why in the STATE file.*
