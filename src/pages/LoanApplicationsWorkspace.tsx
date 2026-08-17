import { useState, useMemo, useCallback, useRef, useEffect, useDeferredValue } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAll, fmtDate, fmtCurrency, updateDocById, softDelete } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { isInDateRange } from '../lib/dateFilters';
import { usePermissions } from '../lib/permissions';
import { useAppStore, useCurrentUser } from '../store/useAppStore';
import {
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Pagination,
  PremiumKpi,
  Select,
  SkeletonRows,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  UniversalCheckbox,
  WorkspaceHero,
} from '../components/ui';
import {
  CreatedDateCell,
  EmptyCell,
  ActionStrip,
  loanApplicationStatusBadge,
  signStatusBadge,
} from '../features/loan-applications/components/LoanApplicationWorkspaceParts';
import { LoanApplicationDetailModal } from '../features/loan-applications/components/LoanApplicationDetailModal';
import { LoanApplicationWorkspaceDialogs } from '../features/loan-applications/components/LoanApplicationWorkspaceDialogs';
import { useLoanApplications, LOAN_APPLICATION_STATUSES, LOAN_APPLICATION_FORM_DEFAULT, isToday } from '../features/loan-applications/hooks/useLoanApplications';
import { useBankOptions } from '../features/banks/hooks/useBanks';
import { onLoanApplicationStatusChange, createLoanApplication } from '../features/loan-applications/services/loanApplicationWorkflow';
import { logUpdate } from '../lib/auditLogger';
import {
  Plus, Trash2, FileText, RefreshCw,
  Download, Users, ListChecks, X,
  Target, User, AlertTriangle,
  Handshake,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useNavigate, useSearchParams } from 'react-router-dom';

const PER_PAGE = 10;

const FORM0 = { ...LOAN_APPLICATION_FORM_DEFAULT };

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatCreatedDate(value: any): string {
  const date = toDate(value);
  return date ? date.toLocaleDateString('en-GB') : '';
}

function recencyDotClass(value: any): string {
  const date = toDate(value);
  if (!date) return 'bg-[var(--color-text-disabled)]';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const then = new Date(date); then.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((today.getTime() - then.getTime()) / 86400000));
  if (days === 0) return 'bg-emerald-500';
  if (days <= 7) return 'bg-blue-500';
  if (days <= 30) return 'bg-amber-500';
  return 'bg-red-500';
}

function isRowOpenIgnored(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button,a,input,select,textarea,[data-action],[data-interactive]'));
}

