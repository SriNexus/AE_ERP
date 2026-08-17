/**
 * WorkspaceDashboard — Universal workspace dashboard (Phase 0F)
 *
 * Sections:
 * - KPI Cards (6 compact metric cards)
 * - Recent Cases (from CaseEngine)
 * - Assigned Work / Recent Tasks (from useTasks)
 * - Activity Feed (from ActivityFeed component)
 * - Pending Approvals
 * - Escalated Tasks (from TaskEngine SLA)
 * - Upcoming Deadlines
 *
 * Requirements:
 * - Responsive (mobile-safe grid)
 * - Lazy loaded (can be code-split)
 * - Permission aware (actions hidden without access)
 * - Uses existing dashboard hooks and components
 */

import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Target, Users, ShoppingCart, Truck, Clock, AlertTriangle,
  CheckSquare, UserCheck, Calendar, ArrowRight, DollarSign,
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { usePermissions, type Module } from '../../lib/permissions';
import { KPIStatCard } from '../dashboard/KPIStatCard';
import { ActivityFeed } from '../dashboard/ActivityFeed';
import { useTasks } from '../../hooks/useTasks';
import { useDashboardOverview } from '../../hooks/useDashboardData';
import { useAppStore } from '../../store/useAppStore';
import { resolveWriteCompanyId } from '../../lib/firestore';
import type { CaseRecord, TaskRecord } from '../../types';

// ── Types ──────────────────────────────────────────────────

export interface WorkspaceDashboardProps {
  /** Optional company ID override. Defaults to active company. */
  companyId?: string;
  /** Additional class names */
  className?: string;
  /** Compact mode — smaller cards, tighter spacing */
  compact?: boolean;
}

// ── Constants ──────────────────────────────────────────────

// ── Helper: format relative time ───────────────────────────

