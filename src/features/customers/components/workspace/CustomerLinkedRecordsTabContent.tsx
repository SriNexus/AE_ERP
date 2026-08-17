/**
 * CustomerLinkedRecordsTabContent — Linked Records section, mounted inside
 * the Center Panel's accordion (CustomerWorkspaceSections.tsx).
 *
 * Premium UX Redesign mission: the old standalone "Linked Records" tab's
 * quick-nav tile row previously preferred fake denormalized count fields on
 * the Customer document itself (order/quotation/project/invoice counts) —
 * none of those fields are ever written anywhere (the Customer Workspace
 * Master Plan §16 explicitly lists denormalized counts as fields that must
 * NOT be created on Customer). The tiles below are now plain navigation
 * links, not pretend metrics. The real, detailed list still comes from
 * UniversalLinkedRecordsTab via WorkspaceTabs' own exported `content()`
 * dispatch — no re-import of the lazy-loaded component, no reimplemented
 * linked-records query (linkedRecordsEngine stays exclusively inside it).
 */
import { Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { content } from '../../../../components/shared/WorkspaceTabs';

// content()'s underlying UniversalLinkedRecordsTab is a React.lazy()
// component with no Suspense boundary of its own — a local one here (instead
// of relying on CustomerWorkspace.tsx's page-level boundary) means a
// first-time lazy load only shows a small in-place "Loading" for THIS
// section, never collapses the whole Center Panel and resets its scroll
// position.
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

function RelatedRecordLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--color-text-secondary)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors"
    >
      {label} <ArrowUpRight className="h-3 w-3" />
    </button>
  );
}

export default function CustomerLinkedRecordsTabContent({ customer, entityId, companyId, caseId, permissions }: Props) {
  const navigate = useNavigate();

  return (
    <div>
      <div className="flex flex-wrap gap-2 pb-3">
        <RelatedRecordLink label="Orders" onClick={() => navigate(`/orders?customerId=${encodeURIComponent(customer.id)}`)} />
        <RelatedRecordLink label="Quotations" onClick={() => navigate(`/quotations?customerId=${encodeURIComponent(customer.id)}`)} />
        <RelatedRecordLink label="Projects" onClick={() => navigate(`/projects?customerId=${encodeURIComponent(customer.id)}`)} />
        <RelatedRecordLink label="Invoices" onClick={() => navigate(`/invoices?customerId=${encodeURIComponent(customer.id)}`)} />
        <RelatedRecordLink label="Installations" onClick={() => navigate(`/installations?customerId=${encodeURIComponent(customer.id)}`)} />
      </div>
      <Suspense fallback={<SectionLoading />}>
        {content('linked_records', undefined, { entityId, entityType: 'customers', companyId, record: customer as Record<string, unknown>, caseId, permissions })}
      </Suspense>
    </div>
  );
}
