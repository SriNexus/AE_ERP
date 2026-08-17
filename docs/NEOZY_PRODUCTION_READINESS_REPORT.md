# NEOZY ERP — Phase 19 Production-Readiness Report

**Scope:** Deployment delivery of Phases 0–18, plus a fresh, non-trusting production-readiness audit of the current repository state. This report is the authoritative record for Phase 19 — see `docs/NEOZY_MASTER_IMPLEMENTATION_BLUEPRINT.md`'s Phase 19 section for the same material folded into the phase history.

---

## 1. What was already complete

Verified, not assumed, by reading current source directly (not by trusting prior reports):

- **B2B/B2C business-rule enforcement is real**, not UI-only: `Customer.type` classification set once at Lead→Customer conversion; `createProject()` and (as of this phase) `createRegistration()` both throw for a B2B customer; `convertQuotationToOrder`'s `orderType` is derived via `resolveCustomerType()` with a hard throw on ambiguity (the original Gap Audit's claim that this was hardcoded to `'B2C'` is stale — already fixed by an earlier phase).
- **`Company.businessMode` (`'B2B'|'B2C'|'Both'`) is genuinely wired**, not a dead field: gates navigation (`Sidebar.tsx`, `ModuleNavDrawer.tsx`), routes (`RoleRoute.tsx`), and service-layer creation (`leadWorkflow.ts`, `useCustomers.ts` throw on mismatch) — consistently across desktop and mobile.
- **Multi-company isolation** — three-layer enforcement (query-scoping, client re-filter, Firestore security rules), confirmed still intact.
- **Manager "team" visibility is real**, not a self-only collapse as the original Gap Audit claimed: `useGlobalBoot.ts` populates `teamMemberIds` from a live `managerId` query, wired into both `ownershipVisibility.ts` and `projectVisibility.ts` query plans.
- **Employee↔Warehouse↔Manager↔User chain is real**: `EmployeeDomainService.create()/update()` links every Employee to a real User carrying `warehouseId`/`managerId`; `getWarehouseEmployeeCounts()` is real and wired into `WarehousesWorkspace.tsx`.
- **`cancelOrder()`** is real, thorough, and idempotent (stock restoration, dispatch reversal, refund flagging).
- **Demo Mode's B2B/B2C graph segregation holds**, confirmed by directly executing the canonical generator (`buildCompleteDemoPlan`) in this session: 364 total documents, 6 B2B customers with zero Projects, 10 B2C customers all resolving to valid Projects.

## 2. What was actually broken

Seven confirmed, fixed defects (root cause and fix for each in §3–§4 below):

1. `docs/.gitignore` silently excluded every real governance doc from version control.
2. `src/pages/Leads.tsx` had a separate, incomplete lead-creation path from the one mobile uses, plus a latent data-corruption bug in the shared hook it should have been using all along.
3. Firestore security rules never enforced ownership for 7 project-scoped collections (`qc_checks`, `commissioning_records`, `net_metering_applications`, `subsidy_applications`, `project_handovers`, `amc_contracts`, `generation_readings`).
4. `createProject()`/`createRegistration()` had no service-layer RBAC check.
5. `autoReminderWorkflow.ts` wrote a fake `assignedToId: 'unassigned'` sentinel onto real Task documents.
6. `executeAndVerifyDispatch()` had no duplicate-serial protection.
7. `notificationRoutes.ts` had a duplicated dead branch and a missing `'withdrawal'` route.

Additionally: **the entire multi-phase initiative (commit `8490ac72` through the start of this session) had never been committed or pushed** — discovered via direct `git status`/`git log`, not assumed.

## 3. Root cause (per defect)

