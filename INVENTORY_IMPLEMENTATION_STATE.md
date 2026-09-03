# INVENTORY_IMPLEMENTATION_STATE.md

**Neozy ERP — Inventory Remediation: Live Continuity Checkpoint**

> This file is the **single source of truth for where the Inventory remediation project currently stands.**
> A future session with NO conversation history should be able to read `brain.md` + `INVENTORY_IMPLEMENTATION_PLAN.md` + this file + `INVENTORY_REGRESSION_MATRIX.md` and know exactly what to do next.
> **Update EVERY field at the end of EVERY phase (Plan §23 step 10).** Never leave a field stale.

---

## PLAN APPROVAL

```
PLAN STATUS:            DRAFT — NOT APPROVED
APPROVED BY:            —
APPROVED ON:            —
APPROVAL NOTES:         Awaiting review of INVENTORY_IMPLEMENTATION_PLAN.md.
                        Implementation MUST NOT begin until this reads "APPROVED".
```

---

## CURRENT POSITION

```
CURRENT PHASE:          NONE — planning complete, implementation not started
STATUS:                 AWAITING PLAN APPROVAL
LAST VERIFIED COMMIT:   (pre-remediation baseline — set to the commit that adds these 4 planning docs once committed)
DATE OF THIS UPDATE:    2026-09-03
UPDATED BY:             Planning session (architecture + roadmap)
```

---

## COMPLETED PHASES

```
(none)
```

| Phase | Completed on | Commit hash | Emulator run | Notes |
|---|---|---|---|---|
| — | — | — | — | — |

---

## CURRENT OBJECTIVE

```
Obtain review + approval of INVENTORY_IMPLEMENTATION_PLAN.md.
No code, rules, schema, or data changes until approved.
```

---

## WHAT WAS CHANGED (this session)

```
Created 4 planning artifacts (documentation only — zero source/rules/schema/data changes):
  - INVENTORY_IMPLEMENTATION_PLAN.md         (master roadmap, 12 phases: INVENTORY-00 … INVENTORY-11; 05 split 05a-05d)
  - INVENTORY_IMPLEMENTATION_STATE.md        (this file)
  - INVENTORY_PHASE_DEPENDENCY_MAP.md        (why phases run in this order)
  - INVENTORY_REGRESSION_MATRIX.md           (permanent regression checklist)

During planning, ONE audit finding was upgraded from evidence:
  - P1-8: NOT VERIFIED -> VERIFIED. Orders.tsx:289-293 (save mutation, editId branch) does a full
    updateDocById(COLLECTIONS.ORDERS, editId, {...d, items, subtotal, taxTotal, discount, total})
    with NO status check and NO lock -> order line items/quantities are editable after partial/full
    dispatch, overwriting dispatchedQty/pendingQty tracking written by executeAndVerifyDispatch.
```

---

## WHAT WAS VERIFIED (this session)

```
- BRAIN.md read in full (1541 lines). Inventory-relevant sections: §11.3, §13, §15, §18, §23
  (INVENTORY/STOCK, ORDERS, DISPATCH, VENDORS/PO/GRN), §25, §27, §28, §33, §34.
- COMPLETE_INVENTORY_INTEGRITY_AUDIT.md re-read; all finding IDs carried into the plan (§2).
- Source re-read for planning: stockWorkflow.ts, dispatchWorkflow.ts, orderWorkflow.ts,
  quotationWorkflow.ts, invoiceWorkflow.ts, taxInvoiceWorkflow.ts (head), useInventory.ts,
  useCategories.ts, useWarehouses.ts, purchaseOrderWorkflow.ts, goodsReceiptWorkflow.ts,
  ProcurementValidationEngine.ts, ProductPicker.ts, Orders.tsx (save mutation), firestore.rules
  (stock 1423, stock_ledger 1510, dispatch 1393, warehouses 917, product_categories 1939,
  purchase_orders 1878, goods_receipts 1902, generic fallback 2591, helpers 435-504, isSpecialCollection 780-795),
  api/_lib/registry.ts, api/[entity]/[id].ts (delete handler), firestore.indexes.json (grep).
- Confirmed: no master-plan / phase docs exist in the repo. BRAIN.md is the sole architectural source.
- Confirmed: no existing inventory movement engine / reconciliation engine (src/engines/ has only
  CaseEngine, CaseValidationEngine, ProcurementValidationEngine, LinkedRecordsEngine, TaskEngine, WorkspaceSearchEngine).
- Confirmed: reservedQty written by zero production paths; onHandQty not a production field.
- Confirmed: two stockSummaryId definitions (workflow.ts:60, useInventory.ts:134) — identical output.
```

