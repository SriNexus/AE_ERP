import { useEffect, useMemo, useState, useCallback } from 'react';
import type React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
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
  Printer,
  ReceiptText,
  Truck,
  Trash2,
  UserCheck,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { ORDER_STATUSES, PAYMENT_MODES, PAYMENT_STATUSES } from '../../../config/company';
import { useGeneratePIFromOrder, useMarkPIAsPaid } from '../../../features/orders/hooks/useOrders';
import { useOrders } from '../../../features/sales/hooks/useSales';
import { Badge, Button, Card, ConfirmDialog, Input, Modal, Pagination, Select, Textarea, statusBadge } from '../../ui';
import { COLLECTIONS } from '../../../lib/firebase';
import { createDocWithId, deleteDocById, fmtCurrency, fmtDate, genId, getAll, toInputDate, updateDocById, resolveWriteCompanyId } from '../../../lib/firestore';
import { getNextDocumentNumber, resolveDocumentDefaults } from '../../../lib/documentNumbering';
import { notifyRoleUsers } from '../../../lib/notifications';
import { getProductHistory } from '../../../lib/pricingEngine';
import { usePermissions } from '../../../lib/permissions';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore, useCurrentUser } from '../../../store/useAppStore';
import { resolveBusinessMode } from '../../../lib/companyBusinessMode';
import { filterCustomersForBusinessMode } from '../../../lib/customerClassification';
import { NotificationType, type Order as SharedOrder, type ProformaInvoice } from '../../../types';
import { cn } from '../../../utils/cn';
import { MobileTimelinePreview } from '../shared/MobileTimelinePreview';

const PER_PAGE = 10;
const ALL = 'All';
const ORDER_TYPES = ['B2B', 'B2C'];
const FORM0 = {
  customer: '',
  customerId: '',
  orderType: 'B2B',
  date: new Date().toISOString().slice(0, 10),
  deliveryDate: '',
  status: 'Pending',
  paymentStatus: 'Pending',
  paymentMode: '',
  discount: '0',
  notes: '',
  shippingAddress: '',
  billingAddress: '',
  warehouseId: '',
  quotationId: '',
  sourceQuotationId: '',
  assignedToId: '',
  assignedToName: '',
};
const ITEM0 = {
  productId: '',
  product: '',
  description: '',
  category: '',
  qty: '1',
  unit: 'PCS',
  price: '',
  tax: '0',
  discount: '0',
  historyText: '',
};

type Mode = 'records' | 'create';
type Order = SharedOrder & Record<string, any>;
type OrderForm = typeof FORM0;
type OrderItem = typeof ITEM0;
type OrderFilters = {
  search: string;
  status: string;
  orderType: string;
  paymentStatus: string;
  date: string;
};

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isToday(value: any): boolean {
  const date = toDate(value);
  if (!date) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

function isThisWeek(value: any): boolean {
  const date = toDate(value);
  if (!date) return false;
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - start.getDay());
  return date >= start;
}

