/**
 * PlatformCompanies — Super Admin Companies screen (§6.4).
 *
 * Table: Company name · Group (linked) · Status · Warehouses count · Users
 * count · Business mode · Created. Filters: Group dropdown, status, search.
 * Row action: View detail — links into the existing per-Company admin context
 * (Companies.tsx's detail view, reachable from here). NO generic "Create
 * Company" button (Company creation remains a Group Admin action, §7.3) —
 * the only creation path here is "Bootstrap first Company", visible only for
 * a Group with zero Companies (§4.3).
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Loader2, Plus, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import PlatformShell from './PlatformShell';
import { getAllPlatform } from '../../lib/firestore';
import { COLLECTIONS } from '../../lib/firebase';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { bootstrapCompany } from '../../lib/platformAdmin';
import { toast } from 'react-hot-toast';

export default function PlatformCompanies() {
  const qc = useQueryClient();
  const [groupF, setGroupF] = useState('all');
  const [statusF, setStatusF] = useState('all');
  const [search, setSearch] = useState('');
  const [bootstrapGroupId, setBootstrapGroupId] = useState<string | null>(null);

  const { data: companies = [] } = useQuery({ queryKey: ['platform-companies'], queryFn: () => getAllPlatform<any>(COLLECTIONS.COMPANIES), staleTime: 30_000 });
  const { data: groups = [] } = useQuery({ queryKey: ['platform-groups'], queryFn: () => getAllPlatform<any>(COLLECTIONS.GROUPS), staleTime: 30_000 });
  const { data: warehouses = [] } = useQuery({ queryKey: ['platform-warehouses'], queryFn: () => getAllPlatform<any>(COLLECTIONS.WAREHOUSES), staleTime: 30_000 });
  const { data: users = [] } = useQuery({ queryKey: ['platform-users'], queryFn: () => getAllPlatform<any>(COLLECTIONS.USERS), staleTime: 30_000 });

  const groupName = (id: string) => {
    const g = groups.find((gr: any) => gr.id === id);
    return g ? (g.shortName || g.name || id) : id;
  };

  // Groups with zero Companies — candidates for the bootstrap action.
  const bootstrapCandidates = groups.filter((g: any) => !g.isDeleted && g.status === 'Active'
    && !companies.some((c: any) => c.groupId === g.id && !c.isDeleted));

  const rows = useMemo(() => {
    return companies
      .filter((c: any) => !c.isDeleted)
      .map((c: any) => ({
        id: c.id,
        name: c.name || c.id,
        groupId: c.groupId || '',
        status: c.status || 'Active',
        businessMode: c.businessMode || c.business_mode || '',
        createdAt: c.createdAt,
        warehousesCount: warehouses.filter((w: any) => w.companyId === c.id && !w.isDeleted).length,
        usersCount: users.filter((u: any) => u.companyId === c.id && !u.isDeleted).length,
      }))
      .filter((c: any) => {
        if (groupF !== 'all' && c.groupId !== groupF) return false;
        if (statusF !== 'all' && c.status !== statusF) return false;
        const q = search.toLowerCase().trim();
        if (q && !c.name.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a: any, b: any) => a.name.localeCompare(b.name));
  }, [companies, groups, warehouses, users, groupF, statusF, search]);

  const bootstrapMut = useMutation({
    mutationFn: (input: { groupId: string; name: string }) => bootstrapCompany({ groupId: input.groupId, name: input.name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-companies'] });
      qc.invalidateQueries({ queryKey: ['platform-audit'] });
      toast.success('Company bootstrapped into Group');
      setBootstrapGroupId(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <PlatformShell title="Companies">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-[var(--color-text-muted)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search companies…"
              className="pl-8 pr-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] w-56"
            />
          </div>
          <Select aria-label="Group" value={groupF} onChange={(e) => setGroupF(e.target.value)} options={[
            { label: 'All Groups', value: 'all' },
            ...groups.filter((g: any) => !g.isDeleted).map((g: any) => ({ label: g.shortName || g.name || g.id, value: g.id })),
          ]} />
          <Select aria-label="Status" value={statusF} onChange={(e) => setStatusF(e.target.value)} options={[
            { label: 'All statuses', value: 'all' },
            { label: 'Active', value: 'Active' },
            { label: 'Suspended', value: 'Suspended' },
          ]} />
        </div>
        {bootstrapCandidates.length > 0 && (
          <Button variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setBootstrapGroupId(bootstrapCandidates[0].id)}>
            Bootstrap first Company
          </Button>
        )}
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                <th className="px-4 py-3 font-semibold">Company</th>
                <th className="px-4 py-3 font-semibold">Group</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Warehouses</th>
                <th className="px-4 py-3 font-semibold text-right">Users</th>
                <th className="px-4 py-3 font-semibold">Business mode</th>
                <th className="px-4 py-3 font-semibold">Created</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c: any) => (
                <tr key={c.id} className="border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-hover)]">
                  <td className="px-4 py-3 font-semibold text-[var(--color-text)]">{c.name}</td>
                  <td className="px-4 py-3">
                    {c.groupId ? (
                      <Link to="/platform/groups" className="text-[var(--color-primary-text)] hover:underline">{groupName(c.groupId)}</Link>
                    ) : <span className="text-[var(--color-danger-text)]">No Group</span>}
                  </td>
                  <td className="px-4 py-3"><Badge variant={c.status === 'Active' ? 'success' : 'danger'}>{c.status}</Badge></td>
                  <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text)]">{c.warehousesCount}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text)]">{c.usersCount}</td>
                  <td className="px-4 py-3 text-[var(--color-text-muted)]">{c.businessMode || '—'}</td>
                  <td className="px-4 py-3 text-[var(--color-text-muted)]">{c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <Link to={`/companies?open=${c.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-primary-text)] hover:underline">
                      <Building2 className="h-3.5 w-3.5" /> View
                    </Link>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-[var(--color-text-muted)]">No Companies found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Bootstrap first Company modal (§4.3/§6.4) */}
      <Modal
        open={!!bootstrapGroupId}
        onClose={() => setBootstrapGroupId(null)}
        title="Bootstrap first Company"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setBootstrapGroupId(null)}>Cancel</Button>
            <Button
              loading={bootstrapMut.isPending}
              disabled={!bootstrapGroupId}
              onClick={() => bootstrapGroupId && bootstrapMut.mutate({ groupId: bootstrapGroupId, name: '' })}
            >
              <span className="flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" /> Create Company</span>
            </Button>
          </div>
        }
      >
        <BootstrapForm
          groupId={bootstrapGroupId || ''}
          groupName={bootstrapGroupId ? groupName(bootstrapGroupId) : ''}
          loading={bootstrapMut.isPending}
          onSubmit={(name) => bootstrapGroupId && bootstrapMut.mutate({ groupId: bootstrapGroupId, name })}
        />
      </Modal>
    </PlatformShell>
  );
}

function BootstrapForm({ groupId, groupName, loading, onSubmit }: {
  groupId: string; groupName: string; loading: boolean;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const [businessMode, setBusinessMode] = useState('Both');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--color-text)]">
        Bootstrapping the first Company into Group <span className="font-semibold">{groupName}</span> ({groupId}).
      </p>
      <Input label="Company name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ChaitanyaSri Greentech Pvt Ltd" autoFocus />
      <Select label="Business mode" value={businessMode} onChange={(e) => setBusinessMode(e.target.value)} options={[
        { label: 'Both', value: 'Both' }, { label: 'B2B', value: 'B2B' }, { label: 'B2C', value: 'B2C' },
      ]} />
      <div className="grid grid-cols-2 gap-3">
        <Input label="Contact email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label="Contact phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <Button loading={loading} disabled={!name.trim()} onClick={() => onSubmit(name.trim())} className="w-full">
        Create Company in {groupName}
      </Button>
    </div>
  );
}
