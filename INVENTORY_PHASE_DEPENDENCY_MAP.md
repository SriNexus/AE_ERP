# INVENTORY_PHASE_DEPENDENCY_MAP.md

**Why the Neozy Inventory remediation phases must run in this order.**

Companion to `INVENTORY_IMPLEMENTATION_PLAN.md` (§14 has the full phase specs) and `INVENTORY_IMPLEMENTATION_STATE.md` (live position).

**Core principle:** order by *dependency and blast radius*, not by audit severity. A P0 waits if its safe fix needs a foundation that doesn't exist yet; a P2 goes early if it's a self-contained lock that protects data the later phases build on.

---

## 1. THE GRAPH

```
                          ┌──────────────────────────┐
                          │   INVENTORY-00           │
                          │   Baseline & Safety Lock  │
                          │   (tests, invariants,     │
                          │    role-matrix repro,     │
                          │    emulator env)          │
                          └────────────┬─────────────┘
                                       │  produces the safety net + confirms P1-3
             ┌─────────────────────────┼─────────────────────────┐
             ▼                         ▼                         ▼
   ┌───────────────────┐    ┌────────────────────┐    ┌────────────────────┐
   │  INVENTORY-01     │    │  INVENTORY-02      │    │  INVENTORY-04      │
   │  Dispatch OUT txn │    │  API write         │    │  Order / PO        │
   │  (P0-1)           │    │  boundary (P0-2)   │    │  lifecycle locks   │
   │                   │    │                    │    │  (P1-8, P2-2/7/8)  │
   └─────────┬─────────┘    └─────────┬──────────┘    └─────────┬──────────┘
             │                        │                          │
             │              ┌────────────────────┐               │
             │              │  INVENTORY-03      │               │
             │              │  GRN integrity +   │               │
             │              │  role alignment    │               │
             │              │  (P1-1/2/5/3, P2-4)│               │
             │              └─────────┬──────────┘               │
             │                        │                          │
             └──────────┬─────────────┴──────────────┬───────────┘
                        ▼                            (04 also feeds 05d)
              ┌────────────────────┐
              │  INVENTORY-05a     │   Movement engine, DORMANT (no caller migrated)
              │  (P1-4 foundation) │
              └─────────┬──────────┘
                        │
        ┌───────────────┼────────────────┐
        ▼               ▼                ▼
  ┌───────────┐   ┌───────────┐    ┌──────────────┐
  │  05b      │   │  05c      │    │  05d          │
  │  GRN →    │   │  Dispatch │    │  Manual+Cancel│
  │  engine   │   │  → engine │    │  → engine;    │
  │  (needs 03│   │  (needs 01│    │  retire dup   │
  │           │   │           │    │  writer       │
  │           │   │           │    │  (needs 04)   │
  └─────┬─────┘   └─────┬─────┘    └──────┬────────┘
        └───────────────┴─────────────────┘
                        ▼   (one writer now exists; ledger schema consistent)
              ┌────────────────────┐
              │  INVENTORY-06     │   Stock ↔ Ledger reconciliation (READ-ONLY)
              │  (P2-1)           │
              └─────────┬──────────┘
                        ▼   (numbers can now be trusted / drift is visible)
              ┌────────────────────┐
              │  INVENTORY-07     │   Sales reservation / allocation   ◄── BUSINESS SIGN-OFF
              │  (P0-3)           │       (highest business risk)
              └─────────┬──────────┘
                        ▼
              ┌────────────────────┐
              │  INVENTORY-08     │   Warehouse transfer (paired movements)
              │  (missing feature)│       [needs 05*, NOT 07 — order swappable, see §4]
              └─────────┬──────────┘
                        ▼
              ┌────────────────────┐
              │  INVENTORY-09     │   Master data integrity
              │  (P2-3, P1-7,     │       (category id, SKU uniqueness, delete guards)
              │   P2-5)           │       [needs 05* only for the delete-guard stock reads]
              └─────────┬──────────┘
                        ▼
              ┌────────────────────┐
              │  INVENTORY-10     │   Operational features
              │  (P3-1/2/5)       │       (opening stock, damage, bulk, low-stock, RMA)
              └─────────┬──────────┘
                        ▼
              ┌────────────────────┐
              │  INVENTORY-11     │   Scale & reporting hardening
              │  (P2-9, P3-6)     │       [fully independent — could run any time after 05,
              │                   │        placed last to avoid file churn during feature work]
              └────────────────────┘
```

