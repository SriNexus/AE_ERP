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
CURRENT PHASE:          INVENTORY-11 — Scale & Reporting Hardening — IMPLEMENTED + VERIFIED +
                        COMMITTED (2 commits on top of Phase 10 `ee73df0`: `2b4d3dd` (§11a) →
                        `275f21b` (§11b) — see COMMITS below). **This is the LAST phase in Plan
                        §14's roadmap** — the plan defines no INVENTORY-12; the inventory
                        remediation project's planned scope is now complete pending any further
                        human-directed work.
STATUS (11):            Problems addressed (Plan §14's own scope anchor): **P2-9** (dispatch
                        serial dedup O(n^2) full-scan) and **P3-6** (28 collections without
                        composite indexes; API missing-index fallback = full-collection read).
                        Both closed. The plan's broader "Sub-scope" bullets (11c/11d/11e) were
                        reconciled against the CURRENT code — not blindly implemented — see below.
                        **11a — Dispatch serial lock (P2-9).** Replaced
                        `dispatchWorkflow.assertNoDuplicateSerials`'s `getAll(DISPATCH)` full scan
                        (a real "query -> check -> write" race: two concurrent verifications of the
                        same serial could both pass the pre-check, then both commit) with
                        `dispatch_serials/{companyId}_{normalizedSerial}` — a deterministic lock
                        doc read + validated + written INSIDE `dispatchDocParticipant`, the SAME
                        movement-engine transaction as the DISPATCH_OUT lines + the dispatch-doc
                        status flip (mirrors the GRN/transfer/reservation/return participant
                        pattern — the engine stays the sole `stock`/`stock_ledger` writer; 11a adds
                        zero stock-write surface). A conflicting lock (held by a DIFFERENT
                        dispatch) aborts the WHOLE transaction — zero partial mutation, same class
                        as INV-1/INV-13. New PURE `src/lib/inventory/serialLock.ts` (mirrors
                        `skuLock.ts`'s "deterministic doc id IS the uniqueness check" pattern):
                        `normalizeSerial` (trim+uppercase — so "SN-100"/"sn-100" collide),
                        `dispatchSerialLockId`, `lockHeldByAnotherDispatch`.
                        `assertNoDuplicateSerials` → `assertNoDuplicateSerialsInBatch` (in-batch-
                        only, normalized, non-transactional pre-check for a friendlier error — the
                        REAL cross-dispatch guard is the transactional lock). A serial captured
                        against a zero-verified-quantity line is REJECTED outright (never silently
                        left un-locked — the participant only runs when ≥1 movement actually
                        applies). Desktop + mobile already shared the ONE
                        `executeAndVerifyDispatch` entry point — zero UI change needed for parity.
                        `firestore.rules`: new `dispatch_serials` block (`resource==null`-guarded
                        read gated on `sameWarehouse()`, create requires warehouse-actor+same-
                        company+same-warehouse+an inventory role, `update/delete: if false` —
                        permanently claimed, deliberately mirroring the OLD mechanism's own
                        semantics which never released a serial on cancel either) +
                        `isSpecialCollection()` entry. `firestore.ts`: added to
                        `WAREHOUSE_SCOPED_COLLECTIONS` + `COLLECTION_PERMISSION_MODULE` (`'stock'`).
                        New dry-run-first `scripts/inventory/backfill-dispatch-serials.ts` (mirrors
                        `backfill-sku-locks.ts`): the new lock collection starts EMPTY, so without
                        a backfill a NEW verification could re-claim a serial already used on an
                        OLD pre-§11a dispatch — reports historical serials with one clear owner
                        (`--apply` locks them) vs. AMBIGUOUS ones (2+ distinct historical
                        dispatches — pre-existing bad data, report only, never auto-picked). NOT
                        run against production this session (script exists, dry-run-first,
                        awaiting a human `--apply` decision).
                        **11b — Composite indexes + loud index fallback (P3-6).** Reconciled the
                        plan's own list against the ACTUAL code: `product_categories` (named in
                        the plan) needs NO index — its only query is a single `companyId`
                        equality, verified via `companyScopedQuery`, no composite required
                        (avoided speculative index bloat); `stock_reservations`/`stock_transfers`
                        already got theirs in Phases 07/08. The REAL, currently-LIVE gap: `api/
                        [entity].ts`'s generic `handleList` for `products`/`vendors`/
                        `purchase_orders`/`goods_receipts`/`warehouses`/`stock` — their default
                        list query (`companyId==`+`isDeleted==`+`orderBy(createdAt)`) had NO
                        matching composite (their existing indexes cover a DIFFERENT sort field,
                        or for `warehouses` a `groupId`-based query used by a different code path)
                        — every plain "list this entity" REST call fell through to the silent
                        full-collection-read fallback (BRAIN.md API-6). Added the missing
                        `(companyId ASC, isDeleted ASC, createdAt DESC)` composite for all 6 —
                        purely additive. `api/[entity].ts`: "make it loud" (the plan's own explicit
                        alternative to removing the fallback outright — a broader REST-API
                        behavior change touching every registered entity, inventory or not, which
                        this inventory-scoped phase should not make) — the fallback's response
                        behavior is UNCHANGED (still a resilience path, never a hard 500), only a
                        clear `console.error` naming the collection + missing query shape was
                        added.
                        **Reconciled and deliberately NOT implemented this phase** (evidence-based,
                        not blind plan-following):
                        - **11c (paginated stock/ledger/product/category/warehouse lists)** — every
                          relevant client read already goes through `companyScopedQuery` (a
                          company-scoped Firestore query via `getAll()`, never a cross-tenant
                          leak); the real concern is single-company dataset SIZE at scale, not
                          tenant safety. A full pagination retrofit of 5 major hooks feeding
                          StockWorkspace/ProductsWorkspace/CategoriesWorkspace/
                          WarehousesWorkspace/StockLedgerWorkspace would be a large, high-blast-
                          radius UI rewrite of their existing filter/sort/export UX, not tied to
                          either of Plan §14's own named "Problems addressed" (P2-9, P3-6).
                          `getPage()` already exists in `firestore.ts` for incremental future
                          adoption per-hook.
                        - **11d (ledger archival/rollup)** — the plan's own text says "design only
                          in this phase unless volume demands it"; no evidence of current volume
                          pressure found. Design note only (COMPLETED PHASES table + this entry):
                          a future pass would move `stock_ledger` rows older than N months into a
                          per-company monthly rollup collection
                          (`companyId+month+productId+warehouseId` aggregates), keep raw rows
                          queryable for the retention window via the existing composite indexes,
                          and fold rollup totals into `StockReconciliationEngine`'s math for
                          periods outside that window. Trigger: implement when a company's
                          `stock_ledger` row count or query latency actually degrades (monitor via
                          Firestore usage dashboards) — not preemptively.
                        - **11e (reporting semantics)** — VERIFIED, not changed: every report/
                          comparison surface found (`ProductsWorkspace` stock rollup,
                          `ProjectProcurementWorkspace` availability check,
                          `StockReconciliationEngine`) already reads `availableQty`/`onHandQty`/
                          `reservedQty` directly from the `stock` summary as the sole source of
                          truth; none re-derive an alternate calculation. No code change needed.
                        **10a Opening Stock** — `applyOpeningStock()` (new
                        `src/features/inventory/services/stockOperationsWorkflow.ts`): ONE
                        `OPENING_STOCK` movement per (company, product, warehouse), EVER. The real
                        guard is a DETERMINISTIC idempotency key
                        (`OPENING_STOCK:opening:{companyId}:{productId}:{warehouseId}`) — the
                        engine's own existing-ledger-row check inside its transaction, not just an
                        app-layer precheck (which only gives a friendlier error message).
                        **10b Damage / Write-off** — `applyDamageWriteOff()` (same file):
                        `DAMAGE_OUT` restricted to a fixed reason taxonomy
                        (`DAMAGE_REASON_CODES = damaged|expired|lost|theft|sample`, exported +
                        reused by 10e, not duplicated) with an Admin/GroupAdmin-only approval gate
                        above `DAMAGE_APPROVAL_THRESHOLD_QTY=50` units OR
                        `DAMAGE_APPROVAL_THRESHOLD_VALUE=50000` estimated value — enforced at the
                        workflow layer (the acting user's role from `useAppStore`), never only in
                        UI.
                        **10c Bulk import / bulk adjust** — new
                        `src/features/inventory/services/bulkStockImportWorkflow.ts`:
                        `previewBulkAdjust`/`applyBulkAdjust`, CSV rows -> one
                        ADJUSTMENT_IN/OUT engine call per row (never a second stock writer, never
                        one giant cross-row transaction). A shared `importRunId` + each row's own
                        row-number line-key makes a re-submitted run idempotent row-by-row via the
                        engine's own existing-ledger-row check; the dry-run preview simulates the
                        cumulative on-hand effect of multiple rows touching the same
                        product+warehouse and flags rows already applied by a prior attempt
                        (`alreadyApplied`) without double-counting. UI: `BulkStockAdjustModal.tsx`
                        (SKU/warehouse-name resolution, never raw ids in the CSV) wired into
                        `StockWorkspace.tsx` as "Bulk Import". No new firestore.rules — reuses the
                        already-rules-covered + already-emulator-proven ADJUSTMENT_IN/OUT path.
                        **10d Low-stock alerts** — new `src/lib/inventory/lowStockAlerts.ts`:
                        `checkLowStockAndNotify()` runs AFTER a movement batch commits (the ONLY
                        change to `stockMovementEngine.ts` — the core transaction logic is
                        byte-identical to Phase-09); fires once per genuine threshold crossing
                        (`onHandBefore > threshold && onHandAfter <= threshold`) via the existing
                        `NotificationType.INVENTORY_UPDATED` path to Warehouse/Procurement,
                        best-effort (its own try/catch — a notification failure can never surface
                        as an error from a movement that already committed).
                        **10e Customer return / RMA** — new
                        `src/features/inventory/services/customerReturnWorkflow.ts`:
                        `createCustomerReturn(input, returnId)` — `returnId` is a REQUIRED
                        caller-supplied parameter (not internally generated, unlike
                        `createTransfer`) so a retry of the SAME return reuses the SAME idempotency
                        keys for both movement legs, a real transaction-level guarantee. A
                        `customer_returns/{RET-*}` doc links back to the order+dispatch; every line
                        restocks physically (`SALES_RETURN_IN`); a `damaged`-condition line is
                        ADDITIONALLY written off immediately (`DAMAGE_OUT`, reusing 10b's
                        `DAMAGE_REASON_CODES`) — both legs + the return doc commit in ONE atomic
                        movement-engine batch via a `MovementParticipant` (mirrors the GRN/
                        transfer/reservation pattern; the engine stays the sole `stock`/
                        `stock_ledger` writer). New `firestore.rules` block (`resource==null`-
                        guarded read, warehouse+company-scoped create, role-gated,
                        `update/delete: if false` — immutable like a ledger row) + added to
                        `isSpecialCollection()` / `WAREHOUSE_SCOPED_COLLECTIONS` (its read rule
                        gates on `sameWarehouse()`) / `COLLECTION_PERMISSION_MODULE` (`'stock'`
                        module, shared operational state) + 3 new composite indexes. UI:
                        `ProcessReturnModal.tsx` wired into `DispatchDetail.tsx` as "Process
                        Return" (gated on `canDo('edit','stock')` + the dispatch actually having a
                        verified/dispatched quantity).
                        **Known limitations (genuine, documented, not blockers):**
                        (1) no mobile UI entry point for 10c (bulk import) or 10e (customer
                        return) this phase — both underlying workflows are already
                        mobile-consumable (no mobile-specific logic to duplicate; 10a/10b's shared
                        `useSaveStockEntry` hook already has full mobile parity in
                        `MobileStockWorkspace.tsx`), wiring a mobile entry point is pure UI work
                        for a later session; (2) `CSVImportModal.tsx`'s existing `collection:
                        'products'` master-data import path still bypasses the Phase-09 SKU lock
                        (`batchCreate` direct write) — a REAL, pre-existing gap, verified again
                        this phase, deliberately left untouched (Phase-09-adjacent, not
                        Phase-10-scoped: Phase-10's own new bulk-import path is for STOCK
                        QUANTITIES only and does not touch product master data at all).
STATUS (09):            Product SKU uniqueness (`product_sku_locks`, mirrors `customer_phone_locks`,
                        atomic create/edit via `useInventory.ts` + the REST API's `products`
                        create/update via `api/_lib/productSkuLock.ts` — the SAME shared
                        `skuLock.ts` normalization, one implementation). `categoryId` now written
                        on every product save (desktop + mobile forms + ProductPicker); category
                        rename cascades the denormalized display name onto linked products + child
                        categories, `categoryId` itself immutable, historical quotation/order line
                        snapshots NEVER touched. Delete guards (`masterDataGuards.ts`, read-only)
                        for product / category / warehouse / vendor, wired into every create/delete
                        path (desktop AND mobile — found and eliminated a real duplicate inline
                        category workflow in `CategoriesWorkspace.tsx` + `MobileCategoryWorkspace.tsx`
                        in the process). `assertMasterDataIdAvailable` closes the P1-7
                        `genId`+`setDoc(merge)` collision class for product/category/warehouse/vendor
                        create (scoped guard, `createDocWithId` itself unchanged). Dry-run-first
                        backfill scripts for `categoryId` (name-match report, never auto-picks
                        ambiguous) and SKU locks (duplicate report, never auto-merges). **Found +
                        fixed a real pre-existing firestore.rules gap**: the generic collection
                        fallback's `read` rule was missing the `resource == null` guard every other
                        deterministic-lock/settings-class collection already has — surfaced by the
                        new P1-7 product-id-collision transactional read, fixed with the same
                        established one-line pattern, emulator-verified with zero regression across
                        ~30 collections sharing the fallback. SKU-lock concurrency proven for real
                        against the Firestore emulator (company-scoped, one winner). tsc 0 / lint 3
                        pre-existing / build 0 / full vitest 29-fail brittle baseline UNCHANGED
                        (+47 passing) / emulator (batched) 100%. Committed.
STATUS (08):            IMPLEMENTED + VERIFIED — committed separately as `6cfdeb5`, after 06+07 `de5902e`.
STATUS (08):            First-class warehouse-to-warehouse transfer within one company:
                        `stock_transfers/{TRF-*}` collection (rules block + 3 indexes +
                        isSpecialCollection + permission module 'stock'). New
                        `src/features/warehouses/services/warehouseTransferWorkflow.ts` —
                        createTransfer (draft, no stock effect) / shipTransfer (`TRANSFER_OUT`
                        @ source, status in_transit, atomic) / receiveTransfer (`TRANSFER_IN`
                        @ dest for the qty that arrived — partial receipt = loss flagged on
                        the doc) / cancelTransfer (draft → flip; in_transit → compensating
                        `TRANSFER_IN` back to source). Movement engine UNCHANGED — TRANSFER_OUT/IN
                        were already wired (OUT/IN); the doc status flip is a `MovementParticipant`
                        so it commits atomically inside the engine's runTransaction. Deterministic
                        idempotency keys (ship/receive/cancel retry-safe). INV-11: a completed
                        transfer's `Σ(TRANSFER_OUT + TRANSFER_IN) == 0` — machine-verified vs the
                        real stock/ledger. Reconciliation extended additively
                        (`computeTransferReconciliation` / `reconcileTransfers` — an in-transit
                        transfer is an EXPECTED outstanding movement, never drift; a lossy one
                        surfaces the shortfall for a human RECONCILE_ADJUST). Desktop UI at
                        `/stock-transfers`. tsc 0 / lint 3 pre-existing / build 0 / full vitest
                        29-fail brittle baseline UNCHANGED / emulator (batched) 100%
                        (`stockTransferTransaction.emulator.test.ts` 13/13 incl. real concurrent
                        ship + cross-company DENY + suspended-group DENY). Committed separately.
STATUS (07):            IMPLEMENTED + VERIFIED — committed with 06 as `de5902e`.
STATUS (07):            `reservationsEnabled` feature flag ACTIVATED (default ON; instant rollback =
                        flip `RESERVATIONS_ENABLED_DEFAULT` in `src/lib/inventory/reservationConfig.ts`).
                        New `stock_reservations` collection (rules block + 5 indexes + isSpecialCollection
                        + WAREHOUSE_SCOPED + permission module). Engine: `SALES_RESERVE`/`SALES_RELEASE`
                        + `clampToStock` partial-grant + `reservationsEnabled` gate + INV-3 on the final
                        per-summary state; `availableQty = onHandQty − reservedQty` after EVERY movement
                        (INV-4 — the one roadmap semantic change). `markPIAsPaid` → reserve per PI line
                        (participant creates the reservation doc IN the engine txn; idempotent
                        `SALES_RESERVE:proforma_invoice:{pi}:{line}`; partial → `order.stockShortfall[]`;
                        no fulfilment warehouse → deferred, payment never failed). Dispatch verify →
                        `SALES_RELEASE`(dispatch_consume) in the same batch as DISPATCH_OUT + reservation
                        doc `qtyConsumed`/`status`. `cancelOrder` → `SALES_RELEASE`(order_cancel) for the
                        unconsumed remainder + reservation `released` (alongside the existing
                        SALES_RETURN_IN; no double count). Reconciliation extended ADDITIVELY
                        (`reservedReconciled`, `reservedMismatchCount`) — Phase-06 physical math
                        untouched. Migration: `scripts/inventory/backfill-onhand.ts` (dry-run default,
                        `--apply`; start-clean, no retro-reserve; never deletes / never touches ledger).
                        UI: StockWorkspace ON HAND column; OrdersWorkspace reservation panel + shortfall.
                        Emulator `stockReservationTransaction.emulator.test.ts` 15/15 (incl. real
                        concurrent-runTransaction M4 + rules + B2B/B2C smoke). Full regression matrix:
                        29-fail brittle baseline UNCHANGED (+97 passing tests). tsc 0 / lint 3
                        pre-existing / build 0. NOT committed.
STATUS (06):            New READ-ONLY `src/engines/StockReconciliationEngine.ts` (mirrors
                        ProcurementValidationEngine): `reconcileSummary` / `reconcileWarehouse`
                        / `generateStockHealthReport` compute `Σ(operational IN) − Σ(operational
                        OUT)` from `stock_ledger` and compare to `stock.onHandQty`. Pure math in
                        `src/engines/stockReconciliationMath.ts` (zero imports) — reused by the
                        engine AND `scripts/inventory/reconcile.ts`. RECONCILE_ADJUST rows are
                        EXCLUDED from `computed` (they patch `stored`, not the operational
                        history) so a correction genuinely reconciles (post-correction delta 0).
                        Correction: `applyReconciliationCorrection` (canDo('edit','stock') +
                        reason + reconciliationRunId) → `applyStockMovement('RECONCILE_ADJUST',
                        qty: signed delta, idempotencyKey: RECONCILE_ADJUST:reconciliation:
                        {runId}:{summaryId})` — audit-logged, idempotent, engine-only. Engine:
                        +`auditReconciliation: true` flag on RECONCILE_ADJUST ledger rows. UI:
                        read-only "Reconcile" report in `StockWorkspace` behind `canDo('view',
                        'stock')`; per-mismatch "Apply Correction" (confirm + reason) behind
                        `canDo('edit','stock')`. NO firestore.rules / firestore.indexes change.
                        **P2-1 detection DONE; P1-4 single-writer invariant intact.**
LAST VERIFIED COMMIT:   `275f21b` (INVENTORY-11 §11b, current HEAD). Full chain: … → 6939c12
                        (05d) → de5902e (06+07) → 6cfdeb5 (08) → ef7b08b (09 SKU lock) → d5c27e3
                        (09 category-id) → 781926c (09 delete guards) → 0391a4f (10 §10a/§10b) →
                        c640b8a (10 §10d) → 788f89a (10 §10e) → f791b6b (10 §10c) → c980d18
                        (10 §10a/§10b UI) → b13dc0f (10 §10c UI) → b222416 (10 §10e UI) → ee73df0
                        (10 docs) → 2b4d3dd (11 §11a) → 275f21b (11 §11b).
DATE OF THIS UPDATE:    2026-09-05
UPDATED BY:             INVENTORY-11 implementation session
```

