/**
 * ServiceTickets.tsx — Desktop Service Tickets page (Leads Gold Standard)
 */
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Wrench, Plus, Trash2, Download, RefreshCw,
  FileText, X, Users, ListChecks,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  Button, Card, CardHeader, ConfirmDialog, EmptyState, Modal,
  Pagination, PremiumKpi, Select, SkeletonRows,
  Table, Thead, Th, Tbody, Tr, Td, UniversalCheckbox,
  WorkspaceHero, statusBadge,
} from '../components/ui';
import { Input, Textarea } from '../components/ui/Input';
import { fmtDate, getAll, deleteDocById } from '../lib/firestore';
import { usePermissions } from '../lib/permissions';
import { useCurrentUser } from '../store/useAppStore';
import { useServiceTickets, useCreateServiceTicket, useTransitionServiceTicket } from '../features/service-tickets/hooks/useServiceTickets';
import type { ServiceTicketCreateInput, ServiceTicketRecord, TicketStatus } from '../lib/serviceTicketWorkflow';
import { isValidTransition, reassignServiceTicket } from '../lib/serviceTicketWorkflow';
import { COLLECTIONS } from '../lib/firebase';
import { isInDateRange } from '../lib/dateFilters';
import { useProjects } from '../features/projects/hooks/useProjects';

const PER_PAGE = 15;
const TICKET_STATUSES: TicketStatus[] = ['Open', 'InProgress', 'Resolved', 'Closed', 'Cancelled'];
const PRIORITIES: Array<'Low' | 'Medium' | 'High' | 'Urgent'> = ['Low', 'Medium', 'High', 'Urgent'];
const ISSUE_TYPES = ['Warranty Claim', 'Fault Repair', 'Cleaning', 'Inspection', 'Performance Issue', 'Other'];

const FORM0: ServiceTicketCreateInput = {
  projectId: '', projectName: '', customerId: '', customerName: '',
  issueType: 'Fault Repair' as any, description: '', priority: 'Medium' as any,
  assignedTechnicianName: '', notes: '',
};

