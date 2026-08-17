# NEOZY ERP — MASTER BUSINESS WORKFLOW & CURRENT-STATE GAP AUDIT

**Scope:** Read-only audit. No code was modified. All findings below are tagged **[CONFIRMED]** (verified directly by reading source), **[INFERRED]** (reasonable conclusion not directly exercised), or **[UNKNOWN]** (not traced — flagged for follow-up), per the audit's Rule #20.

---

## 1. Executive Summary

Neozy runs two structurally different businesses on one codebase: **B2B material distribution** (sell products, customer installs) and **B2C direct solar installation** (Neozy installs). The single most important finding of this audit is that **the codebase has no enforced concept of this distinction anywhere except a single string field, `Customer.type`, set once at Lead→Customer conversion** — and even that field is not consistently honored downstream.

Concretely:

- **Project creation shows every customer, B2B and B2C alike, with no filter** (`src/pages/Projects.tsx:134-154,814`). A B2B (material-only) customer can have a full EPC Project opened against them today.
- **Quotation→Order conversion hardcodes `orderType: 'B2C'` unconditionally** (`src/lib/quotationWorkflow.ts:176`), regardless of the source customer's real type — while the *other* Order-creation paths (`Orders.tsx`, `CustomerOrderForm.tsx`, `MobileOrderWorkspace.tsx`) correctly derive `orderType` from `customer.type`. Two code paths disagree on how to classify the same kind of record.
- **Company has no B2B/B2C/Both business-mode field at all** — grepped exhaustively, zero matches. Nothing in routing, queries, or Demo Mode is gated by it because it does not exist.
- **Demo Mode's classification schema (`customerType: 'Residential'|'Commercial'`) is a completely different, non-overlapping schema from the real one (`Customer.type: 'B2B'|'B2C'`)** — every demo customer is unclassified with respect to the real model, and 100% of demo customers (10/10) receive a Project unconditionally, which is structurally the exact contamination pattern the user flagged.
- **"Installation" as a business entity does not really exist in production.** The Installation pages (`Installations.tsx`, `InstallationWorkspace.tsx`, `MobileInstallationsWorkspace.tsx`) all read and write **Lead** documents (`capturedSerialNumbers`, `installationChecklist` fields live on `COLLECTIONS.LEADS`), while the Case-propagation chain declares `installations` as a child of `projects` and parent of `qc_checks` — a collection that is **never actually created anywhere in the app**. This silently breaks caseId propagation for QC, Commissioning, Net Metering, and Subsidy for every record, always.
- **Multi-company and Super Admin isolation are, by contrast, genuinely well-built** — three-layer enforcement (query-scoping, client re-filter, Firestore security rules) and a real, non-spoofable, server-verified Super Admin identity check. This is the strongest part of the architecture.
- **Manager-level "team" visibility is not real** — it silently behaves identically to "self" visibility for all Project-scoped collections (Survey, Engineering, Installation, QC, etc.), and for non-project collections, filtering happens only after the full company dataset is fetched to the client.
- **HR is disconnected from itself**: `warehouseId` and `managerId` (reporting manager) live on the `AppUser`/Users record, not on the `Employee` record, and there is no foreign key between the two — so "which warehouse does this employee work at" and "who is their reporting manager" are not answerable from the Employee/Attendance/Payroll side at all.
- **Channel Partners are correctly and cleanly segregated from B2B customers** — this is a genuine bright spot, along with Notifications (real company/user scoping, dedup, deep links) and the shared Documents system (though it only covers Lead/Customer/Project/Survey/Engineering — Order/Quotation/PI/Dispatch/Payment have no document capability at all, not even a legacy one).

None of this has been fixed. Per the brief, this document is a baseline only.

---

## 2. Correct Business Definition (restated, as confirmed against the code)

- **B2B** = a GST-registered business or Solar EPC company that buys **materials** from Neozy and installs them itself. Classification lives on `Customer.type === 'B2B'`, set exclusively by `convertLeadToCustomer(lead, 'B2B')` (`src/lib/leadWorkflow.ts`). A B2B customer should never own a Project.
- **B2C** = Neozy performs the installation. `Customer.type === 'B2C'`. Project Type (`Residential`/`Commercial`/`Industrial`, `src/features/projects/types/index.ts:11`) is a property of the **Project**, not the customer's B2B/B2C classification. A "Commercial" or "Industrial" Project Type customer is still B2C.
- GST fields are not, and must not be treated as, a B2B signal — **[CONFIRMED]** no code path currently uses GST presence to imply B2B, but also **no code path currently blocks a B2B classification without GST** — the fields are simply independent and unvalidated against each other.

---

## 3. Visual Workflow Diagrams (as currently implemented, text form)

### 3a. B2B — as implemented today
```
Lead --[convertLeadToCustomer(lead,'B2B')]--> Customer(type='B2B')
   |
   +--> Quotation (createQuotation) --[convertQuotationToOrder]--> Order
   |         ^ orderType hardcoded 'B2C' regardless of customer.type  <-- BUG
   |
   +--> Order (direct, via Orders.tsx/CustomerOrderForm.tsx)
             orderType correctly = customer.type                      <-- correct path
                |
                v
        generatePIsFromOrder -> ProformaInvoice(s) (Draft, split by item category)
                |
                v
        markPIAsPaid -> PI.paymentStatus='Paid', Order.stockBlocked=true
                |
                v
        requestDispatch -> Dispatch(Pending Verification, items[].serials=[])
                |
                v
        approveDispatch -> Dispatch.approvalStatus='Approved'
                |
                v
        executeAndVerifyDispatch -> Stock decremented, StockLedger 'OUT',
                                     Order.items[].dispatchedQty updated,
                                     Order.status='Dispatched'|'Partial Dispatch'
                |
                v
        confirmDelivery(OTP) -> Dispatch.status='Delivered' -> closeDispatch -> 'Closed'
                |
                v
        [NO explicit "Bill"/Tax Invoice generation call found wired to Dispatch close —
         a `tax_invoices` collection and taxInvoiceWorkflow.ts exist and are chained
         from proforma_invoices in casePropagation, but the trigger point from
         Dispatch-Closed -> Bill was not located in this pass. UNKNOWN/gap.]
```
Serial-number capture: `Dispatch.items[].serials` field exists at creation (`requestDispatch`, `dispatchWorkflow.ts:38`) but the UI call-site that actually populates it during verification was not traced to completion in this pass — **[UNKNOWN]**, flagged for follow-up, do not assume it works end-to-end.

### 3b. B2C — as implemented today
```
Lead --[convertLeadToCustomer(lead,'B2C')]--> Customer(type='B2C')
   |
   +--> Project (projectType: Residential|Commercial|Industrial — NOT enforced mandatory,
   |             no `required` attribute on the field, no validation found)
   |         |
   |         v
   |     Survey --[approveSurvey]--> createEngineeringDraftFromSurvey (auto, idempotent)
   |         |
   |         v
   |     Engineering (design Draft->InReview->Approved)
   |         |
   |         v
   |     Quotation (createQuotation, can link project+engineeringDesignId)
   |         |
   |         v
   |     convertQuotationToOrder --> Order (orderType hardcoded 'B2C' -- correct for
   |                                          this path only by coincidence)
   |         |
   |         v
   |     generatePIsFromOrder / markPIAsPaid / requestDispatch / executeAndVerifyDispatch
   |     / confirmDelivery  (SAME shared functions as B2B — no B2C-specific installation
   |     handoff logic distinguishes "install here" from "ship to buyer")
   |         |
   |         v
   |     [GAP] "Installation" as a linked entity: Installations.tsx / InstallationWorkspace.tsx
   |           / MobileInstallationsWorkspace.tsx read/write COLLECTIONS.LEADS directly
   |           (installationChecklist, capturedSerialNumbers fields on the Lead document),
   |           NOT a projectId-scoped Installation record. Serial numbers ARE captured here
   |           (captureInstallationSerial(leadId,...)) -- this is the correct "after
   |           installation" timing the user wants, but it is anchored to the Lead, not
   |           the Project or a dedicated Installation record.
   |         |
   |         v
   |     QC (qcWorkflow.ts) -- keyed by required projectId, optional installationId
   |         (advanceProjectStage(projectId,'QC',...) -- this part IS project-scoped correctly)
   |         |
   |         v
   |     Commissioning (commissioningWorkflow.ts, real collection, project-linked)
   |         |
   |         v
   |     NetMetering -> Subsidy -> Handover -> AMC -> Service
   |         (pages/collections all exist: NetMeteringWorkspace, SubsidyWorkspace,
   |          ProjectHandoverWorkspace, AMC, Service — not deep-audited stage-by-stage
   |          in this pass beyond confirming they exist and are wired into
   |          casePropagation's PARENT_CHAIN — [PARTIALLY VERIFIED])
```

