/**
 * AmcContracts.tsx — Desktop AMC Contracts page (Leads Gold Standard)
 */
import { useState, useMemo, useCallback, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  CalendarCheck, Plus, Trash2, Download, RefreshCw,
  AlertTriangle, FileText, X, Users, ListChecks,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  Button, Card, CardHeader, ConfirmDialog, EmptyState, Modal,
  Pagination, PremiumKpi, Select, SkeletonRows,
  Table, Thead, Th, Tbody, Tr, Td, UniversalCheckbox,
  WorkspaceHero, statusBadge,
} from '../components/ui';
import { Input, Textarea } from '../components/ui/Input';
import { fmtCurrency, fmtDate, getAll, deleteDocById } from '../lib/firestore';
import { usePermissions } from '../lib/permissions';
import { useAppStore, useCurrentUser } from '../store/useAppStore';
import { useAmcContracts, useCreateAmcContract, useTransitionAmcContract } from '../features/amc/hooks/useAmcContracts';
import type { AmcContractCreateInput, AmcContractRecord, AmcStatus } from '../lib/amcWorkflow';
import { isValidTransition, reassignAmcContract } from '../lib/amcWorkflow';
import { COLLECTIONS } from '../lib/firebase';
import { isInDateRange } from '../lib/dateFilters';
import { useProjects } from '../features/projects/hooks/useProjects';

const PER_PAGE = 10;
const AMC_STATUSES: AmcStatus[] = ['Draft', 'Active', 'Expired', 'Cancelled'];
const FORM0: AmcContractCreateInput = {
  projectId: '', projectName: '', customerId: '', customerName: '',
  startDate: new Date().toISOString().split('T')[0], endDate: '',
  visitsPerYear: 2, contractValue: 0, assignedTo: '', assignedToName: '', notes: '',
};

function daysUntilExpiry(endDate: string): number {
  if (!endDate) return Infinity;
  const end = new Date(endDate);
  if (isNaN(end.getTime())) return Infinity;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.ceil((end.getTime() - now.getTime()) / 86400000);
}
function isInactive(s: string) { return s === 'Expired' || s === 'Cancelled'; }
function isRowOpenIgnored(t: EventTarget | null) {
  if (!(t instanceof HTMLElement)) return false;
  return Boolean(t.closest('button,a,input,select,textarea,[data-action],[data-interactive]'));
}
function downloadCsv(rows: AmcContractRecord[], fn: string) {
  const h = ['Contract Number', 'Customer', 'Project', 'Start Date', 'End Date', 'Value', 'Visits/Year', 'Status', 'Assigned To'];
  const l = rows.map(c =>
    [c.contractNumber, c.customerName, c.projectName, c.startDate, c.endDate, String(c.contractValue), String(c.visitsPerYear), c.status, c.assignedToName || '']
      .map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
  );
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + [h.join(','), ...l].join('\r\n')], { type: 'text/csv;charset=utf-8;' }));
  a.download = fn; a.click(); URL.revokeObjectURL(a.href);
}
function toDateValue(v: any): Date | null {
  if (!v) return null;
  if (typeof v === 'object' && typeof v.toDate === 'function') return v.toDate();
  if (typeof v === 'object' && v.seconds) return new Date(v.seconds * 1000);
  const d = new Date(v); return isNaN(d.getTime()) ? null : d;
}
function fmtCreated(v: any) { const d = toDateValue(v); return d ? d.toLocaleDateString('en-GB') : ''; }
function recDot(v: any) {
  const d = toDateValue(v); if (!d) return 'bg-[var(--color-text-disabled)]';
  const t = new Date(); t.setHours(0, 0, 0, 0); const c = new Date(d); c.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((t.getTime() - c.getTime()) / 86400000));
  if (days === 0) return 'bg-emerald-500'; if (days <= 7) return 'bg-blue-500';
  if (days <= 30) return 'bg-amber-500'; return 'bg-red-500';
}

