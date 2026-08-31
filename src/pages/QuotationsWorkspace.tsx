/**
 * QuotationsWorkspace — Permanent operational workspace for Quotations.
 *
 * 3-panel architecture:
 *   LEFT  — B2B/B2C context-aware + Quotation Summary
 *   CENTER — Quotation workspace (info, items, pricing, terms, notes)
 *   RIGHT — Quick Actions (Edit, PDF, Status) + Linked Records
 *
 * B2B: Customer → Active Business Context → Previous Business
 * B2C: Customer → Loan Application → Active/Closed Quotations
 */
import { Suspense, useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowUpRight, Edit2, Trash2, Send, FileText,
  Phone, Mail, MessageCircle, User, Save, X, Plus, MapPin,
  ChevronDown, Loader2, Package, Clock, ClipboardList,
  Download, Lock,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { EmptyState } from '../components/shared';
import { CollapsedRow } from '../components/shared/WorkspaceSectionCards';
import { usePermissions } from '../lib/permissions';
import { useAppStore, useCurrentUser } from '../store/useAppStore';
import { getOne, getAll, fmtDate, fmtCurrency } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { queryKeys } from '../lib/queryKeys';
import { useUserNameResolver } from '../hooks/useUserNameResolver';
import { isQuotationLocked, updateQuotation } from '../lib/quotationWorkflow';
import { useConvertQuotationToOrder } from '../features/quotations/hooks/useQuotations';
import { useSettingsSection } from '../features/settings/hooks/useSettingsSection';
import { normalizeEmailSettings } from '../features/settings/emailRuntime';
import { sendQuotationEmail } from '../features/quotations/utils/quotationEmail';
import { DocumentTemplateResolver, triggerPrint } from '../templates/documents/resolver';
import { QuotationItemsEditor } from '../features/quotations/components/QuotationItemsEditor';
import { useSalesProducts } from '../features/sales/hooks/useSales';
import { cn } from '../utils/cn';
import type { Customer, Quotation } from '../types';
import type { ProjectRecord } from '../features/projects/types';
import type { CompanyConfig } from '../config/company';

// ── Status badge ──────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  Draft: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600',
  Sent: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-700',
  Accepted: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700',
  'Converted to Order': 'bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-900/40 dark:text-indigo-300 dark:border-indigo-700',
  Rejected: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-300 dark:border-red-700',
  Expired: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700',
  Pending: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700',
};
const QT_STATUSES = ['Draft', 'Sent', 'Accepted', 'Rejected', 'Expired'];

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] || STATUS_COLORS.Draft;
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
export default function QuotationsWorkspace() {
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const perms = usePermissions();
  const user = useCurrentUser();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const company = useAppStore((s) => s.company);
  const keys = queryKeys.forCompany(activeCompanyId);
  const resolveUserName = useUserNameResolver();

  // ── Quotation data
  const quoteQuery = useQuery({
    queryKey: [...keys.quotationsRoot, id],
    queryFn: () => getOne<Quotation>(COLLECTIONS.QUOTATIONS, id),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
  const quote = quoteQuery.data as any;

  // ── Customer data
  const customerQuery = useQuery({
    queryKey: [...keys.customersRoot, 'qt-ws', quote?.customerId],
    queryFn: () => getOne<Customer>(COLLECTIONS.CUSTOMERS, quote!.customerId),
    enabled: Boolean(quote?.customerId),
    staleTime: 60_000,
  });
  const customer = customerQuery.data as Customer | undefined;

  // ── All customers (for B2B active business lookup)
  const customersQuery = useQuery({
    queryKey: keys.customersAll,
    queryFn: () => getAll<Customer>(COLLECTIONS.CUSTOMERS),
    staleTime: 60_000,
  });
  const allCustomers = (customersQuery.data as Customer[]) || [];

  // ── All quotations (for B2C active/closed lookup + nav)
  const quotationsQuery = useQuery({
    queryKey: keys.quotationsAll,
    queryFn: () => getAll<any>(COLLECTIONS.QUOTATIONS),
    staleTime: 30_000,
  });
  const allQuotations = (quotationsQuery.data as any[]) || [];

  // ── All orders (for B2B active business lookup)
  const ordersQuery = useQuery({
    queryKey: keys.ordersAll,
    queryFn: () => getAll<any>(COLLECTIONS.ORDERS),
    staleTime: 30_000,
  });
  const allOrders = (ordersQuery.data as any[]) || [];

  // ── Loan applications (for B2C context)
  const loanAppsQuery = useQuery({
    queryKey: keys.registrationsPaged,
    queryFn: () => getAll<any>(COLLECTIONS.LOAN_APPLICATIONS),
    staleTime: 60_000,
  });
  const allLoanApps = (loanAppsQuery.data as any[]) || [];

  // ── Project data (if linked)
  const projectQuery = useQuery({
    queryKey: [...keys.projectsRoot, 'qt-ws', quote?.projectId],
    queryFn: () => getOne<ProjectRecord>(COLLECTIONS.PROJECTS, quote!.projectId),
    enabled: Boolean(quote?.projectId),
    staleTime: 60_000,
  });
  const project = projectQuery.data as ProjectRecord | undefined;

  // ── Email settings
  const emailSettingsQuery = useSettingsSection('email');
  const emailSettings = useMemo(() => normalizeEmailSettings(emailSettingsQuery.data as Record<string, unknown> | undefined), [emailSettingsQuery.data]);

  const canEdit = perms.canEdit('quotations');
  const canDelete = perms.canDelete('quotations');
  const canConvert = perms.canCreate('orders');

  // ── Convert to Order
  const convertToOrder = useConvertQuotationToOrder();
  const [showConvertConfirm, setShowConvertConfirm] = useState(false);

  // ── Derived data
  const status = String(quote?.status || 'Draft');
  const locked = isQuotationLocked(quote);
  const quoteNumber = String(quote?.quotationNumber || quote?.quoteNumber || quote?.refNo || id);
  const customerName = quote?.customer || customer?.name || '';
  const isB2B = customer?.type === 'B2B';
  const items = (quote?.items as any[]) || [];
  const subtotal = Number(quote?.subtotal || 0);
  const taxTotal = Number(quote?.taxTotal || quote?.taxAmount || 0);
  const discount = Number(quote?.discount || 0);
  const total = Number(quote?.total || 0);
  const itemCount = items.length;
  const deliveryTimeline = String(quote?.deliveryTimeline || '');
  const terms = String(quote?.terms || '');
  const notes = String(quote?.notes || '');

  // ── B2B: Active/previous business context
  const b2bActiveOrders = useMemo(() => {
    if (!isB2B || !quote?.customerId) return [];
    return allOrders.filter((o: any) => o.customerId === quote.customerId && o.status !== 'Delivered' && o.status !== 'Cancelled');
  }, [isB2B, quote, allOrders]);

  const b2bPreviousOrders = useMemo(() => {
    if (!isB2B || !quote?.customerId) return [];
    return allOrders.filter((o: any) => o.customerId === quote.customerId && (o.status === 'Delivered' || o.status === 'Cancelled'));
  }, [isB2B, quote, allOrders]);

  // ── B2C: Loan application context
  const b2cLoanApp = useMemo(() => {
    if (isB2B || !quote?.customerId) return null;
    return allLoanApps.find((la: any) => la.customerId === quote.customerId) || null;
  }, [isB2B, quote, allLoanApps]);

  // ── B2C: Active/closed quotations
  const b2cActiveQuotations = useMemo(() => {
    if (isB2B || !quote?.customerId) return [];
    return allQuotations.filter((q: any) => q.customerId === quote.customerId && q.id !== id && !['Rejected', 'Expired', 'Converted to Order'].includes(q.status));
  }, [isB2B, quote, allQuotations, id]);

  const b2cClosedQuotations = useMemo(() => {
    if (isB2B || !quote?.customerId) return [];
    return allQuotations.filter((q: any) => q.customerId === quote.customerId && q.id !== id && ['Rejected', 'Expired', 'Converted to Order'].includes(q.status));
  }, [isB2B, quote, allQuotations, id]);



  // ── Delete
  const [showDelete, setShowDelete] = useState(false);
  const handleDelete = useCallback(async () => {
    if (!quote?.id) return;
    const { softDelete } = await import('../lib/firestore');
    const { COLLECTIONS: COLS } = await import('../lib/firebase');
    await softDelete(COLS.QUOTATIONS, quote.id);
    qc.invalidateQueries({ queryKey: keys.quotationsPaged });
    toast.success('Quotation deleted');
    navigate('/quotations');
  }, [quote, qc, keys, navigate]);

  // ── Status update
  const [statusUpdating, setStatusUpdating] = useState(false);
  const handleStatusChange = useCallback(async (newStatus: string) => {
    if (!quote?.id || newStatus === status || locked) return;
    setStatusUpdating(true);
    try {
      await updateQuotation(quote.id, { status: newStatus, updatedBy: user?.id });
      qc.invalidateQueries({ queryKey: [...keys.quotationsRoot, id] });
      qc.invalidateQueries({ queryKey: keys.quotationsPaged });
      toast.success(`Status updated to ${newStatus}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update status');
    } finally {
      setStatusUpdating(false);
    }
  }, [quote, status, locked, user, qc, keys, id]);

  // ── PDF generation (client-side via DocumentTemplateResolver)
  const handlePdf = useCallback(() => {
    if (!quote || !company) return;
    const companyConfig = company as CompanyConfig;
    const html = DocumentTemplateResolver(companyConfig, 'QUOTATION', {
      ...quote,
      customer: customerName,
      customerAddress: customerField(customer as any, ['address']),
      customerPhone: customerField(customer as any, ['phone', 'mobile']),
      customerEmail: customerField(customer as any, ['email']),
      customerGst: customerField(customer as any, ['gst']),
      customerState: customerField(customer as any, ['state']),
    });
    triggerPrint(html);
  }, [quote, company, customer, customerName]);

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
    const installation = Number(editForm.installationCharges) || 0;
    const transport = Number(editForm.transportCharges) || 0;
    const discount = Number(editForm.specialDiscount) || 0;
    const grandTotal = sub + tax + installation + transport - discount;
    return { subtotal: sub, taxTotal: tax, grandTotal };
  }, [editItems, editForm.installationCharges, editForm.transportCharges, editForm.specialDiscount]);

  function startEdit() {
    if (!quote) return;
    setEditForm({
      customer: quote.customer || '',
      customerId: quote.customerId || '',
      date: quote.date || '',
      validUntil: quote.validUntil || '',
      deliveryTimeline: quote.deliveryTimeline || '',
      terms: quote.terms || '',
      notes: quote.notes || '',
      installationCharges: String(quote.installationCharges || ''),
      transportCharges: String(quote.transportCharges || ''),
      specialDiscount: String(quote.specialDiscount || ''),
    });
    setEditItems((quote.items || []).map((it: any) => ({ ...it })));
    setIsEditing(true);
  }

  function cancelEdit() {
    setIsEditing(false);
    setEditForm({});
    setEditItems([]);
  }

  function addEditItem() {
    setEditItems((prev) => [...prev, { productId: '', product: '', description: '', hsn: '', specs: '', warranty: '', qty: 1, price: 0, tax: 0, unit: 'Nos', discount: 0 }]);
  }

  function removeEditItem(idx: number) {
    setEditItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateEditItem(idx: number, key: string, val: any) {
    setEditItems((prev) => prev.map((it, i) => {
      if (i !== idx) return it;
      const updated = { ...it, [key]: val };
      // Auto-fill from product catalog when productId changes
      if (key === 'productId' && val) {
        const pr = products.find((p: any) => p.id === val);
        if (pr) {
          updated.product = pr.name;
          updated.description = pr.description || '';
          updated.hsn = pr.hsn || '';
          updated.specs = pr.specifications || '';
          updated.warranty = pr.warranty || '';
          updated.price = pr.price || 0;
          updated.tax = pr.tax || 0;
          updated.unit = pr.unit || 'Nos';
        }
      }
      return updated;
    }));
  }

  async function saveEdit() {
    if (!quote?.id) return;
    if (!editForm.customer) return toast.error('Customer is required');
    if (!editItems.length) return toast.error('Add at least one item');
    setSaving(true);
    try {
      const payload = {
        customer: editForm.customer,
        customerId: editForm.customerId,
        date: editForm.date,
        validUntil: editForm.validUntil,
        deliveryTimeline: editForm.deliveryTimeline,
        terms: editForm.terms,
        notes: editForm.notes,
        installationCharges: Number(editForm.installationCharges) || 0,
        transportCharges: Number(editForm.transportCharges) || 0,
        specialDiscount: Number(editForm.specialDiscount) || 0,
        items: editItems,
        subtotal: editTotals.subtotal,
        taxTotal: editTotals.taxTotal,
        discount: Number(editForm.specialDiscount) || 0,
        total: editTotals.grandTotal,
        updatedBy: user?.id,
      };
      await updateQuotation(quote.id, payload);
      await qc.invalidateQueries({ queryKey: [...keys.quotationsRoot, id] });
      qc.invalidateQueries({ queryKey: keys.quotationsPaged });
      setIsEditing(false);
      setEditForm({});
      setEditItems([]);
      toast.success('Quotation updated');
    } catch (err: any) {
      toast.error(err.message || 'Failed to update');
    } finally {
      setSaving(false);
    }
  }

  function updateEditField(field: string, value: string) {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  }

  // ── Mobile collapsed state
  const [mobCtxOpen, setMobCtxOpen] = useState(false);

  // ── Loading
  if (quoteQuery.isLoading) {
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

  if (!quote || quoteQuery.isError) {
    return (
      <EmptyState
        title="Quotation not found"
        description="This quotation does not exist or has been deleted."
        action={<Link to="/quotations"><Button variant="outline">Back to Quotations</Button></Link>}
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
        <button type="button" onClick={() => navigate('/quotations')} className="flex items-center gap-1.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors lg:hidden">
          <ArrowLeft className="h-4 w-4" /><span className="text-[11px] font-semibold">Back</span>
        </button>
        <div className="flex flex-1 items-center gap-3 sm:flex-wrap sm:gap-x-3 sm:gap-y-2">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-hover)] text-lg font-bold text-white shadow-sm ring-2 ring-[var(--color-primary-muted)] sm:h-12 sm:w-12">
            {customerName[0]?.toUpperCase() || 'Q'}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="min-w-0 break-words text-base font-bold text-[var(--color-text)] sm:truncate sm:text-xl">{customerName || 'Quotation'}</h1>
              <StatusBadge status={status} />
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <span className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1"><FileText className="h-3 w-3" />{quoteNumber}</span>
              {quote?.date && <span className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1"><Clock className="h-3 w-3" />{fmtDateSafe(quote.date)}</span>}
              {locked && <span className="text-[11px] text-amber-600 font-semibold flex items-center gap-1"><Lock className="h-3 w-3" />Converted — locked</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5 sm:shrink-0">
          {custPhone && <a href={`tel:${custPhone}`} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors shadow-sm"><Phone className="h-3.5 w-3.5" /> Call</a>}
          {custPhone && <a href={`https://wa.me/${String(custPhone).replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-emerald-50 hover:text-emerald-700 transition-colors shadow-sm"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</a>}
          {custEmail && <a href={`mailto:${custEmail}`} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-blue-50 hover:text-blue-700 transition-colors shadow-sm"><Mail className="h-3.5 w-3.5" /> Email</a>}
          <button type="button" onClick={() => navigate('/quotations')} className="hidden lg:inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors shadow-sm">
            <ArrowLeft className="h-3.5 w-3.5" /> Quotations
          </button>
        </div>
      </div>

      {/* ── BODY — 3-column ── */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1.5 lg:flex-row lg:gap-2 lg:overflow-hidden lg:pr-0">

        {/* ══ LEFT PANEL — B2B/B2C Context + Quotation Summary ══ */}
        <div className="hidden w-full shrink-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm p-4 lg:block lg:w-[25%] lg:overflow-hidden">
          <div className="lg:h-full lg:overflow-y-auto">
            {/* Customer Information */}
            {customerName && (
              <div className="mb-4">
                <SectionHeading>Customer Information</SectionHeading>
                {quote?.customerId && <LeftLinkRow label="Customer" displayText={customerName} href={`/customers/${encodeURIComponent(quote.customerId)}`} />}
                {!quote?.customerId && <LeftInfoRow label="Name" value={customerName} />}
                {custType && <LeftInfoRow label="Type" value={custType} />}
                {custCompany && <LeftInfoRow label="Company" value={custCompany} />}
                {custPhone && <LeftInfoRow label="Phone" value={custPhone} />}
                {custEmail && <LeftInfoRow label="Email" value={custEmail} />}
                {(custAddress || custCity) && <LeftInfoRow label="Address" value={[custAddress, [custCity, custState].filter(Boolean).join(', ')].filter(Boolean).join(', ') || undefined} />}
                {custGst && <LeftInfoRow label="GST" value={custGst} />}
              </div>
            )}

            {/* B2B: Active Business Context */}
            {isB2B && b2bActiveOrders.length > 0 && (
              <div className="mb-4">
                <SectionHeading>Active Business</SectionHeading>
                {b2bActiveOrders.slice(0, 3).map((o: any) => (
                  <LeftLinkRow key={o.id} label="Order" displayText={o.orderNumber || o.orderNo || o.id} href={`/orders/${encodeURIComponent(o.id)}`} />
                ))}
              </div>
            )}

            {/* B2B: Previous Business */}
            {isB2B && b2bPreviousOrders.length > 0 && (
              <div className="mb-4">
                <SectionHeading>Previous Business</SectionHeading>
                {b2bPreviousOrders.slice(0, 3).map((o: any) => (
                  <LeftLinkRow key={o.id} label="Order" displayText={o.orderNumber || o.orderNo || o.id} href={`/orders/${encodeURIComponent(o.id)}`} />
                ))}
              </div>
            )}

            {/* B2C: Loan Application */}
            {!isB2B && b2cLoanApp && (
              <div className="mb-4">
                <SectionHeading>Loan Application</SectionHeading>
                <LeftLinkRow label="Application" displayText={b2cLoanApp.registrationId || b2cLoanApp.id} href={`/loan-applications/${encodeURIComponent(b2cLoanApp.id)}`} />
                <LeftInfoRow label="Status" value={b2cLoanApp.status || 'Draft'} />
                {b2cLoanApp.bankName && <LeftInfoRow label="Bank" value={b2cLoanApp.bankName} />}
              </div>
            )}

            {/* B2C: Active Quotations */}
            {!isB2B && b2cActiveQuotations.length > 0 && (
              <div className="mb-4">
                <SectionHeading>Other Active Quotations</SectionHeading>
                {b2cActiveQuotations.slice(0, 3).map((q: any) => (
                  <LeftLinkRow key={q.id} label="Quotation" displayText={q.quotationNumber || q.quoteNumber || q.id} href={`/quotations/${encodeURIComponent(q.id)}`} />
                ))}
              </div>
            )}

            {/* B2C: Closed Quotations */}
            {!isB2B && b2cClosedQuotations.length > 0 && (
              <div>
                <SectionHeading>Closed Quotations</SectionHeading>
                {b2cClosedQuotations.slice(0, 3).map((q: any) => (
                  <LeftLinkRow key={q.id} label="Quotation" displayText={q.quotationNumber || q.quoteNumber || q.id} href={`/quotations/${encodeURIComponent(q.id)}`} />
                ))}
              </div>
            )}

            {/* Project link (if exists) */}
            {project && (
              <div className="mt-4">
                <LeftLinkRow label="Project" displayText={project.projectId || project.id} href={`/projects/${encodeURIComponent(project.id)}`} />
              </div>
            )}

            {/* ── Quotation Summary ── */}
            <div className="mt-4 pt-4 border-t border-[var(--color-border-subtle)]">
              <SectionHeading>Quotation Summary</SectionHeading>
              <LeftInfoRow label="Quotation No." value={quoteNumber} />
              <LeftInfoRow label="Status" value={<StatusBadge status={status} />} />
              <LeftInfoRow label="Items" value={`${itemCount} item${itemCount !== 1 ? 's' : ''}`} />
              <LeftInfoRow label="Value" value={fmtCurrency(total)} />
              <LeftInfoRow label="Date" value={fmtDateSafe(quote?.date || quote?.createdAt)} />
              <LeftInfoRow label="Valid Until" value={fmtDateSafe(quote?.validUntil)} />
              {deliveryTimeline && <LeftInfoRow label="Delivery" value={deliveryTimeline} />}
              <LeftInfoRow label="Created By" value={resolveUserName(quote?.createdBy)} />
              {quote?.assignedToName && <LeftInfoRow label="Assigned" value={quote.assignedToName} />}
            </div>
          </div>
        </div>

        {/* ══ CENTER PANEL — Quotation Workspace ══ */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
          <div className="overflow-y-auto lg:h-full lg:min-h-0 lg:flex-1">
            <Suspense fallback={<div className="flex justify-center py-16 text-sm text-[var(--color-text-muted)]">Loading...</div>}>
              <div className="p-4 sm:p-5 space-y-4">

                {/* Mobile: Context (collapsed) */}
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 shadow-sm lg:hidden">
                  <CollapsedRow label="Customer & Context" icon={<User className="h-3.5 w-3.5" />} open={mobCtxOpen} onToggle={() => setMobCtxOpen((v) => !v)}>
                    <div className="space-y-1.5 text-[13px]">
                      {quote?.customerId && (
                        <a href={`/customers/${encodeURIComponent(quote.customerId)}`} className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-primary)] hover:underline mb-2">
                          View customer profile <ArrowUpRight className="h-3 w-3 shrink-0" />
                        </a>
                      )}
                      <div className="flex justify-between gap-3"><span className="text-[var(--color-text-muted)]">Name</span><span className="truncate font-semibold text-[var(--color-text)]">{customerName}</span></div>
                      {custType && <div className="flex justify-between gap-3"><span className="text-[var(--color-text-muted)]">Type</span><span className="truncate font-semibold text-[var(--color-text)]">{custType}</span></div>}
                      {custPhone && <div className="flex justify-between gap-3"><span className="text-[var(--color-text-muted)]">Phone</span><span className="truncate font-semibold text-[var(--color-text)]">{custPhone}</span></div>}
                      {project && <LeftLinkRow label="Project" displayText={project.projectId || project.id} href={`/projects/${encodeURIComponent(project.id)}`} />}
                    </div>
                  </CollapsedRow>
                </div>

                {/* ══ EDIT MODE ══ */}
                {isEditing ? (
                  <div className="space-y-4">
                    {/* Edit header with Cancel/Save */}
                    <div className="rounded-xl border border-[var(--color-primary)] bg-[var(--color-surface)] p-5 shadow-sm">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-[var(--color-text)] border-b-2 border-[var(--color-primary)] pb-1">Edit Quotation</h3>
                        <div className="flex items-center gap-1.5">
                          <button onClick={cancelEdit} className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors">
                            <X className="h-3 w-3" /> Cancel
                          </button>
                          <button onClick={saveEdit} disabled={saving} className="inline-flex items-center gap-1 rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[var(--color-primary-hover)] transition-colors disabled:opacity-50">
                            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save Changes
                          </button>
                        </div>
                      </div>

                      {/* Quotation Information fields */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Customer Name</label>
                          <input value={editForm.customer} onChange={(e) => updateEditField('customer', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Date</label>
                          <input type="date" value={editForm.date} onChange={(e) => updateEditField('date', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Valid Until</label>
                          <input type="date" value={editForm.validUntil} onChange={(e) => updateEditField('validUntil', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Delivery Timeline</label>
                          <input value={editForm.deliveryTimeline} onChange={(e) => updateEditField('deliveryTimeline', e.target.value)} placeholder="e.g. 7-10 working days after advance" className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                        </div>
                      </div>
                    </div>

                    {/* Items editor */}
                    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
                      <SectionHeading>Quotation Items</SectionHeading>
                      <div className="mt-3">
                        <QuotationItemsEditor
                          items={editItems}
                          products={products}
                          currencySymbol={currencySymbol}
                          subtotal={editTotals.subtotal}
                          taxTotal={editTotals.taxTotal}
                          installationCharges={Number(editForm.installationCharges) || 0}
                          transportCharges={Number(editForm.transportCharges) || 0}
                          specialDiscount={Number(editForm.specialDiscount) || 0}
                          grandTotal={editTotals.grandTotal}
                          onAddItem={addEditItem}
                          onRemoveItem={removeEditItem}
                          onUpdateItem={updateEditItem}
                        />
                      </div>
                    </div>

                    {/* Commercial fields */}
                    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
                      <SectionHeading>Commercial Information</SectionHeading>
                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Installation Charges</label>
                          <input type="number" min="0" value={editForm.installationCharges} onChange={(e) => updateEditField('installationCharges', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Transport Charges</label>
                          <input type="number" min="0" value={editForm.transportCharges} onChange={(e) => updateEditField('transportCharges', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Special Discount</label>
                          <input type="number" min="0" value={editForm.specialDiscount} onChange={(e) => updateEditField('specialDiscount', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                        </div>
                      </div>
                    </div>

                    {/* Payment Terms & Notes */}
                    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
                      <SectionHeading>Terms & Notes</SectionHeading>
                      <div className="mt-3 space-y-3">
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Payment Terms & Conditions</label>
                          <textarea value={editForm.terms} onChange={(e) => updateEditField('terms', e.target.value)} rows={3} placeholder="65% advance on order... 30% before dispatch..." className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Notes / Remarks</label>
                          <textarea value={editForm.notes} onChange={(e) => updateEditField('notes', e.target.value)} rows={3} placeholder="Additional notes..." className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                        </div>
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
                {/* ── QUOTATION INFORMATION ── */}
                    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
                      <SectionHeading>Quotation Information</SectionHeading>
                      <div className="mt-3">
                        <InfoGrid>
                          <InfoField label="Quotation No." value={quoteNumber} />
                          <InfoField label="Status" value={<StatusBadge status={status} />} />
                          <InfoField label="Date" value={fmtDateSafe(quote?.date || quote?.createdAt)} />
                          <InfoField label="Valid Until" value={fmtDateSafe(quote?.validUntil)} />
                          <InfoField label="Revision" value={quote?.revisionNumber ? `v${quote.revisionNumber}` : undefined} />
                          <InfoField label="Created By" value={resolveUserName(quote?.createdBy)} />
                          <InfoField label="Assigned To" value={quote?.assignedToName || resolveUserName(quote?.assignedToId)} />
                          <InfoField label="Approval" value={quote?.approvalStatus || (quote?.isApproved ? 'Approved' : 'Pending')} />
                        </InfoGrid>
                      </div>
                    </div>

                    {/* ── DELIVERY TIMELINE ── */}
                    {deliveryTimeline && (
                      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
                        <SectionHeading>Delivery Timeline</SectionHeading>
                        <p className="mt-2 text-[12px] font-medium text-[var(--color-text)]">{deliveryTimeline}</p>
                      </div>
                    )}

                    {/* ── ITEMS TABLE ── */}
                    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm overflow-hidden">
                      <div className="px-5 pt-5 pb-3">
                        <SectionHeading>Quotation Items</SectionHeading>
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
                                      {item.description && <span className="block text-[11px] text-[var(--color-text-muted)] mt-0.5">{item.description}</span>}
                                    </td>
                                    <td className="px-4 py-2.5 text-right">{item.qty || item.quantity || '0'} {item.unit || ''}</td>
                                    <td className="px-4 py-2.5 text-right">{fmtCurrency(Number(item.price || 0))}</td>
                                    <td className="px-4 py-2.5 text-right">{item.tax != null ? `${item.tax}%` : '—'}</td>
                                    <td className="px-4 py-2.5 text-right font-semibold">{fmtCurrency(lineTotal)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* ── COMMERCIAL SUMMARY ── */}
                    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
                      <SectionHeading>Commercial Summary</SectionHeading>
                      <div className="mt-3 space-y-2 max-w-xs ml-auto">
                        <div className="flex justify-between text-[12px]"><span className="text-[var(--color-text-muted)]">Subtotal</span><span className="font-medium">{fmtCurrency(subtotal)}</span></div>
                        {discount > 0 && <div className="flex justify-between text-[12px]"><span className="text-[var(--color-text-muted)]">Discount</span><span className="font-medium text-red-600">−{fmtCurrency(discount)}</span></div>}
                        {taxTotal > 0 && <div className="flex justify-between text-[12px]"><span className="text-[var(--color-text-muted)]">Tax</span><span className="font-medium">{fmtCurrency(taxTotal)}</span></div>}
                        <div className="flex justify-between text-[14px] font-bold border-t border-[var(--color-border-subtle)] pt-2"><span>Grand Total</span><span className="text-[var(--color-primary)]">{fmtCurrency(total)}</span></div>
                      </div>
                    </div>

                    {/* ── PAYMENT TERMS ── */}
                    {terms && (
                      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
                        <SectionHeading>Payment Terms & Conditions</SectionHeading>
                        <p className="mt-2 text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap leading-relaxed">{terms}</p>
                      </div>
                    )}

                    {/* ── NOTES ── */}
                    {notes && (
                      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
                        <SectionHeading>Notes / Remarks</SectionHeading>
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
                  {canEdit && !locked && (
                    <QuickAction icon={<Edit2 className="h-4 w-4" />} label="Edit" onClick={startEdit} />
                  )}
                  {canEdit && locked && (
                    <QuickAction icon={<Lock className="h-4 w-4" />} label="Edit" onClick={() => toast('Order generated — this quotation can no longer be edited.')} disabled title="Order generated — this quotation can no longer be edited." />
                  )}
                  <QuickAction icon={<Download className="h-4 w-4" />} label="PDF" onClick={handlePdf} />
                  {canConvert && !locked && status === 'Accepted' && !showConvertConfirm && (
                    <QuickAction icon={<ClipboardList className="h-4 w-4" />} label="Convert" onClick={() => setShowConvertConfirm(true)} />
                  )}
                  {!locked && status !== 'Accepted' && (
                    <QuickAction icon={<Send className="h-4 w-4" />} label="Send" onClick={() => quote && sendQuotationEmail(quote, allCustomers, { company, emailSettings })} />
                  )}
                  {locked && quote?.convertedOrderId && (
                    <QuickAction icon={<ClipboardList className="h-4 w-4" />} label="Order" onClick={() => navigate(`/orders/${encodeURIComponent(String(quote.convertedOrderId))}`)} />
                  )}
                  {quote?.customerId && <QuickAction icon={<User className="h-4 w-4" />} label="Customer" onClick={() => navigate(`/customers/${encodeURIComponent(String(quote.customerId))}`)} />}
                  {quote?.projectId && <QuickAction icon={<MapPin className="h-4 w-4" />} label="Project" onClick={() => navigate(`/projects/${encodeURIComponent(String(quote.projectId))}`)} />}
                </div>
                {/* Convert confirmation toggle */}
                {canConvert && !locked && status === 'Accepted' && showConvertConfirm && (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                    <p className="text-[11px] font-semibold text-amber-800">Convert this quotation into an Order?</p>
                    <p className="text-[10px] text-amber-600">This will create a new Order from this quotation and lock it from further edits.</p>
                    <div className="flex gap-1.5">
                      <button onClick={() => {
                        if (!quote) return;
                        convertToOrder.mutate(quote as any, {
                          onSuccess: () => {
                            setShowConvertConfirm(false);
                            qc.invalidateQueries({ queryKey: [...keys.quotationsRoot, id] });
                          },
                        });
                      }} disabled={convertToOrder.isPending}
                        className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-semibold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50">
                        {convertToOrder.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ClipboardList className="h-3 w-3" />} Convert to Order
                      </button>
                      <button onClick={() => setShowConvertConfirm(false)}
                        className="inline-flex items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[11px] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {/* Status control */}
                {canEdit && !locked && (
                  <div className="mt-2 flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] shrink-0">Status</span>
                    <div className="relative flex-1">
                      <select value={status} onChange={(e) => handleStatusChange(e.target.value)} disabled={statusUpdating}
                        className="w-full appearance-none rounded-md border border-[var(--color-border)] bg-[var(--color-bg-sunken)] px-2.5 py-1.5 pr-7 text-[11px] font-semibold text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] disabled:opacity-50 cursor-pointer">
                        {QT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--color-text-muted)]" />
                    </div>
                    {statusUpdating && <Loader2 className="h-3 w-3 animate-spin text-[var(--color-primary)]" />}
                  </div>
                )}
                {locked && (
                  <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                    <Lock className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                    <span className="text-[11px] font-semibold text-amber-700">Converted — locked</span>
                  </div>
                )}
              </div>

              {/* Linked Records */}
              {(quote?.customerId || quote?.projectId || quote?.leadId || quote?.convertedOrderId) && (
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                  <h3 className="mb-3 text-[11px] font-extrabold uppercase tracking-widest text-[var(--color-text)]">Linked Records</h3>
                  <div className="space-y-1.5">
                    {quote?.customerId && <a href={`/customers/${encodeURIComponent(String(quote.customerId))}`} className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-left hover:border-[var(--color-primary)] transition-colors"><span className="text-[11px] text-[var(--color-text-secondary)]">Customer</span><span className="text-[11px] font-semibold text-[var(--color-primary)]">→</span></a>}
                    {quote?.projectId && <a href={`/projects/${encodeURIComponent(String(quote.projectId))}`} className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-left hover:border-[var(--color-primary)] transition-colors"><span className="text-[11px] text-[var(--color-text-secondary)]">Project</span><span className="text-[11px] font-semibold text-[var(--color-primary)]">→</span></a>}
                    {quote?.leadId && <a href={`/leads/workspace/${encodeURIComponent(String(quote.leadId))}`} className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-left hover:border-[var(--color-primary)] transition-colors"><span className="text-[11px] text-[var(--color-text-secondary)]">Lead</span><span className="text-[11px] font-semibold text-[var(--color-primary)]">→</span></a>}
                    {quote?.convertedOrderId && <a href={`/orders/${encodeURIComponent(String(quote.convertedOrderId))}`} className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-left hover:border-[var(--color-primary)] transition-colors"><span className="text-[11px] text-[var(--color-text-secondary)]">Order</span><span className="text-[11px] font-semibold text-[var(--color-primary)]">→</span></a>}
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

              {/* Row 1: Edit | Delete */}
              <div className="grid grid-cols-2 gap-1.5">
                {canEdit && !locked && (
                  <QuickAction
                    icon={<Edit2 className="h-4 w-4" />} label="Edit"
                    onClick={startEdit}
                  />
                )}
                {canEdit && locked && (
                  <QuickAction
                    icon={<Lock className="h-4 w-4" />} label="Edit"
                    onClick={() => toast('Order generated — this quotation can no longer be edited.')}
                    disabled
                    title="Order generated — this quotation can no longer be edited."
                  />
                )}
                {canDelete && <QuickAction icon={<Trash2 className="h-4 w-4" />} label="Delete" onClick={() => setShowDelete(true)} />}
              </div>

              {/* Row 2: PDF | Convert */}
              <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                <QuickAction icon={<Download className="h-4 w-4" />} label="PDF" onClick={handlePdf} />
                {canConvert && !locked && status === 'Accepted' && !showConvertConfirm && (
                  <QuickAction icon={<ClipboardList className="h-4 w-4" />} label="Convert" onClick={() => setShowConvertConfirm(true)} />
                )}
                {!locked && status !== 'Accepted' && (
                  <QuickAction icon={<Send className="h-4 w-4" />} label="Send" onClick={() => quote && sendQuotationEmail(quote, allCustomers, { company, emailSettings })} />
                )}
                {locked && quote?.convertedOrderId && (
                  <QuickAction icon={<ClipboardList className="h-4 w-4" />} label="Order" onClick={() => navigate(`/orders/${encodeURIComponent(String(quote.convertedOrderId))}`)} />
                )}
              </div>

              {/* Convert confirmation toggle */}
              {canConvert && !locked && status === 'Accepted' && showConvertConfirm && (
                <div className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                  <p className="text-[11px] font-semibold text-amber-800">Convert this quotation into an Order?</p>
                  <p className="text-[10px] text-amber-600">This will create a new Order and lock the quotation from further edits.</p>
                  <div className="flex gap-1.5">
                    <button onClick={() => {
                      if (!quote) return;
                      convertToOrder.mutate(quote as any, {
                        onSuccess: () => {
                          setShowConvertConfirm(false);
                          qc.invalidateQueries({ queryKey: [...keys.quotationsRoot, id] });
                        },
                      });
                    }} disabled={convertToOrder.isPending}
                      className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[10px] font-semibold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50">
                      {convertToOrder.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ClipboardList className="h-3 w-3" />} Confirm
                    </button>
                    <button onClick={() => setShowConvertConfirm(false)}
                      className="inline-flex items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[10px] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Row 3: Status — full width */}
              {canEdit && !locked && (
                <div className="mt-1.5">
                  <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] shrink-0">Status</span>
                    <div className="relative flex-1">
                      <select value={status} onChange={(e) => handleStatusChange(e.target.value)} disabled={statusUpdating}
                        className="w-full appearance-none rounded-md border border-[var(--color-border)] bg-[var(--color-bg-sunken)] px-2.5 py-1.5 pr-7 text-[11px] font-semibold text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] disabled:opacity-50 cursor-pointer">
                        {QT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--color-text-muted)]" />
                    </div>
                    {statusUpdating && <Loader2 className="h-3 w-3 animate-spin text-[var(--color-primary)]" />}
                  </div>
                </div>
              )}
              {locked && (
                <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <Lock className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                  <span className="text-[11px] font-semibold text-amber-700">Converted — locked</span>
                </div>
              )}
            </div>

            <div className="px-4 py-4">
              <h3 className="mb-3 text-[11px] font-extrabold uppercase tracking-widest text-[var(--color-text)]">Linked Records</h3>
              <div className="space-y-1.5">
                {quote?.customerId && <a href={`/customers/${encodeURIComponent(String(quote.customerId))}`} className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-left hover:border-[var(--color-primary)] transition-colors"><span className="text-[11px] text-[var(--color-text-secondary)]">Customer</span><span className="text-[11px] font-semibold text-[var(--color-primary)]">→</span></a>}
                {quote?.projectId && <a href={`/projects/${encodeURIComponent(String(quote.projectId))}`} className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-left hover:border-[var(--color-primary)] transition-colors"><span className="text-[11px] text-[var(--color-text-secondary)]">Project</span><span className="text-[11px] font-semibold text-[var(--color-primary)]">→</span></a>}
                {quote?.leadId && <a href={`/leads/workspace/${encodeURIComponent(String(quote.leadId))}`} className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-left hover:border-[var(--color-primary)] transition-colors"><span className="text-[11px] text-[var(--color-text-secondary)]">Lead</span><span className="text-[11px] font-semibold text-[var(--color-primary)]">→</span></a>}
                {quote?.convertedOrderId && <a href={`/orders/${encodeURIComponent(String(quote.convertedOrderId))}`} className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-left hover:border-[var(--color-primary)] transition-colors"><span className="text-[11px] text-[var(--color-text-secondary)]">Order</span><span className="text-[11px] font-semibold text-[var(--color-primary)]">→</span></a>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── FOOTER ── */}
      <div className="flex shrink-0 flex-col gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm px-3 py-2 sm:px-4 lg:flex-row lg:flex-wrap lg:items-center lg:gap-3 lg:py-1.5">
        <div className="flex w-full items-center justify-between gap-2 sm:gap-3 lg:flex-1">
          <button type="button" onClick={() => { const idx = allQuotations.findIndex((q: any) => q.id === id); if (idx > 0) navigate(`/quotations/${encodeURIComponent(allQuotations[idx - 1].id)}`); }}
            disabled={allQuotations.findIndex((q: any) => q.id === id) <= 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2 text-[12px] font-semibold text-[var(--color-text-secondary)] shadow-sm disabled:opacity-40 disabled:cursor-not-allowed hover:-translate-y-0.5 hover:shadow-md transition-all">
            ← Previous
          </button>
          <span className="text-[11px] text-[var(--color-text-muted)]">{allQuotations.findIndex((q: any) => q.id === id) + 1} of {allQuotations.length}</span>
          <button type="button" onClick={() => { const idx = allQuotations.findIndex((q: any) => q.id === id); if (idx >= 0 && idx < allQuotations.length - 1) navigate(`/quotations/${encodeURIComponent(allQuotations[idx + 1].id)}`); }}
            disabled={allQuotations.findIndex((q: any) => q.id === id) >= allQuotations.length - 1}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2 text-[12px] font-semibold text-[var(--color-text-secondary)] shadow-sm disabled:opacity-40 disabled:cursor-not-allowed hover:-translate-y-0.5 hover:shadow-md transition-all">
            Next →
          </button>
        </div>
      </div>

      {/* Delete confirmation */}
      <Modal open={showDelete} onClose={() => setShowDelete(false)} title="Delete Quotation" size="sm">
        <p className="text-sm text-[var(--color-text-secondary)]">Delete this quotation permanently? This cannot be undone.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowDelete(false)}>Cancel</Button>
          <Button variant="danger" size="sm" onClick={handleDelete}>Delete</Button>
        </div>
      </Modal>
    </div>
  );
}
