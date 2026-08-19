/**
 * Users — User & Access Management workspace (Desktop Gold Standard)
 *
 * Preserves all existing business logic: Firebase Auth user creation,
 * user projections, role assignments, permissions, Super Admin management.
 * Visually identical to Leads. Only business data changes.
 */

import { useState, useMemo, useCallback, useEffect, useDeferredValue, useRef, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { getAll, getAllPlatform, getOne, fmtDate } from '../lib/firestore';
import { logCreate, logUpdate, logRoleChange, logPermissionChange, logDelete } from '../lib/auditLogger';
import { createUserProjection, updateUserProjection, deleteUserProjection } from '../features/users/hooks/useUsers';
import { provisionAuthenticatedUser } from '../lib/authProvisioning';
import { isEligibleManagerOption, type OrgRoleLike, type OrgUserLike } from '../features/users/orgHierarchy';
import { COLLECTIONS, db } from '../lib/firebase';
import { query as fbQuery, collection, where, getDocs } from 'firebase/firestore';
import { Shield, Plus, RefreshCw, Eye, Edit2, Trash2, X, UserCheck, UserX, UserCog, Users as UsersIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAppStore, useCurrentUser } from '../store/useAppStore';
import { usePermissions } from '../lib/permissions';
import { useWarehouses } from '../features/warehouses/hooks/useWarehouses';
import {
  Button, Card, CardHeader, ConfirmDialog, EmptyState, Pagination,
  PremiumKpi, Select, SkeletonRows, Table, Tbody, Td, Th, Thead, Tr,
  UniversalCheckbox, WorkspaceHero,
} from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { Input, Select as InputSelect, FormRow, FormSection } from '../components/ui/Input';
import { Badge, statusBadge } from '../components/ui/Badge';

const PER_PAGE = 15;
const DEFAULT_USER_ROLE = 'Sales Executive';
const FORM0 = {
  name: '', email: '', phone: '', role: DEFAULT_USER_ROLE, managerId: '', status: 'Active', warehouseId: '', password: '', isSuperAdmin: false,
  // Super Admin only (§ tenant-assignment requirement): the target Group and
  // Company must be explicitly selected and cross-validated before a new
  // user is provisioned — never silently inferred. Ignored for every other
  // actor (Group Admin/Company Admin creations resolve their own company
  // automatically, unchanged — see resolveWriteCompanyId()).
  groupId: '', companyId: '',
};

const DATE_OPTIONS = [
  { label: 'All dates', value: '' },
  { label: 'Today', value: 'today' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'Custom', value: 'custom' },
];

export default function UsersPage() {
  const qc = useQueryClient();
  const currentUser = useCurrentUser();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const perms = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();

  // Tenant-assignment requirement: a Super Admin creating a user must
  // explicitly select the target Group and Company (never an inferred
  // default) — see the Group/Company picker in the create form below and
  // its cross-validation in handleSubmit. Platform-wide reads (every Group/
  // every Company, not just the actor's own) require the Owner/Super Admin
  // identity — getAllPlatform() itself throws otherwise, hence `enabled`.
  const isPlatformActor = !!(currentUser?.isOwner || currentUser?.isSuperAdmin);
  const { data: platformGroups = [] } = useQuery({
    queryKey: ['platform-groups'],
    queryFn: () => getAllPlatform<any>(COLLECTIONS.GROUPS),
    staleTime: 30_000,
    enabled: isPlatformActor,
  });
  const { data: platformCompanies = [] } = useQuery({
    queryKey: ['platform-companies'],
    queryFn: () => getAllPlatform<any>(COLLECTIONS.COMPANIES),
    staleTime: 30_000,
    enabled: isPlatformActor,
  });

  // Filters
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const deferredSearch = useDeferredValue(search);
  const [roleF, setRoleF] = useState(() => searchParams.get('role') || '');
  const [statusF, setStatusF] = useState(() => searchParams.get('status') || '');
  const [dateRange, setDateRange] = useState(() => searchParams.get('date') || '');
  const [customFrom, setCustomFrom] = useState(() => searchParams.get('from') || '');
  const [customTo, setCustomTo] = useState(() => searchParams.get('to') || '');
  const [activeKpi, setActiveKpi] = useState(() => searchParams.get('kpi') || '');
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [perPage, setPerPage] = useState(() => Math.max(1, Number(searchParams.get('perPage')) || PER_PAGE));
  const [sortKey, setSortKey] = useState('name');
  const [sortDesc, setSortDesc] = useState(false);

  // Selection & drawers
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewItem, setViewItem] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...FORM0 });
  const [delId, setDelId] = useState<string | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<'overview' | 'roles' | 'activity'>('overview');

  const openParam = searchParams.get('open') || '';
  const createParam = searchParams.get('create') || '';

  // Queries
  // Gated on perms.ready (permissionCache.ready): false on every fresh boot,
  // true only once identity + roles have both resolved together (useGlobalBoot).
  // Without this gate the query fired the instant the component mounted —
  // including mid-boot, before the ERP identity/tenant context was ready —
  // producing an unscoped or mismatched-tenant Firestore read that the rules
  // correctly (but unhelpfully) deny as "Missing or insufficient permissions"
  // (Admin /users runtime-storm root cause).
  const { data: users = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['users'],
    // Typed as OrgUserLike so the manager-selector helpers below are type-safe
    // without `as any` casts (getAll's default DocumentData index signature is
    // not structurally compatible in strict callback variance).
    queryFn: () => getAll<OrgUserLike>(COLLECTIONS.USERS),
    staleTime: 30000,
    enabled: perms.ready,
    retry: 1,
  });

  // Phase 5 (§7.5/§7.7): roles are per-Company documents (F-03 keying — no
  // groupId field), so in "All Companies (Group view)" mode the group-scoped
  // query would be unprovable at the rules layer. The role dropdown falls back
  // to the Group Admin's HOME company role documents (their Admin-equivalent
  // permission source per §5.2) — still rules-provable via canReadCompanyScoped().
  const { data: roles = [] } = useQuery({
    queryKey: ['roles', activeCompanyId === 'group' ? `home:${currentUser?.companyId || ''}` : 'scoped'],
    queryFn: async () => {
      if (activeCompanyId === 'group') {
        const homeCompanyId = currentUser?.companyId;
        if (!homeCompanyId) return [];
        const snap = await getDocs(fbQuery(collection(db, COLLECTIONS.ROLES), where('companyId', '==', homeCompanyId)));
        return snap.docs.map((d: any) => ({ ...d.data(), id: d.id }));
      }
      return getAll<OrgRoleLike>(COLLECTIONS.ROLES);
    },
    staleTime: 300000,
    enabled: perms.ready,
  });

  // Data-driven section model: a user's department is the department of their
  // role. The reporting-manager selector only offers eligible managers for the
  // selected role's section (same department, cross-section Management layer,
  // or super-admin) — never every user in the company. Typed structurally via
  // OrgUserLike/OrgRoleLike (getAll returns DocumentData, structurally
  // compatible) — no `as any` casts.
  const roleNameOf = useCallback((candidate: OrgUserLike) => String(candidate.role || '').trim().toLowerCase(), []);
  const roleByUser = useCallback((candidate: OrgUserLike) =>
    roles.find((r: OrgRoleLike) => String(r.name || '').trim().toLowerCase() === roleNameOf(candidate)) || null,
  [roles, roleNameOf]);
  const formRoleDepartment = useMemo(() => {
    const roleDoc = roles.find((r: OrgRoleLike) => String(r.name || '').trim().toLowerCase() === String(form.role || '').trim().toLowerCase());
    return String(roleDoc?.department || '');
  }, [roles, form.role]);
  const managerOptions = useMemo(() => [
    { label: 'None (Self)', value: '' },
    ...users
      .filter((u: OrgUserLike) => String(u.id || '') !== editId && isEligibleManagerOption(u, formRoleDepartment, roleByUser(u)))
      .map((u: OrgUserLike) => ({ label: String(u.name || ''), value: String(u.id || '') })),
  ], [users, editId, formRoleDepartment, roleByUser]);

  // Phase 12: warehouseId was already tracked in form state (FORM0, openEdit)
  // and already sent on save — but no <Select> ever existed to let a user
  // actually set it, so it could never be assigned through this UI at all.
  const { data: warehouses = [] } = useWarehouses();
  const warehouseOptions = useMemo(() => [
    { label: 'No warehouse assigned', value: '' },
    ...(warehouses as any[]).map((w: any) => ({ label: w.name, value: w.id })),
  ], [warehouses]);

  const canCreateUsers = perms.can('users', 'create');
  const canEditUsers = perms.can('users', 'edit');
  const canDeleteUsers = perms.can('users', 'delete');
  const canEditRoles = perms.can('roles', 'edit');
  const canManageSuperAdmin = currentUser?.isSuperAdmin === true;

  // Mutations
  const save = useMutation({
    mutationFn: async (d: typeof FORM0) => {
      if (editId) {
        // groupId/companyId are a creation-time-only decision (the Super
        // Admin picker below) — always stripped here regardless of form
        // state, so an edit can never accidentally overwrite an existing
        // user's tenant assignment with an empty/stale value.
        const { password: _, groupId: _groupId, companyId: _companyId, ...rest } = d;
        // F-16 (Phase 0): capture the pre-mutation state so role/permission/
        // status changes are audited with old + new values. Previously the
        // most security-sensitive user mutations (role change, super-admin
        // grant, deactivation) left NO audit trail at all.
        const existing = await getOne<any>(COLLECTIONS.USERS, editId).catch(() => null);
        await updateUserProjection(editId, rest);
        if (existing) {
          if ((existing.role || '') !== (rest.role || '')) {
            await logRoleChange(editId, existing.email || rest.email || '', existing.role || '', rest.role || '');
          }
          if (Boolean(existing.isSuperAdmin) !== Boolean(rest.isSuperAdmin)) {
            await logPermissionChange(editId, existing.email || rest.email || '', rest.role || existing.role || '', { isSuperAdmin: Boolean(rest.isSuperAdmin) });
          }
          if ((existing.status || 'Active') !== (rest.status || 'Active')) {
            await logUpdate('user', editId, { status: existing.status || 'Active' }, { status: rest.status || 'Active' }, 'users');
          }
        }
      } else {
        const { password: _, ...rest } = d;
        const authId = await provisionAuthenticatedUser({
          email: d.email,
          password: d.password,
          createProfile: async (authId) => {
            await createUserProjection(authId, { ...rest, id: authId, createdBy: currentUser?.id });
            return authId;
          },
        });
        // F-16 (Phase 0): audit user creation.
        await logCreate('user', authId, { name: rest.name, email: rest.email, role: rest.role, status: rest.status }, 'users');
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success(editId ? 'Updated' : 'User added'); closeForm(); },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      await deleteUserProjection(id);
      // F-16 (Phase 0): audit user deletion (soft delete).
      await logDelete('user', id, undefined, 'users');
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success('Deleted'); setDelId(null); },
    onError: (e: any) => toast.error(e.message),
  });

  function closeForm() { setShowForm(false); setEditId(null); setForm({ ...FORM0 }); }

  function openEdit(u: any) {
    setForm({
      name: u.name || '', email: u.email || '', phone: u.phone || '',
      role: u.role || '', managerId: u.managerId || '', status: u.status || 'Active',
      warehouseId: u.warehouseId || '', password: '', isSuperAdmin: u.isSuperAdmin === true,
      // Not editable here — a user's company/group assignment is a creation-
      // time-only decision (see the Super Admin picker in the create form
      // and the explicit strip in handleSubmit's edit branch below).
      groupId: '', companyId: '',
    });
    setEditId(u.id);
    setShowForm(true);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name || !form.email) return toast.error('Name & email required');
    if (!editId && !form.password) return toast.error('Temporary password required');
    // Tenant-assignment requirement: a Super Admin must explicitly select
    // and cross-validate the target Group + Company before a new user is
    // provisioned — never an inferred default (that inference is reserved
    // for Group Admin/Company Admin creations, which always resolve to
    // their own company automatically).
    if (!editId && isPlatformActor) {
      if (!form.groupId) return toast.error('Select a Group');
      if (!form.companyId) return toast.error('Select a Company');
      const selectedCompany = platformCompanies.find((c: any) => c.id === form.companyId);
      if (!selectedCompany || selectedCompany.groupId !== form.groupId) {
        return toast.error('The selected Company does not belong to the selected Group');
      }
    }
    save.mutate(form);
  }

  // URL sync
  function syncQueueParams(nextState: Record<string, string | number | undefined>) {
    const next = new URLSearchParams(searchParams);
    const keys = ['q', 'role', 'status', 'date', 'from', 'to', 'kpi', 'page', 'perPage'];
    keys.forEach((key) => {
      const val = nextState[key] ?? searchParams.get(key);
      if (val && val !== '' && val !== 1 && val !== 15) next.set(key, String(val));
      else next.delete(key);
    });
    setSearchParams(next, { replace: true });
  }

  function clearAll() {
    setSearch(''); setRoleF(''); setStatusF(''); setDateRange(''); setCustomFrom(''); setCustomTo('');
    setActiveKpi(''); setPage(1); setSelected(new Set());
    syncQueueParams({ q: '', role: '', status: '', date: '', from: '', to: '', kpi: '', page: 1 });
  }

  // Sorting
  function handleSort(k: string) {
    if (sortKey === k) setSortDesc(d => !d);
    else { setSortKey(k); setSortDesc(true); }
  }

  // Detail auto-open from URL
  useEffect(() => {
    if (createParam === '1') {
      setForm({ ...FORM0 }); setEditId(null); setShowForm(true);
    }
  }, [createParam]);

  const lastClosedParamRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastClosedParamRef.current === openParam) { lastClosedParamRef.current = null; return; }
    if (!openParam) return;
    const found = (users as any[]).find(u => u.id === openParam);
    if (found) { setDetailTab('overview'); setViewItem(found); }
  }, [openParam, users]);

  // Selection
  const toggleSelect = useCallback((id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);

  function isRowOpenIgnored(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false;
    return Boolean(target.closest('button,a,input,select,textarea,[data-action],[data-interactive]'));
  }

  // Stats
  const stats = useMemo(() => {
    const all = users as any[];
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
    return {
      total: all.length,
      active: all.filter((u: any) => u.status === 'Active').length,
      inactive: all.filter((u: any) => u.status === 'Inactive').length,
      suspended: all.filter((u: any) => u.status === 'Suspended').length,
      admins: all.filter((u: any) => u.role === 'Admin').length,
      newThisMonth: all.filter((u: any) => {
        const d = u.createdAt ? new Date(u.createdAt) : null;
        return d && !isNaN(d.getTime()) && d >= thirtyDaysAgo;
      }).length,
    };
  }, [users]);

  const isTotalDefault = !activeKpi && !search && !roleF && !statusF && !dateRange;

  // Filtering
  const filtered = useMemo(() => {
    let list = [...(users as any[])];
    const q = deferredSearch.toLowerCase().trim();
    if (q) list = list.filter((u: any) => [u.name, u.email, u.phone, u.role].some((v: any) => String(v || '').toLowerCase().includes(q)));
    if (activeKpi === 'active') list = list.filter((u: any) => u.status === 'Active');
    else if (activeKpi === 'inactive') list = list.filter((u: any) => u.status === 'Inactive');
    else if (activeKpi === 'suspended') list = list.filter((u: any) => u.status === 'Suspended');
    else if (activeKpi === 'admins') list = list.filter((u: any) => u.role === 'Admin');
    else if (activeKpi === 'newThisMonth') {
      const now = new Date(); now.setHours(0, 0, 0, 0);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
      list = list.filter((u: any) => {
        const d = u.createdAt ? new Date(u.createdAt) : null;
        return d && !isNaN(d.getTime()) && d >= thirtyDaysAgo;
      });
    }
    if (roleF) list = list.filter((u: any) => u.role === roleF);
    if (statusF) list = list.filter((u: any) => u.status === statusF);
    if (dateRange) {
      list = list.filter((u: any) => {
        if (!u.createdAt) return false;
        const d = new Date(u.createdAt);
        if (isNaN(d.getTime())) return false;
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
    list.sort((a: any, b: any) => {
      const va = String(a[sortKey] || ''), vb = String(b[sortKey] || '');
      return sortDesc ? vb.localeCompare(va) : va.localeCompare(vb);
    });
    return list;
  }, [users, deferredSearch, roleF, statusF, dateRange, customFrom, customTo, activeKpi, sortKey, sortDesc]);

  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  const toggleAll = () => setSelected(s => s.size === paginated.length ? new Set() : new Set(paginated.map((u: any) => u.id)));
  const allSel = selected.size === paginated.length && paginated.length > 0;

  useEffect(() => { const maxPage = Math.max(1, Math.ceil(filtered.length / perPage)); if (page > maxPage) setPage(maxPage); }, [filtered.length, perPage, page]);

  const hasActiveFilters = Boolean(search || roleF || statusF || dateRange || activeKpi);
  const activeFilterCount = (activeKpi ? 1 : 0) + (search ? 1 : 0) + (dateRange ? 1 : 0) + (roleF ? 1 : 0) + (statusF ? 1 : 0);

  const KPI_CONFIGS = [
    { key: '', label: 'TOTAL USERS', value: stats.total, icon: <UsersIcon className="h-4 w-4" />, description: 'All registered users' },
    { key: 'active', label: 'ACTIVE', value: stats.active, icon: <UserCheck className="h-4 w-4" />, description: 'Active users' },
    { key: 'inactive', label: 'INACTIVE', value: stats.inactive, icon: <UserX className="h-4 w-4" />, description: 'Inactive users' },
    { key: 'suspended', label: 'SUSPENDED', value: stats.suspended, icon: <Shield className="h-4 w-4" />, description: 'Suspended accounts' },
    { key: 'admins', label: 'ADMINISTRATORS', value: stats.admins, icon: <UserCog className="h-4 w-4" />, description: 'Admin role users' },
    { key: 'newThisMonth', label: 'NEW THIS MONTH', value: stats.newThisMonth, icon: <Plus className="h-4 w-4" />, description: 'Added in last 30 days' },
  ];

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      <WorkspaceHero
        title="Users & Access"
        icon={<Shield className="h-6 w-6" />}
        breadcrumbs={['Home', 'Settings', 'Users']}
        statusText={`${stats.total} users`}
        statusDotColor="var(--color-success)"
        className="gap-3"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => refetch()}>
              Refresh
            </Button>
            {canCreateUsers && (
              <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />}
                onClick={() => { setForm({ ...FORM0 }); setEditId(null); setShowForm(true); }}>
                Add User
              </Button>
            )}
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
              {canDeleteUsers && (
                <button onClick={() => { if (selected.size) setBulkDeleteOpen(true); }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-[10px] font-semibold hover:bg-[var(--color-surface-hover)] transition-colors text-red-600 dark:text-red-400">
                  <Trash2 className="h-3 w-3" /> Delete
                </button>
              )}
              <button onClick={() => setSelected(new Set())} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">✕ Clear</button>
            </div>
          </div>
        )}

        {/* Filters */}
        <CardHeader className="px-6 pt-2 pb-2 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
            <input aria-label="Search" placeholder="Search name, email, role..."
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

            <Select aria-label="Role" value={roleF} onChange={e => { setRoleF(e.target.value); setPage(1); syncQueueParams({ role: e.target.value, page: 1 }); }}
              options={[
                { label: 'All Roles', value: '' },
                ...(roles as any[]).map((r: any) => ({ label: r.name, value: r.name })),
              ]} className="w-[120px] h-8 py-1" />
            <Select aria-label="Status" value={statusF} onChange={e => { setStatusF(e.target.value); setPage(1); syncQueueParams({ status: e.target.value, page: 1 }); }}
              options={[
                { label: 'All Status', value: '' },
                { label: 'Active', value: 'Active' },
                { label: 'Inactive', value: 'Inactive' },
                { label: 'Suspended', value: 'Suspended' },
              ]} className="w-[110px] h-8 py-1" />
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]"><span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" /></div>
          </div>

          {activeFilterCount > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {activeKpi && (<span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary-light)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-primary-text)]">{KPI_CONFIGS.find(k => k.key === activeKpi)?.label || activeKpi}<button onClick={() => { setActiveKpi(''); setPage(1); syncQueueParams({ kpi: '', page: 1 }); }} className="ml-0.5 hover:opacity-70">✕</button></span>)}
              {search && (<span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)]">S: {search.length > 20 ? search.slice(0, 20) + '…' : search}<button onClick={() => { setSearch(''); setPage(1); }} className="ml-0.5 hover:opacity-70">✕</button></span>)}
              {dateRange && (<span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)]">{DATE_OPTIONS.find(d => d.value === dateRange)?.label || dateRange}<button onClick={() => { setDateRange(''); setCustomFrom(''); setCustomTo(''); setPage(1); syncQueueParams({ date: '', page: 1 }); }} className="ml-0.5 hover:opacity-70">✕</button></span>)}
              {roleF && (<span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)]">{roleF}<button onClick={() => { setRoleF(''); setPage(1); syncQueueParams({ role: '', page: 1 }); }} className="ml-0.5 hover:opacity-70">✕</button></span>)}
              {statusF && (<span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)]">{statusF}<button onClick={() => { setStatusF(''); setPage(1); syncQueueParams({ status: '', page: 1 }); }} className="ml-0.5 hover:opacity-70">✕</button></span>)}
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
                <Th sortable sorted={sortKey === 'name'} desc={sortDesc} onSort={() => handleSort('name')} style={{ minWidth: 140 }}>NAME</Th>
                <Th sortable sorted={sortKey === 'email'} desc={sortDesc} onSort={() => handleSort('email')} style={{ minWidth: 160 }}>EMAIL</Th>
                <Th style={{ width: 100 }}>PHONE</Th>
                <Th sortable sorted={sortKey === 'role'} desc={sortDesc} onSort={() => handleSort('role')} style={{ width: 100 }}>ROLE</Th>
                <Th sortable sorted={sortKey === 'status'} desc={sortDesc} onSort={() => handleSort('status')} style={{ width: 90 }}>STATUS</Th>
                <Th sortable sorted={sortKey === 'createdAt'} desc={sortDesc} onSort={() => handleSort('createdAt')} style={{ width: 100 }}>ADDED</Th>
                <Th style={{ width: 160 }}>ACTIONS</Th>
              </Thead>
              <Tbody>
                {isError ? (
                  <tr><td colSpan={8} className="py-14 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Shield className="h-10 w-10 text-[var(--color-text-disabled)]" />
                      <p className="text-sm text-[var(--color-text-muted)]">Failed to load users.</p>
                      <button onClick={() => refetch()} className="text-xs font-semibold text-[var(--color-primary)] hover:underline">Retry</button>
                    </div>
                  </td></tr>
                ) : isLoading || !perms.ready ? (<SkeletonRows cols={8} rows={6} />) : paginated.length === 0 ? (
                  <tr><td colSpan={8}>
                    <EmptyState icon={<Shield className="h-9 w-9" />}
                      title={hasActiveFilters ? 'No users match filters' : 'No users yet'}
                      description={hasActiveFilters ? 'Try adjusting your search or filters.' : 'Add your first user to get started.'}
                      action={!hasActiveFilters && canCreateUsers ? <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => { setForm({ ...FORM0 }); setEditId(null); setShowForm(true); }}>Add Your First User</Button> : undefined} />
                  </td></tr>
                ) : (
                  paginated.map((u: any) => (
                    <Tr key={u.id}
                      onClick={(e) => { if (!isRowOpenIgnored(e.target as HTMLElement)) { setDetailTab('overview'); setViewItem(u); } }}
                      className="group cursor-pointer transition-all duration-200 ease-out hover:bg-[var(--color-table-row-hover)] focus-visible:bg-[var(--color-table-row-hover)] focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-inset">
                      <Td><span data-interactive onClick={(e) => e.stopPropagation()}><UniversalCheckbox checked={selected.has(u.id)} onChange={() => toggleSelect(u.id)} /></span></Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                            {(u.name || '?')[0].toUpperCase()}
                          </div>
                          <p className="font-semibold text-[var(--color-text)] text-sm">{u.name || '—'}</p>
                        </div>
                      </Td>
                      <Td className="text-xs text-[var(--color-text)]">{u.email || '—'}</Td>
                      <Td className="text-xs text-[var(--color-text-muted)]">{u.phone || '—'}</Td>
                      <Td><span data-interactive onClick={(e) => e.stopPropagation()}><Badge variant="purple">{u.role || '—'}</Badge></span></Td>
                      <Td><span data-interactive onClick={(e) => e.stopPropagation()}>{statusBadge(u.status || 'Active')}</span></Td>
                      <Td className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">{fmtDate(u.createdAt)}</Td>
                      <Td>
                        <div data-action onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} className="flex items-center justify-end gap-1">
                          <button type="button" onClick={(e) => { e.stopPropagation(); setDetailTab('overview'); setViewItem(u); }}
                            className="inline-flex h-7 items-center gap-1 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-text)] px-3 py-1 text-xs font-semibold text-[var(--color-text-inverse)] shadow-[var(--shadow-enterprise-control)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]">
                            <Eye className="h-3.5 w-3.5" /> View
                          </button>
                          {canEditUsers && (
                            <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(u); }}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-primary-text)] hover:bg-[var(--color-primary-light)] transition-colors" title="Edit">
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {canDeleteUsers && (
                            <button type="button" onClick={(e) => { e.stopPropagation(); setDelId(u.id); }}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-danger-text)] hover:bg-[var(--color-danger-light)] transition-colors" title="Delete">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </Td>
                    </Tr>
                  ))
                )}
              </Tbody>
            </Table>
          </div>
          <div className="shrink-0 border-t border-[var(--color-border-subtle)]">
            <Pagination page={page} total={filtered.length} perPage={perPage}
              onChange={(p) => { setPage(p); syncQueueParams({ page: p }); }}
              onPerPageChange={(n) => { setPerPage(n); setPage(1); syncQueueParams({ perPage: n, page: 1 }); }} />
          </div>
        </div>
      </Card>

      {/* ── Detail View Modal ───────────────────────────────────────────── */}
      <Modal open={!!viewItem} onClose={() => {
        lastClosedParamRef.current = openParam;
        setViewItem(null);
        const next = new URLSearchParams(searchParams);
        next.delete('open');
        setSearchParams(next, { replace: true });
      }} size="2xl">
        {viewItem && (() => {
          const tabs = [
            { key: 'overview' as const, label: 'Overview' },
            { key: 'roles' as const, label: 'Roles & Permissions' },
            { key: 'activity' as const, label: 'Activity' },
          ];
          return (
            <div className="flex h-[70vh] max-h-[700px] min-h-0 flex-col">
              {/* Header */}
              <div className="shrink-0 flex items-start justify-between border-b border-[var(--color-border-subtle)] pb-4">
                <div className="flex items-center gap-3">
                  <div className="h-14 w-14 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-2xl font-bold text-white shrink-0">
                    {(viewItem.name || '?')[0].toUpperCase()}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-[var(--color-text)]">{viewItem.name}</h2>
                    <p className="text-xs text-[var(--color-text-muted)]">{viewItem.email}</p>
                  </div>
                </div>
                <button onClick={() => {
                  lastClosedParamRef.current = openParam;
                  setViewItem(null);
                  const next = new URLSearchParams(searchParams);
                  next.delete('open');
                  setSearchParams(next, { replace: true });
                }} className="rounded-xl p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Tabs */}
              <div className="shrink-0 flex gap-1 border-b border-[var(--color-border-subtle)] py-3">
                {tabs.map(tab => (
                  <button key={tab.key} onClick={() => setDetailTab(tab.key)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                      detailTab === tab.key
                        ? 'text-[var(--color-primary-text)] shadow-[inset_0_-2px_0_var(--color-primary)]'
                        : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]'
                    }`}>
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto pt-4">
                {detailTab === 'overview' && (
                  <div className="space-y-5">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Email</p>
                        <p className="mt-1 text-sm font-medium text-[var(--color-text)] break-words">{viewItem.email || '—'}</p>
                      </div>
                      <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Phone</p>
                        <p className="mt-1 text-sm font-medium text-[var(--color-text)] break-words">{viewItem.phone || 'Not available'}</p>
                      </div>
                      <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Role</p>
                        <p className="mt-1 text-sm font-medium text-[var(--color-text)] break-words"><Badge variant="purple">{viewItem.role || '—'}</Badge></p>
                      </div>
                      <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Status</p>
                        <p className="mt-1 text-sm font-medium text-[var(--color-text)] break-words">{statusBadge(viewItem.status || 'Active')}</p>
                      </div>
                      <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Super Admin</p>
                        <p className="mt-1 text-sm font-medium text-[var(--color-text)] break-words">{viewItem.isSuperAdmin === true ? 'Yes' : 'No'}</p>
                      </div>
                    </div>
                    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Account Info</h3>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">User ID</p>
                          <p className="mt-1 text-sm font-medium text-[var(--color-text)] break-words">{viewItem.id}</p>
                        </div>
                        <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Created</p>
                          <p className="mt-1 text-sm font-medium text-[var(--color-text)] break-words">{fmtDate(viewItem.createdAt)}</p>
                        </div>
                        <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Last Login</p>
                          <p className="mt-1 text-sm font-medium text-[var(--color-text)] break-words">{viewItem.lastLoginAt ? fmtDate(viewItem.lastLoginAt) : 'Not available'}</p>
                        </div>
                      </div>
                    </section>
                    {canEditUsers && (
                      <button onClick={() => { setViewItem(null); openEdit(viewItem); }}
                        className="w-full flex items-center justify-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-sm font-semibold text-[var(--color-primary-text)] hover:bg-[var(--color-surface-hover)] transition-colors">
                        <Edit2 className="h-4 w-4" /> Edit User
                      </button>
                    )}
                  </div>
                )}

                {detailTab === 'roles' && (
                  <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Role & Permissions</h3>
                    <div className="mt-3 space-y-4">
                      <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Assigned Role</p>
                        <p className="mt-1 text-sm font-medium text-[var(--color-text)] break-words"><Badge variant="purple">{viewItem.role || '—'}</Badge></p>
                      </div>
                      {viewItem.department && (
                        <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Department</p>
                          <p className="mt-1 text-sm font-medium text-[var(--color-text)] break-words">{viewItem.department}</p>
                        </div>
                      )}
                      {viewItem.managerId && (
                        <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Reporting Manager</p>
                          <p className="mt-1 text-sm font-medium text-[var(--color-text)] break-words">
                            {(users as any[]).find(u => u.id === viewItem.managerId)?.name || viewItem.managerName || viewItem.managerId}
                          </p>
                        </div>
                      )}
                      {viewItem.warehouseId && (
                        <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Warehouse</p>
                          <p className="mt-1 text-sm font-medium text-[var(--color-text)] break-words">
                            {(warehouses as any[]).find(w => w.id === viewItem.warehouseId)?.name || viewItem.warehouseId}
                          </p>
                        </div>
                      )}
                      <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-8 text-center">
                        <Shield className="mx-auto h-8 w-8 text-[var(--color-text-disabled)]" />
                        <p className="mt-2 text-sm font-medium text-[var(--color-text)]">Permission details</p>
                        <p className="mt-1 text-xs text-[var(--color-text-muted)]">Full permission view available in the Roles module.</p>
                      </div>
                    </div>
                  </section>
                )}

                {detailTab === 'activity' && (
                  <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Activity Log</h3>
                    <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-8 text-center mt-3">
                      <Shield className="mx-auto h-8 w-8 text-[var(--color-text-disabled)]" />
                      <p className="mt-2 text-sm font-medium text-[var(--color-text)]">No activity recorded</p>
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">Activity logs will appear here.</p>
                    </div>
                  </section>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* ── Form Modal ──────────────────────────────────────────────────── */}
      <Modal open={showForm} onClose={closeForm} title={editId ? 'Edit User' : 'Add User'} size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <FormSection title="User Info">
            <FormRow>
              <Input label="Full Name" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              <Input label="Email" type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            </FormRow>
            {/* Tenant-assignment requirement: Super Admin must explicitly
                pick the target Group + Company before creating a user —
                Group Admin/Company Admin never see this, their new user
                always resolves to their own company automatically. */}
            {!editId && isPlatformActor && (
              <FormRow>
                <InputSelect label="Group" required value={form.groupId}
                  onChange={e => setForm({ ...form, groupId: e.target.value, companyId: '' })}
                  options={[
                    { label: 'Select a Group…', value: '' },
                    ...platformGroups.filter((g: any) => g.status !== 'Suspended').map((g: any) => ({ label: g.name || g.shortName || g.id, value: g.id })),
                  ]} />
                <InputSelect label="Company" required value={form.companyId}
                  onChange={e => setForm({ ...form, companyId: e.target.value })}
                  options={[
                    { label: form.groupId ? 'Select a Company…' : 'Select a Group first', value: '' },
                    ...platformCompanies.filter((c: any) => c.groupId === form.groupId).map((c: any) => ({ label: c.name || c.shortName || c.id, value: c.id })),
                  ]} />
              </FormRow>
            )}
            <FormRow>
              <Input label="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
              {canEditRoles ? (
                <InputSelect label="Role" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}
                  options={[
                    { label: DEFAULT_USER_ROLE, value: DEFAULT_USER_ROLE },
                    // Phase 5 (§7.5): a Group Admin actor cannot assign the
                    // GroupAdmin role (rules-enforced) — hide the option as a
                    // matching convenience, not the security boundary.
                    ...(roles as any[])
                      .filter((r: any) => r.name !== DEFAULT_USER_ROLE && !(currentUser?.role === 'GroupAdmin' && String(r.name || '').trim() === 'GroupAdmin'))
                      .map((r: any) => ({ label: r.name, value: r.name })),
                  ]} />
              ) : (
                <div>
                  <p className="text-xs font-semibold uppercase text-[var(--color-text-muted)] mb-1">Role</p>
                  <Badge variant="purple">{form.role || '—'}</Badge>
                </div>
              )}
            </FormRow>
            <FormRow>
              <InputSelect label="Reporting Manager" value={form.managerId} onChange={e => setForm({ ...form, managerId: e.target.value })}
                options={managerOptions} />
              <InputSelect label="Status" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}
                options={[
                  { label: 'Active', value: 'Active' },
                  { label: 'Inactive', value: 'Inactive' },
                  { label: 'Suspended', value: 'Suspended' },
                ]} />
            </FormRow>
            <FormRow>
              <InputSelect label="Warehouse" value={form.warehouseId} onChange={e => setForm({ ...form, warehouseId: e.target.value })}
                options={warehouseOptions} />
            </FormRow>
            {canManageSuperAdmin && (
              <label className="flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3 text-sm cursor-pointer">
                <input type="checkbox" checked={form.isSuperAdmin} onChange={e => setForm({ ...form, isSuperAdmin: e.target.checked })}
                  className="mt-0.5 rounded border-[var(--color-border)] text-indigo-600 cursor-pointer" />
                <span>
                  <span className="block font-semibold text-[var(--color-text)]">Super Admin</span>
                  <span className="block text-xs text-[var(--color-text-muted)]">Grant unrestricted ERP access through the user document.</span>
                </span>
              </label>
            )}
            {!editId && (
              <Input label="Temporary Password" type="password" required value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Set initial password" />
            )}
          </FormSection>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" type="button" onClick={closeForm}>Cancel</Button>
            <Button type="submit" loading={save.isPending}>{editId ? 'Update' : 'Add User'}</Button>
          </div>
        </form>
      </Modal>

      {/* ── Delete Confirm ──────────────────────────────────────────────── */}
      <ConfirmDialog open={!!delId} onClose={() => setDelId(null)}
        onConfirm={() => delId && del.mutate(delId)}
        loading={del.isPending} title="Delete User"
        message="Delete this user? They will lose access." />

      <ConfirmDialog open={bulkDeleteOpen} onClose={() => setBulkDeleteOpen(false)}
        onConfirm={async () => {
          const ids = Array.from(selected);
          await Promise.all(ids.map(id => del.mutateAsync(id)));
          setSelected(new Set()); setBulkDeleteOpen(false);
          toast.success(`Deleted ${ids.length} user${ids.length > 1 ? 's' : ''}`);
        }}
        loading={del.isPending} title="Delete Users"
        message={`Delete ${selected.size} selected user${selected.size > 1 ? 's' : ''}?`} />
    </div>
  );
}
