import React from 'react';
import { useState, useMemo, useCallback, useEffect, useRef, useDeferredValue } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAll, getOne, updateDocById, deleteDocById,
  fmtDate, fmtCurrency
} from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { Button } from '../components/ui/Button';
import {
  Card,
  CardHeader,
  Pagination,
  PremiumKpi,
  Select,
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
import { EmptyState } from '../components/shared';
import { statusBadge } from '../components/ui/Badge';
import { cn } from '../utils/cn';
import { Modal, ConfirmDialog } from '../components/ui/Modal';
import { Input, Textarea, FormRow, FormSection } from '../components/ui/Input';
import {
  Plus, Trash2, Download, Eye, ClipboardList, RefreshCw,
  Loader2, CheckCircle2, User, Package, FileText, X,
  Target, AlertTriangle, Send,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAppStore, useCurrentUser } from '../store/useAppStore';
import { queryKeys } from '../lib/queryKeys';
import { QT_STATUSES, useQuotations } from '../features/sales/hooks/useSales';
import type { Quotation } from '../types';
import { useKPIStats } from '../hooks/useKPIStats';
import { canDo } from '../lib/permissions';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useProjects } from '../features/projects/hooks/useProjects';
import { useEngineeringDesigns } from '../features/engineering/hooks/useEngineeringDesigns';
import { quotationItemsFromEngineering, synchronizeQuotationProjectLink, createQuotation, updateQuotation } from '../lib/quotationWorkflow';
import { quotationDisplayNumber } from '../features/quotations/utils/quotationEmail';
import { QuotationItemsEditor } from '../features/quotations/components/QuotationItemsEditor';

const PER_PAGE = 10;
const CONVERTED_STATUS = 'Converted to Order';

const FORM0 = {
  orderId: '',
  projectId: '',
  engineeringDesignId: '',
  customer: '',
  customerId: '',
  customerPhone: '',
  customerEmail: '',
  customerAddress: '',
  customerGst: '',
  customerState: '',
  date: '',
  validUntil: '',
  status: 'Draft',
  notes: '',
  terms: '',
  deliveryTimeline: '',
  installationCharges: '',
  transportCharges: '',
  specialDiscount: '',
};