---

## TEST RESULTS (this session — baseline capture)

```
UNIT (targeted):  npx vitest run stockWorkflow.test.ts dispatchWorkflow.test.ts orderWorkflow.test.ts
                  purchaseOrderWorkflow.test.ts goodsReceiptWorkflow.test.ts
                  -> 20 passed / 20.  (2026-09-03)

UNIT (full):      NOT RUN this session. BRAIN.md §35 baseline: ~29 brittle source-string UI test files
                  fail as a pre-existing baseline (NOT regressions). Phase 00 must capture the exact count.

TYPECHECK:        npm run lint (tsc --noEmit) -> 3 errors, ALL pre-existing, ALL in attendance test files
                  (attendancePhase11.test.ts, attendancePhase12.test.ts, attendanceRuleEngine.test.ts —
                  missing gpsAccuracyCeilingMeters / locationConsistencyMaxSpreadMeters).
                  ZERO errors in inventory/procurement/order/dispatch/stock code.

BUILD:            npm run build (vite build) -> SUCCESS (exit 0, 3m16s). Only warning: main chunk 2.69MB
                  > 600kB (pre-existing, unrelated).

FIRESTORE / EMULATOR:  NOT RUN. java.exe missing from PATH in this environment
                       (auto-memory: feedback_neozy_environment_notes — use Android Studio's bundled JBR
                       as a workaround). CI (security-rules-tests.yml) still runs the suite.
                       *** PHASE 00 MUST RESOLVE THIS or document CI-only. ***
```

---

## KNOWN REMAINING RISKS (full register in the audit + Plan §2)

```
P0-1  Dispatch stock-OUT non-transactional -> oversell/lost update            (Plan Phase 01, then 05c)
P0-2  REST API PUT /api/stock/:id mutates availableQty, no ledger/txn/rules    (Plan Phase 02, then 05)
P0-3  No reservation layer; reservedQty dead; order.stockBlocked unread        (Plan Phase 07)
P1-1  GRN not idempotent -> duplicate stock IN on retry                         (Plan Phase 03, then 05b)
P1-2  Concurrent GRNs -> silent over-receipt                                    (Plan Phase 03)
P1-3  stock field guard likely blocks Procurement(GRN)/Accounts(cancel)        (Plan Phase 00 REPRODUCE, fix Phase 03)  <-- NOT YET CONFIRMED
P1-4  Two parallel stock-write implementations, divergent ledger schemas       (Plan Phase 05a-05d)
P1-5  Multi-doc stock ops non-atomic (dispatch, GRN)                            (Plan Phase 01/03, then 05)
P1-6  No product/warehouse existence check at order/dispatch/adjust            (Plan Phase 01 partial, 09)
P1-7  genId random + setDoc(merge:true) -> collision silently merges           (Plan Phase 09)
P1-8  Order items editable after partial dispatch (VERIFIED, Orders.tsx:289)   (Plan Phase 04)
P2-1  No stock<->ledger reconciliation                                         (Plan Phase 06)
P2-2  cancelOrder non-atomic; doesn't reverse PIs/tax invoices                 (Plan Phase 04 status-atomic, 05d restore)
P2-3  Category link by name, not id                                            (Plan Phase 09)
P2-4  Three divergent PO transition tables                                     (Plan Phase 03)
P2-5  Master-data soft-delete no FK guard/cascade                              (Plan Phase 09)
P2-6  stock_ledger create not role-gated / not delta-checked                   (Plan Phase 02 doc, 03/05 fix)
P2-7  PI generatable repeatedly; totalInvoiced "simplified"                    (Plan Phase 04 guard; billing math = Future)
P2-8  Concurrent quote->order conversion race                                  (Plan Phase 04)
P2-9  Dispatch serial dedup = full getAll(DISPATCH) scan O(n^2)                (Plan Phase 11a)
P3-1..6  opening stock / damage / bulk / low-stock / RMA / indexes            (Plan Phase 10, 11)
```

