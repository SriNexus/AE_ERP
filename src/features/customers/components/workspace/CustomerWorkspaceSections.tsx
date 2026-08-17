/**
 * CustomerWorkspaceSections — the Center Panel's secondary customer context,
 * mounted directly below the always-open pipeline/snapshot
 * (CustomerWorkspace.tsx). Deliberately visually quieter than the pipeline
 * above it (smaller type, tighter borders, no stage-card treatment) so the
 * primary workflow stays the dominant thing on the screen.
 *
 * Premium UX Redesign mission, second refinement pass: the first pass
 * replaced the old page-width tab bar with five identical collapsed
 * accordion rows — an improvement over tabs, but still reading as one
 * generic list with no hierarchy of its own. This pass differentiates by
 * actual value:
 *   - Activity and (B2B) Order History are time-sensitive, "what just
 *     happened" information an operator plausibly wants at a glance without
 *     a click — they render as always-visible compact peek cards, with an
 *     inline "Show full ..." expansion for the complete log/list.
 *   - Documents, Linked Records, and Tasks are looked up occasionally, not
 *     glanced at — they stay as one-click collapsed rows.
 * Activity's own duplication with the Right Panel is also resolved here:
 * the Right Panel no longer mounts its own Recent Activity widget (see
 * CustomerWorkspaceRightPanel.tsx) — this peek card, reusing the exact same
 * rightPanel/CustomerRecentActivity.tsx derivation function, is now the
 * single place "what happened recently" lives.
 *
 * Every section still reuses an existing, already-working content component
 * verbatim for its full/expanded view — no data logic was rewritten:
 *   Activity (full)       → CustomerActivityTabContent
 *   Order History (full)  → CustomerOrdersTabContent, B2B only
 *   Documents              → CustomerWorkspaceDocumentsSection (unchanged)
 *   Linked Records         → CustomerLinkedRecordsTabContent
 *   Tasks                  → WorkspaceTabs' own `content('tasks', ...)` dispatch
 */
import { Suspense, useRef, useState } from 'react';
import { FileText, Activity, ShoppingCart, Link2, ListTodo } from 'lucide-react';
import { content } from '../../../../components/shared/WorkspaceTabs';
import { PeekCard, CollapsedRow } from '../../../../components/shared/WorkspaceSectionCards';
import { useCustomerBillingContext } from '../../hooks/useCustomerBillingContext';
import { usePreserveScroll } from '../../../../hooks/usePreserveScroll';
import { mostRecentByDate } from './CustomerWorkspaceKpis';
import { deriveRecentActivity } from './rightPanel/CustomerRecentActivity';
import CustomerWorkspaceDocumentsSection from './CustomerWorkspaceDocumentsSection';
import CustomerActivityTabContent from './CustomerActivityTabContent';
import CustomerOrdersTabContent from './CustomerOrdersTabContent';
import CustomerLinkedRecordsTabContent from './CustomerLinkedRecordsTabContent';
import { fmtCurrency, fmtDate } from '../../../../lib/firestore';

/** Small in-place loading placeholder for a lazy-loaded section's FIRST
 * render only (React.lazy's dynamic import resolves once and is cached for
 * the rest of the session) — deliberately local to whichever row is
 * expanding, never the whole accordion/center panel, so a first-time lazy
 * load can't collapse unrelated content and reset the page's scroll
 * position (see the Tasks row below and the scroll-preservation hook). */
function SectionLoading() {
  return <div className="flex justify-center py-6 text-[11.5px] text-[var(--color-text-muted)]">Loading…</div>;
}

type CollapsedId = 'documents' | 'linked' | 'tasks';

interface Props {
  customer: any;
  isB2B: boolean;
  entityId: string;
  companyId: string;
  caseId?: string;
  permissions: { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean };
  canEditCustomer: boolean;
  onDocsSaved: () => void;
}

