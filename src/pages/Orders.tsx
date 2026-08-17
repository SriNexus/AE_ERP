import React from 'react';
import { useState, useMemo, useCallback, useEffect, useDeferredValue } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAll, updateDocById, deleteDocById, fmtDate, fmtCurrency, toInputDate } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { ORDER_STATUSES, PAYMENT_STATUSES } from '../config/company';
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
import { OrderItemsEditor } from '../features/orders/components/OrderItemsEditor';
import { statusBadge } from '../components/ui/Badge';
import { Modal, ConfirmDialog } from '../components/ui/Modal';
import { Input, Select, Textarea, FormRow, FormSection } from '../components/ui/Input';
import { Plus, Download, Trash2, CheckCircle2, Eye, ShoppingCart, RefreshCw, X, AlertTriangle, Clock, Archive } from 'lucide-react';
import { InactiveRecordsModal } from '../components/shared/InactiveRecordsModal';
import toast from 'react-hot-toast';
import { useAppStore, useCurrentUser } from '../store/useAppStore';
import { resolveBusinessMode } from '../lib/companyBusinessMode';
import { filterCustomersForBusinessMode } from '../lib/customerClassification';
import { useSettingsSection } from '../features/settings/hooks/useSettingsSection';
import { buildEmailComposePayload, normalizeEmailSettings, openGmailCompose } from '../features/settings/emailRuntime';
import type { EmailTemplateKey } from '../features/settings/types';
import { getProductHistory } from '../lib/pricingEngine';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { queryKeys } from '../lib/queryKeys';
import { useCancelOrder } from '../features/orders/hooks/useOrders';
import { useOrders } from '../features/sales/hooks/useSales';
import { useKPIStats } from '../hooks/useKPIStats';
import type { Order, OrderType } from '../types';
import { NotificationType } from '../types';
import { canDo } from '../lib/permissions';
import { notifyRoleUsers } from '../lib/notifications';
import { propagateCaseIdFromChain } from '../lib/casePropagation';
import { createOrder } from '../lib/orderWorkflow';

const PER_PAGE = 10;
const FORM0 = { customer:'', customerId:'', orderType:'B2B', date:'', deliveryDate:'', status:'Pending', paymentStatus:'Pending', paymentMode:'', discount:'0', notes:'', shippingAddress:'', warehouseId:'' };
const ORDER_TYPE_OPTIONS: OrderType[] = ['B2B', 'B2C'];
const DATE_RANGE_OPTIONS = [
  { label: 'All Dates', value: 'all' },
  { label: 'Today', value: 'today' },
  { label: 'This Week', value: 'week' },
  { label: 'This Month', value: 'month' },
  { label: 'Custom', value: 'custom' },
];

function asDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object' && value && 'toDate' in value && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value && 'seconds' in value) return new Date(Number(value.seconds) * 1000);
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function inDateRange(value: unknown, range: string, customFrom?: string, customTo?: string) {
  if (range === 'all') return true;
  const date = asDate(value);
  if (!date) return false;
  const now = new Date();
  if (range === 'today') return date >= startOfDay(now);
  if (range === 'week') {
    const start = startOfDay(now);
    start.setDate(start.getDate() - start.getDay());
    return date >= start;
  }
  if (range === 'month') return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  if (range === 'custom') {
    const from = customFrom ? startOfDay(new Date(customFrom)) : null;
    const to = customTo ? startOfDay(new Date(customTo)) : null;
    if (to) to.setDate(to.getDate() + 1);
    return (!from || date >= from) && (!to || date < to);
  }
  return true;
}

function formatOrderDate(value: unknown): string {
  const date = asDate(value);
  return date ? date.toLocaleDateString('en-GB') : '—';
}

function orderDisplayNumber(order: any): string {
  return String(order?.orderNumber || order?.orderNo || '').trim() || '—';
}

function orderEmail(order: any, customers: any[]) {
  const customer = customers.find((entry) => entry.id === order.customerId);
  return order.customerEmail || order.email || customer?.email || customer?.businessEmail || '';
}

function isRowOpenIgnored(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button,a,input,select,textarea,[data-action],[data-dropdown],[data-interactive]'));
}

function OrderActionStrip({ onView }: { onView: () => void; }) {
  return (
    <div className="flex items-center justify-end gap-1.5 opacity-90 transition-opacity duration-150 group-hover:opacity-100" data-action>
      <Button
        size="xs"
        variant="outline"
        icon={<Eye className="h-3.5 w-3.5" />}
        onClick={onView}
        className="h-7 rounded-xl border-[var(--color-border-strong)] bg-[var(--color-text)] px-3 text-[var(--color-text-inverse)] shadow-[var(--shadow-enterprise-control)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-[var(--color-text)] hover:opacity-90 hover:shadow-[var(--shadow-enterprise-row)]"
      >
        View
      </Button>
    </div>
  );
}

