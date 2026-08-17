import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Building2, Plus, Trash2, RefreshCw,
  Download, Users, ListChecks, Eye, Search,
  Activity, User, CreditCard, XCircle, CheckCircle2, Calendar,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { fmtDate } from '../lib/firestore';
import { isInDateRange } from '../lib/dateFilters';
import { usePermissions } from '../lib/permissions';
import {
  WorkspaceHero, PremiumKpi, Select as UiSelect, Pagination,
  Table, Thead, Th, Tbody, Tr, Td, UniversalCheckbox, SkeletonRows, EmptyState, ConfirmDialog,
} from '../components/ui';
import { Card, CardHeader } from '../components/ui/Card';

import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { VendorForm } from '../features/procurement/components/VendorForm';
import { useVendorActions, useVendors } from '../features/procurement/hooks/useVendors';
import { VENDOR_FORM_DEFAULT, type VendorFormValues, type VendorRecord } from '../features/procurement/types';
import { VendorDetailModal } from '../features/procurement/components/VendorDetailModal';
import { VendorWorkspaceDialogs } from '../features/procurement/components/VendorWorkspaceDialogs';

const PER_PAGE = 10;

function formFromVendor(vendor: VendorRecord): VendorFormValues {
  return {
    name: vendor.name, gstin: vendor.gstin || '',
    contactPerson: vendor.contactInfo?.contactPerson || '',
    phone: vendor.contactInfo?.phone || '',
    email: vendor.contactInfo?.email || '',
    address: vendor.contactInfo?.address || '',
    paymentTerms: vendor.paymentTerms || '',
    categoryTags: (vendor.categoryTags || []).join(', '),
  };
}

