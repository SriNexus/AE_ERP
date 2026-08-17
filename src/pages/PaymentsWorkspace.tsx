/**
 * PaymentsWorkspace — Full-page workspace for a single Payment record
 *
 * Phase 1 — Module #6: Payments Workspace
 * Spec: 13 tabs, 24 overview fields, 7 Quick Actions
 *
 * Tabs:
 *   Overview (module-specific)
 *   Activity | Notes | Documents | History | Tasks | Permissions
 *   Linked Records | Attachments | Communication
 *   Payment Allocation | Receipts | Ledger
 */

import { useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CreditCard,
  Calendar,
  User,
  Building2,
  Hash,
  ChevronRight,
  DollarSign,
  Clock,
  ArrowLeft,
  FileText,
  Percent,
  Receipt,
  Truck,
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
import { PAYMENT_TABS, buildPaymentQuickActions } from '../features/payments/utils/workspaceConfig';

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
    Paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    Pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    Partial: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    Refunded: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
    Failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    Cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    Reconciled: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
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

// ── Payment Allocation Tab Content ─────────────────────────

function PaymentAllocationTab({ payment }: { payment?: Record<string, unknown> }) {
  const allocations = (payment as any)?.allocations as Array<Record<string, unknown>> | undefined;

  if (!allocations || allocations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-[var(--color-text-muted)]">
        <DollarSign className="h-10 w-10 mb-3 opacity-40" />
        <p className="text-sm font-medium">No payment allocations</p>
        <p className="text-xs mt-1">This payment has not been allocated to specific invoices.</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="overflow-hidden rounded-xl border border-[var(--color-border-subtle)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--color-bg-sunken)]">
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Invoice</th>
              <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Allocated Amount</th>
              <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Balance After</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Date</th>
            </tr>
          </thead>
          <tbody>
            {allocations.map((alloc, idx) => (
              <tr key={idx} className="border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-sunken)]/50">
                <td className="px-4 py-3">{String(alloc.invoiceId || alloc.reference || '—')}</td>
                <td className="px-4 py-3 text-right font-semibold">{fmtCurrencySafe(alloc.amount)}</td>
                <td className="px-4 py-3 text-right">{fmtCurrencySafe(alloc.balanceAfter)}</td>
                <td className="px-4 py-3">{fmtDateSafe(alloc.date || alloc.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────

export default function PaymentsWorkspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const qkeys = queryKeys.forCompany(activeCompanyId);

  // ── Data queries ─────────────────────────────────────────
  const paymentQuery = useQuery({
    queryKey: [...qkeys.payments, id],
    queryFn: () => getOne(COLLECTIONS.PAYMENTS, id || ''),
    enabled: Boolean(id),
    staleTime: 30_000,
  });

  const ordersQuery = useQuery({
    queryKey: qkeys.ordersAll,
    queryFn: () => getAll(COLLECTIONS.ORDERS),
    staleTime: 60_000,
  });

  const customersQuery = useQuery({
    queryKey: qkeys.customersAll,
    queryFn: () => getAll(COLLECTIONS.CUSTOMERS),
    staleTime: 60_000,
  });

  const invoicesQuery = useQuery({
    queryKey: qkeys.invoices,
    queryFn: () => getAll(COLLECTIONS.PROFORMA_INVOICES),
    staleTime: 30_000,
  });

  const payment = paymentQuery.data as any;
  const orders = (ordersQuery.data as any[]) || [];
  const customers = (customersQuery.data as any[]) || [];
  const invoices = (invoicesQuery.data as any[]) || [];

  // ── Permissions ──────────────────────────────────────────
  const perms = usePermissions();
  const canEdit = perms.canEdit('payments');
  const canCreate = perms.canCreate('payments');

  // ── Workspace state ──────────────────────────────────────
  const workspace = useWorkspace('payments', id, 'overview');
  const activeTab = workspace.activeTab as TabId;

  // ── Derived data ─────────────────────────────────────────
  const customer = useMemo(() => {
    if (!payment) return null;
    return customers.find((c: any) => c.id === payment.customerId) || null;
  }, [payment, customers]);

  const linkedOrder = useMemo(() => {
    if (!payment) return null;
    return orders.find((o: any) => o.id === payment.orderId) || null;
  }, [payment, orders]);

  const linkedInvoice = useMemo(() => {
    if (!payment) return null;
    return invoices.find((pi: any) => pi.id === payment.invoiceId || pi.id === payment.proformaInvoiceId) || null;
  }, [payment, invoices]);

  const status = String(payment?.status || 'Paid');
  const paymentId = String(payment?.id || '—');
  const mode = String(payment?.mode || '—');
  const amount = Number(payment?.amount || 0);
  const gst = Number((payment as any)?.gst || 0);
  const tds = Number((payment as any)?.tds || 0);
  const customerName = payment?.customer ? String(payment.customer) : (customer?.name ? String(customer.name) : '—');
  const orderId = payment?.orderId ? String(payment.orderId) : null;
  const invoiceId = payment?.invoiceId || payment?.proformaInvoiceId ? String(payment.invoiceId || payment.proformaInvoiceId) : null;
  const projectId = payment?.projectId ? String(payment.projectId) : null;
  const caseId = payment?.caseId ? String(payment.caseId) : null;
  const transactionId = (payment as any)?.transactionId ? String((payment as any).transactionId) : null;
  const reference = payment?.reference ? String(payment.reference) : null;
  const quotationId = linkedOrder?.sourceQuotationId ? String(linkedOrder.sourceQuotationId) : null;
  const bank = (payment as any)?.bank ? String((payment as any).bank) : null;
  const reconciliationStatus = (payment as any)?.reconciliationStatus ? String((payment as any).reconciliationStatus) : null;
  const receiptStatus = (payment as any)?.receiptStatus ? String((payment as any).receiptStatus) : null;
  const utrNumber = (payment as any)?.utr || (payment as any)?.utrNumber || reference;

  // ── Quick action handlers ────────────────────────────────
  const handlers = useMemo(() => ({
    onEdit: () => navigate(`/payments?open=${encodeURIComponent(id || '')}`),
    onDownloadReceipt: () => {
      const receiptUrl = (payment as any)?.receiptUrl;
      if (receiptUrl) window.open(receiptUrl, '_blank');
      else navigate(`/payments?open=${encodeURIComponent(id || '')}&tab=receipt`);
    },
    onSendReceipt: () => navigate(`/payments?open=${encodeURIComponent(id || '')}&tab=send`),
    onRefund: () => navigate(`/payments?open=${encodeURIComponent(id || '')}&tab=refund`),
    onMarkReconciled: () => navigate(`/payments?open=${encodeURIComponent(id || '')}&tab=reconcile`),
    onAssignOwner: () => navigate(`/payments?open=${encodeURIComponent(id || '')}&tab=assign`),
    onCreateTask: () => navigate(`/tasks?create=1&entityType=payments&entityId=${encodeURIComponent(id || '')}`),
  }), [navigate, id, payment]);

  const quickActions = useMemo(
    () => buildPaymentQuickActions({ canEdit, canCreate }, handlers),
    [canEdit, canCreate, handlers],
  );

  const onCaseClick = useCallback(() => {
    if (caseId) navigate(`/cases/${encodeURIComponent(caseId)}`);
  }, [caseId, navigate]);

  // ── Module tab content ───────────────────────────────────
  const moduleTabContent: Partial<Record<TabId, React.ReactNode>> = useMemo(() => ({
    'allocations-tab': <PaymentAllocationTab payment={payment} />,
  }), [payment]);

  // ── Loading state ────────────────────────────────────────
  if (paymentQuery.isLoading) {
    return (
      <div className="flex flex-col h-full animate-fadeIn">
        <PageHeader title="Loading Payment..." icon={<CreditCard className="h-5 w-5" />} />
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
  if (!payment || paymentQuery.isError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
        <CreditCard className="h-12 w-12 text-[var(--color-text-muted)] opacity-40" />
        <h2 className="mt-4 text-lg font-semibold">Payment not found</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {paymentQuery.isError ? 'Failed to load payment details.' : 'This payment record does not exist or has been deleted.'}
        </p>
        <Button className="mt-4" variant="outline" onClick={() => navigate('/payments')}>
          Back to Payments
        </Button>
      </div>
    );
  }

  // ── Overview section ─────────────────────────────────────
  const overview = (
    <div className="p-6 space-y-6">
      {/* Key Info Grid — first row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <OverviewField label="Payment Number" value={paymentId} icon={Hash} />
        <OverviewField label="Payment Status">
          <StatusBadge status={status} />
        </OverviewField>
        <OverviewField label="Payment Date" value={fmtDateSafe(payment.date || payment.createdAt)} icon={Calendar} />
        <OverviewField label="Payment Method" value={mode} icon={CreditCard} />
      </div>

      {/* Customer & Links */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="Customer" icon={User}>
          {customer ? (
            <button
              type="button"
              onClick={() => navigate(`/customers/${encodeURIComponent(customer.id)}`)}
              className="text-[var(--color-primary)] hover:underline"
            >
              {customerName} <ChevronRight className="inline h-3 w-3" />
            </button>
          ) : <span>{customerName}</span>}
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
        <OverviewField label="Invoice" icon={FileText}>
          {invoiceId ? (
            <button
              type="button"
              onClick={() => navigate(`/invoices/${encodeURIComponent(invoiceId)}`)}
              className="text-[var(--color-primary)] hover:underline"
            >
              {invoiceId} <ChevronRight className="inline h-3 w-3" />
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
      </div>

      {/* Amount & Financial */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="Amount" icon={DollarSign}>
          <span className="font-bold text-emerald-600 dark:text-emerald-400">
            {fmtCurrencySafe(amount)}
          </span>
        </OverviewField>
        <OverviewField label="GST" value={gst > 0 ? fmtCurrencySafe(gst) : '—'} icon={Percent} />
        <OverviewField label="TDS" value={tds > 0 ? fmtCurrencySafe(tds) : '—'} icon={Percent} />
        <OverviewField label="Company" value={String(payment?.company || '—')} icon={Building2} />
      </div>

      {/* Transaction Details */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="Transaction ID" value={transactionId || '—'} icon={Hash} />
        <OverviewField label="Bank" value={bank || '—'} icon={Building2} />
        <OverviewField label="UTR Number" value={utrNumber || '—'} icon={Hash} />
        <OverviewField label="Reference Number" value={reference || '—'} icon={Hash} />
      </div>

      {/* Status Fields */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="Reconciliation Status" icon={FileText}>
          {reconciliationStatus ? (
            <StatusBadge status={reconciliationStatus} />
          ) : <span className="text-[var(--color-text-disabled)]">—</span>}
        </OverviewField>
        <OverviewField label="Receipt Status" icon={Receipt}>
          {receiptStatus ? (
            <span className="text-[var(--color-text)]">{receiptStatus}</span>
          ) : <span className="text-[var(--color-text-disabled)]">—</span>}
        </OverviewField>
        <OverviewField label="Created By" value={String(payment?.createdBy || '—')} icon={User} />
        <OverviewField label="Approved By" icon={User}>
          {payment?.approvedBy ? String(payment.approvedBy) : '—'}
        </OverviewField>
      </div>

      {/* Additional Info */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="Last Updated" value={fmtDateSafe(payment.updatedAt || payment.createdAt)} icon={Clock} />
        <OverviewField label="Currency" value={String((payment as any)?.currency || 'INR')} icon={DollarSign} />
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
        <OverviewField label="Order Value" value={linkedOrder ? fmtCurrencySafe(linkedOrder.total) : '—'} icon={DollarSign} />
      </div>

      {/* Notes */}
      {payment?.notes && (
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Payment Notes</p>
          <p className="mt-2 text-sm text-[var(--color-text)]">{String(payment.notes)}</p>
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
          {quotationId && (
            <Button variant="outline" size="sm" icon={<FileText className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/quotations/${encodeURIComponent(quotationId)}`)}>
              Source Quotation
            </Button>
          )}
          {orderId && (
            <Button variant="outline" size="sm" icon={<FileText className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/orders/${encodeURIComponent(orderId)}`)}>
              Order Details
            </Button>
          )}
          {invoiceId && (
            <Button variant="outline" size="sm" icon={<FileText className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/invoices/${encodeURIComponent(invoiceId)}`)}>
              Invoice Details
            </Button>
          )}
          {projectId && (
            <Button variant="outline" size="sm" icon={<Building2 className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/projects/${encodeURIComponent(projectId)}`)}>
              Project
            </Button>
          )}
          {orderId && (
            <Button variant="outline" size="sm" icon={<Truck className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/dispatch?orderId=${encodeURIComponent(orderId)}`)}>
              Dispatch Records
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
        title={`Payment ${paymentId}`}
        icon={<CreditCard className="h-5 w-5" />}
        actions={<Button variant="outline" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/payments')}>Payments</Button>}
      />

      <WorkspaceShell
        header={{
          name: `Payment ${paymentId}`,
          status,
          entityId: id || '',
          caseId: caseId ?? undefined,
          onCaseClick,
          createdAt: payment?.createdAt ? String(payment.createdAt) : undefined,
          assignedTo: payment?.assignedToName ? { name: String(payment.assignedToName) } : undefined,
        }}
        quickActions={{
          actions: quickActions,
          permissions: { canView: true, canCreate, canEdit, canDelete: false },
        }}
        tabs={{
          tabs: PAYMENT_TABS,
          activeTab,
          onTabChange: (tabId) => workspace.setActiveTab(tabId as any),
          tabProps: {
            entityId: id || '',
            entityType: 'payments',
            companyId: activeCompanyId || '',
            record: payment as Record<string, unknown>,
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
