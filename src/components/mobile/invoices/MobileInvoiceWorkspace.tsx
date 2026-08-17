import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useSettingsSection } from '../../../features/settings/hooks/useSettingsSection';
import { buildEmailComposePayload, normalizeEmailSettings, openGmailCompose } from '../../../features/settings/emailRuntime';
import type { EmailTemplateKey } from '../../../features/settings/types';
import { Calendar, CheckCircle2, Copy, Download, Edit2, FileText, Mail, MessageCircle, Phone, Printer, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { PAYMENT_MODES, PAYMENT_STATUSES } from '../../../config/company';
import { Badge, Button, Card, ConfirmDialog, Input, Modal, Pagination, Select, Textarea, statusBadge } from '../../ui';
import { COLLECTIONS, db } from '../../../lib/firebase';
import { deleteDocById, fmtCurrency, fmtDate, genId, getAll, getOne, toInputDate, updateDocById, resolveWriteCompanyId } from '../../../lib/firestore';
import { getNextDocumentNumber, resolveDocumentDefaults } from '../../../lib/documentNumbering';
import { notifyRoleUsers } from '../../../lib/notifications';
import { usePermissions } from '../../../lib/permissions';
import { queryKeys } from '../../../lib/queryKeys';
import { sanitizePayload } from '../../../lib/sanitizer';
import { useAppStore, useCurrentUser } from '../../../store/useAppStore';
import { NotificationType, type Order, type ProformaInvoice } from '../../../types';
import { cn } from '../../../utils/cn';
import { MobileTimelinePreview } from '../shared/MobileTimelinePreview';

const PER_PAGE = 10;
const ALL = 'All';
const INVOICE_STATUSES = ['Draft', 'Sent', 'Accepted', 'Cancelled'];
const FORM0 = {
  orderId: '',
  customer: '',
  customerId: '',
  date: new Date().toISOString().slice(0, 10),
  dueDate: '',
  status: 'Draft',
  paymentStatus: 'Pending',
  paymentMode: '',
  subtotal: '0',
  taxAmount: '0',
  discount: '0',
  total: '0',
  notes: '',
  terms: '',
  billingAddress: '',
  attachmentName: '',
};

type Mode = 'records' | 'create';
type Invoice = ProformaInvoice & Record<string, any>;
type InvoiceForm = typeof FORM0;
type InvoiceFilters = {
  search: string;
  status: string;
  payment: string;
  date: string;
};

function roundMoney(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function invoiceNumber(invoice: Invoice) {
  return String(invoice.invoiceNumber || invoice.piNumber || invoice.id || 'Untitled Invoice');
}

function formatDateLabel(value: any) {
  const date = toDate(value);
  return date ? fmtDate(date) : 'Not available';
}

function customerName(customer: any) {
  return customer?.name || customer?.fullName || customer?.contactPerson || customer?.company || customer?.companyName || customer?.id || '';
}

function invoicePhone(invoice: Invoice, customers: any[]) {
  const customer = customers.find((entry) => entry.id === invoice.customerId);
  return invoice.customerPhone || invoice.phone || customer?.phone || customer?.mobile || customer?.businessPhone || '';
}

function invoiceEmail(invoice: Invoice, customers: any[]) {
  const customer = customers.find((entry) => entry.id === invoice.customerId);
  return invoice.customerEmail || invoice.email || customer?.email || customer?.businessEmail || '';
}

function whatsappHref(phone?: string) {
  const clean = String(phone || '').replace(/\D/g, '');
  return clean ? `https://wa.me/${clean}` : undefined;
}

function isInDateRange(value: any, range: string) {
  if (range === 'all') return true;
  const date = toDate(value);
  if (!date) return false;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (range === 'today') return date >= start;
  const days = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 0;
  return days ? date >= new Date(Date.now() - days * 86400000) : true;
}

function filterInvoices(invoices: Invoice[], filters: InvoiceFilters) {
  const term = filters.search.trim().toLowerCase();
  return invoices
    .filter((invoice) => {
      if (filters.status !== ALL && (invoice.status || 'Draft') !== filters.status) return false;
      if (filters.payment !== ALL && (invoice.paymentStatus || 'Pending') !== filters.payment) return false;
      if (!isInDateRange(invoice.date || invoice.createdAt, filters.date)) return false;
      if (!term) return true;
      return [
        invoice.id,
        invoice.invoiceNumber,
        invoice.piNumber,
        invoice.customer,
        invoice.customerId,
        invoice.orderId,
        invoice.sourceOrderId,
        invoice.status,
        invoice.paymentStatus,
      ].some((value) => String(value || '').toLowerCase().includes(term));
    })
    .sort((a, b) => {
      const aTime = toDate(a.updatedAt)?.getTime() || toDate(a.createdAt)?.getTime() || toDate(a.date)?.getTime() || 0;
      const bTime = toDate(b.updatedAt)?.getTime() || toDate(b.createdAt)?.getTime() || toDate(b.date)?.getTime() || 0;
      return bTime - aTime;
    });
}

function totalsFor(items: any[], discountValue: string | number) {
  const subtotal = items.reduce((sum, item) => sum + (Number(item.qty) || 0) * (Number(item.price) || 0), 0);
  const taxAmount = items.reduce((sum, item) => sum + ((Number(item.qty) || 0) * (Number(item.price) || 0) * (Number(item.tax) || 0)) / 100, 0);
  const discount = Number(discountValue) || 0;
  const grandTotal = roundMoney(subtotal + taxAmount - discount);
  return { subtotal, taxAmount, discount, grandTotal };
}

function downloadInvoicesCsv(rows: Invoice[], filename: string) {
  const headers = ['Invoice No', 'Order No', 'Customer', 'Date', 'Due Date', 'Total', 'Payment Status', 'Invoice Status'];
  const lines = rows.map((invoice) =>
    [
      invoiceNumber(invoice),
      invoice.orderNumber || invoice.orderId || invoice.sourceOrderId || '',
      invoice.customer || '',
      invoice.date || '',
      invoice.dueDate || '',
      invoice.total ?? '',
      invoice.paymentStatus || '',
      invoice.status || '',
    ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','),
  );
  const csv = [headers.join(','), ...lines].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function printInvoice(invoice: Invoice, fallbackCompany: any) {
  const toastId = toast.loading('Generating document...');
  try {
    const fullCompany = await getOne(COLLECTIONS.COMPANIES, invoice.companyId || fallbackCompany?.id) || fallbackCompany;
    const { DocumentTemplateResolver, triggerPrint } = await import('../../../templates/documents/resolver');
    const docType = invoice.templateUsed ? 'PROFORMA INVOICE' : 'INVOICE';
    const html = DocumentTemplateResolver(fullCompany, docType, invoice);
    triggerPrint(html);
    toast.success('Document ready', { id: toastId });
  } catch (error: any) {
    toast.error(`Failed to generate document: ${error.message}`, { id: toastId });
  }
}

export function MobileInvoiceWorkspace({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const company = useAppStore((state) => state.company);
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const user = useCurrentUser();
  const keys = queryKeys.forCompany(activeCompanyId);
  const perms = usePermissions();
  const { data: invoices = [], isLoading, error } = useQuery({ queryKey: keys.invoices, queryFn: () => getAll<Invoice>(COLLECTIONS.PROFORMA_INVOICES), staleTime: 30000 });
  const { data: orders = [] } = useQuery({ queryKey: keys.ordersAll, queryFn: () => getAll<Order>(COLLECTIONS.ORDERS), staleTime: 60000 });
  const { data: customers = [] } = useQuery({ queryKey: keys.customersAll, queryFn: () => getAll(COLLECTIONS.CUSTOMERS), staleTime: 60000 });
  const { data: dispatches = [] } = useQuery({ queryKey: keys.dispatchAll, queryFn: () => getAll(COLLECTIONS.DISPATCH), staleTime: 60000 });
  const { data: payments = [] } = useQuery({ queryKey: keys.payments, queryFn: () => getAll(COLLECTIONS.PAYMENTS), staleTime: 60000 });
  const emailSettingsQuery = useSettingsSection('email');
  const emailSettings = useMemo(() => normalizeEmailSettings(emailSettingsQuery.data as Record<string, unknown> | undefined), [emailSettingsQuery.data]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const [formOpen, setFormOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [form, setForm] = useState<InvoiceForm>({ ...FORM0 });
  const [items, setItems] = useState<any[]>([]);
  const [viewInvoice, setViewInvoice] = useState<Invoice | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [duplicateInvoice, setDuplicateInvoice] = useState<Invoice | null>(null);
  const [noteInvoice, setNoteInvoice] = useState<Invoice | null>(null);
  const [noteText, setNoteText] = useState('');
  const createParam = params.get('create');

  useEffect(() => {
    if (mode === 'create') setFormOpen(true);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'records' || createParam !== '1') return;
    setEditingInvoice(null);
    setForm({ ...FORM0, date: new Date().toISOString().slice(0, 10) });
    setItems([]);
    setDirty(false);
    setFormOpen(true);
  }, [mode, createParam]);

  useEffect(() => {
    const order = (location.state as any)?.prefillOrder;
    if (!order) return;
    hydrateFromOrder(order as any);
    setFormOpen(true);
    window.history.replaceState({}, document.title);
  }, [location.state]);

  const filters = useMemo<InvoiceFilters>(() => ({
    search: params.get('q') || '',
    status: params.get('status') || ALL,
    payment: params.get('payment') || params.get('paymentStatus') || ALL,
    date: params.get('date') || 'all',
  }), [params]);

  const filteredInvoices = useMemo(() => filterInvoices(invoices as Invoice[], filters), [invoices, filters]);
  const paginatedInvoices = useMemo(() => filteredInvoices.slice((page - 1) * PER_PAGE, page * PER_PAGE), [filteredInvoices, page]);
  const selectedRows = useMemo(() => (invoices as Invoice[]).filter((invoice) => selected.has(invoice.id)), [invoices, selected]);
  const totals = useMemo(() => totalsFor(items, form.discount), [items, form.discount]);
  const canCreate = perms.canCreate('invoices');
  const canEdit = perms.canEdit('invoices');
  const canDelete = perms.canDelete('invoices');
  const canExport = perms.canExport('invoices') || canEdit || canCreate;

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredInvoices.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filteredInvoices.length, page]);

  function hydrateFromOrder(order: any) {
    setEditingInvoice(null);
    setForm({
      ...FORM0,
      orderId: order.id || '',
      customer: order.customer || '',
      customerId: order.customerId || '',
      date: new Date().toISOString().slice(0, 10),
      subtotal: String(order.subtotal || 0),
      taxAmount: String(order.taxAmount || order.taxTotal || 0),
      discount: String(order.discount || 0),
      total: String(order.total || 0),
      terms: order.terms || '',
      billingAddress: order.billingAddress || order.shippingAddress || '',
    });
    setItems(Array.isArray(order.items) ? order.items.map((item: any) => ({ ...item })) : []);
    setDirty(true);
  }

  function changePage(nextPage: number) {
    setPage(nextPage);
    const next = new URLSearchParams(params);
    if (nextPage > 1) next.set('page', String(nextPage));
    else next.delete('page');
    setParams(next, { replace: true });
  }

  function toggleSelect(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function closeForm() {
    setFormOpen(false);
    setEditingInvoice(null);
    setForm({ ...FORM0, date: new Date().toISOString().slice(0, 10) });
    setItems([]);
    setDirty(false);
    if (mode === 'create') navigate('/app', { replace: true });
    if (params.get('create') === '1') {
      const next = new URLSearchParams(params);
      next.delete('create');
      setParams(next, { replace: true });
    }
  }

  function requestCloseForm() {
    if (dirty) return setConfirmClose(true);
    closeForm();
  }

  function updateForm(patch: Partial<InvoiceForm>) {
    setForm((current) => ({ ...current, ...patch }));
    setDirty(true);
  }

  function selectOrder(orderId: string) {
    const order = (orders as any[]).find((entry) => entry.id === orderId);
    if (!order) {
      updateForm({ orderId: '', customer: '', customerId: '' });
      setItems([]);
      return;
    }
    hydrateFromOrder(order);
  }

  function openEdit(invoice: Invoice) {
    setViewInvoice(null);
    setEditingInvoice(invoice);
    setForm({
      orderId: invoice.orderId || invoice.sourceOrderId || '',
      customer: invoice.customer || '',
      customerId: invoice.customerId || '',
      date: toInputDate(invoice.date) || new Date().toISOString().slice(0, 10),
      dueDate: toInputDate(invoice.dueDate),
      status: invoice.status || 'Draft',
      paymentStatus: invoice.paymentStatus || 'Pending',
      paymentMode: invoice.paymentMode || '',
      subtotal: String(invoice.subtotal || 0),
      taxAmount: String(invoice.taxAmount || invoice.taxTotal || 0),
      discount: String(invoice.discount || 0),
      total: String(invoice.total || 0),
      terms: invoice.terms || '',
      notes: invoice.notes || '',
      billingAddress: invoice.billingAddress || invoice.deliveryAddress || '',
      attachmentName: invoice.attachmentName || '',
    });
    setItems(Array.isArray(invoice.items) ? invoice.items.map((item: any) => ({ ...item })) : []);
    setDirty(false);
    setFormOpen(true);
  }

  const saveInvoice = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        items,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        discount: totals.discount,
        total: totals.grandTotal,
        updatedByName: user.name,
      };
      if (editingInvoice) {
        await updateDocById(COLLECTIONS.PROFORMA_INVOICES, editingInvoice.id, payload);
        await notifyRoleUsers(['Accounts', 'Director'], NotificationType.INVOICE_UPDATED, 'Invoice updated', `Invoice ${editingInvoice.id} was updated for ${form.customer || 'customer'}.`, 'invoice', editingInvoice.id, activeCompanyId);
        return { ...editingInvoice, ...payload };
      }
      if (!form.orderId) throw new Error('Order selection is required');
      if (!items.length) throw new Error('Order has no items');
      const documentDefaults = await resolveDocumentDefaults(resolveWriteCompanyId());
      const id = genId.invoice(company?.invoicePrefix || 'INV');
      const { documentNumber } = await getNextDocumentNumber(resolveWriteCompanyId(), 'invoice');
      await runTransaction(db, async (transaction) => {
        const orderRef = doc(db, COLLECTIONS.ORDERS, form.orderId);
        const orderSnap = await transaction.get(orderRef);
        if (!orderSnap.exists()) throw new Error(`Order ${form.orderId} not found`);
        const order = orderSnap.data() as any;
        if (order.companyId !== activeCompanyId) throw new Error(`Order ${form.orderId} does not belong to the active company`);
        if (order.status === 'Cancelled') throw new Error(`Order ${form.orderId} is cancelled and cannot be invoiced`);
        const orderTotal = roundMoney(Number(order.total) || 0);
        const currentInvoiced = roundMoney(Number(order.totalInvoiced) || 0);
        const invoiceTotal = roundMoney(totals.grandTotal);
        const pendingBilling = roundMoney(order.pendingBilling === undefined ? Math.max(0, orderTotal - currentInvoiced) : Number(order.pendingBilling) || 0);
        if (order.piGenerated && Array.isArray(order.generatedPIs) && order.generatedPIs.length > 0) throw new Error(`Order ${form.orderId} already has generated invoice(s)`);
        if (invoiceTotal <= 0) throw new Error('Invoice total must be greater than zero');
        if (pendingBilling <= 0) throw new Error(`Order ${form.orderId} has no pending billing`);
        if (invoiceTotal > pendingBilling) throw new Error(`Invoice total exceeds pending billing. Pending: ${pendingBilling}`);
        const invoiceRef = doc(db, COLLECTIONS.PROFORMA_INVOICES, id);
        if ((await transaction.get(invoiceRef)).exists()) throw new Error(`Invoice ${id} already exists`);
        const nextInvoiced = roundMoney(currentInvoiced + invoiceTotal);
        const nextPendingBilling = roundMoney(Math.max(0, orderTotal - nextInvoiced));
        transaction.set(invoiceRef, sanitizePayload({
          ...payload,
          id,
          invoiceNumber: documentNumber,
          piNumber: documentNumber,
          refNo: documentNumber,
          terms: form.terms || documentDefaults.settings.defaultTerms,
          notes: form.notes || documentDefaults.settings.defaultNotes,
          sourceOrderId: form.orderId,
          companyId: activeCompanyId,
          createdBy: user.id,
          createdByName: user.name,
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
      await notifyRoleUsers(['Accounts', 'Director'], NotificationType.PI_GENERATED, 'Invoice generated', `Invoice ${documentNumber} was generated for order ${form.orderId}.`, 'invoice', id, activeCompanyId);
      return { ...payload, id, invoiceNumber: documentNumber, piNumber: documentNumber, refNo: documentNumber, sourceOrderId: form.orderId, companyId: activeCompanyId };
    },
    onSuccess: (invoice) => {
      void qc.invalidateQueries({ queryKey: keys.invoices });
      void qc.invalidateQueries({ queryKey: keys.ordersRoot });
      toast.success(editingInvoice ? 'Invoice updated' : 'Invoice created');
      closeForm();
      setViewInvoice(invoice as Invoice);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map(async (id) => {
        await deleteDocById(COLLECTIONS.PROFORMA_INVOICES, id);
        await notifyRoleUsers(['Accounts', 'Director'], NotificationType.INVOICE_DELETED, 'Invoice deleted', `Invoice ${id} was deleted.`, 'invoice', id, activeCompanyId);
      }));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.invoices });
      toast.success(`Deleted ${selectedRows.length || 1} invoice${selectedRows.length === 1 ? '' : 's'}`);
      setSelected(new Set());
      setDeleteOpen(false);
      setViewInvoice(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const sendMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length !== 1) throw new Error('Select exactly one invoice to open Gmail compose.');
      const invoice = (invoices as Invoice[]).find((entry) => entry.id === ids[0]);
      if (!invoice) throw new Error('Invoice not found');
      const result = buildEmailComposePayload({
        templateKey: 'invoice',
        settings: emailSettings,
        recipientEmail: invoiceEmail(invoice, customers as any[]),
        variables: {
          customerName: invoice.customer || invoice.customerName || (customers as any[]).find((entry: any) => entry.id === invoice.customerId)?.name || '',
          companyName: company?.name || '',
          invoiceNumber: invoiceNumber(invoice),
          orderNumber: (orders as any[]).find((entry) => entry.id === invoice.orderId || entry.id === invoice.sourceOrderId)?.orderNumber || (orders as any[]).find((entry) => entry.id === invoice.orderId || entry.id === invoice.sourceOrderId)?.orderNo || String(invoice.orderNumber || invoice.orderNo || ''),
          invoiceDate: fmtDate(invoice.date || invoice.createdAt),
          dueDate: fmtDate(invoice.dueDate),
          totalAmount: fmtCurrency(invoice.total || 0, company.currencySymbol),
        },
      });
      if (!result.ok) throw new Error(result.error);
      if (!openGmailCompose(result.payload.url)) throw new Error('Could not open Gmail compose. Please allow pop-ups and try again.');
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.invoices });
      toast.success('Email compose opened');
      setSelected(new Set());
      setViewInvoice(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const markPaidMutation = useMutation({
    mutationFn: async (ids: string[]) => Promise.all(ids.map((id) => updateDocById(COLLECTIONS.PROFORMA_INVOICES, id, { paymentStatus: 'Paid', paidAt: new Date().toISOString(), paidAmount: (invoices as Invoice[]).find((invoice) => invoice.id === id)?.total || 0, balanceAmount: 0 }))),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.invoices });
      toast.success('Invoice marked paid');
      setSelected(new Set());
      setViewInvoice(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const addNote = useMutation({
    mutationFn: async ({ invoice, note }: { invoice: Invoice; note: string }) => updateDocById(COLLECTIONS.PROFORMA_INVOICES, invoice.id, { notes: [invoice.notes, note].filter(Boolean).join('\n') }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.invoices });
      toast.success('Note added');
      setNoteInvoice(null);
      setNoteText('');
    },
    onError: (e: any) => toast.error(e.message),
  });

  function duplicateCurrent() {
    if (!duplicateInvoice) return;
    setEditingInvoice(null);
    setForm({
      ...FORM0,
      customer: duplicateInvoice.customer || '',
      customerId: duplicateInvoice.customerId || '',
      date: new Date().toISOString().slice(0, 10),
      dueDate: toInputDate(duplicateInvoice.dueDate),
      paymentMode: duplicateInvoice.paymentMode || '',
      subtotal: String(duplicateInvoice.subtotal || 0),
      taxAmount: String(duplicateInvoice.taxAmount || 0),
      discount: String(duplicateInvoice.discount || 0),
      total: String(duplicateInvoice.total || 0),
      terms: duplicateInvoice.terms || '',
      notes: duplicateInvoice.notes || '',
      billingAddress: duplicateInvoice.billingAddress || '',
    });
    setItems(Array.isArray(duplicateInvoice.items) ? duplicateInvoice.items.map((item: any) => ({ ...item })) : []);
    setDuplicateInvoice(null);
    setDirty(true);
    setFormOpen(true);
  }

  if (mode === 'create') {
    return (
      <InvoiceDialogs
        formOpen={formOpen}
        form={form}
        items={items}
        orders={orders as any[]}
        totals={totals}
        dirty={dirty}
        saving={saveInvoice.isPending}
        confirmClose={confirmClose}
        currencySymbol={company?.currencySymbol || '₹'}
        onCloseForm={requestCloseForm}
        onDiscard={() => { setConfirmClose(false); closeForm(); }}
        onKeepEditing={() => setConfirmClose(false)}
        onFormChange={updateForm}
        onOrderSelect={selectOrder}
        onSubmit={(event) => { event.preventDefault(); saveInvoice.mutate(); }}
      />
    );
  }

  return (
    <div className="space-y-4 pb-2 pt-2">
      <div className="px-1 pb-1 pt-2">
        <h1 className="text-xl font-bold text-[var(--color-text)]">Invoices</h1>
      </div>

      {selected.size > 0 && (
        <Card className="rounded-xl p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-xs font-semibold text-[var(--color-primary-text)]">{selected.size} selected</span>
            {canExport && <Button size="xs" variant="outline" icon={<Download className="h-3 w-3" />} onClick={() => downloadInvoicesCsv(selectedRows, `invoices-export-${new Date().toISOString().slice(0, 10)}.csv`)}>Export</Button>}
            {canEdit && <Button size="xs" variant="outline" onClick={() => sendMutation.mutate(Array.from(selected))}>Send</Button>}
            {canEdit && <Button size="xs" variant="outline" icon={<CheckCircle2 className="h-3 w-3" />} onClick={() => markPaidMutation.mutate(Array.from(selected))}>Paid</Button>}
            {canDelete && <Button size="xs" variant="danger" icon={<Trash2 className="h-3 w-3" />} onClick={() => setDeleteOpen(true)}>Delete</Button>}
            <button type="button" onClick={() => setSelected(new Set())} className="px-2 py-1 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">Clear</button>
          </div>
        </Card>
      )}

      {error && <div className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-light)] px-3 py-2 text-sm text-[var(--color-danger-text)]">{(error as Error).message}</div>}

      <div className="space-y-3">
        {isLoading && Array.from({ length: 5 }).map((_, index) => <InvoiceSkeletonCard key={index} />)}
        {!isLoading && filteredInvoices.length === 0 && <Card className="rounded-xl p-5 text-center text-sm text-[var(--color-text-muted)]">No invoices match the current filters.</Card>}
        {!isLoading && paginatedInvoices.map((invoice) => (
          <InvoiceCard
            key={invoice.id}
            invoice={invoice}
            customers={customers as any[]}
            selected={selected.has(invoice.id)}
            currencySymbol={company?.currencySymbol || '₹'}
            onSelect={() => toggleSelect(invoice.id)}
            onView={() => setViewInvoice(invoice)}
          />
        ))}
      </div>

      {!isLoading && filteredInvoices.length > 0 && <Pagination page={page} total={filteredInvoices.length} perPage={PER_PAGE} onChange={changePage} />}

      <InvoiceViewModal
        invoice={viewInvoice}
        orders={orders as any[]}
        customers={customers as any[]}
        dispatches={dispatches as any[]}
        payments={payments as any[]}
        currencySymbol={company?.currencySymbol || '₹'}
        canEdit={canEdit}
        canDelete={canDelete}
        sending={sendMutation.isPending}
        markingPaid={markPaidMutation.isPending}
        onClose={() => setViewInvoice(null)}
        onEdit={openEdit}
        onDelete={(invoice) => { setSelected(new Set([invoice.id])); setViewInvoice(null); setDeleteOpen(true); }}
        onDuplicate={(invoice) => { setViewInvoice(null); setDuplicateInvoice(invoice); }}
        onNote={(invoice) => { setViewInvoice(null); setNoteInvoice(invoice); }}
        onSend={(invoice) => sendMutation.mutate([invoice.id])}
        onMarkPaid={(invoice) => markPaidMutation.mutate([invoice.id])}
        onPrint={(invoice) => printInvoice(invoice, company)}
      />

      <InvoiceDialogs
        formOpen={formOpen}
        form={form}
        items={items}
        orders={orders as any[]}
        totals={totals}
        dirty={dirty}
        saving={saveInvoice.isPending}
        confirmClose={confirmClose}
        currencySymbol={company?.currencySymbol || '₹'}
        onCloseForm={requestCloseForm}
        onDiscard={() => { setConfirmClose(false); closeForm(); }}
        onKeepEditing={() => setConfirmClose(false)}
        onFormChange={updateForm}
        onOrderSelect={selectOrder}
        onSubmit={(event) => { event.preventDefault(); saveInvoice.mutate(); }}
      />

      <Modal open={!!noteInvoice} onClose={() => setNoteInvoice(null)} title="Add Note" size="full">
        <div className="space-y-4">
          <Textarea label="Note" required value={noteText} onChange={(event) => setNoteText(event.target.value)} />
          <Button className="w-full" loading={addNote.isPending} onClick={() => {
            if (!noteInvoice || !noteText.trim()) return toast.error('Note required');
            addNote.mutate({ invoice: noteInvoice, note: noteText.trim() });
          }}>Save Note</Button>
        </div>
      </Modal>

      <ConfirmDialog open={!!duplicateInvoice} onClose={() => setDuplicateInvoice(null)} onConfirm={duplicateCurrent} title="Duplicate Invoice" message={`Create a draft copy of ${duplicateInvoice ? invoiceNumber(duplicateInvoice) : 'this invoice'}?`} confirmLabel="Duplicate" danger={false} />
      <ConfirmDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={() => deleteMutation.mutate(Array.from(selected))} loading={deleteMutation.isPending} title="Delete Invoices" message={`Delete ${selectedRows.length} selected invoice${selectedRows.length === 1 ? '' : 's'}?`} />
    </div>
  );
}

function InvoiceCard({ invoice, customers, selected, currencySymbol, onSelect, onView }: {
  invoice: Invoice;
  customers: any[];
  selected: boolean;
  currencySymbol: string;
  onSelect: () => void;
  onView: () => void;
}) {
  const phone = invoicePhone(invoice, customers);
  const email = invoiceEmail(invoice, customers);
  const customer = customers.find((entry) => entry.id === invoice.customerId);
  const paid = Number(invoice.paidAmount || invoice.amountPaid || 0);
  const balance = Number(invoice.balanceAmount ?? Math.max(0, (Number(invoice.total) || 0) - paid));
  return (
    <Card className={cn('rounded-xl border border-[var(--color-border-subtle)] p-3 shadow-sm transition-shadow hover:shadow-[var(--shadow-enterprise-row)]', selected && 'border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/40', (invoice.paymentStatus || '').toLowerCase() === 'overdue' && 'border-l-4 border-l-red-500')}>
      <div className="flex items-start gap-2.5">
        <input type="checkbox" checked={selected} onChange={onSelect} className="mt-1 rounded border-[var(--color-border)] text-[var(--color-primary)]" aria-label={`Select ${invoiceNumber(invoice)}`} />
        <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
          <p className="truncate text-[15px] font-bold leading-5 text-[var(--color-text)]">{invoiceNumber(invoice)}</p>
          <p className="mt-0.5 truncate text-xs font-medium text-[var(--color-text-muted)]">{invoice.customer || 'Customer not selected'}</p>
          {customer?.company || customer?.companyName ? <p className="truncate text-xs text-[var(--color-text-muted)]">{customer.company || customer.companyName}</p> : null}
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs leading-5 text-[var(--color-text-muted)]">
            <p className="truncate">{fmtCurrency(Number(invoice.total) || 0, currencySymbol)}</p>
            <p className="truncate">{invoice.date ? fmtDate(invoice.date) : 'Date not set'}</p>
            <p className="truncate">Due {invoice.dueDate ? fmtDate(invoice.dueDate) : 'not set'}</p>
            <p className="truncate">Balance {fmtCurrency(balance, currencySymbol)}</p>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {statusBadge(invoice.status || 'Draft')}
            {statusBadge(invoice.paymentStatus || 'Pending')}
          </div>
        </button>
        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <a href={whatsappHref(phone)} target="_blank" rel="noreferrer" aria-label="WhatsApp invoice" className={cn(actionIconClass, 'bg-emerald-50/90 text-emerald-600 ring-emerald-100 dark:bg-emerald-900/25 dark:text-emerald-300 dark:ring-emerald-800/60', !phone && 'pointer-events-none opacity-40')}><MessageCircle className="h-4 w-4" /></a>
          <a href={email ? `mailto:${email}` : undefined} aria-label="Email invoice" className={cn(actionIconClass, 'bg-amber-50/90 text-amber-600 ring-amber-100 dark:bg-amber-900/25 dark:text-amber-300 dark:ring-amber-800/60', !email && 'pointer-events-none opacity-40')}><Mail className="h-4 w-4" /></a>
          <a href={phone ? `tel:${phone}` : undefined} aria-label="Call invoice" className={cn(actionIconClass, 'bg-blue-50/90 text-blue-600 ring-blue-100 dark:bg-blue-900/25 dark:text-blue-300 dark:ring-blue-800/60', !phone && 'pointer-events-none opacity-40')}><Phone className="h-4 w-4" /></a>
        </div>
      </div>
    </Card>
  );
}

const actionIconClass = 'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/60 shadow-sm ring-1 backdrop-blur-sm transition-transform active:scale-95';

function InvoiceSkeletonCard() {
  return (
    <Card className="rounded-xl p-3">
      <div className="flex gap-3">
        <div className="h-4 w-4 rounded bg-[var(--color-bg-sunken)]" />
        <div className="flex-1 space-y-3">
          <div className="h-4 w-2/3 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-3 w-1/2 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-8 rounded bg-[var(--color-bg-sunken)]" />
        </div>
      </div>
    </Card>
  );
}

function InvoiceDialogs({ formOpen, form, items, orders, totals, dirty, saving, confirmClose, currencySymbol, onCloseForm, onDiscard, onKeepEditing, onFormChange, onOrderSelect, onSubmit }: {
  formOpen: boolean;
  form: InvoiceForm;
  items: any[];
  orders: any[];
  totals: ReturnType<typeof totalsFor>;
  dirty: boolean;
  saving: boolean;
  confirmClose: boolean;
  currencySymbol: string;
  onCloseForm: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
  onFormChange: (patch: Partial<InvoiceForm>) => void;
  onOrderSelect: (orderId: string) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <>
      <Modal open={formOpen} onClose={onCloseForm} title="Invoice" size="full">
        <form onSubmit={onSubmit} className="space-y-4">
          <Section title="Source Order">
            <p className="text-xs text-[var(--color-text-muted)]">Select an order to hydrate customer details, products, taxes and pricing.</p>
            <Select label="Source Order" required value={form.orderId} onChange={(event) => onOrderSelect(event.target.value)} options={[{ label: 'Select order...', value: '' }, ...orders.map((order) => ({ label: `${order.orderNumber || order.orderNo || order.id} - ${order.customer || 'Customer'} (${fmtCurrency(Number(order.total) || 0, currencySymbol)})`, value: order.id }))]} />
            <Detail label="Customer" value={form.customer || 'Not selected'} />
          </Section>

          <Section title="Invoice Details">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Invoice Date" type="date" value={form.date} onChange={(event) => onFormChange({ date: event.target.value })} />
              <Input label="Due Date" type="date" value={form.dueDate} onChange={(event) => onFormChange({ dueDate: event.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Select label="Invoice Status" value={form.status} onChange={(event) => onFormChange({ status: event.target.value })} options={INVOICE_STATUSES.map((status) => ({ label: status, value: status }))} />
              <Select label="Payment Status" value={form.paymentStatus} onChange={(event) => onFormChange({ paymentStatus: event.target.value })} options={PAYMENT_STATUSES.map((status) => ({ label: status, value: status }))} />
            </div>
            <Select label="Payment Mode" value={form.paymentMode} onChange={(event) => onFormChange({ paymentMode: event.target.value })} options={[{ label: 'Not selected', value: '' }, ...PAYMENT_MODES.map((mode) => ({ label: mode, value: mode }))]} />
          </Section>

          <Section title="Products">
            {items.length ? (
              <div className="space-y-2">
                {items.map((item, index) => (
                  <div key={index} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                    <p className="text-sm font-semibold text-[var(--color-text)]">{item.product || `Item ${index + 1}`}</p>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">{Number(item.qty) || 0} {item.unit || ''} x {fmtCurrency(Number(item.price) || 0, currencySymbol)} · Tax {Number(item.tax) || 0}%</p>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-[var(--color-text-muted)]">No products loaded.</p>}
          </Section>

          <Section title="Pricing Summary">
            <Input label="Discount" inputMode="decimal" value={form.discount} onChange={(event) => onFormChange({ discount: event.target.value })} />
            <div className="space-y-2 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3 text-sm">
              <TotalRow label="Subtotal" value={fmtCurrency(totals.subtotal, currencySymbol)} />
              <TotalRow label="Tax" value={fmtCurrency(totals.taxAmount, currencySymbol)} />
              <TotalRow label="Discount" value={fmtCurrency(totals.discount, currencySymbol)} />
              <div className="border-t border-[var(--color-border)] pt-2"><TotalRow label="Grand Total" value={fmtCurrency(totals.grandTotal, currencySymbol)} strong /></div>
            </div>
          </Section>

          <Section title="Billing & Notes">
            <Textarea label="Billing Details" value={form.billingAddress} onChange={(event) => onFormChange({ billingAddress: event.target.value })} />
            <Textarea label="Notes" value={form.notes} onChange={(event) => onFormChange({ notes: event.target.value })} />
            <Input label="Attachment Name" value={form.attachmentName} onChange={(event) => onFormChange({ attachmentName: event.target.value })} />
          </Section>

          {dirty ? <p className="text-xs font-medium text-[var(--color-warning-text)]">Unsaved changes</p> : null}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onCloseForm}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={saving}>Save</Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog open={confirmClose} onClose={onKeepEditing} onConfirm={onDiscard} title="Discard Changes" message="Close this form and discard unsaved changes?" />
    </>
  );
}

function InvoiceViewModal({ invoice, orders, customers, dispatches, payments, currencySymbol, canEdit, canDelete, sending, markingPaid, onClose, onEdit, onDelete, onDuplicate, onNote, onSend, onMarkPaid, onPrint }: {
  invoice: Invoice | null;
  orders: any[];
  customers: any[];
  dispatches: any[];
  payments: any[];
  currencySymbol: string;
  canEdit: boolean;
  canDelete: boolean;
  sending: boolean;
  markingPaid: boolean;
  onClose: () => void;
  onEdit: (invoice: Invoice) => void;
  onDelete: (invoice: Invoice) => void;
  onDuplicate: (invoice: Invoice) => void;
  onNote: (invoice: Invoice) => void;
  onSend: (invoice: Invoice) => void;
  onMarkPaid: (invoice: Invoice) => void;
  onPrint: (invoice: Invoice) => void;
}) {
  if (!invoice) return null;
  const orderId = invoice.orderId || invoice.sourceOrderId;
  const order = orders.find((entry) => entry.id === orderId);
  const phone = invoicePhone(invoice, customers);
  const email = invoiceEmail(invoice, customers);
  const paid = Number(invoice.paidAmount || invoice.amountPaid || 0);
  const balance = Number(invoice.balanceAmount ?? Math.max(0, (Number(invoice.total) || 0) - paid));
  const relatedDispatch = dispatches.filter((entry) => entry.orderId === orderId);
  const relatedPayments = payments.filter((entry) => entry.orderId === orderId || entry.proformaInvoiceId === invoice.id || entry.invoiceId === invoice.id);
  const activity = [
    { type: 'Created', desc: 'Invoice record created', date: invoice.createdAt || invoice.date, userName: invoice.createdByName || 'System' },
    ...(invoice.updatedAt ? [{ type: 'Updated', desc: 'Invoice was updated', date: invoice.updatedAt, userName: invoice.updatedByName || 'System' }] : []),
    ...(invoice.paymentStatus === 'Paid' ? [{ type: 'Paid', desc: 'Invoice marked as paid', date: invoice.paidAt || invoice.updatedAt || invoice.createdAt, userName: invoice.updatedByName || 'System' }] : []),
  ];
  return (
    <Modal open={!!invoice} onClose={onClose} title={invoiceNumber(invoice)} size="full">
      <div className="space-y-4">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">{statusBadge(invoice.status || 'Draft')}{statusBadge(invoice.paymentStatus || 'Pending')}</div>
          <div className="grid grid-cols-2 gap-2">
            <Detail label="Customer" value={invoice.customer || 'Not available'} />
            <Detail label="Total" value={fmtCurrency(Number(invoice.total) || 0, currencySymbol)} />
          </div>
        </section>

        <Section title="Invoice Information">
          <Detail label="Invoice Number" value={invoiceNumber(invoice)} />
          <Detail label="Invoice Date" value={invoice.date ? fmtDate(invoice.date) : 'Not set'} />
          <Detail label="Due Date" value={invoice.dueDate ? fmtDate(invoice.dueDate) : 'Not set'} />
          <Detail label="Template" value={invoice.templateUsed || 'INVOICE'} />
        </Section>

        <Section title="Customer Information">
          <Detail label="Customer" value={invoice.customer || 'Not available'} />
          <Detail label="Mobile" value={phone || 'Not available'} />
          <Detail label="Email" value={email || 'Not available'} />
        </Section>

        <Section title="Order Reference">
          <Detail label="Order" value={order?.orderNumber || order?.orderNo || orderId || 'No order linked'} />
        </Section>

        <Section title="Products">
          {invoice.items?.length ? (
            <div className="space-y-2">
              {invoice.items.map((item: any, index: number) => (
                <div key={index} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                  <p className="text-sm font-semibold text-[var(--color-text)]">{item.product || `Item ${index + 1}`}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{Number(item.qty) || 0} {item.unit || ''} x {fmtCurrency(Number(item.price) || 0, currencySymbol)} · Tax {Number(item.tax) || 0}%</p>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-[var(--color-text-muted)]">No products available.</p>}
        </Section>

        <Section title="Pricing Summary">
          <TotalRow label="Subtotal" value={fmtCurrency(Number(invoice.subtotal) || 0, currencySymbol)} />
          <TotalRow label="Tax Details" value={fmtCurrency(Number(invoice.taxAmount || invoice.taxTotal) || 0, currencySymbol)} />
          <TotalRow label="Discounts" value={fmtCurrency(Number(invoice.discount) || 0, currencySymbol)} />
          <TotalRow label="Grand Total" value={fmtCurrency(Number(invoice.total) || 0, currencySymbol)} strong />
        </Section>

        <Section title="Payment Summary">
          <Detail label="Payment Status" value={invoice.paymentStatus || 'Pending'} />
          <Detail label="Paid Amount" value={fmtCurrency(paid, currencySymbol)} />
          <Detail label="Outstanding" value={fmtCurrency(balance, currencySymbol)} />
          <Detail label="Payment Mode" value={invoice.paymentMode || 'Not selected'} />
        </Section>

        <Section title="Billing Details">
          <p className="text-sm text-[var(--color-text-secondary)]">{invoice.billingAddress || invoice.deliveryAddress || order?.billingAddress || order?.shippingAddress || 'Not available'}</p>
        </Section>

        <Section title="Notes">
          <p className="whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{invoice.notes || 'No notes recorded.'}</p>
        </Section>

        <Section title="Attachments"><p className="text-sm text-[var(--color-text-muted)]">{invoice.attachmentName || invoice.fileName || 'No attachments available.'}</p></Section>

        <Section title="Timeline">
          <MobileTimelinePreview title={`${invoiceNumber(invoice)} Timeline`} entries={activity} />
        </Section>

        <Section title="Payment History">
          {relatedPayments.length ? relatedPayments.map((payment) => <Detail key={payment.id} label={payment.id} value={`${fmtCurrency(Number(payment.amount) || 0, currencySymbol)} · ${payment.status || 'Recorded'}`} />) : <p className="text-sm text-[var(--color-text-muted)]">No payments linked.</p>}
        </Section>

        <Section title="Related Dispatch">
          {relatedDispatch.length ? relatedDispatch.map((dispatch) => <Detail key={dispatch.id} label={dispatch.dispatchNumber || dispatch.id} value={dispatch.status || 'Pending'} />) : <p className="text-sm text-[var(--color-text-muted)]">No dispatch records.</p>}
        </Section>

        <Section title="Audit Information">
          <Detail label="Created By" value={invoice.createdByName || invoice.createdBy || 'System'} />
          <Detail label="Updated" value={invoice.updatedAt ? formatDateLabel(invoice.updatedAt) : 'Not available'} />
        </Section>

        <div className="grid grid-cols-2 gap-2">
          {phone ? <a className={linkButtonClass} href={`tel:${phone}`}><Phone className="h-4 w-4" />Call</a> : null}
          {phone ? <a className={linkButtonClass} href={whatsappHref(phone)} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" />WhatsApp</a> : null}
          {email ? <a className={linkButtonClass} href={`mailto:${email}`}><Mail className="h-4 w-4" />Email</a> : null}
          <Button variant="outline" icon={<Printer className="h-4 w-4" />} onClick={() => onPrint(invoice)}>PDF</Button>
          {canEdit ? <Button variant="outline" icon={<FileText className="h-4 w-4" />} loading={sending} onClick={() => onSend(invoice)}>Send Email</Button> : null}
          {canEdit ? <Button variant="outline" icon={<CheckCircle2 className="h-4 w-4" />} loading={markingPaid} onClick={() => onMarkPaid(invoice)}>Mark Paid</Button> : null}
          {canEdit ? <Button variant="outline" icon={<Copy className="h-4 w-4" />} onClick={() => onDuplicate(invoice)}>Duplicate</Button> : null}
          {canEdit ? <Button variant="outline" icon={<Calendar className="h-4 w-4" />} onClick={() => onNote(invoice)}>Add Note</Button> : null}
          {canEdit ? <Button variant="outline" icon={<Edit2 className="h-4 w-4" />} onClick={() => onEdit(invoice)}>Edit</Button> : null}
          {canDelete ? <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => onDelete(invoice)}>Delete</Button> : null}
        </div>
      </div>
    </Modal>
  );
}

function TotalRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={cn('flex items-center justify-between gap-3 text-sm', strong ? 'font-bold text-[var(--color-text)]' : 'text-[var(--color-text-secondary)]')}><span>{label}</span><span>{value}</span></div>;
}

const linkButtonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-medium text-[var(--color-text)]';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3"><h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{title}</h3><div className="mt-3 space-y-3">{children}</div></section>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p><p className="mt-1 break-words text-sm font-semibold text-[var(--color-text)]">{value}</p></div>;
}

export default MobileInvoiceWorkspace;
