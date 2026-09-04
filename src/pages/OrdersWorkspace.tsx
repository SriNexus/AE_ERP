/**
 * OrdersWorkspace — Permanent operational workspace for Orders.
 *
 * 3-panel architecture (matching Quotation Workspace):
 *   LEFT   — Customer / Project / Quotation context + Order Summary
 *   CENTER — Order workspace (info, items, pricing, delivery, notes)
 *   RIGHT  — Quick Actions (Edit, Invoice, Payment, Dispatch, Status) + Linked Records
 */
import { Suspense, useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowUpRight, Edit2, Trash2, FileText,
  Phone, Mail, MessageCircle, User, Save, X, Plus, MapPin,
  ChevronDown, Loader2, Package, Clock, ClipboardList,
  Download, Lock, Truck, CreditCard, ShoppingCart,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { EmptyState } from '../components/shared';
import { CollapsedRow } from '../components/shared/WorkspaceSectionCards';
import { usePermissions } from '../lib/permissions';
import { useAppStore, useCurrentUser } from '../store/useAppStore';
import { getOne, getAll, updateDocById, fmtDate, fmtCurrency } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { queryKeys } from '../lib/queryKeys';
import { useUserNameResolver } from '../hooks/useUserNameResolver';
import { ORDER_STATUSES, PAYMENT_STATUSES } from '../config/company';
import { useSalesProducts } from '../features/sales/hooks/useSales';
import { OrderItemsEditor } from '../features/orders/components/OrderItemsEditor';
import { cn } from '../utils/cn';
import type { Customer, Order, ProformaInvoice } from '../types';
import type { ProjectRecord } from '../features/projects/types';

// ── Status badge ──────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  Pending: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600',
  Processing: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-700',
  Confirmed: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-700',
  Dispatched: 'bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-900/40 dark:text-indigo-300 dark:border-indigo-700',
  'Partial Dispatch': 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700',
  Delivered: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700',
  Completed: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700',
  Cancelled: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-300 dark:border-red-700',
};

const PAYMENT_COLORS: Record<string, string> = {
  Paid: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700',
  Partial: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700',
  Pending: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600',
  Overdue: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-300 dark:border-red-700',
  Refunded: 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/40 dark:text-purple-300 dark:border-purple-700',
};

function StatusBadge({ status, colors }: { status: string; colors?: Record<string, string> }) {
  const cls = (colors || STATUS_COLORS)[status] || 'bg-slate-100 text-slate-700 border-slate-300';
  return (
    <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold leading-tight', cls)}>
      {status}
    </span>
  );
}

// ── Left-panel helpers ────────────────────────────────────
function LeftInfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === undefined || value === null || value === '' || value === '—') return null;
  return (
    <div className="grid grid-cols-[100px_1fr] items-start py-1.5 gap-2 border-b border-[var(--color-border-subtle)] last:border-b-0">
      <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] leading-4">{label}</span>
      <span className="text-[11px] font-medium text-[var(--color-text)] break-words leading-4">{value}</span>
    </div>
  );
}

function LeftLinkRow({ label, displayText, href }: { label: string; displayText?: string; href: string }) {
  return (
    <div className="grid grid-cols-[100px_1fr] items-start py-1.5 gap-2 border-b border-[var(--color-border-subtle)] last:border-b-0">
      <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] leading-4">{label}</span>
      <a href={href} className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-primary)] hover:underline leading-4">
        {displayText || label}
        <ArrowUpRight className="h-3 w-3 shrink-0" />
      </a>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-[var(--color-text)] border-b-2 border-[var(--color-primary)] pb-1 mb-1">{children}</h3>;
}

function QuickAction({ icon, label, onClick, disabled, title }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} title={title}
      className="group flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-2.5 text-center transition-all shadow-sm hover:-translate-y-0.5 hover:border-[var(--color-primary-muted)] hover:shadow-md active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus:ring-[var(--color-focus-ring)] disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <span className="text-[var(--color-text-secondary)] transition-colors group-hover:text-[var(--color-primary-text)]">{icon}</span>
      <span className="text-[10px] font-semibold leading-tight text-[var(--color-text-secondary)] transition-colors group-hover:text-[var(--color-primary-text)]">{label}</span>
    </button>
  );
}

function InfoGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0">{children}</div>;
}

function InfoField({ label, value, span }: { label: string; value?: React.ReactNode; span?: boolean }) {
  if (value === undefined || value === null || value === '' || value === '—') return null;
  return (
    <div className={`flex items-baseline justify-between gap-2 py-2 border-b border-[var(--color-border-subtle)] last:border-b-0 ${span ? 'sm:col-span-2' : ''}`}>
      <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] shrink-0">{label}</span>
      <span className="text-[12px] font-medium text-[var(--color-text)] text-right break-words">{value}</span>
    </div>
  );
}

function customerField(c: Record<string, unknown> | null | undefined, keys: string[]): string {
  if (!c) return '';
  for (const k of keys) { const v = String(c[k] || '').trim(); if (v) return v; }
  return '';
}

function fmtDateSafe(v: unknown): string {
  if (!v) return '—';
  if (typeof v === 'object' && v && 'toDate' in v && typeof (v as any).toDate === 'function') return fmtDate((v as any).toDate());
  if (typeof v === 'object' && v && 'seconds' in v) return fmtDate(new Date(Number((v as { seconds: number }).seconds) * 1000));
  return fmtDate(String(v));
}