function isInactive(s: string) { return s === 'Cancelled' || s === 'Closed'; }
function isRowOpenIgnored(t: EventTarget | null) {
  if (!(t instanceof HTMLElement)) return false;
  return Boolean(t.closest('button,a,input,select,textarea,[data-action],[data-interactive]'));
}
function downloadCsv(rows: ServiceTicketRecord[], fn: string) {
  const h = ['Ticket Number', 'Customer', 'Project', 'Issue Type', 'Priority', 'Status', 'Assigned To', 'Reported Date'];
  const l = rows.map(t =>
    [t.ticketNumber, t.customerName, t.projectName, t.issueType, t.priority, t.status, t.assignedTechnicianName || '', t.reportedDate]
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
function priorityBadge(p: string) {
  return `inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold ${
    p === 'Urgent' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' :
    p === 'High' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' :
    p === 'Medium' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' :
    'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
  }`;
}

export default function ServiceTickets() {
  const qc = useQueryClient();
  const user = useCurrentUser();
  const perms = usePermissions();
  const [sp, setSp] = useSearchParams();
  const openParam = sp.get('open') || '';
  const createParam = sp.get('create') || '';

  const [search, setSearch] = useState(() => sp.get('q') || '');
  const [statusF, setStatusF] = useState(() => sp.get('status') || '');
  const [assignF, setAssignF] = useState(() => sp.get('owner') || '');
  const [priorityF, setPriorityF] = useState(() => sp.get('priority') || '');
  const [dateRange, setDateRange] = useState(() => sp.get('date') || 'all');
  const [customFrom, setCustomFrom] = useState(() => sp.get('from') || '');
  const [customTo, setCustomTo] = useState(() => sp.get('to') || '');
  const [activeKpi, setActiveKpi] = useState(() => sp.get('kpi') || '');
  const [page, setPage] = useState(() => Math.max(1, Number(sp.get('page')) || 1));
  const [perPage, setPerPage] = useState(() => Math.max(1, Number(sp.get('perPage')) || PER_PAGE));
  const [sortKey, setSortKey] = useState('reportedDate');
  const [sortDesc, setSortDesc] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...FORM0 });
  const [viewItem, setViewItem] = useState<ServiceTicketRecord | null>(null);
  const [delId, setDelId] = useState<string | null>(null);
  const [detailsTab, setDetailsTab] = useState<'overview' | 'activity' | 'notes' | 'documents' | 'history'>('overview');
  const [showBulkStatus, setShowBulkStatus] = useState(false);
  const [showBulkAssign, setShowBulkAssign] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkAssignId, setBulkAssignId] = useState('');
  const [bulkAssignName, setBulkAssignName] = useState('');

  const { data: tickets = [], isLoading, refetch } = useServiceTickets();
  const { data: projects = [] } = useProjects();
  const createMut = useCreateServiceTicket();
  const transitionMut = useTransitionServiceTicket();
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => getAll(COLLECTIONS.USERS), staleTime: 300000 });
  const userClosedRef = useRef(false);

  const eligibleProjects = useMemo(
    () => (projects as any[]).filter((p: any) => ['Handover', 'AMC', 'Service', 'Monitoring'].includes(p.currentStage)),
    [projects],
  );
  const salesUsers = useMemo(
    () => (users as any[])
      .filter((u: any) => ['Sales', 'Executive', 'BDE', 'BDM', 'Manager', 'TL', 'Operations', 'Technician'].includes(u.role) && u.status !== 'Inactive' && !u.isDeleted)
      .sort((a: any, b: any) => a.name.localeCompare(b.name)),
    [users],
  );

  function syncQueueParams(ns: { q?: string; status?: string; owner?: string; priority?: string; date?: string; from?: string; to?: string; kpi?: string; page?: number; perPage?: number }) {
    const n = new URLSearchParams(sp);
    const q = ns.q ?? search; const s = ns.status ?? statusF; const o = ns.owner ?? assignF;
    const p = ns.priority ?? priorityF; const d = ns.date ?? dateRange;
    const f = ns.from ?? customFrom; const t = ns.to ?? customTo;
    const k = ns.kpi ?? activeKpi; const np = ns.page ?? page; const npp = ns.perPage ?? perPage;
    if (q) n.set('q', q); else n.delete('q');
    if (s) n.set('status', s); else n.delete('status');
    if (o) n.set('owner', o); else n.delete('owner');
    if (p) n.set('priority', p); else n.delete('priority');
    if (d && d !== 'all') n.set('date', d); else n.delete('date');
    if (f) n.set('from', f); else n.delete('from');
    if (t) n.set('to', t); else n.delete('to');
    if (k) n.set('kpi', k); else n.delete('kpi');
    if (np > 1) n.set('page', String(np)); else n.delete('page');
    if (npp !== PER_PAGE) n.set('perPage', String(npp)); else n.delete('perPage');
    setSp(n, { replace: true });
  }

  useEffect(() => { if (createParam !== '1') return; setForm({ ...FORM0 }); setEditId(null); setShowForm(true); }, [createParam]);
  function closeForm() { setShowForm(false); setEditId(null); setForm({ ...FORM0 }); if (createParam === '1') { const n = new URLSearchParams(sp); n.delete('create'); setSp(n, { replace: true }); } }

  function handleProjectSelect(projectId: string) {
    const project = (projects as any[]).find((p: any) => p.id === projectId);
    setForm({ ...form, projectId, projectName: project?.projectId || project?.name || projectId, customerId: project?.customerId || '', customerName: project?.customerName || project?.customer || '' });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); if (createMut.isPending) return;
    if (!form.projectId) return toast.error('Please select a project');
    if (!form.customerName) return toast.error('Customer name is required');
    if (!form.issueType) return toast.error('Issue type is required');
    if (!form.description) return toast.error('Description is required');
    createMut.mutate(form, { onSuccess: () => { qc.invalidateQueries({ queryKey: ['service_tickets'] }); toast.success('Ticket created'); closeForm(); }, onError: (e: any) => toast.error(e.message) });
  }

  const del = useMutation({
    mutationFn: async (id: string) => { await deleteDocById(COLLECTIONS.SERVICE_TICKETS, id); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['service_tickets'] }); toast.success('Deleted'); setDelId(null); setSelected(new Set()); },
    onError: (e: any) => toast.error(e.message),
  });

  function handleTransition(ticketId: string, nextStatus: TicketStatus) {
    const p: any = { ticketId, nextStatus };
    if (nextStatus === 'Cancelled') { const r = prompt('Enter cancellation reason:'); if (r === null) return; p.note = r || 'Cancelled by user'; }
    if (nextStatus === 'Resolved' || nextStatus === 'Closed') { const r = prompt('Enter resolution note (optional):'); p.note = r || ''; }
    transitionMut.mutate(p, { onSuccess: () => closeTicketDetails() });
  }

  function closeTicketDetails() { userClosedRef.current = true; setViewItem(null); if (!openParam) return; const n = new URLSearchParams(sp); n.delete('open'); setSp(n, { replace: true }); }
  function openTicketDetails(t: ServiceTicketRecord) {
    userClosedRef.current = false; setViewItem(t); setDetailsTab('overview'); if (!t?.id) return;
    const n = new URLSearchParams(sp); n.set('open', t.id);
    if (search) n.set('q', search); else n.delete('q'); if (statusF) n.set('status', statusF); else n.delete('status');
    if (assignF) n.set('owner', assignF); else n.delete('owner'); if (priorityF) n.set('priority', priorityF); else n.delete('priority');
    if (dateRange && dateRange !== 'all') n.set('date', dateRange); else n.delete('date');
    if (customFrom) n.set('from', customFrom); else n.delete('from'); if (customTo) n.set('to', customTo); else n.delete('to');
    if (activeKpi) n.set('kpi', activeKpi); else n.delete('kpi');
    if (page > 1) n.set('page', String(page)); else n.delete('page');
    if (perPage !== PER_PAGE) n.set('perPage', String(perPage)); else n.delete('perPage');
    setSp(n, { replace: true });
  }
  useEffect(() => {
    if (userClosedRef.current) { userClosedRef.current = false; return; }
    if (!openParam || isLoading) return;
    const t = (tickets as ServiceTicketRecord[]).find(x => x.id === openParam);
    if (!t) return; setViewItem(t); setDetailsTab('overview');
  }, [openParam, isLoading, tickets]);

  function handleRowClick(e: React.MouseEvent<HTMLTableRowElement>, t: ServiceTicketRecord) { if (window.getSelection()?.toString()) return; if (isRowOpenIgnored(e.target)) return; openTicketDetails(t); }
  function handleRowKeyDown(e: React.KeyboardEvent<HTMLTableRowElement>, t: ServiceTicketRecord) { if (isRowOpenIgnored(e.target)) return; if (e.key !== 'Enter' && e.key !== ' ') return; e.preventDefault(); openTicketDetails(t); }
  function sort(k: string) { if (sortKey === k) { setSortDesc(d => !d); } else { setSortKey(k); setSortDesc(true); } }
  function clearAll() {
    setSearch(''); setStatusF(''); setAssignF(''); setPriorityF('');
    setDateRange('all'); setCustomFrom(''); setCustomTo(''); setActiveKpi(''); setPage(1);
    syncQueueParams({ q: '', status: '', owner: '', priority: '', date: 'all', from: '', to: '', kpi: '', page: 1 });
  }

  const filtered = useMemo(() => {
    let list = [...(tickets as ServiceTicketRecord[])];
    if (activeKpi) {
      if (activeKpi === 'Assigned') {
        list = list.filter(t => (t.assignedTechnicianName || t.assignedTechnician || '').length > 0);
      } else {
        list = list.filter(t => t.status === activeKpi);
      }
    }
    const q = search.toLowerCase();
    if (q) list = list.filter(t => [t.ticketNumber, t.customerName, t.projectName, t.issueType, t.assignedTechnicianName].some(v => String(v || '').toLowerCase().includes(q)));
    if (statusF) list = list.filter(t => t.status === statusF);
    if (priorityF) list = list.filter(t => t.priority === priorityF);
    if (assignF) list = list.filter(t => t.assignedTechnicianName === assignF || t.assignedTechnician === assignF);
    if (dateRange !== 'all') list = list.filter(t => isInDateRange(t.reportedDate || t.createdAt, dateRange as any, customFrom, customTo));
    list.sort((a, b) => { const aV = String(a[sortKey as keyof ServiceTicketRecord] || ''), bV = String(b[sortKey as keyof ServiceTicketRecord] || ''); return sortDesc ? bV.localeCompare(aV) : aV.localeCompare(bV); });
    return list;
  }, [tickets, search, statusF, assignF, priorityF, dateRange, customFrom, customTo, activeKpi, sortKey, sortDesc]);

  const paginated = filtered.slice((page - 1) * perPage, page * perPage);
  const stats = useMemo(() => ({
    total: tickets.length, open: tickets.filter(t => t.status === 'Open').length,
    assigned: tickets.filter(t => (t.assignedTechnicianName || t.assignedTechnician || '').length > 0).length,
    inProgress: tickets.filter(t => t.status === 'InProgress').length,
    resolved: tickets.filter(t => t.status === 'Resolved').length,
    closed: tickets.filter(t => t.status === 'Closed').length,
  }), [tickets]);

  const isTotalDefault = useMemo(() => !activeKpi && !search && !statusF && !assignF && !priorityF && dateRange === 'all', [activeKpi, search, statusF, assignF, priorityF, dateRange]);
  const activeFilterCount = useMemo(() => { let c = 0; if (search) c++; if (statusF) c++; if (assignF) c++; if (priorityF) c++; if (dateRange !== 'all') c++; if (activeKpi) c++; return c; }, [search, statusF, assignF, priorityF, dateRange, activeKpi]);

  const KPI_TILES = [
    { key: '', label: 'TOTAL', icon: <Wrench className="h-4 w-4" />, value: stats.total, description: `${stats.total} total tickets` },
    { key: 'Open', label: 'OPEN', icon: <FileText className="h-4 w-4" />, value: stats.open, description: 'Open tickets' },
    { key: 'Assigned', label: 'ASSIGNED', icon: <Users className="h-4 w-4" />, value: stats.assigned, description: 'Assigned tickets' },
    { key: 'InProgress', label: 'IN PROGRESS', icon: <RefreshCw className="h-4 w-4" />, value: stats.inProgress, description: 'In progress' },
    { key: 'Resolved', label: 'RESOLVED', icon: <ListChecks className="h-4 w-4" />, value: stats.resolved, description: 'Resolved tickets' },
    { key: 'Closed', label: 'CLOSED', icon: <X className="h-4 w-4" />, value: stats.closed, description: 'Closed tickets' },
  ];

  const toggleSelect = useCallback((id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);
  const toggleAll = () => setSelected(s => s.size === paginated.length ? new Set() : new Set(paginated.map(t => t.id)));
  const allSel = selected.size === paginated.length && paginated.length > 0;

  function exportSelected() {
    const rows = (tickets as ServiceTicketRecord[]).filter(t => selected.has(t.id));
    if (!rows.length) return toast.error('No tickets selected');
    downloadCsv(rows, `service-tickets-export-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${rows.length} ticket${rows.length > 1 ? 's' : ''}`);
  }

  const bulkStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      await Promise.all(ids.map(id => {
        const t = (tickets as ServiceTicketRecord[]).find(x => x.id === id);
        if (!t || !isValidTransition(t.status as TicketStatus, status as TicketStatus)) throw new Error(`Cannot transition to ${status}`);
        return transitionMut.mutateAsync({ ticketId: id, nextStatus: status as TicketStatus });
      }));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['service_tickets'] }); toast.success(`Updated ${selected.size} tickets`); setShowBulkStatus(false); setBulkStatus(''); setSelected(new Set()); },
    onError: (e: any) => toast.error(e.message),
  });
  const bulkAssignMutation = useMutation({
    mutationFn: async ({ ids, userId, userName }: { ids: string[]; userId: string; userName: string }) => {
      await Promise.all(ids.map(id => reassignServiceTicket(id, userId, userName)));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['service_tickets'] }); toast.success(`Assigned ${selected.size} tickets to ${bulkAssignName}`); setShowBulkAssign(false); setBulkAssignId(''); setBulkAssignName(''); setSelected(new Set()); },
    onError: (e: any) => toast.error(e.message),
  });

  const assignOptions = [{ label: 'All Assigned', value: '' }, ...salesUsers.map((u: any) => ({ label: u.name, value: u.id }))];
  const priorityOptions = [{ label: 'All Priorities', value: '' }, ...PRIORITIES.map(p => ({ label: p, value: p }))];
  const DATE_OPTIONS = [
    { label: 'All dates', value: 'all' }, { label: 'Today', value: 'today' },
    { label: 'Last 7 days', value: 'week' }, { label: 'Last 30 days', value: 'month' },
    { label: 'Custom', value: 'custom' },
  ];
  function handleDateChange(v: string) { setDateRange(v); setPage(1); if (v !== 'custom') { setCustomFrom(''); setCustomTo(''); } syncQueueParams({ date: v, from: '', to: '', page: 1 }); }

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      <WorkspaceHero title="Service Tickets" icon={<Wrench className="h-6 w-6" />}
        breadcrumbs={['Home', 'Post Sales', 'Service Tickets']}
        statusText="Last sync · Realtime Connected" statusDotColor="var(--color-success)" className="gap-3"
        actions={
          <>
            <Button variant="outline" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => refetch()}>Refresh</Button>
            {perms.canCreate('projects') && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setForm({ ...FORM0 }); setEditId(null); setShowForm(true); }}>New Ticket</Button>}
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
            <input aria-label="Search tickets" placeholder="Search ticket number, customer, project, issue..."
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
            <Select aria-label="Status" value={statusF} onChange={e => { const v = e.target.value; setStatusF(v); if (v && activeKpi && v !== activeKpi) { setActiveKpi(''); setPage(1); syncQueueParams({ status: v, kpi: '', page: 1 }); } else { setPage(1); syncQueueParams({ status: v, page: 1 }); } }} options={[{ label: 'All Status', value: '' }, ...TICKET_STATUSES.map(s => ({ label: s === 'InProgress' ? 'In Progress' : s, value: s }))]} className="w-[120px] h-8 py-1" />
            <Select aria-label="Priority" value={priorityF} onChange={e => { setPriorityF(e.target.value); setPage(1); syncQueueParams({ priority: e.target.value, page: 1 }); }} options={priorityOptions} className="w-[110px] h-8 py-1" />
            <Select aria-label="Assigned" value={assignF} onChange={e => { setAssignF(e.target.value); setPage(1); syncQueueParams({ owner: e.target.value, page: 1 }); }} options={assignOptions} className="w-[120px] h-8 py-1" />
            {activeFilterCount > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {activeKpi && <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary-light)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-primary-text)]">{KPI_TILES.find(t => t.key === activeKpi)?.label || activeKpi}<button type="button" onClick={() => { setActiveKpi(''); setPage(1); syncQueueParams({ kpi: '', page: 1 }); }} className="ml-0.5 hover:opacity-70"><X className="h-2.5 w-2.5" /></button></span>}
                {search && <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">S: {search.slice(0, 12)}{search.length > 12 ? '…' : ''}</span>}
                {statusF && !activeKpi && <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">{statusF === 'InProgress' ? 'In Progress' : statusF}</span>}
                {priorityF && <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">{priorityF}</span>}
                <button type="button" onClick={clearAll} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"><X className="h-2.5 w-2.5" /> Clear</button>
              </div>
            )}
          </div>
        </CardHeader>
        {selected.size > 0 && (
          <div className="px-6 py-2.5 flex items-center gap-3 bg-[var(--color-primary-light)] border-b border-[var(--color-primary-muted)]">
            <span className="text-sm font-semibold text-[var(--color-primary-text)]">{selected.size} ticket{selected.size > 1 ? 's' : ''} selected</span>
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
                <Th style={{ width: 44, minWidth: 44, maxWidth: 44 }}><UniversalCheckbox checked={allSel} indeterminate={selected.size > 0 && !allSel} onChange={toggleAll} ariaLabel="Select visible tickets" /></Th>
                <Th sortable sorted={sortKey === 'ticketNumber'} desc={sortDesc} onSort={() => sort('ticketNumber')} style={{ width: '14%', minWidth: 110 }}>TICKET</Th>
                <Th sortable sorted={sortKey === 'customerName'} desc={sortDesc} onSort={() => sort('customerName')} style={{ width: '22%', minWidth: 200 }}>CUSTOMER</Th>
                <Th style={{ width: '14%', minWidth: 120 }}>ISSUE</Th>
                <Th style={{ width: 80, minWidth: 80 }}>PRIORITY</Th>
                <Th sortable sorted={sortKey === 'status'} desc={sortDesc} onSort={() => sort('status')} style={{ width: 100, minWidth: 100 }}>STATUS</Th>
                <Th style={{ width: '12%', minWidth: 120 }}>ASSIGNED</Th>
                <Th sortable sorted={sortKey === 'reportedDate'} desc={sortDesc} onSort={() => sort('reportedDate')} style={{ width: 90, minWidth: 90 }}>DATE</Th>
                <Th align="right" style={{ width: 130, minWidth: 130 }}>ACTIONS</Th>
              </Thead>
              <Tbody>
                {isLoading ? <SkeletonRows cols={9} />
                  : paginated.length === 0 ? (
                    <tr><td colSpan={9} className="py-14 text-center">
                      <EmptyState icon={<Wrench className="h-9 w-9" />}
                        title={search || statusF || activeKpi ? 'No tickets match filters' : 'No service tickets yet'}
                        description={search || statusF || activeKpi ? undefined : 'Create your first service ticket to get started.'}
                        action={!search && !statusF && !activeKpi && perms.canCreate('projects') ? <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setForm({ ...FORM0 }); setEditId(null); setShowForm(true); }} className="mt-2">Create Your First Ticket</Button> : undefined}
                      />
                    </td></tr>
                  ) : paginated.map((t: any) => {
                    const inactive = isInactive(t.status);
                    const urgent = t.priority === 'Urgent' || t.priority === 'High';
                    return (
                      <Tr key={t.id} selected={selected.has(t.id)} role="button" tabIndex={0}
                        onClick={e => handleRowClick(e, t)} onKeyDown={e => handleRowKeyDown(e, t)}
                        className={['transition-colors duration-150', urgent && t.status === 'Open' ? 'bg-amber-50/40 dark:bg-amber-900/10 border-l-[3px] border-l-amber-400 dark:border-l-amber-600' : '', inactive ? 'opacity-60' : ''].join(' ')}
                      >
                        <Td className="py-3" onClick={e => e.stopPropagation()}><UniversalCheckbox checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)} ariaLabel={`Select ${t.ticketNumber}`} /></Td>
                        <Td className="py-3"><span className="font-mono text-xs font-semibold text-[var(--color-primary-text)]">{t.ticketNumber}</span></Td>
                        <Td className="py-3 min-w-[200px]">
                          <div className="flex items-center gap-2.5">
                            <div className="h-7 w-7 shrink-0 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary-text)] flex items-center justify-center text-[11px] font-bold">{(t.customerName || '?')[0].toUpperCase()}</div>
                            <div className="flex flex-col gap-0.5">
                              <span className="text-sm font-medium text-[var(--color-text)] leading-tight">{t.customerName || '—'}</span>
                              <span className="text-[12px] text-[var(--color-text-muted)] leading-tight">{t.projectName}</span>
                            </div>
                          </div>
                        </Td>
                        <Td className="py-3"><span className="text-[13px] text-[var(--color-text-secondary)] max-w-[200px] truncate inline-block">{t.issueType}</span></Td>
                        <Td className="py-3"><span className={priorityBadge(t.priority)}>{t.priority}</span></Td>
                        <Td className="py-3" onClick={e => e.stopPropagation()}>{statusBadge(t.status === 'InProgress' ? 'InProgress' : t.status)}</Td>
                        <Td className="py-3 text-[13px] text-[var(--color-text-secondary)] whitespace-nowrap">{t.assignedTechnicianName || <span className="inline-flex items-center rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-text-muted)]">Unassigned</span>}</Td>
                        <Td className="py-3">
                          <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] whitespace-nowrap">
                            <span className={`h-1.5 w-1.5 rounded-full ${recDot(t.reportedDate || t.createdAt)}`} />{fmtCreated(t.reportedDate)}
                          </span>
                        </Td>
                        <Td className="py-3" onClick={e => e.stopPropagation()}><div className="flex items-center justify-end"><Button size="xs" variant="outline" onClick={() => openTicketDetails(t)}><FileText className="h-3.5 w-3.5 mr-1" />View</Button></div></Td>
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

      {/* Create Modal */}
      <Modal open={showForm} onClose={closeForm} title="New Service Ticket" size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Select label="Project" required value={form.projectId} onChange={e => handleProjectSelect(e.target.value)}
            options={[{ label: 'Select project...', value: '' }, ...eligibleProjects.map((p: any) => ({ label: `${p.projectId || p.name || p.id} — ${p.customerName || p.customer || ''}`, value: p.id }))]} />
          <Input label="Customer Name" required value={form.customerName} onChange={e => setForm({ ...form, customerName: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Select label="Issue Type" required value={form.issueType} onChange={e => setForm({ ...form, issueType: e.target.value })} options={ISSUE_TYPES.map(t => ({ label: t, value: t }))} />
            <Select label="Priority" required value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value as any })} options={PRIORITIES.map(p => ({ label: p, value: p }))} />
          </div>
          <Textarea label="Description" required value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3} />
          <Input label="Assign Technician" value={form.assignedTechnicianName || ''} onChange={e => setForm({ ...form, assignedTechnicianName: e.target.value, assignedTechnician: e.target.value })} placeholder="Technician name" />
          <Textarea label="Notes" value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} />
          <div className="flex justify-end gap-2 pt-2"><Button variant="outline" type="button" onClick={closeForm}>Cancel</Button><Button type="submit" loading={createMut.isPending}>Create Ticket</Button></div>
        </form>
      </Modal>

      {/* Detail Modal */}
      <Modal open={!!viewItem} onClose={closeTicketDetails} size="2xl">
        {viewItem && (() => {
          const tabs = [{ key: 'overview', label: 'Overview' }, { key: 'activity', label: 'Activity' }, { key: 'notes', label: 'Notes' }, { key: 'documents', label: 'Documents' }, { key: 'history', label: 'History' }] as const;
          return (
            <div className="flex h-[78vh] max-h-[760px] min-h-0 flex-col text-sm text-[var(--color-text-secondary)]">
              <header className="shrink-0 flex flex-col gap-5 border-b border-[var(--color-border-subtle)] pb-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 gap-4">
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-light)] text-3xl font-bold text-[var(--color-primary-text)] ring-1 ring-[var(--color-primary-muted)]"><Wrench className="h-8 w-8" /></div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-2xl font-bold text-[var(--color-text)]">{viewItem.ticketNumber}</h2>{statusBadge(viewItem.status === 'InProgress' ? 'InProgress' : viewItem.status)}<span className={priorityBadge(viewItem.priority)}>{viewItem.priority}</span></div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]"><span>{viewItem.customerName} · {viewItem.projectName}</span><span>{viewItem.issueType}</span></div>
                  </div>
                </div>
                <div className="flex shrink-0 items-start gap-2" data-action>
                  <button onClick={closeTicketDetails} className="rounded-xl p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]" aria-label="Close"><X className="h-4 w-4" /></button>
                </div>
              </header>
              <nav className="shrink-0 grid grid-cols-5 gap-1 border-b border-[var(--color-border-subtle)] py-4">
                {tabs.map(tab => (
                  <button key={tab.key} type="button" onClick={() => setDetailsTab(tab.key)}
                    className={['rounded-lg px-2 py-2 text-center text-xs font-semibold transition-colors', detailsTab === tab.key ? 'text-[var(--color-primary-text)] shadow-[inset_0_-2px_0_var(--color-primary)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]'].join(' ')}>{tab.label}</button>
                ))}
              </nav>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {detailsTab === 'overview' && (
                  <div className="grid gap-5 pt-5 lg:grid-cols-[minmax(0,1fr)_300px]">
                    <div className="space-y-5">
                      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Ticket Details</h3>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <Detail label="Customer" value={viewItem.customerName} />
                          <Detail label="Project" value={viewItem.projectName} />
                          <Detail label="Issue Type" value={viewItem.issueType} />
                          <Detail label="Reported" value={fmtDate(viewItem.reportedDate)} />
                          <Detail label="Assigned Technician" value={viewItem.assignedTechnicianName || '—'} />
                          {viewItem.amcContractNumber && <Detail label="AMC Contract" value={viewItem.amcContractNumber} />}
                        </div>
                      </section>
                      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Description</h3>
                        <div className="mt-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3 whitespace-pre-wrap text-[var(--color-text)]">{viewItem.description || 'No description provided.'}</div>
                      </section>
                      {viewItem.notes && (
                        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                          <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Notes</h3>
                          <p className="mt-3 whitespace-pre-wrap rounded-xl bg-[var(--color-bg-sunken)] p-4 text-[var(--color-text-secondary)]">{viewItem.notes}</p>
                        </section>
                      )}
                    </div>
                    <aside className="space-y-4">
                      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Quick Actions</h3>
                        <div className="mt-3 space-y-2">
                          {perms.canEdit('projects') && isValidTransition(viewItem.status as TicketStatus, 'InProgress') && <Button size="sm" className="w-full justify-start" onClick={() => handleTransition(viewItem.id, 'InProgress')}>Start</Button>}
                          {perms.canEdit('projects') && isValidTransition(viewItem.status as TicketStatus, 'Resolved') && <Button size="sm" className="w-full justify-start" onClick={() => handleTransition(viewItem.id, 'Resolved')}>Mark Resolved</Button>}
                          {perms.canEdit('projects') && isValidTransition(viewItem.status as TicketStatus, 'Closed') && <Button size="sm" variant="outline" className="w-full justify-start" onClick={() => handleTransition(viewItem.id, 'Closed')}>Close Ticket</Button>}
                          {perms.canEdit('projects') && isValidTransition(viewItem.status as TicketStatus, 'Cancelled') && <Button size="sm" variant="danger" className="w-full justify-start" onClick={() => handleTransition(viewItem.id, 'Cancelled')}>Cancel Ticket</Button>}
                          <div className="border-t border-[var(--color-border-subtle)] pt-3 space-y-2">
                            {perms.canDelete('projects') && <Button size="sm" variant="danger" className="w-full justify-start" onClick={() => { closeTicketDetails(); setDelId(viewItem.id); }}>Delete</Button>}
                          </div>
                        </div>
                      </section>
                      {viewItem.cancellationReason && (
                        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                          <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Cancellation Reason</h3>
                          <p className="mt-3 text-sm text-[var(--color-text)]">{viewItem.cancellationReason}</p>
                        </section>
                      )}
                    </aside>
                  </div>
                )}
                {detailsTab === 'activity' && (
                  <div className="pt-5">
                    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Activity Timeline</h3>
                      {(viewItem.statusHistory?.length ?? 0) > 1 ? (
                        viewItem.statusHistory.map((entry: any, i: number) => (
                          <div key={i} className="flex gap-3 mt-3">
                            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${entry.status === 'Resolved' || entry.status === 'Closed' ? 'bg-emerald-500' : entry.status === 'Cancelled' ? 'bg-red-500' : entry.status === 'InProgress' ? 'bg-purple-500' : entry.status === 'Open' ? 'bg-amber-500' : 'bg-gray-400'}`} />
                            <div>
                              <p className="font-semibold text-[var(--color-text)]">{entry.status === 'InProgress' ? 'In Progress' : entry.status}</p>
                              <p className="text-xs text-[var(--color-text-muted)]">{fmtDate(entry.changedAt)} by {entry.changedBy}</p>
                              {entry.note && <p className="text-sm text-[var(--color-text-secondary)]">{entry.note}</p>}
                            </div>
                          </div>
                        ))
                      ) : <p className="mt-3 text-sm text-[var(--color-text-muted)]">No activity recorded.</p>}
                    </section>
                  </div>
                )}
                {detailsTab === 'notes' && (
                  <div className="pt-5">
                    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Notes</h3>
                      {viewItem.notes ? <p className="mt-3 whitespace-pre-wrap rounded-xl bg-[var(--color-bg-sunken)] p-4 text-[var(--color-text)]">{viewItem.notes}</p> : <p className="mt-3 text-sm text-[var(--color-text-muted)]">No notes recorded.</p>}
                    </section>
                  </div>
                )}
                {detailsTab === 'documents' && (
                  <div className="pt-5">
                    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Documents</h3>
                      <div className="mt-3 rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-8 text-center">
                        <FileText className="mx-auto h-8 w-8 text-[var(--color-text-disabled)]" />
                        <p className="mt-2 text-sm font-medium text-[var(--color-text)]">No documents attached</p>
                        <p className="mt-1 text-xs text-[var(--color-text-muted)]">Documents will appear here after upload.</p>
                      </div>
                    </section>
                  </div>
                )}
                {detailsTab === 'history' && (
                  <div className="pt-5">
                    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Status History</h3>
                      {(viewItem.statusHistory?.length ?? 0) > 1 ? (
                        <div className="mt-3 space-y-2">
                          {viewItem.statusHistory.map((entry: any, i: number) => (
                            <div key={i} className="flex items-start gap-2 text-xs">
                              <div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${entry.status === 'Resolved' || entry.status === 'Closed' ? 'bg-emerald-500' : entry.status === 'Cancelled' ? 'bg-red-500' : entry.status === 'InProgress' ? 'bg-purple-500' : entry.status === 'Open' ? 'bg-amber-500' : 'bg-gray-400'}`} />
                              <div>
                                <p className="font-medium text-[var(--color-text)]">{entry.status === 'InProgress' ? 'In Progress' : entry.status}</p>
                                <p className="text-[var(--color-text-muted)]">{entry.changedBy} · {fmtDate(entry.changedAt)}</p>
                                {entry.note && <p className="text-[var(--color-text-muted)] italic">{entry.note}</p>}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : <p className="mt-3 text-sm text-[var(--color-text-muted)]">No history recorded.</p>}
                    </section>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>

      <Modal open={showBulkStatus} onClose={() => setShowBulkStatus(false)} title="Change Status" size="sm">
        <div className="space-y-4">
          <Select label="New Status" value={bulkStatus} onChange={e => setBulkStatus(e.target.value)} options={[{ label: 'Select status...', value: '' }, ...TICKET_STATUSES.map(s => ({ label: s === 'InProgress' ? 'In Progress' : s, value: s }))]} />
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => { setShowBulkStatus(false); setBulkStatus(''); }}>Cancel</Button><Button loading={bulkStatusMutation.isPending} onClick={() => { if (!bulkStatus) return toast.error('Select a status'); bulkStatusMutation.mutate({ ids: Array.from(selected), status: bulkStatus }); }}>Update {selected.size} Tickets</Button></div>
        </div>
      </Modal>

      <Modal open={showBulkAssign} onClose={() => setShowBulkAssign(false)} title="Assign Tickets" size="sm">
        <div className="space-y-4">
          <Select label="Assign To" value={bulkAssignId} onChange={e => { const a = salesUsers.find((u: any) => u.id === e.target.value); setBulkAssignId(e.target.value); setBulkAssignName(a?.name || ''); }} options={[{ label: 'Select user...', value: '' }, ...salesUsers.map((u: any) => ({ label: u.name, value: u.id }))]} />
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setShowBulkAssign(false)}>Cancel</Button><Button loading={bulkAssignMutation.isPending} onClick={() => { if (!bulkAssignId) return toast.error('Select a user'); bulkAssignMutation.mutate({ ids: Array.from(selected), userId: bulkAssignId, userName: bulkAssignName }); }}>Assign {selected.size} Tickets</Button></div>
        </div>
      </Modal>

      <ConfirmDialog open={!!delId} onClose={() => setDelId(null)}
        onConfirm={() => {
          if (delId === '__bulk__') {
            Promise.all(Array.from(selected).map(id => del.mutateAsync(id))).then(() => { setSelected(new Set()); setDelId(null); }).catch(() => { });
          } else if (delId) {
            del.mutate(delId, { onSuccess: () => { if (viewItem?.id === delId) closeTicketDetails(); } });
          }
        }}
        loading={del.isPending} title="Delete Ticket" message={delId === '__bulk__' ? `Delete ${selected.size} selected tickets permanently?` : 'Delete this ticket permanently?'}
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
