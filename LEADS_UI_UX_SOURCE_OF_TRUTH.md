# Neozy CRM Workspace — UI/UX Source of Truth

Derived from the **finalized Leads implementation** (`src/pages/Leads.tsx`,
`src/pages/LeadWorkspace.tsx`, `src/components/mobile/leads/MobileLeadWorkspace.tsx`
and their directly-related components). This is the standard every CRM
workspace (Leads, Customers, and future entities) follows.

Three categories, kept strictly separate:

- **GLOBAL CRM UI STANDARD** — shared presentation every entity inherits.
- **LEAD-SPECIFIC** — Lead lifecycle functionality; not copied elsewhere.
- **CUSTOMER-SPECIFIC** — Customer lifecycle functionality; not copied to Leads.

---

## GLOBAL CRM UI STANDARD

### 1. Platform routing model

| Viewport | Renderer |
| --- | --- |
| ≥ 1024px | Desktop `AppShell` (Sidebar + `TopBar` + `.app-shell__main`, `padding: 1.25rem`) |
| < 1024px | `MobileShell` (`MobileTopBar` + scrolling `<main>` + `MobileBottomNav`) |

- **List pages** are desktop-only components; mobile has its own list component.
- **Details pages** are ONE component used by **both** platforms via the same route
  (`/<entity>/workspace/:id` for Leads). Mobile renders it full-screen.
- `MobileShell.isFullScreenRoute(pathname)` hides `MobileTopBar` + `MobileBottomNav`
  and drops the `<main>` padding for detail-workspace routes, so the page owns the
  entire viewport.

### 2. List page — layout & density

- Root: `flex flex-1 min-h-0 flex-col gap-2 overflow-hidden`, pulled back into
  ~half the shell's outer padding: desktop `-mx-2.5 -mt-2.5`, mobile `-mx-2 -mt-2`.
  Internal control/section spacing is **not** reduced.
- **Hero** (`WorkspaceHero`): entity title + icon + realtime-status dot; NO
  in-page breadcrumb (the global breadcrumb is the only one); `actions` slot on
  the right.
- **Breadcrumb** (`src/components/navigation/Breadcrumbs.tsx`, in `TopBar`,
  `hidden sm:flex`): `Home ▸ <Section> ▸ <Page>`.
  - **Home** → button, navigates to `/`.
  - **Section** (e.g. "Sales") → button, opens a dropdown built from
    `ERP_NAV_ITEMS` (the existing sidebar nav structure, permission-filtered).
  - **Page** → button, navigates/refreshes the list; stays visually active.
- **KPI row**: `grid gap-1.5 sm:grid-cols-2 xl:grid-cols-6` of `PremiumKpi`
  tiles; tapping a tile filters the list and syncs the URL.
- **Actions** (in the hero `actions` slot, `size="sm"`):
  - `Refresh` — `variant="outline"`
  - `Upload CSV` — `variant="secondary"`, `UploadCloud` icon (first-class action,
    same height/radius/typography as the primary button, not a raw utility)
  - `Add <Entity>` — primary, `Plus` icon, gated by `perms.canCreate(...)`
- **Search + Filters** — ONE row inside the table `CardHeader`
  (`flex items-center gap-2 flex-1 min-w-0` search + `flex items-center gap-2
  flex-wrap` filter `Select`s). All controls `h-8`. Wraps only when width truly
  forces it. Active-filter pills + a `Clear` control render below when any
  filter is set.
- **Table** (`Table/Thead/Th/Tbody/Tr/Td` from `components/ui`):
  - Compact rows (`py-3`), `text-[13px]` body, `text-[10px]` uppercase headers.
  - Status shown via `statusBadge(...)`.
  - Row is `role="button"`, click → the details route; clicks on links/buttons
    inside a row are excluded.
  - Right-most column = **View** action: `Button size="xs" variant="outline"`
    with an `Eye` icon → the same details route.
  - Row-selection checkboxes drive a bulk-action bar (Export / Change Status /
    Assign / Delete).
  - Attention rows (e.g. overdue) get a `border-l-[3px]` accent + faint tint.
