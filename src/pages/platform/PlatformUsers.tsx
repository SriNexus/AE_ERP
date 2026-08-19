/**
 * PlatformUsers — Super Admin platform-wide Users screen (§6.5).
 *
 * Table: Name · Email · Role · Company · Group · Status · Created. Filters:
 * Group, Company, Role, Status, search. Row actions: Deactivate/Reactivate
 * (platform-wide authority) · Grant Group Admin (elevation flow, §6.6).
 *
 * Deliberately does NOT support bulk role editing or bulk permission changes
 * — role changes are scoped, deliberate, individually-audited actions
 * (logRoleChange() once per user).
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, UserCog, UserX } from 'lucide-react';
import PlatformShell from './PlatformShell';
import { getAllPlatform, updateDocById } from '../../lib/firestore';
import { COLLECTIONS } from '../../lib/firebase';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { grantGroupAdmin, revokeGroupAdmin } from '../../lib/platformAdmin';
import { logUpdate } from '../../lib/auditLogger';
import { toast } from 'react-hot-toast';

export default function PlatformUsers() {
  const qc = useQueryClient();
  const [groupF, setGroupF] = useState('all');
  const [companyF, setCompanyF] = useState('all');
  const [roleF, setRoleF] = useState('all');
  const [statusF, setStatusF] = useState('all');
  const [search, setSearch] = useState('');
  const [grantTarget, setGrantTarget] = useState<any | null>(null);

  const { data: users = [] } = useQuery({ queryKey: ['platform-users'], queryFn: () => getAllPlatform<any>(COLLECTIONS.USERS), staleTime: 30_000 });
  const { data: groups = [] } = useQuery({ queryKey: ['platform-groups'], queryFn: () => getAllPlatform<any>(COLLECTIONS.GROUPS), staleTime: 30_000 });
  const { data: companies = [] } = useQuery({ queryKey: ['platform-companies'], queryFn: () => getAllPlatform<any>(COLLECTIONS.COMPANIES), staleTime: 30_000 });
  const { data: members = [] } = useQuery({ queryKey: ['platform-group-members'], queryFn: () => getAllPlatform<any>(COLLECTIONS.GROUP_MEMBERS), staleTime: 30_000 });

  const companyGroup = (companyId: string) => companies.find((c: any) => c.id === companyId)?.groupId || '';
  const groupName = (id: string) => { const g = groups.find((gr: any) => gr.id === id); return g ? (g.shortName || g.name || id) : id; };
  const companyName = (id: string) => { const c = companies.find((co: any) => co.id === id); return c ? (c.name || id) : id; };

  const activeGroupAdminUserIds = new Set(members.filter((m: any) => m.status === 'Active' && m.role === 'GroupAdmin').map((m: any) => m.userId));

  const rows = useMemo(() => {
    return users
      .filter((u: any) => !u.isDeleted)
      .map((u: any) => ({
        id: u.id, name: u.name || '', email: u.email || '', role: u.role || '',
        companyId: u.companyId || '', groupId: u.groupId || companyGroup(u.companyId),
        status: u.status || 'Active', isSuperAdmin: u.isSuperAdmin === true, createdAt: u.createdAt,
      }))
      .filter((u: any) => {
        if (groupF !== 'all' && u.groupId !== groupF) return false;
        if (companyF !== 'all' && u.companyId !== companyF) return false;
        if (roleF !== 'all' && u.role !== roleF) return false;
        if (statusF !== 'all' && u.status !== statusF) return false;
        const q = search.toLowerCase().trim();
        if (q && !u.name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a: any, b: any) => a.name.localeCompare(b.name));
  }, [users, groups, companies, groupF, companyF, roleF, statusF, search]);

  const statusMut = useMutation({
    mutationFn: (input: { id: string; status: string }) => updateDocById(COLLECTIONS.USERS, input.id, { status: input.status }),
    onSuccess: (_: any, input: { id: string; status: string }) => {
      qc.invalidateQueries({ queryKey: ['platform-users'] });
      const u = users.find((x: any) => x.id === input.id);
      void logUpdate('user', input.id, {}, { status: input.status }, 'users').catch(() => {});
      toast.success(`User ${input.status === 'Active' ? 'reactivated' : 'deactivated'} (${u?.email || input.id})`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const grantMut = useMutation({
    mutationFn: (input: { groupId: string; userId: string; email: string; role: string }) =>
      grantGroupAdmin({ groupId: input.groupId, userId: input.userId, userEmail: input.email, currentRole: input.role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-users'] });
      qc.invalidateQueries({ queryKey: ['platform-group-members'] });
      qc.invalidateQueries({ queryKey: ['platform-audit'] });
      toast.success('Group Admin granted');
      setGrantTarget(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const revokeMut = useMutation({
    mutationFn: (input: { userId: string; groupId: string; email: string }) => revokeGroupAdmin(input.groupId, input.userId, input.email),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-users'] });
      qc.invalidateQueries({ queryKey: ['platform-group-members'] });
      toast.success('Group Admin revoked');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const roleOptions = Array.from(new Set(users.map((u: any) => u.role).filter(Boolean))).sort();

  return (
    <PlatformShell title="Users">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-[var(--color-text-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users…"
            className="pl-8 pr-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] w-56"
          />
        </div>
        <Select aria-label="Group" value={groupF} onChange={(e) => setGroupF(e.target.value)} options={[
          { label: 'All Groups', value: 'all' },
          ...groups.filter((g: any) => !g.isDeleted).map((g: any) => ({ label: g.shortName || g.name || g.id, value: g.id })),
        ]} />
        <Select aria-label="Company" value={companyF} onChange={(e) => setCompanyF(e.target.value)} options={[
          { label: 'All Companies', value: 'all' },
          ...companies.filter((c: any) => !c.isDeleted).map((c: any) => ({ label: c.name || c.id, value: c.id })),
        ]} />
        <Select aria-label="Role" value={roleF} onChange={(e) => setRoleF(e.target.value)} options={[
          { label: 'All roles', value: 'all' },
          ...roleOptions.map((r) => ({ label: r, value: r })),
        ]} />
        <Select aria-label="Status" value={statusF} onChange={(e) => setStatusF(e.target.value)} options={[
          { label: 'All statuses', value: 'all' },
          { label: 'Active', value: 'Active' },
          { label: 'Inactive', value: 'Inactive' },
        ]} />
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Email</th>
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="px-4 py-3 font-semibold">Company</th>
                <th className="px-4 py-3 font-semibold">Group</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Created</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u: any) => {
                const isGroupAdmin = u.role === 'GroupAdmin';
                const isOwnerRecord = u.email === 'shreeniwas.tripathi0@gmail.com';
                return (
                  <tr key={u.id} className="border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-hover)]">
                    <td className="px-4 py-3 font-semibold text-[var(--color-text)]">{u.name || '—'}</td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)]">{u.email}</td>
                    <td className="px-4 py-3">
                      {isGroupAdmin ? <Badge variant="purple">GroupAdmin</Badge>
                        : u.isSuperAdmin ? <Badge variant="info">Super Admin</Badge>
                        : <Badge variant="gray">{u.role || '—'}</Badge>}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)]">{u.companyId ? companyName(u.companyId) : '—'}</td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)]">{u.groupId ? groupName(u.groupId) : '—'}</td>
                    <td className="px-4 py-3"><Badge variant={u.status === 'Active' ? 'success' : 'danger'}>{u.status}</Badge></td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)]">{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {!isOwnerRecord && !u.isSuperAdmin && !isGroupAdmin && (
                        <Button size="sm" variant="outline" icon={<UserCog className="h-3.5 w-3.5" />} className="mr-1" onClick={() => setGrantTarget(u)}>
                          Grant Group Admin
                        </Button>
                      )}
                      {isGroupAdmin && (
                        <Button size="sm" variant="danger" className="mr-1" loading={revokeMut.isPending && revokeMut.variables?.userId === u.id}
                          onClick={() => revokeMut.mutate({ userId: u.id, groupId: u.groupId, email: u.email })}>
                          Revoke
                        </Button>
                      )}
                      {!isOwnerRecord && !u.isSuperAdmin && (
                        <Button size="sm" variant={u.status === 'Active' ? 'warning' : 'success'} icon={<UserX className="h-3.5 w-3.5" />}
                          onClick={() => statusMut.mutate({ id: u.id, status: u.status === 'Active' ? 'Inactive' : 'Active' })}>
                          {u.status === 'Active' ? 'Deactivate' : 'Reactivate'}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-[var(--color-text-muted)]">No Users found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Grant Group Admin modal (§6.6) */}
      <GrantModal
        target={grantTarget}
        onClose={() => setGrantTarget(null)}
        groups={groups.filter((g: any) => !g.isDeleted && g.status === 'Active')}
        companies={companies.filter((c: any) => !c.isDeleted)}
        activeGroupAdminUserIds={activeGroupAdminUserIds}
        onSubmit={(groupId) => grantMut.mutate({ groupId, userId: grantTarget.id, email: grantTarget.email, role: grantTarget.role })}
        loading={grantMut.isPending}
      />
    </PlatformShell>
  );
}