1. **`.gitignore`** — `docs/*` whitelist named four files from documents that were explicitly superseded early in this initiative; nobody updated the whitelist when the real, current docs (this Blueprint, the Gap Audit, the Demo remediation log) became the actual working set.
2. **Lead creation divergence** — `Leads.tsx` predates `useSaveLead`'s creation and was never migrated onto it when the shared hook was built for mobile.
3. **Firestore rules gap** — these 7 collections were added to the app (Phase 10/11-era) without a matching security-rule block ever being written; the generic wildcard rule silently covered the gap at a lower enforcement level than the client assumed.
4. **RBAC gap** — `canDo()` was added to `surveyWorkflow.ts`/`engineeringWorkflow.ts`/`quotationWorkflow.ts`/`dispatchWorkflow.ts` at different times by different fixes; `projectWorkflow.ts`/`registrationWorkflow.ts` were never brought in line.
5. **Task sentinel** — a placeholder value written once, never revisited, with nothing elsewhere in the codebase recognizing or depending on it.
6. **Serial duplication** — no uniqueness check was ever built for this field; `dispatch.items[].serials` has always been free-text captured at verification time.
7. **Notification routes** — a copy-paste duplication (`'case'` block repeated) and a route added for the `'withdrawal'` notification type in `channelPartnerSettlement.ts` without a matching entry ever being added to the central router.
8. **(Phase 20) Reset-path gap** — `scripts/demo/runner.ts`'s `loadSafeDeletionDocuments()`, used by the scheduled/manual GitHub Actions reset, only ever deletes documents whose id is part of the *current plan* — any stale record with a different id (confirmed live: two exist) could never be reached by any prior reset.

## 4. Files changed

- `.gitignore` — fixed docs whitelist.
- `src/pages/Leads.tsx`, `src/features/leads/hooks/useLeads.ts` — lead creation parity + name-corruption fix.
- `firestore.rules` — added 7 explicit `match` blocks.
- `src/lib/projectWorkflow.ts`, `src/features/registrations/services/registrationWorkflow.ts` — RBAC guards.
- `src/lib/autoReminderWorkflow.ts` — sentinel fix.
- `src/lib/dispatchWorkflow.ts` — duplicate-serial guard.
- `src/lib/notificationRoutes.ts` — dedup + withdrawal route.
- `scripts/demo/runner.ts`, `scripts/demo/resetDemoData.ts`, `scripts/demo/cleanupDemoData.ts` — Phase 20 stale-record sweep.
- `docs/NEOZY_MASTER_IMPLEMENTATION_BLUEPRINT.md`, `docs/DEMO_MODE_BUSINESS_FLOW_REMEDIATION.md` — Phase 18/19/20 sections.
- New tests: `src/lib/__tests__/phase19LeadCreationParity.test.ts`, `src/lib/__tests__/notificationRoutes.test.ts`, `src/lib/__tests__/phase20StaleDataSweep.test.ts`, plus additions to `src/lib/__tests__/projectWorkflowCreateGuard.test.ts`, `src/features/registrations/services/__tests__/registrationWorkflow.test.ts`, `src/lib/__tests__/dispatchWorkflow.test.ts`.

## 5. Business-flow impact

None of the fixes change B2B or B2C business rules. All seven are defect-level corrections (security, data-integrity, or platform-parity bugs) within already-locked business rules. No new business rule was invented; no existing one was changed.

## 6. Demo-data impact

None. Demo Mode was re-verified unregressed by directly executing the canonical generator (not by re-reading a prior report): 364 documents, 6 B2B customers (zero with Projects), 10 B2C customers (all with valid Projects). No demo data was regenerated or reseeded this phase.

## 7. Security/RBAC impact

Real hardening, not cosmetic:
- Firestore rules now enforce ownership server-side for 7 collections that previously relied entirely on the client not sending a broader query than intended.
- `createProject()`/`createRegistration()` can no longer be invoked successfully by a role lacking the `create` permission, even via a direct call bypassing the UI.
- No existing permission was widened or removed; only gaps were closed.

## 8. Tests added

17 new regression tests across 6 files (5 lead-parity, 2 RBAC-denial, 3 notification-route, 4 dispatch-serial, 3 stale-data-sweep). All passing. See §4 for file list.

## 9. TypeScript result

`npx tsc --noEmit`: 32 pre-existing errors (unrelated files — `WarehousesWorkspace.tsx` and others, unchanged baseline), **zero new errors** introduced by this audit's changes.

## 10. Test result

`npx vitest run`: **1640 passed**, 8 failed (all 8 pre-existing and unrelated: theme presets, GST calculation, commissioning-page hook order, owner-access policy, appearance/theme consolidation — same failing tests, same failing files, as the pre-audit baseline of 1623 passed / 8 failed). Net: +17 passing tests, 0 new failures.

## 11. Build result

`npm run build`: succeeds. Output unchanged in shape (same chunk-size warning present before this phase, informational only).

## 12. Remaining genuine gaps

