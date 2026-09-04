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
CURRENT PHASE:          INVENTORY-05a — Stock Movement Engine + Adapter (DORMANT) — COMPLETE
STATUS:                 IMPLEMENTED + VERIFIED + COMMITTED. New engine module lands DEAD CODE
                        — no existing caller migrated (05b/05c/05d do the migrations). The only
                        behaviour-adjacent change is de-duplicating `stockSummaryId` (byte-
                        identical output, tested). NO firestore.rules change — the engine's
                        write shape passes today's `stock`/`stock_ledger` rules unchanged
                        (emulator-proven).
LAST VERIFIED COMMIT:   HEAD  feat(inventory): dormant stock movement engine + adapter (INVENTORY-05a)
                        HEAD chain: c043009 → 1368cfd (01) → 58038f4 (02) → 8e2c799 (03) → 21e502e (04) → 9227ec3 (docs) → HEAD (05a).
DATE OF THIS UPDATE:    2026-09-04
UPDATED BY:             INVENTORY-05a implementation session
```

---

## COMPLETED PHASES

| Phase | Completed on | Commit hash | Emulator run | Notes |
|---|---|---|---|---|
| approval | 2026-09-03 | `ea3f32f` | — | Project owner approved the plan; INVENTORY-00 authorized. |
| planning baseline | 2026-09-03 | `47c063b` | — | 4 INVENTORY_*.md planning artifacts committed. |
| **INVENTORY-00** | 2026-09-03 | `49123be` | **PASS** (JBR java 21, 14 files / 600 assertions, 2 batches, 100%) | Baseline harness (6 test files, 51 tests), stock role matrix (25 tests, P1-3 **CONFIRMED**), invariant predicates. Zero production behavior change. |
| **INVENTORY-01** | 2026-09-03 | `1368cfd` | **PASS** (JBR java 21, full suite 3 batches 15 files / 608 tests 100%; new dispatch txn suite 8/8; concurrency proven) | Atomic + idempotent dispatch stock-OUT (P0-1); dispatch-side product/warehouse validation (P1-6 slice); one **minimal** firestore.rules change (`stock_ledger` read `resource == null` guard). |
| **INVENTORY-02** | 2026-09-03 | `58038f4` | **PASS** (unchanged — no rules touched; spot-check 4 files / 315 tests 100%) | REST API `stock` + `stock_ledger` made READ-ONLY (P0-2): every mutating method -> 405 before auth/DB, zero Firestore write. **NO firestore.rules change. NO SDK stock-writer change. NO UI change.** New: `api/__tests__/apiInventoryWriteBoundary.test.ts` (18 tests). API suite 11 files / 303 tests 100%. |
| **INVENTORY-03** | 2026-09-04 | `8e2c799` | **PASS** (JBR java 21, full suite 16 files / 624 tests 100%, sub-batched; new `grnReceiptTransaction.emulator.test.ts` 16/16; concurrency + INV-13 + P1-3 proven; re-verified in the acceptance audit) | GRN receipt is now **idempotent + atomic per receipt + over-receipt-proof under concurrency** (P1-1/P1-2/P1-5/INV-13): one `runTransaction` over `stock`+`stock_ledger`+`purchase_orders`, deterministic per-line ledger id, PO `receivedQty` incremented (never a stale array). **P1-3 RESOLVED** — `stock` write-role list gains `Procurement` (Sales/Accounts stay denied). **P2-4 RESOLVED** — one shared `PURCHASE_ORDER_TRANSITIONS` (workflow ↔ ProcurementValidationEngine ↔ rules mirror). `firestore.rules`: `stock` field-guard role list (+Procurement, 3 calls→1); `purchase_orders` update made LEAN (budget) + `PartiallyReceived→PartiallyReceived` self-transition. Additive: `stock_ledger.purchaseOrderId`/`stockId`, `goods_receipts.stockApplied[]`, 2 composite indexes. |
| **INVENTORY-04** | 2026-09-04 | `21e502e` (was `30920c2` before the PRE-05a rebuild — identical -04 content) | **PASS** — new `orderLifecycleTransaction.emulator.test.ts` 5/5 (convert-race + cancel-atomicity); NO firestore.rules / firestore.indexes change so the INVENTORY-03 emulator surface (16 files / 624 tests) stands. | Order line lock (P1-8 / INV-12): shared `isOrderLineLocked(order)` + `updateOrder(id,patch)` in `orderWorkflow.ts` — a dispatched order's line product/qty/price can no longer change (workflow-layer, `Orders.tsx` + `MobileOrderWorkspace.tsx` both call it); non-line edits stay allowed. `cancelOrder` (P2-2): order + affected dispatch status flip in ONE `runTransaction` (configured) that re-reads each; additive `orders.piReversalRequired` + `orders.reversalInvoiceIds[]` (info only — NO reversal/GST/amount change). Stock restore UNCHANGED (still `stockIn` — 05d). `generatePIsFromOrder` (P2-7): re-read + repeat guard (`{force:true}` escape). `convertQuotationToOrder` (P2-8): lock-check + order-create + quotation-mark in ONE `runTransaction` re-reading `convertedOrderId` — concurrent conversions → one order, same id. **NO rules change; `orders` API PUT bypass documented, still deferred.** |
| **INVENTORY-05a** | 2026-09-04 | `HEAD` | **PASS** — new `src/lib/inventory/__tests__/stockMovementEngine.emulator.test.ts` 8/8 (engine write shape passes CURRENT rules unchanged; atomic; idempotent; INV-1 abort; cross-company + Sales-role + forged-warehouse DENY; ledger immutable). NO firestore.rules change → INVENTORY-03 emulator surface (16 files / 624) stands. | **DORMANT** `src/lib/inventory/stockMovementEngine.ts` — `applyStockMovement(input): Promise<MovementResult>` (Plan §4.1/§9/§10). ONE `runTransaction` over `stock` + `stock_ledger` + in-txn idempotency (deterministic **injective** id `STKMV-{encodeURIComponent(idempotencyKey)}` — INV-8 by construction); INV-1/INV-2 guards abort the txn; INV-3/INV-4 gated behind `reservationsEnabled` (FALSE for 05–06: `availableQty == onHandQty`, `reservedQty` 0); `companyId`+`groupId` manually stamped; legacy ledger fields (`type`/`referenceType`/`referenceId`/`date`) dual-written. New `types.ts` (MovementType enum §8) + `idempotency.ts`. **NO caller migrated** (05b/05c/05d). `stockSummaryId` de-duplicated: `useInventory.ts` deletes its local copy, imports the one in `workflow.ts` (byte-identical — tested). New: `stockMovementEngine.test.ts` (15). Additive schema (only when called, not in 05a): `stock.onHandQty`, `stock_ledger.{movementType,direction,idempotencyKey,onHandBefore/After,reservedBefore/After}`. |

---

## COMMITS (this remediation project, newest last)

```
47c063b  docs(inventory): establish remediation planning baseline   (4 INVENTORY_*.md)
ea3f32f  docs(inventory): approve remediation plan                  (STATE: PLAN STATUS -> APPROVED)
49123be  test(inventory): baseline harness + role matrix + invariants (INVENTORY-00)
c043009  docs(inventory): record INVENTORY-00 commit hash in STATE checkpoint
1368cfd  fix(inventory): atomic + idempotent dispatch stock-out (INVENTORY-01, P0-1)
58038f4  fix(inventory): make stock read-only via REST API (INVENTORY-02, P0-2)
8e2c799  fix(inventory): idempotent+atomic GRN, unified PO transitions, stock write-role alignment (INVENTORY-03)
21e502e  fix(inventory): order line lock + atomic cancel + PI/convert guards (INVENTORY-04)
9227ec3  docs(inventory): checkpoint STATE + regression matrix for INVENTORY-01..04
HEAD   feat(inventory): dormant stock movement engine + adapter (INVENTORY-05a)   (current HEAD — this commit ALSO carries this STATE + the regression-matrix update, per the phase §18 instruction; a future session replaces "HEAD" here with the real short hash once 05b lands, exactly as -04's row was backfilled to 21e502e)

PRE-05a git checkpoint (2026-09-04): the earlier session committed only Phase-04 (as 30920c2)
while -01/-02/-03 sat uncommitted, so history was out of phase order. Reconciled by a SAFE
LOCAL rebuild — `git reset --mixed c043009` (working tree untouched) then re-commit each phase
in order. No `--hard`, no `clean`, no force-push, no remote change. The `firestore.rules` and
`vitest.emulator.config.ts` cross-phase diffs were split by reconstructing the file content
between commits (verified byte-exact against the pre-checkpoint working tree). Old commit
30920c2 is preserved on branch `pre-05a-backup-head`; a full pre-checkpoint tracked-tree
snapshot is tag `pre-05a-worktree-snapshot`.

LAST VERIFIED COMMIT = HEAD (INVENTORY-05a). Uncommitted in the working tree: the 4 unrelated
pre-existing changes (LEADS_UI_UX delete, ProfileSection.tsx, useMyProfile.ts, userProfile.ts)
+ untracked BRAIN.md / COMPLETE_INVENTORY_INTEGRITY_AUDIT.md. ZERO inventory implementation
files are uncommitted.
```

---

## CURRENT OBJECTIVE

```
INVENTORY-00..05a are committed in order (c043009 checkpoint, then 1368cfd / 58038f4 /
8e2c799 / 21e502e / 9227ec3 docs / HEAD 05a). All phases implemented + verified +
committed. INVENTORY-05a landed the Stock Movement Engine as DORMANT dead code — no
caller migrated. The next authorized phase is INVENTORY-05b (migrate the GRN receipt
path onto the engine behind a flag). It requires its own explicit go-ahead — do NOT
start it from this file alone.
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

## WHAT WAS CHANGED (INVENTORY-01 — Dispatch Stock-OUT Transaction Safety)

```
PRODUCTION SOURCE (1 file):
  src/lib/dispatchWorkflow.ts
    - executeAndVerifyDispatch() rewritten for atomicity + idempotency (P0-1):
        * status guard: re-reads the authoritative dispatch; a sequential
          double-click / retry-after-success on a TERMINAL_DISPATCH_STATUSES
          dispatch ('Dispatched'|'In Transit'|'Delivered'|'Returned'|'Closed')
          is REJECTED with a clear message.
        * P1-6 (dispatch slice): assertDispatchReferencesValid() — warehouse +
          every referenced product must exist, not be soft-deleted, and be
          same-company; else reject BEFORE any mutation.
        * CONFIGURED branch: ONE runTransaction covering the dispatch doc + every
          line's stock summary + every line's deterministic ledger doc. All
          reads first, then validate (insufficient => whole txn aborts, no
          partial mutation), then all writes. `availableQty` can never go
          negative; `groupId` manually stamped (raw-txn, HR-9).
        * DETERMINISTIC ledger doc id: dispatchOutLedgerId(dispatchId, productId)
          = `STKOUT-{enc(dispatchId)}-{enc(productId)}`. Read first inside the
          txn — an existing row => that line is an idempotent no-op (appliedQty
          0). `stock_ledger` rules (`allow update: if false`) are the backstop.
        * order-line dispatchedQty/pendingQty is bumped by the APPLIED qty (0 for
          an idempotent no-op line) — a losing concurrent verification never
          double-bumps the order.
        * DEMO branch (!firebaseEnv.isConfigured): same guards, sequential
          (best-effort) — unchanged risk class, demo-only.
        * new exports: TERMINAL_DISPATCH_STATUSES, dispatchOutLedgerId.
        * return value added: { dispatchId, alreadyVerified, applied[] }
          (callers ignore the return — backward compatible).
    - new ledger fields on the OUT row (ADDITIVE, backward compatible): groupId,
      sourceType:'dispatch', sourceId, idempotencyKey, createdBy. All prior
      fields (type/qty/beforeQty/afterQty/referenceType/referenceId/date/...) kept.

FIRESTORE RULES (1 minimal change):
  firestore.rules — match /stock_ledger read rule gains a `resource == null`
    guard (identical established pattern to stock/companies/roles/users/settings/
    customer_phone_locks). REQUIRED: the txn reads a not-yet-created deterministic
    ledger doc for the idempotency check; without the guard that read hard-denies
    the whole transaction for every role. Grants NOTHING once a row exists;
    `allow create` unchanged; `allow update, delete: if false` unchanged.
    NO write-permission broadening. Emulator budget (E7): re-verified, no regression.

TESTS:
  src/lib/__tests__/dispatchWorkflow.test.ts        — updated: COLLECTIONS mock
      gains WAREHOUSES/PRODUCTS/PROJECTS; firestore mock gains resolveWriteGroupId;
      workflow mock gains stockSummaryId; the 2 serial-protection tests that
      proceed past validation now stub the authoritative dispatch + warehouse +
      product; +7 INVENTORY-01 tests (terminal-status reject, deleted/missing/
      cross-company product+warehouse, insufficient, idempotent no-op, deterministic
      ledger id + idempotencyKey). 13/13 pass.
  src/lib/inventory/__tests__/baseline/dispatchOut.baseline.test.ts — REWRITTEN
      to characterize the FIXED demo-branch behavior (was: the pre-fix defects).
      11/11 pass. Commit note: this file's expectations intentionally changed.
  src/lib/__tests__/dispatchStockOutTransaction.emulator.test.ts — NEW. 8 tests:
      K2 atomic decrement + deterministic OUT ledger + dispatch Dispatched;
      D4/K4 CONCURRENCY (stock=1, two parallel 1-unit verifications -> exactly one
      applies, final stock 0, exactly ONE OUT ledger row, never negative);
      D3/K3 insufficient aborts whole txn; D5/K5 idempotent no-op; status guard;
      ledger immutability; P1-3 compatibility (Accounts can't complete — documented);
      cross-warehouse rejected.
  vitest.emulator.config.ts — +1 line registering the new emulator test.

NO changes to: stockWorkflow.stockIn internals, useInventory, goodsReceiptWorkflow,
Orders/order lifecycle, reservation/onHandQty/reservedQty, movement engine (none),
mobile business logic, any other firestore.rules block, indexes.
```

---

## WHAT WAS VERIFIED (INVENTORY-01)

```
- DISPATCH ACTOR ROLES: the "Verify & Execute" section in ProjectDispatchWorkspace.tsx
  is gated by perms.canApprove('dispatch'). Roles with `dispatch approve`
  (BRAIN §14.2): Warehouse (primary operator) and Accounts. Mobile
  (MobileDispatchWorkspace) calls the same shared workflow. Cross-checked vs the
  INVENTORY-00 role matrix: Warehouse/Operations/Admin/GroupAdmin CAN complete the
  stock write; Accounts CANNOT (field guard). Decision (Plan §13): NO rules change
  to broaden stock writes — the normal operator (Warehouse) works; the pre-existing
  Accounts-verifies gap is unchanged by INVENTORY-01 and is explicitly owned by
  Plan Phase 03 (stock write-role alignment). Documented, emulator-asserted.

- CONCURRENCY (Plan §7) — proven against the Firestore emulator, not mocked:
  seed stock=1, two concurrent runTransaction verifications of 1 unit each:
    final availableQty      = 0        (never -1, never 1)
    OUT ledger rows          = 1        (deterministic id => at most one)
    total applied across both = 1        (the unit issued exactly once)
    dispatch status          = 'Dispatched'
  The losing transaction retries, re-reads the now-existing deterministic ledger
  row, and returns a benign no-op (applied 0) — no throw, no oversell.

- ATOMICITY / no partial mutation (Plan §6, §19): insufficient-stock verification
  aborts the ENTIRE transaction — emulator-confirmed stock + ledger + dispatch
  status all unchanged.

- IDEMPOTENCY (Plan §8): after a successful verify, a second verify is rejected
  by the status guard (sequential) or no-ops on the deterministic ledger row
  (race) — emulator + unit confirmed, no second decrement, one ledger row.

- P1-6 (dispatch slice): deleted product, cross-company product, missing/deleted
  warehouse => rejected before any stock/ledger write (unit-confirmed).

- MULTI-COMPANY / MULTI-WAREHOUSE isolation preserved: emulator test — a
  Warehouse actor scoped to WH_A cannot decrement WH_B's stock; stock key stays
  companyId+productId+warehouseId; warehouseId not mutated. Full
  multiTenantSecurity + sensitiveCollectionsRoleEnforcement + firestoreDemoIsolation
  + rbacPhase8CumulativeSecurity emulator suites still 100% green.

- LEDGER (Plan §14): OUT row keeps every existing field (backward compatible) +
  additive groupId/sourceType/sourceId/idempotencyKey/createdBy; deterministic id;
  `stock_ledger` immutability (update/delete if false) confirmed still enforced.

- SOURCE INSPECTION (Plan §20): the only production stock-write sites are
  dispatchWorkflow.ts (this phase — configured branch is the transaction; demo
  branch is guarded + demo-only) and stockWorkflow.stockIn (unchanged, its own
  transaction) and useInventory.useSaveStockEntry (unchanged, its own
  transaction). No other active dispatch-OUT path bypasses the transaction. P1-4
  (unify the writers) remains deferred to Plan Phase 05.
```

---

## TEST RESULTS (INVENTORY-01)

```
TYPECHECK:  npm run lint  -> 3 errors, ALL pre-existing (attendancePhase11/12,
            attendanceRuleEngine). ZERO in any INVENTORY-01 file. Baseline unchanged.

BUILD:      npm run build -> SUCCESS (exit 0, ~59s). Only the pre-existing chunk-size warning.

UNIT (full): npx vitest run
            -> 254 files (225 passed | 29 failed) ; 3446 tests (3381 passed | 65 failed).
            -> IDENTICAL failure set to the INVENTORY-00 baseline: same 29 brittle
               source-string/UI-structure files, same 65 failing tests (BRAIN §35).
               Verified the failing file list is unchanged (e.g.
               projectWorkspaceDispatchIntegration.test.ts:42 — a brittle assertion on
               ProjectWorkOnThisProject.tsx, NOT on dispatchWorkflow.ts — was already
               failing in INVENTORY-00).
            -> +10 net new passing tests vs INVENTORY-00 (3436 -> 3446): the added
               INVENTORY-01 dispatchWorkflow tests + rewritten dispatchOut baseline.

UNIT (targeted): npx vitest run src/lib/inventory/ dispatchWorkflow.test.ts
            stockWorkflow.test.ts orderWorkflow.test.ts procurement/services/
            projectWorkspaceDispatchIntegration.test.ts
            -> 12 passed | 1 failed (13 files) ; 101 passed | 1 failed (102).
               The 1 failure = projectWorkspaceDispatchIntegration.test.ts:42 (pre-existing
               brittle assertion, in the documented 29). Every inventory/dispatch/stock/
               procurement test passes.

FIRESTORE / EMULATOR:  PASS — full suite, 3 batches (rules changed => mandatory).
            Batch A: dispatchStockOutTransaction + stockAdjustTransaction + stockRoleMatrix
                     -> 3 files / 37 tests, 100%.
            Batch B: multiTenantSecurity + sensitiveCollectionsRoleEnforcement +
                     firestoreDemoIsolation + rbacPhase8CumulativeSecurity
                     -> 4 files / 417 tests, 100%.
            Batch C: groupAdminFullGroupAccess, settingsPersonalOwnershipBackfillFix,
                     rolesSystemRolePermissionEditFix, missingIsSuperAdminFieldFix,
                     phase8GroupPerformance, attendanceRules, biometricFaceReferences,
                     leadCreationProjectionWrites -> 8 files / 154 tests, 100%.
            Total: 15 files / 608 tests, 100% green.
            NOTE: a single run of 5 heavy suites together produced 1 flaky failure
            once (BRAIN §2.1 documents full-cold-run flakiness); every batched run
            = 100%. E7 (1000-expression budget): no regression — stockAdjustTransaction
            (the near-cap 2-doc txn) and stockRoleMatrix both green after the
            stock_ledger read-rule change.

MANUAL VERIFICATION (Plan §23 item 7): NOT performed — the project owner deferred
            running the app / all git operations to a later batched step. The
            emulator concurrency + atomicity + idempotency tests exercise the real
            Firestore transaction semantics that manual clicking could only
            approximate. Flagged for the later manual pass.
```

---

## WHAT WAS CHANGED (INVENTORY-02 — Inventory Write Boundary / REST API read-only)

```
API SOURCE (5 files — all under api/; NO firestore.rules, NO src/, NO SDK stock-writer, NO UI):
  api/_lib/registry.ts
    - EntityConfig gains `readOnly?: boolean`.
    - `stock` marked `readOnly: true`.
    - `stock_ledger` NEWLY REGISTERED as `{ collection:'stock_ledger', module:'stock',
      searchFields:[...], readOnly:true }` — GET only; every write -> 405. (Previously
      unregistered -> `POST /api/stock_ledger` returned 400 "Unknown entity"; now a
      consistent, intentional 405 and a read path for dashboards/reports.)
    - new export `isRestWriteBlocked(entityName, method)` — the single authoritative
      "is this REST write blocked" predicate (POST/PUT/PATCH/DELETE x readOnly entity).
  api/_lib/response.ts
    - new `sendMethodNotAllowed(res, message)` (405, code 'METHOD_NOT_ALLOWED').
  api/[entity].ts  (list / create entry point)
    - after entity resolution, before auth: `if (isRestWriteBlocked(entityName, req.method))
      -> 405`. Defense in depth: `handleCreate` also refuses `config.readOnly === true`.
  api/[entity]/[id].ts  (get / update / delete entry point)
    - same entry-point guard; `handleUpdate` and `handleDelete` also refuse
      `config.readOnly === true` (defense in depth).
  api/index.ts  (catalogue)
    - `stock_ledger` added to `supported_entities`; new `read_only_entities` field derived
      from the registry so the API's self-doc is honest about the boundary.

TESTS:
  api/__tests__/apiInventoryWriteBoundary.test.ts — NEW (18 tests):
    registry + isRestWriteBlocked pure coverage; stock POST/PUT/PATCH/DELETE -> 405 with
    ZERO Firestore write (Admin-SDK boundary spied); stock_ledger POST/PUT/DELETE -> 405
    zero write; GET /api/stock + /api/stock/:id + /api/stock_ledger still reach the read
    path; regression — PUT /api/orders, POST /api/quotations, DELETE /api/dispatch are NOT
    blocked; handleUpdate() called directly with a read-only config -> 405.

BEHAVIOUR DELTA: exactly one — the generic REST API no longer performs any write to
`stock` or `stock_ledger`. Reads unchanged. All other entities unchanged. No Admin-SDK
generic mutation path to inventory remains (verified by post-implementation grep).
```

---

## WHAT WAS VERIFIED (INVENTORY-02)

```
- CALLER AUDIT (Plan §4 / §17): NO internal `POST|PUT|DELETE /api/stock` or
  `/api/stock_ledger` caller exists.
    * The SPA writes Firestore DIRECTLY via the SDK (BRAIN §1.1) — the only `api/` calls
      from src/ are the biometrics face-attendance endpoints (useFaceAttendance /
      useFaceEnrollment) + aiService (AI Intelligence). None touch stock.
    * `src/lib/entityRegistry.ts` is a SEPARATE client-side relationship registry (no HTTP).
    * `scripts/backfill-*.cjs` / `scripts/audit-indexes.cjs` reference stock/stock_ledger but
      use the Admin SDK directly (maintenance scripts), NOT the REST API.
    * No generic REST API client wrapper exists anywhere in src/.
  => "No internal POST/PUT/DELETE /api/stock caller found." Nothing migrated. Nothing broken.

- HTTP BEHAVIOUR (test-verified against the real handlers with a spied Admin-SDK boundary):
    GET  /api/stock              -> reaches handleList (NOT 405); auth + requirePermission('view','stock') run
    GET  /api/stock/:id          -> reaches handleGetById (NOT 405)
    GET  /api/stock_ledger       -> reaches handleList (NOT 405)
    POST /api/stock              -> 405, verifyAuthToken NOT called, zero Firestore write
    PUT  /api/stock/:id          -> 405, zero write  (primary P0-2 regression — E4)
    PATCH /api/stock/:id         -> 405, zero write
    DELETE /api/stock/:id        -> 405, zero write
    POST /api/stock_ledger       -> 405, zero write
    PUT  /api/stock_ledger/:id   -> 405, zero write
    DELETE /api/stock_ledger/:id -> 405, zero write

- FIELD PROTECTION (Plan §13): the rejection is method-level on the WHOLE entity — a PUT
  attempting to change availableQty / reservedQty / warehouseId / productId / companyId is
  405'd identically; no field slips through.

- LEDGER FABRICATION (Plan §14): POST /api/stock_ledger with arbitrary type/qty/beforeQty/
  afterQty/sourceId/referenceId -> 405, no ledger doc created.

- OTHER ENTITIES UNCHANGED (Plan §16): PUT /api/orders, POST /api/quotations,
  DELETE /api/dispatch reach their real handlers (auth + requirePermission run) — NOT the
  inventory 405. Full API suite (11 files / 303 tests) green, incl. api.test.ts +
  apiMassAssignment.test.ts unchanged.

- LEGITIMATE SPA WORKFLOWS (Plan §18): unaffected — INVENTORY-02 changes nothing in
  stockWorkflow / useInventory / dispatchWorkflow / goodsReceiptWorkflow / firestore.rules.
  Their unit + emulator tests are unchanged (dispatchStockOutTransaction + stockRoleMatrix +
  stockAdjustTransaction + multiTenantSecurity re-run: 4 files / 315 tests, 100%).

- ISOLATION (Plan §19): unchanged — INVENTORY-02 does not touch the API's read-path company
  scoping (`handleList`/`handleGetById` still filter by `companyId` unless super-admin) nor
  firestore.rules. No new API authorization model.

- SOURCE RE-INSPECTION (Plan §24): the only Admin-SDK write verbs in the generic handlers
  (`.create` / `.add` / `.update`) are inside handleCreate/handleUpdate/handleDelete, each
  now guarded by `config.readOnly` AND unreachable for a read-only entity because the
  entry-point `isRestWriteBlocked` check returns 405 first. `config.collection` is always
  taken from the registry, never the URL. No other api/ file writes stock/stock_ledger.
  `api/demo-reset.ts` is a purpose-built, auth-gated whole-demo-dataset reset — not a
  generic per-record mutation path — and is out of scope for P0-2.
```

---

## TEST RESULTS (INVENTORY-02)

```
TYPECHECK:  npm run lint (tsc --noEmit; tsconfig `include` covers `api`)
            -> 3 errors, ALL pre-existing (attendancePhase11/12, attendanceRuleEngine).
               ZERO in any api/ or INVENTORY-02 file.

BUILD:      npm run build -> SUCCESS (exit 0, ~59s). Pre-existing chunk-size warning only.

UNIT (src): npx vitest run
            -> 254 files (225 | 29) ; 3446 tests (3381 | 65). IDENTICAL to the INVENTORY-01
               baseline (INVENTORY-02 changed only api/, which the src `include` glob
               excludes). No src regression.

API SUITE:  npx vitest run --config vitest.api.config.ts
            -> 11 files / 303 tests, 100% PASS.
               (+1 file / +18 tests vs INVENTORY-01: apiInventoryWriteBoundary.test.ts.
                api.test.ts + apiMassAssignment.test.ts + biometrics API tests all unchanged.)

FIRESTORE / EMULATOR:  no firestore.rules / src change this phase, so the INVENTORY-01
            full result (15 files / 608 tests, 100%) stands. Spot re-check this session:
            dispatchStockOutTransaction + stockRoleMatrix + stockAdjustTransaction +
            multiTenantSecurity -> 4 files / 315 tests, 100% green.
```

---

## WHAT WAS CHANGED (INVENTORY-03 — Procurement Role + GRN Integrity)

```
PRODUCTION SOURCE (4 files):
  src/features/procurement/services/goodsReceiptWorkflow.ts   — createGoodsReceipt rewritten:
    * configured branch: ONE runTransaction over stock + stock_ledger + purchase_orders
      (all received lines). Reads PO in-txn, re-validates Σ received ≤ ordered per line
      (INV-13) → over-receipt aborts the WHOLE txn (spec C: no partial mutation). Increments
      items[].receivedQty (never a stale client array). Deterministic per-line ledger id
      grnReceiptLedgerId(poId,lineIndex,receivedBefore,qty) = STKIN-GRN-{enc(po)}-L{i}-B{b}-Q{q};
      an existing row => that line is a no-op (P1-1). PO doc contention serializes concurrent
      receipts → Σ received can never pass ordered (P1-2). New exports: grnReceiptLedgerId,
      grnReceiptIdempotencyKey, goodsReceiptDeterministicId.
    * GRN doc: deterministic id GRN-{enc(po)}-{djb2(lines)}; written via createDocWithId AFTER
      the atomic txn (overwrite-safe).
    * reconcileMissingGrnDocs(): on entry, rebuild any GRN doc whose atomic txn committed but
      whose doc write failed, from the reliable stock_ledger rows (J12 — no GRN-less stock,
      no permanent inconsistency). requestMatchesCompletedGrn(): a retry whose client PO
      snapshot is stale (line already fully received) returns the completed GRN instead of
      throwing.
    * demo branch (!firebaseEnv.isConfigured): same guards, sequential, GRN-doc-last marker.
    * NO call to stockWorkflow.stockIn anymore (was: non-idempotent, random GRN id in sourceId).
  src/features/procurement/services/purchaseOrderWorkflow.ts   — PURCHASE_ORDER_TRANSITIONS
    is now THE one authoritative PO state machine + doc comment naming its 3 consumers.
    PartiallyReceived gains a 'PartiallyReceived' self-transition (a further partial receipt
    that still leaves qty outstanding).
  src/engines/ProcurementValidationEngine.ts   — VALID_PO_TRANSITIONS is now
    `= PURCHASE_ORDER_TRANSITIONS` (imported). The engine only needs "is this a known status?"
    (all 5 keys present); no behavior change to validate/repair.
  src/features/procurement/types/index.ts   — GoodsReceiptRecord.stockApplied?: string[] (additive).

FIRESTORE RULES (firestore.rules — 2 changes, both stock/purchase_orders only):
  1. match /stock update field-guard: the availableQty/reservedQty role list is now ONE
     actorRoleMatches('.*Warehouse.*|.*Operations.*|.*Procurement.*|Admin|GroupAdmin') call
     (was three: .*Warehouse.*, .*Operations.*, Admin|GroupAdmin). Adds Procurement (P1-3);
     Sales/Accounts/Manager stay DENIED (least privilege). Collapsing 3→1 also LOWERS cost (E7).
  2. match /purchase_orders update: canUpdateCompanyScoped() (sameCompany()x2 identity-chain
     re-entry) replaced by the LEAN discriminator
     (isOwnerIdentity() || actorIsSuperAdmin() || tenantWriteCanUpdate(resource.data) || groupAdminCanUpdate(...))
     — the established employees/payroll/payments pattern. REQUIRED so the GRN's 3-collection
     stock+ledger+PO transaction stays under the 1000-expression budget. Same security
     property (same-company + group-active + companyId immutable), lower cost.
  3. validPurchaseOrderTransition(): PartiallyReceived → to in ['PartiallyReceived','Received','Cancelled']
     (added the self-transition; mirrors the TS PURCHASE_ORDER_TRANSITIONS).
  NO other rules block touched. storage.rules: NOT changed (no identity helper changed).

FIRESTORE INDEXES (firestore.indexes.json — 2 additive composite indexes):
  stock_ledger  (companyId ASC, purchaseOrderId ASC)   — reconcileMissingGrnDocs ledger scan
  goods_receipts (companyId ASC, purchaseOrderId ASC)  — prior-receipt lookup + reconciliation

TESTS:
  src/lib/__tests__/grnReceiptTransaction.emulator.test.ts   — NEW. 16 tests (J6/J7/J8/J9/J10x3/
    J11/J12/E3x2/C7/N1/N5 + PartiallyReceived self-transition + Draft-PO reject). Replicates the
    EXACT configured-branch transaction shape (like dispatchStockOutTransaction.emulator.test.ts).
  src/lib/__tests__/stockRoleMatrix.emulator.test.ts   — Procurement OP-2 expectation flipped
    ALLOW (was DENY in the INVENTORY-00 baseline — P1-3 resolution); docstring + final assertions
    updated (Sales/Accounts/Manager still asserted DENY).
  src/features/procurement/services/goodsReceiptWorkflow.test.ts   — REWRITTEN for the fixed
    demo-branch behavior (deterministic ids, incremental receivedQty, over-receipt reject,
    double-submit idempotency). 10 tests.
  src/lib/inventory/__tests__/baseline/grn.baseline.test.ts   — REWRITTEN to characterize the
    FIXED behavior (P1-1/P1-2/P1-5 resolved). 4 tests. Commit note: expectations intentionally changed.
  src/features/procurement/services/purchaseOrderWorkflow.test.ts   — PartiallyReceived table
    row updated; +1 "one shared table" assertion.
  vitest.emulator.config.ts   — +1 line registering grnReceiptTransaction.emulator.test.ts.

NO changes to: dispatchWorkflow, stockWorkflow.stockIn internals, useInventory, Orders/order
lifecycle, reservation/onHandQty/reservedQty, movement engine (none), api/, mobile business
logic, any other firestore.rules block. UI: goodsReceiptWorkflow signature unchanged — NO
GoodsReceipts.tsx / MobileGoodsReceiptWorkspace.tsx / GoodsReceiptForm.tsx change needed.
```

---

## WHAT WAS VERIFIED (INVENTORY-03)

```
- P1-3 REPRODUCED then RESOLVED: INVENTORY-00's stockRoleMatrix confirmed the pre-existing
  field guard DENIED Procurement OP-2 (update availableQty on an existing summary). INVENTORY-03
  adds Procurement to the guard; grnReceiptTransaction.emulator J11 proves a Procurement-role
  GRN into an EXISTING summary (seeded availableQty 25) succeeds → 35. stockRoleMatrix re-run:
  Procurement ALLOW on all 3 ops; Sales/Accounts/Manager still DENY on OP-2 (least privilege kept).

- GRN IDEMPOTENCY (P1-1 / J9) — emulator: submit the identical receipt twice against the same
  PO snapshot → deterministic GRN id + deterministic ledger id → the 2nd call is a no-op.
  One stock IN, one ledger row, one GRN doc, receivedQty incremented once.

- CONCURRENCY (P1-2 / INV-13 / J10) — emulator, real Firestore transaction semantics:
    ordered 10, two concurrent receipts:
      6 + 6  -> final receivedQty 6, stock +6, one ledger row (the loser no-ops on the shared key)
      4 + 6  -> final receivedQty EXACTLY 10, stock +10, two ledger rows, PO 'Received'
      7 + 6  -> exactly one is REJECTED; stock reflects only the accepted qty (single atomic
               stock+ledger+PO txn — the loser's transaction aborts entirely, NO stranded stock)
    Σ received ≤ ordered holds in every interleaving.

- ATOMICITY (P1-5 / spec C) — emulator: a sequential over-receipt (received 8, receive 3 vs
  ordered 10) is rejected INSIDE the transaction; stock, ledger and PO all unchanged. Zero
  partial mutation.

- PARTIAL FAILURE / RESUMABILITY (J12) — emulator: after a successful receipt the GRN doc is
  deleted (simulating a post-transaction doc-write failure); stock + PO stay consistent
  (atomic); a retry of the identical receipt reconciles the GRN doc from the ledger rows and
  applies NO further stock (still +4, one ledger row).

- PO STATE MACHINE (P2-4 / J4 / J5): one shared PURCHASE_ORDER_TRANSITIONS consumed by
  purchaseOrderWorkflow.transitionPurchaseOrder, imported by ProcurementValidationEngine, and
  mirrored (with a cross-reference comment) by firestore.rules validPurchaseOrderTransition.
  updatePurchaseOrder still rejects edits once status != 'Draft' (J5). The
  PartiallyReceived→PartiallyReceived self-transition (needed for a 2nd partial receipt on a
  multi-line PO) is emulator-verified allowed by the rules.

- SECURITY (N1–N10) — full emulator suite, batched, 16 files / 623 tests, 100%:
    N1 cross-company GRN receipt denied; N2 warehouse scoping (sameWarehouse) unchanged;
    N3 Sales/Accounts stock write denied (E3); N4 REST 405 unchanged (INVENTORY-02);
    N5 goods_receipts + stock_ledger update/delete denied (`if false`); N6 GroupAdmin group
    read unchanged; N7 groupIsActive gate unchanged; N8 storage.rules — no identity helper
    changed, nothing to mirror; N9 100% green (3 batches); N10 NO 1000-expression failure on
    any touched block. C7 forged cross-company warehouseId on a GRN write → denied
    (warehouseBelongsToCompany).

- E7 BUDGET: the GRN transaction touches 3 collections (stock + stock_ledger + purchase_orders).
  The `purchase_orders` update rule was made lean expressly for this. stockAdjustTransaction
  (the near-cap 2-doc txn) + dispatchStockOutTransaction + stockRoleMatrix all re-run green.
  No "maximum expressions" error anywhere in the batched suite.

- SOURCE INSPECTION: goodsReceiptWorkflow no longer calls stockWorkflow.stockIn. The only
  production stock-summary writers remain stockIn (unchanged), useInventory.useSaveStockEntry
  (unchanged), dispatchWorkflow (INVENTORY-01) and now goodsReceiptWorkflow.applyGrnReceipt.
  P1-4 (unify the writers into one engine) stays deferred to Plan Phase 05.

- MANUAL BUSINESS VERIFICATION: NOT performed — deferred with the owner's git/deploy step
  (same as INVENTORY-01/-02). The emulator concurrency + atomicity + idempotency + resume
  tests exercise the real transaction semantics a manual click could only approximate.
  NOTE for the manual/deploy pass: the 2 new composite indexes MUST be deployed together with
  the rules (`firebase deploy --only firestore:indexes,firestore:rules`) or reconcileMissingGrnDocs'
  queries fail until the indexes build.
```

---

## TEST RESULTS (INVENTORY-03)

```
TYPECHECK:  npm run lint (tsc --noEmit)
            -> 3 errors, ALL pre-existing (attendancePhase11/12, attendanceRuleEngine).
               ZERO in any INVENTORY-03 file. Baseline unchanged.

BUILD:      npm run build -> SUCCESS (exit 0, ~59-105s). Only the pre-existing chunk-size warning.

UNIT (full): npx vitest run
            -> 254 files (225 passed | 29 failed) ; 3451 tests (3386 passed | 65 failed).
            -> IDENTICAL failure set to the INVENTORY-02 baseline: the same 29 brittle
               source-string / UI-structure files, same 65 failing tests (BRAIN §35).
            -> +5 net new passing vs INVENTORY-02 (3446 -> 3451): the new goodsReceiptWorkflow
               + purchaseOrderWorkflow + rewritten grn.baseline tests.

UNIT (targeted): npx vitest run src/features/procurement src/lib/inventory src/engines
            src/lib/__tests__/stockWorkflow.test.ts src/lib/__tests__/dispatchWorkflow.test.ts
            src/lib/__tests__/orderWorkflow.test.ts
            -> 14 files / 94 tests, 100% pass.

FIRESTORE / EMULATOR:  PASS — full suite, 3 batches (rules changed => mandatory).
            Batch A+B: grnReceiptTransaction + stockRoleMatrix + stockAdjustTransaction +
                       dispatchStockOutTransaction + sensitiveCollectionsRoleEnforcement +
                       multiTenantSecurity -> 6 files / 446 tests, 100%.
            Batch C:  firestoreDemoIsolation, rbacPhase8CumulativeSecurity,
                      groupAdminFullGroupAccess, settingsPersonalOwnershipBackfillFix,
                      rolesSystemRolePermissionEditFix, missingIsSuperAdminFieldFix,
                      phase8GroupPerformance, attendanceRules, biometricFaceReferences,
                      leadCreationProjectionWrites -> 10 files / 177 tests, 100%.
            Total: 16 files / 623 tests, 100% green. E7 budget: no regression.
            (grnReceiptTransaction.emulator.test.ts: 16/16 in isolation, re-verified.)

API SUITE:  npx vitest run --config vitest.api.config.ts -> 11 files / 303 tests, 100%
            (api/ untouched; E4/E5/N4 REST stock 405 boundary intact).
```

---

## WHAT WAS CHANGED (INVENTORY-04 — Order & PO Lifecycle Locks)

```
PRODUCTION SOURCE (5 files):
  src/lib/orderWorkflow.ts     — NEW exports:
      * isOrderLineLocked(order)  — Σ items[].dispatchedQty > 0 OR status ∈
        LOCKED_ORDER_STATUSES ['Partial Dispatch','Dispatched','Closed','Cancelled'].
        Shared predicate, reusable by workflow + UI.
      * updateOrder(id, patch)    — the authoritative order-update path. Re-reads the
        order; if `patch` carries `items` AND the order is locked AND the line
        signature (productId|product|qty|price|tax|discount|unit per line) changed
        -> throws. Non-line patches (no `items` key, or identical line content)
        pass through to updateDocById.
  src/pages/Orders.tsx          — edit branch: updateDocById(ORDERS,...) -> updateOrder(editId, payload).
  src/components/mobile/orders/MobileOrderWorkspace.tsx — edit branch: same rewire
      (WIRING ONLY — no mobile business logic; the shared workflow enforces the lock).
  src/lib/invoiceWorkflow.ts    — generatePIsFromOrder(order, options?={force?}) — re-reads
      the authoritative order; rejects if piGenerated && generatedPIs.length && !force.
      Money math / numbering / GST / dual-entity split UNCHANGED.
  src/lib/quotationWorkflow.ts  — convertQuotationToOrder(quote): fast idempotent
      short-circuit on quote.convertedOrderId; then the lock-check + order create +
      quotation mark + project patch run in ONE runTransaction (configured branch)
      that RE-READS quoteRef.convertedOrderId. Demo branch: sequential + best-effort
      re-read. Post-commit side effects (log/notify/caseId) only when WE created the
      order. companyId + groupId now explicitly stamped on the order doc (raw txn -> HR-9).
      Engineering items (productId:'') preserved verbatim — NO product-existence check added.
  src/lib/stockWorkflow.ts      — cancelOrder: the order-status write + every affected
      dispatch-status write now run in ONE runTransaction (configured) that re-reads
      each doc (precondition: order not already 'Cancelled' -> abort). Demo branch:
      sequential. Additive order fields: piReversalRequired + reversalInvoiceIds[]
      (from order.generatedPIs + proforma_invoices/tax_invoices by orderId/sourceOrderId
      -- INFORMATION ONLY, no financial reversal). STOCK RESTORE PATH UNCHANGED (still
      the sequential stockIn calls + CANCEL: idempotency key -> migrates to the engine
      in Plan Phase 05d, NOT here).

FIRESTORE RULES: NONE. FIRESTORE INDEXES: NONE. storage.rules: NONE.
  The `orders` API PUT still bypasses the workflow line-lock -> documented known gap
  (it was already possible; not a regression). A dedicated `orders` rules block is a
  larger rules-consolidation change, deferred (Plan INVENTORY-04 §701 decision).

TESTS:
  src/lib/__tests__/orderWorkflow.test.ts        — +11 (isOrderLineLocked + updateOrder: 1-7 + edge cases).
  src/lib/__tests__/stockWorkflow.test.ts        — +4 (cancel 8 status flip, 10 reversal info, no-flag case).
  src/lib/__tests__/invoiceWorkflow.test.ts      — +2 (11-12 repeat guard; force bypass).
  src/lib/__tests__/quotationWorkflow.test.ts    — +3 (13/16 normal + eng item; 14/15 convertedOrderId short-circuit + demo re-read).
  src/lib/__tests__/orderLifecycleTransaction.emulator.test.ts — NEW (5): P2-8 concurrent
      conversion -> one order same id; engineering item survives; P2-2 cancel flips
      order+dispatches in one txn; precondition failure aborts with no partial write.
  vitest.emulator.config.ts     — +1 line registering the new emulator test.
  src/lib/inventory/__tests__/baseline/cancelOrder.baseline.test.ts — UNCHANGED, still green.

NOT changed: GRN / applyGrnReceipt / dispatch OUT internals / stockIn quantity logic /
  reservation (none) / movement engine (none) / firestore.rules / Products/Categories/
  Warehouses / PI money math / GST / invoice numbering / quotation pricing / payment
  workflow. No new collection. No migration/backfill.
```

---

## TEST RESULTS (INVENTORY-04)

```
TYPECHECK:  npm run lint (tsc --noEmit) -> 3 errors, ALL pre-existing (attendancePhase11/12,
            attendanceRuleEngine). ZERO in any INVENTORY-04 file.
BUILD:      npm run build -> SUCCESS (exit 0, ~4m). Pre-existing chunk-size warning only.
UNIT (full): npx vitest run -> 254 files (225 passed | 29 failed) ; 3470 tests
            (3405 passed | 65 failed). SAME 29-file / 65-test brittle baseline as
            INVENTORY-03 (BRAIN §35). No Phase-04 file failing. +~19 net new passing.
UNIT (focused Phase-04):
            orderWorkflow.test.ts        14/14
            stockWorkflow.test.ts        6/6  (incl. cancelOrder + baseline behaviour)
            invoiceWorkflow.test.ts      5/5
            quotationWorkflow.test.ts    20/20
            cancelOrder.baseline.test.ts green (unchanged)
            dispatchWorkflow.test.ts + orderTypeBackfill.test.ts green
FIRESTORE / EMULATOR:
            NO firestore.rules / firestore.indexes change this phase -> the INVENTORY-03
            emulator surface (16 files / 624 tests, 100%, re-verified in the -03 acceptance
            audit) STANDS. NEW: orderLifecycleTransaction.emulator.test.ts -> 5/5
            (convert-race one-order-same-id; cancel-atomicity + precondition abort).
MANUAL SMOKE: NOT performed in a running app — deferred with the owner's manual/deploy
            pass (same as -01/-02/-03). The emulator transaction tests exercise the real
            Firestore concurrency/atomicity semantics a manual click could only approximate.
```

---

## WHAT WAS CHANGED (INVENTORY-05a — Stock Movement Engine + Adapter, DORMANT)

```
NEW MODULE (3 files, DEAD CODE — no production caller):
  src/lib/inventory/types.ts
      MovementType union (12 types, FROZEN at Phase 05 — Plan §8): PURCHASE_RECEIPT,
      OPENING_STOCK, ADJUSTMENT_IN, ADJUSTMENT_OUT, DAMAGE_OUT, SALES_RESERVE,
      SALES_RELEASE, DISPATCH_OUT, SALES_RETURN_IN, TRANSFER_OUT, TRANSFER_IN,
      RECONCILE_ADJUST. MOVEMENT_DIRECTION map (IN/OUT/RESERVE/RELEASE),
      MOVEMENT_TYPES[], REASON_CODE_REQUIRED[] (ADJUSTMENT_IN/OUT, DAMAGE_OUT,
      RECONCILE_ADJUST). StockMovementInput + MovementResult interfaces. NO Firestore
      access, NO callers.
  src/lib/inventory/idempotency.ts
      buildIdempotencyKey(movementType, sourceType, sourceId, lineKey?) ->
      `{movementType}:{sourceType}:{sourceId}[:{lineKey}]` (Plan §5).
      movementLedgerId(key) -> `STKMV-{encodeURIComponent(key)}` — an INJECTIVE map, so
      "no two ledger rows share an idempotencyKey" (INV-8) holds BY CONSTRUCTION.
  src/lib/inventory/stockMovementEngine.ts
      applyStockMovement(input): Promise<MovementResult> (Plan §4.1 / §9 / §10).
      * prepare(): resolves companyId (resolveWorkflowCompanyId) + groupId
        (resolveWriteGroupId) + actorId; validates qty finite & > 0 (a signed qty is
        allowed ONLY for RECONCILE_ADJUST); requires reasonCode for the REASON_CODE_REQUIRED
        types; computes idempotencyKey + ledgerId = movementLedgerId(key).
      * canonical stock summary id = stockSummaryId(companyId, productId, warehouseId)
        = `SUM-{enc(companyId)}-{enc(productId)}-{enc(warehouseId)}` (Plan §8), then
        resolveStockSummaryDocumentId() reconciles against any legacy-id match.
      * CONFIGURED branch: query the summary id outside the txn (>1 active match -> throw
        "Duplicate stock summaries"), then ONE runTransaction:
          transaction.get(ledgerRef) -> exists -> return { applied:false, ...existing row }
                                                  (IN-TXN idempotency check — Plan §5).
          transaction.get(stockRef);
          onHandBefore = existing.onHandQty ?? existing.availableQty ?? existing.available ?? 0;
          applyDelta(direction, onHandBefore, reservedBefore, |qty|);
          assertInvariants(): onHandAfter < -EPSILON -> throw "Insufficient stock" (INV-1);
                              reservedAfter < -EPSILON -> throw (INV-2);
                              INV-3/INV-4 (reserved <= onHand, available == onHand - reserved)
                              gated behind prep.reservationsEnabled (FALSE for Phase 05-06).
          deriveAvailable() = reservationsEnabled ? onHandAfter - reservedAfter : onHandAfter.
          transaction.set(stockRef, { ...companyId, groupId, productId, warehouseId,
              onHandQty, reservedQty, availableQty, updatedAt, ... });
          transaction.set(ledgerRef, buildLedgerRow(...)).
        The stock summary write + the ledger write commit together or not at all (INV-7:
        one movement = one ledger row = one summary delta).
      * DEMO branch (!firebaseEnv.isConfigured): the same guards, sequential
        getOne / createDocWithId (unchanged risk class, demo-only).
      * buildLedgerRow(): UNIFIED schema (movementType, direction, qty, onHandBefore/After,
        reservedBefore/After, idempotencyKey, actorId, transactionId, movementAt, createdAt,
        createdBy, isDeleted) PLUS legacy dual-write (type: 'IN'|'OUT' from direction,
        referenceType: sourceType, referenceId: sourceId, date) so existing readers keep working.
      * companyId + groupId manually stamped on BOTH docs (raw runTransaction bypasses
        auto-stamping — HR-9).
      * NO logActivity / notifyUsers in the engine — callers add those on migration (05b-05d).
      * EPSILON = 1e-6 for the invariant float comparisons.

  stockSummaryId CONSOLIDATION (Plan §11):
    src/features/inventory/hooks/useInventory.ts — DELETED its local
      `function stockSummaryId(companyId, productId, warehouseId)` (was byte-identical to
      the one in src/lib/workflow.ts); now imports it from '../../../lib/workflow'.
      stockSummaryKey / canonicalizeStockSummary now use the imported function. Output is
      byte-identical for every input (tested, incl. values needing encodeURIComponent).

TESTS:
  src/lib/inventory/__tests__/stockMovementEngine.test.ts — NEW (15): IN/OUT deltas;
    INV-1 rejection (OUT below zero); zero / non-finite qty rejected; reasonCode required;
    Phase-05 model (reservedQty stays 0, availableQty == onHandQty across a run); every
    movement type's direction; idempotency (twice -> one effect, 2nd { applied:false });
    deterministic injective ledger id; explicit idempotencyKey override; companyId/groupId
    stamped on both docs; explicit companyId override; legacy dual-write fields present.
    PLUS a `stockSummaryId consolidation` block asserting useInventory.ts imports the shared
    function, has no local copy, and produces identical output to the old local formula.
  src/lib/inventory/__tests__/stockMovementEngine.emulator.test.ts — NEW (8): the engine's
    configured-branch txn shape replicated in movementTxn(); Warehouse IN passes CURRENT
    rules + summary/ledger atomic; OUT decrements, availableQty tracks onHandQty; idempotent
    twice; INV-1 OUT-below-zero aborts with NO partial write; cross-company DENIED; Sales-role
    DENIED on an existing-summary change (P1-3 least privilege); forged cross-company
    warehouseId DENIED; ledger row immutable (assertFails on overwrite).
  vitest.config.ts — exclude list broadened: `src/**/*.emulator.test.ts` (so the new
    emulator test under src/lib/inventory/__tests__/ is excluded from the default vitest run).
  vitest.emulator.config.ts — +1 line registering stockMovementEngine.emulator.test.ts.

NO caller migrated. NO firestore.rules / firestore.indexes / storage.rules change. NO
schema write to production (the additive fields land only WHEN the engine is first called,
in 05b). NO mobile change (Plan §13 — no separate mobile movement engine). NO change to
goodsReceiptWorkflow / dispatchWorkflow / stockWorkflow.stockIn / cancelOrder / useSaveStockEntry.
```

---

## WHAT WAS VERIFIED (INVENTORY-05a)

```
- ENGINE IS DORMANT: grep across src/ finds NO `import ... stockMovementEngine`, NO
  `applyStockMovement(` outside the engine's own two test files. The four legacy stock
  writers (stockIn, useSaveStockEntry, dispatchWorkflow, goodsReceiptWorkflow.applyGrnReceipt)
  are UNCHANGED — confirmed by grep + by their unchanged unit/emulator tests.

- NO FIRESTORE RULES BLOCKER (Plan §10): the engine's write shape (stock summary set with
  companyId/groupId/productId/warehouseId/onHandQty/reservedQty/availableQty; stock_ledger
  create with transactionId:string, movementAt != null, referenceType/referenceId, the
  warehouseBelongsToCompany + sameWarehouse FK checks) passes the CURRENT `stock` /
  `stock_ledger` rules (as set by INVENTORY-03) UNCHANGED. Proven by
  stockMovementEngine.emulator.test.ts test 1 (Warehouse IN) + test 2 (OUT). => NO rules
  weakening needed, NO blocker to report.

- ATOMICITY (INV-7): emulator test 4 — an INV-1-violating OUT aborts the whole runTransaction;
  stock summary AND ledger both unchanged (no partial write).

- IDEMPOTENCY (INV-8, Plan §5): the idempotency check is INSIDE the transaction
  (transaction.get(ledgerRef) before any write). Emulator test 3 + unit test — the same
  movement applied twice produces ONE summary delta + ONE ledger row; the 2nd call returns
  { applied:false } with the existing row. The ledger id is an injective function of the
  idempotencyKey, so INV-8 also holds structurally.

- QUANTITY MODEL (Plan §6): across a multi-movement unit run, reservedQty stays 0 and
  availableQty == onHandQty at every step (reservationsEnabled is FALSE — Phase 07 flips it).
  An OUT can never drive onHandQty below 0 (INV-1 throw).

- TENANT + WAREHOUSE SAFETY: emulator tests 5/6/7 — a cross-company actor, a Sales-role
  actor changing an existing summary, and a forged cross-company warehouseId are ALL denied
  by the existing rules. companyId + groupId are stamped on both docs.

- LEDGER COMPATIBILITY (Plan §9): buildLedgerRow writes the unified schema AND the legacy
  fields (type, referenceType, referenceId, date) so INVENTORY-01/-03 readers and any
  dashboard query keep working after a future migration.

- stockSummaryId: exactly ONE definition remains in src/ (src/lib/workflow.ts); the
  useInventory.ts local copy is gone; output is byte-identical (unit-tested with
  encodeURIComponent-sensitive inputs). resolveStockSummaryDocumentId still reconciles
  legacy ids.

- MANUAL BUSINESS VERIFICATION: N/A — the engine has no caller and no UI. Nothing to click.
```

---

## TEST RESULTS (INVENTORY-05a)

```
TYPECHECK:  npm run lint (tsc --noEmit) -> 3 errors, ALL pre-existing (attendancePhase11/12,
            attendanceRuleEngine — missing gpsAccuracyCeilingMeters /
            locationConsistencyMaxSpreadMeters on AttendanceSettings). ZERO in any
            INVENTORY-05a file. Identical to the -00..-04 baseline.
BUILD:      npm run build -> SUCCESS (exit 0). Pre-existing chunk-size warning only.
UNIT (full): npx vitest run -> 255 test files (226 passed | 29 failed) ; 3485 tests
            (3420 passed | 65 failed). SAME 29-file / 65-test brittle baseline as
            INVENTORY-04 (BRAIN §35) — no engine/inventory file among the failures.
            +1 file / +15 net new passing (stockMovementEngine.test.ts). The new emulator
            test file is excluded from the default run.
UNIT (focused): npx vitest run src/lib/inventory/
            -> stockMovementEngine.test.ts 15/15; the -00 baseline/*.baseline.test.ts +
               INVENTORY_INVARIANTS still green.
FIRESTORE / EMULATOR:
            NO firestore.rules / firestore.indexes change this phase -> the INVENTORY-03
            emulator surface (16 files / 623-624 tests, 100%) STANDS. NEW:
            stockMovementEngine.emulator.test.ts -> 8/8 (JBR java, sub-batched per BRAIN §2.1).
            E7 budget: unaffected (no rules touched).
```

---

## KNOWN REMAINING RISKS (full register in the audit + Plan §2)

```
P0-1  Dispatch stock-OUT non-transactional -> oversell/lost update            *** INTERIM FIX DONE (INVENTORY-01) ***
      executeAndVerifyDispatch is now atomic (one runTransaction) + idempotent
      (deterministic ledger id + status guard). Emulator concurrency-proven: stock=1,
      two verifies -> stock 0, one OUT row, never negative. Canonical fix (movement
      engine) still Plan Phase 05c.
P0-2  REST API PUT /api/stock/:id mutates availableQty, no ledger/txn/rules    *** FIXED (INVENTORY-02) ***
      `stock` + `stock_ledger` are READ-ONLY over the generic REST API — every mutating
      method -> 405 before auth/DB, zero Firestore write. No internal caller was broken
      (none existed). External API-key holders can no longer alter inventory quantities.
      firestore.rules unchanged; SDK stock-writers unchanged (P1-4 still Plan Phase 05).
P0-3  No reservation layer; reservedQty dead; order.stockBlocked unread        (Plan Phase 07)
P1-1  GRN not idempotent -> duplicate stock IN on retry                         *** FIXED (INVENTORY-03) ***
      createGoodsReceipt: deterministic per-line stock_ledger id + deterministic GRN doc id.
      A retried / double-submitted / concurrent-duplicate receipt finds its row and no-ops.
      Emulator J9 proven. Canonical fix (movement engine) still Plan Phase 05b.
P1-2  Concurrent GRNs -> silent over-receipt                                    *** FIXED (INVENTORY-03) ***
      The GRN is ONE runTransaction over stock+ledger+PO; concurrent receipts contend on the
      PO doc and serialize; Σ received re-checked against the fresh in-txn PO (INV-13).
      Emulator J10: 6+6->6, 4+6->10, 7+6->one rejected, never over-receipt, no stranded stock.
P1-3  stock field guard BLOCKED Procurement from updating availableQty          *** FIXED (INVENTORY-03) ***
      on an EXISTING summary (CONFIRMED in INVENTORY-00). firestore.rules match /stock update
      field-guard role list now = ONE actorRoleMatches('.*Warehouse.*|.*Operations.*|.*Procurement.*|Admin|GroupAdmin')
      (was 3 calls). Procurement ADDED; Sales/Accounts/Manager stay DENIED (least privilege —
      per the phase instruction, NOT widened for cancel-restore). stockRoleMatrix + J11 emulator-proven.
      NB: the Accounts-can-reach-Verify-but-not-complete dispatch gap (INVENTORY-01) is UNCHANGED
      — deliberately not widened here; a privileged cancel-restore path, if ever needed, is a
      later movement-engine concern.
P1-4  Two parallel stock-write implementations, divergent ledger schemas       *** ENGINE BUILT (INVENTORY-05a); migrations 05b-05d ***
      INVENTORY-05a landed src/lib/inventory/stockMovementEngine.ts — the single future write
      chokepoint (one runTransaction over stock + stock_ledger, in-txn idempotency, unified
      ledger schema + legacy dual-write, INV-1/2/7/8 enforced). It is DORMANT — no caller
      migrated. The four legacy writers (stockIn, useSaveStockEntry, dispatchWorkflow,
      goodsReceiptWorkflow.applyGrnReceipt) are unchanged. 05b migrates GRN, 05c dispatch,
      05d manual + cancel-restore (and retires the duplicate writers). stockSummaryId is
      already de-duplicated (05a).
P1-5  Multi-doc stock ops non-atomic (dispatch, GRN)                            (dispatch: DONE INVENTORY-01; GRN: DONE INVENTORY-03; unify in 05)
P1-6  No product/warehouse existence check at order/dispatch/adjust            (dispatch: DONE INVENTORY-01; GRN slice: DONE INVENTORY-03 — product/warehouse existence + same-company check; order/adjust + broader: Plan Phase 09)
P1-7  genId random + setDoc(merge:true) -> collision silently merges           (Plan Phase 09)
P1-8  Order items editable after partial dispatch                             *** FIXED at the workflow layer (INVENTORY-04) ***
      isOrderLineLocked(order) + updateOrder(id,patch) in orderWorkflow.ts. Locked when
      Σ dispatchedQty > 0 OR status ∈ {Partial Dispatch,Dispatched,Closed,Cancelled}. A
      line (product/qty/price) change on a locked order is REJECTED at the workflow layer;
      non-line edits still allowed. Orders.tsx + MobileOrderWorkspace.tsx both call updateOrder.
      KNOWN GAP (unchanged, documented): the generic `orders` REST API PUT still bypasses
      this — no dedicated `orders` rules block this phase (deferred rules-consolidation).
P2-1  No stock<->ledger reconciliation                                         (Plan Phase 06)
P2-2  cancelOrder non-atomic; doesn't reverse PIs/tax invoices                 *** STATUS-ATOMIC + FLAGS DONE (INVENTORY-04); restore in 05d ***
      Order-status + every affected dispatch-status write now in ONE runTransaction
      (configured) re-reading each doc — emulator-proven (all flip or none). Additive
      orders.piReversalRequired + orders.reversalInvoiceIds[] record the affected PI /
      tax-invoice ids (INFO ONLY — no financial reversal). Stock restore still the
      sequential stockIn path + CANCEL: key -> migrates to the engine in Plan Phase 05d.
P2-3  Category link by name, not id                                            (Plan Phase 09)
P2-4  Three divergent PO transition tables                                     *** FIXED (INVENTORY-03) ***
      ONE PURCHASE_ORDER_TRANSITIONS (purchaseOrderWorkflow.ts) — imported by
      ProcurementValidationEngine, mirrored (comment cross-ref) by firestore.rules
      validPurchaseOrderTransition. purchaseOrderWorkflow.test.ts asserts the 5-status coverage.
P2-5  Master-data soft-delete no FK guard/cascade                              (Plan Phase 09)
P2-6  stock_ledger create not role-gated / not delta-checked                   (PARTIAL — Plan Phase 05)
      NB (INVENTORY-03): a Procurement/Warehouse/Operations/Admin/GroupAdmin GRN ledger CREATE
      is the legitimate path and is intentionally allowed (warehouseActorCanCreate + FK checks,
      not role-gated — matches INVENTORY-00 matrix OP-3). A dedicated SDK-layer role/delta gate
      on arbitrary `stock_ledger` CREATE is still Plan Phase 05 (the movement-engine chokepoint).
      REST API stock_ledger create already 405 (INVENTORY-02).
P2-7  PI generatable repeatedly                                                *** FIXED (INVENTORY-04) ***
      generatePIsFromOrder re-reads the authoritative order; a repeat is rejected unless
      {force:true}. `totalInvoiced = order.total` "simplified" billing math is UNCHANGED
      (Future Finance phase). NO money/GST/numbering change.
P2-8  Concurrent quote->order conversion race                                  *** FIXED (INVENTORY-04) ***
      convertQuotationToOrder: lock-check + order create + quotation mark in ONE
      runTransaction re-reading `convertedOrderId`. Emulator: 2 concurrent conversions ->
      exactly ONE order, both callers get the SAME id. Engineering item (productId:'')
      still converts.
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

INVENTORY-00 (commit 49123be, tests + harness only — NO production code):
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

INVENTORY-01 (COMMITTED — 1368cfd):
  MODIFIED: src/lib/dispatchWorkflow.ts        (executeAndVerifyDispatch: atomic + idempotent
            stock-OUT; +assertDispatchReferencesValid; +TERMINAL_DISPATCH_STATUSES,
            +dispatchOutLedgerId exports)
  MODIFIED: firestore.rules                    (match /stock_ledger read: +`resource == null`
            guard — minimal, established pattern; NO write-permission change)
  MODIFIED: src/lib/__tests__/dispatchWorkflow.test.ts   (COLLECTIONS/mocks updated; +7 tests)
  REWRITTEN: src/lib/inventory/__tests__/baseline/dispatchOut.baseline.test.ts  (fixed-behavior)
  ADDED:    src/lib/__tests__/dispatchStockOutTransaction.emulator.test.ts  (8 tests, concurrency)
  MODIFIED: vitest.emulator.config.ts          (+1 line, register the new emulator test)
  MODIFIED: INVENTORY_IMPLEMENTATION_STATE.md  (this update)

  PRODUCTION SOURCE FILES MODIFIED BY INVENTORY-01: src/lib/dispatchWorkflow.ts (1).
  FIRESTORE RULES: firestore.rules — 1 minimal read-guard change on match /stock_ledger.

INVENTORY-02 (COMMITTED — 58038f4):
  MODIFIED: api/_lib/registry.ts        (+readOnly flag; stock readOnly; +stock_ledger entry;
            +isRestWriteBlocked export)
  MODIFIED: api/_lib/response.ts        (+sendMethodNotAllowed)
  MODIFIED: api/[entity].ts             (entry-point 405 guard; handleCreate defense-in-depth)
  MODIFIED: api/[entity]/[id].ts        (entry-point 405 guard; handleUpdate/handleDelete
            defense-in-depth)
  MODIFIED: api/index.ts                (catalogue: +stock_ledger, +read_only_entities)
  ADDED:    api/__tests__/apiInventoryWriteBoundary.test.ts   (18 tests)
  MODIFIED: INVENTORY_IMPLEMENTATION_STATE.md + INVENTORY_REGRESSION_MATRIX.md

  API/SOURCE FILES MODIFIED BY INVENTORY-02: api/ only (5 files).
  FIRESTORE RULES: UNCHANGED (Plan §9). SDK stock-writers (stockWorkflow/useInventory/
    dispatchWorkflow/goodsReceiptWorkflow/orderWorkflow): UNCHANGED (Plan §10). UI: UNCHANGED (§11).

INVENTORY-03 (COMMITTED — 8e2c799):
  MODIFIED: src/features/procurement/services/goodsReceiptWorkflow.ts   (createGoodsReceipt
            rewritten: atomic stock+ledger+PO txn, deterministic ids, reconcileMissingGrnDocs,
            requestMatchesCompletedGrn; +grnReceiptLedgerId/grnReceiptIdempotencyKey/
            goodsReceiptDeterministicId exports; NO longer calls stockWorkflow.stockIn)
  MODIFIED: src/features/procurement/services/purchaseOrderWorkflow.ts  (PURCHASE_ORDER_TRANSITIONS
            is the one authoritative table + doc; PartiallyReceived self-transition)
  MODIFIED: src/engines/ProcurementValidationEngine.ts  (VALID_PO_TRANSITIONS = imported
            PURCHASE_ORDER_TRANSITIONS)
  MODIFIED: src/features/procurement/types/index.ts     (GoodsReceiptRecord.stockApplied?: string[])
  MODIFIED: firestore.rules   (match /stock update field-guard role list -> 1 call, +Procurement;
            match /purchase_orders update -> lean tenant gate; validPurchaseOrderTransition
            PartiallyReceived self-transition)
  MODIFIED: firestore.indexes.json  (+2 additive composite indexes: stock_ledger + goods_receipts
            each on (companyId, purchaseOrderId))
  MODIFIED: src/lib/__tests__/stockRoleMatrix.emulator.test.ts   (Procurement OP-2 -> ALLOW)
  REWRITTEN: src/features/procurement/services/goodsReceiptWorkflow.test.ts  (fixed behavior, 10 tests)
  REWRITTEN: src/lib/inventory/__tests__/baseline/grn.baseline.test.ts      (fixed behavior, 4 tests)
  MODIFIED: src/features/procurement/services/purchaseOrderWorkflow.test.ts (transition table row)
  ADDED:    src/lib/__tests__/grnReceiptTransaction.emulator.test.ts  (16 tests, concurrency/INV-13/J12)
  MODIFIED: vitest.emulator.config.ts   (+1 line, register grnReceiptTransaction.emulator.test.ts)
  MODIFIED: INVENTORY_IMPLEMENTATION_STATE.md + INVENTORY_REGRESSION_MATRIX.md

  PRODUCTION SOURCE FILES MODIFIED BY INVENTORY-03: goodsReceiptWorkflow.ts, purchaseOrderWorkflow.ts,
    ProcurementValidationEngine.ts, types/index.ts (4).
  FIRESTORE RULES: 2 blocks — match /stock (field-guard role list), match /purchase_orders
    (lean update + transition self-loop). NO other block. storage.rules UNCHANGED.
  FIRESTORE INDEXES: 2 additive composites. MUST deploy with the rules.
  UI: UNCHANGED — createGoodsReceipt signature unchanged.

INVENTORY-04 (COMMITTED — 21e502e; was 30920c2 pre-checkpoint):
  MODIFIED: src/lib/orderWorkflow.ts            (+isOrderLineLocked, +updateOrder, +LOCKED_ORDER_STATUSES)
  MODIFIED: src/lib/invoiceWorkflow.ts          (generatePIsFromOrder: +options.force, repeat guard)
  MODIFIED: src/lib/quotationWorkflow.ts        (convertQuotationToOrder: runTransaction guard, +firebaseEnv/
            sanitizer/resolveWriteGroupId imports, companyId/groupId stamped on order doc)
  MODIFIED: src/lib/stockWorkflow.ts            (cancelOrder: status writes -> runTransaction (configured);
            +piReversalRequired / +reversalInvoiceIds[]; stock restore path UNCHANGED)
  MODIFIED: src/pages/Orders.tsx                (edit branch -> updateOrder; +import)
  MODIFIED: src/components/mobile/orders/MobileOrderWorkspace.tsx  (edit branch -> updateOrder; +import — WIRING ONLY)
  MODIFIED: src/lib/__tests__/orderWorkflow.test.ts / stockWorkflow.test.ts / invoiceWorkflow.test.ts /
            quotationWorkflow.test.ts   (+20 focused Phase-04 tests; mocks extended)
  ADDED:    src/lib/__tests__/orderLifecycleTransaction.emulator.test.ts   (5 tests)
  MODIFIED: vitest.emulator.config.ts           (+1 line)

  PRODUCTION SOURCE FILES MODIFIED BY INVENTORY-04: orderWorkflow.ts, invoiceWorkflow.ts,
    quotationWorkflow.ts, stockWorkflow.ts, Orders.tsx, MobileOrderWorkspace.tsx (6).
  FIRESTORE RULES: NONE. FIRESTORE INDEXES: NONE. storage.rules: NONE.
  DATABASE: additive orders.piReversalRequired + orders.reversalInvoiceIds[] (absent = false/[]).
    No migration.
  THE -04 COMMIT contains ONLY the source/test/config files above — NOT the INVENTORY_*.md
    doc updates, NOT the -01/-02/-03 files.

  UNRELATED PRE-EXISTING working-tree changes remain UNTOUCHED (LEADS_UI_UX_SOURCE_OF_TRUTH.md
    delete; ProfileSection.tsx; useMyProfile.ts; userProfile.ts). BRAIN.md + audit still untracked.
  INVENTORY-01/-02/-03 now committed (1368cfd/58038f4/8e2c799). Only the INVENTORY_*.md doc updates + 4 unrelated changes remain in the working tree.

INVENTORY-05a (COMMITTED — HEAD):
  ADDED:    src/lib/inventory/types.ts             (MovementType enum + direction map + interfaces — Plan §8)
  ADDED:    src/lib/inventory/idempotency.ts        (buildIdempotencyKey + injective movementLedgerId — INV-8)
  ADDED:    src/lib/inventory/stockMovementEngine.ts (applyStockMovement — DORMANT, one runTransaction over
            stock + stock_ledger, in-txn idempotency, unified + legacy ledger schema, INV-1/2/7 guards)
  MODIFIED: src/features/inventory/hooks/useInventory.ts  (DELETED local stockSummaryId; imports the one in
            src/lib/workflow.ts — byte-identical output, tested)
  ADDED:    src/lib/inventory/__tests__/stockMovementEngine.test.ts           (15 unit tests)
  ADDED:    src/lib/inventory/__tests__/stockMovementEngine.emulator.test.ts  (8 emulator tests)
  MODIFIED: vitest.config.ts            (exclude glob broadened: src/**/*.emulator.test.ts)
  MODIFIED: vitest.emulator.config.ts   (+1 line registering stockMovementEngine.emulator.test.ts)
  MODIFIED: INVENTORY_IMPLEMENTATION_STATE.md + INVENTORY_REGRESSION_MATRIX.md

  PRODUCTION SOURCE FILES MODIFIED BY INVENTORY-05a: useInventory.ts only (1 — stockSummaryId de-dup).
    The 3 new engine files are DEAD CODE (no caller).
  FIRESTORE RULES / INDEXES / storage.rules: NONE. DATABASE: no production write (the additive engine
    fields land only when the engine is first CALLED — Phase 05b). No migration/backfill.
  UI / MOBILE: UNCHANGED (Plan §13 — no separate mobile movement engine).
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
- API auth + all API entities. (Phase 02 DONE: `stock` + `stock_ledger` made read-only.
  Do not touch other API entities or the API auth model.)
- ANY src/components/mobile/** business logic — mobile shells call shared hooks/workflows only
  (DESKTOP IS THE SOURCE OF TRUTH — BRAIN.md §22.3)
```

---

## DATABASE CHANGES (cumulative)

```
APPLIED (INVENTORY-01, in working tree — not deployed):
  - stock_ledger OUT rows written by dispatch verification now carry ADDITIVE fields:
    groupId, sourceType:'dispatch', sourceId, idempotencyKey, createdBy. Every prior field kept.
    Doc id for these rows is now DETERMINISTIC: STKOUT-{enc(dispatchId)}-{enc(productId)}.
    Old random-id OUT rows remain valid; nothing reads dispatch ledger rows by id.
  - firestore.rules: match /stock_ledger read gains `resource == null` (read-guard only).
  - NO migration/backfill required.

INVENTORY-02: NO database / schema / rules change. API-layer only.

APPLIED (INVENTORY-03, in working tree — not deployed):
  - stock_ledger GRN (IN) rows now carry ADDITIVE fields: idempotencyKey
    (PURCHASE_RECEIPT:goods_receipt:{po}:{line}:{before}:{qty}), referenceType:'GoodsReceipt',
    referenceId (GRN id), purchaseOrderId, sourceType:'purchase', groupId, stockId. Every prior
    field kept. Doc id is DETERMINISTIC: STKIN-GRN-{enc(po)}-L{i}-B{before}-Q{qty}.
  - goods_receipts docs gain stockApplied: string[] (the ledger ids the GRN owns).
  - goods_receipts doc id is now DETERMINISTIC: GRN-{enc(po)}-{djb2(lines)} (was genId random).
    Old random-id GRN docs + random-id GRN ledger rows remain valid.
  - firestore.rules: match /stock update field-guard (role list) + match /purchase_orders update
    (lean tenant gate) + validPurchaseOrderTransition (PartiallyReceived self-loop).
  - firestore.indexes.json: +2 additive composites — stock_ledger(companyId,purchaseOrderId),
    goods_receipts(companyId,purchaseOrderId). DEPLOY WITH THE RULES.
  - NO migration/backfill required (new receipts use the new shape; old rows untouched).

APPLIED (INVENTORY-04, code committed — not deployed):
  - orders docs gain ADDITIVE fields on cancellation: piReversalRequired (bool),
    reversalInvoiceIds (string[] of affected PI + tax-invoice ids). Absent = false / [].
  - convertQuotationToOrder now stamps companyId + groupId explicitly on the order doc
    (was relying on createDocWithId auto-stamp; raw runTransaction needs it — HR-9).
  - NO rules / index / migration / backfill.

INVENTORY-05a: NO production database write. The engine is DORMANT — its additive fields
  (stock.onHandQty; stock_ledger.{movementType,direction,idempotencyKey,onHandBefore/After,
  reservedBefore/After}; deterministic ledger id STKMV-{enc(idempotencyKey)}) are written
  ONLY when applyStockMovement is first called, which happens in Phase 05b. NO rules / index
  / migration / backfill this phase.

Planned additive schema (05a engine defines it; NOT yet written — first write in 05b):
  Phase 05a/05b: stock.onHandQty; stock_ledger.{movementType,direction,idempotencyKey,onHandBefore/After,reservedBefore/After}
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
INVENTORY-00 rollback = revert commit 49123be. Test files + one test-config line; nothing to
un-migrate, no data touched, no rules deployed.

INVENTORY-01 rollback = `git revert 1368cfd` (or `git reset --hard c043009` if reverting the whole chain). Files:
  src/lib/dispatchWorkflow.ts, firestore.rules, src/lib/__tests__/dispatchWorkflow.test.ts,
  src/lib/inventory/__tests__/baseline/dispatchOut.baseline.test.ts,
  src/lib/__tests__/dispatchStockOutTransaction.emulator.test.ts, vitest.emulator.config.ts (the
  dispatch line), INVENTORY_IMPLEMENTATION_STATE.md (this section).
  The `stock_ledger` read-rule change is NOT deployed (no `firebase deploy` was run) so prod is
  unaffected until a deliberate deploy. Deterministic-id OUT ledger rows written during any
  local/emulator testing are inert. No data migration to undo.

INVENTORY-02 rollback = `git revert 58038f4`. Files:
  api/_lib/registry.ts, api/_lib/response.ts, api/[entity].ts, api/[entity]/[id].ts,
  api/index.ts, api/__tests__/apiInventoryWriteBoundary.test.ts.
  Pure API-layer change, no deploy, no data, no rules. Reverting restores the generic REST
  write path (i.e. re-opens P0-2). Nothing else to undo.

INVENTORY-03 rollback = `git revert 8e2c799` (re-deploy prior rules/indexes if already deployed). Files:
  src/features/procurement/services/goodsReceiptWorkflow.ts + .test.ts,
  src/features/procurement/services/purchaseOrderWorkflow.ts + .test.ts,
  src/engines/ProcurementValidationEngine.ts, src/features/procurement/types/index.ts,
  firestore.rules (the /stock + /purchase_orders blocks), firestore.indexes.json (2 indexes),
  src/lib/__tests__/stockRoleMatrix.emulator.test.ts, src/lib/inventory/__tests__/baseline/grn.baseline.test.ts,
  src/lib/__tests__/grnReceiptTransaction.emulator.test.ts, vitest.emulator.config.ts (the GRN line).
  NO firebase deploy was run — prod rules/indexes unaffected until a deliberate deploy. Any
  deterministic-id GRN ledger rows / GRN docs written during local/emulator testing are inert.
  No data migration to undo. Reverting re-opens P1-1/P1-2/P1-3/P1-5(GRN)/P2-4.

INVENTORY-04 rollback = `git revert 21e502e` (or reset to 8e2c799). Files:
  src/lib/orderWorkflow.ts, src/lib/invoiceWorkflow.ts, src/lib/quotationWorkflow.ts,
  src/lib/stockWorkflow.ts, src/pages/Orders.tsx, src/components/mobile/orders/MobileOrderWorkspace.tsx,
  the 4 *.test.ts + orderLifecycleTransaction.emulator.test.ts + vitest.emulator.config.ts (the -04 line).
  NO firestore.rules / indexes / deploy / data / migration. Reverting re-opens P1-8/P2-2(status)/
  P2-7/P2-8. `orders.piReversalRequired`/`reversalInvoiceIds[]` written during any local testing
  are inert additive fields.

INVENTORY-05a rollback = `git revert HEAD` (or reset to 9227ec3). Files:
  src/lib/inventory/types.ts, src/lib/inventory/idempotency.ts, src/lib/inventory/stockMovementEngine.ts
  (all DEAD CODE — deleting them affects nothing), src/features/inventory/hooks/useInventory.ts
  (restores the local stockSummaryId copy — byte-identical, so no behaviour change either way),
  src/lib/inventory/__tests__/stockMovementEngine.test.ts + .emulator.test.ts, vitest.config.ts
  (the exclude glob), vitest.emulator.config.ts (the engine line).
  NO firestore.rules / indexes / deploy / data / migration. NOTHING to un-migrate — the engine
  was never called. Reverting simply removes the (unused) 05b-05d foundation.

Rollback readiness for future phases (Plan §18):
  - Tag firestore.rules before Phases 07, 08, 09, 11 as rules-pre-INVENTORY-0X
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
NEXT PHASE:            INVENTORY-05b — migrate the GRN receipt path onto stockMovementEngine
                       behind a flag (USE_MOVEMENT_ENGINE_GRN). Then 05c (dispatch -> engine),
                       05d (manual + cancel-restore -> engine; retire the duplicate writers).
BLOCKED BY:            Explicit human go-ahead for INVENTORY-05b. Each phase runs on its own
                       instruction (Plan §23 / §30). Do NOT auto-start.
DEPENDS ON:            INVENTORY-05a (the engine — DONE, dormant). The engine's write shape is
                       already proven against the current rules (05a emulator test).
GIT NOTE:              INVENTORY-01..05a are committed in order (1368cfd / 58038f4 / 8e2c799 /
                       21e502e / 9227ec3 docs / HEAD 05a) on c043009 — sequencing reconciled
                       in the PRE-05a checkpoint. Uncommitted: only the 4 unrelated pre-existing
                       changes + untracked BRAIN.md / audit. Safety refs: branch
                       `pre-05a-backup-head` (old 30920c2), tag `pre-05a-worktree-snapshot`.
```

---

## EXACT NEXT ACTION

```
INVENTORY-01..05a IMPLEMENTED + VERIFIED + COMMITTED in order (1368cfd / 58038f4 / 8e2c799 /
21e502e / 9227ec3 docs / HEAD 05a), sequencing reconciled in the PRE-05a checkpoint.
Nothing inventory-related is uncommitted. The Stock Movement Engine exists but is DORMANT
(no caller). Do NOT do anything further without a new instruction.

Before the next phase, a human should:
  a. (optional) drop the safety refs once satisfied: `git branch -D pre-05a-backup-head` +
     `git tag -d pre-05a-worktree-snapshot`. Push when ready (`origin/main` is at 46e3aab).
  b. Manually exercise (running app / API token):
     - INVENTORY-01: dispatch verification — stock drops once + one STKOUT row; re-verify ->
       "already verified"; insufficient -> rejected.
     - INVENTORY-02: `PUT /api/stock/<id>` -> 405; `GET /api/stock` -> 200; `POST /api/stock_ledger` -> 405.
     - INVENTORY-03: PO Draft -> Sent -> GRN partial(4) -> GRN(6) -> Received, receivedQty 10,
       two STKIN-GRN-... rows, stock +10 once; over-receipt rejected; double-click -> one effect;
       Procurement-role GRN succeeds. `firebase deploy --only firestore:indexes,firestore:rules`.
     - INVENTORY-04: dispatch part of an order -> try to change a line qty/product (blocked,
       clear error) -> edit its notes (allowed); cancel the order (order + dispatches all flip;
       check piReversalRequired + reversalInvoiceIds); "Generate PI" twice (2nd rejected);
       convert a quotation, then try to convert it again (returns the same order, no 2nd order).

When INVENTORY-05b is authorized, execute it per Plan "INVENTORY-05b — GRN -> Movement Engine":
  1. Re-read: brain.md (INVENTORY/STOCK §), Plan INVENTORY-05b, dependency map §2/§5,
     src/lib/inventory/stockMovementEngine.ts (the dormant engine 05a built).
  2. Route goodsReceiptWorkflow.applyGrnReceipt through applyStockMovement (movementType
     PURCHASE_RECEIPT, sourceType 'goods_receipt', lineKey the PO line) behind a flag
     (USE_MOVEMENT_ENGINE_GRN). Keep the pre-engine local transaction in code for one release.
     Add logActivity/notifyUsers at the caller (the engine does not).
  3. Full batched emulator run (behaviour path changes even if rules don't). Standard gate.
     Update THIS file. STOP. (05c dispatch, 05d manual + cancel-restore, each its own phase.)

Do NOT touch order/quotation/invoice/cancel workflow logic (INVENTORY-04 is done), dispatch
internals (05c), firestore.rules, reservations, or any later-phase scope. Do NOT change the
frozen MovementType enum or the engine's transaction shape without a rules re-verification.
```

---

## DO NOT REPEAT

```
- Do NOT re-run the full audit — it is complete (COMPLETE_INVENTORY_INTEGRITY_AUDIT.md).
- Do NOT re-derive the phase order — it is in the Plan + INVENTORY_PHASE_DEPENDENCY_MAP.md.
- Do NOT re-run INVENTORY-00 — COMPLETE (49123be). P1-3 is CONFIRMED; do not "re-check".
- Do NOT re-do INVENTORY-01 — IMPLEMENTED + verified. P0-1 has its interim fix. Do not
  "re-transactionalize" dispatch or re-add a movement engine (that's Phase 05c).
- Do NOT re-do INVENTORY-02 — IMPLEMENTED + verified. P0-2 is FIXED (`stock`/`stock_ledger`
  read-only over REST). Do not re-open the API write path.
- Do NOT re-do INVENTORY-03 — IMPLEMENTED + verified + acceptance-audited. P1-1/P1-2/P1-3/
  P1-5(GRN)/P2-4 are FIXED. Do not "re-transactionalize" the GRN, do not re-open the `stock`
  write-role list to Sales/Accounts, do not build the movement engine (Phase 05b migrates the
  GRN to it), do not add a dedicated SDK `stock_ledger` create gate here (Phase 05).
- Do NOT re-do INVENTORY-04 — IMPLEMENTED + verified + CODE COMMITTED. P1-8/P2-2(status)/
  P2-7/P2-8 are FIXED (workflow layer). Do not move cancel stock-restore into the engine
  (Phase 05d), do not add an `orders` rules block (deferred), do not touch PI money math.
- Do NOT re-do INVENTORY-05a — the Stock Movement Engine (src/lib/inventory/stockMovementEngine.ts
  + types.ts + idempotency.ts) is BUILT + verified + committed. It is DORMANT by design. Do NOT
  migrate any caller here (05b GRN / 05c dispatch / 05d manual+cancel each own their migration),
  do NOT change the frozen MovementType enum, do NOT re-consolidate stockSummaryId (done), do
  NOT weaken firestore.rules for it (its write shape already passes — emulator-proven).
- Git: INVENTORY-00..05a are committed in order (…c043009 → 1368cfd → 58038f4 → 8e2c799 →
  21e502e → 9227ec3 docs → HEAD 05a). Sequencing was reconciled in the PRE-05a checkpoint
  (safe local rebuild, no force-push). The 4 unrelated pre-existing changes + untracked
  BRAIN.md/audit stay in the working tree — do NOT commit/stash/revert those. Safety refs:
  branch `pre-05a-backup-head` (old 30920c2), tag `pre-05a-worktree-snapshot`. `origin/main`
  is still at 46e3aab (not pushed).
- Do NOT re-derive the emulator command — it is recorded above (JBR java).
- Do NOT start INVENTORY-05b (or any later phase) without an explicit new instruction.
- Do NOT attempt to "fix everything" — one phase, verify, update STATE, then STOP.
- The 29 failing unit-test files are the documented pre-existing baseline (BRAIN.md §35) — do NOT "fix" them.
```

---

## DO NOT CHANGE (until the owning phase)

```
See "FILES / AREAS NOT TO TOUCH" above and Plan §21. In particular:
- firestore.rules: INVENTORY-01 = `stock_ledger` READ-guard. INVENTORY-02 = none. INVENTORY-03
  = `stock` field-guard role list + `purchase_orders` lean update + PO transition self-loop.
  INVENTORY-05a = none (engine write shape passes the -03 rules unchanged). Next rules edit is
  Phase 07 (new stock_reservations block) — full batched emulator + E7 each time.
- Stock quantity/write logic: dispatch OUT done (INVENTORY-01), GRN IN done (INVENTORY-03).
  The movement engine exists (INVENTORY-05a) but is DORMANT — do NOT migrate stockIn / manual
  adjust / GRN / dispatch / cancel-restore onto it except in their owning phase (05b/05c/05d).
  cancel stock-restore stays as-is (INVENTORY-04 only made the STATUS writes atomic) -> 05d.
- REST API: `stock`/`stock_ledger` are read-only (INVENTORY-02). Do not touch other API entities.
- PO transition table: ONE `PURCHASE_ORDER_TRANSITIONS` (INVENTORY-03). Do not fork it again.
- Order lifecycle: `isOrderLineLocked` / `updateOrder` (INVENTORY-04) are the authoritative
  order-edit path. Do not add a parallel order-update that skips the lock.
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
3. CURRENT PHASE = INVENTORY-05a, STATUS = COMPLETE + COMMITTED (HEAD). The Stock Movement
   Engine is built but DORMANT (no caller). NEXT PHASE = INVENTORY-05b (migrate GRN onto the
   engine). INVENTORY-00..05a are committed in order
   (c043009 → 1368cfd → 58038f4 → 8e2c799 → 21e502e → 9227ec3 docs → HEAD 05a).
   -> If the user has just asked you to run INVENTORY-05b, do EXACTLY what "EXACT NEXT ACTION" says.
   -> If they asked for manual verification, do that (see EXACT NEXT ACTION b).
   -> Otherwise STOP and report: INVENTORY-00..05a committed in order; -05b awaits a go-ahead.
4. `git log --oneline -8` shows the ordered inventory commits on c043009.
   `git status --short` shows ONLY: 4 unrelated pre-existing changes (LEADS_UI_UX delete,
   ProfileSection.tsx, useMyProfile.ts, userProfile.ts) + untracked BRAIN.md /
   COMPLETE_INVENTORY_INTEGRITY_AUDIT.md — do NOT commit, revert, or stash the unrelated /
   untracked items. (The INVENTORY_*.md checkpoint edits are committed WITH the 05a commit
   per the phase instruction §18.)
5. Do not touch any phase beyond the one you were told to run. End with Plan §23. Update this
   file. STOP.
6. Emulator: use the JBR-java command in ROLLBACK STATUS / WHAT WAS VERIFIED. Do not re-derive it.
```

---
*End of INVENTORY_IMPLEMENTATION_STATE.md — checkpoint. Update at the end of every phase.*