---

## 2. EDGE-BY-EDGE JUSTIFICATION

| Edge | Why this dependency exists |
|---|---|
| **00 → everything** | No behavior may change until (a) current behavior is pinned by tests, (b) the rules emulator runs, (c) P1-3's real behavior is confirmed. 00 is the safety net; skipping it means every later phase risks a silent regression it can't detect. |
| **00 → 01** | Phase 01 rewrites `executeAndVerifyDispatch` to use a transaction that writes `stock`. If the dispatch actor's role is silently denied by the `stock` field guard (P1-3), the "fix" would break dispatch. 00's `stockRoleMatrix.emulator.test.ts` tells us whether that's a risk before we touch the code. |
| **00 → 02** | Phase 02 removes the API stock-write path. If any internal tool / mobile path / integration writes stock via `POST\|PUT /api/stock`, removing it breaks them. 00 inventories the API callers first. |
| **00 → 03** | Phase 03 changes the `stock` write-role rules. 00's role matrix is the before/after oracle. |
| **01, 02, 03 → 05a** | The movement engine's write shape must satisfy the *current* `stock`/`stock_ledger` rules. Phases 01–03 stabilize those rules (03 sets the final role list). Building the engine against a rules surface that's about to change wastes the work. Also: the engine is only worth building once the *active bleeds* (01 dispatch, 03 GRN, 02 API) are stopped — otherwise corruption continues during the multi-phase engine migration. |
| **01 → 05c** | 05c replaces the Phase-01 local dispatch transaction with the engine call. It needs 01's transactional shape + tests as the equivalence baseline. |
| **03 → 05b** | 05b replaces the Phase-03 local GRN receipt with the engine call. It needs 03's idempotency + over-receipt guards + tests as the baseline. |
| **04 → 05d** | 05d migrates `cancelOrder`'s stock restore to the engine and makes it atomic per line. 04 first makes `cancelOrder`'s *status* changes atomic and adds the PI-reversal flags, so 05d only has to move the stock loop. Doing 05d before 04 would mean touching `cancelOrder` twice with a half-atomic state in between. |
| **04 → 07** | Reservation consumes on dispatch and releases on cancel. The order-line lock (04, INV-12) ensures the order's `items[]` (the reservation basis) can't be mutated out from under an active reservation. Reservation on top of an unlocked, mutable order is unsafe. |
| **05a → 05b/05c/05d** | Nothing can migrate to the engine before the engine exists. 05a lands it dormant + tested so the three migrations are pure "swap the call". |
| **05b + 05c + 05d → 06** | Reconciliation computes `Σ ledger` and compares to the summary. This is only meaningful once (a) exactly one writer exists (05d retires the duplicate — INV-7), and (b) the ledger schema is consistent across all movement types (05a's unified schema, applied by 05b/c/d). Before that, `Σ ledger` is computed from two schemas and an incomplete OUT history — garbage in. |
| **06 → 07** | Phase 07 changes the meaning of `availableQty` (→ `onHandQty − reservedQty`) and activates `reservedQty`. That semantic change is only safe if we can *trust* `onHandQty` and *detect* drift. 06 provides both. Activating reservation on numbers we can't reconcile risks compounding a hidden error into every order. |
| **05* → 08** | Warehouse transfer is a paired `TRANSFER_OUT` / `TRANSFER_IN` — two engine movements sharing a `transferId`. It cannot exist before the engine. It does **not** need reservation (07). |
| **05* → 09 (weak)** | Master-data integrity is structurally independent of the stock engine — *except* the delete guards need to read `stock` summaries ("block product delete if `onHandQty > 0`"), and `onHandQty` is an engine field (05a). If 09 ran before 05, the guard would read `availableQty` instead — acceptable but it would need re-touching. Cleaner after 05. |
| **09 → 10** | Some operational flows (RMA linking to a product, damage reason codes per category) are cleaner once products have stable ids + category ids. Not a hard block; a convenience ordering. |
| **05* → 10** | Opening stock / damage / bulk / RMA are all new movement types through the engine. |
| **anything after 05 → 11** | 11 is pure optimization (indexes, pagination, serial-lock collection). It has **no functional dependency** on 06–10. It's placed last purely so index/hook/rules churn doesn't collide with feature work. It could safely run right after 05 if scale pain forces it (see §4). |

---

## 3. WHY SEVERITY ORDER WOULD BE WRONG

| If we naively fixed in P0 → P1 → P2 order | What breaks |
|---|---|
| P0-3 (reservation) first | Reservation needs a single writer (P1-4 / Phase 05), reconciliation (P2-1 / Phase 06), and the order lock (P1-8 / Phase 04). Building it first means building it on quicksand — every later foundation phase would force a reservation rewrite. |
| P1-4 (unify writers) before P0-1/P1-1 | The engine would be built against a dispatch OUT path that still oversells and a GRN that still double-receives; 05b/05c would inherit those bugs and have to fix them anyway. Fixing them *in place* first (01, 03) gives 05b/05c a clean, tested equivalence target. |
| P1-3 (role rules) before 00's reproduction | We don't actually know the current role behavior (PLAUSIBLE, not VERIFIED). Changing `firestore.rules` `stock` block without the before/after emulator matrix risks either not fixing the real problem or opening a new hole — and every `stock` rules change fights the 1000-expression budget (`firestore.rules:1470-1505`). |
| P2-4 (PO table) late | It's a 30-minute consolidation that removes a foot-gun *before* Phases 03 and 05b touch PO status. Early is free insurance. |
| P2-1 (reconciliation) before Phase 05 | `Σ ledger` would be computed from two ledger schemas + an OUT history with gaps → the report would flag "drift" everywhere and be useless. It only works once the engine normalizes writes. |

---

## 4. PERMITTED REORDERINGS (with justification required in the STATE file)

| Swap | Allowed if | Not allowed if |
|---|---|---|
| **01 ↔ 02 ↔ 04** | These three are mutually independent (different files, no shared state). A team could run them in parallel or any order. | — |
| **03 before 01/02** | 03 is independent of 01/02. | — |
| **08 before 07** | Business prioritizes inter-warehouse logistics over sales reservation, AND 05* is complete. 08 only needs the engine. | 05* not complete. |
| **09 before 07 or 08** | 05* complete; delete guards accept reading `availableQty` as a proxy for `onHandQty` during the gap (re-touch in a later cleanup). | 05* not complete (no `stock` read basis for guards). |
| **11 right after 05** | Scale pain (list latency, Firestore cost, serial-scan timeouts) is actively hurting production. 11 has no functional dependency on 06–10. | Otherwise — keep it last to avoid churn. |
| **05a merged into 05b** | Only if the reviewer is confident the engine + first migration can land as one reviewable commit. **Default: keep split** — a dormant engine is a zero-risk merge; bundling adds runtime risk to the engine's first review. |

**Never reorder:**
- 00 before anything else.
- 05a before its migrations.
- 06 before 05* (reconciliation on inconsistent ledgers is meaningless).
- 07 before 06 (semantic change on untrusted numbers).
- 04 before 07 (reservation on a mutable order).

---

## 5. CRITICAL PATH (longest dependency chain)

```
00 → 03 → 05a → 05b/05c/05d → 06 → 07
```

**Six sequential gates** to reach reservation (the thing that makes "available stock" mean something for Sales). Phases 01, 02, 04, 08, 09, 10, 11 hang off this spine and can be parallelized by additional developers, but the spine itself is strictly sequential and is the schedule driver.

**Business sign-off is required before 07** (§7 of the Plan lists the 5 open decisions). Obtain it early — during Phases 01–06 — so it doesn't block the critical path.

---

## 6. BLAST-RADIUS AT A GLANCE (which phases need the full emulator + regression + smoke)

| Blast radius | Phases | Gate before commit |
|---|---|---|
| NONE / LOW | 00, 02, 05a, 06 | unit + build + typecheck; emulator once |
| MEDIUM | 01, 04, 05b, 05c, 08, 09, 10, 11 | + full emulator (batched) + regression matrix rows + module smoke |
| HIGH | 03, 05d, 07 | + full emulator + **full** regression matrix + **end-to-end** cross-module smoke (Lead→…→TaxInvoice, both B2B and B2C) + feature-flag verification |

---
*End of INVENTORY_PHASE_DEPENDENCY_MAP.md*
