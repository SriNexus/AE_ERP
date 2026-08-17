/**
 * QuotationsWorkspace — Full-page workspace for a single Quotation record
 *
 * Phase 1 — Module #4: Quotations Workspace
 * Spec: 13 tabs, 24 overview fields, 7 Quick Actions
 *
 * Tabs:
 *   Overview (module-specific)
 *   Activity | Notes | Documents | History | Tasks | Permissions
 *   Linked Records | Attachments | Communication
 *   Line Items | Revisions | Approvals
 */

import { useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  FileText,
  Calendar,
  User,
  Building2,
  Hash,
  ChevronRight,
  DollarSign,
  Percent,
  Clock,
  ArrowLeft,
  ClipboardList,
  CheckCircle,
  Send,
  RefreshCw,
  Package,
} from 'lucide-react';
import { getOne, getAll, fmtDate, fmtCurrency } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { usePermissions } from '../lib/permissions';
import { useAppStore } from '../store/useAppStore';
import { queryKeys } from '../lib/queryKeys';
import { useSettingsSection } from '../features/settings/hooks/useSettingsSection';
import { normalizeEmailSettings } from '../features/settings/emailRuntime';
import { sendQuotationEmail } from '../features/quotations/utils/quotationEmail';
import { cn } from '../utils/cn';
import { PageHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { WorkspaceShell, useWorkspace } from '../components/shared';
import type { TabId } from '../components/shared/WorkspaceTabs';
import { QUOTATION_TABS, buildQuotationQuickActions } from '../features/quotations/utils/workspaceConfig';
// ── Helpers ────────────────────────────────────────────────

function fmtDateSafe(value: unknown): string {
  if (!value) return '—';
  if (typeof value === 'object' && value && 'toDate' in value && typeof value.toDate === 'function') {
    return fmtDate(value.toDate());
  }
  if (typeof value === 'object' && value && 'seconds' in value) {
    return fmtDate(new Date(Number((value as { seconds: number }).seconds) * 1000));
  }
  return fmtDate(String(value));
}

function fmtCurrencySafe(value: unknown, symbol = '₹'): string {
  const num = Number(value) || 0;
  return fmtCurrency(num, symbol);
}

function OverviewField({ label, value, icon: Icon, children }: {
  label: string;
  value?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3 transition-colors duration-150 hover:border-[var(--color-border)]">
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />}
        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      </div>
      <div className="mt-1 break-words text-sm font-medium text-[var(--color-text)]">
        {children ?? value ?? <span className="text-[var(--color-text-disabled)]">—</span>}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const colorMap: Record<string, string> = {
    Draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800/40 dark:text-slate-300',
    Sent: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    Accepted: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    'Converted to Order': 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
    Rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    Expired: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    Pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  };
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
      colorMap[status] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
    )}>
      {status}
    </span>
  );
}

// ── Line Items Tab Content ─────────────────────────────────

