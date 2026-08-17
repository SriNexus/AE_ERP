import { useState, useMemo, useCallback, useRef, useEffect, useDeferredValue } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAll, createDocWithId,
  genId, fmtDate,
} from '../lib/firestore';
import { createCustomerProjection, deleteCustomerProjection, formatCustomerDate, updateCustomerProjectionWithPhoneLock, useCustomers } from '../features/customers/hooks/useCustomers';
import { updateProjectionWithEntity } from '../lib/entityProjection';
import { COLLECTIONS } from '../lib/firebase';
import { INDIAN_STATES } from '../config/company';
import { isInDateRange } from '../lib/dateFilters';
import { usePermissions } from '../lib/permissions';
import { useAppStore, useCurrentUser } from '../store/useAppStore';
import { statusBadge } from '../components/ui/Badge';
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
import { CreatedDateCell } from '../features/customers/components/CustomerWorkspaceParts';
import { CustomerTransferModal } from '../features/customers/components/CustomerTransferModal';
import { CustomerWorkspaceDialogs } from '../features/customers/components/CustomerWorkspaceDialogs';
import {
  Plus, Trash2, Building2, Phone, RefreshCw,
  UploadCloud, Download,
  User, Users, AlertTriangle, Calendar,
  Target, Eye, X, UserCheck,
} from 'lucide-react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { notifyRoleUsers, resolveNotificationCompanyId, sendNotification } from '../lib/notifications';
import { NotificationType } from '../types';
import { CSVImportModal } from '../components/shared/CSVImportModal';

const PER_PAGE = 10;

const B2B_FORM0 = {
  company: '', companyName: '', gst: '', contactPerson: '', businessPhone: '',
  businessEmail: '', address: '', state: '', city: '',
  industryType: '', assignedToId: '', assignedToName: '', notes: '',
  billUpload: null as File | null, billUploadName: '',
};

const B2C_FORM0 = {
  fullName: '', mobile: '', altMobile: '', email: '',
  address: '', state: '', city: '', aadhaar: '',
  monthlyBillAmount: '', roofType: '', sanctionLoad: '',
  propertyType: '', projectType: '', assignedToId: '', assignedToName: '', notes: '',
  electricityBillFile: null as File | null,
  electricityBillPreview: '' as string,
  aadhaarFile: null as File | null,
  aadhaarPreview: '' as string,
  panFile: null as File | null,
  panPreview: '' as string,
};

