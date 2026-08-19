/**
 * GroupTeams — Group Admin Teams directory screen (§7.6).
 *
 * Table: name · Company · Warehouse (if set) · Lead · Member count · Status.
 * Create/Edit modal: name · Company (dropdown scoped to the Group) ·
 * Warehouse (optional) · Lead (user picker) · Members (multi-user picker).
 *
 * Pure directory management — this screen has NO interaction with the
 * existing project/ownership visibility engine (§2.3). Company/Group scoping
 * on reads and writes comes from the standard query layer + rules fallback
 * (teams carries companyId + groupId; groupId is write-helper stamped, never
 * client-supplied).
 */

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, UsersRound, RefreshCw, Search } from 'lucide-react';
import GroupShell from './GroupShell';
import { getAll } from '../../lib/firestore';
import { COLLECTIONS } from '../../lib/firebase';
import { useAppStore } from '../../store/useAppStore';
import { useTeams, useSaveTeam } from '../../features/teams/hooks/useTeams';
import { TEAM_FORM_DEFAULT, TEAM_STATUS_OPTIONS, type Team } from '../../features/teams/types';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader, CardTitle, EmptyState } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { Input, Select, FormRow, FormSection } from '../../components/ui/Input';
import { Badge, statusBadge } from '../../components/ui/Badge';
import { Table, Tbody, Td, Th, Thead, Tr } from '../../components/ui/Table';
import { useGroupCompanies } from '../../features/company/hooks/useCompanies';
import toast from 'react-hot-toast';

