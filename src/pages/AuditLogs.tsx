/**
 * AuditLogs — Desktop Audit Logs Page (Phase 9E)
 *
 * Route: /audit-logs
 * Access: Super Admin only (shreeniwas.tripathi0@gmail.com)
 *
 * Features:
 *   - WorkspaceShell compliance
 *   - KPI cards (Total, Today, Security Events, Failures)
 *   - Search across audit entries
 *   - Filters (date range, user, module, action)
 *   - Export CSV
 *   - Pagination
 *   - Row details modal
 *   - Timeline view
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAll } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';
import { cn } from '../utils/cn';
import {
  Search, Filter, X, Download, ChevronLeft, ChevronRight,
  Clock, Shield, AlertTriangle, Activity, Users,
  Loader2, Eye, Calendar, SlidersHorizontal, FileDown,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { isOwnerEmail } from '../lib/ownerAccess';
import type { AuditLogEntry } from '../lib/auditLogger';
import { logExport } from '../lib/auditLogger';

// ── KPI Card ────────────────────────────────────────────

function KpiCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4">
      <div className="flex items-center gap-2 mb-2">{icon}<span className="text-xs text-[var(--color-text-muted)]">{label}</span></div>
      <p className={`text-2xl font-bold text-${color}-600 dark:text-${color}-400 tabular-nums`}>{value.toLocaleString()}</p>
    </div>
  );
}

// ── Action Badge ─────────────────────────────────────────

function ActionBadge({ action }: { action: string }) {
  const colors: Record<string, string> = {
    create: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    update: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    delete: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    login: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
    logout: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
    security_event: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    unauthorized_access: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    failure: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    ai_query: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    export: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    search: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${colors[action] || 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'}`}>
      {action.replace(/_/g, ' ')}
    </span>
  );
}

// ── Severity Dot ─────────────────────────────────────────

function SeverityDot({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    critical: 'bg-red-500', danger: 'bg-orange-500',
    warning: 'bg-amber-500', success: 'bg-emerald-500',
    info: 'bg-blue-500',
  };
  return <span className={`inline-block h-2 w-2 rounded-full ${colors[severity] || 'bg-gray-400'}`} />;
}

// ── Detail Modal ─────────────────────────────────────────

function AuditDetailModal({ entry, onClose }: { entry: AuditLogEntry | null; onClose: () => void }) {
  if (!entry) return null;
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-xl max-w-lg w-full max-h-[80vh] overflow-y-auto">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border-subtle)]">
            <h3 className="text-sm font-bold text-[var(--color-text)]">Audit Log Detail</h3>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-[var(--color-surface-hover)]"><X className="h-4 w-4" /></button>
          </div>
          <div className="px-5 py-4 space-y-3 text-sm">
            <Row label="Action"><ActionBadge action={entry.action} /></Row>
            <Row label="Message">{entry.message}</Row>
            <Row label="User">{entry.userEmail} ({entry.userRole})</Row>
            <Row label="Entity">{entry.entityType} · {entry.entityId}</Row>
            <Row label="Module">{entry.module || '—'}</Row>
            <Row label="Route">{entry.route || '—'}</Row>
            <Row label="Timestamp">{new Date(entry.timestamp).toLocaleString()}</Row>
            <Row label="Severity"><SeverityDot severity={entry.severity} /> {entry.severity}</Row>
            <Row label="Device">{entry.device} · {entry.browser} · {entry.os}</Row>
            {entry.oldValues && <Row label="Old Values"><pre className="text-xs max-h-32 overflow-auto">{JSON.stringify(entry.oldValues, null, 2)}</pre></Row>}
            {entry.newValues && <Row label="New Values"><pre className="text-xs max-h-32 overflow-auto">{JSON.stringify(entry.newValues, null, 2)}</pre></Row>}
            {entry.metadata && Object.keys(entry.metadata).length > 0 && (
              <Row label="Metadata"><pre className="text-xs max-h-32 overflow-auto">{JSON.stringify(entry.metadata, null, 2)}</pre></Row>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="text-xs font-semibold text-[var(--color-text-muted)] w-24 shrink-0">{label}</span>
      <span className="text-[var(--color-text)] break-all">{children}</span>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────

const ACTIONS = ['create', 'update', 'delete', 'login', 'logout', 'export', 'search', 'ai_query', 'failure', 'security_event', 'unauthorized_access', 'permission_change', 'role_change', 'notification_send'];
const MODULES = ['leads', 'customers', 'orders', 'quotations', 'invoices', 'payments', 'dispatch', 'products', 'stock', 'warehouses', 'vendors', 'purchase_orders', 'projects', 'surveys', 'engineering', 'installations', 'qc', 'commissioning', 'net_metering', 'subsidy', 'handovers', 'amc', 'service_tickets', 'monitoring', 'partners', 'settlements', 'cases', 'tasks', 'employees', 'users', 'roles', 'security', 'ai', 'notifications', 'search', 'settings'];

const PER_PAGE = 25;

export default function AuditLogs() {
  const navigate = useNavigate();
  const currentUser = useAppStore((s) => s.user);
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);

  // Guard: Super Admin only
  if (!isOwnerEmail(currentUser?.email)) {
    navigate('/', { replace: true });
    return null;
  }

  // Read ?filter= query param (supports security_logs route)
  const [searchParams] = useSearchParams();
  const urlFilter = searchParams.get('filter');

  // Search & filters
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState(urlFilter === 'security' ? 'security_event' : 'all');
  const [moduleFilter, setModuleFilter] = useState(urlFilter === 'security' ? 'security' : 'all');
  const [severityFilter, setSeverityFilter] = useState(urlFilter === 'security' ? 'critical' : 'all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(0);
  const [selectedEntry, setSelectedEntry] = useState<AuditLogEntry | null>(null);

  // Fetch audit logs
  const { data: logs, isLoading } = useQuery({
    queryKey: ['audit-logs', activeCompanyId],
    queryFn: () => getAll<any>(COLLECTIONS.AUDIT_LOGS),
    staleTime: 30_000,
  });

  // Filter and sort
  const filtered = useMemo(() => {
    if (!logs) return [];

    const q = searchQuery.toLowerCase().trim();
    const now = dateTo ? new Date(dateTo + 'T23:59:59') : new Date();
    const from = dateFrom ? new Date(dateFrom + 'T00:00:00') : new Date(0);

    let results = logs
      .filter((l: any) => !l.isDeleted)
      .map((l: any) => ({
        id: l.id,
        timestamp: l.timestamp || l.createdAt || '',
        userId: l.userId || '',
        userEmail: l.userEmail || '',
        userRole: l.userRole || '',
        companyId: l.companyId || '',
        action: l.action || 'unknown',
        entityType: l.entityType,
        entityId: l.entityId,
        module: l.module,
        oldValues: l.oldValues,
        newValues: l.newValues,
        route: l.route,
        device: l.device,
        browser: l.browser,
        os: l.os,
        source: l.source,
        status: l.status || 'success',
        severity: l.severity || 'info',
        message: l.message || '',
        metadata: l.metadata || {},
      } as AuditLogEntry))
      .filter((l: AuditLogEntry) => {
        if (q && !l.message.toLowerCase().includes(q) && !l.userEmail.toLowerCase().includes(q) && !(l.entityId || '').toLowerCase().includes(q)) return false;
        if (actionFilter !== 'all' && l.action !== actionFilter) return false;
        if (moduleFilter !== 'all' && l.module !== moduleFilter) return false;
        if (severityFilter !== 'all' && l.severity !== severityFilter) return false;
        if (l.timestamp && new Date(l.timestamp) < from) return false;
        if (l.timestamp && new Date(l.timestamp) > now) return false;
        return true;
      })
      .sort((a: AuditLogEntry, b: AuditLogEntry) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return results;
  }, [logs, searchQuery, actionFilter, moduleFilter, severityFilter, dateFrom, dateTo]);

  const totalCount = logs?.length || 0;
  const todayCount = logs?.filter((l: any) => {
    if (!l.timestamp) return false;
    const today = new Date();
    const logDate = new Date(l.timestamp);
    return logDate.toDateString() === today.toDateString();
  }).length || 0;
  const securityCount = logs?.filter((l: any) => l.severity === 'critical' || l.action === 'security_event' || l.action === 'unauthorized_access').length || 0;
  const failureCount = logs?.filter((l: any) => l.status === 'failure' || l.severity === 'danger').length || 0;

  const pageCount = Math.ceil(filtered.length / PER_PAGE);
  const pageItems = filtered.slice(page * PER_PAGE, (page + 1) * PER_PAGE);

  const handleExportCsv = () => {
    const header = 'Timestamp,User Email,User Role,Action,Entity Type,Entity ID,Module,Severity,Status,Message,Device,Browser,OS';
    const rows = filtered.map((l: AuditLogEntry) =>
      `"${l.timestamp}","${l.userEmail}","${l.userRole}","${l.action}","${l.entityType || ''}","${l.entityId || ''}","${l.module || ''}","${l.severity}","${l.status}","${(l.message || '').replace(/"/g, '""')}","${l.device || ''}","${l.browser || ''}","${l.os || ''}"`
    ).join('\n');
    const blob = new Blob([`${header}\n${rows}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    void logExport('audit-logs', 'CSV', filtered.length);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[var(--color-text)] flex items-center gap-2">
            <Shield className="h-5 w-5 text-indigo-500" /> Audit Logs
          </h1>
          <p className="text-xs text-[var(--color-text-muted)]">Complete activity trail — Super Admin only</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExportCsv} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors">
            <FileDown className="h-3.5 w-3.5" /> Export CSV
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard icon={<Activity className="h-4 w-4 text-blue-500" />} label="Total Logs" value={totalCount} color="blue" />
        <KpiCard icon={<Calendar className="h-4 w-4 text-emerald-500" />} label="Today" value={todayCount} color="emerald" />
        <KpiCard icon={<Shield className="h-4 w-4 text-red-500" />} label="Security Events" value={securityCount} color="red" />
        <KpiCard icon={<AlertTriangle className="h-4 w-4 text-orange-500" />} label="Failures" value={failureCount} color="orange" />
      </div>

      {/* Filters */}
      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4">
        <div className="flex flex-wrap gap-3 items-end">
          {/* Search */}
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs font-semibold text-[var(--color-text-muted)] mb-1 block">Search</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-text-muted)]" />
              <input value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setPage(0); }}
                placeholder="Search messages, emails, IDs..."
                className="w-full bg-[var(--color-bg-sunken)] border border-[var(--color-border)] rounded-lg pl-8 pr-3 py-2 text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)]"
              />
            </div>
          </div>

          {/* Action filter */}
          <div>
            <label className="text-xs font-semibold text-[var(--color-text-muted)] mb-1 block">Action</label>
            <select value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(0); }}
              className="bg-[var(--color-bg-sunken)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]">
              <option value="all">All Actions</option>
              {ACTIONS.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
            </select>
          </div>

          {/* Module filter */}
          <div>
            <label className="text-xs font-semibold text-[var(--color-text-muted)] mb-1 block">Module</label>
            <select value={moduleFilter} onChange={(e) => { setModuleFilter(e.target.value); setPage(0); }}
              className="bg-[var(--color-bg-sunken)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]">
              <option value="all">All Modules</option>
              {MODULES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          {/* Severity filter */}
          <div>
            <label className="text-xs font-semibold text-[var(--color-text-muted)] mb-1 block">Severity</label>
            <select value={severityFilter} onChange={(e) => { setSeverityFilter(e.target.value); setPage(0); }}
              className="bg-[var(--color-bg-sunken)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]">
              <option value="all">All Severities</option>
              <option value="critical">Critical</option>
              <option value="danger">Danger</option>
              <option value="warning">Warning</option>
              <option value="success">Success</option>
              <option value="info">Info</option>
            </select>
          </div>

          {/* Date range */}
          <div>
            <label className="text-xs font-semibold text-[var(--color-text-muted)] mb-1 block">From</label>
            <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0); }}
              className="bg-[var(--color-bg-sunken)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]" />
          </div>
          <div>
            <label className="text-xs font-semibold text-[var(--color-text-muted)] mb-1 block">To</label>
            <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0); }}
              className="bg-[var(--color-bg-sunken)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]" />
          </div>
        </div>
      </div>

      {/* Results table */}
      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border-subtle)] flex items-center justify-between">
          <p className="text-xs text-[var(--color-text-muted)]">{filtered.length} results {searchQuery || actionFilter !== 'all' || moduleFilter !== 'all' ? '(filtered)' : ''}</p>
          {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--color-text-muted)]" />}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--color-text-muted)] border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)]">
                <th className="py-2.5 px-4 font-semibold text-xs">Timestamp</th>
                <th className="py-2.5 px-4 font-semibold text-xs">Action</th>
                <th className="py-2.5 px-4 font-semibold text-xs">User</th>
                <th className="py-2.5 px-4 font-semibold text-xs">Module</th>
                <th className="py-2.5 px-4 font-semibold text-xs">Entity</th>
                <th className="py-2.5 px-4 font-semibold text-xs">Severity</th>
                <th className="py-2.5 px-4 font-semibold text-xs">Message</th>
                <th className="py-2.5 px-4 font-semibold text-xs w-10"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} className="py-12 text-center text-sm text-[var(--color-text-muted)]">Loading audit logs...</td></tr>
              ) : pageItems.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-sm text-[var(--color-text-muted)]">No audit logs found</td></tr>
              ) : pageItems.map((entry) => (
                <tr key={entry.id} className="border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-hover)]">
                  <td className="py-2.5 px-4 text-xs text-[var(--color-text-muted)] whitespace-nowrap font-mono">
                    {new Date(entry.timestamp).toLocaleString()}
                  </td>
                  <td className="py-2.5 px-4"><ActionBadge action={entry.action} /></td>
                  <td className="py-2.5 px-4 text-xs text-[var(--color-text-secondary)]">{entry.userEmail}</td>
                  <td className="py-2.5 px-4 text-xs text-[var(--color-text-secondary)]">{entry.module || '—'}</td>
                  <td className="py-2.5 px-4 text-xs text-[var(--color-text-secondary)] truncate max-w-[120px]">{entry.entityType ? `${entry.entityType}·${(entry.entityId || '').slice(0, 20)}` : '—'}</td>
                  <td className="py-2.5 px-4"><SeverityDot severity={entry.severity} /></td>
                  <td className="py-2.5 px-4 text-xs text-[var(--color-text)] truncate max-w-[200px]">{entry.message}</td>
                  <td className="py-2.5 px-4">
                    <button onClick={() => setSelectedEntry(entry)} className="p-1 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]">
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pageCount > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--color-border-subtle)]">
            <p className="text-xs text-[var(--color-text-muted)]">Page {page + 1} of {pageCount}</p>
            <div className="flex gap-1">
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
                className="p-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] disabled:opacity-40">
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button disabled={page >= pageCount - 1} onClick={() => setPage(p => p + 1)}
                className="p-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] disabled:opacity-40">
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail modal */}
      <AuditDetailModal entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
    </div>
  );
}