function formatRelative(isoDate?: string): string {
  if (!isoDate) return '';
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(isoDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// ── Component ──────────────────────────────────────────────

export function WorkspaceDashboard({
  companyId: propCompanyId,
  className,
  compact = false,
}: WorkspaceDashboardProps) {
  const navigate = useNavigate();
  const perms = usePermissions();
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const companyId = propCompanyId || resolveWriteCompanyId();

  const { allTasks, loading: tasksLoading } = useTasks();
  const { data: dashboard, isLoading: dashboardLoading } = useDashboardOverview(companyId);

  // ── Compute KPIs ─────────────────────────────────────────
  const kpis = useMemo(() => {
    if (!dashboard) return [];
    const s = dashboard.stats;
    const summary = dashboard.summary;
    return [
      { label: 'Today Leads', value: s.todayLeads, icon: <Target className="h-5 w-5" />, color: 'indigo' as const },
      { label: 'Today Orders', value: s.todayOrders, icon: <ShoppingCart className="h-5 w-5" />, color: 'teal' as const },
      { label: 'Total Customers', value: summary.customers, icon: <Users className="h-5 w-5" />, color: 'blue' as const },
      { label: 'Revenue MTD', value: `₹${(s.totalRevenueMTD || 0).toLocaleString()}`, icon: <DollarSign className="h-5 w-5" />, color: 'emerald' as const },
      { label: 'Pending Dispatch', value: s.pendingDispatch, icon: <Truck className="h-5 w-5" />, color: 'amber' as const },
      { label: 'Pending Payments', value: s.pendingPayments, icon: <Clock className="h-5 w-5" />, color: 'purple' as const },
    ];
  }, [dashboard]);

  // ── Recent Tasks (top 5 incomplete, sorted by due date) ──
  const recentTasks = useMemo(() => {
    return (allTasks as any[])
      .filter((t: any) => t.status !== 'completed' && t.status !== 'cancelled')
      .sort((a: any, b: any) => {
        const aTime = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const bTime = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        return aTime - bTime;
      })
      .slice(0, 5);
  }, [allTasks]);

  // ── My Tasks (assigned to current user) ──────────────────
  const currentUserId = useAppStore((state) => state.user?.id);
  const assignedTasks = useMemo(() => {
    return (allTasks as any[])
      .filter((t: any) => t.assigneeId === currentUserId && t.status !== 'completed')
      .sort((a: any, b: any) => {
        const aPriority = { critical: 4, high: 3, medium: 2, low: 1 };
        return (aPriority[b.priority as keyof typeof aPriority] || 0) - (aPriority[a.priority as keyof typeof aPriority] || 0);
      })
      .slice(0, 5);
  }, [allTasks, currentUserId]);

  // ── Escalated Tasks ─────────────────────────────────────
  const escalatedTasks = useMemo(() => {
    return (allTasks as any[])
      .filter((t: any) => (t.escalationLevel || 0) > 0)
      .slice(0, 5);
  }, [allTasks]);

  // ── Upcoming Deadlines (tasks due within 7 days) ─────────
  const upcomingDeadlines = useMemo(() => {
    const sevenDaysFromNow = Date.now() + 7 * 24 * 60 * 60 * 1000;
    return (allTasks as any[])
      .filter((t: any) => {
        if (t.status === 'completed' || t.status === 'cancelled') return false;
        const due = t.dueDate ? new Date(t.dueDate).getTime() : null;
        return due && due <= sevenDaysFromNow && due >= Date.now();
      })
      .sort((a: any, b: any) => {
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      })
      .slice(0, 5);
  }, [allTasks]);

  // ── Activity Feed items ─────────────────────────────────
  const activityItems = useMemo(() => {
    if (!dashboard) return [];
    const items: any[] = [];
    (dashboard.recentLeads || []).forEach((lead: any) => {
      items.push({ _type: 'lead', id: lead.id, name: lead.name, status: lead.status, created_at: lead.createdAt });
    });
    (dashboard.recentOrders || []).forEach((order: any) => {
      items.push({ _type: 'order', id: order.id, name: order.customerName || order.id, status: order.status, total: order.total, created_at: order.createdAt });
    });
    return items.sort((a: any, b: any) => {
      const aTime = a.created_at?.toDate?.()?.getTime() || new Date(a.created_at).getTime() || 0;
      const bTime = b.created_at?.toDate?.()?.getTime() || new Date(b.created_at).getTime() || 0;
      return bTime - aTime;
    }).slice(0, 10);
  }, [dashboard]);

  // ── Section visibility ──────────────────────────────────
  const canViewTasks = perms.canView('tasks' as Module);

  // ── Loading state ───────────────────────────────────────
  if (dashboardLoading && !dashboard) {
    return (
      <div className={cn('grid gap-4 animate-pulse', className)}>
        {/* KPI skeleton */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 bg-[var(--color-bg-sunken)] rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="h-64 bg-[var(--color-bg-sunken)] rounded-xl lg:col-span-2" />
          <div className="h-64 bg-[var(--color-bg-sunken)] rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className={cn('space-y-6', className)}>
      {/* ── KPI Cards ───────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map((kpi, idx) => (
          <KPIStatCard
            key={kpi.label}
            label={kpi.label}
            value={kpi.value}
            icon={kpi.icon}
            color={kpi.color}
            loading={dashboardLoading}
            compact={compact}
          />
        ))}
      </div>

      {/* ── Main Grid ───────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ── Left column: Activity Feed (spans 2 cols on lg) ── */}
        <div className="lg:col-span-2">
          <ActivityFeed
            items={activityItems}
            loading={dashboardLoading}
          />
        </div>

        {/* ── Right column: Quick Actions / Stats ───────── */}
        <div className="space-y-4">
          {/* Recent / Assigned Tasks */}
          {canViewTasks && (
            <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
              <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-[var(--color-border-subtle)]">
                <div className="flex items-center gap-2">
                  <CheckSquare className="h-4 w-4 text-indigo-500" />
                  <h3 className="text-sm font-bold text-[var(--color-text)]">
                    {assignedTasks.length > 0 ? 'Assigned to Me' : 'Recent Tasks'}
                  </h3>
                </div>
                {assignedTasks.length > 0 && (
                  <span className="text-xs bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 font-bold px-2 py-0.5 rounded-full">
                    {assignedTasks.length}
                  </span>
                )}
              </div>
              <div className="p-2 divide-y divide-[var(--color-border-subtle)]">
                {(assignedTasks.length > 0 ? assignedTasks : recentTasks).map((task: any) => (
                  <button
                    key={task.id}
                    onClick={() => navigate('/tasks')}
                    className="flex items-center gap-3 px-2 py-2.5 w-full text-left hover:bg-[var(--color-surface-hover)] rounded-lg transition-colors group"
                  >
                    <div className={cn(
                      'h-2 w-2 rounded-full shrink-0',
                      task.priority === 'critical' ? 'bg-rose-400' :
                      task.priority === 'high' ? 'bg-amber-400' :
                      task.priority === 'medium' ? 'bg-blue-400' : 'bg-slate-400',
                    )} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-[var(--color-text)] truncate">
                        {task.title || task.name || '—'}
                      </p>
                      <p className="text-[10px] text-[var(--color-text-muted)] truncate">
                        {task.assigneeName || 'Unassigned'} · {task.dueDate ? formatRelative(task.dueDate) : 'No due date'}
                      </p>
                    </div>
                    {task.status && (
                      <span className="text-[10px] font-medium text-[var(--color-text-muted)] px-1.5 py-0.5 rounded bg-[var(--color-bg-sunken)]">
                        {task.status}
                      </span>
                    )}
                    <ArrowRight className="h-3 w-3 text-[var(--color-text-disabled)] shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
                {assignedTasks.length === 0 && recentTasks.length === 0 && (
                  <div className="flex items-center justify-center py-6 text-xs text-[var(--color-text-muted)]">
                    <UserCheck className="h-4 w-4 mr-1.5" />
                    No pending tasks
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Second Row: Escalated Tasks + Upcoming Deadlines + Pending Approvals ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Escalated Tasks */}
        {canViewTasks && escalatedTasks.length > 0 && (
          <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
            <div className="flex items-center gap-2 px-4 pt-4 pb-3 border-b border-[var(--color-border-subtle)]">
              <AlertTriangle className="h-4 w-4 text-rose-500" />
              <h3 className="text-sm font-bold text-[var(--color-text)]">Escalated Tasks</h3>
            </div>
            <div className="p-2 divide-y divide-[var(--color-border-subtle)]">
              {escalatedTasks.map((task: any) => (
                <button
                  key={task.id}
                  onClick={() => navigate('/tasks')}
                  className="flex items-center gap-3 px-2 py-2 w-full text-left hover:bg-[var(--color-surface-hover)] rounded-lg transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[var(--color-text)] truncate">
                      {task.title || task.name || '—'}
                    </p>
                    <p className="text-[10px] text-rose-500">
                      Level {task.escalationLevel} escalation
                    </p>
                  </div>
                  <ArrowRight className="h-3 w-3 text-[var(--color-text-disabled)] shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Upcoming Deadlines */}
        {canViewTasks && upcomingDeadlines.length > 0 && (
          <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
            <div className="flex items-center gap-2 px-4 pt-4 pb-3 border-b border-[var(--color-border-subtle)]">
              <Calendar className="h-4 w-4 text-amber-500" />
              <h3 className="text-sm font-bold text-[var(--color-text)]">Due This Week</h3>
            </div>
            <div className="p-2 divide-y divide-[var(--color-border-subtle)]">
              {upcomingDeadlines.map((task: any) => (
                <button
                  key={task.id}
                  onClick={() => navigate('/tasks')}
                  className="flex items-center gap-3 px-2 py-2 w-full text-left hover:bg-[var(--color-surface-hover)] rounded-lg transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[var(--color-text)] truncate">
                      {task.title || task.name || '—'}
                    </p>
                    <p className="text-[10px] text-[var(--color-text-muted)]">
                      Due {task.dueDate ? formatRelative(task.dueDate) : '—'}
                    </p>
                  </div>
                  <span className={cn(
                    'text-[10px] font-medium px-1.5 py-0.5 rounded',
                    task.priority === 'critical' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' :
                    task.priority === 'high' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' :
                    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
                  )}>
                    {task.priority}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Pending Approvals */}
        <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
          <div className="flex items-center gap-2 px-4 pt-4 pb-3 border-b border-[var(--color-border-subtle)]">
            <UserCheck className="h-4 w-4 text-purple-500" />
            <h3 className="text-sm font-bold text-[var(--color-text)]">Pending Approvals</h3>
          </div>
          <div className="flex items-center justify-center py-8 text-xs text-[var(--color-text-muted)]">
            <Clock className="h-5 w-5 mr-2 opacity-50" />
            Approval module integration pending
          </div>
        </div>
      </div>
    </div>
  );
}

export default WorkspaceDashboard;