// ── Helpers ───────────────────────────────────────────────
function safeAge(createdAt: any): number {
  if (!createdAt) return 0;
  let date: Date;
  if (typeof createdAt === 'object' && typeof createdAt.toDate === 'function') date = createdAt.toDate();
  else if (typeof createdAt === 'object' && createdAt.seconds) date = new Date(createdAt.seconds * 1000);
  else date = new Date(createdAt);
  if (isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isThisMonth(value: any): boolean {
  const date = toDate(value);
  if (!date) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function isOverdue(next_date: any): boolean {
  if (!next_date) return false;
  let d: Date;
  if (typeof next_date === 'object' && typeof next_date.toDate === 'function') d = next_date.toDate();
  else if (typeof next_date === 'object' && next_date.seconds) d = new Date(next_date.seconds * 1000);
  else d = new Date(next_date);
  if (isNaN(d.getTime())) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return d < today;
}

function downloadCustomersCsv(rows: any[], filename: string) {
  const headers = ['Name', 'Phone', 'Email', 'Company', 'GST', 'City', 'State', 'Type', 'Assigned To', 'Notes', 'Created Date'];
  const lines = rows.map(c =>
    [
      c.name || c.fullName || '',
      c.phone || c.mobile || c.businessPhone || '',
      c.email || c.businessEmail || '',
      c.company || '',
      c.gst || '',
      c.city || '',
      c.state || '',
      c.type || '',
      c.assignedToName || '',
      (c.notes || '').replace(/\"/g, '""'),
      formatCustomerDate(c.createdAt),
    ].map(v => `"${v}"`).join(',')
  );
  const csv = [headers.join(','), ...lines].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function customerDisplayName(c: any): string {
  return c.name || c.fullName || c.contactPerson || '—';
}

function customerPhone(c: any): string {
  return c.phone || c.mobile || c.businessPhone || '—';
}

function customerEmail(c: any): string {
  return c.email || c.businessEmail || '—';
}

function customerSecondaryLine(c: any): string {
  return [c.city, c.company || c.companyName].filter(Boolean).join(' · ') || '—';
}

function highValueCustomer(c: any): boolean {
  return (Number(c.creditLimit) || 0) >= 100000 || (Number(c.monthlyBillAmount) || 0) >= 10000;
}

function formatCustomerCreated(value: any): string {
  const date = toDate(value);
  if (!date) return '—';
  return date.toLocaleDateString('en-GB');
}

function recencyDotClass(value: any): string {
  const age = safeAge(value);
  if (age === 0) return 'bg-emerald-500';
  if (age <= 7) return 'bg-blue-500';
  if (age <= 30) return 'bg-amber-500';
  return 'bg-red-500';
}

function isRowOpenIgnored(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button,a,input,select,textarea,[data-action],[data-interactive]'));
}

function sourceBadge(source: string | undefined | null) {
  if (!source) return <EmptyCell />;
  const colors: Record<string, string> = {
    Lead: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 border-blue-200 dark:border-blue-700',
    Direct: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 border-emerald-200 dark:border-emerald-700',
    Website: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700',
    Referral: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400 border-purple-200 dark:border-purple-700',
    Campaign: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 border-blue-200 dark:border-blue-700',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold leading-tight ${colors[source] || 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border-gray-200 dark:border-gray-700'}`}>
      {source}
    </span>
  );
}

function EmptyCell({ children = '-' }: { children?: React.ReactNode }) {
  return <span className="text-[var(--color-text-disabled)]">{children}</span>;
}

// ─────────────────────────────────────────────────────────────
export default function Customers() {
  const qc = useQueryClient();
  const user = useCurrentUser();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const perms = usePermissions();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const notificationCompanyId = resolveNotificationCompanyId(activeCompanyId);
  const openParam = searchParams.get('open') || '';
  const createParam = searchParams.get('create') || '';

  // ── Filters
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const deferredSearch = useDeferredValue(search);
  const [typeF, setTypeF] = useState(() => searchParams.get('type') || '');
  const [statusF, setStatusF] = useState(() => searchParams.get('status') || '');
  const [assignF, setAssignF] = useState(() => searchParams.get('owner') || '');
  const [dateRange, setDateRange] = useState(() => searchParams.get('date') || 'all');
  const [customFrom, setCustomFrom] = useState(() => searchParams.get('from') || '');
  const [customTo, setCustomTo] = useState(() => searchParams.get('to') || '');
  const [activeKpi, setActiveKpi] = useState(() => searchParams.get('kpi') || '');

  // ── Table
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [perPage, setPerPage] = useState(() => Math.max(1, Number(searchParams.get('perPage')) || PER_PAGE));
  const [sortKey, setSortKey] = useState('updatedAt');
  const [sortDesc, setSortDesc] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ── Delete
  const [delId, setDelId] = useState<string | null>(null);

  // ── Create
  const [showTypeChooser, setShowTypeChooser] = useState(false);
  const [createType, setCreateType] = useState<'B2B' | 'B2C' | null>(null);
  const [lockedSourceLead, setLockedSourceLead] = useState<any>(null);
  const [b2bForm, setB2bForm] = useState({ ...B2B_FORM0 });
  const [b2cForm, setB2cForm] = useState({ ...B2C_FORM0 });

  // ── Transfer (Assign Customer) — Schedule Follow-up's own row action was
  // retired from this list page (Final Customer Module Polish mission); the
  // Workspace's own Right Panel Quick Action still schedules follow-ups.
  const [showTransfer, setShowTransfer] = useState<any>(null);

  // ── Bill upload refs
  const billFileRef = useRef<HTMLInputElement>(null);
  const b2bBillFileRef = useRef<HTMLInputElement>(null);
  const aadhaarFileRef = useRef<HTMLInputElement>(null);
  const panFileRef = useRef<HTMLInputElement>(null);

  const [showCsvImport, setShowCsvImport] = useState(false);

  function handleAadhaarFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => setB2cForm(f => ({ ...f, aadhaarFile: file, aadhaarPreview: evt.target?.result as string }));
    reader.readAsDataURL(file);
  }

  function handlePanFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => setB2cForm(f => ({ ...f, panFile: file, panPreview: evt.target?.result as string }));
    reader.readAsDataURL(file);
  }

  function syncQueueParams(nextState: {
    q?: string; type?: string; status?: string; owner?: string;
    date?: string; from?: string; to?: string; kpi?: string;
    page?: number; perPage?: number;
  }) {
    const next = new URLSearchParams(searchParams);
    const q = nextState.q ?? search;
    const type = nextState.type ?? typeF;
    const status = nextState.status ?? statusF;
    const owner = nextState.owner ?? assignF;
    const date = nextState.date ?? dateRange;
    const from = nextState.from ?? customFrom;
    const to = nextState.to ?? customTo;
    const kpi = nextState.kpi ?? activeKpi;
    const nextPage = nextState.page ?? page;
    const nextPerPage = nextState.perPage ?? perPage;

    if (q) next.set('q', q); else next.delete('q');
    if (type) next.set('type', type); else next.delete('type');
    if (status) next.set('status', status); else next.delete('status');
    if (owner) next.set('owner', owner); else next.delete('owner');
    if (date && date !== 'all') next.set('date', date); else next.delete('date');
    if (from) next.set('from', from); else next.delete('from');
    if (to) next.set('to', to); else next.delete('to');
    if (kpi) next.set('kpi', kpi); else next.delete('kpi');
    if (nextPage > 1) next.set('page', String(nextPage)); else next.delete('page');
    if (nextPerPage !== PER_PAGE) next.set('perPage', String(nextPerPage)); else next.delete('perPage');
    setSearchParams(next, { replace: true });
  }

  // ── Queries
  const { data: customers = [], isLoading, refetch } = useCustomers();
  const { data: users = [] } = useQuery({
    queryKey: ['users'], queryFn: () => getAll(COLLECTIONS.USERS), staleTime: 300000,
  });

  const salesUsers = useMemo(() =>
    (users as any[])
      .filter(u => ['Sales', 'Executive', 'BDE', 'BDM', 'Manager', 'TL'].includes(u.role) && u.status !== 'Inactive' && !u.isDeleted)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [users]);

  useEffect(() => {
    const sourceLead = (location.state as any)?.sourceLead || (location.state as any)?.prefillLead;
    if (!sourceLead) return;
    setLockedSourceLead(sourceLead);
    setB2cForm(f => ({
      ...f, fullName: sourceLead.name || '', mobile: sourceLead.phone || '',
      email: sourceLead.email || '', city: sourceLead.city || '', notes: sourceLead.notes || '',
    }));
    setCreateType('B2C');
  }, [location.state]);

  // ── Mutations
  const createB2B = useMutation({
    mutationFn: async (d: typeof B2B_FORM0) => {
      const id = genId.customer();
      const logEntry = { id: genId.generic('LOG'), type: 'Creation', desc: 'B2B Customer created', date: new Date().toISOString(), userName: user.name };
      const createdCustomer = { ...d, id, type: 'B2B', name: d.contactPerson, phone: d.businessPhone, email: d.businessEmail, companyName: d.companyName || d.company, company: d.companyName || d.company, billUploadName: d.billUploadName || d.billUpload?.name || '', billUpload: undefined, createdBy: user.id, createdAt: new Date().toISOString(), status: 'Active', activityLog: [logEntry] };
      await createCustomerProjection(id, createdCustomer);
      if (d.assignedToId) await sendNotification(d.assignedToId, NotificationType.CUSTOMER_ASSIGNED, 'Customer assigned', `Customer ${d.contactPerson || d.company || id} was assigned to you.`, 'customer', id, notificationCompanyId);
      await notifyRoleUsers(['Admin', 'Director'], NotificationType.CUSTOMER_CREATED, 'Customer created', `Customer ${d.contactPerson || d.company || id} was created.`, 'customer', id, notificationCompanyId);
      return createdCustomer;
    },
    onSuccess: (createdCustomer: any) => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      toast.success('B2B Customer created!');
      closeCreateForm();
      if (createdCustomer?.id) openDetails(createdCustomer, true);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const createB2C = useMutation({
    mutationFn: async (d: typeof B2C_FORM0) => {
      const id = genId.customer();
      const logEntry = { id: genId.generic('LOG'), type: 'Creation', desc: 'B2C Customer created', date: new Date().toISOString(), userName: user.name };
      const createdCustomer = { ...d, id, type: 'B2C', name: d.fullName, phone: d.mobile, projectType: d.projectType || d.propertyType, sourceLeadId: lockedSourceLead?.id || '', electricityBillFile: undefined, electricityBillFileName: d.electricityBillFile?.name || '', aadhaarFile: undefined, aadhaarFileName: d.aadhaarFile?.name || '', panFile: undefined, panFileName: d.panFile?.name || '', createdBy: user.id, createdAt: new Date().toISOString(), status: 'Active', activityLog: [logEntry] };
      await createCustomerProjection(id, createdCustomer);
      if (d.assignedToId) await sendNotification(d.assignedToId, NotificationType.CUSTOMER_ASSIGNED, 'Customer assigned', `Customer ${d.fullName || id} was assigned to you.`, 'customer', id, notificationCompanyId);
      await notifyRoleUsers(['Admin', 'Director'], NotificationType.CUSTOMER_CREATED, 'Customer created', `Customer ${d.fullName || id} was created.`, 'customer', id, notificationCompanyId);
      return createdCustomer;
    },
    onSuccess: (createdCustomer: any) => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      toast.success('B2C Customer created!');
      closeCreateForm();
      if (createdCustomer?.id) openDetails(createdCustomer, true);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      await deleteCustomerProjection(id);
      await notifyRoleUsers(['Admin', 'Director'], NotificationType.CUSTOMER_DELETED, 'Customer deleted', `Customer ${id} was deleted.`, 'customer', id, notificationCompanyId);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['customers'] }); toast.success('Deleted'); setDelId(null); setSelected(new Set()); },
  });

  const transferCustomer = useMutation({
    mutationFn: async ({ customerId, newUserId, newUserName, note, existingLog, existingHistory }: any) => {
      const logEntry = { id: genId.generic('LOG'), type: 'Transfer', desc: `Transferred to ${newUserName}. Note: ${note}`, date: new Date().toISOString(), userName: user.name };
      const historyEntry = { fromUserId: user.id, fromUserName: user.name, toUserId: newUserId, toUserName: newUserName, note, transferredAt: new Date().toISOString() };
      await updateProjectionWithEntity(COLLECTIONS.CUSTOMERS, customerId, { assignedToId: newUserId, assignedToName: newUserName, activityLog: [...(existingLog || []), logEntry], transferHistory: [...(existingHistory || []), historyEntry], updatedBy: user.id });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['customers'] }); toast.success('Customer transferred!'); setShowTransfer(null); },
    onError: (e: any) => toast.error(e.message),
  });

  // ── Helpers
  useEffect(() => {
    if (createParam !== '1') return;
    setCreateType(null);
    setShowTypeChooser(true);
  }, [createParam]);

  function closeCreateForm() {
    setCreateType(null); setShowTypeChooser(false);
    setLockedSourceLead(null);
    setB2bForm({ ...B2B_FORM0 }); setB2cForm({ ...B2C_FORM0 });
    if (createParam === '1') {
      const next = new URLSearchParams(searchParams);
      next.delete('create');
      setSearchParams(next, { replace: true });
    }
  }

  function openCreate() { setShowTypeChooser(true); }

  function handleB2BSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (createB2B.isPending) return;
    if (!b2bForm.contactPerson) return toast.error('Name required');
    if (!b2bForm.companyName && !b2bForm.company) return toast.error('Company name required');
    if (!b2bForm.businessPhone) return toast.error('Business phone required');
    createB2B.mutate(b2bForm);
  }

  function handleB2CSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (createB2C.isPending) return;
    if (!b2cForm.fullName) return toast.error('Full name required');
    if (!b2cForm.mobile) return toast.error('Mobile number required');
    if (!b2cForm.address) return toast.error('Address required');
    createB2C.mutate(b2cForm);
  }

  function handleBillFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => setB2cForm(f => ({ ...f, electricityBillFile: file, electricityBillPreview: evt.target?.result as string }));
    reader.readAsDataURL(file);
  }

  function handleB2BBillFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setB2bForm(f => ({ ...f, billUpload: file, billUploadName: file.name }));
  }

  function exportSelected() {
    const rows = (customers as any[]).filter(c => selected.has(c.id));
    if (!rows.length) return toast.error('No customers selected');
    downloadCustomersCsv(rows, `customers-export-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${rows.length} customer${rows.length > 1 ? 's' : ''}`);
  }

  // Phase 5.3 popup retirement: the Customer Workspace (/customers/:id) is
  // now the primary View/Edit experience. `?open=ID` is kept as a stable,
  // still-linked-to-from-elsewhere (notifications, Orders, Loan Applications,
  // Mobile Lead Workspace) deep-link contract, but now redirects straight
  // into the Workspace instead of opening the retired CustomerDetailModal —
  // see the redirect effect below. This also removes that popup's own
  // limitation of only working for a customer already on the loaded page.
  function openDetails(customer: any, replace = false) {
    if (!customer?.id) return;
    navigate(`/customers/${encodeURIComponent(customer.id)}`, { replace });
  }

  function handleRowClick(e: React.MouseEvent, customer: any) {
    if (window.getSelection()?.toString()) return;
    if (isRowOpenIgnored(e.target)) return;
    openDetails(customer);
  }

  function handleRowKeyDown(e: React.KeyboardEvent, customer: any) {
    if (isRowOpenIgnored(e.target)) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    openDetails(customer);
  }

  // ── Filtering + sorting
  const filtered = useMemo(() => {
    let list = [...(customers as any[])];

    if (activeKpi === 'active') list = list.filter(c => (c.status || 'Active') === 'Active');
    else if (activeKpi === 'inactive') list = list.filter(c => c.status === 'Inactive');
    else if (activeKpi === 'newMonth') list = list.filter(c => isThisMonth(c.createdAt));
    else if (activeKpi === 'overdue') list = list.filter(c => isOverdue(c.next_date));
    else if (activeKpi === 'highValue') list = list.filter(highValueCustomer);

    const q = deferredSearch.toLowerCase();
    if (q) list = list.filter(c =>
      [c.name, c.fullName, c.phone, c.mobile, c.businessPhone, c.email, c.businessEmail, c.company, c.city, c.gst]
        .some((v: any) => String(v || '').toLowerCase().includes(q))
    );

    if (typeF) list = list.filter(c => c.type === typeF);
    if (statusF) list = list.filter(c => (c.status || 'Active') === statusF);
    if (assignF) list = list.filter(c => c.assignedToId === assignF || c.assignedToName === assignF);
    if (dateRange !== 'all') list = list.filter(c => isInDateRange(c.createdAt, dateRange as any, customFrom, customTo));

    list.sort((a, b) => {
      const av = sortKey === 'name' ? customerDisplayName(a) : a[sortKey] || customerDisplayName(a);
      const bv = sortKey === 'name' ? customerDisplayName(b) : b[sortKey] || customerDisplayName(b);
      const ad = sortKey === 'createdAt' ? (toDate(av)?.getTime() ?? 0) : null;
      const bd = sortKey === 'createdAt' ? (toDate(bv)?.getTime() ?? 0) : null;
      const cmp = ad !== null && bd !== null ? ad - bd : String(av).localeCompare(String(bv));
      return sortDesc ? -cmp : cmp;
    });
    return list;
  }, [customers, deferredSearch, typeF, statusF, assignF, dateRange, customFrom, customTo, activeKpi, sortKey, sortDesc]);

  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  // `?open=ID` is a stable deep-link contract other pages (notifications,
  // Orders, Loan Applications, Mobile Lead Workspace) already navigate to
  // expecting to land on this customer — redirect straight into the
  // Workspace, the primary View/Edit experience, instead of the retired
  // CustomerDetailModal. Unlike that modal, this no longer needs the
  // customer to already be present on the currently-loaded page.
  useEffect(() => {
    if (!openParam) return;
    navigate(`/customers/${encodeURIComponent(openParam)}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openParam]);

  // Customer Type (B2B/B2C) is now changed through the normal Edit Customer
  // flow in the Workspace itself (CustomerWorkspaceEditor.tsx) — the old
  // structural-edit query-param routing into this list page's own edit form
  // is retired along with that form (see CustomerWorkspaceDialogs.tsx).

  const stats = useMemo(() => {
    const all = customers as any[];
    return {
      total: all.length,
      active: all.filter(c => (c.status || 'Active') === 'Active').length,
      inactive: all.filter(c => c.status === 'Inactive').length,
      newMonth: all.filter(c => isThisMonth(c.createdAt)).length,
      overdue: all.filter(c => isOverdue(c.next_date)).length,
      highValue: all.filter(highValueCustomer).length,
    };
  }, [customers]);

  const isTotalDefault = useMemo(() => {
    return !activeKpi && !search && !typeF && !statusF && !assignF && dateRange === 'all';
  }, [activeKpi, search, typeF, statusF, assignF, dateRange]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (search) count++;
    if (typeF) count++;
    if (statusF) count++;
    if (assignF) count++;
    if (dateRange !== 'all') count++;
    if (activeKpi) count++;
    return count;
  }, [search, typeF, statusF, assignF, dateRange, activeKpi]);

  const toggleSelect = useCallback((id: string) =>
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);
  const toggleAll = () =>
    setSelected(s => s.size === paginated.length ? new Set() : new Set(paginated.map((c: any) => c.id)));
  const allSel = selected.size === paginated.length && paginated.length > 0;

  function sort(k: string) {
    if (sortKey === k) { setSortDesc(d => !d); } else { setSortKey(k); setSortDesc(true); }
  }

  function clearAll() {
    setSearch(''); setTypeF(''); setStatusF(''); setAssignF('');
    setDateRange('all'); setCustomFrom(''); setCustomTo(''); setActiveKpi(''); setPage(1);
    syncQueueParams({ q: '', type: '', status: '', owner: '', date: 'all', from: '', to: '', kpi: '', page: 1 });
  }

  const assignOptions = [{ label: 'All Assigned', value: '' }, ...salesUsers.map(u => ({ label: u.name, value: u.id }))];

  const KPI_TILES = [
    { label: 'TOTAL', value: stats.total, key: '', icon: <Target className="h-4 w-4" />, description: `${stats.total} total customers` },
    { label: 'ACTIVE', value: stats.active, key: 'active', icon: <Users className="h-4 w-4" />, description: 'Active customers' },
    { label: 'INACTIVE', value: stats.inactive, key: 'inactive', icon: <User className="h-4 w-4" />, description: 'Inactive customers' },
    { label: 'NEW THIS MONTH', value: stats.newMonth, key: 'newMonth', icon: <Calendar className="h-4 w-4" />, description: 'Registered this month' },
    { label: 'OVERDUE', value: stats.overdue, key: 'overdue', icon: <AlertTriangle className="h-4 w-4" />, description: 'Follow-up overdue' },
    { label: 'HIGH VALUE', value: stats.highValue, key: 'highValue', icon: <Building2 className="h-4 w-4" />, description: 'High value customers' },
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
    if (newDateRange !== 'custom') { setCustomFrom(''); setCustomTo(''); }
    syncQueueParams({ date: newDateRange, from: '', to: '', page: 1 });
  }

  // ─────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      {/* ── Premium Workspace Hero ─────────────────────────── */}
      <WorkspaceHero
        title="Customers"
        icon={<Building2 className="h-6 w-6" />}
        breadcrumbs={['Home', 'Sales', 'Customers']}
        statusText="Last sync · Realtime Connected"
        statusDotColor="var(--color-success)"
        className="gap-3"
        actions={
          <>
            <Button variant="outline" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => refetch()}>
              Refresh
            </Button>
            <Button variant="outline" size="sm" icon={<UploadCloud className="h-3.5 w-3.5" />} onClick={() => setShowCsvImport(true)}>
              Upload CSV
            </Button>
            {perms.canCreate('customers') && (
              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                Add Customer
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
        {/* ── Card Header with Search + Filters + Active Pills */}
        <CardHeader className="px-6 pt-2 pb-2 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <input
              aria-label="Search customers"
              placeholder="Search name, phone, email, company..."
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
              aria-label="Type"
              value={typeF}
              onChange={(e) => {
                const v = e.target.value;
                setTypeF(v);
                setPage(1);
                syncQueueParams({ type: v, page: 1 });
              }}
              options={[{ label: 'All Types', value: '' }, { label: 'B2B', value: 'B2B' }, { label: 'B2C', value: 'B2C' }]}
              className="w-[110px] h-8 py-1"
            />
            <Select
              aria-label="Status"
              value={statusF}
              onChange={(e) => {
                const v = e.target.value;
                setStatusF(v);
                if (v && activeKpi && activeKpi !== 'highValue' && activeKpi !== 'newMonth' && activeKpi !== 'overdue') {
                  setActiveKpi('');
                  setPage(1);
                  syncQueueParams({ status: v, kpi: '', page: 1 });
                } else {
                  setPage(1);
                  syncQueueParams({ status: v, page: 1 });
                }
              }}
              options={[{ label: 'All Status', value: '' }, { label: 'Active', value: 'Active' }, { label: 'Inactive', value: 'Inactive' }]}
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
                {typeF && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">{typeF}</span>
                )}
                {statusF && !activeKpi && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">{statusF}</span>
                )}
                {assignF && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">{assignF}</span>
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
              {selected.size} customer{selected.size > 1 ? 's' : ''} selected
            </span>
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <Button size="sm" variant="outline"
                icon={<Download className="h-3.5 w-3.5" />}
                onClick={exportSelected}
                className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30">
                Export CSV
              </Button>
              {perms.canDelete('customers') && (
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
                  <UniversalCheckbox checked={allSel} indeterminate={selected.size > 0 && !allSel} onChange={toggleAll} ariaLabel="Select visible customers" />
                </Th>
                <Th sortable sorted={sortKey === 'name'} desc={sortDesc} onSort={() => sort('name')} style={{ width: '25%', minWidth: 200 }}>NAME</Th>
                <Th style={{ width: 120, minWidth: 120 }}>PHONE</Th>
                <Th style={{ width: 100, minWidth: 100 }}>SOURCE</Th>
                <Th sortable sorted={sortKey === 'type'} desc={sortDesc} onSort={() => sort('type')} style={{ width: 80, minWidth: 80 }}>TYPE</Th>
                <Th sortable sorted={sortKey === 'status'} desc={sortDesc} onSort={() => sort('status')} style={{ width: 110, minWidth: 110 }}>STATUS</Th>
                <Th style={{ width: '12%', minWidth: 130 }}>ASSIGNED</Th>
                <Th style={{ width: '12%', minWidth: 130 }}>LAST ACTIVITY</Th>
                <Th sortable sorted={sortKey === 'createdAt'} desc={sortDesc} onSort={() => sort('createdAt')} style={{ width: 90, minWidth: 90 }}>CREATED</Th>
                <Th align="center" style={{ width: 110, minWidth: 110 }}>ACTIONS</Th>
              </Thead>
              <Tbody>
                {isLoading
                  ? <SkeletonRows cols={10} />
                  : paginated.length === 0
                    ? (
                      <tr>
                        <td colSpan={10} className="py-14 text-center">
                          <EmptyState
                            icon={<Building2 className="h-9 w-9" />}
                            title={search || typeF || statusF || assignF || activeKpi ? 'No customers match filters' : 'No customers yet'}
                            description={search || typeF || statusF || assignF || activeKpi ? undefined : 'Add your first customer to get started.'}
                            action={!search && !typeF && !statusF && !assignF && !activeKpi && perms.canCreate('customers') ? (
                              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate} className="mt-2">Add Your First Customer</Button>
                            ) : undefined}
                          />
                        </td>
                      </tr>
                    )
                    : paginated.map((c: any) => {
                      const displayName = customerDisplayName(c);
                      const phone = customerPhone(c);
                      const assignedName = c.assignedToName || 'Unassigned';
                      const isOverdueEntry = isOverdue(c.next_date);
                      const lastActivity = c.last_note || c.activityLog?.[c.activityLog.length - 1]?.desc || '—';
                      return (
                        <Tr key={c.id} selected={selected.has(c.id)}
                          data-record-id={c.id}
                          role="button"
                          tabIndex={0}
                          onClick={(e) => handleRowClick(e, c)}
                          onKeyDown={(e) => handleRowKeyDown(e, c)}
                          className={`transition-colors duration-150 ${isOverdueEntry ? 'bg-[rgba(239,68,68,0.04)] border-l-[3px] border-l-[var(--color-danger)]' : ''}`}
                        >
                          {/* Checkbox */}
                          <Td className="py-3" onClick={(e) => e.stopPropagation()}>
                            <UniversalCheckbox checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} ariaLabel={`Select ${displayName}`} />
                          </Td>

                          {/* Name + Avatar */}
                          <Td className="py-3 min-w-[200px]">
                            <div className="flex items-center gap-2.5">
                              <div className="h-7 w-7 shrink-0 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary-text)] flex items-center justify-center text-[11px] font-bold">
                                {(displayName || '?')[0].toUpperCase()}
                              </div>
                              <div className="flex flex-col gap-0.5">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-sm font-medium text-[var(--color-text)] leading-tight">{displayName}</span>
                                  {isOverdueEntry && <span title="Follow-up overdue"><AlertTriangle className="h-3 w-3 shrink-0 text-[var(--color-danger)]" /></span>}
                                </div>
                                <span className="text-[12px] text-[var(--color-text-muted)] leading-tight">{customerSecondaryLine(c)}</span>
                              </div>
                            </div>
                          </Td>

                          {/* Phone */}
                          <Td className="py-3">
                            {phone !== '—' ? (
                              <a href={`tel:${phone}`} title="Call" data-interactive
                                onClick={(e) => e.stopPropagation()}
                                className="text-[var(--color-primary)] hover:underline inline-flex items-center gap-1 text-[13px] font-medium">
                                <Phone className="h-3 w-3" />{phone}
                              </a>
                            ) : <EmptyCell />}
                          </Td>

                          {/* Source — themed badge */}
                          <Td className="py-3">
                            {c.sourceLeadId ? sourceBadge('Lead') : sourceBadge(c.source || 'Direct')}
                          </Td>

                          {/* Type */}
                          <Td className="py-3">
                            <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold leading-tight ${
                              c.type === 'B2B'
                                ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400 border-purple-200 dark:border-purple-700'
                                : c.type === 'B2C'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 border-emerald-200 dark:border-emerald-700'
                                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border-gray-200 dark:border-gray-700'
                            }`}>{c.type || '—'}</span>
                          </Td>

                          {/* Status */}
                          <Td className="py-3"><span data-interactive onClick={(e) => e.stopPropagation()}>{statusBadge(c.status || 'Active')}</span></Td>

                          {/* Assigned To */}
                          <Td className="py-3 whitespace-nowrap">
                            {assignedName === 'Unassigned' ? (
                              <span className="inline-flex items-center rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-text-muted)]">Unassigned</span>
                            ) : (
                              <span className="text-[13px] text-[var(--color-text-secondary)] whitespace-nowrap">{assignedName}</span>
                            )}
                          </Td>

                          {/* Last Activity */}
                          <Td className="py-3">
                            <span className="text-[13px] text-[var(--color-text-muted)] line-clamp-2 leading-snug max-w-[140px] inline-block" title={lastActivity}>
                              {lastActivity === '—' ? <EmptyCell /> : lastActivity}
                            </span>
                          </Td>

                          {/* Created Date */}
                          <Td className="py-3"><CreatedDateCell value={c.createdAt} recencyDotClass={recencyDotClass} formatCustomerCreated={formatCustomerCreated} /></Td>

                          {/* Actions — Final Customer Module Polish mission:
                              trimmed to exactly View (→ Workspace) and Assign
                              Customer. Schedule Follow-up and Delete were
                              retired from this row (still reachable from the
                              bulk action bar for Delete, and from the
                              Workspace's own Quick Actions for Follow-up). */}
                          <Td className="py-3" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-center gap-1.5">
                              <Button size="xs" variant="outline" onClick={() => openDetails(c)} className="shrink-0">
                                <Eye className="h-3.5 w-3.5 mr-1" />
                                View
                              </Button>
                              <Button size="xs" variant="outline" title="Assign Customer" onClick={() => setShowTransfer(c)} className="shrink-0 px-2">
                                <UserCheck className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </Td>
                        </Tr>
                      );
                    })
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
              onChange={nextPage => { setPage(nextPage); syncQueueParams({ page: nextPage }); }}
              onPerPageChange={n => { setPerPage(n); setPage(1); syncQueueParams({ perPage: n, page: 1 }); }}
            />
          </div>
        </div>
      </Card>

      {/* ── Dialogs & Modals ────────────────────────────────── */}
      <CustomerWorkspaceDialogs
        ctx={{
          showTypeChooser, setShowTypeChooser, createType, setCreateType, lockedSourceLead,
          b2bForm, setB2bForm, b2cForm, setB2cForm, createB2B, createB2C, closeCreateForm,
          salesUsers, STATE_OPTS: [{ label: 'Select State', value: '' }, ...INDIAN_STATES.map((s: string) => ({ label: s, value: s }))], PROPERTY_TYPES: ['Residential', 'Commercial', 'Industrial', 'Agricultural'],
          INDUSTRY_TYPES: ['Manufacturing', 'Retail', 'IT/Software', 'Healthcare', 'Education', 'Real Estate', 'Agriculture', 'Other'],
          ROOF_TYPES: ['RCC Flat', 'Tin Sheet', 'Asbestos', 'Mangalore Tile', 'Other'],
          billFileRef, b2bBillFileRef, aadhaarFileRef, panFileRef,
          handleBillFile, handleAadhaarFile, handlePanFile, handleB2BBillFile,
          handleB2BSubmit, handleB2CSubmit, ctxToast: toast,
          showCsvImport, setShowCsvImport,
        }}
      />


      <CustomerTransferModal
        open={!!showTransfer}
        customer={showTransfer}
        salesUsers={salesUsers}
        onClose={() => { setShowTransfer(null); }}
        onSave={({ customerId, newUserId, newUserName, note, existingLog, existingHistory }) => {
          transferCustomer.mutate({ customerId, newUserId, newUserName, note, existingLog, existingHistory });
        }}
        saving={transferCustomer.isPending}
      />

      {showCsvImport && (
        <CSVImportModal
          collection="customers"
          onClose={() => setShowCsvImport(false)}
          onSuccess={() => { setShowCsvImport(false); qc.invalidateQueries({ queryKey: ['customers'] }); }}
        />
      )}

      <ConfirmDialog
        open={!!delId} onClose={() => setDelId(null)}
        onConfirm={() => {
          if (delId === '__bulk__') {
            Promise.all(Array.from(selected).map(id => del.mutateAsync(id)))
              .then(() => { setSelected(new Set()); setDelId(null); })
              .catch(() => {});
          } else if (delId) {
            del.mutate(delId);
          }
        }}
        loading={del.isPending} title="Delete Customer"
        message={delId === '__bulk__' ? `Delete ${selected.size} selected customers permanently? This cannot be undone.` : 'Delete this customer permanently? This cannot be undone.'}
      />
    </div>
  );
}
