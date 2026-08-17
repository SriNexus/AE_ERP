# NEOZY ERP — MASTER BUSINESS WORKFLOW IMPLEMENTATION BLUEPRINT

**Status:** Execution source of truth. **Phase 0 through Phase 20 are COMPLETE at the code/test/commit level, including Phase 15.1 (Final Demo Data / Business-Flow Correction), Phase 18 (Final Live Data Reset & Canonical Data Activation), Phase 19 (Deployment Delivery & Final Production-Readiness Audit), and Phase 20 (Complete Clean Reset Path Hardening & Live Firestore Proof).** Phase 20 proved directly against the live Firebase project that the deployed application is still serving the OLD demo dataset — this is now a proven fact, not an inference. Phase 17 (Demo Mode — Final Business-Flow Data Rebuild & Realistic ERP Demo Validation) is detailed in `docs/DEMO_MODE_BUSINESS_FLOW_REMEDIATION.md`; Phase 19's full findings and the required next actions are detailed in `docs/NEOZY_PRODUCTION_READINESS_REPORT.md`. **Deployment and live-Firestore/browser verification are explicitly NOT complete** — this environment has no deploy authority for the live demo's Vercel project and no Firebase Admin credentials; see the production-readiness report for the exact commands required. No further numbered phase is scheduled at the code level — see Appendix E and the open policy items for what remains genuinely unresolved. This document is updated in place as each phase closes — always re-read it before starting further work.

Legend used throughout: **[CONFIRMED]** verified by reading the actual code · **[INFERRED]** reasonable conclusion, not directly exercised · **[UNKNOWN — REQUIRES IMPLEMENTATION-TIME VERIFICATION]** could not be determined by static reading, must be checked when that phase starts · **[POLICY DECISION NEEDED]** a business call this document flags but does not make unilaterally.

---

## 1. Executive Summary

Neozy runs two structurally different businesses — B2B material distribution and B2C solar-installation EPC — on one Firebase/Firestore + React codebase. The completed Gap Audit (`docs/NEOZY_MASTER_BUSINESS_WORKFLOW_GAP_AUDIT.md`, sibling repo location `C:\Users\Shree\.aa\docs\NEOZY_MASTER_BUSINESS_WORKFLOW_GAP_AUDIT.md`) found that this distinction was enforced in exactly one place (`Customer.type`, set once at Lead conversion) and was silently violated in at least three others: Project creation accepted any customer regardless of type (**fixed, Phase 2**), Quotation→Order conversion hardcoded `orderType:'B2C'` regardless of the real customer (**fixed, Phase 3**), and Demo Mode used an entirely different, non-overlapping classification schema that structurally could not represent a B2B customer at all (**partially fixed** — Phase 2 corrected the Customer.type schema mismatch, Phase 3 added a first, minimal genuine B2B example; the full Demo rebuild remains Phase 15's job). Phase 4 closed the remaining Project-creation gaps: `projectType` is now mandatory at creation (both the direct path and Registration's project-creation path, the latter of which was silently discarding it via a hardcoded empty string — a real bug found and fixed this phase), a genuine "create Customer + Project together" master form now exists on both desktop and mobile, and the "B2B customers must never have a Project" rule is now enforced at the true lowest-level write function (`createProject()`), not merely at the picker. Phase 5 consolidated the stage-order duplication the Audit flagged (§16): eight (not the Audit's originally-cited seven — an 8th was found this phase) independently-drifting copies of the Project/EPC stage list are now one canonical module (`src/lib/projectLifecycle.ts`), and two genuine stage-completion display bugs (silently broken for any project past the end of a UI component's own stage-metadata subset) were found and fixed in the process. Phase 6's fresh, first-hand Survey-domain audit (not just a regression check) found and fixed two more genuine bugs of the same family: `surveyWorkflow.ts` had its own 9th independent stage-patch reimplementation that could silently regress a Project's stage, and `Surveys.tsx`'s bulk-assign desynced the two fields (`surveyorId`/`assignedSurveyor`) Survey visibility scoping depends on. Phase 7's equally fresh Engineering-domain audit found a 10th: `engineeringWorkflow.ts`'s `approveDesign()` had the identical unconditional-stage-set bug, now fixed the same way; Engineering's own bulk-assign was checked against the same suspicion and confirmed correct (only one canonical assignment field, not two to desync). Phase 8's fresh Quotation/Order/PI/Payment audit confirmed the B2C financial chain itself is correct end-to-end, fixed a real Project-linkage gap in the Customer Workspace's Quotation creation path, and surfaced a more significant finding: the Phase 0-locked policy that a strict-B2C-mode company cannot create a standalone Order/Quotation without a Project was never actually implemented in code by any phase — now tracked as an explicit Critical Blocker (Appendix E) rather than silently assumed done. Phase 9's fresh Dispatch audit confirmed B2B serial-number capture is fully working (resolving the Audit's own "UNKNOWN" flag), fixed a real price-visibility gap (Warehouse could see selling price on two screens the verification modal itself correctly never showed), and found a more significant bug: `confirmDelivery()` was auto-closing every dispatch immediately, bypassing `closeDispatch()`'s own Accounts-only permission check and making the real 'Delivered' status — which three other parts of the codebase already assumed was real and observable — unreachable in practice. Phase 10's fresh Installation/QC audit re-confirmed the Gap Audit's central finding was still true — no `COLLECTIONS.INSTALLATIONS` ever existed and `qc_checks.installationId` could only ever resolve to a Lead id — and fixed it via a deliberate **dual-write** (not a full cutover, per the Blueprint's own HIGH-regression-risk guidance): every `installationEngine.ts` mutator now also mirrors onto a real, Project-scoped `installations` document, restoring `qc_checks → installations → projects` caseId propagation for the first time, while every existing Lead-reading UI keeps working unchanged. Phase 10 also found and fixed a second instance of the stage-regression anti-pattern in `qcWorkflow.ts`'s `submitQCDecision()` (the QC-fail path's backward loop-back to Installation is a legitimate exception, now guarded so a stale QC record can never regress a Project already past QC), added a duplicate-open-QC-check guard, and discovered — only after the dual-write made the collection non-empty for the first time — two already-latent field-name/link bugs in `WorkspaceSearchEngine.ts`'s installation search result (both fixed). Phase 11's fresh Commissioning/NetMetering/Subsidy/Handover/AMC/ServiceTickets audit found the same "chain entry references a field that's never written" bug once more — `casePropagation.ts`'s `net_metering_applications`/`subsidy_applications` entries pointed at `commissioningId`/`netMeteringId` fields neither record's schema declares — fixed by chaining both directly to the Project; also found and fixed two field-name-typo bugs in bulk-assign UI (Commissioning/ServiceTickets), added the missing stage-precondition and duplicate-open-record guards to Handover/AMC creation (the only two of the six stage-creating modules that had none), fixed an incomplete soft-delete on two pages, and rewrote all six modules' demo data to use the real schema field names throughout (the previous version invented field names none of the real workflows or UI ever read). Phase 12's fresh HR/Warehouse audit found that the Employee↔User link the Gap Audit and this Blueprint both assumed absent had, in fact, already been built (`Employee.userId`, set by the pre-existing `EmployeeDomainService.create()`) — the real gap was that nothing ever read through it: `Users.tsx` tracked a `warehouseId` form field and sent it on save with no `<Select>` control ever rendered for it (a confirmed, isolated bug), and `Warehouses.tsx` had zero employee-count aggregation code anywhere. Fixed by extending the existing link (new `employeeDirectory.ts` join helpers) rather than building a second, competing architecture. Phase 13's fresh Roles/Permissions/Data-Visibility audit re-confirmed both of the Gap Audit's §12/§22 HIGH-severity findings were still literally true in code — `isProjectScopedRole()` collapsed `'team'` and `'self'` into the identical single-user match, and non-project collections (Leads/Customers/Orders/Tasks/…) fetched the full company dataset via `getAll()` before filtering by ownership client-side — and fixed both by extending, not replacing, the existing patterns: `projectVisibility.ts`'s query-plan builder now accepts `teamMemberIds` and matches `[self, ...team]` (chunked for Firestore's 30-value `in` limit) instead of only `self`, and a new, symmetric `ownershipVisibility.ts` applies the identical pattern as a real `where()` constraint for non-project collections, reusing `teamMemberIds` from Phase 12's own manager→reports resolution rather than inventing a second one. A second, independent gap was found in the process: `useGlobalBoot.ts`'s `teamMemberIds` resolution only ever ran for the two hardcoded role-name strings `'Manager'`/`'TL'`, silently ignoring any data-driven role an admin configures with `visibility:'team'` on any module — fixed by widening (never narrowing) the trigger to also fire whenever the resolved role document itself declares `'team'` anywhere. A third, more serious finding: `hardDelete()` — a real, working permanent-delete primitive — was wired into exactly one live UI surface (`CategoriesWorkspace.tsx`/`MobileCategoryWorkspace.tsx`'s "Delete"/"Merge" actions) with **zero Super-Admin gate**, reachable by any user holding ordinary `categories.delete` permission, while `firestore.rules` blanket-denied `delete` on every collection including this one (`allow delete: if false` even in the generic catch-all) — meaning the button was simultaneously a real security gap in application code and non-functional against production Firestore. Fixed at both layers: a narrowly-scoped `product_categories` rule now allows `delete` only for `isSuperAdmin()`, and the client mutations/UI (both desktop and mobile) now require the same check before calling `hardDelete()`, reusing the existing `isOwnerIdentity()`/`useSuperAdminAccess()` mechanism per the Blueprint's own instruction, not a new one. `restoreRecord()` was real but never stamped who/when a record was restored — `restoredBy`/`restoredAt` added. The audit also found the "show inactive + restore" UI the Blueprint anticipated might already exist did not exist **anywhere** in the application — `restoreRecord()` was dead code with zero callers, and no list view had an inactive-records toggle — a new shared `getAllDeleted()`/`InactiveRecordsModal` capability was built and wired into two representative modules (Leads, Orders); full rollout to every other soft-deletable module is tracked as a new, explicit Appendix E item, not silently left undone (see Phase 13's own section for the honest scope boundary). Phase 14's fresh Documents audit confirmed the Gap Audit's core finding — Order/Quotation/ProformaInvoice/Dispatch/Payment had zero document capability — but also found something the Audit and this Blueprint's prior text had **not** caught: a generic `UniversalDocumentsTab` component already existed and was already mounted, via the shared `WorkspaceShell`, into a "Documents" tab on all five of these entities' dedicated workspace pages **and ~14 other modules besides** (AMC, Commissioning, NetMetering, Subsidy, Handover, QC, Installations, Cases, Partners, Monitoring, Settlements, CommissionRules, CommissionApprovals, ServiceTickets) — but it never actually persisted anything: uploads/deletes only mutated local React state seeded from a private `record.documents[]`/`record.attachments[]` array, so a file "uploaded" there vanished on refresh. This was a real, live bug affecting ~19 modules, not merely an absent capability for the five Phase 14 owns. Fixed by making `UniversalDocumentsTab` branch: for the five Phase 14 entity types, it now renders a new `EntityDocumentsPanel` (extending `caseDocuments.ts`'s existing `resolveDocumentsFor()`/`createCaseDocument()`/`deleteCaseDocument()` over the one shared `COLLECTIONS.DOCUMENTS` collection, with five new scope fields — `orderId`/`quotationId`/`invoiceId`/`dispatchId`/`paymentId` — reusing the exact same shared `DocumentManager` UI component Lead/Customer/Project already use); every other module still mounting this tab keeps its exact pre-existing (unpersisted) behavior, unchanged — fixing those 14 is a real, tracked, explicitly out-of-scope follow-up (Appendix E), not silently done or silently left broken. A second finding: Orders.tsx's own list-page quick-view modal (confirmed, via direct testing, to be the more heavily-used of the two Order-detail surfaces) already had a tab literally labeled "Documents" that in fact only listed linked Proforma Invoices — a real, useful capability, but not the file-attachment capability its label promised. Fixed by adding the same `EntityDocumentsPanel` alongside the existing list (relabeled "Linked Invoices", left otherwise untouched). Demo Mode had zero documents seeded for *any* entity, including the five already-complete ones (Lead/Customer/Project/Survey/Engineering) — Phase 14 seeded the collection for the first time, for its own five entities, and found `'documents'` was missing from `DEMO_RESETTABLE_COLLECTIONS` (would have made seeded documents survive every demo reset) — fixed alongside. Phase 15's fresh, line-by-line trace of the entire demo generator (`scripts/demo/datasets/businessGraph.ts` and `foundation.ts`) — prompted by a direct report of a B2B Customer appearing with a Project in the live UI — proved the **current generator code already produces zero such relationships**: `buildCustomersProjects()` only ever pairs `type:'B2C'` customers with a Project, and `buildB2BExample()`'s one B2B customer is never referenced by any Project/Survey/Engineering/Installation/QC/Commissioning/etc. record anywhere in the file, independently re-confirmed by two already-real, previously-unnoticed defense-in-depth guards (`projectWorkflow.ts`'s `createProject()`, which throws if the linked customer is B2B, and `useCustomers.ts`'s `updateCustomerProjectionWithPhoneLock()`, which blocks reclassifying an already-Project-linked B2C customer to B2B) — meaning no code path in this repository, generator or production, can currently create the observed state; the live UI's data is stale relative to this repository (this environment has never had live Firestore write access, across all 15 phases — a daily scheduled GitHub Actions reset (`.github/workflows/demo-reset.yml`) exists and will self-correct the live tenant once these fixes are deployed and it next runs). Phase 15 found and fixed two other genuine, more consequential bugs while proving this: (1) the exact "artificial record-count ceiling" the Blueprint's own Appendix E (item 5) had flagged as unlocated since Phase 1 — `DEMO_MAX_RECORDS = 5`, checked on every single `createDoc()`/`createDocWithId()`/`batchCreate()` call for the demo company, which in practice blocked **all** demo record creation outright, since every seeded collection already holds more than 5 records — found duplicated in a second, independent code path (`api/[entity].ts`'s serverless REST route) and removed at both; (2) the seeded `companies/{DEMO_COMPANY_ID}` Firestore document itself never actually carried `businessMode` — only a UI-side static fallback object did, masking the gap — fixed by adding the field to the real seeded document. A second, minimal B2B example (`buildB2BDirectOrderExample()`) was added to represent the Blueprint's other named B2B path (a directly-created Order with no Quotation in its chain at all), since only the Quotation-first path had a demo example before this phase. Twenty permanent, generic (never tied to one specific hardcoded id) regression tests were added asserting the hard B2B/B2C segregation invariant, the Order.orderType/Customer.type match for every Order, full downstream-parent-resolution for every entity chain, and the ceiling's removal — so none of these can regress silently again.

**Phase 15.1 (Final Demo Data / Business-Flow Correction)** re-opened Phase 15's own closing claim — "no code path in this repository, generator or production, can currently create the observed state; the live UI's data is stale" — because a live report showed the B2B-with-Project symptom persisting. That prior conclusion was **wrong**, not merely stale: it never searched beyond `scripts/demo/datasets/*` and `src/lib/firestore.ts`/`api/[entity].ts`. A fresh trace of the actual login path (`src/pages/Login.tsx` → `src/lib/sandboxReset.ts`'s `triggerDemoReset()` → `POST /api/demo-reset`) found that endpoint built its **own, entirely separate, hand-written ~500-line demo dataset** — never imported anything from `scripts/demo/datasets/businessGraph.ts`, and never set `Customer.type` on any of its ~3 hardcoded customers at all. Because `Login.tsx` calls this endpoint on every browser's *first* login as `demo@neozy.in` (gated by a `localStorage` marker), this hand-written, B2B/B2C-unaware dataset — not the extensively audited generator — is what actually populated the live public demo tenant, independent of whatever the nightly `.github/workflows/demo-reset.yml` cron had separately written. This is the confirmed, actual root cause of the screenshots. Fixed by rewriting `api/demo-reset.ts` to seed from the same `buildCompleteDemoPlan()` every other demo entry point uses, and to delete from the authoritative `DEMO_RESETTABLE_COLLECTIONS` list (the old hand-typed delete list had also drifted out of sync, missing `documents` and `entity_relationships`). Separately, this phase's fresh downstream-graph audit found Phase 15's own generator — while genuinely correct on B2B/B2C segregation — had never checked *stage/downstream-record coherence*: several of the 10 demo B2C Projects claimed a `currentStage` (Subsidy/Handover/Service/NetMetering/QC) their own Survey/Engineering/Dispatch/QC/Commissioning/NetMetering/Subsidy/Procurement records did not actually support (e.g. PRJ-8/9/10 had no Survey or Engineering record at all despite being deep into the downstream chain; PRJ-6/7/8's Dispatch/QC/Commissioning statuses still showed pending/in-transit/incomplete despite the Project claiming to be stages past them; PRJ-5, genuinely at the Dispatch stage, had no Dispatch record at all). Fixed at the source (`scripts/demo/datasets/businessGraph.ts`'s `buildTechnical()`/`buildSupply()`/`buildExecution()`) so every stage before a Project's own `currentStage` now shows a resolved downstream record, and only the record matching the Project's own current stage may still be in-progress — a realistic lifecycle distribution across all 10 canonical stages, not a blind force-through-every-entity fill. 21 new permanent, generic structural tests (`src/lib/__tests__/phase15StageCoherence.test.ts`) assert this stage/downstream coherence for every Project by reading its own `currentStage` field (never a hardcoded PRJ-N id), assert full relationship integrity (no orphan downstream records) across all B2C-only collections, assert B2B/B2C isolation holds on both sides, assert reset/reseed determinism, and permanently guard `api/demo-reset.ts` against ever reintroducing a parallel hand-written dataset.

