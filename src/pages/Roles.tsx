/**
 * Roles — Role Management workspace (Desktop Gold Standard)
 *
 * Preserves all existing business logic: RBAC permission matrix,
 * role cloning, system role protection, permission toggles, bulk delete.
 * Visually identical to Leads. Only business data changes.
 */

import { useState, useMemo, useCallback, useEffect, useDeferredValue, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { getAll, createDocWithId, updateDocById, deleteDocById, genId, fmtDate } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';
import { ALL_MODULES, type Permission, usePermissions } from '../lib/permissions';
import { getSystemRoleSeedDocuments } from '../lib/roleBootstrap';
import { Shield, Plus, RefreshCw, Eye, Edit2, Trash2, Copy, X, Users as UsersIcon, CheckCircle2, Clock, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  Button, Card, CardHeader, ConfirmDialog, EmptyState, Pagination,
  PremiumKpi, Select, SkeletonRows, Table, Tbody, Td, Th, Thead, Tr,
  UniversalCheckbox, WorkspaceHero,
} from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';

const PER_PAGE = 15;
const INITIAL_PERMS = ALL_MODULES.reduce((acc, mod) => {
  acc[mod] = { view: false, create: false, edit: false, delete: false, cancel: false, export: false, import: false, approve: false, view_pricing: false, visibility: 'self' };
  return acc;
}, {} as any);

const FORM0 = { name: '', description: '', department: '', isManager: false, permissions: INITIAL_PERMS };

const DATE_OPTIONS = [
  { label: 'All dates', value: '' },
  { label: 'Today', value: 'today' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'Custom', value: 'custom' },
];

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const p = new Date(value);
  return isNaN(p.getTime()) ? null : p;
}