function fmtWhen(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diffDays <= 0) return 'today';
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function CustomerWorkspaceSections({
  customer, isB2B, entityId, companyId, caseId, permissions, canEditCustomer, onDocsSaved,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [ordersExpanded, setOrdersExpanded] = useState(false);
  const [openRow, setOpenRow] = useState<CollapsedId | null>(null);
  // Expanding any of these sections must never move the operator's place on
  // the page — see usePreserveScroll's own doc comment for why a first-time
  // lazy load (Activity/Linked Records/Tasks, below) can otherwise reset
  // scroll position even with a locally-scoped Suspense boundary in place.
  const toggleActivity = usePreserveScroll(rootRef, () => setActivityExpanded((v) => !v));
  const toggleOrders = usePreserveScroll(rootRef, () => setOrdersExpanded((v) => !v));
  const toggleRow = usePreserveScroll(rootRef, (id: CollapsedId) => setOpenRow((cur) => (cur === id ? null : id)));

  const { entries: recentActivity, totalCount: activityCount } = deriveRecentActivity(customer, 3);
  const { orders } = useCustomerBillingContext(customer);
  const latestOrder = mostRecentByDate(orders, 'date');
  const docCount = (customer?.documents?.length ?? customer?.attachments?.length) || 0;

  return (
    <div className="space-y-3" ref={rootRef}>
      <p className="px-0.5 text-[9.5px] font-bold uppercase tracking-wider text-[var(--color-text-disabled)]">Customer Context</p>

      <PeekCard
        title="Activity"
        icon={<Activity className="h-3.5 w-3.5" />}
        expanded={activityExpanded}
        onToggleExpand={toggleActivity}
        expandLabel="Show full log"
        expandedContent={<CustomerActivityTabContent customer={customer} entityId={entityId} companyId={companyId} caseId={caseId} permissions={permissions} />}
      >
        {recentActivity.length > 0 ? (
          <div className="space-y-1.5">
            {recentActivity.map((entry: any, idx: number) => (
              <div key={entry.id || idx} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-primary)]" />
                <p className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--color-text-secondary)]">
                  <span className="text-[var(--color-text)] font-medium">{entry.actionLabel || entry.desc || entry.type || 'Activity'}</span>
                  <span className="text-[var(--color-text-muted)]"> · {fmtWhen(entry.date)}</span>
                </p>
              </div>
            ))}
            {activityCount > recentActivity.length && (
              <p className="pl-3.5 text-[10px] text-[var(--color-text-muted)]">+{activityCount - recentActivity.length} more</p>
            )}
          </div>
        ) : (
          <p className="text-[11.5px] text-[var(--color-text-muted)]">No activity recorded yet.</p>
        )}
      </PeekCard>

      {isB2B && (
        <PeekCard
          title="Order History"
          icon={<ShoppingCart className="h-3.5 w-3.5" />}
          expanded={ordersExpanded}
          onToggleExpand={toggleOrders}
          expandLabel={orders.length > 0 ? `Show all ${orders.length}` : 'Show list'}
          expandedContent={<CustomerOrdersTabContent customer={customer} />}
        >
          {latestOrder ? (
            <p className="text-[11.5px] text-[var(--color-text-secondary)]">
              <span className="text-[var(--color-text)] font-medium">{orders.length} order{orders.length === 1 ? '' : 's'}</span> total · most recent {fmtCurrency(latestOrder.total)} on {fmtDate(latestOrder.date)}
            </p>
          ) : (
            <p className="text-[11.5px] text-[var(--color-text-muted)]">No orders recorded yet — repeat business will build up a history here.</p>
          )}
        </PeekCard>
      )}

      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 shadow-sm">
        <CollapsedRow label="Documents" icon={<FileText className="h-3.5 w-3.5" />} meta={docCount ? `${docCount}` : undefined} open={openRow === 'documents'} onToggle={() => toggleRow('documents')}>
          <CustomerWorkspaceDocumentsSection customer={customer} isEditing={canEditCustomer} activeCompanyId={companyId} onSaved={onDocsSaved} />
        </CollapsedRow>

        <CollapsedRow label="Linked Records" icon={<Link2 className="h-3.5 w-3.5" />} open={openRow === 'linked'} onToggle={() => toggleRow('linked')}>
          <CustomerLinkedRecordsTabContent customer={customer} entityId={entityId} companyId={companyId} caseId={caseId} permissions={permissions} />
        </CollapsedRow>

        <CollapsedRow label="Tasks" icon={<ListTodo className="h-3.5 w-3.5" />} open={openRow === 'tasks'} onToggle={() => toggleRow('tasks')}>
          <Suspense fallback={<SectionLoading />}>
            {content('tasks', undefined, { entityId, entityType: 'customers', companyId, record: customer as Record<string, unknown>, caseId, permissions })}
          </Suspense>
        </CollapsedRow>
      </div>
    </div>
  );
}
