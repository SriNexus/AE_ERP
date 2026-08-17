/**
 * CaseTimelineTab — Enhanced EPC Lifecycle Timeline
 *
 * Phase 3E — Case Timeline UI Enhancement
 * Transforms the timeline into a premium EPC lifecycle visualization with:
 *   - Global metrics header (progress %, completed/pending/failed counts, health, duration)
 *   - 6 statuses: completed, current, pending, failed, skipped, cancelled
 *   - Rich stage cards with entity ID, assigned user, duration, validation status,
 *     failure/pending reason, health indicator
 *   - Navigation to entity workspace (only if workspace exists)
 *   - Validation integration with CaseValidationEngine
 *
 * Stage order (LOCKED — 17 stages, preserved from Phase 3D):
 *   Lead → Customer → Project → Quotation → Order → Invoice → Payment →
 *   Dispatch → Installation → QC → Commissioning → Net Metering → Subsidy →
 *   Handover → AMC → Service Tickets → Monitoring
 */

import { useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getAll, getOne } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { cn } from '../../../utils/cn';
import { useAppStore } from '../../../store/useAppStore';
import { queryKeys } from '../../../lib/queryKeys';
import {
  CheckCircle2,
  ChevronRight,
  XCircle,
  Clock,
  UserPlus,
  Users,
  Building2,
  FileText,
  ShoppingCart,
  CreditCard,
  Truck,
  Wrench,
  ClipboardCheck,
  Zap,
  Gauge,
  PiggyBank,
  Handshake,
  Shield,
  Headphones,
  Activity,
  AlertTriangle,
  Loader2,
  SkipForward,
  Ban,
  Calendar,
  User,
  Hash,
  TrendingUp,
  Info,
  BarChart3,
  Check,
} from 'lucide-react';
import {
  formatDuration,
  formatTimelineDate,
  formatTimelineDateFull,
  sanitizeTimestamp,
  computeTimelineMetrics,
  getWorkspaceRoute,
  STATUS_VISUALS,
} from '../utils/timelineHelpers';
import type { TimelineStageStatus } from '../utils/timelineHelpers';

// ── Stage definition (LOCKED — 17 stages) ──────────────────

interface StageDef {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  entityType: string;
}

const STAGES: StageDef[] = [
  { key: 'lead', label: 'Lead Created', icon: UserPlus, description: 'Customer inquiry recorded', entityType: 'leads' },
  { key: 'customer', label: 'Customer Created', icon: Users, description: 'Lead converted to customer', entityType: 'customers' },
  { key: 'project', label: 'Project Created', icon: Building2, description: 'Solar project initiated', entityType: 'projects' },
  { key: 'quotation', label: 'Quotation', icon: FileText, description: 'Quotation sent to customer', entityType: 'quotations' },
  { key: 'order', label: 'Order', icon: ShoppingCart, description: 'Order confirmed', entityType: 'orders' },
  { key: 'invoice', label: 'Invoice', icon: FileText, description: 'Invoice generated', entityType: 'proforma_invoices' },
  { key: 'payment', label: 'Payment', icon: CreditCard, description: 'Payment received', entityType: 'payments' },
  { key: 'dispatch', label: 'Dispatch', icon: Truck, description: 'Material dispatched', entityType: 'dispatch' },
  { key: 'installation', label: 'Installation', icon: Wrench, description: 'System installed on-site', entityType: 'installations' },
  { key: 'qc', label: 'QC', icon: ClipboardCheck, description: 'Quality check completed', entityType: 'qc_checks' },
  { key: 'commissioning', label: 'Commissioning', icon: Zap, description: 'System commissioned', entityType: 'commissioning_records' },
  { key: 'net-metering', label: 'Net Metering', icon: Gauge, description: 'DISCOM meter installed', entityType: 'net_metering_applications' },
  { key: 'subsidy', label: 'Subsidy', icon: PiggyBank, description: 'Government subsidy processed', entityType: 'subsidy_applications' },
  { key: 'handover', label: 'Handover', icon: Handshake, description: 'Project handed over to customer', entityType: 'project_handovers' },
  { key: 'amc', label: 'AMC', icon: Shield, description: 'AMC contract active', entityType: 'amc_contracts' },
  { key: 'service-tickets', label: 'Service Tickets', icon: Headphones, description: 'Support requests', entityType: 'service_tickets' },
  { key: 'monitoring', label: 'Monitoring', icon: Activity, description: 'Generation monitoring active', entityType: 'generation_readings' },
];

// ── Collection map ─────────────────────────────────────────

