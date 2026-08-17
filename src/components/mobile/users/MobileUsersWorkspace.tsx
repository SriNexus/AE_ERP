/**
 * MobileUsersWorkspace — Mobile Users module
 *
 * Architecture matches MobileLeadWorkspace:
 *   - No inline KPI/Search/Filters (handled by MobileTopBar at module level)
 *   - Filters read from URL params
 *   - Card-based list matching LeadCard pattern
 *   - Full-screen detail modal with Section/Detail components
 *   - Shared ConfirmDialog for deletes
 *   - Dirty state tracking + confirm close on forms
 *   - mode prop for 'records' | 'create'
 *
 * Reuses all user management business logic:
 *   - useQuery for users + roles (same as desktop)
 *   - createUserProjection, updateUserProjection, deleteUserProjection
 *   - Firebase Auth for user creation (via secondary app, same pattern as desktop)
 *   - usePermissions for access control
 *   - Shared ui components (Badge, Button, Card, ConfirmDialog, Input, Modal,
 *     Pagination, Select, Textarea, statusBadge) from ../../ui
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Download, Edit2, Shield, Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge, Button, Card, ConfirmDialog, Input, Modal, Pagination, Select, statusBadge } from '../../ui';
import { getAll, fmtDate } from '../../../lib/firestore';
import { COLLECTIONS, firebaseConfig } from '../../../lib/firebase';
import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import {
  createUserProjection,
  updateUserProjection,
  deleteUserProjection,
} from '../../../features/users/hooks/useUsers';
import { isEligibleManagerOption } from '../../../features/users/orgHierarchy';
import { usePermissions } from '../../../lib/permissions';
import { useCurrentUser } from '../../../store/useAppStore';
import { cn } from '../../../utils/cn';

const PER_PAGE = 15;
const DEFAULT_USER_ROLE = 'Sales Executive';
const FORM0 = {
  name: '', email: '', phone: '', role: DEFAULT_USER_ROLE,
  managerId: '', status: 'Active', warehouseId: '', password: '', isSuperAdmin: false,
};
type UserForm = typeof FORM0;
type Mode = 'records' | 'create';

function downloadUsersCsv(rows: any[], filename: string) {
  const headers = ['Name', 'Email', 'Phone', 'Role', 'Status', 'Added'];
  const lines = rows.map((u) =>
    [u.name || '', u.email || '', u.phone || '', u.role || '', u.status || '', u.createdAt || '']
      .map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','),
  );
  const csv = [headers.join(','), ...lines].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function MobileUsersWorkspace({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const currentUser = useCurrentUser();
  const perms = usePermissions();

  const { data: users = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['users'], queryFn: () => getAll(COLLECTIONS.USERS), staleTime: 30000,
  });
  const { data: roles = [] } = useQuery({
    queryKey: ['roles'], queryFn: () => getAll(COLLECTIONS.ROLES), staleTime: 300000,
  });

  const canCreate = perms.can('users', 'create');
  const canEdit = perms.can('users', 'edit');
  const canDelete = perms.can('users', 'delete');
  const canEditRoles = perms.can('roles', 'edit');
  const canManageSuperAdmin = currentUser.isSuperAdmin === true;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<UserForm>({ ...FORM0 });
  const [viewUser, setViewUser] = useState<any>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const createParam = params.get('create');

  useEffect(() => {
    if (mode === 'create') setFormOpen(true);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'records' || createParam !== '1') return;
    setEditId(null);
    setForm({ ...FORM0 });
    setDirty(false);
    setFormOpen(true);
  }, [mode, createParam]);

  const saveMut = useMutation({
    mutationFn: async (d: UserForm) => {
      if (editId) {
        const { password, ...rest } = d;
        await updateUserProjection(editId, rest);
      } else {
        const secondaryApp = initializeApp(firebaseConfig, 'SecondaryApp' + Date.now());
        const secondaryAuth = getAuth(secondaryApp);
        let authId: string;
        try {
          const authResult = await createUserWithEmailAndPassword(secondaryAuth, d.email, d.password);
          authId = authResult.user.uid;
        } finally {
          await secondaryAuth.signOut();
        }
        const { password, ...rest } = d;
        await createUserProjection(authId, { ...rest, id: authId, createdBy: currentUser.id });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success(editId ? 'Updated' : 'User added');
      closeForm();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => deleteUserProjection(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Deleted');
    },
    onError: (e: any) => toast.error(e.message),
  });

  function closeForm() { setFormOpen(false); setEditId(null); setForm({ ...FORM0 }); setDirty(false); }

  function openEdit(u: any) {
    setForm({
      name: u.name || '', email: u.email || '', phone: u.phone || '',
      role: u.role || '', managerId: u.managerId || '',
      status: u.status || 'Active', warehouseId: u.warehouseId || '', password: '',
      isSuperAdmin: u.isSuperAdmin === true,
    });
    setDirty(false);
    setEditId(u.id);
    setFormOpen(true);
  }

  function requestCloseForm() {
    if (dirty) { setConfirmClose(true); return; }
    closeForm();
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name || !form.email) return toast.error('Name & email required');
    if (!editId && !form.password) return toast.error('Temporary password required');
    saveMut.mutate(form);
  }

  function updateForm(patch: Partial<UserForm>) {
    setForm((current) => ({ ...current, ...patch }));
    setDirty(true);
  }

  const stats = useMemo(() => ({
    total: (users as any[]).length,
    active: (users as any[]).filter((u: any) => u.status === 'Active').length,
    admins: (users as any[]).filter((u: any) => u.role === 'Admin').length,
  }), [users]);

  const filtered = useMemo(() => {
    const q = params.get('q') || '';
    const roleFilter = params.get('role') || '';
    const statusFilter = params.get('status') || '';
    return (users as any[]).filter((u: any) => {
      if (roleFilter && roleFilter !== 'All' && u.role !== roleFilter) return false;
      if (statusFilter && statusFilter !== 'All' && u.status !== statusFilter) return false;
      if (!q) return true;
      const term = q.toLowerCase();
      return [u.name, u.email, u.phone, u.role].some((v: any) => String(v || '').toLowerCase().includes(term));
    });
  }, [users, params]);

  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const selectedRows = useMemo(() => (users as any[]).filter((u) => selected.has(u.id)), [users, selected]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filtered.length, page]);

  useEffect(() => {
    setSelected((current) => {
      const available = new Set((users as any[]).map((u) => u.id));
      const next = new Set(Array.from(current).filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [users]);

  function changePage(nextPage: number) {
    setPage(nextPage);
    const next = new URLSearchParams(params);
    if (nextPage > 1) next.set('page', String(nextPage));
    else next.delete('page');
    setParams(next, { replace: true });
  }

  function toggleSelect(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function deleteSelected() {
    await Promise.all(selectedRows.map((u) => delMut.mutateAsync(u.id)));
    setSelected(new Set());
    setDeleteOpen(false);
  }

  function exportRows(rows: any[]) {
    if (!rows.length) return toast.error('No users selected');
    downloadUsersCsv(rows, `users-export-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${rows.length} user${rows.length > 1 ? 's' : ''}`);
  }

  if (mode === 'create') {
    return (
      <UserDialogs
        formOpen={formOpen}
        form={form}
        editId={editId}
        saving={saveMut.isPending}
        dirty={dirty}
        confirmClose={confirmClose}
        roles={roles as any[]}
        users={users as any[]}
        canEditRoles={canEditRoles}
        canManageSuperAdmin={canManageSuperAdmin}
        onCloseForm={requestCloseForm}
        onDiscard={() => { setConfirmClose(false); closeForm(); }}
        onKeepEditing={() => setConfirmClose(false)}
        onChange={updateForm}
        onSubmit={handleSubmit}
      />
    );
  }

  return (
    <div className="space-y-4 pb-2 pt-2">
      <div className="px-1 pb-1 pt-2">
        <h1 className="text-xl font-bold text-[var(--color-text)]">Users & Access</h1>
      </div>

      {selected.size > 0 && (
        <Card className="rounded-xl p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-xs font-semibold text-[var(--color-primary-text)]">{selected.size} selected</span>
            <Button size="xs" variant="outline" icon={<Download className="h-3 w-3" />} onClick={() => exportRows(selectedRows)}>Export</Button>
            {canDelete && <Button size="xs" variant="danger" icon={<Trash2 className="h-3 w-3" />} onClick={() => setDeleteOpen(true)}>Delete</Button>}
            <button type="button" onClick={() => setSelected(new Set())} className="px-2 py-1 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">Clear</button>
          </div>
        </Card>
      )}

      {isError && (
        <div className="flex flex-col items-center justify-center min-h-[30vh] text-center px-6">
          <Shield className="h-10 w-10 text-rose-500 mb-3" />
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">Failed to load users</h3>
          <p className="text-xs text-[var(--color-text-muted)] max-w-[260px]">Could not load user data.</p>
          <button onClick={() => refetch()} className="mt-4 px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg text-xs font-semibold hover:opacity-90">Retry</button>
        </div>
      )}

      <div className="space-y-3">
        {isLoading && Array.from({ length: 5 }).map((_, index) => <UserSkeletonCard key={index} />)}
        {!isLoading && !isError && filtered.length === 0 && (
          <Card className="rounded-xl p-5 text-center text-sm text-[var(--color-text-muted)]">
            No users match the current filters.
          </Card>
        )}
        {!isLoading && !isError && paginated.map((u: any) => (
          <UserCard
            key={u.id}
            user={u}
            selected={selected.has(u.id)}
            onSelect={() => toggleSelect(u.id)}
            onView={() => setViewUser(u)}
            onEdit={canEdit ? () => { setViewUser(null); openEdit(u); } : undefined}
          />
        ))}
      </div>

      {!isLoading && !isError && filtered.length > 0 && (
        <Pagination page={page} total={filtered.length} perPage={PER_PAGE} onChange={changePage} />
      )}

      <UserViewModal
        user={viewUser}
        canEdit={canEdit}
        canDelete={canDelete}
        onClose={() => setViewUser(null)}
        onEdit={(u) => { setViewUser(null); openEdit(u); }}
        onDelete={(u) => { setSelected(new Set([u.id])); setViewUser(null); setDeleteOpen(true); }}
      />

      <UserDialogs
        formOpen={formOpen}
        form={form}
        editId={editId}
        saving={saveMut.isPending}
        dirty={dirty}
        confirmClose={confirmClose}
        roles={roles as any[]}
        users={users as any[]}
        canEditRoles={canEditRoles}
        canManageSuperAdmin={canManageSuperAdmin}
        onCloseForm={requestCloseForm}
        onDiscard={() => { setConfirmClose(false); closeForm(); }}
        onKeepEditing={() => setConfirmClose(false)}
        onChange={updateForm}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => void deleteSelected()}
        loading={delMut.isPending}
        title="Delete Users"
        message={`Delete ${selectedRows.length} selected user${selectedRows.length > 1 ? 's' : ''}?`}
      />
    </div>
  );
}

/* ── User Card ────────────────────────────────────────────── */