- **Footer / pagination**: `Pagination` component inside the table card, on a
  `border-t`; `page` / `total` / `perPage` / `onChange` / `onPerPageChange`;
  optional `Load More` when the query has more pages.
- **Mobile list**: a dedicated component (card list, not a table), same hero
  title, same filter surface via `MobileTopBar`'s search/filter sheet, same
  `Pagination`. Tapping a card **navigates** to the shared details route
  (never a modal).

### 3. Details page — layout & density

Full-screen operating screen on **both** platforms:

```
FULL VIEWPORT
├── FIXED HEADER      (shrink-0)
├── SCROLLABLE MIDDLE (flex-1 min-h-0 overflow-y-auto)
└── FIXED FOOTER      (shrink-0)
```

- Root: `flex h-full min-h-0 flex-col gap-2 overflow-hidden p-2
  lg:-m-5 lg:h-[calc(100%+2.5rem)]`.
  Desktop `-m-5` cancels the shell padding and the height grows by `2 × 1.25rem`;
  mobile is a plain full-height flex column inside the chrome-less `MobileShell`.
- **Header** (`shrink-0`, never scrolls): `flex flex-wrap items-center
  gap-x-3 gap-y-2 rounded-xl border … px-4 py-3 sm:gap-4 sm:px-6 sm:py-4`.
  - Avatar (`h-11 w-11 sm:h-12 sm:w-12`), entity name (`break-words text-base
    sm:truncate sm:text-xl`) + status badge, a wrapping row of identity chips
    (primary identifiers always visible; secondary chips `hidden sm:flex`,
    tertiary `hidden lg:flex`).
  - Action group: `w-full flex-wrap sm:w-auto sm:shrink-0`; primary contact
    actions (Call / WhatsApp / Email) preserved on both platforms.
  - Back-to-list button: **desktop only** (`hidden lg:inline-flex`); on mobile
    the full-screen workspace is exited via the OS/browser back gesture and the
    footer's Previous/Next moves through the queue.
  - **Edit Information** action: **mobile only** (`lg:hidden`), top-right of the
    header action area — opens the Information section in edit mode (see below).
    Desktop edits Information from the always-visible left panel's own control.
- **Body**: `flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto
  lg:flex-row lg:gap-2 lg:overflow-hidden`.
  - Desktop → three columns `25% / flex-1 / 19%`. Each column is a rounded
    `overflow-hidden` shell wrapping an inner `lg:overflow-y-auto` layer, so the
    scrollbar is clipped to the rounded rectangle and stays visually contained.
  - Mobile → one column, **one** vertical scroll (this body). Panels are
    natural-height with **no** nested scroll.
  - **Left panel = entity Information.** Desktop: always visible. Mobile:
    `hidden` unless `isEditing` (the header Edit action sets it); shown in edit
    mode above the primary section, and hidden again on Save/Cancel. Uses the
    shared `Input/Select/Textarea` and the entity's existing update service.
  - **Centre panel** = the entity's primary workflow card, then the standardized
    sections in this order: **Notes → Follow-ups → Documents → Activity**.
  - **Right panel** = metrics + **Quick Actions**. Any "recent activity" preview
    here is `hidden lg:block` (desktop only) — on mobile the Activity section is
    the single activity surface.
- **Footer** (`shrink-0`, never scrolls): `flex flex-col gap-2 …
  lg:flex-row lg:flex-wrap lg:items-center lg:gap-3 lg:py-0.5`.
  - Navigation row: **Previous** far-left, **position / progress** centred
    (`flex-1 justify-center`; the progress bar is `hidden min-[420px]:block`),
    **Next** far-right.
  - **Save / Save & Next**: a second row **below** the navigation row on mobile
    (`border-t pt-2`), inline on the right on desktop; shown only when there are
    unsaved staged changes.
- **Save model**:
  - *Staged* (batched by Save / Save & Next): the primary-workflow selections and
    the entity's own field edits, via the entity's workspace-engine reducer +
    persistence helper.
  - *Immediate write* (never re-saved by Save): embedded sub-workflows, Documents,
    assignment/transfer.