const COLLECTION_MAP: Record<string, string> = {
  leads:                      COLLECTIONS.LEADS,
  customers:                  COLLECTIONS.CUSTOMERS,
  projects:                   COLLECTIONS.PROJECTS,
  quotations:                 COLLECTIONS.QUOTATIONS,
  orders:                     COLLECTIONS.ORDERS,
  proforma_invoices:          COLLECTIONS.PROFORMA_INVOICES,
  payments:                   COLLECTIONS.PAYMENTS,
  dispatch:                   COLLECTIONS.DISPATCH,
  installations:              'installations',
  qc_checks:                  COLLECTIONS.QC_CHECKS,
  commissioning_records:      COLLECTIONS.COMMISSIONING_RECORDS,
  net_metering_applications:  COLLECTIONS.NET_METERING_APPLICATIONS,
  subsidy_applications:       COLLECTIONS.SUBSIDY_APPLICATIONS,
  project_handovers:          COLLECTIONS.PROJECT_HANDOVERS,
  amc_contracts:              COLLECTIONS.AMC_CONTRACTS,
  service_tickets:            COLLECTIONS.SERVICE_TICKETS,
  generation_readings:        COLLECTIONS.GENERATION_READINGS,
};

// ── Rich stage info ────────────────────────────────────────

interface RichStageInfo {
  stage: StageDef;
  status: TimelineStageStatus;
  entityId: string | null;
  entityStatus: string | null;
  timestamp: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  createdAt: string | null;
  completedAt: string | null;
  failureReason: string | null;
  pendingReason: string | null;
  validationStatus: 'valid' | 'invalid' | 'unknown';
  healthIndicator: 'good' | 'warning' | 'critical' | 'none';
  canNavigate: boolean;
  route: string | null;
  previousTimestamp: string | null;
  duration: string;
}

// ── Status resolution logic ────────────────────────────────

/**
 * Resolve the 6-status system for an entity.
 * Supports: completed, current, pending, failed, skipped, cancelled
 */
function resolveEntityStatus(stageKey: string, entity: any | null): {
  status: TimelineStageStatus;
  failureReason: string | null;
  pendingReason: string | null;
} {
  if (!entity) {
    return { status: 'pending', failureReason: null, pendingReason: null };
  }

  const rawStatus = String(entity.status || '').toLowerCase();
  const isDeleted = entity.isDeleted === true;

  // Check deleted first
  if (isDeleted) {
    return { status: 'cancelled', failureReason: 'Record was deleted', pendingReason: null };
  }

  // Check cancelled/rejected
  if (rawStatus === 'cancelled' || rawStatus === 'rejected') {
    return { status: 'cancelled', failureReason: entity.cancellationReason || entity.rejectionReason || 'Cancelled', pendingReason: null };
  }

  // Check failed
  if (rawStatus === 'failed') {
    return { status: 'failed', failureReason: entity.failureReason || entity.errorMessage || 'Stage failed', pendingReason: null };
  }

  // Check completed based on stage-specific rules
  const isCompleted = checkStageCompleted(stageKey, rawStatus, entity);
  if (isCompleted) {
    return { status: 'completed', failureReason: null, pendingReason: null };
  }

  // Check skip
  if (rawStatus === 'skipped' || entity.isSkipped === true) {
    return { status: 'skipped', failureReason: null, pendingReason: entity.skipReason || 'Skipped' };
  }

  // Entity exists but not completed → current
  if (entity.id) {
    return { status: 'current', failureReason: null, pendingReason: null };
  }

  return { status: 'pending', failureReason: null, pendingReason: null };
}

/**
 * Stage-specific completion checks matching the Phase 3D logic.
 */
function checkStageCompleted(stageKey: string, normalizedStatus: string, entity: any): boolean {
  switch (stageKey) {
    case 'payment':
      return normalizedStatus === 'paid' || entity.paidAmount > 0;
    case 'qc':
      return normalizedStatus === 'passed';
    case 'commissioning':
      return normalizedStatus === 'completed';
    case 'handover':
      return normalizedStatus === 'completed';
    case 'amc':
      return normalizedStatus === 'active';
    case 'invoice':
      return normalizedStatus === 'paid' || normalizedStatus === 'sent';
    case 'dispatch':
      return normalizedStatus === 'delivered' || normalizedStatus === 'closed' || normalizedStatus === 'dispatched';
    default:
      return normalizedStatus !== 'pending' && normalizedStatus !== 'draft' && normalizedStatus !== '';
  }
}

// ── Icon resolver ──────────────────────────────────────────

function resolveStageIcon(
  status: TimelineStageStatus,
  StageIcon: React.ComponentType<{ className?: string }>,
): React.ReactNode {
  if (status === 'completed') return <CheckCircle2 className="h-5 w-5 text-white" />;
  if (status === 'failed') return <XCircle className="h-5 w-5 text-white" />;
  if (status === 'skipped') return <SkipForward className="h-5 w-5 text-amber-700" />;
  if (status === 'cancelled') return <Ban className="h-5 w-5 text-rose-700" />;
  if (status === 'current') return <Loader2 className="h-5 w-5 text-white animate-spin" />;
  // pending
  return <StageIcon className="h-5 w-5 text-[var(--color-text-muted)]" />;
}

