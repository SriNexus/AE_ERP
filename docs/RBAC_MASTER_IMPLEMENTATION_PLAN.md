# RBAC Master Implementation Plan

**Status:** PLANNING ONLY — no RBAC code, rules, routes, or permissions have been changed as part of this document.
**Baseline commit:** `4663494` (branch `main`, pushed to `origin/main`; `git rev-parse HEAD == git rev-parse origin/main`).
**Input evidence:** `BRAIN.md` (pre-existing forensic audit) + the "Neozy Access Ledger" RBAC audit (published this engagement) — both **re-verified against current source in this pass**, not copied. Where this document's finding differs from either prior document, this document's finding is the current one, and the discrepancy is noted.
**Audience:** any engineer implementing Phase 1–10 below, in order, without needing to rediscover the RBAC architecture first.

---

## 0. How to use this document

1. Read §1–§11 once, in full, before touching any code. They are the shared mental model every phase depends on.
2. Before starting phase *N*, re-read that phase's block in §18 and the shared regression gate in §19 in full.
3. Every phase ends with the commit boundary defined in §21 — one phase, one commit (or a small number of tightly related commits), never a mega-commit spanning phases.
4. §15 lists every point where this document deliberately stops short of a decision and asks for one. **Do not resolve a `BUSINESS DECISION REQUIRED` item by picking the "obviously correct" answer.** Get the decision, record it in §15's table, then proceed.
5. §7 is the baseline. After every phase, the relevant slice of §7 must be re-verified (not re-derived from memory) and must still say what it said before, unless the phase's own stated intent was to change that exact cell — in which case §7 is updated in the same commit as the code change, with the reason cross-referenced.

---

## 1. Executive Summary

Neozy's RBAC has a coherent, mostly-correct spine: a real identity chain (Firebase Auth → `user_auth_maps` → `users`), a single canonical permission engine (`canDo()` in `src/lib/permissions.ts`) consumed by every route guard, and hard, verified blocks on the classic escalation paths (self-role-change, cross-company reach, cross-group reach). Two systemic gaps sit underneath that spine:

- **A rules-layer ownership gap on 8 core CRM/business collections** (`leads`, `customers`, `quotations`, `orders`, `products`, `vendors`, `cases`, `loan_applications`) — they have no dedicated Firestore `match` block, so they fall through to a generic same-company, no-role, no-ownership grant. Every "self"/"team" scope promise on these collections is enforced only by a client-side array filter.
- **A broken server-side permission lookup** in `api/_lib/permissions.ts` — a case-sensitivity bug means the primary role-document query always misses, so an unscoped, cross-company, non-deterministic fallback scan is not an edge case but the only code path that has ever executed.

Neither gap requires new architecture. The client already computes and enforces the correct ownership predicate (`assignedToId` / `createdBy` / `partnerId` / `teamMemberIds`, see §8) for exactly these collections — the fix is to mirror that same, already-correct logic into Firestore rules, the same way it was already done for `channel_partners`, `projects`, and every Inventory-phase collection. This materially de-risks the highest-severity phase of this plan: there is no data-model migration needed, only a rules-authoring and verification exercise on fields that already exist, are already populated, and are already read by the client.

This document is the implementation roadmap that closes those gaps — and every smaller inconsistency found alongside them — in ten dependency-ordered phases, each independently committable, each gated by an explicit regression checklist built around one non-negotiable constraint: **no role loses any access it legitimately has today**, unless a named business decision (§15) explicitly approves the change.

---

## 2. Current Architecture

```
Firebase Auth (email/password)
        │
        ▼
user_auth_maps/{authUid}  ── maps a login to a canonical user id
        │
        ▼
users/{userId}             ── either a real authUid-keyed staff account,
        │                       or a phone-keyed MUSR-{companyId}-{phone}
        │                       "master identity" (never a login)
        ▼
useAppStore (Zustand)      ── holds { user, roleData, teamMemberIds, activeCompanyId }
        │
        ├──► src/lib/permissions.ts   canDo(action, module) ── THE canonical
        │                              client permission check
        │
        ├──► src/lib/firestore.ts     resolveVisibility / applyAccessFilters
        │                              ── client-side ownership re-filter
        │
        ├──► RoleRoute / SuperAdminRoute (src/components/auth/*)
        │                              ── route guards, desktop + mobile share
        │                              the same module strings
        │
        ├──► firestore.rules (2,839 lines, 56 dedicated `match` blocks +
        │                      1 generic fallback) ── the actual data
        │                      security boundary; independent of the client
        │
        └──► api/_lib/permissions.ts  ── a SEPARATE, weaker server-side
                                         permission plane for the generic
                                         REST facade (api/[entity].ts),
                                         talks to Firestore via Admin SDK,
                                         bypasses firestore.rules entirely
```

Four independent authorization "planes" exist side by side: **client UI** (`canDo`, route guards), **client data-fetch filtering** (`applyAccessFilters`), **Firestore rules**, and **the REST API's own permission check**. They are meant to agree. §13 catalogs every place they currently don't, and §16–17 define how they converge without weakening the two planes (rules, API) that are the actual security boundary.

---

## 3. Current RBAC Flow

```
USER
 → IDENTITY            Firebase Auth UID, resolved through user_auth_maps
 → GROUP                users.groupId (optional — only Group-tenant accounts have one)
 → COMPANY               users.companyId, switchable to any company in-group
                          via activeCompanyId for GroupAdmin/Owner
 → ROLE                 users.role (a raw string — see §4 for the 24 that exist)
 → ROLE NORMALIZATION   EXACT_ROLE_COMPATIBILITY alias table (client copy in
                          permissions.ts, a DIFFERENT copy in api/_lib/permissions.ts,
                          and Firestore rules' OWN raw-string regex matching —
                          three independent tables, see §13)
 → PERMISSIONS          the resolved role's module grants from roleBootstrap.ts's
                          LEGACY_SYSTEM_ROLES (client) or the `roles/{companyId}_{Role}`
                          Firestore document (server + rules)
 → ROUTE ACCESS          RoleRoute → canDo('view', module); SuperAdminRoute →
                          literal owner-email check, unrelated to role or
                          isSuperAdmin flag
 → PAGE ACCESS           same canDo() call the route guard used — no separate gate
 → ACTION ACCESS         canDo(action, module) per button/mutation
 → FIRESTORE/API AUTHZ   firestore.rules (client SDK writes) OR
                          api/_lib/permissions.ts (REST writes) — these are
                          NOT the same code path and NOT guaranteed to agree
 → DATA SCOPE            resolveVisibility()/applyAccessFilters() (client only,
                          for the 8 ungated collections) OR a real rules
                          predicate (for channel_partners, projects, and every
                          Inventory-phase collection)
```

---

## 4. Role Inventory

24 role strings exist in the repository today. `SYSTEM_ROLE_NAMES` (`src/lib/roleBootstrap.ts`) seeds 15 of them with a full permission template; the rest resolve through `EXACT_ROLE_COMPATIBILITY` onto one of those 15, or fail to resolve.

| Role string | Kind | Resolves to | Has server API alias? | Matched by rules regex? |
|---|---|---|---|---|
| `Admin` | Canonical/system | itself | Yes | Yes |
| `GroupAdmin` | Canonical/scope-extension | itself (own rules branches, not the alias table) | **No** | Own dedicated branches |
| `Director` | Canonical/system | itself | Yes | Yes |
| `Sales` | Canonical/system | itself | Yes | Yes |
| `Sales Executive` | Data-driven designation | `Sales` (alias) | Yes | **No** — raw-string mismatch |
| `BDM` | Data-driven designation | `Sales` (alias) | Yes | **No** |
| `BDE` | Data-driven designation | `Sales` (alias) | Yes | **No** |
| `Accounts` | Canonical/system | itself | Yes | Yes |
| `Acc` | Alias fragment | `Acc` — **no such role document exists** | **No** | **No** |
| `Warehouse` | Canonical/system | itself | Yes | Yes |
| `HR` | Canonical/system | itself | Yes | Yes |
| `Operations` | Canonical/system | itself | Yes | Yes |
| `Partner` | Canonical/external | itself | Yes | Yes |
| `Manager` | Canonical/system | itself | Yes | Yes |
| `TL` | Legacy alias | `Manager` | **No** | **No** |
| `Management` | Legacy alias | `Admin` (not `Director`) | Yes | **No** |
| `Surveyor` / `Engineer` / `InstallationLead` / `ServiceTechnician` / `ComplianceOfficer` | Canonical/project-scoped | themselves | **No** | Not referenced by name (matched structurally via `isProjectScopedRole()`) |
| `Procurement` | Canonical/system | itself | **No** | Not in the warehouse-class regex list |
| `demo operator` / `demo admin` | Legacy/demo alias | `Admin` | **No** | **No** |
| `Owner` | Synthetic — not a stored role | unconditional bypass | Yes (email + synthetic superadmin) | Yes (`isOwnerIdentity()`) |

**Read this table as the reason Phase 2 exists**: three independent alias tables (client, server, rules-regex) drift from each other, and the drift is concentrated exactly on the roles a real org chart uses daily (`Sales Executive`, `TL`, `GroupAdmin`).

---

## 5. Permission Inventory

The `Permission` type is exactly: `view · create · edit · delete · cancel · approve · disburse · export · import · view_pricing` (`src/lib/permissions.ts`). There is no first-class permission for print/share/upload/download/reassign/change-owner — those are UI capabilities gated by `view`/`edit` at the component level, not distinct RBAC actions today. Phase 4 (§18) decides, per action named in the user's request (Part 4/6) but not in the current `Permission` type, whether it needs to become first-class or stays composed from the existing 10.

The `Module` type carries ~37 keys on the client; the server's copy (`api/_lib/permissions.ts`) has 28, missing `cases, loan_applications, banks, payouts, scheme_registration, net_metering` — see §13 finding AUTH-D6.

---

## 6. Route / Page Inventory

- **Desktop:** 86 routes in `src/app/router/routes.tsx`, gated by `RoleRoute module="…"` (75), `SuperAdminRoute` (9: `/platform/*`, `/group/*`, `/ai-intelligence`, `/audit-logs`), or no route-level guard at all (`/settings/:sectionId` — gated per-section inside the page instead), or public (`/login`).
- **Mobile:** 75 routes in `src/components/mobile/routing/MobileRoutes.tsx`, sharing the identical module string with their desktop counterpart wherever both exist. 9 desktop surfaces (Stock Transfers, Banks, standalone Stock Ledger, Cases, AI Intelligence, and the whole `/platform/*` and `/group/*` families except `audit-logs`) have no mobile route at all — absence, not a bypass.
- **7 routes borrow another module's guard key** rather than having their own: `/stock-transfers` (borrows `stock`), `/goods-receipts`, `/handovers`, `/amc-contracts`, `/monitoring` (borrow `purchase_orders`/`projects`), `/sales-documents` (borrows `leads`), `/notifications` (borrows `dashboard`). Documented as finding AUTH-D2 in §12.