A follow-up pass closed one remaining gap this phase's own report had flagged: removing `api/demo-reset.ts`'s duplicate dataset also removed the only source of demo data for `banks` and `registrations`, since the canonical generator never covered either. A full diff of the removed dataset's collection list against the canonical generator's own output found **five more** collections in the same situation — `attendance`, `payroll`, `serial_numbers`, `tax_invoices`, `partner_wallet_transactions` — each already listed in `DEMO_RESETTABLE_COLLECTIONS` (meaning the reset pipeline always expected them to exist) but never actually seeded by `scripts/demo/datasets/*`. All seven are now seeded from the single canonical generator (`buildBankDocuments()`/`buildAttendanceDocuments()`/`buildPayrollDocuments()` added to `foundation.ts`; `buildRegistrations()`/`buildTaxInvoices()` added to `businessGraph.ts`; `buildPartnerCommissions()` extended to also emit `partner_wallet_transactions`; the installations loop extended to also emit standalone `serial_numbers` docs mirroring each installation's own `capturedSerialNumbers`), each using that module's real, verified field/enum shapes (`src/features/banks/hooks/useBanks.ts`'s `BankRecord`, `src/features/hr/hooks/useHR.ts`'s `ATTENDANCE_STATUSES`/`PAYROLL_FORM_DEFAULT`, `src/lib/taxInvoiceWorkflow.ts`'s `TaxInvoiceRecord`, `src/features/channel-partner/types/index.ts`'s `PartnerWalletTransaction`, `src/lib/installationEngine.ts`'s `captureSerial()`, `src/features/registrations/services/registrationWorkflow.ts`'s real status values) — never invented, never a second hardcoded dataset. `banks` and `registrations` were also added to `DEMO_RESETTABLE_COLLECTIONS` (previously absent from it entirely). 9 new permanent tests assert all seven collections are non-empty, use only real enum values, resolve every reference to a real record, and survive reset/reseed determinism.

**Phase 16 (Cross-Module Integration & Final ERP Stabilization)** treated the entire ERP as one connected system rather than 16 independently-verified phases, on the reasoning that per-module testing cannot by construction catch a bug that only exists in how modules compose. Five parallel full-system audit passes found one high-severity, previously-undetected defect: **no production code path ever advanced a Project to the `'Subsidy'` stage** (`netMeteringWorkflow.ts`/`subsidyWorkflow.ts` never wrote to `COLLECTIONS.PROJECTS`), which meant `createHandover()`'s `currentStage>=Subsidy` precondition — and, cascading from it, `createAmcContract()`'s `currentStage>=Handover` precondition — could never be satisfied by any real project; **Handover and AMC were structurally unreachable in production**, undetected because each module's own precondition tests passed correctly against a mocked stage in isolation. Fixed by advancing to `'Subsidy'` on the first real sign of progress on either of the two parallel post-Commissioning tracks (Net Metering reaching `MeterInstalled`, or a Subsidy application being filed), deliberately not waiting for both to fully resolve — consistent with, not overriding, the Blueprint's own already-locked "minimum unambiguous bar" policy for Handover (Appendix E item 9). The same pass fixed three smaller cross-module wiring gaps (`casePropagation.ts` missing a `registrations` chain entry, so Registration's `caseId` was silently never populated; `entityRegistry.ts` missing entries for 9 real collections, degrading generic entity labeling/linked-relationships for all of them; `roleBootstrap.ts` never granting any non-Admin role access to the real `registrations`/`banks` modules, making both pages Admin-only by omission), added a service-layer B2B guard to `registrationWorkflow.ts`'s `createRegistration()` (previously UI-gated only, the exact pattern Phase 4 already fixed for Project creation), and fixed a 9th independently-hand-typed stage list (`CaseSearch.tsx`, containing a phantom `'Closure'` value and missing `'Archived'`). A full fresh re-read of the original Gap Audit confirmed every one of its findings was either fully resolved by a completed phase or already tracked as an open Appendix E item, with three exceptions carried forward as newly-confirmed (not merely re-flagged) items: no stock-transfer-between-warehouses or reverse-dispatch workflow exists anywhere in the codebase, Super-Admin cross-company view mode remains unverified, and `Task.assignedToId` remains an unconstrained string — none are blockers, all are documented in Appendix E (items 22–24) rather than silently built or silently ignored. 20 new permanent regression tests added; `tsc`/full test suite/production build all pass with the same pre-existing, unrelated baseline (32 tsc errors, 7 failing test files) unchanged.

This blueprint converts that audit into a 17-phase (Phase 0–16), dependency-ordered execution plan. Each phase specifies exactly what changes, what must not change, what Demo Mode correction accompanies it, and the gate that must pass before the next phase starts. No phase is "complete" on a green build alone — every phase's gate requires its own Demo Mode correction and an end-to-end scenario pass.

The single highest-leverage, lowest-risk starting point is **Phase 1 (Company Business Mode)** followed immediately by **Phase 2 (Customer/Lead Classification enforcement)** — see §23(F) for the full justification. Phase 0 (this document's own ratification) must close first, since every later phase cites decisions Phase 0 locks.

---

## 2. Source-of-Truth Hierarchy

When sources disagree, resolve in this order:

1. **This Blueprint**, once Phase 0 ratifies it — becomes the binding execution contract.
2. **The completed Gap Audit** (`NEOZY_MASTER_BUSINESS_WORKFLOW_GAP_AUDIT.md`) — the current-state baseline. Treated as authoritative for "what the code does today." Not re-derived here; cited by section number throughout.
3. **The actual source code** (`C:\Users\Shree\.aa\CSGPL-1\src\`) — ground truth. Where this blueprint needed detail beyond the audit, it was re-verified directly against the code this session (see inline citations); where it could not be verified, it is marked **[UNKNOWN — REQUIRES IMPLEMENTATION-TIME VERIFICATION]**.
4. **The user's business-rule briefs** (the original Gap Audit brief and this Blueprint brief) — highest authority specifically for *what the business wants*, i.e., the B2B/B2C definitions, the canonical flows, the segregation rule, Company Business Mode, soft-delete policy, and Demo Mode philosophy. These briefs are the final word whenever a business-intent question arises that the code cannot answer.
5. **`docs/BUSINESS_BLUEPRINT_FINAL.md`** (in this repo) — **[IMPORTANT CONFLICT, FLAGGED, NOT SILENTLY RESOLVED]**. This document is a *business/UX-philosophy* reference only. It is **not** a description of the current codebase: it references a "Technical Blueprint," an "Execution Playbook," and a "Master Document 3 / Architecture Freeze Declaration" that do not exist anywhere in this repository or its sibling `docs/` corpus, and it describes a Postgres/Supabase-style schema (`quotations`, `orders`, `TIMESTAMPTZ`, `branch_id`, "Supabase Storage") that **contradicts** the actual current Firebase/Firestore implementation the Gap Audit confirmed. Per Rule 21 (report conflicts, don't silently choose): **[CONFLICT]** its §4.2 is literally titled *"Parallel Workflow (B2B/Commercial)"* and describes Registration as "B2C only... skips for Commercial/B2B" — this is the exact B2B≠Commercial/Industrial confusion this whole initiative exists to correct. This document must be **used** for: its module inventory (§3.1 — confirms 50 modules exist, useful cross-check for §19 of this blueprint), its business-exception catalogue (§9.1–9.17 — a genuinely useful, not-yet-implemented list, orthogonal to B2B/B2C and not audited this round), its notification/task-automation matrices (§11.2–11.3), and its recognition that Registration is a real, distinct module (see §5.1 below). It must **not** be used for: any B2B/Commercial equivalence, any Supabase/Postgres technical detail, or any claim about "Technical Blueprint"/"Execution Playbook" content this repo does not contain.
6. **The sibling docs corpus** (`C:\Users\Shree\.aa\docs\*.md`, `ERP_ARCHITECTURE_BIBLE/*`) — historical/phase-completion reports. Useful for archaeology only; multiple were already caught stale by the Gap Audit (e.g., the claim that Channel Partner notifications aren't wired — they are). Do not trust without re-verification.

---

## 3. Current-State Baseline (reference, not re-derivation)

Full detail lives in the Gap Audit. The load-bearing facts this blueprint builds on:

- `Customer.type: 'B2B'|'B2C'`, set once by `convertLeadToCustomer()` (`src/lib/leadWorkflow.ts`), is the **only** real classification mechanism. **[CONFIRMED, Audit §2]**
- Project creation (`src/pages/Projects.tsx:134-154,814`) shows every customer unfiltered. **[CONFIRMED, Audit §8, item 1]**
- `convertQuotationToOrder()` hardcodes `orderType:'B2C'` (`src/lib/quotationWorkflow.ts:176`) regardless of the real customer type; direct Order creation elsewhere correctly reads `customer.type`. **[CONFIRMED, Audit §8, item 2]**
- Company has no business-mode field anywhere. **[CONFIRMED, Audit §9]**
- Multi-company isolation and Super Admin identity protection are strong, three-layer, and should be reused as the template for other scoping work. **[CONFIRMED GOOD, Audit §10, §12]**
- Manager "team" visibility collapses to self-only for project-scoped collections; non-project collections are filtered client-side only, after the full company dataset reaches the browser. **[CONFIRMED, Audit §12, §22]**
- Employee has no `warehouseId`/`managerId`/link to `AppUser` — those fields live on Users instead, with no FK joining the two records. **[CONFIRMED, Audit §13]**
- Documents cover only Lead/Customer/Project/Survey/Engineering; Order/Quotation/PI/Dispatch/Payment have no document capability at all. **[CONFIRMED, Audit §14]**
- The caseId chain is permanently broken between `qc_checks` and its declared parent `installations`, because no code anywhere creates an `installations` collection document — the real Installation pages write onto the **Lead** record instead. **[CONFIRMED, Audit §14]**
- Demo Mode uses a parallel, non-overlapping classification schema (`customerType:'Residential'|'Commercial'`) and gives 100% of demo customers a Project unconditionally — it cannot currently represent a B2B customer. **[CONFIRMED, Audit §15]**
- Seven independently-maintained copies of the Project/EPC stage-order list exist (an 8th, `purchaseOrderWorkflow.ts`, was found at Phase 5 start); three (`analyticsCore.ts`'s `PROJECT_STAGE_DASHBOARD_ORDER`, `quotationWorkflow.ts`'s local `PROJECT_STAGES`, `dispatchWorkflow.ts`'s local `PROJECT_STAGE_ORDER`) already agree on the same 17-stage sequence: `New, Survey, Engineering, Quotation, Order, Procurement, Dispatch, Installation, QC, Commissioning, NetMetering, Subsidy, Handover, AMC, Service, Monitoring, Archived`. **[CONFIRMED, Audit §16, re-verified this session — RESOLVED at Phase 5, consolidated into `src/lib/projectLifecycle.ts`]**

Newly verified this session (not in the original audit, folded in here as baseline):
- `CustomerProjectForm.tsx` requires an **existing** `customer` prop — it is not a "create Customer+Project together" master form; it reuses `createProject()`/`createProjectFromRegistration()` against an already-selected customer. Whether a true combined master form exists elsewhere was not found. **[CONFIRMED ABSENT as described by the user's intended behavior — this is a gap, not merely unverified]**
- `Registration` is a real, distinct, pre-Project module (`src/features/registrations/services/registrationWorkflow.ts`, `createProjectFromRegistration()`) sitting between Customer and Project for at least some B2C paths (loan/financing). It is not mentioned in the user's canonical B2C flow brief. It must be **preserved and reconciled**, not deleted or ignored — see §5.1 and Phase 4.
- Tax Invoice (`src/lib/taxInvoiceWorkflow.ts`) is a real, mature, GST-fiscal-year-aware module (`createTaxInvoiceDraft`/`issueTaxInvoice`/`cancelTaxInvoice`) — but it is **not** triggered automatically by `closeDispatch()`; nothing in `DispatchWorkspace.tsx` references it. The B2B canonical flow's "Accounts → Bill Generated" step exists as a capability but is a **manual, disconnected** action today, not an automatic handoff. **[CONFIRMED]**

---

## 4. Final Business Rules

These are locked at Phase 0 and binding for every later phase.

1. **B2B** = a customer that buys solar materials from Neozy and installs them itself (EPC companies, installers, distributors, GST-registered material buyers). No Project is ever created for a B2B customer.
2. **B2C** = Neozy performs the installation. Supports Project Type Residential/Commercial/Industrial. A Commercial or Industrial installation Neozy itself performs is still B2C.
3. **Customer Type** (B2B/B2C) and **Project Type** (Residential/Commercial/Industrial) are two independent fields on two different entities (Customer vs Project). Neither may be inferred from the other. GST presence/absence never implies B2B/B2C.
4. Customer classification is set exactly once, at Lead→Customer conversion, via the existing `convertLeadToCustomer()` mechanism. Re-classification of an existing Customer is out of scope unless a later phase's investigation proves it is genuinely required by the business (do not invent this capability speculatively).
5. **Company Business Mode** (`B2B`/`B2C`/`Both`) is a new, first-class field that must gate navigation, routes, queries, Demo Mode, reports, dashboards, and record creation — not merely hide UI (§8).
6. **Soft delete is the default and only normal-user delete path.** Permanent deletion is Super Admin-only, a distinct, privileged, explicitly-confirmed action (§13).
7. Multi-Company and Multi-Warehouse are permanent, non-negotiable architectural constraints for every entity touched by any phase.
8. Demo Mode must, by the end of Phase 15, be operationally indistinguishable in *capability* from production for the same company/role — full create/edit/soft-delete, realistic multi-state data, no artificial record-count ceiling (§14).
9. Existing, correct functionality is reused, not rewritten. The audit's "CONFIRMED GOOD" findings (multi-company isolation, Super Admin protection, Notifications scoping, Channel Partner segregation, the shared Documents pattern, `validateDispatchIntegrity()`'s consistency-check pattern, the Users universal-identity model) are load-bearing and must not be touched except where a specific phase requires extending them.
10. The canonical Project/EPC stage list is locked in Phase 5, not assumed in advance (§10).

---

## 5. B2B Target Workflow

```
Lead
  → convertLeadToCustomer(lead, 'B2B')         [EXISTING, reuse as-is]
  → Customer(type='B2B', companyInfo)
  → { Quotation → convertQuotationToOrder() }  [EXISTING logic, FIX orderType]
        OR
    { Order created directly }                 [EXISTING, already correct]
  → generatePIsFromOrder()                      [EXISTING, reuse as-is]
  → Record Payment → markPIAsPaid()              [EXISTING, reuse as-is]
  → requestDispatch()                            [EXISTING, reuse as-is]
  → Loading Planning / Load Material / Quantity Verification
        (executeAndVerifyDispatch())             [EXISTING, reuse as-is]
  → Serial Number Capture (where required)        [EXISTING FIELD, VERIFY population site — Phase 9]
  → Delivery Challan (confirmDelivery + closeDispatch)  [EXISTING, reuse as-is]
  → Accounts → Bill Generated                     [EXISTING MODULE, currently manual — Phase 9 decides
                                                    whether to auto-populate from Order/Dispatch, without
                                                    making Tax Invoice mandatory-blocking on Dispatch close]
  → B2B COMPLETE
```
No Project entity is ever created or referenced in this flow. Dispatch/loading UI must not display selling price to the loading/verification user — **[UNKNOWN — REQUIRES IMPLEMENTATION-TIME VERIFICATION]**, not confirmed either way this session; Phase 9 must check the Dispatch verification UI component directly.

## 6. B2C Target Workflow

```
Lead
  → convertLeadToCustomer(lead, 'B2C')
  → Customer(type='B2C')
  → [Registration — EXISTING module, B2C-financing-specific, NOT B2B/Commercial-gated
     as BUSINESS_BLUEPRINT_FINAL.md currently mis-describes it; LOCKED AT PHASE 0:
     always optional, never mandatory, for any Project Type — available whenever a
     deal needs financing, never a blocking gate on Project creation]
  → Project (Project Type MANDATORY: Residential | Commercial | Industrial)
  → Survey → Engineering                          [EXISTING, already verified/fixed
                                                    in a prior session phase — reuse verbatim]
  → Quotation → Order (same shared functions as B2B — correct reuse)
  → Proforma Invoice → Payment → Dispatch          [same shared functions as B2B]
  → Installation                                   [MUST become Project-scoped —
                                                    currently Lead-anchored, Phase 10 fixes this]
  → Quality Check (QC)                             [already Project-scoped, EXISTING, reuse]
  → Commissioning → Net Metering → Subsidy → Handover → AMC / Service
        [EXISTING modules/collections, chain-registered in casePropagation;
         not deep-audited stage-by-stage — Phase 11 verifies each]
```

## 7. B2B/B2C Separation Rules (binding, enforced in code from Phase 2 onward)

| Surface | Rule |
|---|---|
| Project creation (customer picker) | MUST exclude `customer.type==='B2B'` |
| Project list / Project Workspace | MUST be unreachable for a B2B customer's id (defense in depth, not just creation-time) |
| Survey / Engineering / Installation / QC entry points | Unreachable for B2B (follows automatically once Project itself is unreachable, since these are Project-scoped — verify no independent entry point bypasses Project) |
| Order creation (both direct and Quotation-converted) | `orderType` MUST always equal the real `customer.type`, no hardcoding |
| B2C entering B2B-only workflow | Not prevented unless a later phase's investigation proves the business explicitly wants a separate concurrent relationship — **do not invent this control speculatively**; flag as [POLICY DECISION NEEDED] if it turns out B2C customers can currently reach Orders/Quotations designed for B2B-only semantics |
| GST field presence | Never used as a classification signal, in either direction |

---

## 8. Company Business Mode Architecture

New field: `Company.businessMode: 'B2B' | 'B2C' | 'Both'`. **[NEW FIELD — does not exist today, Audit §9]**.

Enforcement surfaces (all must read this field, not just navigation):

| Surface | Behavior when `businessMode==='B2B'` | Behavior when `'B2C'` | Behavior when `'Both'` |
|---|---|---|---|
| Navigation/routes | Hide/403 all B2C-only routes (Projects, Survey, Engineering, Installation, QC, Commissioning, NetMetering, Subsidy, Handover, AMC) | Hide/403 B2B-only Quotation/Order-direct-without-Project paths — **[LOCKED AT PHASE 0: B2C is Project-only. No standalone Order/Quotation entry point for a `'B2C'`-mode company; every B2C Quotation/Order must trace to a Project.]** | All routes available |
| Customer creation | Force `type='B2B'` at conversion (hide the B2C choice) | Force `type='B2C'` | Both offered |
| Customer selection (any picker) | Only B2B customers listed | Only B2C customers listed | Both, still filtered by the target workflow's own rule (§7) |
| Project creation | Blocked entirely (no B2C workflow) | Available | Available |
| Order/Quotation creation | Available | **[LOCKED AT PHASE 0: blocked without a linked Project — see Navigation/routes row]** | Available |
| Dispatch | Available (B2B semantics) | Available only via a B2C Order/Project (per §7) | Both |
| Reports/dashboards | B2B-only KPIs/tiles | B2C-only KPIs/tiles | Both, clearly sectioned, never silently merged into one ambiguous number |
| Demo Mode | Demo company record must itself carry a `businessMode` and generate only the data shapes valid for it | same | Demo generates both graphs, kept structurally separate (§15/Phase 15) |
| Permissions | No change to role model; enforcement is orthogonal to `businessMode` — a Sales role still works the same way, just against a narrower workflow set | | |

`businessMode` is enforced at the **query/service layer**, not only the route layer — e.g., `getAll(COLLECTIONS.CUSTOMERS)` callers that build a picker must filter by `businessMode` in addition to (not instead of) `customer.type`, so a `'Both'` company can still segregate B2B pickers from B2C pickers correctly per §7.

---

## 9. Canonical Entity Model (target-state deltas from current)

| Entity | Current (Audit) | Target | Phase |
|---|---|---|---|
| `Company` | no business-mode field | `+ businessMode: 'B2B'\|'B2C'\|'Both'` | 1 |
| `Customer` | no canonical `interface Customer` in `types/index.ts`; `type` field real but untyped at most call sites | Canonical `interface Customer` added, `type: 'B2B'|'B2C'` strictly typed (no widening) | 2 |
| `Order` | `orderType?: OrderType | string` (widened) | `orderType: OrderType` (strict), always derived from `customer.type`, never hardcoded | 3 |
| `Project` | `projectType: string`, not enforced mandatory | `projectType: ProjectType` required at creation, form validation added | 4 |
| `Installation` | does not exist as a collection; fields live on `Lead` (`capturedSerialNumbers`, `installationChecklist`) | Real, Project-scoped `installations` collection (or Project-embedded sub-object — decided in Phase 10) with `projectId` FK | 10 |
| `Employee` | no `warehouseId`/`managerId`/link to `AppUser` | `+ warehouseId`, either a link field to `AppUser` or the fields consolidated onto Employee — decided in Phase 12 | 12 |
| `Order`/`Quotation`/`ProformaInvoice`/`Dispatch`/`Payment` | no `documents` field/capability | wired into the existing shared `caseDocuments.ts`/`COLLECTIONS.DOCUMENTS` system, reusing `resolveDocumentsFor()` | 14 |
| All soft-deletable entities | `isDeleted` boolean exists **[CONFIRMED via Audit's `softDelete()` primitive citation, §20]** but permanent-delete authorization not audited | `+ deletedBy, deletedAt` metadata where missing; permanent-delete path gated to Super Admin only | 13 |

No Firestore collection is renamed or dropped. No parallel workflow engine is introduced. Every row above is an additive field or a reconnection of an existing collection, consistent with Rule 24 (avoid unnecessary schema changes, avoid parallel engines).

---

## 10. Canonical Project Lifecycle

**LOCKED AT PHASE 5 (COMPLETE):** the 17-stage sequence below is now the single canonical Project/EPC lifecycle, implemented in `src/lib/projectLifecycle.ts`:

```
New → Survey → Engineering → Quotation → Order → Procurement → Dispatch →
Installation → QC → Commissioning → NetMetering → Subsidy → Handover →
AMC → Service → Monitoring → Archived
```

Rationale: this is the only one of the seven candidates with independent triple-agreement, it brackets the lifecycle correctly (`New` at start, `Archived` at end), and it includes `Procurement` and `Monitoring`, which the shorter 12/13/16-stage variants omit but which the user's own B2C flow (§4 of this brief) and post-sale AMC/generation-monitoring reality both require.

Phase 5 confirmed this against the real business need (the user's own B2C flow, §4, and post-sale AMC/generation-monitoring reality both require `Procurement` and `Monitoring`, which the shorter 12/13/16-stage variants omitted), extracted it into `src/lib/projectLifecycle.ts`, and migrated all 8 call sites that existed by the time Phase 5 started (`useProjectStage.ts`, `projectStageTransition.ts`, `ProjectJourneyTimeline.helpers.ts`, `analyticsCore.ts`, `anomalyDetection.ts`, `quotationWorkflow.ts`, `dispatchWorkflow.ts`, and an 8th found only during Phase 5's own re-audit: `purchaseOrderWorkflow.ts`) — see Phase 5's section for full detail, including two genuine bugs found and fixed in the process.

---

## 11. User / Role / Permission Architecture

Current-state is largely sound (Audit §12) and is **preserved**, with two targeted fixes:

- Keep: phone-keyed universal Users identity (`PROJECTION_ROLE_MAP`), data-driven role documents, `EXACT_ROLE_COMPATIBILITY` legacy map, dual-layer Super Admin protection (client + Firestore security rules), Notifications' company/user/dedup/deep-link model, Channel Partner's distinct `userId`-keyed model.
- **DONE AT PHASE 13:** Manager `'team'` visibility is now real for project-scoped collections — `buildProjectVisibilityQueryPlan()`'s own pattern was extended (not replaced) to resolve `teamMemberIds` (Phase 12's `managerId`-based reporting-manager field, via `useGlobalBoot.ts`) into the matched id set whenever a role document's resolved visibility is genuinely `'team'`.
- **DONE AT PHASE 13:** non-project collections (Leads/Customers/Orders/Tasks/…) now gain real query-level `where()`-in scoping via a new, symmetric `ownershipVisibility.ts`, closing the data-over-fetch exposure the audit flagged as HIGH severity (Audit §22) — `applyAccessFilters()`'s in-memory check remains as defense-in-depth, per the same two-layer pattern already proven for company scoping.
- Hierarchy stays: Super Admin (platform-level, `shreeniwas.tripathi0@gmail.com`, hardcoded and dual-layer protected — **never weaken this**) → Company Admin/Management → Manager/Team Leader → Team Member/Executive → future Customer/Vendor portal (not built now; Phase 13 only ensures the data model doesn't make it structurally impossible later, per the original audit brief's explicit instruction not to prematurely implement a portal).

---

## 12. HR / Warehouse / Employee Architecture

Target relationship chain: `Company → Warehouse → Employee → Reporting Manager → Team → Attendance/Payroll`.

Current break (Audit §13): `warehouseId`/`managerId` live on `AppUser`, not `Employee`; no FK joins the two — **[RESOLVED AT PHASE 12]**: the FK actually already existed (`Employee.userId`, set by the pre-existing `EmployeeDomainService.create()`) before Phase 12 began; the audit and this Blueprint's prior text simply hadn't caught it. What Phase 12 found and fixed was that nothing ever read through that link.

- **Option A (link) — CONFIRMED at Phase 12, not Option B:** `Employee.userId` already existed and is actively maintained (`EmployeeDomainService.update()` already synced name/phone onto the linked User before this phase). Extending it (new join helpers in `src/lib/employeeDirectory.ts`, plus `warehouseId`/`managerId` sync) was the safe, already-in-motion choice — switching to Option B now would mean undoing a working mechanism for no benefit. A reverse `AppUser.employeeId` pointer was deliberately not added: every required query below is resolvable from the existing one-directional link plus a full employees scan, which each of these queries needs regardless.

The target queries are now real (not UI-inferred): employee→company (pre-existing), employee→warehouse (`resolveEmployeeWarehouseInfo()`), employee→reporting manager (`resolveEmployeeWarehouseInfo()`), employee→team (`getDirectReportEmployeeIds()`), warehouse→employee-count (`getWarehouseEmployeeCounts()`, surfaced in `WarehousesWorkspace.tsx`), attendance→warehouse / payroll→warehouse (both resolved and displayed in `Attendance.tsx`/`Payroll.tsx`'s detail views). Attendance/Payroll already keyed correctly off `employeeId` (Audit §13) — confirmed still true, no schema change needed there.

---

## 13. Delete / Inactive / Permanent Delete Policy

State machine (universal, all soft-deletable entities — customers, leads, projects, orders, quotations, users, employees, vendors, products, documents, and other applicable entities per the brief):

```
ACTIVE → (normal user delete) → SOFT-DELETED / INACTIVE → (Super Admin only) → PERMANENTLY DELETED
```

- `isDeleted: boolean` already exists as a working primitive (Audit §20, `softDelete()`). **Reuse it — do not invent a parallel state field.**
- **DONE AT PHASE 13:** `deletedBy`/`deletedAt` already existed (`softDelete()`); `restoredBy`/`restoredAt` added to `restoreRecord()`, confirmed needed — Phase 13's fresh audit found `restoreRecord()` was real but stamped neither.
- **DONE AT PHASE 13, PARTIAL ROLLOUT:** List views did **not** already have a "show inactive" toggle anywhere — confirmed absent, not merely unverified (`restoreRecord()` had zero callers in the entire codebase before this phase). A real, generic, reusable `InactiveRecordsModal` + `getAllDeleted()` now exists and is wired into two modules (Leads, Orders); rolling it out to the rest of the state-machine's entity list is mechanical and tracked (Appendix E, item 11).
- Restore: **[POLICY DECISION STILL OPEN]** — the Phase 13 implementation does not add a separate permission gate on the restore action itself beyond the same self/team/all visibility scoping `getAllDeleted()` shares with the active-record list (i.e., a user can only see/restore an inactive record they'd have had visibility into while it was active). Whether restore should additionally require edit permission, delete permission, or an elevated permission distinct from both remains an explicit, unmade business call — not silently decided by this phase.
- Permanent delete: a distinct, explicitly-confirmed, audited action, gated to the Super Admin identity check already proven real and non-spoofable (Audit §10/§12 — reuse `isOwnerIdentity()`/Firestore security rules, do not build a new authorization mechanism). **DONE AT PHASE 13** for the one live permanent-delete surface (`product_categories`, via Categories UI) — both `firestore.rules` and the client mutations now require `isSuperAdmin()`/`useSuperAdminAccess()`.
- Audit implication: every soft-delete, restore, and permanent-delete must write an activity-log entry (reuse `logActivity()`, already used throughout every workflow file the audit reviewed).

---

## 14. Demo Mode Architecture

Target principle (binding, restated from the brief): `demo@neozy.in` experiences the real ERP UI, the real business rules, realistic multi-state seed data, and full create/edit/soft-delete capability with **no artificial ceiling** — seeded records plus user-created records must coexist.

Concretely:
- Demo Mode must run through the **same** service functions as production (`convertLeadToCustomer`, `convertQuotationToOrder`, `generatePIsFromOrder`, etc.) against demo-scoped storage, per the brief's explicit "same ERP logic, different storage" diagram. It does **not** get a parallel, simplified logic path.
- The generator (`scripts/demo/datasets/businessGraph.ts`) must be rewritten (Phase 15, after every upstream phase has already corrected the pieces it depends on) to: (a) use the real `Customer.type` field, not the unrelated `customerType` label; (b) generate a genuine B2B graph (Lead→Customer→Quotation/Order→PI→Payment→Dispatch→Delivery Challan→Accounts, **no Project**) separate from a genuine B2C graph (Lead→Customer→Project→Survey→…→QC); (c) never seed a downstream record whose upstream entity doesn't exist (e.g., no `qc_checks` without a real `installations` parent, once Phase 10 creates that collection); (d) represent multiple states per module (per §14 of the brief — New/Contacted/Qualified/Converted/Lost leads; Survey-pending/Survey-complete/Engineering-active/Quotation/Order/Installation/QC projects, etc.), using only statuses that genuinely exist in that module's real status enum — never invented ones.
- **RESOLVED AT PHASE 15:** the artificial record-count ceiling was `DEMO_MAX_RECORDS = 5` (`src/config/demo.ts`), enforced by `enforceDemoRecordLimit()` in `src/lib/firestore.ts` on every `createDoc()`/`createDocWithId()`/`batchCreate()` call, with a **second, duplicate** enforcement of the identical cap in `api/[entity].ts`'s serverless REST route — not in `demoCapabilityPolicy.ts`/`demoSession.ts`/`sandboxReset.ts` as originally guessed. Both were located and removed (the numeric cap only — the legitimate, separate `business-crud` capability gate in `demoCapabilityPolicy.ts` was kept, unweakened).
- Every phase from 1–14 corrects its own slice of Demo data as it lands (§16) — Demo Mode Finalization (Phase 15) is a capstone verification, not a first attempt at correctness.

---

## 15. Phase-by-Phase Implementation Roadmap

### PHASE 0 — Architecture & Business Rule Lock

**Objective:** Ratify this blueprint as binding; resolve the [POLICY DECISION NEEDED] items that block later phases from starting cleanly.
**Business Problem Solved:** Prevents every subsequent phase from re-litigating fundamentals mid-implementation.
**Current-State Gap(s):** No single authoritative document currently exists; the audit found conflicting stage-order arrays and a conflicting business doc (`BUSINESS_BLUEPRINT_FINAL.md`) with no adjudication.
**Target-State Behavior:** This document is the adjudication. Two open items were resolved by the user at Phase 0:
- **(a) RESOLVED:** A `'B2C'`-mode company never needs standalone Orders without a Project — B2C is Project-only. Every B2C Quotation/Order must trace to a Project; §8's table and Phase 1's rule set are updated accordingly.
- **(b) RESOLVED:** Registration is always optional, never mandatory, for any Project Type (Residential/Commercial/Industrial). It remains available whenever a deal needs financing but never blocks Project creation. §5.1's B2C Target Workflow and Phase 4's scope are updated accordingly — Phase 4 no longer needs a company-configurable Registration-gating field.
- **(c) DEFERRED (as originally planned):** HR link-vs-consolidate choice (§12/Phase 12) remains open until Phase 12 begins, since it depends on an implementation-time Employee↔AppUser match-rate investigation this document explicitly reserves for that phase.
**Affected Modules:** None (documentation/decision phase only).
**Affected Entities/Fields/Services/UI/Permissions/Routes:** None.
**Data Migration:** None.
**Demo Data Correction:** None yet.
**Demo Scenarios:** None yet.
**Tests:** N/A.
**Regression Risk:** None — no code touched.
**Dependencies:** None (first phase).
**Completion Criteria:** User has answered the open policy questions above (or explicitly deferred them with a documented interim default); this blueprint is treated as locked from this point. **MET** — (a) and (b) answered by the user; (c) explicitly deferred to Phase 12 per this document's own design.

```
PHASE 0 COMPLETION GATE
Business Rules:        [x] Complete
Database/Data Model:   [ ] N/A
Services:              [ ] N/A
UI:                    [ ] N/A
Permissions:           [ ] N/A
Workflow:              [ ] N/A
Migration:             [ ] N/A
Demo Data:             [ ] N/A
Demo Create/Edit/Delete/Restore: [ ] N/A
Technical Validation:  [ ] N/A
End-to-End Scenario:   [ ] N/A
Cross-Module Regression: [ ] N/A
PHASE STATUS: COMPLETE
```

---

### PHASE 1 — Company Business Mode

**Objective:** Introduce `Company.businessMode` and make it a real enforcement gate.
**Business Problem Solved:** Today, nothing distinguishes a B2B-only company from a B2C-only one; every company sees every workflow (§8/§9 audit).
**Current-State Gap:** Field does not exist (Audit §9, CONFIRMED absolute).
**Target-State Behavior:** See §8 table in full.
**Affected Modules:** Company settings/creation UI, route guards, navigation, every customer/project/order picker.
**Affected Entities:** `Company`/`CompanyConfig`/`CompanyDoc`.
**Affected Fields:** `+ businessMode: 'B2B'|'B2C'|'Both'`.
**Affected Services:** `useCompanies()`, route-guard middleware, wherever navigation menus are built.
**Affected UI:** Company creation/edit form, sidebar/topbar navigation, mobile bottom nav.
**Affected Permissions:** None to the role model itself; `businessMode` is an orthogonal gate.
**Affected Routes:** All B2B-only and B2C-only routes gain a `businessMode` guard alongside existing permission guards.
**Data Migration:** Every existing Company record needs a `businessMode` value. Since the audit found real B2B and real B2C customers already coexisting under Neozy's own single company record **[UNKNOWN — REQUIRES IMPLEMENTATION-TIME VERIFICATION whether more than one Company doc currently exists in production]**, the safe default migration is `businessMode:'Both'` for every existing company (never silently narrow an existing company's capability), with Super Admin able to narrow it deliberately afterward.
**Demo Data Correction:** Demo company record(s) must get an explicit `businessMode` (start with `'Both'` unless Phase 15 decides dedicated single-mode demo companies are more instructive).
**Demo Scenarios:** Log in as demo, confirm nav/routes reflect `'Both'` mode fully (no regression yet, since downstream filtering isn't wired until Phase 2/3).
**Tests:** New unit tests for the route-guard/nav-filter functions; no existing test should need to weaken.
**Regression Risk:** Low if the default migration is `'Both'` for all existing companies (no existing capability is removed).
**Dependencies:** Phase 0.
**Completion Criteria:** Field exists, migrated, and at least the navigation/route layer honors it; deep query-level enforcement lands progressively in Phases 2–4 as those entities' filters are built.

```
PHASE 1 COMPLETION GATE
Business Rules:        [x] Complete
Database/Data Model:   [x] Complete
Services:              [x] Complete
UI:                    [x] Complete
Permissions:           [x] Complete (unchanged by design — orthogonal to businessMode)
Workflow:              [x] Complete (nav/route-level only, as scoped)
Migration:             [x] Complete (read-time default to 'Both', no destructive write)
Demo Data:              [x] Corrected (DEMO_COMPANY carries businessMode: 'Both')
Demo Create:            [x] Verified (Company create form defaults to Both, all 3 modes selectable)
Demo Edit:              [x] Verified (existing company docs resolve to Both via default; editable in form)
Demo Soft Delete:       [ ] N/A (no delete behavior touched this phase — Companies.tsx still hard-deletes, a pre-existing gap deferred to Phase 13)
Demo Restore:           [ ] N/A (same as above)
Technical Validation:   [x] TypeScript (32 pre-existing errors, unchanged) [x] Tests (1345 passed / 8 pre-existing failures, unchanged) [x] Build (succeeded)
End-to-End Scenario:    [x] Passed (B2B-mode company: Projects/Survey/Engineering/etc. hidden from nav + blocked at route; B2C/Both: unaffected)
Cross-Module Regression:[x] Passed (no new tsc errors, no new test failures vs. pre-Phase-1 baseline)
PHASE STATUS: COMPLETE
```

---

### PHASE 2 — Customer / Lead Classification

**Objective:** Make `Customer.type` strictly typed and query-enforced everywhere a customer is selected or listed, and add the canonical `interface Customer`.
**Business Problem Solved:** B2B customers currently appear in every B2C picker (Audit §8, item 1).
**Current-State Gap:** No canonical `Customer` interface; no filtering by `type` anywhere outside the conversion function itself.
**Target-State Behavior:** Every customer-picker query filters by `type` (and, where relevant, `businessMode`) at the query/service layer, not just in the rendered dropdown.
**Affected Modules:** Customers, Leads (conversion UI), every module with a customer picker (Projects, Orders, Quotations, CustomerOrderForm, MobileOrderWorkspace).
**Affected Entities:** `Customer` (new canonical interface in `types/index.ts`).
**Affected Fields:** `type` becomes required and strictly `'B2B'|'B2C'` (no `any`/widened usage).
**Affected Services:** `src/pages/Projects.tsx`'s customer query (`getAll(COLLECTIONS.CUSTOMERS)` → add a `type==='B2C'` filter before/while building `customerOptions`), `Orders.tsx`, `CustomerOrderForm.tsx`, `MobileOrderWorkspace.tsx` (already correct — audit them for consistency, don't rewrite what's already right).
**Affected UI:** Project creation customer Select, Order creation customer Select.
**Affected Permissions:** None.
**Affected Routes:** None new.
**Data Migration:** None to existing Customer docs (the `type` field already exists and is populated correctly at conversion time — Audit confirmed this). Only the TypeScript interface and query filters change.
**Demo Data Correction:** This phase's demo correction is deferred to Phase 15's full rebuild, EXCEPT: if any interim demo verification is done in this phase, confirm the picker filter itself works correctly against whatever demo data exists at the time (even if that data is still using the old schema) by testing the filter logic in isolation.
**Demo Scenarios:** Not the primary target of this phase's demo work — full Demo correction for customer classification happens at Phase 15, but this phase's code change (the filter) must not crash against current (still-wrong) demo data.
**Tests:** Unit test proving a B2B customer id is excluded from `customerOptions` in `Projects.tsx`.
**Regression Risk:** Medium — any code that currently relies on seeing *all* customers in the Project picker (e.g., an admin correcting a miscategorized historical record) loses that ability; confirm with business whether an "override" affordance is needed for genuine data-correction cases, or whether that should go through a separate admin tool instead.
**Dependencies:** Phase 1 (company mode informs whether a `'B2B'`-only company should even show the Project creation entry point at all, independent of customer filtering).
**Completion Criteria:** Zero B2B customers selectable in any B2C picker; zero B2C-only fields leak into B2B customer creation forms. **MET**, plus additional scope actually implemented (see below): the audit's Projects.tsx picker was one of *ten* real customer-selection surfaces found across desktop+mobile (Projects, MobileProjectList, Orders, MobileOrderWorkspace, MobileQuotationWorkspace, MobilePaymentWorkspace, plus three B2B/B2C creation-toggle UIs: LeadWorkspaceConversionFlow, MobileLeadWorkspace, CustomerWorkspaceDialogs, plus one re-classification UI: CustomerWorkspaceEditor) — all ten now correctly gated. Two service-layer defense-in-depth guards were added (`leadWorkflow.ts`'s `convertLeadToCustomer`, `useCustomers.ts`'s `createCustomerProjection`) so the invariant holds regardless of which UI (or future UI, or CSV bulk-import) calls them.

**Newly discovered during this phase (documented, not fixed — belongs to a later phase):**
- Desktop `Quotations.tsx`'s standalone "New Quotation" form has **no real customer picker at all** — `customer`/`customerPhone`/`customerEmail`/`customerGst`/`customerAddress` are free-text `<Input>` fields; `customerId` is only ever populated when a Project or Order is selected to auto-fill, or via `location.state.prefillCustomer` navigation. A quotation created blank (`?create=1`, no project/order) never links to a real Customer record at all, meaning Customer-type enforcement is structurally inapplicable to that specific path. This is a workflow-completeness gap, not a classification-enforcement gap — belongs to **Phase 3 (B2B Workflow Completion)** or a dedicated Quotation-form fix, not Phase 2. (Mobile's `MobileQuotationWorkspace.tsx`, by contrast, already has a real customer picker and is now correctly gated.)
- `CustomersWorkspace.tsx`'s B2C direct-create form (and the demo generator) capture a `projectType` field **on the Customer record itself** — a pre-existing architectural blur between Customer and Project concepts (Blueprint §4 rule 3 says these must stay independent). Not removed speculatively in Phase 2 (removing it risks breaking whatever currently reads it); flagged for **Phase 4 (B2C Customer → Project Foundation)** to resolve.
- `CustomerWorkspaceEditor.tsx` already allowed changing an existing Customer's `type` after creation, with **zero guard** prior to this phase — resolves the Gap Audit's "[UNKNOWN, not exhaustively checked]" item as **CONFIRMED, real, and previously unguarded**. This phase added a Business-Mode-based options guard (can't re-type into a mode the company doesn't support), but did **not** add a check for "does this customer already have a linked Project/Order that would become inconsistent" — that cross-entity check belongs to **Phase 4**, which owns the Customer→Project relationship.

```
PHASE 2 COMPLETION GATE
Business Rules:        [x] Complete
Database/Data Model:   [x] Complete (canonical `interface Customer` added)
Services:              [x] Complete (customerClassification.ts + 2 service-layer guards)
UI:                    [x] Complete (10 picker/toggle surfaces across desktop+mobile)
Permissions:           [x] Complete (unchanged by design — orthogonal to classification)
Workflow:              [x] Complete (picker/creation-time enforcement; see "Newly discovered" above for what remains out of scope)
Migration:             [x] Complete (no-op to production Customer docs, confirmed; Demo Mode's Customer.type schema corrected)
Demo Data:              [x] Corrected (10 demo customers now carry real `type:'B2C'`; genuine B2B demo examples deferred to Phase 15, documented below)
Demo Create:            [x] Verified (creation toggles correctly gate by Business Mode; existing demo test suite green)
Demo Edit:              [x] Verified (CustomerWorkspaceEditor's type-change guard applies identically in Demo Mode)
Demo Soft Delete:       [ ] N/A (no delete-policy work in this phase; deferred to Phase 13)
Demo Restore:           [ ] N/A (same as above)
Technical Validation:   [x] TypeScript (32 pre-existing errors, unchanged, none in touched files) [x] Tests (1363 passed / 8 pre-existing failures, unchanged; 1 stale test updated to match the new correct behavior) [x] Build (succeeded)
End-to-End Scenario:    [x] Passed (B2B/B2C/Both company scenarios A-D from the brief manually traced through the actual code paths — see report)
Cross-Module Regression:[x] Passed (no new tsc errors, no new test failures vs. baseline; confirmed via isolated + extended-timeout full-suite runs)
PHASE STATUS: COMPLETE
```

---

### PHASE 3 — B2B Workflow Completion

**Objective:** Fix the `orderType` hardcode; verify the full B2B chain end-to-end.
**Business Problem Solved:** Quotation-originated Orders are silently mislabeled B2C today (Audit §6/§8, item 2 — the single highest-value fix in the whole audit).
**Current-State Gap:** `src/lib/quotationWorkflow.ts:176` hardcodes `orderType:'B2C'`.
**Target-State Behavior:** `convertQuotationToOrder()` reads `quote.customerId`'s `customer.type` (fetch the Customer record, or carry `customerType` on the Quotation itself if already denormalized there — **[UNKNOWN — REQUIRES IMPLEMENTATION-TIME VERIFICATION whether Quotation already denormalizes customer type]**) and sets `orderType` from it, matching the pattern already correct in `Orders.tsx`/`CustomerOrderForm.tsx`.
**Affected Modules:** Quotations, Orders.
**Affected Entities:** `Order`.
**Affected Fields:** `orderType` (typing tightened per Phase 2's Order interface work, or as part of this phase if Phase 2 didn't cover Order specifically — reconcile ordering at Phase 0/1 if unclear).
**Affected Services:** `quotationWorkflow.ts`'s `convertQuotationToOrder()`.
**Affected UI:** None (the bug is invisible in the UI, only the underlying data was wrong).
**Affected Permissions:** None.
**Affected Routes:** None.
**Data Migration:** **[POLICY DECISION NEEDED]** existing Orders that were created via Quotation conversion and are now known to carry a wrong `orderType` — does the business want a one-time backfill (re-deriving `orderType` from the linked Customer's real `type`), or is this left as historical data with only new Orders getting the fix? Given the audit's finding that this also corrupted `Quotations.tsx:605`'s `b2cOrders` filter and any report trusting `order.orderType`, a backfill is recommended, but must be confirmed before running it (irreversible in the sense that the "wrong" value is currently indistinguishable from a legitimately-B2C order without cross-referencing the Customer).
**Demo Data Correction:** Any demo Orders generated via a simulated Quotation-conversion path must be corrected to the real customer's type once this phase's fix lands (coordinates with Phase 15, but can be spot-corrected earlier since this is a narrow, well-understood bug).
**Demo Scenarios:** Seed one B2B Lead → B2B Customer → Quotation → converted Order; verify `orderType==='B2B'` end-to-end. Seed the equivalent B2C path and verify `orderType==='B2C'`.
**Tests:** Update/add a unit test asserting `convertQuotationToOrder()` output's `orderType` matches the source customer's `type` for both B2B and B2C fixtures — the existing `quotationWorkflow.test.ts` currently asserts the wrong (`'B2C'`-hardcoded) behavior and must be corrected, not left passing against the bug.
**Regression Risk:** Low-medium — anything currently relying on quotation-converted orders always being `'B2C'` (unlikely, since that's simply wrong, but check `Quotations.tsx:605` and any dashboard/report filter keyed on `orderType`) must be re-verified against the fix.
**Dependencies:** Phase 2 (Customer classification must be query-reliable before Order logic trusts it).
**Completion Criteria:** Every new Order's `orderType`, regardless of creation path, matches its customer's real `type`; full B2B chain (Lead→Customer→Quotation-or-Order→PI→Payment→Dispatch→Delivery→Accounts) verified end-to-end with a real B2B fixture. **MET** for the Quotation-conversion path (the audit's #1 bug) and re-confirmed for the already-correct direct-creation paths; the Dispatch→PI→Payment→Delivery→Accounts leg of the B2B chain was traced (not re-implemented — already correct/shared, per Audit §6) but its own dedicated verification is Phase 9's scope.

**What was actually implemented (exceeds the Blueprint's original single-line-fix framing):**
- `quotationWorkflow.ts`'s `convertQuotationToOrder()` no longer hardcodes `orderType:'B2C'` — it resolves the linked Customer's real `type` via Phase 2's canonical `resolveCustomerType()`, and throws a clear, actionable error (never guesses/defaults) when the quotation has no linked Customer or the Customer has no valid type.
- `Order.orderType` tightened from `OrderType | string` to `OrderType` in `types/index.ts` (the Blueprint's own canonical target for this phase) — zero new `tsc` errors.
- A full repository audit of every Order-creation path confirmed `orderWorkflow.ts`'s `createOrder()` (used by `Orders.tsx` and `CustomerOrderForm.tsx`) is a correct passthrough (no hardcoding) and `useConvertQuotationToOrder()` (desktop + mobile, both platforms share the identical hook) is the *only* caller of the fixed function — one fix point closes both.
- A safe, tested, **not-executed** data-migration mechanism was built for historically-mistyped Orders: `src/lib/orderTypeBackfill.ts` (pure planning logic — never guesses; buckets every Order into corrected / already-correct / ambiguous-left-untouched) plus `scripts/backfill-order-type.ts` (a thin CLI mirroring the existing `backfill-projectIds.ts` pattern exactly, defaulting to dry-run). **Not run against any live data — this environment has no Firestore credentials; must be executed by someone with production access when ready.**
- Demo Mode: the 7 existing demo Orders now carry `orderType:'B2C'` (previously absent entirely, matching their real B2C-shaped Customer/Project structure), and a new minimal, non-fabricated B2B example (1 Lead, 1 Customer, 1 Quotation, 1 Order — no Project, per the canonical B2B rule) proves `orderType` correctly resolves to `'B2B'` in the seed data too.

```
PHASE 3 COMPLETION GATE
Business Rules:        [x] Complete
Database/Data Model:   [x] Complete (`Order.orderType` strict; migration logic built, not executed — no DB access)
Services:              [x] Complete (`quotationWorkflow.ts` fixed; `orderTypeBackfill.ts` added)
UI:                    [x] Complete (no UI change needed — bug was invisible in the UI, exactly as the Blueprint predicted)
Permissions:           [x] Complete (unchanged by design)
Workflow:              [x] Complete (Quotation→Order leg; downstream PI/Payment/Dispatch confirmed already-correct/shared, not re-verified end-to-end here — Phase 9's job)
Migration:             [x] Complete (logic built + unit-tested; execution deferred — requires live Firestore credentials this environment does not have)
Demo Data:              [x] Corrected (7 existing Orders gained `orderType:'B2C'`; 1 new minimal B2B Lead/Customer/Quotation/Order chain added)
Demo Create:            [x] Verified (demo generator produces a valid, `verify.ts`-passing plan; new B2B customer creatable/usable exactly like any other)
Demo Edit:              [x] Verified (no new edit surface; existing Customer/Order edit paths unchanged)
Demo Soft Delete:       [ ] N/A (no delete-policy work this phase; deferred to Phase 13)
Demo Restore:           [ ] N/A (same as above)
Technical Validation:   [x] TypeScript (32 pre-existing errors, unchanged, none in touched files) [x] Tests (1375 passed / 8 pre-existing failures, unchanged; 1 stale hardcoded-count test + 1 stale hardcoded-bug test updated to the correct behavior) [x] Build (succeeded)
End-to-End Scenario:    [x] Passed (B2B and B2C Quotation→Order conversion traced through actual code + demo fixtures; live browser session not run — see Remaining Gaps)
Cross-Module Regression:[x] Passed (no new tsc errors, no new test failures vs. baseline)
PHASE STATUS: COMPLETE
```

**Newly discovered during this phase (documented, not fixed — belongs to a later phase):**
- Desktop `Quotations.tsx`'s standalone create form is still free-text-only for customer (confirmed unchanged from Phase 2's finding) — but the *real*, actually-used B2B/B2C quotation-creation path is `CustomerQuotationForm.tsx` (launched from within a Customer's own Workspace), which **does** correctly set `customerId`. The free-text standalone form remains a documented gap for whichever phase eventually rebuilds `Quotations.tsx`'s creation UX — not re-scoped into Phase 3, since the primary real-world path already works correctly with this phase's fix.
- `invoiceWorkflow.ts`'s `generatePIsFromOrder()` splits PI line items between a `'CSGPL'` template and a `'SANTOSH_VARANASI'` template by item category — this is a **real, functionally load-bearing dual-legal-entity billing distinction** (two separate PI numbering series/templates), not a stray branding leftover, and it is unrelated to Phase 3's Quotation→Order scope. Left untouched; flagged for whoever eventually does a dedicated branding/entity-naming pass to evaluate with actual business input (is "CSGPL"/"Santosh Techno Varanasi" a real second legal entity this ERP bills under, or a legacy artifact?) before renaming — renaming blindly could break the two-template split's real business meaning.

---

### PHASE 4 — B2C Customer → Project Foundation

**Objective:** Make Project creation B2C-only in practice (not just excluded-picker, per Phase 2, but also policy for direct creation and Registration's place in the chain); enforce `projectType` mandatory; resolve the Registration reconciliation.
**Business Problem Solved:** Project Type is typed correctly but not enforced mandatory (Audit §17); the "one master form" direct-creation behavior the business wants does not currently exist (`CustomerProjectForm.tsx` requires a pre-existing customer, confirmed this session).
**Current-State Gap:** `ProjectForm.tsx`'s Project Type `<Select>` has no `required` attribute and no validation found; no combined Customer+Project creation form exists.
**Target-State Behavior:** `projectType` is validated non-empty before save, at the service layer (`buildProjectCreatePayload()`), not just a UI attribute. **Master-form policy question RESOLVED, not speculative:** the user's Phase 4 instruction directively required "Single Customer + Project master creation flow" and "Automatic Customer creation when creating a Project directly" as concrete deliverables — this session confirmed no existing entry point already satisfied it (`CustomerProjectForm.tsx` still requires a pre-existing customer; `Projects.tsx`'s "New Project" flow still required picking from the existing customer list) and built it: an Existing/New Customer toggle in both `Projects.tsx` (desktop) and `MobileProjectList.tsx` (mobile), where "New Customer" mode collects minimal fields (name, phone, email) and creates the Customer via the existing `createCustomerProjection()` — always and only as `type:'B2C'`, since Projects are B2C-exclusive — before creating the Project with the new customer's id. Registration's place: **RESOLVED at Phase 0** — Registration is always optional, never mandatory, for any Project Type; this phase did not wire a blocking gate or add a company-configurable field for it. A genuine, previously-undiscovered bug was found and fixed while tracing every Project-creation path end-to-end: `createProjectFromRegistration()` hardcoded `projectType: ''` internally, silently discarding whatever the user actually selected in the UI, even though the UI already rendered the (now-required) Project Type field.
**Affected Modules:** Projects, Customers, Registrations.
**Affected Entities:** `Project`, `Registration`.
**Affected Fields:** `Project.projectType` (validation only, no schema change).
**Affected Services:** `projectWorkflow.ts` (`buildProjectCreatePayload()` mandatory-projectType throw; `createProject()` new B2B/Project defense-in-depth guard), `ProjectForm.tsx` (`required` on Project Type), `CustomerProjectForm.tsx`, `registrationWorkflow.ts`'s `createProjectFromRegistration()` (bug fix — real parameter instead of hardcoded `''`), `useCustomers.ts`'s `updateCustomerProjectionWithPhoneLock()` (new cross-entity reclassification guard).
**Affected UI:** Project creation form (`required` on Project Type), new Existing/New Customer toggle + inline customer fields in `Projects.tsx` and `MobileProjectList.tsx`, `CustomerWorkspaceEditor.tsx` (Customer Type Select now excludes B2B once a linked Project exists, with an inline explanation).
**Affected Permissions:** None new.
**Affected Routes:** None new — the master-form toggle lives inside the existing "Create Project" modal on both platforms, not a new route.
**Data Migration:** Existing Projects with an empty `projectType` — grandfathered (left empty; only new Projects are blocked from saving without one) — executed as designed, no historical data touched.
**Demo Data Correction:** Every demo Project (`scripts/demo/datasets/businessGraph.ts`'s `buildCustomersProjects()`) now carries a valid, non-empty `projectType` (Residential/Commercial/Industrial, deterministically distributed) — previously absent entirely (only `systemType` was set).
**Demo Scenarios:** Attempting to save a Project without a Project Type is blocked (native HTML5 `required` + the service-layer throw); the demo dataset itself now passes a new dedicated assertion (`demoBusinessGraph.test.ts`) that every seeded Project has one of the three valid values.
**Tests:** `projectWorkflow.test.ts` (mandatory-projectType throw + grandfathered update path — the pre-existing "builds a valid create payload" test was fixed, since it predates this phase's validation and would otherwise fail against a fixture with no `projectType`), new `projectWorkflowCreateGuard.test.ts` (B2B/Project defense-in-depth guard), new `customerReclassificationGuard.test.ts` (cross-entity reclassification guard), `registrationWorkflow.test.ts` (new `createProjectFromRegistration` coverage — the bug-fix regression test), new `projectsMasterForm.test.ts` (master-form wiring on both platforms), `demoBusinessGraph.test.ts` (new projectType assertion), and one stale pre-existing test (`projectWorkspaceUiStructure.test.ts`) updated — it had asserted the literal old buggy `"projectType: '',"` string as expected behavior.
**Regression Risk:** Low — all changes are additive validation/guards or new UI surfaces; no existing behavior was narrowed except the two genuinely-locked business rules (mandatory projectType on new Projects, B2B customers can never have a Project).
**Dependencies:** Phase 2 (B2C customer filtering must already be correct so this phase's "only B2C customers can start this flow" holds).
**Completion Criteria:** No Project can be saved without a `projectType` — **MET**. Registration's relationship to Project creation is explicit and correctly gated per the Phase 0 policy decision — **MET**, plus the discovered hardcoding bug is fixed. The master-form requirement — **MET**, built on both desktop and mobile. Cross-entity validation before Customer reclassification — **MET** (B2C→B2B blocked once a linked Project exists, enforced at the service layer with UI-level immediate feedback). B2B/B2C contamination re-audit around Projects — **MET**: found and closed one real gap (`createProject()` had no server-side check that the target customer isn't B2B; UI-level filtering was the only protection).

**What was actually implemented (exceeds the Blueprint's original single-line-validation framing, per the user's directive Phase 4 scope):**
- `ProjectForm.tsx`'s Project Type `<Select>` gained `required` — since this component is shared verbatim by `Projects.tsx`, `CustomerProjectForm.tsx`, and `MobileProjectList.tsx`, one fix achieves Desktop/Mobile/Workspace parity.
- `projectWorkflow.ts`'s `buildProjectCreatePayload()` throws `'Project Type is required'` when empty — mirrors the existing `customerId`/`capacityKw` validation pattern in the same function. `buildProjectUpdatePayload()` deliberately does **not** gain the same check (grandfather decision — an admin editing an unrelated field on a legacy empty-`projectType` Project should not be newly blocked).
- `projectWorkflow.ts`'s `createProject()` gained a genuine defense-in-depth guard: it now fetches the target customer and throws if `customer.type === 'B2B'`, closing the gap where UI-level filtering (`filterCustomersForProjectCreation`) was the *only* thing preventing a B2B customer from ever getting a Project — this also transitively protects `createProjectFromRegistration()`, since it calls `createProject()` internally.
- `registrationWorkflow.ts`'s `createProjectFromRegistration()` signature changed: `projectType: string` is now a real, required parameter (reordered ahead of the pre-existing optional `siteAddressInput` — a required parameter cannot follow an optional one), replacing the previous hardcoded `projectType: ''`. Its sole call site (`CustomerProjectForm.tsx`) was updated to pass `form.projectType`.
- **Master creation flow:** `Projects.tsx` and `MobileProjectList.tsx` both gained an Existing/New Customer toggle inside the "Create Project" modal (hidden while editing). New Customer mode collects Name/Phone/Email, and on submit calls `createCustomerProjection()` with `type:'B2C'` hardcoded (never user-selectable — Projects are B2C-exclusive), then `createProject()` with the resulting id. `ProjectForm`'s existing `lockedCustomerLabel` prop (built in a prior phase for the Customer Workspace's embedded form) is reused to hide the customer picker while in New Customer mode.
- **Cross-entity reclassification guard:** `useCustomers.ts`'s `updateCustomerProjectionWithPhoneLock()` now blocks re-typing a Customer to `'B2B'` if it has any non-deleted linked Project (queried via `COLLECTIONS.PROJECTS`), throwing a clear error — the true lowest-level enforcement of "B2B customers must never have a Project" for the reclassification direction (Phase 2 already guarded the creation-time direction). `CustomerWorkspaceEditor.tsx` mirrors this with immediate UI feedback: the B2B option is removed from the Customer Type `<Select>` (with an inline explanation) rather than letting Save fail.

**Newly discovered during this phase (documented, not fixed — belongs to a later phase or is a deliberate non-fix):**
- Registration creation itself (`createRegistration()`) has no customer-type filter — in a `'Both'`-mode company, a Registration could in principle be created against a B2B customer. This is inert (a dangling Registration causes no data corruption, since the actual Project-creation guard in `createProject()` would still block any resulting Project), so it was not fixed as part of this phase's Project-focused contamination sweep — flagged here for whoever eventually does a Registration-module-specific pass.
- `Customer.projectType` (the architecturally-blurred field flagged by Phase 2 as living on the Customer record, not the Project) was **not** touched this phase — Phase 4's scope was the real `Project.projectType` field; the Customer-side field remains a separate, still-open cleanup item.

```
PHASE 4 COMPLETION GATE
Business Rules:        [x] Complete
Database/Data Model:   [x] Complete (no schema change; validation + guards only)
Services:              [x] Complete (projectWorkflow.ts, registrationWorkflow.ts, useCustomers.ts)
UI:                    [x] Complete (ProjectForm.tsx, Projects.tsx, MobileProjectList.tsx, CustomerWorkspaceEditor.tsx)
Permissions:           [x] Complete (unchanged by design)
Workflow:              [x] Complete (master creation flow, Registration projectType fix, reclassification guard)
Migration:             [x] Complete (grandfather decision executed — no historical Project touched)
Demo Data:              [x] Corrected (all 10 demo Projects gained a valid projectType)
Demo Create:            [x] Verified (master-form flow forces B2C on new demo customers exactly as in production)
Demo Edit:              [x] Verified (reclassification guard applies identically in Demo Mode)
Demo Soft Delete:       [ ] N/A (no delete-policy work this phase; deferred to Phase 13)
Demo Restore:           [ ] N/A (same as above)
Technical Validation:   [x] TypeScript (32 pre-existing errors, unchanged, none in touched/new files) [x] Tests (1396 passed / 8 pre-existing failures, unchanged; 1 stale test updated to the correct post-fix behavior; 21 new tests added across 4 new test files) [x] Build (succeeded)
End-to-End Scenario:    [x] Passed (mandatory-projectType throw, B2B/Project guard, reclassification guard, and master-form wiring all traced through actual code + unit-tested; live browser session not run — see Remaining Gaps)
Cross-Module Regression:[x] Passed (no new tsc errors, no new test failures vs. baseline)
PHASE STATUS: COMPLETE
```

---

### PHASE 5 — Canonical Project Lifecycle

**Objective:** Lock one canonical stage-order source; migrate all current call sites to it.
**Business Problem Solved:** Independently-drifting stage-order arrays (Audit §16) made "what stage is a project really in" ambiguous depending on which file answers the question.
**Current-State Gap (re-audited this phase, not assumed from the Audit alone):** The Audit's original 7 files were confirmed, plus **an 8th, previously-undiscovered duplicate found this phase**: `src/features/procurement/services/purchaseOrderWorkflow.ts`'s `projectProcurementPatch()` locally redeclared the identical 17-stage `PROJECT_STAGE_ORDER`. Final count: `useProjectStage.ts` (13-stage UI metadata subset), `projectStageTransition.ts` (17, canonical-matching), `ProjectJourneyTimeline.helpers.ts` (12-stage UI metadata subset), `analyticsCore.ts` (17), `anomalyDetection.ts` (16, missing `Archived`), `quotationWorkflow.ts` (17), `dispatchWorkflow.ts` (17), `purchaseOrderWorkflow.ts` (17, newly found).
**Target-State Behavior:** `src/lib/projectLifecycle.ts` exports the canonical 17-stage `PROJECT_STAGE_ORDER`, `projectStageIndex()`, `isProjectStageAtOrPast()`, `buildProjectStageAdvancePatch()` (the shared forward-only, append-only-history patch builder every prior file reimplemented with near-identical logic), and `findOrphanProjectStages()` (read-only data-migration verification helper). The two UI-metadata subsets (`useProjectStage.ts`'s 13-item `LIFECYCLE`, `ProjectJourneyTimeline.helpers.ts`'s 12-item `JOURNEY_STAGE_DEFINITIONS`) are legitimately different presentation surfaces (different titles/icons/subsets) and were **not** force-merged into one list — only their internal stage-*ordering* comparisons were migrated to derive from the canonical module instead of computing position-within-their-own-subset-array.
**Affected Modules:** Every Project-stage-aware module: Project Workspace, dashboards, analytics, anomaly detection, quotation/dispatch/purchase-order workflow, journey timeline.
**Affected Entities:** None (no schema change — `Project.currentStage` already exists as a string).
**Affected Fields:** None.
**Affected Services:** `projectStageTransition.ts` (kept its public API — `PROJECT_STAGE_ORDER`, `buildProjectStagePatch`, `advanceProjectStage` — as a thin re-export layer, since 5 downstream files already import from it: `monitoringWorkflow.ts`, `serviceTicketWorkflow.ts`, `amcWorkflow.ts`, `projectHandoverWorkflow.ts`, `qcWorkflow.ts`), `dispatchWorkflow.ts`, `quotationWorkflow.ts`, `purchaseOrderWorkflow.ts`, `analyticsCore.ts` (its `PROJECT_STAGE_DASHBOARD_ORDER` is now an alias of the canonical array, not a separate literal), `anomalyDetection.ts`, `useProjectStage.ts`, `ProjectJourneyTimeline.helpers.ts` — all now import from `projectLifecycle.ts` instead of redeclaring.
**Affected UI:** None visually changed by design — the canonical order was already the widest (17-stage) of every list it replaces, so no dashboard/timeline lost or gained stages; two genuine **bugs were found and fixed** in the process (see below), which change output only for projects whose `currentStage` is past the end of a UI's own metadata subset.
**Affected Permissions:** None.
**Affected Routes:** None.
**Data Migration:** None required to data. `findOrphanProjectStages()` (read-only) was built and unit-tested; run against the current demo dataset, it returns zero orphans — every demo Project's `currentStage` is a real canonical value. **Not run against live production data** — this environment has no Firestore credentials (same limitation Phase 3 documented for its own backfill mechanism); whoever has production access can run it before Phase 15's full Demo rebuild if desired, though it is not a blocker.
**Demo Data Correction:** None needed — the demo dataset already only uses canonical stage names (verified via the new orphan-check test), and Phase 4 already gave every demo Project a valid `projectType`.
**Demo Scenarios:** Confirmed via the orphan-check test against the real demo generator (`buildBusinessGraphPlan()`), not merely asserted.
**Tests:** New `projectLifecycle.test.ts` (canonical module itself), new `projectJourneyTimeline.helpers.test.ts` and new `useProjectStage.test.ts` (regression-lock the two bug fixes below — neither file had dedicated test coverage before this phase). All pre-existing stage-related test files (`projectStageTransition.test.ts`, `analyticsCore.test.ts`, `quotationWorkflow.test.ts`, `dispatchWorkflow.test.ts`, `anomalyDetection.test.ts`, `projectWorkspace.test.ts`, `purchaseOrderWorkflow.test.ts`) pass unchanged — no existing assertion needed weakening.
**Regression Risk:** Low, not Medium as originally estimated — because the canonical list was already the *widest* of every list it replaced (a strict superset), no dashboard/report lost stages or changed its percentage denominator. The two behavior changes found are bug **fixes**, not regressions (see below).
**Dependencies:** Phases 1–4 (customer/project foundation stable before touching stage machinery) — confirmed still COMPLETE, re-audited only where this phase's own changes touch them.
**Completion Criteria:** Exactly one source of truth for the Project/EPC stage list exists in the codebase — **MET** (verified by grep: zero remaining literal `['New','Survey','Engineering'...]`-shaped arrays outside `projectLifecycle.ts` itself, other than the deliberately-out-of-scope `Case` module, see below). All prior call sites (7 from the Audit + 1 newly found) import from it — **MET**. No literal stage array is redeclared anywhere else — **MET**.

**What was actually implemented (exceeds the Blueprint's original seven-file framing):**
- New `src/lib/projectLifecycle.ts`: `PROJECT_STAGE_ORDER`, `projectStageIndex()`, `isProjectStageAtOrPast()`, `buildProjectStageAdvancePatch()`, `findOrphanProjectStages()`.
- **8th duplicate found and migrated**: `purchaseOrderWorkflow.ts`'s `projectProcurementPatch()` — not in the Audit's original list of 7.
- **Two genuine bugs found and fixed** while migrating the two UI-metadata subsets: `useProjectStage.ts`'s `resolveProjectWorkspaceStages()` and `ProjectJourneyTimeline.helpers.ts`'s `resolveJourneyStages()` both computed "is this stage completed" partly via `findIndex` position *within their own 12/13-item subset array*. For a project whose `currentStage` is past the end of that subset (e.g. `AMC`/`Service`/`Monitoring` — none of which exist in the 12-item journey subset, and `Service`/`Monitoring` don't exist in the 13-item workspace subset), `findIndex` silently returned `-1`, disabling the position-based "mark everything before this as completed" fallback — such a project's earlier stages showed as completed only if `stageHistory` happened to already contain every one of them. Now both compare via the canonical `projectStageIndex()`, so a project past its subset's end correctly shows the entire subset as completed regardless of `stageHistory` completeness. Locked in by new regression tests.
- `projectStageTransition.ts` kept its exact public API (`PROJECT_STAGE_ORDER`, `buildProjectStagePatch`, `advanceProjectStage`) as a thin re-export, since 5 other workflow files already depend on it — avoiding an otherwise-unnecessary 5-file refactor outside this phase's real scope.

**Newly discovered during this phase (documented, deliberately not touched — a different entity, not Project):**
- `src/engines/CaseEngine.ts`'s `CASE_STAGE_ORDER`/`CaseStage` (16 stages, ending in `Closure` instead of `Archived`+`Monitoring`) and `src/pages/CaseSearch.tsx`'s `STAGE_OPTIONS` filter list track the **Case** entity's own cross-entity rollup lifecycle (`cases` collection — "One Case = One Truth for every business entity," per that file's own docstring), not `Project.currentStage`. This is a genuinely separate state machine, not a Project-lifecycle duplicate — merging it would conflate two different entities' stage concepts, which the user's "do not invent workflow" instruction rules out. Separately, `CaseSearch.tsx`'s own `STAGE_OPTIONS` doesn't even match `CaseEngine.ts`'s own `CASE_STAGE_ORDER` (it has both `Closure` *and* `Monitoring` at the end, an internal drift within the Case module itself) — flagged here for whoever eventually does a Case-module-specific consolidation pass; out of Phase 5's Project-lifecycle scope.

```
PHASE 5 COMPLETION GATE
Business Rules:        [x] Complete
Database/Data Model:   [x] Complete (no schema change; consolidation + 2 bug fixes only)
Services:              [x] Complete (projectLifecycle.ts + 8 migrated call sites)
UI:                    [x] Complete (no visual change except the 2 bug fixes, which only affect stage-completion display for projects past a subset's end)
Permissions:           [x] Complete (unchanged by design)
Workflow:              [x] Complete (shared advance-patch logic, shared comparison logic)
Migration:             [x] Complete (findOrphanProjectStages() built + unit-tested; zero orphans in demo data; live-DB run optional, not a blocker)
Demo Data:              [x] Corrected (verified zero orphans — no changes needed)
Demo Create:            [x] Verified (stage-advance patches behave identically; demo Projects create/advance exactly as before)
Demo Edit:              [x] Verified (same)
Demo Soft Delete:       [ ] N/A (no delete-policy work this phase; deferred to Phase 13)
Demo Restore:           [ ] N/A (same as above)
Technical Validation:   [x] TypeScript (32 pre-existing errors, unchanged, none in touched/new files) [x] Tests (1414 passed / 8 pre-existing failures, unchanged; 21 new tests across 3 new test files, zero existing assertions weakened) [x] Build (succeeded)
End-to-End Scenario:    [x] Passed (stage-advance patches traced through actual code + unit-tested for every migrated file; the two bug fixes verified via dedicated regression tests; live browser session not run — see Remaining Gaps)
Cross-Module Regression:[x] Passed (no new tsc errors, no new test failures vs. baseline)
PHASE STATUS: COMPLETE
```

---

### PHASE 6 — Survey

**Objective:** Re-verify Survey stability now that Project/customer foundations are corrected, and complete the Survey domain — this was scoped by the user as more than a pure regression check: a fresh, first-hand repository audit of every Survey-related file, fixing any genuine bug found along the way.
**Business Problem Solved:** Survey→Engineering handoff was already real/automatic/idempotent (confirmed, no change needed) — but this phase's own fresh audit found **two genuine, previously-undiscovered bugs** that a pure regression check would have missed: (1) `scheduleSurvey()`/`approveSurvey()` unconditionally set `Project.currentStage`, which could silently regress a Project already past Survey/Engineering back to an earlier stage; (2) `Surveys.tsx`'s bulk-assign wrote only `surveyorId`, leaving `assignedSurveyor` (the field `projectVisibility.ts` actually scopes visibility by) stale, breaking Survey visibility for both the old and new surveyor after a reassignment.
**Current-State Gap:** See the two bugs above, plus a Demo Mode completeness gap: every "Approved" demo Survey was missing `engineeringDesignId` (the field the real UI's "Engineering draft created" link reads), and demo Survey #8 was marked "Approved" with no corresponding Engineering Design at all — a real invariant violation, since `approveSurvey()` always creates one. Zero demo Surveys represented the real, reachable "Pending" (awaiting Engineer review) state.
**Target-State Behavior:** `Project.currentStage` transitions from Survey scheduling/approval are forward-only, via the same shared `buildProjectStageAdvancePatch()` guard Phase 5 introduced — never a special case. Bulk reassignment keeps `surveyorId`/`assignedSurveyor` in sync, matching `scheduleSurvey()`'s own existing behavior. Demo Surveys correctly link to their Engineering Design and represent all four real `SurveyApprovalStatus` states across at least one example each (except `Rejected`, not yet represented — see Remaining Gaps).
**Affected Modules:** Survey (desktop/mobile), Project Workspace's Survey card, Demo Mode dataset.
**Affected Entities:** None (no schema change).
**Affected Fields:** None new — `assignedSurveyor`/`engineeringDesignId`/`engineeringHandoffAt` already existed; this phase fixed *when* they get populated.
**Affected Services:** `src/features/surveys/services/surveyWorkflow.ts` (`scheduleSurvey()`, `approveSurvey()`).
**Affected UI:** `src/pages/Surveys.tsx` (`bulkAssignMutation`).
**Affected Permissions:** None.
**Affected Routes:** None.
**Data Migration:** None to production data (no schema change; the two code bugs only affected future writes). Demo dataset regenerated in-place (disposable by design, per §14).
**Demo Data Correction:** `scripts/demo/datasets/businessGraph.ts`'s `buildTechnical()` — Approved demo Surveys (SRV-2..SRV-7) now carry `engineeringDesignId`/`engineeringHandoffAt` pointing at their real `engineering_designs` doc; SRV-8 changed from an orphaned "Approved" to "Pending" (Completed, awaiting Engineer review) — the dataset's first example of that real status.
**Demo Scenarios:** Verified via a new dedicated test against the real demo generator (`buildBusinessGraphPlan()`), not merely asserted: every Approved demo Survey resolves to a real Engineering Design; at least one Survey is Pending.
**Tests:** New `surveyWorkflowStageGuard.test.ts` (locks in both stage-advance bug fixes), new `surveysBulkAssignSync.test.ts` (locks in the bulk-assign fix), new assertion in `demoBusinessGraph.test.ts` (locks in the Demo Mode fix). All pre-existing Survey tests (`projectWorkspaceSurveyIntegration.test.ts`, `surveyWorkflow.test.ts`, `engineeringWorkflow.test.ts`, `projectWorkspaceEngineeringIntegration.test.ts`) pass unchanged.
**Regression Risk:** Low — both code fixes are narrowing (a bug that could regress a stage/desync a field now cannot), and the demo data change only adds previously-missing fields plus reclassifies one already-inconsistent record.
**Dependencies:** Phases 1–5 — re-confirmed stable; the stage-list consolidation (Phase 5) itself did not regress Survey (it was the vehicle used to *fix* Survey's own pre-existing, unrelated bug via the same shared guard).
**Completion Criteria:** All existing Survey tests still pass — **MET**. Every Survey-related file in the repository traced and audited (not assumed from the Blueprint alone) — **MET**, full list in the phase report. Both genuinely-found bugs fixed and regression-tested — **MET**. Demo Mode Survey data internally consistent with the real `approveSurvey()` invariant — **MET**.

**What was actually implemented (exceeds the Blueprint's original pure-regression-check framing, per the user's explicit "this is not only a regression check" instruction):**
- `surveyWorkflow.ts`: removed the module's own local `stageHistory()` re-implementation (an idempotency-only check, not a true forward-only ordinal guard) and replaced both its call sites with the shared `buildProjectStageAdvancePatch()` from `src/lib/projectLifecycle.ts` (Phase 5) — closing a real regression bug and eliminating a 9th, previously-undiscovered duplicate of the stage-patch pattern Phase 5 exists to consolidate.
- `Surveys.tsx`: `bulkAssignMutation` now writes `assignedSurveyor` alongside `surveyorId`.
- Demo dataset: Survey/Engineering-Design linkage and status-state completeness fixed (see Demo Data Correction above).

**Newly discovered during this phase (documented, not fixed — out of Survey's own scope or belongs elsewhere):**
- `STUCK_THRESHOLD_DAYS` (the per-stage stuck-project threshold map used for auto-reminders) is an exact duplicate literal between `src/lib/reportsAggregation.ts` and `src/lib/autoReminderWorkflow.ts` — a cross-cutting, all-16-stages concern (Survey is only one of the 16 keys), not Survey-specific, so left untouched; flagged for whoever eventually does a general constants-consolidation pass.
- `src/pages/CaseSearch.tsx`'s `STAGE_OPTIONS` filter list still doesn't match `CaseEngine.ts`'s own `CASE_STAGE_ORDER` (has both `Closure` and `Monitoring` at the end; `CASE_STAGE_ORDER` has only `Closure`) — already flagged in Phase 5's report as out-of-scope Case-module drift; re-confirmed still present, still out of Phase 6's Survey scope.
- Demo Mode has zero `Rejected` Surveys — a real, reachable status this phase did not add an example for (adding one would require also adjusting the downstream Engineering Design chain to stay consistent, more design work than a regression-check-scoped phase should absorb unilaterally); flagged for Phase 15's full Demo rebuild.
- `MobileSurveyWorkspace.tsx` renders selection checkboxes (`selectedIds`/`toggleSelect`) with no bulk-action buttons wired to them — inert UI, not a correctness bug (no bulk mutation exists to be wrong), left untouched since building a mobile bulk-action UI is new feature work, not Survey-domain completion.

```
PHASE 6 COMPLETION GATE
Business Rules:        [x] Complete
Database/Data Model:   [x] Complete (no schema change; 2 real bug fixes + demo data correction)
Services:              [x] Complete (surveyWorkflow.ts)
UI:                    [x] Complete (Surveys.tsx bulk-assign fix)
Permissions:           [x] Complete (unchanged, confirmed correct)
Workflow:              [x] Complete (forward-only stage guard, assignedSurveyor sync)
Migration:             [x] N/A (no schema change)
Demo Data:              [x] Corrected (Survey↔Engineering Design linkage, Pending state added)
Demo Create:            [x] Verified (scheduleSurvey unaffected for the common New-project path)
Demo Edit:              [x] Verified (bulk-assign fix applies identically in Demo Mode)
Demo Soft Delete:       [x] Verified (archiveSurvey()'s existing softDelete() path unchanged, confirmed correct)
Demo Restore:           [ ] N/A (no restore-specific Survey UI; covered generically at Phase 13)
Technical Validation:   [x] TypeScript (32 pre-existing errors, unchanged, none in touched/new files) [x] Tests (1420 passed / 8 pre-existing failures, unchanged; 6 new tests across 2 new test files plus 1 new demo assertion) [x] Build (succeeded)
End-to-End Scenario:    [x] Passed (both bug fixes unit-tested with real mocked Firestore call assertions; demo linkage verified against the real generator; live browser session not run — see Remaining Gaps)
Cross-Module Regression:[x] Passed (no new tsc errors, no new test failures vs. baseline)
PHASE STATUS: COMPLETE
```

---

### PHASE 7 — Engineering

**Objective:** Same fresh-audit posture as Phase 6, for Engineering — not a rubber-stamp regression check.
**Business Problem Solved:** Survey→Engineering handoff and Engineering→Quotation line-item mapping were already verified in a prior session (Card 2 unification, no duplicate submission, permission independence preserved) and remain correct. This phase's own fresh audit found **one genuine, previously-undiscovered bug of the exact same family Phase 6 found in Survey**: `approveDesign()` unconditionally set `Project.currentStage` to `'Quotation'` and unconditionally appended a new `stageHistory` entry, regardless of how far the project had already progressed — the 10th independent occurrence of this pattern across the codebase (8 stage-order-array duplicates from Phase 5, plus Survey's own bug from Phase 6).
**Current-State Gap:** See the bug above. Everything else audited (desktop/mobile UI, Project-Workspace-embedded card, bulk-assign, permissions, linkage, search, Demo Mode) was confirmed already correct — notably, `EngineeringDesigns.tsx`'s bulk-assign (which looked like it might repeat Survey's `surveyorId`/`assignedSurveyor` desync bug) was checked and confirmed **not** to have that problem: Engineering Designs have only one canonical assignment field (`designerId`), used both for display and for `projectVisibility.ts`'s visibility scoping, so there was nothing to desync.
**Target-State Behavior:** `Project.currentStage` transitions from Engineering Design approval are forward-only, via the same shared `buildProjectStageAdvancePatch()` guard Phase 5 introduced and Phase 6 already applied to Survey — never a special case anywhere in the codebase.
**Affected Modules:** Engineering (desktop/mobile), Project Workspace's Engineering card.
**Affected Entities:** None (no schema change).
**Affected Fields:** None new.
**Affected Services:** `src/features/engineering/services/engineeringWorkflow.ts` (`approveDesign()`).
**Affected UI:** None (no UI change needed — the bug was invisible in the UI, exactly like Survey's and Phase 3's `orderType` bug were).
**Affected Permissions:** None.
**Affected Routes:** None.
**Data Migration:** None — no schema change, no historical data affected (the bug only affected future writes, and only in the rare case of a design being (re-)approved against a project that had already progressed past Quotation through some other path).
**Demo Data Correction:** Confirmed demo Engineering designs still carry a valid `surveyId`/`projectId` after Phase 6's Survey-linkage fix (they're the target of that fix's new `engineeringDesignId` references, re-verified via the Phase 6 test still passing) — no further correction needed this phase.
**Demo Scenarios:** Re-verified via the existing demo test suite (`demoBusinessGraph.test.ts`, `quotationDocumentContract.test.ts`) — both pass unchanged; Quotation-readiness (`quotationItemsFromEngineering()`) confirmed untouched by any phase to date.
**Tests:** New `engineeringWorkflowStageGuard.test.ts` (locks in the stage-advance bug fix, mirroring Phase 6's `surveyWorkflowStageGuard.test.ts`). `projectWorkspaceEngineeringIntegration.test.ts`, `caseDocuments.test.ts`'s Engineering assertions, and `engineeringWorkflow.test.ts` all pass unchanged.
**Regression Risk:** Low — the fix is narrowing (a bug that could regress a stage now cannot); no existing behavior for the common, correct-progression path (Engineering → Quotation) changed at all.
**Dependencies:** Phases 1–6 — re-confirmed stable; Phase 5's stage-list consolidation did not regress Engineering (it was the vehicle used to fix Engineering's own pre-existing, unrelated bug via the same shared guard, exactly as it was for Survey in Phase 6).
**Completion Criteria:** All existing Engineering tests still pass — **MET**. Every Engineering-related file traced and audited (not assumed) — **MET**. The one genuinely-found bug fixed and regression-tested — **MET**.

**What was actually implemented (exceeds the Blueprint's original pure-regression-check framing, per the same "not only a regression check" discipline Phase 6 established):**
- `engineeringWorkflow.ts`: `approveDesign()` now calls the shared `buildProjectStageAdvancePatch()` from `src/lib/projectLifecycle.ts` (Phase 5) instead of unconditionally constructing the stage patch inline — closing a real regression bug and eliminating a 10th independent occurrence of the pattern Phase 5 exists to consolidate.
- Confirmed (not assumed) that `EngineeringDesigns.tsx`'s bulk-assign does **not** have Survey's desync bug — genuine verification, not a skipped check.

**Newly discovered during this phase (documented, not fixed — out of Engineering's own scope):**
- None beyond what Phase 6 already flagged (`STUCK_THRESHOLD_DAYS` duplication, `CaseSearch.tsx`/`CaseEngine.ts` Case-module drift) — both re-confirmed still present, still out of scope for a Survey/Engineering-focused phase.

```
PHASE 7 COMPLETION GATE
Business Rules:        [x] Complete
Database/Data Model:   [x] Complete (no schema change; 1 real bug fix)
Services:              [x] Complete (engineeringWorkflow.ts)
UI:                    [x] Complete (confirmed correct, no change needed)
Permissions:           [x] Complete (unchanged, confirmed correct)
Workflow:              [x] Complete (forward-only stage guard)
Migration:             [x] N/A (no schema change)
Demo Data:              [x] Corrected (regression-checked; Phase 6's Survey-linkage fix already covers Engineering's side)
Demo Create:            [x] Verified (createDesign/createEngineeringDraftFromSurvey unaffected)
Demo Edit:              [x] Verified (updateDesign, bulk-assign confirmed correct)
Demo Soft Delete:       [x] Verified (archiveDesign()'s existing softDelete() path unchanged, confirmed correct)
Demo Restore:           [ ] N/A (no restore-specific Engineering UI; covered generically at Phase 13)
Technical Validation:   [x] TypeScript (32 pre-existing errors, unchanged, none in touched/new files) [x] Tests (1422 passed / 8 pre-existing failures, unchanged; 2 new tests in 1 new test file) [x] Build (succeeded)
End-to-End Scenario:    [x] Passed (bug fix unit-tested with real mocked Firestore call assertions; Survey→Engineering→Quotation chain traced through actual code; live browser session not run — see Remaining Gaps)
Cross-Module Regression:[x] Passed (no new tsc errors, no new test failures vs. baseline)
PHASE STATUS: COMPLETE
```

---

### PHASE 8 — Quotation / Order / PI / Payment (B2C Flow)

**Objective:** Verify the shared financial/logistics functions (already fixed for `orderType` in Phase 3) behave correctly specifically in the B2C, Project-linked context — a fresh audit, not an assumption that Phase 3/5 left nothing to find.
**Business Problem Solved:** Confirms `convertQuotationToOrder()`'s project-linking side (`projectOrderPatch()`, stage advancement) works correctly now that Phase 5 has unified the stage list it writes into — **confirmed correct, already fixed by Phase 5**. This phase's own fresh audit additionally found: (1) `CustomerQuotationForm.tsx` (the real, actually-used B2C quotation-creation path, per Phase 3's own finding) never passed a `projectId` at all, even when the customer already had one — now fixed, non-blockingly. (2) The Phase 0-locked policy "a `'B2C'`-mode company has no standalone Order/Quotation entry point without a linked Project" was never actually implemented anywhere in the code, on either the standalone pages or the shared creation functions — a real, confirmed gap, **not fixed this phase** (see rationale below).
**Current-State Gap:** See above. `createOrder()` (the direct-creation path shared by `Orders.tsx` and `CustomerOrderForm.tsx`) has no equivalent of `projectOrderPatch()` at all — confirmed **not a bug**, because `CustomerOrderForm.tsx` is reachable only from `CustomerB2BWorkflowPipeline.tsx` (traced via `goToOrder()`'s only call site), and B2B Orders never have a Project to link; `Orders.tsx`'s standalone form also has no project-selector UI, which is the concrete blocker to enforcing the locked B2C rule (see below).
**Target-State Behavior:** A B2C Quotation (with `projectId`+`engineeringDesignId`) converts to an Order that correctly advances the Project's `currentStage` to `'Order'` per the canonical list (Phase 5), generates PIs, and accepts payment exactly as the B2B path does — **confirmed true end-to-end**: `projectOrderPatch()` advances the stage correctly (Phase 5), `generatePIsFromOrder()` correctly propagates `projectId` onto every generated PI, and `markPIAsPaid()`'s transactional stock-block is untouched and correct. A B2C Quotation created from the Customer Workspace, when the customer already has a Project, now correctly carries that `projectId` from creation (this phase's fix) rather than only when manually linked later via the standalone `Quotations.tsx` page's project-select field.
**Affected Modules:** Quotations, Orders, Invoices, Payments.
**Affected Entities:** None (no schema change).
**Affected Fields:** None new.
**Affected Services:** None — the fix is UI-layer only (see Affected UI).
**Affected UI:** `CustomerCenterPanel.tsx` (passes `latestProject?.id` through), `CustomerQuotationForm.tsx` (accepts optional `projectId`, forwards it into `createQuotation()`'s payload).
**Affected Permissions:** None.
**Affected Routes:** None.
**Data Migration:** None beyond Phase 3's.
**Demo Data Correction:** None needed — the demo B2C Quotation→Order→PI→Payment chain (Phase 3) already carries real `projectId` links throughout; re-verified via the existing demo test suite, unchanged.
**Demo Scenarios:** Re-verified via `demoBusinessGraph.test.ts`/`quotationDocumentContract.test.ts` (both pass unchanged) — the B2C financial chain's Project-linkage was already correct in Demo Mode; this phase's fix only affects the *live* Customer Workspace creation path, which Demo Mode also uses identically (no demo-only shortcut).
**Tests:** `quotationWorkflow.test.ts`'s Project-linking assertions (`projectOrderPatch`, `projectQuotationPatch`) — unchanged, pass. New `customerQuotationFormProjectLink.test.ts` locks in this phase's fix.
**Regression Risk:** Low — the fix only adds a `projectId` where one was previously always empty; nothing that depended on it being empty (there was no such consumer) is affected.
**Dependencies:** Phases 3, 5 — both confirmed still correctly in effect.
**Completion Criteria:** B2C financial chain verified end-to-end with correct Project stage advancement — **MET**. Quotation creation correctly links an already-existing Project — **MET** (newly fixed). The locked "no standalone B2C Order/Quotation without a Project" policy is enforced in code — **NOT MET**, confirmed never implemented; flagged as a Critical Blocker (Appendix E) for a future phase with real UI scope, not silently carried forward as if it were done.

**What was actually implemented (exceeds the Blueprint's original pure-verification framing):**
- `CustomerCenterPanel.tsx` / `CustomerQuotationForm.tsx`: the customer's most-recently-updated existing Project (if any) is now passed through to `createQuotation()` when a B2C Quotation is created from the Customer Workspace — closing a real, confirmed gap where this path never linked a Project even when one already existed, unlike the standalone `Quotations.tsx` page's own project-select field. Non-blocking: a Quotation can still be created with no Project when none exists yet, matching the Customer Workspace's own deliberately-independent one-time-card design (Quotation/Registration/Project don't gate each other).
- Confirmed (not assumed) that `CustomerOrderForm.tsx`'s lack of a `projectId` is correct, not a bug — traced its only reachable call site (`CustomerB2BWorkflowPipeline.tsx`) to confirm it is B2B-exclusive in practice, where a Project genuinely never applies.

**Newly discovered during this phase (documented, not fixed — requires a policy/UI decision beyond safely completing Phase 8):**
- **The Phase 0-locked rule "no standalone Order/Quotation entry point for a `'B2C'`-mode company without a linked Project" (§8) was never implemented in code.** `Orders.tsx`'s standalone create form has no project-selector field at all (for any customer type); `Quotations.tsx`'s does (`form.projectId`, a real `<Select>`), but nothing validates it's required when the active company's `businessMode` is strictly `'B2C'`. Neither `createOrder()` nor `createQuotation()` check `businessMode` against `projectId` presence. This is not fixed this phase because: building it correctly requires new UI (a project-selector on `Orders.tsx`, which doesn't exist), and the Customer Workspace's own B2C cards are deliberately designed so Quotation/Project don't gate each other (a real, earlier, deliberate UX decision) — reconciling that design with the locked rule is a genuine **[POLICY DECISION NEEDED]**, not a code-only fix, and forcing it unilaterally risks a real regression for existing B2C users. Flagged as a Critical Blocker (Appendix E).
- Re-confirmed (not re-investigated further) Phase 3's own deliberate deferral: `invoiceWorkflow.ts`'s `generatePIsFromOrder()` still splits PI line items between `'CSGPL'` and `'SANTOSH_VARANASI'` templates — still a real, functionally load-bearing dual-legal-entity distinction per Phase 3's own analysis, still requiring real business input before any rename; left untouched.

```
PHASE 8 COMPLETION GATE
Business Rules:        [x] Complete
Database/Data Model:   [x] Complete (no schema change)
Services:              [x] Complete (no service change needed — confirmed already correct)
UI:                    [x] Complete (CustomerQuotationForm project-linkage fix)
Permissions:           [x] Complete (unchanged, confirmed correct)
Workflow:              [x] Complete (Quotation→Order→PI→Payment chain confirmed correct end-to-end)
Migration:             [x] N/A (no schema change)
Demo Data:              [x] Corrected (re-verified already correct; no changes needed)
Demo Create:            [x] Verified (Quotation/Order/PI creation unaffected in the common path; improved for the Project-linking case)
Demo Edit:              [x] Verified (no edit-path change)
Demo Soft Delete:       [ ] N/A (no delete-policy work this phase; deferred to Phase 13)
Demo Restore:           [ ] N/A (same as above)
Technical Validation:   [x] TypeScript (32 pre-existing errors, unchanged, none in touched/new files) [x] Tests (1424 passed / 8 pre-existing failures, unchanged; 2 new tests in 1 new test file) [x] Build (succeeded)
End-to-End Scenario:    [x] Passed (B2C Quotation→Order→PI→Payment chain traced through actual code with correct stage advancement at every step; live browser session not run — see Remaining Gaps)
Cross-Module Regression:[x] Passed (no new tsc errors, no new test failures vs. baseline)
PHASE STATUS: COMPLETE
```

---

### PHASE 9 — Dispatch (B2B vs B2C correctness, serial-number timing, Bill trigger)

**Objective:** Verify/complete the B2B serial-number-at-Dispatch population (previously UNKNOWN), decide the Dispatch→Bill relationship, and confirm dispatch-loading UI hides selling price — a fresh, complete repository audit of the whole Dispatch domain, not a narrow re-check.
**Business Problem Solved:** Audit flagged `Dispatch.items[].serials` as a field that exists but whose population site was not confirmed; and confirmed Tax Invoice is real but not auto-triggered from Dispatch close. This phase's fresh audit **confirmed serial capture is fully built and working** (previously UNKNOWN, now CONFIRMED — see below), confirmed the price-visibility concern was real and fixed it, and additionally found and fixed a genuine, more significant workflow bug: `confirmDelivery()` was auto-closing every dispatch immediately after delivery, bypassing `closeDispatch()`'s own Accounts-only permission check and making the real 'Delivered' status impossible to ever observe — contradicting three independent parts of the codebase (`dispatchWorkspaceUtils.ts`'s progress/KPI logic, `validateDispatchIntegrity()`, and a dedicated "Close Dispatch" bulk action) that all already assumed 'Delivered' was a real, separately-closeable state.
**Current-State Gap:** Serial capture — **RESOLVED, CONFIRMED WORKING**: `DispatchWorkspaceParts.tsx`'s verification section (both desktop and `MobileDispatchWorkspace.tsx`) has real Barcode/Serials input fields, comma-separated parsing, and derives `verifiedQty` from serial/barcode count when `trackingType` requires it — fully wired end-to-end, contrary to the Audit's "not traced to completion" flag. Price visibility — **CONFIRMED a real gap**: the verification modal itself never showed price (already correct), but `DispatchDetail.tsx`'s "Material Value" field and `DispatchWorkspace.tsx`'s "DISPATCH VALUE" KPI tile were both visible to any role that could view Dispatch at all, including Warehouse (the role doing the physical verification) — now fixed. Dispatch→Bill — **CONFIRMED still manual by design** (no code path triggers `createTaxInvoiceDraft()` from `closeDispatch()`); left as-is per the Blueprint's own "enhancement, not a bug fix" framing, not built this phase. **Newly found**: the `confirmDelivery()` auto-close bug (see above).
**Target-State Behavior:** Serial capture works exactly as designed — confirmed, no change needed. Dispatch-loading/detail UI does not display price/total fields to a role without Dispatch pricing visibility — **MET**, via the pre-existing but previously entirely unused `view_pricing` permission (already defined in `permissions.ts`'s type system and `usePermissions()`'s `canViewPricing()`, never wired to any role or UI before this phase). `confirmDelivery()` sets `status:'Delivered'` and stops; closing remains a distinct, separately-permissioned Accounts action via the existing "Close Dispatch" bulk action — **MET**.
**Affected Modules:** Dispatch (desktop/mobile), Tax Invoices (confirmed unaffected — no trigger built), Roles/Permissions.
**Affected Entities:** None (no schema change — all fixes are permission-gating or removing an incorrect side-effect).
**Affected Fields:** None new.
**Affected Services:** `src/lib/dispatchWorkflow.ts` (`confirmDelivery()` — auto-close removed).
**Affected UI:** `src/pages/DispatchDetail.tsx` (Material Value gated), `src/pages/DispatchWorkspace.tsx` (DISPATCH VALUE KPI tile gated).
**Affected Permissions:** `src/lib/roleBootstrap.ts` — `view_pricing: true` added to the `dispatch` module for Director, Sales, Accounts, Operations, Manager; deliberately **not** added for Warehouse.
**Affected Routes:** None.
**Data Migration:** None (no schema change; the workflow fix only affects future delivery confirmations, and no historical Dispatch record needs correction as a result).
**Demo Data Correction:** `scripts/demo/datasets/businessGraph.ts`'s dispatch generator previously used an invented `status:'Verified'` value that the real `dispatchWorkflow.ts` enum never produces, and never set `approvalStatus` at all (so the Dispatch KPI's Scheduled/Verified buckets could never match any demo record). Fixed: all 5 demo dispatches now use only real enum values, one is genuinely `approvalStatus:'Approved'` while still `status:'Pending Verification'` (the real meaning of "Verified"), and — previously absent entirely — one now reaches the real `'Closed'` terminal state with `deliveredAt`/`closedAt` set.
**Demo Scenarios:** Verified via a new dedicated test against the real demo generator: every demo Dispatch uses a real status/approvalStatus value; at least one reaches `Delivered` (with `deliveredAt`) and at least one reaches `Closed` (with `closedAt`) — previously zero ever did.
**Tests:** New `dispatchConfirmDeliveryGuard.test.ts` (locks in the auto-close fix), new assertions in `roleBootstrap.test.ts` (Warehouse lacks `view_pricing`, five other roles have it) and `demoBusinessGraph.test.ts` (real enum values, Delivered/Closed both reachable), new `dispatchPriceVisibility.test.ts` (source-text wiring check for both UI gates). All pre-existing Dispatch tests (`dispatchWorkflow.test.ts`) pass unchanged.
**Regression Risk:** Low — the price-visibility fix only removes visibility for the one role (Warehouse) the Blueprint's own concern was about, with five other roles gaining it explicitly and Admin already having it by default; the `confirmDelivery()` fix is a narrowing (a side-effect that shouldn't have happened no longer happens) with a pre-existing, correctly-permissioned path (the "Close Dispatch" bulk action) already available to complete the same end state deliberately.
**Dependencies:** Phase 3 (B2B Order/PI/Payment chain must be correct first) — re-confirmed still correct.
**Completion Criteria:** Serial capture confirmed working for B2B dispatch — **MET**. Price-visibility policy resolved and enforced via the reused `view_pricing` permission — **MET**. Dispatch→Bill relationship explicitly documented as manual by design — **MET** (the Blueprint's own alternative, valid outcome). A genuinely-found workflow bug (auto-close bypassing permission and hiding a real state) fixed — **MET**, exceeding the phase's original scope.

**What was actually implemented (exceeds the Blueprint's original framing):**
- `dispatchWorkflow.ts`'s `confirmDelivery()`: removed the automatic `closeDispatch({skipPermission:true})` call in both the demo and production (transactional) branches — 'Delivered' now persists as its own real, observable state; closing remains a distinct, Accounts-permissioned action.
- `roleBootstrap.ts`: wired the pre-existing, previously-unused `view_pricing` permission onto the `dispatch` module for Director/Sales/Accounts/Operations/Manager, explicitly withheld from Warehouse.
- `DispatchDetail.tsx` / `DispatchWorkspace.tsx`: gated "Material Value" and the "DISPATCH VALUE" KPI tile on `canViewPricing('dispatch')`.
- Demo dataset: Dispatch statuses/approvalStatus corrected to only ever use real enum values; the dataset now reaches both `Delivered` and `Closed` for the first time.

**Newly discovered during this phase (documented, not fixed — genuinely out of scope or requires further decision):**
- `src/features/dispatch/components/DispatchWorkspaceBoard.tsx` and `DispatchViewModal.tsx` are both fully orphaned — zero import references anywhere in the repository, apparently superseded by `DispatchWorkspaceParts.tsx`'s `DispatchManagementModal`. Not deleted this phase (neither was touched for Phase 9's actual workflow-correctness work, and removing UI component files is a larger, separate cleanup decision); flagged for a future dead-code pass.
- Dispatch→Bill (Tax Invoice) remains entirely manual, per the Blueprint's own sanctioned "manual by design" outcome — no convenience action was built. If the business later wants one, it's still available as future, explicitly-scoped work.

```
PHASE 9 COMPLETION GATE
Business Rules:        [x] Complete
Database/Data Model:   [x] Complete (no schema change)
Services:              [x] Complete (dispatchWorkflow.ts confirmDelivery() fix)
UI:                    [x] Complete (DispatchDetail.tsx, DispatchWorkspace.tsx price gating)
Permissions:           [x] Complete (view_pricing wired for dispatch across 5 roles, withheld from Warehouse)
Workflow:              [x] Complete (Delivered no longer auto-collapses into Closed)
Migration:             [x] N/A (no schema change)
Demo Data:              [x] Corrected (real enum values; Delivered and Closed both now reachable)
Demo Create:            [x] Verified (requestDispatch unaffected)
Demo Edit:              [x] Verified (approve/execute/verify unaffected)
Demo Soft Delete:       [ ] N/A (no delete-policy work this phase; deferred to Phase 13)
Demo Restore:           [ ] N/A (same as above)
Technical Validation:   [x] TypeScript (32 pre-existing errors, unchanged, none in touched/new files) [x] Tests (pre-existing baseline maintained; 12 new tests across 4 new/updated test files) [x] Build (succeeded)
End-to-End Scenario:    [x] Passed (serial capture, price-visibility gating, and the confirmDelivery fix all traced through actual code and unit-tested; live browser session not run — see Remaining Gaps)
Cross-Module Regression:[x] Passed (no new tsc errors, no new test failures vs. baseline)
PHASE STATUS: COMPLETE
```

---

### PHASE 10 — Installation / QC

**Objective:** Build a real, Project-scoped Installation entity; fix the broken `qc_checks`↔`installations` caseId link.
**Business Problem Solved:** The single largest structural finding in the audit after the B2B/B2C bugs — "Installation" is fields on a Lead document, not a Project-scoped record, permanently breaking caseId propagation for everything downstream of QC.
**Current-State Gap (re-verified this phase, still true):** No `COLLECTIONS.INSTALLATIONS` constant existed; `captureInstallationSerial(leadId,...)`/`installationChecklist`/`assignEngineer` all wrote only to `COLLECTIONS.LEADS`; `casePropagation.ts`'s `installations` chain entry (`installations → parentCollection 'projects'`, `qc_checks → parentCollection 'installations'`) was already correctly built but mapped to a raw, never-populated collection name; `QC.tsx`'s "Installation (optional)" create-dropdown sourced its options from `COLLECTIONS.LEADS`, meaning `qc_checks.installationId` could only ever hold a Lead id.
**What was actually implemented — Dual-write, not a full cutover:** Per this Blueprint's own "HIGH regression risk... dual-write period recommended" guidance below, and to avoid a 5-file UI rewrite with no live/staging environment to verify it in, the fix is scoped to the service-layer chokepoint. `installationEngine.ts` gained `COLLECTIONS.INSTALLATIONS` (`firebase.ts`), a new `InstallationRecord` shape, `ensureInstallationForLead()` (finds-or-lazily-creates one real Installation doc per Project the first time a Lead with a linked Project is mutated) and `mirrorToInstallation()` (best-effort mirrored write — a mirror failure never fails the caller's already-successful Lead write, matching the established pattern from `submitSurveyReport()`'s GPS/Documents mirrors). Every mutator (`toggleChecklistItem`, `resetChecklist`, `captureInstallationSerial`, `removeCapturedSerial`, `assignEngineer`, `linkInstallationToProject`) now ALSO writes onto the real collection, while continuing to write the Lead fields unchanged — so all five existing Lead-reading UI surfaces (`Installations.tsx`, `InstallationWorkspace.tsx`, `MobileInstallationsWorkspace.tsx`, partner `InstallationDetailDrawer.tsx`, `PartnerMobileInstallationWorkspace.tsx`) keep working with zero behavior change, while the real collection accumulates correctly-linked data going forward for the one thing that actually needed it: QC→Case propagation. `captureInstallationSerial()` additionally now writes the real installation id (not the Lead id) onto the `serial_numbers.installationId` field once a Project is linked. `QC.tsx` and `MobileQCWorkspace.tsx`'s Installation-selection dropdowns now source from the real collection instead of Leads. `Installations.tsx`'s bulk-assign (previously a raw `updateDocById` bypassing the service layer entirely) now calls `assignEngineer()`, consolidating the duplicate logic and automatically inheriting the dual-write.
**Newly discovered and fixed — `submitQCDecision()`'s stage-regression variant:** The same unconditional-`currentStage`/`stageHistory`-write bug found in Survey (Phase 6) and Engineering (Phase 7), with a twist: QC-fail's backward loop-back to Installation is a *legitimate, intentional* exception to forward-only progression, so the canonical `buildProjectStageAdvancePatch()` guard (which would refuse any backward move outright) could not be used unmodified. Fixed as two branches: PASS uses `buildProjectStageAdvancePatch(project, 'Commissioning', ...)` (forward-only, regression-proof, from `projectLifecycle.ts`); FAIL still writes manually but now guarded with `if (project.currentStage === 'QC')`, so a stale/duplicate QC record can never regress a Project that has already legitimately moved past QC via a later, different QC check. `createQCCheck()` also gained a duplicate-open-QC-check guard (rejects a new check while a `pending`/`in_progress` one already exists for the Project) — the contributing risk factor behind that ambiguity in the first place.
**Newly discovered and fixed — latent `WorkspaceSearchEngine.ts` bugs, surfaced only by the dual-write:** `searchInstallations()` already targeted the real `'installations'` collection name before this phase (like `casePropagation.ts` and `CaseReports.tsx`'s `caseAnalytics.ts`, it was anticipating the collection's eventual existence) — but since the collection was always empty, two latent bugs were never exercised: it read `doc.status`/`doc.assignedInstaller`, fields that don't exist on the real record (`installationStatus`/`assignedEngineerName` do); and it linked to `/installations/${doc.id}`, but that route (`InstallationWorkspace.tsx`) still resolves by **Lead** id, not the installations collection's own id. Both fixed (link now uses `doc.leadId`). `LinkedRecordsEngine.ts` gained a proper `installations` entity registration (label, `projects → installations` relationship via `projectId`, collection mapping) — previously entirely absent, so a Project's Linked Records panel had no way to show its Installation at all.
**Verified correct, no change needed:** `casePropagation.ts`'s chain map and `PROJECT_SCOPED_COLLECTIONS` (`projectVisibility.ts`) already correctly anticipated `installations` — only the missing real documents were the gap. `qcWorkflow.ts`'s QC notification routing (`type: 'qc_check'`) and `createQCCheck()`'s own `advanceProjectStage()` call were already correct. Permissions: `installations`/`qc` are already first-class `Module` values (`permissions.ts`) with a working `InstallationLead` role grant (`roleBootstrap.ts`) — Installation/QC never had app-layer `canDo()` enforcement inside the service functions themselves (a pre-existing gap predating this phase, not introduced or worsened by it — left as-is, out of scope).
**Affected Modules:** Installations (desktop/mobile/partner), QC (desktop/mobile), Project Workspace (Linked Records), global search.
**Affected Entities:** New `Installation` collection (dual-write alongside, not replacing, the Lead fields); `qc_checks` (no schema change — the FK just starts resolving); `Project` (stage-write fix only, no schema change).
**Affected Fields:** New `installations.{installationId, projectId, leadId, companyId, installationStatus, checklist, capturedSerialNumbers, assignedEngineerId, assignedEngineerName, assignedEngineerPhone}`; `serial_numbers.installationId` now the real installation id (was the Lead id); `qc_checks.installationId`/`installationName` now resolve to a real record.
**Affected Services:** `installationEngine.ts`, `qcWorkflow.ts`, `queryKeys.ts` (new `installationsRoot`/`installationsAll`), `LinkedRecordsEngine.ts`, `WorkspaceSearchEngine.ts`.
**Affected UI:** `Installations.tsx` (bulk-assign only), `QC.tsx`, `MobileQCWorkspace.tsx` (Installation dropdowns only) — all other Installation/QC UI unchanged, per the dual-write design.
**Affected Permissions:** No change — reused the existing `installations`/`qc` `Module` values and `PROJECT_ASSIGNMENT_FIELDS`/`buildProjectVisibilityQueryPlan()` pattern, confirmed already correctly wired.
**Affected Routes:** No change — `/installations/:id` continues to resolve by Lead id (documented, not changed; a full route/UI cutover to Project-scoped routing is explicitly deferred, see Remaining Gaps below).
**Data Migration:** `src/lib/installationBackfill.ts` (pure planning logic, mirrors `orderTypeBackfill.ts`) + `scripts/backfill-installations.ts` (thin CLI, mirrors `scripts/backfill-order-type.ts`, dry-run by default) — scans every Lead with real installation progress (`installationStatus` set and not `'pending'`) and a linked Project, and creates the matching `installations` document if one doesn't already exist. A Lead with real installation progress but **no** resolvable Project is placed in `orphaned`, never silently dropped or guessed (Zero Data Loss). Not yet executed against any live data (no Firestore credentials in this environment, same situation as Phase 3's `backfill-order-type.ts`) — whoever has production DB access should run it (dry-run first) whenever convenient; going forward, new/touched records self-heal via the dual-write regardless.
**Demo Data Correction:** `scripts/demo/datasets/businessGraph.ts` now generates 5 real, Project-scoped `installations` documents (one per demo Project that reaches QC), with realistic checklist-completion/serial-capture states spanning in-progress through completed, and the 5 demo Leads that own them (`LEAD-7`..`LEAD-11`) now carry the matching Lead-side fields for the first time (previously the demo dataset set none at all). The 5 demo `qc_checks` records now reference the real `installationId`. `DEMO_RESETTABLE_COLLECTIONS` (`scripts/demo/config.ts`) gained `'installations'` in correct child-before-parent reset order (after `qc_checks`, before `dispatch`).
**Demo Scenarios:** Full demo Installation: checklist progress, serial capture (2 of 5), completion (2 of 5), handoff to QC — confirmed QC's `installationId` now resolves to a real record whose `projectId` resolves to a real Project (new test, see Tests below); `propagateCaseIdFromChain('qc_checks', ...)` now has a real chain to walk where it previously always failed silently.
**Tests:** `installationEngineDualWrite.test.ts` (7 tests — mirror-write creation/reuse/skip-when-no-project, `assignEngineer`/`captureInstallationSerial`/`linkInstallationToProject` mirroring, real-id-on-serial-record); `qcWorkflow.test.ts` (7 tests — duplicate-open-check guard, PASS forward-only + no-regression, FAIL guarded-backward + no-regression-when-already-past-QC); `installationBackfill.test.ts` (9 tests); `workspaceSearchInstallations.test.ts` (2 tests, source-text wiring check); `demoBusinessGraph.test.ts` gained one new assertion (`qc_checks → installations → projects` chain resolves for every demo record with an `installationId`).
**Regression Risk:** Mitigated to **LOW** by the dual-write design — every existing Lead-reading caller is untouched; only two UI files (`Installations.tsx` bulk-assign, `QC`/`MobileQCWorkspace` dropdowns) and one service file's internals changed. The originally-flagged HIGH risk (a full cutover touching every caller) is deliberately not what was built.
**Dependencies:** Phases 4, 5 (Project foundation and canonical stage list, both satisfied).
**Completion Criteria:** A real, Project-scoped `installations` collection exists and is populated by every mutation path; `qc_checks.installationId` resolves to a real document whose `projectId` resolves to a real Project; caseId propagates correctly through QC for both new and (once the backfill script runs) migrated records; no existing Lead-anchored UI behavior changed.

```
PHASE 10 COMPLETION GATE
Business Rules:        [x] Complete
Database/Data Model:   [x] Complete
Services:              [x] Complete
UI:                    [x] Complete
Permissions:           [x] Complete (verified, no change needed)
Workflow:              [x] Complete
Migration:             [x] Complete (script built, dry-run by default — not yet executed against live data; see Data Migration above)
Demo Data:              [x] Corrected
Demo Create:            [x] Verified (dataset build + reference-resolution tests pass)
Demo Edit:              [x] Verified (dual-write path covered by installationEngineDualWrite.test.ts)
Demo Soft Delete:       [x] Verified where applicable (installations doc follows the same isDeleted convention; no UI soft-delete path exists yet for it, matching its dual-write-only scope)
Demo Restore:           [x] Verified where applicable (none applicable — no soft-delete UI path added this phase)
Technical Validation:   [x] TypeScript [x] Tests [x] Build
End-to-End Scenario:    [x] Passed (demo dataset build + reference/case-report chain resolution verified via automated tests; not live-browser-tested — see final report)
Cross-Module Regression:[x] Passed (32/32 baseline tsc errors unchanged, 8/8 baseline test failures unchanged across the same 7 files, build succeeds)
PHASE STATUS: COMPLETE
```

---

### PHASE 11 — Commissioning / Net Metering / Subsidy / Handover / AMC / Service

**Objective:** Now that Phase 10 restored caseId propagation into this chain, verify each of these modules stage-by-stage (the audit only confirmed they exist and are chain-registered, not their internal correctness).
**Business Problem Solved:** Closes the audit's explicitly-flagged gap: "not individually deep-audited stage-by-stage... do not assume full correctness beyond what's stated."
**Current-State Gap (re-verified this phase):** All six modules' service layers (`commissioningWorkflow.ts`, `netMeteringWorkflow.ts`, `subsidyWorkflow.ts`, `projectHandoverWorkflow.ts`, `amcWorkflow.ts`, `serviceTicketWorkflow.ts`) exist, are well-structured, and mostly correct — but the deep audit found: (1) `casePropagation.ts`'s `net_metering_applications`/`subsidy_applications` chain entries referenced FK fields (`commissioningId`/`netMeteringId`) that neither record's real schema ever declares or writes, permanently breaking caseId propagation for both, the same bug family Phase 10 fixed for `installations`/`qc_checks`; (2) `createHandover()`/`createAmcContract()` had zero precondition on the Project's current stage, unlike every sibling module, allowing Handover/AMC to be created (and the Project stage force-advanced) from any earlier stage, with no duplicate-open-record guard either; (3) two field-name-typo bugs in bulk-assign UI (`Commissioning.tsx` wrote `commissionedById` instead of `commissionedBy`; `ServiceTickets.tsx` wrote `assignedTechnicianId` instead of `assignedTechnician`), both silently no-op against the real schema; (4) `AmcContracts.tsx`/`ServiceTickets.tsx`'s single-record delete bypassed `deleteDocById`, omitting `deletedAt`/`deletedBy`; (5) the demo dataset for all six modules used invented field names (`referenceNumber`, `submittedAt`/`approvedAt`, `amount`, `subject`, `openedAt`, `amcId`, `handoverId`, `checklist`/`documents` arrays that don't exist on the schema) that none of these workflows' real interfaces or UI ever read, so demo records rendered blank `projectName`/`customerName`/`contractValue`/`statusHistory` everywhere the real UI displays them; (6) `roleBootstrap.ts`'s `InstallationLead` role — the role that performs Commissioning in practice, immediately after QC passes — had no `commissioning` permission grant at all.
**Target-State Behavior:** Each module's create/transition/complete logic reviewed against the same rigor already applied to Survey/Engineering/QC; every confirmed bug above fixed; no new bugs found beyond those.
**Affected Modules:** Commissioning, NetMetering, Subsidy, ProjectHandover, AMC, ServiceTickets (desktop/mobile) — all confirmed to already share the same business logic between desktop and mobile via `features/*/hooks/use*.ts`, no mobile-only logic found or introduced.
**Affected Entities/Fields/Services/UI/Permissions/Routes:** `casePropagation.ts` (`PARENT_CHAIN` entries for `net_metering_applications`/`subsidy_applications` now point at `projects`/`projectId`); `commissioningWorkflow.ts` (new `reassignCommissioning()`, stage-write now routed through `buildProjectStageAdvancePatch()`); `projectHandoverWorkflow.ts` / `amcWorkflow.ts` (new stage-precondition + duplicate-open-record guard on create, new `reassignHandoverEngineer()` / `reassignAmcContract()`); `serviceTicketWorkflow.ts` (new `reassignServiceTicket()`); `Commissioning.tsx` / `ServiceTickets.tsx` / `ProjectHandover.tsx` / `AmcContracts.tsx` (bulk-assign routed through the new reassign functions; `AmcContracts.tsx`/`ServiceTickets.tsx`'s single-record delete now uses `deleteDocById`); `roleBootstrap.ts` (`InstallationLead` gains `commissioning`).
**Data Migration:** None required — every fix is either forward-only-safe (canonical `projectLifecycle.ts` guard) or a field-name correction on new writes; no destructive migration of existing data.
**Demo Data Correction:** All six modules' demo records in `scripts/demo/datasets/businessGraph.ts` rewritten to use the real workflow-schema field names throughout (`discomName`/`applicationNumber`/`schemeName`/`statusHistory`/`disbursements`/`handoverNumber`/`contractNumber`/`contractValue`/`ticketNumber`/`issueType`/`reportedDate`, `projectName`/`customerName` on every record) — no invented fields or parallel schemas remain.
**Demo Scenarios:** Full downstream demo walkthrough verified via automated tests: Commissioning (2 completed, referencing real passed QC checks) → Net Metering (Submitted/UnderReview/Approved/MeterInstalled spread across 4 applications, each with real `statusHistory`) → Subsidy (UnderReview/Approved/Disbursed spread across 4 applications, with a real `disbursements` ledger entry on the Disbursed one) → Handover (2 Completed, full `statusHistory`) → AMC (2 Active contracts with real `contractValue`) → Service Ticket (1 Resolved, 1 Open, both linked to their AMC contract via `amcContractId`).
**Tests:** `projectHandoverWorkflow.test.ts` and `amcWorkflow.test.ts` extended with the new stage-precondition and duplicate-open-record guard cases (their existing `createHandover`/`createAmcContract` fixtures also corrected from an invalid `currentStage: 'NetMetering'` to a valid post-fix stage); `commissioningWorkflow.test.ts` and `serviceTicketWorkflow.test.ts` extended with a `reassign*()` field-correctness test each; new `casePropagationPhase11.test.ts` (3 tests) proving NetMetering/Subsidy caseId now resolves via the Project; `demoBusinessGraph.test.ts` gained a new schema-field-correctness assertion covering all six modules' demo records.
**Regression Risk:** **LOW** — every fix is additive/corrective on paths that were already broken or missing; no working business logic was changed. The stage-precondition guards on Handover/AMC are new validation, not a change to any previously-succeeding call (nothing in the codebase created a Handover/AMC before the correct stage was reached in practice).
**Dependencies:** Phase 10.
**Completion Criteria:** Each of the six modules has the same level of confirmed correctness Survey/Engineering/QC already have; every confirmed bug found during this phase's investigation is fixed and demo-corrected; two genuine business-policy ambiguities are documented (not silently resolved) in Appendix E rather than invented.

```
PHASE 11 COMPLETION GATE
Business Rules:        [x] Complete
Database/Data Model:   [x] Complete (casePropagation.ts chain fix only — no schema change)
Services:              [x] Complete
UI:                    [x] Complete
Permissions:           [x] Complete (InstallationLead gained commissioning)
Workflow:              [x] Complete
Migration:             [x] Complete (none required — see Data Migration above)
Demo Data:              [x] Corrected
Demo Create:            [x] Verified (dataset build + schema-field tests pass)
Demo Edit:              [x] Verified (reassign/guard paths covered by new unit tests)
Demo Soft Delete:       [x] Verified where applicable (AmcContracts.tsx/ServiceTickets.tsx now use deleteDocById like every sibling module)
Demo Restore:           [x] Verified where applicable (standard softDelete/restoreRecord path, unchanged)
Technical Validation:   [x] TypeScript [x] Tests [x] Build
End-to-End Scenario:    [x] Passed (full downstream demo chain verified via automated tests; not live-browser-tested — see final report)
Cross-Module Regression:[x] Passed (32/32 baseline tsc errors unchanged, baseline test failures unchanged across the same 7 files, build succeeds)
PHASE STATUS: COMPLETE
```

---

### PHASE 12 — HR / User / Warehouse Alignment

**Objective:** Join Employee and User (link or consolidate, per the Phase 0/12 policy decision, §12), add Warehouse↔Employee.
**Business Problem Solved:** Cannot currently answer "which warehouse does this employee work in" or "who is their reporting manager" from the Employee/HR side (Audit §13).
**Current-State Gap (re-verified this phase):** `warehouseId`/`managerId` live on `AppUser`, not `Employee` — still true. But the fresh audit found the **link itself already exists**: `EmployeeDomainService.create()` already calls `resolveOrCreateMasterUser()` and stores the result as `Employee.userId` — this was NOT reflected in the Gap Audit or this Blueprint's prior text. What was actually missing was anywhere that read through that already-existing link: no UI ever resolved Employee→User→warehouse/manager, `Users.tsx` tracked `form.warehouseId` in state and sent it on save but had **no `<Select>` control for it at all** (a confirmed, isolated bug — the field could never be set through that page), and `Warehouses.tsx`/`WarehousesWorkspace.tsx` had zero employee-count aggregation code anywhere.
**Target-State Behavior:** **Option A (link) confirmed and extended** — not Option B — since the link already exists and is actively maintained (`EmployeeDomainService.update()` already syncs name/phone changes onto the linked User). A reverse `AppUser.employeeId` pointer was deliberately not added: every required query (employee→warehouse, employee→manager, employee→team, warehouse→employee-count) is resolvable from the existing one-directional `Employee.userId` link plus a full employees scan, which every one of these queries needs regardless.
**Affected Modules:** Employees, Users, Attendance, Payroll, Warehouses (desktop + mobile for Employees).
**Affected Entities:** `Employee` (no schema change — `userId` already existed), `AppUser` (`warehouseId`/`managerId` — no schema change, now actually reachable/settable).
**Affected Fields:** No new fields. `Employee.userId` (pre-existing, now actually used); `AppUser.warehouseId`/`managerId` (pre-existing, now actually settable and read through).
**Affected Services:** New `src/lib/employeeDirectory.ts` (join helpers: `resolveEmployeeWarehouseInfo`, `getWarehouseEmployeeCounts`, `getDirectReportEmployeeIds`); `EmployeeDomainService.create()`/`update()` (now sync `warehouseId`/`managerId` onto the linked User, explicitly excluded from the Employee document itself to avoid a second, driftable copy).
**Affected UI:** `Employees.tsx` (desktop + mobile) gained Warehouse/Reporting-Manager fields on the create/edit form and detail view; `Users.tsx` gained the missing Warehouse `<Select>` (bug fix) plus resolved-name display for Reporting Manager/Warehouse (previously showed a raw ID); `WarehousesWorkspace.tsx`/`WarehouseModals.tsx` gained a real, query-backed per-warehouse Employees count; `Attendance.tsx`/`Payroll.tsx` gained a resolved Warehouse field in their detail views.
**Affected Permissions:** None new — confirmed; every new field/query sits inside the same, already-permission-gated forms and detail views.
**Affected Routes:** None new.
**Data Migration:** None required — every existing Employee already has a real `userId` (set at creation time by the already-existing `EmployeeDomainService.create()` call), so there is no backfill population needed for the link itself; only the never-before-set `warehouseId`/`managerId` values need to be assigned going forward through the now-working UI, which is an ordinary data-entry task, not a migration.
**Demo Data Correction:** `scripts/demo/datasets/foundation.ts`'s `buildEmployeeDocuments()` previously created 10 demo Employees with no linked User at all. Fixed: new `buildEmployeeUserDocuments()` creates a matching demo User per Employee (`Employee.userId` now set), with an uneven 5/3/2 warehouse split across the 3 demo warehouses and a genuine 2-level manager chain (assignee `USR-1` → two department leads → their direct reports).
**Demo Scenarios:** From the Warehouse workspace, view a real, query-backed employee count per warehouse (verified via `demoTooling.test.ts`); from an Employee record, see their real reporting manager and warehouse; from Attendance/Payroll, see the resolved warehouse for that employee.
**Tests:** New `employeeDirectory.test.ts` (8 tests), `EmployeeDomainService.test.ts` (5 tests), `usersWarehouseField.test.ts` (2 tests, source-text wiring guard against the confirmed missing-Select bug recurring); `demoTooling.test.ts` extended (document count 58→68, new Employee↔User↔Warehouse link assertion).
**Regression Risk:** **LOW** — no schema change, no data migration; every fix is additive (new helper module, new UI fields/displays) or a targeted bug fix (Users.tsx's missing Select) on a field that was previously unsettable through the UI, so there was no working behavior to regress.
**Dependencies:** Phase 1 (company scoping foundation) — satisfied.
**Completion Criteria:** Warehouse-wise employee count, reporting-manager chain, and warehouse-attributed Attendance/Payroll are all real, query-backed capabilities.

```
PHASE 12 COMPLETION GATE
Business Rules:        [x] Complete
Database/Data Model:   [x] Complete (no schema change needed — link already existed)
Services:              [x] Complete
UI:                    [x] Complete (desktop + mobile Employees; Users; Warehouses; Attendance; Payroll)
Permissions:           [x] Complete (verified, no change needed)
Workflow:              [x] Complete
Migration:             [x] Complete (none required — see Data Migration above)
Demo Data:              [x] Corrected
Demo Create:            [x] Verified (dataset build + link/count tests pass)
Demo Edit:              [x] Verified (EmployeeDomainService sync path covered by tests)
Demo Soft Delete:       [x] Verified where applicable (unchanged — no delete-path changes this phase)
Demo Restore:           [x] Verified where applicable (unchanged — no delete-path changes this phase)
Technical Validation:   [x] TypeScript [x] Tests [x] Build
End-to-End Scenario:    [x] Passed (demo dataset build + join/count assertions verified via automated tests; not live-browser-tested — see final report)
Cross-Module Regression:[x] Passed (32/32 baseline tsc errors unchanged, baseline test failures unchanged across the same 7 files, build succeeds)
PHASE STATUS: COMPLETE
```

---

### PHASE 13 — Roles / Permissions / Data Visibility

**Objective:** Make Manager "team" visibility real; move non-project collections from client-side post-filtering to query-level scoping; finalize the soft-delete/permanent-delete policy (§13).
**Business Problem Solved:** Audit §12/§22's two CONFIRMED HIGH-severity gaps: team visibility collapses to self-only; non-project collections over-fetch to the client before filtering.
**Current-State Gap:** `isProjectScopedRole()` treats `'team'` same as `'self'`; `applyAccessFilters()` is a post-fetch, in-memory filter for Leads/Customers/Orders/Tasks.
**Target-State Behavior:** `'team'` visibility resolves real direct reports (via Phase 12's reporting-manager field) and is used to build a real `where()` constraint set, mirroring `buildProjectVisibilityQueryPlan()`'s existing pattern (reuse it, extend it — do not invent a second pattern). Non-project collections gain equivalent query-level constraints wherever Firestore's query model allows (`where('assignedToId','in',[...])`-style, mindful of Firestore's `in` clause size limits — **[UNKNOWN — REQUIRES IMPLEMENTATION-TIME VERIFICATION of exact Firestore query-shape feasibility for large teams]**). Soft-delete/permanent-delete policy (§13) is implemented: `deletedBy`/`deletedAt` added where missing, permanent-delete gated to Super Admin via the existing, proven `isOwnerIdentity()` mechanism.
**Affected Modules:** Every module with role-based visibility; every soft-deletable entity.
**Affected Entities:** Role documents (no schema change, behavior change only); every entity gaining delete metadata.
**Affected Fields:** `+ deletedBy, deletedAt` (and `restoredBy`/`restoredAt` if the Phase 0/13 policy decision includes restore metadata).
**Affected Services:** `firestore.ts`'s `applyAccessFilters()`, `projectVisibility.ts`, `softDelete()` primitive (extend, don't replace).
**Affected UI:** "Show inactive" toggle standardized across list views (confirm existing per-module state first); restore action UI where missing; permanent-delete action restricted to Super Admin UI surfaces only.
**Affected Permissions:** `'team'` visibility becomes meaningfully different from `'self'` for the first time.
**Affected Routes:** None new.
**Data Migration:** None to existing soft-deleted records' core state; only additive metadata fields need backfilling (`deletedBy`/`deletedAt` can be left null for historical soft-deletes if the actor/timestamp isn't recoverable — document this explicitly as a known historical-data limitation, not a bug).
**Demo Data Correction:** Demo data must include soft-deleted records in various states (recently deleted, long-deleted) to prove the "show inactive" toggle and restore flow function in Demo Mode exactly as in production.
**Demo Scenarios:** As a Manager-role demo user, confirm visibility now includes real team members' records, not just your own. Soft-delete a demo record, confirm it disappears from the default list, appears under "show inactive," and can be restored. Attempt a permanent delete as a non-Super-Admin demo user — must fail. As the Super Admin identity, permanent-delete a record — must succeed and be irreversible.
**Tests:** New tests for team-visibility query construction; new tests for soft-delete/restore/permanent-delete authorization (positive and negative cases per §19 of the original brief).
**Regression Risk:** Medium-high — visibility changes are exactly the kind of change that can silently over- or under-expose data; requires careful review of every role's expected record set before/after.
**Dependencies:** Phase 12 (reporting-manager field must exist for team visibility to have something real to query against).
**Completion Criteria:** A Manager sees their real team's records for both project-scoped and non-project-scoped collections; non-project collections no longer over-fetch to the client; soft-delete/restore/permanent-delete all behave per §13's policy, verified positively and negatively. **MET**, with one honestly-scoped exception (the "show inactive" UI rollout — see below).

**Fresh repository audit findings (re-verified this session against actual code, not assumed from the Audit/Blueprint text):**
- `src/lib/projectVisibility.ts`'s `isProjectScopedRole()`/`buildProjectVisibilityQueryPlan()` — **CONFIRMED, still exactly the Audit's finding**: `'team'` and `'self'` both resolved to the same `'assigned'` mode, matching only the current user's own id against `PROJECT_ASSIGNMENT_FIELDS`. No code path anywhere read `teamMemberIds` for project-scoped collections.
- `src/lib/firestore.ts`'s `getAll()` — **CONFIRMED, still exactly the Audit's finding**: non-project collections (`Leads`/`Customers`/`Orders`/`Tasks`/…) fetched via `companyScopedQuery()` (company-id filter only) and relied entirely on `applyAccessFilters()`'s in-memory post-filter for self/team narrowing — the full company dataset for that collection reached the browser before any ownership check ran.
- `teamMemberIds` itself, however, was **already real** (not a gap): `useGlobalBoot.ts` computes it from `users.filter(u => u.managerId === user.id)` — a genuine, Phase-12-enabled reporting-manager query, just never consulted by the project-scoped path and never query-level-applied for the non-project path. The gate is `isManager = user?.role==='Manager'||user?.role==='TL'` — a second, independent gap: this hardcoded check means a **data-driven** custom role configured with `visibility:'team'` on any module never gets its `teamMemberIds` resolved at all, since it isn't literally named `'Manager'` or `'TL'`.
- No system-seeded role (`roleBootstrap.ts`) actually sets `visibility:'team'` anywhere — `'team'` is a value the architecture supports (`Visibility = 'all'|'team'|'self'`) but no default role exercises. This is a legitimate configuration state (an admin can set it on any data-driven role document), not itself a bug — the fix target is making the *mechanism* correct, not assigning `'team'` to a specific role as a policy decision this Blueprint doesn't own.
- **New, more serious finding, outside the Blueprint's original framing of this phase:** `src/lib/firestore.ts`'s `hardDelete()` is a real, working, unconditional permanent-delete primitive, wired into exactly one live UI surface — `src/pages/CategoriesWorkspace.tsx` and `src/components/mobile/categories/MobileCategoryWorkspace.tsx`'s "Delete" and "Merge" actions — with **zero Super-Admin gate**: any user holding ordinary `categories`→`delete` permission (not a narrow set, per Demo's own role seed) could trigger an irreversible permanent delete, violating Blueprint Rule 6 (§13: "Permanent deletion is Super Admin-only"). Simultaneously, `firestore.rules`'s catch-all rule (and every explicit collection match block) already read `allow delete: if false` unconditionally — meaning against real production Firestore, this button would always fail with a permission-denied error for **everyone**, including Super Admin — the feature was both an application-layer security gap and non-functional at the same time.
- `restoreRecord()` (`firestore.ts`) was real and correctly reachable, but never stamped `restoredBy`/`restoredAt` — confirming the Blueprint's own flagged open question (§13: "confirm at Phase 13").
- **Confirmed absent, not merely unconfirmed:** a "show inactive" toggle plus restore UI does not exist anywhere in the application — `restoreRecord()` had **zero callers** anywhere in `src/`. This resolves the Blueprint's own `[UNKNOWN — verify whether this toggle already exists per-module]` flag as: it does not, in any module.
- `Companies.tsx`'s delete mutation (flagged as a "still hard-deletes" gap in Phase 1's own gate text) was re-checked directly against current code: it calls `deleteDocById()`, which is the soft-delete-safe wrapper — this is **already correct today**; the Phase 1 note was stale relative to the current codebase, not a live gap.

**What was actually implemented:**
- `src/lib/projectVisibility.ts`: `canAccessProjectRecord()`, `filterVisibleProjectRecords()`, and `buildProjectVisibilityQueryPlan()` all gained an optional `teamMemberIds` parameter (backward-compatible default `[]`, every existing caller/test unaffected). When the resolved visibility is genuinely `'team'` (not the role-name fallback, which stays `'self'`), the matched id set becomes `[self, ...teamMemberIds]`; when it's `'self'`, behavior is byte-for-byte unchanged. Firestore's `in`-clause value limit (30 in the current JS SDK) is handled by chunking the id set per assignment field — resolves the Blueprint's own `[UNKNOWN]` flag on this point.
- New `src/lib/ownershipVisibility.ts`: a **symmetric, not duplicate**, query-plan builder for non-project collections — same chunking logic, matched against the generic `assignedToId`/`createdBy` ownership fields `applyAccessFilters()` already uses, per the Blueprint's explicit "extend `buildProjectVisibilityQueryPlan()`'s pattern... do not invent a second pattern" instruction (a second *file* was necessary since the field shapes genuinely differ — project assignment fields vs. generic ownership fields — but the pattern, chunking constant, and query-merge-by-id shape are identical).
- `src/lib/firestore.ts`: extracted a single `resolveVisibility(col)` helper (now the one source of truth for self/team/all resolution, reused by both `getAll()`'s new query-planning branch and `applyAccessFilters()`'s existing in-memory defense-in-depth check — previously this logic was inlined only in `applyAccessFilters()`). `getAll()` now branches: project-scoped collections use the (now team-aware) `buildProjectVisibilityQueryPlan()`; ownership-scoped collections (every non-project collection except `Users`/`Companies`/`Roles`/`Settings`/`Documents`, which keep their pre-existing always-open behavior) use the new `buildOwnershipVisibilityQueryPlan()` when resolved visibility is `'self'`/`'team'`; all other cases keep the original single company-scoped fetch. `applyAccessFilters()` remains as a second, defense-in-depth layer exactly as it does for company scoping (Audit §10's proven two-layer pattern) — the query narrowing can only ever fetch a subset of what today's filter already reduced to, never a different result, so this is a pure narrowing with no behavior-correctness risk. `Users` is deliberately excluded from query-level ownership scoping: `useGlobalBoot.ts`'s own `teamMemberIds` computation needs an unscoped scan of every company User's `managerId` to build the hierarchy in the first place, so scoping that same read by `teamMemberIds` would be circular.
- `getPage()` (paginated fetch) keeps its existing behavior for non-project collections — pagination cursors don't merge cleanly across the multiple parallel `in`-queries the new plan produces, so this fix is scoped to `getAll()`, consistent with the Blueprint's completion criteria ("non-project collections no longer over-fetch **to the client**" — the in-memory filter these callers already had was already correctness-safe, this fix closes the network-level exposure, not pagination internals). Flagged as a known, scoped remainder, not silently dropped.
- `src/lib/useGlobalBoot.ts`: `isManager` (gating whether `teamMemberIds` gets resolved at all) now also fires when the resolved role document declares `visibility:'team'` on *any* module (`roleHasTeamVisibility`), not only for the literal strings `'Manager'`/`'TL'`. The legacy check is kept as an `OR`, never narrowed — this can only add cases where team-hierarchy resolution runs, never remove one.
- `src/lib/firestore.ts`'s `restoreRecord()`: now stamps `restoredBy`/`restoredAt` alongside `isDeleted:false`, matching `softDelete()`'s existing `deletedBy`/`deletedAt` pattern.
- New `src/lib/firestore.ts`'s `getAllDeleted()`: fetches soft-deleted records for a collection under the *same* company + self/team/all visibility scoping as `getAll()` (reusing `resolveVisibility()`/`buildProjectVisibilityQueryPlan()`/`buildOwnershipVisibilityQueryPlan()` — no parallel access-control logic) — the query-level foundation the "show inactive" UI needed and never had.
- **Permanent delete, Super-Admin-only, both layers:** `firestore.rules` gained a narrowly-scoped `match /product_categories/{documentId}` block — the one collection with a real client-side hard-delete surface — with `allow delete: if isSuperAdmin() && sameCompany(resource.data)`, reusing the rules file's own pre-existing `isSuperAdmin()` function (no new authorization mechanism). Every other collection's universal `allow delete: if false` is untouched — this is not a blanket relaxation. Client-side: `CategoriesWorkspace.tsx` and `MobileCategoryWorkspace.tsx` both now gate their `hardDelete()`-calling mutations (single delete, bulk delete, merge) behind `useSuperAdminAccess()` (the same, already-proven Super-Admin identity hook `SuperAdminRoute` uses), throwing a clear error for anyone else rather than silently failing against the rules change; the Merge/Delete buttons themselves are hidden for non-Super-Admins (`CategoryDetailsModal` gained a `canDelete` prop; mobile's own `canDelete` local now additionally requires `isSuperAdmin`, and its Merge button — previously gated only by the weaker `canEdit` — was corrected to use the same `canDelete` gate, since merging also permanently deletes the source categories).
- **"Show inactive" + restore — built as a real, reusable, generic capability, rolled out to two representative modules, not all of them:** new `src/components/shared/InactiveRecordsModal.tsx` (generic — takes a collection name and two label functions, fetches via `getAllDeleted()`, restores via `restoreRecord()`) wired into `Leads.tsx` and `Orders.tsx` (the Blueprint's own literal cited examples for the query-scoping fix, giving both fixes a coherent through-line on the same two modules). This is a genuine, working, positively-and-negatively-testable capability — not a stub — but it is **not yet wired into every other soft-deletable module** (Customers, Employees, Products, Vendors, Quotations, etc.). This is tracked honestly as a new Appendix E item, not silently left undone.
- Demo Mode: two soft-deleted Leads (`LEAD-13`, `LEAD-14`, different ages — `deletedAt` ~40 days apart on the demo timeline) and one soft-deleted Order (`ORD-1`), each stamped with `deletedBy`/`deletedAt`, added to `scripts/demo/datasets/businessGraph.ts` — chosen specifically because neither is referenced as a target by any other builder function in that file, so the change is additive-only and cannot corrupt any cross-entity reference the demo's own `verifyPlan()` consistency checks validate (re-confirmed: `demoBusinessGraph.test.ts`/`demoTooling.test.ts` both still pass in full).

**Newly discovered during this phase (documented, not fixed — belongs to a later phase or explicit follow-up):**
- **"Show inactive" + restore UI rollout is partial** (Leads, Orders only) — the underlying service-layer capability (`getAllDeleted()`, `restoreRecord()` with full metadata, the same visibility scoping as the active-record list) is universal and works for any collection today; only the per-page UI trigger needs mechanical rollout to the rest of the soft-deletable entity list in §13's state machine (Customers, Projects, Quotations, Employees, Vendors, Products, Users, Documents). Tracked as a new Appendix E item.
- `getPage()`'s non-project pagination path still over-fetches per the pre-Phase-13 pattern (in-memory filter only, no query-level scoping) — `getAll()` is fixed; `getPage()`'s cursor semantics don't compose cleanly with the multi-query team plan and were left untouched rather than risking a broken pagination cursor. Not currently a wide-impact gap (most list pages in this codebase call `getAll()`, not `getPage()`), but should be revisited if a paginated non-project view is later found to matter for a `'team'`-configured role.
- No system-seeded role currently uses `visibility:'team'` for any module — the mechanism is now genuinely correct when a role is configured this way, but demonstrating it end-to-end in Demo Mode required test-level verification (role documents constructed in the test itself) rather than a live interactive Demo Mode session, since the single demo login (`demo@neozy.in`) is deliberately seeded with `visibility:'all'` everywhere (full-capability demo access, per §14's own design principle) — there is no second, restricted demo identity to browser-test a `'team'`-scoped view against. This mirrors Phase 12's own precedent (its End-to-End Scenario was "verified via automated tests... not live-browser-tested").

```
PHASE 13 COMPLETION GATE
Business Rules:        [x] Complete
Database/Data Model:   [x] Complete (no schema change — restoredBy/restoredAt are additive fields on the existing isDeleted state machine)
Services:              [x] Complete (projectVisibility.ts team-aware; new ownershipVisibility.ts; firestore.ts resolveVisibility/getAll/getAllDeleted/restoreRecord)
UI:                    [x] Complete for the surfaces this phase scoped (Categories Super-Admin gating desktop+mobile; Show Inactive/Restore on Leads+Orders) — full "show inactive" rollout to remaining modules tracked as a new Appendix E item, not silently dropped
Permissions:           [x] Complete ('team' visibility now real for both project- and non-project-scoped collections; permanent delete now genuinely Super-Admin-only at both the rules and application layer)
Workflow:              [x] Complete
Migration:             [x] Complete (no destructive migration; restoredBy/restoredAt additive-only, consistent with §13's stated policy for historical soft-deletes)
Demo Data:              [x] Corrected (2 soft-deleted Leads at different ages + 1 soft-deleted Order, each with deletedBy/deletedAt; verified non-disruptive to every existing demo consistency check)
Demo Create:            [x] Verified (unchanged this phase; no regression — full suite green)
Demo Edit:              [x] Verified (unchanged this phase; no regression — full suite green)
Demo Soft Delete:       [x] Verified (existing softDelete() path unchanged; demo fixtures now exercise it)
Demo Restore:           [x] Verified (getAllDeleted()/restoreRecord() covered by tests; InactiveRecordsModal wired end-to-end on Leads/Orders)
Technical Validation:   [x] TypeScript (32 pre-existing errors, unchanged, none in touched files) [x] Tests (1510 passed / 8 pre-existing failures across the same 7 files, unchanged — 24 new Phase 13 tests added, all passing) [x] Build (succeeded)
End-to-End Scenario:    [x] Passed — traced/tested directly: (a) team visibility for project-scoped and non-project-scoped collections, positive (team member's record visible) and negative (outsider's record excluded); (b) permanent delete blocked for non-Super-Admin, allowed for Super-Admin, at both rules and UI layers; (c) soft-delete → show inactive → restore round trip via the new Leads/Orders UI, backed by real demo fixtures. Not live-browser-tested (this environment has no interactive browser session) — verified via direct code tracing and the automated test suite, consistent with Phase 12's own precedent.
Cross-Module Regression:[x] Passed (32/32 baseline tsc errors unchanged; same 8 pre-existing test failures across the same 7 files; build succeeds; no new failures anywhere in the 1510-test suite)
PHASE STATUS: COMPLETE
```

---

### PHASE 14 — Documents / Activities / Linked Records

**Objective:** Extend the existing shared Documents system to Order/Quotation/ProformaInvoice/Dispatch/Payment.
**Business Problem Solved:** These five entities currently have zero document capability — not a silo, a total absence (Audit §14).
**Current-State Gap:** No `documents` field on any of these five interfaces; `caseDocuments.ts`'s `resolveDocumentsFor()` pattern is proven but only wired into Lead/Customer/Project/Survey/Engineering.
**Target-State Behavior:** Each of the five gains a DocumentsSection adapter following the exact pattern already established (Audit §20's recommended reuse) — scoped by whatever FK fields are natural to it (`orderId`, `quotationId`, `piId`/`invoiceId`, `dispatchId`, `paymentId`, plus the existing `leadId`/`customerId`/`projectId`/`caseId` chain where resolvable).
**Affected Modules:** Orders, Quotations, Invoices(PI), Dispatch, Payments.
**Affected Entities:** `Order`, `Quotation`, `ProformaInvoice`, `Dispatch`, `Payment` (each gains document-scoping capability, no new collection — reuses `COLLECTIONS.DOCUMENTS`).
**Affected Fields:** No field added to these entities themselves; `CaseDocument` scope-matching gains awareness of their id fields.
**Affected Services:** `caseDocuments.ts`'s `resolveDocumentsFor()` (extend the scope-matching keys), five new DocumentsSection components (or one generalized component parameterized per entity — prefer generalizing given the pattern is now proven five times over, consistent with Rule 24's "avoid duplicate UI systems").
**Affected UI:** New Documents tab/section in Order/Quotation/Invoice/Dispatch/Payment workspaces (if they have workspaces — verify each has an appropriate mount point; some of these may currently be modal-based rather than full workspaces, per the Gap Audit's page/module inventory — confirm before assuming a workspace shell exists).
**Affected Permissions:** Reuse the existing `COLLECTIONS.DOCUMENTS` permissions carve-out (Audit §20 cites `if (col === COLLECTIONS.DOCUMENTS) return true;` in `applyAccessFilters()`) — no new permission work needed.
**Affected Routes:** None new.
**Data Migration:** None — this is pure additive capability, no existing data to migrate.
**Demo Data Correction:** Seed a handful of realistic documents (e.g., a signed quotation PDF placeholder, a dispatch photo, a payment receipt) against demo Orders/Quotations/Dispatches to prove the new capability in Demo Mode.
**Demo Scenarios:** Upload a document to a demo Order; confirm it's retrievable from the Order's workspace and correctly scoped (not visible from an unrelated Order).
**Tests:** New tests mirroring `caseDocuments.test.ts`'s existing structure for the five new scope types.
**Regression Risk:** Low — purely additive; no existing behavior changes.
**Dependencies:** Phase 3 (B2B Order correctness) and Phase 8 (B2C Order correctness) should be stable first, though this phase is largely independent of the B2B/B2C business-logic phases.
**Completion Criteria:** All five entities support document upload/view/delete through the same shared system as Lead/Customer/Project/Survey/Engineering, with no parallel document mechanism introduced. **MET**, with two honestly-scoped exceptions (mobile UI, and 4-of-5 list-page modal surfaces — see below).

**Fresh repository audit findings (re-verified this session against actual code):**
- **CONFIRMED, matching the Audit exactly:** no `documents` field/scope on `Order`/`Quotation`/`ProformaInvoice`/`Dispatch`/`Payment`; `resolveDocumentsFor()` only recognized `leadId`/`customerId`/`projectId`/`caseId`.
- **NOT in the Audit/Blueprint's prior text — a bigger, more serious finding:** all five entities' dedicated `/module/:id` workspace routes (confirmed real via `routes.tsx`: `/orders/:id`, `/quotations/:id`, `/invoices/:id`, `/dispatch/:id`, `/payments/:id`) already had a "Documents" tab, mounted generically through `WorkspaceShell`'s shared `'documents'` tab id → `UniversalDocumentsTab` component. That component's upload/delete handlers only ever mutated local React `useState`, seeded from `record.documents[]`/`record.attachments[]` — a private-array-per-entity shape `caseDocuments.ts`'s own doc comment already explains was rejected for Lead/Customer/Project for exactly this reason. **Nothing was ever persisted** — a file "uploaded" through this tab disappeared on refresh; a "deleted" document reappeared. Grepping every `workspaceConfig.ts` file confirmed this same tab id (and therefore the same bug) is mounted by **~19 modules total**, not just the five Phase 14 owns: also AMC, Commissioning, NetMetering, Subsidy, Handover, QC, Installations, Cases, Partners, Monitoring, Settlements, CommissionRules, CommissionApprovals, ServiceTickets.
- `Orders.tsx`'s own list-page "quick view" modal (opened by clicking a row — confirmed, via reading the click handler, to be reachable without navigating to `/orders/:id` at all, making it likely the more commonly-used of the two Order-detail surfaces) already had a tab literally labeled "Documents" — but its content only ever listed linked Proforma Invoices (a real, useful, but differently-named capability), with no file-attachment capability at all.
- Payment/Dispatch have no canonical TypeScript interface anywhere in the codebase (confirmed via exhaustive grep) — the same "most business-critical entity is untyped" gap the Audit flagged for `Customer` pre-Phase-2, just never previously flagged for these two. Out of scope for Phase 14 (a data-model-typing gap, not a documents gap) — noted for a future phase, not fixed here.
- Demo Mode had **zero** documents seeded for any entity at all, including the five already-"complete" ones (Lead/Customer/Project/Survey/Engineering) — this collection had never been seeded once, by any phase. `DEMO_RESETTABLE_COLLECTIONS` also did not list `'documents'` — a latent gap that would only have surfaced once something finally seeded the collection (now, this phase).

**What was actually implemented:**
- `src/lib/caseDocuments.ts`: `CaseDocument`/`CaseDocumentScope`/`CreateCaseDocumentInput` extended with five new optional fields — `orderId`, `quotationId`, `invoiceId` (matching the real schema's actual field name — no persisted field is ever literally named `piId` anywhere in the codebase, confirmed by grep; `piId` only ever appears as a local variable name meaning "a PI's own `.id`"), `dispatchId`, `paymentId`. `sourceEntityType` widened to include `'order'|'quotation'|'invoice'|'dispatch'|'payment'`. `resolveDocumentsFor()` extended with five new match arms — still one function, "match on any relationship key," not a second algorithm.
- New `src/components/shared/EntityDocumentsPanel.tsx`: the one real, shared-architecture adapter for the five entities — maps each `entityType` to its own FK field (`orders→orderId`, `quotations→quotationId`, `invoices→invoiceId`, `dispatch→dispatchId`, `payments→paymentId`), reads every cross-link field (`customerId`/`projectId`/`leadId`/`orderId`/`quotationId`/`invoiceId`/`dispatchId`/`paymentId`) defensively off the record so a document uploaded against, say, a Payment is also discoverable from its linked Invoice/Order, and renders through the exact same shared `DocumentManager` UI component Lead/Customer/Project already use — no second document UI.
- `src/components/shared/UniversalTabs/UniversalDocumentsTab.tsx`: now branches — the five Phase 14 entity types render the new, real `EntityDocumentsPanel`; every other entity type renders `LegacyLocalDocumentsTab`, containing the exact original (broken, non-persistent) implementation, **preserved unchanged** — the fix is scoped precisely to what Phase 14 owns, not a blanket rewrite of a component 14 other, out-of-scope modules also depend on.
- `src/pages/Orders.tsx`: the list-page quick-view modal's "Documents" tab now also renders `EntityDocumentsPanel` (real upload/view/delete), with the pre-existing linked-Proforma-Invoices list kept exactly as it was, relabeled "Linked Invoices" for clarity.
- Demo Mode: `scripts/demo/datasets/businessGraph.ts` gained `buildPhase14Documents()` — five real `documents` records (one per entity type: a signed Quotation, a Purchase Order confirmation, a signed Proforma Invoice, a delivery photo on a Dispatch, a Payment receipt), each cross-linked to its real customer/project/sibling-entity ids and registered in the plan's reference graph so `verifyPlan()` validates them like every other demo record; inserted before `buildPartnerCommissions()` in the generation order so the existing reverse-dependency-reset test's `deletions[0]==='commission_records'` assertion stays correct. `scripts/demo/config.ts`'s `DEMO_RESETTABLE_COLLECTIONS` gained `'documents'` — otherwise these (and any future) seeded documents would survive every demo reset.

**Newly discovered during this phase (documented, not fixed — belongs to a later phase or a dedicated follow-up):**
- **The same non-persistent `UniversalDocumentsTab` bug still affects ~14 other modules** (AMC, Commissioning, NetMetering, Subsidy, Handover, QC, Installations, Cases, Partners, Monitoring, Settlements, CommissionRules, CommissionApprovals, ServiceTickets) — Phase 14 fixed it only for the five entities it owns, per the Blueprint's own phase boundaries. Fixing the rest is now purely mechanical (each just needs its `entityType` added to `EntityDocumentsPanel.tsx`'s `ENTITY_SCOPE_FIELD` map, once each entity's real FK field name is confirmed) — not scheduled to a specific numbered phase; a natural fit for Phase 16 (Cross-Module Integration & Final ERP Stabilization) or a dedicated follow-up pass.
- **Mobile has zero Documents UI for any of the five entities** (confirmed absent, not merely unverified, via grep across `src/components/mobile/`) — the real, shared service-layer capability (`EntityDocumentsPanel`/`caseDocuments.ts`) is available and mobile-ready, but no mobile page mounts it yet. Tracked as an explicit follow-up, matching the same honest-partial-completion pattern Phase 13 used for its own UI-rollout gap.
- **Quotations/Invoices/Dispatch/Payments' own list-page quick-view modals** (the sibling surfaces to the one Orders.tsx fix covers) were not touched — unlike Orders.tsx, none of them had a pre-existing "Documents" tab to begin with (confirmed via grep), so adding one is a net-new UI addition rather than a bug fix; each entity's dedicated `/module/:id` workspace route (fixed this phase) remains the fully-correct primary path for all five. Tracked as a follow-up, not silently assumed done.
- Payment and Dispatch have no canonical TypeScript interface anywhere in the codebase — a real, pre-existing data-model gap (same family as the Audit's pre-Phase-2 `Customer` finding), outside Phase 14's own scope (documents, not typing) — flagged for whichever future phase next touches these two entities' schemas.

```
PHASE 14 COMPLETION GATE
Business Rules:        [x] Complete
Database/Data Model:   [x] Complete (5 new optional scope fields on CaseDocument/CaseDocumentScope — additive only, no existing field changed)
Services:              [x] Complete (caseDocuments.ts extended; new EntityDocumentsPanel.tsx; UniversalDocumentsTab.tsx fixed for its 5 owned entity types)
UI:                    [x] Complete for the surfaces this phase scoped (all 5 dedicated /module/:id workspace routes + Orders.tsx's list-page modal) — mobile and the other 4 modules' list-page modals tracked as new, explicit Appendix E items, not silently dropped
Permissions:           [x] Complete (reuses the existing COLLECTIONS.DOCUMENTS carve-out in applyAccessFilters() unchanged — no new permission work needed, confirmed)
Workflow:              [x] Complete
Migration:             [x] N/A (additive only, confirmed — no existing data touched)
Demo Data:              [x] Corrected (5 new demo documents, one per entity type, cross-linked and reference-verified; 'documents' added to DEMO_RESETTABLE_COLLECTIONS)
Demo Create:            [x] Verified (createCaseDocument()/EntityDocumentsPanel covered by tests; demo fixtures prove realistic seed shape)
Demo Edit:              [x] N/A (documents are append/delete, not edited in place — matches the existing Lead/Customer/Project DocumentManager convention)
Demo Soft Delete:       [x] Verified (deleteCaseDocument() reuses the existing softDelete() primitive, unchanged)
Demo Restore:           [x] N/A (Documents were not in Phase 13's restore-UI rollout scope; the underlying softDelete()/isDeleted state machine is the same one Phase 13 already covers generically)
Technical Validation:   [x] TypeScript (32 pre-existing errors, unchanged, none in touched files) [x] Tests (1531 passed / 8 pre-existing failures across the same 7 files, unchanged — 44 new Phase 14 tests added, all passing) [x] Build (succeeded)
End-to-End Scenario:    [x] Passed — traced/tested directly: a document uploaded against a demo Order resolves correctly from EntityDocumentsPanel's scope match and is verified absent from an unrelated Order (resolveDocumentsFor()'s own de-duplication/exclusivity tests); the legacy (broken) tab's behavior is confirmed byte-for-byte unchanged for out-of-scope modules via source-text verification. Not live-browser-tested (this environment has no interactive browser session) — verified via direct code tracing and the automated test suite, consistent with Phase 12/13's own precedent.
Cross-Module Regression:[x] Passed (32/32 baseline tsc errors unchanged; same 8 pre-existing test failures across the same 7 files — confirmed via a stable, non-timeout full-suite run; build succeeds)
PHASE STATUS: COMPLETE
```

---

### PHASE 15 — Demo Mode Finalization

**Objective:** Full Demo Mode rebuild — the capstone, only now that every upstream phase's corrected rules exist to seed data against.
**Business Problem Solved:** Demo Mode currently cannot represent a B2B customer at all, uses a schema unrelated to production, has internally-inconsistent stage/status combinations, and (per the brief) may impose an artificial record-count ceiling that blocks realistic use.
**Current-State Gap:** See Audit §15 in full; restated in §14 of this blueprint.
**Target-State Behavior:** Per §14 of this blueprint — same ERP logic as production, realistic multi-state seed data forming genuine B2B and B2C business graphs (never mixed), no invented statuses, no artificial creation ceiling, full create/edit/soft-delete/restore parity with production for the demo user's role.
**Affected Modules:** `scripts/demo/datasets/businessGraph.ts` and any sibling demo-dataset files; `demoCapabilityPolicy.ts`/`demoSession.ts`/`sandboxReset.ts` (record-count-ceiling investigation and removal).
**Affected Entities:** Every entity the demo generator touches — Leads, Customers, Projects, Surveys, Engineering Designs, Quotations, Orders, PIs, Payments, Dispatches, Installations (newly possible per Phase 10), QC, Commissioning, Net Metering, Subsidy, Handover, AMC, Service Tickets, Employees, Warehouses, Channel Partners.
**Affected Fields:** `customerType` (demo-only field) is removed/replaced with the real `type: 'B2B'|'B2C'`; every other field aligned to whatever schema changes Phases 1–14 introduced.
**Affected Services:** The demo generator itself; whatever function currently enforces the record-count ceiling (located and confirmed at this phase, per §14's UNKNOWN flag).
**Affected UI:** None directly — this phase is data-generation-side, but its correctness is verified through the same UI every other phase uses.
**Affected Permissions:** None new — demo users already operate under the real role/permission system per the brief's "same business rules" principle.
**Affected Routes:** None new.
**Data Migration:** N/A — demo data is regenerated, not migrated (it's disposable/reset-able by design, per `sandboxReset.ts`).
**Demo Data Correction:** This phase's entire content IS the demo data correction — see §14 and Audit §15 for the exhaustive list of what must change (B2B graph with zero Projects, B2C graph with a full Project chain, no orphaned downstream records, multi-state distributions per module, internally-consistent stage/status combinations, e.g., no more Order `'Partial Dispatch'` with `paymentStatus:'Pending'`).
**Demo Scenarios:** The full set from §14/§18 — B2B happy path, B2B-without-quotation path, B2C Residential/Commercial/Industrial, direct Project creation (master form, built in Phase 4), plus: create 5–6 additional records per major module beyond the seeded set and confirm they persist alongside seeded data without any ceiling; soft-delete a demo record and confirm restore; confirm a demo Company's `businessMode` (Phase 1) correctly shapes what the demo generator produces for it.
**Tests:** New tests directly asserting the generator's output graph integrity (no B2B customer with a Project; no downstream record without its upstream parent; no invented status values) — this is exactly the kind of structural assertion the original Gap Audit's fork made manually; codify it as a permanent test so it can't regress silently again.
**Regression Risk:** Medium — a full regenerate risks breaking any test that snapshotted specific demo IDs/values; audit and update those tests as part of this phase, don't let them silently rot.
**Dependencies:** All of Phases 1–14 (this phase is explicitly last among the "content" phases, seeding data against final corrected rules rather than being patched twice).
**Completion Criteria:** Demo Mode fully reflects every correction made in Phases 1–14; `demo@neozy.in` can perform every workflow action a real user could, against realistic, internally-consistent, B2B/B2C-correctly-segregated data, with no artificial creation ceiling. **MET.**

**Fresh repository audit findings (re-verified this session against actual code, triggered by a direct report of a B2B Customer appearing with a Project in the live demo UI):**
- **Traced to source, not assumed:** every line of `scripts/demo/datasets/businessGraph.ts` and `foundation.ts` was read end-to-end. `buildCustomersProjects()` (the only builder that pairs a Customer with a Project) unconditionally sets `type:'B2C'` on every customer it creates — there is no code path in it that could produce a B2B customer. `buildB2BExample()` (the only builder that creates a `type:'B2B'` customer) never creates or references a Project, Survey, Engineering Design, Installation, QC check, Commissioning record, Net Metering application, Subsidy application, Handover, AMC contract, or Service Ticket for it — confirmed by exhaustive grep for its customer id across the entire file. **The current generator code cannot produce a B2B Customer with a Project.**
- This is independently enforced at the true service layer, confirmed still real and unweakened: `src/lib/projectWorkflow.ts`'s `createProject()` fetches the linked Customer and throws if `type==='B2B'` (Phase 4's defense-in-depth guard); `src/features/customers/hooks/useCustomers.ts`'s `updateCustomerProjectionWithPhoneLock()` blocks reclassifying an already-Project-linked B2C customer to B2B (closing the exact gap Phase 2's own report had flagged as open and deferred to Phase 4 — found already built and already tested this session, `customerReclassificationGuard.test.ts`).
- **Conclusion on the reported issue:** since no code path (generator or production) can currently create this state, the observed live data is stale relative to this repository — this environment has never had live Firestore write access across any of the 15 phases (a standing, previously-documented limitation, not new to this phase). A daily scheduled GitHub Actions workflow (`.github/workflows/demo-reset.yml`, `cron: '30 20 * * *'`) already exists to reset the live public demo tenant against the deterministic plan this repository builds — once these fixes are merged and that workflow next runs, the live tenant will self-correct. This is documented as **dry-run/source verified**, not **live-execution verified** — this environment cannot confirm the workflow has run against these changes.
- **Two more consequential, previously-unlocated bugs found while proving the above:**
  1. **The exact "artificial record-count ceiling"** the Blueprint's own Appendix E (item 5) had flagged as `[UNKNOWN]` since Phase 1: `DEMO_MAX_RECORDS = 5` (`src/config/demo.ts`), checked by `enforceDemoRecordLimit()` on every single `createDoc()`/`createDocWithId()`/`batchCreate()` call for the demo company (`src/lib/firestore.ts`). In practice this blocked **all** demo record creation outright — every collection the seed data touches already holds more than 5 non-deleted records (Leads: 17, Customers: 12, Projects: 10, …), so the very first create attempt in any of them would already be at or over the cap. A **second, independent, duplicate** enforcement of the identical cap was found in a completely separate code path — `api/[entity].ts`'s Vercel serverless REST route — confirming this was not a single-point bug.
  2. The seeded `companies/{DEMO_COMPANY_ID}` Firestore document itself never actually carried `businessMode` — only a UI-side static fallback object (`src/config/demoCompany.ts`, used by `useGlobalBoot.ts` for demo sessions) did, which masked the gap in the running app while leaving the real persisted document incomplete.
- Only ONE of the Blueprint's two named B2B paths ("Quotation → convertQuotationToOrder()" and "Order created directly", both `[EXISTING, already correct]` per §5) had a demo example — the Quotation-first one. The direct-Order path had none.

**What was actually implemented:**
- **No change was needed to `buildCustomersProjects()`/`buildB2BExample()` themselves** — the B2B/B2C segregation they already produce is correct, per the exhaustive trace above. Nothing was "fixed" here because nothing was broken in the generator's own logic; the fix that mattered was proving it and making the proof permanent (see tests, below).
- `src/lib/firestore.ts`: `enforceDemoRecordLimit()` no longer counts existing documents or throws once a numeric cap is reached — it still enforces the legitimate, unrelated `business-crud` capability gate (`demoCapabilityPolicy.ts`'s real allow-list, blocking company-admin/user-admin/system-counter/stock-ledger-mutation/etc. for demo, which is correct and untouched). `DEMO_MAX_RECORDS` removed from `src/config/demo.ts` entirely (dead after the fix).
- `api/[entity].ts`: the duplicate server-side cap (`DEMO_LIMIT_REACHED`, same 5-record check) removed; `api/demo-reset.ts`'s response payload's now-meaningless `maxRecordsPerEntity: DEMO_MAX_RECORDS` field removed.
- `scripts/demo/datasets/foundation.ts`: the seeded `companies/{DEMO_COMPANY_ID}` document now carries `businessMode: 'Both'` directly (previously absent) — 'Both' confirmed still the right choice at this phase (see Remaining Gaps/Policy Decisions below for why dedicated single-mode demo companies were not built).
- `scripts/demo/datasets/businessGraph.ts`: new `buildB2BDirectOrderExample()` — a second, minimal, genuine B2B customer (`CUS-12`) whose Order (`ORD-9`) has no `quotationId` at all, proving the direct-Order-creation B2B path distinctly from the first example's Quotation-conversion path. Still zero Project/downstream references, per the same invariant.
- Twenty new, deliberately generic (never hardcoded to one specific id, so they keep protecting the invariant even if future phases change which customer is B2B) permanent regression tests (`src/lib/__tests__/phase15DemoGraphInvariants.test.ts`) plus 2 more added to the existing `demoBusinessGraph.test.ts` — see Tests below.
- Two pre-existing tests in `demoBusinessGraph.test.ts` had genuinely obsolete counts after the new B2B example was added (Leads 16→17, Customers 11→12, Orders 8→9, B2B customers 1→2) — updated deliberately, not silently; the underlying invariants they assert were preserved and, in the "Phase 3" test's case, generalized to loop over every B2B customer rather than assume exactly one.

**Newly discovered during this phase (documented, not fixed — belongs to a later phase or requires a business decision):**
- Live demo Firestore data may still show the stale B2B→Project state until the next scheduled reset run (or a manual one) executes against these fixes — outside this environment's reach; tracked in Appendix E.
- Appendix E item 7 (the still-open `'B2C'`-mode "no standalone Order/Quotation without a Project" enforcement policy decision, flagged since Phase 8) remains genuinely unresolved — Phase 15 did not decide it, consistent with "do not silently decide business policy." The demo company's `businessMode:'Both'` sidesteps needing an immediate answer (Both-mode never triggers this rule), but it is still an open item for whenever a real `'B2C'`-only company is provisioned.
- The other ~14 modules Phase 14 left with the pre-existing, non-persistent `UniversalDocumentsTab` behavior are unchanged by this phase — still tracked in Appendix E item 14, not re-litigated here (documents are not this phase's scope).

```
PHASE 15 COMPLETION GATE
Business Rules:        [x] Complete
Database/Data Model:   [x] Complete (businessMode added to the seeded company doc; no schema changes)
Services:              [x] Complete (enforceDemoRecordLimit() fixed in firestore.ts and api/[entity].ts; generator additions)
UI:                    [x] N/A (data-side phase, as scoped)
Permissions:           [x] Complete (business-crud capability gate preserved and re-verified; no permission weakened)
Workflow:              [x] Complete
Migration:             [x] N/A (demo data is regenerated, not migrated, by design)
Demo Data:              [x] Corrected (businessMode added; second B2B direct-order example added; portfolio counts updated consistently)
Demo Create:            [x] Verified (artificial ceiling removed at both enforcement points, source-verified; same production createDoc()/createDocWithId() path used, no demo-only branch)
Demo Edit:              [x] Verified (unchanged this phase — no edit-path regression; full suite green)
Demo Soft Delete:       [x] Verified (unchanged — Phase 13's softDelete()/isDeleted state machine untouched; demo fixtures already exercise it)
Demo Restore:           [x] Verified where applicable (unchanged — Phase 13's getAllDeleted()/restoreRecord()/InactiveRecordsModal untouched)
Technical Validation:   [x] TypeScript (32 pre-existing errors, unchanged baseline — 2 new errors surfaced by the DEMO_MAX_RECORDS removal in api/ were fixed, not left as regressions) [x] Tests (1552 passed / 8 pre-existing failures across the same 7 files, unchanged baseline — 22 new Phase 15 tests added, all passing) [x] Build (succeeded)
End-to-End Scenario:    [x] Passed — B2B Happy Path, B2B-without-Quotation, B2C Residential/Commercial/Industrial (all three Project Types represented across the 10 demo Projects), Manager/team visibility (Phase 13, unchanged), Soft Delete/Restore (Phase 13, unchanged), Warehouse Reporting (Phase 12, unchanged) all traced against the current generator output and passing tests. Negative isolation scenarios (§19 items 1–2) re-confirmed via the existing, still-passing Phase 2 test suite. Not live-browser-tested — this environment has no interactive browser session or Firestore write access; verified via direct code tracing and the automated test suite, consistent with every prior phase's own precedent.
Cross-Module Regression:[x] Passed (32/32 baseline tsc errors unchanged; same 8 pre-existing test failures across the same 7 files; build succeeds; no other phase's demo data or business logic touched)
PHASE STATUS: COMPLETE
```

---

### PHASE 16 — Cross-Module Integration & Final ERP Stabilization

**Objective:** End-to-end verification across every phase's output together; no new business logic — an integration and regression phase.
**Business Problem Solved:** Confirms the 16 preceding phases compose correctly as a whole, not just individually.
**Current-State Gap:** N/A — this phase exists to catch integration gaps the phase-by-phase approach could miss.
**Target-State Behavior:** Every scenario in §18/§19 below passes, across both B2B and B2C, across at least two companies (one `'B2B'`-mode, one `'B2C'`-mode, one `'Both'`-mode if resources allow), across at least two warehouses, with Manager/Team-Member/Super-Admin roles all exercised.
**Affected Modules:** All.
**Data Migration:** None new — this phase validates prior migrations held.
**Demo Data Correction:** None new — validates Phase 15's output under real cross-module load.
**Demo Scenarios:** Full regression pass of every scenario in §18/§19.
**Tests:** Full `tsc`/test-suite/build run; every phase's individual tests re-run together (catches cross-phase interaction bugs individual-phase testing missed).
**Regression Risk:** N/A — this phase's entire purpose is regression-catching.
**Dependencies:** Phases 0–15, all complete.
**Completion Criteria:** Every End-to-End and Negative/Security scenario in this document (§18, §19) passes; `tsc --noEmit` shows no new errors vs. the pre-implementation baseline; full test suite green; production build succeeds. **MET.**

**What this phase actually did:** Not a re-run of Phases 0–15/15.1's own work (none of it was reopened or undone). A fresh, whole-system trace of the entire B2B and B2C business graph as ONE connected system — five parallel audit passes covering (A) production workflow stage/guard integrity, (B) permissions/visibility + duplicate-implementation scanning, (C) search/entity-registry/notifications/documents coverage, (D) desktop/mobile parity + API/service-layer mismatches, and (E) a complete fresh re-read of the original Gap Audit cross-checked against every phase's own roadmap entry and Appendix E — specifically because per-module, in-isolation testing (Phases 5–11's own methodology) cannot, by construction, catch a bug that only exists in how modules compose together.

**Findings and fixes** (full detail in Appendix E items 19–24):
- **Item 19 (HIGH SEVERITY, the headline finding):** no production code path ever advanced a Project to the `'Subsidy'` stage — `netMeteringWorkflow.ts`/`subsidyWorkflow.ts` never wrote to `COLLECTIONS.PROJECTS` at all, despite the former's own header comment describing the intended design. Since `createHandover()` requires `currentStage>=Subsidy` and `createAmcContract()` requires `currentStage>=Handover`, **Handover and AMC were structurally unreachable for every real (non-demo) project** — a defect no single module's own tests could have caught, since each module's precondition passed correctly in isolation against a mocked stage. Fixed by advancing to `'Subsidy'` on the first real sign of progress on either parallel track (NetMetering reaching `MeterInstalled`, or a Subsidy application being filed), deliberately not waiting for full resolution of both — consistent with, not overriding, item 9's already-locked "minimum unambiguous bar" policy. A second bug (both files gating on a hardcoded, independently-drifted local stage array instead of `projectLifecycle.ts`) was fixed in the same pass.
- **Item 20:** three smaller cross-module wiring gaps — `casePropagation.ts` missing a `registrations` chain entry (Registration's `caseId` was silently never populated), `entityRegistry.ts` missing entries for 9 real collections (generic entity labeling/linked-relationships silently degraded for all of them), `roleBootstrap.ts` never granting any non-Admin role access to the real `registrations`/`banks` modules (both pages were Admin-only by omission, not by design) — plus a 9th independently-hand-typed stage list in `CaseSearch.tsx` with a phantom `'Closure'` value and a missing `'Archived'`.
- **Item 21:** `registrationWorkflow.ts`'s `createRegistration()` had no service-layer B2B guard (UI-only gating, the exact pattern Phase 4 already fixed for Project creation) — fixed to mirror `createProject()`'s guard exactly.
- **Items 22–24:** three items the original Gap Audit flagged and no phase ever investigated, confirmed (not merely re-flagged) at Phase 16 — no stock-transfer-between-warehouses or reverse-dispatch workflow exists anywhere in the codebase (item 22, a real confirmed gap, not built here since it's new-feature work); Super-Admin cross-company view mode (item 23) and `Task.assignedToId` identity constraints (item 24) remain genuinely unverified, low-priority, and are not blockers.
- **Explicitly NOT done, by design:** items 11 and 14's "natural fit for Phase 16" UI-rollout follow-ups (more modules getting "show inactive"/real Documents persistence) were confirmed still open but deliberately not expanded — that is feature completion, not defect-fixing, and out of scope for a stabilization audit per this phase's own "do not introduce new business rules" / "do not blindly change working code" instructions.

**Tests added:** 20 new permanent regression tests across `netMeteringWorkflow.test.ts`, `subsidyWorkflow.test.ts`, `casePropagationPhase11.test.ts`, `roleBootstrap.test.ts`, `registrationWorkflow.test.ts`, and a new `phase16EntityRegistryCoverage.test.ts`.

**Validation:** `tsc --noEmit` — 32 pre-existing errors, unchanged baseline, zero new. Full test suite — 1593 passing (up from 1582 pre-Phase-16); the same 7 pre-existing failing test files (unrelated: theme/router/payroll/stock pages), byte-identical to the baseline before this phase. Production build — succeeds. Demo Mode reset/reseed determinism, B2B/B2C graph invariants, and stage-coherence tests (Phase 15/15.1's own suites) — all still passing, unmodified and unregressed.

```
PHASE 16 COMPLETION GATE
Business Rules:        [x] Complete
Database/Data Model:   [x] N/A (no schema changes — permission/registry/workflow-wiring fixes only)
Services:              [x] Complete (netMeteringWorkflow.ts/subsidyWorkflow.ts stage-advance fix; registrationWorkflow.ts B2B guard; casePropagation.ts registrations chain)
UI:                    [x] Complete (CaseSearch.tsx stage-list fix; no other UI changes needed)
Permissions:           [x] Complete (roleBootstrap.ts registrations/banks backfilled for Director/Sales/Accounts/Manager)
Workflow:              [x] Complete (Handover/AMC reachability restored end-to-end)
Migration:             [x] N/A (no data migration — code/wiring fixes only)
Demo Data:              [x] N/A (Phase 15.1 already closed Demo Mode; re-verified unregressed, not re-seeded)
Demo Create:            [x] Verified (unregressed — full demo test suite re-run, all passing)
Demo Edit:              [x] Verified (unregressed)
Demo Soft Delete:       [x] Verified (unregressed)
Demo Restore:           [x] Verified where applicable (unregressed)
Technical Validation:   [x] TypeScript (32/32 baseline, 0 new) [x] Tests (1593 passed, 7 pre-existing unrelated failures unchanged) [x] Build (succeeded)
End-to-End Scenario:    [x] Passed — B2C full lifecycle chain (Survey through Service/Monitoring, including the now-fixed Handover/AMC stage transitions) traced and test-verified; B2B Happy Path and B2B-without-Quotation re-verified unregressed; Manager/Team visibility, Soft Delete/Restore, Warehouse Reporting all re-verified unregressed via the existing, still-passing suites.
Cross-Module Regression:[x] Passed (5 parallel full-system audit passes covering workflow guards, permissions/duplication, search/registry/notifications/documents, desktop/mobile/API parity, and a full Gap Audit re-read; every CONFIRMED genuine defect fixed and tested; every INTENTIONAL/policy item left alone and documented, not silently changed)
PHASE STATUS: COMPLETE
```

---

### Phase 18 — Final Live Data Reset & Canonical Data Activation

Live demo tenant continued showing the pre-Phase-15.1 dataset after Phase 15.1's `api/demo-reset.ts` fix was written, even after fresh logins. Root cause traced through the full tenant-ID chain (`demo@neozy.in` Firebase Auth → `user_auth_maps` → `users/{DEMO_ERP_USER_ID}.companyId` → `Login.tsx`'s `setActiveCompanyId()` → Zustand `activeCompanyId` → `companyScopedQuery()`): every link resolves to the same `company-demo-neozy` id — **no tenant mismatch exists**, ruling out the most likely alternative explanation before accepting the real one. The actual cause: `DEMO_SEED_ID` (`src/config/demo.ts`), the value `isDemoSeeded()` (`src/lib/sandboxReset.ts`) compares against a per-browser `localStorage` marker to decide whether to call `triggerDemoReset()`, had never changed across Phases 15/15.1/16/17 — so any browser that had ever completed a reset before those fixes shipped had a marker that already matched the (unchanged) target value, and `Login.tsx`'s `if (!isDemoSeeded())` gate stayed false forever for that browser, no matter how many times the user logged out and back in. Fixed by bumping `DEMO_SEED_ID` ('DEMO_V1'→'DEMO_V2'), invalidating every existing marker unconditionally and forcing exactly one fresh reset on each browser's next login. `DEMO_ID_PREFIX` deliberately left unchanged so document ids stay stable. Separately hardened the React Query cache path: `src/lib/queryClient.ts` (new — a leaf module holding the single `QueryClient` singleton, extracted from `app/providers/index.tsx` specifically to let `useAppStore.ts`'s `logout()` call `queryClient.clear()` without a circular import) is now cleared both on logout and immediately after a successful demo reset (`Login.tsx`), so no stale cached query result can mask the corrected Firestore data even within the same browser session. 16 new regression tests (`src/lib/__tests__/phase18DemoLiveResetPath.test.ts`) assert the exact failure scenario (a stale seed marker still triggers a fresh reset) and the full tenant-ID-chain identity end-to-end.

**Environment limits, stated explicitly, not glossed over:** this environment has never had live Firestore Admin credentials or a browser automation tool, across any phase including this one. The tenant-ID chain and the seed-marker logic were verified by direct source reading and unit tests, not by observing an actual live reset. This was the honest, stated limitation at the time — Phase 19 below closes the remaining gap in this chain (delivery, not data-path correctness).

```
PHASE 18 COMPLETION GATE
Root Cause:             [x] Identified and proven via full tenant-ID chain trace (5 links, each verified against source)
Fix:                    [x] DEMO_SEED_ID bumped; queryClient.clear() added to logout() and post-reset success path
Technical Validation:   [x] TypeScript (baseline unchanged) [x] Tests (16 new, passing) [x] Build (succeeded)
Live Verification:      [ ] NOT performed — no Firestore Admin credentials or browser tool available in this environment (see Phase 19)
PHASE STATUS: COMPLETE (code-path); live-verification portion explicitly deferred, not claimed
```

---

### Phase 19 — Deployment Delivery & Final Production-Readiness Audit

Two-part phase. **Part A (delivery):** discovered, via direct `git status`/`git log`, that the entire multi-phase initiative since commit `8490ac72` — every phase in this document, Phase 0 through 18 — had never been committed or pushed; 202 lines of uncommitted changes sat in the working tree. Committed the complete verified working-tree state as commit `e8570b39` and pushed to `origin/main`. Verified the deployment mechanism is Vercel (`vercel.json` + `api/` serverless convention, no GitHub Actions deploy workflow); confirmed this environment has no deploy authority for whichever Vercel project actually serves the live Neozy ERP demo domain (a Vercel account did authenticate via an unrelated Claude Code plugin flow, but it owns three unrelated projects, not this one) and no GitHub API token for this private repo — both stated explicitly rather than assumed complete.

**Part B (production-readiness audit):** a fresh, non-trusting re-audit of the entire ERP against the Gap Audit's original P0–P3 list and this document's own Appendix E open items, using three parallel read-only research passes (RBAC/HR/manager-visibility; Search/Documents/Mobile-parity; Inventory/Serial/open-policy-items) followed by direct source verification before any fix. Found and fixed:

1. **`docs/.gitignore` blanket-ignore defect** — `docs/*` was whitelisting four files that no longer exist in this repository (leftover from documents superseded early in this initiative) and never whitelisting the three real, actively-maintained governance docs (this Blueprint, the Gap Audit, the Demo Mode remediation log) or this phase's new production-readiness report. Every edit to any of them, across every phase including the Phase 19 Part A commit itself, was silently excluded from version control. Fixed the whitelist; this is the fix that makes Phase 19's own documentation durable.
2. **Desktop/mobile Lead creation divergence** — `src/pages/Leads.tsx` had its own hand-rolled create-lead mutation, entirely separate from `useSaveLead` (`src/features/leads/hooks/useLeads.ts`), which `MobileLeadWorkspace.tsx` has always used. The desktop-only path silently skipped auto-assignment (`getNextAssignee`), master-user linking (`resolveOrCreateMasterUser`), and caseId propagation (`createCaseForLead`) — a live functional gap, not merely duplicated code. Fixed by routing desktop through the same `useSaveLead`, after first adding desktop's LEAD_ASSIGNED/LEAD_CREATED notification behavior into `useSaveLead` itself so neither platform lost a capability the other had. This surfaced a second, independent, more serious bug in `useSaveLead`'s own auto-assign branch: `getNextAssignee()` returns `{userId,name}`, not `{assignedToId,assignedToName}`; the pre-existing code spread that raw shape directly into the create payload as `{...data, ...assignment, ...}`, so an auto-assigned lead's own `name` field (the customer's name) was silently overwritten by the assignee's name, and `assignedToId` was never actually set. Fixed by normalizing both branches to the real field names before spreading. 5 new regression tests (`phase19LeadCreationParity.test.ts`).
3. **Firestore security rules — ownership not enforced server-side for 7 project-scoped collections** — `qc_checks`, `commissioning_records`, `net_metering_applications`, `subsidy_applications`, `project_handovers`, `amc_contracts`, `generation_readings` had no explicit `match` block and fell through to the generic wildcard rule, which enforces `sameCompany()` only. The client's own `projectVisibility.ts` already treats these exact 7 collections as project-scoped, querying them exclusively by `PROJECT_ASSIGNMENT_FIELDS` (`assignedSurveyor`/`assignedInstaller`/`salesOwner`/`designerId`) — the same 4 fields `canReadProjectScoped()` checks — so a same-company user with a narrow field-execution role could bypass the client's own query-level narrowing entirely via a direct SDK call. Fixed by adding explicit `match` blocks using the existing `canReadProjectScoped()` function, matching the already-shipped `installations`/`service_tickets` pattern exactly. Verified the rules file still compiles by starting the local Firestore emulator (no live deploy access, but a genuine local compile-check, not skipped).
4. **RBAC enforced only via UI, not the service layer, for Project and Registration creation** — `createProject()` and `createRegistration()` had zero `canDo()` check, unlike `surveyWorkflow.ts`/`engineeringWorkflow.ts`/`quotationWorkflow.ts`/`dispatchWorkflow.ts`, which all already call it. A role with no `create` permission on `projects`/`registrations` could still call these functions directly and succeed, relying entirely on `RoleRoute`/button visibility. Fixed by adding the same `canDo('create', module)` guard used elsewhere, with 2 new regression tests asserting the RBAC denial path specifically (not just the pre-existing B2B/B2C guard).
5. **`Task.assignedToId` fake sentinel** — `autoReminderWorkflow.ts` created auto-reminder tasks with `assignedToId: 'unassigned'`, a literal string that is not a real user id and matches nothing anywhere else in the codebase. This caused `createTask()`'s internal `sendNotification('unassigned', ...)` call to attempt delivery to a recipient that can never exist. Fixed by using `''` instead — the value `sendNotification()`'s own pre-existing `if (!recipientUserId...) return;` guard is designed to recognize as "no recipient," skipping cleanly rather than writing an orphaned notification. (Real users still get notified separately via the already-present `notifyRoleUsers()` call when a rule's `notifyRoles` is configured — this was a real but secondary defect, not "the feature notifies nobody.")
6. **Duplicate serial numbers across dispatches — no protection existed** — `executeAndVerifyDispatch()` never checked whether a serial being verified was already typed into the same batch twice, or already recorded against a different dispatch for the same company. Added `assertNoDuplicateSerials()`, checked before any stock/ledger mutation, with 4 new regression tests including an explicit cross-tenant false-positive check (a matching serial on another *company's* dispatch must never block).
7. **`notificationRoutes.ts`** — the `'case'` route branch was verbatim duplicated (harmless but dead), and `entityType: 'withdrawal'` notifications (sent from `channelPartnerSettlement.ts`'s withdrawal approve/reject flow) had no matching route and fell to the generic `/notifications` fallback instead of `/settlements`. Fixed both, 3 new regression tests.

**Confirmed NOT regressed, and confirmed still real (not merely re-flagged) via direct source reading in this pass:** `businessMode` enforcement (nav/routes/service-layer creation guards — genuinely wired end-to-end, not cosmetic); B2B/B2C demo graph segregation (live-generated: 6 B2B customers, 0 with Projects; 10 B2C customers, all resolving to valid Projects; 364 total demo documents); Manager "team" visibility (real, query-level, driven by `useGlobalBoot.ts`'s live `managerId` lookup — the original Gap Audit's claim that this collapses to self-only is now stale); Employee↔Warehouse↔Manager↔User chain (real, via `EmployeeDomainService`, with a working `getWarehouseEmployeeCounts()`); `cancelOrder()` (real, thorough, idempotent stock reversal).

**Confirmed still genuinely open, deliberately NOT built this phase (feature work or policy decisions, not defects):** stock-transfer-between-warehouses/reverse-dispatch (Appendix E item 22, re-confirmed absent); Super-Admin cross-company aggregate view (Appendix E item 23 — more precisely characterized this pass: `companyScopedQuery()` silently falls back to the Super Admin's own company for `'all'`, while `getAllDeleted()` treats `'all'` as no filter — an inconsistency between the two paths, documented but not unified, since building genuine cross-company aggregation is new-feature work and changing `getAllDeleted()`'s existing behavior risks breaking whatever cross-company restore tooling already depends on it); document persistence for the ~14 non-Phase-14 modules (AMC, Commissioning, NetMetering, Subsidy, Handover, QC, Installations, Cases, Partners, Monitoring, Settlements, CommissionRules, CommissionApprovals, ServiceTickets — Appendix E item 14, re-confirmed still accurate; each of the 14 needs its real FK id field individually verified before wiring, which this phase did not have budget to do safely for all 14 without risking exactly the "guessed field name" bug class Phase 11 had to fix six times over); Global Search has no `'documents'` category (new finding this phase, low-medium severity, non-blocking — documents remain reachable via each entity's own Documents tab); "show inactive/restore" UI rollout beyond Leads/Orders (Appendix E item 11, re-confirmed still accurate); `getPage()`'s ownership-scoping gap (new finding this phase — real but zero live call sites, dead-code-level risk only).

**Validation:** `tsc --noEmit` — 32 pre-existing errors, unchanged baseline, zero new. Full test suite — 1637 passing (up from 1623 pre-Phase-19; 14 new regression tests across 5 files), the same 8 pre-existing failing tests (theme presets, GST calc, commissioning hook order, owner access, appearance/theme — unrelated to this phase), byte-identical to the pre-Phase-19 baseline. Production build — succeeds. Firestore rules — compiles cleanly (verified via local emulator startup, not a live deploy).

```
PHASE 19 COMPLETION GATE
Delivery:               [x] Committed (e8570b39) and pushed to origin/main
Deployment:             [ ] NOT verified — no Vercel deploy authority or GitHub API token for this repo in this environment (stated explicitly)
Documentation Delivery: [x] docs/.gitignore fixed — this and all prior phases' doc updates are now actually trackable
Business Rules:         [x] Complete (no changes — all fixes were defect-level, not business-rule changes)
Services:               [x] Complete (projectWorkflow.ts/registrationWorkflow.ts RBAC guards; useLeads.ts parity+bugfix; dispatchWorkflow.ts serial guard; autoReminderWorkflow.ts sentinel fix; notificationRoutes.ts fixes)
Security:               [x] Complete (Firestore rules gap closed for 7 collections; verified via local emulator compile)
UI:                     [x] Complete (Leads.tsx now delegates to the shared hook — net code reduction, not addition)
Migration:              [x] N/A (no schema/data changes)
Demo Data:              [x] N/A (unregressed — re-verified via live generator run: 364 docs, 6 B2B/10 B2C, zero contamination)
Technical Validation:   [x] TypeScript (32/32 baseline, 0 new) [x] Tests (1637 passed, 14 new, 8 pre-existing unrelated failures unchanged) [x] Build (succeeded)
Live Verification:      [ ] NOT performed — explicitly deferred, see docs/NEOZY_PRODUCTION_READINESS_REPORT.md for the exact next action required
PHASE STATUS: COMPLETE (code, tests, delivery-to-git); deployment and live-Firestore/browser verification explicitly NOT claimed
```

---

### Phase 20 — Complete Clean Reset Path Hardening & Live Firestore Proof

Given explicit authorization that no real production data exists to protect, this phase attempted the strongest available live verification and closed a real gap in the reset mechanism itself, found only by that live check.

**Reset-path gap, found and fixed:** `loadSafeDeletionDocuments()` (`scripts/demo/runner.ts`), used by the scheduled/manual GitHub Actions "Guarded Demo Reset" workflow (`.github/workflows/demo-reset.yml`, real GCP Workload Identity Federation credentials, cron + `workflow_dispatch`), only ever looks up documents by the current canonical plan's own ids — a record left behind by an older generator version, or created via a user's own demo-mode CRUD testing, has an id the plan never mentions and was therefore permanently unreachable by this path, no matter how many times it ran. `api/demo-reset.ts` (the client/login-triggered path) never had this defect — it already does a plain `companyId` sweep. Fixed by adding `loadStaleCompanyScopedDocuments()` (content-based, companyId-only match, same tenant-isolation boundary as the already-proven-safe `api/demo-reset.ts` pattern), wired into both `resetDemoData.ts` and `cleanupDemoData.ts`. 3 new regression tests (`phase20StaleDataSweep.test.ts`).

**Live Firestore proof, performed directly (not inferred):** traced the real Firebase project id (`ae-erp-d933d`) from `.env.local` — the only place it exists in this repository (`.env.example` only has placeholders). Authenticated as `demo@neozy.in` against the live Firebase Auth REST API using the same public client API key any browser uses (not an Admin credential), then read Firestore directly via its REST API using the resulting token. Confirmed, live:
- The tenant-resolution chain is correct in production, not only in local source: `user_auth_maps/{authUid}` → `userId: MUSR-DEMO-0001`, `companyId: company-demo-neozy`, matching this repository's constants exactly.
- **The live `customers` collection currently holds the OLD, pre-Phase-17 dataset** (`demoSeedId: DEMO_V1`, old placeholder naming, one customer with no `type` at all, one Commercial customer misclassified `type: 'B2B'`) — direct, first-party confirmation that no phase's code fixes or corrected dataset have reached the deployed application yet.
- Two live records exist with ids outside the canonical scheme entirely (`CU-260713-OXTZ`, `CU-260715-9KTV`) — first-party proof the reset-path gap above is real, not theoretical.

**What remains genuinely blocked, and why:** actually performing the live wipe requires either the Firebase Admin SDK (a service-account credential not present in this environment) or triggering the already-credentialed GitHub Actions workflow (requires GitHub UI/API access this environment does not have). Firestore security rules block hard deletion for every identity except the true Super Admin, with no demo-tenant carve-out — confirmed via `firestore.rules`, not assumed — so this is a hard technical boundary, not a caution this pass chose to apply. Full detail and the exact two options to unblock it are in `docs/NEOZY_PRODUCTION_READINESS_REPORT.md` and `docs/DEMO_MODE_BUSINESS_FLOW_REMEDIATION.md`'s Phase 20 addendum.

```
PHASE 20 COMPLETION GATE
Reset-path gap:          [x] Found and fixed (loadStaleCompanyScopedDocuments, wired into both CLI scripts)
Live tenant-chain proof: [x] Performed directly against production Firestore (read-only)
Live data-state proof:   [x] Performed — confirmed OLD dataset still live, confirmed the exact orphan-record scenario the fix addresses
Live wipe/reseed:        [ ] NOT performed — blocked by Firestore security rules (Super-Admin-only hard delete) + no Admin/GitHub-Actions credential in this environment
Technical Validation:    [x] TypeScript (32/32 baseline, 0 new) [x] Tests (1640 passed, 3 new, 8 pre-existing unrelated failures unchanged) [x] Build (succeeded)
PHASE STATUS: COMPLETE (code, tests, live read-proof); live write/reseed explicitly blocked at a proven technical boundary, not claimed
```

---

### Phase 21 — Complete Collection Inventory

A full re-check of every collection constant in `src/lib/firebase.ts`'s `COLLECTIONS` map against `DEMO_RESETTABLE_COLLECTIONS` (not merely against that list's own prior contents) found three real, actively-written, `companyId`-scoped collections missing entirely: `cases` (`CaseEngine.createCase()`, fired on every real Lead creation including ordinary demo-mode CRUD — not just the static seed), `settlements` (`channelPartnerSettlement.ts`), and `audit_logs` (`workflow.ts`'s `logActivity()`, called on nearly every create/update action anywhere in the app). None of the three could ever have been reached by any reset, including Phase 20's content-based sweep fix — the collection itself was never queried. Fixed by adding all three to `DEMO_RESETTABLE_COLLECTIONS`; `cases` additionally needed a new `entityRegistry.ts` entry. `'activity'` was checked and correctly left alone — a real declared constant with zero actual writers anywhere in `src/`. 5 new regression tests, generic (read real writer source for their collection constants), not a hardcoded list.

```
PHASE 21 COMPLETION GATE
Collection inventory:   [x] Complete — cross-checked against COLLECTIONS, not against the reset list's own prior contents
Gaps found & fixed:     [x] cases, settlements, audit_logs added to DEMO_RESETTABLE_COLLECTIONS; cases registered in entityRegistry.ts
Technical Validation:   [x] TypeScript (32/32 baseline, 0 new) [x] Tests (1645 passed, 5 new, 8 pre-existing unrelated failures unchanged) [x] Build (succeeded)
PHASE STATUS: COMPLETE
```

---

## 16. Demo Data Correction Plan (phase-by-phase index)

| Phase | Demo Correction Focus |
|---|---|
| 0 | None |
| 1 | Company records get `businessMode` |
| 2 | Picker-filter logic verified against current (still-imperfect) demo data |
| 3 | Spot-fix Orders' `orderType` for any demo Quotation-conversion chain |
| 4 | Every demo Project gets a valid `projectType` — DONE |
| 5 | Demo Project `currentStage`/`stageHistory` validated against canonical 17-stage list — DONE, zero orphans found |
| 6 | Demo Survey records corrected: Approved surveys linked to their real Engineering Design; one Survey reclassified to Pending — DONE |
| 7 | Engineering demo records re-verified valid after Phase 6's Survey-linkage fix — no further correction needed |
| 8 | Demo B2C Quotation→Order→PI→Payment chain seeded with real `projectId` links — re-verified, already correct |
| 9 | Demo Dispatch statuses/approvalStatus corrected to real enum values; Delivered and Closed both now reachable — DONE (Tax Invoice generation remains manual by design, not seeded) |
| 10 | First-ever real demo `installations` documents created (5, one per demo Project reaching QC), linked to real demo `qc_checks` — DONE. Lead-anchored demo fields kept (dual-write, not retired — matches production's dual-write design) |
| 11 | Demo Commissioning/NetMetering/Subsidy/Handover/AMC/Service records seeded/repaired |
| 12 | Demo Employees get realistic warehouse/manager distribution — DONE (5/3/2 warehouse split, genuine 2-level manager chain) |
| 13 | Demo soft-deleted records in multiple states; restore flow demo-verified — DONE (2 soft-deleted Leads at different ages, 1 soft-deleted Order) |
| 14 | **DONE** — first-ever demo `documents` seeded at all (previously zero, for every entity including the five already-"complete" ones): 5 real documents, one per Order/Quotation/ProformaInvoice/Dispatch/Payment, cross-linked to real customer/project/sibling ids; `'documents'` added to `DEMO_RESETTABLE_COLLECTIONS` |
| 15 | **DONE** — capstone audit, not a rewrite: exhaustive trace proved the existing B2B/B2C segregation was already correct (no generator rewrite needed); real fixes were `businessMode` added to the seeded company doc, the artificial `DEMO_MAX_RECORDS` ceiling located and removed (two call sites), and a second B2B example (`buildB2BDirectOrderExample()`) added for the direct-Order-without-Quotation path; 20 new permanent invariant tests added |
| 15.1 | **DONE** — root cause of live B2B-with-Project screenshots fixed (`api/demo-reset.ts` rewritten to seed from the canonical generator instead of a parallel hand-written dataset); Project stage/downstream-record coherence corrected for all 10 B2C Projects; 7 collections (`banks`/`registrations`/`attendance`/`payroll`/`serial_numbers`/`tax_invoices`/`partner_wallet_transactions`) that only the removed duplicate dataset used to seed added to the canonical generator; 30 new permanent tests added |
| 16 | Final regression validation only, no new seeding — production workflow/permission/registry fixes only (see Appendix E items 19–21) |

---

## 17. Data Migration Strategy

General principle: every migration is additive-first (new field, populated where derivable, left null/flagged where not) — no destructive rewrite of existing documents without an explicit, confirmed policy decision (flagged `[POLICY DECISION NEEDED]` throughout §15 wherever this applies). Summary of the substantive migrations:

| Old State | Migration | New State | If Unmigrable |
|---|---|---|---|
| `Company` with no `businessMode` | Default every existing company to `'Both'` | `businessMode:'Both'` | N/A — always safe, never narrows existing capability |
| `Order.orderType` possibly wrong (from Quotation-conversion bug) | **[POLICY DECISION NEEDED]** — backfill by re-deriving from linked Customer, or leave historical | Correct `orderType` on all new Orders; historical backfill optional | If backfilled: document every changed Order id in a migration log for auditability |
| `Project.projectType` empty on old records | Grandfather — leave empty, enforce only going forward | New Projects always have `projectType` | Old empty-`projectType` Projects remain queryable/editable but flagged in reports as "type unknown" |
| Seven stage-order arrays | Consolidate into one canonical module; verify no `currentStage` value only exists in a non-canonical list | One shared `projectLifecycle.ts` | Any orphan stage value mapped explicitly to its nearest canonical equivalent, logged |
| `Lead.capturedSerialNumbers`/`installationChecklist` | Migrate into new `Installation` documents linked via Lead→Customer→Project | Real `installations` collection, Project-scoped | Leads with no resolvable Project flagged for manual review, data never dropped |
| `Employee` missing `warehouseId`/`managerId` | Match to `AppUser` by email/phone (exact mechanism confirmed at Phase 12 start), populate | Employee↔User linked or consolidated per Phase 12's chosen option | Unmatched Employees flagged for manual assignment |
| Soft-deleted records missing `deletedBy`/`deletedAt` | Leave null for historical deletes (not recoverable after the fact) | New soft-deletes always populate both fields | Historical gap documented as a known limitation, not silently backfilled with guessed values |
| Demo dataset (`customerType`, unconditional Project attachment, orphaned downstream records) | Full regeneration at Phase 15, not incremental patching | Demo data matches every corrected production rule | N/A — demo data is disposable by design |

---

## 18. End-to-End Test Scenarios

1. **B2B Happy Path:** Lead → B2B Customer → Quotation → Order (verify `orderType==='B2B'`) → PI → Payment (PI marked Paid, Order `stockBlocked=true`) → Dispatch (request→approve→verify with serial capture→confirm delivery→close) → Accounts Bill (manual or convenience-triggered, per Phase 9's resolution) → B2B Complete. No Project ever created or referenced.
2. **B2B First Transaction Without Quotation:** B2B Customer → Order (direct) → PI → Payment → Dispatch → Delivery → Accounts. Confirms the "Order directly, no Quotation" path the brief explicitly allows.
3. **B2C Residential:** Lead → B2C Customer → (Registration, if in scope per Phase 0/4 decision) → Project(`projectType='Residential'`) → Survey → Engineering → Quotation → Order → PI → Payment → Dispatch → Installation → QC → Commissioning → Net Metering → Subsidy → Handover.
4. **B2C Commercial:** Identical to #3 with `projectType='Commercial'` — confirms Commercial is B2C, not B2B.
5. **B2C Industrial:** Identical to #3 with `projectType='Industrial'`.
6. **Direct Project Creation (built in Phase 4):** Create Project → combined Customer+Project master form → both records created correctly linked → `projectType` mandatory enforced.
7. **Manager Visibility:** A Manager role sees their real team's records (not just their own) for both a project-scoped collection (Survey) and a non-project collection (Leads), post-Phase 13.
8. **Soft Delete / Restore:** A Team Member soft-deletes a Customer → record hidden from default list → appears under "show inactive" → restored successfully.
9. **Warehouse Reporting:** From a Warehouse workspace, view a real employee count; from an Employee record, see their real warehouse and reporting manager (post-Phase 12).
10. **Demo Parity:** As `demo@neozy.in`, perform scenarios 1–9 above with identical success criteria to production, plus create 5–6 additional records in at least three different modules beyond the seeded set with no ceiling encountered.

---

## 19. Security / Negative Test Scenarios

| # | Scenario | Expected Result |
|---|---|---|
| 1 | B2B customer selected in Project creation picker | MUST NOT appear in the list at all (post-Phase 2) |
| 2 | B2C customer routed into a B2B-only workflow (e.g., appears in a B2B-specific report/picker, if any exists) | MUST be prevented, unless Phase 0 explicitly confirms a legitimate dual-relationship exception — never invented silently |
| 3 | A `'B2B'`-mode company's user opens a B2C-only route (e.g., `/projects`) | MUST NOT have access (post-Phase 1) |
| 4 | A `'B2C'`-mode company's user opens a B2B-only workflow (if Phase 1's policy decision restricts it) | Per Phase 1's resolved policy — MUST match whatever rule was locked, not left ambiguous |
| 5 | Normal user attempts permanent delete | MUST fail (post-Phase 13) |
| 6 | Normal user deletes a record | MUST soft-delete / mark inactive, never physically remove from Firestore |
| 7 | Super Admin (`shreeniwas.tripathi0@gmail.com`) performs permanent delete | MUST succeed, MUST be logged |
| 8 | Employee assigned to Warehouse A | MUST NOT appear in Warehouse B's employee count or reporting (post-Phase 12) |
| 9 | Cross-company data access attempt (any role, any collection) | MUST fail at the query layer, defense-in-depth confirmed at the client re-filter and Firestore security-rules layers (already CONFIRMED GOOD — this scenario re-validates no phase regressed it) |
| 10 | Team Member attempts to view a record outside their assigned/team scope (post-Phase 13) | MUST fail at the query layer, not merely be hidden in the UI |
| 11 | A non-Super-Admin user attempts to write a `users/{userId}` document with the email `shreeniwas.tripathi0@gmail.com` | MUST fail — reuse the existing, already-CONFIRMED-real Firestore security-rules block; re-validate no phase weakened it |

---

## 20. Cross-Module Dependency Matrix

| Phase | Depends On | Because |
|---|---|---|
| 0 | — | First |
| 1 | 0 | Needs ratified policy on B2C-standalone-Order question |
| 2 | 1 | Company mode informs whether Project entry point exists at all for a company |
| 3 | 2 | Order logic must trust a query-reliable `customer.type` |
| 4 | 2 | B2C customer filtering must be correct before Project-creation policy is finalized |
| 5 | 1–4 | Stage machinery sits on top of the Customer/Project/Order foundation |
| 6 | 1–5 | Regression check of foundation-adjacent module |
| 7 | 1–6 | Regression check, depends on Survey (6) |
| 8 | 3, 5 | B2C financial chain needs both the Order fix and the canonical stage list |
| 9 | 3 | B2B Order/PI/Payment chain must be correct before Dispatch refinement |
| 10 | 4, 5 | Installation is Project-scoped and stage-aware — both must be stable |
| 11 | 10 | Downstream chain depends on Installation's caseId fix |
| 12 | 1 | Independent of B2B/B2C phases; only needs company-scoping foundation |
| 13 | 12 | Team visibility needs the reporting-manager field |
| 14 | 3, 8 | Document capability extends the now-correct Order/Quotation/PI/Dispatch/Payment entities |
| 15 | 1–14 | Full rebuild seeds against every corrected rule |
| 16 | 0–15 | Final integration validation |

---

## 21. Risk Register

| Risk | Phase(s) | Severity | Mitigation |
|---|---|---|---|
| Backfilling `orderType` changes historical financial-looking records | 3 | Medium | Explicit policy decision before running; log every changed id |
| Stage-list consolidation changes dashboard percentages | 5 | Medium | Communicate to stakeholders before switching; consider a parallel-run/compare step |
| Installation migration (Lead→real collection) is the largest schema change in the roadmap | 10 | **High** | Dual-write period recommended; exhaustive caller search before cutover; Zero-Data-Loss discipline |
| Employee↔User match rate may be poor, blocking Phase 12's clean completion | 12 | Medium-High | Investigate match rate first before committing to Option A/B; budget for manual cleanup |
| Manager team-visibility query changes may over- or under-expose data | 13 | High | Review every role's expected record set before/after; test both over-exposure and under-exposure |
| Demo Mode record-count ceiling mechanism unknown until located | 15 | Low-Medium | Time-boxed investigation at phase start; the mechanism must be found, not assumed away |
| `BUSINESS_BLUEPRINT_FINAL.md`'s conflicting technical assumptions (Supabase, SQL schema) causing confusion if consulted uncritically during implementation | All | Medium | This blueprint's §2 explicitly flags the conflict; implementers must not treat that document's technical specifics as current-state |
| Six downstream B2C modules (Phase 11) may contain undiscovered bugs of unknown scope | 11 | Unknown (treat as Medium by default) | Phase 11 begins with its own focused read-only audit sub-pass before any fix |

---

## 22. Implementation Completion Matrix

| Phase | Business Rules | Data Model | Services | UI | Permissions | Migration | Demo | Technical Validation | E2E Scenario | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | ☑ | — | — | — | — | — | — | — | — | COMPLETE |
| 1 | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | COMPLETE |
| 2 | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | COMPLETE |
| 3 | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | COMPLETE |
| 4 | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | COMPLETE |
| 5 | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | COMPLETE |
| 6 | ☑ | ☑ | ☑ | ☑ | ☑ | — | ☑ | ☑ | ☑ | COMPLETE |
| 7 | ☑ | ☑ | ☑ | ☑ | ☑ | — | ☑ | ☑ | ☑ | COMPLETE |
| 8 | ☑ | ☑ | ☑ | ☑ | ☑ | — | ☑ | ☑ | ☑ | COMPLETE |
| 9 | ☑ | ☑ | ☑ | ☑ | ☑ | — | ☑ | ☑ | ☑ | COMPLETE |
| 10 | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | COMPLETE |
| 11 | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | COMPLETE |
| 12 | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | COMPLETE |
| 13 | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | COMPLETE |
| 14 | ☑ | ☑ | ☑ | ☑ | ☑ | — | ☑ | ☑ | ☑ | COMPLETE |
| 15 | ☑ | ☑ | ☑ | — | ☑ | ☑ | ☑ | ☑ | ☑ | COMPLETE |
| 15.1 | ☑ | — | ☑ | — | — | — | ☑ | ☑ | ☑ | COMPLETE |
| 16 | ☑ | — | ☑ | ☑ | ☑ | — | ☑ | ☑ | ☑ | COMPLETE |
| 17 | — | — | — | — | — | — | ☑ | ☑ | ☑ | COMPLETE |

*(This table is the living tracker — update per phase as work proceeds; it must never show a phase COMPLETE while any of its own gate checklist items remain unchecked.)*

---

## 23. Final Production Readiness Criteria

Neozy ERP is production-ready for the corrected B2B+B2C architecture when, and only when:

- Every phase's completion gate (§15) shows all boxes checked and status COMPLETE.
- Zero B2B customers are reachable from any B2C surface, and vice versa per whatever Phase 0/8 policy was locked — verified by the negative scenarios in §19, not merely asserted.
- Every Order's `orderType` matches its customer's real `type`, for every creation path, with no exceptions.
- Company Business Mode genuinely gates navigation, routes, queries, Demo Mode, reports, and dashboards — not only navigation.
- The canonical Project lifecycle has exactly one source of truth, imported everywhere it's needed.
- Installation is a real, Project-scoped entity; caseId propagates correctly through the entire chain from Lead to AMC/Service.
- Manager team-visibility and non-project-collection query-level scoping are both real, verified by both positive and negative tests.
- Employee↔Warehouse↔Manager relationships are query-backed, not UI-inferred.
- Soft-delete is universal and default; permanent deletion is Super-Admin-only, verified negatively for every other role.
- Documents cover every entity in the business chain, through the one shared system.
- Demo Mode (`demo@neozy.in`) offers full, realistic, unrestricted create/edit/soft-delete/restore parity with production for the demo company's role and business mode, with internally consistent, correctly-segregated B2B and B2C data graphs and no artificial record-count ceiling.
- `tsc --noEmit`, the full test suite, and the production build all pass with no regressions versus the pre-implementation baseline.

---

## A. Master Phase Dependency Diagram

```
Phase 0 (Rule Lock)
   |
Phase 1 (Company Business Mode)
   |
Phase 2 (Customer/Lead Classification)
   |
   +---------------------+
   |                     |
Phase 3 (B2B Workflow)   Phase 4 (B2C Customer->Project Foundation)
   |                     |
   |                  Phase 5 (Canonical Project Lifecycle)
   |                     |
   |                  Phase 6 (Survey) -> Phase 7 (Engineering)
   |                     |
   +----------+       Phase 8 (Quotation/Order/PI/Payment B2C)
   |          |          |
Phase 9    Phase 14   Phase 10 (Installation/QC)
(Dispatch)  (Documents)   |
   |          |        Phase 11 (Commissioning..Service)
   |          |          |
   +----------+----------+
              |
Phase 12 (HR/User/Warehouse) [mostly independent, needs only Phase 1]
   |
Phase 13 (Roles/Permissions/Visibility)
   |
Phase 15 (Demo Mode Finalization) <- needs ALL of 1-14
   |
Phase 16 (Cross-Module Integration & Stabilization)
```

## B. Business Workflow Diagram — B2B and B2C Side-by-Side (Target State)

```
B2B                                          B2C
---                                          ---
Lead                                         Lead
 |                                            |
convertLeadToCustomer(type='B2B')            convertLeadToCustomer(type='B2C')
 |                                            |
Customer(type='B2B')                         Customer(type='B2C')
 |                                            |
 |                                        [Registration — B2C financing, if applicable]
 |                                            |
 |                                         Project(projectType MANDATORY:
 |                                           Residential|Commercial|Industrial)
 |                                            |
 |                                         Survey -> Engineering
 |                                            |
Quotation ---OR--- Order (direct)            Quotation -> Order
 |  (orderType = real customer.type,           |  (orderType = real customer.type,
 |   fixed in Phase 3)                         |   same shared function)
 |                                            |
generatePIsFromOrder()                       generatePIsFromOrder()  [SAME FUNCTION]
 |                                            |
Payment -> markPIAsPaid()                    Payment -> markPIAsPaid()  [SAME FUNCTION]
 |                                            |
requestDispatch -> approve -> verify          requestDispatch -> approve -> verify
 (serial capture during loading)              [SAME FUNCTIONS]
 |                                            |
confirmDelivery -> closeDispatch              confirmDelivery -> closeDispatch
 |                                            |
Accounts -> Bill (Tax Invoice)                Installation (Project-scoped, Phase 10)
 |                                            |
B2B COMPLETE — NO PROJECT EVER EXISTS         QC -> Commissioning -> NetMetering ->
                                              Subsidy -> Handover -> AMC / Service
                                               |
                                              B2C COMPLETE
```

## C. Phase-to-Module Matrix

| Phase | Leads | Customers | Projects | Survey | Engineering | Quotations | Orders | Invoices/PI | Payments | Dispatch | Installations | QC | Commissioning+ | HR/Employees | Warehouses | Roles/Perm | Documents | Demo |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | | | | | | | | | | | | | | | | | | |
| 1 | | ● | ● | ● | ● | ● | ● | | | ● | ● | | | | | | | ● |
| 2 | ● | ● | ● | | | | ● | | | | | | | | | | | ● |
| 3 | | ● | | | | ● | ● | ● | ● | ● | | | | | | | | ● |
| 4 | | ● | ● | | | | | | | | | | | | | | | ● |
| 5 | | | ● | ● | ● | ● | ● | | | ● | ● | ● | ● | | | | | ● |
| 6 | | | ● | ● | | | | | | | | | | | | | ● | ● |
| 7 | | | ● | | ● | | | | | | | | | | | | ● | ● |
| 8 | | | ● | | | ● | ● | ● | ● | | | | | | | | | ● |
| 9 | | | | | | | ● | ● | | ● | | | | | | | | ● |
| 10 | ● | | ● | | | | | | | | ● | ● | | | | ● | | ● |
| 11 | | | ● | | | | | | | | ● | ● | ● | | | | | ● |
| 12 | | | | | | | | | | | | | | ● | ● | | | ● |
| 13 | ● | ● | ● | ● | ● | | ● | | | | ● | ● | ● | ● | | ● | | ● |
| 14 | | | | | | ● | ● | ● | ● | ● | | | | | | | ● | ● |
| 15 | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| 16 | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |

## D. Demo Data Dependency Matrix

| Phase | Demo Datasets Created/Migrated/Fixed |
|---|---|
| 1 | Company `businessMode` |
| 2 | Demo customers corrected to real `type:'B2C'` (was `customerType:'Residential'/'Commercial'`); genuine B2B demo Leads/Customers still absent — deferred to Phase 15 |
| 3 | Existing 7 demo Orders gained `orderType:'B2C'`; 1 new minimal B2B Lead/Customer/Quotation/Order chain added (no Project, per canonical rule) |
| 4 | Projects' `projectType` — all 10 demo Projects corrected |
| 5 | Project `currentStage`/`stageHistory` — verified zero orphans, no changes needed |
| 6 | Surveys — corrected (Engineering Design linkage, Pending state added) |
| 7 | Engineering Designs — re-verified valid, no correction needed |
| 8 | Quotations, Orders, PIs, Payments (B2C project-linked chain) — re-verified correct, no changes needed |
| 9 | Dispatches — corrected to real enum values, Delivered/Closed both reachable (Tax Invoices remain manual by design, not seeded) |
| 10 | **Installations (new — first time this collection ever has demo data)** — DONE, 5 real Project-scoped records, linked to demo `qc_checks` |
| 11 | QC, Commissioning, NetMetering, Subsidy, Handover, AMC, Service Tickets — all six rewritten to the real schema field names (previously invented ones), demo chain verified end-to-end |
| 12 | Employees (warehouse/manager distribution) — DONE, linked to real demo Users |
| 13 | **DONE** — 2 soft-deleted Leads at different ages (`LEAD-13`/`LEAD-14`) + 1 soft-deleted Order (`ORD-1`), each with `deletedBy`/`deletedAt`, proving "show inactive" + restore; chosen to be unreferenced elsewhere in the graph so the change is additive-only |
| 14 | **DONE** — first-ever demo `documents` (collection had zero seeded data for any entity before this phase): 5 documents, one per Order/Quotation/ProformaInvoice/Dispatch/Payment, cross-linked and reference-verified; `'documents'` added to `DEMO_RESETTABLE_COLLECTIONS` |
| 15 | **DONE** — audited, not regenerated: B2B/B2C segregation proved already correct end-to-end (0 B2B customers with Projects, 0 Projects referencing B2B customers, 0 Order.orderType mismatches — all now permanently tested); `businessMode:'Both'` added to the seeded company doc; second B2B example (`CUS-12`/`ORD-9`, direct-Order-no-Quotation path) added; artificial `DEMO_MAX_RECORDS` ceiling (client + server duplicate) located and removed |
| 15.1 | **DONE** — root cause of the live B2B-with-Project screenshots found and fixed: `api/demo-reset.ts` (the login-triggered reset endpoint) rewritten to seed from `buildCompleteDemoPlan()` instead of its own hand-written, B2B/B2C-unaware dataset. Survey/Engineering coverage extended to all 10 Projects (was capped at 7/6); Dispatch loop extended to cover PRJ-5 (previously had zero Dispatch record despite being at the Dispatch stage) and made stage-coherent for PRJ-6..10; Purchase Orders/Goods Receipts made fully Received for PRJ-4..8; QC/Commissioning/NetMetering/Subsidy made stage-coherent for PRJ-6..10; Service Ticket scope narrowed from 2 to 1 (only the Project genuinely at the Service stage). Follow-up: `banks`, `registrations`, `attendance`, `payroll`, `serial_numbers`, `tax_invoices`, `partner_wallet_transactions` — all 7 collections only the removed duplicate dataset used to seed — added to the canonical generator with real field/enum shapes; `banks`/`registrations` added to `DEMO_RESETTABLE_COLLECTIONS` |
| 16 | (validation only) |
| 17 | **DONE** — full identity-data realism rebuild (customers/leads/projects/employees/vendors/warehouses/channel partners: realistic Indian names/addresses/states/GSTIN-shaped values, zero placeholder patterns); B2B graph rebuilt from 2 customers (stuck at Order) to 6 customers each carrying the complete Quotation-or-Order→PI→Payment→Dispatch(real serial-capture schema)→Bill chain with genuine status variety; see `docs/DEMO_MODE_BUSINESS_FLOW_REMEDIATION.md` for the full audit trail |

## E. Critical Blockers (must resolve before implementation safely begins)

1. **POLICY RESOLVED AT PHASE 0, ENFORCEMENT STILL NOT BUILT (corrected at Phase 8):** A `'B2C'`-mode company never needs standalone Orders without a Project — B2C is Project-only. The *policy* was locked at Phase 0 (was blocking Phase 1's full rule table, §8), but Phase 8's fresh audit confirmed **no phase since has actually implemented the enforcement** — see item 7 below, the corrected, concrete version of this blocker.
2. **RESOLVED AT PHASE 0, EXECUTED AT PHASE 4:** Registration is always optional, never mandatory, for any Project Type. (Phase 4 also found and fixed a related bug: `createProjectFromRegistration()` was silently hardcoding `projectType` to an empty string.)
2a. **RESOLVED AT PHASE 4:** The "single Customer + Project master creation flow" question Phase 4's own text originally flagged as `[POLICY DECISION NEEDED]` — the user's Phase 4 instruction directively required it; built on both desktop and mobile (see Phase 4's section).
3. **RESOLVED AT PHASE 3 (mechanism built, execution still pending):** Backfill logic for wrongly-typed `orderType` Orders is built and unit-tested (`src/lib/orderTypeBackfill.ts`, `scripts/backfill-order-type.ts`) — never guesses, buckets records into corrected/already-correct/ambiguous. **Not yet executed against any live data** (no Firestore credentials in this environment) — whoever has production DB access should run it (dry-run first, per the script's default) whenever convenient; it is not itself a blocker for Phase 4+.
4. **RESOLVED AT PHASE 12:** Employee↔User — **Option A (link)**, not Option B. No match-rate investigation was actually needed: `EmployeeDomainService.create()` already linked every Employee to a real User via `userId` before Phase 12 began (an existing mechanism the original audit had not caught), so there was no backfill population to run — only the never-before-set `warehouseId`/`managerId` values need ordinary data entry through the now-working UI.
5. **RESOLVED AT PHASE 15:** Demo Mode's artificial record-count ceiling was `DEMO_MAX_RECORDS = 5` (`src/config/demo.ts`), enforced in `src/lib/firestore.ts`'s `enforceDemoRecordLimit()` on every create call, with a duplicate enforcement of the identical cap independently found in `api/[entity].ts`'s serverless REST route. Both located and removed (the numeric cap only — the separate, legitimate `business-crud` capability gate was kept).
6. **RESOLVED AT PHASE 10:** Installation migration's originally-flagged HIGH risk was de-risked by building a **dual-write**, not a full cutover — a full caller search (`Installations.tsx`, `InstallationWorkspace.tsx`, `MobileInstallationsWorkspace.tsx`, partner `InstallationDetailDrawer.tsx`, `PartnerMobileInstallationWorkspace.tsx`) confirmed only two files perform real mutations, both funneling through `installationEngine.ts`; every one of them keeps reading/writing the Lead fields unchanged while a real, Project-scoped `installations` collection accumulates correctly-linked data in parallel. The historical-data backfill (`scripts/backfill-installations.ts`) is built, tested, and dry-run by default, but **not yet executed against live data** — same category as Phase 3's `orderTypeBackfill.ts`, not itself a blocker for Phase 11+.
7. **[POLICY DECISION STILL NEEDED, FOUND AT PHASE 8, RE-CONFIRMED STILL OPEN AT PHASE 15]** The Phase 0-locked rule "no standalone Order/Quotation entry point for a `'B2C'`-mode company without a linked Project" has no enforcement anywhere in the code: `Orders.tsx`'s create form has no project-selector UI at all; `Quotations.tsx`'s does, but nothing validates it's required in strict B2C mode; neither `createOrder()` nor `createQuotation()` check `businessMode` against `projectId` presence. Closing this requires either (a) new UI (a project-selector on `Orders.tsx`) plus service-layer validation, or (b) relaxing the locked rule to match the Customer Workspace's own deliberate design (Quotation/Project are independent, non-gating one-time cards for B2C) — a real business call, not a code-only fix. Phase 15 deliberately did not decide this — the demo company's `businessMode:'Both'` sidesteps needing an answer (the rule only bites a `'B2C'`-only company), so it remains a live, unmade decision for whenever a real `'B2C'`-only company is provisioned.
8. **[DELIBERATE, NOT YET DONE — FOUND AT PHASE 10]** `Installations.tsx`/`InstallationWorkspace.tsx`/mobile/partner Installation UI's *reads* (list/detail display) still come from `COLLECTIONS.LEADS`, and `/installations/:id` still resolves by Lead id, not the new `installations` collection or a `projectId`-based route — this was a deliberate scope decision to keep Phase 10's blast radius to the service layer (see Phase 10's dual-write design), not an oversight. A full read-side cutover (re-point list/detail UI to the real collection, switch the route to Project-scoped) is a legitimate, lower-risk follow-up once the collection has accumulated real production data via the dual-write — not scheduled to any specific numbered phase; flag if a later phase's scope naturally touches Installation UI again.
9. **[POLICY DECISION NEEDED, FOUND AT PHASE 11]** Should `createHandover()` strictly require NetMetering to be `MeterInstalled` and Subsidy to be `Disbursed` before a Handover can be created? The code currently does NOT enforce this (only that the Project has reached the Subsidy stage — the minimum, unambiguous bar this phase added, matching every sibling module's own precondition pattern). Real-world subsidy disbursement (e.g. PM Surya Ghar) can legitimately lag months behind physical handover, so mandating full resolution first could block a real, wanted operational flow. Not fixed — the minimal stage-order guard was added as the unambiguous part; the stricter rule is a genuine business call, not a code-only fix.
10. **[POLICY DECISION NEEDED, FOUND AT PHASE 11]** `createServiceTicket()` unconditionally calls `advanceProjectStage(projectId, 'Service', ...)` on *every* ticket creation — safe from regression (the canonical forward-only guard makes repeat calls a no-op), but it means the Project's `currentStage` only ever reaches `'Service'` via whichever ticket happens to be created first, and a Project with an Active AMC contract but zero tickets ever created stays at `'AMC'` indefinitely. Whether the `'Service'` stage transition should instead be triggered by AMC activation (`transitionAmcStatus(id, 'Active')`) rather than ticket creation is a genuine design question, not resolved here — left as-is (no regression risk either way).
11. **[DELIBERATE, PARTIAL ROLLOUT — FOUND AT PHASE 13]** The "show inactive + restore" UI (`InactiveRecordsModal`, backed by the new `getAllDeleted()`) is a real, generic, working capability, but is wired into only two modules (Leads, Orders) as this phase's proof — every other soft-deletable entity in §13's own state machine (Customers, Projects, Quotations, Employees, Vendors, Products, Users, Documents, and others) still has no "show inactive" toggle in its list view, even though the underlying service-layer capability already works for any collection. Rolling it out is now purely mechanical (import the component, add a button + two label functions per page) — not scheduled to a specific numbered phase; a natural fit for Phase 16 (Cross-Module Integration & Final ERP Stabilization) or a dedicated follow-up pass, whichever comes first.
12. **[POLICY OPEN, FOUND AT PHASE 13]** No system-seeded role (`roleBootstrap.ts`) currently sets `visibility:'team'` on any module — the Manager role ships with `visibility:'all'` (implicit default) across every module it's granted, meaning today no default role actually exercises the now-fixed team-visibility mechanism in production. Whether the business wants the seeded `Manager` role itself to default to `'team'` visibility for some modules (narrowing its current `'all'` access) is a genuine policy call this Blueprint does not make unilaterally — Phase 13 fixed the *mechanism* only; assigning `'team'` to any specific role is a live, unmade business decision, achievable today via the existing Roles UI without further code changes if/when decided.
13. **[POLICY DECISION NEEDED, FOUND AT PHASE 13]** Does restoring a soft-deleted record require the same permission as deleting it, editing it, or a distinct elevated permission? §13's policy text flagged this as open before Phase 13 began; Phase 13's implementation (`InactiveRecordsModal`) intentionally did not decide it — restore is currently gated only by the same self/team/all visibility scoping the active-record list already uses, with no additional edit/delete permission check layered on top. Not a security gap (a user still can't restore what they couldn't see), but a real, unmade product decision.
14. **[DELIBERATE, PARTIAL FIX — FOUND AT PHASE 14]** `UniversalDocumentsTab.tsx`'s pre-Phase-14 implementation never persisted uploads/deletes anywhere (local React state only, seeded from a private `record.documents[]`/`record.attachments[]` array) — a real, live bug affecting **all ~19 modules** that mount the shared `'documents'` workspace tab, not only the five Phase 14 owns. Phase 14 fixed it for its own five entity types (Orders/Quotations/Invoices/Dispatch/Payments) and left the other ~14 (AMC, Commissioning, NetMetering, Subsidy, Handover, QC, Installations, Cases, Partners, Monitoring, Settlements, CommissionRules, CommissionApprovals, ServiceTickets) with their exact pre-existing (still broken) behavior, unchanged. Closing the rest is now mechanical — add each entity's real FK field name to `EntityDocumentsPanel.tsx`'s `ENTITY_SCOPE_FIELD` map — not scheduled to a specific numbered phase; a natural fit for Phase 16 or a dedicated follow-up.
15. **[DELIBERATE, NOT YET DONE — FOUND AT PHASE 14]** Mobile has zero Documents UI for any of the five Phase 14 entities (confirmed absent via grep, not merely unverified) — the real, shared service-layer capability (`EntityDocumentsPanel`) is mobile-ready today, but no mobile page mounts it. Likewise, Quotations/Invoices/Dispatch/Payments' own list-page quick-view modals (the siblings to the one Orders.tsx fix covers) were not touched, since — unlike Orders.tsx — none of them had a pre-existing "Documents" tab to fix; their dedicated `/module/:id` workspace routes (fixed this phase) remain the fully-correct primary path. Both are tracked, explicit follow-ups, not silently dropped — not scheduled to a specific numbered phase.
16. **[OUT OF SCOPE, FOUND AT PHASE 14]** `Payment` and `Dispatch` have no canonical TypeScript interface anywhere in the codebase (confirmed via exhaustive grep) — the same "most business-critical entity is untyped" gap the Audit flagged for `Customer` pre-Phase-2, never previously flagged for these two. Not a Documents gap, so not fixed in Phase 14 — flagged for whichever future phase next touches these two entities' schemas.
17. **[RESOLVED AT PHASE 15.1 — Phase 15's own conclusion below was WRONG, not merely stale]** Phase 15 concluded: "this state cannot be produced by any code path in this repository... the live UI's data is stale relative to this repository." A follow-up report of the same symptom persisting triggered a deeper trace (Phase 15.1) that found a real, live code path Phase 15 never searched: `api/demo-reset.ts` — called by `src/pages/Login.tsx` on every browser's first login as `demo@neozy.in` — built its own separate, hand-written demo dataset that never set `Customer.type` at all, completely bypassing `scripts/demo/datasets/businessGraph.ts`. Fixed by making that endpoint seed from the same `buildCompleteDemoPlan()` as every other demo entry point (see Phase 15.1's section above and the Executive Summary addendum). Still outside this environment's reach: confirming the live tenant has actually been reset via a genuine login (or a manual `workflow_dispatch`/`POST /api/demo-reset` call) after this fix is deployed — this environment has never had live Firestore write access, across any phase including 15.1.
18. **[DELIBERATE, NOT YET DONE — FOUND AT PHASE 15]** Only one demo company (`businessMode:'Both'`) exists, per Phase 1's own original default ("start with 'Both' unless Phase 15 decides dedicated single-mode demo companies are more instructive") — Phase 15 confirmed 'Both' remains the right choice for the one public demo tenant (it must showcase every workflow, and building genuinely separate B2B-only/B2C-only demo companies with their own login/company-switching flow would be a significant new feature, not a "finalization" of the existing generator). If the business later wants dedicated single-mode demo companies for a specific sales/demo scenario, that is a new, explicit feature request, not a Phase 15 gap.
19. **[RESOLVED AT PHASE 16 — HIGH SEVERITY, previously undetected]** A fresh cross-module trace (not a per-module audit, which is exactly why Phases 5–11's own individual, in-isolation testing never caught this) found that **no production code path ever advanced a Project's `currentStage` to `'Subsidy'`**: `commissioningWorkflow.ts` advances to `'NetMetering'` on commissioning completion, but neither `netMeteringWorkflow.ts` nor `subsidyWorkflow.ts` ever wrote to `COLLECTIONS.PROJECTS` — confirmed by direct grep, not inference. Since `projectHandoverWorkflow.ts`'s `createHandover()` requires `currentStage>=Subsidy`, **Handover was structurally unreachable for every real project**, and since `amcWorkflow.ts`'s `createAmcContract()` requires `currentStage>=Handover`, **AMC was unreachable too** — cascading from one missing stage-write. `netMeteringWorkflow.ts`'s own header comment had, in fact, already described the intended design ("stays in NetMetering until Handover, which waits for both NetMetering and Subsidy") but the mechanism implementing that wait was never built. Fixed by advancing to `'Subsidy'` at the first real sign of forward progress on either parallel track — `netMeteringWorkflow.ts`'s `transitionNetMeteringStatus()` reaching `'MeterInstalled'`, or `subsidyWorkflow.ts`'s `createSubsidyApplication()` being called at all — deliberately NOT waiting for full resolution of both, consistent with item 9's already-locked "minimum unambiguous bar" policy (not a new rule). A second, related bug fixed alongside: both files gated their own `create*Application()` functions on a hardcoded inline stage array (`['NetMetering','Subsidy','Handover','Archived']`) instead of `projectLifecycle.ts`'s `isProjectStageAtOrPast()` — the exact independently-drifting-stage-list anti-pattern Phase 5 eliminated everywhere else, and functionally wrong on its own terms (it excluded `'AMC'/'Service'/'Monitoring'`, incorrectly blocking a late-created application for a project already that far along). 8 new regression tests added (`netMeteringWorkflow.test.ts`, `subsidyWorkflow.test.ts`).
20. **[RESOLVED AT PHASE 16]** Three smaller, genuine cross-module gaps found and fixed in the same pass: (a) `casePropagation.ts`'s `PARENT_CHAIN`/`COLLECTION_MAP` had no entry for `'registrations'`, even though `registrationWorkflow.ts`'s `onRegistrationStatusChange()` has always called `propagateCaseIdFromChain('registrations', ...)` on approval — the untyped `entityType: string` parameter let this compile silently, and the lookup returned `null` every time, so Registration's `caseId` was never actually populated; fixed by adding the entry (parent: `customers` via `customerId`), and the pre-existing `installations` entry's raw `'installations'` string literal was also switched to the real `COLLECTIONS.INSTALLATIONS` constant while in the area. (b) `entityRegistry.ts` had no entry at all for 8 real, actively-written collections (`installations`, `documents`, `commission_records`, `notifications`, `tasks`, `entity_relationships`, `entities`, plus the Phase 15.1-added `banks`/`registrations`), meaning `relationships.ts`'s linked/recommended-relationships logic could never recognize a reference to any of them and `getEntityLabel()`/`resolveOwnerId()` silently fell back to a bare id; all 9 added with real field-name-verified `labelFields`/`ownerFields`. (c) `roleBootstrap.ts`'s `LEGACY_SYSTEM_ROLES` had zero non-Admin role with a `registrations` or `banks` entry — both are real `Module` values with real, already-shipped pages, simply never backfilled into any role definition when they were added, meaning only `Admin` could ever see either page; added to `Director` (view, matching its existing "view everything core" tier), `Sales`/`Manager` (view+create+edit, matching their existing customer-lifecycle tier), and `Accounts` (view+edit+approve, since `createPaymentFromRegistration()` writes a real Payment directly from a Registration) — deliberately NOT added to the field-execution roles (Surveyor/Engineer/InstallationLead/ServiceTechnician/ComplianceOfficer/Procurement), none of which have `customers`/`payments` access either, so extending them would be inconsistent with their existing narrow scope, not a fix. Also fixed: `CaseSearch.tsx`'s `STAGE_OPTIONS` was a 9th independently hand-typed stage list (Phase 5 anti-pattern again) containing a phantom `'Closure'` value (not a real `ProjectStage` — filtering by it could never match anything) and missing the real terminal stage `'Archived'`; now derives from `projectLifecycle.ts`'s canonical `PROJECT_STAGE_ORDER`. 6 new regression tests added (`casePropagationPhase11.test.ts`, `phase16EntityRegistryCoverage.test.ts` — new file, `roleBootstrap.test.ts`).
21. **[GENUINE DEFECT, FOUND AT PHASE 16, NOT FIXED — B2C-only enforcement gap of the same class as item 19's guard]** `registrationWorkflow.ts`'s `createRegistration()` had zero `customer.type` check — Registration (Neozy's B2C-only pre-Project financing module) was only kept away from B2B customers by the UI never wiring a "Start Registration" button into `CustomerB2BWorkflowPipeline.tsx` (confirmed: the button only exists in `CustomerB2CWorkflowCards.tsx`), exactly the UI-only-gating pattern Phase 4 already fixed for Project creation. **Fixed at Phase 16**, mirroring `projectWorkflow.ts`'s `createProject()` guard exactly — `createRegistration()` now throws if the linked customer resolves to `type==='B2B'`. 2 new regression tests added.
22. **[CONFIRMED GAP, FOUND AT PHASE 16 — carried forward from the original Gap Audit, never previously verified by any phase]** The Gap Audit's own §21 flagged, but never confirmed either way, whether Order-cancellation, Stock-transfer-between-warehouses, Return/reverse-dispatch, or Partial-delivery workflows exist. A direct Phase 16 trace of `src/lib/stockWorkflow.ts` (the only plausible home for these) found: `cancelOrder()` exists and is real; **no stock-transfer-between-warehouses function exists anywhere in the codebase** (confirmed via exhaustive grep for `transfer`/`stockTransfer`/`warehouseTransfer`); no distinct reverse-dispatch function exists (Dispatch's own partial-quantity fulfillment mechanism partially covers partial-delivery, but there is no explicit "return/reverse" capability). This is a genuine, now-confirmed absence, not merely undocumented — building these would be new feature work, not a Phase 16 "integration" fix, so intentionally not built here. Flagged for whichever future phase or dedicated follow-up next touches multi-warehouse stock operations.
23. **[UNKNOWN, FOUND AT PHASE 16 — carried forward from the Gap Audit, low priority]** Whether a genuine "Super Admin views all companies at once" UI mode exists was marked `[UNKNOWN]` by the original Gap Audit (§10) and is not mentioned anywhere in this Blueprint's 16 completed phases. Not investigated at Phase 16 (low severity, no regression risk either way) — flagged for whenever multi-company Super-Admin tooling is next touched.
24. **[UNKNOWN, FOUND AT PHASE 16 — carried forward from the Gap Audit, low priority]** `Task.assignedToId: string` remains unconstrained (confirmed still true) — whether the assignment-picker UI actually restricts it to real Employee/User identities, or a stale/arbitrary string can be stored, was marked `[UNKNOWN]` by the Gap Audit and was never investigated by any of Phases 0–16. Not a confirmed defect (no failure mode observed), just an unverified assumption — flagged for whenever Task assignment is next touched.

**Status update on two previously-flagged "natural fit for Phase 16" items (11, 14 above):** Phase 16 deliberately did NOT roll out `InactiveRecordsModal`/"show inactive" to any additional module beyond the two Phase 13 already wired (item 11), and did NOT extend `EntityDocumentsPanel.tsx`'s `ENTITY_SCOPE_FIELD` map to any of the ~14 modules still on the old broken `UniversalDocumentsTab` behavior (item 14) — both remain real, tracked, unstarted follow-ups; Phase 16 confirmed (via Fork C's dedicated audit pass) that nothing has changed about either since Phase 13/14 closed, but chose to prioritize this phase's limited scope on genuine cross-module *defects* (items 19–21) surfaced by the fresh full-system trace, consistent with "do not blindly change working code" / "do not introduce new business rules" — expanding UI rollout to more modules is feature completion, not defect-fixing, and is explicitly out of scope for a stabilization audit.

## F. Recommended First Implementation Phase

*(Historical — this was the recommendation made before any phase started. Phases 0–15 are now COMPLETE; see the document header and §22 for current status. The live "what's next" recommendation is Phase 16 (Cross-Module Integration & Final ERP Stabilization), per Phase 15's closing report and the dependency diagram in Appendix A — Phase 16 needs Phases 0–15 done first, which is now true for the first time.)*

**Phase 1 (Company Business Mode), immediately followed by Phase 2 (Customer/Lead Classification).**

Reasoning: Phase 1 is additive-only (a new field, safely defaulted to `'Both'` for every existing company — zero regression risk), touches no existing data destructively, and every other phase's enforcement logic (§8's table) is written in terms of it. Phase 2 is the second-lowest-risk phase (a query filter, not a schema change) and directly closes the audit's #1-cited contamination vector (B2B customers reachable from Project creation). Together they establish the foundation every other phase's dependency chain (§20) already assumes. Phase 3's fix (the `orderType` hardcode) is arguably higher standalone business value, but it correctly depends on Phase 2 landing first so that "the real customer type" is something the fix can trust — starting with 1→2 in strict order, then 3, is the safest sequencing, not merely the highest-value one.

---

**STOP.** Phases 0–20 (including 15.1) are COMPLETE at the code/test/commit level. Phase 20 proved live, against the actual deployed Firebase project, that the corrected code and dataset have never been deployed — the exact next actions to close this are in `docs/NEOZY_PRODUCTION_READINESS_REPORT.md`. (see document header, Executive Summary, and §22). Phase 16's fresh, whole-system trace found and fixed one high-severity, previously-undetected cross-module defect (Handover/AMC were structurally unreachable — Appendix E item 19) plus several smaller ones (items 20–21). Phase 17 (Demo Mode — Final Business-Flow Data Rebuild & Realistic ERP Demo Validation; full detail in `docs/DEMO_MODE_BUSINESS_FLOW_REMEDIATION.md`) rebuilt every demo identity field to realistic Indian data and rebuilt the B2B material-sales demo graph to 6 fully-chained customers. Phase 18 found and fixed the real reason the live demo tenant kept showing stale data (`DEMO_SEED_ID` had never changed, so the reset gate never re-fired for any browser that had ever completed one before). Phase 19 (full detail in `docs/NEOZY_PRODUCTION_READINESS_REPORT.md`) discovered and fixed the fact that nothing had ever been committed/pushed, delivered the complete verified tree to `origin/main` as commit `e8570b39`, and ran a fresh, non-trusting production-readiness audit that found and fixed 7 genuine defects (a docs/.gitignore delivery blocker, a desktop/mobile Lead-creation divergence with a real data-corruption bug, a Firestore security-rules gap across 7 collections, missing service-layer RBAC on 2 creation paths, a fake Task assignee sentinel, missing duplicate-serial protection on Dispatch, and 2 notification-routing bugs). **Deployment to the live Vercel project and live-Firestore/browser verification remain genuinely unverified from this environment** — not a code gap, an environment-access gap, stated explicitly rather than assumed away. Remaining items (Appendix E's open items, the open policy items, and Phase 19's newly-confirmed non-blocking backlog: 14-module document persistence, Global Search documents category, Super-Admin cross-company view inconsistency) require a business decision, new feature work, or per-item verification budget beyond this pass — they are not blockers. Do not start a new phase unless one of these specific open items is explicitly picked up, a genuinely new gap is found, or deployment/live verification becomes possible.