- **Guards**: shared `useDirtyNavigation` (anchor-click + popstate interception,
  Save/Discard/Cancel modal) and a multi-user "updated by someone else" conflict
  modal.

### 4. Quick Actions

- **Desktop**: `grid grid-cols-2` (2 × 2), icon-over-label tiles.
- **Mobile**: `grid grid-cols-4` (one evenly-distributed row); `min-w-0`,
  `shrink-0` icons, `text-[10px] leading-tight` labels (wrap, never clipped).
- Actions that reveal an in-page section (e.g. a conversion form) scroll that
  section into view; actions that open a small choice (e.g. reassignment) use a
  `Modal size="sm"`. No action navigates away from the details page.

### 5. Notes (standard behaviour)

- **Purpose**: real, user-entered contextual notes. **Never** a mirror of the
  Activity feed — no call/activity history, timestamps, or operator history.
- **Peek**: latest note snippet + relative time, or an empty-state prompt.
- **Expanded** (`Show all` / `Add note`): a textarea (Cancel / Save Note) and a
  "Previous Notes" list. New notes persist through the entity's existing
  activity-log/notes mechanism (no second notes data model).
- Optional — submitting the primary workflow is never blocked by an empty note.

### 6. Documents (standard behaviour) — **already shared**

`src/components/shared/DocumentManager.tsx` (used by Lead + Customer + Project),
wrapped per-entity by a thin adapter that maps `entity.documents` + legacy slots
into/out of the shared `COLLECTIONS.DOCUMENTS` collection.

- Header wraps on narrow widths (`flex-wrap`); the two actions (`Upload
  Document`, `Capture Photo`) become `w-full` and split 50/50 (`flex-1
  sm:flex-none`) so **both stay fully in-viewport**, collapsed or expanded.
- Master-detail (list + inline preview) stacks vertically below `lg`
  (`flex-col lg:flex-row`); list `w-full min-w-0 lg:max-w-[300px]`.
- Long file names truncate; no horizontal overflow.

### 7. Activity (standard behaviour)

- **Terminology**: this section is called **Activity** (the finalized Leads
  section is currently still titled "Timeline" in-code; the standard name is
  "Activity" and the rename is a pending follow-up — see below).
- Single source of truth for chronological system/user activity on the page.
- **Ordering**: latest → oldest, by the real event timestamp, with a stable
  secondary sort on event id when timestamps tie. Never relies on Firestore
  insertion order.
- **Collapsed**: shows only the latest event (`<desc> · <when> · <operator>`).
- **Expanded**: the complete history, same presentation, same ordering.
- No second activity/history/"communication" card anywhere on the page.

### 8. Section shells — **already shared**

`src/components/shared/WorkspaceSectionCards.tsx`:
- `PeekCard` — always-visible peek + `Show all` expansion (Notes, Follow-ups,
  Activity).
- `CollapsedRow` — one-click collapsed row (Documents).
Used by Lead, Customer, and Project workspace section files.

### 9. Forms (standard behaviour)

- Shared `Input / Select / Textarea` components.
- **Mobile**: one logical field per row — every multi-column grid is
  `grid-cols-1 sm:grid-cols-2` (or stacks entirely); every `<select>` carries
  `min-w-0` so long option text can't blow a track out and get clipped by an
  ancestor `overflow-hidden`.
- Every field visible, reachable, tappable; validation messages visible; submit
  control reachable above the fixed footer (the form lives in the scrollable
  middle, so it scrolls — it never extends under the footer).

### 10. Scroll philosophy

| | Desktop | Mobile |
| --- | --- | --- |
| Details page | 3 independent panel scrolls, each clipped inside its rounded card | ONE vertical scroll (the middle body) |
| Header / footer | last flex rows of a fixed-height `overflow-hidden` column | same — fixed via flexbox, **not** `position: fixed`, so they never overlap content |

The desktop three-panel scroll model is **never** reproduced on mobile.

### 11. Responsive rule

Desktop and Mobile are two **presentations** of the same details experience.
Business logic, data model, hooks, services, permissions and RBAC are shared;
only layout adapts. No `isMobile ? <A/> : <B/>` business branching.

---

## LEAD-SPECIFIC