### 3c. Customer Classification
```
Lead.company/name --[user picks B2B or B2C toggle in LeadWorkspaceConversionFlow.tsx]-->
   convertLeadToCustomer(lead, customerType) --> Customer{ type: 'B2B'|'B2C', ... }
   (This is the ONLY place customer.type is ever set. No later edit path found that
    changes an existing customer's type — [UNKNOWN, not exhaustively checked].)
```

### 3d. Company B2B/B2C/Both — DOES NOT EXIST
```
Company { id, name, gst, pan, currency, invoicePrefix, ... }   <-- no mode field
   |
   X   nothing reads a business-mode field anywhere, because there isn't one
```

### 3e. Multi-company
```
User.companyId --> activeCompanyId (useAppStore)
   |
   +--> companyScopedQuery() adds where('companyId','==',activeCompanyId)   [real]
   +--> applyAccessFilters() re-checks docData.companyId === activeCompanyId [real, defense-in-depth]
   +--> firestore.rules: sameCompany(data) required on every collection,
        catch-all rule defaults new/unlisted collections to company-scoped [real, server-side]

Super Admin (shreeniwas.tripathi0@gmail.com):
   client: SuperAdminRoute checks Firebase Auth SDK session email
   server: firestore.rules isOwnerIdentity() checks request.auth.token.email (verified claim)
   -- both layers present, genuinely non-spoofable [CONFIRMED]
```

### 3f. Multi-warehouse
```
Company --1:N--> Warehouse (companyId FK, real)
Warehouse --1:N--> Stock (warehouseId FK, real, enforced in stockWorkflow.ts)
Warehouse --1:N--> Dispatch (warehouseId FK, real)
Warehouse --X--> Employee   <-- NO FK. Employee record has no warehouseId field at all.
                                 warehouseId instead lives on AppUser/Users (auth identity).
Warehouse.managerName/managerPhone  <-- free text strings, not a User/Employee reference
```

### 3g. User/Role hierarchy (as implemented)
```
Users (COLLECTIONS.USERS, phone-keyed MUSR-{companyId}-{phone} docs)
   roles: string[]  (accumulates: Lead, Customer, Employee, Driver, Vendor,
                      InstallationPartner, FieldAgent -- via PROJECTION_ROLE_MAP)
   linkedModules: string[]

Role documents (FirestoreRoleDocument) -- data-driven, not hardcoded strings:
   admin / director / sales / accounts / warehouse / hr / operations / partner / manager
   each carries per-module permission flags + visibility: 'all'|'team'|'self'

   visibility='team' and visibility='self' COLLAPSE to the same enforcement for
   Project-scoped collections (Survey/Engineering/Installation/QC/etc.) --
   both only match records where the CURRENT USER is the assignee
   (assignedSurveyor/assignedInstaller/salesOwner/designerId). No real
   "manager sees team's records" query exists. [CONFIRMED GAP]

Super Admin -- see 3e, sits above this entire hierarchy, both roles unnecessary for it.
```

### 3h. Lead → Customer → Project/Order relationships
```
Lead --(convert)--> Customer --(direct create, no Lead check)--> Project
                        |
                        +--(direct create, no Lead check, no Customer-type check)--> Order

Project creation customer-picker (Projects.tsx) shows ALL customers, B2B+B2C, unfiltered.
Order creation (Orders.tsx/CustomerOrderForm.tsx) DOES read customer.type correctly.
convertQuotationToOrder does NOT read customer.type -- hardcodes 'B2C'.
```

### 3i. Documents
```
COLLECTIONS.DOCUMENTS (shared) <-- Lead, Customer, Project, Survey(mirrored), Engineering(mirrored)
   resolveDocumentsFor(scope) matches ANY of leadId/customerId/projectId/caseId

Order, Quotation, ProformaInvoice, Dispatch, Payment
   --X-- no `documents` field in the type at all, no shared-system wiring, no legacy array.
   This is a full capability gap, not merely a silo.
```

### 3j. HR
```
Employee (COLLECTIONS.EMPLOYEES): name, phone, dept, designation, salary, bank, PAN...
   companyId: SET correctly at creation
   warehouseId: ABSENT
   managerId/reportingManagerId: ABSENT
   userId (link to AppUser): ABSENT

AppUser (COLLECTIONS.USERS): companyId, warehouseId, managerId  <-- these live HERE instead

Attendance/Payroll key off employeeId (the HR-side record) -- which has no warehouse/manager
info -- so warehouse-wise or reporting-manager-wise attendance/payroll rollups are not
possible today. [CONFIRMED GAP — the two "halves" of an employee's identity never join.]
```

### 3k. Tasks
```
Task { assignedToId: string (unconstrained), entityType?: 'Lead'|'Customer'|'Order'|string,
       entityId?: string, createdBy }
-- assignedToId has no enum/reference restricting it to Employee/User identities.
Whether the assignment UI's picker sources Employees-only was not verified. [UNKNOWN]
```

### 3l. Permissions (data-scoping depth)
```
Project-scoped collections (Survey/Engineering/Installation/QC/Commissioning/...):
   REAL query-level enforcement via buildProjectVisibilityQueryPlan() -- where() clauses
   built from PROJECT_ASSIGNMENT_FIELDS (assignedSurveyor/assignedInstaller/salesOwner/
   designerId) matched to current user id. [CONFIRMED REAL]

Non-project collections (Leads/Customers/Orders/Tasks/etc.):
   getAll() fetches broadly (company-scoped only), THEN applyAccessFilters() filters
   in-memory by assignedToId/createdBy. The FULL company dataset for that collection is
   sent to the client before the self/team filter is applied client-side.
   [CONFIRMED -- a real data-exposure gap, not just "UI hides it".]
```

---

## 4. Actual Current Implementation — Expected vs Current, by workflow