---

## 7. Role × Page × Action Baseline

**This is the regression contract.** Every phase re-checks the cells relevant to what it touched and must find the same answer unless the phase's declared intent is to change that exact cell — in which case the new value replaces the old one here, in the same commit, with a note pointing at the approving business decision (§15) or security-fix rationale (§12).

Legend — **Current**: ALLOW / DENY / CONDITIONAL / UNKNOWN (never "partial"). **Enforcement**: UI / ROUTE / API / FIRESTORE / MULTIPLE. **Scope**: SELF / ASSIGNED / TEAM / COMPANY / GROUP / GLOBAL / UNKNOWN.

### 7.1 Sales / Sales Executive / BDM / BDE (all resolve to the `Sales` template)

| Page/Action | Current | Enforcement | Scope |
|---|---|---|---|
| View dashboard | ALLOW | ROUTE | COMPANY |
| View/create/edit Leads | ALLOW (no delete) | ROUTE (view) + FIRESTORE generic-fallback (write) | **COMPANY** (seed sets no `visibility`, defaults `'all'` — see AUTH-C1, §12) |
| View/create/edit Customers | ALLOW (no delete) | same | COMPANY |
| View/create/edit Quotations | ALLOW (no delete) | same | COMPANY |
| View/create Orders (no edit) | ALLOW | same | COMPANY |
| View/create Dispatch + view selling price (`view_pricing`) | ALLOW | ROUTE + FIRESTORE (dedicated `dispatch` block, warehouse-scoped) | COMPANY |
| Approve/cancel orders or dispatch | DENY | ROUTE (no grant) | n/a |
| View Products/Categories/Stock | ALLOW (view only) | ROUTE + FIRESTORE generic-fallback | COMPANY |
| Delete anything | DENY | ROUTE (no grant on any module) | n/a |
| Export any report | DENY | ROUTE (no `export:true` in seed) | n/a |
| View/create Loan Applications, view Banks | ALLOW | ROUTE | COMPANY |
| Users / Roles / Companies / Employees / Payments / Invoices / Settings-admin sections | DENY | ROUTE (no module grant) | n/a |
| Change own role/company/group | DENY | FIRESTORE (`selfAccessFieldsUnchanged()`) | n/a |
| Direct-id read of another rep's Lead/Customer/Quotation/Order | **ALLOW** (this is AUTH-C1's blast radius, not a distinct row) | FIRESTORE generic-fallback | COMPANY |

**Must-not-regress for this role family:** create/edit Leads, Customers, Quotations; create Orders and Dispatch; view Products/Stock/Banks/Loan Applications; view dispatch selling price. These are the day-to-day job functions and are the canonical "Sales Executive must still be able to create a Lead" test named in the request.

### 7.2 Manager (alias: `TL`)