function LineItemsTab({ items }: { items?: Array<Record<string, unknown>> }) {
  if (!items || items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-[var(--color-text-muted)]">
        <Package className="h-10 w-10 mb-3 opacity-40" />
        <p className="text-sm font-medium">No line items</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="overflow-hidden rounded-xl border border-[var(--color-border-subtle)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--color-bg-sunken)]">
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">#</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Product</th>
              <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Qty</th>
              <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Price</th>
              <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Tax %</th>
              <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={idx} className="border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-sunken)]/50">
                <td className="px-4 py-3 text-[var(--color-text-muted)]">{idx + 1}</td>
                <td className="px-4 py-3 font-medium">{String(item.product || item.productName || '—')}</td>
                <td className="px-4 py-3 text-right">{String(item.qty || item.quantity || '0')}</td>
                <td className="px-4 py-3 text-right">₹{Number(item.price || 0).toLocaleString('en-IN')}</td>
                <td className="px-4 py-3 text-right">{item.tax != null ? `${Number(item.tax)}%` : '—'}</td>
                <td className="px-4 py-3 text-right font-semibold">₹{Number(item.total || (Number(item.qty || 0) * Number(item.price || 0))).toLocaleString('en-IN')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────

export default function QuotationsWorkspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const qkeys = queryKeys.forCompany(activeCompanyId);

  // ── Data queries ─────────────────────────────────────────
  const quotationQuery = useQuery({
    queryKey: [...qkeys.quotationsRoot, id],
    queryFn: () => getOne(COLLECTIONS.QUOTATIONS, id || ''),
    enabled: Boolean(id),
    staleTime: 30_000,
  });

  const leadsQuery = useQuery({
    queryKey: qkeys.leadsAll,
    queryFn: () => getAll(COLLECTIONS.LEADS),
    staleTime: 60_000,
  });

  const customersQuery = useQuery({
    queryKey: qkeys.customersAll,
    queryFn: () => getAll(COLLECTIONS.CUSTOMERS),
    staleTime: 60_000,
  });

  const ordersQuery = useQuery({
    queryKey: qkeys.ordersAll,
    queryFn: () => getAll(COLLECTIONS.ORDERS),
    staleTime: 30_000,
  });

  const quote = quotationQuery.data as any;
  const leads = (leadsQuery.data as any[]) || [];
  const customers = (customersQuery.data as any[]) || [];
  const orders = (ordersQuery.data as any[]) || [];

  // ── Permissions ──────────────────────────────────────────
  const perms = usePermissions();
  const canEdit = perms.canEdit('quotations');
  const canCreate = perms.canCreate('quotations');

  // ── Workspace state ──────────────────────────────────────
  const workspace = useWorkspace('quotations', id, 'overview');
  const activeTab = workspace.activeTab as TabId;

  // ── Derived data ─────────────────────────────────────────
  const customer = useMemo(() => {
    if (!quote) return null;
    return customers.find((c: any) => c.id === quote.customerId) || null;
  }, [quote, customers]);

  const lead = useMemo(() => {
    if (!quote) return null;
    return leads.find((l: any) => l.id === quote.leadId || l.id === quote.sourceLeadId) || null;
  }, [quote, leads]);

  const linkedOrder = useMemo(() => {
    if (!quote) return null;
    return orders.find((o: any) => o.id === quote.convertedOrderId) || null;
  }, [quote, orders]);

  const status = String(quote?.status || 'Draft');
  const quoteNumber = String(quote?.quotationNumber || quote?.quoteNumber || quote?.refNo || quote?.id || '—');
  const customerName = quote?.customer ? String(quote.customer) : (customer?.name ? String(customer.name) : '—');
  const leadId = quote?.leadId ? String(quote.leadId) : (quote?.sourceLeadId ? String(quote.sourceLeadId) : null);
  const projectId = quote?.projectId ? String(quote.projectId) : null;
  // engineeringDesignId available for future rendering
  const caseId = quote?.caseId ? String(quote.caseId) : null;
  const total = Number(quote?.total || 0);
  const subtotal = Number(quote?.subtotal || 0);
  const taxTotal = Number(quote?.taxTotal || quote?.taxAmount || 0);
  const discount = Number(quote?.discount || 0);
  const revisionNumber = Number(quote?.revisionNumber || 1);
  const approvalStatus = String(quote?.approvalStatus || (quote?.isApproved ? 'Approved' : 'Pending'));
  const sentStatus = quote?.sentAt ? 'Sent' : (quote?.status === 'Sent' ? 'Sent' : 'Not Sent');
  const customerAcceptance = String(quote?.customerAcceptance || (quote?.status === 'Accepted' ? 'Accepted' : (quote?.status === 'Rejected' ? 'Rejected' : 'Pending')));
  const convertedOrderId = quote?.convertedOrderId ? String(quote.convertedOrderId) : null;
  const leadName = lead?.name ? String(lead.name) : null;

  const company = useAppStore((s) => s.company);
  const emailSettingsQuery = useSettingsSection('email');
  const emailSettings = useMemo(() => normalizeEmailSettings(emailSettingsQuery.data as Record<string, unknown> | undefined), [emailSettingsQuery.data]);

  // ── Quick action handlers ────────────────────────────────
  // The retired popup's '?open=' destinations are gone: project-linked
  // quotations open/convert in their Project Workspace (Stage 3 — Quotation
  // workspace, the migration target); unlinked quotations deep-link the list
  // page's form modal in edit mode. Send Quotation now composes Gmail
  // directly (the same email runtime the popup used — see quotationEmail.ts).
  const handlers = useMemo(() => ({
    onEdit: () => {
      if (quote?.projectId) navigate(`/projects/${encodeURIComponent(String(quote.projectId))}`);
      else navigate(`/quotations?edit=${encodeURIComponent(id || '')}`);
    },
    onConvertToOrder: () => {
      if (quote?.projectId) navigate(`/projects/${encodeURIComponent(String(quote.projectId))}`);
      else navigate(`/orders?create=1&quotationId=${encodeURIComponent(id || '')}`);
    },
    onSend: () => {
      if (quote) sendQuotationEmail(quote, customers, { company, emailSettings });
    },
    onDownloadPdf: () => {
      const win = window.open(`/api/documents/quotations/${encodeURIComponent(id || '')}/pdf`, '_blank');
      if (!win) navigate(`/api/documents/quotations/${encodeURIComponent(id || '')}/pdf`);
    },
    onCreateTask: () => navigate(`/tasks?create=1&entityType=quotations&entityId=${encodeURIComponent(id || '')}`),
  }), [navigate, id, quote, customers, company, emailSettings]);

  const quickActions = useMemo(
    () => buildQuotationQuickActions({ canEdit, canCreate }, handlers),
    [canEdit, canCreate, handlers],
  );

  const onCaseClick = useCallback(() => {
    if (caseId) navigate(`/cases/${encodeURIComponent(caseId)}`);
  }, [caseId, navigate]);

  // ── Module tab content ───────────────────────────────────
  const moduleTabContent: Partial<Record<TabId, React.ReactNode>> = useMemo(() => ({
    'items-tab': <LineItemsTab items={quote?.items as Array<Record<string, unknown>> | undefined} />,
  }), [quote]);

  // ── Loading state ────────────────────────────────────────
  if (quotationQuery.isLoading) {
    return (
      <div className="flex flex-col h-full animate-fadeIn">
        <PageHeader title="Loading Quotation..." icon={<FileText className="h-5 w-5" />} />
        <div className="flex-1 p-6 space-y-4">
          <div className="h-8 w-64 bg-[var(--color-bg-sunken)] rounded-md animate-pulse" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-20 bg-[var(--color-bg-sunken)] rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Error state ──────────────────────────────────────────
  if (!quote || quotationQuery.isError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
        <FileText className="h-12 w-12 text-[var(--color-text-muted)] opacity-40" />
        <h2 className="mt-4 text-lg font-semibold">Quotation not found</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {quotationQuery.isError ? 'Failed to load quotation details.' : 'This quotation does not exist or has been deleted.'}
        </p>
        <Button className="mt-4" variant="outline" onClick={() => navigate('/quotations')}>
          Back to Quotations
        </Button>
      </div>
    );
  }

  // ── Overview section ─────────────────────────────────────
  const overview = (
    <div className="p-6 space-y-6">
      {/* Key Info Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <OverviewField label="Quotation Number" value={quoteNumber} icon={Hash} />
        <OverviewField label="Status">
          <StatusBadge status={status} />
        </OverviewField>
        <OverviewField label="Customer" value={customerName} icon={User} />
        <OverviewField label="Project" icon={Building2}>
          {projectId ? (
            <button
              type="button"
              onClick={() => navigate(`/projects/${encodeURIComponent(projectId)}`)}
              className="text-[var(--color-primary)] hover:underline"
            >
              {projectId} <ChevronRight className="inline h-3 w-3" />
            </button>
          ) : <span className="text-[var(--color-text-disabled)]">—</span>}
        </OverviewField>
        <OverviewField label="Lead" icon={User}>
          {leadId ? (
            <button
              type="button"
              onClick={() => navigate(`/leads/workspace/${encodeURIComponent(leadId)}`)}
              className="text-[var(--color-primary)] hover:underline"
            >
              {leadName || leadId} <ChevronRight className="inline h-3 w-3" />
            </button>
          ) : <span className="text-[var(--color-text-disabled)]">—</span>}
        </OverviewField>
        <OverviewField label="Case ID" icon={Hash}>
          {caseId ? (
            <button
              type="button"
              onClick={() => navigate(`/cases/${encodeURIComponent(caseId)}`)}
              className="font-mono text-[var(--color-primary)] hover:underline"
            >
              {caseId} <ChevronRight className="inline h-3 w-3" />
            </button>
          ) : <span className="text-[var(--color-text-disabled)]">—</span>}
        </OverviewField>
        <OverviewField label="Company" value={quote?.company ? String(quote.company) : '—'} icon={Building2} />
        <OverviewField label="Quotation Date" value={fmtDateSafe(quote.date || quote.createdAt)} icon={Calendar} />
      </div>

      {/* Validity & Revision */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="Valid Until" value={fmtDateSafe(quote.validUntil)} icon={Calendar} />
        <OverviewField label="Revision Number" value={`v${revisionNumber}`} icon={RefreshCw} />
        <OverviewField label="Approval Status" value={approvalStatus} icon={CheckCircle} />
        <OverviewField label="Sent Status" value={sentStatus} icon={Send} />
      </div>

      {/* Financial Details */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="Subtotal" value={`₹${subtotal.toLocaleString('en-IN')}`} icon={DollarSign} />
        <OverviewField label="Tax" value={`₹${taxTotal.toLocaleString('en-IN')}`} icon={Percent} />
        <OverviewField label="Discount" value={discount > 0 ? `₹${discount.toLocaleString('en-IN')}` : '—'} icon={Percent} />
        <OverviewField label="Final Amount" icon={DollarSign}>
          <span className="font-bold text-[var(--color-primary)]">₹{total.toLocaleString('en-IN')}</span>
        </OverviewField>
      </div>

      {/* Status Section */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="Customer Acceptance" value={customerAcceptance} icon={CheckCircle} />
        <OverviewField label="Assigned Owner" icon={User}>
          {quote?.assignedToName ? String(quote.assignedToName) : (quote?.assignedToId ? String(quote.assignedToId) : '—')}
        </OverviewField>
        <OverviewField label="Created By" icon={User}>
          {quote?.createdBy ? String(quote.createdBy) : '—'}
        </OverviewField>
        <OverviewField label="Last Updated" value={fmtDateSafe(quote.updatedAt || quote.createdAt)} icon={Clock} />
      </div>

      {/* Links */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="Source Lead" icon={User}>
          {leadId ? (
            <button
              type="button"
              onClick={() => navigate(`/leads/workspace/${encodeURIComponent(leadId)}`)}
              className="text-[var(--color-primary)] hover:underline"
            >
              {leadName || leadId} <ChevronRight className="inline h-3 w-3" />
            </button>
          ) : <span className="text-[var(--color-text-disabled)]">—</span>}
        </OverviewField>
        <OverviewField label="Expected Conversion Value" value={`₹${total.toLocaleString('en-IN')}`} icon={DollarSign} />
        <OverviewField label="Linked Order" icon={ClipboardList}>
          {convertedOrderId ? (
            <button
              type="button"
              onClick={() => navigate(`/orders/${encodeURIComponent(convertedOrderId)}`)}
              className="text-[var(--color-primary)] hover:underline"
            >
              {convertedOrderId} <ChevronRight className="inline h-3 w-3" />
            </button>
          ) : <span className="text-[var(--color-text-disabled)]">—</span>}
        </OverviewField>
      </div>

      {/* Notes section */}
      {quote?.notes && (
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Quotation Notes</p>
          <p className="mt-2 text-sm text-[var(--color-text)]">{String(quote.notes)}</p>
        </div>
      )}

      {/* Delivery Info */}
      {quote?.terms && (
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Terms & Conditions</p>
          <p className="mt-2 text-sm text-[var(--color-text)] whitespace-pre-wrap">{String(quote.terms)}</p>
        </div>
      )}

      {/* Related Records Links */}
      <div className="rounded-xl border border-[var(--color-border-subtle)] p-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Links & References</p>
        <div className="mt-3 flex flex-wrap gap-3">
          {leadId && (
            <Button variant="outline" size="sm" icon={<User className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/leads/workspace/${encodeURIComponent(leadId)}`)}>
              Source Lead
            </Button>
          )}
          {customer && (
            <Button variant="outline" size="sm" icon={<User className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/customers/${encodeURIComponent(customer.id)}`)}>
              Customer Profile
            </Button>
          )}
          {projectId && (
            <Button variant="outline" size="sm" icon={<Building2 className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/projects/${encodeURIComponent(projectId)}`)}>
              Project
            </Button>
          )}
          {convertedOrderId && (
            <Button variant="outline" size="sm" icon={<ClipboardList className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/orders/${encodeURIComponent(convertedOrderId)}`)}>
              Linked Order
            </Button>
          )}
          {caseId && (
            <Button variant="outline" size="sm" icon={<Hash className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/cases/${encodeURIComponent(caseId)}`)}>
              View Case
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <PageHeader
        title={`Quotation ${quoteNumber}`}
        icon={<FileText className="h-5 w-5" />}
        actions={<Button variant="outline" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/quotations')}>Quotations</Button>}
      />

      <WorkspaceShell
        header={{
          name: `Quotation ${quoteNumber}`,
          status,
          entityId: id || '',
          caseId: caseId ?? undefined,
          onCaseClick,
          createdAt: quote?.createdAt ? String(quote.createdAt) : undefined,
          assignedTo: quote?.assignedToName ? { name: String(quote.assignedToName) } : undefined,
        }}
        quickActions={{
          actions: quickActions,
          permissions: { canView: true, canCreate, canEdit, canDelete: false },
        }}
        tabs={{
          tabs: QUOTATION_TABS,
          activeTab,
          onTabChange: (tabId) => workspace.setActiveTab(tabId as any),
          tabProps: {
            entityId: id || '',
            entityType: 'quotations',
            companyId: activeCompanyId || '',
            record: quote as Record<string, unknown>,
            permissions: { canView: true, canCreate, canEdit, canDelete: false },
            caseId: caseId ?? undefined,
          },
          overview,
          moduleTabContent,
        }}
      />
    </div>
  );
}