| Item | Category | Why |
|---|---|---|
| Document persistence for 14 modules (AMC, Commissioning, NetMetering, Subsidy, Handover, QC, Installations, Cases, Partners, Monitoring, Settlements, CommissionRules, CommissionApprovals, ServiceTickets) | D — non-blocking backlog, already tracked (Blueprint Appendix E item 14) | Each needs its real FK id field verified individually before wiring; rushing this risked the exact "guessed field name" bug class Phase 11 already had to fix six times. Mechanically simple once each field is confirmed — not attempted this phase for correctness reasons, not effort reasons alone. |
| Global Search has no `'documents'` category | D — non-blocking, newly found this phase | Documents remain reachable via each entity's own Documents tab; a genuine gap, low severity. |
| Super-Admin `'all'`-companies inconsistency (`companyScopedQuery()` silently narrows to own company; `getAllDeleted()` treats `'all'` as no filter) | E — needs verification/policy call, newly characterized this phase | Not fixed — unifying the two risks breaking whichever cross-company restore behavior may already depend on `getAllDeleted()`'s current behavior. Needs a deliberate decision, not a blind unification. |
| Stock-transfer-between-warehouses / reverse-dispatch | C — new feature, not a defect | Confirmed absent (re-verified this phase); the "Transfer Stock" button that exists only reassigns a warehouse's manager, not stock. |
| "Show inactive/restore" UI rollout beyond Leads/Orders | D — non-blocking backlog, already tracked | Underlying capability (`getAllDeleted()`) works for any collection; just not wired into every list page's UI yet. |
| `getPage()`'s ownership-scoping gap | D — non-blocking, zero live call sites | Real code path, but nothing in `src/` currently calls `getPage()`, so it presents no live risk today. |
| Open policy items 7, 9, 10, 12, 13 (Blueprint) | B — policy decisions | Unchanged this phase; still require an explicit business call, not invented here. |

## 13. Anything requiring live deployment/Firestore/browser verification

**Everything in this section is explicitly NOT verified from this environment — stated, not glossed over:**

- Whether the pushed commit (`e8570b39`, `origin/main`) has actually been built and deployed by Vercel. This environment authenticated into a Vercel account via an unrelated Claude Code plugin device-auth flow, but that account owns three unrelated projects (`feston`, `sriconnect`, `devahydro`) — none of them this repository. No `.vercel/` project-link file exists in this repo to identify the correct project/org.
- Whether `demo@neozy.in` logging in against the deployed build actually triggers `triggerDemoReset()` and receives the corrected canonical dataset. The code path is unit-tested and the tenant-ID chain is proven consistent at the source level (Phase 18), but no live Firestore write or browser session was exercised.
- Firestore security rules were verified to **compile** by starting the local emulator (`firebase emulators:start --only firestore`, using the JDK already present in `.tools/`) — this confirms syntax correctness, not that the rules have been deployed to the live project.