---

## COMPLETED PHASES

| Phase | Completed on | Commit hash | Emulator run | Notes |
|---|---|---|---|---|
| **INVENTORY-11** | 2026-09-05 | 2 commits on top of 10 `ee73df0`: `2b4d3dd` (11a) → `275f21b` (11b) | **PASS** — new `dispatchSerialLock.emulator.test.ts` **11/11** (fresh claim atomic-commits with DISPATCH_OUT+status flip; same-dispatch retry idempotent; a DIFFERENT dispatch claiming an already-locked serial aborts the WHOLE txn with stock/ledger/dispatch/lock all provably unchanged; case-insensitive collision; **2 different dispatches racing the SAME serial → exactly one succeeds, exactly one lock exists**; same serial in a different company independent; lock immutability; cross-company read/create denial; unauthorized-role denial; cross-company forged warehouseId denial; warehouse-restricted cross-warehouse denial). `serialLock.test.ts` **10/10** (pure). `dispatchWorkflow.test.ts` **16/16** (2 rewired + 3 new). `apiListIndexFallback.test.ts` **3/3**. Regression (batched emulator): `dispatchStockOutTransaction`+`stockReservationTransaction`+`stockTransferTransaction`+`customerReturnTransaction`+`productSkuLock`+`stockRoleMatrix`+`grnReceiptTransaction` **96/96**; `sensitiveCollectionsRoleEnforcement`+`multiTenantSecurity`+`rbacPhase8CumulativeSecurity`+`groupAdminFullGroupAccess` **419/419**; full batched suite (24 files) **704/704, zero flakes**. Full API suite **12 files/306 tests**. Full `npx vitest run`: 268 files, **29-fail/65-fail brittle baseline UNCHANGED** (3664/3729 total, +13 net new passing). tsc exit 0 (3 known pre-existing attendance errors only), build exit 0. `singleStockWriter.test.ts` PASS; grep confirms zero direct `stock`/`stock_ledger` writers outside `stockMovementEngine.ts`. | **INVENTORY-11 — Scale & Reporting Hardening (the LAST planned phase — Plan §14 defines no INVENTORY-12).** Full sub-feature write-up is in CURRENT POSITION above. Headline: **11a** new `src/lib/inventory/serialLock.ts` (pure) + `dispatchWorkflow.ts`'s `dispatchDocParticipant` extended to read/validate/write `dispatch_serials/{companyId}_{normalizedSerial}` lock docs INSIDE the SAME movement-engine transaction as the DISPATCH_OUT lines — replaces the old `getAll(DISPATCH)` O(n²) full-scan (P2-9) with a real transactional guarantee; new `firestore.rules` block + `isSpecialCollection()`/`WAREHOUSE_SCOPED_COLLECTIONS`/`COLLECTION_PERMISSION_MODULE` entries; new dry-run-first `scripts/inventory/backfill-dispatch-serials.ts` (NOT run against production this session). **11b** 6 new composite indexes (`companyId+isDeleted+createdAt`) for `products`/`vendors`/`purchase_orders`/`goods_receipts`/`warehouses`/`stock` closing a REAL currently-live gap in `api/[entity].ts`'s default list query (P3-6/API-6); the fallback itself made loud (a `console.error` naming the collection+shape) rather than removed, keeping its resilience behavior for every REST-registered entity unchanged. **11c/11d/11e reconciled against the plan and deliberately NOT implemented** (pagination retrofit — high blast-radius, not tied to either named "Problem addressed"; ledger archival — plan's own "design only" hedge, no volume pressure found; reporting semantics — verified already compliant, no alternate stock source of truth anywhere). Movement engine core transaction logic, reservations, transfers, master-data guards, Phase-10 operational workflows — all UNTOUCHED, re-verified green. Single stock writer preserved (11a adds zero stock-write surface — the serial lock is a NEW collection, never `stock`/`stock_ledger`). |
| **INVENTORY-10** | 2026-09-05 | 7 commits on top of 09 `781926c`: `0391a4f` (10a/10b) → `c640b8a` (10d) → `788f89a` (10e) → `f791b6b` (10c) → `c980d18` (10a/10b UI) → `b13dc0f` (10c UI) → `b222416` (10e UI) | **PASS** — new `customerReturnTransaction.emulator.test.ts` **11/11** (atomic doc+movement commit, damaged net-onHand-unchanged with both ledger rows, idempotent retry, 2-concurrent-creates-same-id race exactly-one-applies, cross-company read/create DENY, role-outside-pattern DENY, warehouse-restricted cross-warehouse DENY, doc+ledger immutability, suspended-group DENY, company-wide Admin any-warehouse ALLOW). Re-ran `stockReservationTransaction`+`stockTransferTransaction`+`productSkuLock`+`stockRoleMatrix`+`dispatchStockOutTransaction` (69/69), `sensitiveCollectionsRoleEnforcement`+`multiTenantSecurity`+`rbacPhase8CumulativeSecurity` (406/406), `stockMovementEngine`+`stockAdjustTransaction` (15/15) — zero regression on the Phase 05–09 invariants Phase-10 could plausibly have touched. Full batched emulator suite (24 files incl. the new one) — 2 files flaked with `client is offline` under the full-batch cold-run load (documented environment characteristic, BRAIN §2.1), both **re-verified 100% in isolation** (130/130) — not a regression. Full `npx vitest run`: 267 files, **29-fail/65-fail brittle baseline UNCHANGED** (3586/3651 passing, +~140 net new passing tests across the 4 new focused suites). tsc exit 0 (only the 3 known pre-existing attendance-fixture errors), lint N/A this session (no lint script run separately from tsc/build), build exit 0. | **INVENTORY-10 — Inventory Operational Features.** Full sub-feature-by-sub-feature write-up is in CURRENT POSITION above (kept there, not duplicated here). Headline: `stockOperationsWorkflow.ts` (10a+10b) + `bulkStockImportWorkflow.ts` (10c) + `lowStockAlerts.ts` (10d, the ONLY change to `stockMovementEngine.ts` — core txn logic byte-identical to 09) + `customerReturnWorkflow.ts` (10e, NEW `customer_returns` collection + rules block + 3 indexes + `isSpecialCollection()`/`WAREHOUSE_SCOPED_COLLECTIONS`/`COLLECTION_PERMISSION_MODULE`) + UI: `StockWorkspace.tsx`'s Adjust Stock modal gains Opening Stock/Damage types + a Bulk Import action (`BulkStockAdjustModal.tsx`), `DispatchDetail.tsx` gains a Process Return action (`ProcessReturnModal.tsx`), `MobileStockWorkspace.tsx` shares 10a/10b via the same `useSaveStockEntry` hook (no mobile UI for 10c/10e this phase — documented limitation, not a blocker). Movement engine core transaction logic, reservations, transfers, master-data guards — all UNTOUCHED, re-verified green. Single stock writer preserved (10a/10b/10c/10e all route through `applyStockMovement`/`applyStockMovements`; 10d is a post-commit read+notify with no stock write of its own). Two genuine, documented, non-blocking limitations noted above. |
| approval | 2026-09-03 | `ea3f32f` | — | Project owner approved the plan; INVENTORY-00 authorized. |
| planning baseline | 2026-09-03 | `47c063b` | — | 4 INVENTORY_*.md planning artifacts committed. |
| **INVENTORY-00** | 2026-09-03 | `49123be` | **PASS** (JBR java 21, 14 files / 600 assertions, 2 batches, 100%) | Baseline harness (6 test files, 51 tests), stock role matrix (25 tests, P1-3 **CONFIRMED**), invariant predicates. Zero production behavior change. |
| **INVENTORY-01** | 2026-09-03 | `1368cfd` | **PASS** (JBR java 21, full suite 3 batches 15 files / 608 tests 100%; new dispatch txn suite 8/8; concurrency proven) | Atomic + idempotent dispatch stock-OUT (P0-1); dispatch-side product/warehouse validation (P1-6 slice); one **minimal** firestore.rules change (`stock_ledger` read `resource == null` guard). |
| **INVENTORY-02** | 2026-09-03 | `58038f4` | **PASS** (unchanged — no rules touched; spot-check 4 files / 315 tests 100%) | REST API `stock` + `stock_ledger` made READ-ONLY (P0-2): every mutating method -> 405 before auth/DB, zero Firestore write. **NO firestore.rules change. NO SDK stock-writer change. NO UI change.** New: `api/__tests__/apiInventoryWriteBoundary.test.ts` (18 tests). API suite 11 files / 303 tests 100%. |
| **INVENTORY-03** | 2026-09-04 | `8e2c799` | **PASS** (JBR java 21, full suite 16 files / 624 tests 100%, sub-batched; new `grnReceiptTransaction.emulator.test.ts` 16/16; concurrency + INV-13 + P1-3 proven; re-verified in the acceptance audit) | GRN receipt is now **idempotent + atomic per receipt + over-receipt-proof under concurrency** (P1-1/P1-2/P1-5/INV-13): one `runTransaction` over `stock`+`stock_ledger`+`purchase_orders`, deterministic per-line ledger id, PO `receivedQty` incremented (never a stale array). **P1-3 RESOLVED** — `stock` write-role list gains `Procurement` (Sales/Accounts stay denied). **P2-4 RESOLVED** — one shared `PURCHASE_ORDER_TRANSITIONS` (workflow ↔ ProcurementValidationEngine ↔ rules mirror). `firestore.rules`: `stock` field-guard role list (+Procurement, 3 calls→1); `purchase_orders` update made LEAN (budget) + `PartiallyReceived→PartiallyReceived` self-transition. Additive: `stock_ledger.purchaseOrderId`/`stockId`, `goods_receipts.stockApplied[]`, 2 composite indexes. |
| **INVENTORY-04** | 2026-09-04 | `21e502e` (was `30920c2` before the PRE-05a rebuild — identical -04 content) | **PASS** — new `orderLifecycleTransaction.emulator.test.ts` 5/5 (convert-race + cancel-atomicity); NO firestore.rules / firestore.indexes change so the INVENTORY-03 emulator surface (16 files / 624 tests) stands. | Order line lock (P1-8 / INV-12): shared `isOrderLineLocked(order)` + `updateOrder(id,patch)` in `orderWorkflow.ts` — a dispatched order's line product/qty/price can no longer change (workflow-layer, `Orders.tsx` + `MobileOrderWorkspace.tsx` both call it); non-line edits stay allowed. `cancelOrder` (P2-2): order + affected dispatch status flip in ONE `runTransaction` (configured) that re-reads each; additive `orders.piReversalRequired` + `orders.reversalInvoiceIds[]` (info only — NO reversal/GST/amount change). Stock restore UNCHANGED (still `stockIn` — 05d). `generatePIsFromOrder` (P2-7): re-read + repeat guard (`{force:true}` escape). `convertQuotationToOrder` (P2-8): lock-check + order-create + quotation-mark in ONE `runTransaction` re-reading `convertedOrderId` — concurrent conversions → one order, same id. **NO rules change; `orders` API PUT bypass documented, still deferred.** |
| **INVENTORY-05a** | 2026-09-04 | `ff45262` | **PASS** — new `src/lib/inventory/__tests__/stockMovementEngine.emulator.test.ts` 8/8 (engine write shape passes CURRENT rules unchanged; atomic; idempotent; INV-1 abort; cross-company + Sales-role + forged-warehouse DENY; ledger immutable). NO firestore.rules change → INVENTORY-03 emulator surface (16 files / 624) stands. | **DORMANT** `src/lib/inventory/stockMovementEngine.ts` — `applyStockMovement(input): Promise<MovementResult>` (Plan §4.1/§9/§10). ONE `runTransaction` over `stock` + `stock_ledger` + in-txn idempotency (deterministic **injective** id `STKMV-{encodeURIComponent(idempotencyKey)}` — INV-8 by construction); INV-1/INV-2 guards abort the txn; INV-3/INV-4 gated behind `reservationsEnabled` (FALSE for 05–06: `availableQty == onHandQty`, `reservedQty` 0); `companyId`+`groupId` manually stamped; legacy ledger fields (`type`/`referenceType`/`referenceId`/`date`) dual-written. New `types.ts` (MovementType enum §8) + `idempotency.ts`. **NO caller migrated** (05b/05c/05d). `stockSummaryId` de-duplicated: `useInventory.ts` deletes its local copy, imports the one in `workflow.ts` (byte-identical — tested). New: `stockMovementEngine.test.ts` (15). Additive schema (only when called, not in 05a): `stock.onHandQty`, `stock_ledger.{movementType,direction,idempotencyKey,onHandBefore/After,reservedBefore/After}`. |
| **INVENTORY-05a.1** | 2026-09-04 | `d5010e2` | **PASS** — `stockMovementEngine.emulator.test.ts` 11/11 (8 prior + 3 participant: PO write commits atomically with stock+ledger under CURRENT rules; participant `validate` throw aborts the whole txn — stock+ledger+PO all unchanged; **concurrent 7+6 over-receipt → exactly one aborts entirely, Σledger == PO.receivedQty, no stranded stock**). NO firestore.rules change. | **Prerequisite for 05b** — resolves the 05b atomicity blocker. New `applyStockMovements(inputs, participant?)`: one `runTransaction` over every (stock summary + ledger row) in the batch PLUS an optional `MovementParticipant` that runs its OWN authoritative read (`ctx.get`) → validate (throw = abort with error; `false` = benign skip) → write (`MovementWriter`) all inside the SAME txn. The `MovementWriter` REJECTS `stock`/`stock_ledger` (`assertParticipantCollection`) so the engine stays the sole owner of every stock/ledger mutation (Plan §4.1). `applyStockMovement(input, participant?)` is now a thin wrapper. Engine also dual-writes legacy `beforeQty`/`afterQty` + a generic `input.ledgerExtra` pass-through (GRN's `referenceType:'GoodsReceipt'` / `purchaseOrderId`). New: `types.ts` (`MovementParticipant`, `MovementWriter`, `MovementPlanEntry`, `BatchMovementResult`), +7 unit tests. **NO caller migrated.** |
| **INVENTORY-05b** | 2026-09-04 | `e01819a` | **PASS** — `grnReceiptTransaction.emulator.test.ts` rewritten to the migrated engine+participant shape, all **16/16** Phase-03 cases green (J6–J12, double-submit, **concurrent 6+6 / 4+6 / 7+6 over-receipt → INV-13 holds atomically, no stranded stock**, Procurement/Sales/Accounts roles, cross-company, forged warehouseId, ledger+GRN immutability, reconcile-from-ledger). NO firestore.rules / firestore.indexes change → INVENTORY-03 emulator surface stands. | `goodsReceiptWorkflow.createGoodsReceipt` → `applyStockMovements(receiptMovementInputs(...), grnPurchaseOrderParticipant(...))`. The Phase-03 local `runTransaction` over stock+ledger+PO is **DELETED** — the engine's txn now carries every line's stock+ledger write PLUS the PO participant: `read` re-fetches the PO in-txn, `validate` re-checks `Σ received + applied ≤ ordered` per line (**INV-13**, P1-2) + PO receivable (P1-5), `commit` increments `items[].receivedQty` off the fresh PO + recomputes status. Movement ledger id `STKMV-{enc(PURCHASE_RECEIPT:goods_receipt:{grnId}:{lineIndex})}` (grnId already encodes each line's before+qty → idempotent, P1-1). New rows carry the unified schema + legacy compat (`type`/`referenceType:'GoodsReceipt'`/`referenceId`/`beforeQty`/`afterQty`/`purchaseOrderId` + `grnLineIndex`/`grnPreviouslyReceivedQty` via `ledgerExtra`). `reconcileMissingGrnDocs` reads the new fields (falls back to the -03 parse for old rows). Demo + configured branches unified (both go through the engine). NO caller of `createGoodsReceipt` changed (signature identical) — Desktop + Mobile share it. Removed: `grnReceiptLedgerId` / `grnReceiptIdempotencyKey` / `lineMetaFor` (superseded). Tests: `goodsReceiptWorkflow.test.ts` + `grn.baseline.test.ts` updated to the new ledger shape (behaviour identical). |
| **INVENTORY-05c** | 2026-09-04 | `8432c22` | **PASS** — `dispatchStockOutTransaction.emulator.test.ts` rewritten to the migrated engine+participant shape, all **8/8** Phase-01 cases green (K2 atomic decrement + DISPATCH_OUT ledger + dispatch Dispatched; **D4/K4 concurrency: stock=1, 2 verifies → exactly one applies, final 0, one ledger row, never negative**; D3/K3 insufficient aborts entirely; D5/K5 idempotent no-op; K5 terminal guard; ledger immutability; P1-3 Accounts denied; cross-warehouse denied). NO firestore.rules change → INVENTORY-03 emulator surface stands. | `dispatchWorkflow.executeAndVerifyDispatch` → `applyStockMovements(DISPATCH_OUT[], dispatchDocParticipant)`. The Phase-01 local `runTransaction` over dispatch+stock+ledger is **DELETED** — every line is a `DISPATCH_OUT` movement; the engine's ONE txn carries all lines' stock+stock_ledger writes PLUS `dispatchDocParticipant` (`read` re-fetches the dispatch; `validate` returns **false** for a terminal dispatch → benign skip / `alreadyVerified`; `commit` writes `status:'Dispatched'` + `items`/`verifiedBy`/`dispatchedAt`). The order-items update + project patch + notifications stay AFTER the engine call (Phase-01 shape — Plan §811). Sequential double-click still rejected by the pre-check throw. `dispatchOutLedgerId(id, productId)` now returns `STKMV-{enc(DISPATCH_OUT:dispatch:{id}:{productId})}` (idempotency key byte-identical to INVENTORY-01). New rows: unified schema + legacy (`type:'OUT'`, `beforeQty`/`afterQty`, `referenceType:'Dispatch'`, `referenceId`). Demo + configured unified through the engine. Zero-line verify + all-idempotent-no-op recovery flip the dispatch status directly (`updateDocById`, Phase-01 parity — a `dispatch`-doc write, NOT a stock write). `executeAndVerifyDispatch` signature unchanged — Desktop (`ProjectDispatchWorkspace`) + Mobile (`MobileDispatchWorkspace`) share it. Tests: `dispatchWorkflow.test.ts` + `dispatchOut.baseline.test.ts` updated to the engine shape (behaviour identical). |
| **INVENTORY-05d** | 2026-09-04 | `6939c12` | **PASS** — new `singleStockWriter.test.ts` (2) asserts NO `stock`/`stock_ledger` write exists outside the engine + the 4 workflows call it; `stockWorkflow.test.ts` 7/7, `stockIn.baseline` 9/9, `manualEntry.baseline` 7/7, `cancelOrder.baseline` 7/7, `stockMovementEngine.test.ts` 22/22. NO firestore.rules change → INVENTORY-03 emulator surface stands (`stockAdjustTransaction` + `stockRoleMatrix` + engine emulator re-run green). | **P1-4 CLOSED — one stock writer.** `stockWorkflow.stockIn` → thin wrapper over `applyStockMovement` (sourceType map: purchase→PURCHASE_RECEIPT, return→SALES_RETURN_IN, adjustment→ADJUSTMENT_IN + reasonCode); its Phase-00 demo transaction + the configured `runTransaction` are **DELETED**. `useInventory.useSaveStockEntry` → `applyStockMovement` (IN→ADJUSTMENT_IN, OUT→ADJUSTMENT_OUT, reasonCode from `reference`/`notes`, `reference` kept on the row via `ledgerExtra`); its `runTransaction` is DELETED. `stockWorkflow.cancelOrder` restore loop → `applyStockMovement('SALES_RETURN_IN', sourceType:'order_cancel', sourceId:'{orderId}:{dispatchId}:{productId}')`; the old "scan existing `CANCEL:` ledgers" guard is replaced by the engine's in-txn idempotency (`result.applied` drives `restoredItems`). `cancelOrder`'s INVENTORY-04 order+dispatch **status** `runTransaction` is untouched (not a stock write). Manual entries stay NON-idempotent (`stockIn`/`useSaveStockEntry` mint a fresh idempotency key per call unless an explicit `sourceId` is given). `resolveStockSummaryDocumentId` MOVED into `stockMovementEngine.ts` (breaks the `engine → stockWorkflow → engine` cycle) + re-exported from `stockWorkflow.ts`. `stockIn` still has 3 UI callers (`ProductDetailDrawer`, `ProductDetailsModal`, `MobileStockWorkspace`) + `cancelOrder`; signature unchanged. NEW: `singleStockWriter.test.ts`. Baseline tests rewritten to the engine shape (behaviour identical, P1-1 for an explicit `sourceId` now fixed). |
| **INVENTORY-09** | 2026-09-05 | *3 SEPARATE commits on top of 08 `6cfdeb5`: `ef7b08b` (SKU lock) → `d5c27e3` (category-id) → delete guards (`91eb2b0`)* | **PASS** — see `INVENTORY_REGRESSION_MATRIX.md` "09 STATUS" for the full write-up (SKU lock: `product_sku_locks`, atomic client + Admin-API creation, mirrors `customer_phone_locks`; `categoryId`/`parentCategoryId` FK + rename cascade, historical snapshots verified untouched; delete guards for product/category/warehouse/vendor, read-only; P1-7 id-collision guard; **found + fixed a real pre-existing `resource == null` gap in the generic rules fallback**, surfaced by the new transactional product-id read, fixed with the established pattern, zero regression across ~30 collections). `productSkuLock.test.ts` 10/10, `masterDataGuards.test.ts` 24/24, `useCategories.test.ts` 10/10, `vendorWorkflow.test.ts` +3, `productSkuLock.emulator.test.ts` **9/9 — real concurrent-runTransaction proof of company-scoped SKU uniqueness**. Full emulator regression (batched, 3 sub-batches) 100%; full vitest 263 files, **29-fail/65-fail brittle baseline UNCHANGED** (+47 passing). tsc exit 0, lint 3 pre-existing, build exit 0. | **INVENTORY-09 — Master Data Integrity.** Full change list, file-by-file, is in `INVENTORY_REGRESSION_MATRIX.md`'s "09 STATUS" row (kept there to avoid duplicating ~600 words in two places). Headline pieces: `src/lib/inventory/skuLock.ts` (pure) + `src/lib/inventory/masterDataGuards.ts` (pure, read-only, all 4 delete guards) + `api/_lib/productSkuLock.ts` (Admin-SDK mirror of the client lock, closes the REST API's create/update SKU bypass) + `useInventory.ts`/`useCategories.ts`/`useWarehouses.ts`/`vendorWorkflow.ts` wiring + `CategoriesWorkspace.tsx`/`MobileCategoryWorkspace.tsx` consolidated onto the ONE shared category workflow (a real pre-existing 3-way duplicate — desktop inline, mobile inline, and dead `useCategories.ts` hooks — eliminated) + two dry-run-first backfill scripts (`backfill-category-ids.ts`, `backfill-sku-locks.ts`) + `firestore.rules` (`product_sku_locks` block + the generic-fallback `resource==null` fix). Movement engine, reservation workflow, transfer workflow, and dispatch/GRN quantity logic — all UNTOUCHED, re-verified green. **Known residual gap (documented, not a Phase-09 blocker):** the REST API's product soft-`DELETE` still bypasses the app-layer delete guard (out of §A's named scope, which was the create SKU-bypass only). |
| **INVENTORY-08** | 2026-09-04 | *SEPARATE commit, after 06+07 `de5902e`* | **PASS** — new `stockTransferTransaction.emulator.test.ts` **13/13** (L1–L5, INV-11 vs real stock/ledger, double-ship + double-receive idempotent, **concurrent ship → one effect**, **concurrent ship racing last units → no negative stock**, partial receipt source −10/dest +8/loss visible, Admin both-legs, Sales DENIED at the `stock` guard, warehouse-restricted cannot ship another warehouse, cross-company create DENIED both directions, cross-company read DENIED, identity immutable, delete DENIED, ledger immutable, suspended-group DENIED). New `warehouseTransferWorkflow.test.ts` **18/18** (lifecycle 1–12, validation 13–20, idempotency 21–26, cancel 27–31, partial receipt 32–37, reservation compat 45–46). `stockReconciliationEngine.test.ts` **30/30** (+5 transfer/INV-11). Emulator regression (batched): inventory batch 9 files / 102 tests + security batch 4 files / 417 tests — 100%. Full vitest 260 files, **29-fail / 65-fail brittle baseline UNCHANGED** (+23 passing). tsc exit 0, lint 3 pre-existing attendance, build exit 0. | **INVENTORY-08 — Warehouse Transfer.** New collection `stock_transfers/{TRF-*}` (`companyId`, `groupId`, `fromWarehouseId`, `toWarehouseId`, `warehouseIds[]`, `items[{productId,qty,unit,shippedQty?,receivedQty?}]`, `status: draft\|in_transit\|received\|cancelled`, `hasShortfall?`/`shortfallQty?`, shipped/received/cancelled actor+timestamp). New `src/features/warehouses/services/warehouseTransferWorkflow.ts` + `types/stockTransfer.ts` + `hooks/useStockTransfers.ts` + page `src/pages/WarehouseTransfersWorkspace.tsx` (route `/stock-transfers`, nav under Inventory). **createTransfer** validates same-company + both warehouses real + products real + qty>0 + from≠to; draft, NO stock effect. **shipTransfer** → `applyStockMovements(TRANSFER_OUT[] @ from, transferParticipant)`, status `in_transit` + `shippedQty`; a multi-line ship where one line is short commits NOTHING. **receiveTransfer(id, receivedQuantities?)** → `applyStockMovements(TRANSFER_IN[] @ to, transferParticipant)` for the qty that ARRIVED (default = full); partial → `receivedQty` per line + `hasShortfall`/`shortfallQty` on the doc (loss surfaced, not erased). **cancelTransfer** → `draft`: doc flip; `in_transit`: compensating `TRANSFER_IN` back to source (key `TRANSFER_IN:transfer_cancel:{TRF}:{pid}`), status `cancelled`. **Engine (`stockMovementEngine.ts`): NO change** — `TRANSFER_OUT`/`TRANSFER_IN` already in `MOVEMENT_DIRECTION`; INV-1 guards the source, Phase-07 INV-3 (final per-summary state) blocks a transfer that would drop onHand below reservedQty. The `transferParticipant` (a `MovementParticipant`) flips the `stock_transfers` doc status ATOMICALLY inside the engine's runTransaction; `validate` returns `false` (benign skip) when already in the target status → ship/receive/cancel are idempotent + deterministic-keyed. **INV-11:** a completed transfer's `Σ(TRANSFER_OUT + TRANSFER_IN) == 0` machine-verified vs the actual `stock_ledger`. **Reconciliation (additive, Phase-06/07 math untouched):** `stockReconciliationMath.computeTransferReconciliation` (PURE) + `StockReconciliationEngine.reconcileTransfers()` — `in_transit` = expected outstanding movement (NOT drift), `received` with unbalanced pair = `loss_in_transit` for a human RECONCILE_ADJUST; `StockLedgerRowLike` gains `transferId`/`sourceType`. **firestore.rules:** new `warehouseIdInCompany(whId, companyId)`; new `match /stock_transfers` block (company+group read; LEAN `warehouseActorCanCreate/Update` + inventory-role `actorRoleMatches`; BOTH warehouses must exist AND belong to the doc company → no cross-company; warehouse-restricted actor limited to transfers touching their own warehouse; identity immutable; `delete: if false`); `stock_transfers` added to `isSpecialCollection()`. Physical stock writes still go through the existing `match /stock` guard (a Sales ship is DENIED there). `firestore.ts`: `COLLECTION_PERMISSION_MODULE[STOCK_TRANSFERS]='stock'`. **firestore.indexes.json:** 3 additive composites. `collections.ts`: `STOCK_TRANSFERS`. `types/index.ts`: unchanged (transfer types live in the warehouses feature). **Operational note:** a transfer's two legs need an inventory operator — Warehouse@source ships + Warehouse@dest receives, OR a warehouse-any operator (Admin/GroupAdmin/Procurement) for both — a source-warehouse user cannot create the destination stock summary (`match /stock` `sameWarehouse`, existing Phase-3 isolation). Manual verification = the emulator L1/L2/L3 lifecycle test (real Firestore + real transactions + persisted-state assertions — the exact §24 checklist). **Rollback:** revert the commit + feature-flag the `/stock-transfers` route; in-transit transfers complete manually via the engine. Committed SEPARATELY after 06+07. |
| **INVENTORY-07** | 2026-09-04 | *committed with 06 as `de5902e`* | **PASS** — new `stockReservationTransaction.emulator.test.ts` **15/15** (M1–M8, partial dispatch, cancel release, **real concurrent runTransaction M4: 7+3, total==onHand, never over-reserve**, Sales ALLOW / Manager DENY / cross-company DENY, reservation-doc + ledger immutability, legitimate consume-update ALLOW, full B2B/B2C inventory-spine SMOKE). `stockMovementEngine.test.ts` **30/30** (+8 Phase-07). New `reservations.test.ts` **9/9**, `markPIAsPaidReservation.test.ts` **4/4**. `stockReconciliationEngine.test.ts` **25/25** (+4 reserved-reconcile). Emulator regression (batched): `stockRoleMatrix` / `stockAdjustTransaction` / `dispatchStockOutTransaction` / `grnReceiptTransaction` / `orderLifecycleTransaction` / `stockMovementEngine` / `stockReconciliation` / `multiTenantSecurity` / `sensitiveCollectionsRoleEnforcement` / `rbacPhase8CumulativeSecurity` / `groupAdminFullGroupAccess` / `phase8GroupPerformance` / `firestoreDemoIsolation` / `settingsPersonalOwnershipBackfillFix` / `rolesSystemRolePermissionEditFix` / `missingIsSuperAdminFieldFix` / `attendanceRules` / `biometricFaceReferences` / `leadCreationProjectionWrites` — **20 files, all green when batched** (one cold 9-suite run flaked 2, re-verified clean per BRAIN §2.1). Full vitest: 259 files, **29-fail / 65-fail brittle baseline UNCHANGED**, +97 passing. tsc exit 0, lint 3 pre-existing attendance, build exit 0. | **INVENTORY-07 — Sales Reservation / Allocation.** `reservationsEnabled` flag ACTIVATED (`src/lib/inventory/reservationConfig.ts`; default ON — the activation phase; rollback = flip the constant). New `stock_reservations/{RSV-enc(key)}` collection + `firestore.rules` block + 5 `firestore.indexes.json` composites; added to `isSpecialCollection()` / `WAREHOUSE_SCOPED_COLLECTIONS` / `COLLECTION_PERMISSION_MODULE`. Engine `stockMovementEngine.ts`: `SALES_RESERVE`/`SALES_RELEASE` honour `input.reservationsEnabled ?? isReservationsEnabled()`; new `clampToStock` grants `min(qty, onHand−reserved)` / `min(qty, reserved)` inside the plan (partial reservation M3; stale-safe consume/release); flag OFF → RESERVE/RELEASE are benign no-ops; INV-3 checked on the FINAL per-summary plan state; `availableQty = onHandQty − reservedQty` after every movement (INV-4). New `src/lib/inventory/reservations.ts` (participants + input builders + `applyReservationDelta`). `invoiceWorkflow.markPIAsPaid` → `reserveStockForPaidOrder` (after the payment txn; `applyStockMovements(SALES_RESERVE[], reserveParticipant)`; fulfilment warehouse = `order.fulfilmentWarehouseId||order.warehouseId`, locked; missing → `reservationStatus:'deferred_no_warehouse'`, payment never failed; shortfall merged into `order.stockShortfall[]`; idempotent). `dispatchWorkflow.executeAndVerifyDispatch` → reads order reservations once, `SALES_RELEASE`(dispatch_consume) per verified line in the SAME engine batch, `dispatchDocParticipant` updates the reservation docs; only DISPATCH_OUT results bump order line qty. `stockWorkflow.cancelOrder` → `SALES_RELEASE`(order_cancel) for the unconsumed remainder + `reservationUpdateParticipant` marks `released` (alongside SALES_RETURN_IN; no double count). Reconciliation ADDITIVE: `stockReconciliationMath` gains `storedReserved`/`expectedReserved`/`reservedDelta`/`reservedReconciled`; `StockReconciliationEngine` + `scripts/inventory/reconcile.ts` fetch `stock_reservations`; `generateStockHealthReport` reports `reservedMismatchCount`. Migration `scripts/inventory/backfill-onhand.ts` (dry-run default / `--apply`; start-clean, no retro-reserve; never deletes / never touches ledger; flags + skips ledger-complete mismatches). `firestore.rules`: `match /stock` update gains a reservation-only branch for Sales/Accounts (operational role-match still short-circuits first — E7 neutral); new `match /stock_reservations` block (warehouse+company scoped, `resource==null`, create role-gated, update `hasOnly` accounting fields + identity immutable, `delete: if false`). UI: `StockWorkspace` ON HAND column; `OrdersWorkspace` Stock Reservation panel + shortfall. `types/index.ts`: additive `order.fulfilmentWarehouseId` / `reservationStatus` / `reservedAt` / `stockShortfall[]`. Baseline tests updated for the INV-4 semantic flip (`stockIn` / `manualEntry` / `dispatchOut` / `stockWorkflow`: `availableQty` now `onHand−reserved` where a fixture seeded a non-zero `reservedQty` — expectations intentionally changed). NOT committed. |
| **INVENTORY-06** | 2026-09-04 | *committed with 07 as `de5902e`* | **PASS** — new `stockReconciliation.emulator.test.ts` **6/6** (F4 report writes 0; F5 Admin RECONCILE_ADJUST applies+audits+reconciles; F5 idempotent per run-id; F5 Sales-role DENIED — nothing written; F5 cross-company DENIED; F5 correction ledger row immutable). `stockReconciliationEngine.test.ts` **21/21** (classification, detection 1–11, correction 12–20, F4 read-only). `singleStockWriter.test.ts` still green (engine `auditReconciliation` flag is additive). NO firestore.rules change → INVENTORY-03 emulator surface stands. | READ-ONLY `src/engines/StockReconciliationEngine.ts` — `reconcileSummary(id)` / `reconcileWarehouse(id)` / `generateStockHealthReport()` compute `computed = Σ(operational IN qty) − Σ(operational OUT qty)` from `stock_ledger` (reservation rows ignored; **RECONCILE_ADJUST rows EXCLUDED** so a correction genuinely reconciles) and compare to `stock.onHandQty`; return `{ stored, computed, reconcileAdjustTotal, delta, reconciled, ledgerRowCount, unclassifiedRowCount, firstMovementAt, lastMovementAt, ledgerComplete, note }`. `ledgerComplete=false` (no operational rows / an unclassifiable row) → flagged **likely pre-engine opening balance**, not real drift. Classifier `ledgerRowOnHandDelta`: `direction` → `movementType` → legacy `type`; RECONCILE_ADJUST sign from `direction` (engine writes qty ABSOLUTE). Pure math extracted to `src/engines/stockReconciliationMath.ts` (**zero imports**) — reused by the engine + `scripts/inventory/reconcile.ts` (no second implementation). **Correction:** `applyReconciliationCorrection({ summaryId, targetOnHand?, reasonCode, reconciliationRunId, approvedBy? })` — `canDo('edit','stock')` + reason + run-id required; `correctionQty = (targetOnHand ?? computed) − stored` (SIGNED, sign NOT reversed); calls `applyStockMovement('RECONCILE_ADJUST', qty, idempotencyKey:'RECONCILE_ADJUST:reconciliation:{runId}:{summaryId}', ledgerExtra:{ reconciliationRunId, approvedBy, reconciledFromOnHand, reconciledToOnHand, referenceType:'StockReconciliation' })` → engine writes stock+ledger (audit trail: the RECONCILE_ADJUST row stays in the ledger), idempotent per (run-id × summary); `logActivity('Stock','Reconciliation Correction', …)`. Engine change: `+auditReconciliation: true` on RECONCILE_ADJUST ledger rows (additive). UI: `src/features/stock/components/StockReconciliationReport.tsx` (read-only report + correction confirm dialog) wired into `StockWorkspace` "Reconcile" button (`canDo('view','stock')`; corrections `canDo('edit','stock')`). `scripts/inventory/reconcile.ts` — read-only CLI (Firestore REST, zero writes). **NO auto-correction anywhere** (Plan §17). NO rules/indexes/schema change (RECONCILE_ADJUST rows are normal movement rows + a flag). |

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
ff45262  feat(inventory): dormant stock movement engine + adapter (INVENTORY-05a)
d5010e2  refactor(inventory): generic transaction participant for the movement engine (INVENTORY-05a.1)
e01819a  refactor(inventory): GRN receipt via movement engine (INVENTORY-05b)
8432c22  refactor(inventory): dispatch stock-out via movement engine (INVENTORY-05c)
6939c12  refactor(inventory): single writer — retire duplicate stock transaction (INVENTORY-05d, P1-4)
de5902e  feat(inventory): stock reconciliation + sales reservation (INVENTORY-06, INVENTORY-07)
6cfdeb5  feat(inventory): warehouse transfer with paired movements (INVENTORY-08)
ef7b08b  feat(inventory): product SKU uniqueness lock (INVENTORY-09)
d5c27e3  feat(inventory): category id integrity + rename cascade + backfill (INVENTORY-09)
781926c  feat(inventory): master-data delete guards (INVENTORY-09)
0391a4f  feat(inventory): INVENTORY-10 §10a/§10b — opening stock + damage write-off
c640b8a  feat(inventory): INVENTORY-10 §10d — low-stock threshold notification
788f89a  feat(inventory): INVENTORY-10 §10e — customer return / RMA
f791b6b  feat(inventory): INVENTORY-10 §10c — bulk stock import / bulk adjust
c980d18  feat(inventory): INVENTORY-10 §10a/§10b UI — Opening Stock + Damage entry types
b13dc0f  feat(inventory): INVENTORY-10 §10c UI — Bulk Stock Adjust (CSV import)
b222416  feat(inventory): INVENTORY-10 §10e UI — Process Customer Return
ee73df0  docs(inventory): checkpoint STATE + regression matrix for INVENTORY-10
2b4d3dd  feat(inventory): INVENTORY-11 §11a — transactional dispatch serial lock
275f21b  feat(inventory): INVENTORY-11 §11b — composite indexes + loud index fallback   (current HEAD — carries this STATE + regression-matrix update)

PRE-05a git checkpoint (2026-09-04): the earlier session committed only Phase-04 (as 30920c2)
while -01/-02/-03 sat uncommitted, so history was out of phase order. Reconciled by a SAFE
LOCAL rebuild — `git reset --mixed c043009` (working tree untouched) then re-commit each phase
in order. No `--hard`, no `clean`, no force-push, no remote change. The `firestore.rules` and
`vitest.emulator.config.ts` cross-phase diffs were split by reconstructing the file content
between commits (verified byte-exact against the pre-checkpoint working tree). Old commit
30920c2 is preserved on branch `pre-05a-backup-head`; a full pre-checkpoint tracked-tree
snapshot is tag `pre-05a-worktree-snapshot`.

LAST VERIFIED COMMIT = INVENTORY-11's §11b commit, `275f21b` (HEAD at this checkpoint).
Uncommitted in the working tree: the SAME 4 unrelated pre-existing changes as every prior
checkpoint (LEADS_UI_UX delete, ProfileSection.tsx, useMyProfile.ts, userProfile.ts) + untracked
BRAIN.md / COMPLETE_INVENTORY_INTEGRITY_AUDIT.md — confirmed unchanged by this phase (Phase-11
never touched any of the 4, never read/wrote BRAIN.md or the audit doc). ZERO inventory
implementation files are uncommitted.
```

---

## CURRENT OBJECTIVE

```
INVENTORY-00..05d committed (through 6939c12). INVENTORY-06 + INVENTORY-07 committed
TOGETHER as `de5902e`. INVENTORY-08 (warehouse transfer) committed separately as `6cfdeb5`.
INVENTORY-09 (master-data integrity) committed as 3 separate commits: `ef7b08b` (SKU lock),
`d5c27e3` (category-id integrity), and this checkpoint's delete-guards commit. `reservationsEnabled`
is ON by default. The next authorized phase is INVENTORY-10 — it requires its own explicit
go-ahead; do NOT start it from this file alone. Two backfills remain un-run against live data
(reviewed, dry-run-first scripts exist for both — run against a copy first): the Phase-07
`onHandQty` backfill (`scripts/inventory/backfill-onhand.ts`) and the Phase-09 `categoryId`
backfill (`scripts/inventory/backfill-category-ids.ts`) + SKU-lock backfill
(`scripts/inventory/backfill-sku-locks.ts`).
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

## WHAT WAS CHANGED (INVENTORY-05a.1 — generic transaction participant)

```
WHY: the 05b GRN migration hit a hard blocker — Phase-03's GRN is ONE runTransaction over
     stock + stock_ledger + purchase_orders (the INV-13 over-receipt check reads the PO in
     the SAME txn that writes stock). The 05a engine's txn covered only stock + stock_ledger,
     so a naive migration would move the over-receipt check into a second txn AFTER the stock
     write → a concurrent 7+6 over-receipt could strand stock. The approved resolution is a
     GENERIC transaction-participation capability (NOT PO-specific).

ENGINE (src/lib/inventory/stockMovementEngine.ts — rewritten, still no caller):
  - NEW `applyStockMovements(inputs: StockMovementInput[], participant?): Promise<BatchMovementResult>`
    — ONE runTransaction (configured branch) covering EVERY (stock summary + ledger row) in
    the batch, coalesced per stock summary (one summary write per distinct product/warehouse,
    one ledger row per input), PLUS the participant.
  - `applyStockMovement(input, participant?)` is now `applyStockMovements([input], participant)[0]`.
  - Participant lifecycle inside the txn: READ (`participant.read(ctx)` — `ctx.get(collection,id)`
    does `transaction.get`) → PLAN (engine computes per-input applied/no-op + onHand/reserved
    before/after) → VALIDATE (`participant.validate(ctx, plan)` — throw = abort with error;
    return `false` = benign skip, nothing written) → INV-1/2/3 assert on applied entries →
    WRITE (engine writes stock + ledger) → COMMIT (`participant.commit(ctx, plan, writer)`).
  - `MovementWriter` handed to commit REJECTS `collection === STOCK || STOCK_LEDGER`
    (`assertParticipantCollection` throws) — the engine is the SOLE owner of stock/ledger.
    Configured: forwards to `transaction.set/update`. Demo: queues `createDocWithId`/
    `updateDocById` and awaits them after `commit` returns.
  - Legacy dual-write extended: `beforeQty`/`afterQty` (aliases of onHandBefore/After — the
    StockLedgerWorkspace "Before"/"After" columns read these) + a generic `input.ledgerExtra`
    pass-through merged last onto the ledger row (GRN uses it for `referenceType:'GoodsReceipt'`,
    `purchaseOrderId`, `grnLineIndex`, `grnPreviouslyReceivedQty`). The engine never
    interprets `ledgerExtra`.

TYPES (src/lib/inventory/types.ts): `MovementReadContext`, `MovementWriter`, `MovementParticipant`,
  `MovementPlanEntry`, `BatchMovementResult`; `StockMovementInput.ledgerExtra?`; `MovementResult.skipped?`.

TESTS:
  src/lib/inventory/__tests__/stockMovementEngine.test.ts — +8 (`ledgerExtra`; participant
    read/validate/commit atomic; validate-throw aborts everything; validate-false benign skip;
    participant may NOT write stock/stock_ledger; idempotent-with-participant; multi-line batch).
  src/lib/inventory/__tests__/stockMovementEngine.emulator.test.ts — +3 (participant PO write
    atomic under CURRENT rules; validate-throw aborts stock+ledger+PO; **concurrent 7+6
    over-receipt → one aborts entirely, Σledger == PO.receivedQty, no stranded stock**).

NO caller migrated (05b/05c/05d). NO firestore.rules / firestore.indexes change.
```

---

## TEST RESULTS (INVENTORY-05a.1)

```
TYPECHECK:  npx tsc --noEmit -> 3 errors, ALL pre-existing (attendancePhase11/12,
            attendanceRuleEngine). ZERO in any INVENTORY-05a.1 file.
UNIT (focused): npx vitest run src/lib/inventory/__tests__/stockMovementEngine.test.ts
            -> 22/22 (15 prior + 7 new).
FIRESTORE / EMULATOR: stockMovementEngine.emulator.test.ts -> 11/11 (JBR java).
            NO rules change -> the INVENTORY-03 emulator surface stands.
```

---

## WHAT WAS CHANGED (INVENTORY-05b — GRN → movement engine)

```
PRODUCTION SOURCE (1 file):
  src/features/procurement/services/goodsReceiptWorkflow.ts
    - DELETED the Phase-03 local `applyGrnReceipt` runTransaction over
      stock + stock_ledger + purchase_orders. NEW `applyGrnReceipt`:
        applyStockMovements(receiptMovementInputs(grnId, receivedItems, ctx),
                            grnPurchaseOrderParticipant(ctx, capture))
      One PURCHASE_RECEIPT movement per received line + the PO participant, ONE
      engine runTransaction.
    - grnPurchaseOrderParticipant: read() re-fetches the PO INSIDE the txn;
      validate() re-checks `Σ received + Σ applied ≤ ordered` per line (INV-13,
      P1-2) and PO receivable (P1-5) — throw aborts the WHOLE txn; commit()
      increments items[].receivedQty off the FRESH PO (never a stale array) +
      recomputes status, via the engine's guarded MovementWriter (which rejects
      stock / stock_ledger). `capture.status` carries the new PO status back out.
    - receiptMovementInputs: movementType PURCHASE_RECEIPT, sourceType
      'goods_receipt', sourceId = the deterministic grnId (encodes each line's
      before+qty), lineKey = PO line index. idempotencyKey =
      PURCHASE_RECEIPT:goods_receipt:{grnId}:{lineIndex}; ledger id STKMV-{enc(key)}.
      ledgerExtra: referenceType:'GoodsReceipt', referenceId, purchaseOrderId,
      product, warehouse, grnLineIndex, grnPreviouslyReceivedQty (legacy consumer
      + reconcile compatibility).
    - reconcileMissingGrnDocs: reads `row.grnLineIndex` / `row.grnPreviouslyReceivedQty`
      (falls back to the INVENTORY-03 sourceId / idempotencyKey parse for old rows).
    - Demo + configured branches UNIFIED — both call `applyGrnReceipt` (the engine
      branches internally). `reconcileMissingGrnDocs` + `requestMatchesCompletedGrn`
      stay configured-only (need collection queries); demo keeps its `getOne(grnId)`
      dedupe.
    - REMOVED exports: grnReceiptLedgerId, grnReceiptIdempotencyKey (Phase-03
      ledger-id scheme, superseded by the engine). REMOVED: lineMetaFor / LineMeta.
    - createGoodsReceipt SIGNATURE UNCHANGED — no `useGoodsReceipts` / UI / mobile
      change. Product + warehouse + tenant validation UNCHANGED.

FIRESTORE RULES / INDEXES: NONE (the engine's write shape — incl. the participant
  `purchase_orders` write — passes the INVENTORY-03 rules unchanged; emulator-proven).

TESTS:
  src/lib/__tests__/grnReceiptTransaction.emulator.test.ts — the `grnReceiptTxn`
    helper rewritten to mirror the engine+participant shape (ledger id, unified
    schema, participant PO write). ALL 16 Phase-03 cases unchanged and green.
  src/features/procurement/services/goodsReceiptWorkflow.test.ts — dropped the
    removed-helper assertion; +1 test asserting the new unified ledger schema
    (movementType/direction/onHandBefore-After + legacy type/referenceType/
    beforeQty/afterQty/grnLineIndex). Behaviour assertions (J6–J9, over-receipt,
    idempotency, PO status) unchanged.
  src/lib/inventory/__tests__/baseline/grn.baseline.test.ts — unchanged, still
    green (the P1-5 demo write-order — stock, ledger, stock, ledger, PO, GRN doc —
    is preserved by the engine's demo branch + participant).
```

---

## TEST RESULTS (INVENTORY-05b)

```
TYPECHECK:  npx tsc --noEmit -> 3 errors, ALL pre-existing. ZERO in any -05b file.
BUILD:      npm run build -> SUCCESS (exit 0).
UNIT (full): npx vitest run -> 255 files (226 | 29) ; 3492 tests (3427 | 65).
            SAME 29-file / 65-test brittle baseline (BRAIN §35). No GRN/engine/
            procurement file failing. +7 net vs pre-05 (05a.1 tests).
UNIT (focused): procurement suite + grn.baseline + stockMovementEngine.test.ts +
            engines -> 7 files / 48 tests, 100%.
FIRESTORE / EMULATOR: grnReceiptTransaction.emulator.test.ts -> 16/16 (JBR java) —
            migrated shape, all Phase-03 cases green incl. concurrent 7+6.
            stockMovementEngine.emulator.test.ts -> 11/11.
            NO rules change -> INVENTORY-03 emulator surface stands.
```

---

## WHAT WAS CHANGED (INVENTORY-05c — dispatch stock-OUT → movement engine)

```
PRODUCTION SOURCE (1 file):
  src/lib/dispatchWorkflow.ts
    - DELETED the Phase-01 local runTransaction over dispatch + per-line stock +
      per-line stock_ledger. executeAndVerifyDispatch now builds one DISPATCH_OUT
      StockMovementInput per verified line and calls
        applyStockMovements(inputs, dispatchDocParticipant(dispatchId, verifiedItems, actorId, now))
    - dispatchDocParticipant: read() re-fetches the dispatch INSIDE the txn;
      validate() returns FALSE if the dispatch is already terminal (benign skip →
      alreadyVerified, no stock decrement, no order re-bump); commit() writes
      { status:'Dispatched', items: verifiedItems, verifiedBy, dispatchedAt,
      updatedBy } via the engine's guarded MovementWriter (which rejects stock /
      stock_ledger). This preserves the Phase-01 atomic boundary — stock + ledger
      + dispatch status commit together.
    - The sequential double-click pre-check (TERMINAL_DISPATCH_STATUSES → throw
      "already been verified") stays. assertNoDuplicateSerials +
      assertDispatchReferencesValid (P1-6) unchanged.
    - The order-items dispatchedQty/pendingQty update + project installation patch
      + logActivity + notifyUsers stay AFTER the engine call (Phase-01 shape —
      Plan §811 "keep the order-items/dispatch-doc update sequence").
    - Insufficient-stock: the engine's INV-1 guard aborts the whole batch; the
      catch re-wraps it as "Insufficient stock for {product}. …" (Phase-01 phrasing).
    - Zero-line verify (all verifiedQty ≤ 0) and the all-idempotent-no-op case:
      the engine short-circuits before the participant, so the dispatch status is
      flipped by a direct updateDocById(DISPATCH, …) (Phase-01 parity — a
      `dispatch`-doc write, NOT a stock write).
    - dispatchOutLedgerId(dispatchId, productId) reimplemented as
      movementLedgerId(buildIdempotencyKey('DISPATCH_OUT','dispatch',id,productId))
      → STKMV-{enc(DISPATCH_OUT:dispatch:{id}:{productId})}. The idempotency KEY is
      byte-identical to INVENTORY-01's; only the doc id changed.
    - Removed now-unused imports: resolveWriteGroupId, stockSummaryId.

FIRESTORE RULES / INDEXES: NONE (the engine's write shape + the participant
  `dispatch` write pass the INVENTORY-01/03 rules unchanged; emulator-proven).

TESTS:
  src/lib/__tests__/dispatchStockOutTransaction.emulator.test.ts — `verifyLineTxn`
    rewritten to mirror the engine+participant shape (unified ledger schema,
    participant dispatch write). ALL 8 Phase-01 cases unchanged and green
    (incl. the stock=1 two-concurrent-verify test).
  src/lib/__tests__/dispatchWorkflow.test.ts — the stock-write assertions moved
    from updateDocById('stock',…) to createDocWithId('stock',…, {onHandQty,availableQty});
    the ledger-shape test now asserts the DISPATCH_OUT unified + legacy fields +
    the participant dispatch flip. Behaviour assertions (serial dedup, P1-6,
    insufficient, idempotent, terminal guard) unchanged.
  src/lib/inventory/__tests__/baseline/dispatchOut.baseline.test.ts — ledger id +
    stock-write assertions updated to the engine shape; behaviour identical.
```

---

## TEST RESULTS (INVENTORY-05c)

```
TYPECHECK:  npx tsc --noEmit -> 3 errors, ALL pre-existing. ZERO in any -05c file.
BUILD:      npm run build -> SUCCESS (exit 0).
UNIT (full): npx vitest run -> 255 files (226 | 29) ; 3492 tests (3427 | 65).
            SAME 29-file / 65-test brittle baseline (BRAIN §35). No dispatch/engine
            file failing.
UNIT (focused): dispatchWorkflow.test.ts 13/13, dispatchOut.baseline 11/11,
            stockMovementEngine.test.ts 22/22, goodsReceiptWorkflow + grn.baseline green.
FIRESTORE / EMULATOR: dispatchStockOutTransaction.emulator.test.ts -> 8/8 (JBR java).
            NO rules change -> INVENTORY-03 emulator surface stands.
```

---

## WHAT WAS CHANGED (INVENTORY-05d — manual + cancel → engine; retire the duplicate writer)

```
PRODUCTION SOURCE (3 files):
  src/lib/stockWorkflow.ts
    - `stockIn` REWRITTEN as a thin wrapper over `applyStockMovement`. Its
      Phase-00 demo transaction AND its configured `runTransaction` are DELETED.
      sourceType → movement type: purchase → PURCHASE_RECEIPT, return →
      SALES_RETURN_IN, adjustment → ADJUSTMENT_IN (+ a reasonCode from notes).
      Idempotency key `{movementType}:{sourceType}:{sourceId || genId('STK')}` —
      a fresh key when no explicit sourceId (Phase-00 "no idempotency" parity);
      an explicit sourceId now dedups (P1-1 improvement). Returns
      { stockId, ledgerId, transactionId:'', beforeQty, afterQty } (compatible).
    - `cancelOrder` restore loop → `applyStockMovement('SALES_RETURN_IN', {
      sourceType:'order_cancel', sourceId:'{orderId}:{dispatchId}:{productId}',
      ledgerExtra:{ referenceType:'OrderCancel', referenceId, dispatchId } })`.
      The old "scan existing CANCEL: ledgers + a Set" guard is REMOVED — the
      engine's in-txn `transaction.get(ledgerRef)` is the idempotency; `result.applied`
      decides whether the line goes into `restoredItems`. The INVENTORY-04
      order+dispatch STATUS `runTransaction` is untouched (not a stock write).
    - `resolveStockSummaryDocumentId` MOVED to `stockMovementEngine.ts` (the
      engine can no longer import `stockWorkflow` once `stockWorkflow` imports the
      engine — cycle); `stockWorkflow.ts` re-exports it (`export { … }`).
    - Removed now-unused imports: createDocWithId, resolveWriteGroupId, sanitize
      (kept — used by cancelOrder), stockSummaryId.
  src/features/inventory/hooks/useInventory.ts
    - `useSaveStockEntry` REWRITTEN to call `applyStockMovement` (IN →
      ADJUSTMENT_IN, OUT → ADJUSTMENT_OUT; reasonCode = reference || notes ||
      "Manual stock {type}"; `reference` / `product` / `warehouse` / `date` kept
      on the ledger row via `ledgerExtra`). Its `runTransaction` is DELETED.
      A fresh idempotency key per submission (no dedupe — Phase-00 parity).
      Removed `resolveWriteGroupId` import. `stockSummaryId` import kept
      (still used by `canonicalizeStockSummary`).
  src/lib/inventory/stockMovementEngine.ts
    - `resolveStockSummaryDocumentId` added here (exported). Demo branch now
      reads the summary from its own `getAll(stock)` result before falling back
      to `getOne` (INVENTORY-05c) — no behaviour change.

FIRESTORE RULES / INDEXES: NONE.

SINGLE-WRITER GUARANTEE (P1-4):
  src/lib/inventory/__tests__/singleStockWriter.test.ts — NEW. Greps the whole
  `src/` tree (excluding `__tests__` and the engine) for a direct `stock` /
  `stock_ledger` write (`createDocWithId(COLLECTIONS.STOCK…)`,
  `updateDocById(COLLECTIONS.STOCK…)`, `transaction.set(stockRef…)`,
  `setDoc(doc(db,'stock'…))`) and FAILS if it finds one. Also asserts GRN /
  dispatch / stockWorkflow / manual all call `applyStockMovement(s)` and that GRN
  no longer opens its own `runTransaction`. This is the permanent guard against a
  second stock writer (Plan §833/§837).

TESTS (rewritten to the engine shape — behaviour identical):
  src/lib/__tests__/stockWorkflow.test.ts               (stockIn + cancelOrder)
  src/lib/inventory/__tests__/baseline/stockIn.baseline.test.ts       (9)
  src/lib/inventory/__tests__/baseline/manualEntry.baseline.test.ts   (7)
  src/lib/inventory/__tests__/baseline/cancelOrder.baseline.test.ts   (7)
```

---

## TEST RESULTS (INVENTORY-05d)

```
TYPECHECK:  npx tsc --noEmit -> 3 errors, ALL pre-existing. ZERO in any -05d file.
BUILD:      npm run build -> SUCCESS (exit 0).
UNIT (full): npx vitest run -> 255 files ; SAME 29-file / 65-test brittle baseline
            (BRAIN §35). No inventory/engine/stock file failing.
UNIT (focused): singleStockWriter 2/2, stockWorkflow 7/7, stockIn.baseline 9/9,
            manualEntry.baseline 7/7, cancelOrder.baseline 7/7, stockMovementEngine 22/22.
FIRESTORE / EMULATOR: NO rules change → the INVENTORY-03 surface stands.
            Re-run: stockAdjustTransaction + stockRoleMatrix + stockMovementEngine.emulator
            (JBR java). The 3 migrated emulator tests (engine 11/11, GRN 16/16,
            dispatch 8/8) all green.
```

---

## FULL PHASE-05 (movement engine) SUMMARY

```
GRN        → applyStockMovements(PURCHASE_RECEIPT[], PO participant)          [05b]
Dispatch   → applyStockMovements(DISPATCH_OUT[], dispatch participant)        [05c]
Manual     → applyStockMovement(ADJUSTMENT_IN | ADJUSTMENT_OUT)               [05d]
stockIn    → applyStockMovement (thin wrapper)                                [05d]
Cancel     → applyStockMovement(SALES_RETURN_IN)                              [05d]

STOCK-SUMMARY WRITER:  ONLY src/lib/inventory/stockMovementEngine.ts  (singleStockWriter.test.ts)
STOCK-LEDGER WRITER:   ONLY the engine
LEGACY LOCAL TXNS:     all deleted (goodsReceiptWorkflow, dispatchWorkflow stock loop,
                       stockIn, useSaveStockEntry). Only non-stock transactions remain
                       (closeDispatch, confirmDelivery, cancelOrder status, quotation/
                       invoice workflows).
FIRESTORE RULES:       UNCHANGED across 05a → 05d.
UNIFIED LEDGER SCHEMA: every new movement row carries movementType / direction /
                       onHandBefore-After / reservedBefore-After / idempotencyKey +
                       legacy type / referenceType / referenceId / date / beforeQty / afterQty.
MOBILE:                Desktop + Mobile call the same shared workflows → the same engine.
INVARIANTS:            INV-1 (no negative on-hand), INV-7 (1 movement = 1 ledger = 1 delta),
                       INV-8 (injective ledger id), INV-13 (GRN over-receipt, atomic via the
                       PO participant) — all enforced by the engine going forward.
```

---

## WHAT WAS CHANGED (INVENTORY-06 — stock ↔ ledger reconciliation, read-only + human correction)

```
NEW (5 files):
  src/engines/stockReconciliationMath.ts
      PURE, ZERO imports. `ledgerRowOnHandDelta(row)` → { delta, classified, isReconcile }
      (direction → movementType → legacy type; RECONCILE_ADJUST sign from `direction`).
      `computeReconciliation({ storedOnHand, ledgerRows, … })` → SummaryReconciliation.
      `computed` = Σ(operational IN qty) − Σ(operational OUT qty). RESERVE/RELEASE ignored.
      **RECONCILE_ADJUST rows are EXCLUDED from `computed`** (tracked separately as
      `reconcileAdjustTotal`) — they patch `stored`, not the operational history, so a
      correction that brings `stored` to `computed` actually reconciles (post-correction
      delta 0). `ledgerComplete=false` when there are no operational rows (stored != 0) or
      an unclassifiable row exists → the mismatch is flagged "likely pre-engine opening
      balance". Shared by the engine + the CLI script (Plan §26 — one implementation).
  src/engines/StockReconciliationEngine.ts   (mirrors ProcurementValidationEngine)
      re-exports the pure math + Firestore-backed READ-ONLY:
        reconcileSummary(summaryId)   — getOne(stock) + getAll(stock_ledger, product+warehouse)
        reconcileWarehouse(whId)      — getAll(stock, wh) + getAll(stock_ledger, wh) ONCE,
                                        grouped by product (no N×M fan-out)
        generateStockHealthReport()   — all summaries + all ledger once; splits mismatches
                                        into realDriftCount (ledgerComplete) vs
                                        likelyOpeningBalanceCount
      Company / warehouse scope is enforced by getAll/getOne (companyScopedQuery +
      firestore.rules). NOTHING is written by any of these.
      applyReconciliationCorrection({ summaryId, targetOnHand?, reasonCode,
        reconciliationRunId, approvedBy? }):
        - canDo('edit','stock') || throw; reasonCode + reconciliationRunId required.
        - correctionQty = (targetOnHand ?? computed) − stored  (SIGNED; sign NOT reversed —
          Plan §13). `|correctionQty| <= EPS` → { applied:false, alreadyReconciled:true }.
        - applyStockMovement('RECONCILE_ADJUST', qty: correctionQty, unit: summary unit,
          sourceType:'reconciliation', sourceId: runId, lineKey: summaryId,
          idempotencyKey:'RECONCILE_ADJUST:reconciliation:{runId}:{summaryId}',
          reasonCode, ledgerExtra:{ reconciliationRunId, approvedBy, reconciledFromOnHand,
          reconciledToOnHand, ledgerComputedOnHand, referenceType:'StockReconciliation' }).
          Idempotent per (run-id × summary) via the engine's in-txn ledger-exists check.
        - logActivity('Stock','Reconciliation Correction', summaryId, {...}).
        - NEVER writes stock / stock_ledger directly.
  src/features/stock/components/StockReconciliationReport.tsx
      READ-ONLY report (useQuery → generateStockHealthReport) + per-mismatch "Apply
      Correction" (Modal confirm: physical-count Input + required reason Textarea) →
      applyReconciliationCorrection with one reconciliationRunId per opened report.
      Correction UI shown only when canDo('edit','stock').
  scripts/inventory/reconcile.ts
      Standalone READ-ONLY CLI (Firestore REST API + a TOKEN; zero writes). Imports the
      shared pure math. `--company <id>` / `--json`. Exit 0 even with mismatches.
  src/lib/__tests__/stockReconciliation.emulator.test.ts   (6 — F4 / F5)

MODIFIED (2 files):
  src/lib/inventory/stockMovementEngine.ts
      buildLedgerRow: `+auditReconciliation: true` when movementType === 'RECONCILE_ADJUST'
      (additive audit flag — Plan §863). NOTHING else in the engine changed.
  src/pages/StockWorkspace.tsx
      + "Reconcile" hero button (canDo('view','stock')) opening a Modal that renders
      <StockReconciliationReport/>. No other change.
  vitest.emulator.config.ts   (+1 line registering the reconciliation emulator test)

FIRESTORE RULES / INDEXES / STORAGE.RULES: NONE. DATABASE: none new — RECONCILE_ADJUST
  rows are normal `stock_ledger` movement rows (+ the `auditReconciliation` flag +
  reconciliation `ledgerExtra`). NO backfill, NO historical-data rewrite (Plan §17/§25).
  P1-4 single-writer invariant intact — the reconciliation engine only READS; corrections
  go through `applyStockMovement` (singleStockWriter.test.ts still green).
```

---

## TEST RESULTS (INVENTORY-06)

```
TYPECHECK:  npx tsc --noEmit -> exit 0. 3 errors, ALL pre-existing (attendancePhase11/12,
            attendanceRuleEngine). ZERO in any INVENTORY-06 file.
LINT:       npm run lint (tsc --noEmit) -> same.
BUILD:      npm run build -> SUCCESS (exit 0). Pre-existing chunk-size warning only.
UNIT (focused): stockReconciliationEngine.test.ts 21/21; singleStockWriter.test.ts 2/2;
            stockMovementEngine.test.ts 22/22; the -00..-05 baseline / workflow tests green.
UNIT (full): npx vitest run -> SAME 29-file / 65-test brittle baseline (BRAIN §35).
            No reconciliation / engine / stock file among the failures. +1 file
            (stockReconciliationEngine.test.ts).
FIRESTORE / EMULATOR:
            stockReconciliation.emulator.test.ts -> 6/6 (JBR java) — F4 zero-write,
            F5 authorized correction + audit + post-correction reconcile, F5 idempotent
            per run-id, F5 Sales-role DENIED, F5 cross-company DENIED, F5 ledger immutable.
            NO firestore.rules change → the INVENTORY-03 emulator surface stands
            (grn / dispatch / engine / stockRoleMatrix / stockAdjust re-run green).
```

---

## KNOWN REMAINING RISKS (full register in the audit + Plan §2)

```
P0-1  Dispatch stock-OUT non-transactional -> oversell/lost update            *** FIXED (INVENTORY-01 interim; canonical INVENTORY-05c) ***
      executeAndVerifyDispatch now calls applyStockMovements(DISPATCH_OUT[], dispatchDocParticipant)
      — the engine's ONE runTransaction covers every line's stock + stock_ledger write PLUS the
      dispatch-doc status flip (Phase-01 atomic boundary, preserved). Deterministic ledger id
      STKMV-{enc(DISPATCH_OUT:dispatch:{id}:{productId})} → concurrent verifies can't both
      decrement; INV-1 guard aborts the whole batch on a short line. Emulator concurrency-proven
      (migrated shape): stock=1, two verifies -> stock 0, one OUT row, never negative. The
      Phase-01 local dispatch transaction is GONE.
P0-2  REST API PUT /api/stock/:id mutates availableQty, no ledger/txn/rules    *** FIXED (INVENTORY-02) ***
      `stock` + `stock_ledger` are READ-ONLY over the generic REST API — every mutating
      method -> 405 before auth/DB, zero Firestore write. No internal caller was broken
      (none existed). External API-key holders can no longer alter inventory quantities.
      firestore.rules unchanged; SDK stock-writers unchanged (P1-4 still Plan Phase 05).
P0-3  No reservation layer; reservedQty dead; order.stockBlocked unread        (Plan Phase 07)
P1-1  GRN not idempotent -> duplicate stock IN on retry                         *** FIXED (INVENTORY-03; canonical fix INVENTORY-05b) ***
      createGoodsReceipt now calls applyStockMovements('PURCHASE_RECEIPT'[], PO-participant).
      Idempotency is the engine's deterministic ledger doc id
      STKMV-{enc(PURCHASE_RECEIPT:goods_receipt:{grnId}:{lineIndex})} (grnId encodes each
      line's before+qty). A retried / double-submitted / concurrent-duplicate line finds its
      row in-txn and no-ops. Emulator J9 proven against the migrated shape.
P1-2  Concurrent GRNs -> silent over-receipt                                    *** FIXED (INVENTORY-03; canonical fix INVENTORY-05b) ***
      The engine runs ONE runTransaction over every line's stock+ledger PLUS the PO
      participant; the participant re-reads the PO IN-TXN and re-checks Σ received + applied
      ≤ ordered per line (INV-13). Concurrent receipts contend on the stock summary + PO docs
      and serialize; a losing over-receipt's participant.validate throws → the WHOLE engine
      transaction aborts (zero partial mutation). Emulator (migrated shape): 6+6->6, 4+6->10,
      7+6->one aborts entirely, Σledger == PO.receivedQty, no stranded stock.
P1-3  stock field guard BLOCKED Procurement from updating availableQty          *** FIXED (INVENTORY-03) ***
      on an EXISTING summary (CONFIRMED in INVENTORY-00). firestore.rules match /stock update
      field-guard role list now = ONE actorRoleMatches('.*Warehouse.*|.*Operations.*|.*Procurement.*|Admin|GroupAdmin')
      (was 3 calls). Procurement ADDED; Sales/Accounts/Manager stay DENIED (least privilege —
      per the phase instruction, NOT widened for cancel-restore). stockRoleMatrix + J11 emulator-proven.
      NB: the Accounts-can-reach-Verify-but-not-complete dispatch gap (INVENTORY-01) is UNCHANGED
      — deliberately not widened here; a privileged cancel-restore path, if ever needed, is a
      later movement-engine concern.
P1-4  Two parallel stock-write implementations, divergent ledger schemas       *** FIXED (INVENTORY-05a…05d) — ONE WRITER ***
      src/lib/inventory/stockMovementEngine.ts is the SOLE stock/stock_ledger writer. GRN
      (05b), dispatch OUT (05c), manual add/adjust + stockIn + cancel-restore (05d) ALL call
      applyStockMovement(s). Every legacy local stock transaction is deleted. Enforced
      permanently by src/lib/inventory/__tests__/singleStockWriter.test.ts (repo-wide grep:
      no stock/stock_ledger write outside the engine). Unified ledger schema + legacy
      dual-write. stockSummaryId de-duplicated (05a); resolveStockSummaryDocumentId lives in
      the engine (05d).
P1-5  Multi-doc stock ops non-atomic (dispatch, GRN)                            (dispatch: DONE INVENTORY-01; GRN: DONE INVENTORY-03, on the engine INVENTORY-05b; unify remaining in 05c/05d)
P1-6  No product/warehouse existence check at order/dispatch/adjust            (dispatch: DONE INVENTORY-01; GRN slice: DONE INVENTORY-03 — product/warehouse existence + same-company check; order/adjust + broader: Plan Phase 09)
P1-7  genId random + setDoc(merge:true) -> collision silently merges           (Plan Phase 09)
P1-8  Order items editable after partial dispatch                             *** FIXED at the workflow layer (INVENTORY-04) ***
      isOrderLineLocked(order) + updateOrder(id,patch) in orderWorkflow.ts. Locked when
      Σ dispatchedQty > 0 OR status ∈ {Partial Dispatch,Dispatched,Closed,Cancelled}. A
      line (product/qty/price) change on a locked order is REJECTED at the workflow layer;
      non-line edits still allowed. Orders.tsx + MobileOrderWorkspace.tsx both call updateOrder.
      KNOWN GAP (unchanged, documented): the generic `orders` REST API PUT still bypasses
      this — no dedicated `orders` rules block this phase (deferred rules-consolidation).
P2-1  No stock<->ledger reconciliation                                         *** DETECTION DONE (INVENTORY-06) — correction human-gated ***
      src/engines/StockReconciliationEngine.ts (read-only): per summary,
      computed = Σ(operational ledger IN qty) − Σ(operational ledger OUT qty) vs stock.onHandQty.
      A /stock "Reconcile" report + scripts/inventory/reconcile.ts (both read-only, zero writes).
      Correction is a deliberate human action: applyReconciliationCorrection → RECONCILE_ADJUST
      movement through the engine (canDo('edit','stock') + reason + run-id, audit-logged,
      idempotent per (run-id × summary)). NO auto-correction, NO scheduled cron (Future). NO
      firestore.rules / schema change. RECONCILE_ADJUST rows are excluded from `computed`
      (they patch `stored`) so a correction reconciles. The one-time manual correction
      campaign (review report + physical count + apply) is a data task, not code.
P2-2  cancelOrder non-atomic; doesn't reverse PIs/tax invoices                 *** STATUS-ATOMIC + FLAGS (INVENTORY-04); RESTORE ON THE ENGINE (INVENTORY-05d) ***
      Order-status + every affected dispatch-status write in ONE runTransaction (configured)
      re-reading each doc — emulator-proven (all flip or none). Additive
      orders.piReversalRequired + orders.reversalInvoiceIds[] record the affected PI /
      tax-invoice ids (INFO ONLY — no financial reversal). Stock restore is now
      applyStockMovement('SALES_RETURN_IN', sourceType:'order_cancel', sourceId:'{orderId}:
      {dispatchId}:{productId}') — engine idempotency (one ledger row per restore line,
      re-run is a no-op) replaced the manual CANCEL: ledger scan. Financial (PI/GST) reversal
      is still a Future Finance phase.
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

INVENTORY-05a (COMMITTED — ff45262):
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

INVENTORY-05a.1 (COMMITTED — d5010e2):
  MODIFIED: src/lib/inventory/types.ts  (+MovementReadContext / MovementWriter / MovementParticipant /
            MovementPlanEntry / BatchMovementResult; +StockMovementInput.ledgerExtra; +MovementResult.skipped)
  MODIFIED: src/lib/inventory/stockMovementEngine.ts  (rewritten: applyStockMovements(inputs, participant?)
            batch + generic participant lifecycle read→validate→commit; MovementWriter rejects stock/
            stock_ledger; applyStockMovement is now a wrapper; +beforeQty/afterQty + ledgerExtra dual-write)
  MODIFIED: src/lib/inventory/__tests__/stockMovementEngine.test.ts       (+7)
  MODIFIED: src/lib/inventory/__tests__/stockMovementEngine.emulator.test.ts  (+3)
  MODIFIED: INVENTORY_IMPLEMENTATION_STATE.md + INVENTORY_REGRESSION_MATRIX.md
  PRODUCTION SOURCE FILES: types.ts + stockMovementEngine.ts (still no caller). RULES/INDEXES/DB: NONE.

INVENTORY-05b (COMMITTED — e01819a):
  MODIFIED: src/features/procurement/services/goodsReceiptWorkflow.ts  (applyGrnReceipt → applyStockMovements
            + grnPurchaseOrderParticipant; Phase-03 local runTransaction DELETED; reconcileMissingGrnDocs
            reads grnLineIndex/grnPreviouslyReceivedQty; demo+configured unified; removed grnReceiptLedgerId/
            grnReceiptIdempotencyKey/lineMetaFor)
  MODIFIED: src/features/procurement/services/goodsReceiptWorkflow.test.ts  (drop removed-helper assert; +1 ledger-shape)
  MODIFIED: src/lib/__tests__/grnReceiptTransaction.emulator.test.ts  (grnReceiptTxn helper → engine+participant shape; 16 cases unchanged)
  MODIFIED: INVENTORY_IMPLEMENTATION_STATE.md + INVENTORY_REGRESSION_MATRIX.md
  PRODUCTION SOURCE FILES MODIFIED: goodsReceiptWorkflow.ts (1). RULES/INDEXES/storage: NONE.
  DATABASE: new GRN ledger rows use the unified schema + legacy compat (additive). No migration.
  UI/MOBILE: createGoodsReceipt signature unchanged.

INVENTORY-05c (COMMITTED — 8432c22):
  MODIFIED: src/lib/dispatchWorkflow.ts  (executeAndVerifyDispatch → applyStockMovements(DISPATCH_OUT[],
            dispatchDocParticipant); Phase-01 local runTransaction DELETED; dispatchOutLedgerId → STKMV id;
            order-items update / project patch / notifications stay post-engine; removed resolveWriteGroupId/
            stockSummaryId imports)
  MODIFIED: src/lib/inventory/stockMovementEngine.ts  (demo branch reads summary from getAll(stock) result first)
  MODIFIED: src/lib/__tests__/dispatchWorkflow.test.ts / dispatchStockOutTransaction.emulator.test.ts /
            src/lib/inventory/__tests__/baseline/dispatchOut.baseline.test.ts  (engine shape)
  MODIFIED: INVENTORY_IMPLEMENTATION_STATE.md + INVENTORY_REGRESSION_MATRIX.md
  PRODUCTION SOURCE FILES MODIFIED: dispatchWorkflow.ts (1) + engine demo-read tweak. RULES/INDEXES: NONE.
  UI/MOBILE: executeAndVerifyDispatch signature unchanged (Desktop ProjectDispatchWorkspace + Mobile MobileDispatchWorkspace).

INVENTORY-05d (COMMITTED — 6939c12):
  MODIFIED: src/lib/stockWorkflow.ts  (stockIn → thin applyStockMovement wrapper [demo txn + configured
            runTransaction DELETED]; cancelOrder restore → applyStockMovement('SALES_RETURN_IN'); manual
            CANCEL: scan removed; resolveStockSummaryDocumentId re-exported from the engine)
  MODIFIED: src/features/inventory/hooks/useInventory.ts  (useSaveStockEntry → applyStockMovement
            [ADJUSTMENT_IN/OUT]; its runTransaction DELETED; removed resolveWriteGroupId import)
  MODIFIED: src/lib/inventory/stockMovementEngine.ts  (+resolveStockSummaryDocumentId [moved from
            stockWorkflow to break the import cycle])
  ADDED:    src/lib/inventory/__tests__/singleStockWriter.test.ts  (repo-wide: ONE stock writer — P1-4 guard)
  MODIFIED (engine shape): src/lib/__tests__/stockWorkflow.test.ts,
            src/lib/inventory/__tests__/baseline/{stockIn,manualEntry,cancelOrder}.baseline.test.ts
  MODIFIED: INVENTORY_IMPLEMENTATION_STATE.md + INVENTORY_REGRESSION_MATRIX.md
  PRODUCTION SOURCE FILES MODIFIED: stockWorkflow.ts, useInventory.ts, stockMovementEngine.ts (3).
  RULES/INDEXES/storage: NONE. DATABASE: new manual/cancel ledger rows use the unified schema (additive).
  UI: stockIn's 3 UI callers (ProductDetailDrawer, ProductDetailsModal, MobileStockWorkspace) UNCHANGED (signature identical).

INVENTORY-06 (UNCOMMITTED — in the working tree; the user withheld commit for this phase):
  ADDED:    src/engines/stockReconciliationMath.ts        (PURE, zero imports — the one reconciliation math)
  ADDED:    src/engines/StockReconciliationEngine.ts       (read-only reconcile* + applyReconciliationCorrection)
  ADDED:    src/engines/__tests__/stockReconciliationEngine.test.ts   (21 tests)
  ADDED:    src/lib/__tests__/stockReconciliation.emulator.test.ts    (6 tests — F4 / F5)
  ADDED:    src/features/stock/components/StockReconciliationReport.tsx  (read-only report + correction dialog)
  ADDED:    scripts/inventory/reconcile.ts                 (standalone read-only CLI — Firestore REST, zero writes)
  MODIFIED: src/lib/inventory/stockMovementEngine.ts       (+auditReconciliation flag on RECONCILE_ADJUST rows — additive)
  MODIFIED: src/pages/StockWorkspace.tsx                   (+"Reconcile" button + Modal → <StockReconciliationReport/>)
  MODIFIED: vitest.emulator.config.ts                      (+1 line)
  MODIFIED: INVENTORY_IMPLEMENTATION_STATE.md + INVENTORY_REGRESSION_MATRIX.md

  PRODUCTION SOURCE FILES MODIFIED BY INVENTORY-06: stockMovementEngine.ts (1 additive flag),
    StockWorkspace.tsx (1 button). The engines + report + script are new.
  FIRESTORE RULES / INDEXES / storage.rules: NONE. DATABASE: none new (RECONCILE_ADJUST rows are
    normal movement rows + a flag). NO backfill, NO historical rewrite.
  P1-4: intact — the reconciliation engine only READS; corrections go through applyStockMovement
    (singleStockWriter.test.ts still green).

INVENTORY-07 / 08 / 09 / 10: starting with Phase 07, the full per-file change list moved to
  living in the COMPLETED PHASES table's Notes column + INVENTORY_REGRESSION_MATRIX.md's own
  per-phase STATUS rows, to avoid duplicating the same ~500-1000 words in two/three places every
  phase (Phase 09's own Notes cell says this explicitly). This cumulative section is kept for
  Phases 00-06 (already written) but is NOT being extended further — see COMPLETED PHASES above
  for Phase 07-10's exact file lists.
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

INVENTORY-06: NO production database write from reconciliation (read-only). A human-approved
  RECONCILE_ADJUST correction writes ONE normal `stock_ledger` movement row (+ `auditReconciliation`
  flag + reconciliation `ledgerExtra`) + the summary delta, through the engine. NO rules / index
  / migration / backfill. NO automatic drift correction.

INVENTORY-10: purely ADDITIVE schema, matching the plan's own "Schema impact: additive
  (reasonCode, importRunId, return docs collection)" line exactly:
  - 10a: no new fields — OPENING_STOCK already existed in the MovementType enum (05a); this
    phase adds the workflow-layer double-entry guard, not a schema change.
  - 10b: `stock_ledger.reasonCode` was already a generic pass-through field (REASON_CODE_REQUIRED
    since 05a); this phase constrains it to a fixed taxonomy at the workflow layer only —
    existing rows with a free-text reasonCode remain valid, untouched.
  - 10c: `stock_ledger` rows written by a bulk-adjust row carry `ledgerExtra:{referenceType:
    'BulkImport', referenceId: importRunId, rowNumber}` — additive, same pattern as every other
    movement source (GRN/dispatch/transfer/reservation).
  - 10d: NO schema change — a best-effort `notifications` row via the existing
    `NotificationType.INVENTORY_UPDATED` path, same shape as every other stock notification.
  - 10e: NEW collection `customer_returns/{RET-*}` (rules block + 3 composite indexes +
    isSpecialCollection/WAREHOUSE_SCOPED_COLLECTIONS/COLLECTION_PERMISSION_MODULE entries) —
    additive collection, touches no existing document shape. Its `SALES_RETURN_IN`/`DAMAGE_OUT`
    ledger rows carry `ledgerExtra:{referenceType:'CustomerReturn'|'CustomerReturnDamage',
    referenceId: returnId, orderId, dispatchId, ...}` — additive.
  NO backfill required for any of the above (all new fields/collections start empty and are
  populated only by new activity going forward).

Additive schema, by phase (05a/07/08/09/10/11 ALL DONE and shipped — this is the FULL planned roadmap):
  Phase 05a/05b: stock.onHandQty; stock_ledger.{movementType,direction,idempotencyKey,onHandBefore/After,reservedBefore/After}
  Phase 07 (DONE): NEW collection stock_reservations + rules block + index;
            order.fulfilmentWarehouseId, order.stockShortfall[]; availableQty semantic = onHand - reserved
  Phase 08 (DONE): NEW collection stock_transfers + rules block + index
  Phase 09 (DONE): product.categoryId, product.parentCategoryId; NEW collection product_sku_locks + rules + index
  Phase 10 (DONE): reasonCode restricted to a fixed taxonomy (workflow-layer only, no schema
            change); importRunId in stock_ledger.ledgerExtra for bulk-adjust rows; NEW collection
            customer_returns + rules block + 3 indexes — see the INVENTORY-10 entry above.
  Phase 11 (DONE): NEW collection dispatch_serials + rules + index (11a); 6 composite indexes
            (companyId+isDeleted+createdAt) for products/vendors/purchase_orders/goods_receipts/
            warehouses/stock (11b) — product_categories/stock_reservations/stock_transfers were
            RECONCILED against actual usage, not blindly indexed (see the INVENTORY-11 entry
            above for the evidence).
```

---

## MIGRATIONS (cumulative)

```
(none run in production this session; Phase 07/09/11's own backfill scripts — see their
COMPLETED PHASES rows — remain dry-run-first tools, not auto-applied)

INVENTORY-10: NO migration/backfill of any kind. Every Phase-10 schema addition is purely
  additive and starts empty (see DATABASE CHANGES above) — nothing to backfill. Confirmed:
  Phase-10 introduced no field on an EXISTING document type that a pre-existing row would be
  missing in a way that breaks a new read path (10b's reasonCode taxonomy is enforced only at
  the workflow layer going forward, never re-validated against historical rows).

INVENTORY-11: 11b is a pure additive index + a logging-only API change — NO migration. 11a's
  `dispatch_serials` collection starts EMPTY like every other new collection, BUT this one has a
  genuine backfill NEED (not just an option, unlike 10's purely-additive fields): without it, a
  NEW dispatch verification could re-claim a serial already used on an OLD, pre-§11a dispatch
  (the new transactional lock only protects what it has actually SEEN; the old full-scan checked
  ALL history). `scripts/inventory/backfill-dispatch-serials.ts` exists (dry-run default,
  --apply writes only unambiguous single-owner historical serials, ambiguous ones report-only —
  see the script's own header) but has NOT been run against production this session — it awaits
  a human `TOKEN=... node --experimental-strip-types scripts/inventory/backfill-dispatch-serials.ts`
  dry-run review + an explicit `--apply` decision.

Planned backfills (scripts, dry-run first, reviewed, run on a copy — NEVER automatic):
  Phase 05d/07: set stock.onHandQty = stock.availableQty where onHandQty absent; recompute availableQty
  Phase 07:     decision required — retro-reserve currently-paid-undispatched orders, OR start clean from deploy date
                (RECOMMENDED: start clean, documented)
  Phase 09:     map product.category (name string) -> product.categoryId by category name; report unmatched
  Phase 09:     SKU duplicate report (flag for manual resolution, never auto-merge)
  Phase 11a:    backfill dispatch_serials from existing dispatch.items[].serials — script written,
                NOT yet run; a human should run the dry-run + review before --apply (see MIGRATIONS above)
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

INVENTORY-05a rollback = `git revert ff45262` (or reset to 9227ec3). Files:
  src/lib/inventory/types.ts, src/lib/inventory/idempotency.ts, src/lib/inventory/stockMovementEngine.ts
  (all DEAD CODE — deleting them affects nothing), src/features/inventory/hooks/useInventory.ts
  (restores the local stockSummaryId copy — byte-identical, so no behaviour change either way),
  src/lib/inventory/__tests__/stockMovementEngine.test.ts + .emulator.test.ts, vitest.config.ts
  (the exclude glob), vitest.emulator.config.ts (the engine line).
  NO firestore.rules / indexes / deploy / data / migration. NOTHING to un-migrate — the engine
  was never called. Reverting simply removes the (unused) 05b-05d foundation.

INVENTORY-06 rollback = revert the (uncommitted) working-tree changes: delete
  src/engines/stockReconciliationMath.ts + StockReconciliationEngine.ts + their tests,
  src/features/stock/components/StockReconciliationReport.tsx, scripts/inventory/reconcile.ts,
  src/lib/__tests__/stockReconciliation.emulator.test.ts; revert the 1-line
  `auditReconciliation` flag in stockMovementEngine.ts, the "Reconcile" button in
  StockWorkspace.tsx, and the vitest.emulator.config.ts line. NO firestore.rules / indexes /
  deploy / data / migration. Any RECONCILE_ADJUST rows written during testing are inert
  additive movement rows.

INVENTORY-10 rollback = revert the 7 commits in reverse order (`b222416` `b13dc0f` `c980d18`
  `f791b6b` `788f89a` `c640b8a` `0391a4f`) or `git reset --hard 781926c` to drop the whole phase.
  Per-sub-feature (the plan's own "Rollback: per sub-feature revert"):
    10a/10b: revert `0391a4f` (backend) + `c980d18` (UI) — deletes
      stockOperationsWorkflow.ts + its test, reverts useInventory.ts's STOCK_FORM_DEFAULT/
      useSaveStockEntry, StockWorkspace.tsx's Transaction Type options, MobileStockWorkspace.tsx's
      same options. Nothing to un-migrate — OPENING_STOCK/DAMAGE_OUT rows already written stay
      valid ledger history (movement rows are immutable by design across every phase).
    10c: revert `f791b6b` (backend) + `b13dc0f` (UI) — deletes bulkStockImportWorkflow.ts +
      BulkStockAdjustModal.tsx, reverts StockWorkspace.tsx's "Bulk Import" button and
      CSVImportModal.tsx's `parseCSV` export. ADJUSTMENT_IN/OUT rows already applied stay valid.
    10d: revert `c640b8a` — deletes lowStockAlerts.ts + its test, reverts the ONE
      `stockMovementEngine.ts` hook (the core txn function returns to its Phase-09 shape
      byte-for-byte). No data to un-migrate (notifications are ephemeral).
    10e: revert `788f89a` (backend) + `b222416` (UI) — deletes customerReturnWorkflow.ts +
      ProcessReturnModal.tsx, reverts DispatchDetail.tsx's "Process Return" action,
      firestore.rules' `customer_returns` block + isSpecialCollection entry,
      firestore.indexes.json's 3 new composites, firestore.ts's WAREHOUSE_SCOPED_COLLECTIONS/
      COLLECTION_PERMISSION_MODULE entries, collections.ts's CUSTOMER_RETURNS constant.
      **If firestore.rules/indexes were already deployed**, redeploy the pre-10e rules (tag it
      first, same discipline as every prior rules-touching phase) — a `customer_returns` doc
      already written becomes unreadable/unwritable after the rules revert but is NOT deleted
      (soft-delete-only discipline holds; it simply becomes inert until 10e is reinstated).
  NO firebase deploy was run by this session for ANY Phase-10 change — prod rules/indexes are
  UNAFFECTED until a deliberate deploy. Every ledger row any Phase-10 code wrote during local/
  emulator testing is an inert, valid, immutable movement row — nothing to undo in the data
  itself, per the project's "ledger is immutable, soft-delete only" invariant (Plan §5 item 5).

INVENTORY-11 rollback = revert the 2 commits in reverse order (`275f21b` `2b4d3dd`) or
  `git reset --hard ee73df0` to drop the whole phase.
    11a: revert `2b4d3dd` — deletes serialLock.ts + serialLock.test.ts +
      dispatchSerialLock.emulator.test.ts + backfill-dispatch-serials.ts, reverts
      dispatchWorkflow.ts's `dispatchDocParticipant`/`executeAndVerifyDispatch` back to the
      Phase-10 shape (the old `assertNoDuplicateSerials` full-scan returns), reverts
      dispatchWorkflow.test.ts's serial tests, reverts firestore.rules' `dispatch_serials` block
      + isSpecialCollection entry, firestore.ts's WAREHOUSE_SCOPED_COLLECTIONS/
      COLLECTION_PERMISSION_MODULE entries, collections.ts's DISPATCH_SERIALS constant, the
      vitest.emulator.config.ts line. **If firestore.rules was already deployed**, redeploy the
      pre-11a rules (tag it first). A `dispatch_serials` lock doc already written becomes inert
      (unreadable/unwritable) after the rules revert but is NOT deleted (soft-delete-only
      discipline holds).
    11b: revert `275f21b` — reverts firestore.indexes.json's 6 new composites (safe to drop;
      purely additive, nothing depended on them existing), reverts api/[entity].ts's console.error
      addition (pure logging, zero behavior change either way), deletes
      apiListIndexFallback.test.ts.
  NO firebase deploy was run by this session for ANY Phase-11 change — prod rules/indexes are
  UNAFFECTED until a deliberate deploy. The `backfill-dispatch-serials.ts` script was NOT run
  against production — nothing to undo there either. Every lock doc any Phase-11 code wrote
  during local/emulator testing is an inert, valid, immutable doc — nothing to undo in the data
  itself.

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
NEXT PHASE:            NONE PLANNED. INVENTORY-11 (Scale & Reporting Hardening) was the LAST
                       phase in Plan §14's roadmap and is now IMPLEMENTED + VERIFIED + COMMITTED
                       (`2b4d3dd` §11a → `275f21b` §11b). The plan defines no INVENTORY-12. The
                       Neozy Inventory Remediation project's PLANNED scope (Plan §14, INVENTORY-00
                       through INVENTORY-11) is complete.
STATUS:                All 12 phases (00, 01, 02, 03, 04, 05a/05a.1/05b/05c/05d, 06, 07, 08, 09,
                       10, 11) IMPLEMENTED + VERIFIED + COMMITTED. `singleStockWriter.test.ts`
                       PASS (one authoritative stock writer, unbroken since 05d). Reservations
                       (07) ACTIVE. Transfers (08) ACTIVE. SKU/category/delete integrity (09)
                       ACTIVE. Operational workflows (10: opening stock, damage, bulk adjust,
                       low-stock alerts, customer returns) ACTIVE. Dispatch serial uniqueness
                       (11a) transactional. Index/reporting hardening (11b) shipped; 11c/11d/11e
                       reconciled and deliberately deferred (see CURRENT POSITION for the exact
                       reasoning on each).
IF FURTHER WORK IS REQUESTED:  It is a NEW instruction, not a continuation of this plan — do not
                       invent a "Phase 12" name or assume it inherits this project's phase-gate
                       ceremony unless the human explicitly frames it that way. Two GENUINE,
                       documented, non-blocking gaps remain if a human wants to pick one up later
                       (neither is a Phase-11 completion blocker):
                         1. No mobile UI for INVENTORY-10 §10c (bulk import) / §10e (customer
                            return) — the underlying workflows are already mobile-consumable.
                         2. `CSVImportModal.tsx`'s `collection:'products'` bulk-import path still
                            bypasses the Phase-09 SKU lock (`batchCreate` direct write) —
                            Phase-09-adjacent, verified twice (Phase 10 and again reviewed here),
                            deliberately left untouched both times as out of each phase's named
                            scope.
                       Also open, per 11c/11d's own deferral reasoning above: a future pagination
                       retrofit of the 5 big list hooks, and a future stock_ledger archival pass —
                       neither is urgent; both have a concrete trigger condition recorded in
                       CURRENT POSITION (11c: proven scale pain on a specific page; 11d: measured
                       ledger volume/latency degradation).
GIT NOTE:              INVENTORY-00..11 fully committed in order (see COMMITS below, newest
                       `275f21b`). The 4 unrelated pre-existing changes + untracked BRAIN.md /
                       audit remain in the working tree across every checkpoint — do NOT touch
                       those. Safety refs: branch `pre-05a-backup-head`, tag
                       `pre-05a-worktree-snapshot`.
```

---

## EXACT NEXT ACTION

```
INVENTORY-00..11 are ALL COMMITTED (newest: `275f21b`, INVENTORY-11 §11b). Phase 11 (Scale &
Reporting Hardening) is COMPLETE: 11a (dispatch serial lock, P2-9) and 11b (composite indexes +
loud index fallback, P3-6) implemented, focused-tested, emulator-tested (including a real
concurrent-transaction serial race), security-batch-tested, tsc/build/full-vitest all clean
against baseline, STATE + regression matrix updated. 11c/11d/11e were reconciled against the
current code and deliberately NOT implemented (see CURRENT POSITION for the exact reasoning).
This is the LAST phase in Plan §14's roadmap. Do NOT do anything further without a new
instruction.

There is no "next phase" to prepare for. If a human gives a NEW instruction:
  a. If it names one of the two genuine open gaps above (10c/10e mobile UI, or the
     CSVImportModal SKU-lock bypass) — treat it as its OWN small, explicitly-scoped task, not a
     reopening of Phase 09 or Phase 10.
  b. If it asks for 11c (pagination) or 11d (ledger archival) — these were assessed, not
     rejected; re-read the CURRENT POSITION reasoning first (the "not tied to Problems
     addressed" / "no volume pressure" judgment calls may no longer hold if data has changed),
     then scope it as its own task with the same rigor every phase in this project has used.
  c. If it is unrelated to inventory — this project's phase-gate discipline (read source of
     truth first, exact scope boundary, invariant protection, focused-then-full verification,
     STATE+matrix update, one phase then STOP) is a good template to reuse, but this file stops
     being the authoritative continuity checkpoint for it.

Do NOT touch the movement engine's transaction shape / the frozen MovementType enum / the
`MovementParticipant` contract, do NOT weaken any existing firestore.rules block, do NOT touch
reservations (07) / transfers (08) / master-data guards (09) / the 10a–10e workflow modules /
the 11a serial lock without a fresh, explicitly-scoped instruction.
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
- Do NOT re-do INVENTORY-05a / 05a.1 — the Stock Movement Engine + the generic
  transaction-participation contract are BUILT + verified + committed. Do NOT change the
  frozen MovementType enum, the `MovementParticipant` contract, or the `MovementWriter`
  stock/stock_ledger guard; do NOT re-consolidate stockSummaryId; do NOT weaken firestore.rules.
- Do NOT re-do INVENTORY-05b / 05c / 05d — GRN, dispatch OUT, manual add/adjust, `stockIn`
  and cancel-restore ALL run on the engine now; every legacy local stock transaction is
  DELETED. **P1-4 is CLOSED** — `singleStockWriter.test.ts` fails the build if a second
  stock/stock_ledger writer is reintroduced. Do NOT "re-transactionalize" any of them, do NOT
  add a `USE_MOVEMENT_ENGINE_*` flag path (the migration is unconditional and shipped).
- Do NOT re-do INVENTORY-06 — `StockReconciliationEngine` (read-only) + `stockReconciliationMath`
  (the ONE reconciliation math) + the report + `scripts/inventory/reconcile.ts` are BUILT +
  verified + COMMITTED (with 07 as `de5902e`). Reconciliation NEVER auto-corrects (Plan §17).
  Corrections are human-gated `RECONCILE_ADJUST` movements through the engine ONLY — do NOT add
  a direct stock write, do NOT build a batch/auto-heal, do NOT count RECONCILE_ADJUST rows in
  `computed` (they patch `stored`), do NOT backfill or rewrite historical ledger rows.
- Do NOT re-do INVENTORY-07 — sales reservation/allocation is BUILT + verified + COMMITTED
  (`de5902e`), `reservationsEnabled` is ACTIVE (default ON). Do NOT flip it off without an
  explicit instruction, do NOT re-derive the five §7 decisions (already resolved and shipped),
  do NOT add a second reservation participant path outside `src/lib/inventory/reservations.ts`.
- Do NOT re-do INVENTORY-08 — warehouse transfer is BUILT + verified + COMMITTED (`6cfdeb5`).
  `warehouseTransferWorkflow.ts` is the ONE transfer workflow; do NOT add a second ship/receive/
  cancel path; do NOT weaken the `stock_transfers` rules block; INV-11 (paired-movement sum-to-
  zero) is machine-verified — do not reintroduce an unpaired transfer leg.
- Do NOT re-do INVENTORY-09 — SKU uniqueness lock (`product_sku_locks`) + `categoryId`/
  `parentCategoryId` FK + rename cascade + delete guards (`masterDataGuards.ts`) are BUILT +
  verified + COMMITTED (`ef7b08b` → `d5c27e3` → `781926c`). Do NOT bypass `skuLock.ts` with a
  second SKU-uniqueness check; do NOT rewrite a historical quotation/order line-item snapshot's
  denormalized category name on a rename. **Known pre-existing gap, still open, not this
  project's current job unless separately instructed:** `CSVImportModal.tsx`'s `collection:
  'products'` bulk-import path (`batchCreate`) still bypasses the SKU lock — verified again in
  Phase 10, deliberately left untouched both times (out of each phase's named scope).
- Do NOT re-do INVENTORY-10 — opening stock / damage write-off / bulk import / low-stock alerts
  / customer return are BUILT + verified + COMMITTED (7 commits, `0391a4f` → `b222416`, see
  COMMITS below). Do NOT add a second opening-stock or customer-return path outside
  `stockOperationsWorkflow.ts`/`customerReturnWorkflow.ts`; do NOT change the
  `DAMAGE_REASON_CODES` taxonomy or the approval thresholds without a fresh instruction (they are
  the enforced authoritative values, not placeholders); do NOT add a mobile UI for 10c/10e as a
  "quick fix" — it remains its own genuine, tracked, non-blocking follow-up (see NEXT PHASE).
- Do NOT re-do INVENTORY-11 — the dispatch serial lock (11a, `dispatch_serials`, replaces
  `assertNoDuplicateSerials`' old full-scan) and the composite-index + loud-fallback hardening
  (11b) are BUILT + verified + COMMITTED (`2b4d3dd` → `275f21b`). Do NOT add a second serial-
  uniqueness path outside `serialLock.ts`/`dispatchDocParticipant`; do NOT re-introduce the
  `getAll(DISPATCH)` scan; do NOT change `dispatch_serials`' immutability
  (`update, delete: if false`) to add a "release on cancel" flow without a fresh, explicitly-
  scoped instruction (the current permanent-claim semantics deliberately mirror the OLD
  mechanism's own behavior — not an oversight). 11c (pagination) / 11d (ledger archival) were
  assessed and deferred with a recorded trigger condition each (see NEXT PHASE) — do NOT
  silently implement either as a "cleanup" without a fresh instruction naming it.
- Git: INVENTORY-00..11 are ALL committed in order (…c043009 → … → 6939c12 05d → de5902e 06+07
  → 6cfdeb5 08 → ef7b08b 09 → d5c27e3 09 → 781926c 09 → 0391a4f 10 → c640b8a 10 → 788f89a 10 →
  f791b6b 10 → c980d18 10 → b13dc0f 10 → b222416 10 → ee73df0 10-docs → 2b4d3dd 11 → 275f21b 11,
  current HEAD). The 4 unrelated pre-existing changes + untracked BRAIN.md/audit stay in the
  working tree across every checkpoint — do NOT commit/stash/revert those. Safety refs: branch
  `pre-05a-backup-head` (old 30920c2), tag `pre-05a-worktree-snapshot`. `origin/main` is still at
  46e3aab (not pushed) as of the last check — re-verify before assuming this if it matters for
  the next task.
- Do NOT re-derive the emulator command — it is recorded above (JBR java).
- Do NOT invent an INVENTORY-12 — the plan defines none; INVENTORY-11 was the last planned
  phase. Any further inventory work is a NEW, separately-scoped instruction (see NEXT PHASE).
- Do NOT attempt to "fix everything" — one phase, verify, update STATE, then STOP.
- The 29 failing unit-test files / 65 failing tests are the documented pre-existing baseline
  (BRAIN.md §35) — do NOT "fix" them; Phase 11's full `npx vitest run` reproduced this EXACT
  count (268 files, 3664 tests, 29/65 failing) with zero new failures.
```

---

## DO NOT CHANGE (until the owning phase)

```
See "FILES / AREAS NOT TO TOUCH" above and Plan §21. In particular:
- firestore.rules — full change history: INVENTORY-01 = `stock_ledger` READ-guard. INVENTORY-02
  = none. INVENTORY-03 = `stock` field-guard role list + `purchase_orders` lean update + PO
  transition self-loop. INVENTORY-05a…06 = NONE. INVENTORY-07 = `stock` update gains a
  reservation-only branch + new `stock_reservations` block. INVENTORY-08 = new `stock_transfers`
  block + `warehouseIdInCompany()`. INVENTORY-09 = new `product_sku_locks` block + the
  generic-fallback `resource==null` fix (a real pre-existing gap, fixed). INVENTORY-10 = new
  `customer_returns` block + `isSpecialCollection()` addition (10e only — 10a/10b/10c/10d made
  NO rules change). INVENTORY-11 = new `dispatch_serials` block + `isSpecialCollection()`
  addition (11a only — 11b made NO rules change, indexes/logging only). **This was the LAST
  planned rules-touching phase** — any further rules edit needs a fresh instruction; same
  discipline applies (full batched emulator + a fresh security-focused run) whenever one happens.
- Stock quantity/write logic: EVERYTHING is on `stockMovementEngine.ts` (05b GRN, 05c dispatch,
  05d manual + stockIn + cancel-restore, 07 reserve/release, 08 transfer legs, 10a/10b/10c/10e
  opening/damage/bulk-adjust/return — ALL call `applyStockMovement`/`applyStockMovements`;
  nothing writes `stock`/`stock_ledger` directly). `singleStockWriter.test.ts` enforces it. Do
  NOT add another writer. Reconciliation (06) is READ-ONLY. 10d (low-stock alerts) is a
  post-commit READ + notify, not a stock write. 11a (`dispatch_serials`) is a NEW collection
  written by `dispatchDocParticipant`, never `stock`/`stock_ledger` — it adds zero stock-write
  surface.
- REST API: `stock`/`stock_ledger` are read-only (INVENTORY-02). `api/[entity].ts`'s missing-
  index fallback now logs loudly when it fires (INVENTORY-11 §11b) — its response behavior is
  otherwise unchanged for every registered entity. Do not touch other API entities.
- PO transition table: ONE `PURCHASE_ORDER_TRANSITIONS` (INVENTORY-03). Do not fork it again.
- Order lifecycle: `isOrderLineLocked` / `updateOrder` (INVENTORY-04) are the authoritative
  order-edit path. Do not add a parallel order-update that skips the lock.
- Reservation/`reservedQty` is ACTIVE since Phase 07 (`reservationsEnabled` default ON). Do not
  flip it off without an explicit instruction.
- SKU uniqueness / categoryId FK / delete guards (Phase 09) are the authoritative master-data
  integrity layer. Do not bypass `skuLock.ts` / `masterDataGuards.ts`.
- Opening-stock double-entry guard, damage reason taxonomy + approval thresholds, bulk-import
  idempotency-by-run-id, low-stock crossing detection, customer-return atomicity (Phase 10) are
  the authoritative Phase-10 layer (`stockOperationsWorkflow.ts` / `bulkStockImportWorkflow.ts` /
  `lowStockAlerts.ts` / `customerReturnWorkflow.ts`). Do not bypass them with a direct
  `applyStockMovement` call from new UI — route through these workflow functions.
- Dispatch serial uniqueness (Phase 11 §11a) is authoritative in `serialLock.ts` +
  `dispatchDocParticipant` (`dispatchWorkflow.ts`). Do not bypass it with a direct
  `dispatch_serials` write or a re-introduced `getAll(DISPATCH)` scan.
- No mobile-file business logic, ever.
```

---

## CONTINUITY CHECK (for a fresh session)

```
If you are a new session with no history:
1. You have read: brain.md, INVENTORY_IMPLEMENTATION_PLAN.md, this file, INVENTORY_REGRESSION_MATRIX.md,
   INVENTORY_PHASE_DEPENDENCY_MAP.md.
2. PLAN STATUS: APPROVED. Overall approval exists, BUT each phase runs on its own explicit instruction.
3. CURRENT PHASE = INVENTORY-11 (Scale & Reporting Hardening — dispatch serial lock + composite
   indexes/loud index fallback). STATUS = IMPLEMENTED + VERIFIED + **COMMITTED** (2 commits,
   `2b4d3dd` → `275f21b`). **This was the LAST planned phase (Plan §14 defines no INVENTORY-12).**
   INVENTORY-00 through INVENTORY-10 are ALL implemented + verified + committed (this file's
   COMPLETED PHASES table has every hash). Single stock writer intact through Phase 11 —
   `singleStockWriter.test.ts` still passes; 11a's `dispatch_serials` collection adds zero
   stock-write surface (never `stock`/`stock_ledger`).
   NEXT PHASE = NONE PLANNED. Two genuine, non-blocking, tracked gaps remain if a human wants to
   pick one up (see NEXT PHASE section above for the full list) — neither is a Phase-11
   completion blocker.
   -> If the user asks "what's next" or to continue the plan — report: the planned roadmap
      (INVENTORY-00..11) is COMPLETE; no further phase is defined; ask what they'd like next
      rather than inventing scope.
   -> If the user gives a genuinely NEW inventory instruction — scope it as its own task with
      this project's same rigor (read source of truth, exact boundary, focused-then-full verify,
      STATE+matrix update), but do not assume it is "Phase 12" of this plan unless they say so.
   -> Otherwise STOP and report: the full remediation plan is complete through Phase 11.
4. `git log --oneline -20` shows the ordered inventory commits (11 = `2b4d3dd`…`275f21b`, newest
   `275f21b`). `git status --short` shows ONLY the 4 unrelated pre-existing changes (LEADS_UI_UX
   delete, ProfileSection.tsx, useMyProfile.ts, userProfile.ts) + untracked BRAIN.md /
   COMPLETE_INVENTORY_INTEGRITY_AUDIT.md — the SAME 4+2 items every checkpoint since before
   Phase 10 began. ZERO inventory-implementation files are uncommitted. Do NOT commit, revert,
   or stash the unrelated / untracked items.
5. Do not touch any phase beyond the one you were told to run. End with Plan §23. Update this
   file. STOP.
6. Emulator: use the JBR-java command in ROLLBACK STATUS / WHAT WAS VERIFIED. Do not re-derive it.
```

---
*End of INVENTORY_IMPLEMENTATION_STATE.md — checkpoint. Update at the end of every phase.*
