/**
 * Banks — Bank Master workspace (Desktop Gold Standard)
 *
 * Preserves all existing business logic: form dialogs, detail modal, CSV import, branches.
 * Visually identical to Leads. Only business data changes.
 */

import { useState, useMemo, useCallback, useRef, useEffect, useDeferredValue } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Building2, Plus, RefreshCw, Download, Eye, CheckCircle2, XCircle, Upload, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  Button, Card, CardHeader, ConfirmDialog, EmptyState, Pagination,
  PremiumKpi, Select, SkeletonRows, Table, Tbody, Td, Th, Thead, Tr,
  UniversalCheckbox, WorkspaceHero,
} from '../components/ui';
import { usePermissions } from '../lib/permissions';
import { useBanks, useSaveBank, useDeleteBank, useBulkBankStatus, BANK_FORM_DEFAULT, type BankRecord, type BankForm } from '../features/banks/hooks/useBanks';
import { BankStatusBadge, BankTypeBadge } from '../features/banks/components/BankWorkspaceParts';
import { BankDetailModal } from '../features/banks/components/BankDetailModal';
import { BankWorkspaceDialogs } from '../features/banks/components/BankWorkspaceDialogs';
import { BulkImportBanksDialog } from '../features/banks/components/BulkImportBanksDialog';
import { fmtDate } from '../lib/firestore';

const PER_PAGE = 10;

const DATE_OPTIONS = [
  { label: 'All dates', value: '' },
  { label: 'Today', value: 'today' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'Custom', value: 'custom' },
];

const TYPE_OPTIONS = [
  { label: 'All Types', value: '' },
  { label: 'Public', value: 'Public' },
  { label: 'Private', value: 'Private' },
  { label: 'Cooperative', value: 'Cooperative' },
  { label: 'NBFC', value: 'NBFC' },
];

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const p = new Date(value);
  return isNaN(p.getTime()) ? null : p;
}

