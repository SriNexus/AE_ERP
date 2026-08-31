/**
 * InvoiceDetail — Proforma Invoice Workspace
 *
 * 3-panel architecture (matching Quotation Workspace):
 *   LEFT   — Customer / Project / Order context + Proforma Invoice Summary
 *   CENTER — Proforma Invoice workspace (info, items, pricing, notes)
 *   RIGHT  — Quick Actions (Edit, Record Payment, PDF, Status) + Linked Records
 *
 * Business rule: This is a PROFORMA INVOICE used for payment collection
 * BEFORE dispatch. The final/tax Invoice is generated later.
 */
import { Suspense, useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowUpRight, Edit2, Trash2, FileText,
  Phone, Mail, MessageCircle, User, Save, X,
  ChevronDown, Loader2, Package, Clock,
  Download, Lock, CreditCard, Receipt, ShoppingCart, Send,
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
import { PAYMENT_STATUSES, PAYMENT_MODES } from '../config/company';
import { useSavePayment, PAYMENT_FORM_DEFAULT, type PaymentForm } from '../features/sales/hooks/useSales';
import { useSettingsSection } from '../features/settings/hooks/useSettingsSection';
import { normalizeEmailSettings } from '../features/settings/emailRuntime';
import { sendQuotationEmail } from '../features/quotations/utils/quotationEmail';
import { DocumentTemplateResolver, triggerPrint } from '../templates/documents/resolver';
import { cn } from '../utils/cn';
import type { Customer, ProformaInvoice } from '../types';
import type { CompanyConfig } from '../config/company';

// ── Status badge ──────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  Draft: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600',
  Sent: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-700',
  Paid: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700',
  'Partially Paid': 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700',
  Overdue: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-300 dark:border-red-700',
  Cancelled: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-300 dark:border-red-700',
  Refunded: 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/40 dark:text-purple-300 dark:border-purple-700',
  Pending: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700',
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
export default function InvoiceDetail() {
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const perms = usePermissions();
  const user = useCurrentUser();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const company = useAppStore((s) => s.company);
  const keys = queryKeys.forCompany(activeCompanyId);
  const resolveUserName = useUserNameResolver();

  // ── Invoice data
  const invoiceQuery = useQuery({
    queryKey: [...keys.invoices, id],
    queryFn: () => getOne<ProformaInvoice>(COLLECTIONS.PROFORMA_INVOICES, id),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
  const invoice = invoiceQuery.data as any;

  // ── Customer data
  const customerQuery = useQuery({
    queryKey: [...keys.customersRoot, 'pi-ws', invoice?.customerId],
    queryFn: () => getOne<Customer>(COLLECTIONS.CUSTOMERS, invoice!.customerId),
    enabled: Boolean(invoice?.customerId),
    staleTime: 60_000,
  });
  const customer = customerQuery.data as Customer | undefined;

  // ── All customers (for email)
  const allCustomersQuery = useQuery({
    queryKey: keys.customersAll,
    queryFn: () => getAll<Customer>(COLLECTIONS.CUSTOMERS),
    staleTime: 60_000,
  });
  const allCustomers = (allCustomersQuery.data as Customer[]) || [];

  // ── Source order
  const orderQuery = useQuery({
    queryKey: [...keys.ordersRoot, 'pi-ws', invoice?.orderId || invoice?.sourceOrderId],
    queryFn: () => getOne<any>(COLLECTIONS.ORDERS, invoice!.orderId || invoice!.sourceOrderId),
    enabled: Boolean(invoice?.orderId || invoice?.sourceOrderId),
    staleTime: 60_000,
  });
  const sourceOrder = orderQuery.data as any;

  // ── Project (from order or invoice)
  const projectId = invoice?.projectId || sourceOrder?.projectId;
  const projectQuery = useQuery({
    queryKey: [...keys.projectsRoot, 'pi-ws', projectId],
    queryFn: () => getOne<any>(COLLECTIONS.PROJECTS, projectId),
    enabled: Boolean(projectId),
    staleTime: 60_000,
  });
  const project = projectQuery.data as any;

  // ── Source quotation (via order or direct)
  const quotationId = invoice?.quotationId || sourceOrder?.sourceQuotationId;
  const quoteQuery = useQuery({
    queryKey: [...keys.quotationsRoot, 'pi-ws', quotationId],
    queryFn: () => getOne<any>(COLLECTIONS.QUOTATIONS, quotationId),
    enabled: Boolean(quotationId),
    staleTime: 60_000,
  });
  const sourceQuotation = quoteQuery.data as any;

  // ── All invoices (for customer context)
  const allInvoicesQuery = useQuery({
    queryKey: keys.invoices,
    queryFn: () => getAll<any>(COLLECTIONS.PROFORMA_INVOICES),
    staleTime: 30_000,
  });
  const allInvoices = (allInvoicesQuery.data as any[]) || [];

  // ── Payments
  const paymentsQuery = useQuery({
    queryKey: keys.payments,
    queryFn: () => getAll<any>(COLLECTIONS.PAYMENTS),
    staleTime: 30_000,
  });
  const allPayments = (paymentsQuery.data as any[]) || [];

  // ── Dispatches
  const dispatchQuery = useQuery({
    queryKey: keys.dispatchRoot,
    queryFn: () => getAll<any>(COLLECTIONS.DISPATCH),
    staleTime: 30_000,
  });
  const allDispatches = (dispatchQuery.data as any[]) || [];

  const canEdit = perms.canEdit('invoices');
  const canDelete = perms.canDelete('invoices');

  // ── Derived data
  const status = String(invoice?.status || 'Draft');
  const paymentStatus = String(invoice?.paymentStatus || 'Pending');
  const piNumber = String(invoice?.invoiceNumber || invoice?.piNumber || invoice?.refNo || id);
  const customerName = invoice?.customer || customer?.name || '';
  const items = (invoice?.items as any[]) || [];
  const subtotal = Number(invoice?.subtotal || 0);
  const taxAmount = Number(invoice?.taxAmount || invoice?.taxTotal || 0);
  const discount = Number(invoice?.discount || 0);
  const total = Number(invoice?.total || 0);
  const itemCount = items.length;
  const paidAmount = Number(invoice?.paidAmount || invoice?.amountPaid || 0);
  const outstandingAmount = Math.max(0, total - paidAmount);
  const notes = String(invoice?.notes || '');
  const terms = String(invoice?.terms || '');
  const invoiceDate = invoice?.date || invoice?.createdAt;
  const dueDate = invoice?.dueDate || '';

  // ── Related records
  const invoicePayments = useMemo(() =>
    allPayments.filter((p: any) => p.invoiceId === invoice?.id || p.orderId === invoice?.orderId),
    [allPayments, invoice]
  );
  const invoiceDispatches = useMemo(() =>
    allDispatches.filter((d: any) => d.orderId === invoice?.orderId),
    [allDispatches, invoice]
  );

  // ── Customer's other invoices (for context)
  const customerInvoices = useMemo(() =>
    invoice?.customerId ? allInvoices.filter((pi: any) => pi.customerId === invoice.customerId && pi.id !== id) : [],
    [allInvoices, invoice, id]
  );

  // ── Status update
  const [statusUpdating, setStatusUpdating] = useState(false);
  const handleStatusChange = useCallback(async (newStatus: string) => {
    if (!invoice?.id || newStatus === status) return;
    setStatusUpdating(true);
    try {
      await updateDocById(COLLECTIONS.PROFORMA_INVOICES, invoice.id, { status: newStatus, updatedBy: user?.id });
      qc.invalidateQueries({ queryKey: [...keys.invoices, id] });
      qc.invalidateQueries({ queryKey: keys.invoices });
      toast.success(`Status updated to ${newStatus}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update status');
    } finally {
      setStatusUpdating(false);
    }
  }, [invoice, status, user, qc, keys, id]);

  // ── Email settings
  const emailSettingsQuery = useSettingsSection('email');
  const emailSettings = useMemo(() => normalizeEmailSettings(emailSettingsQuery.data as Record<string, unknown> | undefined), [emailSettingsQuery.data]);

  // ── PDF generation (client-side via DocumentTemplateResolver)
  const handlePdf = useCallback(() => {
    if (!invoice || !company) return;
    const companyConfig = company as CompanyConfig;
    const html = DocumentTemplateResolver(companyConfig, 'PROFORMA INVOICE', {
      ...invoice,
      refNo: piNumber,
      customer: customerName,
      customerAddress: customerField(customer as any, ['address']),
      customerPhone: customerField(customer as any, ['phone', 'mobile']),
      customerEmail: customerField(customer as any, ['email']),
      customerGst: customerField(customer as any, ['gst']),
      customerState: customerField(customer as any, ['state']),
    });
    triggerPrint(html);
  }, [invoice, company, customer, customerName, piNumber]);

  // ── Send email
  const handleSend = useCallback(() => {
    if (!invoice) return;
    sendQuotationEmail(
      { ...invoice, customer: customerName },
      allCustomers || [],
      { company, emailSettings },
      'quotation',
    );
  }, [invoice, customerName, allCustomers, company, emailSettings]);

  // ── Payment recording
  const [showPayment, setShowPayment] = useState(false);
  const [paymentForm, setPaymentForm] = useState<PaymentForm>({ ...PAYMENT_FORM_DEFAULT });
  const savePayment = useSavePayment(() => {
    setShowPayment(false);
    setPaymentForm({ ...PAYMENT_FORM_DEFAULT });
    qc.invalidateQueries({ queryKey: [...keys.invoices, id] });
    qc.invalidateQueries({ queryKey: keys.invoices });
    qc.invalidateQueries({ queryKey: keys.ordersRoot });
    qc.invalidateQueries({ queryKey: keys.payments });
  });

  function openPaymentForm() {
    setPaymentForm({
      ...PAYMENT_FORM_DEFAULT,
      customer: customerName,
      customerId: invoice?.customerId || '',
      orderId: invoice?.orderId || invoice?.sourceOrderId || '',
      amount: String(outstandingAmount || total),
      date: new Date().toISOString().split('0')[0],
    });
    setShowPayment(true);
  }

  function handlePaymentSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (savePayment.isPending) return;
    if (!paymentForm.customer || !paymentForm.amount) return toast.error('Customer & amount required');
    savePayment.mutate(paymentForm);
  }

  // ── Delete
  const [showDelete, setShowDelete] = useState(false);
  const handleDelete = useCallback(async () => {
    if (!invoice?.id) return;
    const { softDelete } = await import('../lib/firestore');
    const { COLLECTIONS: COLS } = await import('../lib/firebase');
    await softDelete(COLS.PROFORMA_INVOICES, invoice.id);
    qc.invalidateQueries({ queryKey: keys.invoices });
    toast.success('Proforma Invoice deleted');
    navigate('/invoices');
  }, [invoice, qc, keys, navigate]);

  // ── Mobile collapsed state
  const [mobCtxOpen, setMobCtxOpen] = useState(false);

  // ── Loading
  if (invoiceQuery.isLoading) {
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

  if (!invoice || invoiceQuery.isError) {
    return (
      <EmptyState
        title="Proforma Invoice not found"
        description="This proforma invoice does not exist or has been deleted."
        action={<Link to="/invoices"><Button variant="outline">Back to Proforma Invoices</Button></Link>}
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
        <button type="button" onClick={() => navigate('/invoices')} className="flex items-center gap-1.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors lg:hidden">
          <ArrowLeft className="h-4 w-4" /><span className="text-[11px] font-semibold">Back</span>
        </button>
        <div className="flex flex-1 items-center gap-3 sm:flex-wrap sm:gap-x-3 sm:gap-y-2">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-hover)] text-lg font-bold text-white shadow-sm ring-2 ring-[var(--color-primary-muted)] sm:h-12 sm:w-12">
            {customerName[0]?.toUpperCase() || 'P'}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="min-w-0 break-words text-base font-bold text-[var(--color-text)] sm:truncate sm:text-xl">{customerName || 'Proforma Invoice'}</h1>
              <StatusBadge status={status} />
              <StatusBadge status={paymentStatus} colors={PAYMENT_COLORS} />
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <span className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1"><FileText className="h-3 w-3" />{piNumber}</span>
              {invoiceDate && <span className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1"><Clock className="h-3 w-3" />{fmtDateSafe(invoiceDate)}</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5 sm:shrink-0">
          {custPhone && <a href={`tel:${custPhone}`} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors shadow-sm"><Phone className="h-3.5 w-3.5" /> Call</a>}
          {custPhone && <a href={`https://wa.me/${String(custPhone).replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-emerald-50 hover:text-emerald-700 transition-colors shadow-sm"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</a>}
          {custEmail && <a href={`mailto:${custEmail}`} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-blue-50 hover:text-blue-700 transition-colors shadow-sm"><Mail className="h-3.5 w-3.5" /> Email</a>}
          <button type="button" onClick={() => navigate('/invoices')} className="hidden lg:inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors shadow-sm">
            <ArrowLeft className="h-3.5 w-3.5" /> Proforma Invoices
          </button>
        </div>
      </div>

      {/* ── BODY — 3-column ── */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1.5 lg:flex-row lg:gap-2 lg:overflow-hidden lg:pr-0">

        {/* ══ LEFT PANEL — Customer / Project / Order Context ══ */}
        <div className="hidden w-full shrink-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm p-4 lg:block lg:w-[25%] lg:overflow-hidden">
          <div className="lg:h-full lg:overflow-y-auto">
            {/* Customer Information */}
            {customerName && (
              <div className="mb-4">
                <SectionHeading>Customer Information</SectionHeading>
                {invoice?.customerId ? (
                  <LeftLinkRow label="Customer" displayText={customerName} href={`/customers/${encodeURIComponent(invoice.customerId)}`} />
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

            {/* Project (if linked) */}
            {project && (
              <div className="mb-4">
                <SectionHeading>Project</SectionHeading>
                <LeftLinkRow label="Project" displayText={project.projectId || project.id} href={`/projects/${encodeURIComponent(project.id)}`} />
              </div>
            )}

            {/* Source Order */}
            {sourceOrder && (
              <div className="mb-4">
                <SectionHeading>Source Order</SectionHeading>
                <LeftLinkRow label="Order" displayText={sourceOrder.orderNumber || sourceOrder.orderNo || invoice.orderId || invoice.sourceOrderId} href={`/orders/${encodeURIComponent(invoice.orderId || invoice.sourceOrderId)}`} />
                <LeftInfoRow label="Status" value={sourceOrder.status || '—'} />
                <LeftInfoRow label="Value" value={fmtCurrency(Number(sourceOrder.total || 0))} />
              </div>
            )}

            {/* Customer's other invoices */}
            {customerInvoices.length > 0 && (
              <div className="mb-4">
                <SectionHeading>Other Proforma Invoices</SectionHeading>
                {customerInvoices.slice(0, 3).map((pi: any) => (
                  <LeftLinkRow key={pi.id} label="Invoice" displayText={pi.invoiceNumber || pi.piNumber || pi.id} href={`/invoices/${encodeURIComponent(pi.id)}`} />
                ))}
              </div>
            )}

            {/* ── Proforma Invoice Summary ── */}
            <div className="mt-4 pt-4 border-t border-[var(--color-border-subtle)]">
              <SectionHeading>Proforma Invoice Summary</SectionHeading>
              <LeftInfoRow label="PI Number" value={piNumber} />
              <LeftInfoRow label="Status" value={<StatusBadge status={status} />} />
              <LeftInfoRow label="Payment" value={<StatusBadge status={paymentStatus} colors={PAYMENT_COLORS} />} />
              <LeftInfoRow label="Items" value={`${itemCount} item${itemCount !== 1 ? 's' : ''}`} />
              <LeftInfoRow label="Total" value={fmtCurrency(total)} />
              <LeftInfoRow label="Paid" value={fmtCurrency(paidAmount)} />
              {outstandingAmount > 0 && <LeftInfoRow label="Outstanding" value={<span className="text-red-600 font-semibold">{fmtCurrency(outstandingAmount)}</span>} />}
              <LeftInfoRow label="Date" value={fmtDateSafe(invoiceDate)} />
              {dueDate && <LeftInfoRow label="Due Date" value={fmtDateSafe(dueDate)} />}
              <LeftInfoRow label="Created By" value={resolveUserName(invoice?.createdBy)} />
              {invoice?.assignedToName && <LeftInfoRow label="Assigned" value={invoice.assignedToName} />}
            </div>
          </div>
        </div>

        {/* ══ CENTER PANEL — Proforma Invoice Workspace ══ */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
          <div className="overflow-y-auto lg:h-full lg:min-h-0 lg:flex-1">
            <Suspense fallback={<div className="flex justify-center py-16 text-sm text-[var(--color-text-muted)]">Loading...</div>}>
              <div className="p-4 sm:p-5 space-y-4">

                {/* Mobile: Context (collapsed) */}
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 shadow-sm lg:hidden">
                  <CollapsedRow label="Customer & Context" icon={<User className="h-3.5 w-3.5" />} open={mobCtxOpen} onToggle={() => setMobCtxOpen((v) => !v)}>
                    <div className="space-y-1.5 text-[13px]">
                      {invoice?.customerId && (
                        <a href={`/customers/${encodeURIComponent(invoice.customerId)}`} className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-primary)] hover:underline mb-2">
                          View customer profile <ArrowUpRight className="h-3 w-3 shrink-0" />
                        </a>
                      )}
                      <div className="flex justify-between gap-3"><span className="text-[var(--color-text-muted)]">Name</span><span className="truncate font-semibold text-[var(--color-text)]">{customerName}</span></div>
                      {custType && <div className="flex justify-between gap-3"><span className="text-[var(--color-text-muted)]">Type</span><span className="truncate font-semibold text-[var(--color-text)]">{custType}</span></div>}
                      {custPhone && <div className="flex justify-between gap-3"><span className="text-[var(--color-text-muted)]">Phone</span><span className="truncate font-semibold text-[var(--color-text)]">{custPhone}</span></div>}
                      {project && <LeftLinkRow label="Project" displayText={project.projectId || project.id} href={`/projects/${encodeURIComponent(project.id)}`} />}
                      {sourceOrder && <LeftLinkRow label="Order" displayText={sourceOrder.orderNumber || invoice.orderId} href={`/orders/${encodeURIComponent(invoice.orderId || invoice.sourceOrderId)}`} />}
                    </div>
                  </CollapsedRow>
                </div>

                {/* ── PROFORMA INVOICE INFORMATION ── */}
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
                  <SectionHeading>Proforma Invoice Information</SectionHeading>
                  <div className="mt-3">
                    <InfoGrid>
                      <InfoField label="PI Number" value={piNumber} />
                      <InfoField label="Status" value={<StatusBadge status={status} />} />
                      <InfoField label="Payment" value={<StatusBadge status={paymentStatus} colors={PAYMENT_COLORS} />} />
                      <InfoField label="Date" value={fmtDateSafe(invoiceDate)} />
                      {dueDate && <InfoField label="Due Date" value={fmtDateSafe(dueDate)} />}
                      <InfoField label="Payment Mode" value={invoice?.paymentMode || invoice?.paymentMethod || undefined} />
                      <InfoField label="Assigned To" value={invoice?.assignedToName || resolveUserName(invoice?.assignedToId)} />
                      <InfoField label="Created By" value={resolveUserName(invoice?.createdBy)} />
                      {invoice?.caseId && <InfoField label="Case ID" value={invoice.caseId} />}
                    </InfoGrid>
                  </div>
                </div>

                {/* ── ITEMS TABLE ── */}
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm overflow-hidden">
                  <div className="px-5 pt-5 pb-3">
                    <SectionHeading>Proforma Invoice Items</SectionHeading>
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
                                </td>
                                <td className="px-4 py-2.5 text-right">{item.qty || item.quantity || '0'}</td>
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

                {/* ── PRICING SUMMARY ── */}
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
                  <SectionHeading>Pricing Summary</SectionHeading>
                  <div className="mt-3 space-y-2 max-w-xs ml-auto">
                    <div className="flex justify-between text-[12px]"><span className="text-[var(--color-text-muted)]">Subtotal</span><span className="font-medium">{fmtCurrency(subtotal)}</span></div>
                    {discount > 0 && <div className="flex justify-between text-[12px]"><span className="text-[var(--color-text-muted)]">Discount</span><span className="font-medium text-red-600">−{fmtCurrency(discount)}</span></div>}
                    {taxAmount > 0 && <div className="flex justify-between text-[12px]"><span className="text-[var(--color-text-muted)]">Tax</span><span className="font-medium">{fmtCurrency(taxAmount)}</span></div>}
                    <div className="flex justify-between text-[14px] font-bold border-t border-[var(--color-border-subtle)] pt-2"><span>Grand Total</span><span className="text-[var(--color-primary)]">{fmtCurrency(total)}</span></div>
                    <div className="flex justify-between text-[12px] border-t border-[var(--color-border-subtle)] pt-2"><span className="text-[var(--color-text-muted)]">Paid</span><span className="font-medium text-emerald-600">{fmtCurrency(paidAmount)}</span></div>
                    {outstandingAmount > 0 && <div className="flex justify-between text-[12px]"><span className="text-[var(--color-text-muted)]">Outstanding</span><span className="font-semibold text-red-600">{fmtCurrency(outstandingAmount)}</span></div>}
                  </div>
                </div>

                {/* ── TERMS ── */}
                {terms && (
                  <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
                    <SectionHeading>Terms & Conditions</SectionHeading>
                    <p className="mt-2 text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap leading-relaxed">{terms}</p>
                  </div>
                )}

                {/* ── NOTES ── */}
                {notes && (
                  <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
                    <SectionHeading>Notes</SectionHeading>
                    <p className="mt-2 text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap leading-relaxed">{notes}</p>
                  </div>
                )}
              </div>
            </Suspense>

            {/* ══ MOBILE: Quick Actions ══ */}
            <div className="lg:hidden p-4 space-y-3">
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                <h3 className="mb-3 text-[11px] font-extrabold uppercase tracking-widest text-[var(--color-text)]">Quick Actions</h3>
                <div className="grid grid-cols-2 gap-1.5">
                  {canEdit && (
                    <QuickAction icon={<CreditCard className="h-4 w-4" />} label="Payment" onClick={openPaymentForm} />
                  )}
                  <QuickAction icon={<Download className="h-4 w-4" />} label="PDF" onClick={() => {
                    handlePdf()
                  }} />
                  {invoice?.orderId && <QuickAction icon={<ShoppingCart className="h-4 w-4" />} label="Order" onClick={() => navigate(`/orders/${encodeURIComponent(invoice.orderId)}`)} />}
                  {canEdit && <QuickAction icon={<Send className="h-4 w-4" />} label="Send" onClick={handleSend} />}
                  {project && <QuickAction icon={<Package className="h-4 w-4" />} label="Project" onClick={() => navigate(`/projects/${encodeURIComponent(project.id)}`)} />}
                </div>
                {/* Status control */}
                {canEdit && (
                  <div className="mt-2 flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] shrink-0">Status</span>
                    <div className="relative flex-1">
                      <select value={status} onChange={(e) => handleStatusChange(e.target.value)} disabled={statusUpdating}
                        className="w-full appearance-none rounded-md border border-[var(--color-border)] bg-[var(--color-bg-sunken)] px-2.5 py-1.5 pr-7 text-[11px] font-semibold text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] disabled:opacity-50 cursor-pointer">
                        {['Draft', 'Sent', 'Paid', 'Partially Paid', 'Overdue', 'Cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--color-text-muted)]" />
                    </div>
                    {statusUpdating && <Loader2 className="h-3 w-3 animate-spin text-[var(--color-primary)]" />}
                  </div>
                )}
              </div>

              {/* Linked Records */}
              {(invoice?.customerId || invoice?.orderId || invoice?.quotationId || projectId) && (
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                  <h3 className="mb-3 text-[11px] font-extrabold uppercase tracking-widest text-[var(--color-text)]">Linked Records</h3>
                  <div className="space-y-1.5">
                    {invoice?.customerId && <a href={`/customers/${encodeURIComponent(String(invoice.customerId))}`} className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-left hover:border-[var(--color-primary)] transition-colors"><span className="text-[11px] text-[var(--color-text-secondary)]">Customer</span><span className="text-[11px] font-semibold text-[var(--color-primary)]">→</span></a>}
                    {invoice?.orderId && <a href={`/orders/${encodeURIComponent(String(invoice.orderId))}`} className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-left hover:border-[var(--color-primary)] transition-colors"><span className="text-[11px] text-[var(--color-text-secondary)]">Order</span><span className="text-[11px] font-semibold text-[var(--color-primary)]">→</span></a>}
                    {quotationId && <a href={`/quotations/${encodeURIComponent(String(quotationId))}`} className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-left hover:border-[var(--color-primary)] transition-colors"><span className="text-[11px] text-[var(--color-text-secondary)]">Quotation</span><span className="text-[11px] font-semibold text-[var(--color-primary)]">→</span></a>}
                    {projectId && <a href={`/projects/${encodeURIComponent(String(projectId))}`} className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-left hover:border-[var(--color-primary)] transition-colors"><span className="text-[11px] text-[var(--color-text-secondary)]">Project</span><span className="text-[11px] font-semibold text-[var(--color-primary)]">→</span></a>}
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

              {/* Row 1: Record Payment | PDF */}
              <div className="grid grid-cols-2 gap-1.5">
                {canEdit && (
                  <QuickAction icon={<CreditCard className="h-4 w-4" />} label="Payment" onClick={openPaymentForm} />
                )}
                <QuickAction icon={<Download className="h-4 w-4" />} label="PDF" onClick={() => {
                  handlePdf()
                }} />
              </div>

              {/* Row 2: Send | Order */}
              <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                {canEdit && <QuickAction icon={<Send className="h-4 w-4" />} label="Send" onClick={handleSend} />}
                {invoice?.orderId && (
                  <QuickAction icon={<ShoppingCart className="h-4 w-4" />} label="Order" onClick={() => navigate(`/orders/${encodeURIComponent(invoice.orderId)}`)} />
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
                        {['Draft', 'Sent', 'Paid', 'Partially Paid', 'Overdue', 'Cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
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
                {invoice?.customerId && <a href={`/customers/${encodeURIComponent(String(invoice.customerId))}`} className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-left hover:border-[var(--color-primary)] transition-colors"><span className="text-[11px] text-[var(--color-text-secondary)]">Customer</span><span className="text-[11px] font-semibold text-[var(--color-primary)]">→</span></a>}
                {invoice?.orderId && <a href={`/orders/${encodeURIComponent(String(invoice.orderId))}`} className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-left hover:border-[var(--color-primary)] transition-colors"><span className="text-[11px] text-[var(--color-text-secondary)]">Order</span><span className="text-[11px] font-semibold text-[var(--color-primary)]">→</span></a>}
                {quotationId && <a href={`/quotations/${encodeURIComponent(String(quotationId))}`} className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-left hover:border-[var(--color-primary)] transition-colors"><span className="text-[11px] text-[var(--color-text-secondary)]">Quotation</span><span className="text-[11px] font-semibold text-[var(--color-primary)]">→</span></a>}
                {projectId && <a href={`/projects/${encodeURIComponent(String(projectId))}`} className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-left hover:border-[var(--color-primary)] transition-colors"><span className="text-[11px] text-[var(--color-text-secondary)]">Project</span><span className="text-[11px] font-semibold text-[var(--color-primary)]">→</span></a>}
                {invoicePayments.length > 0 && <a href={`/payments?invoiceId=${encodeURIComponent(id)}`} className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-left hover:border-[var(--color-primary)] transition-colors"><span className="text-[11px] text-[var(--color-text-secondary)]">Payments ({invoicePayments.length})</span><span className="text-[11px] font-semibold text-[var(--color-primary)]">→</span></a>}
                {invoiceDispatches.length > 0 && <a href={`/dispatch?orderId=${encodeURIComponent(invoice?.orderId || '')}`} className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-left hover:border-[var(--color-primary)] transition-colors"><span className="text-[11px] text-[var(--color-text-secondary)]">Dispatches ({invoiceDispatches.length})</span><span className="text-[11px] font-semibold text-[var(--color-primary)]">→</span></a>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── FOOTER ── */}
      <div className="flex shrink-0 flex-col gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm px-3 py-2 sm:px-4 lg:flex-row lg:flex-wrap lg:items-center lg:gap-3 lg:py-1.5">
        <div className="flex w-full items-center justify-between gap-2 sm:gap-3 lg:flex-1">
          <button type="button" onClick={() => { const idx = allInvoices.findIndex((pi: any) => pi.id === id); if (idx > 0) navigate(`/invoices/${encodeURIComponent(allInvoices[idx - 1].id)}`); }}
            disabled={allInvoices.findIndex((pi: any) => pi.id === id) <= 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2 text-[12px] font-semibold text-[var(--color-text-secondary)] shadow-sm disabled:opacity-40 disabled:cursor-not-allowed hover:-translate-y-0.5 hover:shadow-md transition-all">
            ← Previous
          </button>
          <span className="text-[11px] text-[var(--color-text-muted)]">{allInvoices.findIndex((pi: any) => pi.id === id) + 1} of {allInvoices.length}</span>
          <button type="button" onClick={() => { const idx = allInvoices.findIndex((pi: any) => pi.id === id); if (idx >= 0 && idx < allInvoices.length - 1) navigate(`/invoices/${encodeURIComponent(allInvoices[idx + 1].id)}`); }}
            disabled={allInvoices.findIndex((pi: any) => pi.id === id) >= allInvoices.length - 1}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2 text-[12px] font-semibold text-[var(--color-text-secondary)] shadow-sm disabled:opacity-40 disabled:cursor-not-allowed hover:-translate-y-0.5 hover:shadow-md transition-all">
            Next →
          </button>
        </div>
      </div>

      {/* Delete confirmation */}
      <Modal open={showDelete} onClose={() => setShowDelete(false)} title="Delete Proforma Invoice" size="sm">
        <p className="text-sm text-[var(--color-text-secondary)]">Delete this proforma invoice permanently? This cannot be undone.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowDelete(false)}>Cancel</Button>
          <Button variant="danger" size="sm" onClick={handleDelete}>Delete</Button>
        </div>
      </Modal>

      {/* Record Payment modal */}
      <Modal open={showPayment} onClose={() => setShowPayment(false)} title="Record Payment" size="sm">
        <form onSubmit={handlePaymentSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Customer</label>
            <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">{customerName}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Amount (₹)</label>
              <input type="number" min="0" required value={paymentForm.amount} onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Date</label>
              <input type="date" value={paymentForm.date} onChange={(e) => setPaymentForm((f) => ({ ...f, date: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Payment Mode</label>
              <select value={paymentForm.mode} onChange={(e) => setPaymentForm((f) => ({ ...f, mode: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]">
                {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Status</label>
              <select value={paymentForm.status} onChange={(e) => setPaymentForm((f) => ({ ...f, status: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]">
                {PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Reference / UTR / Cheque No.</label>
            <input value={paymentForm.reference} onChange={(e) => setPaymentForm((f) => ({ ...f, reference: e.target.value }))} placeholder="Transaction reference"
              className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Notes</label>
            <textarea value={paymentForm.notes} onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))} rows={2}
              className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setShowPayment(false)}>Cancel</Button>
            <Button type="submit" loading={savePayment.isPending}>Record Payment</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
