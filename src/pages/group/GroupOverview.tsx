/**
 * GroupOverview — Group Admin summary screen (§7.1).
 *
 * KPIs: Companies in this Group · Total Users (active/inactive) · Total
 * Warehouses · Basic ERP usage (Leads/Orders created this month, summed
 * across the Group's Companies).
 * Widgets: "Companies in this Group" table (name, users count, warehouses
 * count, status, quick-link) · "Recent Group activity" (audit_logs,
 * Group-scoped).
 *
 * Query mechanism (§7.1): every widget uses a single
 * where('groupId','==', actor.groupId) query per collection — the direct
 * payoff of the Phase 1 groupId denormalization. Reads go through getAll()
 * with the 'group' sentinel active (set on mount), which the Phase 2 query
 * layer translates to the groupId constraint; the rules'
 * groupAdminCanRead()/sameGroup() branches make every one provable.
 */

import { useMemo } from 'react';
import { Building2, Users, Warehouse as WarehouseIcon, Target, ShoppingCart, ScrollText, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import GroupShell from './GroupShell';
import { COLLECTIONS } from '../../lib/firebase';
import { useSelectedGroupId, useGroupScopedCollection } from './useSelectedGroup';
import { Card, CardHeader, CardTitle } from '../../components/ui/Card';
import { Badge, statusBadge } from '../../components/ui/Badge';

function Kpi({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string | number; sub?: string; tone: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className={`p-2.5 rounded-xl ring-2 shrink-0 ${tone}`}>{icon}</div>
        <div className="min-w-0">
          <p className="text-xs text-[var(--color-text-muted)] font-medium uppercase tracking-wide truncate">{label}</p>
          <p className="text-2xl font-bold text-[var(--color-text)] leading-tight mt-0.5 tabular-nums">{value}</p>
          {sub && <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{sub}</p>}
        </div>
      </div>
    </Card>
  );
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && value !== null && typeof (value as any).toDate === 'function') return (value as any).toDate();
  if (typeof value === 'object' && value !== null && typeof (value as any).seconds === 'number') return new Date((value as any).seconds * 1000);
  const p = new Date(value as any);
  return isNaN(p.getTime()) ? null : p;
}