Not copied to Customer or any other entity:

- **Call Outcome** card — the always-open primary workflow: `Add Call Log` →
  `Connected` / `Not Connected` → sub-outcomes (Interested / Need Follow-up /
  Qualified / Converted / Rejected / Duplicate / Wrong Number, or the
  not-connected reasons). Selected state shows the **complete** outcome
  ("Connected — Interested") with Reset / Change. `Need Follow-up` reveals
  date/time; `Converted` renders the conversion flow inline. Call attempts are
  committed only on Save (`COMMIT_CALL_ATTEMPT`), never on selection.
- **Lead conversion** (`LeadWorkspaceConversionFlow`) — B2B / B2C segmented
  control (stacks on mobile) + the existing `convertLeadToCustomer` service.
  B2B/B2C field grids are `grid-cols-1 sm:grid-cols-2`.
- **Lead transfer** — reassignment ONLY. Opens `Modal size="sm"` with the
  eligible-sales-person radio list (`useLeadsUsers()` filtered by sales roles +
  active + not-deleted); confirm → `LeadDomainService.update({ assignedToId,
  assignedToName, updatedBy })` + `logActivity('Leads', 'Lead Transferred', …)`.
  **Never** changes `status`; **never** dispatches a lifecycle transition.
- **Lead Quick Actions** — Convert / Transfer / Follow-up / Mark Lost.
- **Lead queue** — Previous/Next/Save & Next exclude Converted leads (a
  converted lead has left the Lead lifecycle).
- **Lead KPIs** — Total / New / Follow-up / Converted / Lost / Overdue.
- **Lead scoring / health** (`LeadHealthCard`), overdue-follow-up highlighting.

---

## CUSTOMER-SPECIFIC

Preserved as-is; not forced to look like Lead functionality:

- Customer-only fields — company / GST / PAN / credit limit / payment terms /
  pincode, B2B vs B2C classification.
- **Work on This Customer** primary card — the B2B pipeline
  (`CustomerB2BWorkflowPipeline`: Quotation → Order → Invoice → Payment →
  Dispatch) or the B2C project entry (`CustomerB2CWorkflowCards`).
- **Project Timeline panel** (B2C) — `CustomerProjectTimelinePanel`, the
  read-only stage tracker driven by the real Project stage engine.
- Linked Records / Orders / Quotations / Loan Applications tabs
  (`Customer*TabContent`).
- Customer Quick Actions trigger the same `useCustomerCenterWorkflow` the centre
  panel uses.
- Two-tier save model (Tier A staged field edits via `CustomerWorkspaceEngine`;
  Tier B immediate-write sub-workflows) — unchanged.
- Customer has **no** "graduate and disappear" queue-exclusion (unlike Lead).

---

## STATUS OF SHARED-COMPONENT CONSOLIDATION

| Section | Shared today | Notes |
| --- | --- | --- |
| Section shells (`PeekCard` / `CollapsedRow`) | ✅ `WorkspaceSectionCards.tsx` | Lead + Customer + Project |
| Documents | ✅ `DocumentManager.tsx` | Lead + Customer + Project, via thin adapters |
| Dirty-nav guard | ✅ `useDirtyNavigation.ts` | Lead + Customer |
| Scroll-preservation | ✅ `usePreserveScroll.ts` | — |
| Notes body | ❌ inline per entity | Lead: `NotesCenterPanel`; Customer: inline — pending extraction to one `<Notes entityType… />` |
| Activity body | ❌ inline per entity | Lead: `TimelineCenterPanel`; Customer: `CustomerActivityTabContent` — pending extraction + rename to **Activity** |

**Pending follow-up work** (tracked, not done in the current pass):
1. Rename the Leads "Timeline" section → **Activity** everywhere it is
   user-facing (label only; the underlying activity-log data model is unchanged).
2. Extract **Notes** and **Activity** bodies into single reusable components
   parameterised by entity context, replacing the Lead and Customer inline
   copies.
3. Transform the **Customer List** (`CustomersWorkspace.tsx`) to this list
   standard (breadcrumb, density, CSV Upload button, one-row search/filter,
   table language, View button, pagination).
