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
| Own Leads/Customers (view + create) | ALLOW | **FIRESTORE (real, dedicated block)** — `canReadLeadScoped()`/`canReadCustomerScoped()`, Phase 7 (`9fd0e80` / `e708c4b`) | SELF (rules-enforced) |
| Own Projects (view + create) | ALLOW | **UI-ONLY** (`filterPartnerOwnedProjects`); `canReadProjectScoped()` grants any same-company Project read to non-field roles | intended SELF, actual COMPANY (AUTH-C4 — **BD-9 RESOLVED (a): keep as-is**, this is a deliberate breadth choice, not a hole) |
| Own commissions/settlements (view) | ALLOW | **FIRESTORE (real)** — `commissionSettlementReadAllowed()`, Phase 7 (`1916f4f`, AUTH-C3): Partner read requires `data.partnerId == actor.channelPartnerId` | SELF (rules-enforced) |
| Own payouts (view) | ALLOW | **UI-ONLY narrowing** on `partner_wallet_transactions` (separate block, not in AUTH-C3 scope) | intended SELF, actual COMPANY |
| Internal ERP routes (`/leads`, `/users`, …) | DENY | ROUTE — `isPartnerOnlyIdentity()` confines to `/partner/*` before any module check | n/a |
| Create NEW Lead/Customer/Project/Scheme while **suspended** or **inactive** | **DENY** (BD-3, owner-approved 2026-09-09) | **FIRESTORE** (`partnerCreateEligible()` / `channelPartnerStatusActive()`) + **API** (`assertApiPartnerCanCreate`) + workflow + client | n/a |
| View / update existing / in-flight work while **suspended** | ALLOW (unchanged — BD-3: close-out is preserved) | FIRESTORE / API (read + update rules untouched) | SELF (Partner rules-enforced, Phase 7) |
| Any action while **KYC** `not_started` / `pending` / `submitted` / `rejected` (status `active`) | ALLOW (BD-3: KYC is advisory, never a blocker) | — | as `active` |
| Any action while **inactive** / terminated | **DENY** everywhere | FIRESTORE (`transitionStatus` deactivates the linked `users` login → `actorIsActive()` cuts all) | n/a |

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
| Create a role document named after a system role | **DENY at the rules layer — closed in Phase 2 (AUTH-C6)**; the client UI's own check remains as a UX nicety, no longer the sole boundary | FIRESTORE (`isReservedSystemRoleName()`) + UI, §12 | n/a |

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
- **Two independently-defaulting visibility resolvers exist** and disagree on the unresolved-role fallback direction: `getModuleVisibility()` (`permissions.ts`) defaults to `'all'`; `resolveVisibility()` (`firestore.ts`) defaults to `'self'`. **Phase 2 investigated this (AUTH-C7) and closed it as intentional, not a defect** — see §12's AUTH-C7 row for the full evidence (both defaults are independently pinned by existing passing tests, and `getModuleVisibility()` has no live UI consumer at all). Left unchanged.
- **Phase 2 re-verified BD-1/BD-2's premise and confirmed it accurate**: the raw `LEGACY_SYSTEM_ROLES` literals in `roleBootstrap.ts` (e.g. Sales' `leads: {view,create,edit}`) have no `visibility` key at the source-literal level, which could be misread as implying `resolveVisibility()`'s `'self'` default applies to real Sales/Manager accounts — it does not. `legacyModulePermissions()` (the function that actually transforms those literals into a seeded Firestore role document) explicitly normalizes a missing `visibility` to `'all'` for every module, for every role, at seed time (`roleBootstrap.ts` — the ternary at the top of `legacyModulePermissions`). So the persisted role document Sales/Manager actually get always carries an explicit `visibility: 'all'` on these modules, and BD-1/BD-2's "current behavior: company-wide" description in §15 is correct as written. Recorded here so a future reader doesn't need to re-derive this two-step trace.
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
| REST API access | **RESOLVED in Phase 1** (see §18 Phase 1 completion record for the commit hash) — `groupadmin`/`tl`/`demo operator`/`demo admin` added to `api/_lib/permissions.ts`'s alias table, mirroring the client's table exactly; `/api/integrations` also now admits the literal `GroupAdmin` role. `AUTH-D1` (the underlying role-document lookup bug) is separate and still open, deferred to Phase 6. | `api/_lib/permissions.ts`, `api/integrations.ts` |
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
| AUTH-C1 | RBAC-001 | **Critical** | `leads/customers/quotations/orders/products/vendors/cases/loan_applications` have no dedicated Firestore rules block; ownership is client-only | **PARTIALLY CLOSED — Phase 7 (rules/SDK plane) + Phase 10 N1 (REST-API plane).** Phase 7: `leads` (`9fd0e80`) and `customers` (`e708c4b`) now have dedicated `canReadLeadScoped()`/`canReadCustomerScoped()` blocks enforcing the seeded `self`/`team` visibility at the rules layer. **Phase 10 (N1, `c665794`)** extended that same self/team ownership enforcement to the **generic REST API plane** for exactly those two collections: `GET /api/leads` / `GET /api/customers` (list) and `GET /api/{leads,customers}/:id` (direct-id read) previously enforced only company/group scope, so a Partner or Manager calling them directly retrieved every same-company record — AUTH-C1's blast radius, on the API plane. `api/_lib/ownership.ts` now resolves the caller's ownership scope from the trusted per-company role document (`'all'` for Admin/Director/Sales/GroupAdmin/Super Admin — unchanged) and, for a `self`/`team` caller, filters the tenant-scoped result to records whose `assignedToId`/`createdBy`/`partnerId` match the caller (or, for `team`, a direct report via `users.managerId`) — mirroring `applyAccessFilters` / `canReadLeadScoped` exactly. READ-only fix: create/update/delete authorization is unchanged; no `firestore.rules` change. The other 6 collections (`quotations/orders/products/vendors/cases/loan_applications`) are confirmed **no-op**: per BD-1/BD-2 (RESOLVED (a)) no role is seeded narrower than `'all'` on any of them, so there is no ownership predicate to enforce on either plane — they retain today's company-scope grant intentionally, not by omission. AUTH-C1a/AUTH-C1b remain deferred (see their rows). |
| AUTH-D1 | RBAC-002 | **Critical** | `api/_lib/permissions.ts`'s `getRoleDocument()` case-sensitivity bug makes its "fallback" (unscoped, cross-company, non-deterministic full scan) the only path that ever runs | **CLOSED — Phase 6** |
| AUTH-C3 | RBAC-003 | High | `commission_records`/`settlements` rules grant any same-company Manager/Partner/Director read on every row, no ownership predicate | **CLOSED — Phase 7 (`1916f4f`).** New `commissionSettlementReadAllowed(data)` helper replaces the non-GroupAdmin branch of the read rule on both `match /commission_records/{recordId}` and `match /settlements/{settlementId}`: owner/SuperAdmin unconditional; Admin/Manager/Director same-company company-wide (unchanged — `'all'` seed); Partner requires `sameCompany(data)` **and** `data.partnerId == actor.channelPartnerId` (self-scope now rules-enforced, not advisory). A row with no `partnerId` is denied to Partner. `create`/`update`/`delete` and the GroupAdmin ternary branch unchanged. Fits Firestore's 1000-expression budget (binds `authMap`+`actor` once via `let`; net expression count lower than the rule it replaces — verified: no budget error across repeated clean emulator runs). Tests: `commissionSettlementOwnershipScope.emulator.test.ts` (16/16), `sensitiveCollectionsRoleEnforcement.emulator.test.ts` (118/118). AUTH-S1b's `TL`-alias gap on the bare `Manager` alternation in these blocks is a separate false-DENY (safe direction) — **not folded in here**, remains deferred (see AUTH-S1b row). |
| AUTH-C4 | RBAC-004 | High | `canReadProjectScoped()` allows any non-project-scoped role to direct-read any same-company project regardless of assignment | **CLOSED AS NOT-A-DEFECT — BD-9 RESOLVED 2026-09-05 (`4a01d7e`), re-confirmed at Phase 7 close.** BD-9 (a): any non-field-role reading any same-company Project by id is the deliberate, shipped intent (Managers/Sales/Accounts coordinating a project need company-wide project lookup); Manager/Partner were already separately narrowed to team/self via BD-2/the seed. `canReadProjectScoped()` requires **no change** — Phase 7 correctly made zero `projects` rules edits. The `commission_records`/`settlements` portion of Phase 7's objective was the real work here and is closed under AUTH-C3. |
| CP-1 | CP-1 | High | `validatePartnerCanAct`/`validatePartnerCanCreateLead` fully implemented, zero call sites — suspended/unverified partners act freely | **CLOSED — Phase 10 (BD-3, owner-approved 2026-09-09).** `validatePartnerCanAct` rewritten to the approved policy (KYC advisory; blocks NEW-record creation for non-`active` status) and wired into the real enforcement paths: `firestore.rules` `partnerCreateEligible()` on `leads`/`customers`/`projects` create + `channelPartnerStatusActive()` inside `schemeRegPartnerOwnsProject()`; the REST API `handleCreate` (`api/_lib/partnerEligibility.ts`); `partnerCreateLead` / `createSchemeRegistration` workflows; the four partner-portal create surfaces. A `'suspended'` partner keeps read/update on existing work; an `'inactive'` partner's linked login is deactivated (`transitionStatus`). See the §18 implementation record. |
| AUTH-C2 | RBAC-005 | Medium | Sales/Operations seeded at company-wide visibility; the seed's own comments say this should be narrower | **SUBSUMED / RESOLVED — no independent business decision remains.** (1) The premise is stale: the current `src/lib/roleBootstrap.ts` `Sales` and `Operations` blocks carry **no `visibility` key and no "should be narrower" comment at all** (re-verified in the Phase 10 audit — the comment this finding cited no longer exists in source; `legacyModulePermissions()` normalizes both roles to `visibility: 'all'` on every module). (2) The **Sales** half is decided by **BD-1 — RESOLVED 2026-09-05 (a)**: company-wide visibility for Sales/Sales Executive/BDM/BDE on leads/customers/quotations is the deliberate, recorded final answer (the BD-1 resolution's DBT-1 analysis found no decided design anywhere in the repo's history that Sales should be narrower). (3) The **Operations** half is a confirmed non-issue: Operations holds no role seeded narrower than `'all'` and has no team-scoped module (§7.4, Phase 5 audit), so there is no ownership predicate for any decision to enable. Nothing here blocks Phase 10. |
| AUTH-D4 | RBAC-006 | Medium | `GroupAdmin` missing from server `EXACT_ROLE_COMPATIBILITY` — 403 on every `/api/*` call | **CLOSED — Phase 1** |
| AUTH-D5 | RBAC-007 | Medium | `/api/integrations` does a raw `role==='Admin'` string check, alias-blind to GroupAdmin | **CLOSED — Phase 1** |
| AUTH-C6 | S-4 | Medium | `roleNotSystemProtected()` only inspects the client-controlled `isSystem` field, never checks `name` for a reserved/colliding value | **CLOSED — Phase 2** |
| AUTH-P1 | RBAC-008 | Low | No role template grants `cases` except Admin — likely an oversight for Director | Phase 4 — **BUSINESS DECISION REQUIRED, §15** |
| AUTH-P2 | RBAC-009 | Low | Manager has no approve grant on orders/dispatch — plausibly intentional separation of duties | none — **confirm intent only, §15** |
| AUTH-S1 | S-1 | Low | Firestore rules regex tests the raw stored role string, never the alias table — `Sales Executive`/`BDM`/`BDE`/`TL` fail any regex that lists only the canonical name | **CLOSED (banks) — Phase 2.** Every other `actorRoleMatches(...)` call site was individually audited (not blindly rewritten): 7 Inventory-domain sites (`stock`/`stock_reservations`/`stock_transfers`/`customer_returns`/`dispatch_serials`) already use a `.*Sales.*`/`.*Warehouse.*`-style wildcard that incidentally matches `Sales Executive` via substring (no gap) but NOT `BDM`/`BDE` (no substring match) — see **AUTH-S1b** below, deferred rather than fixed here. `commission_records`/`settlements` contain a bare `Manager` alternation with the same TL gap, but both collections are explicitly in-scope for AUTH-C3 (Phase 5/7) — touching them now would cross the "do not touch AUTH-C1/C3/C4 yet" boundary, so left untouched and re-flagged for that phase instead. `employees`/`payroll`/`payments`/`attendance` contain no Sales/Manager-family alternation at all — no gap. GroupAdmin needed no changes anywhere: every site either already lists it literally in the regex or routes it through a separate `isGroupAdmin() ? groupAdminCanRead(...) : ...` ternary that never reaches the regex branch at all. |
| AUTH-S1b | (new) | Low | `BDM`/`BDE` (Sales aliases) do not match the wildcard `.*Sales.*` alternation used on 7 Inventory-domain write rules (`stock`, `stock_reservations`, `stock_transfers`, `customer_returns`, `dispatch_serials`) — `Sales Executive` already matches via substring, but `BDM`/`BDE` contain neither "Sales" nor "Account" as a substring | **DEFERRED to Phase 5/7** — these exact collections are already tight against Firestore's 1000-expression budget (multiple inline comments in `firestore.rules` document live-verified overflow incidents on these same hot paths), so widening their alternations needs to be paired with a live budget re-check, not bundled into Phase 2's otherwise mechanical parity pass. Phase 5/7 already revisits these collections for AUTH-C1/C3/C4, making it the natural place to fold this in with a proper budget re-verification. |
| AUTH-S2 | S-2 | Low | `Acc` aliases to a role document that does not exist — silent full lockout | **INVESTIGATED, NOT CHANGED — Phase 2.** No seed script or test fixture in the repository ever creates a role document literally named `Acc` — but `Roles.tsx` permits an Admin to create an arbitrarily-named custom role, so a live company could in principle have one, and this audit has no access to production Firestore data to rule that out. Per the explicit instruction not to remove a mapping without evidence it's genuinely dead, **both** the client and server `acc: 'Acc'` entries are left exactly as they were. **Recommendation for whoever next touches this:** query production `roles` for a document named `Acc` before deciding between "map it somewhere real" and "remove it, fail closed with a clear diagnostic." |
| AUTH-S3 | S-3 | Low | `Management` aliases to `Admin`, not `Director` | **CLOSED — Phase 10 (BD-5 RESOLVED (b) 2026-09-09).** `Management` is an intentional `Admin` alias. The client (`src/lib/permissions.ts`) and REST API (`api/_lib/permissions.ts`) already mapped `management → 'Admin'`; the gap was `firestore.rules`, which had no `Management` handling at all. Now consistent across all three planes — `isAdmin()` / `roleMatches()` / `actorRoleMatches()` (via `roleStringMatches()`) and the direct `role in ['Admin', 'Management']` sites — and never widened past Admin. See the §18 "BD-5 / AUTH-S3 — IMPLEMENTATION RECORD". |
| AUTH-S5 | S-5 | Low | `/group/*` route naming implies GroupAdmin access it doesn't have | Phase 4 (rename or re-route) |
| AUTH-C7 | S-6 | Low | `getModuleVisibility()` and `resolveVisibility()` default an unresolved role in opposite directions | **INVESTIGATED, CLOSED AS NOT-A-DEFECT — Phase 2.** Both defaults are individually pinned by an existing, deliberate, passing unit test (`resolveVisibility`'s `'self'` default: `phase13RolesPermissions.test.ts`; `getModuleVisibility`'s `'all'` default: `channelPartnerGapRemediation.test.ts`'s "a role with NEITHER key" case) — changing either would be a regression against established, intentional test contracts, not a fix. They also serve different consumers: `resolveVisibility()` is the one function that actually drives `getAll()`'s query-level self/team scoping (`buildOwnershipVisibilityQueryPlan`); `getModuleVisibility()`/`usePermissions().getVisibility()` has **zero call sites anywhere in `src/` that consume its return value** (traced exhaustively — `useCasePermissions().getVisibility` and the general `usePermissions().getVisibility` are both defined, exported, and never invoked by any component). Unifying them would be a no-op for real authorization behavior and a real regression against the pinned tests. Left unchanged. |
| AUTH-D2 | DBT-2 | Low | 7 routes borrow another module's guard key instead of having their own | Phase 4 |
| AUTH-D6 | (new) | Low | Server `Module` type missing keys the client has (5, not 6 as originally estimated — corrected on Phase 1 verification: `cases, loan_applications, banks, payouts, scheme_registration`); server alias table missing `groupadmin`/`tl`/demo aliases | **CLOSED — Phase 1** |
| BANK-1 | BANK-1 | Low | No rules block for `banks/{id}/branches` — subcollection is fully unreachable (dead feature, not an exposure) | Out of scope — feature decision, not RBAC |
| AUTH-D9 | (new) | Low | `MobileInstallationsWorkspace.tsx` hardcodes `isAdmin = role==='Admin'\|\|role==='Director'` to gate 7 edit/schedule/checklist controls, with no `canDo()` involved. Desktop's `InstallationWorkspace.tsx` correctly uses `perms.canEdit('installations')`. Since Director is seeded view-only on every module, this mobile-only hardcoded check currently grants Director an edit capability on mobile that Director has nowhere else. | **CLOSED — Phase 10 (N2, `7f90239`).** The mobile workspace now derives a single `canEditInstallations = perms.canEdit('installations')` and gates all 7 controls on it — byte-for-byte the same permission gate desktop's `InstallationWorkspace.tsx` uses. The hardcoded `isAdmin` role check and its `useAppStore(s => s.user)` read are removed; no new role literal is introduced. This aligns mobile with desktop and with the seed: `installations` carries no role seeded narrower than the module grant, so an InstallationLead holding `installations:edit` now gets the mobile edit controls it always should have, and Director (seeded view-only) no longer gets a mobile-only edit capability. No `firestore.rules` change — `installations` write stays `canUpdateCompanyScoped()` (role-blind, the documented Bucket-B posture for non-sensitive project-lifecycle collections); this was a client-gate correctness bug, not a rules-layer exposure. Regression test: `src/components/mobile/installations/__tests__/mobileInstallationsPermissionGate.test.ts` (4 tests). |
| AUTH-D7 | (new) | Low | Server `Permission` type/`ALL_PERMISSIONS` missing `'disburse'` (present on the client, used for Accounts' payout-disbursement grant) | **CLOSED — Phase 6** |
| AUTH-D10 | (new) | Medium | `api/_lib/biometrics/authorization.ts` gates biometric enrollment on a raw `auth.role !== 'Admin' && auth.role !== 'HR' && !auth.isSuperAdmin` check — the same alias-blind, GroupAdmin-false-DENY pattern AUTH-D5 named for `/api/integrations`, at a different endpoint the Master Plan never enumerated | **CLOSED — AUTH-D10 follow-up (`38f3077`), between Phase 6 and Phase 7.** `resolveEnrollmentTarget()`'s on-behalf-of role gate changed to `auth.role !== 'Admin' && auth.role !== 'HR' && auth.role !== 'GroupAdmin' && !auth.isSuperAdmin` — the single missing GroupAdmin case added, mirroring `firestore.rules`' own raw-role-name style for this Bucket-A (materially-more-sensitive) boundary rather than routing it through `canDo()`. Same-company GroupAdmin on-behalf-of enrollment now works; cross-company still denied (the `sameGrp` cross-company/same-group extension is a separately-tracked deferred module-plumbing gap — `AuthenticatedUser` carries no `groupId` — not a business decision). Tests: `api/_lib/biometrics/__tests__/authD10GroupAdminEnrollment.test.ts` (13). Full record in the "AUTH-D10 — SECURITY FOLLOW-UP" section of §18. Re-verified still closed in the Phase 10 fresh audit. |
| AUTH-C1a | (new) | Medium | CSV-imported Leads (`Leads.tsx`'s CSV import path) are persisted with `assignedToId: ''` — no assignee at all, unlike every other lead-creation path (which round-robin-assigns via `getNextAssignee()`). Under a future 'self'/'team' ownership rule these leads become invisible to everyone except an `'all'`-visibility role. | **Discovered — Phase 5, not fixed** (Phase 5 is audit-only). Phase 7 must decide — with an explicit answer, not a guess — whether unassigned records default company-wide-visible or need a pre-deployment backfill. |
| AUTH-C1b | (new) | Low | `loan_applications`'s exact `assignedToId` coverage was not conclusively confirmed — `loanApplicationWorkflow.ts` serves more than one registration-type collection and this pass could not isolate the field's reliability specifically for `loan_applications`. | **Discovered — Phase 5, incomplete evidence, not asserted either way.** Needs a dedicated, narrower read before Phase 7 touches this collection. |
| AUTH-C4a | (new) | Medium | Narrowing `canReadProjectScoped()` beyond the 5 already-enforced project-scoped field roles has no corresponding BD-1..BD-8 entry — nobody has posed or approved the business question of whether Manager/Partner/Sales/Accounts/etc. should be limited to assigned-only project reads. | **BUSINESS DECISION REQUIRED — new, tracked as BD-9 in §15.** Not decided; not guessed. |

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
| `roleNotSystemProtected()` | Prevents mutating a system role's identity | **CLOSED — Phase 2.** Checked only the client-supplied `isSystem` field; a reserved-name check is now applied as an independent, standalone `isReservedSystemRoleName()` guard on the create/update rules — deliberately NOT folded into `roleNotSystemProtected()` itself, since a first attempt at exactly that broke `roleSystemIdentityUnchanged()`'s branch-2 algebra (caught by the pre-existing `rolesSystemRolePermissionEditFix.emulator.test.ts` regression suite before it reached a commit — see that fix's own code comment for the full trace) | Low — isolated, independently tested |
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
| BD-1 | Should **Sales** (incl. Sales Executive/BDM/BDE) see every company Lead/Customer/Quotation, or only their own? | Company-wide (`visibility` unset → `'all'`) | (a) Keep company-wide — reps benefit from shared pipeline visibility; (b) narrow to `self`; (c) narrow to `team` if a manager hierarchy exists for reps too | None if (a) is the genuine intent — it's a scope-breadth choice, not a hole, since it's uniform within the tenant | Sales, Sales Executive, BDM, BDE — every one of their list/detail pages | **RESOLVED 2026-09-05 — (a), preserve company-wide.** See the "BD-1 / BD-2 — BUSINESS DECISION RESOLUTION" record below §18's Phase 6 completion record for the full evidence trace. |
| BD-2 | Should **Manager** see all company Quotations/Orders/Dispatch/Stock/Products/Partners/Loan Applications, or only their team's? | Company-wide (seed sets no `visibility` override on these modules, unlike Leads/Customers/Projects which ARE team-scoped) | (a) Keep as company-wide (the seed's own asymmetry may be deliberate — Managers coordinating fulfillment need company-wide stock/order visibility even if their *sales* pipeline view is team-scoped); (b) extend team-scoping to these modules too | Same as BD-1 — a breadth choice | Manager/TL | **RESOLVED 2026-09-05 — (a), preserve the existing split exactly as seeded.** See the "BD-1 / BD-2 — BUSINESS DECISION RESOLUTION" record below §18's Phase 6 completion record for the full evidence trace. |
| BD-3 | Should the Channel Partner status/KYC eligibility gate (`validatePartnerCanAct`) actually block a suspended/rejected partner, or stay advisory-only? | Fully implemented, never called (CP-1) | (a) Wire it into `partnerCreateLead`/commission generation as a hard block; (b) formally retire it as dead code and remove the UI implication that it's enforced (the "KYC Verified" badge) | Currently a false sense of enforcement — the badge implies a gate that isn't there | Channel Partner, every internal workflow that creates records on a partner's behalf | **RESOLVED 2026-09-09 — owner-approved policy. KYC is ADVISORY (never blocks an action). `status` gates NEW-record creation only:** verified/active + KYC-pending + KYC-rejected → full access; **suspended** → BLOCK new Lead/Customer/Project/Scheme (existing/in-flight work stays viewable + editable; pre-suspension earned commission preserved); **inactive/terminated** → full stop (linked login deactivated). Implemented at rules + REST API + workflow + client. See the "BD-3 / CP-1 / CP-2 — IMPLEMENTATION RECORD" in §18. |
| BD-4 | Should `cases` be granted to Director (and possibly Manager) alongside Admin? | Only Admin has the module at all | (a) Add `cases:view` to Director's (and/or Manager's) seed; (b) leave as Admin-only | Currently a probable false DENY, not a security risk either way | Director, Manager | **(a)** for Director specifically (matches its existing "view everything" mandate); Manager needs an explicit answer |
| BD-5 | Should `Management` (the literal role string) alias to `Director` (read-only) instead of `Admin` (full access), matching what the name implies? | Aliases to `Admin` today | (a) Re-point the alias to `Director`; (b) leave as `Admin` (perhaps `"Management"` was always meant as an `Admin` synonym, not a `Director` synonym, in this org's usage) | If (a) is correct and left unfixed, every `Management`-titled account is over-privileged today | Any account currently stored with role string `Management` | **RESOLVED 2026-09-09 — (b): `Management` is an intentional alias of `Admin`.** The client and REST-API alias tables already resolved it to `Admin`; the change makes `firestore.rules` agree (it had no `roleMatches('Management')` at all — a live client/API↔rules disagreement). Now consistent across all three planes: `isAdmin()` / `roleMatches()` / `actorRoleMatches()` and the direct `== 'Admin'` sites all treat `Management` exactly as `Admin`, never wider (not GroupAdmin/Owner/SuperAdmin). AUTH-S3 CLOSED. See the "BD-5 / AUTH-S3 — IMPLEMENTATION RECORD" in §18. |
| BD-6 | Should Accounts gain a `partners` module grant (even view-only), given it currently has none? | No grant at all | (a) Add view-only; (b) leave as-is (Accounts may legitimately have no reason to see partner relationship data, only commission/payout amounts which it already has via Payouts) | None — this is a scope-breadth question, not a security gap | Accounts | **(b)**, preserve as-is, unless the business identifies a concrete need |
| BD-7 | Is Manager's lack of an approve grant on Orders/Dispatch intentional separation of duties, or a gap? | DENY | (a) Leave denied (Accounts/Warehouse approve, by design); (b) grant Manager approve too | None either way — purely a workflow-design question | Manager | **(a)**, preserve as-is; separation-of-duties patterns are usually deliberate and this one is internally consistent with the Accounts/Warehouse payout-approve-vs-disburse split already in the seed |
| BD-8 | Should the 7 "borrowed-module" routes (§6/AUTH-D2) get their own dedicated module keys, or is sharing acceptable? | Shared keys today (e.g., `/stock-transfers` uses `stock`) | (a) Give each its own module (finer-grained, more Roles & Permissions checkboxes to manage); (b) formally document the sharing as intentional and leave it | Low either way — the shared grant is at least consistent, not contradictory | Whoever holds the parent module's grant today | **(b)** for low-traffic borrowed routes, **(a)** is worth it only for `/stock-transfers` specifically since stock viewing and stock transferring are meaningfully different risk levels; needs a decision per-route, not a blanket one |
| BD-9 | Should `canReadProjectScoped()` be narrowed beyond the 5 already-enforced project-scoped field roles (Surveyor/Engineer/InstallationLead/ServiceTechnician/ComplianceOfficer) — i.e., should Manager/Partner/Sales/Accounts/Director/etc. be limited to assigned-only Project reads instead of any same-company Project? | ALLOW — any non-field-role actor reads any same-company Project directly (AUTH-C4/AUTH-C4a, discovered in Phase 5) | (a) Leave as-is (Managers/Sales/Accounts coordinating a project plausibly need to look up any company project by id, not just their own); (b) narrow to assigned-only for some or all of these roles | If (a) is the genuine intent, this is a scope-breadth choice, not a hole; if not, it's a real over-exposure of customer/project detail across teams | Manager, Partner, Sales, Accounts, Director, and any other non-field-role | **RESOLVED 2026-09-05 — (a), preserve current behavior.** (Manager/Partner were already separately narrowed to team/self via BD-2/the pre-existing seed, unaffected by this row.) See the "BD-9 / AUTH-C4a — BUSINESS DECISION RESOLUTION" record below the BD-1/BD-2 resolution for the full evidence trace. |

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
- **How Firestore authorization relates to the central permission model:** rules remain independently authoritative for Bucket A (§11) checks — they are never *derived* from the `roles` document at write-time (a compromised or misconfigured role document must not be able to grant itself write access to protected collections). For Bucket B checks, rules gain the SAME alias-expanded role regexes the client and server use, without making rules read the permission document live (that would be both slower and a new attack surface — a `roles` doc allowing writes to itself is exactly the kind of self-referential risk Bucket A exists to prevent). **Phase 2 applied this to the one genuinely affected, non-deferred site it found (`banks`)** — see §12's AUTH-S1 row for the full site-by-site audit of why every other candidate site was either already correct, already routed around the gap via a ternary, explicitly deferred (AUTH-S1b), or out of bounds (AUTH-C3's collections). AUTH-S2 (`Acc`) and AUTH-S3 (`Management`, blocked on BD-5) were investigated but deliberately left unchanged — see their §12 rows.
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

**PHASE 1 COMPLETION RECORD**

- **Status:** COMPLETE (local commit only — not pushed to `origin/main` per explicit instruction; production untouched).
- **Verified against current code before implementing** (per this phase's own discipline): `api/_lib/permissions.ts`'s `EXACT_ROLE_COMPATIBILITY` was confirmed still missing `groupadmin`/`tl`/`demo operator`/`demo admin`; `api/integrations.ts` was confirmed still doing the raw `auth.role !== 'Admin'` check; the server `Module` type was confirmed missing keys the client has. **One discrepancy found and corrected on verification:** the plan's §12 register originally said "6" missing module keys — direct inspection found exactly **5** (`cases, loan_applications, banks, payouts, scheme_registration`); corrected in place above, does not change the fix's nature or risk.
- **Findings closed:** AUTH-D4, AUTH-D5, AUTH-D6 (register updated above).
- **Files changed:** `api/_lib/permissions.ts` (alias table + Module type, additive), `api/integrations.ts` (one literal-string addition to the authorization check), plus two new test files (`api/_lib/__tests__/groupAdminApiAccess.test.ts`, `api/__tests__/apiIntegrationsAuthorization.test.ts`).
- **Tests:** 21 new tests, all passing (positive: GroupAdmin/TL/demo aliases now resolve and behave exactly as their canonical role; negative: ordinary roles unaffected, unknown/malformed roles still fail closed, Super Admin bypass unaffected, company-scoping via `canAccessApiResource` unaffected, `/api/integrations` still denies Sales/Manager/HR/Warehouse/Operations/Partner/Director/arbitrary custom roles **and** deliberately does not widen to Management/demo aliases). Full API suite: 14 files / 327 tests pass (was 12 files / 306 before this phase — the delta is exactly the 2 new files / 21 new tests, zero regressions). `npx tsc --noEmit`: clean. `npm run build`: clean. Full `npx vitest run`: 29 failed files / 65 failed tests — the documented pre-existing baseline, unchanged.
- **Deviations from the plan's original Phase 1 text:** none in the fix itself. The AUTH-D5 fix used an explicit literal `auth.role !== 'GroupAdmin'` addition rather than routing through the shared alias table, specifically to avoid also admitting `Management`/`demo operator`/`demo admin` (which alias to `Admin` elsewhere) — a narrower implementation than "use the alias table" might have suggested, chosen because the finding as documented named GroupAdmin specifically and the task's own instructions warned against incidentally widening this endpoint.
- **Deferred finding surfaced during Phase 1 verification (NOT fixed):** **AUTH-D7** — the server `Permission` type (`api/_lib/permissions.ts`) is missing `'disburse'`, which the client `Permission` type has (used for Accounts' payout-disbursement grant). Not fixed here because it was not named in AUTH-D6's scope (module keys only) and is currently inert: no `ENTITY_REGISTRY` entry exposes the `payouts` module over the REST API, so no live code path can call `canDo(user, 'disburse', 'payouts')` today. Belongs with Phase 6 (API/backend authorization), alongside the rest of the server-side type/alias sync work.

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

**PHASE 2 COMPLETION RECORD**

- **Status:** COMPLETE for the mechanical/investigative scope; **PARTIAL by design** — one item (BD-5/`Management`) is explicitly blocked on a business decision and was correctly left unresolved rather than guessed. Local commit only — not pushed to `origin/main`; production untouched.
- **A "build-time generator" was deliberately NOT built.** The plan's own text called for one "where technically appropriate." After auditing every `actorRoleMatches`/`roleMatches` call site in `firestore.rules` individually (not a blind sweep), the genuine, non-deferred, non-budget-risk gap turned out to be exactly one line (`banks`'s read rule). A generator script for a single call site would have been pure ceremony; the fix was instead applied as a direct, heavily-commented literal expansion, with explicit provenance back to `EXACT_ROLE_COMPATIBILITY`'s exact entries so it stays reviewable and re-derivable by hand. If Phase 5/7 finds AUTH-S1b's deferred Inventory-domain sites genuinely need the same treatment, a generator becomes worth building at that point — noted there, not built prematurely here.
- **Findings closed:** AUTH-S1 (the one non-deferred site — `banks`), AUTH-C6 (reserved system role name protection), AUTH-C7 (investigated, closed as not-a-defect — see §12).
- **Findings deliberately NOT closed, with reasons:** AUTH-S1b (new — BDM/BDE substring gap on 7 budget-sensitive Inventory sites, deferred to Phase 5/7); AUTH-S2 (`Acc` — insufficient evidence whether any live company has a role document by that name; left unchanged, a live-data check is recommended before any future decision); AUTH-S3 (`Management`→`Admin` vs `Director` — **BUSINESS DECISION REQUIRED, BD-5, unresolved**, mapping left exactly as-is in both the client and server tables).
- **A real bug was found and fixed in this phase's OWN first attempt, before it ever reached a commit:** folding the reserved-name check directly into `roleNotSystemProtected()` (the "obvious" implementation) silently broke `roleSystemIdentityUnchanged()`'s branch-2 logic — a request that flipped a genuine system role's `isSystem:true` to `false` while leaving its (still-reserved) name untouched was wrongly ALLOWED, because the corrupted function now treated "name is reserved" as equivalent to "isSystem is true" in a context that assumed the two were the same thing. Caught immediately by re-running the pre-existing `rolesSystemRolePermissionEditFix.emulator.test.ts` suite (2 of its 12 tests failed) before any commit was made. Fixed by keeping `roleNotSystemProtected()` completely unchanged and applying the reserved-name check as a fully independent, non-interacting AND-clause directly on the create/update rules instead. Full trace preserved in `firestore.rules`' own comments at the fix site — this is exactly the class of subtle rules-interaction the Master Plan's regression-gate discipline exists to catch, and it worked.
- **Files changed:** `firestore.rules` (banks alias expansion + reserved-name guard, both additive), `vitest.emulator.config.ts` (registers the 2 new test files), plus the 2 new emulator test files themselves.
- **Tests:** 2 new emulator test files, 17 new tests, all passing after the fix above (10 in `rolesReservedSystemNameProtection.emulator.test.ts`, 7 in `banksRoleAliasParity.emulator.test.ts`). Full regression run across 26 emulator test files (~750 assertions, batched per the established JBR-java pattern): 100% pass, including the specific `rolesSystemRolePermissionEditFix.emulator.test.ts` (12/12), `multiTenantSecurity`/`groupAdminFullGroupAccess`/`rbacPhase8CumulativeSecurity`/`sensitiveCollectionsRoleEnforcement`/`missingIsSuperAdminFieldFix` (423/423), and the full Inventory-domain suite (2 transient environment timeouts on first run, both large-batch resource-contention flakiness per BRAIN.md's own documented characteristic of this sandbox — re-ran in isolation and both passed cleanly, 29/29). `npx tsc --noEmit`: clean (no client/server TypeScript was touched this phase). `npm run build`: clean. Full `npx vitest run`: 29 failed files / 65 failed tests — the documented pre-existing baseline, unchanged.
- **A significant self-correction made and then reversed during this phase's own investigation** (recorded here so it isn't silently lost): while investigating AUTH-C7, tracing only as far as the raw `LEGACY_SYSTEM_ROLES` literals in `roleBootstrap.ts` (which lack an explicit `visibility` key for Sales' `leads`/`customers`/`quotations`) initially suggested BD-1/BD-2's "current behavior: company-wide" premise might be wrong. Tracing one step further into `legacyModulePermissions()` (the function that actually seeds the Firestore role document) showed it explicitly normalizes a missing `visibility` to `'all'` at seed time for every module — so the real, persisted behavior for Sales/Manager IS company-wide, exactly as §7/§15 already stated. No correction to §7/§15 was needed in the end; this note exists so a future reader doesn't have to re-walk the same two-step trace.
- **Deviations from the plan's original Phase 2 text:** the plan's AUTH-S2 default recommendation ("remove the alias entirely... since no role document backs it today") was NOT followed, because this phase found the plan's own premise ("no role document backs it") cannot actually be verified without live production access — Roles.tsx permits arbitrary custom role names, so a company could have created one. Recommending removal without that verification would have been exactly the "guess" the task's instructions repeatedly warn against.
- **Commit boundary actually used:** one commit (not the plan's originally-sketched two), since the `Management`/BD-5 change never happened — there was no second, business-policy commit to make.

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

**PHASE 3 COMPLETION RECORD**

- **Status:** COMPLETE. Local commit only — not pushed to `origin/main`; production untouched.
- **MAJOR FINDING (verified against current source, not assumed from this Plan's own text): Phase 3's structural deliverables already exist and predate this Master Plan.** `ModulePermissionMap` (`src/lib/permissions.ts`) already types `visibility` as a required per-module field; `roleBootstrap.ts`'s `legacyModulePermissions()` already normalizes and writes an explicit `visibility` value into every seeded role document at creation time; `Roles.tsx` already renders a fully wired, live "Data Visibility" `<select>` (Self/Team/Global) per module, backed by its own `handleVisibilityChange` reducer, persisted through the exact same `save` mutation as every boolean permission. None of this carries a "Phase 3" (or any Master-Plan-phase) attribution — the codebase's own historical comments trace it to a *different*, pre-existing internal numbering ("RBAC Phase 2/6" etc. — this repository's own past remediation cycles, unrelated to and predating this Master Plan's Phase 1–10 scheme). **No new visibility mechanism was built** — doing so would have created exactly the "second source of truth" this Plan explicitly forbids. This phase's real, remaining work was therefore verification and measurement, not construction, and that is what was delivered.
- **Findings closed:** the plan's own Phase 3 acceptance criteria are met by the pre-existing implementation, now backed by an explicit regression contract that didn't exist before (see Files Changed).
- **Files changed:** two new test files only. **Zero production/source files were modified this phase** — `firestore.rules`, `Roles.tsx`, `roleBootstrap.ts`, `permissions.ts`, and `firestore.ts` are all byte-identical to the Phase 2 commit.
  - `src/pages/__tests__/rolesVisibilityEditingRegression.test.ts` (13 tests): source-verifies the existing visibility UI wiring; behaviorally mirrors `handleVisibilityChange`'s reducer to prove editing one module's visibility never disturbs a sibling module or that module's own boolean permissions, and that a legacy role document with no `visibility` field at all can still have it set additively; and — the acceptance-criteria test — asserts, for every one of the 15 seeded system roles across all `ALL_MODULES`, that `legacyModulePermissions()`'s existing (unmodified) normalization still produces an explicit `visibility` in `{self,team,all}` for every module, with spot-checks pinning Partner=self, Manager=team, Sales=all (per §7/§15's already-documented, independently-confirmed-in-Phase-2 baseline) and Admin=all everywhere.
  - `src/lib/__tests__/rolesPropagationLatency.test.ts` (3 tests): the required empirical propagation test — see below.
- **PROPAGATION — measured, not assumed:** traced the real mechanism (`useGlobalBoot.ts`'s `useQuery({queryKey:['roles_global',companyId], staleTime:1000*60*30})`, `Roles.tsx`'s `onSuccess: () => qc.invalidateQueries({queryKey:['roles_global']})`) and confirmed via repo-wide grep that `listenCollection` (this codebase's Firestore `onSnapshot` wrapper) is **never** called for the `roles` collection anywhere in `src/` — there is no realtime listener. The test file exercises the real `@tanstack/react-query` library (not a hand-rolled stand-in) with the app's exact query-key shape and `staleTime`, using two independent `QueryClient` instances to stand in for two independently-open browser sessions sharing one backing data source:
  - **The editor's own session:** propagates effectively immediately — measured at ~1ms in the test's mock data source (bounded in production by one Firestore document read, typically tens to low-hundreds of milliseconds), via the existing `invalidateQueries` call in `onSuccess`. No relogin needed for the person who made the edit.
  - **A different, already-open session (a separate `QueryClient`) watching the identical query key:** does **not** observe the change on its own. It continues to serve its cached (pre-edit) value until its *own* cache is invalidated or its 30-minute `staleTime` elapses *and* a refetch-triggering event fires (window refocus, remount) — confirmed by the test explicitly asserting the stale value persists after the other session's write+invalidate, and only updates once that second session runs its own `invalidateQueries`.
  - **Conclusion, stated plainly:** the current architecture does **not** provide true live (no-interaction) cross-session propagation of a role/visibility change. A relogin or manual page reload propagates it immediately (a fresh load has no stale cache to contend with), but a session that stays open will not see another user's role edit until up to 30 minutes pass with a refetch trigger, or the app is given an explicit mechanism to shorten or bypass that window.
- **DEFERRED, not resolved — flagged rather than guessed, per this phase's own explicit instruction:** whether to add a cross-session propagation mechanism (a realtime `onSnapshot` listener on the acting user's own role document, a materially shorter `staleTime`, or an explicit "your permissions changed — refresh" UI affordance) is an **architecture decision, not an additive schema change**, and carries its own regression/cost profile (new Firestore listener quota, added complexity) that does not belong in a phase explicitly scoped as "additive plumbing." Recorded here for a future phase (or an explicit business/engineering decision) to pick up — not invented or implemented now.
- **Tests:** 2 new files, 16 new tests, all passing. Regression: 7 related existing test files (`rolesPermissionMatrixCompleteness`, `roleBootstrap`, `useGlobalBootRegression`, `rolesGlobalCacheKey`, `phase13RolesPermissions`, `channelPartnerGapRemediation`, `channelPartnerPhase2Rbac`) — 114/114 pass, unchanged. `npx tsc --noEmit`: clean. `npm run build`: clean. Full `npx vitest run`: 29 failed files / 65 failed tests — the documented pre-existing baseline, unchanged (271 files/3689 tests total vs. Phase 2's 269/3671 — the delta is exactly the 2 new files/18 new tests).
- **Firestore emulator / API suites:** not re-run this phase — zero production/source files changed (only new, environment-independent unit tests were added), so neither surface could have regressed. Noted explicitly rather than silently skipped.
- **Deviations from the plan's original Phase 3 text:** the plan describes building schema + UI as this phase's work; neither was built, because both were found already complete on inspection. This is a deviation in *description*, not in outcome — every one of Phase 3's stated acceptance criteria (visibility editable via Roles & Permissions; zero resolved-permission change; propagation measured and documented) is met.
- **Business decisions:** none were required or resolved. BD-1 through BD-8 remain exactly as recorded in §15; BD-5 remains open.

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

**PHASE 4 COMPLETION RECORD**

- **Status:** COMPLETE for the work that does not depend on an unresolved business decision. BD-3, BD-4, and BD-8 all remain unresolved and were correctly NOT guessed — no CP-1 wiring, no `cases` grant, no route/module split happened this phase. Local commit only — not pushed to `origin/main`; production untouched.
- **Repo-wide hardcoded-authorization audit performed first, as required**, before any change. Searched for `role ===`/`role !==`/`role.includes`/`isAdmin`/`isSuperAdmin`/direct role-string comparisons across `src/` (124 files matched across both pattern families before filtering test files and the canonical definition files themselves out). Every non-test candidate was individually read and classified — not a blind sweep:
  - **Bucket A (kept hardcoded, correctly so):** every `role === 'GroupAdmin'` / `isGroupAdmin` check in `Companies.tsx`, `Users.tsx`, `MobileCompaniesWorkspace.tsx`, `MobileUsersWorkspace.tsx`, `GroupSettings.tsx`, `CompanySwitcher.tsx`, `PlatformUsers.tsx`, `PlatformGroups.tsx`, `useEmployees.ts`, `groupAdmin.ts` — these are identity-TIER routing decisions (which write path to use, which UI affordance a GroupAdmin-vs-Admin-vs-Owner tier sees, self-escalation-adjacent candidate filtering explicitly commented "not the security boundary") that `canDo()` has no vocabulary for at all — `canDo()` models module permissions, not identity tiers. Confirmed architecturally correct and consistent with how Owner/Super Admin checks are hardcoded everywhere else by design. **Not touched.**
  - **Bucket B, investigated, found to be deliberate business policy (not a bug) — not touched:** `RegistrationDetailModal.tsx` and `ProjectSchemeRegistrationWorkspace.tsx`'s `canReopen = isAdmin && canApprove && (...)` — a raw `role==='Admin'` check layered ON TOP of the canonical `canApprove('scheme_registration')` permission, restricting the specific "reopen a Completed/VendorLocked registration" action to Admin only even though Manager also holds `scheme_registration:approve`. There is no first-class "reopen" permission in the `Permission` type, and this reads as a deliberate, sensible extra restriction on an unusually sensitive override action, not a duplicate/drifted authorization system. Replacing it would either invent a new permission (out of Phase 4's scope) or WIDEN who can reopen a closed registration (a business-policy change, not a mechanical one). Left unchanged.
  - **Bucket B, replaced — the one genuine, safe fix found:** `src/components/dashboard/QuickActions.tsx`'s `normalizeRole()` silently fell through to `return UserRole.Sales` for ANY role it didn't explicitly name — mis-bucketing Manager, GroupAdmin, Procurement, TL, and the 5 project-scoped field roles (Surveyor/Engineer/InstallationLead/ServiceTechnician/ComplianceOfficer) into Sales' 5-module shortcut candidate list for this dashboard widget, regardless of those roles' real, much broader `canDo()` grants. This is a "UI shows fewer shortcuts than the role is entitled to" false DENY, scoped entirely to a convenience widget — the underlying pages were always correctly reachable via their own `canDo()`-gated routes/nav. Fixed so an unrecognized role now resolves to `null`, which the (also updated) `quickActionsForRole()` treats as "no bucket pre-filter — the existing, UNCHANGED `canDo()` check decides over the full action list." Since `canDo()` remains the same, unchanged, final gate, this can only surface actions a role's real permissions already grant — it cannot over-grant anything. **Disclosed side effect, verified inert:** the fix also gave literal `'Partner'` (previously silently hitting the same Sales fallback as every other unhandled role) its own already-defined `ROLE_MODULES.Partner` bucket — verified via `routes.tsx`'s `ProtectedLayout`, which redirects any `isPartnerOnlyIdentity()` session to `/partner` before this internal Dashboard widget can ever render for them, so no live Partner session is affected. The 8 explicitly-named roles' own bucket lists (Admin/Director/Sales/Accounts/Warehouse/HR/Operations/Partner) are **byte-identical** to before this fix — proven by a new test that mocks `canDo()` to always return `true`, isolating the pre-filter's own output from the real permission gate.
  - **New finding discovered during the sweep, deliberately NOT fixed (a real access reduction, not a mechanical no-op):** `src/components/mobile/installations/MobileInstallationsWorkspace.tsx` gates 7 edit/schedule/checklist controls on `isAdmin = role==='Admin'||role==='Director'` — a hardcoded check with no `canDo()` involved at all. The **desktop** equivalent (`src/pages/InstallationWorkspace.tsx`) correctly uses `perms.canEdit('installations')`. Director's seed (`roleBootstrap.ts`) is view-only on every module, including `installations` — so this hardcoded mobile check currently grants Director an EDIT capability on mobile that Director does not have on desktop and does not have anywhere else in the app. Fixing this would **narrow** Director's current mobile access, which this phase's own instructions require treating as a regression risk needing explicit confirmation, not a mechanical sweep item — recorded as **AUTH-D9** below, not fixed.
  - **AUTH-S5 (`/group/*` naming) — found already adequately addressed, no further change made:** the exact naming-trap concern this finding describes is already thoroughly documented in-code at `routes.tsx`'s `/group/*` route block (a multi-line comment explicitly stating these routes are Owner-identity-only via `SuperAdminRoute`, and that GroupAdmin's real capability lives in the shared `/users`/`/companies`/`/warehouses` business pages instead). No route, URL, or guard-component change was made — restructuring the actual URLs was judged out of proportion for a "narrow, safe correction" given the concern is already mitigated at the documentation level, and changing live URLs carries its own (bookmark/link) risk this phase's scope doesn't call for.
- **BD-3 (Channel Partner eligibility / CP-1):** confirmed `validatePartnerCanAct`/`validatePartnerCanCreateLead` (`src/lib/channelPartnerWorkflow.ts`) still have zero call sites — unchanged since the original audit. **BUSINESS DECISION REQUIRED — BD-3 remains unresolved.** No wiring was added; no validator was removed.
- **BD-4 (`cases` for Director):** confirmed `cases` is still seeded only on Admin in `roleBootstrap.ts`. **BUSINESS DECISION REQUIRED — BD-4 remains unresolved.** No seed change was made.
- **BD-8 (borrowed-module routes):** confirmed all 7 borrowed routes (`/stock-transfers`→`stock`, `/goods-receipts`/`/handovers`/`/amc-contracts`/`/monitoring`→`purchase_orders`/`projects`, `/sales-documents`→`leads`, `/notifications`→`dashboard`) are unchanged in `routes.tsx`/`MobileRoutes.tsx`. **BUSINESS DECISION REQUIRED — BD-8 remains unresolved.** No new module key was created; no route was re-pointed.
- **Route inventory:** re-verified `routes.tsx`'s desktop route table and `MobileRoutes.tsx`'s mobile table against the Master Plan's §6 inventory — no drift found since Phase 2/3 (neither file was touched by those phases). No route was added, removed, or re-guarded this phase.
- **GroupAdmin/Super Admin:** neither was touched. GroupAdmin's Phase 1 API access and Phase 2 alias/rules parity remain exactly as those phases left them (no file either phase touched was modified this phase). `isOwnerFirebaseUser()`, `OWNER_AUTH_EMAIL`, `SuperAdminRoute`, `ownerAccess.ts` — untouched.
- **New deferred finding: AUTH-D9** (mobile Installations Director over-grant) — see above; added to the register below.
- **Files changed:** `src/components/dashboard/QuickActions.tsx` (the one fix), `src/components/dashboard/__tests__/quickActionsRoleFallback.test.ts` (new, 10 tests).
- **Tests:** 10 new tests, all passing (8 explicitly-named roles proven byte-identical via a `canDo()`-mocked-true isolation test; the previously-mis-bucketed-role fallback proven to now return the full candidate list; the full-list-still-gated-by-`canDo()` property separately proven with `canDo()` mocked false). `npx tsc --noEmit`: clean. `npm run build`: clean. Full `npx vitest run`: 29 failed files / 65 failed tests — the documented pre-existing baseline, unchanged (272 files/3699 tests total vs. Phase 3's 271/3689 — delta is exactly the 1 new file/10 new tests). Firestore emulator / API suites not re-run — no `firestore.rules` or `api/` file was touched this phase.
- **Deviations from the plan's original Phase 4 text:** the plan sketches this phase as producing several replaced hardcoded checks and multiple commits; the actual, evidence-based outcome is one genuine replacement (QuickActions) plus a documented decision NOT to touch several other candidates that turned out, on inspection, to be either correct-as-is (Bucket A GroupAdmin identity checks), deliberate business policy (scheme-registration reopen), already-mitigated (`/group/*` naming), or a real access-reduction risk needing its own confirmation (mobile Installations) rather than a mechanical fix. This is a deviation in volume, not in discipline — the plan's own instruction ("do NOT blindly replace every role comparison... produce a complete inventory before making replacements") is exactly what produced this outcome.

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

**PHASE 5 COMPLETION RECORD**

- **Status:** COMPLETE for its actual defined scope (audit + rules-pattern design). **Zero `firestore.rules` changes were made** — this is not a partial result, it is the correct outcome: this phase's own text above says "Security impact: none yet," "Regression risks: none (read-only audit...)," and "Rollback/safety: N/A — no production change in this phase." Deploying the actual predicate is Phase 7's job, and Phase 7 explicitly depends on BD-1/BD-2 being answered (§14's dependency graph) — both remain open. Local commit only; `origin/main` untouched at `33fc782`.
- **Confirmed unchanged since the original audit:** none of the 8 collections (`leads`, `customers`, `quotations`, `orders`, `products`, `vendors`, `cases`, `loan_applications`) have a dedicated `firestore.rules` match block — re-verified by grepping every `match /{collection}/` line in the current file. `commission_records`/`settlements` (AUTH-C3) and the `projects` `canReadProjectScoped()` gate (AUTH-C4) are also unchanged.

**Per-collection ownership-field audit** (traced from actual write-path code, not assumed):

| Collection | `companyId`/`groupId` | `createdBy` | `assignedToId` | `partnerId` | Notes |
|---|---|---|---|---|---|
| `leads` | Auto-stamped by `createDocWithId`/`createDoc` (universal) | Auto-stamped | **Set on standard creation** — `useLeads.ts`'s create hook auto-assigns via `getNextAssignee()` round-robin when not explicit, so a lead created through the normal UI is never unassigned | Set when a Channel Partner creates the lead | **Finding AUTH-C1a:** `Leads.tsx`'s CSV import path (`handleCsvImport`) explicitly sets `assignedToId: ''` — a CSV-imported lead has NO assignee at all. Under a future 'self'/'team' ownership rule, these leads would be invisible to everyone except a company-wide ('all') role, until manually re-assigned. This is a real, historical-data risk Phase 7 must account for (a backfill or an explicit "unassigned leads default to company-wide read" clause), not an invented one. |
| `customers` | Auto-stamped | Auto-stamped (`createCustomerProjectionInTransaction`'s `...payload` spread + explicit `createdBy`) | Set at Lead→Customer conversion (`leadWorkflow.ts`, carries the lead's resolved assignee forward) and at direct creation (`CustomersWorkspace.tsx`'s `assignedToId`/`assignedToName` fields) | Set when linked to a partner-owned lead | No equivalent CSV-import gap found for Customers (no bulk-import path exists for this collection). |
| `quotations` | Auto-stamped | Auto-stamped (`Quotations.tsx` sets `createdBy: user.id` explicitly, redundant with but consistent with the auto-stamp) | **Not set anywhere** — `Quotations.tsx`'s creation payload has no `assignedToId` field at all | Not applicable (no partner-facing quotation creation flow found) | A future ownership predicate here can only ever match on `createdBy` (self) — see the corrected rules-pattern design below for why this specifically breaks a naive "team" implementation. |
| `orders` | Auto-stamped | Auto-stamped (`Orders.tsx` sets `createdBy:user.id` explicitly) | **Not set anywhere** — same gap as quotations; `assignedToId` appears only in the list page's *filter* UI (`o.assignedToId===assignedF`), never in the create payload | Not applicable | Same consequence as quotations. |
| `products` | Auto-stamped | Auto-stamped only (no explicit field in `Products.tsx`) | Not applicable — products are not personally owned | Not applicable | `products` has no role seeded with anything narrower than `'all'` visibility today (confirmed — no `self`/`team` grant exists for this module in any of the 15 system roles), so an ownership predicate would currently be a pure no-op for every real role even if deployed. |
| `vendors` | Auto-stamped | Auto-stamped only | Not applicable | Not applicable | Same as products — no role is seeded `self`/`team` on `vendors`; Procurement (the only role with meaningful vendor CRUD) is seeded `'all'`. |
| `cases` | Auto-stamped | Auto-stamped (`CaseEngine.ts` sets `createdBy: userId`) | Not applicable | Not applicable | Moot until BD-4 is answered — only Admin holds any grant on `cases` at all today, so no other role's scope is even reachable yet. |
| `loan_applications` | Auto-stamped | Auto-stamped (`loanApplicationWorkflow.ts` maps its `createdById` parameter onto the persisted `createdBy` field — verified NOT a schema drift, just a differently-named function argument) | Present in the same workflow file for a related registration flow in the same module; not confirmed as populated specifically for every `loan_applications` create path in this pass | Not applicable | Needs a closer, dedicated read before Phase 7 touches this collection specifically — flagged as **incomplete evidence**, not asserted either way. |

**Corrected rules-pattern design** (this phase's required deliverable) — the plan's original draft (top of this section, still shown above for history) had a real design gap this audit caught before it could reach Phase 7 as a broken rule: it only matched `assignedToId in callerTeamMemberIds()` for "team" scope. Since **5 of the 8 collections have no `assignedToId` field at all** (quotations, orders, products, vendors, and — pending the one open item above — possibly loan_applications), a rule built only that way would make "team" visibility permanently empty for a Manager on those collections, even though the client's own `applyAccessFilters`/`ownershipVisibility.ts` already correctly checks **`createdBy` for team membership too** (`OWNERSHIP_FIELDS = ['assignedToId', 'createdBy', 'partnerId']`, each checked against the same `[self, ...teamMemberIds]` set). The corrected pattern, verified against the client's actual, working logic:

```
function isTeamMemberRecord(recordOwnerUserId) {
  // Mirrors useGlobalBoot.ts's own team computation EXACTLY:
  // `teamMemberIds = users.filter(u => u.managerId === user.id).map(u => u.id)`
  // — a one-level, direct managerId match, nothing more. This get() is
  // the same class of single-document lookup already used elsewhere in
  // this file (warehouse/company FK checks) — technically safe, but it
  // is an EXTRA get() per evaluation on top of everything else already
  // in these clauses, and this file has repeated, documented history of
  // hitting the 1000-expression budget on far simpler rules (stock,
  // attendance, users, roles). Any Phase 7 use of this function MUST be
  // paired with a live expression-budget check on that specific
  // collection's write path, not assumed safe by analogy.
  return recordOwnerUserId is string && recordOwnerUserId != ''
    && exists(/databases/$(database)/documents/users/$(recordOwnerUserId))
    && get(/databases/$(database)/documents/users/$(recordOwnerUserId)).data.managerId == currentUserId();
}

function isOwnedRecord(data) {
  return isSignedInActor() &&
    (
      data.createdBy == currentUserId()
      || (data.keys().hasAny(['assignedToId']) && data.assignedToId == currentUserId())
      || (data.keys().hasAny(['partnerId']) && data.partnerId != null && data.partnerId == callerPartnerDocId())
      || isTeamMemberRecord(data.createdBy)
      || (data.keys().hasAny(['assignedToId']) && isTeamMemberRecord(data.assignedToId))
    );
}
// Applied only for roles whose seeded visibility is 'self' or 'team' for
// this module — a role seeded 'all' keeps the existing sameCompany()-only
// grant, completely unchanged. THIS is the exact reason Phase 7 cannot
// deploy yet: for these 8 collections, that "which roles are self/team"
// question is Sales (BD-1, on leads/customers/quotations) and Manager
// (BD-2, on quotations/orders/products/vendors/loan_applications) — both
// still open. Partner's self-scope (leads/customers) and Manager's
// team-scope (leads/customers, NOT the BD-2 modules) are the only parts of
// this predicate that are already non-controversial today.
```

- **AUTH-C1 status per collection:** groundwork complete for all 8; the enforcing rule itself remains correctly un-deployed, blocked on **BD-1** (leads/customers/quotations — Sales scope) and **BD-2** (quotations/orders/products/vendors/loan_applications — Manager scope). `products`/`vendors`/`cases` have no BD blocking them specifically — they simply have no role seeded narrower than `'all'` today, so there is nothing for Phase 7 to enforce on them unless a future business decision changes that.
- **AUTH-C3 (`commission_records`/`settlements`) status:** re-verified unchanged. Notably, the current rules file's own comment already documents this as a **deliberate, prior trade-off** ("does NOT replicate Manager's team-scope or Partner's self-scope narrowing... to avoid the extra get() calls a per-record ownership check would require") — not an oversight this audit is the first to notice. The corrected `isOwnedRecord`/`isTeamMemberRecord` pattern above is directly applicable here too if a future decision reverses that trade-off; no schema blocker exists (both collections carry `partnerId` reliably per `channelPartnerCommissionEngine.ts`). Deferred to Phase 7, gated on an explicit decision to accept the extra `get()` cost this file's own history treats as non-trivial.
- **AUTH-C4 (`projects` / `canReadProjectScoped()`) status:** re-verified unchanged — `!isProjectScopedRole()` unconditionally passes any non-field-role actor. Real owner fields are `assignedSurveyor`, `assignedInstaller`, `salesOwner`, `designerId` (not `assignedToId` — Projects use their own, already-established field names, confirmed via the existing rule text). No schema blocker; narrowing this is a scope-policy question (should Manager/Partner/Sales/Accounts/etc. really be limited to assigned-only project reads?) that was never posed as one of BD-1 through BD-8 and is **not decided here** — flagged as a new, explicit item for §15.
- **Query compatibility:** traced the actual `getAll()`/`buildOwnershipVisibilityQueryPlan()` code path (`src/lib/firestore.ts`, `src/lib/ownershipVisibility.ts`) — it already issues company-scoped, `assignedToId`/`createdBy`/`partnerId`-`in`-chunked queries for any collection whose resolved visibility isn't `'all'`, and already narrows the query itself (not just an in-memory filter) for exactly these 8 collections today. **No query changes are required for Phase 7** — the client already queries in a shape a matching rules predicate would accept; the gap is entirely on the rules side, not the query side.
- **New finding, deferred:** **AUTH-C1a** — CSV-imported Leads persist with `assignedToId: ''`, meaning they'd be invisible under a 'self'/'team' rule until reassigned. Phase 7 must decide (with a business answer, not a guess) whether unassigned records default to company-wide-visible or require a backfill pass before the rule goes live — modeled on this project's own established dry-run-first backfill script pattern.
- **New finding, deferred:** **AUTH-C1b** — `loan_applications`'s exact `assignedToId` coverage was not conclusively confirmed in this pass (the workflow file serves more than one registration-type collection); needs a dedicated, narrower read before Phase 7 touches this specific collection.
- **New finding, deferred:** **AUTH-C4a** — Project ownership narrowing (beyond the 5 already-enforced field roles) has no corresponding BD-1..BD-8 entry; if Phase 7 is ever asked to tighten `canReadProjectScoped()` further, that needs its own named business decision first, not an assumption that "matching AUTH-C1's pattern" is authorization enough.
- **Files changed:** `docs/RBAC_MASTER_IMPLEMENTATION_PLAN.md` only, plus one new evidence-pinning test file (source-verification style, matching this repo's established convention) that captures the concrete, re-checkable facts this audit found (which collections have `assignedToId`, the CSV-import gap, the `teamMemberIds` computation this design mirrors) so a future phase can re-run it rather than re-deriving the same evidence by hand.
- **Tests:** the new evidence test passes; no `firestore.rules` change means no emulator suite needed to be re-run for a behavioral change (none occurred) — the existing emulator baseline was re-run anyway as a pure regression sanity check (see below) and is unaffected. `npx tsc --noEmit`: clean. `npm run build`: clean. Full `npx vitest run`: 29 failed files / 65 failed tests — the documented pre-existing baseline, unchanged.
- **Business decisions:** **BD-1 and BD-2 remain the explicit blockers for Phase 7's actual deployment on 6 of the 8 collections** (leads/customers/quotations/orders/products*/vendors*/loan_applications — *products/vendors have no seeded role to apply the predicate to regardless of the BD answer). Neither was guessed or resolved here. No other BD was touched.
- **Deviation from the plan's original Phase 5 text:** none in outcome — the plan's own definition already scoped this phase to audit + design with zero enforcing change; this record documents that scope was honored, plus the corrected rules-pattern design and the 3 new deferred findings (AUTH-C1a, AUTH-C1b, AUTH-C4a) the audit surfaced that the original plan text couldn't have known about in advance.

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

**PHASE 6 COMPLETION RECORD**

- **Status:** COMPLETE. Local commit only — not pushed to `origin/main`; production untouched at `33fc782`.
- **AUTH-D1 — CLOSED.** `getRoleDocument()` re-verified as still broken exactly as documented before touching anything: the primary query (`where('name','==', lowercased)`) always missed against capitalized stored names, and the "fallback" (an unscoped, cross-company `collection('roles').get()`, first-match-wins, no guaranteed order) was the only path that had ever executed. Fixed by switching to a direct, deterministic `.doc('{companyId}_{RoleName}').get()` — the exact same id scheme `src/lib/roleBootstrap.ts`'s `roleDocumentId()` already uses for every seeded role document, imported directly rather than re-implemented (empirically verified safe to import into the serverless context — see the deviation note below). `canDo()` now also fails closed explicitly on a missing `companyId` before ever constructing a lookup id. Zero unscoped or cross-tenant scans remain in this code path.
- **AUTH-D4 — re-verified, still correctly closed from Phase 1.** `EXACT_ROLE_COMPATIBILITY` still carries `groupadmin`/`tl`/`demo operator`/`demo admin`, unchanged. GroupAdmin resolution now ALSO benefits from the AUTH-D1 fix: it correctly reaches its own company's Admin role document, not a non-deterministic one. GroupAdmin's security boundary (not Owner, not Super Admin, company/group isolation independent of this file) was not touched — `resolveApiCompanyScope`/`canAccessApiResource` in `api/_lib/registry.ts` remain the untouched, actual tenant boundary; re-verified via an explicit test.
- **AUTH-D5 — re-verified, unchanged from Phase 1, correctly left alone.** `/api/integrations`'s `auth.role !== 'Admin' && auth.role !== 'GroupAdmin'` check is a Bucket A security boundary (gatekeeping integration secrets) that Phase 1 already fixed narrowly; Phase 6 did not touch it — the plan's own Phase 6 scope does not name AUTH-D5 as requiring further work, and there is nothing further to correct.
- **AUTH-D6 — re-verified, still correctly closed from Phase 1.** Server `Module` type/`ALL_MODULES` still carry all 5 previously-added keys (`cases`, `loan_applications`, `banks`, `payouts`, `scheme_registration`) plus `net_metering` (confirmed present on both client and server since before Phase 1 — never actually missing). Full parity with the client's `Module` type confirmed by direct comparison.
- **AUTH-D7 — CLOSED.** The server `Permission` type and `ALL_PERMISSIONS` array were still missing `'disburse'` (deferred from Phase 1, confirmed still open before fixing). Added, additive-only — no `ENTITY_REGISTRY` entry exposes `payouts` over the REST API, so this changes no current request's outcome; it only lets a future `canDo(user,'disburse','payouts')` call resolve based on real role data instead of failing the type guard unconditionally.
- **Repo-wide API authorization audit performed** (`role ===`/`isAdmin`/`isSuperAdmin`/`canDo`/`requirePermission` across every `api/**/*.ts`, excluding tests): confirmed `api/[entity].ts`/`api/[entity]/[id].ts` correctly route every check through `requirePermission()` (Bucket B, already canonical — no change needed); confirmed `api/index.ts` is a pure documentation/health endpoint (non-authorization). **New finding, deferred:** **AUTH-D10** — `api/_lib/biometrics/authorization.ts` has its own raw, alias-blind check (`auth.role !== 'Admin' && auth.role !== 'HR' && !auth.isSuperAdmin`) gating biometric face-reference enrollment — the same false-DENY-on-GroupAdmin pattern AUTH-D5 named for `/api/integrations`, but at a different endpoint the Master Plan never explicitly enumerated. **Not fixed** — not named in this phase's scope, and per this whole initiative's discipline, a discovery mid-phase does not authorize expanding the phase; recorded for a future phase (or an explicit instruction) to pick up.
- **Client/API agreement verified:** same canonical alias table content (`EXACT_ROLE_COMPATIBILITY`, still two independently-maintained but content-identical copies — no new drift introduced this phase), same `Permission`/`Module` vocabularies (now byte-identical in content, though still two separately-declared TypeScript types, not a shared import — deliberately not unified into one cross-boundary type this phase, since doing so was not this phase's scope and the two ARE independently verified consistent), same fail-closed behavior for unknown role/module/action/missing role document.
- **Deviation from the plan's original Phase 6 text, disclosed:** the plan's own "Files/modules likely affected" text left open whether to inline the `{companyId}_{RoleName}` format or reuse `roleDocumentId()` directly. This implementation **imports `roleDocumentId` from `src/lib/roleBootstrap.ts`** into the serverless API layer — a cross-boundary import initially suspected unsafe (that module transitively imports `useAppStore.ts`, which uses Zustand's `persist` middleware, a `localStorage`-backed mechanism that does not exist in Node). **Verified empirically before committing**, not assumed either way: both `vitest.config.ts` and `vitest.api.config.ts` already run under `environment: 'node'` (not `jsdom`), and dozens of existing tests already import this exact chain successfully under that environment; the full API suite was run immediately after adding the import and passed with no import-time error. Chosen over inlining the tiny format string as the more disciplined, single-source-of-truth option, precisely because it could be verified safe rather than merely assumed risky or assumed safe.
- **Files changed:** `api/_lib/permissions.ts` (the AUTH-D1 + AUTH-D7 fix), `api/_lib/__tests__/groupAdminApiAccess.test.ts` (mock updated from the old query shape to `.doc(id).get()`; 4 new AUTH-D1 tests added, including the required multi-company-isolation proof), `api/__tests__/apiMassAssignment.test.ts` (its own independent `roles` collection mock updated to the same new shape — otherwise its 4 existing DI-03 tests would have failed not because DI-03 regressed, but because its mock no longer matched the fixed lookup's call shape).
- **Tests:** full API suite (`vitest.api.config.ts`): **14 files / 331 tests pass** (was 14/327 before this phase — the delta is exactly the 4 new AUTH-D1 tests: missing-role-document fails closed, the multi-company cross-tenant-isolation proof, missing-companyId fails closed, and a proof the fixed code path cannot fall back to any collection-wide scan). `npx tsc --noEmit`: clean. `npm run build`: clean. Full `npx vitest run` (main config): 29 failed files / 65 failed tests — the documented pre-existing baseline, unchanged (this run does not include `api/**` tests, which live under the separate `vitest.api.config.ts`).
- **Business decisions:** none touched. BD-1 through BD-9 remain exactly as recorded; none were required for this phase's scope and none were guessed.
- **Deferred findings:** **AUTH-D10** (new, above). Everything else Phase 5 deferred (AUTH-C1a, AUTH-C1b, AUTH-C4a/BD-9) remains exactly as deferred — not touched by Phase 6, as instructed.

### AUTH-D10 — SECURITY FOLLOW-UP (Biometrics API authorization)

Performed as a small, isolated, explicitly-instructed follow-up between Phase 6 and Phase 7 — **not** part of Phase 7 and **not** a phase in its own right. Phase 7 remains not-started.

- **Status:** COMPLETE. Local commit only — not pushed to `origin/main`; production untouched at `33fc782`.
- **Root cause:** `api/_lib/biometrics/authorization.ts`'s `resolveEnrollmentTarget()` gated on-behalf-of biometric face enrollment on `auth.role !== 'Admin' && auth.role !== 'HR' && !auth.isSuperAdmin` — a raw, hardcoded role-name check with no GroupAdmin case at all. Since GroupAdmin is a canonical scope-extension alias of Admin everywhere else this exact distinction is made in this codebase (client `canDo()`, server `canDo()`, and — critically — this same module's own sibling enforcement point, `firestore.rules`' `biometricCreateAllowed`/`biometricReadAllowed`, which already grant a same-company GroupAdmin actor identically to Admin/HR via their `sameCo` branch), this was a false DENY, not an intentional restriction: a GroupAdmin acting entirely within their own home company was incorrectly rejected from enrolling another employee's face.
- **Authorization flow inspected before any change was made:** `api/_lib/biometrics/authorization.ts` (`resolveEnrollmentTarget`, `resolveVerificationTarget`) in full; every caller (`api/_lib/biometrics/enrollment.ts`, `api/biometrics/enroll.ts`, `api/biometrics/status.ts`, `api/_lib/biometrics/verification.ts`, plus the two structural/behavioral test files exercising them) — confirmed `enrollment.ts` has no second, duplicate role check of its own, so this function is the single authorization point; `api/_lib/auth.ts`'s `AuthenticatedUser` interface and `buildAuthenticatedUser()` — confirmed the type carries no `groupId` field at all (a fixed 7-field object literal, not a spread of the raw Firestore document); `firestore.rules`' `biometricReadAllowed`/`biometricCreateAllowed`/`biometricUpdateAllowed` (lines ~2772-2850) — the authoritative, already-approved model for this exact domain, which independently confirmed GroupAdmin's intended biometric access is real but has TWO distinct branches: a same-company `sameCo` branch (identical treatment to Admin/HR) and a SEPARATE, additional cross-company `sameGrp` branch keyed on `data.groupId == authMap.groupId`; `api/_lib/permissions.ts`'s server `canDo()`/`EXACT_ROLE_COMPATIBILITY` (confirmed GroupAdmin already resolves to the Admin template there, post-Phase-1/6) — considered and deliberately **not** used as the fix mechanism (see Bucket classification below).
- **Bucket classification: Bucket A** — a security boundary that must remain hardcoded/independently enforced, not migrated to the customizable `canDo()` permission-document model. Evidence: `firestore.rules` itself enforces this exact same-company Admin/HR/GroupAdmin gate via a raw `actor.role == 'Admin' || actor.role == 'HR'`-style check, not a permission-document lookup, and its own comment explains why — biometric embedding data is "a materially more sensitive category than typical business records," deliberately not wired to the same customizable per-company role-permission documents that gate ordinary modules. Routing this check through `canDo(auth,'edit','employees')` (the nearest equivalent canonical permission) was considered and rejected: it would make biometric-enrollment authority silently follow a company's *unrelated* Employees-module customization (e.g., a company granting Manager `employees:edit` for routine HR admin would, as an undocumented side effect, also grant that Manager the ability to enroll another employee's face) — a new privilege-escalation path the task explicitly prohibited introducing. The fix therefore mirrors `firestore.rules`' own raw-role-name style exactly, adding the single missing case rather than creating a fourth independent special-case list or migrating to a mechanism that doesn't fit this boundary's actual security model.
- **Exact code change:** `api/_lib/biometrics/authorization.ts`, `resolveEnrollmentTarget()` — the on-behalf-of role gate changed from `auth.role !== 'Admin' && auth.role !== 'HR' && !auth.isSuperAdmin` to `auth.role !== 'Admin' && auth.role !== 'HR' && auth.role !== 'GroupAdmin' && !auth.isSuperAdmin`, with the thrown message updated to name GroupAdmin. Nothing else in the function changed: the same-company tenant anchor (`targetCompanyId !== auth.companyId && !auth.isSuperAdmin` → `crossTenantDenied()`), the target-must-exist check, the target-must-be-active check, the self-enrollment always-authorized branch, and `resolveVerificationTarget()` (never role-gated) are all byte-for-byte unchanged.
- **Scope boundary, explicitly not implemented:** `firestore.rules`' separate `sameGrp` cross-company, same-group capability is **not** added here. `AuthenticatedUser` has no `groupId` field; giving this module a safe way to verify a cross-company group match would require either broadening that shared type (affecting every API consumer, not just biometrics) or adding a second, scoped Firestore read inside this one function — both larger than this fix's instructed "small, isolated" scope. This is recorded as a new, named, deferred architectural gap — not guessed, not silently implemented, not silently skipped — for a future phase or explicit instruction to pick up, exactly like AUTH-C1a/AUTH-C1b/AUTH-C4a were handled in Phase 5.
- **GroupAdmin verification:** proved positive for same-company on-behalf-of enrollment (the exact false-deny closed) and proved still denied cross-company (the boundary correctly deferred, not silently loosened) — see tests below.
- **Admin/HR/SuperAdmin regression verification:** all three proved unchanged — Admin and HR still authorized for same-company on-behalf-of enrollment exactly as before; SuperAdmin's unconditional bypass (including across companies) still works exactly as before.
- **Negative authorization verification:** an unrelated role (Sales), a plain Employee, an unknown/malformed role string, and an empty role string all proved still denied — the fix does not widen the gate beyond Admin/HR/GroupAdmin/SuperAdmin.
- **Cross-company/group verification:** a GroupAdmin targeting a different-company employee proved denied (`cross_tenant_denied`), including when the target document happens to carry a matching `groupId` — this module has no group-matching path at all, so the company boundary alone governs and correctly denies it, proving the deferred `sameGrp` gap cannot be silently bypassed by accident.
- **Self-access/identity-boundary verification:** self-enrollment for a GroupAdmin actor proved still always authorized and unaffected by the on-behalf-of role-gate change; a nonexistent on-behalf-of target proved still rejected (identity-forgery resistance unchanged); an inactive/suspended/deleted target proved still rejected for a GroupAdmin actor exactly as for Admin/HR.
- **Exact tests and results:** new file `api/_lib/biometrics/__tests__/authD10GroupAdminEnrollment.test.ts` — 13 tests, all passing, covering all 9 scenarios the task required (numbered 1-9 above map directly to named tests in that file). Full biometrics suite (`vitest.api.config.ts`, `api/_lib/biometrics/**`): 6 files / 153 tests pass (was 5 files / 140 tests before this fix). Full API suite (`vitest.api.config.ts`): 15 files / 344 tests pass (one transient, pre-existing timing-sensitive failure in `api/__tests__/api.test.ts`'s unrelated `checkRateLimit` rate-limiter test was observed once and reproduced as flaky — confirmed by re-running in isolation and re-running the full suite again, both green; it is unrelated to this module and to AUTH-D10).
- **`npx tsc --noEmit`:** clean (exit 0).
- **`npm run build`:** clean (the pre-existing "chunks larger than 600 kB" informational notice is unrelated and unchanged).
- **Full `npx vitest run` (main config) vs the 29 failed files / 65 failed tests baseline:** 30 failed files / 66 failed tests — a +1 file/+1 test delta, investigated: the extra failure is `src/features/customers/components/workspace/__tests__/customerWorkspaceHeader.test.ts` (a source-text parity check between `src/pages/LeadWorkspace.tsx` and `CustomerWorkspaceHeader.tsx`, both files this task never touched — confirmed clean/unmodified in the working tree). Reproduced identically with this fix's changes fully `git stash`ed out, proving it pre-exists at HEAD (`ec6046f`) independent of AUTH-D10. Further confirmed structurally impossible for this fix to have caused it: `vitest.config.ts`'s `include` is `src/**/*.test.ts` only, so it never runs anything under `api/**` — the only directory this fix touched. This is a one-file/one-test drift in the documented baseline number itself (likely measured at a slightly different point), not a regression introduced here.
- **Exact files changed:** `api/_lib/biometrics/authorization.ts` (the fix); `api/_lib/biometrics/__tests__/authD10GroupAdminEnrollment.test.ts` (new); `docs/RBAC_MASTER_IMPLEMENTATION_PLAN.md` (this record).
- **Not touched, per explicit instruction:** Phase 7; AUTH-C1a; AUTH-C1b; AUTH-C4a/BD-9; BD-1 through BD-8; `firestore.rules`; the two production features in `33fc782`; any unrelated cleanup or refactor; `BRAIN.md`; `COMPLETE_INVENTORY_INTEGRITY_AUDIT.md`; the pre-existing `LEADS_UI_UX_SOURCE_OF_TRUTH.md` working-tree deletion.
- **Business decisions:** none touched. BD-1 through BD-9 remain exactly as recorded.
- **Deferred findings:** the cross-company/same-group `sameGrp` extension described above (new, named here, not a BD — it is a module-implementation gap, not a business-policy question: the business intent is already settled by `firestore.rules`, only the API-layer plumbing to check it safely is missing). AUTH-C1a, AUTH-C1b, AUTH-C4a/BD-9 remain exactly as Phase 5 left them. Phase 7 was **not** started.

### BD-1 / BD-2 — BUSINESS DECISION RESOLUTION

Performed as an explicitly-instructed, isolated task between the AUTH-D10 follow-up and Phase 7 — resolves the two business decisions blocking Phase 7's AUTH-C1 deployment. **Not** Phase 7 implementation; no `firestore.rules` change is made here.

- **Status:** BOTH RESOLVED. Documentation-only — no `firestore.rules`, `roleBootstrap.ts`, or any authorization-behavior file was changed, per explicit instruction ("do not modify production behavior merely to make the audit pass"; "do not modify Firestore ownership predicates yet"). Local commit only (docs); not pushed; production untouched at `33fc782`.

**BD-1 — Sales/Sales Executive/BDM/BDE scope on Leads/Customers/Quotations**

1. **Current implementation traced end-to-end:** `src/lib/roleBootstrap.ts`'s `Sales` entry (`LEGACY_SYSTEM_ROLES.Sales`) sets no `visibility` key on `leads`/`customers`/`quotations`; `createModulePermissions()`'s default parameter (`visibility: Visibility = 'all'`) and `legacyModulePermissions()`'s explicit normalize-missing-to-`'all'` ternary both confirm the persisted, seeded Firestore role document carries `visibility: 'all'` on these modules for every Sales-tier account, in every company (re-verified directly against the live file — Phase 2's prior trace of this exact question, recorded at line 291 above, was re-confirmed still accurate). `src/lib/firestore.ts`'s `applyAccessFilters`/`resolveVisibility` read that `'all'` value and apply no client-side narrowing. `firestore.rules` has no ownership predicate on any of these 3 collections today for any role (AUTH-C1, Phase 5) — company scope is the only enforced boundary. Net effect: a Sales-tier user reads every same-company Lead/Customer/Quotation today, both in the UI and (if it existed) at the rules layer.
2. **What the Master Plan already said:** §15's BD-1 row (this document, written during the original planning pass) already recorded this exact current behavior accurately and already recommended "(a), unless told otherwise" as the safe default, explicitly because narrowing it is "the single highest-blast-radius change in the whole plan." Phase 7's own spec (§18, "Dependencies") already anticipated this exact resolution path: "BD-1/BD-2's 'keep company-wide' default answer means Sales/Manager's operational modules literally do not change in this phase."
3. **Actual desktop behavior and existing enforcement:** `src/pages/Leads.tsx`'s filter bar includes a manual, optional "assigned to" dropdown filter (`assignF`, applied in the `filtered` `useMemo`) layered on top of the full company list `getAll()` already returns for this role. This is a cross-rep browsing affordance — a rep can choose to view a colleague's leads by selecting them in the filter — that only functions as built if the underlying list already contains every company rep's records; it would be dead UI (a dropdown that can only ever resolve to the viewer's own name) under a `self`-scoped list. This is current, live, shipped product design, not a stale seed default nobody has looked at since — it directly reflects "Desktop is the source of truth."
4. **Contradictions/drift found:** One indirect, unverifiable signal exists in `BRAIN.md`'s own prior forensic finding **DBT-1** ("Sales/Operations templates default `visibility:'all'` (comments say should be self/team)... Open (partially addressed for Partner/Manager)") — but the specific comment it describes was searched for directly in the current `roleBootstrap.ts` and does not exist there today (Sales' block, lines 156-174, carries no visibility-related comment at all, unlike Manager/Partner/Director/Accounts, which all carry explicit "Phase 2 (§8.2 matrix)" rationale comments added by a prior, already-completed remediation effort). `git log --follow` on this file shows Sales' block structurally unchanged since the earliest tracked history — it was never revisited by that same effort, unlike Manager and Partner, which both WERE deliberately narrowed with dedicated rationale in that same pass. DBT-1 is therefore a flagged, still-open question from a prior audit, not evidence of a contrary decided design — and it is explicitly the ONE finding on this exact topic marked "Open," never "Resolved," anywhere in this repository's history.
5. **Security / multi-company implications:** Company isolation itself is untouched either way (a Sales user never sees another COMPANY's records, only another same-company rep's) — this is purely a breadth-of-visibility choice within one tenant, not a tenant-boundary question. Multi-warehouse is not implicated (Leads/Customers/Quotations carry no `warehouseId` concept). The blast radius of getting this wrong in the RESTRICTIVE direction (narrowing without authorization) is large: every Sales-tier user, on every list/detail page, on every company, would lose access to colleagues' records mid-flow, breaking the shared-pipeline UX the desktop app is visibly built around (point 3). The blast radius of confirming the status quo is zero — no access changes for anyone.
6. **Recommended policy:** **(a) — preserve company-wide visibility for Sales/Sales Executive/BDM/BDE on Leads/Customers/Quotations.**
7. **Resolution:** The repository contains enough evidence to resolve this objectively **as a status-quo-preservation decision** — not as proof that reps should never be narrowed, but as proof that (i) no dedicated design effort, rationale, or comment anywhere in this codebase's history ever decided Sales should be narrower, (ii) the one prior audit note suggesting otherwise (DBT-1) is itself unresolved and unverifiable against current source, and (iii) the live, shipped desktop UI is actively built assuming company-wide visibility (the cross-rep assignee filter). Confirming (a) requires zero authorization-behavior change and carries zero regression risk, exactly matching this task's "do not modify production behavior merely to make the audit pass" instruction. **BD-1 is CLOSED as: keep current behavior; Phase 7 will not add any ownership predicate narrowing Sales' access to these 3 modules.** If the business later wants genuine narrowing, that remains a valid, separate, explicit, future decision — not reopened by this resolution.

**BD-2 — Manager/TL scope on Quotations/Orders/Dispatch/Stock/Products/Partners/Loan Applications**

1. **Current implementation traced end-to-end:** `roleBootstrap.ts`'s `Manager` entry sets `visibility: 'team'` explicitly on exactly six modules — `leads`, `customers`, `projects`, `surveys`, `scheme_registration`, `payouts` — each carrying its own dedicated rationale comment ("Phase 2 (G7 fix + §8.2 matrix): Manager is the TL/Manager layer and operates at TEAM scope — own + assigned agents' records only, never org-wide. Team members are resolved from `users.managerId` by `useGlobalBoot`'s `teamMemberIds`"). The remaining Manager-granted modules — `quotations`, `orders`, `dispatch`, `inventory`, `stock`, `products`, `partners`, `loan_applications`, `banks` — carry no `visibility` key at all in that SAME block, in that SAME already-edited-for-team-scope section of the file, and therefore normalize to `'all'` (company-wide) by the identical mechanism traced for BD-1.
2. **What the Master Plan already said:** §15's BD-2 row already recorded this exact split accurately ("seed sets no `visibility` override on these modules, unlike Leads/Customers/Projects which ARE team-scoped") and already hypothesized the asymmetry "may be deliberate — Managers coordinating fulfillment need company-wide stock/order visibility even if their *sales* pipeline view is team-scoped."
3. **Actual desktop behavior and existing enforcement:** confirmed via `src/lib/__tests__/channelPartnerPhase2Rbac.test.ts` (`describe('§8.2 permission matrix')`, `it('Manager/TL: team scope...')`), `src/lib/__tests__/projectVisibility.test.ts` ("Phase 2 (G7 fix + §8.2 matrix): Manager operates at TEAM scope, not org-wide"), and `src/lib/__tests__/roleBootstrap.test.ts` ("Manager gains projects at TEAM scope") — all three are pre-existing, currently-passing test files from a dedicated, already-completed remediation effort (predating this RBAC Master Plan) that specifically targeted Manager's supervisory scope on the customer/deal-relationship modules, with its own named rationale and its own regression coverage. That same effort touched Manager's seed entry extensively (6 modules got `visibility: 'team'` added, several gained new grants like `approve` on `scheme_registration`/`payouts`) and, in that same edit, left `quotations`/`orders`/`dispatch`/`inventory`/`stock`/`products`/`partners`/`loan_applications`/`banks` untouched — a deliberate, selective application across many adjacent lines of the same block, not an overlooked module.
4. **Contradictions/drift found:** none. Unlike BD-1, there is no prior audit note (BRAIN.md or otherwise) suggesting Manager's operational-module breadth is itself an open question — `BRAIN.md`'s DBT-1 names only Sales/Operations, not Manager, and explicitly marks Manager's half of this exact tension "partially addressed." The asymmetry is internally coherent with this system's broader supervision model: the modules Manager supervises AT team scope are exactly the customer-relationship/deal modules a direct report personally owns (leads, customers, the projects those become, the surveys/vendor-lock/payout stages tied to a specific deal); the modules that stay company-wide are exactly the shared, downstream fulfillment/operations modules (a quotation becomes an order, which needs warehouse/dispatch/stock coordination regardless of which rep's team originated the sale) — matching the Master Plan's own hypothesis in point 2, now corroborated by a dedicated, tested, already-shipped implementation rather than resting on inference alone.
5. **Security / multi-company implications:** same as BD-1 — a breadth-of-visibility choice within one tenant, not a tenant/warehouse-isolation question (company/warehouse isolation for these modules is enforced independently, unaffected either way). The 6 already-team-scoped modules currently have that scope enforced ONLY client-side (BRAIN.md's own documented finding — rules enforce company scope only); Phase 7's actual job is turning that already-decided value into a real rules predicate, which is a security-POSITIVE change requiring no further business input, since the "should it be team-scoped" question for those 6 modules was already answered by the effort that added the `visibility:'team'` key in the first place.
6. **Recommended policy:** **(a) — preserve the existing split exactly as currently seeded**: team-scope stays team-scope on the 6 already-`'team'` modules; the remaining operational modules stay company-wide.
7. **Resolution:** The repository contains enough evidence to resolve this objectively, with materially stronger evidence than BD-1: a dedicated, already-completed, well-documented, still-passing-tests remediation effort deliberately drew this exact line, module by module, in the same edit. **BD-2 is CLOSED as: preserve the current split; Phase 7 will implement the ownership predicate for Manager on exactly the 6 modules already seeded `visibility:'team'` (leads, customers, projects, surveys, scheme_registration, payouts) and will not add any predicate narrowing Manager's access to quotations/orders/dispatch/inventory/stock/products/partners/loan_applications/banks.**

**Effect on Phase 7 readiness**

- **Phase 7's AUTH-C1 scope (the 8 "ungated collections": leads/customers/quotations/orders/products/vendors/cases/loan_applications) is now UNBLOCKED on the business-decision front.** For every role × module pair in that scope, the seed's existing `visibility` value (already resolved, per BD-1/BD-2 above, as the deliberate, final answer) is now confirmed usable as Phase 7's ground truth without further business input: apply the ownership predicate exactly where a role is seeded `self`/`team`; leave every `all`-visibility grant exactly as it is today.
- **Phase 7 is NOT fully unblocked as a whole.** Phase 7's own stated Objective (§18, point 2) also includes tightening `commission_records`/`settlements`/`projects`'s existing rule — the `projects` portion of that is exactly AUTH-C4a, gated on **BD-9**, which remains open and was correctly NOT touched by this task (out of scope per explicit instruction). Phase 7 can therefore proceed on the 8 AUTH-C1 collections now; the `projects`/`commission_records`/`settlements` narrowing needs BD-9 resolved first, either as a preceding step or as a deliberately-scoped later sub-phase.
- **Business decisions:** BD-1 and BD-2 RESOLVED (both (a), documented above). BD-3 through BD-8 untouched, exactly as recorded. **BD-9 remains open** — not touched, as instructed; still blocks the `projects`-related portion of Phase 7's objective.
- **Files changed:** `docs/RBAC_MASTER_IMPLEMENTATION_PLAN.md` only (this record + the §15 table annotations). No source file was modified — no `roleBootstrap.ts`, `firestore.rules`, `src/lib/firestore.ts`, `src/lib/permissions.ts`, or any test file. AUTH-C1a, AUTH-C1b, AUTH-C4a/BD-9 were read (necessarily, since §15/§18 cross-reference them) but not modified.

### BD-9 / AUTH-C4a — BUSINESS DECISION RESOLUTION

Performed as an explicitly-instructed, isolated follow-up to the BD-1/BD-2 resolution — resolves the one remaining business decision blocking the `projects`/`commission_records`/`settlements` portion of Phase 7's objective. **Not** Phase 7 implementation; no `firestore.rules` change is made here.

- **Status:** RESOLVED — **Option A: current behavior is intentional and correct.** Documentation + test-evidence only. No `firestore.rules`, `roleBootstrap.ts`, `src/lib/firestore.ts`, or `src/lib/projectVisibility.ts` was changed; two new tests were added that pin the already-existing behavior as a regression contract (no behavior changed by adding them). Local commit only; not pushed; production untouched at `33fc782`.
- **`canReadProjectScoped()` and its callers traced:** `firestore.rules` — `canReadProjectScoped(data)` (`sameCompany(data) && (isAdmin() || role=='Director' || !isProjectScopedRole() || <4 ownership-field checks>)`), `isProjectScopedRole()` (`role in ['Surveyor','Engineer','InstallationLead','ServiceTechnician','ComplianceOfficer']`), and every match block that calls it: `projects`, `surveys`, `engineering_designs`, `installations`, `service_tickets`, `qc_checks`, `commissioning_records`, `net_metering_applications`, `subsidy_applications`, `project_handovers`, `amc_contracts`, `generation_readings` (12 collections total, all sharing the identical gate).
- **Project ownership fields confirmed:** `assignedSurveyor`, `assignedInstaller`, `salesOwner`, `designerId` (rules-layer) — matches `src/lib/projectVisibility.ts`'s `PROJECT_ASSIGNMENT_FIELDS` (`assignedSurveyor`, `assignedInstaller`, `salesOwner`, `designerId`, `partnerId` — one additional field, `partnerId`, added client-side in a later phase for Partner's self-scope matching; the rules layer doesn't need it separately because Partner is itself `sameCompany`-gated and never one of the 5 `isProjectScopedRole()` names, so it already falls through the `!isProjectScopedRole()` branch — see below).
- **`roleBootstrap.ts` traced:** `legacyModulePermissions()` (the same normalization function BD-1/BD-2 already traced) iterates every `Module`, including `projects`, for every role — a role with no `projects` entry in its `LEGACY_SYSTEM_ROLES` definition (Sales, Accounts, Warehouse, HR, Operations) still gets a full, explicit `{view:false,...,visibility:'all'}` object stamped onto its persisted role document, never `undefined`. This is the exact same mechanism, not a separate one, that already produced Sales/Manager's confirmed `'all'` default for leads/customers/quotations in the BD-1/BD-2 resolution above. Director and Procurement DO declare `projects:{view:true}` explicitly (no `visibility` key), which normalizes to `'all'` the same way. Partner (`visibility:'self'`) and Manager (`visibility:'team'`) are the only two roles that override this default — both pre-dating this task, both already independently enforced client-side and unaffected by this resolution.
- **Relevant project visibility/query logic traced:** `src/lib/projectVisibility.ts`'s `resolveVisibilityKind()` — reads the role document's own `projects.visibility` first (present and `'all'` for Sales/Accounts/Warehouse/HR/Operations/Director/Procurement per the point above); only falls back to a role-NAME heuristic (`PROJECT_SCOPED_ROLE_NAMES` — the same 5 names as the rules layer's `isProjectScopedRole()`) when no role document is available at all (e.g., a not-yet-loaded permission cache). Both the seeded-value path and the heuristic-fallback path agree: every role outside the 5 field roles (and outside Partner/Manager's explicit override) resolves to `'all'`. `getProjectVisibilityMode()`/`canAccessProjectRecord()`/`filterVisibleProjectRecords()`/`buildProjectVisibilityQueryPlan()` all key off this same `resolveVisibilityKind()` result, so client query-building, in-memory filtering, and single-record access checks are all in agreement.
- **`firestore.rules` re-verified:** `canReadProjectScoped()`'s `!isProjectScopedRole()` branch is a raw role-name check (Bucket A style, matching the biometrics precedent from AUTH-D10) — it does not read the `roles` permission document at all. It independently produces the exact same ALLOW/DENY split as the client's seeded-`visibility:'all'` value, for every role checked (Admin/Director explicit; every other non-field, non-Partner, non-Manager role via the catch-all). The two mechanisms (client seed value, rules raw role-name check) were engineered separately but are provably in lockstep — the goal state this whole RBAC engagement has been building toward for every other collection, already achieved here.
- **Relevant desktop project behavior confirmed — the decisive evidence:** `src/pages/DispatchDetail.tsx` (opened by Warehouse, Operations, Accounts, Sales, Manager, and Admin alike, whenever any of them views a dispatch record) calls `getAll(COLLECTIONS.PROJECTS)` in an unconditional `useQuery` — no `canDo`/permission gate wraps it — specifically to resolve and render the dispatch's linked "Project" field and its click-through navigation link (`/projects/{projectId}`). This is a real, currently-shipped, load-bearing feature: Warehouse and Operations staff routinely need to see which project a dispatch belongs to while executing it, and none of Warehouse/Operations/Accounts/Sales hold any explicit `projects` module grant at all — they rely entirely on the `'all'`-visibility default traced above. Narrowing `canReadProjectScoped()` to require an explicit `projects` grant (or to apply the ownership-field check to these roles) would break this shipped feature for these roles, for zero security benefit, since the client's own dedicated visibility engine already treats `'all'` as the correct, intended answer here.
- **Existing RBAC/project visibility tests reviewed:** `src/lib/__tests__/projectVisibility.test.ts` (pre-existing coverage for Admin/Manager/Surveyor/Engineer, none for a role with no `projects` grant at all — the exact gap this resolution closes) and `src/lib/__tests__/phase5OwnershipFieldAudit.test.ts`'s pre-existing `AUTH-C4` block (pinned the `!isProjectScopedRole()` branch's continued existence and the 4 ownership field names, but did not previously assert anything about WHY the catch-all is correct or what depends on it).
- **`BRAIN.md` cross-checked:** its own prior, independent forensic finding **HR-2** ("`canReadProjectScoped` true for all non-project-scoped roles | Partner, Sales, etc. | any same-company project readable by direct id | Open | tighten to assigned/owned for Partner") is **stale** — it predates the later Phase 2/§8.2 remediation that gave Partner an explicit `visibility:'self'` on `projects` (already traced and tested, see `channelPartnerPhase2Rbac.test.ts`/`projectVisibility.test.ts`). Partner's half of HR-2 is already resolved; nothing in `BRAIN.md` raises a comparable concern for Sales/Accounts/Warehouse/HR/Operations specifically — unlike BD-1's DBT-1 finding, there is no prior audit note suggesting this default is wrong.
- **Bucket classification:** `canReadProjectScoped()`'s company-isolation clause (`sameCompany(data)`) and the Owner/SuperAdmin-equivalent `isAdmin()` bypass remain Bucket A (untouched, unaffected by this resolution). The `!isProjectScopedRole()` breadth-of-visibility default itself is Bucket B in nature (a business scope-breadth choice, like BD-1/BD-2) but is — like BD-1/BD-2's resolution — correctly enforced as a raw role check in the rules layer rather than a `canDo()` lookup, for the same reason established in AUTH-D10 and BD-1/BD-2: it must stay in lockstep with the client's own seeded-value engine, which itself does not route through `canDo()` for this decision either.
- **Security / multi-company / multi-warehouse implications:** Company isolation (`sameCompany(data)`) is untouched and unaffected either way — this is purely a breadth-of-visibility choice within one tenant, identical in kind to BD-1/BD-2. No multi-warehouse concern applies (`projects` and its 11 satellite collections carry no `warehouseId` concept; `WAREHOUSE_SCOPED_COLLECTIONS` in `src/lib/firestore.ts` does not include any of them). GroupAdmin is unaffected — `match /projects/{projectId}` and every sibling block gate on `canReadProjectScoped(resource.data) || groupAdminCanRead(resource.data)`, and `groupAdminCanRead()` is a wholly separate, already-audited group-scoped path this task did not touch.
- **Decision:** **Option A — current behavior is intentional and correct.** Preserve `canReadProjectScoped()`'s `!isProjectScopedRole()` default exactly as-is; do not narrow project (or its 11 satellite collections') reads for Sales, Accounts, Warehouse, HR, Operations, Director, or Procurement. Manager and Partner's own narrower team/self scope (already correctly seeded and already client-enforced) is unaffected and unchanged by this decision either way.
- **AUTH-C4a status: CLOSED.** The "no BD-1..BD-8 entry authorized this narrowing" gap Phase 5 flagged is resolved — BD-9 now explicitly answers it as "leave as-is," with a concrete, verifiable, shipped-feature reason, not an assumption.
- **Tests added:** `src/lib/__tests__/projectVisibility.test.ts` — 1 new test proving Warehouse/Accounts/HR/Operations/Sales all resolve to `'all'` project-visibility mode (both the seeded `visibility:'all'` value and `getProjectVisibilityMode()`'s/`canAccessProjectRecord()`'s resulting behavior). `src/lib/__tests__/phase5OwnershipFieldAudit.test.ts` — 2 new tests (a new `describe` block) source-text-pinning `projectVisibility.ts`'s role-name-fallback default and `DispatchDetail.tsx`'s unconditional, permission-gate-free dependency on the company-wide projects list. All pre-existing tests in both files continue to pass unchanged.
- **Files changed:** `docs/RBAC_MASTER_IMPLEMENTATION_PLAN.md` (this record + §15 table annotation), `src/lib/__tests__/projectVisibility.test.ts` (+1 test), `src/lib/__tests__/phase5OwnershipFieldAudit.test.ts` (+1 describe block, 2 tests). No production/authorization source file was modified.
- **Business decisions:** BD-9 RESOLVED (documented above). BD-1 through BD-8 untouched, exactly as recorded (BD-1/BD-2 already resolved in the prior task).
- **Effect on Phase 7 readiness:** **Phase 7 is now fully unblocked on the business-decision front.** All three business decisions gating its objective (BD-1, BD-2, BD-9) are resolved. The 8 AUTH-C1 collections (leads/customers/quotations/orders/products/vendors/cases/loan_applications) and the `projects`/`commission_records`/`settlements` narrowing (AUTH-C4) can both now proceed under Phase 7, using: (a) each role's already-seeded `visibility` value as the ownership-predicate ground truth for the 8 AUTH-C1 collections (per BD-1/BD-2), and (b) `canReadProjectScoped()`'s current shape, confirmed correct, requiring NO change for the `projects` family (per BD-9) — Phase 7's own AUTH-C4 sub-objective may in fact require zero rules changes to `canReadProjectScoped()` itself; whatever remaining AUTH-C4 work Phase 7 defines should be scoped by Phase 7's own audit of `commission_records`/`settlements` specifically, not `projects`.

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

**PHASE 7 COMPLETION RECORD**

- **Status:** COMPLETE for its actual, business-decision-reconciled scope. Local commits only, on `local/rbac-phase1-8-and-mobile` — **not pushed**; `origin/main` untouched at `0d9699f` (mobile-only production, no RBAC). No production rules deploy (COUNTER-1's `ef97ae3` remains the last deployed RBAC ruleset — see the Phase 8 record; AUTH-C3's rule is local-only).
- **Scope reconciliation against the plan (STEP 1):** the §18 spec sketches "8 separate commits, one per collection, plus one more for `commission_records`/`settlements`/`projects`." The pre-Phase-7 business-decision resolutions (BD-1, BD-2, BD-9 — all RESOLVED (a), `e63e0d8` / `4a01d7e`) collapsed most of that sketch to no-ops, and Phase 7 correctly did **not** invent work to fill it:
  - **`leads` — CLOSED (`9fd0e80`).** Dedicated `canReadLeadScoped()` block: enforces the seeded `self` (Partner, field roles) / `team` (Manager) visibility at the rules layer; `'all'`-visibility roles (Sales, Admin, Director) unchanged. AUTH-C1 test updated (`9488647`).
  - **`customers` — CLOSED (`e708c4b`).** Dedicated `canReadCustomerScoped()` block, same pattern.
  - **`commission_records` / `settlements` — CLOSED (`1916f4f`, this phase's `commission_records`/`settlements` tightening commit).** See AUTH-C3 below.
  - **`quotations`, `orders`, `products`, `vendors`, `cases`, `loan_applications` — no rule added, deliberately.** Per BD-1/BD-2 (RESOLVED (a)), no role is seeded narrower than `'all'` on any of these collections, so there is no `self`/`team` value for an ownership predicate to enforce. Adding a block would be inventing a business rule nobody decided. They keep today's `sameCompany()` company-scope grant — the correct, decided outcome, not an omission.
  - **`projects` — no rule change, deliberately.** BD-9 RESOLVED (a): any non-field-role reading any same-company Project by id is the shipped intent; `canReadProjectScoped()`'s existing 5-field-role enforcement is correct as-is. AUTH-C4 closed as not-a-defect.
- **AUTH-C3 — CLOSED (`1916f4f`).** New helper `commissionSettlementReadAllowed(data)` in `firestore.rules`, replacing the non-GroupAdmin branch of the read rule on **both** `match /commission_records/{recordId}` and `match /settlements/{settlementId}`:
  - owner / SuperAdmin: unconditional (unchanged).
  - Admin / Manager / Director: `sameCompany(data)`, company-wide — byte-for-byte the same actor set as the rule it replaces (`actorRoleMatches('Admin|Manager|Director')`). Manager stays `'all'`; no narrower business behavior was invented.
  - **Partner: `sameCompany(data)` AND `data.get('partnerId','') != '' && actor.get('channelPartnerId','') == data.partnerId`.** The Partner self-scope that was previously advisory only (client `applyAccessFilters` / `buildOwnershipVisibilityQueryPlan` on `OWNERSHIP_FIELDS`) is now rules-enforced. A same-company Partner can no longer `getDoc()` another partner's commission/settlement financial row by direct id. A row with no `partnerId` is not partner-owned → denied to Partner (Admin/Manager/Director still read it).
  - `create` / `update` / `delete` on both blocks: **UNCHANGED.** The GroupAdmin ternary branch (`isGroupAdmin() ? (groupAdminCanRead(resource.data) || canReadCompanyScoped()) : ...`): **UNCHANGED.**
  - `sameCompany()` (owner/SuperAdmin bypass, `companyId` match, §9.6 group-active check) is the sole tenant/group isolation gate and is untouched — company/group isolation is not weakened.
- **Expression-budget result:** PASS. A first attempt (`canReadPartnerModuleScoped()`, which kept the trailing `&& (actorIsSuperAdmin() || actorRoleMatches(...))` and added `isAdmin()`) exceeded Firestore's 1000-expression-per-request budget ("Unable to evaluate the expression as the maximum of 1000 expressions to evaluate has been reached", on both blocks, including positive cases) and was reverted. The shipped `commissionSettlementReadAllowed()` **replaces** that combo instead of stacking on it, binds `authMap` + `actor` **once** each via `let` (RHS evaluated once), and reads `role` / `channelPartnerId` as plain field accesses (no `get()`). Net expression count is **lower** than the rule it replaces. The rule was **not weakened** to fit the budget — it was restructured. No budget error in any clean emulator run (verified across repeated runs to distinguish a real pass from a budget failure and from an environmental hook timeout).
- **Security behavior verified (emulator, STEP 3):**
  - Partner A reads own commission_record / settlement (matching `partnerId`) — **ALLOW.**
  - Partner A direct-reads Partner B's commission_record / settlement — **DENY.**
  - Commission_record with no `partnerId` — **DENY to Partner** (ALLOW to Admin/Manager/Director).
  - Cross-company commission_record / settlement — **DENY** (Partner and Admin alike).
  - Unconstrained Partner collection query — **DENY** (rejected, not silently filtered).
  - Partner query narrowed to own `partnerId` — **ALLOW**, returns exactly the own row.
  - Partner `create` / `update` on a commission_record — **DENY** (no privilege escalation; write rules unchanged and still deny Partner).
  - Admin / Manager / Director read any same-company commission_record / settlement — **ALLOW** (unchanged).
  - Admin cross-company read — **DENY** (unchanged).
  - GroupAdmin same-group read via `groupAdminCanRead()` — **ALLOW** (unchanged).
- **Tests + exact results:**
  - `src/lib/__tests__/commissionSettlementOwnershipScope.emulator.test.ts` — **NEW, 16/16 PASS** (re-run repeatedly, all green, no budget error, no timeout). Registered in `vitest.emulator.config.ts`.
  - `src/lib/__tests__/sensitiveCollectionsRoleEnforcement.emulator.test.ts` — **118/118 PASS** (was 116 + 2 AUTH-C3 failures before the update: `commission_records`/`settlements` `readRoles` changed from `['Manager','Partner','Director']` to `['Manager','Director']` — the generic loop had encoded the pre-AUTH-C3 blanket-read contract; a dedicated 6-test `describe('… AUTH-C3 Partner self-scope')` block was added in that file to pin the before/after).
  - Regression, unchanged suites: `customersOwnershipScope` 14/14, `leadsOwnershipScope` 14/14, `banksRoleAliasParity` 8/8, `groupAdminFullGroupAccess` PASS.
  - `npx tsc --noEmit` — clean. `npm run build` — EXIT 0 (`✓ built in ~3m`).
  - The full 31-suite `npm run test:rules` was **not** run as one pass — it is environmentally flaky on this memory-constrained sandbox (hook timeouts, documented in `vitest.emulator.config.ts`). Per §18 point 15, targeted batches covering every touched + adjacent suite were run instead, reliably and repeatedly. No shared rules helper was modified (only a new function + two rule-line swaps), so the "silently break an unrelated suite via a shared helper" risk does not apply here.
- **Files changed (Phase 7, cumulative):** `firestore.rules` (`9fd0e80` leads block; `e708c4b` customers block; `1916f4f` `commissionSettlementReadAllowed()` + the two read-rule swaps); `src/lib/__tests__/customersOwnershipScope.emulator.test.ts`, `src/lib/__tests__/leadsOwnershipScope.emulator.test.ts`, `src/lib/__tests__/authC1AuditRegression*.ts` (`9488647`); `src/lib/__tests__/commissionSettlementOwnershipScope.emulator.test.ts` (NEW, `1916f4f`); `src/lib/__tests__/sensitiveCollectionsRoleEnforcement.emulator.test.ts` (`1916f4f`); `vitest.emulator.config.ts` (`1916f4f`).
- **Deviation from the plan's original Phase 7 text, disclosed:** the §18 spec's "8 commits + 1" boundary assumed all 8 AUTH-C1 collections and all 3 of `commission_records`/`settlements`/`projects` would need enforcing rules. After BD-1/BD-2/BD-9 resolved to "keep current behavior," only 3 collections (`leads`, `customers`, `commission_records`+`settlements`) had a seeded `self`/`team` value to enforce, so Phase 7 landed as **2 collection commits + 1 combined `commission_records`/`settlements` commit** (the two share one match-block pattern and one helper — the plan's "never combined" refers to not combining *unrelated* collections; these two are the same rule). This is a scope reduction driven by the business-decision outcomes, not a shortcut — every collection the plan named was evaluated and its disposition recorded above.
- **Business decisions:** BD-1, BD-2, BD-9 remain RESOLVED (a) exactly as recorded — Phase 7 consumed those resolutions, did not revisit them. BD-3 through BD-8 untouched.
- **Remaining non-blocking findings (do not block Phase 7 completion):**
  - **AUTH-C1a** (CSV-imported leads persist `assignedToId: ''`) — still deferred. Not triggered by Phase 7's `leads` block because `canReadLeadScoped()` also checks `createdBy` and `partnerId`, and an `'all'`-visibility role (Sales/Admin) still reads unassigned leads; a Manager/Partner would not see a truly ownerless CSV lead, which is the pre-existing risk this finding names. A backfill remains advisable before any future narrowing of Sales.
  - **AUTH-C1b** (`loan_applications` `assignedToId` coverage unconfirmed) — moot for now: no rule was added to `loan_applications` (no seeded narrower visibility). Revisit only if a future BD narrows a role on that collection.
  - **AUTH-S1b** (`TL` alias / `BDM`/`BDE` wildcard gaps on the bare `Manager` alternation in the `commission_records`/`settlements` blocks and 7 Inventory write rules) — **still deferred.** This is a false-DENY (a `TL` would be wrongly denied), i.e. it fails safe, and widening those alternations needs its own paired budget re-verification. Not folded into AUTH-C3 (which only touched the read rule's non-GA branch and left the `Manager` alternation on the write rules untouched).
- **Production / `main` impact:** NONE. `main` and `origin/main` = `0d9699f`, unchanged. No deploy. No branch reset/rewrite. No merge to production.

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

**PHASE 8 COMPLETION RECORD**

- **Status:** COMPLETE. GroupAdmin's API access + full group-scope plane landed across `6d5c29b` / `948053e` / `412f756` / `1371030` / `f53cc18` (behaviour) with emulator + real-browser proof in `e6cd9d1` / `86cff5d` / `ae8d86d` / `ffe5ff4`, and the `document_counters` denorm-backfill field fix `ef97ae3` (COUNTER-1). Local commits on `local/rbac-phase1-8-and-mobile`; `origin/main` untouched at `0d9699f`. **COUNTER-1's `ef97ae3` is the one Phase 8 change that was also deployed to production Firestore rules** (ruleset `6de72e9c-afd8-40b1-8295-b9a0a4f7b4eb`, `scripts/verify-deployed-rules-parity.cjs` → PARITY OK, live-verified via quotation DQT-0013 in `company-demo-neozy` on 2026-09-07) — that deploy predates this task and is out of scope per the "do not touch COUNTER-1/COUNTER-2" instruction; it is recorded here only for completeness. No further deploy in this task.
- **AUTH-D4 — final end-to-end closure confirmed.** `EXACT_ROLE_COMPATIBILITY` (`api/_lib/permissions.ts`) still carries `groupadmin` / `tl` / `demo operator` / `demo admin`; the Phase 6 `getRoleDocument()` rewrite (`ec6046f`) did not regress it; `412f756` adds the group-scope resolution so a GroupAdmin API call now resolves its target company's Admin template AND is bounded to the actor's group. GroupAdmin API access flips DENY → ALLOW (company-scoped, group-bounded), nothing wider.
- **AUTH-S5 (`/group/*` naming trap) — resolved by routing, not rename.** All 8 `/group/*` routes plus `/group` are `<SuperAdminRoute>`-gated (owner-email literal) in `src/app/router/routes.tsx:341-348`. GroupAdmin operates its own group's companies through `activeCompanyId` switching + the dedicated `groupAdminCan*` rules branches, never through `/group/*`. The naming trap is documented as intentional (owner-only group console); no code rename was required and none was made.
- **§9 / §10 SIGNED-OFF VERIFICATION CHECKLIST — see the dedicated section immediately below.** Every row hand-checked against the current tree (`firestore.rules`, `src/lib/permissions.ts`, `src/lib/ownerAccess.ts`, `src/components/auth/SuperAdminRoute.tsx`, `src/app/router/routes.tsx`, `api/_lib/auth.ts`, `api/_lib/permissions.ts`), not from memory. Result: **every §9 row and every §10 row still reads exactly as documented.**
- **Business/security logic:** unchanged by this documentation pass (per STEP 5's constraint). No Phase 8 source file was modified in this task — the completion record and checklist are documentation of already-landed, already-verified work plus a fresh static re-audit.
- **Tests + exact results (Phase 8, as landed + re-checked this task):**
  - Emulator SuperAdmin + GroupAdmin suites (`groupAdminFullGroupAccess`, `groupAdminProductCrud`, `rbacPhase8CumulativeSecurity`, `missingIsSuperAdminFieldFix`, `phase8GroupPerformance`, `rolesSystemRolePermissionEditFix`) — green as landed (`ffe5ff4` records the full-suite pass; memory `project_rbac_phase8_groupadmin` records 352/352 at Phase 8 close). `groupAdminFullGroupAccess` re-run green in this task's AUTH-C3 regression batch.
  - API suite — 370/370 at Phase 8 close (memory-recorded), including `groupAdminApiAccess.test.ts` end-to-end GroupAdmin CRUD.
  - Live verification (2026-09-07, memory `project_rbac_phase8_groupadmin`): browser + REST, both tenants — GroupAdmin home + sibling-company Product CRUD works; foreign-group access denied; GroupAdmin cannot promote GroupAdmin/SuperAdmin; Owner boundary intact.
  - `npx tsc --noEmit` — clean (this task). `npm run build` — EXIT 0 (this task).
- **Deviation from the plan's original Phase 8 text, disclosed:** the §18 spec anticipated "one commit if only the GroupAdmin API closure + optional rename land here." Phase 8 in practice needed a multi-commit group-scope plane (the API closure alone was insufficient — GroupAdmin queries, session context, and the REST 4th plane all needed group-scoping) plus the COUNTER-1 hotfix surfaced during live verification. This is a scope expansion driven by what live testing found, each commit tightly scoped and independently described; disclosed here rather than silently absorbed.
- **Remaining non-blocking findings:** `NOTIF-2` (unchanged, non-blocker, memory-tracked). AUTH-D10 was closed as a between-phase follow-up (`38f3077`), not Phase 8. No new findings from this task's re-audit.
- **Production / `main` impact:** NONE from this task. `main` / `origin/main` = `0d9699f`. The only production rules state is the pre-existing COUNTER-1 deploy (`ef97ae3` → ruleset `6de72e9c`), untouched here.

### §9 / §10 BOUNDARY RE-VERIFICATION CHECKLIST — signed off 2026-09-08 (Phase 8 gate)

Hand-checked row-by-row against the current working tree at `local/rbac-phase1-8-and-mobile` HEAD, not from memory. "Evidence" cites the exact file/function verified.

**§9 — Super Admin / Owner**

| §9 row | Documented state | Verified this pass | Evidence |
|---|---|---|---|
| Access `/platform/*`, `/group/*`, `/ai-intelligence`, `/audit-logs` — owner-email only | ALLOW, owner-email only; `SuperAdminRoute` never widened to `isSuperAdmin===true` or a role | ✅ HOLDS | `routes.tsx:321-348` — all 17 routes wrapped in `<SuperAdminRoute>`, no `RoleRoute`. `SuperAdminRoute.tsx` → `useSuperAdminAccess()` returns `isOwnerFirebaseUser(auth.currentUser)` **only**; redirects to `/unauthorized` otherwise. |
| Manage every Group/Company/User/Role/Permission — unconditional | ALLOW, unconditional | ✅ HOLDS | `firestore.rules` `isOwnerIdentity()` is the first OR-term of every read/write path (`companies` L929, `roles` L1075/L1129, `users` L1454, etc.). `api/_lib/auth.ts` short-circuits to a synthetic Owner principal on `isOwnerEmail(user.email)`. |
| System-level settings — unconditional | ALLOW | ✅ HOLDS | Same `isOwnerIdentity()` bypass on `settings` / `platform_settings` blocks. |
| Bypass company/group scoping anywhere | ALLOW — the one legitimate universal bypass | ✅ HOLDS | `sameCompany()` L108 and `sameGroup()` L241 both lead with `isOwnerIdentity()`. |
| Non-negotiable: no phase changes `isOwnerFirebaseUser()`'s comparison target or adds a widening condition (`|| isSuperAdmin`) | must remain true | ✅ HOLDS | `git diff 33fc782 HEAD -- src/lib/ownerAccess.ts src/components/auth/SuperAdminRoute.tsx` → **empty** (byte-identical to pre-RBAC baseline). `isOwnerIdentity()` body in `firestore.rules` is character-for-character identical to `33fc782:firestore.rules`. `api/_lib/auth.ts` owner check content-identical (only line numbers shifted by `412f756`'s groupId threading). No `|| isSuperAdmin` anywhere in the owner gate. |

**§10 — Group Admin**

| §10 row | Documented state | Verified this pass | Evidence |
|---|---|---|---|
| Switch `activeCompanyId` to any company in own group | ALLOW — client state + `actorGroupId()` match on every GroupAdmin rules branch | ✅ HOLDS | `groupAdminCanRead(data)` L279 requires `data.groupId == actorGroupId()` **and** `groupIsActive(...)`. `actorGroupId()` L206 derives `groupId` from the cached auth-map doc, never a client-claimed value. |
| Create/edit roles per company, except while `activeCompanyId==='group'` (fails closed) | ALLOW except group-sentinel | ✅ HOLDS | `permissions.ts:234` — `if (module === 'roles' && (action==='create'\|\|'edit'\|\|'delete') && state.activeCompanyId === 'group') return false;` — evaluated **before** the `isSuperAdmin` bypass and the permission cache. Rules side: `roles` create/update require `groupAdminCanReadRole(data)` L525 → resolves `companies/{data.companyId}.groupId == actorGroupId()`. |
| Manage users per company, incl. cross-company transfer within the group | ALLOW — the one deliberate `companyId`-mutability exception | ✅ HOLDS | `usersUpdateAllowed()` branch C L1420 — requires `actor.role == 'GroupAdmin'`, `resource.data.groupId == actorGroupId()`, `groupIsActive(...)`, `isSuperAdminFlag` unchanged, new `companyId` passes `groupAdminUserCompanyMatches()` (new company's `groupId == actorGroupId()`), and `groupIdUnchanged()`. No group escape possible. |
| Promote a second GroupAdmin — narrow: target already holds `group_members`, cannot be self | ALLOW, narrowly | ✅ HOLDS | Same branch, promotion exception L1434 — `userId != authMap.userId && exists(group_members/$(resource.data.groupId + '_' + userId))`. Self-promotion always denied. |
| `/group/*` routes | DENY — `SuperAdminRoute`-gated (owner-email), not reachable by this role | ✅ HOLDS | `routes.tsx:341-348` — `/group`, `/group/companies`, `/group/warehouses`, `/group/users`, `/group/teams`, `/group/roles`, `/group/audit-log`, `/group/settings` all `<SuperAdminRoute>`. |
| REST API access | RESOLVED (Phase 1 alias table + Phase 6 lookup + Phase 8 group-scope) | ✅ HOLDS | `EXACT_ROLE_COMPATIBILITY` carries the GroupAdmin aliases; `412f756` threads group scope as the API's 4th plane; API suite 370/370 + live REST verification both tenants (2026-09-07). |
| Cross-group reach | DENY — `actorGroupId()` match required | ✅ HOLDS | Every `groupAdminCan*` helper compares the target's group to `actorGroupId()`; a forged `companyId` pointing into another group is rejected (`groupAdminCanReadRole` / `groupAdminUserCompanyMatches` both re-resolve the real `companies/{id}.groupId`). |
| Company-scoped users granted GroupAdmin/SuperAdmin capability | must remain DENY | ✅ HOLDS | `actorIsGroupAdmin()` L214 keys off the mapped `users` doc's `role == 'GroupAdmin'` — a literal role string, **not** a permission checkbox. `usersUpdateAllowed()` branch B forbids a non-super Admin setting `role='GroupAdmin'` or changing `isSuperAdmin`; `selfAccessFieldsUnchanged()` L547 blocks self-escalation of `role`/`companyId`/`groupId`/`superadmin`. |

**Sign-off:** all §9 and §10 rows verified against current code on 2026-09-08. No drift from any of Phases 1–7. GroupAdmin's API-access row is the only intended change from the original baseline (DENY → ALLOW, company-scoped + group-bounded). Phase 8 gate satisfied.

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

**PHASE 9 COMPLETION RECORD**

- **Status:** COMPLETE / PASS. Verification-only — no `firestore.rules`, RBAC/application source, test-scope, Vitest/emulator config, or GitHub-workflow change was made for this gate. Local commits only, on `local/rbac-phase1-8-and-mobile`; `origin/main` untouched at `0d9699f`. No production deploy, no merge.
- **The four mandatory gates (§20, run in their entirety) against RBAC HEAD `0a8cef0`:**
  1. **`npx tsc --noEmit` — PASS, exit 0** (no diagnostics).
  2. **`npx vitest run` — 29 failed files / 65 failed tests / 3773 passed (277 files, 3838 tests), exit 1.** This is the Master Plan's **documented pre-existing baseline** (§20's "expected 29 failed files / 65 failed tests"; §22's "The full pre-existing test baseline (29 failed files/65 failed tests) still matches exactly"), **matched EXACTLY — zero unexplained deltas.** The 65 failures are the pre-existing brittle source-text / class-string UI-parity suite (`projectWorkspace*Integration`, `customerWorkspace*`, `projectWorkspaceUiStructure`, `useProjectStage`, `navigationConsolidation`, `channelPartnerPhase13Verification`, `demoPhase1Readiness`, `phase14DocumentsExpansion`, `useEmployeesGroupAdminVisibility`, `customerWorkspaceHeader`, …) — they fail identically on production `main`, no RBAC commit touches any of them, and BRAIN.md §35 already records them as "~29 brittle source-string UI test files fail as a baseline (not regressions)". They are **not a newly introduced failure** and were **not "fixed"** (the plan does not require fixing them). The two RBAC-attributable deltas that briefly existed (`phase5OwnershipFieldAudit.test.ts`, `employeeFaceRegistration.structural.test.ts`) were cleared by the two test-hygiene commits below; the failing-file list is now byte-identical between consecutive full runs, with neither of those files present.
  3. **`npm run test:rules` — PASS: 32/32 test files, 818/818 tests, 0 skipped, exit 0.** Run as the **exact, unmodified** command (`firebase emulators:exec --only firestore --project neozy-demo-isolation-test "vitest run --config vitest.emulator.config.ts"`) on the **GitHub Actions `Security Rules Tests` workflow** (`.github/workflows/security-rules-tests.yml`), job `Firestore rules suite (npm run test:rules)`, runner `ubuntu-latest`, event `pull_request`, workflow run `34216974918`, against RBAC HEAD `0a8cef0` via GitHub's ephemeral test-merge ref `refs/pull/1/merge` (`cbe338e Merge 0a8cef0 into 0d9699f`). `main`'s only commits since the `33fc782` merge-base are mobile-UI-only and touch none of `firestore.rules` / `*.emulator.test.ts` / `vitest.emulator.config.ts` (`git diff --stat 33fc782 origin/main` on those paths is empty), so the rules suite that ran is byte-identical to `0a8cef0`. Duration 145.55 s; log line `✔  Script exited successfully (code 0)`.
     - **Why on CI, not locally:** this sandbox (16.9 GB RAM, ~1.5–3.8 GB free, 8 shared vCPU) cannot reliably complete the full 32-suite single-process emulator run — the documented environment characteristic in `vitest.emulator.config.ts`'s own header ("this sandboxed environment's Firestore emulator has a slow cold-start … Environment characteristic, not a defect") and BRAIN.md §2.1 ("full cold run is flaky (hook timeouts), batched runs pass 100%"). Three local full-run attempts all produced **only** Firestore-emulator connectivity failures (`client is offline` / `Could not reach Cloud Firestore backend` / `Test timed out in 20000ms`) — **zero real assertion failures** — with suite durations 3–10× normal, while every affected suite passed **100% in isolation** (`multiTenantSecurity` 278/278; `groupAdminFullGroupAccess` + `leadCreationProjectionWrites` + `sensitiveCollectionsRoleEnforcement` 162/162; `rolesSystemRolePermissionEditFix` + `sensitiveCollectionsRoleEnforcement` 130/130; `groupAdminFullGroupAccess` + `rbacPhase8CumulativeSecurity` + `commissionSettlementOwnershipScope` 41/41). **Those isolated runs were diagnostic only — they did NOT substitute for the mandatory full `npm run test:rules` gate**, which is why the gate was run in full on a capable runner.
     - **CI-verification procedure (authorized, temporary):** HEAD `0a8cef0` was pushed to the temporary remote branch `ci/rbac-phase9-verify` (a non-production `ci/*` name — never `main` / `release/*` / `proposed/*`); a **draft** pull request (#1, base `main`) was opened solely to trigger the `pull_request` workflow; after the result was read, the PR was **closed unmerged** (`state: closed`, `merged: false`, `merged_at: null`) and `ci/rbac-phase9-verify` was **deleted** from `origin`. `main` / `origin/main` were never written; nothing was merged; no `workflow_dispatch` was added; `.github/workflows/security-rules-tests.yml` was not modified.
  4. **`npm run build` — PASS, exit 0** (`✓ built in ~40 s`; only the pre-existing "chunks larger than 600 kB" informational notice).
- **§7 / §9 / §10 baseline (Phase 9 §18 acceptance — "zero unexplained deltas"):** every §7 cell either matches its pre-Phase-1 value, or traces to a **named §12 defect fix** (AUTH-C1: `leads` `9fd0e80`, `customers` `e708c4b`; AUTH-C3: `commission_records`/`settlements` `1916f4f`) or an **approved §15 decision** (BD-1 / BD-2 / BD-9, all RESOLVED (a)). §7.7's Partner rows were already updated to "FIRESTORE" in the Phase 7 closure (`39aff94`); §9 and §10 were already hand-verified row-by-row in the **§9/§10 Boundary Re-Verification Checklist** signed off 2026-09-08 (above). The full `npm run test:rules` pass (32/32 files) and the `npx vitest run` baseline match confirm those hold end-to-end. No §7 cell changed value in this phase; nothing over-restricts a legitimate role and nothing broadens access.
- **Originating-phase test-hygiene fixes (test-only, not security/behaviour):** `0dd36b9` — `src/lib/__tests__/phase5OwnershipFieldAudit.test.ts`'s AUTH-C3 assertion updated to pin the current, approved `commissionSettlementReadAllowed()` predicate (it still string-matched the pre-Phase-7 rules comment that `1916f4f` deliberately rewrote — the identical stale-assertion class `9488647` already fixed in that file for the AUTH-C1 assertions). `0a8cef0` — `src/components/attendance/__tests__/employeeFaceRegistration.structural.test.ts`'s biometric-gate assertion updated from the pre-AUTH-D10 substring to the current gate that `38f3077` deliberately widened to admit GroupAdmin. Neither touches `firestore.rules`, RBAC source, or any authorization behaviour; the AUTH-C3 requirement and biometric authorization are unchanged. Each was sent back to its originating phase and re-verified, per Phase 9 §18 point 14 ("does NOT get patched ad hoc inside Phase 9").
- **Phase 0–8 completion:** remains confirmed — every §18 completion record (Phases 1–8, the AUTH-D10 follow-up, and the BD-1/BD-2 and BD-9 resolutions) stands unchanged; no Phase 1–8 source, rules, or config file was modified in this phase. The full CI rules pass (32/32 files, 818/818 tests) exercises the Phase 1–8 rules end-to-end.
- **Deviation from the plan's original Phase 9 text, disclosed:** (a) §18 point 16 sketched the commit as "`docs(rbac): Phase 9 full regression — updated role × page × action baseline`" with an in-place §7 rewrite; §7.7 was already brought current in the Phase 7 closure (`39aff94`) and §9/§10 were already checklisted in the Phase 8 closure, so the residual §7 delta is nil and this closure is the completion record + changelog entry only (plus the two test-hygiene commits). (b) One gate (`npm run test:rules`) ran on GitHub's `ubuntu-latest` rather than locally, because the local sandbox cannot complete the full single-process emulator suite (documented environment limit — see gate 3 above); the command, scope, and config were identical.
- **Remaining non-blocking findings:** none new. AUTH-C1a / AUTH-C1b remain deferred (unassigned-record handling, no role seeded narrower than `'all'` on the affected collections). AUTH-S1b remains deferred (a `TL`-alias false-DENY on the bare `Manager` alternation — fails safe). BD-3 / BD-4 / BD-5 / BD-6 / BD-7 / BD-8 remain open business decisions, unchanged. `NOTIF-2` unchanged non-blocker.
- **Production / `main` impact:** NONE. `main` = `origin/main` = `0d9699f` — byte-identical to the pre-Phase-9 state, verified against both local and remote. HEAD `0a8cef0` is not an ancestor of `origin/main` (RBAC is not in production). No merge, cherry-pick, reset, or rebase of any production branch. No `firebase deploy` / Vercel deploy; the deployed Firestore ruleset remains `6de72e9c` (COUNTER-1, pre-dates this work). The only push in this phase was the temporary `ci/rbac-phase9-verify` branch for CI, since deleted.
- **Phase 10:** NOT STARTED.

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

**PHASE 10 — REMEDIATION PROGRESS (INTERIM — NOT A COMPLETION RECORD)**

- **Status: BLOCKED — awaiting BD-3..BD-8, and CP-1 where BD-3 applies.** Phase 10 is **not** complete and the verdict is **not** "RBAC READY". This interim record exists only to document the two technical findings that the fresh Phase 10 audit surfaced and that have since been remediated in code. It does **not** close Phase 10, does not supersede the §22 checklist, and does not resolve any open business decision.
- **The fresh Phase 10 audit (independent re-read of `firestore.rules`, `api/_lib/*`, every route guard, and the mobile workspaces) confirmed §12 is otherwise genuinely closed** — every previously-closed `AUTH-*` finding re-verified closed, the §7/§9/§10 baseline re-confirmed with zero unexplained deltas — and surfaced exactly two new issues plus one pre-existing dead-code gap:
  - **N1 (AUTH-C1, REST-API plane) — REMEDIATED (`c665794`).** The Phase-7 `leads`/`customers` self/team ownership predicate was enforced only on the Firestore-rules / client-SDK plane; the generic REST API (`/api/leads`, `/api/customers`, list and direct-id read) enforced only company/group scope, letting a Partner or Manager enumerate every same-company lead/customer via direct API calls. Fixed by mirroring the existing client ownership model server-side (`api/_lib/ownership.ts` + `resolveEffectiveVisibility` in `api/_lib/permissions.ts` + `channelPartnerId` on `AuthenticatedUser`), scoped to **leads and customers only**, **READ-only** (create/update/delete authorization untouched), **no `firestore.rules` change**, Option B (tenant-scoped query + in-memory ownership filter + in-memory pagination — no new composite index). Full detail in the AUTH-C1 register row. Tests: `api/__tests__/apiLeadsCustomersOwnershipVisibility.test.ts` (18).
  - **N2 (AUTH-D9) — REMEDIATED (`7f90239`).** `MobileInstallationsWorkspace.tsx`'s hardcoded `role==='Admin'||role==='Director'` edit gate replaced with `perms.canEdit('installations')`, matching desktop. Full detail in the AUTH-D9 register row. Tests: `mobileInstallationsPermissionGate.test.ts` (4).
  - **CP-1 (partner eligibility gate has zero call sites) — STILL BLOCKED BY BD-3, deliberately untouched.** `validatePartnerCanAct` / `validatePartnerCanCreateLead` remain defined-but-unwired. Wiring them changes what a suspended / KYC-rejected partner can do, which is a business-policy question (BD-3), not a mechanical fix. Not wired, not deleted, KYC/suspension behaviour unchanged.
- **Verification of the two remediations (combined):**
  - `npx tsc --noEmit` — exit 0.
  - `npm run build` — exit 0.
  - `npx vitest run --config vitest.api.config.ts` — all API suites pass (388 tests, exit 0; delta from pre-N1 = exactly the 18 new N1 tests).
  - `npx vitest run` (full) — 29 failed files / 65 failed tests / 3777 passed: the **documented pre-existing baseline, unchanged** (the +1 file / +4 tests vs. the Phase 9 number are the 4 new N2 tests, all passing; the failing-file list is byte-identical to the Phase 9 baseline). Zero unexplained regression.
  - `npm run test:rules` — **not re-run for Phase 10 N1/N2 and not required to be:** `firestore.rules` is byte-identical to its Phase 9 state (`git diff` empty), neither remediation touches a `*.emulator.test.ts` file or the emulator config, so the Phase 9 CI rules pass (32/32 files, run `34216974918`) still stands. A confirmatory isolated emulator batch (`commissionSettlementOwnershipScope` + `sensitiveCollectionsRoleEnforcement`) was run locally and exited 0.
  - `git diff --stat` reviewed after each commit — only the intended files changed; no unrelated file, no `BRAIN.md`, no `firestore.rules`, no Phase 1–9 source.
- **Open business decisions still gating Phase 10 completion — NOT decided here, NOT guessed:** BD-3, BD-4, BD-5, BD-6, BD-7, BD-8 (§15). Their exact wording is unchanged. Phase 10 cannot reach "RBAC READY" until each has a recorded, dated, attributed answer (per §22) and any resulting mechanical work is done and verified.

**Phase 10 remediation — continuation pass (BD deep-dive + doc hygiene + fresh audit)**

- **CP-1 / BD-3 — fully analysed against current source; STILL BLOCKED; NOT implemented.** Every partner action path was traced fresh: `partnerCreateLead` (`src/lib/partnerLeadIntegration.ts` — validates partnerId-link + assignee eligibility only), `generateCommissionRecord` (checks `lead.partnerId` present only), portal customer/project create (`PartnerCustomers.tsx`/`PartnerProjects.tsx` → canonical `useSaveCustomer`/`useSaveProject`, no gate), scheme-registration create/edit, and portal login (`PartnerPortalLayout` → `isPartnerPortalUser` role check only). Repo-wide grep re-confirmed **zero call sites** for `validatePartnerCanAct` / `validatePartnerCanCreateLead` and **no other runtime code anywhere reads `channel_partners.status` or `.kycStatus` for authorization** (only display badges, the internal Partners UI approve/suspend buttons, and fraud analytics). `validatePartnerCanAct` as written rejects **all** non-`'verified'` KYC (including `not_started` / `submitted`), which would block every state-C partner (approved+linked, KYC pending) — the exact steady-onboarding state BRAIN.md §8.3 documents as fully operational. Wiring it verbatim is therefore not a safe mechanical fix. **BD-3 does not specify the action matrix** (§15: "needs an explicit answer on exactly which actions to block"); BRAIN.md CP-1 frames it as "wire it … OR consciously decide status/KYC are advisory". The exact per-action / per-state decision required from the owner is enumerated in the final Phase 10 remediation report and remains open. To be server-authoritative (per the task's own requirement) a wired gate would also need `firestore.rules` changes reading `channel_partners.status`/`.kycStatus` on every partner write (a `get()` per evaluation — §10.4 budget risk, needs live verification) plus the same gate in `api/[entity].ts` create. Not started. No helper wired, no helper deleted, KYC/suspension behaviour unchanged.
- **BD-4 (`cases` for Director / Manager) — NOT implemented.** Current source re-verified: `src/lib/roleBootstrap.ts` seeds `cases` on **no role** (only Admin reaches it via the empty-map allow-all). §15's "(a) for Director" is a *recommended default* inside a still-open BUSINESS DECISION REQUIRED row — §0 point 4 and §15's intro forbid resolving it by picking the recommended answer. Not unambiguously established anywhere in BRAIN.md or this plan. No seed change. Both the Director grant and the Manager question remain owner decisions.
- **BD-5 (`Management` role alias) — NOT implemented; three-way inconsistency documented.** Current source: `src/lib/permissions.ts:88` and `api/_lib/permissions.ts:140` both map `management → 'Admin'`; `firestore.rules` has **no** `roleMatches('Management')` anywhere (only a `department == 'Management'` field check), so a `Management`-role user gets full Admin in the client + REST API but only generic company-scoped access at the rules layer (fails-safe, but a live client/API↔rules disagreement **today**). Resolving it needs BOTH (a) the owner's Admin-vs-Director intent AND (b) a production query for how many live accounts carry the exact role string `Management` — neither is available to this audit (no production Firestore access). No alias change made, in any of the three planes. BD-5 remains open, exactly as BRAIN.md AUTH-S3 records.
- **BD-6 (Accounts → `partners` view) — NOT implemented; no code impact either way.** Current source: Accounts seed has no `partners` grant (`roleBootstrap.ts`). §15 recommends (b) preserve. No widening made. Not a code blocker for Phase 10 (option (a) would be a widening we will not do without a decision; option (b) is the current state); still needs a formal owner answer for §22 completeness.
- **BD-7 (Manager approve on Orders/Dispatch) — NOT implemented; no code impact.** Current source: Manager seed has `orders: {view,create,edit}` and `dispatch: {view,create,edit,view_pricing}` — **no `approve`** on either (matches §7.2). Current state already equals §15's recommended (a) "leave denied". Accounts/Warehouse approval paths unaffected and intact. No seed change. Not a code blocker; needs a formal owner "confirm (a)" for §22.
- **BD-8 (7 borrowed-module routes) — NOT implemented; no real authorization mismatch found.** Each route re-inspected in `src/app/router/routes.tsx`: `/stock-transfers`→`stock`, `/goods-receipts`(+/:id)→`purchase_orders`, `/handovers`(+/:id)→`projects`, `/amc-contracts`(+/:id)→`projects`, `/monitoring`(+/:id)→`projects`, `/sales-documents`→`leads`, `/notifications`(+/:id)→`dashboard`. In every case the underlying collection (`stock_transfers`, `goods_receipts`, `project_handovers`, `amc_contracts`, `generation_readings`, …) has its **own dedicated `firestore.rules` block** enforcing tenant + role + (where applicable) warehouse scope **independently** of which route guard admitted the user to the page — the route guard is UX-layer only (BRAIN.md §1.2). The borrowed grant is *consistent, not contradictory* (§6). No route performs an action more privileged than its parent module's permission implies at the enforcement layer. Recommended disposition: (b) document the sharing as intentional for all 7 (with `/stock-transfers` the one candidate for a future dedicated `stock_transfers` module key if the business wants finer granularity — an atomic permission-matrix migration that BD-8 says needs a per-route owner decision). No route re-pointed, no module key created. BD-8 remains an owner sign-off item, not a code blocker.
- **Documentation hygiene (this pass):** §12 **AUTH-D10** row updated from "deliberately not fixed" → **CLOSED (`38f3077`)**, cross-referencing the existing "AUTH-D10 — SECURITY FOLLOW-UP" §18 section (the fix landed between Phase 6 and Phase 7; only the register row lagged). §12 **AUTH-C2** row updated from "BUSINESS DECISION REQUIRED" → **SUBSUMED / RESOLVED**: the cited "seed comment says narrower" premise no longer exists in `roleBootstrap.ts` (verified), the Sales half is decided by BD-1 RESOLVED (a), the Operations half is a confirmed non-issue (no role seeded narrower than `'all'`, no team-scoped module). §12 **AUTH-C1** and **AUTH-D9** rows carry the N1 / N2 remediation detail (added in the interim pass, re-verified accurate). No Phase 1–9 completion record altered. No "Phase 10 COMPLETE" / "RBAC READY" written. No BD marked RESOLVED that was not already RESOLVED before this task.
- **Fresh independent Phase 10 audit (continuation pass) — result:** every previously-CLOSED `AUTH-*` finding re-verified CLOSED against current source (AUTH-D1/D4/D5/D6/D7/D10, AUTH-C1 both planes, AUTH-C3, AUTH-C4/BD-9, AUTH-C6, AUTH-S1). N1 and N2 re-verified present and correct in the working tree (`handleList` runs `requirePermission('view')` before `resolveApiOwnershipScope`; `handleGetById` returns the tenant-miss not-found for an out-of-scope owned record; `MobileInstallationsWorkspace.tsx` has no `isAdmin` / role-literal authorization path). `firestore.rules` byte-identical to Phase 9 close (`git diff 7d96f5e HEAD -- firestore.rules` empty). §7/§9/§10 baseline unchanged. **New OPEN blockers: none** beyond the already-known BD-3..BD-8 owner decisions and CP-1 (blocked by BD-3). **New DEFERRED findings: none.** The security posture is materially stronger than at Phase 10 entry (both enforcement-plane divergences N1/N2 closed) but Phase 10 cannot be declared complete while BD-3 (and, for §22 completeness, BD-4..BD-8) await owner decisions.
- **Production / `main` impact:** NONE. `main` = `origin/main` = `0d9699f`, unchanged and verified. Phase 10 work is local commits on `local/rbac-phase1-8-and-mobile` only (`7f90239` N2, `c665794` N1, plus docs commits). No push, no merge, no PR, no deploy; the deployed Firestore ruleset is unchanged.

**Phase 10 — FINAL DETERMINATION (third BD-3 deep-dive; outcome fixed)**

A third, independent end-to-end Channel Partner lifecycle trace was performed against current source (partner types/constants, `usePartners.ts` suspend/reactivate hooks, `ChannelPartnerDomainService.transitionStatus`, `channelPartnerWorkflow.ts`, `partnerLeadIntegration.ts`, `roleBootstrap.ts`, `firestore.rules` `channel_partners` / `canReadLeadScoped` / `scheme_registrations` blocks, `api/[entity].ts`, route + portal guards) plus a full re-read of every BD-3-relevant passage of BRAIN.md and this plan. **No project-authoritative document establishes the BD-3 action matrix.** The only CP spec material is BRAIN.md §8 and this plan's §15 BD-3 — both explicitly record it as an unresolved owner decision. Confirmed facts:

- `KYC_STATUSES` = `['not_started', 'pending', 'submitted', 'verified', 'rejected']` (5 states). `validatePartnerCanAct` blocks **every state except `verified`** → wiring it verbatim locks out every partner in `not_started` / `pending` / `submitted` (the normal post-approval, pre-KYC-verification onboarding window — BRAIN.md §8.3 state C, documented as fully operational, and protected by §7.7's "every Partner Portal surface currently reachable stays reachable" must-not-regress).
- `PARTNER_STATUSES` = `['pending_approval', 'active', 'suspended', 'inactive']`. `useSuspendPartner` records a free-text `reason` but nothing downstream consumes `status` — no rules helper, no API check, no client gate (re-verified: `channel_partners` rules block reads neither `status` nor `kycStatus`; `canReadLeadScoped` / `scheme_registrations` create/update key on ownership/link, never partner status).
- **"Generate commission" for a suspended partner is genuinely a business call, not a security-obvious block** — a partner who closed a deal *before* suspension has arguably earned that commission; auto-blocking generation could wrongfully deny earned money. This single matrix cell makes the whole matrix owner-dependent even for the otherwise-clear `suspended` column.
- **CP-2 (is KYC advisory or blocking?) is entirely unresolved** — the plan offers only "(a) wire the helper (which blocks all non-verified KYC) / (b) retire it as advisory". Neither is established; §0.4 and §15's intro forbid picking one.
- **Server-authoritative enforcement scope is itself unauthorised** — making any gate real (not UI-only) needs `firestore.rules` reading `channel_partners.status`/`.kycStatus` via a `get()` on every `leads`/`customers`/`projects`/`scheme_registrations` create (4+ rule blocks, §10.4 1000-expression-budget risk needing live emulator verification) **plus** the same gate in `api/[entity].ts` `handleCreate`. That is a substantial rules change the owner has not scoped.

**Outcome: OUTCOME B — Phase 10 is BLOCKED on owner decisions. It is NOT "RBAC READY" and NOT "Phase 10 COMPLETE".** The two irreducible blockers:

1. **BD-3 / CP-1 / CP-2** — the exact suspend/KYC action matrix (see the "PHASE 10 — FINAL STATUS" report §5 for the decision-ready recommended matrix and the six sub-questions). Cannot be resolved from authoritative source without inventing policy or regressing legitimate onboarding states.
2. **BD-5** — the `Management` alias. Any change in any direction alters effective access for any live `Management`-role account; this audit cannot access the production environment to confirm none exist, and `Roles.tsx` permits arbitrary custom role names, so their non-existence cannot be proven from source. Per the AUTH-S2 precedent ("do not remove/repoint a mapping without evidence it's genuinely dead"), left untouched.

**Not blockers to the security posture, but open for §22 audit-trail completeness (no code, no security dimension — current state already equals the recommended safe default):** BD-4 (cases: Director/Manager — no seed change, safe default preserved), BD-6 (Accounts/partners — no grant, safe default preserved), BD-7 (Manager approve — denied, safe default preserved), BD-8 (7 borrowed routes — no real authorization mismatch on any; the underlying collections each enforce scope independently of the route guard).

**Final verification (Phase 10, this determination — code unchanged since the N1/N2 commits, re-run to confirm):**
- `npx tsc --noEmit` — exit 0.
- `npm run build` — exit 0 (`✓ built in ~2m`; only the pre-existing chunk-size notice).
- `npx vitest run --config vitest.api.config.ts` — **388/388 pass, exit 0** (17 files; includes the 18 N1 tests, the AUTH-D10 / GroupAdmin / mass-assignment suites).
- `npx vitest run` (full) — **29 failed files / 65 failed tests / 3777 passed (278 files, 3842 tests)** — the documented Phase 9 baseline (29/65) unchanged; the +1 file / +4 passed vs. the Phase 9 count are the 4 new N2 tests. Zero unexplained regression.
- `npm run test:rules` — **not re-run (would be incomplete on this sandbox — not claimed as a fresh pass).** `firestore.rules` is byte-identical to Phase 9 close (`git diff 7d96f5e HEAD -- firestore.rules` empty; no `*.emulator.test.ts` or emulator config touched by Phase 10). The authoritative result is the Phase 9 CI run **`34216974918`** (GitHub Actions `ubuntu-latest`, 32/32 files, 818/818 tests, exit 0) against a rules file identical to the current one.

**Production / `main` impact:** NONE (re-confirmed). `main` = `origin/main` = `0d9699f`. `git branch -r --contains HEAD` → empty (HEAD on no remote). Local commits only on `local/rbac-phase1-8-and-mobile`. No push, merge, PR, deploy, or ruleset change.

---

### BD-3 / CP-1 / CP-2 — IMPLEMENTATION RECORD (owner-approved 2026-09-09)

- **Status:** IMPLEMENTED. Local commits only on `local/rbac-phase1-8-and-mobile`; `origin/main` untouched at `0d9699f`. No deploy.
- **Approved policy (verbatim from the owner):**

  | Partner state | Portal/login | Existing / in-flight work | New Lead/Customer/Project/Scheme | Commission |
  |---|---|---|---|---|
  | Verified + Active | ALLOW | ALLOW | ALLOW | ALLOW |
  | KYC Pending (`not_started`/`pending`/`submitted`) | ALLOW | ALLOW | ALLOW | ALLOW |
  | KYC Rejected | ALLOW | ALLOW | ALLOW | ALLOW |
  | Suspended | ALLOW | ALLOW | **BLOCK** | preserve legitimate pre-suspension earned commission (nothing destroyed) |
  | Inactive / Terminated | **BLOCK** business access | **BLOCK** | **BLOCK** | **BLOCK** (no new generation) |

  Interpretation: **KYC is advisory** — it never blocks a business action. Only `channel_partners.status` gates. `pending_approval` is treated as non-`active` (not yet operational). A missing `status` field is grandfathered to `active`.
- **Enforcement — every authoritative plane:**
  - **`firestore.rules`** (SDK plane, the boundary): new `partnerCreateEligible()` (ternary-lazy — only a Partner-role writer pays the extra `get`) ANDed into `create` on `leads` / `customers` / `projects`. For `scheme_registrations` (whose create+update block is expression-budget-critical, §10.4 / AUTH-S1b) the gate is `channelPartnerStatusActive(data.partnerId)` **inside `schemeRegPartnerOwnsProject()`** (which has already proved `data.partnerId` is the acting partner's own linked doc — no identity re-walk), and the create + update rules were **restructured to the file's ternary-discriminator shape** (behaviour-identical — same ALLOW/DENY set for every role — but only one role-branch evaluates, which is what makes room for the status `get`). `read` / `update` rules on all four collections are **unchanged** (a suspended partner keeps existing/in-flight work).
  - **REST API** (`api/[entity].ts` `handleCreate`): new `api/_lib/partnerEligibility.ts` `assertApiPartnerCanCreate(db, user, collection)` → 403 `PARTNER_NOT_ELIGIBLE`, run after `requirePermission('create', …)`, for `leads`/`customers`/`projects`/`scheme_registrations`, Partner callers only. READ/UPDATE/DELETE not gated (structurally asserted).
  - **Workflow layer:** `src/lib/partnerEligibility.ts` (new — pure helpers `partnerCanCreateNewRecords` / `partnerCreateBlockReason` / `assertPartnerCanCreate`); `validatePartnerCanAct` (`channelPartnerWorkflow.ts`) **rewritten** to delegate to it (KYC check removed — the pre-Phase-10 `kycStatus !== 'verified'` throw would have locked out every KYC-pending partner); `partnerCreateLead` (asserts for the authenticated partner when its record resolves); `generateCommissionRecord` (skips generation for an `inactive` partner, returns `null` + logs — never touches existing `commission_records`/`settlements`/wallet); `createSchemeRegistration` (asserts before write).
  - **`inactive` full-stop:** `ChannelPartnerDomainService.transitionStatus` — transitioning a partner **to** `inactive` also sets the linked `users/{userId}.status = 'Inactive'` (so `firestore.rules` `actorIsActive()` denies every read/write and `onUserDeactivated` revokes tokens); transitioning **away from** `inactive` reactivates it. Purely additive — `approve`/`suspend`/`reactivate` never involve `inactive`.
  - **Client (defense-in-depth + clear message):** `PartnerCreateLeadModal`, `PartnerCreateCustomerModal`, `PartnerProjects`, `PartnerRegistrationCreateModal` (+ the `PartnerCustomers` / `PartnerProjects` "Add" buttons) — a banner + disabled control + guarded submit via `partnerCreateBlockReason`.
- **Not weakened:** company/group/tenant isolation, ownership visibility (Phase 7), self-escalation, mass-assignment, GroupAdmin/SuperAdmin boundaries — all untouched. The scheme create/update restructures were verified behaviour-identical by case analysis for every role (GroupAdmin / Partner / Manager+TL / Admin+Management / other).
- **Tests:**
  - `src/lib/__tests__/partnerLifecycleEligibility.emulator.test.ts` (NEW, 22 tests) — active/KYC-pending/KYC-rejected partner CAN create lead/customer/project; suspended partner CANNOT create lead/customer/project; suspended partner CAN still read + update an existing lead; inactive partner CANNOT create; non-Partner (Sales/Admin) unaffected; + BD-5 (below). Registered in `vitest.emulator.config.ts`.
  - `api/__tests__/apiPartnerLifecycleEligibility.test.ts` (NEW, 16 tests) — unit `assertApiPartnerCanCreate` (active/KYC-rejected/missing-status → allowed; suspended/inactive/no-link → 403; non-Partner and non-gated collections → not gated) + end-to-end `POST /api/{leads,customers}` (suspended → 403 `PARTNER_NOT_ELIGIBLE`; active → not blocked) + READ-only-scope structural guards.
  - `src/lib/__tests__/partnerEligibility.test.ts` (NEW, ~30 tests) — the pure helpers; `validatePartnerCanAct` source contract (no `kycStatus`); + BD-3 enforcement-point structural coverage (rules `partnerCreateEligible`/`channelPartnerStatusActive`, `partnerLeadIntegration`, `transitionStatus`).
  - `scheme_registrations` writes are **not** emulator-asserted — that block is un-emulator-testable (create+update+fallback coverage summation exceeds 1000 expressions) on the pre-BD-3 rules just as on these, which is why no scheme-registration emulator test has ever existed; BD-3 for scheme is covered structurally + by the workflow tests.
  - Adjacent emulator suites (all 33 files, run in 5 batches — the established §2.1 approach): **840 tests pass, zero regression.** Structural tests that pinned the pre-BD-3/BD-5 rule text were updated to the new (approved) form: `demoSecurityRulesContract`, `phase5OwnershipFieldAudit`, `settingsP03`, `channelPartnerGapRemediation`.

### BD-5 / AUTH-S3 — IMPLEMENTATION RECORD (owner-approved 2026-09-09)

- **Status:** IMPLEMENTED — **RESOLVED (b): `Management` is an intentional `Admin` alias.** Local commits only; `origin/main` untouched. No deploy.
- **Before:** client (`src/lib/permissions.ts`) and REST API (`api/_lib/permissions.ts`) both resolved `management → 'Admin'` (unchanged, already correct). `firestore.rules` had **no** `Management` handling — a `Management`-role user got full Admin in the UI + REST API but only generic company-scoped access at the rules layer (a live client/API↔rules disagreement; the `Management` string matched no `Admin|…` regex and no `== 'Admin'` check).
- **Change (`firestore.rules` only):**
  - `isAdmin()` → `currentUser().role in ['Admin', 'Management']` (inlined, not a helper — one extra list element, `role` evaluated once — because `isAdmin()` is on the file's most budget-marginal hot paths, §10.4).
  - new `roleStringMatches(rawRole, pattern)` → `rawRole == 'Management' ? ('Admin').matches(pattern) : rawRole.matches(pattern)`; `roleMatches()` and `actorRoleMatches()` route through it (passing `role` once). A `Management` actor is tested as the **literal `'Admin'`** against every pattern — so it satisfies exactly the patterns Admin already satisfies, and **is never widened past Admin** (a `'GroupAdmin'`-only pattern can never match).
  - the direct `actor.role == 'Admin'` sites (users update, settings ×2, biometrics ×3, commission-record read) → `actor.role in ['Admin', 'Management']` / `role in ['Admin', 'Management', 'Manager', 'Director']`.
  - `isSuperAdmin()` still keys off the `isSuperAdmin` doc field, never the role — `Management` gains no platform-tier or GroupAdmin capability.
- **Live-account question:** this task has no production Firestore access, and `Roles.tsx` permits arbitrary custom role names, so the count of live `Management`-string accounts cannot be read from source. RESOLVED (b) is the **non-disruptive** answer — it makes the rules layer agree with the *already-deployed* client/API mapping (`→ Admin`), so no live `Management` account's *effective* access changes (they already had full Admin UI + API; they now also get the rules-layer writes an Admin gets, closing the fail-safe gap). A custom role literally named `Management` (with its own seeded grants) is unaffected — the alias only applies when the role string resolves through the compatibility table, not when a real role document exists.
- **Tests:** `src/lib/__tests__/managementAliasParity.test.ts` (NEW) — client `resolveCompatibleRole('Management') === 'Admin'` + `canDo()` parity with `Admin` + the alias table contains no unexpected Admin-resolving key; API structural; `firestore.rules` structural (`isAdmin` in-list, `roleStringMatches`, the direct sites, never GroupAdmin/wider). `src/lib/__tests__/partnerLifecycleEligibility.emulator.test.ts` — a `Management` user reads a same-company `commission_record` and creates a `commission_rule` exactly as `Admin` does; a `Sales` user cannot (control); `Management` cannot reach a cross-company doc (not widened to GroupAdmin). Adjacent emulator suites re-run green (incl. `groupAdminFullGroupAccess` — a budget regression from a first-draft `isAdminRole()` *helper* was caught and fixed by inlining).

### BD-3 + BD-5 — COMBINED VERIFICATION (2026-09-09)

- **`npx tsc --noEmit`** — exit 0.
- **`npm run build`** — exit 0 (`✓ built in ~40s`; only the pre-existing chunk-size notice).
- **`npx vitest run --config vitest.api.config.ts`** — **404 / 404 pass** (18 files; +16 vs. the prior 388 = the new `apiPartnerLifecycleEligibility.test.ts`).
- **`npx vitest run`** (full) — **29 failed files / 65 failed tests / 3813 passed (280 files, 3878 tests)** — the documented Phase 9 baseline **29 / 65 unchanged**; +40 passed / +2 files vs. the prior Phase-10 count are the new `partnerEligibility.test.ts` + `managementAliasParity.test.ts`. **Zero unexplained regression** (the 29/65 are the known brittle source-text UI-parity suite — BRAIN.md §35). Four structural tests that pinned the pre-BD-3/BD-5 rule text (`demoSecurityRulesContract`, `phase5OwnershipFieldAudit`, `settingsP03`, `channelPartnerGapRemediation`) were updated to the new, approved rule form — not to hide a behaviour change, but because the rule text they assert on legitimately changed per the owner decision.
- **`npm run test:rules`** — **not run as one pass locally** (the sandbox cannot complete the 33-suite single-process emulator run — documented §2.1). Run instead as **5 targeted batches** (the established Phase 7 / Phase 9 approach) covering **all 33 emulator suites + the new `partnerLifecycleEligibility.emulator.test.ts`**: batch results 441 + 111 + 124 + 128 + 36 + 22 = **862 tests pass, zero failures.** `firestore.rules` changed substantially in this pass (BD-3 + BD-5), so the authoritative full-suite `npm run test:rules` should be re-run on the capable CI runner (the Phase 9 `security-rules-tests.yml` `pull_request` procedure) before any production consideration — the local batched run is strong evidence but is not the one mandated §20 gate.
- **Git:** local commits on `local/rbac-phase1-8-and-mobile` only. `main` = `origin/main` = `0d9699f`, untouched. Nothing pushed / merged / deployed.

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
| Phase 1 | **Complete (local commit only, not pushed)** | see commit hash in the git history of the local `main` branch — deliberately not pushed to `origin/main` pending an explicit release milestone | 2026-09-05 |
| Phase 2 | **Complete for its mechanical/investigative scope; BD-5 (`Management`) remains explicitly open (local commit only, not pushed)** | see commit hash in the git history of the local `main` branch | 2026-09-05 |
| Phase 3 | **Complete — structural deliverables found pre-existing; verification/propagation-measurement delivered (local commit only, not pushed)** | see commit hash in the git history of the local `main` branch | 2026-09-05 |
| Phase 4 | **Complete for non-BD-gated work; BD-3/BD-4/BD-8 remain explicitly open (local commit only, not pushed)** | see commit hash in the git history of the local `main` branch | 2026-09-05 |
| Phase 5 | **Complete (audit + design, zero rules changes by design — the correct outcome per this phase's own scope); Phase 7 blocked on BD-1/BD-2/BD-9 (local commit only, not pushed)** | see commit hash in the git history of the local `main` branch | 2026-09-05 |
| Phase 6 | **Complete — AUTH-D1 and AUTH-D7 closed; AUTH-D4/D5/D6 re-verified unchanged from Phase 1; new deferred finding AUTH-D10 (local commit only, not pushed)** | see commit hash in the git history of the local `main` branch | 2026-09-05 |
| AUTH-D10 follow-up | **Complete — GroupAdmin false-deny closed on biometric on-behalf-of enrollment (local commit only, not pushed)** | `38f3077` | 2026-09-05 |
| BD-1 / BD-2 resolution | **Complete — both RESOLVED (a), documentation-only; Phase 7's AUTH-C1 scope unblocked, `projects`/AUTH-C4a portion still blocked on open BD-9 (local commit only, not pushed)** | see commit hash in the git history of the local `main` branch | 2026-09-05 |
| BD-9 / AUTH-C4a resolution | **Complete — RESOLVED (a), current `canReadProjectScoped()` behavior confirmed intentional and correct; Phase 7 now fully unblocked on the business-decision front (local commit only, not pushed)** | see commit hash in the git history of the local `main` branch | 2026-09-05 |
| Phase 7 | **COMPLETE — AUTH-C1 (leads `9fd0e80`, customers `e708c4b`), AUTH-C3 (`commission_records`/`settlements` ownership predicate `1916f4f`), AUTH-C4 closed as not-a-defect per BD-9. The other 6 AUTH-C1 collections + `projects` confirmed no-op per BD-1/BD-2/BD-9. Full record + emulator evidence in §18. Local commits only, not pushed; `origin/main` untouched at `0d9699f`. No production deploy.** | `9fd0e80`, `e708c4b`, `9488647`, `1916f4f` | 2026-09-08 |
| Phase 8 | **COMPLETE — GroupAdmin API access + full group-scope plane (`6d5c29b`/`948053e`/`412f756`/`1371030`/`f53cc18`), emulator + real-browser proof (`e6cd9d1`/`86cff5d`/`ae8d86d`/`ffe5ff4`), COUNTER-1 `ef97ae3`. §9/§10 boundary re-verification checklist signed off 2026-09-08 (§18) — every row hand-checked, no drift from Phases 1–7. Local commits only (COUNTER-1's `ef97ae3` was separately deployed pre-task, ruleset `6de72e9c`, PARITY OK); `origin/main` untouched at `0d9699f`.** | `6d5c29b`, `948053e`, `412f756`, `1371030`, `f53cc18`, `e6cd9d1`, `86cff5d`, `ae8d86d`, `ffe5ff4`, `ef97ae3` | 2026-09-08 |
| Phase 9 | **COMPLETE / PASS — full regression gate satisfied against HEAD `0a8cef0`. `npx tsc --noEmit` exit 0; `npm run build` exit 0; `npx vitest run` = the documented pre-existing baseline 29 failed files / 65 failed tests / 3773 passed, zero unexplained deltas (the 29/65 are the known brittle source-text suite, not an RBAC regression); `npm run test:rules` = 32/32 files, 818/818 tests, exit 0, run as the exact unmodified command on GitHub Actions `ubuntu-latest` (workflow run `34216974918`) via a temporary, closed-unmerged PR because the local sandbox cannot complete the full single-process emulator suite — isolated suite runs were diagnostic only and did not substitute for the mandatory gate. §7/§9/§10 baseline re-confirmed: zero unexplained deltas. Phase 0–8 completion remains confirmed. Two originating-phase test-hygiene fixes committed (`0dd36b9`, `0a8cef0`, test-only). Local commits only, not pushed to `origin/main`; `origin/main` untouched at `0d9699f`; no deploy, no merge. Full record in §18.** | `0dd36b9`, `0a8cef0` (test-hygiene); rules gate verified on CI run `34216974918` | 2026-09-08 |
| Phase 10 | **IN PROGRESS — all technical/security work done; BD-4/BD-6/BD-7/BD-8 need only a formal (no-code) owner sign-off.** Fresh independent audits; every previously-CLOSED `AUTH-*` re-verified closed; §7/§9/§10 baseline holds. **N1** (AUTH-C1 REST-API plane — `/api/leads`+`/api/customers` self/team ownership) `c665794`; **N2** (AUTH-D9 — mobile Installations `perms.canEdit`) `7f90239`. **BD-3 / CP-1 / CP-2 RESOLVED + IMPLEMENTED (owner-approved 2026-09-09):** KYC advisory; `status` gates NEW-record creation only — suspended → BLOCK new (existing work + earned commission preserved), inactive → full stop (login deactivated). Enforced at `firestore.rules` (`partnerCreateEligible` / `channelPartnerStatusActive`; scheme create+update rules restructured to the ternary-discriminator shape, behaviour-identical), REST API (`assertApiPartnerCanCreate` → 403), workflow (`validatePartnerCanAct` rewritten; `generateCommissionRecord`; `createSchemeRegistration`; `transitionStatus`→login-deactivation), and the 4 portal create surfaces. **BD-5 / AUTH-S3 RESOLVED (b) + IMPLEMENTED:** `Management` = `Admin` alias; `firestore.rules` now agrees with the (already-correct) client + API mapping — `isAdmin()` / `roleStringMatches()` / direct `role in ['Admin','Management']` sites; never widened past Admin. Verification: `tsc` exit 0; `build` exit 0; API `404/404`; full `vitest` = **29 failed files / 65 failed tests / 3813 passed** (the Phase-9 baseline 29/65 unchanged; +40 passed = new tests; zero regression); `test:rules` run as 5 local batches = **862 tests pass, all 33 suites + the new emulator file** (the mandated single-pass §20 gate should be re-run on the Phase-9 CI runner — `firestore.rules` changed materially). New tests: `partnerLifecycleEligibility.emulator.test.ts` (22), `apiPartnerLifecycleEligibility.test.ts` (16), `partnerEligibility.test.ts`, `managementAliasParity.test.ts`. Records in §18. **NOT yet "Phase 10 COMPLETE / RBAC READY"** — pending (i) the CI `test:rules` re-run and (ii) a formal owner answer on BD-4/BD-6/BD-7/BD-8 (no code either way; current state = the recommended safe default). Local commits only; `origin/main` untouched at `0d9699f`; nothing pushed/merged/deployed. | `7f90239`, `c665794`, + BD-3/BD-5 commits | 2026-09-09 |
