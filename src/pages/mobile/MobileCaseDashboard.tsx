/**
 * MobileCaseDashboard — Mobile Case Dashboard
 *
 * Phase 3M — Mobile Support
 * Route: /cases (mobile)
 *
 * Features:
 *   - KPI cards (Total, Active, Completed, Failed, Healthy, Warning)
 *   - Health summary with colored indicators
 *   - Current stage summary with progress
 *   - Recent cases list
 *   - Pull-to-refresh, sticky headers, touch gestures
 */

import { useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getAll } from '../../lib/firestore';
import { COLLECTIONS } from '../../lib/firebase';
import { useAppStore } from '../../store/useAppStore';
import { queryKeys } from '../../lib/queryKeys';
import { cn } from '../../utils/cn';
import {
  FolderKanban, Activity, CheckCircle2, AlertTriangle, XCircle,
  Clock, ChevronRight, RefreshCw, Search, TrendingUp,
} from 'lucide-react';
import { KPIStatCard } from '../../components/dashboard/KPIStatCard';
import { Button } from '../../components/ui/Button';
import { generateCaseHealthReport } from '../../engines/CaseValidationEngine';
import { TOUCH } from '../../components/mobile/shared/styles';

// ── Helpers ────────────────────────────────────────────────

function fmtDateSafe(value: unknown): string {
  if (!value) return '—';
  return new Date(String(value)).toLocaleDateString();
}