function GrantModal({ target, onClose, groups, companies, activeGroupAdminUserIds, onSubmit, loading }: {
  target: any | null; onClose: () => void;
  groups: any[]; companies: any[];
  activeGroupAdminUserIds: Set<string>;
  onSubmit: (groupId: string) => void;
  loading: boolean;
}) {
  const [groupId, setGroupId] = useState('');

  // The target user's company must be inside the chosen Group (users.companyId
  // is immutable at the rules layer — the home Company is their current one).
  const userCompanyInGroup = (gid: string) => target && companies.some((c: any) => c.id === target.companyId && c.groupId === gid);

  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title={`Grant Group Admin — ${target?.email || ''}`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!groupId || !userCompanyInGroup(groupId)}
            loading={loading}
            onClick={() => onSubmit(groupId)}
          >
            Grant Group Admin
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-[var(--color-text)]">
          Target user: <span className="font-semibold">{target?.name || target?.email}</span> ({target?.role}) — Company: {target?.companyId || '—'}.
        </p>
        <div>
          <label className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-1 block">Target Group</label>
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="w-full border px-3 py-2 text-sm rounded-lg bg-[var(--color-bg-elevated)] border-[var(--color-border)]">
            <option value="">Select a Group…</option>
            {groups.map((g: any) => {
              const ok = userCompanyInGroup(g.id);
              const alreadyGA = activeGroupAdminUserIds.has(target?.id);
              return (
                <option key={g.id} value={g.id} disabled={!ok}>
                  {g.shortName || g.name} — {g.id}{ok ? '' : ' (user not in this Group)'}
                </option>
              );
            })}
          </select>
          {activeGroupAdminUserIds.has(target?.id) && (
            <p className="text-xs text-[var(--color-danger-text)] mt-1">This user is already an active Group Admin of another Group (V1: one Group per Group Admin).</p>
          )}
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">
          Grant writes group_members/{'{groupId}_{userId}'} (role GroupAdmin, status Active) and sets users.role=GroupAdmin + users.groupId. The user's home Company stays unchanged (companyId is immutable). The audit trail records the role change.
        </p>
      </div>
    </Modal>
  );
}