// ── Sub-components ─────────────────────────────────────────

/** Animated progress ring for metrics display */
function ProgressRing({ percent, size = 56 }: { percent: number; size?: number }) {
  const strokeWidth = 4;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (percent / 100) * circumference;
  return (
    <svg width={size} height={size} className="transform -rotate-90" viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-border-subtle)" strokeWidth={strokeWidth} />
      <circle
        cx={size / 2} cy={size / 2} r={radius} fill="none"
        stroke={percent === 100 ? 'var(--color-success)' : 'var(--color-primary)'}
        strokeWidth={strokeWidth} strokeDasharray={circumference} strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-all duration-700 ease-out"
      />
    </svg>
  );
}

/** Red/green health indicator dot */
function HealthDot({ level }: { level: 'good' | 'warning' | 'critical' | 'none' }) {
  const colors = {
    good: 'bg-emerald-500 shadow-emerald-500/50',
    warning: 'bg-amber-500 shadow-amber-500/50',
    critical: 'bg-red-500 shadow-red-500/50',
    none: 'bg-gray-300 dark:bg-gray-600',
  };
  return (
    <span className={cn('inline-block h-2.5 w-2.5 rounded-full shadow-sm', colors[level])} />
  );
}

/** Status badge pill */
function StatusPill({ status }: { status: TimelineStageStatus }) {
  const cfg = STATUS_VISUALS[status];
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', cfg.badgeColor)}>
      {cfg.label}
    </span>
  );
}

