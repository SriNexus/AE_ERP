/**
 * PlatformGroups — Super Admin Groups management (§6.3).
 *
 * Table: Group name · Short name · Status badge · Companies count · Users
 * count · Created · Group Admin(s). Filters: status + search.
 * Row actions: View detail (drawer) · Suspend/Reactivate (typed-name
 * confirmation, §6.9). Primary action: "Create Group" modal (name + short
 * name + Super-Admin-only default/demo checkboxes). No delete — Groups are
 * never hard-deleted, only suspended (universal soft-delete convention).
 *
 * Detail drawer tabs: Overview · Companies · Group Admins (Revoke + Add
 * Group Admin) · Audit Log (this Group's platform events) · Danger Zone
 * (Suspend Group, typed confirmation).
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Building2, Globe, Loader2, Plus, Search, Shield, UserCog, Users, X,
} from 'lucide-react';
import PlatformShell from './PlatformShell';
import { getAllPlatform } from '../../lib/firestore';
import { COLLECTIONS } from '../../lib/firebase';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/Badge';
import { Card, CardHeader, CardTitle } from '../../components/ui/Card';
import { createGroup, grantGroupAdmin, revokeGroupAdmin, setGroupStatus } from '../../lib/platformAdmin';
import { useAppStore } from '../../store/useAppStore';
import { toast } from 'react-hot-toast';

type GroupRow = {
  id: string;
  name: string;
  shortName: string;
  status: string;
  isDefault?: boolean;
  isDemo?: boolean;
  createdAt?: string;
  companiesCount: number;
  usersCount: number;
  admins: Array<{ userId: string; email?: string; name?: string; status: string }>;
};

export default function PlatformGroups() {
  const qc = useQueryClient();
  const currentUser = useAppStore((s) => s.user);
  const [statusF, setStatusF] = useState('all');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [suspendId, setSuspendId] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [showAddAdmin, setShowAddAdmin] = useState(false);

  const { data: groups = [] } = useQuery({ queryKey: ['platform-groups'], queryFn: () => getAllPlatform<any>(COLLECTIONS.GROUPS), staleTime: 30_000 });
  const { data: members = [] } = useQuery({ queryKey: ['platform-group-members'], queryFn: () => getAllPlatform<any>(COLLECTIONS.GROUP_MEMBERS), staleTime: 30_000 });
  const { data: companies = [] } = useQuery({ queryKey: ['platform-companies'], queryFn: () => getAllPlatform<any>(COLLECTIONS.COMPANIES), staleTime: 30_000 });
  const { data: users = [] } = useQuery({ queryKey: ['platform-users'], queryFn: () => getAllPlatform<any>(COLLECTIONS.USERS), staleTime: 30_000 });
  const { data: auditLogs = [] } = useQuery({ queryKey: ['platform-audit'], queryFn: () => getAllPlatform<any>(COLLECTIONS.AUDIT_LOGS), staleTime: 30_000 });

  const rows: GroupRow[] = useMemo(() => {
    return groups
      .filter((g: any) => !g.isDeleted)
      .map((g: any) => {
        const groupCompanies = companies.filter((c: any) => c.groupId === g.id && !c.isDeleted);
        const groupMemberIds = members.filter((m: any) => m.groupId === g.id && m.status === 'Active').map((m: any) => m.userId);
        const admins = users
          .filter((u: any) => groupMemberIds.includes(u.id))
          .map((u: any) => ({ userId: u.id, email: u.email, name: u.name, status: 'Active' }));
        return {
          id: g.id, name: g.name || g.id, shortName: g.shortName || '', status: g.status || 'Active',
          isDefault: g.isDefault, isDemo: g.isDemo, createdAt: g.createdAt,
          companiesCount: groupCompanies.length,
          usersCount: groupCompanies.reduce((acc, c) => acc + users.filter((u: any) => u.companyId === c.id && !u.isDeleted).length, 0),
          admins,
        };
      })
      .filter((g: GroupRow) => {
        if (statusF !== 'all' && g.status !== statusF) return false;
        const q = search.toLowerCase().trim();
        if (q && !g.name.toLowerCase().includes(q) && !(g.shortName || '').toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.name.localeCompare(b.name));
  }, [groups, members, companies, users, statusF, search]);

  const detail = detailId ? rows.find((r) => r.id === detailId) || null : null;
  const detailCompanies = companies.filter((c: any) => c.groupId === detailId && !c.isDeleted);
  const detailAdmins = detail?.admins || [];

  const createMut = useMutation({
    mutationFn: (input: { name: string; shortName: string; isDefault: boolean; isDemo: boolean }) => createGroup(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['platform-groups'] }); toast.success('Group created'); setShowCreate(false); },
    onError: (e: any) => toast.error(e.message),
  });

  const suspendMut = useMutation({
    mutationFn: (input: { id: string; status: 'Active' | 'Suspended' }) => setGroupStatus(input.id, input.status),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['platform-groups'] }); qc.invalidateQueries({ queryKey: ['platform-audit'] }); toast.success('Group status updated'); setSuspendId(null); setConfirmText(''); },
    onError: (e: any) => toast.error(e.message),
  });

  const grantMut = useMutation({
    mutationFn: (input: { groupId: string; userId: string; email: string; role: string }) =>
      grantGroupAdmin({ groupId: input.groupId, userId: input.userId, userEmail: input.email, currentRole: input.role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-group-members'] });
      qc.invalidateQueries({ queryKey: ['platform-users'] });
      qc.invalidateQueries({ queryKey: ['platform-audit'] });
      toast.success('Group Admin granted');
      setShowAddAdmin(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const revokeMut = useMutation({
    mutationFn: (input: { groupId: string; userId: string; email: string }) => revokeGroupAdmin(input.groupId, input.userId, input.email),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-group-members'] });
      qc.invalidateQueries({ queryKey: ['platform-users'] });
      qc.invalidateQueries({ queryKey: ['platform-audit'] });
      toast.success('Group Admin revoked');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const detailAudit = auditLogs
    .filter((l: any) => !l.isDeleted && /group/i.test(String(l.message || '')) && (l.metadata?.groupId === detailId || String(l.message).includes(detail?.name || '__none__')))
    .slice(0, 20);

  // Users eligible for "Add Group Admin" — not already an active Group Admin
  // of ANY group (V1: one Group per Group Admin), not the owner identity.
  const activeGroupAdminIds = new Set(members.filter((m: any) => m.status === 'Active' && m.role === 'GroupAdmin').map((m: any) => m.userId));
  const grantableUsers = users.filter((u: any) => !u.isDeleted && u.status === 'Active' && !activeGroupAdminIds.has(u.id) && !u.isSuperAdmin && u.email !== 'shreeniwas.tripathi0@gmail.com');

  return (
    <PlatformShell title="Groups">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-[var(--color-text-muted)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search groups…"
              className="pl-8 pr-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] w-56"
            />
          </div>
          <Select
            aria-label="Status"
            value={statusF}
            onChange={(e) => setStatusF(e.target.value)}
            options={[
              { label: 'All statuses', value: 'all' },
              { label: 'Active', value: 'Active' },
              { label: 'Suspended', value: 'Suspended' },
            ]}
          />
        </div>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setShowCreate(true)}>Create Group</Button>
      </div>

      {/* Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                <th className="px-4 py-3 font-semibold">Group</th>
                <th className="px-4 py-3 font-semibold">Short name</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Companies</th>
                <th className="px-4 py-3 font-semibold text-right">Users</th>
                <th className="px-4 py-3 font-semibold">Group Admins</th>
                <th className="px-4 py-3 font-semibold">Created</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id} className="border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-hover)]">
                  <td className="px-4 py-3 font-semibold text-[var(--color-text)]">
                    <button className="hover:underline" onClick={() => setDetailId(g.id)}>{g.name}</button>
                    {g.isDefault && <Badge variant="purple" className="ml-2">default</Badge>}
                    {g.isDemo && <Badge variant="info" className="ml-1">demo</Badge>}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-text-muted)]">{g.shortName || '—'}</td>
                  <td className="px-4 py-3"><Badge variant={g.status === 'Active' ? 'success' : 'danger'}>{g.status}</Badge></td>
                  <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text)]">{g.companiesCount}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text)]">{g.usersCount}</td>
                  <td className="px-4 py-3 text-[var(--color-text-muted)] max-w-[180px] truncate">
                    {g.admins.length === 0 ? '—' : g.admins.map((a) => a.email || a.userId).join(', ')}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-text-muted)]">{g.createdAt ? new Date(g.createdAt).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Button size="sm" variant="outline" onClick={() => setDetailId(g.id)}>View</Button>
                    <Button
                      size="sm"
                      variant={g.status === 'Active' ? 'danger' : 'success'}
                      className="ml-1"
                      onClick={() => { setSuspendId(g.id); setConfirmText(''); }}
                    >
                      {g.status === 'Active' ? 'Suspend' : 'Reactivate'}
                    </Button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-[var(--color-text-muted)]">No Groups found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Create Group modal ── */}
      <CreateGroupModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={createMut.mutate}
        loading={createMut.isPending}
      />

      {/* ── Suspend/Reactivate typed confirmation (§6.9) ── */}
      <Modal
        open={!!suspendId}
        onClose={() => setSuspendId(null)}
        title={rows.find((r) => r.id === suspendId)?.status === 'Suspended' ? 'Reactivate Group' : 'Suspend Group'}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setSuspendId(null)}>Cancel</Button>
            <Button
              variant={rows.find((r) => r.id === suspendId)?.status === 'Suspended' ? 'success' : 'danger'}
              disabled={confirmText !== rows.find((r) => r.id === suspendId)?.name}
              loading={suspendMut.isPending}
              onClick={() => {
                const target = rows.find((r) => r.id === suspendId);
                if (!target) return;
                suspendMut.mutate({ id: target.id, status: target.status === 'Suspended' ? 'Active' : 'Suspended' });
              }}
            >
              Confirm
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-text)]">
            {rows.find((r) => r.id === suspendId)?.status === 'Suspended'
              ? `Reactivating this Group restores access for all Companies and Group Admins under it.`
              : `Suspending this Group immediately cuts off every Company Admin AND Group Admin under it (Super Admin retains break-glass access).`}
          </p>
          <p className="text-sm text-[var(--color-text)]">
            Type the Group name <span className="font-bold text-[var(--color-text)]">{rows.find((r) => r.id === suspendId)?.name}</span> to confirm:
          </p>
          <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="Group name" autoFocus />
        </div>
      </Modal>

      {/* ── Detail drawer ── */}
      <Modal
        open={!!detail}
        onClose={() => setDetailId(null)}
        title={detail?.name || 'Group detail'}
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDetailId(null)}>Close</Button>
            {detail && (
              <Button
                variant={detail.status === 'Active' ? 'danger' : 'success'}
                onClick={() => { setDetailId(null); setSuspendId(detail.id); setConfirmText(''); }}
              >
                {detail.status === 'Active' ? 'Suspend Group' : 'Reactivate Group'}
              </Button>
            )}
          </div>
        }
      >
        {detail && (
          <div className="space-y-5 max-h-[70vh] overflow-y-auto">
            {/* Overview */}
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Globe className="h-4 w-4" /> Overview</CardTitle></CardHeader>
              <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <Stat label="Status"><Badge variant={detail.status === 'Active' ? 'success' : 'danger'}>{detail.status}</Badge></Stat>
                <Stat label="Short name">{detail.shortName || '—'}</Stat>
                <Stat label="Companies">{detail.companiesCount}</Stat>
                <Stat label="Users">{detail.usersCount}</Stat>
                <Stat label="Created">{detail.createdAt ? new Date(detail.createdAt).toLocaleDateString() : '—'}</Stat>
                <Stat label="Default">{detail.isDefault ? 'Yes' : 'No'}</Stat>
                <Stat label="Demo">{detail.isDemo ? 'Yes' : 'No'}</Stat>
                <Stat label="Group Admins">{detail.admins.length}</Stat>
              </div>
            </Card>

            {/* Companies */}
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="h-4 w-4" /> Companies</CardTitle></CardHeader>
              <div className="p-4 space-y-1.5 text-sm">
                {detailCompanies.length === 0 && (
                  <p className="text-[var(--color-text-muted)]">
                    No Companies yet. Use "Bootstrap first Company" on the Companies screen to add one (a Group must have ≥1 Company before a Group Admin can be created — §4.3).
                  </p>
                )}
                {detailCompanies.map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between py-1">
                    <span className="text-[var(--color-text)]">{c.name || c.id}</span>
                    <span className="text-xs text-[var(--color-text-muted)]">{c.businessMode || c.business_mode || ''}</span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Group Admins */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="flex items-center gap-2"><UserCog className="h-4 w-4" /> Group Admins</span>
                  <Button size="sm" variant="outline" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setShowAddAdmin(true)}>Add Group Admin</Button>
                </CardTitle>
              </CardHeader>
              <div className="p-4 space-y-1.5 text-sm">
                {detailAdmins.length === 0 && <p className="text-[var(--color-text-muted)]">No active Group Admins.</p>}
                {detailAdmins.map((a) => (
                  <div key={a.userId} className="flex items-center justify-between py-1">
                    <div>
                      <p className="text-[var(--color-text)]">{a.name || '—'}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{a.email || a.userId}</p>
                    </div>
                    <Button size="sm" variant="danger" loading={revokeMut.isPending && revokeMut.variables?.userId === a.userId} onClick={() => revokeMut.mutate({ groupId: detail.id, userId: a.userId, email: a.email || a.userId })}>
                      Revoke
                    </Button>
                  </div>
                ))}
              </div>
            </Card>

            {/* Audit log (this Group's platform events) */}
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Shield className="h-4 w-4" /> Audit Log</CardTitle></CardHeader>
              <div className="p-4 space-y-1.5 text-sm max-h-48 overflow-y-auto">
                {detailAudit.length === 0 && <p className="text-[var(--color-text-muted)]">No platform-level events for this Group yet.</p>}
                {detailAudit.map((l: any) => (
                  <div key={l.id} className="flex items-start gap-2">
                    <span className="text-xs text-[var(--color-text-muted)] shrink-0">{new Date(l.timestamp || l.createdAt).toLocaleString()}</span>
                    <span className="text-[var(--color-text)]">{l.message}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </Modal>

      {/* ── Add Group Admin modal (§6.6) ── */}
      <AddGroupAdminModal
        open={showAddAdmin}
        onClose={() => setShowAddAdmin(false)}
        groupId={detailId || ''}
        candidates={grantableUsers}
        groupCompanies={detailCompanies}
        onSubmit={(userId, email, role) => grantMut.mutate({ groupId: detailId || '', userId, email, role })}
        loading={grantMut.isPending}
      />
    </PlatformShell>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-[var(--color-text)] font-semibold">{children}</p>
    </div>
  );
}

function CreateGroupModal({ open, onClose, onSubmit, loading }: {
  open: boolean; onClose: () => void;
  onSubmit: (input: { name: string; shortName: string; isDefault: boolean; isDemo: boolean }) => void;
  loading: boolean;
}) {
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [isDemo, setIsDemo] = useState(false);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create Group"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!name.trim() || !shortName.trim()}
            loading={loading}
            onClick={() => onSubmit({ name: name.trim(), shortName: shortName.trim(), isDefault, isDemo })}
          >
            Create Group
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Input label="Group name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CSGPL Group" autoFocus />
        <Input label="Short name" required value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="e.g. CSGPL" />
        <div className="flex items-center gap-4 pt-1">
          <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="accent-[var(--color-primary)]" />
            Mark as default Group
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
            <input type="checkbox" checked={isDemo} onChange={(e) => setIsDemo(e.target.checked)} className="accent-[var(--color-primary)]" />
            Mark as demo Group
          </label>
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">
          A Group is created without a Company or Group Admin in the same flow (§4.3). Use "Bootstrap first Company" on the Companies screen next, then add a Group Admin.
        </p>
      </div>
    </Modal>
  );
}

function AddGroupAdminModal({ open, onClose, groupId, candidates, groupCompanies, onSubmit, loading }: {
  open: boolean; onClose: () => void; groupId: string;
  candidates: any[]; groupCompanies: any[];
  onSubmit: (userId: string, email: string, role: string) => void;
  loading: boolean;
}) {
  const [userId, setUserId] = useState('');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Add Group Admin — ${groupId || ''}`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!userId || groupCompanies.length === 0}
            loading={loading}
            onClick={() => {
              const u = candidates.find((c) => c.id === userId);
              if (!u) return;
              onSubmit(u.id, u.email || u.id, u.role || 'Admin');
            }}
          >
            Grant Group Admin
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {groupCompanies.length === 0 && (
          <p className="text-sm text-[var(--color-danger-text)] bg-[var(--color-danger-light)] border border-[var(--color-danger)]/30 rounded-lg p-3">
            This Group has no Companies. Bootstrap the first Company first (§4.3 — a Group Admin requires a home Company).
          </p>
        )}
        <p className="text-xs text-[var(--color-text-muted)]">
          The target user's home Company (their current Company) stays unchanged — the rules keep users.companyId immutable. Grant sets role=GroupAdmin + groupId on the users doc and writes group_members/{groupId}_{userId}.
        </p>
        <div>
          <label className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-1 block">User (must belong to a Company in this Group)</label>
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="w-full border px-3 py-2 text-sm rounded-lg bg-[var(--color-bg-elevated)] border-[var(--color-border)]"
          >
            <option value="">Select a user…</option>
            {candidates.map((u: any) => {
              const inGroup = groupCompanies.some((c: any) => c.id === u.companyId);
              return (
                <option key={u.id} value={u.id} disabled={!inGroup}>
                  {u.name || u.email} — {u.role} ({u.companyId}){inGroup ? '' : ' · outside this Group'}
                </option>
              );
            })}
          </select>
        </div>
      </div>
    </Modal>
  );
}