function isThisMonth(value: any): boolean {
  const date = toDate(value);
  if (!date) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function orderNumber(order: Order) {
  return String(order.orderNumber || order.orderNo || order.id || 'Untitled Order');
}

function orderCustomer(order: Order) {
  return order.customer || order.customerName || 'Customer not selected';
}

function customerName(customer: any) {
  return customer?.name || customer?.fullName || customer?.contactPerson || customer?.company || customer?.companyName || customer?.id || '';
}

function customerCompany(customer: any) {
  return customer?.company || customer?.companyName || '';
}

function orderPhone(order: Order, customers: any[]) {
  const customer = customers.find((entry) => entry.id === order.customerId);
  return order.customerPhone || order.phone || customer?.phone || customer?.mobile || customer?.businessPhone || '';
}

function orderEmail(order: Order, customers: any[]) {
  const customer = customers.find((entry) => entry.id === order.customerId);
  return order.customerEmail || order.email || customer?.email || customer?.businessEmail || '';
}

function whatsappHref(phone?: string) {
  const clean = String(phone || '').replace(/\D/g, '');
  return clean ? `https://wa.me/${clean}` : undefined;
}

function dispatchStatus(order: Order, dispatches: any[]) {
  const related = dispatches.filter((entry) => entry.orderId === order.id);
  if (order.status === 'Delivered') return 'Delivered';
  if (order.status === 'Dispatched' || related.some((entry) => ['Dispatched', 'Delivered', 'Closed'].includes(entry.status))) return 'Dispatched';
  if (order.status === 'Partial Dispatch' || related.length) return 'Partial Dispatch';
  return 'Pending';
}

function invoiceStatus(order: Order, invoices: ProformaInvoice[]) {
  const related = invoices.filter((entry) => entry.orderId === order.id || entry.sourceOrderId === order.id || order.generatedPIs?.includes(entry.id));
  if (!related.length && !order.piGenerated) return 'Not Generated';
  if (related.every((entry) => (entry.paymentStatus || '').toLowerCase() === 'paid')) return 'Paid';
  return 'Pending';
}

function filterOrders(orders: Order[], filters: OrderFilters) {
  const term = filters.search.trim().toLowerCase();
  return orders
    .filter((order) => {
      if (filters.status !== ALL && (order.status || 'Pending') !== filters.status) return false;
      if (filters.orderType !== ALL && (order.orderType || 'B2B') !== filters.orderType) return false;
      if (filters.paymentStatus !== ALL && (order.paymentStatus || 'Pending') !== filters.paymentStatus) return false;
      if (filters.date === 'today' && !isToday(order.date || order.createdAt)) return false;
      if (filters.date === 'week' && !isThisWeek(order.date || order.createdAt)) return false;
      if (filters.date === 'month' && !isThisMonth(order.date || order.createdAt)) return false;
      if (!term) return true;
      return [
        order.id,
        order.orderNumber,
        order.orderNo,
        order.customer,
        order.customerName,
        order.customerId,
        order.status,
        order.paymentStatus,
        order.assignedToName,
      ].some((value) => String(value || '').toLowerCase().includes(term));
    })
    .sort((a, b) => {
      const aTime = toDate(a.updatedAt)?.getTime() || toDate(a.createdAt)?.getTime() || toDate(a.date)?.getTime() || 0;
      const bTime = toDate(b.updatedAt)?.getTime() || toDate(b.createdAt)?.getTime() || toDate(b.date)?.getTime() || 0;
      return bTime - aTime;
    });
}

function normalizeItem(item: any): OrderItem {
  return {
    productId: item.productId || '',
    product: item.product || item.productName || item.name || '',
    description: item.description || '',
    category: item.category || '',
    qty: String(item.qty ?? item.quantity ?? 1),
    unit: item.unit || item.uom || 'PCS',
    price: String(item.price ?? item.rate ?? ''),
    tax: String(item.tax ?? item.gst ?? 0),
    discount: String(item.discount ?? 0),
    historyText: item.historyText || '',
  };
}

function itemAmount(item: OrderItem) {
  return (Number(item.qty) || 0) * (Number(item.price) || 0);
}

function totalsFor(form: OrderForm, items: OrderItem[]) {
  const subtotal = items.reduce((sum, item) => sum + itemAmount(item), 0);
  const taxTotal = items.reduce((sum, item) => sum + (itemAmount(item) * (Number(item.tax) || 0)) / 100, 0);
  const discount = Number(form.discount) || 0;
  const grandTotal = Math.round((subtotal + taxTotal - discount) * 100) / 100;
  return { subtotal, taxTotal, discount, grandTotal };
}

function downloadOrdersCsv(rows: Order[], filename: string) {
  const headers = ['Order', 'Customer', 'Type', 'Status', 'Payment', 'Date', 'Delivery', 'Total'];
  const lines = rows.map((order) =>
    [
      orderNumber(order),
      orderCustomer(order),
      order.orderType || '',
      order.status || '',
      order.paymentStatus || '',
      fmtDate(order.date),
      fmtDate(order.deliveryDate),
      order.total || 0,
    ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','),
  );
  const csv = [headers.join(','), ...lines].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function MobileOrderWorkspace({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const user = useCurrentUser();
  const company = useAppStore((state) => state.company);
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  const perms = usePermissions();
  const { data: orders = [], isLoading, error } = useOrders();
  const { data: customers = [] } = useQuery({ queryKey: keys.customersAll, queryFn: () => getAll(COLLECTIONS.CUSTOMERS), staleTime: 60000 });
  // Phase 2: mirrors desktop Orders.tsx — exclude only customers whose type
  // isn't valid for this company's Business Mode, never a single fixed type.
  const businessMode = resolveBusinessMode(company);
  const orderCustomerOptions = useMemo(() => filterCustomersForBusinessMode(customers as any[], businessMode), [customers, businessMode]);
  const { data: products = [] } = useQuery({ queryKey: keys.productsAll, queryFn: () => getAll(COLLECTIONS.PRODUCTS), staleTime: 60000 });
  const { data: quotations = [] } = useQuery({ queryKey: keys.quotationsAll, queryFn: () => getAll(COLLECTIONS.QUOTATIONS), staleTime: 60000 });
  const { data: warehouses = [] } = useQuery({ queryKey: keys.warehouses, queryFn: () => getAll(COLLECTIONS.WAREHOUSES), staleTime: 300000 });
  const { data: invoices = [] } = useQuery({ queryKey: keys.invoices, queryFn: () => getAll<ProformaInvoice>(COLLECTIONS.PROFORMA_INVOICES), staleTime: 60000 });
  const emailSettingsQuery = useSettingsSection('email');
  const emailSettings = useMemo(() => normalizeEmailSettings(emailSettingsQuery.data as Record<string, unknown> | undefined), [emailSettingsQuery.data]);
  const { data: dispatches = [] } = useQuery({ queryKey: keys.dispatchAll, queryFn: () => getAll(COLLECTIONS.DISPATCH), staleTime: 60000 });
  const { data: payments = [] } = useQuery({ queryKey: keys.payments, queryFn: () => getAll(COLLECTIONS.PAYMENTS), staleTime: 60000 });
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => getAll(COLLECTIONS.USERS), staleTime: 300000 });
  const generatePI = useGeneratePIFromOrder();
  const markPIAsPaid = useMarkPIAsPaid();

  const sendEmail = useCallback((order: Order, templateKey: EmailTemplateKey = 'order') => {
    const result = buildEmailComposePayload({
      templateKey,
      settings: emailSettings,
      recipientEmail: orderEmail(order, customers as any[]),
      variables: {
        customerName: order.customer || order.customerName || (customers as any[]).find((entry: any) => entry.id === order.customerId)?.name || '',
        companyName: company?.name || '',
        orderNumber: orderNumber(order),
        orderDate: fmtDate(order.date || order.createdAt),
        deliveryDate: fmtDate(order.deliveryDate),
        totalAmount: fmtCurrency(Number(order.total || 0), company.currencySymbol),
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
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [form, setForm] = useState<OrderForm>({ ...FORM0 });
  const [items, setItems] = useState<OrderItem[]>([]);
  const [viewOrder, setViewOrder] = useState<Order | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [duplicateOrder, setDuplicateOrder] = useState<Order | null>(null);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkAssignId, setBulkAssignId] = useState('');
  const [noteOrder, setNoteOrder] = useState<Order | null>(null);
  const [noteText, setNoteText] = useState('');
  const createParam = params.get('create');

  useEffect(() => {
    if (mode === 'create') setFormOpen(true);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'records' || createParam !== '1') return;
    setEditingOrder(null);
    setForm({ ...FORM0, date: new Date().toISOString().slice(0, 10) });
    setItems([]);
    setDirty(false);
    setFormOpen(true);
  }, [mode, createParam]);

  useEffect(() => {
    const prefillCustomer = (location.state as any)?.prefillCustomer;
    if (!prefillCustomer) return;
    setForm({
      ...FORM0,
      customerId: prefillCustomer.id,
      customer: customerName(prefillCustomer),
      orderType: prefillCustomer.type || 'B2C',
      shippingAddress: prefillCustomer.address || '',
      billingAddress: prefillCustomer.address || '',
      date: new Date().toISOString().slice(0, 10),
    });
    setItems([]);
    setEditingOrder(null);
    setDirty(true);
    setFormOpen(true);
    window.history.replaceState({}, document.title);
  }, [location.state]);

  useEffect(() => {
    const openId = params.get('open');
    if (!openId || viewOrder || !orders.length) return;
    const found = (orders as Order[]).find((order) => order.id === openId);
    if (found) setViewOrder(found);
  }, [orders, params, viewOrder]);

  const salesUsers = useMemo(
    () => (users as any[])
      .filter((entry) => ['Sales', 'Executive', 'BDE', 'BDM', 'Manager', 'TL'].includes(entry.role) && entry.status !== 'Inactive' && !entry.isDeleted)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    [users],
  );

  const filters = useMemo<OrderFilters>(() => ({
    search: params.get('q') || params.get('search') || '',
    status: params.get('status') || ALL,
    orderType: params.get('orderType') || ALL,
    paymentStatus: params.get('paymentStatus') || ALL,
    date: params.get('date') || params.get('dateRange') || 'all',
  }), [params]);

  const filteredOrders = useMemo(() => filterOrders(orders as Order[], filters), [orders, filters]);
  const paginatedOrders = useMemo(() => filteredOrders.slice((page - 1) * PER_PAGE, page * PER_PAGE), [filteredOrders, page]);
  const selectedRows = useMemo(() => (orders as Order[]).filter((order) => selected.has(order.id)), [orders, selected]);
  const totals = useMemo(() => totalsFor(form, items), [form, items]);
  const canCreate = perms.canCreate('orders');
  const canEdit = perms.canEdit('orders');
  const canDelete = perms.canDelete('orders');
  const canExport = perms.canExport('orders') || canEdit || canCreate;

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredOrders.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filteredOrders.length, page]);

  useEffect(() => {
    setSelected((current) => {
      const available = new Set((orders as Order[]).map((order) => order.id));
      const next = new Set(Array.from(current).filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [orders]);

  function changePage(nextPage: number) {
    setPage(nextPage);
    const next = new URLSearchParams(params);
    if (nextPage > 1) next.set('page', String(nextPage));
    else next.delete('page');
    setParams(next, { replace: true });
  }

  function openOrder(order: Order) {
    setViewOrder(order);
    const next = new URLSearchParams(params);
    next.set('open', order.id);
    setParams(next, { replace: true });
  }

  function closeOrder() {
    setViewOrder(null);
    if (params.get('open')) {
      const next = new URLSearchParams(params);
      next.delete('open');
      setParams(next, { replace: true });
    }
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
    setEditingOrder(null);
    setForm({ ...FORM0, date: new Date().toISOString().slice(0, 10) });
    setItems([]);
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

  function updateForm(patch: Partial<OrderForm>) {
    setForm((current) => ({ ...current, ...patch }));
    setDirty(true);
  }

  function updateItem(index: number, patch: Partial<OrderItem>) {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
    setDirty(true);
  }

  function selectCustomer(customerId: string) {
    const customer = (customers as any[]).find((entry) => entry.id === customerId);
    if (!customer) {
      updateForm({ customerId: '', customer: '', orderType: 'B2B', shippingAddress: '', billingAddress: '' });
      return;
    }
    updateForm({
      customerId,
      customer: customerName(customer),
      orderType: customer.type || form.orderType || 'B2B',
      shippingAddress: customer.address || [customer.city, customer.state].filter(Boolean).join(', '),
      billingAddress: customer.address || [customer.city, customer.state].filter(Boolean).join(', '),
    });
  }

  function selectQuotation(quotationId: string) {
    const quotation = (quotations as any[]).find((entry) => entry.id === quotationId);
    if (!quotation) {
      updateForm({ quotationId: '', sourceQuotationId: '' });
      return;
    }
    updateForm({
      quotationId,
      sourceQuotationId: quotation.id,
      customerId: quotation.customerId || '',
      customer: quotation.customer || quotation.customerName || '',
      shippingAddress: quotation.customerAddress || '',
      billingAddress: quotation.customerAddress || '',
      discount: String(quotation.specialDiscount || quotation.totalDiscount || quotation.discount || 0),
      notes: quotation.notes || '',
    });
    if (Array.isArray(quotation.items) && quotation.items.length) {
      setItems(quotation.items.map(normalizeItem));
      setDirty(true);
    }
  }

  function selectProduct(index: number, productId: string) {
    const product = (products as any[]).find((entry) => entry.id === productId);
    if (!product) {
      updateItem(index, { productId: '', product: '', category: '', unit: 'PCS', price: '', tax: '0', historyText: '' });
      return;
    }
    const history = getProductHistory(orders as any[], form.customerId, product.id);
    updateItem(index, {
      productId,
      product: product.name || product.productName || product.title || '',
      description: product.description || '',
      category: product.category || '',
      unit: product.unit || product.uom || 'PCS',
      price: String(history?.price ?? product.price ?? product.sellingPrice ?? product.rate ?? ''),
      tax: String(history?.tax ?? product.tax ?? product.gst ?? 0),
      historyText: history ? `Last sold @ ${fmtCurrency(history.price, company?.currencySymbol || '₹')} on ${fmtDate(history.date)}` : '',
    });
  }

  function openEdit(order: Order) {
    closeOrder();
    setEditingOrder(order);
    setForm({
      customer: order.customer || order.customerName || '',
      customerId: order.customerId || '',
      orderType: order.orderType || 'B2B',
      date: toInputDate(order.date) || new Date().toISOString().slice(0, 10),
      deliveryDate: toInputDate(order.deliveryDate),
      status: order.status || 'Pending',
      paymentStatus: order.paymentStatus || 'Pending',
      paymentMode: order.paymentMode || '',
      discount: String(order.discount || 0),
      notes: order.notes || '',
      shippingAddress: order.shippingAddress || '',
      billingAddress: order.billingAddress || order.shippingAddress || '',
      warehouseId: order.warehouseId || '',
      quotationId: order.sourceQuotationId || order.quotationId || '',
      sourceQuotationId: order.sourceQuotationId || order.quotationId || '',
      assignedToId: order.assignedToId || '',
      assignedToName: order.assignedToName || '',
    });
    setItems(Array.isArray(order.items) && order.items.length ? order.items.map(normalizeItem) : []);
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
        category: item.category,
        qty: Number(item.qty) || 0,
        unit: item.unit || 'PCS',
        price: Number(item.price) || 0,
        tax: Number(item.tax) || 0,
        discount: Number(item.discount) || 0,
        total: itemAmount(item),
        dispatchedQty: Number((item as any).dispatchedQty) || 0,
        pendingQty: Math.max(0, (Number(item.qty) || 0) - (Number((item as any).dispatchedQty) || 0)),
        historyText: item.historyText,
      }));
    return {
      ...form,
      items: cleanItems,
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      taxAmount: totals.taxTotal,
      discount: totals.discount,
      total: totals.grandTotal,
      pendingBilling: totals.grandTotal,
      createdBy: user.id,
      createdByName: user.name,
    };
  }

  const saveOrder = useMutation({
    mutationFn: async () => {
      if (!form.customer && !form.customerId) throw new Error('Customer required');
      const cleanItems = items.filter((item) => item.product || item.productId);
      if (!cleanItems.length) throw new Error('Add at least one item');
      const payload = payloadForSave();
      if (editingOrder) {
        await updateDocById(COLLECTIONS.ORDERS, editingOrder.id, payload);
        await notifyRoleUsers(['Accounts', 'Operations', 'Director'], NotificationType.ORDER_UPDATED, 'Order updated', `Order ${editingOrder.id} was updated for ${form.customer || 'customer'}.`, 'order', editingOrder.id, activeCompanyId);
        return { ...editingOrder, ...payload };
      }
      const documentDefaults = await resolveDocumentDefaults(resolveWriteCompanyId());
      const id = genId.order(company?.orderPrefix || 'ORD');
      const { documentNumber } = await getNextDocumentNumber(resolveWriteCompanyId(), 'order');
      const order = { ...payload, id, orderNumber: documentNumber, orderNo: documentNumber, notes: payload.notes || documentDefaults.settings.defaultNotes };
      await createDocWithId(COLLECTIONS.ORDERS, id, order);
      await notifyRoleUsers(['Accounts', 'Operations', 'Director'], NotificationType.ORDER_PLACED, 'Order placed', `Order ${documentNumber} was created for ${form.customer || 'customer'}.`, 'order', id, activeCompanyId);
      return order;
    },
    onSuccess: (order) => {
      void qc.invalidateQueries({ queryKey: keys.ordersRoot });
      toast.success(editingOrder ? 'Order updated' : 'Order created');
      closeForm();
      setViewOrder(order as Order);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map(async (id) => {
        await deleteDocById(COLLECTIONS.ORDERS, id);
        await notifyRoleUsers(['Accounts', 'Operations', 'Director'], NotificationType.ORDER_DELETED, 'Order deleted', `Order ${id} was deleted.`, 'order', id, activeCompanyId);
      }));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.ordersRoot });
      toast.success(`Deleted ${selectedRows.length || 1} order${selectedRows.length === 1 ? '' : 's'}`);
      setSelected(new Set());
      setDeleteOpen(false);
      setViewOrder(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      await Promise.all(ids.map((id) => updateDocById(COLLECTIONS.ORDERS, id, { status })));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.ordersRoot });
      toast.success(`Updated ${selected.size} order${selected.size === 1 ? '' : 's'}`);
      setSelected(new Set());
      setBulkStatus('');
      setBulkStatusOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkAssignMutation = useMutation({
    mutationFn: async ({ ids, assigneeId, assigneeName }: { ids: string[]; assigneeId: string; assigneeName: string }) => {
      await Promise.all(ids.map((id) => updateDocById(COLLECTIONS.ORDERS, id, { assignedToId: assigneeId, assignedToName: assigneeName })));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.ordersRoot });
      toast.success(`Assigned ${selected.size} order${selected.size === 1 ? '' : 's'}`);
      setSelected(new Set());
      setBulkAssignId('');
      setBulkAssignOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const addNote = useMutation({
    mutationFn: async ({ order, note }: { order: Order; note: string }) => {
      const logEntry = { id: genId.generic('LOG'), type: 'Note', desc: note, date: new Date().toISOString(), userName: user.name };
      await updateDocById(COLLECTIONS.ORDERS, order.id, {
        notes: [order.notes, note].filter(Boolean).join('\n'),
        activityLog: [...(order.activityLog || []), logEntry],
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.ordersRoot });
      toast.success('Note added');
      setNoteOrder(null);
      setNoteText('');
    },
    onError: (e: any) => toast.error(e.message),
  });

  function submitOrder(event: React.FormEvent) {
    event.preventDefault();
    saveOrder.mutate();
  }

  function duplicateCurrent() {
    if (!duplicateOrder) return;
    setEditingOrder(null);
    setForm({
      ...FORM0,
      customer: duplicateOrder.customer || '',
      customerId: duplicateOrder.customerId || '',
      orderType: duplicateOrder.orderType || 'B2B',
      date: new Date().toISOString().slice(0, 10),
      status: 'Pending',
      paymentStatus: 'Pending',
      paymentMode: duplicateOrder.paymentMode || '',
      discount: String(duplicateOrder.discount || 0),
      notes: duplicateOrder.notes || '',
      shippingAddress: duplicateOrder.shippingAddress || '',
      billingAddress: duplicateOrder.billingAddress || duplicateOrder.shippingAddress || '',
      warehouseId: duplicateOrder.warehouseId || '',
      assignedToId: duplicateOrder.assignedToId || '',
      assignedToName: duplicateOrder.assignedToName || '',
    });
    setItems(Array.isArray(duplicateOrder.items) && duplicateOrder.items.length ? duplicateOrder.items.map(normalizeItem) : []);
    setDuplicateOrder(null);
    setDirty(true);
    setFormOpen(true);
  }

  function exportRows(rows: Order[]) {
    if (!rows.length) return toast.error('No orders selected');
    downloadOrdersCsv(rows, `orders-export-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${rows.length} order${rows.length === 1 ? '' : 's'}`);
  }

  function printOrder(order: Order) {
    const win = window.open('', '_blank');
    if (!win) return toast.error('Unable to open print preview');
    win.document.write(`<html><head><title>${orderNumber(order)}</title></head><body><h1>${orderNumber(order)}</h1><p><strong>Customer:</strong> ${orderCustomer(order)}</p><p><strong>Status:</strong> ${order.status || 'Pending'}</p><p><strong>Total:</strong> ${fmtCurrency(Number(order.total) || 0, company?.currencySymbol || '₹')}</p></body></html>`);
    win.document.close();
    win.print();
  }

  if (mode === 'create') {
    return (
      <OrderDialogs
        formOpen={formOpen}
        form={form}
        items={items}
        products={products as any[]}
        customers={orderCustomerOptions}
        quotations={quotations as any[]}
        warehouses={warehouses as any[]}
        salesUsers={salesUsers}
        editingOrder={editingOrder}
        totals={totals}
        dirty={dirty}
        saving={saveOrder.isPending}
        confirmClose={confirmClose}
        currencySymbol={company?.currencySymbol || '₹'}
        onCloseForm={requestCloseForm}
        onDiscard={() => {
          setConfirmClose(false);
          closeForm();
        }}
        onKeepEditing={() => setConfirmClose(false)}
        onFormChange={updateForm}
        onCustomerSelect={selectCustomer}
        onQuotationSelect={selectQuotation}
        onItemChange={updateItem}
        onProductSelect={selectProduct}
        onAddItem={() => {
          setItems((current) => [...current, { ...ITEM0 }]);
          setDirty(true);
        }}
        onRemoveItem={(index) => {
          setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
          setDirty(true);
        }}
        onSubmit={submitOrder}
      />
    );
  }

  return (
    <div className="space-y-4 pb-2 pt-2">
      <div className="px-1 pb-1 pt-2">
        <h1 className="text-xl font-bold text-[var(--color-text)]">Orders</h1>
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
        {isLoading && Array.from({ length: 5 }).map((_, index) => <OrderSkeletonCard key={index} />)}
        {!isLoading && filteredOrders.length === 0 && (
          <Card className="rounded-xl p-5 text-center text-sm text-[var(--color-text-muted)]">
            No orders match the current filters.
          </Card>
        )}
        {!isLoading && paginatedOrders.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            customers={customers as any[]}
            dispatches={dispatches as any[]}
            selected={selected.has(order.id)}
            currencySymbol={company?.currencySymbol || '₹'}
            onSelect={() => toggleSelect(order.id)}
            onView={() => openOrder(order)}
          />
        ))}
      </div>

      {!isLoading && filteredOrders.length > 0 && (
        <Pagination page={page} total={filteredOrders.length} perPage={PER_PAGE} onChange={changePage} />
      )}

      <OrderViewModal
        order={viewOrder}
        customers={customers as any[]}
        quotations={quotations as any[]}
        invoices={invoices as ProformaInvoice[]}
        dispatches={dispatches as any[]}
        payments={payments as any[]}
        currencySymbol={company?.currencySymbol || '₹'}
        canEdit={canEdit}
        canDelete={canDelete}
        canCreateInvoice={perms.canCreate('invoices')}
        generatingPI={generatePI.isPending}
        markingPI={markPIAsPaid.isPending}
        onClose={closeOrder}
        onEdit={openEdit}
        onDelete={(order) => {
          setSelected(new Set([order.id]));
          closeOrder();
          setDeleteOpen(true);
        }}
        onDuplicate={(order) => {
          closeOrder();
          setDuplicateOrder(order);
        }}
        onNote={(order) => {
          closeOrder();
          setNoteOrder(order);
        }}
        onGeneratePI={(order) => generatePI.mutate(order)}
        onSendEmail={(order) => sendEmail(order, 'order')}
        onMarkPIAsPaid={(piId) => markPIAsPaid.mutate(piId)}
        onCreateInvoice={(order) => navigate('/invoices', { state: { prefillOrder: order } })}
        onPrint={printOrder}
      />

      <OrderDialogs
        formOpen={formOpen}
        form={form}
        items={items}
        products={products as any[]}
        customers={orderCustomerOptions}
        quotations={quotations as any[]}
        warehouses={warehouses as any[]}
        salesUsers={salesUsers}
        editingOrder={editingOrder}
        totals={totals}
        dirty={dirty}
        saving={saveOrder.isPending}
        confirmClose={confirmClose}
        currencySymbol={company?.currencySymbol || '₹'}
        onCloseForm={requestCloseForm}
        onDiscard={() => {
          setConfirmClose(false);
          closeForm();
        }}
        onKeepEditing={() => setConfirmClose(false)}
        onFormChange={updateForm}
        onCustomerSelect={selectCustomer}
        onQuotationSelect={selectQuotation}
        onItemChange={updateItem}
        onProductSelect={selectProduct}
        onAddItem={() => {
          setItems((current) => [...current, { ...ITEM0 }]);
          setDirty(true);
        }}
        onRemoveItem={(index) => {
          setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
          setDirty(true);
        }}
        onSubmit={submitOrder}
      />

      <Modal open={bulkStatusOpen} onClose={() => setBulkStatusOpen(false)} title="Change Status" size="sm">
        <div className="space-y-4">
          <Select label="New Status" value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value)} options={[{ label: 'Select status...', value: '' }, ...ORDER_STATUSES.map((status) => ({ label: status, value: status }))]} />
          <Button className="w-full" loading={bulkStatusMutation.isPending} onClick={() => {
            if (!bulkStatus) return toast.error('Select a status');
            bulkStatusMutation.mutate({ ids: Array.from(selected), status: bulkStatus });
          }}>
            Update {selected.size} Orders
          </Button>
        </div>
      </Modal>

      <Modal open={bulkAssignOpen} onClose={() => setBulkAssignOpen(false)} title="Assign Orders" size="sm">
        <div className="space-y-4">
          <Select label="Assign To" value={bulkAssignId} onChange={(event) => setBulkAssignId(event.target.value)} options={[{ label: 'Select salesperson...', value: '' }, ...salesUsers.map((entry) => ({ label: entry.name, value: entry.id }))]} />
          <Button className="w-full" loading={bulkAssignMutation.isPending} onClick={() => {
            const assignee = salesUsers.find((entry) => entry.id === bulkAssignId);
            if (!assignee) return toast.error('Select a salesperson');
            bulkAssignMutation.mutate({ ids: Array.from(selected), assigneeId: assignee.id, assigneeName: assignee.name });
          }}>
            Assign {selected.size} Orders
          </Button>
        </div>
      </Modal>

      <Modal open={!!noteOrder} onClose={() => setNoteOrder(null)} title="Add Note" size="full">
        <div className="space-y-4">
          <Textarea label="Note" required value={noteText} onChange={(event) => setNoteText(event.target.value)} />
          <Button className="w-full" loading={addNote.isPending} onClick={() => {
            if (!noteOrder || !noteText.trim()) return toast.error('Note required');
            addNote.mutate({ order: noteOrder, note: noteText.trim() });
          }}>
            Save Note
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!duplicateOrder}
        onClose={() => setDuplicateOrder(null)}
        onConfirm={duplicateCurrent}
        title="Duplicate Order"
        message={`Create a draft copy of ${duplicateOrder ? orderNumber(duplicateOrder) : 'this order'}?`}
        confirmLabel="Duplicate"
        danger={false}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate(Array.from(selected))}
        loading={deleteMutation.isPending}
        title="Delete Orders"
        message={`Delete ${selectedRows.length} selected order${selectedRows.length === 1 ? '' : 's'}?`}
      />
    </div>
  );
}