export default function AmcContracts() {
  const qc = useQueryClient();
  const user = useCurrentUser();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const perms = usePermissions();
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const createParam = sp.get('create') || '';

  const [search, setSearch] = useState(() => sp.get('q') || '');
  const [statusF, setStatusF] = useState(() => sp.get('status') || '');
  const [assignF, setAssignF] = useState(() => sp.get('owner') || '');
  const [dateRange, setDateRange] = useState(() => sp.get('date') || 'all');
  const [customFrom, setCustomFrom] = useState(() => sp.get('from') || '');
  const [customTo, setCustomTo] = useState(() => sp.get('to') || '');
  const [activeKpi, setActiveKpi] = useState(() => sp.get('kpi') || '');
  const [page, setPage] = useState(() => Math.max(1, Number(sp.get('page')) || 1));
  const [perPage, setPerPage] = useState(() => Math.max(1, Number(sp.get('perPage')) || PER_PAGE));
  const [sortKey, setSortKey] = useState('createdAt');
  const [sortDesc, setSortDesc] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...FORM0 });
  const [delId, setDelId] = useState<string | null>(null);
  const [showBulkStatus, setShowBulkStatus] = useState(false);
  const [showBulkAssign, setShowBulkAssign] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkAssignId, setBulkAssignId] = useState('');
  const [bulkAssignName, setBulkAssignName] = useState('');

  const { data: contracts = [], isLoading, refetch } = useAmcContracts();
  const { data: projects = [] } = useProjects();
  const createMut = useCreateAmcContract();
  const transitionMut = useTransitionAmcContract();
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => getAll(COLLECTIONS.USERS), staleTime: 300000 });

  const eligibleProjects = useMemo(
    () => (projects as any[]).filter((p: any) => ['Handover', 'AMC', 'Service', 'Monitoring'].includes(p.currentStage)),
    [projects],
  );
  const salesUsers = useMemo(
    () => (users as any[])
      .filter((u: any) => ['Sales', 'Executive', 'BDE', 'BDM', 'Manager', 'TL', 'Operations'].includes(u.role) && u.status !== 'Inactive' && !u.isDeleted)
      .sort((a: any, b: any) => a.name.localeCompare(b.name)),
    [users],
  );

  function syncQueueParams(ns: { q?: string; status?: string; owner?: string; date?: string; from?: string; to?: string; kpi?: string; page?: number; perPage?: number }) {
    const n = new URLSearchParams(sp);
    const q = ns.q ?? search; const s = ns.status ?? statusF; const o = ns.owner ?? assignF;
    const d = ns.date ?? dateRange; const f = ns.from ?? customFrom; const t = ns.to ?? customTo;
    const k = ns.kpi ?? activeKpi; const np = ns.page ?? page; const npp = ns.perPage ?? perPage;
    if (q) n.set('q', q); else n.delete('q');
    if (s) n.set('status', s); else n.delete('status');
    if (o) n.set('owner', o); else n.delete('owner');
    if (d && d !== 'all') n.set('date', d); else n.delete('date');
    if (f) n.set('from', f); else n.delete('from');
    if (t) n.set('to', t); else n.delete('to');
    if (k) n.set('kpi', k); else n.delete('kpi');
    if (np > 1) n.set('page', String(np)); else n.delete('page');
    if (npp !== PER_PAGE) n.set('perPage', String(npp)); else n.delete('perPage');
    setSp(n, { replace: true });
  }

  useEffect(() => { if (createParam !== '1') return; setForm({ ...FORM0 }); setShowForm(true); }, [createParam]);
  function closeForm() { setShowForm(false); setForm({ ...FORM0 }); if (createParam === '1') { const n = new URLSearchParams(sp); n.delete('create'); setSp(n, { replace: true }); } }
  const save = useMutation({
    mutationFn: async (d: typeof FORM0) => createMut.mutateAsync(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['amc_contracts'] }); toast.success('Contract created'); closeForm(); },
    onError: (e: any) => toast.error(e.message),
  });
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); if (save.isPending) return;
    if (!form.projectId) return toast.error('Please select a project');
    if (!form.customerName) return toast.error('Customer name is required');
    if (!form.startDate) return toast.error('Start date is required');
    if (!form.endDate) return toast.error('End date is required');
    if (form.endDate <= form.startDate) return toast.error('End date must be after start date');
    if (form.contractValue <= 0) return toast.error('Contract value must be greater than 0');
    save.mutate(form);
  }

  const del = useMutation({
    mutationFn: async (id: string) => { await deleteDocById(COLLECTIONS.AMC_CONTRACTS, id); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['amc_contracts'] }); toast.success('Deleted'); setDelId(null); setSelected(new Set()); },
    onError: (e: any) => toast.error(e.message),
  });

  // Row click / View opens the real AMC contract workspace route — the
  // detail modal was retired when the AMC stage moved into the Project
  // Workspace (see ProjectAmcWorkspace.tsx).
  function handleRowClick(e: React.MouseEvent<HTMLTableRowElement>, c: AmcContractRecord) { if (window.getSelection()?.toString()) return; if (isRowOpenIgnored(e.target)) return; navigate(`/amc-contracts/${encodeURIComponent(c.id)}`); }
  function handleRowKeyDown(e: React.KeyboardEvent<HTMLTableRowElement>, c: AmcContractRecord) { if (isRowOpenIgnored(e.target)) return; if (e.key !== 'Enter' && e.key !== ' ') return; e.preventDefault(); navigate(`/amc-contracts/${encodeURIComponent(c.id)}`); }
  function sort(k: string) { if (sortKey === k) { setSortDesc(d => !d); } else { setSortKey(k); setSortDesc(true); } }
  function clearAll() {
    setSearch(''); setStatusF(''); setAssignF(''); setDateRange('all');
    setCustomFrom(''); setCustomTo(''); setActiveKpi(''); setPage(1);
    syncQueueParams({ q: '', status: '', owner: '', date: 'all', from: '', to: '', kpi: '', page: 1 });
  }

  const filtered = useMemo(() => {
    let list = [...(contracts as AmcContractRecord[])];
    if (activeKpi) {
      if (activeKpi === 'Expiring') {
        list = list.filter(c => c.status === 'Active' && daysUntilExpiry(c.endDate) <= 30);
      } else {
        list = list.filter(c => c.status === activeKpi);
      }
    }
    const q = search.toLowerCase();
    if (q) list = list.filter(c => [c.contractNumber, c.customerName, c.projectName, c.assignedToName].some(v => String(v || '').toLowerCase().includes(q)));
    if (statusF) list = list.filter(c => c.status === statusF);
    if (assignF) list = list.filter(c => c.assignedTo === assignF || c.assignedToName === assignF);
    if (dateRange !== 'all') list = list.filter(c => isInDateRange(c.createdAt, dateRange as any, customFrom, customTo));
    list.sort((a, b) => { const aV = String(a[sortKey as keyof AmcContractRecord] || ''), bV = String(b[sortKey as keyof AmcContractRecord] || ''); return sortDesc ? bV.localeCompare(aV) : aV.localeCompare(bV); });
    return list;
  }, [contracts, search, statusF, assignF, dateRange, customFrom, customTo, activeKpi, sortKey, sortDesc]);

  const paginated = filtered.slice((page - 1) * perPage, page * perPage);
  const stats = useMemo(() => ({
    total: contracts.length, draft: contracts.filter(c => c.status === 'Draft').length,
    active: contracts.filter(c => c.status === 'Active').length,
    expiring: contracts.filter(c => c.status === 'Active' && daysUntilExpiry(c.endDate) <= 30).length,
    expired: contracts.filter(c => c.status === 'Expired').length,
    cancelled: contracts.filter(c => c.status === 'Cancelled').length,
  }), [contracts]);

  const isTotalDefault = useMemo(() => !activeKpi && !search && !statusF && !assignF && dateRange === 'all', [activeKpi, search, statusF, assignF, dateRange]);
  const activeFilterCount = useMemo(() => { let c = 0; if (search) c++; if (statusF) c++; if (assignF) c++; if (dateRange !== 'all') c++; if (activeKpi) c++; return c; }, [search, statusF, assignF, dateRange, activeKpi]);

  const KPI_TILES = [
    { key: '', label: 'TOTAL', icon: <CalendarCheck className="h-4 w-4" />, value: stats.total, description: `${stats.total} total contracts` },
    { key: 'Draft', label: 'DRAFT', icon: <FileText className="h-4 w-4" />, value: stats.draft, description: 'Draft contracts' },
    { key: 'Active', label: 'ACTIVE', icon: <RefreshCw className="h-4 w-4" />, value: stats.active, description: 'Active contracts' },
    { key: 'Expiring', label: 'EXPIRING', icon: <AlertTriangle className="h-4 w-4" />, value: stats.expiring, description: 'Expiring within 30 days' },
    { key: 'Expired', label: 'EXPIRED', icon: <CalendarCheck className="h-4 w-4" />, value: stats.expired, description: 'Expired contracts' },
    { key: 'Cancelled', label: 'CANCELLED', icon: <X className="h-4 w-4" />, value: stats.cancelled, description: 'Cancelled contracts' },
  ];

  const toggleSelect = useCallback((id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);
  const toggleAll = () => setSelected(s => s.size === paginated.length ? new Set() : new Set(paginated.map(c => c.id)));
  const allSel = selected.size === paginated.length && paginated.length > 0;

  function exportSelected() {
    const rows = (contracts as AmcContractRecord[]).filter(c => selected.has(c.id));
    if (!rows.length) return toast.error('No contracts selected');
    downloadCsv(rows, `amc-contracts-export-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${rows.length} contract${rows.length > 1 ? 's' : ''}`);
  }

  const bulkStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      await Promise.all(ids.map(id => {
        const c = (contracts as AmcContractRecord[]).find(x => x.id === id);
        if (!c || !isValidTransition(c.status as AmcStatus, status as AmcStatus)) throw new Error(`Cannot transition to ${status}`);
        return transitionMut.mutateAsync({ contractId: id, nextStatus: status as AmcStatus });
      }));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['amc_contracts'] }); toast.success(`Updated ${selected.size} contracts`); setShowBulkStatus(false); setBulkStatus(''); setSelected(new Set()); },
    onError: (e: any) => toast.error(e.message),
  });
  const bulkAssignMutation = useMutation({
    mutationFn: async ({ ids, userId, userName }: { ids: string[]; userId: string; userName: string }) => {
      await Promise.all(ids.map(id => reassignAmcContract(id, userId, userName)));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['amc_contracts'] }); toast.success(`Assigned ${selected.size} contracts to ${bulkAssignName}`); setShowBulkAssign(false); setBulkAssignId(''); setBulkAssignName(''); setSelected(new Set()); },
    onError: (e: any) => toast.error(e.message),
  });

  const assignOptions = [{ label: 'All Assigned', value: '' }, ...salesUsers.map((u: any) => ({ label: u.name, value: u.id }))];
  const DATE_OPTIONS = [
    { label: 'All dates', value: 'all' }, { label: 'Today', value: 'today' },
    { label: 'Last 7 days', value: 'week' }, { label: 'Last 30 days', value: 'month' },
    { label: 'Custom', value: 'custom' },
  ];
  function handleDateChange(v: string) { setDateRange(v); setPage(1); if (v !== 'custom') { setCustomFrom(''); setCustomTo(''); } syncQueueParams({ date: v, from: '', to: '', page: 1 }); }

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      <WorkspaceHero title="AMC Contracts" icon={<CalendarCheck className="h-6 w-6" />}
        breadcrumbs={['Home', 'Post Sales', 'AMC Contracts']}
        statusText="Last sync · Realtime Connected" statusDotColor="var(--color-success)" className="gap-3"
        actions={
          <>
            <Button variant="outline" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => refetch()}>Refresh</Button>
            {perms.canCreate('projects') && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setForm({ ...FORM0 }); setShowForm(true); }}>New Contract</Button>}
          </>
        }
      />
      <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-6">
        {KPI_TILES.map(k => (
          <PremiumKpi key={k.key} label={k.label} value={k.value} icon={k.icon} description={k.description}
            onClick={() => { const nk = activeKpi === k.key ? '' : k.key; setActiveKpi(nk); setPage(1); syncQueueParams({ kpi: nk, page: 1 }); }}
            active={k.key === '' ? (activeKpi === '' || isTotalDefault) : activeKpi === k.key}
          />
        ))}
      </div>
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.04)] border-[var(--color-border)]">
        <CardHeader className="px-6 pt-2 pb-2 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <input aria-label="Search contracts" placeholder="Search contract number, customer, project..."
              value={search} onChange={e => { setSearch(e.target.value); setPage(1); syncQueueParams({ q: e.target.value, page: 1 }); }}
              className="min-w-[160px] flex-1 h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]"
            />
            <Select aria-label="Date" value={dateRange} options={DATE_OPTIONS} onChange={e => handleDateChange(e.target.value)} className="w-[110px] h-8 py-1" />
            {dateRange === 'custom' && (
              <div className="flex items-center gap-1.5">
                <input type="date" value={customFrom} onChange={e => { setCustomFrom(e.target.value); setPage(1); syncQueueParams({ from: e.target.value, to: customTo, date: 'custom', page: 1 }); }} className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                <span className="text-[10px] text-[var(--color-text-muted)]">to</span>
                <input type="date" value={customTo} onChange={e => { setCustomTo(e.target.value); setPage(1); syncQueueParams({ to: e.target.value, from: customFrom, date: 'custom', page: 1 }); }} className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
              </div>
            )}
            <Select aria-label="Status" value={statusF} onChange={e => { const v = e.target.value; setStatusF(v); if (v && activeKpi && v !== activeKpi) { setActiveKpi(''); setPage(1); syncQueueParams({ status: v, kpi: '', page: 1 }); } else { setPage(1); syncQueueParams({ status: v, page: 1 }); } }} options={[{ label: 'All Status', value: '' }, ...AMC_STATUSES.map(s => ({ label: s, value: s }))]} className="w-[110px] h-8 py-1" />
            <Select aria-label="Assigned" value={assignF} onChange={e => { setAssignF(e.target.value); setPage(1); syncQueueParams({ owner: e.target.value, page: 1 }); }} options={assignOptions} className="w-[120px] h-8 py-1" />
            {activeFilterCount > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {activeKpi && <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary-light)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-primary-text)]">{KPI_TILES.find(t => t.key === activeKpi)?.label || activeKpi}<button type="button" onClick={() => { setActiveKpi(''); setPage(1); syncQueueParams({ kpi: '', page: 1 }); }} className="ml-0.5 hover:opacity-70"><X className="h-2.5 w-2.5" /></button></span>}
                {search && <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">S: {search.slice(0, 12)}{search.length > 12 ? '…' : ''}</span>}
                {statusF && !activeKpi && <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">{statusF}</span>}
                <button type="button" onClick={clearAll} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"><X className="h-2.5 w-2.5" /> Clear</button>
              </div>
            )}
          </div>
        </CardHeader>
        {selected.size > 0 && (
          <div className="px-6 py-2.5 flex items-center gap-3 bg-[var(--color-primary-light)] border-b border-[var(--color-primary-muted)]">
            <span className="text-sm font-semibold text-[var(--color-primary-text)]">{selected.size} contract{selected.size > 1 ? 's' : ''} selected</span>
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <Button size="sm" variant="outline" icon={<Download className="h-3.5 w-3.5" />} onClick={exportSelected} className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30">Export CSV</Button>
              {perms.canEdit('projects') && <Button size="sm" variant="outline" icon={<ListChecks className="h-3.5 w-3.5" />} onClick={() => setShowBulkStatus(true)} className="text-indigo-600 border-indigo-300 hover:bg-indigo-50 dark:border-indigo-700 dark:hover:bg-indigo-900/30">Change Status</Button>}
              {perms.canEdit('projects') && <Button size="sm" variant="outline" icon={<Users className="h-3.5 w-3.5" />} onClick={() => setShowBulkAssign(true)} className="text-purple-600 border-purple-300 hover:bg-purple-50 dark:border-purple-700 dark:hover:bg-purple-900/30">Assign</Button>}
              {perms.canDelete('projects') && <Button size="sm" variant="outline" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDelId('__bulk__')} className="text-red-600 border-red-300 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/30">Delete</Button>}
              <button onClick={() => setSelected(new Set())} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] ml-1">✕ Clear</button>
            </div>
          </div>
        )}
        <div className="px-6 flex-1 flex flex-col min-h-0">
          <div className="min-h-0 flex-1 overflow-auto scroll-pt-10">
            <Table>
              <Thead>
                <Th style={{ width: 44, minWidth: 44, maxWidth: 44 }}><UniversalCheckbox checked={allSel} indeterminate={selected.size > 0 && !allSel} onChange={toggleAll} ariaLabel="Select visible contracts" /></Th>
                <Th sortable sorted={sortKey === 'contractNumber'} desc={sortDesc} onSort={() => sort('contractNumber')} style={{ width: '16%', minWidth: 130 }}>CONTRACT</Th>
                <Th sortable sorted={sortKey === 'customerName'} desc={sortDesc} onSort={() => sort('customerName')} style={{ width: '20%', minWidth: 180 }}>CUSTOMER</Th>
                <Th style={{ width: '14%', minWidth: 120 }}>VALUE</Th>
                <Th style={{ width: '14%', minWidth: 130 }}>PERIOD</Th>
                <Th sortable sorted={sortKey === 'status'} desc={sortDesc} onSort={() => sort('status')} style={{ width: 100, minWidth: 100 }}>STATUS</Th>
                <Th style={{ width: '12%', minWidth: 130 }}>ASSIGNED</Th>
                <Th sortable sorted={sortKey === 'createdAt'} desc={sortDesc} onSort={() => sort('createdAt')} style={{ width: 90, minWidth: 90 }}>CREATED</Th>
                <Th align="right" style={{ width: 130, minWidth: 130 }}>ACTIONS</Th>
              </Thead>
              <Tbody>
                {isLoading ? <SkeletonRows cols={9} />
                  : paginated.length === 0 ? (
                    <tr><td colSpan={9} className="py-14 text-center">
                      <EmptyState icon={<CalendarCheck className="h-9 w-9" />}
                        title={search || statusF || activeKpi ? 'No contracts match filters' : 'No AMC contracts yet'}
                        description={search || statusF || activeKpi ? undefined : 'Create your first AMC contract to get started.'}
                        action={!search && !statusF && !activeKpi && perms.canCreate('projects') ? <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setForm({ ...FORM0 }); setShowForm(true); }} className="mt-2">Create Your First Contract</Button> : undefined}
                      />
                    </td></tr>
                  ) : paginated.map((c: any) => {
                    const expiring = c.status === 'Active' && daysUntilExpiry(c.endDate) <= 30;
                    const inactive = isInactive(c.status);
                    return (
                      <Tr key={c.id} selected={selected.has(c.id)} role="button" tabIndex={0}
                        onClick={e => handleRowClick(e, c)} onKeyDown={e => handleRowKeyDown(e, c)}
                        className={['transition-colors duration-150', expiring ? 'bg-[rgba(251,146,60,0.04)] border-l-[3px] border-l-orange-500' : '', inactive ? 'opacity-60' : ''].join(' ')}
                      >
                        <Td className="py-3" onClick={e => e.stopPropagation()}><UniversalCheckbox checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} ariaLabel={`Select ${c.contractNumber}`} /></Td>
                        <Td className="py-3"><span className="font-mono text-xs font-semibold text-[var(--color-primary-text)]">{c.contractNumber}</span></Td>
                        <Td className="py-3 min-w-[180px]">
                          <div className="flex items-center gap-2.5">
                            <div className="h-7 w-7 shrink-0 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary-text)] flex items-center justify-center text-[11px] font-bold">{(c.customerName || '?')[0].toUpperCase()}</div>
                            <div className="flex flex-col gap-0.5">
                              <span className="text-sm font-medium text-[var(--color-text)] leading-tight">{c.customerName || '—'}</span>
                              <span className="text-[12px] text-[var(--color-text-muted)] leading-tight">{c.projectName}</span>
                            </div>
                          </div>
                        </Td>
                        <Td className="py-3"><span className="text-xs font-medium">{fmtCurrency(c.contractValue)}</span></Td>
                        <Td className="py-3">
                          <span className={['text-xs whitespace-nowrap', expiring ? 'font-semibold text-orange-600 dark:text-orange-400' : 'text-[var(--color-text-muted)]'].join(' ')}>
                            {fmtDate(c.startDate)} – {fmtDate(c.endDate)}
                            {expiring && <span className="ml-1" title="Expiring soon"><AlertTriangle className="h-3 w-3 inline text-orange-500" /></span>}
                          </span>
                        </Td>
                        <Td className="py-3" onClick={e => e.stopPropagation()}>{statusBadge(c.status)}</Td>
                        <Td className="py-3 text-[13px] text-[var(--color-text-secondary)] whitespace-nowrap">{c.assignedToName || <span className="inline-flex items-center rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-text-muted)]">Unassigned</span>}</Td>
                        <Td className="py-3">
                          <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] whitespace-nowrap">
                            <span className={`h-1.5 w-1.5 rounded-full ${recDot(c.createdAt)}`} />{fmtCreated(c.createdAt)}
                          </span>
                        </Td>
                        <Td className="py-3" onClick={e => e.stopPropagation()}><div className="flex items-center justify-end"><Button size="xs" variant="outline" onClick={() => navigate(`/amc-contracts/${encodeURIComponent(c.id)}`)}><FileText className="h-3.5 w-3.5 mr-1" />View</Button></div></Td>
                      </Tr>
                    );
                  })}
              </Tbody>
            </Table>
          </div>
          <div className="shrink-0 border-t border-[var(--color-border-subtle)]">
            <Pagination page={page} total={filtered.length} perPage={perPage} onChange={n => { setPage(n); syncQueueParams({ page: n }); }} onPerPageChange={n => { setPerPage(n); setPage(1); syncQueueParams({ perPage: n, page: 1 }); }} />
          </div>
        </div>
      </Card>

      {/* Create/Edit Modal */}
      <Modal open={showForm} onClose={closeForm} title="New AMC Contract" size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Select label="Project" required value={form.projectId} onChange={e => { const p = (projects as any[]).find((x: any) => x.id === e.target.value); setForm({ ...form, projectId: e.target.value, projectName: p?.projectId || p?.name || e.target.value, customerId: p?.customerId || '', customerName: p?.customerName || p?.customer || '' }); }} options={[{ label: 'Select project...', value: '' }, ...eligibleProjects.map((p: any) => ({ label: `${p.projectId || p.name || p.id} — ${p.customerName || p.customer || ''}`, value: p.id }))]} />
          <Input label="Customer Name" required value={form.customerName} onChange={e => setForm({ ...form, customerName: e.target.value })} />
          <Input label="Start Date" type="date" required value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} />
          <Input label="End Date" type="date" required value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} />
          <Input label="Visits per Year" type="number" required value={String(form.visitsPerYear)} onChange={e => setForm({ ...form, visitsPerYear: Number(e.target.value) })} min={0} />
          <Input label="Contract Value" type="number" required value={String(form.contractValue)} onChange={e => setForm({ ...form, contractValue: Number(e.target.value) })} min={0} step="0.01" />
          <Input label="Assigned To" value={form.assignedToName || ''} onChange={e => setForm({ ...form, assignedToName: e.target.value, assignedTo: e.target.value })} placeholder="Engineer or technician name" />
          <Textarea label="Notes" value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} />
          <div className="flex justify-end gap-2 pt-2"><Button variant="outline" type="button" onClick={closeForm}>Cancel</Button><Button type="submit" loading={save.isPending}>Create Contract</Button></div>
        </form>
      </Modal>

      <Modal open={showBulkStatus} onClose={() => setShowBulkStatus(false)} title="Change Status" size="sm">
        <div className="space-y-4">
          <Select label="New Status" value={bulkStatus} onChange={e => setBulkStatus(e.target.value)} options={[{ label: 'Select status...', value: '' }, ...AMC_STATUSES.map(s => ({ label: s, value: s }))]} />
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => { setShowBulkStatus(false); setBulkStatus(''); }}>Cancel</Button><Button loading={bulkStatusMutation.isPending} onClick={() => { if (!bulkStatus) return toast.error('Select a status'); bulkStatusMutation.mutate({ ids: Array.from(selected), status: bulkStatus }); }}>Update {selected.size} Contracts</Button></div>
        </div>
      </Modal>

      <Modal open={showBulkAssign} onClose={() => setShowBulkAssign(false)} title="Assign Contracts" size="sm">
        <div className="space-y-4">
          <Select label="Assign To" value={bulkAssignId} onChange={e => { const a = salesUsers.find((u: any) => u.id === e.target.value); setBulkAssignId(e.target.value); setBulkAssignName(a?.name || ''); }} options={[{ label: 'Select user...', value: '' }, ...salesUsers.map((u: any) => ({ label: u.name, value: u.id }))]} />
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setShowBulkAssign(false)}>Cancel</Button><Button loading={bulkAssignMutation.isPending} onClick={() => { if (!bulkAssignId) return toast.error('Select a user'); bulkAssignMutation.mutate({ ids: Array.from(selected), userId: bulkAssignId, userName: bulkAssignName }); }}>Assign {selected.size} Contracts</Button></div>
        </div>
      </Modal>

      <ConfirmDialog open={!!delId} onClose={() => setDelId(null)}
        onConfirm={() => {
          if (delId === '__bulk__') {
            Promise.all(Array.from(selected).map(id => del.mutateAsync(id))).then(() => { setSelected(new Set()); setDelId(null); }).catch(() => { });
          } else if (delId) {
            del.mutate(delId);
          }
        }}
        loading={del.isPending} title="Delete Contract" message={delId === '__bulk__' ? `Delete ${selected.size} selected contracts permanently?` : 'Delete this contract permanently?'}
      />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-sm font-medium text-[var(--color-text)]">{value}</p>
    </div>
  );
}
