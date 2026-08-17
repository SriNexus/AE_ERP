/**
 * OrdersWorkspace — Full-page workspace for a single Order record
 *
 * Phase 1 — Module #3: Orders Workspace
 * Spec: 13 tabs, 24 overview fields, 7 Quick Actions
 *
 * Tabs:
 *   Overview (module-specific)
 *   Activity | Notes | Documents | History | Tasks | Permissions
 *   Linked Records | Attachments | Communication
 *   Line Items | Payments | Inventory Reservation
 */

import { useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ShoppingCart,
  MapPin,
  Calendar,
  User,
  Building2,
  FileText,
  Package,
  Truck,
  CreditCard,
  Hash,
  Tag,
  ChevronRight,
  DollarSign,
  Percent,
  Warehouse,
  Clock,
  ArrowLeft,
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
import { ORDER_TABS, buildOrderQuickActions } from '../features/orders/utils/workspaceConfig';

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
    Pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    Processing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    Dispatched: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
    Delivered: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    Completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    Cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    'Partial Dispatch': 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
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

export default function OrdersWorkspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const qkeys = queryKeys.forCompany(activeCompanyId);

  // ── Data queries ─────────────────────────────────────────
  const orderQuery = useQuery({
    queryKey: [...qkeys.ordersRoot, id],
    queryFn: () => getOne(COLLECTIONS.ORDERS, id || ''),
    enabled: Boolean(id),
    staleTime: 30_000,
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

  const paymentsQuery = useQuery({
    queryKey: qkeys.payments,
    queryFn: () => getAll(COLLECTIONS.PAYMENTS),
    staleTime: 30_000,
  });

  const dispatchQuery = useQuery({
    queryKey: qkeys.dispatchRoot,
    queryFn: () => getAll(COLLECTIONS.DISPATCH),
    staleTime: 30_000,
  });

  const order = orderQuery.data as any;
  const customers = (customersQuery.data as any[]) || [];
  const invoices = (invoicesQuery.data as any[]) || [];
  const payments = (paymentsQuery.data as any[]) || [];
  const dispatches = (dispatchQuery.data as any[]) || [];

  // ── Permissions ──────────────────────────────────────────
  const perms = usePermissions();
  const canEdit = perms.canEdit('orders');
  const canCreate = perms.canCreate('orders');

  // ── Workspace state ──────────────────────────────────────
  const workspace = useWorkspace('orders', id, 'overview');
  const activeTab = workspace.activeTab as TabId;

  // ── Derived data ─────────────────────────────────────────
  const customer = useMemo(() => {
    if (!order) return null;
    return customers.find((c: any) => c.id === order.customerId) || null;
  }, [order, customers]);

  const orderPayments = useMemo(() => {
    if (!order) return [];
    return payments.filter((p: any) => p.orderId === order.id || p.orderId === order.orderId);
  }, [order, payments]);

  const orderInvoices = useMemo(() => {
    if (!order) return [];
    return invoices.filter((pi: any) => pi.orderId === order.id || pi.sourceOrderId === order.id);
  }, [order, invoices]);

  const orderDispatches = useMemo(() => {
    if (!order) return [];
    return dispatches.filter((d: any) => d.orderId === order.id);
  }, [order, dispatches]);

  const status = String(order?.status || 'Pending');
  const paymentStatus = String(order?.paymentStatus || 'Pending');
  const orderNumber = String(order?.orderNumber || order?.orderNo || order?.id || '—');
  const customerName = order?.customer ? String(order.customer) : (customer?.name ? String(customer.name) : '—');
  const projectId = order?.projectId ? String(order.projectId) : null;
  const quotationId = order?.sourceQuotationId ? String(order.sourceQuotationId) : null;
  const caseId = order?.caseId ? String(order.caseId) : null;
  const total = Number(order?.total || 0);
  const subtotal = Number(order?.subtotal || 0);
  const taxTotal = Number(order?.taxTotal || order?.taxAmount || 0);
  const discount = Number(order?.discount || 0);
  const invoiceStatus = orderInvoices.length > 0
    ? orderInvoices.some((pi: any) => pi.paymentStatus === 'Paid') ? 'Partially Paid'
      : orderInvoices.some((pi: any) => String(pi.paymentStatus || '').toLowerCase() !== 'pending') ? 'Invoiced'
      : 'Issued'
    : 'Not Invoiced';
  const inventoryStatus = (order as any).stockBlocked ? 'Blocked' : 'Unblocked';
  const dispatchStatus = orderDispatches.length > 0
    ? orderDispatches.some((d: any) => d.status === 'Delivered' || d.status === 'Closed') ? 'Delivered'
      : orderDispatches.some((d: any) => d.status === 'Dispatched') ? 'Dispatched'
      : 'In Progress'
    : 'Not Dispatched';
  const paidAmount = Number(order?.paidAmount || order?.amountPaid || 0);
  const balanceAmount = total - paidAmount;
  const warehouseId = order?.warehouseId ? String(order.warehouseId) : null;

  // ── Quick action handlers ────────────────────────────────
  // The retired standalone popup was the old "Edit Order" destination; the
  // edit form now deep-links via ?edit= on the Orders list page (the Project
  // Workspace's Stage 5 — Order workspace is the operational surface). The
  // popup-only "Assign Team" action was dropped with the popup.
  const handlers = useMemo(() => ({
    onEdit: () => navigate(`/orders?edit=${encodeURIComponent(id || '')}`),
    onReserveInventory: () => navigate(`/invoices?create=1&orderId=${encodeURIComponent(id || '')}&reserve=1`),
    onGenerateInvoice: () => navigate(`/invoices?create=1&orderId=${encodeURIComponent(id || '')}`),
    onRecordPayment: () => navigate(`/payments?create=1&orderId=${encodeURIComponent(id || '')}`),
    onScheduleDispatch: () => navigate(`/dispatch?create=1&orderId=${encodeURIComponent(id || '')}`),
    onCreateTask: () => navigate(`/tasks?create=1&entityType=orders&entityId=${encodeURIComponent(id || '')}`),
  }), [navigate, id]);

  const quickActions = useMemo(
    () => buildOrderQuickActions({ canEdit, canCreate }, handlers),
    [canEdit, canCreate, handlers],
  );

  const onCaseClick = useCallback(() => {
    if (caseId) navigate(`/cases/${encodeURIComponent(caseId)}`);
  }, [caseId, navigate]);

  // ── Module tab content ───────────────────────────────────
  const moduleTabContent: Partial<Record<TabId, React.ReactNode>> = useMemo(() => ({
    'line-items': <LineItemsTab items={order?.items as Array<Record<string, unknown>> | undefined} />,
  }), [order]);

  // ── Loading state ────────────────────────────────────────
  if (orderQuery.isLoading) {
    return (
      <div className="flex flex-col h-full animate-fadeIn">
        <PageHeader title="Loading Order..." icon={<ShoppingCart className="h-5 w-5" />} />
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
  if (!order || orderQuery.isError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
        <ShoppingCart className="h-12 w-12 text-[var(--color-text-muted)] opacity-40" />
        <h2 className="mt-4 text-lg font-semibold">Order not found</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {orderQuery.isError ? 'Failed to load order details.' : 'This order does not exist or has been deleted.'}
        </p>
        <Button className="mt-4" variant="outline" onClick={() => navigate('/orders')}>
          Back to Orders
        </Button>
      </div>
    );
  }

  // ── Overview section ─────────────────────────────────────
  const overview = (
    <div className="p-6 space-y-6">
      {/* Key Info Grid — 24 fields total */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <OverviewField label="Order Number" value={orderNumber} icon={Hash} />
        <OverviewField label="Order Status">
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
        <OverviewField label="Company" value={order?.company ? String(order.company) : '—'} icon={Building2} />
        <OverviewField label="Order Date" value={fmtDateSafe(order.date || order.createdAt)} icon={Calendar} />
        <OverviewField label="Order Value" value={`₹${total.toLocaleString('en-IN')}`} icon={DollarSign} />
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

      {/* Financial Status */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="Payment Status">
          <PaymentStatusBadge status={paymentStatus} />
        </OverviewField>
        <OverviewField label="Paid Amount" value={`₹${paidAmount.toLocaleString('en-IN')}`} icon={CreditCard} />
        <OverviewField label="Balance Due" icon={CreditCard}>
          {balanceAmount > 0 ? (
            <span className="text-[var(--color-danger)] font-semibold">
              ₹{balanceAmount.toLocaleString('en-IN')}
            </span>
          ) : <span className="text-emerald-600">₹0</span>}
        </OverviewField>
        <OverviewField label="Invoice Status" value={invoiceStatus} icon={FileText} />
      </div>

      {/* Status & Logistics */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="Inventory Status" icon={Package}>
          <span className={cn(
            'font-semibold',
            inventoryStatus === 'Blocked' ? 'text-emerald-600' : 'text-[var(--color-text-muted)]',
          )}>
            {inventoryStatus}
          </span>
        </OverviewField>
        <OverviewField label="Dispatch Status" value={dispatchStatus} icon={Truck} />
        <OverviewField label="Assigned Team" icon={User}>
          {order?.assignedToName ? String(order.assignedToName) : (order?.assignedToId ? String(order.assignedToId) : '—')}
        </OverviewField>
        <OverviewField label="Created By" icon={User}>
          {order?.createdBy ? String(order.createdBy) : '—'}
        </OverviewField>
      </div>

      {/* Additional Info */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewField label="Approved By" icon={User}>
          {order?.approvedBy ? String(order.approvedBy) : '—'}
        </OverviewField>
        <OverviewField label="Last Updated" value={fmtDateSafe(order.updatedAt || order.createdAt)} icon={Clock} />
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
        <OverviewField label="Warehouse" icon={Warehouse}>
          {warehouseId ? String(warehouseId) : '—'}
        </OverviewField>
      </div>

      {/* Logistics & Notes */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <OverviewField label="Priority" icon={Tag}>
          {order?.priority ? String(order.priority) : '—'}
        </OverviewField>
        <OverviewField label="Expected Dispatch" value={fmtDateSafe(order.deliveryDate || order.expectedDispatch)} icon={Calendar} />
      </div>
      <div className="grid grid-cols-1 gap-3">
        <OverviewField label="Delivery Address" icon={MapPin}>
          {order?.shippingAddress ? String(order.shippingAddress) : '—'}
        </OverviewField>
      </div>

      {/* Notes section */}
      {order?.notes && (
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Order Notes</p>
          <p className="mt-2 text-sm text-[var(--color-text)]">{String(order.notes)}</p>
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
          {orderInvoices.length > 0 && (
            <Button variant="outline" size="sm" icon={<FileText className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/invoices?orderId=${encodeURIComponent(id || '')}`)}>
              Invoices ({orderInvoices.length})
            </Button>
          )}
          {orderPayments.length > 0 && (
            <Button variant="outline" size="sm" icon={<CreditCard className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/payments?orderId=${encodeURIComponent(id || '')}`)}>
              Payments ({orderPayments.length})
            </Button>
          )}
          {orderDispatches.length > 0 && (
            <Button variant="outline" size="sm" icon={<Truck className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/dispatch?orderId=${encodeURIComponent(id || '')}`)}>
              Dispatches ({orderDispatches.length})
            </Button>
          )}
          {projectId && (
            <Button variant="outline" size="sm" icon={<Building2 className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/projects/${encodeURIComponent(projectId)}`)}>
              Project
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
        title={`Order ${orderNumber}`}
        icon={<ShoppingCart className="h-5 w-5" />}
        actions={<Button variant="outline" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/orders')}>Orders</Button>}
      />

      <WorkspaceShell
        header={{
          name: `Order ${orderNumber}`,
          status,
          entityId: id || '',
          caseId: caseId ?? undefined,
          onCaseClick,
          createdAt: order?.createdAt ? String(order.createdAt) : undefined,
          assignedTo: order?.assignedToName ? { name: String(order.assignedToName) } : undefined,
        }}
        quickActions={{
          actions: quickActions,
          permissions: { canView: true, canCreate, canEdit, canDelete: false },
        }}
        tabs={{
          tabs: ORDER_TABS,
          activeTab,
          onTabChange: (tabId) => workspace.setActiveTab(tabId as any),
          tabProps: {
            entityId: id || '',
            entityType: 'orders',
            companyId: activeCompanyId || '',
            record: order as Record<string, unknown>,
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