/** Metric stat card for the global header */
function MetricStat({ label, value, icon: Icon, highlight }: {
  label: string;
  value: string | number;
  icon?: React.ComponentType<{ className?: string }>;
  highlight?: 'success' | 'warning' | 'danger' | 'info';
}) {
  const highlightColors = {
    success: 'text-emerald-600 dark:text-emerald-400',
    warning: 'text-amber-600 dark:text-amber-400',
    danger: 'text-red-600 dark:text-red-400',
    info: 'text-blue-600 dark:text-blue-400',
  };
  return (
    <div className="min-w-0 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className={cn('h-3 w-3', highlight ? highlightColors[highlight] : 'text-[var(--color-text-muted)]')} />}
        <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      </div>
      <p className={cn('mt-0.5 text-sm font-bold', highlight ? highlightColors[highlight] : 'text-[var(--color-text)]')}>
        {value}
      </p>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────

export function CaseTimelineTab({ caseId }: { caseId?: string | null }) {
  const navigate = useNavigate();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const qkeys = queryKeys.forCompany(activeCompanyId);

  // ── Health report integration (from CaseValidationEngine) ────
  const [validationResult, setValidationResult] = useState<{
    healthy: boolean;
    totalErrors: number;
    lastChecked: string | null;
  } | null>(null);

  // ── Data queries ──────────────────────────────────────────
  const caseQuery = useQuery({
    queryKey: ['cases', caseId],
    queryFn: () => getOne<any>(COLLECTIONS.CASES, caseId || ''),
    enabled: Boolean(caseId),
    staleTime: 30_000,
  });

  // Fetch all entity data for the timeline
  const leadsData = useQuery({
    queryKey: [...qkeys.leadsRoot, 'timeline', caseId],
    queryFn: () => getAll<any>(COLLECTIONS.LEADS).then(r => r.filter((e: any) => !e.isDeleted)),
    enabled: Boolean(caseId),
    staleTime: 60_000,
  });

  const customersData = useQuery({
    queryKey: [...qkeys.leadsRoot, 'timeline-customers', caseId],
    queryFn: () => getAll<any>(COLLECTIONS.CUSTOMERS).then(r => r.filter((e: any) => !e.isDeleted)),
    enabled: Boolean(caseId),
    staleTime: 60_000,
  });

  const projectsData = useQuery({
    queryKey: [...qkeys.leadsRoot, 'timeline-projects', caseId],
    queryFn: () => getAll<any>(COLLECTIONS.PROJECTS).then(r => r.filter((e: any) => !e.isDeleted)),
    enabled: Boolean(caseId),
    staleTime: 60_000,
  });

  const quotationsData = useQuery({
    queryKey: [...qkeys.leadsRoot, 'timeline-quotations', caseId],
    queryFn: () => getAll<any>(COLLECTIONS.QUOTATIONS).then(r => r.filter((e: any) => !e.isDeleted)),
    enabled: Boolean(caseId),
    staleTime: 60_000,
  });

  const ordersData = useQuery({
    queryKey: [...qkeys.leadsRoot, 'timeline-orders', caseId],
    queryFn: () => getAll<any>(COLLECTIONS.ORDERS).then(r => r.filter((e: any) => !e.isDeleted)),
    enabled: Boolean(caseId),
    staleTime: 60_000,
  });

  const invoicesData = useQuery({
    queryKey: [...qkeys.leadsRoot, 'timeline-invoices', caseId],
    queryFn: () => getAll<any>(COLLECTIONS.PROFORMA_INVOICES).then(r => r.filter((e: any) => !e.isDeleted)),
    enabled: Boolean(caseId),
    staleTime: 60_000,
  });

  const paymentsData = useQuery({
    queryKey: [...qkeys.leadsRoot, 'timeline-payments', caseId],
    queryFn: () => getAll<any>(COLLECTIONS.PAYMENTS).then(r => r.filter((e: any) => !e.isDeleted)),
    enabled: Boolean(caseId),
    staleTime: 60_000,
  });

  const dispatchData = useQuery({
    queryKey: [...qkeys.leadsRoot, 'timeline-dispatch', caseId],
    queryFn: () => getAll<any>(COLLECTIONS.DISPATCH).then(r => r.filter((e: any) => !e.isDeleted)),
    enabled: Boolean(caseId),
    staleTime: 60_000,
  });

  const installationsData = useQuery({
    queryKey: [...qkeys.leadsRoot, 'timeline-installations', caseId],
    queryFn: () => getAll<any>('installations').then(r => r.filter((e: any) => !e.isDeleted)),
    enabled: Boolean(caseId),
    staleTime: 60_000,
  });

  const qcChecksData = useQuery({
    queryKey: [...qkeys.leadsRoot, 'timeline-qc', caseId],
    queryFn: () => getAll<any>(COLLECTIONS.QC_CHECKS).then(r => r.filter((e: any) => !e.isDeleted)),
    enabled: Boolean(caseId),
    staleTime: 60_000,
  });

  const commissioningData = useQuery({
    queryKey: [...qkeys.leadsRoot, 'timeline-commissioning', caseId],
    queryFn: () => getAll<any>(COLLECTIONS.COMMISSIONING_RECORDS).then(r => r.filter((e: any) => !e.isDeleted)),
    enabled: Boolean(caseId),
    staleTime: 60_000,
  });

  const netMeteringData = useQuery({
    queryKey: [...qkeys.leadsRoot, 'timeline-netmetering', caseId],
    queryFn: () => getAll<any>(COLLECTIONS.NET_METERING_APPLICATIONS).then(r => r.filter((e: any) => !e.isDeleted)),
    enabled: Boolean(caseId),
    staleTime: 60_000,
  });

  const subsidyData = useQuery({
    queryKey: [...qkeys.leadsRoot, 'timeline-subsidy', caseId],
    queryFn: () => getAll<any>(COLLECTIONS.SUBSIDY_APPLICATIONS).then(r => r.filter((e: any) => !e.isDeleted)),
    enabled: Boolean(caseId),
    staleTime: 60_000,
  });

  const handoversData = useQuery({
    queryKey: [...qkeys.leadsRoot, 'timeline-handovers', caseId],
    queryFn: () => getAll<any>(COLLECTIONS.PROJECT_HANDOVERS).then(r => r.filter((e: any) => !e.isDeleted)),
    enabled: Boolean(caseId),
    staleTime: 60_000,
  });

  const amcData = useQuery({
    queryKey: [...qkeys.leadsRoot, 'timeline-amc', caseId],
    queryFn: () => getAll<any>(COLLECTIONS.AMC_CONTRACTS).then(r => r.filter((e: any) => !e.isDeleted)),
    enabled: Boolean(caseId),
    staleTime: 60_000,
  });

  const serviceTicketsData = useQuery({
    queryKey: [...qkeys.leadsRoot, 'timeline-tickets', caseId],
    queryFn: () => getAll<any>(COLLECTIONS.SERVICE_TICKETS).then(r => r.filter((e: any) => !e.isDeleted)),
    enabled: Boolean(caseId),
    staleTime: 60_000,
  });

  const generationData = useQuery({
    queryKey: [...qkeys.leadsRoot, 'timeline-readings', caseId],
    queryFn: () => getAll<any>(COLLECTIONS.GENERATION_READINGS).then(r => r.filter((e: any) => !e.isDeleted)),
    enabled: Boolean(caseId),
    staleTime: 60_000,
  });

  // ── Consolidate entity data ──────────────────────────────
  const allEntityData = useMemo(() => {
    const map: Record<string, any[]> = {};
    const filterByCase = (data: any[] | undefined) => {
      if (!data) return [];
      return data.filter((e: any) => String(e.caseId || e.linkedCaseId || '') === caseId);
    };

    map['lead'] = filterByCase(leadsData.data);
    map['customer'] = filterByCase(customersData.data);
    map['project'] = filterByCase(projectsData.data);
    map['quotation'] = filterByCase(quotationsData.data);
    map['order'] = filterByCase(ordersData.data);
    map['invoice'] = filterByCase(invoicesData.data);
    map['payment'] = filterByCase(paymentsData.data);
    map['dispatch'] = filterByCase(dispatchData.data);
    map['installation'] = filterByCase(installationsData.data);
    map['qc'] = filterByCase(qcChecksData.data);
    map['commissioning'] = filterByCase(commissioningData.data);
    map['net-metering'] = filterByCase(netMeteringData.data);
    map['subsidy'] = filterByCase(subsidyData.data);
    map['handover'] = filterByCase(handoversData.data);
    map['amc'] = filterByCase(amcData.data);
    map['service-tickets'] = filterByCase(serviceTicketsData.data);
    map['monitoring'] = filterByCase(generationData.data);

    return map;
  }, [caseId,
    leadsData.data, customersData.data,
    projectsData.data, quotationsData.data,
    ordersData.data, invoicesData.data,
    paymentsData.data, dispatchData.data,
    installationsData.data, qcChecksData.data,
    commissioningData.data, netMeteringData.data,
    subsidyData.data, handoversData.data,
    amcData.data, serviceTicketsData.data,
    generationData.data,
  ]);

  // ── Compute rich stage info ──────────────────────────────
  const stageInfos: RichStageInfo[] = useMemo(() => {
    const caseRecord = caseQuery.data as any;
    const leadId = caseRecord?.leadId || null;
    const customerId = caseRecord?.customerId || null;

    let previousCompletedTimestamp: string | null = null;

    return STAGES.map((stage) => {
      const entities = allEntityData[stage.key] || [];

      // Find the best entity (last completed first, then latest)
      const completedEntities = entities.filter((e: any) => {
        const { status: resolved } = resolveEntityStatus(stage.key, e);
        return resolved === 'completed';
      });
      const failedEntities = entities.filter((e: any) => {
        const { status: resolved } = resolveEntityStatus(stage.key, e);
        return resolved === 'failed' || resolved === 'cancelled';
      });
      const currentEntities = entities.filter((e: any) => {
        const { status: resolved } = resolveEntityStatus(stage.key, e);
        return resolved === 'current';
      });
      const skippedEntities = entities.filter((e: any) => {
        const { status: resolved } = resolveEntityStatus(stage.key, e);
        return resolved === 'skipped';
      });

      // Prefer entity by priority: completed > failed > current > skipped > first entity
      const bestEntity = completedEntities[0]
        || failedEntities[0]
        || currentEntities[0]
        || skippedEntities[0]
        || entities[0]
        || null;

      // Resolve status using the best entity
      const { status, failureReason, pendingReason } = resolveEntityStatus(stage.key, bestEntity);

      // Timestamps
      const createdAt = sanitizeTimestamp(bestEntity?.createdAt);
      const completedAt = sanitizeTimestamp(bestEntity?.completedAt || bestEntity?.updatedAt);
      const timestamp = sanitizeTimestamp(bestEntity?.createdAt || bestEntity?.completedAt || bestEntity?.updatedAt);
      const prevTimestamp = previousCompletedTimestamp;
      const duration = formatDuration(prevTimestamp, completedAt || createdAt || timestamp);

      // Update previous completed timestamp for duration calculation
      if (status === 'completed' && completedAt) {
        previousCompletedTimestamp = completedAt;
      }

      // Assigned user
      const assignedUserId = bestEntity?.assignedTo || bestEntity?.assigneeId || bestEntity?.userId || null;
      const assignedUserName = bestEntity?.assignedToName || bestEntity?.assigneeName || bestEntity?.userName || null;

      // Validation status
      const validationStatus: 'valid' | 'invalid' | 'unknown' = status === 'failed' ? 'invalid' : status === 'completed' ? 'valid' : 'unknown';

      // Health indicator
      const healthIndicator: 'good' | 'warning' | 'critical' | 'none' =
        status === 'failed' ? 'critical'
        : status === 'cancelled' ? 'warning'
        : status === 'current' ? 'warning'
        : status === 'completed' ? 'good'
        : 'none';

      // Navigation — only if workspace route exists and entity ID exists
      const entityId = bestEntity?.id || null;
      const route = entityId ? getWorkspaceRoute(stage.entityType, entityId) : null;
      const canNavigate = !!route;

      return {
        stage,
        status,
        entityId,
        entityStatus: bestEntity?.status || null,
        timestamp,
        assignedUserId,
        assignedUserName,
        createdAt,
        completedAt,
        failureReason: status === 'failed' ? failureReason : status === 'cancelled' ? failureReason : null,
        pendingReason: status === 'pending' || status === 'current' ? pendingReason : null,
        validationStatus,
        healthIndicator,
        canNavigate,
        route,
        previousTimestamp: prevTimestamp,
        duration,
      };
    });
  }, [caseQuery.data, allEntityData]);

  // ── Global metrics ───────────────────────────────────────
  const metrics = useMemo(() => {
    const statuses = stageInfos.map((s) => s.status);
    const names = stageInfos.map((s) => s.stage.label);
    const base = computeTimelineMetrics(statuses, names);

    // Lifecycle duration
    const firstTimestamp = stageInfos.find((s) => s.createdAt)?.createdAt || null;
    const lastTimestamp = [...stageInfos].reverse().find((s) => s.completedAt)?.completedAt || null;
    const totalDuration = formatDuration(firstTimestamp, lastTimestamp || new Date().toISOString());

    // Estimated remaining stages
    const progressedCount = base.completedCount + (base.currentCount > 0 ? 1 : 0) + base.skippedCount + base.cancelledCount;
    const remainingStages = base.totalStages - progressedCount;

    // Overall case health
    const criticalCount = stageInfos.filter((s) => s.healthIndicator === 'critical').length;
    const warningCount = stageInfos.filter((s) => s.healthIndicator === 'warning').length;
    const overallHealth: 'good' | 'warning' | 'critical' =
      criticalCount > 0 ? 'critical' : warningCount > 0 ? 'warning' : 'good';

    return {
      ...base,
      totalDuration,
      remainingStages,
      overallHealth,
      criticalCount,
      warningCount,
      firstTimestamp,
      lastTimestamp,
    };
  }, [stageInfos]);

  // ── Validation check handler ─────────────────────────────
  const handleQuickValidate = useCallback(async () => {
    if (!caseId) return;
    try {
      const { validateCaseIntegrity } = await import('../../../engines/CaseValidationEngine');
      const result = await validateCaseIntegrity(caseId);
      setValidationResult({
        healthy: result.healthy,
        totalErrors: result.totalErrors,
        lastChecked: new Date().toISOString(),
      });
    } catch {
      setValidationResult({ healthy: false, totalErrors: -1, lastChecked: null });
    }
  }, [caseId]);

  // ── Loading state ────────────────────────────────────────
  const isLoading = caseQuery.isLoading;

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="flex flex-col items-center justify-center py-16 text-[var(--color-text-muted)]">
          <Loader2 className="h-10 w-10 mb-3 opacity-40 animate-spin" />
          <p className="text-sm font-medium">Loading timeline...</p>
          <p className="text-xs mt-1 text-[var(--color-text-disabled)]">Fetching EPC lifecycle data</p>
        </div>
      </div>
    );
  }

  if (!caseId) {
    return (
      <div className="p-6">
        <div className="flex flex-col items-center justify-center py-16 text-[var(--color-text-muted)]">
          <AlertTriangle className="h-10 w-10 mb-3 opacity-40" />
          <p className="text-sm font-medium">No Case selected</p>
          <p className="text-xs mt-1">A Case ID is required to display the timeline.</p>
        </div>
      </div>
    );
  }

  // ── Health color resolution ──────────────────────────────
  const healthColors = {
    good: { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20', icon: CheckCircle2, label: 'Healthy' },
    warning: { text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20', icon: AlertTriangle, label: 'Warning' },
    critical: { text: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20', icon: XCircle, label: 'Critical' },
  };
  const healthCfg = healthColors[metrics.overallHealth];
  const HealthIcon = healthCfg.icon;

  return (
    <div className="p-6 space-y-6 animate-fadeIn">
      {/* ── GLOBAL METRICS HEADER ───────────────────────────── */}
      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5 shadow-sm">
        {/* Title row */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-[var(--color-primary)]" />
            <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--color-text)]">
              EPC Lifecycle Timeline
            </h3>
          </div>
          <div className="flex items-center gap-3">
            {/* Health badge */}
            <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold', healthCfg.text, healthCfg.bg)}>
              <HealthIcon className="h-3.5 w-3.5" />
              {healthCfg.label}
            </span>
            {/* Validate button */}
            <button
              type="button"
              onClick={handleQuickValidate}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-[var(--color-bg-sunken)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border-subtle)] transition-colors"
              title="Run case health validation"
            >
              <Check className="h-3 w-3" />
              Validate
            </button>
          </div>
        </div>

        {/* Progress section */}
        <div className="flex items-center gap-5 mb-4">
          {/* Progress ring */}
          <div className="relative shrink-0">
            <ProgressRing percent={metrics.progressPercent} size={56} />
            <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-[var(--color-text)]">
              {metrics.progressPercent}%
            </span>
          </div>

          {/* Stats grid */}
          <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <MetricStat label="Completed" value={metrics.completedCount} icon={CheckCircle2} highlight="success" />
            <MetricStat label="In Progress" value={metrics.currentCount} icon={Loader2} highlight="info" />
            <MetricStat label="Pending" value={metrics.pendingCount} icon={Clock} />
            <MetricStat label="Failed" value={metrics.failedCount} icon={XCircle} highlight={metrics.failedCount > 0 ? 'danger' : undefined} />
          </div>
        </div>

        {/* Bottom row: active stage, duration, skipped, cancelled */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--color-text-muted)]">
          {metrics.activeStageName && (
            <span className="inline-flex items-center gap-1">
              <TrendingUp className="h-3 w-3 text-blue-500" />
              Current: <strong className="text-[var(--color-text-secondary)]">{metrics.activeStageName}</strong>
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Duration: <strong className="text-[var(--color-text-secondary)]">{metrics.totalDuration}</strong>
          </span>
          {metrics.remainingStages > 0 && (
            <span className="inline-flex items-center gap-1">
              <BarChart3 className="h-3 w-3 text-indigo-500" />
              Remaining: <strong className="text-[var(--color-text-secondary)]">{metrics.remainingStages}</strong>
            </span>
          )}
          {metrics.skippedCount > 0 && (
            <span className="inline-flex items-center gap-1 text-amber-600">
              <SkipForward className="h-3 w-3" />
              Skipped: {metrics.skippedCount}
            </span>
          )}
          {metrics.cancelledCount > 0 && (
            <span className="inline-flex items-center gap-1 text-rose-600">
              <Ban className="h-3 w-3" />
              Cancelled: {metrics.cancelledCount}
            </span>
          )}
          {validationResult?.lastChecked && (
            <span className="inline-flex items-center gap-1 ml-auto">
              <Check className="h-3 w-3 text-emerald-500" />
              Last checked: {formatTimelineDate(validationResult.lastChecked)}
            </span>
          )}
        </div>

        {/* Progress bar */}
        <div className="mt-3 h-1.5 w-full rounded-full bg-[var(--color-bg-sunken)] overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-700 ease-out',
              metrics.progressPercent === 100 ? 'bg-emerald-500' : 'bg-gradient-to-r from-blue-500 to-indigo-500',
            )}
            style={{ width: `${metrics.progressPercent}%` }}
          />
        </div>
      </div>

      {/* ── TIMELINE ───────────────────────────────────────── */}
      <div className="relative">
        {/* Vertical connector line */}
        <div className="absolute left-6 top-0 bottom-0 w-px bg-gradient-to-b from-blue-400 via-emerald-400 to-gray-300 dark:from-blue-600 dark:via-emerald-600 dark:to-gray-700" />

        <div className="space-y-0">
          {stageInfos.map((info, index) => {
            const cfg = STATUS_VISUALS[info.status];

            return (
              <div key={info.stage.key} className="relative flex gap-4 pb-8 last:pb-0 group">
                {/* Timeline dot */}
                <div className="relative z-10 flex shrink-0 items-start pt-1">
                  <div
                    className={cn(
                      'flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all duration-300',
                      'group-hover:shadow-md group-hover:scale-110',
                      cfg.dotColor,
                      info.status === 'pending' || info.status === 'skipped' || info.status === 'cancelled'
                        ? 'bg-[var(--color-bg)]' : '',
                    )}
                  >
                    {resolveStageIcon(info.status, info.stage.icon)}
                  </div>
                  {/* Stage number badge */}
                  <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-bg-sunken)] text-[9px] font-bold text-[var(--color-text-muted)] border border-[var(--color-border-subtle)]">
                    {index + 1}
                  </span>
                </div>

                {/* Stage card */}
                <div
                  className={cn(
                    'flex-1 min-w-0 rounded-xl border p-4 transition-all duration-200',
                    'hover:shadow-sm',
                    cfg.bgColor,
                    info.canNavigate ? 'cursor-pointer hover:-translate-y-0.5' : '',
                  )}
                  onClick={() => {
                    if (info.canNavigate && info.route) {
                      navigate(info.route);
                    }
                  }}
                  role={info.canNavigate ? 'button' : undefined}
                  tabIndex={info.canNavigate ? 0 : undefined}
                  onKeyDown={(e) => {
                    if (info.canNavigate && info.route && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      navigate(info.route);
                    }
                  }}
                >
                  {/* Card header: icon, label, status badge */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <info.stage.icon className={cn('h-4 w-4 shrink-0', cfg.textColor)} />
                      <span className={cn('font-semibold text-sm', cfg.textColor)}>
                        {info.stage.label}
                      </span>
                      <StatusPill status={info.status} />
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {/* Entity status badge */}
                      {info.entityStatus && info.status !== 'pending' && (
                        <span className={cn(
                          'inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
                          cfg.badgeColor,
                        )}>
                          {info.entityStatus}
                        </span>
                      )}
                      {info.canNavigate && (
                        <ChevronRight className="h-4 w-4 text-[var(--color-text-muted)] transition-transform group-hover:translate-x-0.5" />
                      )}
                    </div>
                  </div>

                  {/* Description */}
                  <p className="text-xs text-[var(--color-text-muted)] mb-2">{info.stage.description}</p>

                  {/* Entity ID row */}
                  {info.entityId && (
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Hash className="h-3 w-3 text-[var(--color-text-disabled)]" />
                      <span className={cn(
                        'text-[11px] font-mono',
                        info.canNavigate
                          ? 'text-[var(--color-primary)] hover:underline'
                          : 'text-[var(--color-text-muted)]',
                      )}>
                        {info.entityId}
                        {!info.canNavigate && (
                          <span className="ml-1 text-[9px] text-[var(--color-text-disabled)]">(no workspace)</span>
                        )}
                      </span>
                    </div>
                  )}

                  {/* Metadata grid */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
                    {/* Timestamp */}
                    {info.timestamp && (
                      <div className="flex items-center gap-1.5">
                        <Calendar className="h-3 w-3 text-[var(--color-text-disabled)]" />
                        <span className="text-[11px] text-[var(--color-text-muted)]" title={formatTimelineDateFull(info.timestamp)}>
                          {formatTimelineDate(info.timestamp)}
                        </span>
                      </div>
                    )}

                    {/* Duration */}
                    {info.duration !== '—' && (
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3 w-3 text-[var(--color-text-disabled)]" />
                        <span className="text-[11px] text-[var(--color-text-muted)]">
                          {info.duration}
                        </span>
                      </div>
                    )}

                    {/* Assigned user */}
                    {info.assignedUserName && (
                      <div className="flex items-center gap-1.5">
                        <User className="h-3 w-3 text-[var(--color-text-disabled)]" />
                        <span className="text-[11px] text-[var(--color-text-muted)] truncate">
                          {info.assignedUserName}
                        </span>
                      </div>
                    )}

                    {/* Health indicator */}
                    <div className="flex items-center gap-1.5">
                      <HealthDot level={info.healthIndicator} />
                      <span className="text-[11px] text-[var(--color-text-muted)]">
                        {info.healthIndicator === 'good' ? 'Healthy'
                          : info.healthIndicator === 'warning' ? 'At Risk'
                          : info.healthIndicator === 'critical' ? 'Critical'
                          : '—'}
                      </span>
                    </div>
                  </div>

                  {/* Failure reason — highlighted */}
                  {info.failureReason && (
                    <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-red-50 dark:bg-red-900/20 px-2.5 py-1.5">
                      <AlertTriangle className="h-3 w-3 text-red-500 mt-0.5 shrink-0" />
                      <span className="text-[11px] text-red-700 dark:text-red-300">{info.failureReason}</span>
                    </div>
                  )}

                  {/* Pending reason */}
                  {info.pendingReason && info.status === 'pending' && (
                    <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 px-2.5 py-1.5">
                      <Info className="h-3 w-3 text-amber-500 mt-0.5 shrink-0" />
                      <span className="text-[11px] text-amber-700 dark:text-amber-300">{info.pendingReason}</span>
                    </div>
                  )}

                  {/* Validation status */}
                  {info.validationStatus !== 'unknown' && (
                    <div className="mt-2 flex items-center gap-1.5">
                      {info.validationStatus === 'valid' ? (
                        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                      ) : (
                        <XCircle className="h-3 w-3 text-red-500" />
                      )}
                      <span className={cn(
                        'text-[10px] font-semibold',
                        info.validationStatus === 'valid' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
                      )}>
                        {info.validationStatus === 'valid' ? 'Validated' : 'Validation Failed'}
                      </span>
                    </div>
                  )}

                  {/* Animated progress bar for current stage */}
                  {info.status === 'current' && (
                    <div className="mt-3 h-1 w-full rounded-full bg-[var(--color-bg)] overflow-hidden">
                      <div className="h-full w-2/3 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 animate-pulse" />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── TIMELINE LEGEND ───────────────────────────────── */}
      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Legend</span>
          {(Object.entries(STATUS_VISUALS) as [TimelineStageStatus, typeof STATUS_VISUALS[TimelineStageStatus]][]).map(([key, v]) => (
            <span key={key} className="flex items-center gap-1.5">
              <span className={cn('inline-block h-2 w-2 rounded-full', v.dotColor.split(' ')[0])} />
              <span className="text-[10px] text-[var(--color-text-muted)]">{v.label}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default CaseTimelineTab;
