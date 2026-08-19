/**
 * PlatformDashboard — Super Admin platform dashboard (§6.2).
 *
 * KPIs: Total Groups (active/suspended) · Total Companies · Total Users
 * (active/inactive) · Total Warehouses · Open security events (last 24h) ·
 * Backup status (Phase 7, §12.5 — most recent `backup_metadata` doc's status
 * and age; Never/Running/Success/Failed/Stale, never a bare "healthy" badge
 * with no underlying data).
 * Widgets: "Groups by size" (companies per Group), "Recent platform activity"
 * (audit_logs where module indicates a platform-level action — Group
 * create/suspend, Group Admin grant/revoke — NOT a firehose of company
 * business activity), "Security events" (security_logs, severity badges).
 *
 * Reads: getAllPlatform() only (platform-tier read path, owner/Super Admin).
 */

import { useQuery } from '@tanstack/react-query';
import {
  Activity, AlertTriangle, Boxes, Building2, Database, Globe, Shield, UserCog, Users, Zap,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import PlatformShell from './PlatformShell';
import { getAllPlatform } from '../../lib/firestore';
import { COLLECTIONS } from '../../lib/firebase';
import { Card, CardHeader, CardTitle } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { BACKUP_METADATA_COLLECTION, classifyBackupStatus, formatAge, type BackupMetadataDoc } from '../../lib/backupStatus';

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

const SEVERITY_TONE: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  danger: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  info: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
};

// Platform-level audit modules (§6.2: "recent platform activity" is
// deliberately NOT a company-activity feed).
const PLATFORM_MODULES = new Set(['groups', 'platform', 'security', 'settings', 'roles']);

