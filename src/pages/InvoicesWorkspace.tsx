import React from 'react';
import { useEffect, useState, useMemo, useCallback, useRef, useDeferredValue } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAll, getOne, updateDocById, deleteDocById, genId, fmtDate, fmtCurrency } from '../lib/firestore';
import { COLLECTIONS, db } from '../lib/firebase';
import { PAYMENT_STATUSES, PAYMENT_MODES } from '../config/company';
import {
  Card,
  CardHeader,
  Pagination,
  PremiumKpi,
  Select as UiSelect,
  Table,
  Thead,
  Th,
  Tbody,
  Tr,
  Td,
  SkeletonRows,
  UniversalCheckbox,
  WorkspaceHero,
} from '../components/ui';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/shared';
import { InvoiceItemsDisplay } from '../features/invoices/components/InvoiceItemsDisplay';
import { statusBadge } from '../components/ui/Badge';
import { Modal, ConfirmDialog } from '../components/ui/Modal';
import { Input, Select, Textarea, FormRow, FormSection } from '../components/ui/Input';
import { Plus, Trash2, Download, CheckCircle2, Edit2, FileText, RefreshCw, X, AlertTriangle, Clock } from 'lucide-react';
import { InvoiceDetailModal } from '../features/invoices/components/InvoiceDetailModal';
import toast from 'react-hot-toast';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAppStore, useCurrentUser } from '../store/useAppStore';
import { useSettingsSection } from '../features/settings/hooks/useSettingsSection';
import { buildEmailComposePayload, normalizeEmailSettings, openGmailCompose } from '../features/settings/emailRuntime';
import type { EmailTemplateKey } from '../features/settings/types';
import { getProductHistory } from '../lib/pricingEngine';
import { queryKeys } from '../lib/queryKeys';
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { sanitizePayload } from '../lib/sanitizer';
import { notifyRoleUsers } from '../lib/notifications';
import { getNextDocumentNumber, resolveDocumentDefaults } from '../lib/documentNumbering';
import { canDo } from '../lib/permissions';
import { NotificationType } from '../types';

const PER_PAGE = 10;
const FORM0 = { orderId:'', customer:'', customerId:'', date:'', dueDate:'', status:'Draft', paymentStatus:'Pending', paymentMode:'', subtotal:'0', taxAmount:'0', discount:'0', total:'0', notes:'' };
const roundMoney = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

function toDateValue(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatInvoiceDate(value: any): string {
  const date = toDateValue(value);
  return date ? date.toLocaleDateString('en-GB') : '—';
}

function formatInvoiceTime(value: any): string {
  const date = toDateValue(value);
  return date ? date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }) : '—';
}

function daysAgoText(value: any): string {
  const date = toDateValue(value);
  if (!date) return 'Not available';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const then = new Date(date); then.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((today.getTime() - then.getTime()) / 86400000));
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function invoiceDisplayNumber(inv: any): string {
  return String(inv?.invoiceNumber || inv?.piNumber || '').trim() || '—';
}

function invoiceEmail(invoice: any, customers: any[]) {
  const customer = customers.find((entry) => entry.id === invoice.customerId);
  return invoice.customerEmail || invoice.email || customer?.email || customer?.businessEmail || '';
}

function recencyDotClass(value: any): string {
  const date = toDateValue(value);
  if (!date) return 'bg-[var(--color-text-disabled)]';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const created = new Date(date); created.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((today.getTime() - created.getTime()) / 86400000));
  if (days === 0) return 'bg-emerald-500';
  if (days <= 7) return 'bg-blue-500';
  if (days <= 30) return 'bg-amber-500';
  return 'bg-red-500';
}

function isRowOpenIgnored(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button,a,input,select,textarea,[data-action],[data-dropdown],[data-interactive]'));
}