---

## INTENTIONALLY UNFIXED (deferred by design — see Plan §20 Future/Optional)

```
- Batch/lot/expiry tracking
- Barcode scanning UI
- Inventory valuation / COGS / FIFO-LIFO cost layers
- Demand forecasting / auto-reorder-point
- Reservation expiry / allocation-to-dispatch (loading plans)
- Backorder / negative-available
- Scheduled (cron) reconciliation
- stock_ledger cold-storage / rollup archival (design in 11d; implement only if volume demands)
- Bin/location tracking within a warehouse
- taxInvoiceWorkflow serial_numbers collection overload (documented, not fixed)
- Dedicated firestore.rules block for `orders` (order-edit lock is workflow-layer only in Phase 04;
  the `orders` API PUT gap is documented as pre-existing, tightened when `orders` gets a dedicated block — Future)
- Billing partial-invoice math ("totalInvoiced = order.total" simplification stays until a Finance phase)
```

---

## FILES MODIFIED (cumulative across all completed phases)

```
(none — no implementation phase has run)

Planning artifacts created this session (docs only):
  INVENTORY_IMPLEMENTATION_PLAN.md
  INVENTORY_IMPLEMENTATION_STATE.md
  INVENTORY_PHASE_DEPENDENCY_MAP.md
  INVENTORY_REGRESSION_MATRIX.md
```

---

## FILES / AREAS NOT TO TOUCH (Plan §21 — enforce every phase)

```
- Invoice/PI money math, tax/GST calc (gstCalculation.ts), taxInvoiceWorkflow number allocation
- Quotation UI / pricing engine (except convert-race guard, Phase 04)
- Customer lifecycle / customer_phone_locks
- paymentWorkflow.ts (except markPIAsPaid: PI-repeat guard Phase 04, reserve trigger Phase 07)
- Lead / Case / Project lifecycle, CaseEngine, casePropagation
- Channel Partner / commission / wallet / settlements
- Attendance / biometric / geo
- Identity chain: authIdentity.ts, userIdentity.ts, entityProjection.ts, ownerAccess.ts
- firestore.rules blocks OTHER THAN: stock, stock_ledger, purchase_orders, product_categories(09),
  and NEW blocks (stock_reservations 07, stock_transfers 08, product_sku_locks 09, dispatch_serials 11)
- The single Cloud Function (onUserDeactivated) — no new Cloud Functions
- API auth + all API entities except the `stock` read-only change (Phase 02)
- ANY src/components/mobile/** business logic — mobile shells call shared hooks/workflows only
  (DESKTOP IS THE SOURCE OF TRUTH — BRAIN.md §22.3)
```

---

## DATABASE CHANGES (cumulative)

```
(none)

Planned additive schema (NOT yet applied — listed for continuity):
  Phase 01: stock_ledger.idempotencyKey (+ deterministic doc id for DISPATCH_OUT rows)
  Phase 03: stock_ledger.idempotencyKey (GRN), goods_receipts.stockApplied[]
  Phase 04: orders.piReversalRequired, orders.reversalInvoiceIds[]
  Phase 05a: stock.onHandQty; stock_ledger.{movementType,direction,onHandBefore/After,reservedBefore/After}
  Phase 07: NEW collection stock_reservations + rules block + index;
            order.fulfilmentWarehouseId, order.stockShortfall[]; availableQty semantic = onHand - reserved
  Phase 08: NEW collection stock_transfers + rules block + index
  Phase 09: product.categoryId, product.parentCategoryId; NEW collection product_sku_locks + rules + index
  Phase 10: reasonCode taxonomy; importRunId; RMA/return docs
  Phase 11: NEW collection dispatch_serials + rules + index; composite indexes for new collections
```

---

## MIGRATIONS (cumulative)