function daysSince(value: unknown): number {
  if (!value) return Infinity;
  const d = new Date(String(value));
  if (isNaN(d.getTime())) return Infinity;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

// ── Component ──────────────────────────────────────────────

export default function MobileCaseDashboard() {
  const navigate = useNavigate();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const qkeys = queryKeys.forCompany(activeCompanyId);
  const [refreshing, setRefreshing] = useState(false);
  const [healthReport, setHealthReport] = useState<any>(null);

  // ── Data ─────────────────────────────────────────────────
  const casesQ = useQuery({
    queryKey: ['mobile-cases', activeCompanyId],
    queryFn: () => getAll<any>(COLLECTIONS.CASES),
    staleTime: 30_000,
  });
  const allCases = (casesQ.data as any[]) || [];
  const isLoading = casesQ.isLoading;

  // ── Pull to refresh ──────────────────────────────────────
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await casesQ.refetch();
    } finally {
      setRefreshing(false);
    }
  }, [casesQ]);

  // ── Health report ─────────────────────────────────────────
  const loadHealth = useCallback(async () => {
    try {
      const report = await generateCaseHealthReport();
      setHealthReport(report);
    } catch { /* ignore */ }
  }, []);

  // ── KPIs ─────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const active = allCases.filter((c: any) => c.status === 'Active' && !c.isDeleted);
    const completed = allCases.filter((c: any) => c.status === 'Completed' && !c.isDeleted);
    const failed = allCases.filter((c: any) => c.status === 'Failed' && !c.isDeleted);
    const total = allCases.filter((c: any) => !c.isDeleted);
    return {
      total: total.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      healthy: healthReport?.healthyCases ?? 0,
      warning: healthReport?.brokenCases ?? 0,
    };
  }, [allCases, healthReport]);

  // ── Stage summary ────────────────────────────────────────
  const stageSummary = useMemo(() => {
    const counts = new Map<string, number>();
    allCases.filter((c: any) => !c.isDeleted && c.currentStage).forEach((c: any) => {
      const stage = String(c.currentStage || 'New');
      counts.set(stage, (counts.get(stage) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
  }, [allCases]);

  // ── Recent cases ─────────────────────────────────────────
  const recentCases = useMemo(() => {
    return [...allCases.filter((c: any) => !c.isDeleted)]
      .sort((a: any, b: any) => {
        const aDate = a.createdAt ? new Date(String(a.createdAt)).getTime() : 0;
        const bDate = b.createdAt ? new Date(String(b.createdAt)).getTime() : 0;
        return bDate - aDate;
      })
      .slice(0, 8);
  }, [allCases]);

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="flex flex-col min-h-screen bg-[var(--color-bg)]">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-[var(--color-bg)]/90 backdrop-blur-lg border-b border-[var(--color-border-subtle)]">
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-lg font-bold text-[var(--color-text)]">Cases</h1>
            <p className="text-xs text-[var(--color-text-muted)]">{kpis.total} total cases</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRefresh}
              className={cn(TOUCH.MIN, 'p-2 rounded-lg', refreshing ? 'animate-spin' : '')}
            >
              <RefreshCw className="h-5 w-5 text-[var(--color-text-muted)]" />
            </button>
            <button
              type="button"
              onClick={() => navigate('/cases/search')}
              className={cn(TOUCH.MIN, 'p-2 rounded-lg')}
            >
              <Search className="h-5 w-5 text-[var(--color-text-muted)]" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {isLoading ? (
          <div className="space-y-3 mt-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-16 bg-[var(--color-bg-sunken)] rounded-xl animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-5 mt-4">
            {/* KPI Cards */}
            <div className="grid grid-cols-3 gap-2">
              <KPIStatCard label="Total" value={kpis.total} icon={<FolderKanban className="h-4 w-4" />} color="indigo" compact />
              <KPIStatCard label="Active" value={kpis.active} icon={<Activity className="h-4 w-4" />} color="blue" compact />
              <KPIStatCard label="Completed" value={kpis.completed} icon={<CheckCircle2 className="h-4 w-4" />} color="emerald" compact />
              <KPIStatCard label="Failed" value={kpis.failed} icon={<XCircle className="h-4 w-4" />} color="rose" compact />
              <KPIStatCard label="Healthy" value={kpis.healthy} icon={<TrendingUp className="h-4 w-4" />} color="emerald" compact />
              <KPIStatCard label="Warning" value={kpis.warning} icon={<AlertTriangle className="h-4 w-4" />} color="amber" compact />
            </div>

            {/* Health Report Button */}
            <button
              type="button"
              onClick={loadHealth}
              className={cn(
                'w-full flex items-center gap-3 rounded-xl border border-[var(--color-border-subtle)]',
                'px-4 py-3 text-left active:scale-[0.98] transition-transform',
              )}
            >
              <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/20">
                <Activity className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--color-text)]">Health Report</p>
                <p className="text-xs text-[var(--color-text-muted)]">Run case health validation</p>
              </div>
              <ChevronRight className="h-4 w-4 text-[var(--color-text-muted)]" />
            </button>

            {/* Stage Summary */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">
                Current Stages
              </h3>
              <div className="space-y-1.5">
                {stageSummary.map(([stage, count]) => {
                  const maxCount = stageSummary[0]?.[1] || 1;
                  return (
                    <div key={stage} className="flex items-center gap-2">
                      <span className="text-xs text-[var(--color-text-secondary)] w-24 truncate">{stage}</span>
                      <div className="flex-1 bg-[var(--color-bg-sunken)] rounded-full h-3 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-indigo-500"
                          style={{ width: `${Math.max((count / maxCount) * 100, 2)}%` }}
                        />
                      </div>
                      <span className="text-xs font-bold text-[var(--color-text-secondary)] w-6 text-right">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Recent Cases */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Recent Cases</h3>
                <button
                  type="button"
                  onClick={() => navigate('/cases')}
                  className="text-xs text-[var(--color-primary)] font-semibold"
                >
                  See All
                </button>
              </div>
              <div className="space-y-2">
                {recentCases.map((c: any) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => navigate(`/cases/${encodeURIComponent(c.id)}`)}
                    className={cn(
                      'w-full flex items-center gap-3 rounded-xl border border-[var(--color-border-subtle)]',
                      'px-3 py-2.5 text-left active:scale-[0.98] transition-transform',
                    )}
                  >
                    <div className={cn(
                      'h-8 w-8 rounded-lg flex items-center justify-center',
                      c.status === 'Completed' ? 'bg-emerald-50 dark:bg-emerald-900/20' :
                      c.status === 'Failed' ? 'bg-red-50 dark:bg-red-900/20' :
                      'bg-indigo-50 dark:bg-indigo-900/20',
                    )}>
                      <FolderKanban className={cn(
                        'h-4 w-4',
                        c.status === 'Completed' ? 'text-emerald-600' :
                        c.status === 'Failed' ? 'text-red-600' :
                        'text-indigo-600',
                      )} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[var(--color-text)] truncate">{c.caseId || c.id}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{c.currentStage || 'New'}</p>
                    </div>
                    <span className="text-[10px] text-[var(--color-text-disabled)] shrink-0">
                      {fmtDateSafe(c.createdAt)}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 text-[var(--color-text-muted)] shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