export default function Roles() {
  const qc = useQueryClient();
  const perms = usePermissions();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const [searchParams, setSearchParams] = useSearchParams();
  const systemRoleNames = useMemo(() => new Set(getSystemRoleSeedDocuments().map((role) => role.name)), []);
  // Phase 5 (§7.7): roles are managed per Company (F-03 per-company role
  // keying — roles docs carry companyId, never groupId). In "All Companies
  // (Group view)" mode the group-scoped query would be unprovable at the
  // rules layer, so the screen shows a banner instead of querying.
  const isGroupViewMode = activeCompanyId === 'group';

  // Filters
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const deferredSearch = useDeferredValue(search);
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
  const [form, setForm] = useState({ ...FORM0, permissions: JSON.parse(JSON.stringify(INITIAL_PERMS)) });
  const [delId, setDelId] = useState<string | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<'overview' | 'permissions' | 'users'>('overview');

  const openParam = searchParams.get('open') || '';
  const createParam = searchParams.get('create') || '';

  // Queries
  const { data: roles = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['roles'],
    queryFn: () => getAll(COLLECTIONS.ROLES),
    staleTime: 30000,
    enabled: !isGroupViewMode,
  });

  const save = useMutation({
    mutationFn: async (d: any) => {
      if (editId) await updateDocById(COLLECTIONS.ROLES, editId, d);
      else { const id = genId.generic('ROL'); await createDocWithId(COLLECTIONS.ROLES, id, { ...d, id }); }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['roles'] }); toast.success(editId ? 'Role updated' : 'Role created'); closeForm(); },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteDocById(COLLECTIONS.ROLES, id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['roles'] }); toast.success('Deleted'); setDelId(null); },
    onError: (e: any) => toast.error(e.message),
  });

  function closeForm() { setShowForm(false); setEditId(null); setForm({ ...FORM0, permissions: JSON.parse(JSON.stringify(INITIAL_PERMS)) }); }

  function openEdit(r: any) {
    const mergedPerms = JSON.parse(JSON.stringify(INITIAL_PERMS));
    Object.keys(r.permissions || {}).forEach(mod => {
      mergedPerms[mod] = { ...mergedPerms[mod], ...r.permissions[mod] };
    });
    setForm({ name: r.name, description: r.description || '', department: r.department || '', isManager: r.isManager === true, permissions: mergedPerms });
    setEditId(r.id);
    setShowForm(true);
  }

  function handleClone(r: any) {
    const mergedPerms = JSON.parse(JSON.stringify(INITIAL_PERMS));
    Object.keys(r.permissions || {}).forEach(mod => {
      mergedPerms[mod] = { ...mergedPerms[mod], ...r.permissions[mod] };
    });
    setForm({ name: `${r.name} (Copy)`, description: r.description || '', department: r.department || '', isManager: r.isManager === true, permissions: mergedPerms });
    setEditId(null);
    setShowForm(true);
  }

  // Immutable at every level (permissions, then the module's own permission
  // object) — the previous version shallow-copied `prev` (`{...prev}`) but
  // then mutated `next.permissions[mod][action]` in place, which is the SAME
  // object reference as `prev.permissions[mod]` (a shallow spread does not
  // clone nested objects). React 19 StrictMode intentionally invokes state
  // updater functions twice to detect exactly this kind of impurity — the
  // in-place mutation meant the second invocation toggled the
  // already-toggled value back, silently cancelling every permission-matrix
  // click and saving the role with the checkbox's ORIGINAL (pre-click) value
  // (RBAC role-permission-persistence root cause, found via live browser
  // verification: a role created with leads.view/leads.create checked was
  // saved to Firestore with both false).
  function handlePermToggle(mod: string, action: Permission) {
    setForm(prev => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [mod]: {
          ...prev.permissions[mod],
          [action]: !prev.permissions[mod][action],
        },
      },
    }));
  }

  function handleVisibilityChange(mod: string, vis: string) {
    setForm(prev => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [mod]: {
          ...prev.permissions[mod],
          visibility: vis,
        },
      },
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name) return toast.error('Name required');
    const normalizedName = form.name.trim().toLowerCase();
    const duplicateRole = (roles as any[]).find((role: any) => String(role.name || '').trim().toLowerCase() === normalizedName && role.id !== editId);
    if (duplicateRole) return toast.error('Role name already exists');
    save.mutate(form);
  }

  // URL sync
  function syncQueueParams(nextState: Record<string, string | number | undefined>) {
    const next = new URLSearchParams(searchParams);
    const keys = ['q', 'date', 'from', 'to', 'kpi', 'page', 'perPage'];
    keys.forEach((key) => {
      const val = nextState[key] ?? searchParams.get(key);
      if (val && val !== '' && val !== 1 && val !== 15) next.set(key, String(val));
      else next.delete(key);
    });
    setSearchParams(next, { replace: true });
  }

  function clearAll() {
    setSearch(''); setDateRange(''); setCustomFrom(''); setCustomTo('');
    setActiveKpi(''); setPage(1); setSelected(new Set());
    syncQueueParams({ q: '', date: '', from: '', to: '', kpi: '', page: 1 });
  }

  // Detail auto-open from URL
  useEffect(() => {
    if (createParam === '1') {
      setForm({ ...FORM0, permissions: JSON.parse(JSON.stringify(INITIAL_PERMS)) });
      setEditId(null);
      setShowForm(true);
    }
  }, [createParam]);

  const lastClosedParamRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastClosedParamRef.current === openParam) { lastClosedParamRef.current = null; return; }
    if (!openParam) return;
    const found = (roles as any[]).find(r => r.id === openParam);
    if (found) { setDetailTab('overview'); setViewItem(found); }
  }, [openParam, roles]);

  // Selection
  const toggleSelect = useCallback((id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);

  function isRowOpenIgnored(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false;
    return Boolean(target.closest('button,a,input,select,textarea,[data-action],[data-interactive]'));
  }

  // Stats
  const stats = useMemo(() => {
    const all = roles as any[];
    return {
      total: all.length,
      system: all.filter((r: any) => systemRoleNames.has(r.name)).length,
      custom: all.filter((r: any) => !systemRoleNames.has(r.name)).length,
      withPerms: all.filter((r: any) => r.permissions && Object.keys(r.permissions).length > 0).length,
      recentlyUpdated: all.filter((r: any) => {
        const d = toDate(r.updatedAt || r.createdAt);
        if (!d) return false;
        const now = new Date(); now.setHours(0, 0, 0, 0);
        return (now.getTime() - d.getTime()) <= 30 * 86400000;
      }).length,
    };
  }, [roles, systemRoleNames]);

  const isTotalDefault = !activeKpi && !search && !dateRange;

  // Filtering
  const filtered = useMemo(() => {
    let list = [...(roles as any[])];
    const q = deferredSearch.toLowerCase().trim();
    if (q) list = list.filter((r: any) => [r.name, r.description].some((v: any) => String(v || '').toLowerCase().includes(q)));
    if (activeKpi === 'system') list = list.filter(r => systemRoleNames.has(r.name));
    else if (activeKpi === 'custom') list = list.filter(r => !systemRoleNames.has(r.name));
    else if (activeKpi === 'withPerms') list = list.filter((r: any) => r.permissions && Object.keys(r.permissions).length > 0);
    else if (activeKpi === 'recentlyUpdated') {
      list = list.filter((r: any) => {
        const d = toDate(r.updatedAt || r.createdAt);
        if (!d) return false;
        const now = new Date(); now.setHours(0, 0, 0, 0);
        return (now.getTime() - d.getTime()) <= 30 * 86400000;
      });
    }
    if (dateRange) {
      list = list.filter((r: any) => {
        const d = toDate(r.updatedAt || r.createdAt);
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
    list.sort((a: any, b: any) => {
      const va = String(a[sortKey] || ''), vb = String(b[sortKey] || '');
      return sortDesc ? vb.localeCompare(va) : va.localeCompare(vb);
    });
    return list;
  }, [roles, deferredSearch, activeKpi, sortKey, sortDesc, systemRoleNames, dateRange, customFrom, customTo]);

  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  const toggleAll = () => setSelected(s => s.size === paginated.length ? new Set() : new Set(paginated.map((r: any) => r.id)));
  const allSel = selected.size === paginated.length && paginated.length > 0;

  useEffect(() => { const maxPage = Math.max(1, Math.ceil(filtered.length / perPage)); if (page > maxPage) setPage(maxPage); }, [filtered.length, perPage, page]);

  const hasActiveFilters = Boolean(search || dateRange || activeKpi);
  const activeFilterCount = (activeKpi ? 1 : 0) + (search ? 1 : 0) + (dateRange ? 1 : 0);

  function handleSort(k: string) { if (sortKey === k) setSortDesc(d => !d); else { setSortKey(k); setSortDesc(true); } }

  const KPI_CONFIGS = [
    { key: '', label: 'TOTAL ROLES', value: stats.total, icon: <Shield className="h-4 w-4" />, description: 'All role definitions' },
    { key: 'system', label: 'SYSTEM', value: stats.system, icon: <CheckCircle2 className="h-4 w-4" />, description: 'Predefined system roles' },
    { key: 'custom', label: 'CUSTOM', value: stats.custom, icon: <FileText className="h-4 w-4" />, description: 'User-created roles' },
    { key: 'withPerms', label: 'WITH PERMISSIONS', value: stats.withPerms, icon: <Shield className="h-4 w-4" />, description: 'Roles with permissions configured' },
    { key: 'recentlyUpdated', label: 'RECENTLY UPDATED', value: stats.recentlyUpdated, icon: <Clock className="h-4 w-4" />, description: 'Updated in last 30 days' },
    { key: '', label: 'USERS ASSIGNED', value: '—', icon: <UsersIcon className="h-4 w-4" />, description: 'Users with this role' },
  ];

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      <WorkspaceHero
        title="Roles & Permissions"
        icon={<Shield className="h-6 w-6" />}
        breadcrumbs={['Home', 'Settings', 'Roles']}
        statusText={`${stats.total} roles`}
        statusDotColor="var(--color-success)"
        className="gap-3"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => refetch()}>
              Refresh
            </Button>
            <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => { setForm({ ...FORM0, permissions: JSON.parse(JSON.stringify(INITIAL_PERMS)) }); setEditId(null); setShowForm(true); }}>
              Create Role
            </Button>
          </div>
        }
      />

      {/* Phase 5 (§7.7): group-view banner — roles are per-Company */}
      {isGroupViewMode && (
        <div className="flex items-start gap-3 rounded-xl border border-[var(--color-primary-muted)] bg-[var(--color-primary-light)] px-4 py-3">
          <Shield className="h-4 w-4 mt-0.5 text-[var(--color-primary-text)] shrink-0" />
          <p className="text-sm text-[var(--color-text-secondary)]">
            Roles are managed per Company. Select a Company above to view or edit its roles.
          </p>
        </div>
      )}

      {/* KPI Grid */}
      <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-6">
        {KPI_CONFIGS.map((k, i) => (
          <PremiumKpi key={String(i)} label={k.label} value={k.value} icon={k.icon} description={k.description}
            active={k.key === '' && k.value !== '—' ? (activeKpi === '' || isTotalDefault) : k.key ? activeKpi === k.key : false}
            onClick={k.value === '—' ? undefined : () => { const next = activeKpi === k.key ? '' : k.key; setActiveKpi(next); setPage(1); syncQueueParams({ kpi: next, page: 1 }); }} />
        ))}
      </div>

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden shadow-[var(--shadow-enterprise-surface)]">
        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="px-6 py-2.5 flex items-center gap-3 bg-[var(--color-primary-light)] border-b border-[var(--color-primary-muted)] dark:bg-[var(--color-primary-light)] dark:border-[var(--color-primary-muted)]">
            <span className="text-sm font-semibold text-[var(--color-primary-text)]">{selected.size} selected</span>
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <button onClick={() => setBulkDeleteOpen(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-[10px] font-semibold hover:bg-[var(--color-surface-hover)] transition-colors text-red-600 dark:text-red-400">
                <Trash2 className="h-3 w-3" /> Delete
              </button>
              <button onClick={() => setSelected(new Set())} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">✕ Clear</button>
            </div>
          </div>
        )}

        {/* Filters */}
        <CardHeader className="px-6 pt-2 pb-2 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
            <input aria-label="Search" placeholder="Search role name, description..."
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

            <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]"><span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" /></div>
          </div>

          {activeFilterCount > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {activeKpi && (<span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary-light)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-primary-text)]">{KPI_CONFIGS.find(k => k.key === activeKpi)?.label || activeKpi}<button onClick={() => { setActiveKpi(''); setPage(1); syncQueueParams({ kpi: '', page: 1 }); }} className="ml-0.5 hover:opacity-70">✕</button></span>)}
              {search && (<span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)]">S: {search.length > 20 ? search.slice(0, 20) + '…' : search}<button onClick={() => { setSearch(''); setPage(1); }} className="ml-0.5 hover:opacity-70">✕</button></span>)}
              {dateRange && (<span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)]">{DATE_OPTIONS.find(d => d.value === dateRange)?.label || dateRange}<button onClick={() => { setDateRange(''); setCustomFrom(''); setCustomTo(''); setPage(1); syncQueueParams({ date: '', page: 1 }); }} className="ml-0.5 hover:opacity-70">✕</button></span>)}
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
                <Th sortable sorted={sortKey === 'name'} desc={sortDesc} onSort={() => handleSort('name')} style={{ minWidth: 140 }}>ROLE NAME</Th>
                <Th sortable sorted={sortKey === 'description'} desc={sortDesc} onSort={() => handleSort('description')} style={{ minWidth: 200 }}>DESCRIPTION</Th>
                <Th style={{ width: 80 }}>USERS</Th>
                <Th style={{ width: 200 }}>ACTIONS</Th>
              </Thead>
              <Tbody>
                {isError ? (
                  <tr><td colSpan={5} className="py-14 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Shield className="h-10 w-10 text-[var(--color-text-disabled)]" />
                      <p className="text-sm text-[var(--color-text-muted)]">Failed to load roles.</p>
                      <button onClick={() => refetch()} className="text-xs font-semibold text-[var(--color-primary)] hover:underline">Retry</button>
                    </div>
                  </td></tr>
                ) : isLoading ? (<SkeletonRows cols={5} rows={6} />) : paginated.length === 0 ? (
                  <tr><td colSpan={5}>
                    <EmptyState icon={<Shield className="h-9 w-9" />}
                      title={hasActiveFilters ? 'No roles match filters' : 'No roles yet'}
                      description={hasActiveFilters ? 'Try adjusting your search or filters.' : 'Create your first role to get started.'}
                      action={!hasActiveFilters ? <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => { setForm({ ...FORM0, permissions: JSON.parse(JSON.stringify(INITIAL_PERMS)) }); setShowForm(true); }}>Create Your First Role</Button> : undefined} />
                  </td></tr>
                ) : (
                  paginated.map((r: any) => (
                    <Tr key={r.id}
                      onClick={(e) => { if (!isRowOpenIgnored(e.target as HTMLElement)) { setDetailTab('overview'); setViewItem(r); } }}
                      className="group cursor-pointer transition-all duration-200 ease-out hover:bg-[var(--color-table-row-hover)] focus-visible:bg-[var(--color-table-row-hover)] focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-inset">
                      <Td><span data-interactive onClick={(e) => e.stopPropagation()}><UniversalCheckbox checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} /></span></Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-full bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center text-purple-700 dark:text-purple-400 text-xs font-bold shrink-0">
                            {(r.name || '?')[0].toUpperCase()}
                          </div>
                          <p className="font-semibold text-[var(--color-text)] text-sm">{r.name || '—'}</p>
                        </div>
                      </Td>
                      <Td className="text-xs text-[var(--color-text-muted)] max-w-[200px] truncate">{r.description || '—'}</Td>
                      <Td className="text-xs text-[var(--color-text-muted)]">—</Td>
                      <Td>
                        <div data-action onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} className="flex items-center justify-end gap-1">
                          <button type="button" onClick={(e) => { e.stopPropagation(); setDetailTab('overview'); setViewItem(r); }}
                            className="inline-flex h-7 items-center gap-1 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-text)] px-3 py-1 text-xs font-semibold text-[var(--color-text-inverse)] shadow-[var(--shadow-enterprise-control)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]">
                            <Eye className="h-3.5 w-3.5" /> View
                          </button>
                          <button type="button" onClick={(e) => { e.stopPropagation(); handleClone(r); }}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-primary-text)] hover:bg-[var(--color-primary-light)] transition-colors" title="Clone">
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(r); }}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-primary-text)] hover:bg-[var(--color-primary-light)] transition-colors" title="Edit">
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          {!systemRoleNames.has(r.name) && (
                            <button type="button" onClick={(e) => { e.stopPropagation(); setDelId(r.id); }}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors" title="Delete">
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

      {/* ── Form Modal ──────────────────────────────────────────────────── */}
      <Modal open={showForm} onClose={closeForm} title={editId ? 'Edit Role' : 'Create Role'} size="2xl">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="flex gap-4">
            <div className="flex-1">
              <Input label="Role Name" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} disabled={systemRoleNames.has(form.name)} />
            </div>
            <div className="flex-[2]">
              <Input label="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1">
              <Input label="Department / Section" value={form.department}
                onChange={e => setForm({ ...form, department: e.target.value })}
                placeholder="e.g. Sales, Warehouse, Accounts, Channel Partner" />
              <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                Data-driven section — a user's department is the department of their role. New sections are created here without code changes.
              </p>
            </div>
            <label className="flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3 text-sm cursor-pointer">
              <input type="checkbox" checked={form.isManager} onChange={e => setForm({ ...form, isManager: e.target.checked })}
                className="mt-0.5 rounded border-[var(--color-border)] text-indigo-600 cursor-pointer" />
              <span>
                <span className="block font-semibold text-[var(--color-text)]">Manager role</span>
                <span className="block text-xs text-[var(--color-text-muted)]">Holds managerial responsibility within this role's department/section only.</span>
              </span>
            </label>
          </div>

          <div>
            <p className="text-sm font-bold text-[var(--color-text)] uppercase tracking-widest border-b border-[var(--color-border)] pb-2 mb-3">Permission Matrix</p>
            <div className="border border-[var(--color-border)] rounded-xl overflow-hidden bg-[var(--color-surface)] shadow-sm overflow-x-auto">
              <table className="min-w-full text-xs text-left divide-y divide-[var(--color-border)]">
                <thead className="bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)] font-semibold">
                  <tr>
                    <th className="px-4 py-3">Module</th>
                    <th className="px-4 py-3 text-center">Data Visibility</th>
                    <th className="px-2 py-3 text-center">View</th>
                    <th className="px-2 py-3 text-center">Create</th>
                    <th className="px-2 py-3 text-center">Edit</th>
                    <th className="px-2 py-3 text-center">Delete</th>
                    <th className="px-2 py-3 text-center">Cancel</th>
                    <th className="px-2 py-3 text-center">Export</th>
                    <th className="px-2 py-3 text-center">Approve</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-subtle)]">
                  {ALL_MODULES.map(mod => (
                    <tr key={mod} className="hover:bg-[var(--color-bg-sunken)]">
                      <td className="px-4 py-2 font-medium capitalize text-[var(--color-text)]">{mod.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-2 text-center">
                        <select
                          value={form.permissions[mod]?.visibility || 'self'}
                          onChange={e => handleVisibilityChange(mod, e.target.value)}
                          className="border border-[var(--color-border)] rounded px-2 py-1 text-xs bg-[var(--color-surface)] text-[var(--color-text)] outline-none focus:border-[var(--color-focus-ring)]"
                        >
                          <option value="self">Self (Own Data)</option>
                          <option value="team">Team (Self + Hierarchy)</option>
                          <option value="all">Global (All Data)</option>
                        </select>
                      </td>
                      {(['view', 'create', 'edit', 'delete', 'cancel', 'export', 'approve'] as Permission[]).map(action => (
                        <td key={action} className="px-2 py-2 text-center">
                          <label className="inline-flex items-center cursor-pointer">
                            <input type="checkbox" className="sr-only peer" checked={!!form.permissions[mod]?.[action]} onChange={() => handlePermToggle(mod, action)} />
                            <div className="relative w-7 h-4 bg-gray-200 dark:bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-[var(--color-surface)] after:border-[var(--color-border)] after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[var(--color-primary)]"></div>
                          </label>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-[var(--color-border-subtle)]">
            <Button variant="outline" type="button" onClick={closeForm}>Cancel</Button>
            <Button type="submit" loading={save.isPending}>{editId ? 'Save Changes' : 'Create Role'}</Button>
          </div>
        </form>
      </Modal>

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
            { key: 'permissions' as const, label: 'Permissions' },
            { key: 'users' as const, label: 'Users Assigned' },
          ];
          return (
            <div className="flex h-[70vh] max-h-[700px] min-h-0 flex-col">
              <div className="shrink-0 flex items-start justify-between border-b border-[var(--color-border-subtle)] pb-4">
                <div className="flex items-center gap-3">
                  <div className="h-14 w-14 rounded-full bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center text-2xl font-bold text-purple-700 dark:text-purple-400">
                    {(viewItem.name || '?')[0].toUpperCase()}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-[var(--color-text)]">{viewItem.name}</h2>
                    <p className="text-xs text-[var(--color-text-muted)]">Role</p>
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

              <div className="shrink-0 flex gap-1 border-b border-[var(--color-border-subtle)] py-3">
                {tabs.map(tab => (
                  <button key={tab.key} onClick={() => setDetailTab(tab.key)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${detailTab === tab.key ? 'text-[var(--color-primary-text)] shadow-[inset_0_-2px_0_var(--color-primary)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]'}`}>
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto pt-4">
                {detailTab === 'overview' && (
                  <div className="space-y-5">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Role Name</p>
                        <p className="mt-1 text-sm font-medium text-[var(--color-text)] break-words">{viewItem.name}</p>
                      </div>
                      <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Description</p>
                        <p className="mt-1 text-sm font-medium text-[var(--color-text)] break-words">{viewItem.description || 'No description'}</p>
                      </div>
                      <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Type</p>
                        <p className="mt-1 text-sm font-medium text-[var(--color-text)] break-words">
                          {systemRoleNames.has(viewItem.name)
                            ? <span className="text-xs font-semibold text-purple-600 dark:text-purple-400">System Role</span>
                            : <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Custom Role</span>}
                        </p>
                      </div>
                      <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Department / Section</p>
                        <p className="mt-1 text-sm font-medium text-[var(--color-text)] break-words">{viewItem.department || '—'}</p>
                      </div>
                      <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Manager Capability</p>
                        <p className="mt-1 text-sm font-medium text-[var(--color-text)] break-words">
                          {viewItem.isManager === true
                            ? <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Section Manager</span>
                            : '—'}
                        </p>
                      </div>
                    </div>
                    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Metadata</h3>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Role ID</p>
                          <p className="mt-1 text-sm font-medium text-[var(--color-text)] break-words">{viewItem.id || '—'}</p>
                        </div>
                        <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Created</p>
                          <p className="mt-1 text-sm font-medium text-[var(--color-text)] break-words">{fmtDate(viewItem.createdAt)}</p>
                        </div>
                      </div>
                    </section>
                  </div>
                )}

                {detailTab === 'permissions' && (
                  <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Permissions by Module</h3>
                    <div className="mt-3 space-y-2">
                      {viewItem.permissions ? (
                        Object.keys(viewItem.permissions).filter(mod => mod !== 'roles').map(mod => {
                          const perm = viewItem.permissions[mod];
                          if (!perm || !Object.values(perm).some((v: any) => v === true)) return null;
                          return (
                            <div key={mod} className="flex flex-wrap items-center gap-2 py-1.5 border-b border-[var(--color-border-subtle)] last:border-0">
                              <span className="text-xs font-bold capitalize text-[var(--color-text)] w-28 shrink-0">{mod.replace(/_/g, ' ')}</span>
                              <div className="flex flex-wrap gap-1.5">
                                {(['view', 'create', 'edit', 'delete', 'cancel', 'export', 'approve'] as Permission[]).filter(a => perm[a]).map(a => (
                                  <span key={a} className="px-2 py-0.5 rounded-full bg-[var(--color-primary-light)] text-[10px] font-semibold text-[var(--color-primary-text)] capitalize">{a}</span>
                                ))}
                                <span className="px-2 py-0.5 rounded-full bg-[var(--color-bg-sunken)] text-[10px] text-[var(--color-text-muted)] capitalize">
                                  {perm.visibility === 'all' ? 'Global' : perm.visibility === 'team' ? 'Team' : 'Self'}
                                </span>
                              </div>
                            </div>
                          );
                        }).filter(Boolean)
                      ) : (
                        <p className="text-sm text-[var(--color-text-muted)]">No permissions configured.</p>
                      )}
                    </div>
                  </section>
                )}

                {detailTab === 'users' && (
                  <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Users with this Role</h3>
                    <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-8 text-center mt-3">
                      <Shield className="mx-auto h-8 w-8 text-[var(--color-text-disabled)]" />
                      <p className="mt-2 text-sm font-medium text-[var(--color-text)]">User assignment tracking</p>
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">View assigned users in the Users module.</p>
                    </div>
                  </section>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* ── Delete Confirm ──────────────────────────────────────────────── */}
      <ConfirmDialog open={!!delId} onClose={() => setDelId(null)}
        onConfirm={() => delId && del.mutate(delId)}
        loading={del.isPending} title="Delete Role"
        message="Delete this role? Users assigned to this role will lose permissions." />

      <ConfirmDialog open={bulkDeleteOpen} onClose={() => setBulkDeleteOpen(false)}
        onConfirm={async () => {
          const ids = Array.from(selected);
          const protectedRoles = (roles as any[]).filter(r => selected.has(r.id) && systemRoleNames.has(r.name));
          if (protectedRoles.length > 0) {
            toast.error('Cannot delete system roles');
            setBulkDeleteOpen(false);
            return;
          }
          await Promise.all(ids.map(id => del.mutateAsync(id)));
          setSelected(new Set());
          setBulkDeleteOpen(false);
          toast.success(`Deleted ${ids.length} role${ids.length > 1 ? 's' : ''}`);
        }}
        loading={del.isPending} title="Delete Roles"
        message={`Delete ${selected.size} selected role${selected.size > 1 ? 's' : ''}?`} />
    </div>
  );
}
