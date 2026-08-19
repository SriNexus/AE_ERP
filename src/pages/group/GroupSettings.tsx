/**
 * GroupSettings — Group Admin settings screen (§7.9).
 *
 * V1 scope: display-only Group info (name, short name, status, created date —
 * Group name/short-name editing is platform-tier in V1) plus the "Group
 * Admins" management table: self-service for an existing Group Admin to add a
 * SECOND Group Admin for their own Group. Revoke stays a platform-tier
 * operation (§7.9 scopes self-service to ADD) — the rules keep
 * group_members update owner/Super Admin only.
 *
 * Reads: groups/{actorGroupId} (rules: isGroupAdmin + path == actorGroupId +
 * Active gate) and group_members where groupId == actorGroupId (rules:
 * groupAdminCanRead). Grant: grantGroupAdminForGroup() — raw writes whose
 * rules require the active GroupAdmin identity, same Group, grantedBy == the
 * actor and target != self.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserCog, UsersRound, Globe } from 'lucide-react';
import GroupShell from './GroupShell';
import { getOne } from '../../lib/firestore';
import { COLLECTIONS } from '../../lib/firebase';
import { useAppStore } from '../../store/useAppStore';
import { useSelectedGroupId, useGroupScopedCollection } from './useSelectedGroup';
import { grantGroupAdminForGroup } from '../../lib/groupAdmin';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader, CardTitle, EmptyState } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { Select } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Table, Tbody, Td, Th, Thead, Tr } from '../../components/ui/Table';
import toast from 'react-hot-toast';

export default function GroupSettings() {
  const qc = useQueryClient();
  const user = useAppStore((s) => s.user);
  const { selectedGroupId: groupId } = useSelectedGroupId();
  const [grantTarget, setGrantTarget] = useState<any | null>(null);

  const groupInfoEnabled = useMemo(() => ({ enabled: !!groupId }), [groupId]);

  const { data: group = null } = useQuery({
    queryKey: ['group-info', groupId],
    queryFn: () => getOne<any>(COLLECTIONS.GROUPS, groupId),
    ...groupInfoEnabled,
    staleTime: 60_000,
  });

  // Group Admins table — direct where('groupId','==', groupId) reads for the
  // Super-Admin-selected Group (see useSelectedGroup.ts).
  const { data: members = [] } = useGroupScopedCollection<any>(COLLECTIONS.GROUP_MEMBERS, groupId, 'group-members');
  const { data: users = [] } = useGroupScopedCollection<any>(COLLECTIONS.USERS, groupId, 'group-settings-users');

  // grantGroupAdminForGroup() requires the literal, active GroupAdmin identity
  // (groupAdmin.ts's requireGroupAdminIdentity()) — it always resolves the
  // Group from the ACTOR's own role/groupId, never a caller-supplied one, so
  // it can never be used from the Super-Admin-only console to grant on an
  // arbitrary browsed Group. "Add Group Admin" is therefore disabled here;
  // granting stays a real GroupAdmin's own §7.9 self-service action from
  // their normal session.
  const canGrant = user?.role === 'GroupAdmin';

  const grantMut = useMutation({
    mutationFn: (input: { userId: string; email: string; role: string }) =>
      grantGroupAdminForGroup(groupId, { userId: input.userId, userEmail: input.email, currentRole: input.role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group-members'] });
      qc.invalidateQueries({ queryKey: ['group-settings-users'] });
      toast.success('Group Admin granted');
      setGrantTarget(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const memberRows = useMemo(() => {
    const activeMemberUserIds = new Set(
      members.filter((m: any) => m.status === 'Active' && m.role === 'GroupAdmin').map((m: any) => m.userId),
    );
    return users
      .filter((u: any) => !u.isDeleted && activeMemberUserIds.has(u.id))
      .map((u: any) => ({
        id: u.id,
        name: u.name || '',
        email: u.email || '',
        status: u.status || 'Active',
      }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name));
  }, [members, users]);

  // Candidates: active users in this Group, not already Group Admins, not the
  // actor (self-grant is forbidden at the rules layer), not Super Admins.
  const grantCandidates = useMemo(() => {
    const activeMemberUserIds = new Set(
      members.filter((m: any) => m.status === 'Active' && m.role === 'GroupAdmin').map((m: any) => m.userId),
    );
    return users
      .filter((u: any) =>
        !u.isDeleted
        && u.status !== 'Inactive' && u.status !== 'inactive'
        && u.role !== 'GroupAdmin'
        && !activeMemberUserIds.has(u.id)
        && u.id !== user?.id
        && u.isSuperAdmin !== true)
      .map((u: any) => ({ id: u.id, name: u.name || '', email: u.email || '', role: u.role || '' }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name));
  }, [members, users, user?.id]);

  const createdDate = (group?.createdAt as any)
    ? (typeof (group as any).createdAt?.toDate === 'function' ? (group as any).createdAt.toDate() : new Date((group as any).createdAt))
    : null;

  return (
    <GroupShell title="Group Settings">
      <div className="grid lg:grid-cols-2 gap-5 mb-6">
        {/* Group info — display-only in V1 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Globe className="h-4 w-4" /> Group info</CardTitle>
          </CardHeader>
          <div className="p-4 space-y-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)] font-semibold">Name</p>
              <p className="text-sm font-semibold text-[var(--color-text)]">{group?.name || groupId}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)] font-semibold">Short name</p>
                <p className="text-sm text-[var(--color-text)]">{group?.shortName || '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)] font-semibold">Status</p>
                <Badge variant={group?.status === 'Suspended' ? 'danger' : 'success'}>{group?.status || 'Active'}</Badge>
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)] font-semibold">Created</p>
              <p className="text-sm text-[var(--color-text)]">{createdDate ? createdDate.toLocaleDateString() : '—'}</p>
            </div>
            <p className="text-xs text-[var(--color-text-muted)] pt-1">
              Group name and short name are managed by the platform. Roles are managed per Company from the Roles screen.
            </p>
          </div>
        </Card>

        {/* Group Admins management */}
        <Card>
          <CardHeader className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2"><UsersRound className="h-4 w-4" /> Group Admins</CardTitle>
            <Button size="sm" icon={<UserCog className="h-3.5 w-3.5" />} disabled={!canGrant || grantCandidates.length === 0} onClick={() => setGrantTarget(grantCandidates[0])}>
              Add Group Admin
            </Button>
          </CardHeader>
          <div className="p-4">
            {!canGrant && (
              <p className="text-xs text-[var(--color-text-muted)] mb-3">
                Granting a Group Admin is a self-service action for an existing Group Admin's own session — sign in as a Group Admin of this Group to add another one.
              </p>
            )}
            {memberRows.length === 0 ? (
              <EmptyState title="No Group Admins" description="Add a second Group Admin for this Group." />
            ) : (
              <Table>
                <Thead>
                  <Tr>
                    <Th>Name</Th>
                    <Th>Email</Th>
                    <Th>Status</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {memberRows.map((m) => (
                    <Tr key={m.id}>
                      <Td className="font-medium text-[var(--color-text)]">{m.name}</Td>
                      <Td>{m.email}</Td>
                      <Td><Badge variant="success">{m.status}</Badge></Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
            <p className="text-xs text-[var(--color-text-muted)] mt-3">
              Revoking a Group Admin is a platform operation. An existing Group Admin can add a second Group Admin for this Group.
            </p>
          </div>
        </Card>
      </div>

      {/* ── Add Group Admin modal ───────────────────────────── */}
      <Modal open={!!grantTarget} onClose={() => setGrantTarget(null)} title="Add Group Admin" size="sm">
        {grantTarget && (
          <div className="space-y-4">
            <p className="text-sm text-[var(--color-text-secondary)]">
              Grant Group Admin authority to a user inside this Group. This grants them the same Group-wide
              management access you have.
            </p>
            <div className="rounded-lg border border-[var(--color-border)] p-3">
              <p className="text-sm font-semibold text-[var(--color-text)]">{grantTarget.name || grantTarget.email}</p>
              <p className="text-xs text-[var(--color-text-muted)]">{grantTarget.email} · {grantTarget.role || '—'}</p>
            </div>
            <Select
              label="Or choose another user in this Group"
              value={grantTarget.id}
              onChange={(e) => {
                const next = grantCandidates.find((c: any) => c.id === e.target.value) || grantTarget;
                setGrantTarget({ ...grantTarget, ...next });
              }}
              options={grantCandidates.map((c: any) => ({ label: `${c.name || c.email} (${c.role || '—'})`, value: c.id }))}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setGrantTarget(null)}>Cancel</Button>
              <Button type="button" disabled={grantMut.isPending} onClick={() => grantMut.mutate({ userId: grantTarget.id, email: grantTarget.email, role: grantTarget.role })}>
                {grantMut.isPending ? 'Granting…' : 'Grant Group Admin'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </GroupShell>
  );
}
