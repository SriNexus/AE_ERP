# INVENTORY_IMPLEMENTATION_STATE.md

**Neozy ERP — Inventory Remediation: Live Continuity Checkpoint**

> This file is the **single source of truth for where the Inventory remediation project currently stands.**
> A future session with NO conversation history should be able to read `brain.md` + `INVENTORY_IMPLEMENTATION_PLAN.md` + this file + `INVENTORY_REGRESSION_MATRIX.md` and know exactly what to do next.
> **Update EVERY field at the end of EVERY phase (Plan §23 step 10).** Never leave a field stale.

---

## PLAN APPROVAL

```
PLAN STATUS:            APPROVED
APPROVED BY:            Human project owner
APPROVED ON:            2026-09-03
APPROVAL NOTES:         Project owner approved INVENTORY_IMPLEMENTATION_PLAN.md explicitly.
                        INVENTORY-00 is authorized. Later phases still require their own
                        gate per the Phase Completion Protocol (Plan §23) — one phase at a time.
```

---

## CURRENT POSITION

```
CURRENT PHASE:          INVENTORY-00 — Baseline & Safety Lock
STATUS:                 COMPLETE
LAST VERIFIED COMMIT:   the HEAD commit titled "test(inventory): baseline harness + role matrix + invariants (INVENTORY-00)"
                         (a commit cannot embed its own hash — resolve with:  git log --oneline -1 --grep "INVENTORY-00")
DATE OF THIS UPDATE:    2026-09-03
UPDATED BY:             INVENTORY-00 implementation session
```

---

## COMPLETED PHASES

| Phase | Completed on | Commit hash | Emulator run | Notes |
|---|---|---|---|---|
| approval | 2026-09-03 | `ea3f32f` | — | Project owner approved the plan; INVENTORY-00 authorized. |
| planning baseline | 2026-09-03 | `47c063b` | — | 4 INVENTORY_*.md planning artifacts committed. |
| **INVENTORY-00** | 2026-09-03 | HEAD `test(inventory): baseline harness + role matrix + invariants (INVENTORY-00)` | **PASS** (JBR java 21, 14 files / 600 assertions, 2 batches, 100%) | Baseline harness (6 test files, 51 tests), stock role matrix (25 tests, P1-3 **CONFIRMED**), invariant predicates. Zero production behavior change. |

---

## COMMITS (this remediation project, newest last)

```
47c063b  docs(inventory): establish remediation planning baseline   (4 INVENTORY_*.md)
ea3f32f  docs(inventory): approve remediation plan                  (STATE: PLAN STATUS -> APPROVED)
HEAD     test(inventory): baseline harness + role matrix + invariants (INVENTORY-00)

LAST VERIFIED COMMIT = the HEAD "…(INVENTORY-00)" commit.  Resolve its hash:
   git log --oneline -1 --grep "INVENTORY-00"
```

---

## CURRENT OBJECTIVE

```
INVENTORY-00 is complete. The next authorized phase is INVENTORY-01 (Dispatch Stock-OUT
Transaction Safety). It requires its own explicit go-ahead — do NOT start it from this file alone.
```

---

## WHAT WAS CHANGED (INVENTORY-00)

```
NEW test / instrumentation files only. NO production source, NO firestore.rules, NO schema,
NO indexes, NO migration, NO UI, NO mobile changes.

  src/lib/inventory/INVENTORY_INVARIANTS.ts
      Pure predicate functions for Plan §5 invariants (INV-1..13 checkable; INV-6/9/14/15
      documented as rules/design). NO callers, NO Firestore access, NO behavior change.

  src/lib/inventory/__tests__/baseline/stockIn.baseline.test.ts        (6 tests)
  src/lib/inventory/__tests__/baseline/dispatchOut.baseline.test.ts    (7 tests)
  src/lib/inventory/__tests__/baseline/grn.baseline.test.ts            (6 tests)
  src/lib/inventory/__tests__/baseline/manualEntry.baseline.test.ts    (8 tests)
  src/lib/inventory/__tests__/baseline/cancelOrder.baseline.test.ts    (7 tests)
  src/lib/inventory/__tests__/baseline/invariants.baseline.test.ts     (17 tests)
      Characterize CURRENT behavior of the stock IN / dispatch OUT / GRN / manual-adjust /
      order-cancel paths, including known defects (each marked `// BASELINE: ... Pxx`).

  src/lib/__tests__/stockRoleMatrix.emulator.test.ts                   (25 tests)
      8 roles (Warehouse, Operations, Procurement, Accounts, Sales, Manager, Admin, GroupAdmin)
      x 3 stock write operations, against the DEPLOYED firestore.rules via the emulator.
      RESOLVES P1-3.

  vitest.emulator.config.ts
      +1 line: registered stockRoleMatrix.emulator.test.ts in the `include` list
      (test-harness config only — no rules/behavior change).