export default function GroupOverview() {
  const navigate = useNavigate();
  const { selectedGroupId: groupId } = useSelectedGroupId();

  // §7.1: reads are direct where('groupId','==', groupId) queries against
  // the Super Admin's currently-selected Group (see useSelectedGroup.ts) —
  // NOT the shared getAll() 'group' sentinel, which only ever resolves the
  // signed-in actor's own groupId (empty for the Owner identity).
  const { data: companies = [] } = useGroupScopedCollection<any>(COLLECTIONS.COMPANIES, groupId, 'group-companies-overview');
  const { data: users = [] } = useGroupScopedCollection<any>(COLLECTIONS.USERS, groupId, 'group-users-overview');
  const { data: warehouses = [] } = useGroupScopedCollection<any>(COLLECTIONS.WAREHOUSES, groupId, 'group-warehouses-overview');
  const { data: leads = [] } = useGroupScopedCollection<any>(COLLECTIONS.LEADS, groupId, 'group-leads-overview');
  const { data: orders = [] } = useGroupScopedCollection<any>(COLLECTIONS.ORDERS, groupId, 'group-orders-overview');
  const { data: auditLogs = [] } = useGroupScopedCollection<any>(COLLECTIONS.AUDIT_LOGS, groupId, 'group-audit-overview');

  const activeCompanies = companies.filter((c: any) => c.isDeleted !== true);
  const activeUsers = users.filter((u: any) => !u.isDeleted && u.status !== 'Inactive' && u.status !== 'inactive');
  const inactiveUsers = users.filter((u: any) => !u.isDeleted && (u.status === 'Inactive' || u.status === 'inactive'));
  const activeWarehouses = warehouses.filter((w: any) => w.isDeleted !== true && w.status !== 'Inactive');

  const monthStart = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  }, []);
  const leadsThisMonth = leads.filter((l: any) => {
    const t = toDate(l.createdAt)?.getTime() || 0;
    return t >= monthStart;
  }).length;
  const ordersThisMonth = orders.filter((o: any) => {
    const t = toDate(o.createdAt)?.getTime() || 0;
    return t >= monthStart;
  }).length;

  const recentActivity = useMemo(
    () => auditLogs
      .filter((l: any) => l.isDeleted !== true)
      .sort((a: any, b: any) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0))
      .slice(0, 8),
    [auditLogs],
  );

  const usersByCompany = useMemo(() => {
    const map = new Map<string, number>();
    for (const u of users) if (!u.isDeleted && u.companyId) map.set(u.companyId, (map.get(u.companyId) || 0) + 1);
    return map;
  }, [users]);
  const warehousesByCompany = useMemo(() => {
    const map = new Map<string, number>();
    for (const w of warehouses) if (w.isDeleted !== true && w.companyId) map.set(w.companyId, (map.get(w.companyId) || 0) + 1);
    return map;
  }, [warehouses]);

  return (
    <GroupShell title="Group Overview">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
        <Kpi icon={<Building2 className="h-4 w-4" />} label="Companies" value={activeCompanies.length} sub="in this Group" tone="bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400" />
        <Kpi icon={<Users className="h-4 w-4" />} label="Total Users" value={activeUsers.length + inactiveUsers.length} sub={`${activeUsers.length} active · ${inactiveUsers.length} inactive`} tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" />
        <Kpi icon={<WarehouseIcon className="h-4 w-4" />} label="Total Warehouses" value={activeWarehouses.length} sub="across the Group" tone="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" />
        <Kpi icon={<Target className="h-4 w-4" />} label="Leads (this month)" value={leadsThisMonth} sub="Group-wide" tone="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" />
        <Kpi icon={<ShoppingCart className="h-4 w-4" />} label="Orders (this month)" value={ordersThisMonth} sub="Group-wide" tone="bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Companies in this Group */}
        <Card>
          <CardHeader>
            <CardTitle>Companies in this Group</CardTitle>
          </CardHeader>
          <div className="p-4 space-y-2">
            {activeCompanies.length === 0 && <p className="text-sm text-[var(--color-text-muted)]">No Companies in this Group yet.</p>}
            {activeCompanies.map((c: any) => (
              <button
                key={c.id}
                onClick={() => navigate('/group/companies')}
                className="w-full flex items-center gap-3 text-left hover:bg-[var(--color-surface-hover)] rounded-lg px-2 py-1.5 transition-colors"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary-light)] text-[var(--color-primary-text)]">
                  <Building2 className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[var(--color-text)]">{c.name || c.id}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {usersByCompany.get(c.id) || 0} users · {warehousesByCompany.get(c.id) || 0} warehouses
                  </p>
                </div>
                {statusBadge(c.status || 'Active')}
              </button>
            ))}
          </div>
        </Card>

        {/* Recent Group activity */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Group activity</CardTitle>
          </CardHeader>
          <div className="p-4 space-y-2">
            {recentActivity.length === 0 && <p className="text-sm text-[var(--color-text-muted)]">No recent activity in this Group.</p>}
            {recentActivity.map((l: any, i: number) => (
              <div key={String(l.id || i)} className="flex items-center gap-3 px-2 py-1.5">
                <ScrollText className="h-3.5 w-3.5 text-[var(--color-text-muted)] shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-[var(--color-text)]">
                    {String(l.action || l.module || 'action')} — {String(l.entityType || l.actorName || l.actorId || 'record')}
                  </p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {l.actorName || l.actorId || 'system'} · {toDate(l.createdAt) ? toDate(l.createdAt)!.toLocaleString() : ''}
                  </p>
                </div>
                {l.severity && <Badge variant={l.severity === 'critical' ? 'danger' : l.severity === 'warning' ? 'warning' : 'gray'}>{l.severity}</Badge>}
              </div>
            ))}
            {recentActivity.length > 0 && (
              <button
                onClick={() => navigate('/group/audit-log')}
                className="w-full flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold text-[var(--color-primary-text)] hover:bg-[var(--color-primary-light)] transition-colors"
              >
                View full audit log <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </Card>
      </div>
    </GroupShell>
  );
}
