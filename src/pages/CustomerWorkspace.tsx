/**
 * CustomerWorkspace — Individual customer workspace page at /customers/:id
 *
 * Phase 1: Header + Top Actions (CustomerWorkspaceHeader). Phase 2: Center
 * Panel embedded workflows (CustomerCenterPanel). Phase 3: a persistent,
 * tab-contextual Left Panel (CustomerWorkspaceLeftPanel). Phase 4: a real
 * Right Panel (CustomerWorkspaceRightPanel — Relationship Health, Quick
 * Actions, Linked Records). Phase 5 (docs/customer-workspace-docs/):
 * the Footer — Previous/Next queue navigation, deferred Customer-field
 * editing (CustomerWorkspaceEngine + CustomerWorkspaceEditor), Save/Save &
 * Next, guarded navigation (shared useDirtyNavigation, also now used by Lead
 * Workspace), and multi-user conflict detection. This completes the
 * Header → Left/Center/Right → Footer architecture (Final UI Cleanup
 * mission removed the KPI bar; Active Orders/Relationship Age moved into
 * the Right Panel's Relationship Health instead — see
 * CustomerRelationshipHealth.tsx).
 *
 * Premium UX Redesign mission: the page-width tab bar this file used to
 * render between the Header and the 3-column body (a retired tab-id config
 * constant — Overview/Documents/Orders/Invoices/Activity/Tasks/Linked
 * Records, driving WorkspaceTabs' `content()` dispatch) is gone. It made the
 * page read as several components stapled together, its "Invoices" tab was
 * dead code (WorkspaceTabs.tsx's `content()` has no case for
 * `invoices-tab`), and several of its cards showed fields that are never
 * written anywhere. The
 * always-open pipeline/snapshot now sits directly in the Center column, with
 * CustomerWorkspaceSections rendering the same underlying content
 * (Documents/Activity/Order History/Linked Records/Tasks) as sectioned
 * cards below it instead of separate tabs — every Universal*Tab component
 * this page used via `content()` is still reused, just from a different
 * mounting point. Second refinement pass: `isEditingCustomer` (below) is now
 * the single shared flag between the Left Panel's Edit toggle and the
 * Footer's Save controls, so the two don't read as independent systems.
 *
 * Two-tier save model (Phase 5, non-negotiable — see the Phase 5 report §2):
 *   Tier A — Customer-owned field edits (name/phone/email/company/gst/pan/
 *     address/city/state/pincode/creditLimit/paymentTerms/notes/assignedTo)
 *     stage into CustomerWorkspaceEngine's `draft` and are written ONLY by
 *     Save/Save & Next, via CustomerWorkspacePersistence.saveCustomerWorkspace
 *     (which reuses updateCustomerProjectionWithPhoneLock unchanged).
 *   Tier B — embedded sub-workflows (Create Quotation/Order/Loan Application/
 *     Project, Schedule Follow-up, Create Task) remain immediate-write,
 *     exactly as Phase 0/2/4 built them. Customer Save never re-saves them.
 * These two states are deliberately NOT merged into one reducer:
 * useCustomerCenterWorkflow.ts (Phase 4, Tier B's "which view" state) and
 * CustomerWorkspaceEngine.tsx (Phase 5, Tier A's draft) stay conceptually
 * separate, coexisting side by side — see the Phase 5 report §4/§15.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { RefreshCw } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { EmptyState } from '../components/shared';
import { usePermissions } from '../lib/permissions';
import { useAppStore, useCurrentUser } from '../store/useAppStore';
import { useCustomers } from '../features/customers/hooks/useCustomers';
import { useCustomerBillingContext } from '../features/customers/hooks/useCustomerBillingContext';
import { mostRecentByDate } from '../features/customers/components/workspace/CustomerWorkspaceKpis';
import { getOne } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { useDirtyNavigation } from '../hooks/useDirtyNavigation';
import CustomerWorkspaceHeader from '../features/customers/components/workspace/CustomerWorkspaceHeader';
import CustomerCenterPanel from '../features/customers/components/workspace/CustomerCenterPanel';
import CustomerWorkspaceLeftPanel from '../features/customers/components/workspace/CustomerWorkspaceLeftPanel';
import CustomerWorkspaceRightPanel from '../features/customers/components/workspace/CustomerWorkspaceRightPanel';
import CustomerWorkspaceFooter from '../features/customers/components/workspace/CustomerWorkspaceFooter';
import CustomerWorkspaceSections from '../features/customers/components/workspace/CustomerWorkspaceSections';
import CustomerProjectTimelinePanel from '../features/customers/components/workspace/CustomerProjectTimelinePanel';
import { useCustomerCenterWorkflow } from '../features/customers/hooks/useCustomerCenterWorkflow';
import { CustomerWorkspaceEngineProvider, useCustomerWorkspaceState } from '../features/customers/components/workspace/CustomerWorkspaceEngine';
import { saveCustomerWorkspace, hasConflict } from '../features/customers/components/workspace/CustomerWorkspacePersistence';

// ── Helper: display name resolver ───────────────────────────
function customerDisplayName(c: any): string {
  return c?.name || c?.fullName || c?.contactPerson || '—';
}

export interface CustomerQueueResult {
  currentIndex: number;
  prevCustomer: any | null;
  nextCustomer: any | null;
}

/** Pure Previous/Next queue derivation — unit-testable without rendering.
 * No exclusion filter (Master Plan §12.1 default — unlike Lead, a Customer
 * has no "graduate and disappear" state to exclude); the queue is exactly
 * the customers list the caller passes in. */