```

---

## WHAT WAS VERIFIED (INVENTORY-00)

```
- Firestore emulator ENVIRONMENT RESOLVED: Android Studio's bundled JBR provides
  OpenJDK 21.0.10 at "C:\Program Files\Android\Android Studio\jbr\bin\java.exe".
  Command used:
    JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"; PATH="$JAVA_HOME/bin:$PATH"
    npx firebase emulators:exec --only firestore --project neozy-demo-isolation-test \
      "npx vitest run --config vitest.emulator.config.ts <files>"
  (firebase-tools 15.23.0 already present.) Documented here so future sessions don't re-derive it.

- STOCK WRITE ROLE MATRIX — observed via emulator (P1-3 RESOLVED):

  | Role        | OP-1 create summary | OP-2 update availableQty | OP-3 create stock_ledger |
  |-------------|:-------------------:|:------------------------:|:------------------------:|
  | Warehouse   | ALLOW               | ALLOW                    | ALLOW                    |
  | Operations  | ALLOW               | ALLOW                    | ALLOW                    |
  | Procurement | ALLOW               | **DENY**                 | ALLOW                    |
  | Accounts    | ALLOW               | **DENY**                 | ALLOW                    |
  | Sales       | ALLOW               | **DENY**                 | ALLOW                    |
  | Manager     | ALLOW               | **DENY**                 | ALLOW                    |
  | Admin       | ALLOW               | ALLOW                    | ALLOW                    |
  | GroupAdmin  | ALLOW               | ALLOW                    | ALLOW                    |

  => P1-3 CONFIRMED. `firestore.rules` match /stock update field-guard
     (`... || actorRoleMatches('.*Warehouse.*') || actorRoleMatches('.*Operations.*') || actorRoleMatches('Admin|GroupAdmin')`)
     BLOCKS Procurement / Accounts / Sales / Manager from changing availableQty (or reservedQty)
     on an EXISTING stock summary. Creating a NEW summary and creating a ledger row are NOT
     role-gated (any active same-company member).
  Operational consequences (to be fixed in Plan Phase 03):
     - A Procurement-role GRN into a product/warehouse pair that ALREADY has a stock summary
       fails at the rules layer (stockIn's transaction.set on the existing summary is denied).
       Only the very first receipt (a create) works for that role.
     - Accounts / Sales / Manager cannot run cancelOrder's stock-restore (stockIn -> existing summary).

- INVARIANT BASELINE (evaluateInventoryInvariants over production-shape + demo-seed-shape data):
  Currently HOLD:   INV-1 (onHand>=0), INV-2 (reserved>=0), INV-3 (reserved<=onHand — trivial today,
                    reservedQty is 0 in production), INV-4 (available==onHand-reserved — trivial today),
                    INV-5 (ledger IN-OUT reconciles for internally-consistent samples),
                    INV-8 (idempotencyKey unique — vacuous, no keyed rows exist yet),
                    INV-10 (warehouse FK), INV-13 (PO not over-received for well-formed data).
  Do NOT hold today:
     - INV-7 for DEMO-seed ledger rows: they carry `balanceAfter` but NO beforeQty/afterQty,
       so movement:ledger 1:1 magnitude cannot be verified. (Production schema-A/B rows DO carry
       beforeQty/afterQty and pass INV-7.) Unified ledger schema arrives in Plan Phase 05a — do NOT fix here.
  Absent fields recorded: production `stock` has NO `onHandQty`; production `stock_ledger` has NO
     `idempotencyKey` / `movementType` / `direction`. Demo `stock` uses onHandQty = available + reserved.

- BASELINE CAPTURE of `stock` / `stock_ledger` state after each operation (Plan §11 / matrix D):
  Done as executable assertions on the resulting doc shape (mocked-firestore for the demo branch,
  emulator for the role matrix) — NEVER against production data.
     Add Stock (IN)   -> stockIn.baseline / manualEntry.baseline: summary availableQty += qty,
                         reservedQty carried forward UNCHANGED; ledger schema A
                         {type:'IN', qty, beforeQty, afterQty, sourceType, sourceId} (no idempotencyKey).
     Adjust Stock (OUT)-> manualEntry.baseline: summary availableQty -= qty (throws if < 0);
                         ledger {type:'OUT', ...}. Own local stockSummaryId copy (P1-4).
     GRN              -> grn.baseline: stockIn per received line, sourceId embeds a NEW random GRN id
                         each call (P1-1); PO items[] written by full replace; sequential
                         stockIn -> GRN doc -> PO update (no transaction, P1-5).
     Dispatch verify  -> dispatchOut.baseline: summary availableQty -= verifiedQty via sequential
                         getAll -> updateDocById -> createDocWithId (NOT a runTransaction, P0-1);
                         reservedQty carried forward; ledger schema B
                         {type:'OUT', referenceType:'Dispatch', referenceId} (no sourceType/sourceId).
                         Re-verifying the same line decrements again (no idempotency, P0-1).
     Order cancel     -> cancelOrder.baseline: stockIn (sourceType:'return', sourceId:'CANCEL:{o}:{d}:{p}')
                         for dispatched items; idempotent via that key + existing-return-ledger scan;
                         order flags set (status, refundRequired, paymentReconciliationPending);
                         NO proforma_invoices / tax_invoices read or written (P2-2). Non-atomic.
```

---

## TEST RESULTS (INVENTORY-00)

```
TYPECHECK:  npm run lint  (tsc --noEmit)
            -> 3 errors, ALL pre-existing, ALL in attendance test files
               (src/lib/__tests__/attendancePhase11.test.ts, attendancePhase12.test.ts,
                attendanceRuleEngine.test.ts — missing gpsAccuracyCeilingMeters /
                locationConsistencyMaxSpreadMeters on AttendanceSettings).
            -> ZERO errors in any INVENTORY-00 file. MATCHES the pre-phase baseline exactly.

BUILD:      npm run build  (vite build)
            -> SUCCESS (exit 0, ~34s). Only warning: main chunk 2.69 MB > 600 kB (pre-existing).

UNIT (full): npx vitest run
            -> 254 test files (225 passed | 29 failed) ; 3436 tests (3371 passed | 65 failed).
            -> The 29 failing files are the DOCUMENTED pre-existing brittle source-string / snapshot
               UI-structure baseline (BRAIN.md §35). Full list captured this session:
                 customerWorkspaceHeader, useEmployeesGroupAdminVisibility, navigationConsolidation,
                 useProjectStage, channelPartnerPhase13Verification, demoPhase1Readiness,
                 phase14DocumentsExpansion, projectWorkspace, customerWorkspaceB2BB2CLifecycle,
                 customerWorkspaceCentralPanelRefinement, customerWorkspaceLeadStandardization,
                 customerWorkspacePhase3/4/5, projectWorkspace{Amc,Commissioning,Dispatch,Engineering,
                 Handover,Installation,LoanApplicationCard,NetMetering,Order,Procurement,QC,Quotation,
                 Subsidy,Survey}Integration, projectWorkspaceUiStructure.
            -> INVENTORY-00 added 6 unit test files / +51 tests (the 6 baseline/*.baseline.test.ts),
               ALL PASS. No previously-green test regressed. (pre-phase file count 248; 248 + 6 = 254.)
               stockRoleMatrix.emulator.test.ts (+25 tests) is excluded from the default run
               (vitest.config.ts excludes src/lib/__tests__/*.emulator.test.ts) and runs under the emulator only.

UNIT (targeted, INVENTORY-00 scope): npx vitest run src/lib/inventory/
            src/lib/__tests__/stockWorkflow.test.ts src/lib/__tests__/dispatchWorkflow.test.ts
            src/lib/__tests__/orderWorkflow.test.ts
            src/features/procurement/services/purchaseOrderWorkflow.test.ts
            src/features/procurement/services/goodsReceiptWorkflow.test.ts
            -> 11 files / 71 tests, 100% pass. (6 new baseline + 5 preserved workflow baselines.)

FIRESTORE / EMULATOR:  PASS.
            Batch 1: stockRoleMatrix + stockAdjustTransaction + multiTenantSecurity +
                     sensitiveCollectionsRoleEnforcement -> 4 files / 423 tests, 100%.
            Batch 2: firestoreDemoIsolation, rbacPhase8CumulativeSecurity, groupAdminFullGroupAccess,
                     settingsPersonalOwnershipBackfillFix, rolesSystemRolePermissionEditFix,
                     missingIsSuperAdminFieldFix, phase8GroupPerformance, attendanceRules,
                     biometricFaceReferences, leadCreationProjectionWrites -> 10 files / 177 tests, 100%.
            Total emulator: 14 files / 600 tests, 100% green (2 batches, per BRAIN.md §2.1).
```

---

## KNOWN REMAINING RISKS (full register in the audit + Plan §2)

```
P0-1  Dispatch stock-OUT non-transactional -> oversell/lost update            (Plan Phase 01, then 05c)
P0-2  REST API PUT /api/stock/:id mutates availableQty, no ledger/txn/rules    (Plan Phase 02, then 05)
P0-3  No reservation layer; reservedQty dead; order.stockBlocked unread        (Plan Phase 07)
P1-1  GRN not idempotent -> duplicate stock IN on retry                         (Plan Phase 03, then 05b)
P1-2  Concurrent GRNs -> silent over-receipt                                    (Plan Phase 03)
P1-3  stock field guard BLOCKS Procurement(GRN)/Accounts/Sales/Manager from     (fix Plan Phase 03)  <-- CONFIRMED (INVENTORY-00 emulator, stockRoleMatrix.emulator.test.ts)
      updating availableQty on an EXISTING summary. create-summary + create-ledger are NOT role-gated.
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
PLANNING (commit 47c063b, docs only):
  INVENTORY_IMPLEMENTATION_PLAN.md
  INVENTORY_IMPLEMENTATION_STATE.md
  INVENTORY_PHASE_DEPENDENCY_MAP.md
  INVENTORY_REGRESSION_MATRIX.md

APPROVAL (commit ea3f32f, docs only):
  INVENTORY_IMPLEMENTATION_STATE.md  (PLAN STATUS -> APPROVED)

INVENTORY-00 (commit <this>, tests + harness only — NO production code):
  ADDED:    src/lib/inventory/INVENTORY_INVARIANTS.ts
  ADDED:    src/lib/inventory/__tests__/baseline/stockIn.baseline.test.ts
  ADDED:    src/lib/inventory/__tests__/baseline/dispatchOut.baseline.test.ts
  ADDED:    src/lib/inventory/__tests__/baseline/grn.baseline.test.ts
  ADDED:    src/lib/inventory/__tests__/baseline/manualEntry.baseline.test.ts
  ADDED:    src/lib/inventory/__tests__/baseline/cancelOrder.baseline.test.ts
  ADDED:    src/lib/inventory/__tests__/baseline/invariants.baseline.test.ts
  ADDED:    src/lib/__tests__/stockRoleMatrix.emulator.test.ts
  MODIFIED: vitest.emulator.config.ts  (+1 line, test include list only)
  MODIFIED: INVENTORY_IMPLEMENTATION_STATE.md  (this update)

PRODUCTION SOURCE FILES MODIFIED BY INVENTORY-00: NONE.
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
INVENTORY-00 rollback = revert the single INVENTORY-00 commit. It adds only test files + one
test-config line; nothing to un-migrate, no data touched, no rules deployed.

Rollback readiness for future phases (Plan §18):
  - Tag firestore.rules before Phases 03, 07, 08, 09, 11 as rules-pre-INVENTORY-0X
  - Feature flags: USE_MOVEMENT_ENGINE_{GRN,DISPATCH,MANUAL} (05b-05d), reservationsEnabled (07)
  - Keep each pre-engine local transaction in code for one release after its migration
  - Emulator command for future rules work (JBR java):
      JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"; PATH="$JAVA_HOME/bin:$PATH"
      npx firebase emulators:exec --only firestore --project neozy-demo-isolation-test \
        "npx vitest run --config vitest.emulator.config.ts <files>"    (run in 2-3 batches)
```

---

## NEXT PHASE

```
NEXT PHASE:            INVENTORY-01 — Dispatch Stock-OUT Transaction Safety
BLOCKED BY:            Explicit human go-ahead for INVENTORY-01. The plan is APPROVED overall,
                       but each phase is executed one at a time on its own instruction
                       (Plan §23 discipline, Plan §30 handoff). Do NOT auto-start INVENTORY-01.
DEPENDS ON:            INVENTORY-00 (done). Also consumes INVENTORY-00's role-matrix result:
                       the dispatch-verify actor is typically the Warehouse role, which OP-2
                       ALLOWS — so INVENTORY-01 should NOT need a firestore.rules change.
                       CONFIRM the real dispatch-verify role(s) before writing code; if a
                       non-{Warehouse|Operations|Admin|GroupAdmin} role verifies dispatches,
                       fold the rules fix into INVENTORY-01 with an emulator test (per Plan §14).
```

---

## EXACT NEXT ACTION

```
INVENTORY-00 is COMPLETE and committed. Do NOT do anything further without a new instruction.

When INVENTORY-01 is authorized, execute it per Plan §14 "INVENTORY-01 — Dispatch Stock-OUT
Transaction Safety":
  1. Re-read: brain.md (§18, §23 DISPATCH/INVENTORY, §34), INVENTORY_IMPLEMENTATION_PLAN.md §14
     INVENTORY-01, INVENTORY_REGRESSION_MATRIX.md rows D3/D4/D5/K1-K6/K11/C5-C7/E7/N9, this file.
  2. Confirm which role(s) actually run executeAndVerifyDispatch (grep the callers + UI perms).
     Cross-check against the INVENTORY-00 role matrix (WHAT WAS VERIFIED above).
  3. Make executeAndVerifyDispatch's per-line stock decrement + ledger write ATOMIC
     (one runTransaction, mirroring stockWorkflow.stockIn), with a deterministic
     stock_ledger doc id keyed 'DISPATCH_OUT:dispatch:{DSP}:{productId}' for double-click idempotency.
     Add: reject re-verify when dispatch.status is already Dispatched/Delivered/Closed.
     Add: getOne(PRODUCTS)/getOne(WAREHOUSES) existence + not-isDeleted check before the loop.
  4. Update dispatchOut.baseline.test.ts to the NEW expected behavior (document the change in the
     commit message); add concurrency / idempotency / oversell / deleted-product tests.
  5. Full verification per Plan §23 (lint == baseline of 3 attendance errors; build; full vitest —
     no new failures beyond the documented 29; emulator suite batched if rules changed).
  6. Update THIS file (every field). Commit:
     fix(inventory): atomic + idempotent dispatch stock-out (INVENTORY-01, P0-1)
  7. STOP.

Do NOT touch stockWorkflow.stockIn internals, useInventory, goodsReceiptWorkflow, firestore.rules
(unless step 2 proves it necessary), or any later-phase scope.
```

---

## DO NOT REPEAT

```
- Do NOT re-run the full audit — it is complete (COMPLETE_INVENTORY_INTEGRITY_AUDIT.md).
- Do NOT re-derive the phase order — it is in the Plan + INVENTORY_PHASE_DEPENDENCY_MAP.md.
- Do NOT re-run INVENTORY-00 — it is COMPLETE (commit recorded below). P1-3 is CONFIRMED; do not "re-check".
- Do NOT re-derive the emulator command — it is recorded above (JBR java).
- Do NOT start INVENTORY-01 (or any later phase) without an explicit new instruction.
- Do NOT attempt to "fix everything" — one phase, one commit, one STATE update, then STOP.
- The 29 failing unit-test files are the documented pre-existing baseline (BRAIN.md §35) — do NOT "fix" them.
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
2. PLAN STATUS: APPROVED. Overall approval exists, BUT each phase runs on its own explicit instruction.
3. CURRENT PHASE = INVENTORY-00, STATUS = COMPLETE. NEXT PHASE = INVENTORY-01.
   -> If the user has just asked you to run INVENTORY-01, do EXACTLY what "EXACT NEXT ACTION" says.
   -> If NOT, STOP and report that INVENTORY-00 is done and INVENTORY-01 awaits a go-ahead.
4. Do not touch any phase beyond the one you were told to run. End with Plan §23. Update this file. STOP.
5. Emulator: use the JBR-java command in ROLLBACK STATUS / WHAT WAS VERIFIED. Do not re-derive it.
```

---
*End of INVENTORY_IMPLEMENTATION_STATE.md — checkpoint. Update at the end of every phase.*