export default function PlatformDashboard() {
  const navigate = useNavigate();
  const { data: groups = [] } = useQuery({ queryKey: ['platform-groups'], queryFn: () => getAllPlatform<any>(COLLECTIONS.GROUPS), staleTime: 30_000 });
  const { data: companies = [] } = useQuery({ queryKey: ['platform-companies'], queryFn: () => getAllPlatform<any>(COLLECTIONS.COMPANIES), staleTime: 30_000 });
  const { data: users = [] } = useQuery({ queryKey: ['platform-users'], queryFn: () => getAllPlatform<any>(COLLECTIONS.USERS), staleTime: 30_000 });
  const { data: warehouses = [] } = useQuery({ queryKey: ['platform-warehouses'], queryFn: () => getAllPlatform<any>(COLLECTIONS.WAREHOUSES), staleTime: 30_000 });
  const { data: securityLogs = [] } = useQuery({ queryKey: ['platform-security'], queryFn: () => getAllPlatform<any>(COLLECTIONS.SECURITY_LOGS), staleTime: 30_000 });
  const { data: auditLogs = [] } = useQuery({ queryKey: ['platform-audit'], queryFn: () => getAllPlatform<any>(COLLECTIONS.AUDIT_LOGS), staleTime: 30_000 });
  const { data: backups = [] } = useQuery({ queryKey: ['platform-backups'], queryFn: () => getAllPlatform<BackupMetadataDoc>(BACKUP_METADATA_COLLECTION), staleTime: 30_000 });

  const backupHealth = classifyBackupStatus(backups);
  const BACKUP_TONE: Record<string, string> = {
    success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    danger: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    info: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    default: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400',
  };
  const backupSub = backupHealth.ageMs !== undefined
    ? formatAge(backupHealth.ageMs)
    : backupHealth.latest
      ? (backupHealth.latest.triggeredBy || 'from backup_metadata')
      : 'no backup_metadata records';

  const activeGroups = groups.filter((g: any) => g.status === 'Active' && !g.isDeleted);
  const suspendedGroups = groups.filter((g: any) => g.status === 'Suspended' && !g.isDeleted);
  const activeUsers = users.filter((u: any) => u.status === 'Active' && !u.isDeleted);
  const inactiveUsers = users.filter((u: any) => (u.status === 'Inactive' || u.status === 'inactive') && !u.isDeleted);

  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const openSecurity24h = securityLogs.filter((l: any) => {
    if (l.isDeleted) return false;
    const t = new Date(l.timestamp || l.createdAt || 0).getTime();
    return t >= dayAgo;
  });

  // Groups by size — companies per Group, top 10.
  const groupsBySize = activeGroups
    .map((g: any) => ({ id: g.id, name: g.name, shortName: g.shortName, size: companies.filter((c: any) => c.groupId === g.id && !c.isDeleted).length }))
    .sort((a: any, b: any) => b.size - a.size)
    .slice(0, 10);
  const maxSize = Math.max(1, ...groupsBySize.map((g: any) => g.size));

  const platformActivity = auditLogs
    .filter((l: any) => !l.isDeleted && (PLATFORM_MODULES.has(l.module) || /group|maintenance/i.test(String(l.message || ''))))
    .slice(0, 20);

  const recentSecurity = securityLogs
    .filter((l: any) => !l.isDeleted)
    .sort((a: any, b: any) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
    .slice(0, 20);

  return (
    <PlatformShell title="Platform Dashboard">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <Kpi icon={<Globe className="h-4 w-4" />} label="Total Groups" value={activeGroups.length + suspendedGroups.length} sub={`${activeGroups.length} active · ${suspendedGroups.length} suspended`} tone="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" />
        <Kpi icon={<Building2 className="h-4 w-4" />} label="Total Companies" value={companies.filter((c: any) => !c.isDeleted).length} sub={`across ${activeGroups.length} active Groups`} tone="bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400" />
        <Kpi icon={<Users className="h-4 w-4" />} label="Total Users" value={activeUsers.length + inactiveUsers.length} sub={`${activeUsers.length} active · ${inactiveUsers.length} inactive`} tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" />
        <Kpi icon={<Boxes className="h-4 w-4" />} label="Total Warehouses" value={warehouses.filter((w: any) => !w.isDeleted).length} sub="across all tenants" tone="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" />
        <Kpi icon={<AlertTriangle className="h-4 w-4" />} label="Security Events (24h)" value={openSecurity24h.length} sub="from security_logs" tone="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" />
        <Kpi icon={<Database className="h-4 w-4" />} label="Backup Status" value={backupHealth.label} sub={backupSub} tone={BACKUP_TONE[backupHealth.tone] || BACKUP_TONE.default} />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Groups by size */}
        <Card>
          <CardHeader><CardTitle>Groups by size</CardTitle></CardHeader>
          <div className="p-4 space-y-2">
            {groupsBySize.length === 0 && <p className="text-sm text-[var(--color-text-muted)]">No Groups yet.</p>}
            {groupsBySize.map((g: any) => (
              <button
                key={g.id}
                onClick={() => navigate('/platform/groups')}
                className="w-full flex items-center gap-3 text-left hover:bg-[var(--color-surface-hover)] rounded-lg px-2 py-1.5 transition-colors"
              >
                <span className="text-xs font-semibold text-[var(--color-text-muted)] w-24 truncate">{g.shortName || g.name}</span>
                <span className="flex-1 h-2 rounded-full bg-[var(--color-bg-sunken)] overflow-hidden">
                  <span className="block h-full bg-[var(--color-primary)] rounded-full" style={{ width: `${Math.max(4, (g.size / maxSize) * 100)}%` }} />
                </span>
                <span className="text-xs font-bold text-[var(--color-text)] tabular-nums">{g.size} companies</span>
              </button>
            ))}
          </div>
        </Card>

        {/* Recent platform activity */}
        <Card>
          <CardHeader><CardTitle>Recent platform activity</CardTitle></CardHeader>
          <div className="p-4 space-y-2 max-h-72 overflow-y-auto">
            {platformActivity.length === 0 && <p className="text-sm text-[var(--color-text-muted)]">No platform-level activity yet.</p>}
            {platformActivity.map((l: any) => (
              <div key={l.id} className="flex items-start gap-2 text-sm">
                <Activity className="h-3.5 w-3.5 text-[var(--color-primary)] mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[var(--color-text)] truncate">{l.message || l.action}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{l.userEmail || 'system'} · {new Date(l.timestamp || l.createdAt).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Security events */}
        <Card>
          <CardHeader><CardTitle>Security events</CardTitle></CardHeader>
          <div className="p-4 space-y-2 max-h-72 overflow-y-auto">
            {recentSecurity.length === 0 && <p className="text-sm text-[var(--color-text-muted)]">No security events.</p>}
            {recentSecurity.map((l: any) => (
              <div key={l.id} className="flex items-start gap-2 text-sm">
                <Shield className="h-3.5 w-3.5 text-[var(--color-danger)] mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-[var(--color-text)] truncate">{l.message || l.action}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{l.userEmail || 'system'} · {new Date(l.timestamp || l.createdAt).toLocaleString()}</p>
                </div>
                <Badge variant={l.severity === 'critical' ? 'danger' : l.severity === 'warning' ? 'warning' : 'default'} className={SEVERITY_TONE[l.severity]}>
                  {l.severity}
                </Badge>
              </div>
            ))}
          </div>
        </Card>

        {/* Platform tools */}
        <Card>
          <CardHeader><CardTitle>Platform tools</CardTitle></CardHeader>
          <div className="p-4 grid sm:grid-cols-2 gap-3">
            {[
              { to: '/platform/groups', label: 'Manage Groups', desc: 'Create, suspend, grant Group Admins', icon: <Globe className="h-4 w-4" /> },
              { to: '/platform/companies', label: 'Manage Companies', desc: 'Companies across all Groups', icon: <Building2 className="h-4 w-4" /> },
              { to: '/platform/users', label: 'Manage Users', desc: 'Platform-wide user administration', icon: <UserCog className="h-4 w-4" /> },
              { to: '/platform/security', label: 'Platform Security', desc: 'security_logs, platform-wide', icon: <Shield className="h-4 w-4" /> },
              { to: '/platform/settings', label: 'Platform Settings', desc: 'Maintenance mode & messages', icon: <Zap className="h-4 w-4" /> },
            ].map((tool) => (
              <button key={tool.to} onClick={() => navigate(tool.to)} className="flex items-start gap-3 p-3 rounded-xl border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors text-left">
                <div className="p-2 rounded-lg bg-[var(--color-primary-light)] text-[var(--color-primary-text)] shrink-0">{tool.icon}</div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--color-text)]">{tool.label}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{tool.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </Card>
      </div>
    </PlatformShell>
  );
}
