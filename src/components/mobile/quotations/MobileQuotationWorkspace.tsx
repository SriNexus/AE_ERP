import { useEffect, useMemo, useState, useCallback } from 'react';
import type React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSettingsSection } from '../../../features/settings/hooks/useSettingsSection';
import { buildEmailComposePayload, normalizeEmailSettings, openGmailCompose } from '../../../features/settings/emailRuntime';
import type { EmailTemplateKey } from '../../../features/settings/types';
import {
  Calendar,
  Copy,
  Download,
  Edit2,
  FileText,
  Mail,
  MessageCircle,
  Phone,
  Plus,
  ShoppingCart,
  Trash2,
  UserCheck,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge, Button, Card, ConfirmDialog, Input, Modal, Pagination, Select, Textarea, statusBadge } from '../../ui';
import {
  QT_STATUSES,
  QUOTATION_FORM_DEFAULT,
  useQuotations,
  useSalesProducts,
  type QuotationForm,
} from '../../../features/sales/hooks/useSales';
import { useConvertQuotationToOrder } from '../../../features/quotations/hooks/useQuotations';
import { COLLECTIONS } from '../../../lib/firebase';
import { createDocWithId, deleteDocById, fmtCurrency, fmtDate, genId, getAll, getOne, toInputDate, updateDocById, resolveWriteCompanyId } from '../../../lib/firestore';
import { getNextDocumentNumber, resolveDocumentDefaults } from '../../../lib/documentNumbering';
import { usePermissions } from '../../../lib/permissions';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore, useCurrentUser } from '../../../store/useAppStore';
import { resolveBusinessMode } from '../../../lib/companyBusinessMode';
import { filterCustomersForBusinessMode } from '../../../lib/customerClassification';
import { cn } from '../../../utils/cn';
import { MobileTimelinePreview } from '../shared/MobileTimelinePreview';
import { useProjects } from '../../../features/projects/hooks/useProjects';
import { useEngineeringDesigns } from '../../../features/engineering/hooks/useEngineeringDesigns';
import { quotationItemsFromEngineering, synchronizeQuotationProjectLink, updateQuotation } from '../../../lib/quotationWorkflow';

const PER_PAGE = 10;
const ALL = 'All';
const FORM0 = {
  ...QUOTATION_FORM_DEFAULT,
  date: new Date().toISOString().slice(0, 10),
  validUntil: '',
};
const ITEM0 = {
  productId: '',
  product: '',
  description: '',
  hsn: '',
  specs: '',
  warranty: '',
  qty: '1',
  unit: '',
  price: '',
  tax: '0',
  discount: '0',
};