export default function Banks() {
  const qc = useQueryClient();
  const perms = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();

  // Filters
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const deferredSearch = useDeferredValue(search);
  const [statusF, setStatusF] = useState(() => searchParams.get('status') || '');
  const [typeF, setTypeF] = useState(() => searchParams.get('type') || '');
  const [dateRange, setDateRange] = useState(() => searchParams.get('date') || '');
  const [customFrom, setCustomFrom] = useState(() => searchParams.get('from') || '');
  const [customTo, setCustomTo] = useState(() => searchParams.get('to') || '');
  const [activeKpi, setActiveKpi] = useState(() => searchParams.get('kpi') || '');
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [sortKey, setSortKey] = useState('bankName');
  const [sortDesc, setSortDesc] = useState(false);

  // Selection & drawers
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewItem, setViewItem] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<BankForm>({ ...BANK_FORM_DEFAULT });
  const [delId, setDelId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);

  const openParam = searchParams.get('open') || '';

  const { data: banks = [], isLoading, isError, refetch } = useBanks();

  // Mutations
  const saveBank = useSaveBank();
  const deleteBank = useDeleteBank();
  const bulkStatus = useBulkBankStatus();

  // Save handler
  function handleSaveSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.bankCode || !form.bankName) return toast.error('Bank code and name required');
    saveBank.mutate({ bankId: editId || undefined, data: form });
  }

  useEffect(() => {
    if (saveBank.isSuccess) { setShowForm(false); setEditId(null); setForm({ ...BANK_FORM_DEFAULT }); }
  }, [saveBank.isSuccess]);

  function closeForm() { setShowForm(false); setEditId(null); setForm({ ...BANK_FORM_DEFAULT }); }

  function openEdit(b: any) {
    setViewItem(null);
    setForm({
      bankCode: b.bankCode || '',
      bankName: b.bankName || '',
      displayName: b.displayName || '',
      status: b.status || 'Active',
      priority: b.priority || 0,
      bankType: b.bankType || '',
    });
    setEditId(b.id);
    setShowForm(true);
  }

  // Sorting
  function handleSort(k: string) {
    if (sortKey === k) setSortDesc(d => !d);
    else { setSortKey(k); setSortDesc(false); }
  }

  // URL sync
  function syncQueueParams(nextState: Record<string, string | number | undefined>) {
    const next = new URLSearchParams(searchParams);
    const keys = ['q', 'status', 'type', 'date', 'from', 'to', 'kpi', 'page'];
    keys.forEach((key) => {
      const val = nextState[key] ?? searchParams.get(key);
      if (val && val !== '' && val !== 1) next.set(key, String(val));
      else next.delete(key);
    });
    setSearchParams(next, { replace: true });
  }

  function clearAll() {
    setSearch(''); setStatusF(''); setTypeF(''); setDateRange(''); setCustomFrom(''); setCustomTo('');
    setActiveKpi(''); setPage(1); setSelected(new Set());
    syncQueueParams({ q: '', status: '', type: '', date: '', from: '', to: '', kpi: '', page: 1 });
  }

  // Detail auto-open from URL
  const lastClosedParamRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastClosedParamRef.current === openParam) { lastClosedParamRef.current = null; return; }
    if (!openParam || isLoading) return;
    const target = (banks as any[]).find((r: any) => r.id === openParam);
    if (target) setViewItem(target);
  }, [openParam, isLoading, banks]);

  // Selection
  const toggleSelect = useCallback((id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);

  function isRowOpenIgnored(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false;
    return Boolean(target.closest('button,a,input,select,textarea,[data-action],[data-interactive]'));
  }

  // Stats
  const stats = useMemo(() => {
    const all = banks as BankRecord[];
    const recent = all.filter(b => {
      const d = toDate(b.createdAt);
      if (!d) return false;
      const now = new Date(); now.setHours(0, 0, 0, 0);
      const then = new Date(d); then.setHours(0, 0, 0, 0);
      return (now.getTime() - then.getTime()) <= 7 * 86400000;
    });
    return {
      total: all.length,
      active: all.filter(b => b.status === 'Active').length,
      inactive: all.filter(b => b.status === 'Inactive').length,
      private: all.filter(b => b.bankType === 'Private').length,
      public: all.filter(b => b.bankType === 'Public').length,
      recentlyAdded: recent.length,
    };
  }, [banks]);

  const isTotalDefault = !activeKpi && !search && !statusF && !typeF && !dateRange;

  // Filtering
  const filtered = useMemo(() => {
    let list = [...(banks as BankRecord[])];
    const q = deferredSearch.toLowerCase().trim();
    if (q) list = list.filter(b => [b.bankCode, b.bankName, b.displayName].some(v => String(v || '').toLowerCase().includes(q)));
    if (activeKpi === 'active') list = list.filter(b => b.status === 'Active');
    else if (activeKpi === 'inactive') list = list.filter(b => b.status === 'Inactive');
    else if (activeKpi === 'private') list = list.filter(b => b.bankType === 'Private');
    else if (activeKpi === 'public') list = list.filter(b => b.bankType === 'Public');
    else if (activeKpi === 'recentlyAdded') list = list.filter(b => {
      const d = toDate(b.createdAt);
      if (!d) return false;
      const now = new Date(); now.setHours(0, 0, 0, 0);
      const then = new Date(d); then.setHours(0, 0, 0, 0);
      return (now.getTime() - then.getTime()) <= 7 * 86400000;
    });
    if (statusF === 'Active') list = list.filter(b => b.status === 'Active');
    else if (statusF === 'Inactive') list = list.filter(b => b.status === 'Inactive');
    if (typeF) list = list.filter(b => b.bankType === typeF);
    if (dateRange) {
      list = list.filter(b => {
        const d = toDate(b.createdAt);
        if (!d) return false;
        const now = new Date(); now.setHours(0, 0, 0, 0);
        if (dateRange === 'today') return d.getTime() >= now.getTime();
        if (dateRange === '7d') return (now.getTime() - d.getTime()) <= 7 * 86400000;
        if (dateRange === '30d') return (now.getTime() - d.getTime()) <= 30 * 86400000;
        if (dateRange === 'custom' && customFrom && customTo) {
          const from = new Date(customFrom), to = new Date(customTo);
          return d >= from && d <= to;
        }
        return true;
      });
    }
    list.sort((a, b) => {
      const av = String(a[sortKey as keyof BankRecord] || '');
      const bv = String(b[sortKey as keyof BankRecord] || '');
      const cmp = av.localeCompare(bv, undefined, { numeric: true });
      return sortDesc ? -cmp : cmp;
    });
    return list;
  }, [banks, deferredSearch, statusF, typeF, dateRange, customFrom, customTo, activeKpi, sortKey, sortDesc]);

  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const toggleAll = () => setSelected(s => s.size === paginated.length ? new Set() : new Set(paginated.map((r: any) => r.id)));
  const allSel = selected.size === paginated.length && paginated.length > 0;

  useEffect(() => { const maxPage = Math.max(1, Math.ceil(filtered.length / PER_PAGE)); if (page > maxPage) setPage(maxPage); }, [filtered.length, page]);

  const hasActiveFilters = Boolean(search || statusF || typeF || dateRange || activeKpi);
  const activeFilterCount = (activeKpi ? 1 : 0) + (search ? 1 : 0) + (dateRange ? 1 : 0) + (statusF ? 1 : 0) + (typeF ? 1 : 0);

  // CSV export
  function downloadCsv(rows: any[]) {
    const headers = ['Bank Code', 'Bank Name', 'Display Name', 'Status', 'Type', 'Priority', 'Updated'];
    const lines = rows.map(r => [r.bankCode, r.bankName, r.displayName || '', r.status || 'Active', r.bankType || '', r.priority ?? 0, fmtDate(r.updatedAt) || ''].map(v => `"${v}"`).join(','));
    const csv = [headers.join(','), ...lines].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `banks-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function handleExport() {
    const rows = selected.size > 0
      ? Array.from(selected).map(id => (banks as any[]).find(b => b.id === id)).filter(Boolean)
      : filtered;
    downloadCsv(rows);
  }

  const KPI_CONFIGS = [
    { key: '', label: 'TOTAL BANKS', value: stats.total, icon: <Building2 className="h-4 w-4" />, description: 'All bank records' },
    { key: 'active', label: 'ACTIVE', value: stats.active, icon: <CheckCircle2 className="h-4 w-4" />, description: 'Active banks' },
    { key: 'inactive', label: 'INACTIVE', value: stats.inactive, icon: <XCircle className="h-4 w-4" />, description: 'Inactive banks' },
    { key: 'private', label: 'PRIVATE', value: stats.private, icon: <Building2 className="h-4 w-4" />, description: 'Private sector banks' },
    { key: 'public', label: 'PUBLIC', value: stats.public, icon: <Building2 className="h-4 w-4" />, description: 'Public sector banks' },
    { key: 'recentlyAdded', label: 'RECENTLY ADDED', value: stats.recentlyAdded, icon: <Plus className="h-4 w-4" />, description: 'Added in last 7 days' },
  ];

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      <WorkspaceHero
        title="Bank Master"
        icon={<Building2 className="h-6 w-6" />}
        breadcrumbs={['Home', 'Settings', 'Banks']}
        statusText={`${stats.total} banks`}
        statusDotColor="var(--color-success)"
        className="gap-3"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" icon={<Download className="h-3.5 w-3.5" />}
              onClick={handleExport} disabled={filtered.length === 0}>
              Export
            </Button>
            {perms.canCreate('banks') && (
              <>
                <Button size="sm" variant="outline" icon={<Upload className="h-3.5 w-3.5" />}
                  onClick={() => setShowImport(true)}>
                  Import CSV
                </Button>
                <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => { setForm({ ...BANK_FORM_DEFAULT }); setEditId(null); setShowForm(true); }}>
                  Add Bank
                </Button>
              </>
            )}
            <Button size="sm" variant="outline" icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => refetch()}>
              Refresh
            </Button>
          </div>
        }
      />

      {/* KPI Grid */}
      <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-6">
        {KPI_CONFIGS.map(k => (
          <PremiumKpi key={k.key} label={k.label} value={k.value} icon={k.icon} description={k.description}
            active={k.key === '' ? (activeKpi === '' || isTotalDefault) : activeKpi === k.key}
            onClick={() => { const next = activeKpi === k.key ? '' : k.key; setActiveKpi(next); setPage(1); syncQueueParams({ kpi: next, page: 1 }); }} />
        ))}
      </div>

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden shadow-[var(--shadow-enterprise-surface)]">
        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="px-6 py-2.5 flex items-center gap-3 bg-[var(--color-primary-light)] border-b border-[var(--color-primary-muted)] dark:bg-[var(--color-primary-light)] dark:border-[var(--color-primary-muted)]">
            <span className="text-sm font-semibold text-[var(--color-primary-text)]">{selected.size} selected</span>
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <button onClick={handleExport}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-[10px] font-semibold hover:bg-[var(--color-surface-hover)] transition-colors text-emerald-600 dark:text-emerald-400">
                <Download className="h-3 w-3" /> Export
              </button>
              <button onClick={() => bulkStatus.mutate({ ids: Array.from(selected), status: 'Active' })}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-[10px] font-semibold hover:bg-[var(--color-surface-hover)] transition-colors text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3 w-3" /> Activate
              </button>
              <button onClick={() => bulkStatus.mutate({ ids: Array.from(selected), status: 'Inactive' })}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-[10px] font-semibold hover:bg-[var(--color-surface-hover)] transition-colors text-orange-600 dark:text-orange-400">
                <XCircle className="h-3 w-3" /> Deactivate
              </button>
              <button onClick={() => setDelId('__bulk__')}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-[10px] font-semibold hover:bg-[var(--color-surface-hover)] transition-colors text-red-600 dark:text-red-400">
                <X className="h-3 w-3" /> Delete
              </button>
              <button onClick={() => setSelected(new Set())} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">✕ Clear</button>
            </div>
          </div>
        )}

        {/* Filters */}
        <CardHeader className="px-6 pt-2 pb-2 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
            <input aria-label="Search" placeholder="Search by bank name, code..."
              value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="min-w-[160px] flex-1 h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]" />

            <Select aria-label="Date" value={dateRange} onChange={e => { const v = e.target.value; setDateRange(v); setPage(1); if (v !== 'custom') { setCustomFrom(''); setCustomTo(''); } syncQueueParams({ date: v, page: 1 }); }}
              options={DATE_OPTIONS} className="w-[110px] h-8 py-1" />
            {dateRange === 'custom' && (
              <div className="flex items-center gap-1">
                <input type="date" value={customFrom} onChange={e => { setCustomFrom(e.target.value); setPage(1); syncQueueParams({ from: e.target.value, page: 1 }); }}
                  className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] w-[130px]" />
                <span className="text-xs text-[var(--color-text-muted)]">to</span>
                <input type="date" value={customTo} onChange={e => { setCustomTo(e.target.value); setPage(1); syncQueueParams({ to: e.target.value, page: 1 }); }}
                  className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] w-[130px]" />
              </div>
            )}

            <Select aria-label="Status" value={statusF} onChange={e => { setStatusF(e.target.value); setPage(1); syncQueueParams({ status: e.target.value, page: 1 }); }}
              options={[{ label: 'All Status', value: '' }, { label: 'Active', value: 'Active' }, { label: 'Inactive', value: 'Inactive' }]} className="w-[110px] h-8 py-1" />
            <Select aria-label="Bank Type" value={typeF} onChange={e => { setTypeF(e.target.value); setPage(1); syncQueueParams({ type: e.target.value, page: 1 }); }}
              options={TYPE_OPTIONS} className="w-[110px] h-8 py-1" />
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]"><span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" /></div>
          </div>

          {activeFilterCount > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {activeKpi && (<span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary-light)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-primary-text)]">{KPI_CONFIGS.find(k => k.key === activeKpi)?.label || activeKpi}<button onClick={() => { setActiveKpi(''); setPage(1); syncQueueParams({ kpi: '', page: 1 }); }} className="ml-0.5 hover:opacity-70">✕</button></span>)}
              {search && (<span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)]">S: {search.length > 20 ? search.slice(0, 20) + '…' : search}<button onClick={() => { setSearch(''); setPage(1); }} className="ml-0.5 hover:opacity-70">✕</button></span>)}
              {dateRange && (<span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)]">{DATE_OPTIONS.find(d => d.value === dateRange)?.label || dateRange}<button onClick={() => { setDateRange(''); setCustomFrom(''); setCustomTo(''); setPage(1); syncQueueParams({ date: '', page: 1 }); }} className="ml-0.5 hover:opacity-70">✕</button></span>)}
              {statusF && (<span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)]">{statusF}<button onClick={() => { setStatusF(''); setPage(1); syncQueueParams({ status: '', page: 1 }); }} className="ml-0.5 hover:opacity-70">✕</button></span>)}
              {typeF && (<span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)]">{typeF}<button onClick={() => { setTypeF(''); setPage(1); syncQueueParams({ type: '', page: 1 }); }} className="ml-0.5 hover:opacity-70">✕</button></span>)}
              <button onClick={clearAll} className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"><X className="h-3 w-3" /> Clear</button>
            </div>
          )}
        </CardHeader>

        {/* Table */}
        <div className="px-6 flex-1 flex flex-col min-h-0">
          <div className="min-h-0 flex-1 overflow-auto scroll-pt-10">
            <Table>
              <Thead>
                <Th style={{ width: 44 }}><UniversalCheckbox checked={allSel} onChange={toggleAll} /></Th>
                <Th sortable sorted={sortKey === 'bankCode'} desc={sortDesc} onSort={() => handleSort('bankCode')} style={{ minWidth: 80 }}>CODE</Th>
                <Th sortable sorted={sortKey === 'bankName'} desc={sortDesc} onSort={() => handleSort('bankName')} style={{ minWidth: 140 }}>BANK NAME</Th>
                <Th style={{ minWidth: 100 }}>DISPLAY NAME</Th>
                <Th style={{ width: 90 }}>STATUS</Th>
                <Th style={{ width: 90 }}>TYPE</Th>
                <Th sortable sorted={sortKey === 'priority'} desc={sortDesc} onSort={() => handleSort('priority')} style={{ width: 80 }}>PRIORITY</Th>
                <Th sortable sorted={sortKey === 'updatedAt'} desc={sortDesc} onSort={() => handleSort('updatedAt')} style={{ width: 100 }}>UPDATED</Th>
                <Th style={{ width: 130 }}>ACTIONS</Th>
              </Thead>
              <Tbody>
                {isError ? (
                  <tr><td colSpan={9} className="py-14 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Building2 className="h-10 w-10 text-[var(--color-text-disabled)]" />
                      <p className="text-sm text-[var(--color-text-muted)]">Failed to load banks.</p>
                      <button onClick={() => refetch()} className="text-xs font-semibold text-[var(--color-primary)] hover:underline">Retry</button>
                    </div>
                  </td></tr>
                ) : isLoading ? (<SkeletonRows cols={9} rows={6} />) : paginated.length === 0 ? (
                  <tr><td colSpan={9}>
                    <EmptyState icon={<Building2 className="h-9 w-9" />}
                      title={hasActiveFilters ? 'No banks match filters' : 'No banks yet'}
                      description={hasActiveFilters ? 'Try adjusting your search or filters.' : 'Add your first bank to get started.'}
                      action={!hasActiveFilters && perms.canCreate('banks') ? <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => { setForm({ ...BANK_FORM_DEFAULT }); setEditId(null); setShowForm(true); }}>Add Your First Bank</Button> : undefined} />
                  </td></tr>
                ) : (
                  paginated.map((b: any) => (
                    <Tr key={b.id}
                      onClick={(e) => { if (!isRowOpenIgnored(e.target as HTMLElement)) { setViewItem(b); } }}
                      className="group cursor-pointer transition-all duration-200 ease-out hover:bg-[var(--color-table-row-hover)] focus-visible:bg-[var(--color-table-row-hover)] focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-inset">
                      <Td><span data-interactive onClick={(e) => e.stopPropagation()}><UniversalCheckbox checked={selected.has(b.id)} onChange={() => toggleSelect(b.id)} /></span></Td>
                      <Td><span className="font-mono text-xs font-semibold">{b.bankCode}</span></Td>
                      <Td><span className="font-semibold text-sm">{b.bankName}</span></Td>
                      <Td className="text-xs text-[var(--color-text-muted)]">{b.displayName || '—'}</Td>
                      <Td><span data-interactive onClick={(e) => e.stopPropagation()}>{BankStatusBadge(b.status)}</span></Td>
                      <Td><span data-interactive onClick={(e) => e.stopPropagation()}>{BankTypeBadge(b.bankType)}</span></Td>
                      <Td className="text-xs">{b.priority ?? '—'}</Td>
                      <Td className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">{fmtDate(b.updatedAt)}</Td>
                      <Td>
                        <div data-action onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} className="flex items-center justify-end gap-1">
                          <button type="button" onClick={(e) => { e.stopPropagation(); setViewItem(b); }}
                            className="inline-flex h-7 items-center gap-1 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-text)] px-3 py-1 text-xs font-semibold text-[var(--color-text-inverse)] shadow-[var(--shadow-enterprise-control)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]">
                            <Eye className="h-3.5 w-3.5" /> View
                          </button>
                        </div>
                      </Td>
                    </Tr>
                  ))
                )}
              </Tbody>
            </Table>
          </div>
          <div className="shrink-0 border-t border-[var(--color-border-subtle)]">
            <Pagination page={page} total={filtered.length} perPage={PER_PAGE}
              onChange={(p) => { setPage(p); syncQueueParams({ page: p }); }} />
          </div>
        </div>
      </Card>

      {/* Import CSV Dialog */}
      <BulkImportBanksDialog open={showImport} onClose={() => setShowImport(false)} />

      {/* Form Modal */}
      <BankWorkspaceDialogs ctx={{
        showForm, closeForm, editId, form, setForm,
        save: saveBank,
        handleSubmit: handleSaveSubmit,
      }} />

      {/* Detail Modal */}
      <BankDetailModal open={!!viewItem} bank={viewItem} onClose={() => {
        lastClosedParamRef.current = openParam;
        setViewItem(null);
        const next = new URLSearchParams(searchParams);
        next.delete('open');
        setSearchParams(next, { replace: true });
      }}
        onEdit={() => { const b = viewItem; setViewItem(null); setTimeout(() => openEdit(b), 100); }}
        onDelete={() => { setDelId(viewItem?.id); setViewItem(null); }} />

      {/* Delete Confirm */}
      <ConfirmDialog open={!!delId} onClose={() => setDelId(null)}
        onConfirm={() => {
          if (delId === '__bulk__') {
            Promise.all(Array.from(selected).map(id => deleteBank.mutateAsync(id))).then(() => { setSelected(new Set()); setDelId(null); });
          } else if (delId) deleteBank.mutate(delId);
        }}
        loading={deleteBank.isPending} title="Delete Bank"
        message={delId === '__bulk__' ? `Delete ${selected.size} selected banks?` : 'Delete this bank permanently?'} />
    </div>
  );
}