| Workflow | Expected | Currently Implemented |
|---|---|---|
| Lead→Customer classification | One explicit, permanent B2B/B2C choice | **[CONFIRMED]** Exactly this — `convertLeadToCustomer(lead, customerType)`, single source of truth. No later re-classification path found. |
| B2B: no Project | B2B customers never get a Project | **[CONFIRMED GAP]** Nothing prevents it; Project's customer picker includes every customer. |
| B2C: Project mandatory with Project Type | Every B2C customer's work happens under a typed Project | **[CONFIRMED GAP]** `projectType` field exists with the right 3 values but is NOT marked required in the form and has no found validation. |
| Direct Project creation → auto-create Customer+Project | One master form | **[UNKNOWN]** Not traced this pass — `CustomerProjectForm.tsx` exists (seen in a prior session) but its master-form behavior wasn't re-verified here. |
| Quotation→Order auto-population | No re-entry, full traceability | **[CONFIRMED]** `convertQuotationToOrder` copies items/subtotal/tax/discount/ids faithfully — traceability (`sourceQuotationId`, `quotationId`) is real. |
| Quotation→Order orderType correctness | Should reflect the real customer type | **[CONFIRMED BUG]** Hardcoded `'B2C'` always (`quotationWorkflow.ts:176`). |
| Order→PI auto-population | Full auto-population | **[CONFIRMED]** `generatePIsFromOrder` correctly splits/copies from Order, real. |
| PI paid → stock blocked | Payment gates dispatch eligibility | **[CONFIRMED]** `markPIAsPaid` sets `Order.stockBlocked=true` atomically (transaction in prod mode). |
| Dispatch → verify → deliver → close | Full chain | **[CONFIRMED]** `requestDispatch→approveDispatch→executeAndVerifyDispatch→confirmDelivery→closeDispatch`, all real, stock ledger real. |
| Dispatch → Accounts → Bill | Bill/Tax Invoice generated after delivery | **[UNKNOWN]** `tax_invoices`/`taxInvoiceWorkflow.ts` exist and are chained in casePropagation from `proforma_invoices`, but the actual trigger from a closed Dispatch was not located. |
| B2B serial capture at Dispatch | Captured during loading/verification | **[UNKNOWN/PARTIAL]** `Dispatch.items[].serials` field exists; population call-site not fully traced. |
| B2C serial capture at QC-after-Installation | Captured post-install | **[CONFIRMED, BUT MISPLACED]** `captureInstallationSerial()` is real and does fire after installation — but it's anchored to the **Lead** document, not Project or a QC/Installation record. |
| Company B2B/B2C/Both mode gating workflows | Should restrict page/workflow availability | **[CONFIRMED MISSING]** No such field exists on Company at all. |
| Multi-company data isolation | No cross-company leakage | **[CONFIRMED GOOD]** 3-layer enforcement, real. |
| Multi-warehouse: Company→Warehouse→Employee→Stock | Real relationships | **[CONFIRMED PARTIAL]** Warehouse→Stock/Dispatch real; Warehouse→Employee absent. |
| HR connectivity | Employee→Company→Warehouse→Manager→Attendance/Payroll | **[CONFIRMED BROKEN]** warehouseId/managerId live on Users, not Employee; no FK joins them. |
| Super Admin isolation | Hardened, unique identity | **[CONFIRMED GOOD]** Real client+server (security rules) enforcement. |
| Manager team visibility | Manager sees team's records via real reporting relationship | **[CONFIRMED GAP]** Collapses to self-only for project-scoped collections. |
| Channel Partner segregation from B2B customer | Fully distinct | **[CONFIRMED GOOD]** Distinct collection/type, `userId`-keyed, own wallet/commission chain. |
| Documents universal but scoped | All business records carry documents | **[CONFIRMED PARTIAL]** Lead/Customer/Project/Survey/Engineering only; Order/Quotation/PI/Dispatch/Payment have zero document capability. |
| Case (`caseId`) universality | Every entity in the chain gets one | **[CONFIRMED BROKEN LINK]** `qc_checks`'s parent (`installations`) is never created anywhere in the app, breaking caseId propagation for QC→Commissioning→NetMetering→Subsidy, always. |
| Demo Mode realism | Represents the real business | **[CONFIRMED SEVERELY BROKEN]** See Section 15. |

---

## 5. Business Workflow Gap Matrix

| Area | Expected | Current Implementation | Status | Severity | Evidence |
|---|---|---|---|---|---|
| Project creation customer picker | B2B customers excluded | All customers shown, unfiltered | Gap | **CRITICAL** | `src/pages/Projects.tsx:134-154,814` |
| Quotation→Order `orderType` | Reflects real customer.type | Hardcoded `'B2C'` | Bug | **CRITICAL** | `src/lib/quotationWorkflow.ts:176` |
| Company business mode | B2B/B2C/Both field constrains workflows | Field does not exist | Missing | **CRITICAL** | grep, zero matches across `src/` |
| Demo Mode classification | Uses real `Customer.type` | Uses unrelated `customerType: Residential/Commercial` | Bug | **CRITICAL** | `scripts/demo/datasets/businessGraph.ts:24`; zero `B2B`/`B2C` literals in `scripts/demo/**` |
| Demo Mode Customer→Project attachment | Only B2C customers get Projects | 100% of demo customers (10/10) get one, unconditionally | Bug | **CRITICAL** | `businessGraph.ts:24` |
| caseId chain: qc_checks and downstream | Every entity gets a caseId | Permanently broken — parent `installations` collection never populated | Bug | **HIGH** | `src/lib/casePropagation.ts:48-52,75`; confirmed no `COLLECTIONS.INSTALLATIONS`, no writer anywhere |
| Installation entity | Project-scoped installation record | Fields live on Lead (`capturedSerialNumbers`, `installationChecklist`) | Design gap | **HIGH** | `src/lib/installationEngine.ts:176-229`; `src/pages/Installations.tsx:140` |
| Project Type mandatory | Required field | Not enforced (no `required`, no validation found) | Gap | **HIGH** | `src/features/projects/components/ProjectForm.tsx:105-110` |
| Manager "team" visibility | Real reporting-manager query scoping | Collapses to self-only for project-scoped collections | Gap | **HIGH** | `src/lib/projectVisibility.ts:57-63,69-98` |
| Non-project collection client filtering | Query-level scoping | Full company dataset fetched, filtered client-side after | Gap | **HIGH** | `src/lib/firestore.ts:130-135` |
| HR Employee↔Warehouse/Manager | Employee carries both | Fields live on Users, no FK to Employee | Gap | **HIGH** | `src/features/employees/hooks/useEmployees.ts:14-20`; `src/types/index.ts:51-67` |
| Documents on Order/Quotation/PI/Dispatch/Payment | Universal document capability | No field, no wiring, no legacy silo | Missing | **MEDIUM** | grep of `src/types/index.ts`, zero `documents` field on these interfaces |
| Dispatch→Bill trigger | Auto-generates Tax Invoice after close | Trigger site not located | Unknown | **MEDIUM** | Not confirmed either way |
| B2B serial capture at Dispatch | Populated during verification | Field exists, population site unverified | Unknown | **MEDIUM** | `src/lib/dispatchWorkflow.ts:38` |
| Order.orderType typing | Strict `'B2B'\|'B2C'` | `OrderType \| string` (widened) | Weak typing | **LOW** | `src/types/index.ts:346` |
| Customer type interface | Canonical `interface Customer` | No canonical interface found in `src/types/index.ts`; type is ad hoc/`any` in most call sites | Data-model gap | **MEDIUM** | absence confirmed by grep |
| Demo stage/status consistency | Logically consistent | Multiple contradictions (Order/PI payment-status disagreement, QC-fail not blocking Commissioning) | Bug | **MEDIUM** | `scripts/demo/datasets/businessGraph.ts:47,54,78` |
| Stage-order duplication | One canonical stage list | 5+ independently drifted stage-order arrays across the codebase | Gap | **MEDIUM** | see Section 16 |

---

## 6. B2B Audit

- Classification: real (`Customer.type==='B2B'`), set once at conversion. **[CONFIRMED]**
- Order creation direct path (`Orders.tsx`, `CustomerOrderForm.tsx`, `MobileOrderWorkspace.tsx`): all three correctly seed `orderType` from `customer.type`. **[CONFIRMED GOOD]**
- Quotation-originated Order path (`convertQuotationToOrder`): **always** writes `orderType:'B2C'`, even for a B2B customer's quotation. **[CONFIRMED BUG — this is the single highest-value fix candidate in the whole audit]**
- PI generation, payment, stock-block, dispatch request/approve/verify/deliver/close: all real, shared logic, no B2B-specific branch found or needed for these particular steps (financial/logistics mechanics are legitimately identical regardless of B2B/B2C). **[CONFIRMED — reuse is appropriate here]**
- Serial number capture during Dispatch: field exists (`serials: []` on dispatch items), actual population UI not traced to completion. **[UNKNOWN]**
- Delivery Challan → Accounts → Bill: Dispatch close and delivery confirmation are real; the explicit "Bill generated, B2B transaction complete" terminal step (tax invoice generation triggered by dispatch closure) was not located. **[UNKNOWN]**
- Project creation for B2B customers: not blocked anywhere. **[CONFIRMED CRITICAL GAP]**