```
(none run)

Planned backfills (scripts, dry-run first, reviewed, run on a copy — NEVER automatic):
  Phase 05d/07: set stock.onHandQty = stock.availableQty where onHandQty absent; recompute availableQty
  Phase 07:     decision required — retro-reserve currently-paid-undispatched orders, OR start clean from deploy date
                (RECOMMENDED: start clean, documented)
  Phase 09:     map product.category (name string) -> product.categoryId by category name; report unmatched
  Phase 09:     SKU duplicate report (flag for manual resolution, never auto-merge)
  Phase 11a:    backfill dispatch_serials from existing dispatch.items[].serials
```

---

## ROLLBACK STATUS

```
Nothing to roll back (no phase executed).

Rollback readiness for future phases (Plan §18):
  - Tag firestore.rules before Phases 03, 07, 08, 09, 11 as rules-pre-INVENTORY-0X
  - Feature flags: USE_MOVEMENT_ENGINE_{GRN,DISPATCH,MANUAL} (05b-05d), reservationsEnabled (07)
  - Keep each pre-engine local transaction in code for one release after its migration
```

---

## NEXT PHASE

```
NEXT PHASE:            INVENTORY-00 — Baseline & Safety Lock
BLOCKED BY:            Plan approval (this file's PLAN STATUS must read "APPROVED")
```

---

## EXACT NEXT ACTION

```
1. A human reviews INVENTORY_IMPLEMENTATION_PLAN.md.
2. On approval: set "PLAN STATUS: APPROVED", fill APPROVED BY / ON, in THIS file. Commit.
3. Begin INVENTORY-00 per Plan §14 "INVENTORY-00":
   a. Resolve the Firestore emulator environment (install a JDK / point to Android Studio's JBR) OR
      formally document that the emulator suite runs in CI only for this project.
   b. Write the baseline test suites (test files ONLY — no source changes):
      src/lib/inventory/__tests__/baseline/{stockIn,dispatchOut,grn,manualEntry,cancelOrder}.baseline.test.ts
   c. Write src/lib/__tests__/stockRoleMatrix.emulator.test.ts — 8 roles x 3 stock write ops.
      This RESOLVES P1-3 (currently PLAUSIBLE / NOT CONFIRMED).
   d. Write src/lib/inventory/INVENTORY_INVARIANTS.ts (predicate fns, no callers) + a test of which hold today.
   e. Capture: full `npx vitest run` pass/fail counts; `npm run lint`; `npm run build`; emulator run.
   f. Screenshot current stock + stock_ledger docs after: Add Stock, Adjust Stock, GRN, dispatch verify, order cancel.
   g. Update THIS file (every field). Commit: test(inventory): baseline harness + role matrix + invariants (INVENTORY-00)
   h. STOP.
```

---

## DO NOT REPEAT

```
- Do NOT re-run the full audit — it is complete (COMPLETE_INVENTORY_INTEGRITY_AUDIT.md).
- Do NOT re-derive the phase order — it is in the Plan + INVENTORY_PHASE_DEPENDENCY_MAP.md.
- Do NOT start any phase after INVENTORY-00 until INVENTORY-00 is COMPLETE and this file says so.
- Do NOT attempt to "fix everything" — one phase, one commit, one STATE update, then STOP.
```

---

## DO NOT CHANGE (until the owning phase)

```
See "FILES / AREAS NOT TO TOUCH" above and Plan §21. In particular:
- No firestore.rules edits before Phase 03 (and only stock/stock_ledger/purchase_orders there).
- No stock quantity/write logic edits before Phase 01 (dispatch) / Phase 03 (GRN) / Phase 05 (engine).
- No reservation / onHandQty / reservedQty activation before Phase 07.
- No mobile-file business logic, ever.
```

---

## CONTINUITY CHECK (for a fresh session)

```
If you are a new session with no history:
1. You have read: brain.md, INVENTORY_IMPLEMENTATION_PLAN.md, this file, INVENTORY_REGRESSION_MATRIX.md,
   INVENTORY_PHASE_DEPENDENCY_MAP.md.
2. PLAN STATUS above: if not "APPROVED" -> STOP, ask for approval, write no code.
3. If APPROVED -> do EXACTLY what "EXACT NEXT ACTION" says for the phase named in "NEXT PHASE".
4. Do not touch any later phase. End with Plan §23. Update this file. STOP.
```

---
*End of INVENTORY_IMPLEMENTATION_STATE.md — checkpoint. Update at the end of every phase.*