type Mode = 'records' | 'create';
type Quotation = Record<string, any> & { id: string; companyId: string };
type QuoteItem = typeof ITEM0;
type QuoteFilters = {
  search: string;
  status: string;
  date: string;
};

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isThisMonth(value: any): boolean {
  const date = toDate(value);
  if (!date) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function isExpired(quotation: Quotation): boolean {
  const date = toDate(quotation.validUntil);
  if (!date || ['Accepted', 'Rejected'].includes(quotation.status)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
}

function quoteNumber(quotation: Quotation) {
  return quotation.quotationNumber || quotation.quoteNumber || quotation.id || 'Untitled Quotation';
}

function quoteCustomer(quotation: Quotation) {
  return quotation.customer || quotation.customerName || quotation.customerCompany || 'Customer not selected';
}

function quotePhone(quotation: Quotation, customers: any[]) {
  const customer = customers.find((entry) => entry.id === quotation.customerId);
  return quotation.customerPhone || quotation.phone || customer?.phone || customer?.mobile || customer?.businessPhone || '';
}

function quoteEmail(quotation: Quotation, customers: any[]) {
  const customer = customers.find((entry) => entry.id === quotation.customerId);
  return quotation.customerEmail || quotation.email || customer?.email || customer?.businessEmail || '';
}

function whatsappHref(phone?: string) {
  const clean = String(phone || '').replace(/\D/g, '');
  return clean ? `https://wa.me/${clean}` : undefined;
}

function filterQuotations(quotations: Quotation[], filters: QuoteFilters) {
  const term = filters.search.trim().toLowerCase();
  return quotations
    .filter((quotation) => {
      if (filters.status !== ALL && (quotation.status || 'Draft') !== filters.status) return false;
      if (filters.date === 'this_month' && !isThisMonth(quotation.date || quotation.createdAt)) return false;
      if (filters.date === 'expired' && !isExpired(quotation)) return false;
      if (!term) return true;
      return [
        quotation.id,
        quotation.quotationNumber,
        quotation.quoteNumber,
        quotation.orderId,
        quotation.customer,
        quotation.customerName,
        quotation.customerPhone,
        quotation.customerEmail,
        quotation.status,
        quotation.assignedToName,
      ].some((value) => String(value || '').toLowerCase().includes(term));
    })
    .sort((a, b) => {
      const aTime = toDate(a.updatedAt)?.getTime() || toDate(a.createdAt)?.getTime() || toDate(a.date)?.getTime() || 0;
      const bTime = toDate(b.updatedAt)?.getTime() || toDate(b.createdAt)?.getTime() || toDate(b.date)?.getTime() || 0;
      return bTime - aTime;
    });
}

function normalizeItem(item: any): QuoteItem {
  return {
    productId: item.productId || '',
    product: item.product || item.name || '',
    description: item.description || '',
    hsn: item.hsn || item.hsnCode || '',
    specs: item.specs || '',
    warranty: item.warranty || '',
    qty: String(item.qty ?? item.quantity ?? 1),
    unit: item.unit || item.uom || '',
    price: String(item.price ?? item.rate ?? ''),
    tax: String(item.tax ?? item.gst ?? 0),
    discount: String(item.discount ?? 0),
  };
}

function itemAmount(item: QuoteItem) {
  return (Number(item.qty) || 0) * (Number(item.price) || 0);
}

function totalsFor(form: QuotationForm, items: QuoteItem[]) {
  const subtotal = items.reduce((sum, item) => sum + itemAmount(item), 0);
  const taxTotal = items.reduce((sum, item) => sum + (itemAmount(item) * (Number(item.tax) || 0)) / 100, 0);
  const extraCharges = (Number(form.installationCharges) || 0) + (Number(form.transportCharges) || 0);
  const totalDiscount = Number(form.specialDiscount) || 0;
  const grandTotal = Math.round((subtotal + taxTotal + extraCharges - totalDiscount) * 100) / 100;
  return { subtotal, taxTotal, extraCharges, totalDiscount, grandTotal };
}

function downloadQuotationsCsv(rows: Quotation[], filename: string) {
  const headers = ['Quotation', 'Customer', 'Status', 'Date', 'Expiry', 'Subtotal', 'Tax', 'Total'];
  const lines = rows.map((quotation) =>
    [
      quoteNumber(quotation),
      quoteCustomer(quotation),
      quotation.status || 'Draft',
      fmtDate(quotation.date),
      fmtDate(quotation.validUntil),
      quotation.subtotal || 0,
      quotation.taxTotal || 0,
      quotation.total || 0,
    ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','),
  );
  const csv = [headers.join(','), ...lines].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function MobileQuotationWorkspace({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const user = useCurrentUser();
  const company = useAppStore((state) => state.company);
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  const perms = usePermissions();
  const { data: quotations = [], isLoading, error } = useQuotations();
  const { data: products = [] } = useSalesProducts();
  const { data: projects = [] } = useProjects();
  const { data: engineeringDesigns = [] } = useEngineeringDesigns();
  const { data: customers = [] } = useQuery({ queryKey: keys.customersAll, queryFn: () => getAll(COLLECTIONS.CUSTOMERS), staleTime: 60000 });
  // Phase 2: Quotations are shared B2B+B2C infrastructure — exclude only
  // customers whose type isn't valid for this company's Business Mode.
  const businessMode = resolveBusinessMode(company);
  const quotationCustomerOptions = useMemo(() => filterCustomersForBusinessMode(customers as any[], businessMode), [customers, businessMode]);
  const emailSettingsQuery = useSettingsSection('email');
  const emailSettings = useMemo(() => normalizeEmailSettings(emailSettingsQuery.data as Record<string, unknown> | undefined), [emailSettingsQuery.data]);
  const { data: orders = [] } = useQuery({ queryKey: keys.ordersAll, queryFn: () => getAll(COLLECTIONS.ORDERS), staleTime: 60000 });
  const { data: invoices = [] } = useQuery({ queryKey: keys.invoices, queryFn: () => getAll(COLLECTIONS.PROFORMA_INVOICES), staleTime: 60000 });
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => getAll(COLLECTIONS.USERS), staleTime: 300000 });
  const convertToOrder = useConvertQuotationToOrder();

  const sendEmail = useCallback((quotation: Quotation, templateKey: EmailTemplateKey = 'quotation') => {
    const result = buildEmailComposePayload({
      templateKey,
      settings: emailSettings,
      recipientEmail: quoteEmail(quotation, customers as any[]),
      variables: {
        customerName: quotation.customer || quotation.customerName || quotation.customerCompany || (customers as any[]).find((entry: any) => entry.id === quotation.customerId)?.name || '',
        companyName: company?.name || '',
        quotationNumber: quoteNumber(quotation),
        quotationDate: fmtDate(quotation.date || quotation.createdAt),
        validUntil: fmtDate(quotation.validUntil),
        totalAmount: fmtCurrency(Number(quotation.total || 0), company.currencySymbol),
      },
    });
    if (!result.ok) { toast.error(result.error); return false; }
    const opened = openGmailCompose(result.payload.url);
    if (!opened) { toast.error('Could not open Gmail compose. Please allow pop-ups and try again.'); return false; }
    toast.success('Email compose opened');
    return true;
  }, [company?.name, company.currencySymbol, customers, emailSettings]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const [formOpen, setFormOpen] = useState(false);
  const [editingQuotation, setEditingQuotation] = useState<Quotation | null>(null);
  const [form, setForm] = useState<QuotationForm>({ ...FORM0 });
  const [items, setItems] = useState<QuoteItem[]>([{ ...ITEM0 }]);
  const [viewQuotation, setViewQuotation] = useState<Quotation | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [duplicateQuotation, setDuplicateQuotation] = useState<Quotation | null>(null);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkAssignId, setBulkAssignId] = useState('');
  const [noteQuotation, setNoteQuotation] = useState<Quotation | null>(null);
  const [noteText, setNoteText] = useState('');
  const createParam = params.get('create');
  const projectParam = params.get('projectId') || '';
  const designParam = params.get('designId') || '';
  const openParam = params.get('open') || '';

  useEffect(() => {
    if (mode === 'create') setFormOpen(true);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'records' || createParam !== '1' || designParam) return;
    setEditingQuotation(null);
    setForm({ ...FORM0, projectId: projectParam });
    setItems([{ ...ITEM0 }]);
    setDirty(false);
    setFormOpen(true);
  }, [mode, createParam, designParam, projectParam]);

  useEffect(() => {
    if (!designParam || !projects.length || !customers.length) return;
    const design = engineeringDesigns.find((entry) => entry.id === designParam && entry.status === 'Approved');
    if (!design || form.engineeringDesignId === design.id) return;
    setEditingQuotation(null);
    selectEngineeringDesign(design.id);
    setDirty(false);
    setFormOpen(true);
  }, [customers.length, designParam, engineeringDesigns, form.engineeringDesignId, projects]);

  const salesUsers = useMemo(
    () => (users as any[])
      .filter((entry) => ['Sales', 'Executive', 'BDE', 'BDM', 'Manager', 'TL'].includes(entry.role) && entry.status !== 'Inactive' && !entry.isDeleted)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    [users],
  );

  const filters = useMemo<QuoteFilters>(() => ({
    search: params.get('q') || '',
    status: params.get('status') || ALL,
    date: params.get('date') || 'all',
  }), [params]);

  const filteredQuotations = useMemo(() => filterQuotations(quotations as Quotation[], filters), [quotations, filters]);
  const paginatedQuotations = useMemo(() => filteredQuotations.slice((page - 1) * PER_PAGE, page * PER_PAGE), [filteredQuotations, page]);
  const selectedRows = useMemo(() => (quotations as Quotation[]).filter((quotation) => selected.has(quotation.id)), [quotations, selected]);
  const totals = useMemo(() => totalsFor(form, items), [form, items]);
  const canCreate = perms.canCreate('quotations');
  const canEdit = perms.canEdit('quotations');
  const canDelete = perms.canDelete('quotations');
  const canExport = perms.canExport('quotations') || canEdit || canCreate;

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredQuotations.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filteredQuotations.length, page]);

  useEffect(() => {
    setSelected((current) => {
      const available = new Set((quotations as Quotation[]).map((quotation) => quotation.id));
      const next = new Set(Array.from(current).filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [quotations]);

  useEffect(() => {
    if (!openParam || viewQuotation?.id === openParam) return;
    const requested = (quotations as Quotation[]).find((quotation) => quotation.id === openParam);
    if (requested) setViewQuotation(requested);
  }, [openParam, quotations, viewQuotation?.id]);

  function closeViewQuotation() {
    setViewQuotation(null);
    if (!openParam) return;
    const next = new URLSearchParams(params);
    next.delete('open');
    setParams(next, { replace: true });
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
    setEditingQuotation(null);
    setForm({ ...FORM0 });
    setItems([{ ...ITEM0 }]);
    setDirty(false);
    if (mode === 'create') {
      navigate('/app', { replace: true });
      return;
    }
    if (params.get('create') === '1') {
      const next = new URLSearchParams(params);
      next.delete('create');
      setParams(next, { replace: true });
    }
  }

  function requestCloseForm() {
    if (dirty) {
      setConfirmClose(true);
      return;
    }
    closeForm();
  }

  function updateForm(patch: Partial<QuotationForm>) {
    setForm((current) => ({ ...current, ...patch }));
    setDirty(true);
  }

  function updateItem(index: number, patch: Partial<QuoteItem>) {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
    setDirty(true);
  }

  function selectCustomer(customerId: string) {
    const customer = (customers as any[]).find((entry) => entry.id === customerId);
    if (!customer) {
      updateForm({ customerId: '', customer: '', customerPhone: '', customerEmail: '', customerAddress: '', customerGst: '', customerState: '' });
      return;
    }
    updateForm({
      customerId,
      customer: customer.name || customer.fullName || customer.contactPerson || customer.company || customer.companyName || '',
      customerPhone: customer.phone || customer.mobile || customer.businessPhone || '',
      customerEmail: customer.email || customer.businessEmail || '',
      customerAddress: customer.address || [customer.city, customer.state].filter(Boolean).join(', '),
      customerGst: customer.gst || '',
      customerState: customer.state || '',
    });
  }

  function selectProject(projectId: string) {
    const project = projects.find((entry) => entry.id === projectId);
    updateForm({ projectId, engineeringDesignId: '' });
    if (project) selectCustomer(project.customerId);
  }

  function selectEngineeringDesign(designId: string) {
    const design = engineeringDesigns.find((entry) => entry.id === designId);
    if (!design) return updateForm({ engineeringDesignId: '' });
    const project = projects.find((entry) => entry.id === design.projectId);
    updateForm({ projectId: design.projectId, engineeringDesignId: design.id });
    if (project) selectCustomer(project.customerId);
    setItems(quotationItemsFromEngineering(design).map(normalizeItem));
  }

  function selectOrder(orderId: string) {
    const order = (orders as any[]).find((entry) => entry.id === orderId);
    if (!order) {
      updateForm({ orderId: '' });
      return;
    }
    updateForm({
      orderId,
      customerId: order.customerId || '',
      customer: order.customer || order.customerName || '',
      customerAddress: order.shippingAddress || order.customerAddress || '',
    });
    if (Array.isArray(order.items) && order.items.length) {
      setItems(order.items.map(normalizeItem));
      setDirty(true);
    }
  }

  function selectProduct(index: number, productId: string) {
    const product = (products as any[]).find((entry) => entry.id === productId);
    if (!product) {
      updateItem(index, { productId: '', product: '', description: '', hsn: '', specs: '', warranty: '', unit: '', price: '', tax: '0' });
      return;
    }
    updateItem(index, {
      productId,
      product: product.name || product.productName || product.title || '',
      description: product.description || '',
      hsn: product.hsn || product.hsnCode || '',
      specs: product.specs || product.specification || '',
      warranty: product.warranty || '',
      unit: product.unit || product.uom || '',
      price: String(product.price ?? product.sellingPrice ?? product.rate ?? ''),
      tax: String(product.tax ?? product.gst ?? 0),
    });
  }

  function openEdit(quotation: Quotation) {
    setEditingQuotation(quotation);
    setForm({
      orderId: quotation.orderId || '',
      projectId: quotation.projectId || '',
      engineeringDesignId: quotation.engineeringDesignId || '',
      customer: quotation.customer || quotation.customerName || '',
      customerId: quotation.customerId || '',
      customerPhone: quotation.customerPhone || '',
      customerEmail: quotation.customerEmail || '',
      customerAddress: quotation.customerAddress || quotation.address || '',
      customerGst: quotation.customerGst || quotation.gst || '',
      customerState: quotation.customerState || quotation.state || '',
      date: toInputDate(quotation.date) || new Date().toISOString().slice(0, 10),
      validUntil: toInputDate(quotation.validUntil),
      status: quotation.status || 'Draft',
      notes: quotation.notes || '',
      terms: quotation.terms || '',
      deliveryTimeline: quotation.deliveryTimeline || '',
      installationCharges: String(quotation.installationCharges ?? ''),
      transportCharges: String(quotation.transportCharges ?? ''),
      specialDiscount: String(quotation.specialDiscount ?? quotation.discount ?? ''),
    });
    setItems(Array.isArray(quotation.items) && quotation.items.length ? quotation.items.map(normalizeItem) : [{ ...ITEM0 }]);
    setDirty(false);
    setFormOpen(true);
  }

  function payloadForSave() {
    const cleanItems = items
      .filter((item) => item.product || item.productId)
      .map((item) => ({
        productId: item.productId,
        product: item.product,
        description: item.description,
        hsn: item.hsn,
        specs: item.specs,
        warranty: item.warranty,
        qty: Number(item.qty) || 0,
        unit: item.unit,
        price: Number(item.price) || 0,
        tax: Number(item.tax) || 0,
        discount: Number(item.discount) || 0,
        amount: itemAmount(item),
      }));
    return {
      ...form,
      items: cleanItems,
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      extraCharges: totals.extraCharges,
      totalDiscount: totals.totalDiscount,
      total: totals.grandTotal,
      installationCharges: Number(form.installationCharges) || 0,
      transportCharges: Number(form.transportCharges) || 0,
      specialDiscount: Number(form.specialDiscount) || 0,
      createdByName: user.name,
    };
  }

  const saveQuotation = useMutation({
    mutationFn: async () => {
      if (!form.customer && !form.customerId) throw new Error('Customer is required');
      const cleanItems = items.filter((item) => item.product || item.productId);
      if (!cleanItems.length) throw new Error('Add at least one product');
      const payload = payloadForSave();
      const { projectId, engineeringDesignId, ...quotationPayload } = payload;
      if (editingQuotation) {
        // Lock-guarded update: a quotation converted to an Order can never
        // be edited — the rule is enforced at the service layer, so this
        // mobile edit path is covered too (see updateQuotation in
        // lib/quotationWorkflow.ts).
        await updateQuotation(editingQuotation.id, quotationPayload);
        await synchronizeQuotationProjectLink(editingQuotation.id, projectId, engineeringDesignId);
        return { ...editingQuotation, ...quotationPayload, projectId, engineeringDesignId };
      }
      const documentDefaults = await resolveDocumentDefaults(company?.id);
      const id = genId.quotation(company?.quotationPrefix || 'QT');
      const { documentNumber } = await getNextDocumentNumber(resolveWriteCompanyId(), 'quotation');
      const quotation = {
        ...quotationPayload,
        id,
        quotationNumber: documentNumber,
        quoteNumber: documentNumber,
        refNo: documentNumber,
        terms: quotationPayload.terms || documentDefaults.settings.defaultTerms,
        notes: quotationPayload.notes || documentDefaults.settings.defaultNotes,
        validUntil: quotationPayload.validUntil || new Date(Date.now() + documentDefaults.settings.piValidityDays * 86400000).toISOString().slice(0, 10),
      };
      await createDocWithId(COLLECTIONS.QUOTATIONS, id, quotation);
      await synchronizeQuotationProjectLink(id, projectId, engineeringDesignId);
      return { ...quotation, projectId, engineeringDesignId };
    },
    onSuccess: (quotation) => {
      void qc.invalidateQueries({ queryKey: keys.quotationsRoot });
      void qc.invalidateQueries({ queryKey: keys.projectsRoot });
      toast.success(editingQuotation ? 'Quotation updated' : 'Quotation created');
      closeForm();
      setViewQuotation(quotation as Quotation);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => deleteDocById(COLLECTIONS.QUOTATIONS, id)));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.quotationsRoot });
      toast.success(`Deleted ${selectedRows.length || 1} quotation${selectedRows.length === 1 ? '' : 's'}`);
      setSelected(new Set());
      setDeleteOpen(false);
      setViewQuotation(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      await Promise.all(ids.map((id) => updateDocById(COLLECTIONS.QUOTATIONS, id, { status })));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.quotationsRoot });
      toast.success(`Updated ${selected.size} quotation${selected.size === 1 ? '' : 's'}`);
      setSelected(new Set());
      setBulkStatus('');
      setBulkStatusOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkAssignMutation = useMutation({
    mutationFn: async ({ ids, assigneeId, assigneeName }: { ids: string[]; assigneeId: string; assigneeName: string }) => {
      await Promise.all(ids.map((id) => updateDocById(COLLECTIONS.QUOTATIONS, id, { assignedToId: assigneeId, assignedToName: assigneeName })));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.quotationsRoot });
      toast.success(`Assigned ${selected.size} quotation${selected.size === 1 ? '' : 's'}`);
      setSelected(new Set());
      setBulkAssignId('');
      setBulkAssignOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const addNote = useMutation({
    mutationFn: async ({ quotation, note }: { quotation: Quotation; note: string }) => {
      const logEntry = { id: genId.generic('LOG'), type: 'Note', desc: note, date: new Date().toISOString(), userName: user.name };
      await updateDocById(COLLECTIONS.QUOTATIONS, quotation.id, {
        notes: [quotation.notes, note].filter(Boolean).join('\n'),
        activityLog: [...(quotation.activityLog || []), logEntry],
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.quotationsRoot });
      toast.success('Note added');
      setNoteQuotation(null);
      setNoteText('');
    },
    onError: (e: any) => toast.error(e.message),
  });

  function submitQuotation(event: React.FormEvent) {
    event.preventDefault();
    saveQuotation.mutate();
  }

  function duplicateCurrent() {
    if (!duplicateQuotation) return;
    setEditingQuotation(null);
    setForm({
      ...FORM0,
      ...Object.fromEntries(Object.keys(FORM0).map((key) => [key, duplicateQuotation[key] || (FORM0 as any)[key]])),
      date: new Date().toISOString().slice(0, 10),
      status: 'Draft',
    } as QuotationForm);
    setItems(Array.isArray(duplicateQuotation.items) && duplicateQuotation.items.length ? duplicateQuotation.items.map(normalizeItem) : [{ ...ITEM0 }]);
    setDuplicateQuotation(null);
    setDirty(true);
    setFormOpen(true);
  }

  function exportRows(rows: Quotation[]) {
    if (!rows.length) return toast.error('No quotations selected');
    downloadQuotationsCsv(rows, `quotations-export-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${rows.length} quotation${rows.length === 1 ? '' : 's'}`);
  }

  async function printQuotation(quotation: Quotation) {
    const toastId = toast.loading('Generating quotation PDF...');
    try {
      const fullCompany = await getOne(COLLECTIONS.COMPANIES, quotation.companyId || company?.id) || company;
      const { DocumentTemplateResolver, triggerPrint } = await import('../../../templates/documents/resolver');
      const html = DocumentTemplateResolver(fullCompany as any, 'QUOTATION', quotation);
      triggerPrint(html);
      toast.success('Quotation document ready', { id: toastId });
    } catch (error: any) {
      toast.error(`Failed to generate quotation: ${error.message}`, { id: toastId });
    }
  }

  if (mode === 'create') {
    return (
      <QuotationDialogs
        formOpen={formOpen}
        form={form}
        items={items}
        products={products as any[]}
        customers={quotationCustomerOptions}
        orders={orders as any[]}
        projects={projects}
        engineeringDesigns={engineeringDesigns}
        salesUsers={salesUsers}
        editingQuotation={editingQuotation}
        totals={totals}
        dirty={dirty}
        saving={saveQuotation.isPending}
        confirmClose={confirmClose}
        onCloseForm={requestCloseForm}
        onDiscard={() => {
          setConfirmClose(false);
          closeForm();
        }}
        onKeepEditing={() => setConfirmClose(false)}
        onFormChange={updateForm}
        onCustomerSelect={selectCustomer}
        onOrderSelect={selectOrder}
        onProjectSelect={selectProject}
        onEngineeringDesignSelect={selectEngineeringDesign}
        onItemChange={updateItem}
        onProductSelect={selectProduct}
        onAddItem={() => {
          setItems((current) => [...current, { ...ITEM0 }]);
          setDirty(true);
        }}
        onRemoveItem={(index) => {
          setItems((current) => current.length === 1 ? current : current.filter((_, itemIndex) => itemIndex !== index));
          setDirty(true);
        }}
        onSubmit={submitQuotation}
      />
    );
  }

  return (
    <div className="space-y-4 pb-2 pt-2">
      <div className="px-1 pb-1 pt-2">
        <h1 className="text-xl font-bold text-[var(--color-text)]">Quotations</h1>
      </div>

      {selected.size > 0 && (
        <Card className="rounded-xl p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-xs font-semibold text-[var(--color-primary-text)]">{selected.size} selected</span>
            {canExport && <Button size="xs" variant="outline" icon={<Download className="h-3 w-3" />} onClick={() => exportRows(selectedRows)}>Export</Button>}
            {canEdit && <Button size="xs" variant="outline" icon={<UserCheck className="h-3 w-3" />} onClick={() => setBulkAssignOpen(true)}>Assign</Button>}
            {canEdit && <Button size="xs" variant="outline" onClick={() => setBulkStatusOpen(true)}>Status</Button>}
            {canDelete && <Button size="xs" variant="danger" icon={<Trash2 className="h-3 w-3" />} onClick={() => setDeleteOpen(true)}>Delete</Button>}
            <button type="button" onClick={() => setSelected(new Set())} className="px-2 py-1 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">Clear</button>
          </div>
        </Card>
      )}

      {error && (
        <div className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-light)] px-3 py-2 text-sm text-[var(--color-danger-text)]">
          {(error as Error).message}
        </div>
      )}

      <div className="space-y-3">
        {isLoading && Array.from({ length: 5 }).map((_, index) => <QuotationSkeletonCard key={index} />)}
        {!isLoading && filteredQuotations.length === 0 && (
          <Card className="rounded-xl p-5 text-center text-sm text-[var(--color-text-muted)]">
            No quotations match the current filters.
          </Card>
        )}
        {!isLoading && paginatedQuotations.map((quotation) => (
          <QuotationCard
            key={quotation.id}
            quotation={quotation}
            customers={customers as any[]}
            selected={selected.has(quotation.id)}
            currencySymbol={company?.currencySymbol || '₹'}
            onSelect={() => toggleSelect(quotation.id)}
            onView={() => setViewQuotation(quotation)}
          />
        ))}
      </div>

      {!isLoading && filteredQuotations.length > 0 && (
        <Pagination page={page} total={filteredQuotations.length} perPage={PER_PAGE} onChange={changePage} />
      )}

      <QuotationViewModal
        quotation={viewQuotation}
        customers={customers as any[]}
        orders={orders as any[]}
        invoices={invoices as any[]}
        currencySymbol={company?.currencySymbol || '₹'}
        canEdit={canEdit}
        canDelete={canDelete}
        canConvert={perms.canCreate('orders')}
        converting={convertToOrder.isPending}
        onClose={closeViewQuotation}
        onEdit={(quotation) => {
          setViewQuotation(null);
          openEdit(quotation);
        }}
        onDelete={(quotation) => {
          setSelected(new Set([quotation.id]));
          setViewQuotation(null);
          setDeleteOpen(true);
        }}
        onDuplicate={(quotation) => {
          setViewQuotation(null);
          setDuplicateQuotation(quotation);
        }}
        onNote={(quotation) => {
          setViewQuotation(null);
          setNoteQuotation(quotation);
        }}
        onPrint={printQuotation}
        onConvert={(quotation) => convertToOrder.mutate(quotation)}
        onSendEmail={() => sendEmail(viewQuotation!, 'quotation')}
      />

      <QuotationDialogs
        formOpen={formOpen}
        form={form}
        items={items}
        products={products as any[]}
        customers={quotationCustomerOptions}
        orders={orders as any[]}
        projects={projects}
        engineeringDesigns={engineeringDesigns}
        salesUsers={salesUsers}
        editingQuotation={editingQuotation}
        totals={totals}
        dirty={dirty}
        saving={saveQuotation.isPending}
        confirmClose={confirmClose}
        onCloseForm={requestCloseForm}
        onDiscard={() => {
          setConfirmClose(false);
          closeForm();
        }}
        onKeepEditing={() => setConfirmClose(false)}
        onFormChange={updateForm}
        onCustomerSelect={selectCustomer}
        onOrderSelect={selectOrder}
        onProjectSelect={selectProject}
        onEngineeringDesignSelect={selectEngineeringDesign}
        onItemChange={updateItem}
        onProductSelect={selectProduct}
        onAddItem={() => {
          setItems((current) => [...current, { ...ITEM0 }]);
          setDirty(true);
        }}
        onRemoveItem={(index) => {
          setItems((current) => current.length === 1 ? current : current.filter((_, itemIndex) => itemIndex !== index));
          setDirty(true);
        }}
        onSubmit={submitQuotation}
      />

      <Modal open={bulkStatusOpen} onClose={() => setBulkStatusOpen(false)} title="Change Status" size="sm">
        <div className="space-y-4">
          <Select label="New Status" value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value)} options={[{ label: 'Select status...', value: '' }, ...QT_STATUSES.map((status) => ({ label: status, value: status }))]} />
          <Button className="w-full" loading={bulkStatusMutation.isPending} onClick={() => {
            if (!bulkStatus) return toast.error('Select a status');
            bulkStatusMutation.mutate({ ids: Array.from(selected), status: bulkStatus });
          }}>
            Update {selected.size} Quotations
          </Button>
        </div>
      </Modal>

      <Modal open={bulkAssignOpen} onClose={() => setBulkAssignOpen(false)} title="Assign Quotations" size="sm">
        <div className="space-y-4">
          <Select label="Assign To" value={bulkAssignId} onChange={(event) => setBulkAssignId(event.target.value)} options={[{ label: 'Select salesperson...', value: '' }, ...salesUsers.map((entry) => ({ label: entry.name, value: entry.id }))]} />
          <Button className="w-full" loading={bulkAssignMutation.isPending} onClick={() => {
            const assignee = salesUsers.find((entry) => entry.id === bulkAssignId);
            if (!assignee) return toast.error('Select a salesperson');
            bulkAssignMutation.mutate({ ids: Array.from(selected), assigneeId: assignee.id, assigneeName: assignee.name });
          }}>
            Assign {selected.size} Quotations
          </Button>
        </div>
      </Modal>

      <Modal open={!!noteQuotation} onClose={() => setNoteQuotation(null)} title="Add Note" size="full">
        <div className="space-y-4">
          <Textarea label="Note" required value={noteText} onChange={(event) => setNoteText(event.target.value)} />
          <Button className="w-full" loading={addNote.isPending} onClick={() => {
            if (!noteQuotation || !noteText.trim()) return toast.error('Note required');
            addNote.mutate({ quotation: noteQuotation, note: noteText.trim() });
          }}>
            Save Note
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!duplicateQuotation}
        onClose={() => setDuplicateQuotation(null)}
        onConfirm={duplicateCurrent}
        title="Duplicate Quotation"
        message={`Create a draft copy of ${duplicateQuotation ? quoteNumber(duplicateQuotation) : 'this quotation'}?`}
        confirmLabel="Duplicate"
        danger={false}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate(Array.from(selected))}
        loading={deleteMutation.isPending}
        title="Delete Quotations"
        message={`Delete ${selectedRows.length} selected quotation${selectedRows.length === 1 ? '' : 's'}?`}
      />
    </div>
  );
}

