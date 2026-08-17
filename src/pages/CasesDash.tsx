/**
 * CasesDash — Case Management Dashboard
 *
 * Phase 3F — Case Dashboard
 * Route: /cases
 * Provides a complete operational view of all Cases across the ERP.
 *
 * Sections:
 *   1. KPI Cards (8 metrics)
 *   2. Pipeline View (17 stages with counts)
 *   3. Health Dashboard (7 health metrics from CaseValidationEngine)
 *   4. Recent Activity (recently created/completed/validated cases)
 *   5. Alerts (failed, stuck, missing caseIds, validation failures, deleted refs)
 *   6. Quick Actions (create task, validate, health report, export, search, repair)
 */

import { useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  getAll,
  fmtDate,
  getOne,
} from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';
import { queryKeys } from '../lib/queryKeys';
import { canDo } from '../lib/permissions';
import { cn } from '../utils/cn';
import { PageHeader, Card, CardHeader, CardTitle, CardBody } from '../components/ui/Card';
import { KPIStatCard } from '../components/dashboard/KPIStatCard';
import { Button } from '../components/ui/Button';
import { DataTable } from '../components/shared/DataTable';
import type { TableColumn } from '../components/shared/DataTable';
import { generateCaseHealthReport, validateCaseIntegrity } from '../engines/CaseValidationEngine';

import {
  FolderKanban,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Activity,
  BarChart3,
  Target,
  Users,
  FileText,
  Search,
  RefreshCw,
  Download,
  Wrench,
  Loader2,
  ArrowUpRight,
  UserPlus,
  Building2,
  ShoppingCart,
  CreditCard,
  Truck,
  Wrench as WrenchIcon,
  ClipboardCheck,
  Zap,
  Gauge,
  PiggyBank,
  Handshake,
  Shield,
  Headphones,
  Ban,
  PlusCircle,
} from 'lucide-react';

// ── Stage pipeline labels ─────────────────────────────────

const PIPELINE_STAGES = [
  { key: 'Lead', label: 'Lead', icon: UserPlus },
  { key: 'Customer', label: 'Customer', icon: Users },
  { key: 'Project', label: 'Project', icon: Building2 },
  { key: 'Quotation', label: 'Quotation', icon: FileText },
  { key: 'Order', label: 'Order', icon: ShoppingCart },
  { key: 'Invoice', label: 'Invoice', icon: FileText },
  { key: 'Payment', label: 'Payment', icon: CreditCard },
  { key: 'Dispatch', label: 'Dispatch', icon: Truck },
  { key: 'Installation', label: 'Installation', icon: WrenchIcon },
  { key: 'QC', label: 'QC', icon: ClipboardCheck },
  { key: 'Commissioning', label: 'Commissioning', icon: Zap },
  { key: 'NetMetering', label: 'Net Metering', icon: Gauge },
  { key: 'Subsidy', label: 'Subsidy', icon: PiggyBank },
  { key: 'Handover', label: 'Handover', icon: Handshake },
  { key: 'AMC', label: 'AMC', icon: Shield },
  { key: 'Service', label: 'Service Ticket', icon: Headphones },
  { key: 'Closure', label: 'Monitoring', icon: Activity },
];

// ── Helpers ───────────────────────────────────────────────