| Page/Action | Current | Enforcement | Scope |
|---|---|---|---|
| Leads / Customers / Projects / Surveys / Scheme Registration / Payouts (approve) | ALLOW | ROUTE (view) + **UI-ONLY** (`applyAccessFilters`) for scope | **TEAM** (seeded `visibility:'team'`, resolved via `managerId`→`teamMemberIds`), but **FIRESTORE grants COMPANY** for the ungated collections (AUTH-C1) |
| Quotations / Orders / Dispatch / Stock / Products / Partners / Loan Applications / Banks | ALLOW | ROUTE | **COMPANY** (no `visibility` override in seed — this is the seed's own stated intent, not a bug) |
| Approve orders/dispatch | DENY | ROUTE (no grant — separation of duties: Accounts/Warehouse approve) | n/a — confirm intent, §15 |
| Cases | DENY | ROUTE (no role template grants `cases` except Admin) | n/a — likely oversight, §15 |
| Users/Roles/Companies | DENY | ROUTE | n/a |
| Read a project outside the managed team via direct id | **ALLOW** | FIRESTORE (`canReadProjectScoped()` allows any non-project-scoped role) | COMPANY (not TEAM as the list view implies) |
| Read another team's commission/settlement rows | **ALLOW** | FIRESTORE (role-only check, no ownership predicate) | COMPANY (not TEAM) |

**Must-not-regress:** team-visible Leads/Customers/Projects list views continue to show exactly the current team's records (not fewer); company-wide Quotations/Orders/Dispatch/Stock/Products access is preserved as-is unless §15's Manager-visibility decision changes it.

### 7.3 Accounts

| Page/Action | Current | Enforcement | Scope |
|---|---|---|---|
| Payments/Invoices — full CRUD + delete | ALLOW | ROUTE + FIRESTORE (dedicated block) | COMPANY |
| Tax invoices — view/create/edit/cancel | ALLOW | same | COMPANY |
| Approve orders/dispatch | ALLOW | ROUTE | COMPANY |
| Payouts — view + disburse (not approve) | ALLOW | ROUTE | COMPANY |
| Export reports | ALLOW | ROUTE | COMPANY |
| Partners module | **DENY — no grant at all** | ROUTE | n/a (AUTH-C2, confirm intent §15) |
| Leads/Customers/Quotations/Orders (non-financial) | DENY | ROUTE | n/a |
| Users/Roles/Companies/Employees | DENY | ROUTE | n/a |

**Must-not-regress:** full financial-module CRUD, order/dispatch approval, payout disbursement, report export.

### 7.4 Warehouse / Operations

| Page/Action | Current | Enforcement | Scope |
|---|---|---|---|
| Stock/Stock Ledger/Dispatch/Goods Receipts/Customer Returns/Dispatch Serials/Stock Transfers | ALLOW (create/edit; Warehouse also approves dispatch) | ROUTE + **FIRESTORE (real, dedicated, warehouse-scoped rules)** | **WAREHOUSE** — the one fully rules-backed scope boundary in the system |
| View dispatch selling price | DENY (deliberate) | ROUTE (`view_pricing` not granted) | n/a |
| Products/Categories | ALLOW view (Warehouse); Operations same, both warehouse-restricted | ROUTE | COMPANY (view), WAREHOUSE (write ops) |
| Leads/Customers/Quotations/Orders/Users/Roles/Finance | DENY | ROUTE | n/a |
| Operations' own `visibility` key | UNSET → defaults `'all'` | seed | flagged AUTH-C1 companion, low priority (Operations has no team-scoped module to begin with) |

**Must-not-regress:** every stock/dispatch/GRN/return/transfer action currently available to Warehouse/Operations, scoped to their own warehouse exactly as today.

### 7.5 HR

| Page/Action | Current | Enforcement | Scope |
|---|---|---|---|
| Employees — full CRUD + delete | ALLOW | ROUTE + FIRESTORE | COMPANY |
| Attendance — view/create/edit | ALLOW | ROUTE + FIRESTORE (self for regular employees, Admin/HR company-wide) | COMPANY |
| Payroll — view only | ALLOW (view), DENY (create/edit) | ROUTE | COMPANY |
| Everything else | DENY | ROUTE | n/a |

### 7.6 Procurement

| Page/Action | Current | Enforcement | Scope |
|---|---|---|---|
| Vendors — full CRUD + delete | ALLOW | ROUTE + FIRESTORE generic-fallback | COMPANY (AUTH-C1 applies here too) |
| Purchase Orders — view/create/edit/approve | ALLOW | ROUTE | COMPANY |
| Products — view; Stock — view/create; Warehouses — view | ALLOW | ROUTE | COMPANY |
| Server API access | **DENY** (missing from server alias table) | API | n/a — AUTH-D6 |

### 7.7 Partner (Channel Partner)

| Page/Action | Current | Enforcement | Scope |
|---|---|---|---|
| Own `channel_partners` record | ALLOW (read + self-update) | **FIRESTORE (real, dedicated block)** | SELF |
| Own Leads/Customers/Projects (view + create) | ALLOW | **UI-ONLY** (`filterPartnerOwnedLeads/Customers/Projects`) | intended SELF, **actual FIRESTORE grant is COMPANY** (AUTH-C1) |
| Own commissions/settlements/payouts (view) | ALLOW | **UI-ONLY narrowing**; FIRESTORE grants any same-company Partner/Admin/Manager/Director read on every row | intended SELF, actual COMPANY |
| Internal ERP routes (`/leads`, `/users`, …) | DENY | ROUTE — `isPartnerOnlyIdentity()` confines to `/partner/*` before any module check | n/a |
| Act while suspended / KYC-rejected | **ALLOW — the eligibility gate is defined but has zero call sites** | none (dead application code) | n/a — CP-1, §12 |

**Must-not-regress:** every Partner Portal surface currently reachable stays reachable at the identical scope; the internal-route confinement stays exactly as strict as today.

### 7.8 Director ("Management" string aliases to Admin, not this role — see §13 S-3)

| Page/Action | Current | Enforcement | Scope |
|---|---|---|---|
| View (not create/edit/delete) almost every module incl. Loan Applications/Banks/Projects/Surveys/Scheme Registration/Payouts/Partners | ALLOW (view-only) | ROUTE | COMPANY |
| Users/Roles/Companies | ALLOW (view-only) | ROUTE | COMPANY |
| `cases` | DENY | ROUTE (not seeded) | n/a — §15 |
| Any create/edit/delete/approve anywhere | DENY | ROUTE | n/a |

### 7.9 Admin (Company Admin)

| Page/Action | Current | Enforcement | Scope |
|---|---|---|---|
| Every module | ALLOW, full CRUD (empty permission map = allow-all) | ROUTE + FIRESTORE (`sameCompany()` universal) | COMPANY |
| Another company's data | DENY | FIRESTORE | n/a |
| `/platform/*`, `/group/*` | DENY | ROUTE (`SuperAdminRoute` — owner-email literal, not role) | n/a |
| Create a role document named after a system role | **ALLOW at the rules layer** (client UI blocks it, rules do not) | UI only — AUTH-C6, §12 | n/a |

### 7.10 GroupAdmin

See §10 for the full dedicated model. Summary row:

| Page/Action | Current | Enforcement | Scope |
|---|---|---|---|
| Users/Roles/Companies, per target company via `activeCompanyId` | ALLOW (= that company's Admin template) | ROUTE + FIRESTORE (dedicated `groupAdminCan*` branches) | GROUP (own group's companies only) |
| `/group/*` routes | **DENY** — owner-email literal, not this role | ROUTE | n/a — naming trap, §12/§13 S-5 |
| Cross-group reach | DENY | FIRESTORE (`actorGroupId()` match required) | n/a |
| REST API (`/api/*`) | **DENY on every call** — missing from server alias table | API | n/a — AUTH-D4 |

### 7.11 Super Admin / Owner

See §9. Unconditional bypass at every layer, gated on a single hardcoded email, not a role string or the `isSuperAdmin` boolean.

---

## 8. Data-Scope Model

Three visibility values exist: `self`, `team`, `all` (client) / `SELF, ASSIGNED, TEAM, COMPANY, GROUP, GLOBAL` (this document's finer vocabulary, per Part 12). The mechanism:

- **Ownership fields that already exist and are already populated** on Lead/Customer/Quotation/Order/Project records: `createdBy`, `assignedToId`, `partnerId`, plus `managerId`→`teamMemberIds` computed at session-load for team scoping (`src/lib/firestore.ts`, `applyAccessFilters`). These are loosely typed (accessed as `docData.assignedToId` etc., not declared on the `Lead`/`Customer`/`Quotation`/`Order` TypeScript interfaces) but are real, live, already-read fields — **this means Phase 5/7 (§18) is a rules-authoring exercise on data that already exists, not a data-migration project.**
- **Two independently-defaulting visibility resolvers exist** and disagree on the unresolved-role fallback direction: `getModuleVisibility()` (`permissions.ts`) defaults to `'all'`; `resolveVisibility()` (`firestore.ts`) defaults to `'self'`. The second one is the one that actually gates data fetches, so today's practical exposure is low — but this is a maintenance trap (AUTH-C7, §12) that Phase 2 should resolve by making both resolvers share one function.
- **Only 3 domains have the ownership predicate enforced in Firestore rules today**: `channel_partners` (self-link), the 5 project-scoped field roles' access to `projects` (assigned-only), and the entire Inventory domain (warehouse-scoped). Everywhere else — including the two collections just named for their OTHER-role access (Partner/Manager/etc. on `projects`; anyone on `commission_records`/`settlements`) — falls back to company-only.

---

## 9. Super Admin Model

**Identity:** not a role string. `isOwnerFirebaseUser()` / `isOwnerEmail()` (`src/lib/ownerAccess.ts`) compares the authenticated Firebase email against a single hardcoded constant, `OWNER_AUTH_EMAIL`. Neither the `isSuperAdmin` boolean on a `users` document nor any role name grants this tier.

| Capability | Current | Must remain true after every phase |
|---|---|---|
| Access `/platform/*`, `/group/*`, `/ai-intelligence`, `/audit-logs` | ALLOW, owner-email only | Yes — `SuperAdminRoute` stays gated on the literal email, never widened to `isSuperAdmin===true` or any role |
| Manage every Group/Company/User/Role/Permission | ALLOW, unconditional | Yes |
| System-level settings | ALLOW, unconditional | Yes |
| Bypass company/group scoping anywhere | ALLOW | Yes — this is the one legitimate universal bypass in the system |
| Restrictions that must never be bypassed | N/A — Owner is the ceiling | Any phase that appears to require weakening this check to "fix" something else has misdiagnosed the problem; stop and re-scope |

**Non-negotiable:** no phase in §18 may change `isOwnerFirebaseUser()`'s comparison target, add a second qualifying condition that widens who passes it (e.g., `|| isSuperAdmin`), or route any new capability through a check other than this one for platform-tier actions.

---

## 10. Group Admin Model

GroupAdmin is a **scope extension**, not a fifth distinct permission tier: its effective grants are the target company's own `Admin` template, evaluated fresh each time `activeCompanyId` is switched to a company inside the actor's own group.

| Capability | Current | Enforcement |
|---|---|---|
| Switch `activeCompanyId` to any company in own group | ALLOW | Client (`activeCompanyId` state) + rules (`actorGroupId()` match on every GroupAdmin branch) |
| Create/edit roles per company | ALLOW, except while `activeCompanyId==='group'` (fails closed) | `canDo()` special-case, `permissions.ts:234` |
| Manage users per company, incl. cross-company transfer within the group | ALLOW — the one deliberate `companyId`-mutability exception in the whole rules file | `usersUpdateAllowed()` branch C |
| Promote a second GroupAdmin | ALLOW, narrowly — target must already hold a `group_members` record, cannot be self | `firestore.rules` §7.9 exception |
| `/group/*` routes (Group dashboard, Companies/Warehouses/Users/Teams/Roles/Settings) | **DENY** — these are `SuperAdminRoute`-gated (owner-email), not reachable by this role at all | ROUTE |
| REST API access | **DENY on every call** | missing from `api/_lib/permissions.ts`'s alias table |
| Cross-group reach | DENY | FIRESTORE |
| Company-scoped users granted GroupAdmin/SuperAdmin capability | must remain DENY | — |

**What must never happen:** a company-scoped Admin gaining any of the group-switching, cross-company-user-transfer, or role-creation-while-viewing-another-company's-context capabilities that are today exclusive to GroupAdmin. **What is already broken and should be fixed, not preserved:** the `/group/*` naming trap (a route named for this role that this role cannot open) and the REST API gap — both are FALSE DENIES, closing them only grants GroupAdmin capability it conceptually already has under a different label, never anything new.

---

## 11. Security Boundaries — Non-Negotiable vs. Centrally Configurable

Per Part 6, every future phase must sort each control into exactly one of these two buckets and never move a Bucket B item into Bucket A without an explicit, named business decision.

### Bucket A — must remain independently enforced, never derived solely from a Roles & Permissions checkbox

- Firebase Authentication requirement on every non-public route.
- `sameCompany()` / tenant isolation in `firestore.rules`.
- `actorGroupId()` group isolation for GroupAdmin.
- `isOwnerFirebaseUser()` Super Admin gate (§9).
- `selfAccessFieldsUnchanged()` — the self-role/company/group/superadmin escalation block.
- `SECURITY_RESERVED_FIELDS` / `IMMUTABLE_FIELDS` mass-assignment protection in the REST API.
- Warehouse-scoping predicates on the Inventory-domain collections.
- The `roles` collection's own write authorization (who may create/edit a role document) — this stays a hardcoded Admin/GroupAdmin check; it cannot be "configured" by the very system it protects, or a compromised/misconfigured role could grant itself the ability to edit roles.

### Bucket B — should become centrally configurable through Roles & Permissions

- Which modules a role can view/create/edit/delete/approve/export/import (already mostly here — the target state in §16 makes this consistently true everywhere, including the REST API and the borrowed-module routes named in §6).
- Visibility scope (`self`/`team`/`all`) per role per module — today hardcoded in `roleBootstrap.ts`'s seed, target state (§16) keeps the seed as the *default* but lets an Admin/GroupAdmin edit it per company through the Roles & Permissions UI, the same way module grants are already editable.
- Which project-lifecycle/business-workflow transitions (approve, cancel, dispatch, etc.) a role may perform — already permission-driven; Phase 4 (§18) closes the remaining hardcoded-role-string exceptions found in §13.

---

## 12. Current Defects Register

Carried forward and re-verified against the current tree (commit `4663494`); IDs kept stable with the prior "Neozy Access Ledger" audit where they refer to the same fact, renumbered `AUTH-*` here to anchor this document's own cross-references.

| ID | Prior ID | Severity | Summary | Fix belongs in |
|---|---|---|---|---|
| AUTH-C1 | RBAC-001 | **Critical** | `leads/customers/quotations/orders/products/vendors/cases/loan_applications` have no dedicated Firestore rules block; ownership is client-only | Phase 5/7 |
| AUTH-D1 | RBAC-002 | **Critical** | `api/_lib/permissions.ts`'s `getRoleDocument()` case-sensitivity bug makes its "fallback" (unscoped, cross-company, non-deterministic full scan) the only path that ever runs | Phase 6 |
| AUTH-C3 | RBAC-003 | High | `commission_records`/`settlements` rules grant any same-company Manager/Partner/Director read on every row, no ownership predicate | Phase 5/7 |
| AUTH-C4 | RBAC-004 | High | `canReadProjectScoped()` allows any non-project-scoped role to direct-read any same-company project regardless of assignment | Phase 5/7 |
| CP-1 | CP-1 | High | `validatePartnerCanAct`/`validatePartnerCanCreateLead` fully implemented, zero call sites — suspended/unverified partners act freely | Phase 4 |
| AUTH-C2 | RBAC-005 | Medium | Sales/Operations seeded at company-wide visibility; the seed's own comments say this should be narrower | Phase 2/7 — **BUSINESS DECISION REQUIRED, §15** |
| AUTH-D4 | RBAC-006 | Medium | `GroupAdmin` missing from server `EXACT_ROLE_COMPATIBILITY` — 403 on every `/api/*` call | Phase 2/6 |
| AUTH-D5 | RBAC-007 | Medium | `/api/integrations` does a raw `role==='Admin'` string check, alias-blind to GroupAdmin | Phase 6 |
| AUTH-C6 | S-4 | Medium | `roleNotSystemProtected()` only inspects the client-controlled `isSystem` field, never checks `name` for a reserved/colliding value | Phase 2 |
| AUTH-P1 | RBAC-008 | Low | No role template grants `cases` except Admin — likely an oversight for Director | Phase 4 — **BUSINESS DECISION REQUIRED, §15** |
| AUTH-P2 | RBAC-009 | Low | Manager has no approve grant on orders/dispatch — plausibly intentional separation of duties | none — **confirm intent only, §15** |
| AUTH-S1 | S-1 | Low | Firestore rules regex tests the raw stored role string, never the alias table — `Sales Executive`/`BDM`/`BDE`/`TL` fail any regex that lists only the canonical name | Phase 2 |
| AUTH-S2 | S-2 | Low | `Acc` aliases to a role document that does not exist — silent full lockout | Phase 2 |
| AUTH-S3 | S-3 | Low | `Management` aliases to `Admin`, not `Director` | Phase 2 — **confirm intent, §15** |
| AUTH-S5 | S-5 | Low | `/group/*` route naming implies GroupAdmin access it doesn't have | Phase 4 (rename or re-route) |
| AUTH-C7 | S-6 | Low | `getModuleVisibility()` and `resolveVisibility()` default an unresolved role in opposite directions | Phase 2 |
| AUTH-D2 | DBT-2 | Low | 7 routes borrow another module's guard key instead of having their own | Phase 4 |
| AUTH-D6 | (new) | Low | Server `Module` type missing 6 keys the client has; server alias table missing `groupadmin`/`tl`/demo aliases | Phase 6 |
| BANK-1 | BANK-1 | Low | No rules block for `banks/{id}/branches` — subcollection is fully unreachable (dead feature, not an exposure) | Out of scope — feature decision, not RBAC |

---

## 13. Duplicate / Conflicting Authorization Systems Inventory

| Location | Purpose | Current behavior | Keep, replace, or derive from central model? | Migration risk |
|---|---|---|---|---|
| `src/lib/permissions.ts` `EXACT_ROLE_COMPATIBILITY` | Client role-alias resolution | Authoritative for UI/route decisions | **Keep as the canonical alias table** — everything else should read from a shared copy of this, not maintain its own | Low — it's already correct, the problem is the *other* tables not matching it |
| `api/_lib/permissions.ts` `EXACT_ROLE_COMPATIBILITY` | Server role-alias resolution | Independent, incomplete copy (missing `groupadmin`, `tl`, demo aliases) | **Replace** — generate/sync from the client table (build-time codegen or a shared package) so the two can never drift again | Medium — touches every API-authorized request; needs full endpoint regression before/after |
| `firestore.rules` regex role matching (`actorRoleMatches('Admin\|Manager\|...')`) | Rules-layer role checks | Tests the **raw stored role string**, blind to aliases | **Keep the mechanism** (rules can't call a JS function), **but every regex must be expanded to include every alias that resolves to that canonical role** — a data-driven generation step, not hand-maintained lists, is the target state | Medium — a missed alias in a regex either wrongly denies (safe direction) or, if a regex is too broad, wrongly allows; every change needs the emulator suite |
| `roleBootstrap.ts` `LEGACY_SYSTEM_ROLES` | Default permission templates | The literal seed content, includes `visibility` and per-module grants | **Keep as the default seed** for a NEW company; the target state (§16) makes an already-created company's actual `roles/{companyId}_{Role}` Firestore documents the live source of truth, editable via Roles & Permissions, independent of future seed edits | Low |
| `api/integrations.ts` raw `user.role === 'Admin'` check | Gatekeeping integration secrets | Hardcoded, alias-blind | **Replace** with `requirePermission()` against a real module (needs a `integrations` module added to both Module types) | Low — single file, single endpoint |
| `SuperAdminRoute` / `isOwnerFirebaseUser()` | Platform-tier gate | Hardcoded single email | **Keep exactly as-is** — this is Bucket A (§11), not a candidate for centralization | N/A — do not touch |
| `usersUpdateAllowed()` 3-branch structure in rules | Self/Admin/GroupAdmin user-record mutation | Hardcoded branches, not permission-driven | **Keep** — user-record mutation authority is itself a security boundary (Bucket A), not a business permission | N/A |
| `roleNotSystemProtected()` | Prevents mutating a system role's identity | Checks only the client-supplied `isSystem` field | **Extend**, don't replace — add a `name` reserved-word check alongside the existing `isSystem` check | Low |
| Client-side `Roles.tsx` duplicate-name check | UX guard against creating a colliding role name | Runs against whatever the client already fetched; not authoritative | **Keep as a UX nicety**, but no longer treat it as the security boundary — Phase 2 adds the real one in rules (this row + AUTH-C6 are the same defect, two layers) | Low |
| `applyAccessFilters()` / `resolveVisibility()` (client) | Ownership-scope re-filtering after a company-wide Firestore read | Already correctly implements self/team/company scoping for the 8 ungated collections | **Keep the logic, mirror it into Firestore rules** (Phase 5/7) — do not delete this client-side filter even after the rules catch up; it remains useful defense-in-depth and avoids a UI flash of over-scoped data before a rules-rejected write would surface | Medium — mirroring logic incorrectly (e.g., an off-by-one in team membership) is exactly how a phase could accidentally over-restrict; test both directions (§19) |
| Hardcoded `role === '...'` checks outside `canDo()`/`RoleRoute` | Various component-level special cases | Not yet fully inventoried — **Phase 4 includes a dedicated repo-wide grep sweep** (`role\s*===`, `role\.includes`, `isAdmin`, `isSuperAdmin` outside `ownerAccess.ts`) as its first task, before any fix, to produce the complete list this table doesn't yet have | TBD — sized during Phase 4 |

**Do not delete any "replace" row's old mechanism in the same phase that introduces its replacement.** Run both in parallel for at least one phase, diff their outputs against the same test fixtures (§19), and only remove the old mechanism once the new one has zero disagreements across the full regression suite.

---

## 14. Dependency Graph

```
Phase 1 (baseline + mechanical, non-controversial fixes)
   │  no dependency — start here
   ▼
Phase 2 (role/alias normalization)
   │  depends on: Phase 1's baseline snapshot existing
   │  blocks: Phase 4's regex-expansion work, Phase 5/7's ownership-predicate
   │          rules (which must key off the SAME alias-resolved role, not
   │          the raw string), Phase 6's server alias sync
   ▼
Phase 3 (central permission-evaluation plumbing — additive only)
   │  depends on: Phase 2 (one canonical alias source to plumb through)
   │  blocks: nothing downstream is BLOCKED by this, but Phase 4's hardcoded-
   │          check replacement is much lower-risk once this exists
   ▼
Phase 4 (routes/pages/actions alignment)
   │  depends on: Phase 2 (aliases), Phase 3 (plumbing to replace hardcoded checks with)
   │  blocks: nothing further, but should land before Phase 9's full regression
   │          pass so that pass isn't immediately invalidated by a late route change
   ▼
Phase 5 (Firestore/data authorization — ownership FIELD & MODEL audit + rules groundwork)
   │  depends on: Phase 2 (rules regexes must already include every alias)
   │  requires: BUSINESS DECISIONS from §15 on Manager/Sales/Partner scope
   │            before the actual predicate is written (not before the
   │            audit/groundwork sub-steps)
   ▼
Phase 6 (API/backend authorization)
   │  depends on: Phase 2 (server alias sync source)
   │  independent of Phase 5 — may run in parallel with it if capacity allows,
   │  but this document sequences them serially for review bandwidth, not
   │  because of a hard technical dependency
   ▼
Phase 7 (role-specific scope/ownership — the actual rules predicates)
   │  depends on: Phase 5 (groundwork done), business decisions resolved (§15)
   │  THIS is where AUTH-C1/AUTH-C3/AUTH-C4 actually close
   ▼
Phase 8 (Super Admin / Group Admin hardening)
   │  depends on: Phase 6 (server alias must include groupadmin before its
   │              API access can be turned on), Phase 2
   │  independent of Phase 7's business-data scope work
   ▼
Phase 9 (full role × page × action regression against §7's baseline)
   │  depends on: ALL of Phase 1-8 complete
   ▼
Phase 10 (final security audit + production readiness)
   │  depends on: Phase 9 passing clean
```

No phase after 2 may proceed if Phase 2's alias-table unification isn't complete, because every later phase either writes a rules regex, a server permission check, or a route guard keyed on a role name — and all three must agree on what a role name resolves to before any of them can be trusted to test correctly.

---

## 15. Business Decisions Required

**Do not resolve any of these by picking the technically cleaner answer.** Each needs an explicit answer from the business owner before the phase that depends on it proceeds.

| # | Decision | Current behavior | Options | Security impact if left as-is | Roles/pages affected | Recommended safe default |
|---|---|---|---|---|---|---|
| BD-1 | Should **Sales** (incl. Sales Executive/BDM/BDE) see every company Lead/Customer/Quotation, or only their own? | Company-wide (`visibility` unset → `'all'`) | (a) Keep company-wide — reps benefit from shared pipeline visibility; (b) narrow to `self`; (c) narrow to `team` if a manager hierarchy exists for reps too | None if (a) is the genuine intent — it's a scope-breadth choice, not a hole, since it's uniform within the tenant | Sales, Sales Executive, BDM, BDE — every one of their list/detail pages | **(a), unless told otherwise** — changing this is the single highest-blast-radius change in the whole plan (touches the most records, the most users); default to preserving current behavior and only narrow on explicit instruction |
| BD-2 | Should **Manager** see all company Quotations/Orders/Dispatch/Stock/Products/Partners/Loan Applications, or only their team's? | Company-wide (seed sets no `visibility` override on these modules, unlike Leads/Customers/Projects which ARE team-scoped) | (a) Keep as company-wide (the seed's own asymmetry may be deliberate — Managers coordinating fulfillment need company-wide stock/order visibility even if their *sales* pipeline view is team-scoped); (b) extend team-scoping to these modules too | Same as BD-1 — a breadth choice | Manager/TL | **(a)** — preserve as-is; this asymmetry reads as intentional (operational modules vs. pipeline modules), confirm rather than assume |
| BD-3 | Should the Channel Partner status/KYC eligibility gate (`validatePartnerCanAct`) actually block a suspended/rejected partner, or stay advisory-only? | Fully implemented, never called (CP-1) | (a) Wire it into `partnerCreateLead`/commission generation as a hard block; (b) formally retire it as dead code and remove the UI implication that it's enforced (the "KYC Verified" badge) | Currently a false sense of enforcement — the badge implies a gate that isn't there | Channel Partner, every internal workflow that creates records on a partner's behalf | **(a)** is the security-correct default, but this is explicitly a business call (a suspended partner might still need to be allowed to view/close out in-flight work) — needs an explicit answer on exactly which actions to block |
| BD-4 | Should `cases` be granted to Director (and possibly Manager) alongside Admin? | Only Admin has the module at all | (a) Add `cases:view` to Director's (and/or Manager's) seed; (b) leave as Admin-only | Currently a probable false DENY, not a security risk either way | Director, Manager | **(a)** for Director specifically (matches its existing "view everything" mandate); Manager needs an explicit answer |
| BD-5 | Should `Management` (the literal role string) alias to `Director` (read-only) instead of `Admin` (full access), matching what the name implies? | Aliases to `Admin` today | (a) Re-point the alias to `Director`; (b) leave as `Admin` (perhaps `"Management"` was always meant as an `Admin` synonym, not a `Director` synonym, in this org's usage) | If (a) is correct and left unfixed, every `Management`-titled account is over-privileged today | Any account currently stored with role string `Management` | **Do not guess — this reassigns real access up or down for existing accounts.** Needs a direct answer, plus a list of how many (if any) live accounts use this exact string before deciding |
| BD-6 | Should Accounts gain a `partners` module grant (even view-only), given it currently has none? | No grant at all | (a) Add view-only; (b) leave as-is (Accounts may legitimately have no reason to see partner relationship data, only commission/payout amounts which it already has via Payouts) | None — this is a scope-breadth question, not a security gap | Accounts | **(b)**, preserve as-is, unless the business identifies a concrete need |
| BD-7 | Is Manager's lack of an approve grant on Orders/Dispatch intentional separation of duties, or a gap? | DENY | (a) Leave denied (Accounts/Warehouse approve, by design); (b) grant Manager approve too | None either way — purely a workflow-design question | Manager | **(a)**, preserve as-is; separation-of-duties patterns are usually deliberate and this one is internally consistent with the Accounts/Warehouse payout-approve-vs-disburse split already in the seed |
| BD-8 | Should the 7 "borrowed-module" routes (§6/AUTH-D2) get their own dedicated module keys, or is sharing acceptable? | Shared keys today (e.g., `/stock-transfers` uses `stock`) | (a) Give each its own module (finer-grained, more Roles & Permissions checkboxes to manage); (b) formally document the sharing as intentional and leave it | Low either way — the shared grant is at least consistent, not contradictory | Whoever holds the parent module's grant today | **(b)** for low-traffic borrowed routes, **(a)** is worth it only for `/stock-transfers` specifically since stock viewing and stock transferring are meaningfully different risk levels; needs a decision per-route, not a blanket one |

---

## 16. Target Architecture

```
Roles & Permissions UI  (an Admin/GroupAdmin edits a role's module grants,
        │                 visibility scope, and — new — its Firestore
        │                 ownership-predicate class)
        ▼
roles/{companyId}_{RoleName}  (Firestore document — the canonical PERMISSION
        │                       record for that role in that company, already
        │                       true today for module grants; extended in
        │                       Phase 3 to also carry the resolved visibility
        │                       and, where applicable, which ownership field
        │                       the collection's rules should key off)
        ▼
   ┌────┴─────────────────────────────────────────┐
   ▼                                               ▼
CLIENT canDo()/RoleRoute/applyAccessFilters   SERVER requirePermission()
   reads the SAME document, through the           reads the SAME document,
   SAME alias resolution (Phase 2's unified       through a SYNCED copy of
   table)                                         the SAME alias resolution
   │                                               │
   ▼                                               ▼
Route/Page/Action decisions                    REST API authorization
   (already mostly correct; Phase 4 removes        (Phase 6 fixes the broken
    the remaining hardcoded exceptions)             lookup + syncs the alias
                                                     table)
   │
   ▼
firestore.rules  ── evaluates role/company/group/warehouse/ownership
   predicates directly against the client SDK write; DOES NOT read the
   `roles` document's business-permission booleans for security-critical
   checks (Bucket A, §11) but DOES use the SAME alias-expanded role-name
   regexes (Phase 2) so a rules ALLOW/DENY never disagrees with what
   canDo() already decided for the same actor/action
```

---

## 17. Single-Source-of-Truth Strategy

- **Canonical role representation:** the raw string stored on `users.role`, always passed through ONE shared alias-resolution function. Phase 2 makes the client's `EXACT_ROLE_COMPATIBILITY` (already the most complete and most exercised of the three tables) that single source; the server and rules layers consume a generated/synced copy rather than hand-maintaining their own.
- **Canonical permission representation:** the `roles/{companyId}_{RoleName}` Firestore document. It is already authoritative for module view/create/edit/delete/etc. today for both client and — where reachable — server. Phase 3 extends its schema (additively, non-breaking) to also carry visibility scope, making the seed in `roleBootstrap.ts` a *default template for new companies* rather than a second live source of truth.
- **How role aliases are normalized:** one lookup, `resolveCanonicalRole(rawRoleString): CanonicalRole`, exported from a module both `src/lib/permissions.ts` and (via a build step or a shared package) `api/_lib/permissions.ts` import from. Firestore rules cannot import JS, so Phase 2 instead **generates** each rules regex from the same alias table at build/deploy time (a small script, not hand-maintenance) so the three never drift again.
- **How frontend authorization consumes permissions:** unchanged mechanism (`canDo()`), but now guaranteed to agree with the server because both resolve the same alias and read the same Firestore document.
- **How backend authorization consumes permissions:** `api/_lib/permissions.ts` fixed (Phase 6) to actually find the right document (case-correct, company-scoped query, no unscoped fallback) and to use the synced alias table.
- **How Firestore authorization relates to the central permission model:** rules remain independently authoritative for Bucket A (§11) checks — they are never *derived* from the `roles` document at write-time (a compromised or misconfigured role document must not be able to grant itself write access to protected collections). For Bucket B checks, rules gain the SAME alias-expanded role regexes the client and server use, closing AUTH-S1/S2/S3 as a side effect of Phase 2, without making rules read the permission document live (that would be both slower and a new attack surface — a `roles` doc allowing writes to itself is exactly the kind of self-referential risk Bucket A exists to prevent).
- **Which checks must remain security-specific:** the full Bucket A list in §11 — verbatim, unchanged mechanism, for the life of this roadmap.
- **How legacy hardcoded role checks migrate safely:** per the "keep both, diff, then remove" pattern in §13 — never a single-phase rip-and-replace.
- **How permission changes from Roles & Permissions propagate:** already event-driven via the existing role-cache invalidation on `activeCompanyId`/role-document change (per BRAIN.md's prior documentation of `useGlobalBoot`); Phase 3 verifies this propagation is real (it's listed as UNKNOWN/unverified in the prior audit) and, if it isn't instant today, closes that gap as part of making the Roles & Permissions UI trustworthy as the "authoritative" layer Part 6 asks for.

---

## 18. Phase-Wise Implementation Roadmap

Ten phases, in the dependency order derived in §14. Each phase below carries all 17 fields the request specifies.

### PHASE 1 — Baseline Snapshot + Mechanical, Non-Controversial Fixes

1. **Name:** Baseline Snapshot + Safe Mechanical Fixes
2. **Objective:** Freeze the current, verified behavior as a comparison point (§7 already IS this snapshot), and fix the handful of defects that are pure additions to currently-broken DENYs — nothing here can regress an existing ALLOW because nothing here touches an existing ALLOW.
3. **Why required:** Every later phase needs a trustworthy "before" state to diff against, and there's no reason to defer risk-free fixes behind riskier ones.
4. **Exact problems solved:** AUTH-D4 (GroupAdmin missing from server alias table), AUTH-D5 (`/api/integrations` alias-blind check — swap for an alias-aware check, still `Admin`-tier only, no new grantee), AUTH-D6 (server `Module` type gains the 6 missing keys — additive, no behavior change until Phase 6 wires them up).
5. **Files/modules likely affected:** `api/_lib/permissions.ts` (alias table + Module type), `api/integrations.ts`.
6. **Dependencies:** none — this is the entry point.
7. **Roles affected:** GroupAdmin (gains working API access, previously 403 — a false-DENY fix, not a new grant), Admin (unaffected — `/api/integrations` still Admin/GroupAdmin-only, just alias-aware now).
8. **Pages/routes affected:** none (API-only).
9. **Permissions affected:** none new — only closes false denials.
10. **Security impact:** Positive only — closes false-DENY gaps, grants nothing beyond what GroupAdmin already has everywhere else.
11. **Regression risks:** Near zero. The only way this regresses anything is if some caller relied on GroupAdmin's `/api/*` 403 as an (accidental) access control — verify no such reliance exists via a repo grep before merging.
12. **Exact tests required:** New: GroupAdmin can call `/api/[entity]` successfully for at least one entity per registered module. New: `/api/integrations` still 403s a non-Admin/GroupAdmin role. Regression: full existing `api/**/*.test.ts` suite unchanged pass count.
13. **Acceptance criteria:** GroupAdmin API calls that previously 403'd now succeed with correct, company-scoped results; every other role's API behavior is byte-for-byte identical to before.
14. **Rollback/safety:** Trivial — single-file, additive changes; revert commit if any regression surfaces.
15. **Required verification before commit:** `npx tsc --noEmit`, `npm run build`, full `api` vitest config run, the new GroupAdmin-API test.
16. **Commit boundary:** One commit: `fix(rbac): close GroupAdmin API false-denies (AUTH-D4/D5/D6)`.

### PHASE 2 — Role / Alias Normalization

1. **Name:** Unify Role Alias Resolution Across Client, Server, and Rules
2. **Objective:** Make `EXACT_ROLE_COMPATIBILITY` (client) the single generation source for the server's copy and for every Firestore rules regex that currently hand-lists role names.
3. **Why required:** Every later phase writes or edits a rules regex, a server check, or relies on a role resolving consistently — this must be true first, or later phases build on sand.
4. **Exact problems solved:** AUTH-S1 (rules regex blind to aliases), AUTH-S2 (`Acc` dead-end — decide: remove the alias entirely, forcing a fail-closed-with-clear-error, or map it somewhere real; default to removing it and logging a diagnostic, since no role document backs it today), AUTH-S3 (`Management`→`Admin` vs `Director` — **gated on BD-5**), AUTH-C6 (add a `name` reserved-word check to the `roles` create rule), AUTH-C7 (unify `getModuleVisibility()`/`resolveVisibility()`'s fallback direction — both should default to the SAFER (`'self'`) direction on an unresolved role).
5. **Files/modules likely affected:** `src/lib/permissions.ts`, `api/_lib/permissions.ts`, `src/lib/firestore.ts`, `firestore.rules` (every `actorRoleMatches(...)` call site — a mechanical, scripted expansion, not hand-editing 50+ regexes), a new small build-time generator script.
6. **Dependencies:** Phase 1 complete (clean baseline to diff against).
7. **Roles affected:** `Sales Executive`, `BDM`, `BDE`, `TL`, `Management`, `Acc` — every alias role that today silently fails a rules regex gains the SAME access its canonical role already has at the client layer (a false-DENY fix, not a new grant, EXCEPT for BD-5's pending decision on `Management`, which is a genuine business call, not just a rules-sync).
8. **Pages/routes affected:** none directly — this is a data-authorization-layer fix, but it changes whether writes that the UI already showed as allowed (because `canDo()` resolved the alias) now ALSO succeed at the rules layer. This closes a "UI allows, rules reject" class of bug for these specific alias roles.
9. **Permissions affected:** none conceptually new; closes rules-layer false denials for already-intended grants.
10. **Security impact:** Positive — removes a class of confusing, undocumented write failures; the `roleNotSystemProtected` extension closes a real (low-severity) gap.
11. **Regression risks:** Medium — an incorrectly-generated regex could either (a) still miss an alias (no worse than today) or (b) accidentally include a role that should NOT match (a new false-ALLOW). This is why the generator script + full emulator regression is mandatory before commit, not optional.
12. **Exact tests required:** New: for every alias role, a positive Firestore-emulator write-permission test proving parity with its canonical role. New: `roleNotSystemProtected` rejects a create with a reserved `name`. Regression: full existing `firestore.rules` emulator suite (multi-tenant security, self-escalation, all Inventory-phase suites) unchanged pass count. Negative: `Acc` (if the decision is to remove it) now fails closed with a clear, logged reason rather than a silent no-op.
13. **Acceptance criteria:** Every role in §4's table shows "Yes" in the "Matched by rules regex" column except genuinely-dead aliases explicitly decided to stay dead (`Acc`, pending its own confirmation).
14. **Rollback/safety:** Regenerate from the pre-Phase-2 alias table and redeploy rules if any regression surfaces — rules deploys are independently revertible from application code.
15. **Required verification before commit:** `npx tsc --noEmit`, `npm run build`, full emulator suite (the JBR-java Firestore emulator command pattern already established in this project), the new alias-parity tests, `BD-5` decision recorded in §15 before touching `Management`'s mapping.
16. **Commit boundary:** Two commits — (a) `fix(rbac): unify role alias resolution, generate rules regexes from EXACT_ROLE_COMPATIBILITY (AUTH-S1/S2/C6/C7)`, (b) a SEPARATE commit for the `Management`→? remapping once BD-5 is answered, since that one is a business-policy change with its own regression risk, not a mechanical sync.

### PHASE 3 — Centralize Business Permission Evaluation (Additive Plumbing)

1. **Name:** Extend the `roles` Document Schema + Verify Propagation
2. **Objective:** Make the `roles/{companyId}_{RoleName}` document capable of carrying visibility scope (not just module CRUD booleans) and verify that editing it actually propagates to a live session without a re-login.
3. **Why required:** Part 6 requires that Roles & Permissions become the authoritative business-permission layer; today visibility scope lives only in the static `roleBootstrap.ts` seed, not in the editable document.
4. **Exact problems solved:** Makes `visibility` per-role-per-module editable through the same UI that already edits CRUD grants; verifies (or fixes) the previously-UNKNOWN cache-propagation behavior from the prior audit's §Y.
5. **Files/modules likely affected:** `src/lib/roleBootstrap.ts` (seed becomes a template, not the runtime source once a company's role doc exists), the Roles & Permissions page/components, `useGlobalBoot`/role-cache invalidation logic, Firestore schema for `roles` documents (additive fields only).
6. **Dependencies:** Phase 2 (one alias source to key any new per-role-per-module scope field against).
7. **Roles affected:** None change access in this phase — this is pure plumbing. A role's resolved visibility must compute identically before and after this phase for every existing company (verified by a snapshot-diff test, not assumed).
8. **Pages/routes affected:** Roles & Permissions page gains new UI (an editable visibility selector per module), but no route guard changes.
9. **Permissions affected:** None change value in this phase.
10. **Security impact:** Neutral by design (additive schema, unchanged resolved values) — the actual scope-tightening/loosening happens in Phase 7, gated on §15's business decisions, not here.
11. **Regression risks:** Low if truly additive; the risk is a subtle default-value bug where an existing company's role document, lacking the new field, resolves differently than the old hardcoded seed did. Mitigate with an explicit "if the new field is absent, compute exactly what `roleBootstrap.ts` computed before" fallback, tested against every existing seeded role.
12. **Exact tests required:** New: snapshot test proving every existing role's resolved visibility is byte-identical before/after this phase, for every module. New: editing a role's visibility through the UI updates the live document and an open session's next permission check reflects it within the existing cache-invalidation window (measure and document the actual latency — this was UNKNOWN before, must become KNOWN here). Regression: full permission-resolution unit test suite.
13. **Acceptance criteria:** Zero resolved-permission changes for any existing role/company; the Roles & Permissions UI can now display and edit visibility scope; propagation latency is measured and documented.
14. **Rollback/safety:** Additive schema change — safe to roll back the UI/logic without a data migration (the new field simply goes unread again).
15. **Required verification before commit:** `npx tsc --noEmit`, `npm run build`, the snapshot-parity tests, a manual propagation-latency check recorded in the phase's own PR/commit notes.
16. **Commit boundary:** One commit: `feat(rbac): make role visibility scope editable via Roles & Permissions (additive)`.

### PHASE 4 — Align Routes / Pages / Actions

1. **Name:** Close Route-Guard Drift + Hardcoded Check Sweep
2. **Objective:** Fix the borrowed-module routes (§6/AUTH-D2) where doing so is low-risk (per BD-8), replace hardcoded `role===`/`isAdmin`-style checks outside `canDo()` with real permission checks (§13's "TBD, sized during Phase 4" row), resolve BD-4 (cases for Director) once answered.
3. **Why required:** Part 7/8 explicitly require finding and cataloging every duplicate authorization source before Phase 9's regression pass; doing the sweep here (not earlier) benefits from Phase 2/3's unified alias/permission plumbing already existing to migrate onto.
4. **Exact problems solved:** AUTH-D2 (route/module mismatches, per BD-8's per-route decision), CP-1 (wire the eligibility gate in, per BD-3's decision on which actions to block), AUTH-S5 (rename or re-route `/group/*` so its name matches its actual Owner-only gate — a documentation/clarity fix, zero access change), BD-4's `cases` grant if approved.
5. **Files/modules likely affected:** `src/app/router/routes.tsx`, `src/components/mobile/routing/MobileRoutes.tsx`, `src/lib/roleBootstrap.ts` (if BD-4 approved), `src/features/channel-partner/*` (CP-1 wiring), every file the Phase-4 grep sweep turns up (list to be finalized as this phase's first deliverable, before any fix).
6. **Dependencies:** Phase 2 (aliases), Phase 3 (plumbing to replace hardcoded checks with real ones).
7. **Roles affected:** Depends on BD-3/BD-4/BD-8 answers; the mechanical hardcoded-check replacements should affect zero roles' actual access (same outcome, cleaner mechanism) unless the sweep uncovers a check that was ALREADY wrong (each such case gets its own line item, tested individually, never bundled).
8. **Pages/routes affected:** `/stock-transfers` and whichever other borrowed-module routes BD-8 approves for their own module key; `/group/*` (rename only, if chosen).
9. **Permissions affected:** A new `stock_transfers` module (if BD-8 approves splitting it) requires a migration step: every role that currently has `stock:view` needs an explicit, equivalent `stock_transfers:view` grant added in the SAME commit, so no one loses access the moment the split lands.
10. **Security impact:** Positive (CP-1 closes a real gap, pending BD-3's scope); neutral-to-positive elsewhere.
11. **Regression risks:** Medium for the hardcoded-check sweep specifically — an old check and its `canDo()` replacement must be proven to agree on every role before the old check is deleted (the "keep both, diff" pattern from §13).
12. **Exact tests required:** New: parity test for every replaced hardcoded check (old logic vs. `canDo()`, same input, same output, across all 24 roles). New: CP-1 wiring — positive (eligible partner still acts normally) and negative (suspended/rejected partner blocked on exactly the actions BD-3 named) tests. Regression: full route/page access test suite, full Partner Portal test suite.
13. **Acceptance criteria:** Every hardcoded check either replaced-and-proven-equivalent or explicitly left in place with a documented Bucket-A reason; CP-1 enforced per BD-3; no route's accessible-role-set shrinks except where BD-8/BD-4 explicitly changed it.
14. **Rollback/safety:** Each replaced check is its own small commit; revert individually if one shows a discrepancy.
15. **Required verification before commit:** `npx tsc --noEmit`, `npm run build`, full route-access + Partner Portal test suites, the new parity tests.
16. **Commit boundary:** Multiple small commits, one per logical fix group (hardcoded-check sweep; CP-1 wiring; route/module realignment; `/group/*` rename) — never one giant "Phase 4" commit.

### PHASE 5 — Firestore/Data Authorization Groundwork

1. **Name:** Ownership-Field Audit + Rules-Pattern Design for the 8 Ungated Collections
2. **Objective:** Confirm (not assume) that `createdBy`/`assignedToId`/`partnerId`/`teamMemberIds` are reliably populated across historical data for `leads/customers/quotations/orders/products/vendors/cases/loan_applications`, and design the exact rules predicate pattern before writing any enforcing rule.
3. **Why required:** AUTH-C1 is this plan's highest-severity, highest-blast-radius fix. Writing the enforcing rule (Phase 7) before confirming the underlying data is clean risks a mass false-DENY the moment the rule goes live (e.g., a legacy Lead with no `assignedToId` becoming invisible to the rep who's always worked it).
4. **Exact problems solved:** Converts AUTH-C1 from "audit finding" to "designed, data-verified, ready-to-implement fix"; produces the actual rules pattern (mirroring the already-correct client `applyAccessFilters` logic) that Phase 7 will deploy.
5. **Files/modules likely affected:** none changed yet — this phase's output is a data report + a rules-pattern design document appended to this file, plus (if needed) a backfill script for records missing an ownership field, modeled on the existing `backfill-sku-locks.ts`/`backfill-dispatch-serials.ts` dry-run-first pattern.
6. **Dependencies:** Phase 2 (rules regex/alias groundwork already in place for whatever role check the new predicate combines with).
7. **Roles affected:** none yet — audit only.
8. **Pages/routes affected:** none.
9. **Permissions affected:** none yet.
10. **Security impact:** none yet (this phase produces no enforcing change) — but it is the prerequisite that makes Phase 7 safe rather than reckless.
11. **Regression risks:** none (read-only audit + optional dry-run backfill report, never an auto-applying write, matching this project's established backfill-script discipline).
12. **Exact tests required:** A data-coverage report: % of each collection's live documents with a valid, resolvable `createdBy`/`assignedToId`/`partnerId`. Any record failing this check is listed by id for a human decision (assign to a default owner? grandfather as company-wide-visible? — this itself may become a §15 addendum if the numbers are non-trivial).
13. **Acceptance criteria:** A written rules-pattern design (below is the starting draft) plus a data-coverage report with either a clean bill of health or an explicit backfill plan.
14. **Rollback/safety:** N/A — no production change in this phase.
15. **Required verification before commit:** The audit script itself passes `npx tsc --noEmit` if written in TypeScript; its report is reviewed before Phase 7 starts.
16. **Commit boundary:** One commit: `docs(rbac): Phase 5 ownership-field audit + rules pattern design for AUTH-C1`. If a backfill is needed, that is its OWN, separate, dry-run-first commit, run and reviewed before Phase 7, never bundled with the rules change itself.

**Draft rules pattern** (subject to this phase's audit confirming it's viable, and to §15's BD-1/BD-2 answers determining WHICH roles it applies to):

```
function isOwnedRecord(data) {
  return isSignedInActor() &&
    (
      data.createdBy == request.auth.uid ||
      data.assignedToId == request.auth.uid ||
      (data.partnerId != null && data.partnerId == callerPartnerDocId()) ||
      (data.assignedToId in callerTeamMemberIds())   // Manager/team scope
    );
}
// Applied only for roles whose seeded visibility is 'self' or 'team' for this
// module (per Phase 3's now-editable visibility field) — a role seeded 'all'
// for this module keeps the existing sameCompany()-only grant, unchanged.
```

### PHASE 6 — API / Backend Authorization

1. **Name:** Fix the REST API Permission Lookup + Sync Server Alias Table
2. **Objective:** Close AUTH-D1 (the always-broken `getRoleDocument()` case-sensitivity bug and its unscoped fallback) and finish syncing the server's alias/Module tables to the client's (started in Phase 1/2).
3. **Why required:** This is the plan's other Critical finding — every single API-authorized request today is evaluated against a non-deterministic, potentially-wrong-company role document.
4. **Exact problems solved:** AUTH-D1 fully; AUTH-D4/D6 fully (Phase 1 only patched the alias table and Module type, this phase wires the actual lookup to use them correctly and company-scoped).
5. **Files/modules likely affected:** `api/_lib/permissions.ts` (the core fix — correct-case query, or better, query by document id `{companyId}_{RoleName}` directly instead of a `where('name',...)` scan at all, since the id is already deterministic and known), `api/_lib/auth.ts` (to confirm `companyId` is available at the point `getRoleDocument` is called).
6. **Dependencies:** Phase 2 (alias table to look up against).
7. **Roles affected:** every role that uses the REST API — this is a correctness fix, not a scope change: after the fix, a request is evaluated against the CALLER's own company's role document, which in the majority of cases (single-company deployments, or multi-company deployments where every company's "Sales" role happens to have the same grants) produces the identical outcome as today's non-deterministic lookup, and in the minority of cases (a company that has customized a role's permissions) produces the CORRECT outcome instead of a random other company's.
8. **Pages/routes affected:** none (API-only), but any integration or mobile flow that hits `/api/*` directly is affected.
9. **Permissions affected:** none in value, only in which document decides them.
10. **Security impact:** Strongly positive — closes a live cross-tenant policy-confusion bug.
11. **Regression risks:** Medium — if any existing caller was *relying* on the fallback's cross-company behavior (unlikely, since it's non-deterministic and therefore unreliable to depend on, but must be verified via a grep for any API integration test that pins today's specific — accidental — behavior).
12. **Exact tests required:** New: `getRoleDocument()` unit tests proving it finds the CALLER's own company's role document by deterministic id lookup (`{companyId}_{RoleName}`), for every seeded role. New: a multi-company fixture proving Company A's customized "Sales" role no longer leaks into Company B's evaluation. Regression: full existing `api/**/*.test.ts` suite.
13. **Acceptance criteria:** Every API permission check resolves the caller's own company's role document, every time, with zero unscoped collection scans remaining in the code path.
14. **Rollback/safety:** Single-file core fix; straightforward to revert if a regression surfaces, though given the severity, a fast-follow fix is strongly preferred over a rollback.
15. **Required verification before commit:** `npx tsc --noEmit`, `npm run build`, full API test suite, the new deterministic-lookup and multi-company-isolation tests.
16. **Commit boundary:** One commit: `fix(rbac): API permission lookup resolves caller's own company's role document (AUTH-D1)`.

### PHASE 7 — Role-Specific Scope & Ownership (the enforcing rules)

1. **Name:** Deploy Ownership-Predicate Firestore Rules for the 8 Ungated Collections
2. **Objective:** Close AUTH-C1, AUTH-C3, AUTH-C4 by giving `leads/customers/quotations/orders/products/vendors/cases/loan_applications` (and adding an ownership predicate to `commission_records`/`settlements`/`projects`'s existing but too-broad rule) a real, rules-enforced ownership check — mirroring the already-correct client logic — for every role whose seeded visibility is `self` or `team`.
3. **Why required:** This is the actual fix for the plan's highest-severity, highest-blast-radius finding.
4. **Exact problems solved:** AUTH-C1, AUTH-C3, AUTH-C4.
5. **Files/modules likely affected:** `firestore.rules` (new dedicated `match` blocks for the 8 collections, modeled on the `channel_partners`/Inventory-domain pattern already proven in this codebase; tightened predicates on `commission_records`/`settlements`/`projects`).
6. **Dependencies:** Phase 5 (data audit clean / backfill complete), Phase 2 (alias-expanded role regexes already correct), **§15 BD-1 and BD-2 answered** — the predicate is only ever applied where a role's visibility is `self`/`team`; a role seeded `all` for a module keeps today's company-only grant untouched, so BD-1/BD-2's "keep company-wide" default answer means Sales/Manager's operational modules literally do not change in this phase — only the modules already seeded `self`/`team` (Partner's leads/customers/projects, Manager's team-scoped leads/customers/projects, the project-scoped field roles) gain real enforcement of a scope they're already SUPPOSED to have, per the seed.
7. **Roles affected:** Partner (its leads/customers/projects self-scope becomes REAL — this closes a security gap, it does not remove access Partner has today, since Partner never had legitimate access to another partner's records to begin with, only an accidental ability to reach them by direct id); Manager (team-scope on leads/customers/projects becomes REAL, same non-regression logic); the 5 project-scoped field roles (already enforced, verify no change); every role reading `commission_records`/`settlements` (narrows to genuinely-owned rows only, per each role's own visibility).
8. **Pages/routes affected:** none directly — this is a data layer change; the UI already only ever DISPLAYED the scoped view (via `applyAccessFilters`), so no page should visibly change for a user operating through the normal UI. The only observable change is that a direct Firestore call (browser console, a compromised session, dev tools) that previously succeeded against an out-of-scope record now correctly fails.
9. **Permissions affected:** none in the `Permission`/`Module` sense — this is purely the ownership-scope layer becoming enforced rather than advisory.
10. **Security impact:** This IS the security fix — the plan's central deliverable.
11. **Regression risks:** **High** if the ownership-field data audit (Phase 5) missed edge cases, or if the rules predicate has a subtle bug (e.g., treating a Manager's OWN un-assigned-to-self lead as out-of-scope). This is why Phase 5's groundwork and Phase 9's full regression exist as separate, mandatory gates around this phase, and why this phase should be rolled out per-collection (8 separate sub-commits, each independently verified and independently revertible), not as one 8-collection rules deploy.
12. **Exact tests required (per collection, all 8):** Positive — the record's owner/assigned rep/team member/partner can still read, create, and edit it exactly as before. Negative — a same-company user OUTSIDE that ownership/team boundary can no longer direct-read or direct-write it. Regression — every existing emulator suite (multi-tenant, self-escalation, Inventory-phase) unchanged pass count. Full Sales/Manager/Partner UI-flow regression (§19) confirming the list/detail pages a normal user sees are visually unchanged (since they were already client-filtered to the same scope).
13. **Acceptance criteria:** All 8 collections show "FIRESTORE" (not "UI-ONLY") in §7's enforcement column for every role whose visibility is `self`/`team`; every `all`-visibility role's access is provably unchanged; a direct-id probe outside a user's scope fails where it previously succeeded.
14. **Rollback/safety:** Per-collection commits and rules-deploys, each independently revertible; a staged rollout (e.g., `cases`/`loan_applications` first, since they're lower-traffic, before `leads`/`customers`) is strongly recommended to limit blast radius of any surprise.
15. **Required verification before commit (per collection):** `npx tsc --noEmit`, `npm run build`, that collection's new emulator test file, the FULL existing emulator suite (not just the new tests — this phase is exactly the kind of change that could silently break an unrelated suite via a shared helper), a manual smoke-test of the Sales/Manager/Partner UI flows touching that collection.
16. **Commit boundary:** 8 separate commits, one per collection (`feat(rbac): enforce ownership scope on {collection} (AUTH-C1)`), plus one more for the `commission_records`/`settlements`/`projects` tightening — never combined.

### PHASE 8 — Super Admin / Group Admin Hardening

1. **Name:** Close GroupAdmin's Remaining False Denies Without Touching Super Admin
2. **Objective:** Finish GroupAdmin's API access (built on Phase 1/6's alias fixes), resolve the `/group/*` naming question (per Phase 4's AUTH-S5, if not already done there), and perform an explicit, dedicated re-verification pass of every Super Admin boundary in §9 to PROVE none of Phases 1-7 accidentally touched it.
3. **Why required:** Part 5 singles out Super Admin/GroupAdmin for special treatment; this phase is the checkpoint that confirms the preceding, broader-reaching phases didn't erode either.
4. **Exact problems solved:** Final closure of AUTH-D4 (confirms Phase 1's fix holds end-to-end through the Phase 6 lookup rewrite); AUTH-S5 (if deferred from Phase 4).
5. **Files/modules likely affected:** none new, if Phases 1/4/6 already did their part correctly — this phase is primarily VERIFICATION, with fixes only if that verification finds drift.
6. **Dependencies:** Phase 6 (server alias/lookup fixes must exist for GroupAdmin's API access to actually work end-to-end).
7. **Roles affected:** GroupAdmin (full, working API access — a false-DENY closure); Super Admin/Owner (verified UNCHANGED, not "affected").
8. **Pages/routes affected:** `/group/*` rename, if applicable.
9. **Permissions affected:** none new.
10. **Security impact:** This phase's entire purpose is to be a security CHECKPOINT, not just a fix — its main deliverable is the completed §9/§10 verification checklist below, signed off before Phase 9 begins.
11. **Regression risks:** Low for the fixes themselves; the risk this phase specifically exists to catch is a LATENT regression introduced by an earlier phase that hasn't been noticed yet.
12. **Exact tests required:** Full re-run of every Super Admin boundary test named in §9's table (owner-email gate, unconditional bypass, `/platform/*`/`/group/*` access). Full re-run of every GroupAdmin boundary test named in §10's table (company-switching, cross-company user transfer, role creation, cross-group DENY). New: GroupAdmin end-to-end API test (create/read/update through `/api/[entity]` for a representative entity).
13. **Acceptance criteria:** Every row in §9 and §10 still reads exactly as documented, GroupAdmin's API access row flips from DENY to ALLOW (company-scoped, group-bounded), nothing else changes.
14. **Rollback/safety:** N/A for the verification itself; any fix found necessary follows that fix's own file's rollback plan.
15. **Required verification before commit:** `npx tsc --noEmit`, `npm run build`, the full Super Admin + GroupAdmin test suites, a signed-off checklist (literally: check every row of §9/§10 by hand against current code, not from memory).
16. **Commit boundary:** One commit if only the GroupAdmin API closure + optional rename land here: `feat(rbac): GroupAdmin API access + Super Admin/GroupAdmin boundary re-verification (Phase 8)`.

### PHASE 9 — Full Role × Page × Action Regression

1. **Name:** Complete Regression Against the §7 Baseline
2. **Objective:** Re-verify every cell of §7, for every role, against the CURRENT code — not from memory, not by assuming a phase's stated intent succeeded — and produce an updated §7 reflecting the new, intentional state.
3. **Why required:** This is the single gate that catches "technically cleaner, but Sales Executive can no longer create a Lead"-class regressions before they reach anyone.
4. **Exact problems solved:** None new — this phase finds problems INTRODUCED by Phases 1-8, if any, and is where they get caught before Phase 10.
5. **Files/modules likely affected:** None (verification-only), except the plan document itself (§7 is updated in place to reflect the new, approved state).
6. **Dependencies:** Phases 1-8 all complete.
7. **Roles affected:** All 24.
8. **Pages/routes affected:** All 86 desktop + 75 mobile routes.
9. **Permissions affected:** None new — pure verification.
10. **Security impact:** This phase is where a security REGRESSION (e.g., Phase 7's ownership predicate accidentally over-restricting a legitimate Manager) would be caught, if one slipped through the per-phase gates.
11. **Regression risks:** N/A — this phase exists to surface regression risk from prior phases.
12. **Exact tests required:** The full positive AND negative suite named in §19, run in full, for every role in §4, not a sample.
13. **Acceptance criteria:** Every §7 cell either matches its pre-Phase-1 value, or its new value is traced to an approved §15 decision or a named §12 defect fix — with zero unexplained deltas.
14. **Rollback/safety:** Any unexplained delta found here blocks Phase 10 and sends the specific offending change back to its origin phase for a fix-and-re-verify cycle — it does NOT get patched ad hoc inside Phase 9.
15. **Required verification before commit:** The full verification list in §20, run in its entirety.
16. **Commit boundary:** One commit, documentation-only: `docs(rbac): Phase 9 full regression — updated role × page × action baseline`.

### PHASE 10 — Final Security Audit + Production Readiness

1. **Name:** Independent Final Audit + Go/No-Go
2. **Objective:** Re-run the same forensic audit methodology used to produce the original "Neozy Access Ledger" (this document's evidence base), fully independently, against the post-Phase-9 code, to confirm every finding in §12 is genuinely closed (or, for the business-policy items, genuinely resolved per §15's recorded decisions) and no new class of finding was introduced.
3. **Why required:** A phase-by-phase regression gate (Phase 9) proves nothing broke; it does not, by itself, prove nothing NEW is wrong — a fresh, full audit is the only way to make that claim.
4. **Exact problems solved:** Whatever this final pass finds — ideally nothing new, but the whole point is not to assume that.
5. **Files/modules likely affected:** None — audit-only.
6. **Dependencies:** Phase 9 complete and clean.
7. **Roles affected:** All.
8. **Pages/routes affected:** All.
9. **Permissions affected:** None (audit).
10. **Security impact:** This is the final confirmation gate before calling the roadmap done.
11. **Regression risks:** N/A.
12. **Exact tests required:** Everything in §20, plus a fresh independent read of `firestore.rules`, `api/_lib/*`, and every route guard file, exactly as rigorous as the original audit that produced §12 — re-verified, not copied.
13. **Acceptance criteria:** A final report using the same A-Z structure as the original "Neozy Access Ledger," with an updated verdict — the explicit goal being to move from "RBAC CONDITIONALLY READY" to "RBAC READY."
14. **Rollback/safety:** N/A.
15. **Required verification before commit:** All of §20.
16. **Commit boundary:** One commit if any final touch-up is needed; otherwise, no code commit — the deliverable is the final audit report/artifact plus a closing entry in this document's changelog.

---

## 19. Regression Gate — Applied After Every Phase

**Positive tests** ("what should this role still be able to do"):

- Sales Executive can still create/edit a Lead, Customer, Quotation; create an Order; create Dispatch and view its selling price; view Products/Stock/Banks/Loan Applications.
- Manager/TL still sees their team's Leads/Customers/Projects and the full company's Quotations/Orders/Dispatch/Stock/Products/Partners/Loan Applications.
- Accounts still has full Payments/Invoices/Tax-Invoice control, order/dispatch approve, payout disburse, report export.
- Warehouse/Operations still perform every stock/dispatch/GRN/return/transfer action within their own warehouse.
- Admin/Owner retain full, unconditional access everywhere within (Admin) or without (Owner) tenant boundaries.
- Channel Partner still reaches every Partner Portal surface at its current scope.
- GroupAdmin remains fully functional across every company in its group, on every surface it has today, PLUS the API access Phase 1/6/8 add.
- Super Admin remains fully functional, unconditionally, everywhere.

**Negative tests** ("what must this role never be able to do"):

- Unauthorized roles remain denied on every module they don't hold.
- Cross-company access remains blocked, at UI, API, and Firestore layers, for every role including GroupAdmin (bounded to its own group) and Owner (the sole exception, by design).
- Cross-group access remains blocked for GroupAdmin and everyone below it.
- Ownership restrictions are enforced (not just displayed) where §15 confirms they should be.
- Direct Firestore document-id access cannot bypass authorization for any collection touched by Phase 7.
- Query-based access cannot return out-of-scope documents for any collection touched by Phase 7.
- REST API authorization cannot be bypassed or cross-tenant-confused (Phase 6).
- UI and backend decisions do not contradict each other for any flow exercised by the existing E2E/integration suites.
- No role can change its own role/company/group/superadmin flag, at UI, API, or Firestore layers (verify this STAYS true after every phase — it is the one check every phase should explicitly re-run, since it is the highest-value invariant in the whole system).

---

## 20. Test Strategy

Run, at minimum, before every phase's commit (per-phase specifics layered on top, per §18):

- `npx tsc --noEmit`
- `npm run build` (production build)
- All existing RBAC/security-named test files (`*rbac*`, `*security*`, `*permission*`, `*ownerAccess*`, `*groupAdmin*`, `*multiTenant*`, `*tenantIsolation*`)
- Firestore emulator suites relevant to the phase's touched collections, via the established JBR-java `firebase emulators:exec` pattern, run in FULL (not just the new tests) for any Phase 7 sub-commit
- API authorization tests (`vitest.api.config.ts`)
- Role normalization / alias resolution unit tests (new in Phase 2, re-run every phase after)
- Permission evaluation unit tests (`canDo()`, `resolveVisibility()`, `getModuleVisibility()`)
- Route/page access tests (desktop + mobile parity)
- Positive AND negative role tests per §19, for the roles/collections the phase touched at minimum, for ALL 24 roles at Phase 9
- Cross-company and cross-group tests
- Direct-document-id and query-bypass tests for any collection touched
- Ownership/scope tests for any collection touched
- Super Admin and GroupAdmin regression tests (every phase, not just Phase 8 — cheap insurance given how much of this plan touches adjacent code)
- Sales Executive, Admin/Owner, and Channel Partner regression tests (every phase touching a route, permission, or rule they depend on)
- The full pre-existing baseline suite (`npx vitest run`, expected 29 failed files / 65 failed tests — MUST match exactly; any delta is investigated before proceeding, never assumed to be "probably fine")

**Evidence required before any phase's commit:** the actual command output (not a summary) for every item above that the phase touches, attached to that phase's commit message or an accompanying note, following the exact discipline already established across the Inventory remediation program (INVENTORY-00 through INVENTORY-11) that this same repository has already proven works.

---

## 21. Commit Strategy

- One phase → one or a small number of tightly-scoped commits (§18 specifies the exact boundary per phase — some phases are genuinely one commit, Phase 7 is deliberately 9).
- Never combine two phases into one commit, even if both are "done" at the same time — land and verify Phase N fully before starting Phase N+1's commit.
- Never push an incomplete or failing phase.
- After every phase: run tests → `npx tsc --noEmit` → `npm run build` → review the diff for scope creep → verify no unrelated file changed → run the §19 regression checklist → commit → THEN start the next phase.
- Every commit message states which `AUTH-*` finding(s) or `BD-*` decision(s) it closes, so `git log` alone tells a future engineer why each change exists.
- Tag the repository (or note the commit hash in this document's changelog, §22) at the end of every phase, so any future rollback has a precise, named target.

---

## 22. Final Production-Readiness Checklist

Before declaring the roadmap complete (end of Phase 10):

- [ ] Every `AUTH-*` finding in §12 is either closed (with its closing commit hash recorded) or explicitly deferred with a written reason.
- [ ] Every `BD-*` decision in §15 has a recorded answer, dated, attributed to whoever made the call.
- [ ] §7's baseline has been re-verified end-to-end at least twice (once at Phase 9, once at Phase 10) with zero unexplained deltas.
- [ ] §9 (Super Admin) and §10 (GroupAdmin) checklists pass unchanged from their pre-Phase-1 values, except the specific, approved additions (GroupAdmin API access).
- [ ] The full pre-existing test baseline (29 failed files/65 failed tests) still matches exactly.
- [ ] A fresh, independent Phase 10 audit produces a verdict of "RBAC READY" (or explicitly documents why it does not, with a clear remaining-work list).
- [ ] Every commit from Phase 1 through Phase 10 is pushed and `origin/main` matches local `HEAD`.
- [ ] This document's changelog (below) records every phase's completion date and commit hash.

### Changelog

| Phase | Status | Commit(s) | Date |
|---|---|---|---|
| Planning (this document) | Complete | (docs commit, this file) | 2026-09-05 |
| Phase 1 | Not started | — | — |
| Phase 2 | Not started | — | — |
| Phase 3 | Not started | — | — |
| Phase 4 | Not started | — | — |
| Phase 5 | Not started | — | — |
| Phase 6 | Not started | — | — |
| Phase 7 | Not started | — | — |
| Phase 8 | Not started | — | — |
| Phase 9 | Not started | — | — |
| Phase 10 | Not started | — | — |