// ── Main Component ────────────────────────────────────────
export default function OrdersWorkspace() {
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const perms = usePermissions();
  const user = useCurrentUser();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const company = useAppStore((s) => s.company);
  const keys = queryKeys.forCompany(activeCompanyId);
  const resolveUserName = useUserNameResolver();

  // ── Order data
  const orderQuery = useQuery({
    queryKey: [...keys.ordersRoot, id],
    queryFn: () => getOne<Order>(COLLECTIONS.ORDERS, id),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
  const order = orderQuery.data as any;

  // ── Customer data
  const customerQuery = useQuery({
    queryKey: [...keys.customersRoot, 'order-ws', order?.customerId],
    queryFn: () => getOne<Customer>(COLLECTIONS.CUSTOMERS, order!.customerId),
    enabled: Boolean(order?.customerId),
    staleTime: 60_000,
  });
  const customer = customerQuery.data as Customer | undefined;

  // ── Project data (if linked)
  const projectQuery = useQuery({
    queryKey: [...keys.projectsRoot, 'order-ws', order?.projectId],
    queryFn: () => getOne<ProjectRecord>(COLLECTIONS.PROJECTS, order!.projectId),
    enabled: Boolean(order?.projectId),
    staleTime: 60_000,
  });
  const project = projectQuery.data as ProjectRecord | undefined;

  // ── Source quotation
  const quoteQuery = useQuery({
    queryKey: [...keys.quotationsRoot, 'order-ws', order?.sourceQuotationId],
    queryFn: () => getOne<any>(COLLECTIONS.QUOTATIONS, order!.sourceQuotationId),
    enabled: Boolean(order?.sourceQuotationId),
    staleTime: 60_000,
  });
  const sourceQuotation = quoteQuery.data as any;

  // ── All quotations (for customer context)
  const quotationsQuery = useQuery({
    queryKey: keys.quotationsAll,
    queryFn: () => getAll<any>(COLLECTIONS.QUOTATIONS),
    staleTime: 30_000,
  });
  const allQuotations = (quotationsQuery.data as any[]) || [];

  // ── All orders (for customer context)
  const ordersQuery = useQuery({
    queryKey: keys.ordersAll,
    queryFn: () => getAll<any>(COLLECTIONS.ORDERS),
    staleTime: 30_000,
  });
  const allOrders = (ordersQuery.data as any[]) || [];

  // ── Invoices
  const invoicesQuery = useQuery({
    queryKey: keys.invoices,
    queryFn: () => getAll<any>(COLLECTIONS.PROFORMA_INVOICES),
    staleTime: 30_000,
  });
  const allInvoices = (invoicesQuery.data as any[]) || [];

  // ── Dispatches
  const dispatchQuery = useQuery({
    queryKey: keys.dispatchRoot,
    queryFn: () => getAll<any>(COLLECTIONS.DISPATCH),
    staleTime: 30_000,
  });
  const allDispatches = (dispatchQuery.data as any[]) || [];

  // ── Payments
  const paymentsQuery = useQuery({
    queryKey: keys.payments,
    queryFn: () => getAll<any>(COLLECTIONS.PAYMENTS),
    staleTime: 30_000,
  });
  const allPayments = (paymentsQuery.data as any[]) || [];

  // ── Stock reservations (INVENTORY-07)
  const reservationsQuery = useQuery({
    queryKey: ['stock_reservations', 'order', id],
    queryFn: () => getAll<any>(COLLECTIONS.STOCK_RESERVATIONS, []).catch(() => [] as any[]),
    staleTime: 30_000,
    enabled: !!id,
  });
  const orderReservations = useMemo(
    () => ((reservationsQuery.data as any[]) || []).filter((r: any) => r.isDeleted !== true && r.orderId === id),
    [reservationsQuery.data, id],
  );

  const canEdit = perms.canEdit('orders');
  const canDelete = perms.canDelete('orders');
  const canCreate = perms.canCreate('orders');

  // ── Derived data
  const status = String(order?.status || 'Pending');
  const paymentStatus = String(order?.paymentStatus || 'Pending');
  const orderNumber = String(order?.orderNumber || order?.orderNo || id);
  const customerName = order?.customer || customer?.name || '';
  const items = (order?.items as any[]) || [];
  const subtotal = Number(order?.subtotal || 0);
  const taxTotal = Number(order?.taxTotal || order?.taxAmount || 0);
  const discount = Number(order?.discount || 0);
  const total = Number(order?.total || 0);
  const itemCount = items.length;
  const paidAmount = Number(order?.paidAmount || order?.amountPaid || 0);
  const balanceAmount = total - paidAmount;
  const deliveryAddress = String(order?.shippingAddress || '');
  const notes = String(order?.notes || '');
  const orderDate = order?.date || order?.createdAt;
  const deliveryDate = order?.deliveryDate || '';

  // ── Related records
  const orderInvoices = useMemo(() =>
    allInvoices.filter((pi: any) => pi.orderId === order?.id || pi.sourceOrderId === order?.id),
    [allInvoices, order]
  );
  const orderPayments = useMemo(() =>
    allPayments.filter((p: any) => p.orderId === order?.id || p.orderId === order?.orderNumber),
    [allPayments, order]
  );
  const orderDispatches = useMemo(() =>
    allDispatches.filter((d: any) => d.orderId === order?.id),
    [allDispatches, order]
  );

  // ── Customer's other orders (for context)
  const customerOrders = useMemo(() =>
    order?.customerId ? allOrders.filter((o: any) => o.customerId === order.customerId && o.id !== id) : [],
    [allOrders, order, id]
  );

  // ── Status update
  const [statusUpdating, setStatusUpdating] = useState(false);
  const handleStatusChange = useCallback(async (newStatus: string) => {
    if (!order?.id || newStatus === status) return;
    setStatusUpdating(true);
    try {
      await updateDocById(COLLECTIONS.ORDERS, order.id, { status: newStatus, updatedBy: user?.id });
      qc.invalidateQueries({ queryKey: [...keys.ordersRoot, id] });
      qc.invalidateQueries({ queryKey: keys.ordersPaged });
      toast.success(`Status updated to ${newStatus}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update status');
    } finally {
      setStatusUpdating(false);
    }
  }, [order, status, user, qc, keys, id]);

  // ════════════════════════════════════════════════════════════════
  // INLINE EDIT — center panel edit mode with full item editing
  // ════════════════════════════════════════════════════════════════
  const productsQuery = useSalesProducts();
  const products = useMemo(() => (productsQuery.data as any[]) || [], [productsQuery.data]);
  const currencySymbol = company?.currencySymbol || '₹';

  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, any>>({});
  const [editItems, setEditItems] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  // Item calculations
  const editTotals = useMemo(() => {
    let sub = 0;
    let tax = 0;
    editItems.forEach((it: any) => {
      const qty = Number(it.qty) || 0;
      const price = Number(it.price) || 0;
      const lineSub = qty * price;
      const lineTax = lineSub * (Number(it.tax) || 0) / 100;
      sub += lineSub;
      tax += lineTax;
    });
    const discount = Number(editForm.discount) || 0;
    const grandTotal = sub + tax - discount;
    return { subtotal: sub, taxTotal: tax, grandTotal };
  }, [editItems, editForm.discount]);

  function startEdit() {
    if (!order) return;
    setEditForm({
      customer: order.customer || '',
      customerId: order.customerId || '',
      orderType: order.orderType || 'B2B',
      date: order.date || '',
      deliveryDate: order.deliveryDate || '',
      status: order.status || 'Pending',
      paymentStatus: order.paymentStatus || 'Pending',
      paymentMode: order.paymentMode || '',
      discount: String(order.discount || 0),
      notes: order.notes || '',
      shippingAddress: order.shippingAddress || '',
      warehouseId: order.warehouseId || '',
    });
    setEditItems((order.items || []).map((it: any) => ({ ...it })));
    setIsEditing(true);
  }

  function cancelEdit() {
    setIsEditing(false);
    setEditForm({});
    setEditItems([]);
  }

  function addEditItem() {
    setEditItems((prev) => [...prev, { productId: '', product: '', qty: 1, price: 0, tax: 0, unit: 'PCS', total: 0 }]);
  }

  function removeEditItem(idx: number) {
    setEditItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateEditItem(idx: number, key: string, val: any) {
    setEditItems((prev) => prev.map((it, i) => {
      if (i !== idx) return it;
      const updated = { ...it, [key]: val };
      if (key === 'productId' && val) {
        const p = products.find((pr: any) => pr.id === val);
        if (p) {
          updated.product = p.name;
          updated.unit = p.unit || 'PCS';
          updated.price = p.price || 0;
          updated.tax = p.tax || 0;
        }
      }
      updated.total = (Number(updated.qty) || 0) * (Number(updated.price) || 0);
      return updated;
    }));
  }

  async function saveEdit() {
    if (!order?.id) return;
    if (!editForm.customer) return toast.error('Customer is required');
    if (!editItems.length) return toast.error('Add at least one item');
    setSaving(true);
    try {
      const payload = {
        customer: editForm.customer,
        customerId: editForm.customerId,
        orderType: editForm.orderType,
        date: editForm.date,
        deliveryDate: editForm.deliveryDate,
        status: editForm.status,
        paymentStatus: editForm.paymentStatus,
        paymentMode: editForm.paymentMode,
        discount: Number(editForm.discount) || 0,
        notes: editForm.notes,
        shippingAddress: editForm.shippingAddress,
        warehouseId: editForm.warehouseId,
        items: editItems,
        subtotal: editTotals.subtotal,
        taxTotal: editTotals.taxTotal,
        total: editTotals.grandTotal,
        updatedBy: user?.id,
      };
      await updateDocById(COLLECTIONS.ORDERS, order.id, payload);
      await qc.invalidateQueries({ queryKey: [...keys.ordersRoot, id] });
      qc.invalidateQueries({ queryKey: keys.ordersPaged });
      setIsEditing(false);
      setEditForm({});
      setEditItems([]);
      toast.success('Order updated');
    } catch (err: any) {
      toast.error(err.message || 'Failed to update');
    } finally {
      setSaving(false);
    }
  }

  function updateEditField(field: string, value: string) {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  }

  // ── Delete
  const [showDelete, setShowDelete] = useState(false);
  const handleDelete = useCallback(async () => {
    if (!order?.id) return;
    const { softDelete } = await import('../lib/firestore');
    const { COLLECTIONS: COLS } = await import('../lib/firebase');
    await softDelete(COLS.ORDERS, order.id);
    qc.invalidateQueries({ queryKey: keys.ordersPaged });
    toast.success('Order deleted');
    navigate('/orders');
  }, [order, qc, keys, navigate]);

  // ── Mobile collapsed state
  const [mobCtxOpen, setMobCtxOpen] = useState(false);

  // ── Loading
  if (orderQuery.isLoading) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden bg-[var(--color-bg)] p-2 lg:-m-5 lg:h-[calc(100%_+_2.5rem)]">
        <div className="h-10 w-72 animate-pulse rounded-xl bg-[var(--color-bg-sunken)]" />
        <div className="flex min-h-0 flex-1 gap-2">
          <div className="w-[25%] animate-pulse rounded-xl bg-[var(--color-bg-sunken)]" />
          <div className="flex-1 animate-pulse rounded-xl bg-[var(--color-bg-sunken)]" />
          <div className="w-[19%] animate-pulse rounded-xl bg-[var(--color-bg-sunken)]" />
        </div>
      </div>
    );
  }

  if (!order || orderQuery.isError) {
    return (
      <EmptyState
        title="Order not found"
        description="This order does not exist or has been deleted."
        action={<Link to="/orders"><Button variant="outline">Back to Orders</Button></Link>}
      />
    );
  }

  const custPhone = customerField(customer as any, ['phone', 'mobile', 'businessPhone']);
  const custEmail = customerField(customer as any, ['email', 'businessEmail']);
  const custAddress = customerField(customer as any, ['address']);
  const custCity = customerField(customer as any, ['city']);
  const custState = customerField(customer as any, ['state']);
  const custType = customerField(customer as any, ['type']);
  const custCompany = customerField(customer as any, ['company', 'companyName']);
  const custGst = customerField(customer as any, ['gst']);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden bg-[var(--color-bg)] p-2 lg:-m-5 lg:h-[calc(100%_+_2.5rem)]">
      {/* ── HEADER ── */}
      <div className="flex shrink-0 flex-col px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-2 sm:px-6 sm:py-4">
        <button type="button" onClick={() => navigate('/orders')} className="flex items-center gap-1.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors lg:hidden">
          <ArrowLeft className="h-4 w-4" /><span className="text-[11px] font-semibold">Back</span>
        </button>
        <div className="flex flex-1 items-center gap-3 sm:flex-wrap sm:gap-x-3 sm:gap-y-2">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-hover)] text-lg font-bold text-white shadow-sm ring-2 ring-[var(--color-primary-muted)] sm:h-12 sm:w-12">
            {customerName[0]?.toUpperCase() || 'O'}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="min-w-0 break-words text-base font-bold text-[var(--color-text)] sm:truncate sm:text-xl">{customerName || 'Order'}</h1>
              <StatusBadge status={status} />
              <StatusBadge status={paymentStatus} colors={PAYMENT_COLORS} />
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <span className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1"><FileText className="h-3 w-3" />{orderNumber}</span>
              {orderDate && <span className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1"><Clock className="h-3 w-3" />{fmtDateSafe(orderDate)}</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5 sm:shrink-0">
          {custPhone && <a href={`tel:${custPhone}`} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors shadow-sm"><Phone className="h-3.5 w-3.5" /> Call</a>}
          {custPhone && <a href={`https://wa.me/${String(custPhone).replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-emerald-50 hover:text-emerald-700 transition-colors shadow-sm"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</a>}
          {custEmail && <a href={`mailto:${custEmail}`} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-blue-50 hover:text-blue-700 transition-colors shadow-sm"><Mail className="h-3.5 w-3.5" /> Email</a>}
          <button type="button" onClick={() => navigate('/orders')} className="hidden lg:inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors shadow-sm">
            <ArrowLeft className="h-3.5 w-3.5" /> Orders
          </button>
        </div>
      </div>

      {/* ── BODY — 3-column ── */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1.5 lg:flex-row lg:gap-2 lg:overflow-hidden lg:pr-0">

        {/* ══ LEFT PANEL — Customer / Project / Quotation Context ══ */}
        <div className="hidden w-full shrink-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm p-4 lg:block lg:w-[25%] lg:overflow-hidden">
          <div className="lg:h-full lg:overflow-y-auto">
            {/* Customer Information */}
            {customerName && (
              <div className="mb-4">
                <SectionHeading>Customer Information</SectionHeading>
                {order?.customerId ? (
                  <LeftLinkRow label="Customer" displayText={customerName} href={`/customers/${encodeURIComponent(order.customerId)}`} />
                ) : (
                  <LeftInfoRow label="Name" value={customerName} />
                )}
                {custType && <LeftInfoRow label="Type" value={custType} />}
                {custCompany && <LeftInfoRow label="Company" value={custCompany} />}
                {custPhone && <LeftInfoRow label="Phone" value={custPhone} />}
                {custEmail && <LeftInfoRow label="Email" value={custEmail} />}
                {(custAddress || custCity) && <LeftInfoRow label="Address" value={[custAddress, [custCity, custState].filter(Boolean).join(', ')].filter(Boolean).join(', ') || undefined} />}
                {custGst && <LeftInfoRow label="GST" value={custGst} />}
              </div>
            )}

            {/* Project link (if exists) */}
            {project && (
              <div className="mb-4">
                <SectionHeading>Project</SectionHeading>
                <LeftLinkRow label="Project" displayText={project.projectId || project.id} href={`/projects/${encodeURIComponent(project.id)}`} />
              </div>
            )}

            {/* Source Quotation */}
            {sourceQuotation && (
              <div className="mb-4">
                <SectionHeading>Source Quotation</SectionHeading>
                <LeftLinkRow label="Quotation" displayText={sourceQuotation.quotationNumber || sourceQuotation.quoteNumber || order.sourceQuotationId} href={`/quotations/${encodeURIComponent(order.sourceQuotationId)}`} />
                <LeftInfoRow label="Status" value={sourceQuotation.status || '—'} />
                <LeftInfoRow label="Value" value={fmtCurrency(Number(sourceQuotation.total || 0))} />
              </div>
            )}

            {/* Customer's other orders */}
            {customerOrders.length > 0 && (
              <div className="mb-4">
                <SectionHeading>Other Orders</SectionHeading>
                {customerOrders.slice(0, 3).map((o: any) => (
                  <LeftLinkRow key={o.id} label="Order" displayText={o.orderNumber || o.orderNo || o.id} href={`/orders/${encodeURIComponent(o.id)}`} />
                ))}
              </div>
            )}

            {/* ── Order Summary ── */}
            <div className="mt-4 pt-4 border-t border-[var(--color-border-subtle)]">
              <SectionHeading>Order Summary</SectionHeading>
              <LeftInfoRow label="Order No." value={orderNumber} />
              <LeftInfoRow label="Status" value={<StatusBadge status={status} />} />
              <LeftInfoRow label="Payment" value={<StatusBadge status={paymentStatus} colors={PAYMENT_COLORS} />} />
              <LeftInfoRow label="Items" value={`${itemCount} item${itemCount !== 1 ? 's' : ''}`} />
              <LeftInfoRow label="Value" value={fmtCurrency(total)} />
              <LeftInfoRow label="Paid" value={fmtCurrency(paidAmount)} />
              {balanceAmount > 0 && <LeftInfoRow label="Balance" value={<span className="text-red-600 font-semibold">{fmtCurrency(balanceAmount)}</span>} />}
              <LeftInfoRow label="Date" value={fmtDateSafe(orderDate)} />
              {deliveryDate && <LeftInfoRow label="Delivery" value={fmtDateSafe(deliveryDate)} />}
              <LeftInfoRow label="Created By" value={resolveUserName(order?.createdBy)} />
              {order?.assignedToName && <LeftInfoRow label="Assigned" value={order.assignedToName} />}
            </div>
          </div>
        </div>

        {/* ══ CENTER PANEL — Order Workspace ══ */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
          <div className="overflow-y-auto lg:h-full lg:min-h-0 lg:flex-1">
            <Suspense fallback={<div className="flex justify-center py-16 text-sm text-[var(--color-text-muted)]">Loading...</div>}>
              <div className="p-4 sm:p-5 space-y-4">

                {/* Mobile: Context (collapsed) */}
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 shadow-sm lg:hidden">
                  <CollapsedRow label="Customer & Context" icon={<User className="h-3.5 w-3.5" />} open={mobCtxOpen} onToggle={() => setMobCtxOpen((v) => !v)}>
                    <div className="space-y-1.5 text-[13px]">
                      {order?.customerId && (
                        <a href={`/customers/${encodeURIComponent(order.customerId)}`} className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-primary)] hover:underline mb-2">
                          View customer profile <ArrowUpRight className="h-3 w-3 shrink-0" />
                        </a>
                      )}
                      <div className="flex justify-between gap-3"><span className="text-[var(--color-text-muted)]">Name</span><span className="truncate font-semibold text-[var(--color-text)]">{customerName}</span></div>
                      {custType && <div className="flex justify-between gap-3"><span className="text-[var(--color-text-muted)]">Type</span><span className="truncate font-semibold text-[var(--color-text)]">{custType}</span></div>}
                      {custPhone && <div className="flex justify-between gap-3"><span className="text-[var(--color-text-muted)]">Phone</span><span className="truncate font-semibold text-[var(--color-text)]">{custPhone}</span></div>}
                      {project && <LeftLinkRow label="Project" displayText={project.projectId || project.id} href={`/projects/${encodeURIComponent(project.id)}`} />}
                      {sourceQuotation && <LeftLinkRow label="Quotation" displayText={sourceQuotation.quotationNumber || order.sourceQuotationId} href={`/quotations/${encodeURIComponent(order.sourceQuotationId)}`} />}
                    </div>
                  </CollapsedRow>
                </div>

                {/* ══ EDIT MODE ══ */}
                {isEditing ? (
                  <div className="space-y-4">
                    {/* Edit header with Cancel/Save */}
                    <div className="rounded-xl border border-[var(--color-primary)] bg-[var(--color-surface)] p-5 shadow-sm">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-[var(--color-text)] border-b-2 border-[var(--color-primary)] pb-1">Edit Order</h3>
                        <div className="flex items-center gap-1.5">
                          <button onClick={cancelEdit} className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors">
                            <X className="h-3 w-3" /> Cancel
                          </button>
                          <button onClick={saveEdit} disabled={saving} className="inline-flex items-center gap-1 rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[var(--color-primary-hover)] transition-colors disabled:opacity-50">
                            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save Changes
                          </button>
                        </div>
                      </div>

                      {/* Order Information fields */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Customer Name</label>
                          <input value={editForm.customer} onChange={(e) => updateEditField('customer', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Order Type</label>
                          <select value={editForm.orderType} onChange={(e) => updateEditField('orderType', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]">
                            <option value="B2B">B2B</option>
                            <option value="B2C">B2C</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Order Date</label>
                          <input type="date" value={editForm.date} onChange={(e) => updateEditField('date', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Delivery Date</label>
                          <input type="date" value={editForm.deliveryDate} onChange={(e) => updateEditField('deliveryDate', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Payment Status</label>
                          <select value={editForm.paymentStatus} onChange={(e) => updateEditField('paymentStatus', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]">
                            {PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Payment Mode</label>
                          <input value={editForm.paymentMode} onChange={(e) => updateEditField('paymentMode', e.target.value)} placeholder="Cash, UPI, Bank Transfer..." className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Delivery Address</label>
                          <input value={editForm.shippingAddress} onChange={(e) => updateEditField('shippingAddress', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                        </div>
                      </div>
                    </div>

                    {/* Items editor */}
                    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
                      <SectionHeading>Order Items</SectionHeading>
                      <div className="mt-3">
                        <OrderItemsEditor
                          items={editItems}
                          products={products}
                          currencySymbol={currencySymbol}
                          subtotal={editTotals.subtotal}
                          taxTotal={editTotals.taxTotal}
                          discount={Number(editForm.discount) || 0}
                          grandTotal={editTotals.grandTotal}
                          onAddItem={addEditItem}
                          onRemoveItem={removeEditItem}
                          onUpdateItem={updateEditItem}
                          onDiscountChange={(v) => updateEditField('discount', v)}
                        />
                      </div>
                    </div>

                    {/* Notes */}
                    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
                      <SectionHeading>Notes</SectionHeading>
                      <div className="mt-3">
                        <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Notes / Remarks</label>
                        <textarea value={editForm.notes} onChange={(e) => updateEditField('notes', e.target.value)} rows={3} placeholder="Additional notes..." className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                      </div>
                    </div>

                    {/* Save/Cancel footer */}
                    <div className="flex justify-end gap-2">
                      <button onClick={cancelEdit} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-[12px] font-semibold text-[var(--color-text-secondary)] shadow-sm hover:bg-[var(--color-surface-hover)] transition-colors">
                        Cancel
                      </button>
                      <button onClick={saveEdit} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-[12px] font-semibold text-white shadow-sm hover:bg-[var(--color-primary-hover)] transition-colors disabled:opacity-50">
                        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save Changes
                      </button>
                    </div>
                  </div>
                ) : (
                <>
                {/* ── ORDER INFORMATION ── */}
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
                  <SectionHeading>Order Information</SectionHeading>
                  <div className="mt-3">
                    <InfoGrid>
                      <InfoField label="Order No." value={orderNumber} />
                      <InfoField label="Status" value={<StatusBadge status={status} />} />
                      <InfoField label="Payment" value={<StatusBadge status={paymentStatus} colors={PAYMENT_COLORS} />} />
                      <InfoField label="Date" value={fmtDateSafe(orderDate)} />
                      {deliveryDate && <InfoField label="Expected Delivery" value={fmtDateSafe(deliveryDate)} />}
                      <InfoField label="Payment Mode" value={order?.paymentMode || undefined} />
                      <InfoField label="Assigned To" value={order?.assignedToName || resolveUserName(order?.assignedToId)} />
                      <InfoField label="Created By" value={resolveUserName(order?.createdBy)} />
                      {order?.caseId && <InfoField label="Case ID" value={order.caseId} />}
                    </InfoGrid>
                  </div>
                </div>

                {/* ── ITEMS TABLE ── */}
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm overflow-hidden">
                  <div className="px-5 pt-5 pb-3">
                    <SectionHeading>Order Items</SectionHeading>
                  </div>
                  {items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-[var(--color-text-muted)]">
                      <Package className="h-10 w-10 mb-3 opacity-40" />
                      <p className="text-sm font-medium">No line items</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-[var(--color-bg-sunken)]">
                            <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">#</th>
                            <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Product</th>
                            <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Qty</th>
                            <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Price</th>
                            <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Tax</th>
                            <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Dispatched</th>
                            <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((item: any, idx: number) => {
                            const lineTotal = Number(item.total || (Number(item.qty || 0) * Number(item.price || 0)));
                            return (
                              <tr key={idx} className="border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-sunken)]/50">
                                <td className="px-4 py-2.5 text-[var(--color-text-muted)]">{idx + 1}</td>
                                <td className="px-4 py-2.5">
                                  <span className="font-medium">{item.product || item.productName || '—'}</span>
                                </td>
                                <td className="px-4 py-2.5 text-right">{item.qty || item.quantity || '0'}</td>
                                <td className="px-4 py-2.5 text-right">{fmtCurrency(Number(item.price || 0))}</td>
                                <td className="px-4 py-2.5 text-right">{item.tax != null ? `${item.tax}%` : '—'}</td>
                                <td className="px-4 py-2.5 text-right text-[11px]">
                                  {item.dispatchedQty != null ? (
                                    <span className={cn('font-medium', item.dispatchedQty >= (item.qty || 0) ? 'text-emerald-600' : 'text-amber-600')}>
                                      {item.dispatchedQty}/{item.qty || 0}
                                    </span>
                                  ) : '—'}
                                </td>
                                <td className="px-4 py-2.5 text-right font-semibold">{fmtCurrency(lineTotal)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* ── STOCK RESERVATION (INVENTORY-07) ── */}
                {(orderReservations.length > 0
                  || (Array.isArray(order?.stockShortfall) && order.stockShortfall.length > 0)
                  || order?.reservationStatus) && (
                  <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
                    <SectionHeading>Stock Reservation</SectionHeading>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
                      <span className="text-[var(--color-text-muted)]">Status</span>
                      <span className={cn(
                        'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold',
                        order?.reservationStatus === 'reserved' ? 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300'
                          : order?.reservationStatus === 'partial' ? 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300'
                          : 'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)] border-[var(--color-border)]',
                      )}>
                        {String(order?.reservationStatus || 'none').replace(/_/g, ' ')}
                      </span>
                      {order?.fulfilmentWarehouseId && (
                        <span className="text-[var(--color-text-muted)]">· Fulfilment warehouse <span className="font-medium text-[var(--color-text)]">{order.fulfilmentWarehouseId}</span></span>
                      )}
                    </div>
                    {orderReservations.length > 0 && (
                      <div className="mt-3 overflow-x-auto">
                        <table className="w-full text-[12px]">
                          <thead>
                            <tr className="bg-[var(--color-bg-sunken)] text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
                              <th className="px-3 py-2 text-left">Product</th>
                              <th className="px-3 py-2 text-right">Requested</th>
                              <th className="px-3 py-2 text-right">Reserved</th>
                              <th className="px-3 py-2 text-right">Consumed</th>
                              <th className="px-3 py-2 text-right">Released</th>
                              <th className="px-3 py-2 text-left">State</th>
                            </tr>
                          </thead>
                          <tbody>
                            {orderReservations.map((r: any) => (
                              <tr key={r.id} className="border-t border-[var(--color-border-subtle)]">
                                <td className="px-3 py-2 font-medium">{r.productId}</td>
                                <td className="px-3 py-2 text-right">{Number(r.qtyRequested) || 0}</td>
                                <td className="px-3 py-2 text-right">{Number(r.qtyReserved) || 0}</td>
                                <td className="px-3 py-2 text-right">{Number(r.qtyConsumed) || 0}</td>
                                <td className="px-3 py-2 text-right">{Number(r.qtyReleased) || 0}</td>
                                <td className="px-3 py-2">{r.status}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {Array.isArray(order?.stockShortfall) && order.stockShortfall.length > 0 && (
                      <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                        <p className="font-semibold">Stock shortfall — not fully reserved</p>
                        <ul className="mt-1 space-y-0.5">
                          {order.stockShortfall.map((s: any, i: number) => (
                            <li key={i}>{s.productId}: short {s.shortfallQty} (requested {s.requestedQty}, reserved {s.reservedQty})</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* ── PRICING SUMMARY ── */}
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
                  <SectionHeading>Pricing Summary</SectionHeading>
                  <div className="mt-3 space-y-2 max-w-xs ml-auto">
                    <div className="flex justify-between text-[12px]"><span className="text-[var(--color-text-muted)]">Subtotal</span><span className="font-medium">{fmtCurrency(subtotal)}</span></div>
                    {discount > 0 && <div className="flex justify-between text-[12px]"><span className="text-[var(--color-text-muted)]">Discount</span><span className="font-medium text-red-600">−{fmtCurrency(discount)}</span></div>}
                    {taxTotal > 0 && <div className="flex justify-between text-[12px]"><span className="text-[var(--color-text-muted)]">Tax</span><span className="font-medium">{fmtCurrency(taxTotal)}</span></div>}
                    <div className="flex justify-between text-[14px] font-bold border-t border-[var(--color-border-subtle)] pt-2"><span>Grand Total</span><span className="text-[var(--color-primary)]">{fmtCurrency(total)}</span></div>
                    <div className="flex justify-between text-[12px] border-t border-[var(--color-border-subtle)] pt-2"><span className="text-[var(--color-text-muted)]">Paid</span><span className="font-medium text-emerald-600">{fmtCurrency(paidAmount)}</span></div>
                    {balanceAmount > 0 && <div className="flex justify-between text-[12px]"><span className="text-[var(--color-text-muted)]">Balance Due</span><span className="font-semibold text-red-600">{fmtCurrency(balanceAmount)}</span></div>}
                  </div>
                </div>

                {/* ── DELIVERY ADDRESS ── */}
                {deliveryAddress && (
                  <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
                    <SectionHeading>Delivery Address</SectionHeading>
                    <p className="mt-2 text-[12px] font-medium text-[var(--color-text)]">{deliveryAddress}</p>
                  </div>
                )}

                {/* ── NOTES ── */}
                {notes && (
                  <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
                    <SectionHeading>Notes</SectionHeading>
                    <p className="mt-2 text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap leading-relaxed">{notes}</p>
                  </div>
                )}
                </>
                )}
              </div>
            </Suspense>

            {/* ══ MOBILE: Quick Actions ══ */}
            <div className="lg:hidden p-4 space-y-3">
              {/* Actions row */}
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                <h3 className="mb-3 text-[11px] font-extrabold uppercase tracking-widest text-[var(--color-text)]">Quick Actions</h3>
                <div className="grid grid-cols-2 gap-1.5">
                  {canEdit && (
                    <QuickAction icon={<Edit2 className="h-4 w-4" />} label="Edit" onClick={startEdit} />
                  )}
                  {canCreate && (
                    <QuickAction icon={<FileText className="h-4 w-4" />} label="Invoice" onClick={() => navigate(`/invoices?create=1&orderId=${encodeURIComponent(id || '')}`)} />
                  )}
                  {canCreate && (
                    <QuickAction icon={<CreditCard className="h-4 w-4" />} label="Payment" onClick={() => navigate(`/payments?create=1&orderId=${encodeURIComponent(id || '')}`)} />
                  )}
                  {canCreate && (
                    <QuickAction icon={<Truck className="h-4 w-4" />} label="Dispatch" onClick={() => navigate(`/dispatch?create=1&orderId=${encodeURIComponent(id || '')}`)} />
                  )}
                  {order?.projectId && <QuickAction icon={<MapPin className="h-4 w-4" />} label="Project" onClick={() => navigate(`/projects/${encodeURIComponent(String(order.projectId))}`)} />}
                </div>
                {/* Status control */}
                {canEdit && (
                  <div className="mt-2 flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] shrink-0">Status</span>
                    <div className="relative flex-1">
                      <select value={status} onChange={(e) => handleStatusChange(e.target.value)} disabled={statusUpdating}
                        className="w-full appearance-none rounded-md border border-[var(--color-border)] bg-[var(--color-bg-sunken)] px-2.5 py-1.5 pr-7 text-[11px] font-semibold text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] disabled:opacity-50 cursor-pointer">
                        {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--color-text-muted)]" />
                    </div>
                    {statusUpdating && <Loader2 className="h-3 w-3 animate-spin text-[var(--color-primary)]" />}
                  </div>
                )}
              </div>

              {/* Linked Records */}
              {(order?.customerId || order?.projectId || order?.sourceQuotationId) && (
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                  <h3 className="mb-3 text-[11px] font-extrabold uppercase tracking-widest text-[var(--color-text)]">Linked Records</h3>
                  <div className="space-y-1.5">
                    {order?.customerId && <a href={`/customers/${encodeURIComponent(String(order.customerId))}`} className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-left hover:border-[var(--color-primary)] transition-colors"><span className="text-[11px] text-[var(--color-text-secondary)]">Customer</span><span className="text-[11px] font-semibold text-[var(--color-primary)]">→</span></a>}
                    {order?.projectId && <a href={`/projects/${encodeURIComponent(String(order.projectId))}`} className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-left hover:border-[var(--color-primary)] transition-colors"><span className="text-[11px] text-[var(--color-text-secondary)]">Project</span><span className="text-[11px] font-semibold text-[var(--color-primary)]">→</span></a>}
                    {order?.sourceQuotationId && <a href={`/quotations/${encodeURIComponent(String(order.sourceQuotationId))}`} className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-left hover:border-[var(--color-primary)] transition-colors"><span className="text-[11px] text-[var(--color-text-secondary)]">Quotation</span><span className="text-[11px] font-semibold text-[var(--color-primary)]">→</span></a>}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ══ RIGHT PANEL — Quick Actions ══ */}
        <div className="hidden shrink-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm lg:block lg:w-[19%] lg:overflow-hidden">
          <div className="lg:h-full lg:overflow-y-auto">
            <div className="px-4 py-4 border-b border-[var(--color-border-subtle)]">
              <h3 className="mb-3 text-[11px] font-extrabold uppercase tracking-widest text-[var(--color-text)]">Quick Actions</h3>

              {/* Row 1: Edit | Invoice */}
              <div className="grid grid-cols-2 gap-1.5">
                {canEdit && (
                  <QuickAction icon={<Edit2 className="h-4 w-4" />} label="Edit" onClick={startEdit} />
                )}
                {canCreate && (
                  <QuickAction icon={<FileText className="h-4 w-4" />} label="Invoice" onClick={() => navigate(`/invoices?create=1&orderId=${encodeURIComponent(id || '')}`)} />
                )}
              </div>

              {/* Row 2: Payment | Dispatch */}
              <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                {canCreate && (
                  <QuickAction icon={<CreditCard className="h-4 w-4" />} label="Payment" onClick={() => navigate(`/payments?create=1&orderId=${encodeURIComponent(id || '')}`)} />
                )}
                {canCreate && (
                  <QuickAction icon={<Truck className="h-4 w-4" />} label="Dispatch" onClick={() => navigate(`/dispatch?create=1&orderId=${encodeURIComponent(id || '')}`)} />
                )}
              </div>

              {/* Row 3: Status — full width */}
              {canEdit && (
                <div className="mt-1.5">
                  <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] shrink-0">Status</span>
                    <div className="relative flex-1">
                      <select value={status} onChange={(e) => handleStatusChange(e.target.value)} disabled={statusUpdating}
                        className="w-full appearance-none rounded-md border border-[var(--color-border)] bg-[var(--color-bg-sunken)] px-2.5 py-1.5 pr-7 text-[11px] font-semibold text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] disabled:opacity-50 cursor-pointer">
                        {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--color-text-muted)]" />
                    </div>
                    {statusUpdating && <Loader2 className="h-3 w-3 animate-spin text-[var(--color-primary)]" />}
                  </div>
                </div>
              )}
            </div>

            <div className="px-4 py-4">
              <h3 className="mb-3 text-[11px] font-extrabold uppercase tracking-widest text-[var(--color-text)]">Linked Records</h3>
              <div className="space-y-1.5">
                {order?.customerId && <a href={`/customers/${encodeURIComponent(String(order.customerId))}`} className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-left hover:border-[var(--color-primary)] transition-colors"><span className="text-[11px] text-[var(--color-text-secondary)]">Customer</span><span className="text-[11px] font-semibold text-[var(--color-primary)]">→</span></a>}
                {order?.projectId && <a href={`/projects/${encodeURIComponent(String(order.projectId))}`} className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-left hover:border-[var(--color-primary)] transition-colors"><span className="text-[11px] text-[var(--color-text-secondary)]">Project</span><span className="text-[11px] font-semibold text-[var(--color-primary)]">→</span></a>}
                {order?.sourceQuotationId && <a href={`/quotations/${encodeURIComponent(String(order.sourceQuotationId))}`} className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-left hover:border-[var(--color-primary)] transition-colors"><span className="text-[11px] text-[var(--color-text-secondary)]">Quotation</span><span className="text-[11px] font-semibold text-[var(--color-primary)]">→</span></a>}
                {orderDispatches.length > 0 && <a href={`/dispatch?orderId=${encodeURIComponent(id || '')}`} className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-left hover:border-[var(--color-primary)] transition-colors"><span className="text-[11px] text-[var(--color-text-secondary)]">Dispatches ({orderDispatches.length})</span><span className="text-[11px] font-semibold text-[var(--color-primary)]">→</span></a>}
                {orderInvoices.length > 0 && <a href={`/invoices?orderId=${encodeURIComponent(id || '')}`} className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-left hover:border-[var(--color-primary)] transition-colors"><span className="text-[11px] text-[var(--color-text-secondary)]">Invoices ({orderInvoices.length})</span><span className="text-[11px] font-semibold text-[var(--color-primary)]">→</span></a>}
                {orderPayments.length > 0 && <a href={`/payments?orderId=${encodeURIComponent(id || '')}`} className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-left hover:border-[var(--color-primary)] transition-colors"><span className="text-[11px] text-[var(--color-text-secondary)]">Payments ({orderPayments.length})</span><span className="text-[11px] font-semibold text-[var(--color-primary)]">→</span></a>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── FOOTER ── */}
      <div className="flex shrink-0 flex-col gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm px-3 py-2 sm:px-4 lg:flex-row lg:flex-wrap lg:items-center lg:gap-3 lg:py-1.5">
        <div className="flex w-full items-center justify-between gap-2 sm:gap-3 lg:flex-1">
          <button type="button" onClick={() => { const idx = allOrders.findIndex((o: any) => o.id === id); if (idx > 0) navigate(`/orders/${encodeURIComponent(allOrders[idx - 1].id)}`); }}
            disabled={allOrders.findIndex((o: any) => o.id === id) <= 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2 text-[12px] font-semibold text-[var(--color-text-secondary)] shadow-sm disabled:opacity-40 disabled:cursor-not-allowed hover:-translate-y-0.5 hover:shadow-md transition-all">
            ← Previous
          </button>
          <span className="text-[11px] text-[var(--color-text-muted)]">{allOrders.findIndex((o: any) => o.id === id) + 1} of {allOrders.length}</span>
          <button type="button" onClick={() => { const idx = allOrders.findIndex((o: any) => o.id === id); if (idx >= 0 && idx < allOrders.length - 1) navigate(`/orders/${encodeURIComponent(allOrders[idx + 1].id)}`); }}
            disabled={allOrders.findIndex((o: any) => o.id === id) >= allOrders.length - 1}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2 text-[12px] font-semibold text-[var(--color-text-secondary)] shadow-sm disabled:opacity-40 disabled:cursor-not-allowed hover:-translate-y-0.5 hover:shadow-md transition-all">
            Next →
          </button>
        </div>
      </div>

      {/* Delete confirmation */}
      <Modal open={showDelete} onClose={() => setShowDelete(false)} title="Delete Order" size="sm">
        <p className="text-sm text-[var(--color-text-secondary)]">Delete this order permanently? This cannot be undone.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowDelete(false)}>Cancel</Button>
          <Button variant="danger" size="sm" onClick={handleDelete}>Delete</Button>
        </div>
      </Modal>
    </div>
  );
}