function downloadCsv(rows: any[], filename: string) {
  const headers = ['Loan Application ID','Customer','Phone','Bank','Branch','Loan Amount','Status','Digital Sign','Bank Submission','Assigned To','Created Date'];
  const lines = rows.map(r =>
    [
      r.registrationId || r.id || '', r.customerName || '', r.customerPhone || '',
      r.bankName || '', r.branch || '', r.loanAmount || 0,
      r.status || '', r.digitalSignStatus || 'pending', r.submissionDate || '',
      r.assignedToName || '', fmtDate(r.createdAt) || '',
    ].map(v => `"${v}"`).join(',')
  );
  const csv = [headers.join(','), ...lines].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function LoanApplications() {
  const qc = useQueryClient();
  const user = useCurrentUser();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const perms = usePermissions();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const openParam = searchParams.get('open') || '';
  const createParam = searchParams.get('create') || '';

  // ── Filters
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const deferredSearch = useDeferredValue(search);
  const [statusF, setStatusF] = useState(() => searchParams.get('status') || '');
  const [bankF, setBankF] = useState(() => searchParams.get('bank') || '');
  const [assignF, setAssignF] = useState(() => searchParams.get('owner') || '');
  const [dateRange, setDateRange] = useState(() => searchParams.get('date') || 'all');
  const [customFrom, setCustomFrom] = useState(() => searchParams.get('from') || '');
  const [customTo, setCustomTo] = useState(() => searchParams.get('to') || '');
  const [activeKpi, setActiveKpi] = useState(() => searchParams.get('kpi') || '');

  // ── Table
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [perPage, setPerPage] = useState(() => Math.max(1, Number(searchParams.get('perPage')) || PER_PAGE));
  const [sortKey, setSortKey] = useState('createdAt');
  const [sortDesc, setSortDesc] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ── Form
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...FORM0 });

  // ── View / delete
  const [viewItem, setViewItem] = useState<any>(null);
  const [delId, setDelId] = useState<string | null>(null);

  // ── Bulk
  const [showBulkStatus, setShowBulkStatus] = useState(false);
  const [showBulkAssign, setShowBulkAssign] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkAssignId, setBulkAssignId] = useState('');
  const [bulkAssignName, setBulkAssignName] = useState('');

  function syncQueueParams(overrides: Record<string, any>) {
    const next = new URLSearchParams(searchParams);
    const q = overrides.q ?? search;
    const status = overrides.status ?? statusF;
    const bank = overrides.bank ?? bankF;
    const owner = overrides.owner ?? assignF;
    const date = overrides.date ?? dateRange;
    const from = overrides.from ?? customFrom;
    const to = overrides.to ?? customTo;
    const kpi = overrides.kpi ?? activeKpi;
    const nextPage = overrides.page != null ? overrides.page : page;
    const nextPerPage = overrides.perPage != null ? overrides.perPage : perPage;
    if (q) next.set('q', String(q)); else next.delete('q');
    if (status) next.set('status', String(status)); else next.delete('status');
    if (bank) next.set('bank', String(bank)); else next.delete('bank');
    if (owner) next.set('owner', String(owner)); else next.delete('owner');
    if (date && date !== 'all') next.set('date', String(date)); else next.delete('date');
    if (from) next.set('from', String(from)); else next.delete('from');
    if (to) next.set('to', String(to)); else next.delete('to');
    if (kpi) next.set('kpi', String(kpi)); else next.delete('kpi');
    if (nextPage > 1) next.set('page', String(nextPage)); else next.delete('page');
    if (nextPerPage !== PER_PAGE) next.set('perPage', String(nextPerPage)); else next.delete('perPage');
    setSearchParams(next, { replace: true });
  }

  // ── Queries
  const { data: registrations = [], isLoading, refetch } = useLoanApplications();
  const { data: users = [] } = useQuery({
    queryKey: ['users'], queryFn: () => getAll(COLLECTIONS.USERS), staleTime: 300000,
  });

  const salesUsers = useMemo(() =>
    (users as any[])
      .filter(u => ['Sales','Executive','BDE','BDM','Manager','TL','Admin','Accounts','Operations'].includes(u.role) && u.status !== 'Inactive' && !u.isDeleted)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [users]);

  const col = 'registrations';

  // ── Mutations
  const save = useMutation({
    mutationFn: async (d: typeof FORM0) => {
      if (editId) {
        const oldReg = (registrations as any[]).find((r: any) => r.id === editId);
        const fieldChanges: Record<string, unknown> = {};
        const fieldOlds: Record<string, unknown> = {};
        if (oldReg) {
          const trackedFields = ['bankName', 'branch', 'loanAmount', 'assignedToId', 'assignedToName', 'approvalDate', 'paymentDate'];
          for (const field of trackedFields) {
            if (String(d[field as keyof typeof FORM0] ?? '') !== String(oldReg[field] ?? '')) {
              fieldChanges[field] = d[field as keyof typeof FORM0] ?? '';
              fieldOlds[field] = oldReg[field] ?? '';
            }
          }
          if (Object.keys(fieldChanges).length > 0) {
            void logUpdate('registration', editId, fieldOlds, fieldChanges, 'registrations');
          }
        }
        await updateDocById(col, editId, { ...d, updatedBy: user.id });
        return { ...d, id: editId, activityLog: oldReg?.activityLog || [] };
      }
      return createLoanApplication({ form: d, createdById: user.id, createdByName: user.name });
    },
    onSuccess: async (saved: any) => {
      qc.invalidateQueries({ queryKey: ['registrations'] });
      toast.success(editId ? 'Loan application updated' : 'Loan application created');
      closeForm();
      if (saved?.id) {
        // Create path already triggers onLoanApplicationStatusChange internally
        // (createLoanApplication() itself calls it) — only the update path needs
        // it fired here, to avoid double-firing tasks/notifications on create.
        if (editId && saved.status && saved.status !== (registrations as any[]).find((r: any) => r.id === editId)?.status) {
          const oldReg = (registrations as any[]).find((r: any) => r.id === editId);
          void onLoanApplicationStatusChange(saved.id, oldReg?.status || 'Draft', saved.status);
        }
        openRegDetails(saved, true);
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: (id: string) => softDelete(col, id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['registrations'] }); toast.success('Deleted'); setDelId(null); setSelected(new Set()); },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      await Promise.all(ids.map(id => updateDocById(col, id, { status, updatedBy: user.id })));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['registrations'] }); toast.success(`Status updated for ${selected.size}`); setShowBulkStatus(false); setBulkStatus(''); setSelected(new Set()); },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkAssignMutation = useMutation({
    mutationFn: async ({ ids, userId, userName }: { ids: string[]; userId: string; userName: string }) => {
      await Promise.all(ids.map(id => updateDocById(col, id, { assignedToId: userId, assignedToName: userName, updatedBy: user.id })));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['registrations'] }); toast.success(`Assigned ${selected.size} loan applications`); setShowBulkAssign(false); setBulkAssignId(''); setBulkAssignName(''); setSelected(new Set()); },
    onError: (e: any) => toast.error(e.message),
  });

  // ── Helpers
  useEffect(() => {
    if (createParam !== '1') return;
    setForm({ ...FORM0 }); setEditId(null); setShowForm(true);
  }, [createParam]);

  function closeForm() {
    setShowForm(false); setEditId(null); setForm({ ...FORM0 });
    if (createParam === '1') {
      const next = new URLSearchParams(searchParams);
      next.delete('create');
      setSearchParams(next, { replace: true });
    }
  }

  function openEdit(r: any) {
    closeRegDetails();
    setForm({
      customerId: r.customerId || '', customerName: r.customerName || '', customerPhone: r.customerPhone || '',
      customerAddress: r.customerAddress || '', bankName: r.bankName || '', branch: r.branch || '',
      loanAmount: Number(r.loanAmount) || 0, applicationNumber: r.applicationNumber || '',
      caseId: r.caseId || '', registrationId: r.registrationId || '',
      status: r.status || 'Draft', digitalSignStatus: r.digitalSignStatus || 'pending',
      submissionDate: r.submissionDate || '', approvalDate: r.approvalDate || '', paymentDate: r.paymentDate || '',
      assignedToId: r.assignedToId || '', assignedToName: r.assignedToName || '', notes: r.notes || '',
    });
    setEditId(r.id); setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (save.isPending) return;
    if (!editId && !form.customerId) return toast.error('Please select a customer');
    if (!form.customerName) return toast.error('Customer name required');
    save.mutate(form);
  }

  function exportSelected() {
    const rows = (registrations as any[]).filter(r => selected.has(r.id));
    if (!rows.length) return toast.error('No loan applications selected');
    downloadCsv(rows, `loan-applications-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${rows.length}`);
  }

  // ── Filtering + sorting
  const filtered = useMemo(() => {
    let list = [...(registrations as any[])];
    if (activeKpi === 'newToday') list = list.filter(r => isToday(r.createdAt));
    else if (activeKpi === 'pendingBankApproval') list = list.filter(r => r.status === 'Under Review');
    else if (activeKpi === 'approvedCases') list = list.filter(r => r.status === 'Approved' || r.status === 'Payment Received' || r.status === 'Closed');
    else if (activeKpi === 'digitalSignPending') list = list.filter(r => r.status === 'Digital Sign Pending' || r.status === 'Digital Sign Completed');
    else if (activeKpi === 'bankSubmissionPending') list = list.filter(r => r.status === 'Bank Submission Pending');
    else if (activeKpi === 'rejected') list = list.filter(r => r.status === 'Rejected');
    const q = deferredSearch.toLowerCase();
    if (q) list = list.filter(r => [r.customerName, r.customerPhone, r.bankName, r.registrationId, r.id, r.branch].some((v: any) => String(v || '').toLowerCase().includes(q)));
    if (statusF) list = list.filter(r => r.status === statusF);
    if (bankF) list = list.filter(r => r.bankName === bankF);
    if (assignF) list = list.filter(r => r.assignedToId === assignF || r.assignedToName === assignF);
    if (dateRange !== 'all') list = list.filter(r => isInDateRange(r.createdAt, dateRange as any, customFrom, customTo));
    list.sort((a, b) => {
      const cmp = String(a[sortKey] || '').localeCompare(String(b[sortKey] || ''));
      return sortDesc ? -cmp : cmp;
    });
    return list;
  }, [registrations, deferredSearch, statusF, bankF, assignF, dateRange, customFrom, customTo, activeKpi, sortKey, sortDesc]);

  const paginated = filtered.slice((page - 1) * perPage, page * perPage);
  const userClosedRef = useRef(false);

  useEffect(() => {
    if (userClosedRef.current) { userClosedRef.current = false; return; }
    const openId = openParam;
    if (!openId || isLoading) return;
    const target = (registrations as any[]).find((r: any) => r.id === openId);
    if (!target) return;
    setViewItem(target);
    window.setTimeout(() => document.querySelector(`[data-record-id="${CSS.escape(openId)}"]`)?.scrollIntoView({ block: 'center' }), 0);
  }, [openParam, isLoading, registrations]);

  const closeRegDetails = useCallback(() => {
    userClosedRef.current = true; setViewItem(null);
    if (!openParam) return;
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    setSearchParams(next, { replace: true });
  }, [openParam, searchParams, setSearchParams]);

  const openRegDetails = useCallback((reg: any, replace = false) => {
    userClosedRef.current = false; setViewItem(reg);
    if (!reg?.id) return;
    const next = new URLSearchParams(searchParams);
    next.set('open', reg.id);
    if (search) next.set('q', search); else next.delete('q');
    if (statusF) next.set('status', statusF); else next.delete('status');
    if (bankF) next.set('bank', bankF); else next.delete('bank');
    if (assignF) next.set('owner', assignF); else next.delete('owner');
    if (dateRange && dateRange !== 'all') next.set('date', dateRange); else next.delete('date');
    if (customFrom) next.set('from', customFrom); else next.delete('from');
    if (customTo) next.set('to', customTo); else next.delete('to');
    if (activeKpi) next.set('kpi', activeKpi); else next.delete('kpi');
    if (page > 1) next.set('page', String(page)); else next.delete('page');
    if (perPage !== PER_PAGE) next.set('perPage', String(perPage)); else next.delete('perPage');
    setSearchParams(next, { replace });
  }, [search, statusF, bankF, assignF, dateRange, customFrom, customTo, activeKpi, page, perPage, searchParams, setSearchParams]);

  function handleRowClick(e: React.MouseEvent<HTMLTableRowElement>, reg: any) {
    if (window.getSelection()?.toString()) return;
    if (isRowOpenIgnored(e.target)) return;
    openRegDetails(reg);
  }

  function handleRowKeyDown(e: React.KeyboardEvent<HTMLTableRowElement>, reg: any) {
    if (isRowOpenIgnored(e.target)) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    openRegDetails(reg);
  }

  function sort(k: string) {
    if (sortKey === k) setSortDesc(d => !d); else { setSortKey(k); setSortDesc(true); }
  }

  function clearAll() {
    setSearch(''); setStatusF(''); setBankF(''); setAssignF('');
    setDateRange('all'); setCustomFrom(''); setCustomTo(''); setActiveKpi(''); setPage(1);
    syncQueueParams({ q: '', status: '', bank: '', owner: '', date: 'all', from: '', to: '', kpi: '', page: 1 });
  }

  const { options: bankOptionsFromHook } = useBankOptions();
  const assignOptions = [{ label: 'All Assigned', value: '' }, ...salesUsers.map(u => ({ label: u.name, value: u.id }))];
  const bankOptions = [{ label: 'All Banks', value: '' }, ...bankOptionsFromHook.filter(b => b.value !== '').map(b => ({ label: b.label, value: b.value }))];

  const stats = useMemo(() => {
    const all = registrations as any[];
    return {
      total: all.length,
      newToday: all.filter(r => isToday(r.createdAt)).length,
      pendingBankApproval: all.filter(r => r.status === 'Under Review').length,
      approvedCases: all.filter(r => r.status === 'Approved' || r.status === 'Payment Received' || r.status === 'Closed').length,
      digitalSignPending: all.filter(r => r.status === 'Digital Sign Pending' || r.status === 'Digital Sign Completed').length,
      bankSubmissionPending: all.filter(r => r.status === 'Bank Submission Pending').length,
      rejected: all.filter(r => r.status === 'Rejected').length,
    };
  }, [registrations]);

  // Total KPI active by default when no filters/search/KPI are set
  const isTotalDefault = useMemo(() => {
    return !activeKpi && !search && !statusF && !bankF && !assignF && dateRange === 'all';
  }, [activeKpi, search, statusF, bankF, assignF, dateRange]);

  // Active filter count for Clear All display
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (search) count++;
    if (statusF) count++;
    if (bankF) count++;
    if (assignF) count++;
    if (dateRange !== 'all') count++;
    if (activeKpi) count++;
    return count;
  }, [search, statusF, bankF, assignF, dateRange, activeKpi]);

  const toggleSelect = useCallback((id: string) =>
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);
  const toggleAll = () => setSelected(s => s.size === paginated.length ? new Set() : new Set(paginated.map((r: any) => r.id)));
  const allSel = selected.size === paginated.length && paginated.length > 0;

  const KPI_TILES = [
    { label: 'TOTAL', value: stats.total, key: '', icon: <Target className="h-4 w-4" />, description: `${stats.total} total loan applications` },
    { label: 'NEW TODAY', value: stats.newToday, key: 'newToday', icon: <User className="h-4 w-4" />, description: 'Created today' },
    { label: 'SIGN PENDING', value: stats.digitalSignPending, key: 'digitalSignPending', icon: <FileText className="h-4 w-4" />, description: 'Digital sign pending' },
    { label: 'BANK SUBMISSION', value: stats.bankSubmissionPending, key: 'bankSubmissionPending', icon: <RefreshCw className="h-4 w-4" />, description: 'Bank submission pending' },
    { label: 'APPROVED', value: stats.approvedCases, key: 'approvedCases', icon: <Handshake className="h-4 w-4" />, description: 'Approved & completed' },
    { label: 'REJECTED', value: stats.rejected, key: 'rejected', icon: <AlertTriangle className="h-4 w-4" />, description: 'Rejected applications' },
  ];

  const DATE_OPTIONS = [
    { label: 'All dates', value: 'all' },
    { label: 'Today', value: 'today' },
    { label: 'Last 7 days', value: 'week' },
    { label: 'Last 30 days', value: 'month' },
    { label: 'Custom', value: 'custom' },
  ];
  function handleDateChange(newDateRange: string) {
    setDateRange(newDateRange);
    setPage(1);
    if (newDateRange !== 'custom') {
      setCustomFrom('');
      setCustomTo('');
    }
    syncQueueParams({ date: newDateRange, from: '', to: '', page: 1 });
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      {/* ── Premium Workspace Hero ─────────────────────────── */}
      <WorkspaceHero
        title="Loan Applications"
        icon={<FileText className="h-6 w-6" />}
        breadcrumbs={['Home', 'Sales', 'Loan Applications']}
        statusText="Last sync · Realtime Connected"
        statusDotColor="var(--color-success)"
        className="gap-3"
        actions={
          <>
            <Button variant="outline" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => refetch()}>
              Refresh
            </Button>
            {perms.canCreate('loan_applications') && (
              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setForm({ ...FORM0 }); setEditId(null); setShowForm(true); }}>
                Add Loan Application
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
              aria-label="Search loan applications"
              placeholder="Search name, phone, bank, ID..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); syncQueueParams({ q: e.target.value, page: 1 }); }}
              className="min-w-[160px] flex-1 h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]"
            />
            <Select
              aria-label="Date"
              value={dateRange}
              options={DATE_OPTIONS}
              onChange={(e) => handleDateChange(e.target.value)}
              className="w-[110px] h-8 py-1"
            />
            {dateRange === 'custom' && (
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => { setCustomFrom(e.target.value); setPage(1); syncQueueParams({ from: e.target.value, to: customTo, date: 'custom', page: 1 }); }}
                  className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                />
                <span className="text-[10px] text-[var(--color-text-muted)]">to</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => { setCustomTo(e.target.value); setPage(1); syncQueueParams({ to: e.target.value, from: customFrom, date: 'custom', page: 1 }); }}
                  className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                />
              </div>
            )}
            <Select
              aria-label="Status"
              value={statusF}
              onChange={(e) => {
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
              }}
              options={[{ label: 'All Status', value: '' }, ...LOAN_APPLICATION_STATUSES.map(s => ({ label: s, value: s }))]}
              className="w-[110px] h-8 py-1"
            />
            <Select
              aria-label="Bank"
              value={bankF}
              onChange={(e) => { setBankF(e.target.value); setPage(1); syncQueueParams({ bank: e.target.value, page: 1 }); }}
              options={bankOptions}
              className="w-[110px] h-8 py-1"
            />
            <Select
              aria-label="Assigned"
              value={assignF}
              onChange={(e) => { setAssignF(e.target.value); setPage(1); syncQueueParams({ owner: e.target.value, page: 1 }); }}
              options={assignOptions}
              className="w-[120px] h-8 py-1"
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
                {bankF && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">{bankF}</span>
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
              {selected.size} loan application{selected.size > 1 ? 's' : ''} selected
            </span>
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <Button size="sm" variant="outline"
                icon={<Download className="h-3.5 w-3.5" />}
                onClick={exportSelected}
                className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30">
                Export CSV
              </Button>
              {perms.canEdit('loan_applications') && (
                <Button size="sm" variant="outline"
                  icon={<ListChecks className="h-3.5 w-3.5" />}
                  onClick={() => setShowBulkStatus(true)}
                  className="text-indigo-600 border-indigo-300 hover:bg-indigo-50 dark:border-indigo-700 dark:hover:bg-indigo-900/30">
                  Change Status
                </Button>
              )}
              {perms.canEdit('loan_applications') && (
                <Button size="sm" variant="outline"
                  icon={<Users className="h-3.5 w-3.5" />}
                  onClick={() => setShowBulkAssign(true)}
                  className="text-purple-600 border-purple-300 hover:bg-purple-50 dark:border-purple-700 dark:hover:bg-purple-900/30">
                  Assign
                </Button>
              )}
              {perms.canDelete('loan_applications') && (
                <Button size="sm" variant="outline"
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  onClick={() => setDelId('__bulk__')}
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
                  <UniversalCheckbox checked={allSel} indeterminate={selected.size > 0 && !allSel} onChange={toggleAll} ariaLabel="Select visible loan applications" />
                </Th>
                <Th sortable sorted={sortKey === 'registrationId'} desc={sortDesc} onSort={() => sort('registrationId')} style={{ width: 80, minWidth: 80 }}>LA ID</Th>
                <Th sortable sorted={sortKey === 'customerName'} desc={sortDesc} onSort={() => sort('customerName')} style={{ width: '25%', minWidth: 200 }}>CUSTOMER</Th>
                <Th style={{ width: 120, minWidth: 120 }}>PHONE</Th>
                <Th className="hidden md:table-cell" style={{ width: '10%', minWidth: 100 }}>BANK</Th>
                <Th sortable sorted={sortKey === 'loanAmount'} desc={sortDesc} onSort={() => sort('loanAmount')} style={{ width: 100, minWidth: 100 }}>LOAN AMOUNT</Th>
                <Th style={{ width: 110, minWidth: 110 }}>STATUS</Th>
                <Th className="hidden md:table-cell" style={{ width: 80, minWidth: 80 }}>SIGN</Th>
                <Th className="hidden lg:table-cell" style={{ width: '10%', minWidth: 100 }}>BANK SUB.</Th>
                <Th style={{ width: '12%', minWidth: 130 }}>ASSIGNED</Th>
                <Th sortable sorted={sortKey === 'createdAt'} desc={sortDesc} onSort={() => sort('createdAt')} style={{ width: 90, minWidth: 90 }}>CREATED</Th>
                <Th align="right" style={{ width: 130, minWidth: 130 }}>ACTIONS</Th>
              </Thead>
              <Tbody>
                {isLoading
                  ? <SkeletonRows cols={12} />
                  : paginated.length === 0
                    ? (
                      <tr>
                        <td colSpan={12} className="py-14 text-center">
                          <EmptyState
                            icon={<FileText className="h-9 w-9" />}
                            title={search || statusF || bankF ? 'No loan applications match filters' : 'No loan applications yet'}
                            description={search || statusF || bankF ? undefined : 'Add your first loan application to get started.'}
                            action={!search && !statusF && !bankF && perms.canCreate('loan_applications') ? (
                              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setForm({ ...FORM0 }); setEditId(null); setShowForm(true); }} className="mt-2">Add Your First Loan Application</Button>
                            ) : undefined}
                          />
                        </td>
                      </tr>
                    )
                    : paginated.map((r: any) => (
                      <Tr key={r.id} selected={selected.has(r.id)}
                        data-record-id={r.id}
                        role="button"
                        tabIndex={0}
                        onClick={(e) => handleRowClick(e, r)}
                        onKeyDown={(e) => handleRowKeyDown(e, r)}
                        className="transition-colors duration-150"
                      >
                        {/* Checkbox */}
                        <Td className="py-3" onClick={(e) => e.stopPropagation()}>
                          <UniversalCheckbox checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} ariaLabel={`Select ${r.customerName || r.id}`} />
                        </Td>

                        {/* Reg ID */}
                        <Td className="py-3">
                          <span className="font-mono text-xs font-semibold text-[var(--color-text-secondary)]">{r.registrationId || r.id || '—'}</span>
                        </Td>

                        {/* Customer Name + Avatar */}
                        <Td className="py-3 min-w-[200px]">
                          <div className="flex items-center gap-2.5">
                            <div className="h-7 w-7 shrink-0 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary-text)] flex items-center justify-center text-[11px] font-bold">
                              {(r.customerName || '?')[0].toUpperCase()}
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <span className="text-sm font-medium text-[var(--color-text)] leading-tight">{r.customerName || '—'}</span>
                            </div>
                          </div>
                        </Td>

                        {/* Phone */}
                        <Td className="py-3 text-xs">
                          {r.customerPhone ? (
                            <a href={`tel:${r.customerPhone}`} title="Call" data-interactive
                              onClick={(e) => e.stopPropagation()}
                              className="text-[var(--color-primary)] hover:underline inline-flex items-center gap-1 text-[13px] font-medium">
                              {r.customerPhone}
                            </a>
                          ) : <EmptyCell />}
                        </Td>

                        {/* Bank */}
                        <Td className="hidden md:table-cell py-3 text-xs">{r.bankName || <EmptyCell />}</Td>

                        {/* Loan Amount */}
                        <Td className="py-3 text-xs font-semibold text-[var(--color-text)]">{fmtCurrency(Number(r.loanAmount) || 0)}</Td>

                        {/* Status */}
                        <Td className="py-3"><span data-interactive onClick={(e) => e.stopPropagation()}>{loanApplicationStatusBadge(r.status || 'Draft')}</span></Td>

                        {/* Digital Sign */}
                        <Td className="hidden md:table-cell py-3">{signStatusBadge(r.digitalSignStatus || 'pending')}</Td>

                        {/* Bank Submission */}
                        <Td className="hidden lg:table-cell py-3 text-xs text-[var(--color-text-muted)]">
                          {r.submissionDate ? formatCreatedDate(r.submissionDate) : <EmptyCell />}
                        </Td>

                        {/* Assigned To */}
                        <Td className="py-3 whitespace-nowrap">
                          {r.assignedToName ? (
                            <span className="text-xs text-[var(--color-text)]">{r.assignedToName}</span>
                          ) : (
                            <span className="inline-flex items-center rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-text-muted)]">Unassigned</span>
                          )}
                        </Td>

                        {/* Created */}
                        <Td className="py-3"><CreatedDateCell value={r.createdAt} formatCreatedDate={formatCreatedDate} recencyDotClass={recencyDotClass} /></Td>

                        {/* Actions */}
                        <Td className="py-3" align="right"><ActionStrip onView={() => openRegDetails(r)} /></Td>
                      </Tr>
                    ))
                }
              </Tbody>
            </Table>
          </div>
          {/* ── Premium Pagination (inside table block) ────── */}
          <div className="shrink-0 border-t border-[var(--color-border-subtle)]">
            <Pagination page={page} total={filtered.length} perPage={perPage}
              onChange={n => { setPage(n); syncQueueParams({ page: n }); }}
              onPerPageChange={n => { setPerPage(n); setPage(1); syncQueueParams({ perPage: n, page: 1 }); }} />
          </div>
        </div>
      </Card>

      <LoanApplicationWorkspaceDialogs ctx={{ showForm, closeForm, editId, form, setForm, save, salesUsers, bankOptions,
        showBulkStatus, setShowBulkStatus, bulkStatus, setBulkStatus, bulkStatusMutation, selected,
        showBulkAssign, setShowBulkAssign, bulkAssignId, setBulkAssignId, bulkAssignName, setBulkAssignName, bulkAssignMutation, handleSubmit }} />

      <LoanApplicationDetailModal open={!!viewItem} registration={viewItem} onClose={closeRegDetails}
        onEdit={() => { closeRegDetails(); openEdit(viewItem); }}
        onDelete={() => { closeRegDetails(); setDelId(viewItem?.id); }}
        onViewCustomer={viewItem?.customerId ? () => navigate(`/customers?open=${encodeURIComponent(viewItem.customerId)}`) : undefined}
        onCreatePayment={viewItem?.status === 'Approved' ? () => { const r = viewItem; closeRegDetails(); setTimeout(() => { if (r) { /* Payment creation flow */ } }, 200); } : undefined}
        onCreateProject={viewItem?.status === 'Payment Received' ? () => { const r = viewItem; closeRegDetails(); setTimeout(() => { if (r) { /* Project creation flow */ } }, 200); } : undefined} />

      <ConfirmDialog open={!!delId} onClose={() => setDelId(null)}
        onConfirm={() => {
          if (delId === '__bulk__') {
            Promise.all(Array.from(selected).map(id => del.mutateAsync(id))).then(() => { setSelected(new Set()); setDelId(null); }).catch(() => {});
          } else if (delId) del.mutate(delId, { onSuccess: () => { if (viewItem?.id === delId) closeRegDetails(); } });
        }}
        loading={del.isPending} title="Delete Loan Application"
        message={delId === '__bulk__' ? `Delete ${selected.size} selected loan applications permanently?` : 'Delete this loan application permanently?'} />
    </div>
  );
}
