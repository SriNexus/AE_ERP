/**
 * MobileAuditWorkspace — Mobile Audit Logs Workspace (Phase 9E)
 *
 * Uses same Desktop data sources.
 * ZERO business logic — only UI layout.
 * Super Admin only.
 */

import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Shield, Search, X, Clock, AlertTriangle, Eye, Loader2, ChevronRight } from 'lucide-react';
import { getAll } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { useAppStore } from '../../../store/useAppStore';
import { isOwnerEmail } from '../../../lib/ownerAccess';
import { cn } from '../../../utils/cn';
import type { AuditLogEntry } from '../../../lib/auditLogger';

const ACTION_COLORS: Record<string, string> = {
  create: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  update: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  delete: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  login: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  security_event: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  unauthorized_access: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  failure: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  ai_query: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
};

export function MobileAuditWorkspace() {
  const navigate = useNavigate();
  const currentUser = useAppStore((s) => s.user);
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [selectedEntry, setSelectedEntry] = useState<AuditLogEntry | null>(null);

  // Guard: Super Admin only
  if (!isOwnerEmail(currentUser?.email)) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <Shield className="h-12 w-12 text-[var(--color-text-muted)] mb-4 opacity-50" />
        <p className="text-sm font-medium text-[var(--color-text-muted)]">Audit Logs are restricted</p>
        <p className="text-xs text-[var(--color-text-muted)] mt-1 opacity-60">Contact your system administrator</p>
      </div>
    );
  }

  const { data: logs, isLoading } = useQuery({
    queryKey: ['audit-logs-mobile', activeCompanyId],
    queryFn: () => getAll<any>(COLLECTIONS.AUDIT_LOGS),
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    if (!logs) return [];
    const q = searchQuery.toLowerCase().trim();
    return logs
      .filter((l: any) => !l.isDeleted)
      .filter((l: any) => {
        if (q && !(l.message || '').toLowerCase().includes(q) && !(l.userEmail || '').toLowerCase().includes(q)) return false;
        if (actionFilter !== 'all' && l.action !== actionFilter) return false;
        return true;
      })
      .slice(0, 50)
      .sort((a: any, b: any) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
      .map((l: any) => ({
        id: l.id, timestamp: l.timestamp || l.createdAt || '',
        userEmail: l.userEmail || '', userRole: l.userRole || '',
        action: l.action || 'unknown', message: l.message || '',
        entityType: l.entityType, entityId: l.entityId,
        module: l.module, severity: l.severity || 'info',
        device: l.device, browser: l.browser,
      } as AuditLogEntry));
  }, [logs, searchQuery, actionFilter]);

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg)]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
        <Shield className="h-5 w-5 text-indigo-500" />
        <span className="text-base font-bold text-[var(--color-text)]">Audit Logs</span>
        <button onClick={() => navigate(-1)} className="ml-auto text-sm text-[var(--color-primary)]">Close</button>
      </div>

      {/* Search + Filter */}
      <div className="px-3 py-2 space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-muted)]" />
          <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search audit logs..."
            className="w-full bg-[var(--color-bg-sunken)] border border-[var(--color-border)] rounded-xl pl-9 pr-3 py-2.5 text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)]"
          />
          {searchQuery && <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="h-4 w-4 text-[var(--color-text-muted)]" /></button>}
        </div>
        <div className="flex gap-1 overflow-x-auto [scrollbar-width:none]">
          <button onClick={() => setActionFilter('all')} className={`shrink-0 px-2.5 py-1 text-xs font-semibold rounded-lg ${actionFilter === 'all' ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]'}`}>All</button>
          {['create', 'update', 'delete', 'login', 'failure', 'security_event'].map(a => (
            <button key={a} onClick={() => setActionFilter(a)} className={`shrink-0 px-2.5 py-1 text-xs font-semibold rounded-lg ${actionFilter === a ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]'}`}>{a.replace(/_/g, ' ')}</button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="flex gap-2 px-3 pb-2">
        <span className="text-xs text-[var(--color-text-muted)]">{logs?.length || 0} total logs</span>
        <span className="text-xs text-[var(--color-text-muted)]">·</span>
        <span className="text-xs text-[var(--color-text-muted)]">{filtered.length} shown</span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-2">
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-[var(--color-text-muted)]" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 text-sm text-[var(--color-text-muted)]">No audit logs found</div>
        ) : filtered.map((entry) => (
          <button key={entry.id} onClick={() => setSelectedEntry(entry)}
            className="w-full bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-3 text-left hover:bg-[var(--color-surface-hover)] transition-colors">
            <div className="flex items-center justify-between mb-1">
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${ACTION_COLORS[entry.action] || 'bg-gray-100 text-gray-700'}`}>
                {entry.action.replace(/_/g, ' ')}
              </span>
              <span className="text-[10px] text-[var(--color-text-muted)] font-mono">
                {new Date(entry.timestamp).toLocaleString()}
              </span>
            </div>
            <p className="text-xs text-[var(--color-text)] line-clamp-2 mb-1">{entry.message}</p>
            <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
              <span>{entry.userEmail}</span>
              {entry.module && <><span>·</span><span>{entry.module}</span></>}
            </div>
          </button>
        ))}
      </div>

      {/* Detail Modal */}
      {selectedEntry && (
        <>
          <div className="fixed inset-0 bg-black/40 z-50" onClick={() => setSelectedEntry(null)} />
          <div className="fixed inset-x-0 bottom-0 z-50 bg-[var(--color-surface)] rounded-t-2xl border-t border-[var(--color-border)] max-h-[70vh] overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-subtle)]">
              <span className="text-sm font-bold text-[var(--color-text)]">Audit Details</span>
              <button onClick={() => setSelectedEntry(null)} className="p-1 rounded-lg hover:bg-[var(--color-surface-hover)]"><X className="h-4 w-4" /></button>
            </div>
            <div className="px-4 py-3 space-y-2 text-xs">
              <DetailRow label="Action" value={selectedEntry.action} />
              <DetailRow label="Message" value={selectedEntry.message} />
              <DetailRow label="User" value={`${selectedEntry.userEmail} (${selectedEntry.userRole})`} />
              <DetailRow label="Timestamp" value={new Date(selectedEntry.timestamp).toLocaleString()} />
              <DetailRow label="Entity" value={selectedEntry.entityType ? `${selectedEntry.entityType} · ${selectedEntry.entityId}` : '—'} />
              <DetailRow label="Module" value={selectedEntry.module || '—'} />
              <DetailRow label="Severity" value={selectedEntry.severity} />
              <DetailRow label="Device" value={selectedEntry.device ? `${selectedEntry.device} · ${selectedEntry.browser}` : '—'} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="font-semibold text-[var(--color-text-muted)] w-20 shrink-0">{label}</span>
      <span className="text-[var(--color-text)]">{value}</span>
    </div>
  );
}

export default MobileAuditWorkspace;