## 7. B2C Audit

- Classification and Project linkage: Project has `customerId`, no B2B/B2C gate on creation. **[CONFIRMED GAP, shared with Section 6]**
- Project Type field: correct 3 values (`Residential`/`Commercial`/`Industrial`), not enforced mandatory. **[CONFIRMED GAP]**
- Survey→Engineering handoff: real, automatic, idempotent (`createEngineeringDraftFromSurvey`, existing-design check prevents duplicates) — already verified and fixed in a prior session phase. **[CONFIRMED GOOD]**
- Engineering→Quotation: `quotationItemsFromEngineering()` maps design specs to quotation line items. **[CONFIRMED]**
- Quotation→Order→PI→Payment→Dispatch: same shared functions as B2B (see Section 6) — appropriate reuse for the financial/logistics mechanics, but note the `orderType` hardcode means a B2C quotation converting to an Order is *coincidentally* correct only because B2C is the hardcoded default. If B2C classification ever needed to vary (it currently doesn't), this would break silently in the same way it already does for B2B.
- Installation stage: real (checklist + serial capture), but data-model-anchored to the Lead, not the Project. A Project created directly (no source Lead) would have **no** installation checklist/serial-capture record reachable, since `captureInstallationSerial` requires a `leadId`. **[CONFIRMED — a second consequence of the "direct Project creation has no caseId" gap noted earlier in this session's work]**
- QC: correctly project-scoped (`projectId` required), `installationId` optional — so QC does not hard-fail from the missing `installations` collection, but does mean `qc_checks.installationId` is effectively always empty in practice, breaking caseId propagation downstream (Section 14). **[CONFIRMED]**
- Commissioning, Net Metering, Subsidy, Handover, AMC, Service Tickets: real pages/collections/workflows exist and are registered in the caseId `PARENT_CHAIN`; not individually deep-audited stage-by-stage in this pass beyond existence + chain registration. **[PARTIALLY VERIFIED — do not assume full correctness beyond what's stated]**

## 8. B2B/B2C Contamination Audit (extremely important)

Three independent, confirmed contamination vectors, all traced to root cause:

1. **Project creation**: `Projects.tsx` fetches `getAll(COLLECTIONS.CUSTOMERS)` unfiltered and passes the full list to `ProjectForm`'s customer picker. A B2B customer is fully selectable. No downstream check (in `ProjectForm.tsx`, `CustomerProjectForm.tsx`, or any project workflow file) references `customer.type`/B2B/B2C at all — confirmed via direct grep returning zero matches.
2. **Order classification drift**: two Order-creation code paths disagree. Direct creation honors `customer.type`; Quotation-conversion overwrites it with a hardcoded `'B2C'`. This means **an Order's `orderType` is not a reliable signal of the real transaction type** — any report, filter, or dashboard that trusts `order.orderType` (e.g., `Quotations.tsx:605`'s `b2cOrders = orders.filter(o => o.orderType !== 'B2B')`) is working off potentially wrong data for every quotation-originated order.
3. **Demo Mode's parallel, unrelated schema**: demo customers use `customerType: 'Residential'|'Commercial'` (a Project-Type-shaped label) with zero instances of the real `B2B`/`B2C` values anywhere in the demo dataset. Since the demo generator also gives every customer a Project unconditionally, the demo dataset is not merely "unlabeled" — it structurally **cannot** represent a B2B customer (no Project) at all. Every demo customer looks B2C-shaped by construction.

No evidence was found of the reverse direction (a B2C customer being blocked from B2C-only workflows) — the leakage is one-directional: B2B customers gaining access to B2C-shaped workflows (Projects), not B2C customers gaining access to B2B-only ones.

## 9. Company Business Mode Audit

**[CONFIRMED MISSING, absolute.]** Grepped `businessMode|companyMode|workflowType` across all of `src/` — zero matches. Neither `CompanyConfig` (`src/types/index.ts:70-103+`) nor the lighter `CompanyDoc` (`src/lib/firestore.ts:23-32`, `src/features/company/hooks/useCompanies.ts:23-32`) has any such field. No route, query, permission check, Demo Mode gate, report, dashboard, or global-search filter branches on it, because it does not exist to branch on. This is not a partial implementation or a UI-only omission — the concept is entirely absent from the data model.

## 10. Multi-Company Audit

**[CONFIRMED GOOD — the strongest area of the codebase.]** Three independent, layered enforcement mechanisms:
1. `companyScopedQuery()` (`src/lib/firestore.ts:29-40`) — adds `where('companyId','==',companyId)` to reads.
2. `applyAccessFilters()` (`firestore.ts:83-148`) — re-checks `docData.companyId !== activeCompanyId` client-side as defense-in-depth.
3. Firestore Security Rules (`firestore.rules`) — every collection gates on `sameCompany(data)`; an unrecognized/new collection defaults (via the catch-all rule) to company-scoped, not open.

`activeCompanyId==='all'` does not bypass rules to show cross-company data in one query; it only resolves to the current user's own companyId. Whether a genuine "Super Admin views all companies at once" UI mode exists (e.g., iterating per-company queries) was **not traced** — **[UNKNOWN]**.

## 11. Multi-Warehouse Audit

- `Warehouse` (`src/features/warehouses/types/index.ts:3-15`) extends `BaseRecord` → real `companyId`. Own fields: `name, code, address, city, state, pincode, managerName, managerPhone, capacity, status, notes`.
- `managerName`/`managerPhone` are free-text strings, **not** a foreign key to a User/Employee. **[CONFIRMED GAP]**
- Warehouse→Stock: real, enforced FK (`stockWorkflow.ts` throws if `warehouseId` missing, builds `stockSummaryId(companyId,productId,warehouseId)`). **[CONFIRMED GOOD]**
- Warehouse→Dispatch: real, `warehouseId` used consistently in dispatch requests/verification. **[CONFIRMED GOOD]**
- Warehouse→Employee: **[CONFIRMED ABSENT.]** `Employee` (`EMPLOYEE_FORM_DEFAULT`, `src/features/employees/hooks/useEmployees.ts:14-20`) has no `warehouseId` field. "Warehouse-wise employee count" is not computable from current data — no aggregation code found anywhere in `src/features/warehouses/**`.
- Interestingly, `warehouseId` and `managerId` DO exist, but on `AppUser` (`src/types/index.ts:59,63`; `src/pages/Users.tsx:32,617`) — the authentication identity, not the HR/Employee domain record. See Section 13.

## 12. User/Role/Permission Audit

- **Users are a genuine universal human record model.** `COLLECTIONS.USERS` uses deterministic phone-keyed IDs (`MUSR-{companyId}-{phone}`) shared across Lead/Customer/Employee/Driver/Vendor/InstallationPartner/FieldAgent via `PROJECTION_ROLE_MAP` (`src/lib/userIdentity.ts:202-211`). A person accumulates `roles: string[]`/`linkedModules: string[]` as they acquire relationships (e.g., a converted Lead keeps both Lead and Customer roles on one doc). **[CONFIRMED GOOD]**
- Auth identity vs business identity: `createUserProjection`/`updateUserProjection` explicitly block overwriting `id/userId/companyId/roles/linkedModules/profile/filters/createdAt/createdBy/password` (`userIdentity.ts:342-359`) — business-record edits cannot corrupt identity fields. **[CONFIRMED GOOD]** One exception: Super Admin's `createOwnerAppIdentity()` fabricates a client-side pseudo-user rather than a real Users doc (`ownerAccess.ts:26-37`) — a deliberate, documented special case, not a bug.
- Role hierarchy is data-driven (Firestore role documents), not hardcoded strings, with a legacy-string compatibility map (`EXACT_ROLE_COMPATIBILITY`, `permissions.ts:46-63`): `admin→Admin, director→Director, sales→Sales, accounts→Accounts, warehouse→Warehouse, hr→HR, operations→Operations, partner→Partner, manager→Manager, management→Admin`, plus per-role `visibility: 'all'|'team'|'self'`.
- **Manager "team" scoping is not real for project-scoped collections.** `isProjectScopedRole()` treats both `'team'` and `'self'` as the same `'assigned'` mode (`projectVisibility.ts:57-63`); the only fields ever checked are `assignedSurveyor/assignedInstaller/salesOwner/designerId` matched against the current user's own id. A manager sees only their own assigned records, identical to an individual contributor. **[CONFIRMED GAP]**
- For non-project collections, `applyAccessFilters()`'s `'team'` branch does check `teamMemberIds.includes(ownerId)` (`firestore.ts:134`) — but `teamMemberIds` is a precomputed store array whose own derivation (whether it's built from a real reporting-manager query) was **not traced** — **[UNKNOWN]**.
- **Individual/Team Member enforcement**: real query-level `where()` constraints exist for project-scoped collections (`buildProjectVisibilityQueryPlan()`, `projectVisibility.ts:100-125`). For non-project collections (Leads, Customers, Orders, Tasks), enforcement is **client-side post-filter only** — the full company dataset is fetched via `getAll()` before `applyAccessFilters()` filters in memory. This means the client receives records a Team Member is not supposed to see, and the restriction is enforced only in JS after the fact. **[CONFIRMED — a genuine data-exposure risk, see Section 22]**
- **Super Admin protection is real and dual-layered.** Client: `SuperAdminRoute`/`ownerAccess.ts` checks the live Firebase Auth SDK session email. Server: `firestore.rules`'s `isOwnerIdentity()` compares `request.auth.token.email` (a verified, non-forgeable claim) against the literal `shreeniwas.tripathi0@gmail.com`, and additionally blocks any other user document from ever claiming that email. **[CONFIRMED GOOD — not spoofable]**
- **Tasks**: `Task.assignedToId: string` is unconstrained — no enum/reference restricting assignment to Employee/User identities (`types/index.ts:428`). Whether the assignment UI's option list is Employees-only was not verified this pass. **[UNKNOWN]**. `Task.entityType`/`entityId` (lines 434-435) confirm it can tag universal records (Lead/Customer/Order) while nominally owned by `assignedToId`/`createdBy` — the tagging half of the requirement works.
- **Notifications**: real, confirmed scoping. `sendNotification()` requires both `recipientUserId` and `companyId`; every doc stores `companyId`, `recipientUserId`, and a `visibleTo` array of exactly `[recipientUserId, createdBy]` — not broadcast (`notifications.ts:127,168-184`). Deep-link fields (`entityType`/`entityId`) are always stored. A dedup hash prevents notification spam within a 2-minute window. **[CONFIRMED GOOD]**
- **Channel Partner notification claim is stale**: the architecture bible doc claims Channel Partner notification types are "defined but not wired in" — **[CONFIRMED FALSE/OUTDATED]**. 21 Partner/Commission/Settlement/Fraud/Case notification types exist in the `NotificationType` enum and are actively referenced across 18 real workflow files (`channelPartnerSettlement.ts`, `commissionRecalculation.ts`, `tierEvaluation.ts`, `autoSettlementScheduler.ts`, etc.).
- **Channel Partner data model**: fully distinct from Customer — keyed by `userId` (not a Customer id), own `firmName/kycStatus/tier/walletBalance/totalCommissionEarned`. `PartnerWalletTransaction`, `CommissionRule`, `CommissionRecord`, `SettlementRecord` all share a real `partnerId` FK with genuine ledger/audit-trail fields (`balanceBefore/balanceAfter`, approval/payment history) — not stubs. **[CONFIRMED GOOD, mature implementation]**
- **Channel Partner vs B2B Customer segregation**: **[CONFIRMED — no overlap.]** No shared collection, no `type` field crossover.

## 13. HR/Employee/Warehouse Audit

- `Employee` (`EMPLOYEE_FORM_DEFAULT`, `useEmployees.ts:14-20`): `name, phone, email, dob, gender, department, designation, role, joinDate, salary, bankAccount, bankIfsc, bankName, panNumber, aadharNumber, address, city, state, status, emergencyContact, emergencyPhone`. `companyId` set correctly at creation. **No `warehouseId`, no `managerId`/`reportingManagerId`, no link field to a `AppUser`/Users record at all.**
- `Attendance` (`ATTENDANCE_FORM_DEFAULT`, `src/features/hr/hooks/useHR.ts:14-17`): `employeeId, employee, date, status, inTime, outTime, notes`. `companyId` is injected centrally by `createDocWithId()` rather than set explicitly in the HR module — present, just implicit.
- `Payroll` (`PAYROLL_FORM_DEFAULT`, `useHR.ts:64-68`): `employeeId, employee, month, year, basicSalary, hra, allowances, deductions, tds, advance, netSalary, mode, status, notes`. Same implicit companyId pattern.
- `AppUser` (`src/types/index.ts:51-67`) is where `warehouseId` and `managerId` actually live (confirmed in `Users.tsx:32,617`'s "Reporting Manager" dropdown).
- **Conclusion: Employees (HR record) and Users (auth/identity record) are two separate, unlinked documents for the same real person.** There is no `userId` on Employee and no `employeeId` on AppUser — confirmed by grep, zero matches either direction. Attendance and Payroll key correctly off `employeeId`, but since Employee itself carries no warehouse/manager data, **warehouse-wise or reporting-manager-wise Attendance/Payroll rollups are not possible today.** This is exactly the "confusing authentication identity with employee identity" risk the brief warned against, confirmed as real and structural. **[CONFIRMED CRITICAL GAP]**

## 14. Document/Case Relationship Audit

- Shared Documents system (`src/lib/caseDocuments.ts`, `COLLECTIONS.DOCUMENTS`) is wired into exactly 5 places: Lead, Customer, Project workspace DocumentsSections, plus Survey and Engineering (mirrored writes). **[CONFIRMED, exhaustive grep]**
- **Order, Quotation, ProformaInvoice, Dispatch, Payment have no document capability at all** — not a legacy silo, not the shared system, nothing. No `documents` field exists on any of these interfaces in `src/types/index.ts`. **[CONFIRMED GAP — larger than expected]**
- Case propagation full chain, quoted verbatim from `src/lib/casePropagation.ts:37-60` (`PARENT_CHAIN`):
  ```
  leads:                     root (no parent)
  customers:                 parent=leads,                    fk=sourceLeadId
  projects:                  parent=customers,                fk=customerId
  surveys:                   parent=projects,                 fk=projectId
  engineering_designs:       parent=projects,                 fk=projectId
  quotations:                parent=customers,                fk=customerId
  orders:                    parent=quotations,                fk=quotationId
  proforma_invoices:         parent=orders,                    fk=orderId
  payments:                  parent=orders,                    fk=orderId
  dispatch:                  parent=orders,                    fk=orderId
  installations:             parent=projects,                 fk=projectId
  qc_checks:                 parent=installations,             fk=installationId
  commissioning_records:     parent=qc_checks,                fk=qcId
  net_metering_applications: parent=commissioning_records,     fk=commissioningId
  subsidy_applications:      parent=net_metering_applications, fk=netMeteringId
  project_handovers:         parent=projects,                 fk=projectId
  amc_contracts:             parent=projects,                 fk=projectId
  service_tickets:           parent=projects,                 fk=projectId
  generation_readings:       parent=projects,                 fk=projectId
  purchase_orders:           parent=projects,                 fk=projectId
  goods_receipts:            parent=purchase_orders,           fk=purchaseOrderId
  tax_invoices:              parent=proforma_invoices,         fk=sourcePiId
  ```
- **Confirmed permanently broken link**: `installations` is declared as `qc_checks`'s parent, but **no code anywhere creates a document in an `installations` collection** — there isn't even a `COLLECTIONS.INSTALLATIONS` constant in `src/lib/firebase.ts`. The real "Installation" pages (`Installations.tsx`, `InstallationWorkspace.tsx`, `MobileInstallationsWorkspace.tsx`) all operate on `COLLECTIONS.LEADS` instead. Consequently `propagateCaseIdFromChain('qc_checks', id)` always reads `entity['installationId']` as `undefined` and returns `null` — **every QC record, and everything chained after it (Commissioning, Net Metering, Subsidy), permanently never receives a caseId.** This was independently confirmed both by direct code reading (this session) and by a parallel research pass over the demo dataset (zero `installations` documents generated anywhere). **[CONFIRMED, high-confidence, root-caused]**
- Directly created Customers/Projects (no source Lead) also never receive a caseId — confirmed in an earlier phase of this same audit session (`useCustomers.ts`'s create path never calls case propagation).

## 15. Demo Mode Data Audit

Demo Mode is confirmed, structurally, to not represent the real business model at all with respect to B2B/B2C:

1. **Wrong schema entirely.** `scripts/demo/datasets/businessGraph.ts:24` sets `customerType: i%3 ? 'Residential' : 'Commercial'` on every demo customer — this is a Project-Type-shaped label, not the real `Customer.type: 'B2B'|'B2C'` field. Grepping `B2B|B2C` across the entire `scripts/demo/` tree returns **zero matches**. Every demo customer is unclassified with respect to the real model.
2. **100% Project attachment.** All 10 demo customers (`CUS-1`..`CUS-10`) receive exactly one Project each, unconditionally, in the same generation loop — there is no code path that produces a B2B-shaped (material-only, no-Project) customer at all.
3. **Commercial/Industrial vs B2B conflation, reproduced structurally.** Demo Projects never set a `projectType` field (only `systemType: 'Hybrid'|'On-grid'`), while `customerType`/`segment` reuse the word "Commercial" — the exact ambiguity the audit brief warns against is baked into the seed-data generator itself.
4. **Orders/Quotations/PIs/Payments layered onto the same 10 customers that already have Projects** (`buildSalesFinance()`, customers `CUS-3`..`CUS-10`) — there is no separate B2B-only cohort (Orders without Projects) anywhere in the demo dataset, directly contradicting the canonical B2B flow.
5. **Stage/status inconsistencies found:**
   - Orders `i=6,7`: `status:'Partial Dispatch'` while `paymentStatus:'Pending'` — dispatch proceeding with zero payment recorded.
   - At `i=8`: Order's `paymentStatus='Pending'` but the linked ProformaInvoice's `paymentStatus='Partial'` for the same deal — a direct Order↔PI disagreement.
   - QC `i=3`: `status='failed'`, yet the corresponding Commissioning record proceeds to `'completed'` regardless — QC failure does not block Commissioning in the seed data.
6. **No runtime validation anywhere.** The generator is pure literal object construction from a loop index; `demoCapabilityPolicy.ts`/`demoSession.ts`/`sandboxReset.ts` gate session/access concerns only, not data correctness.

Count: **10 of 10 demo customers (100%)** show the Project-attachment contamination pattern; **0 of 10** carry any value in the real `B2B`/`B2C` schema at all.

## 16. Workflow Stage Census

Known, already-confirmed duplicated Project/EPC stage-order arrays (from a prior phase of this same session, re-cited here for completeness):

| # | File | Array/Object | Stage Count |
|---|---|---|---|
| 1 | `src/hooks/useProjectStage.ts` | `LIFECYCLE` | 13 |
| 2 | `src/lib/projectStageTransition.ts` | `PROJECT_STAGE_ORDER` | 17 |
| 3 | `src/components/projects/ProjectJourneyTimeline.helpers.ts` | `JOURNEY_STAGE_DEFINITIONS` | 12 |
| 4 | `src/lib/analyticsCore.ts` | `PROJECT_STAGE_DASHBOARD_ORDER` | 17 |
| 5 | `src/lib/anomalyDetection.ts` | local `stageOrder` | 16 |
| 6 | `src/lib/quotationWorkflow.ts` | `PROJECT_STAGES` (local const, line 12) | 17 |
| 7 | `src/lib/dispatchWorkflow.ts` | `PROJECT_STAGE_ORDER` (local const, line 11) | 17 |

**Newly found this pass (files 6-7 above) — a 6th and 7th independent copy of essentially the same stage-order list**, each locally re-declared rather than imported from a shared constant. Files 6 and 7 both list 17 stages matching file 2's `PROJECT_STAGE_ORDER`, but are separately maintained copies — if file 2 is ever edited, files 6/7 will silently drift. **[CONFIRMED — do not assume these three 17-stage lists stay in sync; they are three separate literal arrays today.]**

Additional areas flagged as containing stage/status concepts but not fully extracted as literal arrays this pass (file-level only, **[UNVERIFIED CONTENT]**): `src/pages/CaseSearch.tsx`, `src/pages/mobile/MobileCaseSearch.tsx`, `src/pages/CasesDash.tsx`, `src/features/cases/utils/caseAnalytics.ts`, `src/features/procurement/services/purchaseOrderWorkflow.ts` (a separate, legitimate Purchase-Order-lifecycle stage concept, not the Project/EPC list), `src/features/reports/types/index.ts`'s `StageDistributionItem.stage: string` (untyped free string, no fixed enum), and partner-facing stage displays (`PartnerPerformance.tsx`, `partner/PartnerDashboard.tsx`).

Separately: the B2B Order/Dispatch/PO lifecycles (`status: Pending→Confirmed→Partial Dispatch→Dispatched→Delivered→Closed`, etc.) are a **distinct stage family from the Project/EPC list** — they are status strings on Order/Dispatch/PurchaseOrder documents, not part of the 17-stage Project list, and should not be conflated with it in future correction work.

## 17. Data Model Audit

- No canonical `interface Customer` was found in `src/types/index.ts` — Customer is handled as loosely-typed/`any` at most call sites. **[CONFIRMED GAP]**
- `Order.orderType?: OrderType | string` — the `| string` widening defeats the purpose of the `OrderType` union; nothing stops an arbitrary string being written. **[CONFIRMED]**
- `Project.projectType: string` (required in the TS interface, `src/features/projects/types/index.ts:18`) defaults to `''` and is never validated as non-empty before save. **[CONFIRMED]**
- `Company`/`CompanyConfig` has no business-mode field (Section 9).
- `Employee` has no `warehouseId`/`managerId`/`userId` (Section 13).
- `Task.assignedToId: string` unconstrained (Section 12).
- Order/Quotation/PI/Dispatch/Payment have no `documents` field (Section 14).
- `casePropagation.ts`'s `installations` chain entry maps to a raw string `'installations'` rather than a `COLLECTIONS.*` constant — the only entry in the entire `PARENT_CHAIN` map that does this, itself a signal that this entity was never actually built out. **[CONFIRMED]**

## 18. Business Logic Audit

- `convertLeadToCustomer`, `createQuotation`, `convertQuotationToOrder`, `generatePIsFromOrder`, `markPIAsPaid`, `requestDispatch`, `approveDispatch`, `executeAndVerifyDispatch`, `confirmDelivery`, `closeDispatch`, `refundPayment`, `stockIn` are all real, working, transactional (where money/stock is involved) functions — this is a mature financial/logistics core. **[CONFIRMED GOOD]**
- The one confirmed logic bug in this core: `convertQuotationToOrder`'s hardcoded `orderType:'B2C'` (Section 6/8).
- `validateDispatchIntegrity()` exists and performs real consistency checks (delivered-without-deliveredAt, OTP-consumed-without-delivered, reconciliation-pending-but-already-settled) — a good defensive pattern, worth reusing as a model for similar checks elsewhere. **[CONFIRMED GOOD PATTERN]**
- `refundPayment()` is a real, transactional, FIFO-style reversal across Payment→Order→PI — more complete than the architecture bible's "Missing Workflows" table suggested (that doc claims payment refund/reversal is missing; it is not — **[CONFIRMED STALE DOC]**).

## 19. Page/Module Audit

Confirmed real, working pages/modules touched this pass: Projects, Orders, Quotations, Invoices(PI), Dispatch (desktop + mobile), Installations (desktop + mobile + partner), QC, Commissioning, Net Metering, Subsidy, Project Handover, Employees, HR (Attendance/Payroll), Users, Warehouses, Channel Partners/Commission/Settlement, Case Search/Analytics/Reports, Notifications. Not all were opened line-by-line; existence + primary data-source were confirmed for each cited above.

## 20. Reusable Component/Service Audit

- `lib/workflow.ts`'s generic helpers (`text`, `notifyUsers`, `usersByRole`, `logActivity`, `hashOTP`, `generateDeliveryOTP`, `isDispatchImmutable`) are correctly shared across every workflow file touched. **[CONFIRMED GOOD]**
- `caseDocuments.ts`'s `resolveDocumentsFor()` pattern (match-by-any-of-several-FK-fields) is a good, reusable model that should be extended to Order/Quotation/PI/Dispatch/Payment rather than inventing a new document mechanism for them (Section 14 gap).
- `validateDispatchIntegrity()` (Section 18) is a good reusable pattern for validating other entity chains (e.g., could inform a `validateQCIntegrity()`/`validateInstallationIntegrity()`).
- The permission layer's `buildProjectVisibilityQueryPlan()` (real query-level scoping) should be the template extended to non-project collections, rather than continuing the client-side-post-filter pattern in `applyAccessFilters()`.

## 21. Missing Business Capabilities

- No Company business-mode field/enforcement (Section 9).
- No real Manager/team-level data scoping for project-scoped collections (Section 12).
- No query-level (only client-post-filter) scoping for non-project collections (Section 12/22).
- No Employee↔Warehouse, Employee↔ReportingManager relationship (Section 13).
- No document capability at all for Order/Quotation/PI/Dispatch/Payment (Section 14).
- No real `installations` collection — the entire Installation stage is a set of fields bolted onto Lead (Section 3b/14).
- No confirmed Order-cancellation, Stock-transfer-between-warehouses, Return/reverse-dispatch, or Partial-delivery workflow (per the architecture bible's "Missing Workflows" table — **[UNVERIFIED this pass, carried over from prior doc, not re-confirmed against current code]**).
- No canonical `interface Customer`.

## 22. Security/Tenancy Risks

- **Data over-fetch for non-project collections**: `getAll()` retrieves the entire company's records for Leads/Customers/Orders/Tasks before `applyAccessFilters()` narrows visibility client-side. A Team Member's browser receives records (e.g., other reps' customers) it should never see, relying entirely on the UI/JS layer not to render them. This is a real information-disclosure risk (a compromised or modified client could read the full company dataset for these collections), not merely a UX nicety. **[CONFIRMED, HIGH]**
- **Manager team-visibility gap** (Section 12) means a Manager role, as currently implemented, provides no more access than an individual contributor for project-scoped work — a functional gap more than a security hole, but worth noting since it may be silently relied upon by admins assuming managers *can* see their team's data.
- Multi-tenancy and Super Admin isolation are otherwise strong (Section 10/12) — no cross-company leakage vector found.

## 23. Top 20 Critical Issues (ranked)

**P0 — business-breaking:**
1. `convertQuotationToOrder()` hardcodes `orderType:'B2C'`, corrupting the B2B/B2C signal on every quotation-originated order (`quotationWorkflow.ts:176`).
2. Project creation has no B2B/B2C guard — B2B customers can have Projects created against them today (`Projects.tsx:134-154,814`).
3. Company has no business-mode (B2B/B2C/Both) field or enforcement anywhere (Section 9).
4. Demo Mode uses a completely different classification schema than production and gives every demo customer a Project unconditionally — Demo Mode cannot currently demonstrate the correct business model at all (Section 15).
5. The `installations` collection in the caseId chain is never populated anywhere in the app, permanently breaking caseId propagation for QC/Commissioning/NetMetering/Subsidy (Section 14).

**P1 — high risk:**
6. Non-project collections (Leads/Customers/Orders/Tasks) are scoped only by client-side post-filtering — full company data reaches the client before filtering (Section 22).
7. Manager "team" visibility collapses to self-only for all project-scoped collections (Section 12).
8. Employee has no `warehouseId`/`managerId`/link-to-User — HR reporting/warehouse rollups are structurally impossible (Section 13).
9. Project Type is not enforced as mandatory despite being a core classification field (Section 17).
10. "Installation" as an entity is really a set of fields on the Lead document, not a Project-scoped record — directly-created Projects (no source Lead) have no reachable installation/serial-capture path (Section 3b/8).
11. Order/Quotation/PI/Dispatch/Payment have zero document-attachment capability (Section 14).
12. No canonical `Customer` interface — the most business-critical entity in the system is untyped (Section 17).

**P2 — medium:**
13. `Order.orderType` is loosely typed (`OrderType | string`), permitting arbitrary values (Section 17).
14. Demo Mode stage/status combinations are internally inconsistent (Order/PI payment-status disagreement, QC-fail-doesn't-block-Commissioning) (Section 15).
15. Seven independently-maintained copies of the Project/EPC stage-order list exist, three of which (17-stage each) can silently drift from one another (Section 16).
16. Dispatch serial-number population (B2B) is not confirmed to be wired end-to-end (Section 6).
17. Dispatch→Bill (Tax Invoice) auto-generation trigger point not located — unknown if this final B2B step is automated or manual (Section 6).

**P3 — improvement:**
18. Architecture-bible doc claims (Channel Partner notifications "not wired", Payment refund "missing") are stale relative to current code — the doc corpus needs a refresh pass.
19. `casePropagation.ts`'s `installations` entry uses a raw string collection name instead of a `COLLECTIONS.*` constant, an internal inconsistency signaling the entity was never finished.
20. Warehouse `managerName`/`managerPhone` are free-text rather than a real User/Employee reference.

## 24. Recommended Correction Order (dependency order only — NOT implementation)

1. **Define Company business mode** first — nearly every other gating decision (Project creation, Order creation, Demo Mode generation, permissions) will want to reference it, so it should exist before anything is changed that depends on it.
2. **Fix `convertQuotationToOrder`'s hardcoded `orderType`** — a narrow, low-risk, high-value fix with no architectural dependency on anything else in this list.
3. **Gate Project creation's customer picker by `customer.type`** — depends on nothing else being done first, but should be done consistently with whatever Company-mode decision comes out of step 1 (e.g., does "Both" mode still forbid B2B-customer Projects? that policy decision precedes the code change).
4. **Decide and implement the real `Installation` entity** (Project-scoped, not Lead-anchored) — this unblocks the caseId chain fix in step 5 and is a prerequisite for it.
5. **Fix the caseId chain break at `qc_checks`↔`installations`** — depends on step 4 existing first.
6. **Consolidate the Project/EPC stage-order list to one shared constant** — independent of the above, but should be done before any workflow-stage logic is touched in steps 1-5, so those changes are made against a single source of truth rather than 7 copies.
7. **Enforce Project Type mandatory** — low-risk, can be done any time after step 1 (so the "Commercial/Industrial GST-not-mandatory" policy is settled first).
8. **Fix Manager team-visibility and non-project-collection query-level scoping** — independent security/permissions track, no dependency on 1-7.
9. **Link Employee↔User (warehouseId/managerId) or migrate those fields onto Employee** — independent HR-track fix.
10. **Extend the Documents system to Order/Quotation/PI/Dispatch/Payment** — reuse `caseDocuments.ts`'s existing pattern; no dependency on the above.
11. **Rebuild Demo Mode** — deliberately last, since it should generate data using the *corrected* schema/rules from steps 1-9, not be patched twice.

## 25. Future Implementation Document Requirements

Before implementation begins, produce:
- A **Company Business Mode specification** — exact enum values, exact enforcement points (routes, queries, Demo Mode, permissions, reports), and the policy for "Both" mode companies.
- An **Installation entity specification** — schema, Project-scoping, relationship to QC, migration plan for existing Lead-anchored data (`capturedSerialNumbers`/`installationChecklist`).
- A **single canonical Project/EPC stage-order module** design, with a migration plan for the 7 existing copies.
- A **Customer canonical type** specification (the interface itself, plus which fields are B2B-only vs B2C-only vs shared).
- A **Documents-for-Order/Quotation/PI/Dispatch/Payment** extension spec, reusing `resolveDocumentsFor()`'s pattern.
- A **Permissions query-level scoping** spec for non-project collections, and a **real Manager/team reporting-relationship** spec.
- An **Employee↔User linkage** spec (or single-record consolidation) for HR.
- A **Demo Mode regeneration spec**, written only after all of the above are finalized, since it must model the corrected rules, not the current ones.

---

## Appendix — Critical Audit Questions A–AM

*(Each answered per available evidence above; "See §N" references the relevant section for supporting detail. Where evidence was insufficient, marked UNKNOWN.)*

**A. How many distinct business workflows currently exist?** Two primary (B2B material distribution, B2C EPC installation) sharing common financial/logistics infrastructure (Quotation→Order→PI→Payment→Dispatch), plus adjacent workflows: Channel Partner/Commission, HR (Employee/Attendance/Payroll), Case management, Notifications, Documents. See §3.

**B. How many stages per workflow?** B2C Project/EPC: 13, 16, or 17 depending on which of the 7 duplicated arrays is consulted (§16) — the brief's instruction "do not guess" is honored by reporting this as unresolved drift, not a single number. B2B Order/Dispatch: separate, shorter status-string lifecycles (Pending→Confirmed→Dispatched→Delivered→Closed family), not part of the Project stage list.

**C. What are the actual current B2B and B2C workflows?** See §3a/3b diagrams.

**D. Where does B2B/Commercial-Industrial-B2C confusion occur?** Demo Mode's `customerType` field (§15) and the absence of any Company business-mode gate (§9) are the two structural sources.

**E/F. Which B2B customers incorrectly have Projects? Count?** In Demo Mode: structurally, all 10/10 (§15), though none carry a real B2B value to test against, which is itself the finding. In production: not countable without a live database query — **[UNKNOWN, requires runtime data access this audit did not have]**; the code-level gap (no filter exists) is confirmed regardless of current count.

**G. Which B2C customers can enter B2B workflows and vice versa?** No B2C→B2B leakage vector found; leakage is one-directional (B2B→Project access), see §8.

**H. Does Company mode control workflow availability?** No — the field doesn't exist (§9).

**I. Does customer classification enforce segregation at service/query level?** No — confirmed absent at Project creation (§8); present and correct at direct Order creation, absent at Quotation-conversion Order creation (§6).

**J. Is B2B serial-number-at-Dispatch correct?** Field exists; end-to-end population unverified (§6, UNKNOWN).

**K. Is B2C serial-number-at-QC-after-Installation correct?** Timing is correct (fires after installation); anchoring is wrong (Lead, not Project/Installation record) (§7).

**L. Does Quotation→Order auto-populate without duplication?** Yes (§4/6), except the `orderType` field.

**M. Does Order→PI auto-populate?** Yes, fully (§4/18).

**N. Is Payment→Paid→Dispatch correct?** Yes — `markPIAsPaid` correctly sets `stockBlocked:true` gating dispatch (§4).

**O. Is Dispatch→Challan→Accounts→Bill correct?** Dispatch/delivery/close chain is real; the Bill/Tax-Invoice trigger from closed dispatch was not located (§6, UNKNOWN).

**P. Is Customer→Project relationship correct?** Structurally present (`customerId` FK) but unguarded by classification (§8).

**Q. Does direct Project creation create Customer+Project together via one master form?** Not re-verified this pass — **[UNKNOWN]**.

**R. Is Project Type mandatory?** No, not enforced despite being intended as such (§17).

**S. Are Residential/Commercial/Industrial correctly treated as B2C?** Yes in the type definition (`PROJECT_TYPES`); yes in the sense that no code conflates Project Type with B2B — but Demo Mode's separate `customerType` field does reuse the word "Commercial" in a confusing, adjacent way (§15).

**T. Do org/GST fields incorrectly classify as B2B?** No such logic found anywhere (§2/9) — this is a correctly-avoided trap, not a gap.

**U. Does Project→Survey→Engineering work?** Yes, confirmed real and already fixed/verified in a prior session phase (§7).

**V. Does Survey→Engineering handoff avoid duplication?** Yes, idempotent, confirmed (§7).

**W. Are downstream B2C stages (Installation onward) connected?** Partially — QC/Commissioning are Project-scoped and real; Installation itself is Lead-anchored, not Project-scoped, breaking the chain at exactly that joint (§3b/14).

**X. Do Multi-Company and Multi-Warehouse work?** Multi-Company: yes, strongly (§10). Multi-Warehouse: partially — Stock/Dispatch real, Employee relationship absent (§11).

**Y. Can employee→company→warehouse be determined?** Company: yes. Warehouse: no, not from the Employee record (§13).

**Z. Is warehouse-wise employee reporting possible?** No (§13).

**AA. Are Attendance/Payroll connected to Employees?** Yes, via `employeeId`; but not to warehouse/manager, since Employee itself lacks those fields (§13).

**AB. Are Tasks restricted to internal employees?** Not confirmed enforced — `assignedToId` is an unconstrained string (§12, UNKNOWN whether the UI picker itself restricts it).

**AC. Are Notifications/Documents universal-but-scoped?** Notifications: yes, well-scoped (§12). Documents: scoped correctly where implemented, but implemented for only 5 of the many entity types that should have it (§14).

**AD. Do roles enforce company/team/assigned visibility?** Company: yes. Assigned (individual): yes, for project-scoped collections; client-side-only for others. Team: no, collapses to assigned/self (§12).

**AE. Is Super Admin isolated correctly?** Yes, dual-layer, non-spoofable (§10/12).

**AF. Is Demo Mode realistic?** No, severely broken with respect to B2B/B2C (§15).

**AG. Count of invalid Demo records?** 10 of 10 demo customers show the Project-attachment contamination pattern; additional specific status-inconsistency instances cited in §15 (items 5a-5c).

**AH. What pages/fields/models are reusable?** `caseDocuments.ts`'s matching pattern, `validateDispatchIntegrity()`'s consistency-check pattern, `buildProjectVisibilityQueryPlan()`'s real query-scoping pattern, the Users universal-identity model (§20).

**AI-AM. Missing business concepts** (Company mode, real Installation entity, canonical Customer type, Employee-Warehouse/Manager linkage, Documents-for-financial-entities): see §21 for the full list.

---

**STOP.** No implementation, refactoring, or modification has been performed. Per the brief's Rule #22 and Final Stop Condition, this document establishes the current-state baseline only. Awaiting the next instruction before any correction work (Demo Mode, B2B, B2C, Project Workspace, Survey, Engineering, or Quotation) begins.