export default function Orders() {
  const qc = useQueryClient();
  const { company } = useAppStore();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const qkeys = queryKeys.forCompany(activeCompanyId);
  const user = useCurrentUser();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const editParam = searchParams.get('edit') || '';
  const projectScope = searchParams.get('projectId') || '';
  const createParam = searchParams.get('create') || '';
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const deferredSearch = useDeferredValue(search);
  const [statusF, setStatusF] = useState(searchParams.get('status') || '');
  const [typeF, setTypeF] = useState(searchParams.get('orderType') || '');
  const [assignedF, setAssignedF] = useState(searchParams.get('assigned') || '');
  const [dateRangeF, setDateRangeF] = useState(searchParams.get('dateRange') || 'all');
  const [customFrom, setCustomFrom] = useState(searchParams.get('from') || '');
  const [customTo, setCustomTo] = useState(searchParams.get('to') || '');
  const [activeKpi, setActiveKpi] = useState(searchParams.get('kpi') || '');
  const [page, setPage] = useState(Math.max(1, Number(searchParams.get('page')) || 1));
  const [perPage, setPerPage] = useState(Math.max(1, Number(searchParams.get('perPage')) || PER_PAGE));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string|null>(null);
  const [form, setForm] = useState({...FORM0});
  const [items, setItems] = useState<any[]>([]);
  const [delId, setDelId] = useState<string|null>(null);
  const [cancelId, setCancelId] = useState<string|null>(null);
  const [showBulkStatus, setShowBulkStatus] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');
  // Phase 13 (Blueprint §13): "show inactive" + restore for soft-deleted Orders
  const [showInactive, setShowInactive] = useState(false);

  const { data: orders=[], isLoading, refetch, loadMore, hasMore, loadingMore } = useOrders();
  const { data: customers=[] } = useQuery({ queryKey:qkeys.customersAll, queryFn:()=>getAll(COLLECTIONS.CUSTOMERS), staleTime:60000 });
  // Phase 2: Orders are shared B2B+B2C infrastructure — exclude only customers
  // whose type isn't valid for this company's Business Mode, never a single fixed type.
  const businessMode = resolveBusinessMode(company);
  const orderCustomerOptions = useMemo(() => filterCustomersForBusinessMode(customers as any[], businessMode), [customers, businessMode]);
  const { data: products=[] }  = useQuery({ queryKey:qkeys.productsAll,  queryFn:()=>getAll(COLLECTIONS.PRODUCTS),  staleTime:60000 });
  const { data: warehouses=[] } = useQuery({ queryKey:qkeys.warehouses, queryFn:()=>getAll(COLLECTIONS.WAREHOUSES), staleTime:300000 });
  const { data: users=[] } = useQuery({ queryKey:queryKeys.global.users, queryFn:()=>getAll(COLLECTIONS.USERS), staleTime:300000 });
  const emailSettingsQuery = useSettingsSection('email');
  const emailSettings = useMemo(() => normalizeEmailSettings(emailSettingsQuery.data as Record<string, unknown> | undefined), [emailSettingsQuery.data]);

  const sendOrderEmail = useCallback((order: any, templateKey: EmailTemplateKey = 'order') => {
    const recipient = orderEmail(order, customers as any[]);
    const result = buildEmailComposePayload({
      templateKey,
      settings: emailSettings,
      recipientEmail: recipient,
      variables: {
        customerName: order.customer || order.customerName || (customers as any[]).find((item: any) => item.id === order.customerId)?.name || '',
        companyName: company?.name || '',
        orderNumber: orderDisplayNumber(order),
        orderDate: formatOrderDate(order.date || order.createdAt),
        deliveryDate: formatOrderDate(order.deliveryDate),
        totalAmount: fmtCurrency(order.total || 0, company.currencySymbol),
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
  }, [company?.name, company.currencySymbol, customers, emailSettings]);

  // Sync filter/pagination state to URL (the retired popup's 'open' param is
  // gone; the deep-link edit param is preserved so /orders/:id's "Edit Order"
  // quick action survives reloads).
  useEffect(() => {
    const next = new URLSearchParams();
    if (search) next.set('search', search);
    if (statusF) next.set('status', statusF);
    if (typeF) next.set('orderType', typeF);
    if (assignedF) next.set('assigned', assignedF);
    if (dateRangeF !== 'all') next.set('dateRange', dateRangeF);
    if (dateRangeF === 'custom') {
      if (customFrom) next.set('from', customFrom);
      if (customTo) next.set('to', customTo);
    }
    if (activeKpi) next.set('kpi', activeKpi);
    if (page > 1) next.set('page', String(page));
    if (perPage !== PER_PAGE) next.set('perPage', String(perPage));
    if (projectScope) next.set('projectId', projectScope);
    if (editParam) next.set('edit', editParam);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusF, typeF, assignedF, dateRangeF, customFrom, customTo, activeKpi, page, perPage, projectScope, editParam, setSearchParams]);

  // Handle incoming routing state (e.g. from Customer "Create Order" button)
  useEffect(() => {
    if (location.state?.prefillCustomer) {
      const c = location.state.prefillCustomer;
      setForm({
        ...FORM0,
        customerId: c.id,
        customer: c.name,
        orderType: c.type || 'B2C',
        shippingAddress: c.address || '',
        date: new Date().toISOString().split('T')[0]
      });
      setItems([]);
      setEditId(null);
      setShowForm(true);
      // Clean up state so it doesn't reopen on refresh
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const subtotal = useMemo(()=>items.reduce((s,i)=>s+(Number(i.qty)||0)*(Number(i.price)||0),0),[items]);
  const taxTotal = useMemo(()=>items.reduce((s,i)=>s+(Number(i.qty)||0)*(Number(i.price)||0)*(Number(i.tax)||0)/100,0),[items]);
  const discount = Number(form.discount)||0;
  const grandTotal = subtotal + taxTotal - discount;

  function addItem() { setItems(prev=>[...prev,{productId:'',product:'',qty:1,price:0,tax:0,unit:'PCS',total:0}]); }
  function updateItem(idx:number, key:string, val:any) {
    setItems(prev=>prev.map((it,i)=>{ 
      if(i!==idx) return it; 
      const updated={...it,[key]:val}; 
      if(key==='productId'){
        const p=products.find((x:any)=>x.id===val);
        if(p){
          updated.product=(p as any).name;
          updated.category=(p as any).category||'';
          updated.unit=(p as any).unit||'PCS';
          
          // SMART PRICING ENGINE: Check history first
          const history = getProductHistory(orders, form.customerId, p.id);
          if (history) {
            updated.price = history.price;
            updated.tax = history.tax || (p as any).tax || 0;
            updated.historyText = `Last sold @ ${fmtCurrency(history.price, company.currencySymbol)} on ${fmtDate(history.date)}`;
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
      if (editId) {
        const payload = {...d, items, subtotal, taxTotal, discount, total:grandTotal, createdBy:user.id};
        await updateDocById(COLLECTIONS.ORDERS, editId, payload);
        await notifyRoleUsers(['Accounts', 'Operations', 'Director'], NotificationType.ORDER_UPDATED, 'Order updated', `Order ${editId} was updated for ${d.customer || 'customer'}.`, 'order', editId, activeCompanyId);
        return { ...payload, id: editId };
      }
      return createOrder({
        form: d, items, subtotal, taxTotal, discount, grandTotal,
        companyId: company.id, orderPrefix: company.orderPrefix, createdBy: user.id, activeCompanyId,
      });
    },
    onSuccess: (savedOrder: any) => {
      // Phase 3B: Propagate caseId from quotation chain to order
      if (savedOrder?.id && !editId) void propagateCaseIdFromChain('orders', savedOrder.id);
      qc.invalidateQueries({queryKey:qkeys.ordersRoot});
      toast.success(editId?'Order updated':'Order created');
      closeForm();
      // The retired standalone popup was the old post-save destination; the
      // Order workspace now lives inside the Project Workspace, and unlinked
      // Orders open their /orders/:id detail page.
      if (savedOrder?.id) navigate(`/orders/${encodeURIComponent(savedOrder.id)}`);
    },
    onError: (e:any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id:string) => {
      await deleteDocById(COLLECTIONS.ORDERS, id);
      await notifyRoleUsers(['Accounts', 'Operations', 'Director'], NotificationType.ORDER_DELETED, 'Order deleted', `Order ${id} was deleted.`, 'order', id, activeCompanyId);
    },
    onSuccess: () => { qc.invalidateQueries({queryKey:qkeys.ordersRoot}); toast.success('Deleted'); setDelId(null); setSelected(new Set()); },
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      await Promise.all(ids.map((id) => updateDocById(COLLECTIONS.ORDERS, id, { status })));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkeys.ordersRoot });
      toast.success(`Status updated for ${selected.size} orders`);
      setShowBulkStatus(false);
      setBulkStatus('');
      setSelected(new Set());
    },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => deleteDocById(COLLECTIONS.ORDERS, id)));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkeys.ordersRoot });
      toast.success(`Deleted ${selected.size} orders`);
      setSelected(new Set());
    },
    onError: (e: any) => toast.error(e.message),
  });

  const cancelOrderMutation = useCancelOrder();

  useEffect(() => {
    if (createParam !== '1') return;
    setForm({...FORM0,date:new Date().toISOString().split('T')[0]});
    setItems([]);
    setEditId(null);
    setShowForm(true);
  }, [createParam]);

  function closeForm() {
    setShowForm(false);
    setEditId(null);
    setForm({...FORM0});
    setItems([]);
    const next = new URLSearchParams(searchParams);
    if (createParam === '1') next.delete('create');
    if (editParam) next.delete('edit');
    setSearchParams(next, { replace: true });
  }
  function openEdit(o:any) {
    setForm({customer:o.customer||'',customerId:o.customerId||'',orderType:o.orderType||'B2B',date:toInputDate(o.date),deliveryDate:toInputDate(o.deliveryDate),status:o.status||'Pending',paymentStatus:o.paymentStatus||'Pending',paymentMode:o.paymentMode||'',discount:String(o.discount||0),notes:o.notes||'',shippingAddress:o.shippingAddress||'',warehouseId:o.warehouseId||''});
    setItems(o.items||[]); setEditId(o.id); setShowForm(true);
  }
  function openCreateForm() {
    setForm({...FORM0,date:new Date().toISOString().split('T')[0]});
    setItems([]);
    setEditId(null);
    setShowForm(true);
  }
  function handleSubmit(e:React.FormEvent) { e.preventDefault(); if(save.isPending) return; if(!form.customer) return toast.error('Customer required'); if(items.length===0) return toast.error('Add at least one item'); save.mutate(form); }

  const orderStats = useKPIStats(orders, {
    statusField: 'status',
    statuses: ORDER_STATUSES,
    revenueField: 'total',
    dateField: 'date',
  });
  const salesUsers = useMemo(() => (users as any[])
    .filter((u: any) => ['Sales', 'Executive', 'BDE', 'BDM', 'Manager', 'TL'].includes(u.role) && u.status !== 'Inactive' && !u.isDeleted)
    .sort((a: any, b: any) => String(a.name || '').localeCompare(String(b.name || ''))),
  [users]);
  const overdueOrders = useMemo(() => (orders as any[]).filter((o: any) => String(o.paymentStatus || '').toLowerCase() === 'overdue').length, [orders]);

  const filtered = useMemo(()=>orders.filter((o:Order)=>{
    const q=deferredSearch.toLowerCase();
    return (!projectScope || String((o as any).projectId || '') === projectScope)
      && (!q||[o.id,o.customer,o.customerId].some((v)=>String(v||'').toLowerCase().includes(q)))
      &&(!statusF||o.status===statusF)
      &&(!typeF||o.orderType===typeF)
      &&(!assignedF||(o as any).assignedToId===assignedF||(o as any).assignedToName?.toLowerCase().includes(assignedF.toLowerCase()))
      &&(!activeKpi
        || (activeKpi === 'Pending' && o.status === 'Pending')
        || (activeKpi === 'Processing' && o.status === 'Processing')
        || (activeKpi === 'Completed' && o.status === 'Delivered')
        || (activeKpi === 'Cancelled' && o.status === 'Cancelled')
        || (activeKpi === 'Overdue' && o.paymentStatus === 'Overdue'))
      &&inDateRange(o.date || o.createdAt, dateRangeF, customFrom, customTo);
  }),[orders,deferredSearch,statusF,typeF,dateRangeF,customFrom,customTo,activeKpi,projectScope]);

  const paginated = filtered.slice((page-1)*perPage,page*perPage);
  const toggleSelect = useCallback((id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    }), []);
  const toggleAll = () =>
    setSelected((s) => s.size === paginated.length ? new Set() : new Set(paginated.map((o: any) => o.id)));
  const allSel = selected.size === paginated.length && paginated.length > 0;
  // The retired standalone popup was the old row-click destination; an
  // Order's full record now opens its /orders/:id detail page (the Project
  // Workspace's Stage 5 — Order workspace is the operational surface).
  function handleRowClick(e: React.MouseEvent<HTMLTableRowElement>, order: any) {
    if (isRowOpenIgnored(e.target)) return;
    navigate(`/orders/${encodeURIComponent(order.id)}`);
  }
  function handleRowKeyDown(e: React.KeyboardEvent<HTMLTableRowElement>, order: any) {
    if (isRowOpenIgnored(e.target)) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    navigate(`/orders/${encodeURIComponent(order.id)}`);
  }
  function exportSelected() {
    const rows = (orders as any[]).filter((o) => selected.has(o.id));
    if (!rows.length) return toast.error('No orders selected');
    const csv=[['Order No','Customer','Total','Status','Payment','Date'],...rows.map((o:any)=>[orderDisplayNumber(o),o.customer||o.customerName||'—',o.total,o.status,o.paymentStatus,fmtDate(o.date)])];
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv.map(r=>r.join(',')).join('\n')],{type:'text/csv'})); a.download='orders-selected.csv'; a.click(); toast.success('Exported!');
  }

  // Sync URL → edit form: /orders/:id's "Edit Order" quick action deep-links
  // here via ?edit= (the retired popup's Edit button previously opened this
  // same form modal inline). The create/edit form modal stays for standalone
  // (unlinked) Order edits.
  // 'filtered' and 'perPage' are NOT in deps to prevent re-triggering on filter changes.
  useEffect(() => {
    const editIdParam = editParam;
    if (!editIdParam || isLoading) return;
    const target = (orders as Order[]).find((order) => order.id === editIdParam);
    if (!target) return;
    // Same prefill the retired popup's Edit button used — the edit form modal
    // deep-link lands here (openEdit takes `any`, so no typing workaround).
    openEdit(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editParam, isLoading, orders]);

  function exportCSV() {
    const rows=[['ID','Customer','Total','Status','Payment','Date'],...filtered.map((o:any)=>[o.id,o.customer,o.total,o.status,o.paymentStatus,fmtDate(o.date)])];
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([rows.map(r=>r.join(',')).join('\n')],{type:'text/csv'})); a.download='orders.csv'; a.click(); toast.success('Exported!');
  }

  // ── Total KPI active by default when no filters are set
  const isTotalDefault = useMemo(() => {
    return !activeKpi && !search && !statusF && !typeF && !assignedF && dateRangeF === 'all';
  }, [activeKpi, search, statusF, typeF, assignedF, dateRangeF]);

  // ── Active filter count for Clear All display
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (search) count++;
    if (statusF) count++;
    if (typeF) count++;
    if (assignedF) count++;
    if (dateRangeF !== 'all') count++;
    if (activeKpi) count++;
    return count;
  }, [search, statusF, typeF, assignedF, dateRangeF, activeKpi]);

  const KPI_TILES = [
    { label: 'TOTAL', value: orderStats.total, key: '', icon: <ShoppingCart className="h-4 w-4" />, description: `${orderStats.total} total orders` },
    { label: 'PENDING', value: orderStats.byStatus.pending || 0, key: 'Pending', icon: <Clock className="h-4 w-4" />, description: 'Pending orders' },
    { label: 'PROCESSING', value: orderStats.byStatus.processing || 0, key: 'Processing', icon: <RefreshCw className="h-4 w-4" />, description: 'Orders in progress' },
    { label: 'COMPLETED', value: orderStats.byStatus.delivered || 0, key: 'Completed', icon: <CheckCircle2 className="h-4 w-4" />, description: 'Delivered orders' },
    { label: 'CANCELLED', value: orderStats.byStatus.cancelled || 0, key: 'Cancelled', icon: <X className="h-4 w-4" />, description: 'Cancelled orders' },
    { label: 'OVERDUE', value: overdueOrders, key: 'Overdue', icon: <AlertTriangle className="h-4 w-4" />, description: 'Overdue payments' },
  ];

  function handleStatusChange(v: string) {
    const kpiStatusMap: Record<string, string> = { Pending: 'Pending', Processing: 'Processing', Completed: 'Delivered', Cancelled: 'Cancelled', Overdue: '' };
    if (v && activeKpi && kpiStatusMap[activeKpi] && v !== kpiStatusMap[activeKpi]) {
      setActiveKpi('');
    }
    setStatusF(v); setPage(1);
  }

  function handleDateChange(newDateRange: string) {
    setDateRangeF(newDateRange);
    setPage(1);
    if (newDateRange !== 'custom') { setCustomFrom(''); setCustomTo(''); }
  }

  function clearAll() {
    setSearch(''); setStatusF(''); setTypeF(''); setAssignedF('');
    setDateRangeF('all'); setCustomFrom(''); setCustomTo(''); setActiveKpi(''); setPage(1);
    const next = new URLSearchParams();
    setSearchParams(next, { replace: true });
  }

  const DATE_OPTIONS = [
    { label: 'All dates', value: 'all' },
    { label: 'Today', value: 'today' },
    { label: 'This Week', value: 'week' },
    { label: 'This Month', value: 'month' },
    { label: 'Custom', value: 'custom' },
  ];

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      {/* ── Premium Workspace Hero ─────────────────────────── */}
      <WorkspaceHero
        title="Orders"
        icon={<ShoppingCart className="h-6 w-6" />}
        breadcrumbs={['Home', 'Sales', 'Orders']}
        statusText="Last sync · Realtime Connected"
        statusDotColor="var(--color-success)"
        className="gap-3"
        actions={
          <>
            <Button variant="outline" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => refetch()}>
              Refresh
            </Button>
            <Button variant="outline" size="sm" icon={<Archive className="h-4 w-4" />} onClick={() => setShowInactive(true)}>
              Show Inactive
            </Button>
            {canDo('create', 'orders') && (
              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreateForm}>
                New Order
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
              const nextKpi = activeKpi === k.key ? '' : k.key;
              setActiveKpi(nextKpi);
              setPage(1);
            }}
            active={k.key === '' ? (activeKpi === '' || isTotalDefault) : activeKpi === k.key}
          />
        ))}
      </div>

      {/* ── Premium Elevated Table Card ────────────────────── */}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.04)] border-[var(--color-border)]">
        {/* ── Card Header with Register Title + Active Filter Pills */}
        <CardHeader className="px-6 pt-2 pb-2 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <input
              aria-label="Search orders"
              placeholder="Search order ID, customer…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="min-w-[160px] flex-1 h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]"
            />
            <UiSelect
              aria-label="Date"
              value={dateRangeF}
              options={DATE_OPTIONS}
              onChange={(e) => handleDateChange(e.target.value)}
              className="w-[110px] h-8 py-1"
            />
            {dateRangeF === 'custom' && (
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => { setCustomFrom(e.target.value); setPage(1); }}
                  className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                />
                <span className="text-[10px] text-[var(--color-text-muted)]">to</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => { setCustomTo(e.target.value); setPage(1); }}
                  className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                />
              </div>
            )}
            <UiSelect
              aria-label="Status"
              value={statusF}
              onChange={(e) => handleStatusChange(e.target.value)}
              options={[
                { label: 'All Status', value: '' },
                ...ORDER_STATUSES.map(s => ({ label: s, value: s })),
              ]}
              className="w-[110px] h-8 py-1"
            />
            <UiSelect
              aria-label="Type"
              value={typeF}
              onChange={(e) => { setTypeF(e.target.value); setPage(1); }}
              options={[
                { label: 'All Types', value: '' },
                ...ORDER_TYPE_OPTIONS.map(s => ({ label: s, value: s })),
              ]}
              className="w-[100px] h-8 py-1"
            />
            <UiSelect
              aria-label="Assigned"
              value={assignedF}
              onChange={(e) => { setAssignedF(e.target.value); setPage(1); }}
              options={[
                { label: 'All Assignments', value: '' },
                ...salesUsers.map(u => ({ label: u.name || u.displayName || u.id, value: u.id })),
              ]}
              className="w-[120px] h-8 py-1"
            />
            {/* Active filter pills + Clear All */}
            {activeFilterCount > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {activeKpi && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary-light)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-primary-text)]">
                    {KPI_TILES.find(t => t.key === activeKpi)?.label || activeKpi}
                    <button type="button" onClick={() => { setActiveKpi(''); setPage(1); }} className="ml-0.5 hover:opacity-70"><X className="h-2.5 w-2.5" /></button>
                  </span>
                )}
                {search && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">S: {search.slice(0, 12)}{search.length > 12 ? '…' : ''}</span>
                )}
                {statusF && !activeKpi && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">{statusF}</span>
                )}
                {typeF && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">{typeF}</span>
                )}
                <button type="button" onClick={clearAll} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors">
                  <X className="h-2.5 w-2.5" />
                  Clear
                </button>
              </div>
            )}
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
            </div>
          </div>
        </CardHeader>

        {/* ── Bulk action bar */}
        {selected.size > 0 && (
          <div className="px-6 py-2.5 flex items-center gap-3 bg-[var(--color-primary-light)] border-b border-[var(--color-primary-muted)]">
            <span className="text-sm font-semibold text-[var(--color-primary-text)]">
              {selected.size} order{selected.size > 1 ? 's' : ''} selected
            </span>
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <Button size="sm" variant="outline"
                icon={<Download className="h-3.5 w-3.5" />}
                onClick={exportSelected}
                className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30">
                Export CSV
              </Button>
              {canDo('edit', 'orders') && (
                <Button size="sm" variant="outline"
                  icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                  onClick={() => setShowBulkStatus(true)}
                  className="text-indigo-600 border-indigo-300 hover:bg-indigo-50 dark:border-indigo-700 dark:hover:bg-indigo-900/30">
                  Change Status
                </Button>
              )}
              {canDo('delete', 'orders') && (
                <Button size="sm" variant="outline"
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  onClick={() => bulkDeleteMutation.mutate(Array.from(selected))}
                  loading={bulkDeleteMutation.isPending}
                  className="text-red-600 border-red-300 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/30">
                  Delete
                </Button>
              )}
              <button onClick={() => setSelected(new Set())}
                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] ml-1">
                ✕ Clear
              </button>
            </div>
          </div>
        )}

        {/* ── Filter + Table Area + Pagination (unified) */}
        <div className="px-6 flex-1 flex flex-col min-h-0">
          {/* ── Premium Universal Table ──────────────────────── */}
          <div className="min-h-0 flex-1 overflow-auto scroll-pt-10">
            <Table>
              <Thead>
                <Th style={{ width: 44, minWidth: 44, maxWidth: 44 }}>
                  <UniversalCheckbox checked={allSel} indeterminate={selected.size > 0 && !allSel} onChange={toggleAll} ariaLabel="Select visible orders" />
                </Th>
                <Th style={{ width: '15%', minWidth: 100 }}>ORDER</Th>
                <Th style={{ width: '18%', minWidth: 140 }}>CUSTOMER</Th>
                <Th style={{ width: 70, minWidth: 70 }}>TYPE</Th>
                <Th style={{ width: 90, minWidth: 90 }}>DATE</Th>
                <Th className="hidden md:table-cell" style={{ width: 90, minWidth: 90 }}>DELIVERY</Th>
                <Th style={{ width: 70, minWidth: 70 }}>ITEMS</Th>
                <Th style={{ width: 110, minWidth: 110 }}>TOTAL</Th>
                <Th style={{ width: 100, minWidth: 100 }}>PAYMENT</Th>
                <Th style={{ width: 100, minWidth: 100 }}>STATUS</Th>
                <Th align="right" style={{ width: 130, minWidth: 130 }}>ACTIONS</Th>
              </Thead>
              <Tbody>
                {isLoading
                  ? <SkeletonRows cols={11} />
                  : paginated.length === 0
                    ? (
                      <tr>
                        <td colSpan={11} className="py-14 text-center">
                          <EmptyState
                            icon={<ShoppingCart className="h-9 w-9" />}
                            title={search || statusF || typeF || assignedF || dateRangeF !== 'all' ? 'No orders match filters' : 'No orders yet'}
                            description={search || statusF || typeF || assignedF || dateRangeF !== 'all' ? undefined : 'Create your first order to get started.'}
                            action={!search && !statusF && !typeF && !assignedF && dateRangeF === 'all' && canDo('create', 'orders') ? (
                              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreateForm} className="mt-2">Create Your First Order</Button>
                            ) : undefined}
                          />
                        </td>
                      </tr>
                    )
                    : paginated.map((o: any) => (
                      <Tr key={o.id} selected={selected.has(o.id)}
                        data-record-id={o.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`Open order ${orderDisplayNumber(o)}`}
                        onClick={(e) => handleRowClick(e, o)}
                        onKeyDown={(e) => handleRowKeyDown(e, o)}
                        className="transition-colors duration-150"
                      >
                        {/* Checkbox */}
                        <Td className="py-3" onClick={(e) => e.stopPropagation()}>
                          <UniversalCheckbox checked={selected.has(o.id)} onChange={() => toggleSelect(o.id)} ariaLabel={`Select ${orderDisplayNumber(o)}`} />
                        </Td>

                        {/* Order Number */}
                        <Td className="py-3">
                          <span className="font-mono text-xs font-semibold text-[var(--color-primary-text)]">{orderDisplayNumber(o)}</span>
                        </Td>

                        {/* Customer */}
                        <Td className="py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-7 w-7 shrink-0 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary-text)] flex items-center justify-center text-[11px] font-bold">
                              {(o.customer || '?')[0].toUpperCase()}
                            </div>
                            <span className="text-sm font-medium text-[var(--color-text)] leading-tight">{o.customer || o.customerName || '—'}</span>
                          </div>
                        </Td>

                        {/* Type */}
                        <Td className="py-3">{statusBadge(o.orderType || 'B2C')}</Td>

                        {/* Date */}
                        <Td className="py-3 text-xs text-[var(--color-text-secondary)]">{fmtDate(o.date || o.createdAt)}</Td>

                        {/* Delivery Date */}
                        <Td className="hidden md:table-cell py-3 text-xs text-[var(--color-text-muted)]">{fmtDate(o.deliveryDate) || '—'}</Td>

                        {/* Items */}
                        <Td className="py-3 text-xs">{(o.items || []).length} items</Td>

                        {/* Total */}
                        <Td className="py-3 text-sm font-semibold text-[var(--color-text)]">{fmtCurrency(o.total, company.currencySymbol)}</Td>

                        {/* Payment Status */}
                        <Td className="py-3">{statusBadge(o.paymentStatus || 'Pending')}</Td>

                        {/* Order Status */}
                        <Td className="py-3">{statusBadge(o.status || 'Pending')}</Td>

                        {/* Actions */}
                        <Td className="py-3" align="right"><OrderActionStrip onView={() => navigate(`/orders/${encodeURIComponent(o.id)}`)} /></Td>
                      </Tr>
                    ))
                }
              </Tbody>
            </Table>
          </div>
          {/* ── Premium Pagination (inside table block) ────── */}
          <div className="shrink-0 border-t border-[var(--color-border-subtle)]">
            <Pagination page={page} total={filtered.length} perPage={perPage} onChange={setPage} onPerPageChange={n => { setPerPage(n); setPage(1); }} />
          </div>
        </div>
      </Card>

      {/* Order Form */}
      <Modal open={showForm} onClose={closeForm} title={editId?'Edit Order':'New Order'} size="2xl">
        <form onSubmit={handleSubmit} className="space-y-5">
          
          <FormSection title="Order Information">
            <FormRow cols={3}>
              <Select label="Customer" required value={form.customerId} onChange={e=>{const c=customers.find((x:any)=>x.id===e.target.value) as any;setForm({...form,customerId:e.target.value,customer:c?.name||'',shippingAddress:c?.address||''});}} options={[{label:'Select Customer',value:''},...orderCustomerOptions.map((c:any)=>({label:c.name,value:c.id}))]}/>
              <Select label="Order Type" value={form.orderType} onChange={e=>setForm({...form,orderType:e.target.value})} options={[{label:'B2B',value:'B2B'},{label:'B2C',value:'B2C'}]}/>
              <Select label="Warehouse" value={form.warehouseId} onChange={e=>setForm({...form,warehouseId:e.target.value})} options={[{label:'Select Warehouse',value:''},...warehouses.map((w:any)=>({label:w.name,value:w.id}))]}/>
            </FormRow>
            <FormRow cols={3}>
              <Input label="Order Date" type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/>
              <Input label="Delivery Date" type="date" value={form.deliveryDate} onChange={e=>setForm({...form,deliveryDate:e.target.value})}/>
              <Select label="Status" value={form.status} onChange={e=>setForm({...form,status:e.target.value})} options={ORDER_STATUSES.map(s=>({label:s,value:s}))}/>
            </FormRow>
          </FormSection>

          {/* Items */}
          <FormSection title="Order Items">
            <OrderItemsEditor
              items={items}
              products={products as any[]}
              currencySymbol={company.currencySymbol}
              subtotal={subtotal}
              taxTotal={taxTotal}
              discount={discount}
              grandTotal={grandTotal}
              onAddItem={addItem}
              onRemoveItem={removeItem}
              onUpdateItem={updateItem}
              onDiscountChange={v => setForm({...form, discount: v})}
            />
          </FormSection>

          <FormSection title="Payment">
            <FormRow>
              <Select label="Payment Status" value={form.paymentStatus} onChange={e=>setForm({...form,paymentStatus:e.target.value})} options={PAYMENT_STATUSES.map(s=>({label:s,value:s}))}/>
              <Input label="Payment Mode" value={form.paymentMode} onChange={e=>setForm({...form,paymentMode:e.target.value})} placeholder="Cash, UPI, Bank Transfer..."/>
            </FormRow>
          </FormSection>
          <Textarea label="Shipping Address" value={form.shippingAddress} onChange={e=>setForm({...form,shippingAddress:e.target.value})} rows={2}/>
          <Textarea label="Notes" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} rows={2}/>
          <div className={"flex justify-end gap-2 pt-2"}><Button variant="outline" type="button" onClick={closeForm}>Cancel</Button><Button type="submit" loading={save.isPending}>{editId?'Update Order':'Create Order'}</Button></div>
          
        </form>
      </Modal>

      <Modal open={showBulkStatus} onClose={() => { setShowBulkStatus(false); setBulkStatus(''); }} title="Change Status" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            Changing status for <span className="font-semibold text-[var(--color-text)]">{selected.size} order{selected.size > 1 ? 's' : ''}</span>.
          </p>
          <Select
            label="New Status"
            value={bulkStatus}
            onChange={e => setBulkStatus(e.target.value)}
            options={[{ label: 'Select Status...', value: '' }, ...ORDER_STATUSES.map(s => ({ label: s, value: s }))]}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setShowBulkStatus(false); setBulkStatus(''); }}>Cancel</Button>
            <Button
              onClick={() => {
                if (!bulkStatus) return toast.error('Select a status');
                bulkStatusMutation.mutate({ ids: Array.from(selected), status: bulkStatus });
              }}
              loading={bulkStatusMutation.isPending}
            >
              Update {selected.size} Orders
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!delId}
        onClose={()=>setDelId(null)}
        onConfirm={()=>delId&&del.mutate(delId)}
        loading={del.isPending}
        title="Delete Order"
        message="Delete this order permanently?"
      />
      <ConfirmDialog
        open={!!cancelId}
        onClose={()=>setCancelId(null)}
        onConfirm={()=>cancelId&&cancelOrderMutation.mutate(
          { orderId: cancelId, reason: 'Cancelled from Orders page' },
          {
            onSuccess: () => {
              setCancelId(null);
            },
          }
        )}
        loading={cancelOrderMutation.isPending}
        title="Cancel Order"
        message="Cancel this order? Dispatched stock will be restored and linked dispatches will be marked returned."
      />

      <InactiveRecordsModal
        open={showInactive}
        onClose={() => setShowInactive(false)}
        col={COLLECTIONS.ORDERS}
        title="Inactive Orders"
        getLabel={(row: any) => row.orderNumber || row.id}
        getSubtitle={(row: any) => row.customerName || ''}
        onRestored={() => refetch()}
      />
    </div>
  );
}