function QuotationCard({ quotation, customers, selected, currencySymbol, onSelect, onView }: {
  quotation: Quotation;
  customers: any[];
  selected: boolean;
  currencySymbol: string;
  onSelect: () => void;
  onView: () => void;
}) {
  const phone = quotePhone(quotation, customers);
  const email = quoteEmail(quotation, customers);
  const whatsapp = whatsappHref(phone);
  return (
    <Card className={cn(
      'rounded-xl border border-[var(--color-border-subtle)] p-3 shadow-sm transition-shadow',
      'hover:shadow-[var(--shadow-enterprise-row)]',
      selected && 'border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/40',
      isExpired(quotation) && 'border-l-4 border-l-red-500',
    )}>
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          className="mt-1 rounded border-[var(--color-border)] text-[var(--color-primary)]"
          aria-label={`Select ${quoteNumber(quotation)}`}
        />
        <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
          <p className="truncate text-[15px] font-bold leading-5 text-[var(--color-text)]">{quoteNumber(quotation)}</p>
          <p className="mt-0.5 truncate text-xs font-medium text-[var(--color-text-muted)]">{quoteCustomer(quotation)}</p>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs leading-5 text-[var(--color-text-muted)]">
            <p className="truncate">{fmtCurrency(Number(quotation.total) || 0, currencySymbol)}</p>
            <p className="truncate">{quotation.date ? fmtDate(quotation.date) : 'Date not set'}</p>
            <p className="truncate">{quotation.validUntil ? `Exp ${fmtDate(quotation.validUntil)}` : 'No expiry'}</p>
            <p className="truncate">{quotation.assignedToName || quotation.createdByName || 'Unassigned'}</p>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {statusBadge(quotation.status || 'Draft')}
            {quotation.orderId ? <Badge variant="gray">Order linked</Badge> : null}
            {quotation.items?.length ? <Badge variant="info">{quotation.items.length} item{quotation.items.length === 1 ? '' : 's'}</Badge> : null}
          </div>
        </button>
        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <a href={whatsapp} target="_blank" rel="noreferrer" aria-label="WhatsApp quotation" className={cn(actionIconClass, 'bg-emerald-50/90 text-emerald-600 ring-emerald-100 dark:bg-emerald-900/25 dark:text-emerald-300 dark:ring-emerald-800/60', !whatsapp && 'pointer-events-none opacity-40')}>
            <MessageCircle className="h-4 w-4" strokeWidth={2.25} />
          </a>
          <a href={email ? `mailto:${email}` : undefined} aria-label="Email quotation" className={cn(actionIconClass, 'bg-amber-50/90 text-amber-600 ring-amber-100 dark:bg-amber-900/25 dark:text-amber-300 dark:ring-amber-800/60', !email && 'pointer-events-none opacity-40')}>
            <Mail className="h-4 w-4" strokeWidth={2.2} />
          </a>
          <a href={phone ? `tel:${phone}` : undefined} aria-label="Call quotation" className={cn(actionIconClass, 'bg-blue-50/90 text-blue-600 ring-blue-100 dark:bg-blue-900/25 dark:text-blue-300 dark:ring-blue-800/60', !phone && 'pointer-events-none opacity-40')}>
            <Phone className="h-4 w-4" strokeWidth={2.25} />
          </a>
        </div>
      </div>
    </Card>
  );
}

