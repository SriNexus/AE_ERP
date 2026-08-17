/**
 * CustomerActivityTabContent — Activity section, mounted inside the Center
 * Panel's accordion (CustomerWorkspaceSections.tsx).
 *
 * Premium UX Redesign mission: the old standalone "Activity" tab's "Timeline
 * & Activity" KPI tile row is REMOVED — two of its four fields
 * (`customer.lastOrderDate`/`lastOrder`, `customer.amcActive`) are never
 * written anywhere in this codebase, and the other two (Created At,
 * Assigned To) already appear in the Left Panel/Header, so the row was both
 * partly fake and partly redundant. Reuses WorkspaceTabs' own exported
 * `content()` dispatch to render the real activity log (UniversalActivityTab)
 * directly — no re-import of the lazy-loaded component (it isn't exported
 * directly), no reimplementation of activity-log logic.
 */
import { Suspense } from 'react';
import { content } from '../../../../components/shared/WorkspaceTabs';

// content()'s underlying UniversalActivityTab is a React.lazy() component
// with no Suspense boundary of its own — a local one here (instead of
// relying on CustomerWorkspace.tsx's page-level boundary) means a first-time
// lazy load only shows a small in-place "Loading" for THIS section, never
// collapses the whole Center Panel and resets its scroll position.
function SectionLoading() {
  return <div className="flex justify-center py-6 text-[11.5px] text-[var(--color-text-muted)]">Loading...</div>;
}

interface Props {
  customer: any;
  entityId: string;
  companyId: string;
  caseId?: string;
  permissions: { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean };
}

export default function CustomerActivityTabContent({ customer, entityId, companyId, caseId, permissions }: Props) {
  return (
    <div>
      <Suspense fallback={<SectionLoading />}>
        {content('activity', undefined, { entityId, entityType: 'customers', companyId, record: customer as Record<string, unknown>, caseId, permissions })}
      </Suspense>
    </div>
  );
}
