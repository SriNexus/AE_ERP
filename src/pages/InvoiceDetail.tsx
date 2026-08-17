/**
 * InvoiceDetail — Full-page workspace for a single Invoice record
 *
 * Phase 1 — Module #5: Invoices Workspace
 * Spec: 13 tabs, 24 overview fields, 7 Quick Actions
 *
 * Tabs:
 *   Overview (module-specific)
 *   Activity | Notes | Documents | History | Tasks | Permissions
 *   Linked Records | Attachments | Communication
 *   Payments | Tax Details | Ledger
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
  CreditCard,
  Package,
  Receipt,
} from 'lucide-react';
import { getOne, getAll, fmtDate, fmtCurrency } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { usePermissions } from '../lib/permissions';
import { useAppStore } from '../store/useAppStore';
import { queryKeys } from '../lib/queryKeys';
import { cn } from '../utils/cn';
import { PageHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { WorkspaceShell, useWorkspace } from '../components/shared';
import type { TabId } from '../components/shared/WorkspaceTabs';
import { INVOICE_TABS, buildInvoiceQuickActions } from '../features/invoices/utils/workspaceConfig';

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
    Paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    'Partially Paid': 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    Overdue: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    Cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    Refunded: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
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

function PaymentStatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const colorMap: Record<string, string> = {
    Paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    Partial: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    Pending: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
    Overdue: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    Refunded: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
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

// ── Invoice Items Tab Content ──────────────────────────────

function InvoiceItemsTab({ items }: { items?: Array<Record<string, unknown>> }) {
  if (!items || items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-[var(--color-text-muted)]">
        <Package className="h-10 w-10 mb-3 opacity-40" />
        <p className="text-sm font-medium">No invoice items</p>
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

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const qkeys = queryKeys.forCompany(activeCompanyId);

  // ── Data queries ─────────────────────────────────────────
  const invoiceQuery = useQuery({
    queryKey: [...qkeys.invoices, id],
    queryFn: () => getOne(COLLECTIONS.PROFORMA_INVOICES, id || ''),
    enabled: Boolean(id),
    staleTime: 30_000,
  });

  const customersQuery = useQuery({
    queryKey: qkeys.customersAll,
    queryFn: () => getAll(COLLECTIONS.CUSTOMERS),
    staleTime: 60_000,
  });

  const ordersQuery = useQuery({
    queryKey: qkeys.ordersAll,
    queryFn: () => getAll(COLLECTIONS.ORDERS),
    staleTime: 60_000,
  });

  const paymentsQuery = useQuery({
    queryKey: qkeys.payments,
    queryFn: () => getAll(COLLECTIONS.PAYMENTS),
    staleTime: 30_000,
  });

  const dispatchQuery = useQuery({
    queryKey: qkeys.dispatchAll,
    queryFn: () => getAll(COLLECTIONS.DISPATCH),
    staleTime: 30_000,
  });

  const quotationsQuery = useQuery({
    queryKey: qkeys.quotationsAll,
    queryFn: () => getAll(COLLECTIONS.QUOTATIONS),
    staleTime: 60_000,
  });

  const invoice = invoiceQuery.data as any;
  const customers = (customersQuery.data as any[]) || [];
  const orders = (ordersQuery.data as any[]) || [];
  const payments = (paymentsQuery.data as any[]) || [];
  const dispatches = (dispatchQuery.data as any[]) || [];
  const quotations = (quotationsQuery.data as any[]) || [];

  // ── Permissions ──────────────────────────────────────────
  const perms = usePermissions();
  const canEdit = perms.canEdit('invoices');
  const canCreate = perms.canCreate('invoices');

  // ── Workspace state ──────────────────────────────────────
  const workspace = useWorkspace('invoices', id, 'overview');
  const activeTab = workspace.activeTab as TabId;

  // ── Derived data ─────────────────────────────────────────
  const customer = useMemo(() => {
    if (!invoice) return null;
    return customers.find((c: any) => c.id === invoice.customerId) || null;
  }, [invoice, customers]);

  const linkedOrder = useMemo(() => {
    if (!invoice) return null;
    return orders.find((o: any) => o.id === invoice.orderId || o.id === invoice.sourceOrderId) || null;
  }, [invoice, orders]);

  const invoicePayments = useMemo(() => {
    if (!invoice || !payments) return [];
    return payments.filter((p: any) => p.invoiceId === invoice.id || p.orderId === invoice.orderId);
  }, [invoice, payments]);

  const invoiceDispatches = useMemo(() => {
    if (!invoice) return [];
    return dispatches.filter((d: any) => d.orderId === invoice.orderId || d.orderId === invoice.sourceOrderId);
  }, [invoice, dispatches]);

  const quote = useMemo(() => {
    if (!invoice || !quotations) return null;
    return quotations.find((q: any) =>
      q.id === invoice.quotationId ||
      q.convertedOrderId === invoice.orderId ||
      q.convertedOrderId === invoice.sourceOrderId
    ) || null;
  }, [invoice, quotations]);

  const status = String(invoice?.status || 'Draft');
  const paymentStatus = String(invoice?.paymentStatus || 'Pending');
  const invoiceNumber = String(invoice?.invoiceNumber || invoice?.piNumber || invoice?.refNo || invoice?.id || '—');
  const customerName = invoice?.customer ? String(invoice.customer) : (customer?.name ? String(customer.name) : '—');
  const orderId = invoice?.orderId ? String(invoice.orderId) : (invoice?.sourceOrderId ? String(invoice.sourceOrderId) : null);
  const quotationId = invoice?.quotationId ? String(invoice.quotationId) : (quote?.id ? String(quote.id) : null);
  const projectId = invoice?.projectId ? String(invoice.projectId) : (linkedOrder?.projectId ? String(linkedOrder.projectId) : null);
  const caseId = invoice?.caseId ? String(invoice.caseId) : null;
  const total = Number(invoice?.total || 0);
  const subtotal = Number(invoice?.subtotal || 0);
  const taxAmount = Number(invoice?.taxAmount || invoice?.taxTotal || 0);
  const discount = Number(invoice?.discount || 0);
  const paidAmount = Number(invoice?.paidAmount || invoice?.amountPaid || 0);
  const outstandingAmount = Math.max(0, total - paidAmount);
  const gstNumber = invoice?.customerGst || invoice?.gstNumber || invoice?.gst || null;
  const paymentMethod = String(invoice?.paymentMode || invoice?.paymentMethod || '—');

  // ── Quick action handlers ────────────────────────────────
  const handlers = useMemo(() => ({
    onEdit: () => navigate(`/invoices?open=${encodeURIComponent(id || '')}`),
    onRecordPayment: () => navigate(`/payments?create=1&invoiceId=${encodeURIComponent(id || '')}&orderId=${encodeURIComponent(orderId || '')}`),
    onDownloadPdf: () => {
      const win = window.open(`/api/documents/invoices/${encodeURIComponent(id || '')}/pdf`, '_blank');
      if (!win) navigate(`/api/documents/invoices/${encodeURIComponent(id || '')}/pdf`);
    },
    onSend: () => navigate(`/invoices?open=${encodeURIComponent(id || '')}&tab=send`),
    onMarkPaid: () => navigate(`/invoices?open=${encodeURIComponent(id || '')}&tab=payment`),
    onAssignOwner: () => navigate(`/invoices?open=${encodeURIComponent(id || '')}&tab=assign`),
    onCreateTask: () => navigate(`/tasks?create=1&entityType=invoices&entityId=${encodeURIComponent(id || '')}`),
  }), [navigate, id, orderId]);

  const quickActions = useMemo(
    () => buildInvoiceQuickActions({ canEdit, canCreate }, handlers),
    [canEdit, canCreate, handlers],
  );

  const onCaseClick = useCallback(() => {
    if (caseId) navigate(`/cases/${encodeURIComponent(caseId)}`);
  }, [caseId, navigate]);

  // ── Module tab content ───────────────────────────────────
  const moduleTabContent: Partial<Record<TabId, React.ReactNode>> = useMemo(() => ({
    'items-tab': <InvoiceItemsTab items={invoice?.items as Array<Record<string, unknown>> | undefined} />,
  }), [invoice]);

  // ── Loading state ────────────────────────────────────────
  if (invoiceQuery.isLoading) {
    return (
      <div className="flex flex-col h-full animate-fadeIn">
        <PageHeader title="Loading Invoice..." icon={<FileText className="h-5 w-5" />} />
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
  if (!invoice || invoiceQuery.isError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
        <FileText className="h-12 w-12 text-[var(--color-text-muted)] opacity-40" />
        <h2 className="mt-4 text-lg font-semibold">Invoice not found</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {invoiceQuery.isError ? 'Failed to load invoice details.' : 'This invoice does not exist or has been deleted.'}
        </p>
        <Button className="mt-4" variant="outline" onClick={() => navigate('/invoices')}>
          Back to Invoices
        </Button>
      </div>
    );
  }

  // ── Overview section ─────────────────────────────────────
  const overview = (
    <div className="p-6 space-y-6">
      {/* Key Info Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <OverviewField label="Invoice Number" value={invoiceNumber} icon={Hash} />
        <OverviewField label="Invoice Status">
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
        <OverviewField label="Order" icon={FileText}>
          {orderId ? (
            <button
              type="button"
              onClick={() => navigate(`/orders/${encodeURIComponent(orderId)}`)}
              className="text-[var(--color-primary)] hover:underline"
            >
              {orderId} <ChevronRight className="inline h-3 w-3" />
            </button>
          ) : <span className="text-[var(--color-text-disabled)]">—</span>}
        </OverviewField>
        <OverviewField label="Quotation" icon={FileText}>
          {quotationId ? (
            <button
              type="button"
              onClick={() => navigate(`/quotations/${encodeURIComponent(quotationId)}`)}
              className="text-[var(--color-primary)] hover:underline"
            >
              {quotationId} <ChevronRight className="inline h-3 w-3" />
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
        <OverviewField label="Invoice Date" value={fmtDateSafe(invoice.date || invoice.createdAt)} icon={Calendar} />
      </div>

      {/* Dates & Payment Status */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="Due Date" value={fmtDateSafe(invoice.dueDate)} icon={Calendar} />
        <OverviewField label="Payment Status">
          <PaymentStatusBadge status={paymentStatus} />
        </OverviewField>
        <OverviewField label="Payment Method" value={paymentMethod} icon={CreditCard} />
        <OverviewField label="GST Number" value={gstNumber || '—'} icon={Receipt} />
      </div>

      {/* Financial Details */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="Subtotal" value={`₹${subtotal.toLocaleString('en-IN')}`} icon={DollarSign} />
        <OverviewField label="Tax Amount" value={`₹${taxAmount.toLocaleString('en-IN')}`} icon={Percent} />
        <OverviewField label="Discount" value={discount > 0 ? `₹${discount.toLocaleString('en-IN')}` : '—'} icon={Percent} />
        <OverviewField label="Final Amount" icon={DollarSign}>
          <span className="font-bold text-[var(--color-primary)]">₹{total.toLocaleString('en-IN')}</span>
        </OverviewField>
      </div>

      {/* Payment Details */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <OverviewField label="Paid Amount" value={`₹${paidAmount.toLocaleString('en-IN')}`} icon={CreditCard} />
        <OverviewField label="Outstanding Amount" icon={CreditCard}>
          {outstandingAmount > 0 ? (
            <span className="text-[var(--color-danger)] font-semibold">
              ₹{outstandingAmount.toLocaleString('en-IN')}
            </span>
          ) : <span className="text-emerald-600">₹0</span>}
        </OverviewField>
      </div>

      {/* Assignment */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="Assigned Owner" icon={User}>
          {invoice?.assignedToName ? String(invoice.assignedToName) : (invoice?.assignedToId ? String(invoice.assignedToId) : '—')}
        </OverviewField>
        <OverviewField label="Created By" icon={User}>
          {invoice?.createdBy ? String(invoice.createdBy) : '—'}
        </OverviewField>
        <OverviewField label="Approved By" icon={User}>
          {invoice?.approvedBy ? String(invoice.approvedBy) : '—'}
        </OverviewField>
        <OverviewField label="Last Updated" value={fmtDateSafe(invoice.updatedAt || invoice.createdAt)} icon={Clock} />
      </div>

      {/* Linked Dispatch */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <OverviewField label="Linked Dispatch" icon={Package}>
          {invoiceDispatches.length > 0 ? (
            <button
              type="button"
              onClick={() => navigate(`/dispatch?orderId=${encodeURIComponent(orderId || '')}`)}
              className="text-[var(--color-primary)] hover:underline"
            >
              {invoiceDispatches.length} dispatches <ChevronRight className="inline h-3 w-3" />
            </button>
          ) : <span className="text-[var(--color-text-disabled)]">—</span>}
        </OverviewField>
      </div>

      {/* Notes section */}
      {invoice?.notes && (
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Invoice Notes</p>
          <p className="mt-2 text-sm text-[var(--color-text)]">{String(invoice.notes)}</p>
        </div>
      )}

      {/* Related Records Links */}
      <div className="rounded-xl border border-[var(--color-border-subtle)] p-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Links & References</p>
        <div className="mt-3 flex flex-wrap gap-3">
          {customer && (
            <Button variant="outline" size="sm" icon={<User className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/customers/${encodeURIComponent(customer.id)}`)}>
              Customer Profile
            </Button>
          )}
          {orderId && (
            <Button variant="outline" size="sm" icon={<FileText className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/orders/${encodeURIComponent(orderId)}`)}>
              Source Order
            </Button>
          )}
          {quotationId && (
            <Button variant="outline" size="sm" icon={<FileText className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/quotations/${encodeURIComponent(quotationId)}`)}>
              Quotation
            </Button>
          )}
          {projectId && (
            <Button variant="outline" size="sm" icon={<Building2 className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/projects/${encodeURIComponent(projectId)}`)}>
              Project
            </Button>
          )}
          {invoicePayments.length > 0 && (
            <Button variant="outline" size="sm" icon={<CreditCard className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/payments?invoiceId=${encodeURIComponent(id || '')}`)}>
              Payments ({invoicePayments.length})
            </Button>
          )}
          {invoiceDispatches.length > 0 && (
            <Button variant="outline" size="sm" icon={<Package className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/dispatch?orderId=${encodeURIComponent(orderId || '')}`)}>
              Dispatches ({invoiceDispatches.length})
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
        title={`Invoice ${invoiceNumber}`}
        icon={<FileText className="h-5 w-5" />}
        actions={<Button variant="outline" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/invoices')}>Invoices</Button>}
      />

      <WorkspaceShell
        header={{
          name: `Invoice ${invoiceNumber}`,
          status,
          entityId: id || '',
          caseId: caseId ?? undefined,
          onCaseClick,
          createdAt: invoice?.createdAt ? String(invoice.createdAt) : undefined,
          assignedTo: invoice?.assignedToName ? { name: String(invoice.assignedToName) } : undefined,
        }}
        quickActions={{
          actions: quickActions,
          permissions: { canView: true, canCreate, canEdit, canDelete: false },
        }}
        tabs={{
          tabs: INVOICE_TABS,
          activeTab,
          onTabChange: (tabId) => workspace.setActiveTab(tabId as any),
          tabProps: {
            entityId: id || '',
            entityType: 'invoices',
            companyId: activeCompanyId || '',
            record: invoice as Record<string, unknown>,
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