const actionIconClass = 'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/60 shadow-sm ring-1 backdrop-blur-sm transition-transform active:scale-95';

function QuotationSkeletonCard() {
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

function QuotationDialogs({ formOpen, form, items, products, customers, orders, projects, engineeringDesigns, salesUsers, editingQuotation, totals, dirty, saving, confirmClose, onCloseForm, onDiscard, onKeepEditing, onFormChange, onCustomerSelect, onOrderSelect, onProjectSelect, onEngineeringDesignSelect, onItemChange, onProductSelect, onAddItem, onRemoveItem, onSubmit }: {
  formOpen: boolean;
  form: QuotationForm;
  items: QuoteItem[];
  products: any[];
  customers: any[];
  orders: any[];
  projects: Array<{ id: string; projectId: string; currentStage: string }>;
  engineeringDesigns: Array<{ id: string; designId: string; projectId: string; status: string; systemCapacityKw: number }>;
  salesUsers: any[];
  editingQuotation: Quotation | null;
  totals: ReturnType<typeof totalsFor>;
  dirty: boolean;
  saving: boolean;
  confirmClose: boolean;
  onCloseForm: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
  onFormChange: (patch: Partial<QuotationForm>) => void;
  onCustomerSelect: (customerId: string) => void;
  onOrderSelect: (orderId: string) => void;
  onProjectSelect: (projectId: string) => void;
  onEngineeringDesignSelect: (designId: string) => void;
  onItemChange: (index: number, patch: Partial<QuoteItem>) => void;
  onProductSelect: (index: number, productId: string) => void;
  onAddItem: () => void;
  onRemoveItem: (index: number) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <>
      <Modal open={formOpen} onClose={onCloseForm} title={editingQuotation ? 'Edit Quotation' : 'Create Quotation'} size="full">
        <form onSubmit={onSubmit} className="space-y-4">
          <Section title="Project Link">
            <Select
              label="Project (optional)"
              value={form.projectId}
              onChange={(event) => onProjectSelect(event.target.value)}
              options={[{ label: 'Not linked', value: '' }, ...projects.map(project => ({ label: `${project.projectId} · ${project.currentStage}`, value: project.id }))]}
            />
            <Select
              label="Approved Engineering Design"
              value={form.engineeringDesignId}
              disabled={!form.projectId}
              onChange={(event) => onEngineeringDesignSelect(event.target.value)}
              options={[{ label: 'No engineering prefill', value: '' }, ...engineeringDesigns
                .filter(design => design.status === 'Approved' && design.projectId === form.projectId)
                .map(design => ({ label: `${design.designId} · ${design.systemCapacityKw} kW`, value: design.id }))]}
            />
            <p className="text-xs text-[var(--color-text-muted)]">Engineering prefill is editable and intentionally leaves commercial pricing at zero.</p>
          </Section>
          <Section title="Customer Selection">
            <Select
              label="Customer"
              required
              value={form.customerId}
              onChange={(event) => onCustomerSelect(event.target.value)}
              options={[{ label: 'Select customer...', value: '' }, ...customers.map((customer) => ({
                label: customer.name || customer.fullName || customer.contactPerson || customer.company || customer.id,
                value: customer.id,
              }))]}
            />
            <Select
              label="Linked Order"
              value={form.orderId}
              onChange={(event) => onOrderSelect(event.target.value)}
              options={[{ label: 'No source order', value: '' }, ...orders.map((order) => ({ label: order.orderNumber || order.id, value: order.id }))]}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Mobile" value={form.customerPhone} onChange={(event) => onFormChange({ customerPhone: event.target.value })} />
              <Input label="Email" type="email" value={form.customerEmail} onChange={(event) => onFormChange({ customerEmail: event.target.value })} />
            </div>
            <Textarea label="Address" value={form.customerAddress} onChange={(event) => onFormChange({ customerAddress: event.target.value })} />
          </Section>

          <Section title="Quotation Information">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Quotation Date" required type="date" value={form.date} onChange={(event) => onFormChange({ date: event.target.value })} />
              <Input label="Valid Until" type="date" value={form.validUntil} onChange={(event) => onFormChange({ validUntil: event.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Select label="Status" value={form.status} onChange={(event) => onFormChange({ status: event.target.value })} options={QT_STATUSES.map((status) => ({ label: status, value: status }))} />
              <Select
                label="Assigned To"
                value={(form as any).assignedToId || ''}
                onChange={(event) => {
                  const assignee = salesUsers.find((entry) => entry.id === event.target.value);
                  onFormChange({ ...(event.target.value ? { assignedToId: event.target.value, assignedToName: assignee?.name || '' } : { assignedToId: '', assignedToName: '' }) } as any);
                }}
                options={[{ label: 'Unassigned', value: '' }, ...salesUsers.map((entry) => ({ label: entry.name, value: entry.id }))]}
              />
            </div>
            <Input label="Delivery Timeline" value={form.deliveryTimeline} onChange={(event) => onFormChange({ deliveryTimeline: event.target.value })} />
          </Section>

          <Section title="Items / Products">
            <div className="space-y-3">
              {items.map((item, index) => (
                <div key={index} className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                  <div className="flex items-center gap-2">
                    <p className="mr-auto text-sm font-bold text-[var(--color-text)]">Item {index + 1}</p>
                    <Button type="button" size="xs" variant="ghost" icon={<Trash2 className="h-3 w-3" />} onClick={() => onRemoveItem(index)} disabled={items.length === 1}>Remove</Button>
                  </div>
                  <div className="mt-3 space-y-3">
                    <Select
                      label="Product"
                      value={item.productId}
                      onChange={(event) => onProductSelect(index, event.target.value)}
                      options={[{ label: 'Select product...', value: '' }, ...products.map((product) => ({
                        label: product.name || product.productName || product.title || product.id,
                        value: product.id,
                      }))]}
                    />
                    <Input label="Product Name" required value={item.product} onChange={(event) => onItemChange(index, { product: event.target.value })} />
                    <Textarea label="Description" value={item.description} onChange={(event) => onItemChange(index, { description: event.target.value })} />
                    <div className="grid grid-cols-3 gap-3">
                      <Input label="Qty" inputMode="decimal" value={item.qty} onChange={(event) => onItemChange(index, { qty: event.target.value })} />
                      <Input label="Rate" inputMode="decimal" value={item.price} onChange={(event) => onItemChange(index, { price: event.target.value })} />
                      <Input label="Tax %" inputMode="decimal" value={item.tax} onChange={(event) => onItemChange(index, { tax: event.target.value })} />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <Input label="Discount" inputMode="decimal" value={item.discount} onChange={(event) => onItemChange(index, { discount: event.target.value })} />
                      <Input label="Unit" value={item.unit} onChange={(event) => onItemChange(index, { unit: event.target.value })} />
                      <Input label="HSN" value={item.hsn} onChange={(event) => onItemChange(index, { hsn: event.target.value })} />
                    </div>
                    <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 text-right text-sm font-bold text-[var(--color-text)]">
                      Amount {fmtCurrency(itemAmount(item))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" className="w-full" icon={<Plus className="h-4 w-4" />} onClick={onAddItem}>Add Item</Button>
          </Section>

          <Section title="Pricing Summary">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Installation" inputMode="decimal" value={form.installationCharges} onChange={(event) => onFormChange({ installationCharges: event.target.value })} />
              <Input label="Transport" inputMode="decimal" value={form.transportCharges} onChange={(event) => onFormChange({ transportCharges: event.target.value })} />
            </div>
            <Input label="Overall Discount" inputMode="decimal" value={form.specialDiscount} onChange={(event) => onFormChange({ specialDiscount: event.target.value })} />
            <div className="space-y-2 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3 text-sm">
              <TotalRow label="Subtotal" value={fmtCurrency(totals.subtotal)} />
              <TotalRow label="Tax" value={fmtCurrency(totals.taxTotal)} />
              <TotalRow label="Extra Charges" value={fmtCurrency(totals.extraCharges)} />
              <TotalRow label="Discount" value={fmtCurrency(totals.totalDiscount)} />
              <div className="border-t border-[var(--color-border)] pt-2">
                <TotalRow label="Grand Total" value={fmtCurrency(totals.grandTotal)} strong />
              </div>
            </div>
          </Section>

          <Section title="Terms & Notes">
            <Textarea label="Terms & Conditions" value={form.terms} onChange={(event) => onFormChange({ terms: event.target.value })} />
            <Textarea label="Notes" value={form.notes} onChange={(event) => onFormChange({ notes: event.target.value })} />
          </Section>

          {dirty ? <p className="text-xs font-medium text-[var(--color-warning-text)]">Unsaved changes</p> : null}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onCloseForm}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={saving}>{editingQuotation ? 'Save' : 'Create'}</Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog open={confirmClose} onClose={onKeepEditing} onConfirm={onDiscard} title="Discard Changes" message="Close this form and discard unsaved changes?" />
    </>
  );
}

function QuotationViewModal({ quotation, customers, orders, invoices, currencySymbol, canEdit, canDelete, canConvert, converting, onClose, onEdit, onDelete, onDuplicate, onNote, onPrint, onConvert, onSendEmail }: {
  quotation: Quotation | null;
  customers: any[];
  orders: any[];
  invoices: any[];
  currencySymbol: string;
  canEdit: boolean;
  canDelete: boolean;
  canConvert: boolean;
  converting: boolean;
  onClose: () => void;
  onEdit: (quotation: Quotation) => void;
  onDelete: (quotation: Quotation) => void;
  onDuplicate: (quotation: Quotation) => void;
  onNote: (quotation: Quotation) => void;
  onPrint: (quotation: Quotation) => void;
  onConvert: (quotation: Quotation) => void;
  onSendEmail: () => void;
}) {
  if (!quotation) return null;
  const phone = quotePhone(quotation, customers);
  const email = quoteEmail(quotation, customers);
  const activity = quotation.activityLog || [];
  const relatedOrders = orders.filter((order) => order.quotationId === quotation.id || order.sourceQuotationId === quotation.id || quotation.convertedOrderId === order.id);
  const relatedInvoices = invoices.filter((invoice) => invoice.quotationId === quotation.id || invoice.customerId === quotation.customerId);
  return (
    <Modal open={!!quotation} onClose={onClose} title={quoteNumber(quotation)} size="full">
      <div className="space-y-4">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {statusBadge(quotation.status || 'Draft')}
            {quotation.convertedOrderId ? <Badge variant="success">Converted</Badge> : null}
            {isExpired(quotation) ? <Badge variant="danger">Expired</Badge> : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Detail label="Customer" value={quoteCustomer(quotation)} />
            <Detail label="Total" value={fmtCurrency(Number(quotation.total) || 0, currencySymbol)} />
          </div>
        </section>

        <Section title="Quotation Information">
          <Detail label="Quotation Number" value={quoteNumber(quotation)} />
          <Detail label="Date" value={quotation.date ? fmtDate(quotation.date) : 'Not set'} />
          <Detail label="Expiry Date" value={quotation.validUntil ? fmtDate(quotation.validUntil) : 'Not set'} />
          <Detail label="Assigned To" value={quotation.assignedToName || 'Unassigned'} />
        </Section>

        <Section title="Customer Information">
          <Detail label="Customer" value={quoteCustomer(quotation)} />
          <Detail label="GST" value={quotation.customerGst || 'Not available'} />
          <Detail label="State" value={quotation.customerState || 'Not available'} />
        </Section>

        <Section title="Contact Details">
          <Detail label="Mobile" value={phone || 'Not available'} />
          <Detail label="Email" value={email || 'Not available'} />
        </Section>

        <Section title="Items / Products">
          {quotation.items?.length ? (
            <div className="space-y-2">
              {quotation.items.map((item: any, index: number) => (
                <div key={index} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                  <p className="text-sm font-semibold text-[var(--color-text)]">{item.product || item.productId || `Item ${index + 1}`}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{Number(item.qty) || 0} x {fmtCurrency(Number(item.price) || 0, currencySymbol)} · Tax {Number(item.tax) || 0}%</p>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-[var(--color-text-muted)]">No products added.</p>}
        </Section>

        <Section title="Pricing Summary">
          <TotalRow label="Subtotal" value={fmtCurrency(Number(quotation.subtotal) || 0, currencySymbol)} />
          <TotalRow label="Tax Details" value={fmtCurrency(Number(quotation.taxTotal) || 0, currencySymbol)} />
          <TotalRow label="Discounts" value={fmtCurrency(Number(quotation.specialDiscount || quotation.totalDiscount) || 0, currencySymbol)} />
          <TotalRow label="Grand Total" value={fmtCurrency(Number(quotation.total) || 0, currencySymbol)} strong />
        </Section>

        <Section title="Terms & Conditions">
          <p className="whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{quotation.terms || 'No terms recorded.'}</p>
        </Section>

        <Section title="Notes">
          <p className="whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{quotation.notes || 'No notes recorded.'}</p>
        </Section>

        <Section title="Attachments">
          <p className="text-sm text-[var(--color-text-muted)]">{quotation.attachmentName || quotation.fileName || 'No attachments available.'}</p>
        </Section>

        <Section title="Timeline">
          <MobileTimelinePreview title={`${quoteNumber(quotation)} Timeline`} entries={activity} />
        </Section>

        <Section title="Activities">
          <Detail label="Calls" value={quotation.callCount ? String(quotation.callCount) : 'No calls logged'} />
          <Detail label="Meetings" value={quotation.meetingCount ? String(quotation.meetingCount) : 'No meetings logged'} />
          <Detail label="Emails / WhatsApp" value={quotation.messageCount ? String(quotation.messageCount) : 'No messages logged'} />
        </Section>

        <RelatedSection title="Related Orders" rows={relatedOrders} empty="No related orders." labelFor={(row) => row.orderNumber || row.id} />
        <RelatedSection title="Related Invoices" rows={relatedInvoices} empty="No related invoices." labelFor={(row) => row.invoiceNumber || row.id} />

        <Section title="Audit Information">
          <Detail label="Created By" value={quotation.createdByName || quotation.createdBy || 'System'} />
          <Detail label="Updated" value={quotation.updatedAt ? fmtDate(quotation.updatedAt) : 'Not available'} />
        </Section>

        <div className="grid grid-cols-2 gap-2">
          {phone ? <a className={linkButtonClass} href={`tel:${phone}`}><Phone className="h-4 w-4" />Call</a> : null}
          {phone ? <a className={linkButtonClass} href={whatsappHref(phone)} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" />WhatsApp</a> : null}
          {email ? <Button variant="outline" icon={<Mail className="h-4 w-4" />} onClick={() => onSendEmail()}>Send Email</Button> : null}
          <Button variant="outline" icon={<FileText className="h-4 w-4" />} onClick={() => onPrint(quotation)}>Print</Button>
          {canEdit ? <Button variant="outline" icon={<Copy className="h-4 w-4" />} onClick={() => onDuplicate(quotation)}>Duplicate</Button> : null}
          {canEdit ? <Button variant="outline" icon={<Calendar className="h-4 w-4" />} onClick={() => onNote(quotation)}>Add Note</Button> : null}
          {canEdit ? <Button variant="outline" icon={<Edit2 className="h-4 w-4" />} onClick={() => onEdit(quotation)}>Edit</Button> : null}
          {canConvert && quotation.status !== 'Rejected' ? <Button variant="success" icon={<ShoppingCart className="h-4 w-4" />} loading={converting} onClick={() => onConvert(quotation)}>Convert</Button> : null}
          {canDelete ? <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => onDelete(quotation)}>Delete</Button> : null}
        </div>
      </div>
    </Modal>
  );
}

function RelatedSection({ title, rows, empty, labelFor }: { title: string; rows: any[]; empty: string; labelFor: (row: any) => string }) {
  return (
    <Section title={title}>
      {rows.length ? (
        <div className="space-y-2">
          {rows.slice(0, 5).map((row) => (
            <div key={row.id} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
              <p className="text-sm font-semibold text-[var(--color-text)]">{labelFor(row)}</p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">{row.status || fmtDate(row.createdAt)}</p>
            </div>
          ))}
        </div>
      ) : <p className="text-sm text-[var(--color-text-muted)]">{empty}</p>}
    </Section>
  );
}

function TotalRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 text-sm', strong ? 'font-bold text-[var(--color-text)]' : 'text-[var(--color-text-secondary)]')}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

const linkButtonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-medium text-[var(--color-text)]';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{title}</h3>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-[var(--color-text)]">{value}</p>
    </div>
  );
}

export default MobileQuotationWorkspace;