function UserCard({ user, selected, onSelect, onView, onEdit }: {
  user: any;
  selected: boolean;
  onSelect: () => void;
  onView: () => void;
  onEdit?: () => void;
}) {
  const isInactive = user.status === 'Inactive';
  return (
    <Card className={cn(
      'rounded-xl border border-[var(--color-border-subtle)] p-3 shadow-sm transition-shadow',
      'hover:shadow-[var(--shadow-enterprise-row)]',
      selected && 'border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/40',
      isInactive && 'opacity-75',
      user.status === 'Suspended' && 'border-l-4 border-l-red-500',
    )}>
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          className="mt-1 rounded border-[var(--color-border)] text-[var(--color-primary)]"
          aria-label={`Select ${user.name || 'user'}`}
        />
        <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
          <p className="truncate text-[15px] font-bold leading-5 text-[var(--color-text)]">{user.name || '—'}</p>
          <p className="mt-0.5 truncate text-xs font-medium text-[var(--color-text-muted)]">{user.email || '—'}</p>
          <div className="mt-2 space-y-0.5 text-xs leading-5 text-[var(--color-text-muted)]">
            <p className="truncate">{user.phone || 'Phone not available'}</p>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {statusBadge(user.status || 'Active')}
            <Badge variant="purple">{user.role || '—'}</Badge>
          </div>
        </button>
        <div className="flex shrink-0 flex-col items-center gap-1.5">
          {onEdit && (
            <button type="button" onClick={onEdit} aria-label="Edit user"
              className={actionIconBtnClass}>
              <Edit2 className="h-4 w-4" strokeWidth={2.25} />
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

const actionIconBtnClass = 'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/60 shadow-sm ring-1 backdrop-blur-sm transition-transform active:scale-95 bg-indigo-50/90 text-indigo-600 ring-indigo-100 dark:bg-indigo-900/25 dark:text-indigo-300 dark:ring-indigo-800/60';

/* ── Skeleton Card ─────────────────────────────────────────── */

function UserSkeletonCard() {
  return (
    <Card className="rounded-xl p-3">
      <div className="flex gap-3">
        <div className="h-4 w-4 rounded bg-[var(--color-bg-sunken)]" />
        <div className="flex-1 space-y-3">
          <div className="h-4 w-2/3 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-3 w-1/2 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-8 rounded bg-[var(--color-bg-sunken)]" />
        </div>
      </div>
    </Card>
  );
}

/* ── User Dialogs (Create/Edit form) ──────────────────────── */

function UserDialogs({ formOpen, form, editId, saving, dirty, confirmClose, roles, users: allUsers, canEditRoles, canManageSuperAdmin, onCloseForm, onDiscard, onKeepEditing, onChange, onSubmit }: {
  formOpen: boolean;
  form: UserForm;
  editId: string | null;
  saving: boolean;
  dirty: boolean;
  confirmClose: boolean;
  roles: any[];
  users: any[];
  canEditRoles: boolean;
  canManageSuperAdmin: boolean;
  onCloseForm: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
  onChange: (patch: Partial<UserForm>) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  // Data-driven section model: the reporting-manager selector only offers
  // eligible managers for the selected role's section (same department,
  // cross-section Management layer, or super-admin).
  const roleDepartment = useMemo(() => {
    const roleDoc = roles.find((r: any) => String(r.name || '').trim().toLowerCase() === String(form.role || '').trim().toLowerCase());
    return String(roleDoc?.department || '');
  }, [roles, form.role]);
  const managerOptions = useMemo(() => [
    { label: 'None (Self)', value: '' },
    ...allUsers
      .filter((u: any) => u.id !== editId && isEligibleManagerOption(u, roleDepartment,
        roles.find((r: any) => String(r.name || '').trim().toLowerCase() === String(u.role || '').trim().toLowerCase()) || null))
      .map((u: any) => ({ label: u.name, value: u.id })),
  ], [allUsers, editId, roleDepartment, roles]);

  return (
    <>
      <Modal open={formOpen} onClose={onCloseForm} title={editId ? 'Edit User' : 'Add User'} size="full">
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">User Info</p>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Full Name *" required value={form.name} onChange={(event) => onChange({ name: event.target.value })} />
              <Input label="Email *" type="email" required value={form.email} onChange={(event) => onChange({ email: event.target.value })} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Input label="Phone" value={form.phone} onChange={(event) => onChange({ phone: event.target.value })} />
              {canEditRoles
                ? <Select label="Role" value={form.role} onChange={(event) => onChange({ role: event.target.value })}
                    options={[{ label: DEFAULT_USER_ROLE, value: DEFAULT_USER_ROLE }, ...roles.filter((r: any) => r.name !== DEFAULT_USER_ROLE).map((r: any) => ({ label: r.name, value: r.name }))]} />
                : <div><p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1">Role</p><Badge variant="purple">{form.role || '—'}</Badge></div>}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Select label="Reporting Manager" value={form.managerId} onChange={(event) => onChange({ managerId: event.target.value })}
                options={managerOptions} />
              <Select label="Status" value={form.status} onChange={(event) => onChange({ status: event.target.value })}
                options={['Active', 'Inactive', 'Suspended'].map(s => ({ label: s, value: s }))} />
            </div>
            {roleDepartment ? (
              <p className="mt-2 text-xs font-medium text-[var(--color-text-muted)]">
                Department: <span className="font-semibold text-[var(--color-text)]">{roleDepartment}</span>
              </p>
            ) : null}
            {canManageSuperAdmin ? (
              <label className="mt-3 flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3 text-sm">
                <input
                  type="checkbox"
                  checked={form.isSuperAdmin}
                  onChange={(event) => onChange({ isSuperAdmin: event.target.checked })}
                  className="mt-0.5 rounded border-[var(--color-border)] text-[var(--color-primary)]"
                />
                <span>
                  <span className="block font-semibold text-[var(--color-text)]">Super Admin</span>
                  <span className="block text-xs text-[var(--color-text-muted)]">Grant unrestricted ERP access through the user document.</span>
                </span>
              </label>
            ) : null}
          </div>

          {!editId && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Authentication</p>
              <Input label="Temporary Password *" type="password" required value={form.password} onChange={(event) => onChange({ password: event.target.value })} placeholder="Set initial password" />
            </div>
          )}

          {dirty ? <p className="text-xs font-medium text-[var(--color-warning-text)]">Unsaved changes</p> : null}

          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onCloseForm}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={saving}>{editId ? 'Update' : 'Add User'}</Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={confirmClose}
        onClose={onKeepEditing}
        onConfirm={onDiscard}
        title="Discard Changes"
        message="Close this form and discard unsaved changes?"
      />
    </>
  );
}

/* ── User View Modal ──────────────────────────────────────── */

function UserViewModal({ user, canEdit, canDelete, onClose, onEdit, onDelete }: {
  user: any;
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onEdit: (u: any) => void;
  onDelete: (u: any) => void;
}) {
  if (!user) return null;
  return (
    <Modal open={!!user} onClose={onClose} title={user.name || 'User Details'} size="full">
      <div className="space-y-4">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {statusBadge(user.status || 'Active')}
            <Badge variant="purple">{user.role || '—'}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Detail label="Email" value={user.email || '—'} />
            <Detail label="Phone" value={user.phone || '—'} />
          </div>
        </section>

        <Section title="Account Information">
          <Detail label="User Name" value={user.name || '—'} />
          <Detail label="User ID" value={user.id || '—'} />
          <Detail label="Created" value={fmtDate(user.createdAt) || '—'} />
          <Detail label="Last Login" value={user.lastLoginAt ? fmtDate(user.lastLoginAt) : 'Not available'} />
        </Section>

        <Section title="Role & Access">
          <Detail label="Role" value={user.role || '—'} />
          <Detail label="Department" value={user.department || '—'} />
          <Detail label="Super Admin" value={user.isSuperAdmin === true ? 'Yes' : 'No'} />
          {user.managerId ? <Detail label="Reporting Manager" value={user.managerName || user.managerId} /> : null}
          {user.warehouseId ? <Detail label="Warehouse" value={user.warehouseId} /> : null}
        </Section>

        <Section title="Activity">
          <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-4 text-center">
            <Shield className="mx-auto h-6 w-6 text-[var(--color-text-disabled)]" />
            <p className="mt-1 text-xs font-medium text-[var(--color-text)]">No activity recorded</p>
            <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">Activity logs will appear here.</p>
          </div>
        </Section>

        <div className="grid grid-cols-2 gap-2">
          {canEdit ? <Button variant="outline" icon={<Edit2 className="h-4 w-4" />} onClick={() => onEdit(user)}>Edit</Button> : null}
          {canDelete ? <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => onDelete(user)}>Delete</Button> : null}
        </div>
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{title}</h3>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-[var(--color-text)]">{value}</p>
    </div>
  );
}

export { MobileUsersWorkspace };