function toDateValue(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function formatCreatedDate(value: any): string {
  const date = toDateValue(value);
  if (!date) return '';
  return date.toLocaleDateString('en-GB');
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
  return Boolean(target.closest('button,a,input,select,textarea,[data-action],[data-interactive]'));
}

function downloadVendorsCsv(rows: VendorRecord[], filename: string) {
  const headers = ['Vendor Code', 'Name', 'GSTIN', 'Contact Person', 'Phone', 'Email', 'Payment Terms', 'Categories', 'Created Date'];
  const lines = rows.map(v =>
    [v.vendorId || '', v.name || '', v.gstin || '',
     v.contactInfo?.contactPerson || '', v.contactInfo?.phone || '', v.contactInfo?.email || '',
     v.paymentTerms || '', (v.categoryTags || []).join('; '),
     fmtDate(v.createdAt) || '',
    ].map(val => `"${String(val).replace(/"/g, '""')}"`).join(',')
  );
  const csv = [headers.join(','), ...lines].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function Vendors() {
  const perms = usePermissions();
  const { data: vendors = [], isLoading, refetch } = useVendors();
  const actions = useVendorActions();

  const [searchParams, setSearchParams] = useSearchParams();
  const createParam = searchParams.get('create') || '';

  // ── Filters
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [statusF, setStatusF] = useState(() => searchParams.get('status') || '');
  const [categoryF, setCategoryF] = useState(() => searchParams.get('category') || '');
  const [assignF, setAssignF] = useState(() => searchParams.get('owner') || '');
  const [dateRange, setDateRange] = useState(() => searchParams.get('date') || 'all');
  const [customFrom, setCustomFrom] = useState(() => searchParams.get('from') || '');
  const [customTo, setCustomTo] = useState(() => searchParams.get('to') || '');
  const [activeKpi, setActiveKpi] = useState(() => searchParams.get('kpi') || '');

  // ── Table
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [perPage, setPerPage] = useState(() => Math.max(1, Number(searchParams.get('perPage')) || PER_PAGE));
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ── Form
  const [showForm, setShowForm] = useState(createParam === '1');
  const [editing, setEditing] = useState<VendorRecord | null>(null);
  const [form, setForm] = useState<VendorFormValues>({ ...VENDOR_FORM_DEFAULT });

  // ── View / delete
  const [viewItem, setViewItem] = useState<VendorRecord | null>(null);
  const [delId, setDelId] = useState<string | null>(null);

  // ── Bulk operations
  const [showBulkStatus, setShowBulkStatus] = useState(false);
  const [showBulkAssign, setShowBulkAssign] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkAssignName, setBulkAssignName] = useState('');

  function syncQueueParams(nextState: {
    q?: string; status?: string; category?: string; owner?: string;
    date?: string; from?: string; to?: string; kpi?: string; page?: number; perPage?: number;
  }) {
    const next = new URLSearchParams(searchParams);
    const q = nextState.q ?? search;
    const status = nextState.status ?? statusF;
    const category = nextState.category ?? categoryF;
    const owner = nextState.owner ?? assignF;
    const date = nextState.date ?? dateRange;
    const from = nextState.from ?? customFrom;
    const to = nextState.to ?? customTo;
    const kpi = nextState.kpi ?? activeKpi;
    const nextPage = nextState.page ?? page;
    const nextPerPage = nextState.perPage ?? perPage;

    if (q) next.set('q', q); else next.delete('q');
    if (status) next.set('status', status); else next.delete('status');
    if (category) next.set('category', category); else next.delete('category');
    if (owner) next.set('owner', owner); else next.delete('owner');
    if (date && date !== 'all') next.set('date', date); else next.delete('date');
    if (from) next.set('from', from); else next.delete('from');
    if (to) next.set('to', to); else next.delete('to');
    if (kpi) next.set('kpi', kpi); else next.delete('kpi');
    if (nextPage > 1) next.set('page', String(nextPage)); else next.delete('page');
    if (nextPerPage !== PER_PAGE) next.set('perPage', String(nextPerPage)); else next.delete('perPage');
    setSearchParams(next, { replace: true });
  }

  // Bulk status change
  const bulkStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      // Placeholder — vendor records don't have a direct status field
      toast.success(`Status update for ${ids.length} vendors coming soon`);
    },
    onSuccess: () => { setShowBulkStatus(false); setBulkStatus(''); setSelected(new Set()); },
    onError: (e: any) => toast.error(e.message),
  });

  // Bulk assign (sets contact person name as pseudo-assignee)
  const bulkAssignMutation = useMutation({
    mutationFn: async ({ ids, assigneeName }: { ids: string[]; assigneeName: string }) => {
      toast.success(`Assigning ${ids.length} vendors to ${assigneeName} coming soon`);
    },
    onSuccess: () => { setShowBulkAssign(false); setBulkAssignName(''); setSelected(new Set()); },
    onError: (e: any) => toast.error(e.message),
  });

  // ── Helpers
  useEffect(() => {
    if (createParam !== '1') return;
    setForm({ ...VENDOR_FORM_DEFAULT });
    setEditing(null);
    setShowForm(true);
  }, [createParam]);

  function closeForm() {
    setShowForm(false);
    setEditing(null);
    setForm({ ...VENDOR_FORM_DEFAULT });
    if (createParam === '1') {
      const next = new URLSearchParams(searchParams);
      next.delete('create');
      setSearchParams(next, { replace: true });
    }
  }

  function openEdit(v: VendorRecord) {
    setViewItem(null);
    setEditing(v);
    setForm(formFromVendor(v));
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (actions.create.isPending || actions.update.isPending) return;
    if (!form.name) return toast.error('Vendor name is required');
    const promise = editing
      ? actions.update.mutateAsync({ id: editing.id, input: form })
      : actions.create.mutateAsync(form);
    promise.then(closeForm).catch(() => {});
  }

  // ── Filtering + sorting
  const categories = useMemo(() =>
    Array.from(new Set((vendors as VendorRecord[]).flatMap(v => v.categoryTags || []))).sort(),
    [vendors]);

  const filtered = useMemo(() => {
    let list = [...(vendors as VendorRecord[])];

    // KPI filter
    if (activeKpi) {
      if (activeKpi === 'active') list = list.filter(v => !v.isDeleted);
      else if (activeKpi === 'inactive') list = list.filter(v => v.isDeleted);
      else if (activeKpi === 'with-gstin') list = list.filter(v => v.gstin);
      else if (activeKpi === 'without-gstin') list = list.filter(v => !v.gstin);
      else if (activeKpi === 'this-month') {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        list = list.filter(v => v.createdAt && v.createdAt >= monthStart);
      }
    }

    // Search
    const q = search.toLowerCase();
    if (q) list = list.filter(v =>
      [v.name, v.vendorId, v.gstin, v.contactInfo?.contactPerson, v.contactInfo?.phone, v.contactInfo?.email]
        .some(val => String(val || '').toLowerCase().includes(q))
    );

    // Filters
    if (statusF) {
      list = list.filter(v =>
        statusF === 'active' ? !v.isDeleted : statusF === 'inactive' ? !!v.isDeleted : true
      );
    }
    if (categoryF) list = list.filter(v => v.categoryTags?.includes(categoryF));
    if (assignF) list = list.filter(v => v.contactInfo?.contactPerson === assignF || v.createdBy === assignF);

    // Date range
    if (dateRange !== 'all') list = list.filter(v => isInDateRange(v.createdAt, dateRange as any, customFrom, customTo));

    return list;
  }, [vendors, search, statusF, categoryF, assignF, dateRange, customFrom, customTo, activeKpi]);

  const paginated = useMemo(() => {
    const start = (page - 1) * perPage;
    return filtered.slice(start, start + perPage);
  }, [filtered, page, perPage]);

  const stats = useMemo(() => ({
    total: (vendors as VendorRecord[]).length,
    active: (vendors as VendorRecord[]).filter(v => !v.isDeleted).length,
    inactive: (vendors as VendorRecord[]).filter(v => !!v.isDeleted).length,
    withGstin: (vendors as VendorRecord[]).filter(v => v.gstin).length,
    withoutGstin: (vendors as VendorRecord[]).filter(v => !v.gstin).length,
    thisMonth: (vendors as VendorRecord[]).filter(v => {
      if (!v.createdAt) return false;
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      return new Date(v.createdAt) >= monthStart;
    }).length,
  }), [vendors]);

  const toggleSelect = useCallback((id: string) =>
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);
  const toggleAll = () =>
    setSelected(s => s.size === paginated.length ? new Set() : new Set(paginated.map(v => v.id)));
  const allSel = selected.size === paginated.length && paginated.length > 0;

  // ── View detail
  const userClosedRef = useRef(false);
  const openParam = searchParams.get('open') || '';

  const closeVendorDetails = useCallback(() => {
    userClosedRef.current = true;
    setViewItem(null);
    if (!openParam) return;
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    setSearchParams(next, { replace: true });
  }, [openParam, searchParams, setSearchParams]);

  const openVendorDetails = useCallback((v: VendorRecord, replace = false) => {
    userClosedRef.current = false;
    setViewItem(v);
    if (!v?.id) return;
    const next = new URLSearchParams(searchParams);
    next.set('open', v.id);
    if (search) next.set('q', search); else next.delete('q');
    if (statusF) next.set('status', statusF); else next.delete('status');
    if (categoryF) next.set('category', categoryF); else next.delete('category');
    if (assignF) next.set('owner', assignF); else next.delete('owner');
    if (dateRange && dateRange !== 'all') next.set('date', dateRange); else next.delete('date');
    if (customFrom) next.set('from', customFrom); else next.delete('from');
    if (customTo) next.set('to', customTo); else next.delete('to');
    if (activeKpi) next.set('kpi', activeKpi); else next.delete('kpi');
    if (page > 1) next.set('page', String(page)); else next.delete('page');
    if (perPage !== PER_PAGE) next.set('perPage', String(perPage)); else next.delete('perPage');
    setSearchParams(next, { replace });
  }, [activeKpi, assignF, categoryF, customFrom, customTo, dateRange, page, perPage, search, searchParams, setSearchParams, statusF]);

  useEffect(() => {
    if (userClosedRef.current) {
      userClosedRef.current = false;
      return;
    }
    const openId = openParam;
    if (!openId || isLoading) return;
    const target = (vendors as VendorRecord[]).find(v => v.id === openId);
    if (!target) return;
    setViewItem(target);
    window.setTimeout(() => document.querySelector(`[data-record-id="${CSS.escape(openId)}"]`)?.scrollIntoView({ block: 'center' }), 0);
  }, [openParam, isLoading, vendors]);

  function handleRowClick(e: React.MouseEvent<HTMLTableRowElement>, v: VendorRecord) {
    if (window.getSelection()?.toString()) return;
    if (isRowOpenIgnored(e.target)) return;
    openVendorDetails(v);
  }

  function handleRowKeyDown(e: React.KeyboardEvent<HTMLTableRowElement>, v: VendorRecord) {
    if (isRowOpenIgnored(e.target)) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    openVendorDetails(v);
  }

  function clearAll() {
    setSearch(''); setStatusF(''); setCategoryF(''); setAssignF('');
    setDateRange('all'); setCustomFrom(''); setCustomTo(''); setActiveKpi(''); setPage(1);
    syncQueueParams({ q: '', status: '', category: '', owner: '', date: 'all', from: '', to: '', kpi: '', page: 1 });
  }

  const DATE_OPTIONS = [
    { label: 'All dates', value: 'all' },
    { label: 'Today', value: 'today' },
    { label: 'This Week', value: 'this_week' },
    { label: 'This Month', value: 'this_month' },
    { label: 'Custom', value: 'custom' },
  ];

  function handleDateChange(newDateRange: string) {
    setDateRange(newDateRange);
    setPage(1);
    if (newDateRange !== 'custom') { setCustomFrom(''); setCustomTo(''); }
    syncQueueParams({ date: newDateRange, from: '', to: '', page: 1 });
  }

  const categoryOptions = [
    { label: 'All Categories', value: '' },
    ...categories.map(c => ({ label: c, value: c })),
  ];

  const assignOptions = [
    { label: 'All Contacts', value: '' },
    ...Array.from(new Set((vendors as VendorRecord[]).map(v => v.contactInfo?.contactPerson).filter(Boolean))).sort().map(name => ({ label: name, value: name })),
  ];

  const isTotalDefault = !activeKpi && !search && !statusF && !categoryF && !assignF && dateRange === 'all';
  const activeFilterCount = [search ? 'search' : '', statusF ? statusF : '', categoryF ? 'category' : '', assignF ? 'assigned' : '', activeKpi ? activeKpi : '', dateRange !== 'all' ? dateRange : ''].filter(Boolean).length;

  const KPI_TILES = useMemo(() => [
    { key: '', label: 'TOTAL', value: stats.total, icon: <Building2 className="h-4 w-4" />, desc: `${stats.active} active` },
    { key: 'active', label: 'ACTIVE', value: stats.active, icon: <Activity className="h-4 w-4" />, desc: 'Currently active' },
    { key: 'with-gstin', label: 'WITH GSTIN', value: stats.withGstin, icon: <CreditCard className="h-4 w-4" />, desc: 'GST registered' },
    { key: 'without-gstin', label: 'NO GSTIN', value: stats.withoutGstin, icon: <XCircle className="h-4 w-4" />, desc: 'Without GST' },
    { key: 'inactive', label: 'INACTIVE', value: stats.inactive, icon: <User className="h-4 w-4" />, desc: 'Not active' },
    { key: 'this-month', label: 'NEW THIS MONTH', value: stats.thisMonth, icon: <Calendar className="h-4 w-4" />, desc: 'Created this month' },
  ], [stats]);

  function exportSelected() {
    const rows = (vendors as VendorRecord[]).filter(v => selected.has(v.id));
    if (!rows.length) return toast.error('No vendors selected');
    downloadVendorsCsv(rows, `vendors-export-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${rows.length} vendor${rows.length > 1 ? 's' : ''}`);
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      {/* WORKSPACE HERO */}
      <WorkspaceHero className="gap-3" icon={<Building2 className="h-4 w-4" />}
        breadcrumbs={['Home', 'Procurement', 'Vendors']} title="Vendors"
        statusText="Procurement" statusDotColor="bg-[var(--color-success)]"
        actions={
          <>
            <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => refetch()}>Refresh</Button>
            {perms.canCreate('vendors') && (
              <Button size="sm" data-tour="vendors-create" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => { setForm({ ...VENDOR_FORM_DEFAULT }); setEditing(null); setShowForm(true); }}>
                Add vendor
              </Button>
            )}
          </>
        }
      />

      {/* KPI GRID */}
      <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-6">
        {KPI_TILES.map(k => (
          <PremiumKpi key={k.key || 'total'} label={k.label} value={k.value} icon={k.icon} description={k.desc}
            active={k.key === '' ? (activeKpi === '' || isTotalDefault) : activeKpi === k.key}
            onClick={() => {
              const nextKpi = activeKpi === k.key ? '' : k.key;
              if (k.key === '' && isTotalDefault) return;
              setActiveKpi(nextKpi);
              setPage(1);
              syncQueueParams({ kpi: nextKpi, page: 1 });
            }}
          />
        ))}
      </div>

      {/* MAIN CARD */}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.04)]">
        {/* SEARCH + FILTERS */}
        <CardHeader className="flex flex-wrap items-center gap-2 px-6 py-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <div className="relative min-w-[160px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input className="h-8 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-8 pr-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                data-tour="vendors-search"
                placeholder="Search name, code, GSTIN, phone..." value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); syncQueueParams({ q: e.target.value, page: 1 }); }}
              />
            </div>
            <UiSelect value={dateRange} onChange={(e) => handleDateChange(e.target.value)} options={DATE_OPTIONS} className="h-8 min-w-[110px] py-1" />
            {dateRange === 'custom' && (
              <div className="flex items-center gap-1.5">
                <input type="date" value={customFrom} onChange={(e) => { setCustomFrom(e.target.value); setPage(1); syncQueueParams({ from: e.target.value, date: 'custom', page: 1 }); }}
                  className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                <span className="text-[10px] text-[var(--color-text-muted)]">to</span>
                <input type="date" value={customTo} onChange={(e) => { setCustomTo(e.target.value); setPage(1); syncQueueParams({ to: e.target.value, date: 'custom', page: 1 }); }}
                  className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
              </div>
            )}
            <UiSelect value={statusF} onChange={(e) => {
              const v = e.target.value;
              setStatusF(v);
              if (v && activeKpi && v !== activeKpi) {
                setActiveKpi('');
                setPage(1);
                syncQueueParams({ status: v, kpi: '', page: 1 });
              } else {
                setPage(1);
                syncQueueParams({ status: v, page: 1 });
              }
            }} options={[{ label: 'All Status', value: '' }, { label: 'Active', value: 'active' }, { label: 'Inactive', value: 'inactive' }]} className="h-8 min-w-[110px] py-1" />
            <UiSelect value={categoryF} onChange={(e) => { setCategoryF(e.target.value); setPage(1); syncQueueParams({ category: e.target.value, page: 1 }); }} options={categoryOptions} className="h-8 min-w-[120px] py-1" />
            <UiSelect value={assignF} onChange={(e) => { setAssignF(e.target.value); setPage(1); syncQueueParams({ owner: e.target.value, page: 1 }); }} options={assignOptions} className="h-8 min-w-[120px] py-1" />
            {activeFilterCount > 0 && (
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="h-4 w-px bg-[var(--color-border)]" />
                <span className="text-xs text-[var(--color-text-muted)]">{activeFilterCount} active</span>
                <button onClick={clearAll} className="text-xs font-medium text-[var(--color-primary-text)] hover:underline">Clear All</button>
              </div>
            )}
          </div>
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />{filtered.length} vendor{filtered.length !== 1 ? 's' : ''}
          </span>
        </CardHeader>

        {/* BULK ACTION BAR */}
        {selected.size > 0 && (
          <div className="flex items-center gap-3 border-b border-[var(--color-primary-muted)] bg-[var(--color-primary-light)] px-6 py-2.5">
            <span className="text-sm font-semibold text-[var(--color-primary-text)]">
              {selected.size} vendor{selected.size > 1 ? 's' : ''} selected
            </span>
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="outline"
                icon={<Download className="h-3.5 w-3.5" />}
                onClick={exportSelected}
                className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30">
                Export CSV
              </Button>
              {perms.canEdit('vendors') && (
                <Button size="sm" variant="outline"
                  icon={<ListChecks className="h-3.5 w-3.5" />}
                  onClick={() => setShowBulkStatus(true)}
                  className="text-indigo-600 border-indigo-300 hover:bg-indigo-50 dark:border-indigo-700 dark:hover:bg-indigo-900/30">
                  Change Status
                </Button>
              )}
              {perms.canEdit('vendors') && (
                <Button size="sm" variant="outline"
                  icon={<Users className="h-3.5 w-3.5" />}
                  onClick={() => setShowBulkAssign(true)}
                  className="text-purple-600 border-purple-300 hover:bg-purple-50 dark:border-purple-700 dark:hover:bg-purple-900/30">
                  Assign
                </Button>
              )}
              {perms.canDelete('vendors') && (
                <Button size="sm" variant="outline"
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  onClick={() => setDelId('__bulk__')}
                  className="text-red-600 border-red-300 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/30">
                  Delete
                </Button>
              )}
              <button onClick={() => setSelected(new Set())}
                className="ml-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">
                ✕ Clear
              </button>
            </div>
          </div>
        )}

        {/* TABLE AREA */}
        <div className="flex min-h-0 flex-1 px-6 py-3">
          <div data-tour="vendors-table" className="min-h-0 w-full overflow-auto rounded-lg border border-[var(--color-border-subtle)]">
            <Table>
              <Thead>
                <Th style={{ width: 44, minWidth: 44, maxWidth: 44 }}>
                  <UniversalCheckbox checked={allSel} indeterminate={selected.size > 0 && !allSel} onChange={toggleAll} ariaLabel="Select visible vendors" />
                </Th>
                <Th style={{ width: 60, minWidth: 60 }}>CODE</Th>
                <Th style={{ width: '22%', minWidth: 180 }}>NAME</Th>
                <Th style={{ width: '16%', minWidth: 130 }}>GSTIN</Th>
                <Th style={{ width: '14%', minWidth: 120 }}>CONTACT</Th>
                <Th style={{ width: '14%', minWidth: 120 }}>CATEGORIES</Th>
                <Th style={{ width: '14%', minWidth: 120 }}>CREATED</Th>
                <Th align="right" style={{ width: 90, minWidth: 90 }}>ACTIONS</Th>
              </Thead>
              <Tbody>
                {isLoading
                  ? <SkeletonRows cols={8} />
                  : paginated.length === 0
                    ? (
                      <tr>
                        <td colSpan={8} className="py-14 text-center">
                          <EmptyState
                            icon={<Building2 className="h-9 w-9" />}
                            title={search || statusF || categoryF || assignF || activeKpi ? 'No vendors match filters' : 'No vendors yet'}
                            description={search || statusF || categoryF || assignF || activeKpi ? undefined : 'Add your first vendor to get started.'}
                            action={!search && !statusF && !categoryF && !assignF && !activeKpi && perms.canCreate('vendors') ? (
                              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setForm({ ...VENDOR_FORM_DEFAULT }); setEditing(null); setShowForm(true); }} className="mt-2">Add Your First Vendor</Button>
                            ) : undefined}
                          />
                        </td>
                      </tr>
                    )
                    : paginated.map((v: VendorRecord) => {
                      const assignedName = v.contactInfo?.contactPerson || '—';
                      return (
                        <Tr key={v.id} selected={selected.has(v.id)}
                          data-record-id={v.id}
                          role="button"
                          tabIndex={0}
                          onClick={(e) => handleRowClick(e, v)}
                          onKeyDown={(e) => handleRowKeyDown(e, v)}
                          className="transition-colors duration-150"
                        >
                          {/* Checkbox */}
                          <Td className="py-3" onClick={(e) => e.stopPropagation()}>
                            <UniversalCheckbox checked={selected.has(v.id)} onChange={() => toggleSelect(v.id)} ariaLabel={`Select ${v.name}`} />
                          </Td>

                          {/* Code */}
                          <Td className="py-3">
                            <span className="text-xs font-mono font-semibold text-[var(--color-text-muted)]">{v.vendorId}</span>
                          </Td>

                          {/* Name + Avatar */}
                          <Td className="py-3 min-w-[180px]">
                            <div className="flex items-center gap-2.5">
                              <div className="h-7 w-7 shrink-0 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary-text)] flex items-center justify-center text-[11px] font-bold">
                                {(v.name || '?')[0].toUpperCase()}
                              </div>
                              <div className="flex flex-col gap-0.5">
                                <span className="text-sm font-medium text-[var(--color-text)] leading-tight">{v.name || '—'}</span>
                                <span className="text-[12px] text-[var(--color-text-muted)] leading-tight">{v.paymentTerms || ''}</span>
                              </div>
                            </div>
                          </Td>

                          {/* GSTIN */}
                          <Td className="py-3">
                            <span className="text-xs text-[var(--color-text-secondary)]">{v.gstin || '—'}</span>
                          </Td>

                          {/* Contact */}
                          <Td className="py-3">
                            <p className="text-xs font-medium text-[var(--color-text-secondary)]">{v.contactInfo?.contactPerson || '—'}</p>
                            {v.contactInfo?.phone && (
                              <a href={`tel:${v.contactInfo?.phone}`} data-interactive
                                onClick={(e) => e.stopPropagation()}
                                className="text-[var(--color-primary)] hover:underline text-xs">
                                {v.contactInfo?.phone}
                              </a>
                            )}
                          </Td>

                          {/* Categories */}
                          <Td className="py-3">
                            <span className="text-xs text-[var(--color-text-muted)] truncate block max-w-[120px]">{v.categoryTags?.join(', ') || '—'}</span>
                          </Td>

                          {/* Created */}
                          <Td className="py-3">
                            <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${recencyDotClass(v.createdAt)}`} />
                              {formatCreatedDate(v.createdAt)}
                            </div>
                          </Td>

                          {/* Actions */}
                          <Td className="py-3" align="right">
                            <Button size="sm" variant="outline" data-tour="vendors-row-view" icon={<Eye className="h-3 w-3" />}
                              onClick={(e: React.MouseEvent) => { e.stopPropagation(); openVendorDetails(v); }}>View</Button>
                          </Td>
                        </Tr>
                      );
                    })
                }
              </Tbody>
            </Table>
          </div>
        </div>

        {/* PAGINATION */}
        {filtered.length > perPage && (
          <div data-tour="vendors-pagination" className="shrink-0 border-t border-[var(--color-border-subtle)]">
            <Pagination page={page} total={filtered.length} perPage={perPage}
              onChange={(nextPage) => { setPage(nextPage); syncQueueParams({ page: nextPage }); }}
              onPerPageChange={(nextPerPage) => { setPerPage(nextPerPage); setPage(1); syncQueueParams({ perPage: nextPerPage, page: 1 }); }} />
          </div>
        )}
      </Card>

      <VendorWorkspaceDialogs
        ctx={{
          showForm, closeForm, editing, form, setForm, save: actions, permissions: perms,
          handleSubmit,
          showBulkStatus, setShowBulkStatus, bulkStatus, setBulkStatus, bulkStatusMutation, selected,
          showBulkAssign, setShowBulkAssign, bulkAssignId: '', setBulkAssignId: () => {},
          bulkAssignName, setBulkAssignName, bulkAssignMutation,
        }}
      />

      <VendorDetailModal
        open={!!viewItem}
        vendor={viewItem}
        onClose={closeVendorDetails}
        onEdit={(v) => { closeVendorDetails(); openEdit(v); }}
        onDelete={(v) => { closeVendorDetails(); setDelId(v.id); }}
      />

      <ConfirmDialog
        open={!!delId} onClose={() => setDelId(null)}
        onConfirm={() => {
          if (delId === '__bulk__') {
            Promise.all(Array.from(selected).map(id => actions.remove.mutateAsync(id)))
              .then(() => {
                setSelected(new Set());
                setDelId(null);
              })
              .catch(() => {});
          } else if (delId) {
            actions.remove.mutate(delId, {
              onSuccess: () => {
                if (viewItem?.id === delId) closeVendorDetails();
              },
            });
            setDelId(null);
          }
        }}
        loading={actions.remove.isPending} title="Delete Vendor"
        message={delId === '__bulk__' ? `Delete ${selected.size} selected vendors permanently?` : 'Delete this vendor permanently?'}
      />
    </div>
  );
}