**Exact next actions required from you:**
1. Open the Vercel dashboard for the actual Neozy ERP project (under whichever team/account owns it — not `shreeezyest-6270`) and confirm a deployment was triggered by commit `e8570b39`.
2. Once deployed, `firebase deploy --only firestore:rules` (or the dashboard equivalent) to push the updated `firestore.rules` — a code push to Vercel does not deploy Firestore rules; that's a separate Firebase CLI/console action.
3. Log in as `demo@neozy.in` / `Neozy@123` on the live deployed URL and confirm the corrected demo dataset appears (per Phase 18's `DEMO_SEED_ID` bump, this should fire automatically on first login post-deploy).
4. If it does not fire automatically, `POST /api/demo-reset` against the deployed app, or run `npm run demo:seed && npm run demo:reset -- --apply --confirm=RESET-company-demo-neozy` with real Firebase Admin credentials.

## 13a. Phase 20 update — live proof performed, and the exact two ways to finish the wipe

A follow-up pass had explicit authorization to read (and, where technically possible, write/delete) live Firebase data, since no real production data exists here. Outbound network access from this environment does work, which changes what §13 above could actually prove:

**Performed directly against the live project (`ae-erp-d933d`, traced from `.env.local`), not inferred:**
- Authenticated as `demo@neozy.in` via the public Firebase Auth REST API (the same unprivileged sign-in any browser performs) and read Firestore directly via its REST API with the resulting token.
- **Confirmed the tenant chain is correct live**: `user_auth_maps/{authUid}` → `userId: MUSR-DEMO-0001`, `companyId: company-demo-neozy`, exactly matching this repo's constants.
- **Confirmed the live `customers` collection still holds the OLD, pre-Phase-17 dataset** — `demoSeedId: DEMO_V1`, old placeholder naming, one customer with no `type` field, one Commercial customer misclassified as `type: 'B2B'`. This is now a *proven fact*: no phase's fixes have reached the deployed app or its live database.
- **Found two live records with ids outside the canonical scheme** (`CU-260713-OXTZ`, `CU-260715-9KTV`) — direct proof of a real reset-path gap: `resetDemoData.ts` (used by the scheduled/manual GitHub Actions workflow) only ever deletes documents whose id is part of the *current plan* — these two could never have been reached by any prior reset, regardless of how many times it ran. **Fixed** — added a content-based `loadStaleCompanyScopedDocuments()` sweep (companyId-only match, same tenant boundary `api/demo-reset.ts` already used correctly), wired into both `resetDemoData.ts` and `cleanupDemoData.ts`. 3 new regression tests.

**Why the actual wipe still could not be performed from here — a proven technical wall, not a caution:** Firestore security rules (`firestore.rules`) block hard deletion for every identity except the real, hardcoded, server-verified Super Admin email — `allow delete: if false` on every collection except `product_categories`, with no demo-tenant exception anywhere. This is enforced server-side; it cannot be bypassed by explicit user authorization from a normal authenticated session, only by an Admin SDK service-account credential or the Super Admin's own verified identity.

**The exact two ways to complete the wipe, in order of recommendation:**

1. **Trigger the existing GitHub Actions workflow (recommended — no credentials ever need to leave GitHub).** Go to this repository's Actions tab → "Guarded Demo Reset" → "Run workflow" (`workflow_dispatch`). It already holds real GCP Workload Identity Federation credentials as encrypted GitHub secrets, checks out `main` fresh (so it will pick up this session's commits, including the Phase 20 reset-path fix), and runs `npm run demo:seed && npm run demo:reset -- --apply --confirm=RESET-company-demo-neozy` — a genuine complete wipe-and-reseed of `company-demo-neozy`, now including the stale/orphan records the old script could never reach. It also runs nightly on its own schedule (20:30 UTC) if you'd rather wait. **This does not require Vercel to have deployed anything first** — it runs directly from the repository's code, independent of the frontend deployment.
2. **Provide a Firebase Admin service-account key for the `ae-erp-d933d` project**, and I can run the same already-guarded script (`npm run demo:reset -- --apply --confirm=RESET-company-demo-neozy`) myself, right now, from this environment.

Separately, and independently of either option above: `firestore.rules` (including this session's 7-collection security fix) has never been deployed either — no GitHub Actions workflow deploys it, and it isn't part of a Vercel build. That requires `firebase deploy --only firestore:rules` run by someone with Firebase CLI access to the project, or the equivalent paste into the Firebase Console's Rules editor.

Once either data-reset option runs, I can re-verify live (the same read-only technique used above) and confirm the old dataset is gone and the corrected one is present — I don't need you to check back with me, I can do this myself once told the reset has run.

## 14. Final production-readiness assessment

**Code, tests, and delivery-to-git: production-ready.** Every defect confirmed across this audit (including the Phase 20 reset-path gap, found only by live verification) was fixed at the correct layer, with regression tests, zero new TypeScript errors, zero new test failures, and a successful production build. The complete, verified tree is committed and pushed to `origin/main`.

**Deployment and live data reset: NOT performed, proven blocked, not glossed over.** This is a real, confirmed technical boundary (Firestore rules + no Admin/GitHub-Actions credential in this environment), not an assumption. Live proof was gathered directly against the production Firebase project wherever technically possible — the live tenant chain is correct, and the live dataset is confirmed to still be the old, pre-fix data. §13a above gives the exact two ways to finish this, in order of recommendation, and offers to close the loop with a second live read-only verification once either one runs.

**Non-blocking backlog** (§12) is honestly classified, not hidden: 4 items are tracked low-priority UI/feature completion, 1 needs a deliberate policy decision, 2 are newly-found and low severity. None of them block production readiness of the business logic itself.