export default function GroupTeams() {
  const qc = useQueryClient();
  const user = useAppStore((s) => s.user);
  const groupId = user?.groupId || '';
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<any>({ ...TEAM_FORM_DEFAULT, companyId: user?.companyId || '' });

  const groupEnabled = useMemo(() => ({ enabled: !!groupId }), [groupId]);
  const { data: teams = [] } = useTeams();
  const { data: companies = [] } = useGroupCompanies(groupId);
  const { data: users = [] } = useQuery({
    queryKey: ['group-team-users', groupId],
    queryFn: () => getAll<any>(COLLECTIONS.USERS),
    ...groupEnabled,
    staleTime: 30_000,
  });
  const { data: warehouses = [] } = useQuery({
    queryKey: ['group-team-warehouses', groupId],
    queryFn: () => getAll<any>(COLLECTIONS.WAREHOUSES),
    ...groupEnabled,
    staleTime: 30_000,
  });

  const companyName = (id: string) => companies.find((c: any) => c.id === id)?.name || id;
  const warehouseName = (id: string) => warehouses.find((w: any) => w.id === id)?.name || id;
  const userName = (id: string) => {
    const u = users.find((x: any) => x.id === id);
    return u ? (u.name || u.email || id) : id;
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (teams as Team[])
      .filter((t) => t.isDeleted !== true)
      .filter((t) => !q || (t.name || '').toLowerCase().includes(q) || companyName(t.companyId).toLowerCase().includes(q))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams, search]);

  const saveTeam = useSaveTeam(editId, () => {
    setShowForm(false);
    setEditId(null);
    setForm({ ...TEAM_FORM_DEFAULT, companyId: user?.companyId || '' });
    qc.invalidateQueries({ queryKey: ['teams'] });
  });

  const openCreate = () => {
    setEditId(null);
    setForm({ ...TEAM_FORM_DEFAULT, companyId: user?.companyId || '' });
    setShowForm(true);
  };
  const openEdit = (t: Team) => {
    setEditId(t.id);
    setForm({
      name: t.name || '',
      companyId: t.companyId || user?.companyId || '',
      warehouseId: t.warehouseId || '',
      leadUserId: t.leadUserId || '',
      memberUserIds: t.memberUserIds || [],
      department: t.department || '',
      status: t.status || 'Active',
    });
    setShowForm(true);
  };

  const toggleMember = (id: string) => {
    setForm((f: any) => ({
      ...f,
      memberUserIds: f.memberUserIds.includes(id)
        ? f.memberUserIds.filter((x: string) => x !== id)
        : [...f.memberUserIds, id],
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name?.trim()) return toast.error('Team name is required');
    if (!form.companyId) return toast.error('Select a Company');
    saveTeam.mutate({ ...form, name: form.name.trim() });
  };

  return (
    <GroupShell title="Group Administration">
      <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
        <Card>
          <CardHeader className="flex items-center justify-between gap-3">
            <CardTitle>Teams</CardTitle>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 px-2 py-1.5 bg-[var(--color-bg-sunken)] rounded-lg">
                <Search className="h-3.5 w-3.5 text-[var(--color-text-muted)] shrink-0" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search teams…"
                  className="flex-1 bg-transparent text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none"
                />
              </div>
              <Button size="sm" variant="outline" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => qc.invalidateQueries({ queryKey: ['teams'] })}>
                Refresh
              </Button>
              <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={openCreate}>
                Create Team
              </Button>
            </div>
          </CardHeader>
          <div className="p-4">
            {rows.length === 0 ? (
              <EmptyState title="No teams" description="Create a team to organise your Group's people." />
            ) : (
              <Table>
                <Thead>
                  <Tr>
                    <Th>Name</Th>
                    <Th>Company</Th>
                    <Th>Warehouse</Th>
                    <Th>Lead</Th>
                    <Th>Members</Th>
                    <Th>Status</Th>
                    <Th />
                  </Tr>
                </Thead>
                <Tbody>
                  {rows.map((t) => (
                    <Tr key={t.id} className="cursor-pointer" onClick={() => openEdit(t)}>
                      <Td className="font-medium text-[var(--color-text)]">{t.name}</Td>
                      <Td>{companyName(t.companyId)}</Td>
                      <Td>{t.warehouseId ? warehouseName(t.warehouseId) : '—'}</Td>
                      <Td>{t.leadUserId ? userName(t.leadUserId) : '—'}</Td>
                      <Td>{(t.memberUserIds || []).length}</Td>
                      <Td>{statusBadge(t.status || 'Active')}</Td>
                      <Td>
                        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openEdit(t); }}>
                          Edit
                        </Button>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </div>
        </Card>
      </div>

      {/* ── Team Form Modal ──────────────────────────────────── */}
      <Modal open={showForm} onClose={() => { setShowForm(false); setEditId(null); }} title={editId ? 'Edit Team' : 'Create Team'} size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <FormSection title="Team Info">
            <FormRow>
              <Input label="Team Name" required value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <Select
                label="Company"
                value={form.companyId || ''}
                onChange={(e) => setForm({ ...form, companyId: e.target.value })}
                options={[
                  { label: 'Select a Company', value: '' },
                  ...companies.map((c: any) => ({ label: c.name || c.id, value: c.id })),
                ]}
              />
            </FormRow>
            <FormRow>
              <Select
                label="Warehouse (optional)"
                value={form.warehouseId || ''}
                onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}
                options={[
                  { label: 'No warehouse', value: '' },
                  ...warehouses
                    .filter((w: any) => !form.companyId || w.companyId === form.companyId)
                    .map((w: any) => ({ label: w.name || w.id, value: w.id })),
                ]}
              />
              <Input label="Department (optional)" value={form.department || ''} onChange={(e) => setForm({ ...form, department: e.target.value })} />
            </FormRow>
            <FormRow>
              <Select
                label="Team Lead (optional)"
                value={form.leadUserId || ''}
                onChange={(e) => setForm({ ...form, leadUserId: e.target.value })}
                options={[
                  { label: 'No lead', value: '' },
                  ...users
                    .filter((u: any) => !u.isDeleted && (!form.companyId || u.companyId === form.companyId))
                    .map((u: any) => ({ label: u.name || u.email || u.id, value: u.id })),
                ]}
              />
              <Select
                label="Status"
                value={form.status || 'Active'}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                options={TEAM_STATUS_OPTIONS}
              />
            </FormRow>
          </FormSection>

          <FormSection title={`Members (${(form.memberUserIds || []).length} selected)`}>
            <div className="max-h-48 overflow-y-auto rounded-lg border border-[var(--color-border)] divide-y divide-[var(--color-border-subtle)]">
              {users
                .filter((u: any) => !u.isDeleted && (!form.companyId || u.companyId === form.companyId))
                .map((u: any) => {
                  const checked = (form.memberUserIds || []).includes(u.id);
                  return (
                    <label key={u.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[var(--color-surface-hover)]">
                      <input type="checkbox" checked={checked} onChange={() => toggleMember(u.id)} />
                      <span className="text-sm text-[var(--color-text)] truncate">{u.name || u.email || u.id}</span>
                      <Badge variant="gray" className="ml-auto">{u.role || '—'}</Badge>
                    </label>
                  );
                })}
              {users.length === 0 && <p className="px-3 py-3 text-xs text-[var(--color-text-muted)]">No users available.</p>}
            </div>
          </FormSection>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditId(null); }}>Cancel</Button>
            <Button type="submit" disabled={saveTeam.isPending}>{saveTeam.isPending ? 'Saving…' : editId ? 'Save changes' : 'Create Team'}</Button>
          </div>
        </form>
      </Modal>
    </GroupShell>
  );
}