function OrderCard({ order, customers, dispatches, selected, currencySymbol, onSelect, onView }: {
  order: Order;
  customers: any[];
  dispatches: any[];
  selected: boolean;
  currencySymbol: string;
  onSelect: () => void;
  onView: () => void;
}) {
  const phone = orderPhone(order, customers);
  const email = orderEmail(order, customers);
  const customer = customers.find((entry) => entry.id === order.customerId);
  const whatsapp = whatsappHref(phone);
  return (
    <Card className={cn(
      'rounded-xl border border-[var(--color-border-subtle)] p-3 shadow-sm transition-shadow',
      'hover:shadow-[var(--shadow-enterprise-row)]',
      selected && 'border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/40',
      (order.paymentStatus || '').toLowerCase() === 'overdue' && 'border-l-4 border-l-orange-500',
    )}>
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          className="mt-1 rounded border-[var(--color-border)] text-[var(--color-primary)]"
          aria-label={`Select ${orderNumber(order)}`}
        />
        <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
          <p className="truncate text-[15px] font-bold leading-5 text-[var(--color-text)]">{orderNumber(order)}</p>
          <p className="mt-0.5 truncate text-xs font-medium text-[var(--color-text-muted)]">{orderCustomer(order)}</p>
          {customerCompany(customer) ? <p className="truncate text-xs text-[var(--color-text-muted)]">{customerCompany(customer)}</p> : null}
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs leading-5 text-[var(--color-text-muted)]">
            <p className="truncate">{fmtCurrency(Number(order.total) || 0, currencySymbol)}</p>
            <p className="truncate">{order.date ? fmtDate(order.date) : 'Date not set'}</p>
            <p className="truncate">{dispatchStatus(order, dispatches)}</p>
            <p className="truncate">{order.assignedToName || order.createdByName || 'Unassigned'}</p>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {statusBadge(order.status || 'Pending')}
            {statusBadge(order.paymentStatus || 'Pending')}
            {order.orderType ? <Badge variant={order.orderType === 'B2C' ? 'info' : 'purple'}>{order.orderType}</Badge> : null}
          </div>
        </button>
        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <a href={whatsapp} target="_blank" rel="noreferrer" aria-label="WhatsApp order" className={cn(actionIconClass, 'bg-emerald-50/90 text-emerald-600 ring-emerald-100 dark:bg-emerald-900/25 dark:text-emerald-300 dark:ring-emerald-800/60', !whatsapp && 'pointer-events-none opacity-40')}>
            <MessageCircle className="h-4 w-4" strokeWidth={2.25} />
          </a>
          <a href={email ? `mailto:${email}` : undefined} aria-label="Email order" className={cn(actionIconClass, 'bg-amber-50/90 text-amber-600 ring-amber-100 dark:bg-amber-900/25 dark:text-amber-300 dark:ring-amber-800/60', !email && 'pointer-events-none opacity-40')}>
            <Mail className="h-4 w-4" strokeWidth={2.2} />
          </a>
          <a href={phone ? `tel:${phone}` : undefined} aria-label="Call order" className={cn(actionIconClass, 'bg-blue-50/90 text-blue-600 ring-blue-100 dark:bg-blue-900/25 dark:text-blue-300 dark:ring-blue-800/60', !phone && 'pointer-events-none opacity-40')}>
            <Phone className="h-4 w-4" strokeWidth={2.25} />
          </a>
        </div>
      </div>
    </Card>
  );
}