function downloadInvoicesCsv(rows: any[], filename: string) {
  const headers = ['Invoice No', 'Order No', 'Customer', 'Date', 'Due Date', 'Total', 'Payment Status', 'Invoice Status'];
  const lines = rows.map((inv) => [
    invoiceDisplayNumber(inv),
    String(inv.orderNumber || inv.orderNo || '—'),
    inv.customer || '',
    inv.date || '',
    inv.dueDate || '',
    inv.total ?? '',
    inv.paymentStatus || '',
    inv.status || '',
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  const csv = [headers.join(','), ...lines].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

const INVOICE_DATE_RANGES = [
  { label: 'All Time', value: 'all' },
  { label: 'Today', value: 'today' },
  { label: '7 Days', value: '7d' },
  { label: '30 Days', value: '30d' },
  { label: '90 Days', value: '90d' },
  { label: 'Custom', value: 'custom' },
];

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function inDateRange(value: unknown, range: string, customFrom?: string, customTo?: string) {
  if (range === 'all') return true;
  const date = toDateValue(value);
  if (!date) return false;
  const now = new Date();
  if (range === 'today') return date >= startOfDay(now);
  if (range === '7d') return date >= new Date(Date.now() - 7 * 86400000);
  if (range === '30d') return date >= new Date(Date.now() - 30 * 86400000);
  if (range === '90d') return date >= new Date(Date.now() - 90 * 86400000);
  if (range === 'custom') {
    const from = customFrom ? startOfDay(new Date(customFrom)) : null;
    const to = customTo ? startOfDay(new Date(customTo)) : null;
    if (to) to.setDate(to.getDate() + 1);
    return (!from || date >= from) && (!to || date < to);
  }
  return true;
}

function isToday(value: unknown) {
  const date = toDateValue(value);
  if (!date) return false;
  return date.toDateString() === new Date().toDateString();
}

async function doPrint(inv: any, fallbackCompany: any) {
  const toastId = toast.loading('Generating Document...');
  try {
    const fullCompany = await getOne(COLLECTIONS.COMPANIES, inv.companyId || fallbackCompany.id) || fallbackCompany;
    const { DocumentTemplateResolver, triggerPrint } = await import('../templates/documents/resolver');
    const docType = inv.templateUsed ? 'PROFORMA INVOICE' : 'INVOICE';
    const html = DocumentTemplateResolver(fullCompany, docType, inv);
    triggerPrint(html);
    toast.success('Document ready', { id: toastId });
  } catch (e: any) {
    toast.error('Failed to generate document: ' + e.message, { id: toastId });
  }
}

type InvoicePageBoundaryProps = { children: React.ReactNode };
type InvoicePageBoundaryState = { hasError: boolean };

class InvoicePageBoundary extends React.Component<InvoicePageBoundaryProps, InvoicePageBoundaryState> {
  state: InvoicePageBoundaryState = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('[InvoicesPageBoundary]', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-enterprise-surface)]">
          <p className="text-sm font-semibold text-[var(--color-text)]">Invoices page error was contained.</p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">This route can be reopened without affecting the rest of the ERP.</p>
          <button
            type="button"
            className="mt-4 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-foreground)]"
            onClick={() => window.location.reload()}
          >
            Reload invoices
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

type InvoiceModalBoundaryProps = {
  children: React.ReactNode;
  onFatalError: (error: Error) => void;
};
type InvoiceModalBoundaryState = { hasError: boolean };

class InvoiceModalBoundary extends React.Component<InvoiceModalBoundaryProps, InvoiceModalBoundaryState> {
  state: InvoiceModalBoundaryState = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    this.props.onFatalError(error);
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

export default function Invoices() {
  const qc = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const { company } = useAppStore();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const qkeys = queryKeys.forCompany(activeCompanyId);
  const user = useCurrentUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const openParam = searchParams.get('open') || '';
  const createParam = searchParams.get('create') || '';
  // Set only when arriving from the Customer Workspace's Generate Invoice
  // modal (CustomerInvoiceModal.tsx) — pre-selects the order the operator
  // already chose there instead of landing on a blank form.
  const prefillOrderIdParam = searchParams.get('orderId') || '';
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const deferredSearch = useDeferredValue(search);
  const [statusF, setStatusF] = useState(() => searchParams.get('status') || '');
  const [paymentF, setPaymentF] = useState(() => searchParams.get('payment') || '');
  const [assignedF, setAssignedF] = useState(() => searchParams.get('assigned') || '');
  const [dateRange, setDateRange] = useState(() => searchParams.get('date') || 'all');
  const [customFrom, setCustomFrom] = useState(() => searchParams.get('from') || '');
  const [customTo, setCustomTo] = useState(() => searchParams.get('to') || '');
  const [activeKpi, setActiveKpi] = useState(() => searchParams.get('kpi') || '');
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [perPage, setPerPage] = useState(() => Math.max(1, Number(searchParams.get('perPage')) || PER_PAGE));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string|null>(null);
  const [form, setForm] = useState({...FORM0});
  const [viewItem, setViewItem] = useState<any>(null);
  const [delId, setDelId] = useState<string|null>(null);
  const [showBulkStatus, setShowBulkStatus] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');
  const safeSelected = selected ?? new Set<string>();
  const selectedCount = safeSelected.size;
  const safeViewItem = viewItem && typeof viewItem === 'object' ? viewItem : null;

  function syncQueueParams(nextState: {
    q?: string;
    status?: string;
    payment?: string;
    assigned?: string;
    date?: string;
    from?: string;
    to?: string;
    kpi?: string;
    page?: number;
    perPage?: number;
  }) {
    const next = new URLSearchParams(searchParams);
    const q = nextState.q ?? search;
    const status = nextState.status ?? statusF;
    const payment = nextState.payment ?? paymentF;
    const date = nextState.date ?? dateRange;
    const from = nextState.from ?? customFrom;
    const to = nextState.to ?? customTo;
    const kpi = nextState.kpi ?? activeKpi;
    const nextPage = nextState.page ?? page;
    const nextPerPage = nextState.perPage ?? perPage;

    if (q) next.set('q', q); else next.delete('q');
    if (status) next.set('status', status); else next.delete('status');
    if (payment) next.set('payment', payment); else next.delete('payment');
    if (nextState.assigned !== undefined) { if (nextState.assigned) next.set('assigned', nextState.assigned); else next.delete('assigned'); }
    else { if (assignedF) next.set('assigned', assignedF); else next.delete('assigned'); }
    if (date && date !== 'all') next.set('date', date); else next.delete('date');
    if (from) next.set('from', from); else next.delete('from');
    if (to) next.set('to', to); else next.delete('to');
    if (kpi) next.set('kpi', kpi); else next.delete('kpi');
    if (nextPage > 1) next.set('page', String(nextPage)); else next.delete('page');
    if (nextPerPage !== PER_PAGE) next.set('perPage', String(nextPerPage)); else next.delete('perPage');
    // Note: 'open' param is NOT touched by syncQueueParams.
    // Only openInvoice / closeInvoiceDetails manage the 'open' param directly.
    setSearchParams(next, { replace: true });
  }


  function openInvoice(inv: any, replace = false) {
    userClosedRef.current = false; // User intentionally opened — reset guard
    setViewItem(inv);
    if (!inv?.id) return;
    const next = new URLSearchParams(searchParams);
    next.set('open', inv.id);
    if (search) next.set('q', search); else next.delete('q');
    if (statusF) next.set('status', statusF); else next.delete('status');
    if (paymentF) next.set('payment', paymentF); else next.delete('payment');
    if (assignedF) next.set('assigned', assignedF); else next.delete('assigned');
    if (dateRange && dateRange !== 'all') next.set('date', dateRange); else next.delete('date');
    if (customFrom) next.set('from', customFrom); else next.delete('from');
    if (customTo) next.set('to', customTo); else next.delete('to');
    if (activeKpi) next.set('kpi', activeKpi); else next.delete('kpi');
    if (page > 1) next.set('page', String(page)); else next.delete('page');
    if (perPage !== PER_PAGE) next.set('perPage', String(perPage)); else next.delete('perPage');
    setSearchParams(next, { replace });
  }

  function openCreateForm() {
    closeInvoiceDetails();
    setForm({ ...FORM0, date: new Date().toISOString().split('T')[0] });
    setItems([]);
    setEditId(null);
    setShowForm(true);
  }
  const { data: invoices=[], isLoading, refetch } = useQuery({ queryKey:qkeys.invoices, queryFn:()=>getAll(COLLECTIONS.PROFORMA_INVOICES), staleTime:30000 });
  const { data: orders=[] }    = useQuery({ queryKey:qkeys.ordersAll,    queryFn:()=>getAll(COLLECTIONS.ORDERS),    staleTime:60000 });
  const { data: customers=[] } = useQuery({ queryKey:qkeys.customersAll, queryFn:()=>getAll(COLLECTIONS.CUSTOMERS), staleTime:60000 });
  const { data: products=[] }  = useQuery({ queryKey:qkeys.productsAll,  queryFn:()=>getAll(COLLECTIONS.PRODUCTS),  staleTime:60000 });
  const { data: users=[] } = useQuery({ queryKey:queryKeys.global.users, queryFn:()=>getAll(COLLECTIONS.USERS), staleTime:300000 });
  const emailSettingsQuery = useSettingsSection('email');
  const emailSettings = useMemo(() => normalizeEmailSettings(emailSettingsQuery.data as Record<string, unknown> | undefined), [emailSettingsQuery.data]);
  const orderNumberById = useMemo(() => {
    const map = new Map<string, string>();
    (orders as any[]).forEach((order: any) => {
      map.set(String(order.id), String(order?.orderNumber || order?.orderNo || '').trim() || '—');
    });
    return map;
  }, [orders]);

  const [items, setItems] = useState<any[]>([]);
  const subtotal = useMemo(()=>items.reduce((s,i)=>s+(Number(i.qty)||0)*(Number(i.price)||0),0),[items]);
  const taxAmount = useMemo(()=>items.reduce((s,i)=>s+(Number(i.qty)||0)*(Number(i.price)||0)*(Number(i.tax)||0)/100,0),[items]);
  const discount = Number(form.discount)||0;
  const grandTotal = subtotal + taxAmount - discount;

  function sendInvoiceEmail(invoice: any, templateKey: EmailTemplateKey = 'invoice') {
    const recipient = invoiceEmail(invoice, customers as any[]);
    const result = buildEmailComposePayload({
      templateKey,
      settings: emailSettings,
      recipientEmail: recipient,
      variables: {
        customerName: invoice.customer || invoice.customerName || (customers as any[]).find((item: any) => item.id === invoice.customerId)?.name || '',
        companyName: company?.name || '',
        invoiceNumber: invoiceDisplayNumber(invoice),
        orderNumber: orderNumberById.get(String(invoice.orderId)) || String(invoice.orderNumber || invoice.orderNo || ''),
        invoiceDate: fmtDate(invoice.date || invoice.createdAt),
        dueDate: fmtDate(invoice.dueDate),
        totalAmount: fmtCurrency(invoice.total || 0, company.currencySymbol),
      },
    });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    const opened = openGmailCompose(result.payload.url);
    if (!opened) {
      toast.error('Could not open Gmail compose. Please allow pop-ups and try again.');
      return false;
    }
    toast.success('Email compose opened');
    return true;
  }

  useEffect(() => {
    const order = (location.state as any)?.prefillOrder;
    if (!order) return;
    setForm({
      ...FORM0,
      orderId: order.id || '',
      customer: order.customer || '',
      customerId: order.customerId || '',
      date: new Date().toISOString().split('T')[0],
      dueDate: '',
      subtotal: String(order.subtotal || 0),
      taxAmount: String(order.taxAmount || order.taxTotal || 0),
      discount: String(order.discount || 0),
      total: String(order.total || 0),
    });
    setItems(order.items || []);
    setEditId(null);
    setShowForm(true);
    window.history.replaceState({}, document.title);
  }, [location.state]);

  function addItem() { setItems(prev=>[...prev,{productId:'',product:'',qty:1,price:0,tax:0,unit:'PCS',total:0}]); }
  function updateItem(idx:number, key:string, val:any) {
    setItems(prev=>prev.map((it,i)=>{ 
      if(i!==idx) return it; 
      const updated={...it,[key]:val}; 
      if(key==='productId'){
        const p=products.find((x:any)=>x.id===val);
        if(p){
          updated.product=(p as any).name;
          updated.hsn=(p as any).hsn||'';
          updated.unit=(p as any).unit||'PCS';
          
          const history = getProductHistory(orders, form.customerId, p.id);
          if (history) {
            updated.price = history.price;
            updated.tax = history.tax || (p as any).tax || 0;
            updated.historyText = `Last sold @ ${fmtCurrency(history.price, company.currencySymbol)}`;
          } else {
            updated.price = (p as any).price || 0;
            updated.tax = (p as any).tax || 0;
            updated.historyText = '';
          }
        }
      } 
      updated.total=(Number(updated.qty)||0)*(Number(updated.price)||0); 
      return updated; 
    }));
  }
  function removeItem(idx:number) { setItems(prev=>prev.filter((_,i)=>i!==idx)); }

  const save = useMutation({
    mutationFn: async (d:typeof FORM0) => {
      const payload = {...d, items, subtotal, taxAmount, discount, total:grandTotal};
      if (editId) {
        await updateDocById(COLLECTIONS.PROFORMA_INVOICES, editId, payload);
        await notifyRoleUsers(
          ['Accounts', 'Director'],
          NotificationType.INVOICE_UPDATED,
          'Invoice updated',
          `Invoice ${editId} was updated for ${d.customer || 'customer'}.`,
          'invoice',
          editId,
          activeCompanyId
        );
        return { ...payload, id: editId };
      }
      else {
        const documentDefaults = await resolveDocumentDefaults(company.id);
        const id=genId.invoice(company.invoicePrefix);
        const { documentNumber } = await getNextDocumentNumber(company.id, 'invoice');
        await runTransaction(db, async (transaction) => {
          const orderRef = doc(db, COLLECTIONS.ORDERS, d.orderId);
          const orderSnap = await transaction.get(orderRef);
          if (!orderSnap.exists()) {
            throw new Error(`Order ${d.orderId} not found`);
          }

          const order = orderSnap.data() as any;
          if (order.companyId !== activeCompanyId) {
            throw new Error(`Order ${d.orderId} does not belong to the active company`);
          }
          if (order.status === 'Cancelled') {
            throw new Error(`Order ${d.orderId} is cancelled and cannot be invoiced`);
          }

          const orderTotal = roundMoney(Number(order.total) || 0);
          const currentInvoiced = roundMoney(Number(order.totalInvoiced) || 0);
          const invoiceTotal = roundMoney(grandTotal);
          const pendingBilling = roundMoney(
            order.pendingBilling === undefined
              ? Math.max(0, orderTotal - currentInvoiced)
              : Number(order.pendingBilling) || 0
          );

          if (order.piGenerated && Array.isArray(order.generatedPIs) && order.generatedPIs.length > 0) {
            throw new Error(`Order ${d.orderId} already has generated invoice(s)`);
          }
          if (invoiceTotal <= 0) {
            throw new Error('Invoice total must be greater than zero');
          }
          if (pendingBilling <= 0) {
            throw new Error(`Order ${d.orderId} has no pending billing`);
          }
          if (invoiceTotal > pendingBilling) {
            throw new Error(`Invoice total exceeds pending billing. Pending: ${pendingBilling}`);
          }

          const invoiceRef = doc(db, COLLECTIONS.PROFORMA_INVOICES, id);
          const invoiceSnap = await transaction.get(invoiceRef);
          if (invoiceSnap.exists()) {
            throw new Error(`Invoice ${id} already exists`);
          }

          const nextInvoiced = roundMoney(currentInvoiced + invoiceTotal);
          const nextPendingBilling = roundMoney(Math.max(0, orderTotal - nextInvoiced));

          transaction.set(invoiceRef, sanitizePayload({
            ...payload,
            id,
            invoiceNumber: documentNumber,
            piNumber: documentNumber,
            refNo: documentNumber,
            sourceOrderId: d.orderId,
            companyId: activeCompanyId,
            notes: payload.notes || documentDefaults.settings.defaultNotes,
            terms: documentDefaults.settings.defaultTerms,
            createdBy: user.id,
            updatedBy: user.id,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            isDeleted: false,
          }));
          transaction.set(orderRef, sanitizePayload({
            piGenerated: nextPendingBilling <= 0,
            generatedPIs: [...(Array.isArray(order.generatedPIs) ? order.generatedPIs : []), id],
            totalInvoiced: nextInvoiced,
            pendingBilling: nextPendingBilling,
            updatedBy: user.id,
            updatedAt: serverTimestamp(),
          }), { merge: true });
        });
        await notifyRoleUsers(
          ['Accounts', 'Director'],
          NotificationType.PI_GENERATED,
          'Invoice generated',
          `Invoice ${documentNumber} was generated for order ${d.orderId}.`,
          'invoice',
          id,
          activeCompanyId
        );
        return {
          ...payload,
          id,
          invoiceNumber: documentNumber,
          piNumber: documentNumber,
          refNo: documentNumber,
          sourceOrderId: d.orderId,
          companyId: activeCompanyId,
          createdBy: user.id,
        };
      }
    },
    onSuccess: (savedInvoice: any) => {
      qc.invalidateQueries({queryKey:qkeys.invoices});
      toast.success(editId?'Updated':'Invoice created');
      closeForm();
      if (savedInvoice?.id) openInvoice(savedInvoice, true);
    },
    onError: (e:any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async (id:string) => {
      await deleteDocById(COLLECTIONS.PROFORMA_INVOICES,id);
      await notifyRoleUsers(['Accounts', 'Director'], NotificationType.INVOICE_DELETED, 'Invoice deleted', `Invoice ${id} was deleted.`, 'invoice', id, activeCompanyId);
    },
    onSuccess:()=>{qc.invalidateQueries({queryKey:qkeys.invoices});toast.success('Deleted');setDelId(null);setSelected(new Set());}
  });

  const bulkSendMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length !== 1) throw new Error('Select exactly one invoice to open Gmail compose.');
      const invoice = invoices.find((entry: any) => entry.id === ids[0]);
      if (!invoice) throw new Error('Invoice not found');
      const opened = sendInvoiceEmail(invoice, 'invoice');
      if (!opened) throw new Error('Unable to open Gmail compose.');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkeys.invoices });
      toast.success('Email compose opened');
      setSelected(new Set());
    },
    onError: (e: any) => toast.error(e.message),
  });
  const bulkMarkPaidMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => updateDocById(COLLECTIONS.PROFORMA_INVOICES, id, { paymentStatus: 'Paid', paidAt: new Date().toISOString() })));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkeys.invoices });
      toast.success(`Marked ${selected.size} invoices paid`);
      setSelected(new Set());
    },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => deleteDocById(COLLECTIONS.PROFORMA_INVOICES, id)));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkeys.invoices });
      toast.success(`Deleted ${selected.size} invoices`);
      setSelected(new Set());
    },
    onError: (e: any) => toast.error(e.message),
  });

  const sendInvoiceMutation = useMutation({
    mutationFn: async (id: string) => {
      const invoice = invoices.find((entry: any) => entry.id === id) || safeViewItem;
      if (!invoice) throw new Error('Invoice not found');
      const opened = sendInvoiceEmail(invoice, 'invoice');
      if (!opened) throw new Error('Unable to open Gmail compose.');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkeys.invoices });
      toast.success('Email compose opened');
      closeInvoiceDetails();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const markPaidMutation = useMutation({
    mutationFn: async (id: string) => updateDocById(COLLECTIONS.PROFORMA_INVOICES, id, { paymentStatus: 'Paid', paidAt: new Date().toISOString() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkeys.invoices });
      toast.success('Invoice marked paid');
      closeInvoiceDetails();
    },
    onError: (e: any) => toast.error(e.message),
  });

  function duplicateInvoice(inv: any) {
    closeInvoiceDetails();
    setForm({
      orderId: '',
      customer: inv.customer || '',
      customerId: inv.customerId || '',
      date: new Date().toISOString().split('T')[0],
      dueDate: inv.dueDate?.split('T')[0] || '',
      status: 'Draft',
      paymentStatus: 'Pending',
      paymentMode: inv.paymentMode || '',
      subtotal: String(inv.subtotal || 0),
      taxAmount: String(inv.taxAmount || 0),
      discount: String(inv.discount || 0),
      total: String(inv.total || 0),
      notes: inv.notes || '',
    });
    setItems(Array.isArray(inv.items) ? inv.items.map((item: any) => ({ ...item })) : []);
    setEditId(null);
    setShowForm(true);
  }

  // Track whether user explicitly closed the detail — prevents URL-driven reopen
  const userClosedRef = useRef(false);

  function closeInvoiceDetails() {
    userClosedRef.current = true;
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    setSearchParams(next, { replace: true });
    setViewItem(null);
  }

  useEffect(() => {
    if (createParam !== '1') return;
    closeInvoiceDetails();
    setForm({ ...FORM0, date: new Date().toISOString().split('T')[0] });
    setItems([]);
    setEditId(null);
    setShowForm(true);
  }, [createParam]);

  // Arriving from the Customer Workspace's Generate Invoice modal
  // (?create=1&orderId=) — pre-select the order the operator already chose
  // there via the existing handleOrderSelect(), once orders have loaded,
  // instead of opening a blank form.
  useEffect(() => {
    if (createParam !== '1' || !prefillOrderIdParam) return;
    const target = orders.find((o: any) => o.id === prefillOrderIdParam);
    if (!target) return;
    handleOrderSelect(prefillOrderIdParam);
    const next = new URLSearchParams(searchParams);
    next.delete('orderId');
    next.delete('customerId');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createParam, prefillOrderIdParam, orders]);

  function closeForm() {
    setShowForm(false);
    setEditId(null);
    setForm({...FORM0});
    setItems([]);
    if (createParam === '1') {
      const next = new URLSearchParams(searchParams);
      next.delete('create');
      next.delete('orderId');
      next.delete('customerId');
      setSearchParams(next, { replace: true });
    }
  }
  function openEdit(inv:any) { 
    closeInvoiceDetails();
    setForm({orderId:inv.orderId||'',customer:inv.customer||'',customerId:inv.customerId||'',date:inv.date?.split('T')[0]||'',dueDate:inv.dueDate?.split('T')[0]||'',status:inv.status||'Draft',paymentStatus:inv.paymentStatus||'Pending',paymentMode:inv.paymentMode||'',subtotal:String(inv.subtotal||0),taxAmount:String(inv.taxAmount||0),discount:String(inv.discount||0),total:String(inv.total||0),notes:inv.notes||''}); 
    setItems(inv.items||[]); 
    setEditId(inv.id); 
    setShowForm(true); 
  }

  function handleOrderSelect(orderId: string) {
    const o = orders.find((x: any) => x.id === orderId);
    if (!o) {
      setForm({...form, orderId: '', customer: '', customerId: '', subtotal: '0', taxAmount: '0', total: '0'});
      setItems([]);
      return;
    }
    
    setForm({
      ...form,
      orderId: o.id,
      customer: o.customer || '',
      customerId: o.customerId || '',
      subtotal: String(o.subtotal || 0),
      taxAmount: String(o.taxAmount || 0),
      discount: String(o.discount || 0),
      total: String(o.total || 0),
    });
    setItems(o.items || []);
  }

  function handleSubmit(e:React.FormEvent) { 
    e.preventDefault(); 
    if (save.isPending) return;
    if(!form.orderId) return toast.error('Order selection is required'); 
    if(items.length===0) return toast.error('Order has no items'); 
    save.mutate(form); 
  }

  const salesUsers = useMemo(() => (users as any[])
    .filter((u: any) => ['Sales', 'Executive', 'BDE', 'BDM', 'Manager', 'TL'].includes(u.role) && u.status !== 'Inactive' && !u.isDeleted)
    .sort((a: any, b: any) => String(a.name || '').localeCompare(String(b.name || ''))),
  [users]);

  const filtered = useMemo(()=>invoices.filter((inv:any)=>{
    const q = deferredSearch.toLowerCase();
    const activeInvoiceDate = inv.date || inv.createdAt;
    const kpiMatch =
      !activeKpi ||
      activeKpi === 'total' ||
      (activeKpi === 'today' && isToday(activeInvoiceDate)) ||
      (activeKpi === 'draft' && inv.status === 'Draft') ||
      (activeKpi === 'sent' && inv.status === 'Sent') ||
      (activeKpi === 'paid' && inv.paymentStatus === 'Paid') ||
      (activeKpi === 'overdue' && inv.paymentStatus === 'Overdue');
    return (!q || [inv.id, inv.customer, inv.orderId].some((v:any)=>String(v||'').toLowerCase().includes(q)))
      && (!statusF || inv.status === statusF)
      && (!paymentF || inv.paymentStatus === paymentF)
      && (!assignedF || inv.assignedToId === assignedF || (inv.assignedToName || '').toLowerCase().includes(assignedF.toLowerCase()))
      && inDateRange(activeInvoiceDate, dateRange, customFrom, customTo)
      && kpiMatch;
  }),[invoices,deferredSearch,statusF,paymentF,assignedF,dateRange,customFrom,customTo,activeKpi]);
  const paginated = filtered.slice((page-1)*perPage, page*perPage);
  const toggleSelect = useCallback((id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    }), []);
  const toggleAll = () =>
    setSelected((s) => s.size === paginated.length ? new Set() : new Set(paginated.map((inv: any) => inv.id)));
  const allSel = selectedCount === paginated.length && paginated.length > 0;
  function handleRowClick(e: React.MouseEvent<HTMLTableRowElement>, inv: any) {
    if (isRowOpenIgnored(e.target)) return;
    openInvoice(inv);
  }
  function handleRowKeyDown(e: React.KeyboardEvent<HTMLTableRowElement>, inv: any) {
    if (isRowOpenIgnored(e.target)) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    openInvoice(inv);
  }
  function exportSelected() {
    const rows = (invoices as any[]).filter((inv) => safeSelected.has(inv.id));
    if (!rows.length) return toast.error('No invoices selected');
    downloadInvoicesCsv(rows, `invoices-export-${new Date().toISOString().slice(0, 10)}.csv`);
  }
  // Sync URL → modal: opens the detail popup when the URL has an 'open' param.
  // 'filtered' and 'perPage' are NOT in deps to prevent re-triggering on filter changes.
  useEffect(() => {
    const openId = openParam;
    // If the user just closed the popup, never reopen — regardless of URL changes
    if (userClosedRef.current) return;
    if (!openId || isLoading) return;
    const target = (invoices as any[]).find((invoice: any) => invoice.id === openId);
    if (!target) return;
    openInvoice(target);
    // Scroll to the record on the page
    window.setTimeout(() => document.querySelector(`[data-record-id="${CSS.escape(openId)}"]`)?.scrollIntoView({ block: 'center' }), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openParam, isLoading, invoices]);
  const stats = useMemo(() => {
    const all = invoices as any[];
    const today = all.filter(i => {
      const d = toDateValue(i.date || i.createdAt);
      return d ? d.toDateString() === new Date().toDateString() : false;
    }).length;
    return {
      today,
      total: all.length,
      draft: all.filter((i:any)=>i.status==='Draft').length,
      sent: all.filter((i:any)=>i.status==='Sent').length,
      paid: all.filter((i:any)=>i.paymentStatus==='Paid').length,
      overdue: all.filter((i:any)=>i.paymentStatus==='Overdue').length,
      value: all.reduce((s:number,i:any)=>s+(Number(i.total)||0),0),
    };
  }, [invoices]);

  const clearAll = () => {
    setSearch('');
    setStatusF('');
    setPaymentF('');
    setAssignedF('');
    setDateRange('all');
    setCustomFrom('');
    setCustomTo('');
    setActiveKpi('');
    setPage(1);
    syncQueueParams({ q: '', status: '', payment: '', assigned: '', date: 'all', from: '', to: '', kpi: '', page: 1 });
  };

  // ── Active filter count for Clear All display
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (search) count++;
    if (statusF) count++;
    if (paymentF) count++;
    if (assignedF) count++;
    if (dateRange !== 'all') count++;
    if (activeKpi) count++;
    return count;
  }, [search, statusF, paymentF, assignedF, dateRange, activeKpi]);

  const KPI_TILES = [
    { label: 'TODAY', value: stats.today, key: 'today', icon: <Clock className="h-4 w-4" />, description: 'Created today' },
    { label: 'TOTAL', value: stats.total, key: 'total', icon: <FileText className="h-4 w-4" />, description: `${stats.total} total invoices` },
    { label: 'DRAFT', value: stats.draft, key: 'draft', icon: <Edit2 className="h-4 w-4" />, description: 'Draft invoices' },
    { label: 'SENT', value: stats.sent, key: 'sent', icon: <CheckCircle2 className="h-4 w-4" />, description: 'Sent to customer' },
    { label: 'PAID', value: stats.paid, key: 'paid', icon: <CheckCircle2 className="h-4 w-4" />, description: 'Payment received' },
    { label: 'OVERDUE', value: stats.overdue, key: 'overdue', icon: <AlertTriangle className="h-4 w-4" />, description: 'Overdue payments' },
  ];

  return (
    <InvoicePageBoundary>
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      {/* ── Premium Workspace Hero ─────────────────────────── */}
      <WorkspaceHero
        title="Invoices"
        icon={<FileText className="h-6 w-6" />}
        breadcrumbs={['Home', 'Sales', 'Invoices']}
        statusText="Last sync · Realtime Connected"
        statusDotColor="var(--color-success)"
        className="gap-3"
        actions={
          <>
            <Button variant="outline" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => refetch()}>
              Refresh
            </Button>
            {canDo('create', 'invoices') && (
              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreateForm}>
                New Invoice
              </Button>
            )}
          </>
        }
      />

      {/* ── Premium Clickable KPI Cards ────────────────────── */}
      <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-6">
        {KPI_TILES.map(k => (
          <PremiumKpi
            key={k.key}
            label={k.label}
            value={k.value}
            icon={k.icon}
            description={k.description}
            onClick={() => {
              const nextKpi = activeKpi === k.key ? '' : (k.key === 'total' ? '' : k.key);
              setActiveKpi(nextKpi);
              setPage(1);
              syncQueueParams({ kpi: nextKpi, page: 1 });
            }}
            active={k.key === 'total' ? (activeKpi === '' || !activeKpi) : activeKpi === k.key}
          />
        ))}
      </div>

      {/* ── Card with inline filters + table + pagination ── */}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.04)] border-[var(--color-border)]">
        {/* ── Card Header with inline search + filters ──────── */}
        <CardHeader className="px-6 pt-2 pb-2 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <input
              aria-label="Search invoices"
              placeholder="Search invoice ID, customer…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); syncQueueParams({ q: e.target.value, page: 1 }); }}
              className="min-w-[160px] flex-1 h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]"
            />
            <UiSelect
              aria-label="Date"
              value={dateRange}
              options={INVOICE_DATE_RANGES}
              onChange={(e) => { setDateRange(e.target.value); setPage(1); syncQueueParams({ date: e.target.value, page: 1 }); }}
              className="w-[100px] h-8 py-1"
            />
            {dateRange === 'custom' && (
              <div className="flex items-center gap-1.5">
                <input type="date" value={customFrom} onChange={(e) => { setCustomFrom(e.target.value); setPage(1); syncQueueParams({ from: e.target.value, to: customTo, date: 'custom', page: 1 }); }} className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                <span className="text-[10px] text-[var(--color-text-muted)]">to</span>
                <input type="date" value={customTo} onChange={(e) => { setCustomTo(e.target.value); setPage(1); syncQueueParams({ to: e.target.value, from: customFrom, date: 'custom', page: 1 }); }} className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
              </div>
            )}
            <UiSelect
              aria-label="Invoice Status"
              value={statusF}
              onChange={(e) => {
                const v = e.target.value;
                const kpiStatusMap: Record<string, string> = { draft: 'Draft', sent: 'Sent', paid: '', overdue: '' };
                if (v && activeKpi && kpiStatusMap[activeKpi] && v !== kpiStatusMap[activeKpi]) { setActiveKpi(''); syncQueueParams({ status: v, kpi: '', page: 1 }); }
                setStatusF(v); setPage(1); syncQueueParams({ status: v, page: 1 });
              }}
              options={[
                { label: 'All Status', value: '' },
                { label: 'Draft', value: 'Draft' },
                { label: 'Sent', value: 'Sent' },
                { label: 'Accepted', value: 'Accepted' },
                { label: 'Cancelled', value: 'Cancelled' },
              ]}
              className="w-[110px] h-8 py-1"
            />
            <UiSelect
              aria-label="Payment Status"
              value={paymentF}
              onChange={(e) => { setPaymentF(e.target.value); setPage(1); syncQueueParams({ payment: e.target.value, page: 1 }); }}
              options={[{ label: 'Payment', value: '' }, ...PAYMENT_STATUSES.map((s: string) => ({ label: s, value: s }))]}
              className="w-[100px] h-8 py-1"
            />
            <UiSelect
              aria-label="Assigned"
              value={assignedF}
              onChange={(e) => { setAssignedF(e.target.value); setPage(1); syncQueueParams({ assigned: e.target.value, page: 1 }); }}
              options={[
                { label: 'All Assignments', value: '' },
                ...(salesUsers || []).map((u: any) => ({ label: u.name || u.displayName || u.id, value: u.id })),
              ]}
              className="w-[120px] h-8 py-1"
            />
            {activeFilterCount > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {activeKpi && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary-light)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-primary-text)]">
                    {KPI_TILES.find(t => t.key === activeKpi)?.label || activeKpi}
                    <button type="button" onClick={() => { setActiveKpi(''); setPage(1); syncQueueParams({ kpi: '', page: 1 }); }} className="ml-0.5 hover:opacity-70"><X className="h-2.5 w-2.5" /></button>
                  </span>
                )}
                {search && <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">S: {search.slice(0, 12)}{search.length > 12 ? '…' : ''}</span>}
                {statusF && !activeKpi && <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">{statusF}</span>}
                {paymentF && <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">{paymentF}</span>}
                <button type="button" onClick={clearAll} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors">
                  <X className="h-2.5 w-2.5" /> Clear
                </button>
              </div>
            )}
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
            </div>
          </div>
        </CardHeader>

        {/* ── Bulk action bar */}
        {selectedCount > 0 && (
          <div className="px-6 py-2.5 flex items-center gap-3 bg-[var(--color-primary-light)] border-b border-[var(--color-primary-muted)]">
            <span className="text-sm font-semibold text-[var(--color-primary-text)]">{selectedCount} invoice{selectedCount > 1 ? 's' : ''} selected</span>
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <Button size="sm" variant="outline" icon={<Download className="h-3.5 w-3.5" />} onClick={exportSelected} className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30">Export CSV</Button>
              {canDo('edit', 'invoices') && <Button size="sm" variant="outline" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => bulkMarkPaidMutation.mutate(Array.from(safeSelected))} loading={bulkMarkPaidMutation.isPending} className="text-indigo-600 border-indigo-300 hover:bg-indigo-50 dark:border-indigo-700 dark:hover:bg-indigo-900/30">Mark Paid</Button>}
              {canDo('edit', 'invoices') && <Button size="sm" variant="outline" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => bulkSendMutation.mutate(Array.from(safeSelected))} loading={bulkSendMutation.isPending} className="text-purple-600 border-purple-300 hover:bg-purple-50 dark:border-purple-700 dark:hover:bg-purple-900/30">Send Email</Button>}
              {canDo('delete', 'invoices') && <Button size="sm" variant="outline" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => bulkDeleteMutation.mutate(Array.from(safeSelected))} loading={bulkDeleteMutation.isPending} className="text-red-600 border-red-300 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/30">Delete</Button>}
              <button onClick={() => setSelected(new Set())} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] ml-1">✕ Clear</button>
            </div>
          </div>
        )}

        {/* ── Table area + Pagination (unified) */}
        <div className="px-6 flex-1 flex flex-col min-h-0">
          <div className="min-h-0 flex-1 overflow-auto scroll-pt-10">
            <Table>
              <Thead>
                <Th style={{ width: 44, minWidth: 44, maxWidth: 44 }}>
                  <UniversalCheckbox checked={allSel} indeterminate={selectedCount > 0 && !allSel} onChange={toggleAll} ariaLabel="Select visible invoices" />
                </Th>
                <Th style={{ width: '15%', minWidth: 100 }}>INVOICE</Th>
                <Th style={{ width: '10%', minWidth: 90 }}>ORDER</Th>
                <Th style={{ width: '18%', minWidth: 140 }}>CUSTOMER</Th>
                <Th style={{ width: 90, minWidth: 90 }}>DATE</Th>
                <Th className="hidden md:table-cell" style={{ width: 90, minWidth: 90 }}>DUE</Th>
                <Th className="hidden md:table-cell" style={{ width: 80, minWidth: 80 }}>TAX</Th>
                <Th style={{ width: 100, minWidth: 100 }}>TOTAL</Th>
                <Th style={{ width: 100, minWidth: 100 }}>STATUS</Th>
                <Th style={{ width: 100, minWidth: 100 }}>PAYMENT</Th>
                <Th align="right" style={{ width: 130, minWidth: 130 }}>ACTIONS</Th>
              </Thead>
              <Tbody>
                {isLoading ? <SkeletonRows cols={11} /> :
                  paginated.length === 0 ? (
                    <tr><td colSpan={11} className="py-14 text-center">
                      <EmptyState
                        icon={<FileText className="h-9 w-9" />}
                        title={search || statusF || paymentF || assignedF || dateRange !== 'all' ? 'No invoices match filters' : 'No invoices yet'}
                        description={search || statusF || paymentF || assignedF || dateRange !== 'all' ? undefined : 'Generate your first invoice from an order.'}
                        action={!search && !statusF && !paymentF && !assignedF && dateRange === 'all' && canDo('create', 'invoices') ? (
                          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreateForm} className="mt-2">Create Your First Invoice</Button>
                        ) : undefined}
                      />
                    </td></tr>
                  ) :
                  paginated.map((inv: any) => (
                    <Tr key={inv.id} selected={safeSelected.has(inv.id)} data-record-id={inv.id} role="button" tabIndex={0}
                      onClick={e => handleRowClick(e, inv)} onKeyDown={e => handleRowKeyDown(e, inv)}
                      className="transition-colors duration-150"
                    >
                      <Td className="py-3" onClick={(e) => e.stopPropagation()}>
                        <UniversalCheckbox checked={safeSelected.has(inv.id)} onChange={() => toggleSelect(inv.id)} ariaLabel={`Select ${invoiceDisplayNumber(inv)}`} />
                      </Td>
                      <Td className="py-3"><span className="font-mono text-xs font-semibold text-[var(--color-primary-text)]">{invoiceDisplayNumber(inv)}</span></Td>
                      <Td className="py-3 text-xs text-[var(--color-text-muted)] font-mono">{orderNumberById.get(String(inv.orderId)) || '—'}</Td>
                      <Td className="py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 shrink-0 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary-text)] flex items-center justify-center text-[11px] font-bold">
                            {(inv.customer || '?')[0].toUpperCase()}
                          </div>
                          <span className="text-sm font-medium text-[var(--color-text)] leading-tight">{inv.customer || inv.customerName || '—'}</span>
                        </div>
                      </Td>
                      <Td className="py-3 text-xs text-[var(--color-text-secondary)]">{formatInvoiceDate(inv.date || inv.createdAt)}</Td>
                      <Td className="hidden md:table-cell py-3 text-xs text-[var(--color-text-muted)]">{formatInvoiceDate(inv.dueDate) || '—'}</Td>
                      <Td className="hidden md:table-cell py-3 text-xs text-[var(--color-text-muted)]">{fmtCurrency(inv.taxAmount || 0, company.currencySymbol)}</Td>
                      <Td className="py-3 text-sm font-semibold text-[var(--color-text)]">{fmtCurrency(inv.total || 0, company.currencySymbol)}</Td>
                      <Td className="py-3">{statusBadge(inv.status || 'Draft')}</Td>
                      <Td className="py-3">{statusBadge(inv.paymentStatus || 'Pending')}</Td>
                      <Td className="py-3" align="right">{/* Use inline View button to avoid circular dep */}
                        <div className="flex items-center justify-end gap-1.5" data-action>
                          <Button size="xs" variant="outline" icon={<FileText className="h-3.5 w-3.5" />} onClick={(e) => { e.stopPropagation(); openInvoice(inv); }} className="h-7 rounded-xl border-[var(--color-border-strong)] bg-[var(--color-text)] px-3 text-[var(--color-text-inverse)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:opacity-90">View</Button>
                        </div>
                      </Td>
                    </Tr>
                  ))}
              </Tbody>
            </Table>
          </div>
          <div className="shrink-0 border-t border-[var(--color-border-subtle)]">
            <Pagination page={page} total={filtered.length} perPage={perPage} onChange={(nextPage) => { setPage(nextPage); syncQueueParams({ page: nextPage }); }} onPerPageChange={n => { setPerPage(n); setPage(1); syncQueueParams({ perPage: n, page: 1 }); }} />
          </div>
        </div>
      </Card>

      {/* ── Form Modal (create/edit invoice) ───────────────── */}
      <Modal open={showForm} onClose={closeForm} title={editId ? 'Edit Invoice' : 'New Auto-Invoice'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 text-sm text-indigo-800 mb-4">Select an Order to automatically hydrate customer details, items, taxes, and pricing.</div>
          <FormSection title="Source Selection">
            <Select label="Select Source Order *" required value={form.orderId} onChange={e => handleOrderSelect(e.target.value)} options={[{ label: 'Select Order...', value: '' }, ...orders.map((o: any) => ({ label: `${o.orderNumber || o.orderNo || '—'} — ${o.customer || o.customerName || '—'} (${fmtCurrency(o.total, company.currencySymbol)})`, value: o.id }))]} />
          </FormSection>
          {form.orderId && (
            <>
              <FormSection title="Invoice Details (Auto-Filled)">
                <div className="grid grid-cols-2 gap-4 bg-background p-4 rounded-xl border border-border mb-4">
                  <div><p className="text-xs text-muted uppercase font-semibold">Customer</p><p className="font-bold text-gray-800">{form.customer || '—'}</p></div>
                  <div><p className="text-xs text-muted uppercase font-semibold">Total Value</p><p className="font-bold text-emerald-600">{fmtCurrency(Number(form.total), company.currencySymbol)}</p></div>
                </div>
                <FormRow>
                  <Input label="Invoice Date" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
                  <Input label="Due Date" type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} />
                </FormRow>
                <FormRow>
                  <Select label="Invoice Status" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} options={['Draft', 'Sent', 'Accepted', 'Cancelled'].map((s: string) => ({ label: s, value: s }))} />
                  <Select label="Payment Status" value={form.paymentStatus} onChange={e => setForm({ ...form, paymentStatus: e.target.value })} options={PAYMENT_STATUSES.map((s: string) => ({ label: s, value: s }))} />
                </FormRow>
              </FormSection>
              <FormSection title="Invoice Items">
                <InvoiceItemsDisplay items={items} currencySymbol={company.currencySymbol} subtotal={subtotal} taxAmount={taxAmount} discount={form.discount} grandTotal={grandTotal} onDiscountChange={v => setForm({ ...form, discount: v })} />
              </FormSection>
              <FormSection title="Additional Information">
                <Select label="Payment Mode" value={form.paymentMode} onChange={e => setForm({ ...form, paymentMode: e.target.value })} options={[{ label: 'Select Mode', value: '' }, ...PAYMENT_MODES.map((m: string) => ({ label: m, value: m }))]} />
                <Textarea label="Notes / Remarks" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Any additional notes for the invoice..." rows={2} />
              </FormSection>
            </>
          )}
          <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
            <Button variant="outline" type="button" onClick={closeForm}>Cancel</Button>
            <Button type="submit" disabled={!form.orderId} loading={save.isPending}>{editId ? 'Update Invoice' : 'Generate Invoice'}</Button>
          </div>
        </form>
      </Modal>

      <InvoiceModalBoundary
        key={safeViewItem?.id || 'invoice-modal-closed'}
        onFatalError={(error) => {
          console.error('[InvoiceModal]', error);
          toast.error('Invoice details could not be rendered. The popup was closed.');
          closeInvoiceDetails();
        }}
      >
      <InvoiceDetailModal
        open={!!safeViewItem}
        invoice={safeViewItem}
        currencySymbol={company.currencySymbol}
        orderNumberById={orderNumberById}
        canDelete={canDo('delete', 'invoices')}
        onClose={closeInvoiceDetails}
        onEdit={() => { closeInvoiceDetails(); openEdit(safeViewItem); }}
        onSend={() => sendInvoiceMutation.mutate(safeViewItem.id)}
        onSendReminder={() => sendInvoiceEmail(safeViewItem, 'paymentReminder')}
        onDownload={() => doPrint(safeViewItem, company)}
        onDuplicate={() => duplicateInvoice(safeViewItem)}
        onMarkPaid={() => markPaidMutation.mutate(safeViewItem.id)}
        onDelete={() => { setDelId(safeViewItem.id); closeInvoiceDetails(); }}
      />
      </InvoiceModalBoundary>
      <ConfirmDialog
        open={!!delId}
        onClose={()=>setDelId(null)}
        onConfirm={()=>delId&&del.mutate(delId, {
          onSuccess: () => {
            if (safeViewItem?.id === delId) closeInvoiceDetails();
          },
        })}
        loading={del.isPending}
        title="Delete Invoice"
        message="Delete this invoice?"
      />
    </div>
    </InvoicePageBoundary>
  );
}