export function resolveCustomerQueue(customers: any[], id: string): CustomerQueueResult {
  const currentIndex = customers.findIndex((c: any) => c.id === id);
  const prevCustomer = currentIndex > 0 ? customers[currentIndex - 1] : null;
  const nextCustomer = currentIndex >= 0 && currentIndex < customers.length - 1 ? customers[currentIndex + 1] : null;
  return { currentIndex, prevCustomer, nextCustomer };
}

function CustomerWorkspaceContent() {
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const perms = usePermissions();
  const user = useCurrentUser();
  const qc = useQueryClient();
  const { data: customers = [], isLoading } = useCustomers();
  const { state: cwState, dispatch: cwDispatch } = useCustomerWorkspaceState();

  const customer = useMemo(() => (customers as any[]).find((c: any) => c.id === id) || null, [id, customers]);
  // Called unconditionally (before the loading/not-found early returns) so
  // hook order stays stable — mirrors useWorkspace's own placement above.
  const centerWorkflow = useCustomerCenterWorkflow(customer);
  // Same query-keyed hook the KPI bar/Center Panel/Right Panel already call
  // (React Query dedups — no extra fetch). B2C Center Panel Restructure
  // mission: "Work on This Customer" always renders for both B2B and B2C —
  // B2C's section now contains ONLY the Project entry (Quotation/Registration
  // cards were removed from it), shown in its create state before a Project
  // exists and its done state (open the record) once one does, keeping the
  // required hierarchy (1. Work on This Customer → 2. Project Timeline →
  // 3. Activity → 4. Linked Records) intact at all times. The only value
  // needed here beyond that is the B2C customer's latest Project, which feeds
  // the always-mounted Project Timeline below.
  const centerBilling = useCustomerBillingContext(customer);
  const centerLatestProject = !centerBilling.isB2B ? mostRecentByDate(centerBilling.projects, 'updatedAt') : null;

  // ── Previous/Next queue — the same customers list Phase 1-4 already use
  // (useCustomers()), no exclusion filter. Unlike Lead (where a Converted
  // lead structurally leaves the processing queue), a Customer has no
  // equivalent "graduate and disappear" state, so the Master Plan's default
  // applies: the queue is exactly the list the operator came from, with no
  // invented "completed" filter (§10/Master Plan §12.1). Note: useCustomers()
  // is a paginated query (usePaginatedCollection) — this queue only spans
  // pages already loaded in this session's cache, an existing, pre-Phase-5
  // constraint inherited from how Phase 1-4 already look up `customer` by
  // id from this same list (see the Phase 5 report §9 for this documented,
  // not-newly-introduced limitation). ──
  const queueCustomers = customers as any[];
  const { currentIndex, prevCustomer, nextCustomer } = useMemo(() => resolveCustomerQueue(queueCustomers, id), [queueCustomers, id]);

  const dirty = cwState.hasUnsaved;
  // ── Multi-user safety: conflict detection (see effect below) ──
  const loadedUpdatedAtRef = useRef<string | null>(null);
  const lastCustomerIdRef = useRef<string | null>(null);

  // ── Shared edit-mode flag (second refinement pass): controls both the
  // Left Panel's Edit/Cancel Editing toggle and whether the Footer shows
  // Save/Save & Next at all — one flag, not two independently-toggled UIs
  // that happen to look related. ──
  const [isEditingCustomer, setIsEditingCustomer] = useState(false);

  // ── Save — Tier A only (§2). Validates, checks conflict, persists via
  // saveCustomerWorkspace (reuses updateCustomerProjectionWithPhoneLock),
  // clears the draft, stays on the current customer. `force` bypasses the
  // conflict check — used only after the operator explicitly picks "Save
  // Anyway" on the conflict modal. ──
  const handleSave = useCallback(async (force = false): Promise<boolean> => {
    if (!customer?.id || cwState.saving) return false;

    if (!perms.canEdit('customers')) {
      toast.error('You do not have permission to edit customers');
      return false;
    }

    if (!force) {
      // `customer` here comes from useCustomers()'s paginated list query
      // (30s staleTime, no live listener) — comparing against it would only
      // ever catch a concurrent edit if that list query happened to have
      // refetched in the meantime, which is not reliable and defeats the
      // purpose of conflict detection (confirmed via runtime testing: two
      // sessions editing the same customer within that window saw no
      // conflict at all, silently overwriting each other). Read the actual
      // current `updatedAt` fresh, right before the check, instead.
      const fresh = await getOne<{ updatedAt?: unknown }>(COLLECTIONS.CUSTOMERS, customer.id);
      if (hasConflict(loadedUpdatedAtRef.current, fresh?.updatedAt)) {
        cwDispatch({ type: 'SET_CONFLICT_PENDING', payload: true });
        return false;
      }
    }

    cwDispatch({ type: 'SET_SAVING', payload: true });
    try {
      const result = await saveCustomerWorkspace(customer, cwState.draft, user, activeCompanyId);
      if (result.changed) {
        qc.invalidateQueries({ queryKey: ['customers'] });
      }
      // This save just became the new baseline — the next save shouldn't
      // flag this operator's own write as a conflict.
      loadedUpdatedAtRef.current = new Date().toISOString();
      cwDispatch({ type: 'MARK_CLEAN' });
      toast.success(result.changed ? 'Saved Successfully' : 'No changes to save');
      return true;
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save changes');
      return false;
    } finally {
      cwDispatch({ type: 'SET_SAVING', payload: false });
    }
  }, [customer, cwState.saving, cwState.draft, user, activeCompanyId, cwDispatch, qc, perms]);

  // ── Save & Next — §9: a no-op save never pretends a save happened; it
  // simply moves to the next customer if one exists. ──
  const handleSaveAndNext = useCallback(async () => {
    if (!cwState.hasUnsaved) {
      if (nextCustomer) navigate(`/customers/${encodeURIComponent(nextCustomer.id)}`);
      return;
    }
    const ok = await handleSave();
    if (ok) {
      if (customer?.id) cwDispatch({ type: 'COMPLETE_CUSTOMER', payload: { customerId: customer.id } });
      if (nextCustomer) navigate(`/customers/${encodeURIComponent(nextCustomer.id)}`);
    }
  }, [cwState.hasUnsaved, handleSave, nextCustomer, navigate, customer, cwDispatch]);

  const handleDiscard = useCallback(() => {
    cwDispatch({ type: 'RESET_WORKSPACE' });
    centerWorkflow.reset();
    setIsEditingCustomer(false);
    toast('Changes Discarded');
  }, [cwDispatch]);

  // Left Panel's "Cancel Editing" — discards the staged draft AND closes the
  // shared edit-mode flag, so the Footer's Save controls disappear along
  // with it (see the file-level comment on isEditingCustomer above).
  const handleCancelEdit = useCallback(() => {
    cwDispatch({ type: 'RESET_WORKSPACE' });
    setIsEditingCustomer(false);
  }, [cwDispatch]);

  // Documents section writes directly via CustomerDomainService.update()
  // (its own primitive, bypassing the Tier A staged draft — same pattern as
  // Lead's own handleDocsSaved) — invalidate so the refreshed document list
  // shows immediately, matching Lead Workspace's behavior.
  const handleDocsSaved = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['customers'] });
  }, [qc]);

  // ── Guarded navigation — shared with Lead Workspace (Phase 5, closes
  // Lead's own Outstanding Item #4) — see src/hooks/useDirtyNavigation.ts. ──
  const {
    pendingNav, requestNavigation, setPendingNav,
    guardSave: handleGuardSave, guardDiscard: handleGuardDiscard, guardCancel: handleGuardCancel,
  } = useDirtyNavigation({ dirty, onSave: handleSave, onDiscard: handleDiscard });

  // ── Per-customer isolation: every customer owns an independent workspace.
  // When the route's id changes, wipe all per-customer state (draft,
  // hasUnsaved, saving, conflictPending, the embedded-workflow view) but
  // preserve the session queue counters. Mirrors Lead's exact reset effect. ──
  useEffect(() => {
    if (lastCustomerIdRef.current === id) return;
    lastCustomerIdRef.current = id;
    cwDispatch({ type: 'RESET_WORKSPACE' });
    centerWorkflow.reset();
    loadedUpdatedAtRef.current = null;
    setPendingNav(null);
    setIsEditingCustomer(false);
    // centerWorkflow/setPendingNav are recreated every render (not memoized
    // by their source hooks) — only `id` should actually retrigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, cwDispatch]);

  // ── Multi-user safety: remember what `updatedAt` looked like the moment
  // this customer's data first became available in this workspace session.
  // Set once per customer (not on every background refetch). ──
  useEffect(() => {
    if (!customer?.id || loadedUpdatedAtRef.current !== null) return;
    loadedUpdatedAtRef.current = customer.updatedAt ? String(customer.updatedAt) : '';
  }, [customer]);

  // ── Browser close / refresh guard when dirty ───────────
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // ── In-app navigation guard: intercept anchor clicks while dirty, and
  // browser back/forward via popstate. Same mechanism as Lead's own guard
  // (both now share useDirtyNavigation's setPendingNav). ──
  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement | null)?.closest?.('a[href]');
      if (!anchor) return;
      const href = anchor.getAttribute('href') || '';
      if (!href.startsWith('/') || anchor.hasAttribute('download') || anchor.getAttribute('target') === '_blank') return;
      e.preventDefault();
      e.stopPropagation();
      setPendingNav(href);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const workspaceUrl = window.location.href;
    const onPopState = () => {
      const target = window.location.pathname + window.location.search;
      window.history.pushState(window.history.state, '', workspaceUrl);
      setPendingNav(target);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [dirty]);

  if (isLoading) {
    return <div className="space-y-4 animate-pulse p-6"><div className="h-10 w-72 rounded-xl bg-[var(--color-bg-sunken)]" /><div className="h-96 rounded-2xl bg-[var(--color-bg-sunken)]" /></div>;
  }

  if (!customer) {
    return <EmptyState title="Customer not found" description="The customer does not exist or is outside your visibility scope." action={<Link to="/customers"><Button variant="outline">Back to Customers</Button></Link>} />;
  }

  const displayName = customerDisplayName(customer);
  const caseId = customer.caseId || customer.linkedCaseId || undefined;
  const sourceLeadId = customer.leadId || customer.sourceLeadId || undefined;
  const canEditCustomer = perms.canEdit('customers');

  const tabPermissions = { canView: true, canCreate: perms.canCreate('customers'), canEdit: canEditCustomer, canDelete: perms.canDelete('customers') };

  return (
    // Compact Workspace & Header mission: matches LeadWorkspace.tsx's own
    // outer wrapper exactly — `-m-5` cancels the shared `.app-shell__main`
    // 1.25rem outer padding on every side (this workspace is a full
    // operating screen, not a centered content page), `p-1` re-adds a 4px
    // safety gutter. Height must be explicitly grown by 2x the cancelled
    // padding because negative margins alone don't expand `h-full`'s fixed
    // pixel height.
    <div className="-m-5 p-2 flex h-full min-h-0 flex-col gap-2 overflow-hidden bg-[var(--color-bg)]" style={{ height: 'calc(100% + 2.5rem)' }}>
      <CustomerWorkspaceHeader
        customer={customer}
        actions={[]}
        onBack={() => requestNavigation('/customers')}
      />

      {/* ── BODY (Left 25% / Center ~56% / Right 19% — Customer + Leads
          Workspace Completion Pass mission: the Right Panel is this
          workspace's finalized source-of-truth surface (width/structure/
          density preserved exactly, unchanged from the Final Customer Module
          Polish mission's 19%) — never resized just to look symmetrical with
          the Left Panel. The Left Panel is NOT a source of truth here, so it
          no longer carries an invented "30:55:20" percentage; it now reuses
          Leads Workspace's own finalized Left Panel width (25%) as its
          anchor instead — both panels hold comparable-density entity-context
          content, so borrowing an already-proven, comfortable width is more
          principled than inventing a new one, and it is NOT the same thing
          as forcing the two workspaces' overall three-column ratios to
          match (Leads is 25/60/15; Customer is 25/56/19 — different right/
          center weighting because each workspace's own source-of-truth side
          is genuinely different). Center is the flex-1 remainder — whatever
          is left over after both fixed sides, not a hardcoded share. ──── */}
      <div className="flex min-h-0 flex-1 gap-2 overflow-hidden">
        {/* Left Panel — permanent (Customer Information + Documents,
            regardless of the active tab — mirrors Lead Workspace's own
            permanent Left Panel). `key={customer.id}` forces a clean remount
            on customer change so no local UI state (e.g. the Edit toggle)
            leaks between customers.

            Left/Center/Right/Header Surface Unification mission: every
            major workspace surface now shares the same rounded-xl/border/
            shadow-sm treatment (previously only single-side border-r/border-l
            flush dividers, no radius, no shadow — the Center's own internal
            cards were the only things that looked "real"). A small gap
            between columns lets the page's own background show through as
            the separator, instead of the surfaces reading as one flat strip. */}
        <div className="w-[25%] shrink-0 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm p-4">
          <CustomerWorkspaceLeftPanel
            key={customer.id}
            customer={customer}
            draft={cwState.draft}
            canEdit={canEditCustomer}
            isEditing={isEditingCustomer}
            onToggleEdit={() => setIsEditingCustomer((v) => !v)}
            onFieldChange={(field, value) => cwDispatch({ type: 'SET_DRAFT_FIELD', payload: { field, value } })}
            onCancelEdit={handleCancelEdit}
          />
        </div>

        {/* Center Panel — Premium UX Redesign mission: the old page-width tab
            bar (Overview/Documents/Orders/Invoices/Activity/Tasks/Linked
            Records, driven by a retired tab-id config constant) is gone. The always-open pipeline/
            snapshot stays exactly where it was; everything else that used to
            be a separate tab (Documents/Activity/Order History/Linked
            Records/Tasks) is now a collapsible accordion section rendered by
            CustomerWorkspaceSections, directly below it, in the same
            scrollable column — no content was dropped, only the old
            "Invoices" tab (confirmed dead — WorkspaceTabs.tsx's content()
            has no case for it) and the fake denormalized-count/KPI tiles
            described in each section's own file comment. */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Suspense fallback={<div className="flex justify-center py-16 text-sm text-[var(--color-text-muted)]">Loading...</div>}>
              <div className="p-4 space-y-4">
                {/* B2C Center Panel Restructure mission: "Work on This
                    Customer" always renders, for both B2B and B2C. B2B's body
                    stays CustomerB2BWorkflowPipeline (Quotation → Order →
                    Invoice → Payment → Dispatch); B2C's is
                    CustomerB2CWorkflowCards — now the single Project entry,
                    shown in its create state before a Project exists and its
                    done state (open the record) once one does.

                    Final Premium UX Refinement Pass: this is the single most
                    important surface on the page, so it gets a deliberately
                    stronger heading treatment (text-sm font-semibold, not the
                    small muted uppercase label used by the secondary
                    accordion sections below), a divider separating the title
                    from the workflow body, a slightly larger radius, and a
                    two-layer shadow for a touch of real depth — restrained,
                    not decorative; no gradients, no glow. */}
                  <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_2px_8px_rgba(0,0,0,0.04)]">
                    <div className="flex items-center justify-between mb-3.5 pb-3 border-b border-[var(--color-border-subtle)]">
                      <h3 className="text-sm font-semibold text-[var(--color-text)]">Work on This Customer</h3>
                    </div>
                    {/* B2B's own body is CustomerB2BWorkflowPipeline (Quotation
                        → Order → Invoice → Payment → Dispatch); B2C's is
                        CustomerB2CWorkflowCards (now the single Project entry
                        — Quotation/Loan Application were removed from this
                        section) — both rendered by CustomerCenterPanel
                        itself. */}
                    <CustomerCenterPanel customer={customer} workflow={centerWorkflow} />
                  </div>

                {/* B2C — one-time project lifecycle: track progress here, the
                    actual work stays in the Project Workspace. Always
                    mounted (never hidden just because a Project doesn't
                    exist yet, or because it does) — its own header owns the
                    "Go to Project Workspace" button once a Project exists. */}
                {!centerBilling.isB2B && (
                  <CustomerProjectTimelinePanel project={centerLatestProject} />
                )}

                {/* Notes — B2B's pipeline card must contain ONLY Quotation →
                    Order → Invoice → Payment → Dispatch. Notes stay visible
                    for B2C, editable via Edit Customer / Add Note. */}
                {!centerBilling.isB2B && customer.notes && (
                  <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
                    <h3 className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">Notes</h3>
                    <p className="text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap">{customer.notes}</p>
                  </div>
                )}

                <CustomerWorkspaceSections
                  customer={customer}
                  isB2B={centerBilling.isB2B}
                  entityId={customer.id}
                  companyId={activeCompanyId}
                  caseId={caseId}
                  permissions={tabPermissions}
                  canEditCustomer={canEditCustomer}
                  onDocsSaved={handleDocsSaved}
                />
              </div>
            </Suspense>
          </div>
        </div>

        {/* Right Panel — Relationship Health / Quick Actions / Recent
            Activity / Linked Records (Phase 4). Quick Actions trigger the
            same centerWorkflow the Center Panel itself uses — no competing
            workflow system. `key={customer.id}` for the same per-customer
            local-state-isolation reason as the Left Panel above. */}
        <div className="w-[19%] shrink-0 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
          <CustomerWorkspaceRightPanel
            key={customer.id}
            customer={customer}
            workflow={centerWorkflow}
            companyId={activeCompanyId}
            sourceLeadId={sourceLeadId}
            onViewSourceLead={sourceLeadId ? () => requestNavigation(`/leads/workspace/${encodeURIComponent(sourceLeadId)}`) : undefined}
          />
        </div>
      </div>

      {/* ── FOOTER — Phase 5 ─────────────────────────────────────── */}
      <CustomerWorkspaceFooter
        onPrevious={() => prevCustomer && requestNavigation(`/customers/${encodeURIComponent(prevCustomer.id)}`)}
        onNext={() => nextCustomer && requestNavigation(`/customers/${encodeURIComponent(nextCustomer.id)}`)}
        hasPrevious={!!prevCustomer}
        hasNext={!!nextCustomer}
        currentPosition={currentIndex >= 0 ? currentIndex + 1 : 0}
        total={queueCustomers.length}
        isEditing={isEditingCustomer}
        hasUnsaved={cwState.hasUnsaved}
        saving={cwState.saving}
        onSave={() => void handleSave()}
        onSaveAndNext={() => void handleSaveAndNext()}
      />

      {/* ── Unsaved Changes guard modal ─────────────────── */}
      <Modal open={!!pendingNav} onClose={handleGuardCancel} title="Unsaved Changes" size="sm">
        <p className="text-sm text-[var(--color-text-secondary)]">
          Your changes have not been saved.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={handleGuardCancel}>Stay</Button>
          <Button variant="danger" size="sm" loading={cwState.saving} disabled={cwState.saving} onClick={() => void handleGuardDiscard()}>
            Discard &amp; Continue
          </Button>
          <Button size="sm" loading={cwState.saving} disabled={cwState.saving} onClick={() => void handleGuardSave()}>
            Save &amp; Continue
          </Button>
        </div>
      </Modal>

      {/* ── Multi-user conflict modal ─────────────────────
          Shown when this customer was changed by someone else since it was
          loaded into this workspace. Never silently overwritten. ── */}
      <Modal open={cwState.conflictPending} onClose={() => cwDispatch({ type: 'SET_CONFLICT_PENDING', payload: false })} title="Customer Was Updated By Someone Else" size="sm">
        <p className="text-sm text-[var(--color-text-secondary)]">
          Another user has saved changes to this customer since you opened it. Saving now would overwrite their update.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => cwDispatch({ type: 'SET_CONFLICT_PENDING', payload: false })}>Cancel</Button>
          <Button
            variant="outline"
            size="sm"
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            onClick={() => {
              cwDispatch({ type: 'SET_CONFLICT_PENDING', payload: false });
              qc.invalidateQueries({ queryKey: ['customers'] });
              cwDispatch({ type: 'RESET_WORKSPACE' });
              centerWorkflow.reset();
              loadedUpdatedAtRef.current = null;
              toast('Reloaded the latest version of this customer');
            }}
          >
            Reload Latest
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={cwState.saving}
            disabled={cwState.saving}
            onClick={() => { cwDispatch({ type: 'SET_CONFLICT_PENDING', payload: false }); void handleSave(true); }}
          >
            Save Anyway
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export default function CustomerWorkspace() {
  return (
    <CustomerWorkspaceEngineProvider>
      <CustomerWorkspaceContent />
    </CustomerWorkspaceEngineProvider>
  );
}