const actionIconClass = 'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/60 shadow-sm ring-1 backdrop-blur-sm transition-transform active:scale-95';

function OrderSkeletonCard() {
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

function OrderDialogs({ formOpen, form, items, products, customers, quotations, warehouses, salesUsers, editingOrder, totals, dirty, saving, confirmClose, currencySymbol, onCloseForm, onDiscard, onKeepEditing, onFormChange, onCustomerSelect, onQuotationSelect, onItemChange, onProductSelect, onAddItem, onRemoveItem, onSubmit }: {
  formOpen: boolean;
  form: OrderForm;
  items: OrderItem[];
  products: any[];
  customers: any[];
  quotations: any[];
  warehouses: any[];
  salesUsers: any[];
  editingOrder: Order | null;
  totals: ReturnType<typeof totalsFor>;
  dirty: boolean;
  saving: boolean;
  confirmClose: boolean;
  currencySymbol: string;
  onCloseForm: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
  onFormChange: (patch: Partial<OrderForm>) => void;
  onCustomerSelect: (customerId: string) => void;
  onQuotationSelect: (quotationId: string) => void;
  onItemChange: (index: number, patch: Partial<OrderItem>) => void;
  onProductSelect: (index: number, productId: string) => void;
  onAddItem: () => void;
  onRemoveItem: (index: number) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <>
      <Modal open={formOpen} onClose={onCloseForm} title={editingOrder ? 'Edit Order' : 'Create Order'} size="full">
        <form onSubmit={onSubmit} className="space-y-4">
          <Section title="Customer & Quotation">
            <Select
              label="Customer"
              required
              value={form.customerId}
              onChange={(event) => onCustomerSelect(event.target.value)}
              options={[{ label: 'Select customer...', value: '' }, ...customers.map((customer) => ({ label: customerName(customer), value: customer.id }))]}
            />
            <Select
              label="Quotation Reference"
              value={form.quotationId || form.sourceQuotationId}
              onChange={(event) => onQuotationSelect(event.target.value)}
              options={[{ label: 'No quotation', value: '' }, ...quotations.map((quotation) => ({
                label: quotation.quotationNumber || quotation.quoteNumber || quotation.id,
                value: quotation.id,
              }))]}
            />
            <Textarea label="Shipping Address" value={form.shippingAddress} onChange={(event) => onFormChange({ shippingAddress: event.target.value })} />
            <Textarea label="Billing Address" value={form.billingAddress} onChange={(event) => onFormChange({ billingAddress: event.target.value })} />
          </Section>

          <Section title="Order Information">
            <div className="grid grid-cols-2 gap-3">
              <Select label="Order Type" value={form.orderType} onChange={(event) => onFormChange({ orderType: event.target.value })} options={ORDER_TYPES.map((type) => ({ label: type, value: type }))} />
              <Select label="Warehouse" value={form.warehouseId} onChange={(event) => onFormChange({ warehouseId: event.target.value })} options={[{ label: 'Select warehouse...', value: '' }, ...warehouses.map((warehouse) => ({ label: warehouse.name || warehouse.id, value: warehouse.id }))]} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Order Date" type="date" value={form.date} onChange={(event) => onFormChange({ date: event.target.value })} />
              <Input label="Delivery Date" type="date" value={form.deliveryDate} onChange={(event) => onFormChange({ deliveryDate: event.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Select label="Status" value={form.status} onChange={(event) => onFormChange({ status: event.target.value })} options={ORDER_STATUSES.map((status) => ({ label: status, value: status }))} />
              <Select label="Payment" value={form.paymentStatus} onChange={(event) => onFormChange({ paymentStatus: event.target.value })} options={PAYMENT_STATUSES.map((status) => ({ label: status, value: status }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Select label="Payment Mode" value={form.paymentMode} onChange={(event) => onFormChange({ paymentMode: event.target.value })} options={[{ label: 'Not selected', value: '' }, ...PAYMENT_MODES.map((mode) => ({ label: mode, value: mode }))]} />
              <Select
                label="Assigned To"
                value={form.assignedToId}
                onChange={(event) => {
                  const assignee = salesUsers.find((entry) => entry.id === event.target.value);
                  onFormChange({ assignedToId: event.target.value, assignedToName: assignee?.name || '' });
                }}
                options={[{ label: 'Unassigned', value: '' }, ...salesUsers.map((entry) => ({ label: entry.name, value: entry.id }))]}
              />
            </div>
          </Section>

          <Section title="Products">
            <div className="space-y-3">
              {items.map((item, index) => (
                <div key={index} className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                  <div className="flex items-center gap-2">
                    <p className="mr-auto text-sm font-bold text-[var(--color-text)]">Item {index + 1}</p>
                    <Button type="button" size="xs" variant="ghost" icon={<Trash2 className="h-3 w-3" />} onClick={() => onRemoveItem(index)}>Remove</Button>
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
                    {item.historyText ? <p className="text-xs font-medium text-[var(--color-success-text)]">{item.historyText}</p> : null}
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
                      <Input label="Category" value={item.category} onChange={(event) => onItemChange(index, { category: event.target.value })} />
                    </div>
                    <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 text-right text-sm font-bold text-[var(--color-text)]">
                      Amount {fmtCurrency(itemAmount(item), currencySymbol)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" className="w-full" icon={<Plus className="h-4 w-4" />} onClick={onAddItem}>Add Product</Button>
          </Section>

          <Section title="Pricing Summary">
            <Input label="Overall Discount" inputMode="decimal" value={form.discount} onChange={(event) => onFormChange({ discount: event.target.value })} />
            <div className="space-y-2 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3 text-sm">
              <TotalRow label="Subtotal" value={fmtCurrency(totals.subtotal, currencySymbol)} />
              <TotalRow label="Tax" value={fmtCurrency(totals.taxTotal, currencySymbol)} />
              <TotalRow label="Discount" value={fmtCurrency(totals.discount, currencySymbol)} />
              <div className="border-t border-[var(--color-border)] pt-2">
                <TotalRow label="Grand Total" value={fmtCurrency(totals.grandTotal, currencySymbol)} strong />
              </div>
            </div>
          </Section>

          <Section title="Notes & Attachments">
            <Textarea label="Notes" value={form.notes} onChange={(event) => onFormChange({ notes: event.target.value })} />
            <Input label="Attachment Name" value={(form as any).attachmentName || ''} onChange={(event) => onFormChange({ attachmentName: event.target.value } as any)} />
          </Section>

          {dirty ? <p className="text-xs font-medium text-[var(--color-warning-text)]">Unsaved changes</p> : null}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onCloseForm}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={saving}>{editingOrder ? 'Save' : 'Create'}</Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog open={confirmClose} onClose={onKeepEditing} onConfirm={onDiscard} title="Discard Changes" message="Close this form and discard unsaved changes?" />
    </>
  );
}

function OrderViewModal({ order, customers, quotations, invoices, dispatches, payments, currencySymbol, canEdit, canDelete, canCreateInvoice, generatingPI, markingPI, onClose, onEdit, onDelete, onDuplicate, onNote, onGeneratePI, onSendEmail, onMarkPIAsPaid, onCreateInvoice, onPrint }: {
  order: Order | null;
  customers: any[];
  quotations: any[];
  invoices: ProformaInvoice[];
  dispatches: any[];
  payments: any[];
  currencySymbol: string;
  canEdit: boolean;
  canDelete: boolean;
  canCreateInvoice: boolean;
  generatingPI: boolean;
  markingPI: boolean;
  onClose: () => void;
  onEdit: (order: Order) => void;
  onDelete: (order: Order) => void;
  onDuplicate: (order: Order) => void;
  onNote: (order: Order) => void;
  onGeneratePI: (order: Order) => void;
  onSendEmail: (order: Order) => void;
  onMarkPIAsPaid: (piId: string) => void;
  onCreateInvoice: (order: Order) => void;
  onPrint: (order: Order) => void;
}) {
  if (!order) return null;
  const phone = orderPhone(order, customers);
  const email = orderEmail(order, customers);
  const relatedQuotation = quotations.find((quotation) => quotation.id === order.sourceQuotationId || quotation.id === order.quotationId);
  const relatedInvoices = invoices.filter((invoice) => invoice.orderId === order.id || invoice.sourceOrderId === order.id || order.generatedPIs?.includes(invoice.id));
  const relatedDispatches = dispatches.filter((dispatch) => dispatch.orderId === order.id);
  const relatedPayments = payments.filter((payment) => payment.orderId === order.id);
  const paidAmount = relatedPayments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), Number(order.paidAmount || order.amountPaid || 0) || 0);
  const outstanding = Math.max(0, (Number(order.total) || 0) - paidAmount);
  const activity = [
    { type: 'Created', desc: 'Order record created', date: order.createdAt || order.date, userName: order.createdByName || 'System' },
    ...(order.updatedAt ? [{ type: 'Updated', desc: 'Order was updated', date: order.updatedAt, userName: order.updatedByName || 'System' }] : []),
    ...(order.piGenerated ? [{ type: 'PI Generated', desc: 'Proforma invoice generated', date: order.updatedAt || order.createdAt, userName: order.updatedByName || 'System' }] : []),
    ...(order.activityLog || []),
  ];

  return (
    <Modal open={!!order} onClose={onClose} title={orderNumber(order)} size="full">
      <div className="space-y-4">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {statusBadge(order.status || 'Pending')}
            {statusBadge(order.paymentStatus || 'Pending')}
            {order.orderType ? <Badge variant={order.orderType === 'B2C' ? 'info' : 'purple'}>{order.orderType}</Badge> : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Detail label="Customer" value={orderCustomer(order)} />
            <Detail label="Total" value={fmtCurrency(Number(order.total) || 0, currencySymbol)} />
          </div>
        </section>

        <Section title="Order Information">
          <Detail label="Order Number" value={orderNumber(order)} />
          <Detail label="Order Date" value={order.date ? fmtDate(order.date) : 'Not set'} />
          <Detail label="Delivery Date" value={order.deliveryDate ? fmtDate(order.deliveryDate) : 'Not set'} />
          <Detail label="Assigned To" value={order.assignedToName || 'Unassigned'} />
        </Section>

        <Section title="Customer Information">
          <Detail label="Customer" value={orderCustomer(order)} />
          <Detail label="Mobile" value={phone || 'Not available'} />
          <Detail label="Email" value={email || 'Not available'} />
        </Section>

        <Section title="Quotation Reference">
          <Detail label="Quotation" value={relatedQuotation?.quotationNumber || relatedQuotation?.quoteNumber || order.sourceQuotationId || 'No quotation linked'} />
        </Section>

        <Section title="Products">
          {order.items?.length ? (
            <div className="space-y-2">
              {order.items.map((item: any, index: number) => (
                <div key={index} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                  <p className="text-sm font-semibold text-[var(--color-text)]">{item.product || item.productId || `Item ${index + 1}`}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{Number(item.qty) || 0} {item.unit || ''} x {fmtCurrency(Number(item.price) || 0, currencySymbol)} · Tax {Number(item.tax) || 0}%</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">Dispatched {Number(item.dispatchedQty) || 0} · Pending {Number(item.pendingQty) || Math.max(0, (Number(item.qty) || 0) - (Number(item.dispatchedQty) || 0))}</p>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-[var(--color-text-muted)]">No products added.</p>}
        </Section>

        <Section title="Pricing Summary">
          <TotalRow label="Subtotal" value={fmtCurrency(Number(order.subtotal) || 0, currencySymbol)} />
          <TotalRow label="Tax Details" value={fmtCurrency(Number(order.taxTotal || order.taxAmount) || 0, currencySymbol)} />
          <TotalRow label="Discounts" value={fmtCurrency(Number(order.discount) || 0, currencySymbol)} />
          <TotalRow label="Grand Total" value={fmtCurrency(Number(order.total) || 0, currencySymbol)} strong />
        </Section>

        <Section title="Billing Details">
          <Detail label="Billing Address" value={order.billingAddress || order.shippingAddress || 'Not available'} />
          <Detail label="Pending Billing" value={fmtCurrency(Number(order.pendingBilling) || 0, currencySymbol)} />
          <Detail label="Total Invoiced" value={fmtCurrency(Number(order.totalInvoiced) || 0, currencySymbol)} />
        </Section>

        <Section title="Shipping Details">
          <Detail label="Shipping Address" value={order.shippingAddress || 'Not available'} />
          <Detail label="Warehouse" value={order.warehouseId || 'Not selected'} />
        </Section>

        <Section title="Payment Summary">
          <Detail label="Payment Status" value={order.paymentStatus || 'Pending'} />
          <Detail label="Paid Amount" value={fmtCurrency(paidAmount, currencySymbol)} />
          <Detail label="Outstanding" value={fmtCurrency(outstanding, currencySymbol)} />
        </Section>

        <Section title="Dispatch Summary">
          <Detail label="Dispatch Status" value={dispatchStatus(order, dispatches)} />
          <Detail label="Dispatch Records" value={String(relatedDispatches.length)} />
          <Detail label="Invoice Status" value={invoiceStatus(order, invoices)} />
        </Section>

        <Section title="Notes">
          <p className="whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{order.notes || 'No notes recorded.'}</p>
        </Section>

        <Section title="Attachments">
          <p className="text-sm text-[var(--color-text-muted)]">{order.attachmentName || order.fileName || 'No attachments available.'}</p>
        </Section>

        <Section title="Timeline">
          <MobileTimelinePreview title={`${orderNumber(order)} Timeline`} entries={activity} />
        </Section>

        <Section title="Related Invoice">
          {relatedInvoices.length ? (
            <div className="space-y-2">
              {relatedInvoices.map((invoice) => (
                <div key={invoice.id} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                  <p className="text-sm font-semibold text-[var(--color-text)]">{(invoice as any).piNumber || (invoice as any).invoiceNumber || invoice.id}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{fmtCurrency(Number(invoice.total) || 0, currencySymbol)} · {invoice.paymentStatus || 'Pending'}</p>
                  {(invoice.paymentStatus || '').toLowerCase() !== 'paid' ? (
                    <Button className="mt-2" size="xs" variant="outline" loading={markingPI} onClick={() => onMarkPIAsPaid(invoice.id)}>Mark Paid</Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-[var(--color-text-muted)]">No related invoice.</p>}
        </Section>

        <Section title="Related Dispatch">
          {relatedDispatches.length ? (
            <div className="space-y-2">
              {relatedDispatches.map((dispatch) => (
                <div key={dispatch.id} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                  <p className="text-sm font-semibold text-[var(--color-text)]">{dispatch.dispatchNumber || dispatch.id}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{dispatch.status || 'Pending'}</p>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-[var(--color-text-muted)]">No dispatch records.</p>}
        </Section>

        <Section title="Audit Information">
          <Detail label="Created By" value={order.createdByName || order.createdBy || 'System'} />
          <Detail label="Updated" value={order.updatedAt ? fmtDate(order.updatedAt) : 'Not available'} />
        </Section>

        <div className="grid grid-cols-2 gap-2">
          {phone ? <a className={linkButtonClass} href={`tel:${phone}`}><Phone className="h-4 w-4" />Call</a> : null}
          {phone ? <a className={linkButtonClass} href={whatsappHref(phone)} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" />WhatsApp</a> : null}
          {email ? <Button variant="outline" icon={<Mail className="h-4 w-4" />} onClick={() => onSendEmail(order)}>Send Email</Button> : null}
          <Button variant="outline" icon={<Printer className="h-4 w-4" />} onClick={() => onPrint(order)}>Print</Button>
          {canEdit ? <Button variant="outline" icon={<FileText className="h-4 w-4" />} loading={generatingPI} onClick={() => onGeneratePI(order)}>Generate PI</Button> : null}
          {canCreateInvoice ? <Button variant="outline" icon={<ReceiptText className="h-4 w-4" />} onClick={() => onCreateInvoice(order)}>Invoice</Button> : null}
          {canEdit ? <Button variant="outline" icon={<Truck className="h-4 w-4" />} onClick={() => toast('Dispatch request workflow is available from Dispatch module')}>Dispatch</Button> : null}
          {canEdit ? <Button variant="outline" icon={<Copy className="h-4 w-4" />} onClick={() => onDuplicate(order)}>Duplicate</Button> : null}
          {canEdit ? <Button variant="outline" icon={<Calendar className="h-4 w-4" />} onClick={() => onNote(order)}>Add Note</Button> : null}
          {canEdit ? <Button variant="outline" icon={<Edit2 className="h-4 w-4" />} onClick={() => onEdit(order)}>Edit</Button> : null}
          {canDelete ? <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => onDelete(order)}>Delete</Button> : null}
        </div>
      </div>
    </Modal>
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

export default MobileOrderWorkspace;