function downloadQuotationsCsv(rows: any[], filename: string) {
  const headers = ['Quotation No', 'Order No', 'Customer', 'Date', 'Valid Until', 'Total', 'Status'];
  const lines = rows.map((q) => [
    quotationDisplayNumber(q),
    String(q.orderNumber || q.orderNo || '—'),
    q.customer || '',
    q.date || '',
    q.validUntil || '',
    q.total ?? '',
    q.status || '',
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  const csv = [headers.join(','), ...lines].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function isRowOpenIgnored(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button,a,input,select,textarea,[data-action],[data-dropdown],[data-interactive]'));
}

function QuotationActionStrip({ onView }: { onView: () => void; }) {
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

const QUOTATION_KPI_STATUS: Record<string, string | null> = {
  total: null,
  draft: 'Draft',
  sent: 'Sent',
  approved: 'Accepted',
  rejected: 'Rejected',
  expired: 'Expired',
};

export default function Quotations() {
  const qc = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectScope = searchParams.get('projectId') || '';
  const designScope = searchParams.get('designId') || '';
  const createParam = searchParams.get('create') || '';
  const { company } = useAppStore();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const qkeys = queryKeys.forCompany(activeCompanyId);
  const user = useCurrentUser();

  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const deferredSearch = useDeferredValue(search);
  const [statusF, setStatusF] = useState(() => searchParams.get('status') || '');
  const [activeKpi, setActiveKpi] = useState(() => searchParams.get('kpi') || '');
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [perPage, setPerPage] = useState(() => Math.max(1, Number(searchParams.get('perPage')) || PER_PAGE));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...FORM0 });
  const [items, setItems] = useState<any[]>([]);
  const [loadingOrder, setLoadingOrder] = useState(false);
  const [orderFetched, setOrderFetched] = useState(false);
  const [delId, setDelId] = useState<string | null>(null);
  const [showBulkStatus, setShowBulkStatus] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');

  function syncQueueParams(nextState: { q?: string; status?: string; kpi?: string; page?: number; perPage?: number }) {
    const next = new URLSearchParams(searchParams);
    const q = nextState.q ?? search;
    const status = nextState.status ?? statusF;
    const kpi = nextState.kpi ?? activeKpi;
    const nextPage = nextState.page ?? page;
    const nextPerPage = nextState.perPage ?? perPage;

    if (q) next.set('q', q); else next.delete('q');
    if (status) next.set('status', status); else next.delete('status');
    if (kpi) next.set('kpi', kpi); else next.delete('kpi');
    if (nextPage > 1) next.set('page', String(nextPage)); else next.delete('page');
    if (nextPerPage !== PER_PAGE) next.set('perPage', String(nextPerPage)); else next.delete('perPage');
    // Note: the retired popup's 'open' param is gone — row click / View now
    // navigates (openQuotationDetails) instead of opening a popup.
    setSearchParams(next, { replace: true });
  }
  const { data: quotations = [], isLoading, refetch, loadMore, hasMore, loadingMore } = useQuotations();
  const { data: projects = [] } = useProjects();
  const { data: engineeringDesigns = [] } = useEngineeringDesigns();
  const { data: orders = [] } = useQuery({ queryKey: qkeys.ordersAll, queryFn: () => getAll(COLLECTIONS.ORDERS), staleTime: 60000 });
  const { data: customers = [] } = useQuery({ queryKey: qkeys.customersAll, queryFn: () => getAll(COLLECTIONS.CUSTOMERS), staleTime: 60000 });
  const { data: products = [] } = useQuery({ queryKey: qkeys.productsAll, queryFn: () => getAll(COLLECTIONS.PRODUCTS), staleTime: 60000 });
  const appliedDesign = useRef('');

  function customerPatch(customerId: string) {
    const customer = (customers as any[]).find((entry) => entry.id === customerId);
    return customer ? {
      customerId,
      customer: customer.name || customer.fullName || customer.contactPerson || customer.company || customer.companyName || '',
      customerPhone: customer.phone || customer.mobile || customer.businessPhone || '',
      customerEmail: customer.email || customer.businessEmail || '',
      customerAddress: customer.address || [customer.city, customer.state].filter(Boolean).join(', '),
      customerGst: customer.gst || '', customerState: customer.state || '',
    } : {};
  }

  function selectProject(projectId: string) {
    const project = projects.find((entry) => entry.id === projectId);
    setForm((current) => ({ ...current, projectId, engineeringDesignId: '', ...(project ? customerPatch(project.customerId) : {}) }));
  }

  function selectEngineeringDesign(designId: string) {
    const design = engineeringDesigns.find((entry) => entry.id === designId);
    if (!design) return setForm((current) => ({ ...current, engineeringDesignId: '' }));
    const project = projects.find((entry) => entry.id === design.projectId);
    setForm((current) => ({ ...current, projectId: design.projectId, engineeringDesignId: design.id, ...(project ? customerPatch(project.customerId) : {}) }));
    setItems(quotationItemsFromEngineering(design));
    setOrderFetched(true);
  }
  const orderNumberById = useMemo(() => {
    const map = new Map<string, string>();
    (orders as any[]).forEach((order: any) => {
      const value = String(order?.orderNumber || order?.orderNo || '').trim() || '—';
      map.set(String(order.id), value);
    });
    return map;
  }, [orders]);

  const subtotal = useMemo(() => items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0), 0), [items]);
  const taxTotal = useMemo(() => items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0) * (Number(i.tax) || 0) / 100, 0), [items]);
  const extraCharges = (Number(form.installationCharges) || 0) + (Number(form.transportCharges) || 0);
  const totalDiscount = (Number(form.specialDiscount) || 0);
  const grandTotal = subtotal + taxTotal + extraCharges - totalDiscount;

  async function handleOrderSelect(orderId: string) {
    setForm(f => ({ ...f, orderId }));
    if (!orderId) {
      setOrderFetched(false);
      setItems([]);
      setForm(f => ({ ...f, customer: '', customerId: '', customerPhone: '', customerEmail: '', customerAddress: '', customerGst: '', customerState: '' }));
      return;
    }
    setLoadingOrder(true);
    try {
      const order = await getOne(COLLECTIONS.ORDERS, orderId) as any;
      if (!order) { toast.error('Order not found'); setLoadingOrder(false); return; }
      const cust = order.customerId ? (await getOne(COLLECTIONS.CUSTOMERS, order.customerId) as any) : null;
      setForm(f => ({
        ...f, orderId,
        customer: order.customer || cust?.name || '',
        customerId: order.customerId || '',
        customerPhone: cust?.phone || order.phone || '',
        customerEmail: cust?.email || order.email || '',
        customerAddress: cust?.address || order.shippingAddress || order.deliveryAddress || '',
        customerGst: cust?.gst || order.customerGst || '',
        customerState: cust?.state || '',
      }));
      const orderItems = order.items || [];
      const enriched = await Promise.all(orderItems.map(async (oi: any) => {
        let pd: any = {};
        if (oi.productId) {
          const cached = products.find((p: any) => p.id === oi.productId) as any;
          pd = cached || (await getOne(COLLECTIONS.PRODUCTS, oi.productId)) || {};
        }
        return {
          productId: oi.productId || '',
          product: oi.product || pd.name || '',
          description: pd.description || oi.description || '',
          hsn: pd.hsn || oi.hsn || '',
          specs: pd.specifications || oi.specs || '',
          warranty: pd.warranty || oi.warranty || '',
          qty: Number(oi.qty) || 1,
          unit: oi.unit || pd.unit || 'Nos',
          price: Number(oi.price) || Number(pd.price) || 0,
          tax: Number(oi.tax) || Number(pd.tax) || 0,
          discount: Number(oi.discount) || 0,
        };
      }));
      setItems(enriched);
      setOrderFetched(true);
      toast.success(`Order ${order.id} auto-populated`);
    } catch (err: any) {
      toast.error('Failed to fetch order: ' + err.message);
    } finally {
      setLoadingOrder(false);
    }
  }

  function updateItem(idx: number, key: string, val: any) {
    setItems(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      const updated = { ...it, [key]: val };
      if (key === 'productId') {
        const pr = products.find((p: any) => p.id === val) as any;
        if (pr) {
          updated.product = pr.name; updated.description = pr.description || '';
          updated.hsn = pr.hsn || ''; updated.specs = pr.specifications || '';
          updated.warranty = pr.warranty || ''; updated.price = pr.price || 0;
          updated.tax = pr.tax || 0; updated.unit = pr.unit || 'Nos';
        }
      }
      return updated;
    }));
  }
  function addItem() { setItems(prev => [...prev, { productId: '', product: '', description: '', hsn: '', specs: '', warranty: '', qty: 1, price: 0, tax: 0, unit: 'Nos', discount: 0 }]); }
  function removeItem(idx: number) { setItems(prev => prev.filter((_, i) => i !== idx)); }

  const save = useMutation({
    mutationFn: async (d: typeof FORM0) => {
      if (editId) {
        const { projectId, engineeringDesignId, ...quotationFields } = d;
        const payload = {
          ...quotationFields, items, subtotal, taxTotal,
          installationCharges: Number(d.installationCharges) || 0,
          transportCharges: Number(d.transportCharges) || 0,
          specialDiscount: Number(d.specialDiscount) || 0,
          discount: totalDiscount,
          total: grandTotal,
          createdBy: user.id,
        };
        // Lock-guarded update: a quotation that has been converted to an
        // Order (status 'Converted to Order' / convertedOrderId) can never
        // be edited, even through this legacy form path.
        await updateQuotation(editId, payload);
        await synchronizeQuotationProjectLink(editId, projectId, engineeringDesignId);
        return { ...payload, projectId, engineeringDesignId, id: editId };
      }
      return createQuotation({
        form: d, items, subtotal, taxTotal, totalDiscount, grandTotal,
        companyId: company.id, quotationPrefix: company.quotationPrefix, createdBy: user.id,
      });
    },
    onSuccess: (savedQuotation: any) => {
      qc.invalidateQueries({ queryKey: qkeys.quotationsRoot });
      qc.invalidateQueries({ queryKey: qkeys.projectsRoot });
      toast.success(editId ? 'Updated' : 'Quotation created');
      closeForm();
      // The retired popup used to open the created/updated quotation here;
      // project-linked quotations now open their Project Workspace (the
      // migration target), everything else opens the /quotations/:id page.
      if (savedQuotation?.id) {
        if (savedQuotation.projectId) navigate(`/projects/${encodeURIComponent(savedQuotation.projectId)}`);
        else navigate(`/quotations/${encodeURIComponent(savedQuotation.id)}`);
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteDocById(COLLECTIONS.QUOTATIONS, id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: qkeys.quotationsRoot }); toast.success('Deleted'); setDelId(null); setSelected(new Set()); },
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      await Promise.all(ids.map((id) => updateDocById(COLLECTIONS.QUOTATIONS, id, { status })));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkeys.quotationsRoot });
      toast.success(`Status updated for ${selected.size} quotations`);
      setShowBulkStatus(false);
      setBulkStatus('');
      setSelected(new Set());
    },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => deleteDocById(COLLECTIONS.QUOTATIONS, id)));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkeys.quotationsRoot });
      toast.success(`Deleted ${selected.size} quotations`);
      setSelected(new Set());
    },
    onError: (e: any) => toast.error(e.message),
  });

  useEffect(() => {
    const customer = (location.state as any)?.prefillCustomer;
    if (!customer) return;
    setForm({
      ...FORM0,
      customer: customer.name || customer.company || customer.companyName || '',
      customerId: customer.id || '',
      customerPhone: customer.phone || customer.businessPhone || '',
      customerEmail: customer.email || customer.businessEmail || '',
      customerAddress: customer.address || '',
      customerGst: customer.gst || '',
      customerState: customer.state || '',
      date: new Date().toISOString().split('T')[0],
    });
    setItems([]);
    setEditId(null);
    setOrderFetched(false);
    setShowForm(true);
    window.history.replaceState({}, document.title);
  }, [location.state]);

  useEffect(() => {
    if (createParam !== '1' || designScope) return;
    setForm({ ...FORM0, date: new Date().toISOString().split('T')[0] });
    setItems([]);
    setEditId(null);
    setOrderFetched(false);
    setShowForm(true);
  }, [createParam, designScope]);

  useEffect(() => {
    if (!designScope || appliedDesign.current === designScope) return;
    const design = engineeringDesigns.find((entry) => entry.id === designScope && entry.status === 'Approved');
    if (!design || !projects.length || !customers.length) return;
    setForm({ ...FORM0, date: new Date().toISOString().split('T')[0] });
    setEditId(null);
    selectEngineeringDesign(design.id);
    setShowForm(true);
    appliedDesign.current = designScope;
  }, [customers.length, designScope, engineeringDesigns, projects]);

  function closeForm() {
    setShowForm(false);
    setEditId(null);
    setForm({ ...FORM0 });
    setItems([]);
    setOrderFetched(false);
    if (createParam === '1') {
      const next = new URLSearchParams(searchParams);
      next.delete('create');
      setSearchParams(next, { replace: true });
    }
  }
  function openNew() { setForm({ ...FORM0, projectId: projectScope, date: new Date().toISOString().split('T')[0] }); setItems([]); setEditId(null); setOrderFetched(false); setShowForm(true); }
  function openEdit(q: any) {
    setForm({
      orderId: q.orderId || '', projectId: q.projectId || '', engineeringDesignId: q.engineeringDesignId || '', customer: q.customer || '', customerId: q.customerId || '',
      customerPhone: q.customerPhone || '', customerEmail: q.customerEmail || '',
      customerAddress: q.customerAddress || '', customerGst: q.customerGst || '', customerState: q.customerState || '',
      date: q.date?.split('T')[0] || '', validUntil: q.validUntil?.split('T')[0] || '',
      status: q.status || 'Draft', notes: q.notes || '', terms: q.terms || '',
      deliveryTimeline: q.deliveryTimeline || '',
      installationCharges: String(q.installationCharges || ''), transportCharges: String(q.transportCharges || ''),
      specialDiscount: String(q.specialDiscount || ''),
    });
    setItems(q.items || []); setEditId(q.id); setOrderFetched(true); setShowForm(true);
  }
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (save.isPending) return;
    if (!form.customer) return toast.error('Customer is required');
    if (!items.length) return toast.error('Add at least one item');
    save.mutate(form);
  }

  const quotationStats = useKPIStats(quotations, {
    statusField: 'status',
    statuses: [...QT_STATUSES, CONVERTED_STATUS],
  });

  const filtered = useMemo(() => quotations.filter((q: Quotation) => {
    const s = deferredSearch.toLowerCase();
    const activeStatus = activeKpi ? QUOTATION_KPI_STATUS[activeKpi] : null;
    return (!projectScope || String((q as any).projectId || '') === projectScope)
      && (!s || [q.id, q.customer, q.orderId].some((v: any) => String(v || '').toLowerCase().includes(s)))
      && (!statusF || q.status === statusF)
      && (!activeStatus || q.status === activeStatus);
  }), [quotations, search, statusF, activeKpi, projectScope]);
  // URL → form modal: the /quotations/:id detail page's Edit quick action
  // deep-links unlinked quotations here (?edit=:id) — the retired popup's
  // replacement. Opens the form modal in edit mode, then clears the param so
  // the modal is not re-opened on every render.
  const editParam = searchParams.get('edit') || '';
  useEffect(() => {
    if (!editParam || isLoading) return;
    const target = (quotations as any[]).find((quotation: any) => quotation.id === editParam);
    if (!target) return;
    openEdit(target);
    const next = new URLSearchParams(searchParams);
    next.delete('edit');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editParam, isLoading, quotations]);
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);
  const b2cOrders = orders.filter((o: any) => o.orderType !== 'B2B');
  const toggleSelect = useCallback((id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    }), []);
  const toggleAll = () =>
    setSelected((s) => s.size === paginated.length ? new Set() : new Set(paginated.map((q: any) => q.id)));
  const allSel = selected.size === paginated.length && paginated.length > 0;
  /** Row click / View — the retired popup's replacement: project-linked
   * quotations open their Project Workspace (Stage 3 — Quotation workspace,
   * the migration target); unlinked quotations open the /quotations/:id
   * detail page. Same pattern Surveys.tsx's openSurveyWorkspace() uses. */
  function openQuotationDetails(q: any) {
    if (q?.projectId) {
      navigate(`/projects/${encodeURIComponent(q.projectId)}`);
      return;
    }
    if (q?.id) navigate(`/quotations/${encodeURIComponent(q.id)}`);
  }
  function handleRowClick(e: React.MouseEvent<HTMLTableRowElement>, quotation: any) {
    if (isRowOpenIgnored(e.target)) return;
    openQuotationDetails(quotation);
  }
  function handleRowKeyDown(e: React.KeyboardEvent<HTMLTableRowElement>, quotation: any) {
    if (isRowOpenIgnored(e.target)) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    openQuotationDetails(quotation);
  }
  function exportSelected() {
    const rows = (quotations as any[]).filter((q) => selected.has(q.id));
    if (!rows.length) return toast.error('No quotations selected');
    downloadQuotationsCsv(rows, `quotations-export-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  // ── Total KPI active by default when no filters are set
  const isTotalDefault = useMemo(() => {
    return !activeKpi && !search && !statusF;
  }, [activeKpi, search, statusF]);

  // ── Active filter count for Clear All display
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (search) count++;
    if (statusF) count++;
    if (activeKpi) count++;
    return count;
  }, [search, statusF, activeKpi]);

  const KPI_TILES = [
    { label: 'TOTAL', value: quotationStats.total, key: '', icon: <ClipboardList className="h-4 w-4" />, description: `${quotationStats.total} total quotations` },
    { label: 'DRAFT', value: quotationStats.byStatus.draft || 0, key: 'draft', icon: <FileText className="h-4 w-4" />, description: 'Draft quotations' },
    { label: 'SENT', value: quotationStats.byStatus.sent || 0, key: 'sent', icon: <Send className="h-4 w-4" />, description: 'Sent to customer' },
    { label: 'APPROVED', value: quotationStats.byStatus.accepted || 0, key: 'approved', icon: <CheckCircle2 className="h-4 w-4" />, description: 'Accepted by customer' },
    { label: 'REJECTED', value: quotationStats.byStatus.rejected || 0, key: 'rejected', icon: <AlertTriangle className="h-4 w-4" />, description: 'Rejected quotations' },
    { label: 'EXPIRED', value: quotationStats.byStatus.expired || 0, key: 'expired', icon: <Target className="h-4 w-4" />, description: 'Expired quotations' },
  ];

  function handleStatusChange(v: string) {
    setStatusF(v);
    const kpiStatusMap: Record<string, string> = { draft: 'Draft', sent: 'Sent', approved: 'Accepted', rejected: 'Rejected', expired: 'Expired' };
    if (v && activeKpi && kpiStatusMap[activeKpi] && v !== kpiStatusMap[activeKpi]) {
      setActiveKpi('');
      setPage(1);
      syncQueueParams({ status: v, kpi: '', page: 1 });
    } else {
      setPage(1);
      syncQueueParams({ status: v, page: 1 });
    }
  }

  function clearAll() {
    setSearch(''); setStatusF(''); setActiveKpi(''); setPage(1);
    syncQueueParams({ q: '', status: '', kpi: '', page: 1 });
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      {/* ── Premium Workspace Hero ─────────────────────────── */}
      <WorkspaceHero
        title="Quotations"
        icon={<ClipboardList className="h-6 w-6" />}
        breadcrumbs={['Home', 'Sales', 'Quotations']}
        statusText="Last sync · Realtime Connected"
        statusDotColor="var(--color-success)"
        className="gap-3"
        actions={
          <>
            <Button variant="outline" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => refetch()}>
              Refresh
            </Button>
            {canDo('create', 'quotations') && (
              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openNew}>
                New Quotation
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
              syncQueueParams({ kpi: nextKpi, page: 1 });
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
              aria-label="Search quotations"
              placeholder="Search ID, order, customer…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); syncQueueParams({ q: e.target.value, page: 1 }); }}
              className="min-w-[160px] flex-1 h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]"
            />
            <Select
              aria-label="Status"
              value={statusF}
              onChange={(e) => handleStatusChange(e.target.value)}
              options={[
                { label: 'All Status', value: '' },
                ...QT_STATUSES.map(s => ({ label: s, value: s })),
              ]}
              className="w-[110px] h-8 py-1"
            />
            {/* Active filter pills + Clear All */}
            {activeFilterCount > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {activeKpi && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary-light)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-primary-text)]">
                    {KPI_TILES.find(t => t.key === activeKpi)?.label || activeKpi}
                    <button type="button" onClick={() => { setActiveKpi(''); setPage(1); syncQueueParams({ kpi: '', page: 1 }); }} className="ml-0.5 hover:opacity-70"><X className="h-2.5 w-2.5" /></button>
                  </span>
                )}
                {search && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">S: {search.slice(0, 12)}{search.length > 12 ? '…' : ''}</span>
                )}
                {statusF && !activeKpi && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">{statusF}</span>
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
              {selected.size} quotation{selected.size > 1 ? 's' : ''} selected
            </span>
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <Button size="sm" variant="outline"
                icon={<Download className="h-3.5 w-3.5" />}
                onClick={exportSelected}
                className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30">
                Export CSV
              </Button>
              {canDo('edit', 'quotations') && (
                <Button size="sm" variant="outline"
                  icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                  onClick={() => setShowBulkStatus(true)}
                  className="text-indigo-600 border-indigo-300 hover:bg-indigo-50 dark:border-indigo-700 dark:hover:bg-indigo-900/30">
                  Change Status
                </Button>
              )}
              {canDo('delete', 'quotations') && (
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
                  <UniversalCheckbox checked={allSel} indeterminate={selected.size > 0 && !allSel} onChange={toggleAll} ariaLabel="Select visible quotations" />
                </Th>
                <Th style={{ width: '15%', minWidth: 100 }}>QUOTATION</Th>
                <Th style={{ width: '10%', minWidth: 90 }}>ORDER</Th>
                <Th style={{ width: '20%', minWidth: 150 }}>CUSTOMER</Th>
                <Th style={{ width: 90, minWidth: 90 }}>DATE</Th>
                <Th className="hidden md:table-cell" style={{ width: 90, minWidth: 90 }}>VALID</Th>
                <Th style={{ width: 70, minWidth: 70 }}>ITEMS</Th>
                <Th style={{ width: 110, minWidth: 110 }}>TOTAL</Th>
                <Th style={{ width: 110, minWidth: 110 }}>STATUS</Th>
                <Th align="right" style={{ width: 130, minWidth: 130 }}>ACTIONS</Th>
              </Thead>
              <Tbody>
                {isLoading
                  ? <SkeletonRows cols={10} />
                  : paginated.length === 0
                    ? (
                      <tr>
                        <td colSpan={10} className="py-14 text-center">
                          <EmptyState
                            icon={<ClipboardList className="h-9 w-9" />}
                            title={search || statusF ? 'No quotations match filters' : 'No quotations yet'}
                            description={search || statusF ? undefined : 'Create your first quotation to get started.'}
                            action={!search && !statusF && canDo('create', 'quotations') ? (
                              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openNew} className="mt-2">Create Your First Quotation</Button>
                            ) : undefined}
                          />
                        </td>
                      </tr>
                    )
                    : paginated.map((q: any) => (
                      <Tr key={q.id} selected={selected.has(q.id)}
                        data-record-id={q.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`Open quotation ${quotationDisplayNumber(q)}`}
                        onClick={(e) => handleRowClick(e, q)}
                        onKeyDown={(e) => handleRowKeyDown(e, q)}
                        className="transition-colors duration-150"
                      >
                        {/* Checkbox */}
                        <Td className="py-3" onClick={(e) => e.stopPropagation()}>
                          <UniversalCheckbox checked={selected.has(q.id)} onChange={() => toggleSelect(q.id)} ariaLabel={`Select ${quotationDisplayNumber(q)}`} />
                        </Td>

                        {/* Quotation Number */}
                        <Td className="py-3">
                          <span className="font-mono text-xs font-semibold text-[var(--color-primary-text)]">{quotationDisplayNumber(q)}</span>
                        </Td>

                        {/* Order */}
                        <Td className="py-3 text-xs text-[var(--color-text-muted)] font-mono">{orderNumberById.get(String(q.orderId)) || '—'}</Td>

                        {/* Customer */}
                        <Td className="py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-7 w-7 shrink-0 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary-text)] flex items-center justify-center text-[11px] font-bold">
                              {(q.customer || '?')[0].toUpperCase()}
                            </div>
                            <span className="text-sm font-medium text-[var(--color-text)] leading-tight">{q.customer || '—'}</span>
                          </div>
                        </Td>

                        {/* Date */}
                        <Td className="py-3 text-xs text-[var(--color-text-secondary)]">{fmtDate(q.date) || '—'}</Td>

                        {/* Valid Until */}
                        <Td className="hidden md:table-cell py-3 text-xs text-[var(--color-text-muted)]">{fmtDate(q.validUntil) || '—'}</Td>

                        {/* Items */}
                        <Td className="py-3 text-xs">{(q.items || []).length} items</Td>

                        {/* Total */}
                        <Td className="py-3 text-sm font-semibold text-[var(--color-text)]">{fmtCurrency(q.total || 0, company.currencySymbol)}</Td>

                        {/* Status */}
                        <Td className="py-3"><span data-interactive onClick={(e) => e.stopPropagation()}>{statusBadge(q.status || 'Draft')}</span></Td>

                        {/* Actions */}
                        <Td className="py-3" align="right"><QuotationActionStrip onView={() => openQuotationDetails(q)} /></Td>
                      </Tr>
                    ))
                }
              </Tbody>
            </Table>
          </div>
          {/* ── Premium Pagination (inside table block) ────── */}
          <div className="shrink-0 border-t border-[var(--color-border-subtle)]">
            <Pagination
              page={page}
              total={filtered.length}
              perPage={perPage}
              onChange={(nextPage) => { setPage(nextPage); syncQueueParams({ page: nextPage }); }}
              onPerPageChange={n => { setPerPage(n); setPage(1); syncQueueParams({ perPage: n, page: 1 }); }}
            />
          </div>
        </div>
      </Card>

      {/* ─── FORM MODAL ─── */}
      <Modal open={showForm} onClose={closeForm} title={editId ? `Edit Quotation: ${editId}` : 'New Quotation'} size="2xl">
        <form onSubmit={handleSubmit} className="space-y-5">

          <FormSection title="Link to Project">
            <FormRow>
              <Select
                label="Project (optional)"
                value={form.projectId}
                onChange={event => selectProject(event.target.value)}
                options={[{ label: 'Not linked', value: '' }, ...projects.map(project => ({ label: `${project.projectId} · ${project.currentStage}`, value: project.id }))]}
              />
              <Select
                label="Approved Engineering Design (optional)"
                value={form.engineeringDesignId}
                onChange={event => selectEngineeringDesign(event.target.value)}
                disabled={!form.projectId}
                options={[{ label: 'No engineering prefill', value: '' }, ...engineeringDesigns
                  .filter(design => design.status === 'Approved' && design.projectId === form.projectId)
                  .map(design => ({ label: `${design.designId} · ${design.systemCapacityKw} kW`, value: design.id }))]}
              />
            </FormRow>
            <p className="text-xs text-muted">Approved engineering data creates editable, zero-priced module and inverter lines. Sales must select products and confirm commercial pricing.</p>
          </FormSection>

          <FormSection title="Step 1 — Link to Order (Auto-Fill)">
            <div className="relative">
              <select
                value={form.orderId}
                onChange={e => handleOrderSelect(e.target.value)}
                disabled={!!editId}
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] pr-10"
              >
                <option value="">— Select Order to auto-populate (optional) —</option>
                {b2cOrders.map((o: any) => (
                  <option key={o.id} value={o.id}>{o.id} — {o.customer} ({fmtCurrency(o.total, company.currencySymbol)})</option>
                ))}
              </select>
              {loadingOrder && <div className="absolute right-3 top-2.5"><Loader2 className="h-4 w-4 animate-spin text-indigo-500" /></div>}
            </div>
            {orderFetched && (
              <div className="flex items-center gap-2 text-xs text-emerald-600 font-medium mt-1">
                <CheckCircle2 className="h-4 w-4" /> Customer details and products auto-populated from order
              </div>
            )}
            <p className="text-xs text-muted mt-1">Selecting an order auto-fills customer info and product items. You can also fill manually below.</p>
          </FormSection>

          <FormSection title="Step 2 — Customer Details">
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-3">
                <User className="h-4 w-4 text-blue-500" />
                <span className="text-xs font-semibold text-blue-700 uppercase">Customer Information</span>
                {orderFetched && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Auto-filled</span>}
              </div>
              <FormRow>
                <Input label="Customer Name *" value={form.customer} onChange={e => setForm({ ...form, customer: e.target.value })} required />
                <Input label="Phone" value={form.customerPhone} onChange={e => setForm({ ...form, customerPhone: e.target.value })} />
              </FormRow>
              <FormRow>
                <Input label="Email" value={form.customerEmail} onChange={e => setForm({ ...form, customerEmail: e.target.value })} />
                <Input label="GSTIN" value={form.customerGst} onChange={e => setForm({ ...form, customerGst: e.target.value })} />
              </FormRow>
              <Input label="Billing / Site Address" value={form.customerAddress} onChange={e => setForm({ ...form, customerAddress: e.target.value })} />
            </div>
          </FormSection>

          <FormSection title="Quotation Details">
            <FormRow>
              <Select label="Status" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} options={QT_STATUSES.map(s => ({ label: s, value: s }))} />
              <Input label="Quotation Date" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
            </FormRow>
            <FormRow>
              <Input label="Valid Until" type="date" value={form.validUntil} onChange={e => setForm({ ...form, validUntil: e.target.value })} />
              <Input label="Delivery Timeline" placeholder="e.g. 7-10 working days after advance" value={form.deliveryTimeline} onChange={e => setForm({ ...form, deliveryTimeline: e.target.value })} />
            </FormRow>
          </FormSection>

          <FormSection title="Step 3 — Products / Items">
            <div className="flex items-center gap-2 mb-2">
              <Package className="h-4 w-4 text-indigo-500" />
              <span className="text-xs font-semibold text-indigo-700 uppercase">Line Items</span>
              {orderFetched && items.length > 0 && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">{items.length} items auto-loaded</span>}
            </div>
            <QuotationItemsEditor
              items={items}
              products={products}
              currencySymbol={company.currencySymbol}
              subtotal={subtotal}
              taxTotal={taxTotal}
              installationCharges={Number(form.installationCharges) || 0}
              transportCharges={Number(form.transportCharges) || 0}
              specialDiscount={Number(form.specialDiscount) || 0}
              grandTotal={grandTotal}
              onAddItem={addItem}
              onRemoveItem={removeItem}
              onUpdateItem={updateItem}
            />
          </FormSection>

          <FormSection title="Additional Charges & Discounts">
            <FormRow>
              <Input label="Installation Charges (₹)" type="number" min="0" value={form.installationCharges} onChange={e => setForm({ ...form, installationCharges: e.target.value })} placeholder="0" />
              <Input label="Transport Charges (₹)" type="number" min="0" value={form.transportCharges} onChange={e => setForm({ ...form, transportCharges: e.target.value })} placeholder="0" />
            </FormRow>
            <Input label="Special Discount (₹)" type="number" min="0" value={form.specialDiscount} onChange={e => setForm({ ...form, specialDiscount: e.target.value })} placeholder="0" />
          </FormSection>

          <FormSection title="Notes & Terms">
            <Textarea label="Notes / Remarks" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Additional notes for the customer..." />
            <Textarea label="Payment Terms & Conditions" value={form.terms} onChange={e => setForm({ ...form, terms: e.target.value })} placeholder="65% advance on order... 30% before dispatch... 5% on commissioning..." />
          </FormSection>

          <div className={"flex justify-end gap-2 pt-2"}>
            <Button variant="outline" type="button" onClick={closeForm}>Cancel</Button>
            <Button type="submit" loading={save.isPending} icon={<FileText className="h-4 w-4" />}>
              {editId ? 'Update Quotation' : 'Create Quotation'}
            </Button>
          </div>
          
        </form>
      </Modal>

      <Modal open={showBulkStatus} onClose={() => { setShowBulkStatus(false); setBulkStatus(''); }} title="Change Status" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            Changing status for <span className="font-semibold text-[var(--color-text)]">{selected.size} quotation{selected.size > 1 ? 's' : ''}</span>.
          </p>
          <Select
            label="New Status"
            value={bulkStatus}
            onChange={e => setBulkStatus(e.target.value)}
            options={[{ label: 'Select Status...', value: '' }, ...QT_STATUSES.map(s => ({ label: s, value: s }))]}
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
              Update {selected.size} Quotations
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!delId}
        onClose={() => setDelId(null)}
        onConfirm={() => delId && del.mutate(delId)}
        loading={del.isPending}
        title="Delete Quotation"
        message="Permanently delete this quotation?"
      />
    </div>
  );
}