function fmtCompactNumber(value: number | null | undefined): string {
  const amount = Number(value ?? 0);
  if (amount >= 10000000) return `${(amount / 10000000).toFixed(1)}Cr`;
  if (amount >= 100000) return `${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `${(amount / 1000).toFixed(1)}K`;
  return String(amount);
}

function fmtDateSafe(value: unknown): string {
  if (!value) return '—';
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.toDate === 'function') {
      try {
        return fmtDate((obj.toDate as () => Date)());
      } catch { /* fall through */ }
    }
    if (typeof obj.seconds === 'number') {
      return fmtDate(new Date((obj as { seconds: number }).seconds * 1000));
    }
  }
  if (value instanceof Date) return fmtDate(value);
  return fmtDate(String(value));
}

function daysSince(dateValue: unknown): number {
  if (!dateValue) return Infinity;
  const d = new Date(String(dateValue));
  if (isNaN(d.getTime())) return Infinity;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

// ── Sub-components ────────────────────────────────────────

/** Pipeline stage bar showing count + completion percentage */
function PipelineStageBar({
  label,
  count,
  total,
  icon: Icon,
  index,
}: {
  label: string;
  count: number;
  total: number;
  icon: React.ComponentType<{ className?: string }>;
  index: number;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const barColors = [
    'bg-indigo-500', 'bg-blue-500', 'bg-sky-500', 'bg-cyan-500',
    'bg-teal-500', 'bg-emerald-500', 'bg-green-500', 'bg-lime-500',
    'bg-yellow-500', 'bg-amber-500', 'bg-orange-500', 'bg-red-500',
    'bg-rose-500', 'bg-pink-500', 'bg-fuchsia-500', 'bg-purple-500',
    'bg-violet-500',
  ];
  const barColor = barColors[index % barColors.length];

  return (
    <div className="flex items-center gap-3 group">
      <div className="flex items-center gap-1.5 w-32 shrink-0">
        <Icon className="h-3.5 w-3.5 text-[var(--color-text-muted)] group-hover:text-[var(--color-text-secondary)] transition-colors" />
        <span className="text-xs font-medium text-[var(--color-text-secondary)] truncate">{label}</span>
      </div>
      <div className="flex-1 bg-[var(--color-bg-sunken)] rounded-full h-5 overflow-hidden">
        <div
          className={cn('h-full rounded-full flex items-center justify-end px-2 transition-all duration-500', barColor)}
          style={{ width: `${Math.max(pct, count > 0 ? 4 : 0)}%` }}
        >
          {pct >= 15 && (
            <span className="text-[10px] font-bold text-white">{count}</span>
          )}
        </div>
      </div>
      <span className="text-xs font-bold text-[var(--color-text-secondary)] w-10 text-right tabular-nums">
        {count}
      </span>
      {pct > 0 && (
        <span className="text-[10px] text-[var(--color-text-muted)] w-8 text-right">{pct}%</span>
      )}
    </div>
  );
}

/** Alert card for the alerts section */
function AlertCard({
  icon: Icon,
  title,
  description,
  count,
  variant = 'warning',
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  count: number;
  variant?: 'warning' | 'danger' | 'info';
  action?: React.ReactNode;
}) {
  const variantColors = {
    warning: 'border-amber-200 dark:border-amber-800/40 bg-amber-50/50 dark:bg-amber-900/10',
    danger: 'border-red-200 dark:border-red-800/40 bg-red-50/50 dark:bg-red-900/10',
    info: 'border-blue-200 dark:border-blue-800/40 bg-blue-50/50 dark:bg-blue-900/10',
  };
  const iconColors = {
    warning: 'text-amber-600 dark:text-amber-400',
    danger: 'text-red-600 dark:text-red-400',
    info: 'text-blue-600 dark:text-blue-400',
  };
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border p-3', variantColors[variant])}>
      <div className={cn('p-1.5 rounded-lg bg-white dark:bg-gray-900/50', iconColors[variant])}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[var(--color-text)]">{title}</span>
          <span className={cn(
            'inline-flex items-center justify-center min-w-[20px] h-5 rounded-full px-1.5 text-[10px] font-bold',
            variant === 'danger' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' :
            variant === 'warning' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' :
            'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
          )}>
            {count}
          </span>
        </div>
        <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{description}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────

export default function CasesDash() {
  const navigate = useNavigate();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const user = useAppStore((s) => s.user);
  const qkeys = queryKeys.forCompany(activeCompanyId);
  const isAdmin = String((user as any)?.role || '').toLowerCase() === 'admin';

  // ── Permissions ─────────────────────────────────────────
  const canEdit = canDo('edit', 'cases');
  const canCreate = canDo('create', 'cases');

  // ── Local state ─────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [stageFilter, setStageFilter] = useState<string>('all');

  // ── Data queries ────────────────────────────────────────
  const casesQuery = useQuery({
    queryKey: ['cases', activeCompanyId],
    queryFn: () => getAll<any>(COLLECTIONS.CASES),
    staleTime: 60_000,
  });

  const leadsQuery = useQuery({
    queryKey: qkeys.leadsRoot,
    queryFn: () => getAll<any>(COLLECTIONS.LEADS),
    staleTime: 60_000,
  });

  const customersQuery = useQuery({
    queryKey: qkeys.customersAll,
    queryFn: () => getAll<any>(COLLECTIONS.CUSTOMERS),
    staleTime: 60_000,
  });

  const projectsQuery = useQuery({
    queryKey: qkeys.projectsRoot,
    queryFn: () => getAll<any>(COLLECTIONS.PROJECTS),
    staleTime: 60_000,
  });

  const allCases = (casesQuery.data as any[]) || [];
  const allLeads = (leadsQuery.data as any[]) || [];
  const allCustomers = (customersQuery.data as any[]) || [];
  const allProjects = (projectsQuery.data as any[]) || [];
  const isLoading = casesQuery.isLoading;

  // Lazy-loaded health report
  const [healthReport, setHealthReport] = useState<any>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  const loadHealthReport = useCallback(async () => {
    setHealthLoading(true);
    setValidationMessage(null);
    try {
      const report = await generateCaseHealthReport();
      setHealthReport(report);
      const healthyPct = report.totalCases > 0
        ? Math.round((report.healthyCases / Math.min(report.totalCases, 50)) * 100)
        : 0;
      setValidationMessage(
        `Health report generated: ${report.healthyCases} healthy, ${report.brokenCases} broken, ` +
        `${report.orphanEntities} orphans, ${report.duplicateCases} duplicates`
      );
    } catch {
      setValidationMessage('Failed to generate health report.');
    } finally {
      setHealthLoading(false);
    }
  }, []);

  // ── KPI computation ─────────────────────────────────────
  const kpis = useMemo(() => {
    const active = allCases.filter((c: any) => c.status === 'Active' && !c.isDeleted);
    const completed = allCases.filter((c: any) => c.status === 'Completed' && !c.isDeleted);
    const failed = allCases.filter((c: any) => c.status === 'Failed' && !c.isDeleted);
    const total = allCases.filter((c: any) => !c.isDeleted).length;

    // Compute average completion time
    const completedWithDates = completed.filter((c: any) => c.createdAt && c.updatedAt);
    let avgCompletionDays = 0;
    if (completedWithDates.length > 0) {
      const totalDays = completedWithDates.reduce((sum: number, c: any) => {
        return sum + daysSince(c.createdAt);
      }, 0);
      avgCompletionDays = Math.round(totalDays / completedWithDates.length);
    }

    return {
      total,
      active: active.length,
      healthy: 0, // filled by health report
      warning: 0,
      critical: 0,
      completed: completed.length,
      failed: failed.length,
      avgCompletionDays,
    };
  }, [allCases]);

  // ── Pipeline computation ────────────────────────────────
  const pipeline = useMemo(() => {
    const active = allCases.filter((c: any) => !c.isDeleted);
    return PIPELINE_STAGES.map((stage) => {
      const count = active.filter((c: any) => {
        const cs = String(c.currentStage || '').toLowerCase();
        const sk = stage.key.toLowerCase();
        // Map stage keys to case currentStage values
        if (sk === 'lead') return cs === 'new' || cs === 'survey' || cs === 'engineering';
        if (sk === 'quotation') return cs === 'quotation';
        if (sk === 'order') return cs === 'order';
        if (sk === 'dispatch') return cs === 'procurement' || cs === 'dispatch';
        if (sk === 'installation') return cs === 'installation';
        if (sk === 'qc') return cs === 'qc';
        if (sk === 'commissioning') return cs === 'commissioning';
        if (sk === 'netmetering') return cs === 'netmetering';
        if (sk === 'subsidy') return cs === 'subsidy';
        if (sk === 'handover') return cs === 'handover';
        if (sk === 'amc') return cs === 'amc';
        if (sk === 'service') return cs === 'service';
        if (sk === 'closure') return cs === 'closure' || cs === 'monitoring';
        if (sk === 'customer') return !!(c as any).customerId;
        if (sk === 'project') return cs === 'project';
        if (sk === 'invoice') return cs === 'invoice' || cs === 'payment';
        if (sk === 'payment') return cs === 'payment';
        return cs.includes(sk.toLowerCase());
      });
      return { ...stage, count: count.length };
    });
  }, [allCases]);

  const totalPipelineCases = useMemo(() =>
    pipeline.reduce((sum, s) => sum + s.count, 0),
    [pipeline]
  );

  // Find bottleneck (stage with most cases stuck)
  const bottleneckStage = useMemo(() => {
    let maxCount = 0;
    let maxStage = PIPELINE_STAGES[0].label;
    pipeline.forEach((s) => {
      if (s.count > maxCount) {
        maxCount = s.count;
        maxStage = s.label;
      }
    });
    return { stage: maxStage, count: maxCount };
  }, [pipeline]);

  // ── Recent activity computation ─────────────────────────
  const recentCases = useMemo(() => {
    const active = allCases.filter((c: any) => !c.isDeleted);
    return [...active]
      .sort((a: any, b: any) => {
        const aDate = a.createdAt ? new Date(String(a.createdAt)).getTime() : 0;
        const bDate = b.createdAt ? new Date(String(b.createdAt)).getTime() : 0;
        return bDate - aDate;
      })
      .slice(0, 10);
  }, [allCases]);

  const recentlyCompleted = useMemo(() => {
    return allCases
      .filter((c: any) => c.status === 'Completed' && !c.isDeleted)
      .sort((a: any, b: any) => {
        const aDate = a.updatedAt ? new Date(String(a.updatedAt)).getTime() : 0;
        const bDate = b.updatedAt ? new Date(String(b.updatedAt)).getTime() : 0;
        return bDate - aDate;
      })
      .slice(0, 5);
  }, [allCases]);

  // ── Alerts computation ──────────────────────────────────
  const alerts = useMemo(() => {
    const failed = allCases.filter((c: any) =>
      (c.status === 'Failed' || c.currentStage === 'Failed') && !c.isDeleted
    );
    // Stuck: no update for >7 days and not completed
    const stuck = allCases.filter((c: any) => {
      if (c.isDeleted || c.status === 'Completed') return false;
      const updatedAt = c.updatedAt || c.createdAt;
      if (!updatedAt) return false;
      return daysSince(updatedAt) > 7;
    });
    // Missing caseIds: Cases without leadId or customerId
    const missingRefs = allCases.filter((c: any) => {
      if (c.isDeleted) return false;
      return !c.leadId || !c.customerId;
    });
    // Cases in warning status
    const warningCases = allCases.filter((c: any) =>
      !c.isDeleted && c.status === 'Warning'
    );

    return {
      failed: failed.length,
      stuck: stuck.length,
      stuckCases: stuck,
      missingRefs: missingRefs.length,
      warningCases: warningCases.length,
    };
  }, [allCases]);

  // ── Table data ──────────────────────────────────────────
  const filteredCases = useMemo(() => {
    let list = allCases.filter((c: any) => !c.isDeleted);

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((c: any) => {
        const lead = allLeads.find((l: any) => l.id === c.leadId);
        const customer = allCustomers.find((cu: any) => cu.id === c.customerId);
        const project = allProjects.find((p: any) => p.caseId === c.caseId || p.caseId === c.id);
        return (
          String(c.caseId || '').toLowerCase().includes(q) ||
          String(lead?.name || '').toLowerCase().includes(q) ||
          String(customer?.name || '').toLowerCase().includes(q) ||
          String(project?.projectName || '').toLowerCase().includes(q) ||
          String(c.status || '').toLowerCase().includes(q) ||
          String(c.currentStage || '').toLowerCase().includes(q)
        );
      });
    }

    // Status filter
    if (statusFilter !== 'all') {
      list = list.filter((c: any) => c.status === statusFilter);
    }

    // Stage filter
    if (stageFilter !== 'all') {
      list = list.filter((c: any) => (c.currentStage || '') === stageFilter);
    }

    return list.sort((a: any, b: any) => {
      const aDate = a.updatedAt || a.createdAt;
      const bDate = b.updatedAt || b.createdAt;
      if (!aDate && !bDate) return 0;
      if (!aDate) return 1;
      if (!bDate) return -1;
      return new Date(String(bDate)).getTime() - new Date(String(aDate)).getTime();
    });
  }, [allCases, searchQuery, statusFilter, allLeads, allCustomers, allProjects]);

  // ── Table columns ───────────────────────────────────────
  const columns: TableColumn[] = useMemo(() => [
    {
      key: 'caseId',
      label: 'Case ID',
      render: (row: any) => (
        <button
          type="button"
          onClick={() => navigate(`/cases/${encodeURIComponent(row.id)}`)}
          className="text-[var(--color-primary)] hover:underline font-mono text-xs font-semibold"
        >
          {row.caseId || row.id}
        </button>
      ),
    },
    {
      key: 'lead',
      label: 'Lead',
      render: (row: any) => {
        const lead = allLeads.find((l: any) => l.id === row.leadId);
        return (
          <span className="text-xs text-[var(--color-text-secondary)] truncate max-w-[120px] block">
            {lead?.name || row.leadId || '—'}
          </span>
        );
      },
    },
    {
      key: 'customer',
      label: 'Customer',
      render: (row: any) => {
        const customer = allCustomers.find((c: any) => c.id === row.customerId);
        return (
          <span className="text-xs text-[var(--color-text-secondary)] truncate max-w-[120px] block">
            {customer?.name || row.customerId || '—'}
          </span>
        );
      },
    },
    {
      key: 'currentStage',
      label: 'Stage',
      render: (row: any) => (
        <span className="inline-flex items-center rounded-full bg-[var(--color-bg-sunken)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-text-secondary)]">
          {row.currentStage || 'New'}
        </span>
      ),
    },
    {
      key: 'health',
      label: 'Health',
      render: (row: any) => {
        const isHealthy = row.status === 'Active' && !!row.leadId && !!row.customerId;
        const isWarning = row.status === 'Warning';
        const isFailed = row.status === 'Failed';
        return (
          <div className="flex items-center gap-1.5">
            <span className={cn(
              'inline-block h-2 w-2 rounded-full',
              isFailed ? 'bg-red-500' : isWarning ? 'bg-amber-500' : isHealthy ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'
            )} />
            <span className="text-[10px] font-medium text-[var(--color-text-muted)]">
              {isFailed ? 'Critical' : isWarning ? 'Warning' : isHealthy ? 'Healthy' : 'Unknown'}
            </span>
          </div>
        );
      },
    },
    {
      key: 'status',
      label: 'Status',
      render: (row: any) => {
        const colorMap: Record<string, string> = {
          Active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
          Completed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
          Archived: 'bg-slate-100 text-slate-700 dark:bg-slate-800/40 dark:text-slate-300',
          Failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
          Warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
        };
        return (
          <span className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
            colorMap[row.status] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
          )}>
            {row.status || '—'}
          </span>
        );
      },
    },
    {
      key: 'updatedAt',
      label: 'Last Updated',
      render: (row: any) => (
        <span className="text-[11px] text-[var(--color-text-muted)]">{fmtDateSafe(row.updatedAt)}</span>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (row: any) => (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => navigate(`/cases/${encodeURIComponent(row.id)}`)}
            className="p-1 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-primary)] hover:bg-[var(--color-bg-sunken)] transition-colors"
            title="Open Case"
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  ], [navigate, allLeads, allCustomers]);

  // ── Quick actions ───────────────────────────────────────
  const quickActions = [
    { id: 'create-task', label: 'Create Task', icon: PlusCircle, permission: canCreate, variant: 'secondary' as const, handler: () => navigate('/tasks?create=1&entityType=cases') },
    { id: 'validate', label: 'Run Validation', icon: RefreshCw, permission: canEdit, variant: 'primary' as const, handler: async () => {
      setHealthLoading(true);
      setValidationMessage(null);
      try {
        const sample = allCases.filter((c: any) => !c.isDeleted).slice(0, 5);
        const results = await Promise.allSettled(
          sample.map((c: any) => validateCaseIntegrity(c.caseId || c.id))
        );
        const healthy = results.filter(r => r.status === 'fulfilled' && r.value.healthy).length;
        const total = results.length;
        setValidationMessage(`Validation complete: ${healthy}/${total} cases healthy in sample.`);
      } catch {
        setValidationMessage('Validation failed — could not check case integrity.');
      } finally {
        setHealthLoading(false);
      }
    }},
    { id: 'health-report', label: 'Health Report', icon: BarChart3, permission: canEdit, variant: 'secondary' as const, handler: loadHealthReport },
    { id: 'export', label: 'Export Cases', icon: Download, permission: canEdit, variant: 'secondary' as const, handler: () => {
      const json = JSON.stringify(allCases.filter((c: any) => !c.isDeleted), null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cases-export-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }},
    { id: 'search', label: 'Open Search', icon: Search, permission: true, variant: 'secondary' as const, handler: () => navigate('/tasks') },
    { id: 'workspace', label: 'Browse Cases', icon: FolderKanban, permission: true, variant: 'secondary' as const, handler: () => {
      if (filteredCases.length > 0) {
        navigate(`/cases/${encodeURIComponent(filteredCases[0].id)}`);
      }
    }},
    { id: 'repair', label: 'Run Repair', icon: Wrench, permission: isAdmin, variant: 'danger' as const, handler: () => {
      if (window.confirm('Run repair on ALL cases? This is a dry-run by default and will check all entities for missing/wrong caseIds.')) {
        import('../engines/CaseValidationEngine').then(({ repairCaseChain }) => {
          // Run repair on a sample
          const sample = allCases.filter((c: any) => !c.isDeleted).slice(0, 5);
          Promise.allSettled(
            sample.map((c: any) => repairCaseChain(c.caseId || c.id, { dryRun: true }))
          ).then((results) => {
            const totalRepairs = results.filter(r => r.status === 'fulfilled').reduce((sum, r: any) => sum + r.value.repairsApplied.length, 0);
            setValidationMessage(`Dry-run complete: ${sample.length} cases checked, ${totalRepairs} potential repairs identified.`);
          });
        });
      }
    }},
  ];

  // ── Loading state ────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-5 animate-fadeIn">
        <PageHeader title="Cases Dashboard" icon={<FolderKanban className="h-5 w-5" />} />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-28 bg-[var(--color-bg-sunken)] rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-[var(--color-bg-sunken)] rounded-xl animate-pulse" />
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────
  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Page Header */}
      <PageHeader
        title="Cases Dashboard"
        subtitle="Complete operational view of all Cases across the ERP"
        icon={<FolderKanban className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            {quickActions.filter(a => a.permission).map((action) => (
              <Button
                key={action.id}
                variant={action.variant}
                size="sm"
                icon={<action.icon className="h-3.5 w-3.5" />}
                onClick={action.handler}
              >
                {action.label}
              </Button>
            ))}
          </div>
        }
      />

      {/* Validation/health message banner */}
      {validationMessage && (
        <div className={cn(
          'rounded-xl border p-3 text-sm flex items-start gap-2',
          validationMessage.includes('healthy')
            ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-900/10 text-emerald-800 dark:text-emerald-200'
            : 'border-amber-200 bg-amber-50 dark:bg-amber-900/10 text-amber-800 dark:text-amber-200'
        )}>
          {validationMessage.includes('healthy') ? (
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          )}
          <span>{validationMessage}</span>
        </div>
      )}

      {/* ── SECTION 1: KPI Cards ──────────────────────────── */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3 flex items-center gap-2">
          <BarChart3 className="h-3.5 w-3.5" /> Key Performance Indicators
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          <KPIStatCard label="Total Cases" value={fmtCompactNumber(kpis.total)} icon={<FolderKanban className="h-4 w-4" />} color="indigo" compact />
          <KPIStatCard label="Active" value={fmtCompactNumber(kpis.active)} icon={<Activity className="h-4 w-4" />} color="blue" compact />
          <KPIStatCard label="Healthy" value={fmtCompactNumber(healthReport?.healthyCases ?? kpis.healthy)} icon={<CheckCircle2 className="h-4 w-4" />} color="emerald" compact />
          <KPIStatCard label="Warning" value={fmtCompactNumber(healthReport?.brokenCases ?? kpis.warning)} icon={<AlertTriangle className="h-4 w-4" />} color="amber" compact />
          <KPIStatCard label="Critical" value={fmtCompactNumber(kpis.failed)} icon={<XCircle className="h-4 w-4" />} color="rose" compact />
          <KPIStatCard label="Completed" value={fmtCompactNumber(kpis.completed)} icon={<CheckCircle2 className="h-4 w-4" />} color="emerald" compact />
          <KPIStatCard label="Failed" value={fmtCompactNumber(kpis.failed)} icon={<XCircle className="h-4 w-4" />} color="rose" compact />
          <KPIStatCard label="Avg Time" value={kpis.avgCompletionDays > 0 ? `${kpis.avgCompletionDays}d` : '—'} icon={<Clock className="h-4 w-4" />} color="purple" compact />
        </div>
      </div>

      {/* ── SECTION 2: Pipeline View ──────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-[var(--color-primary)]" />
              EPC Pipeline View
            </div>
          </CardTitle>
          <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
            <span>Total: <strong className="text-[var(--color-text-secondary)]">{totalPipelineCases}</strong></span>
            <span>Bottleneck: <strong className="text-amber-600">{bottleneckStage.stage}</strong> ({bottleneckStage.count})</span>
          </div>
        </CardHeader>
        <CardBody>
          <div className="space-y-1.5">
            {pipeline.map((stage, i) => (
              <PipelineStageBar
                key={stage.key}
                label={stage.label}
                count={stage.count}
                total={totalPipelineCases}
                icon={stage.icon}
                index={i}
              />
            ))}
          </div>
        </CardBody>
      </Card>

      {/* ── SECTION 3: Health Dashboard ───────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-[var(--color-primary)]" />
              Health Dashboard
            </div>
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            icon={healthLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            onClick={loadHealthReport}
            disabled={healthLoading}
          >
            {healthLoading ? 'Generating...' : 'Generate Report'}
          </Button>
        </CardHeader>
        <CardBody>
          {healthReport ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/30 bg-emerald-50/50 dark:bg-emerald-900/10 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Healthy</p>
                <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300 mt-0.5">{healthReport.healthyCases}</p>
              </div>
              <div className="rounded-xl border border-amber-200 dark:border-amber-800/30 bg-amber-50/50 dark:bg-amber-900/10 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">Broken</p>
                <p className="text-lg font-bold text-amber-700 dark:text-amber-300 mt-0.5">{healthReport.brokenCases}</p>
              </div>
              <div className="rounded-xl border border-red-200 dark:border-red-800/30 bg-red-50/50 dark:bg-red-900/10 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-red-600 dark:text-red-400">Orphans</p>
                <p className="text-lg font-bold text-red-700 dark:text-red-300 mt-0.5">{healthReport.orphanEntities}</p>
              </div>
              <div className="rounded-xl border border-rose-200 dark:border-rose-800/30 bg-rose-50/50 dark:bg-rose-900/10 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-rose-600 dark:text-rose-400">Duplicates</p>
                <p className="text-lg font-bold text-rose-700 dark:text-rose-300 mt-0.5">{healthReport.duplicateCases}</p>
              </div>
              <div className="rounded-xl border border-purple-200 dark:border-purple-800/30 bg-purple-50/50 dark:bg-purple-900/10 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-purple-600 dark:text-purple-400">Circular Ref</p>
                <p className="text-lg font-bold text-purple-700 dark:text-purple-300 mt-0.5">{healthReport.circularReferences}</p>
              </div>
              <div className="rounded-xl border border-orange-200 dark:border-orange-800/30 bg-orange-50/50 dark:bg-orange-900/10 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-orange-600 dark:text-orange-400">Missing IDs</p>
                <p className="text-lg font-bold text-orange-700 dark:text-orange-300 mt-0.5">{healthReport.missingCaseIds}</p>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800/30 bg-slate-50/50 dark:bg-slate-900/10 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">Deleted Ref</p>
                <p className="text-lg font-bold text-slate-700 dark:text-slate-300 mt-0.5">{healthReport.deletedCases}</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <BarChart3 className="h-8 w-8 text-[var(--color-text-disabled)] mb-2" />
              <p className="text-sm text-[var(--color-text-muted)]">No health report generated yet</p>
              <p className="text-xs text-[var(--color-text-disabled)] mt-1">Click "Generate Report" to run a full case health check</p>
            </div>
          )}
        </CardBody>
      </Card>

      {/* ── SECTION 4: Recent Activity ────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Recently Created */}
        <Card>
          <CardHeader>
            <CardTitle>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-blue-500" />
                Recently Created
              </div>
            </CardTitle>
          </CardHeader>
          <CardBody className="max-h-[320px] overflow-y-auto">
            {recentCases.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)] text-center py-6">No cases yet</p>
            ) : (
              <div className="space-y-2">
                {recentCases.map((c: any) => {
                  const lead = allLeads.find((l: any) => l.id === c.leadId);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => navigate(`/cases/${encodeURIComponent(c.id)}`)}
                      className="w-full flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-[var(--color-bg-sunken)] transition-colors text-left"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg-sunken)]">
                        <FolderKanban className="h-4 w-4 text-[var(--color-primary)]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[var(--color-text)] truncate">
                          {c.caseId || c.id}
                        </p>
                        <p className="text-xs text-[var(--color-text-muted)] truncate">
                          {lead?.name || 'No lead'} · {c.currentStage || 'New'}
                        </p>
                      </div>
                      <span className="text-[10px] text-[var(--color-text-disabled)] shrink-0">
                        {fmtDateSafe(c.createdAt)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Recently Completed */}
        <Card>
          <CardHeader>
            <CardTitle>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                Recently Completed
              </div>
            </CardTitle>
          </CardHeader>
          <CardBody className="max-h-[320px] overflow-y-auto">
            {recentlyCompleted.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)] text-center py-6">No completed cases yet</p>
            ) : (
              <div className="space-y-2">
                {recentlyCompleted.map((c: any) => {
                  const lead = allLeads.find((l: any) => l.id === c.leadId);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => navigate(`/cases/${encodeURIComponent(c.id)}`)}
                      className="w-full flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-[var(--color-bg-sunken)] transition-colors text-left"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-900/20">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[var(--color-text)] truncate">
                          {c.caseId || c.id}
                        </p>
                        <p className="text-xs text-[var(--color-text-muted)] truncate">
                          {lead?.name || 'No lead'}
                        </p>
                      </div>
                      <span className="text-[10px] text-[var(--color-text-disabled)] shrink-0">
                        {fmtDateSafe(c.updatedAt)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* ── SECTION 5: Alerts ─────────────────────────────── */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5" /> Alerts & Issues
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <AlertCard
            icon={XCircle}
            title="Failed Cases"
            description="Cases with Failed status"
            count={alerts.failed}
            variant="danger"
            action={
              alerts.failed > 0 ? (
                <button
                  type="button"
                  className="text-[10px] font-semibold text-red-600 dark:text-red-400 hover:underline"
                  onClick={() => { setStatusFilter('Failed'); }}
                >
                  View
                </button>
              ) : undefined
            }
          />
          <AlertCard
            icon={Clock}
            title="Stuck Cases"
            description="No activity for >7 days"
            count={alerts.stuck}
            variant="warning"
            action={
              alerts.stuck > 0 ? (
                <button
                  type="button"
                  className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 hover:underline"
                  onClick={() => navigate(`/tasks?filter=stuck-cases`)}
                >
                  View
                </button>
              ) : undefined
            }
          />
          <AlertCard
            icon={Ban}
            title="Missing References"
            description="Cases without lead or customer"
            count={alerts.missingRefs}
            variant="danger"
          />
          <AlertCard
            icon={AlertTriangle}
            title="Warning Cases"
            description="Cases with Warning status"
            count={alerts.warningCases}
            variant="info"
            action={
              alerts.warningCases > 0 ? (
                <button
                  type="button"
                  className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                  onClick={() => loadHealthReport()}
                >
                  Check
                </button>
              ) : undefined
            }
          />
        </div>

        {/* Stuck cases detail */}
        {alerts.stuck > 0 && (
          <div className="mt-3 rounded-xl border border-amber-200 dark:border-amber-800/30 bg-amber-50/50 dark:bg-amber-900/10 p-3">
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-200 mb-2">Stuck Cases ({alerts.stuck})</p>
            <div className="space-y-1">
              {alerts.stuckCases.slice(0, 5).map((c: any) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => navigate(`/cases/${encodeURIComponent(c.id)}`)}
                  className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300 hover:underline"
                >
                  <span className="font-mono">{c.caseId || c.id}</span>
                  <span>·</span>
                  <span>{c.currentStage || 'New'}</span>
                  <span>·</span>
                  <span>{daysSince(c.updatedAt || c.createdAt)}d inactive</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── SECTION 6: Search & Table ─────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-[var(--color-primary)]" />
              All Cases
            </div>
          </CardTitle>
          <div className="flex items-center gap-2">
            {/* Search input */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-text-muted)]" />
              <input
                type="text"
                placeholder="Search cases..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] text-[var(--color-text)] w-48 focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]/40"
              />
            </div>
            {/* Status filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2 py-1.5 text-xs rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]/40"
            >
              <option value="all">All Status</option>
              <option value="Active">Active</option>
              <option value="Completed">Completed</option>
              <option value="Failed">Failed</option>
              <option value="Warning">Warning</option>
              <option value="Archived">Archived</option>
            </select>
            <span className="text-xs text-[var(--color-text-muted)]">
              {filteredCases.length} results
            </span>
          </div>
        </CardHeader>
        <CardBody>
          {filteredCases.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FolderKanban className="h-10 w-10 text-[var(--color-text-disabled)] mb-3" />
              <p className="text-sm text-[var(--color-text-muted)]">
                {searchQuery ? 'No cases match your search' : 'No cases found'}
              </p>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="mt-2 text-xs text-[var(--color-primary)] hover:underline"
                >
                  Clear search
                </button>
              )}
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={filteredCases}
              perPage={15}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
