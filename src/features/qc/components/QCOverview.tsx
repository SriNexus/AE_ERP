/**
 * QCOverview — Phase 7C Quality Gate
 *
 * 8 sections:
 *   1. Header (QC ID, Project Name, Status, Inspector)
 *   2. 6 KPI cards (Checklist Completion %, Defects Found, Rework Items, Days Open, Safety Score, Commissioning Readiness)
 *   3. QC Checklist Timeline (11 stages)
 *   4. Installation Summary (project, installation, customer, capacity, site, team)
 *   5. Defects & Observations
 *   6. QC Checklist (12 items: Pass/Fail/Needs Rework/Notes)
 *   7. Tasks Overview
 *   8. Recent Activity
 */

import { useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  XCircle,
  ClipboardCheck,
  AlertTriangle,
  Calendar,
  Clock,
  User,
  Building2,
  FolderKanban,
  Zap,
  MapPin,
  Users,
  Activity,
  Shield,
  HardHat,
  RotateCcw,
} from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { cn } from '../../../utils/cn';
import type { QCRecord } from '../../../lib/qcWorkflow';

// ── Helpers ────────────────────────────────────────────────

function fmtDateSafe(value: unknown): string {
  if (!value) return '—';
  if (typeof value === 'object' && value && 'toDate' in value && typeof value.toDate === 'function') {
    const d = value.toDate();
    return `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })} ${d.getFullYear()}`;
  }
  if (typeof value === 'object' && value && 'seconds' in value) {
    const d = new Date(Number((value as { seconds: number }).seconds) * 1000);
    return `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })} ${d.getFullYear()}`;
  }
  return String(value);
}

function MetricTile({ label, value, icon }: { label: string; value: string | number; icon: ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 transition-all duration-150 hover:shadow-sm hover:border-[var(--color-border)]">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-[var(--color-text-muted)]">{label}</span>
        <span className="text-[var(--color-text-muted)] opacity-60">{icon}</span>
      </div>
      <p className="mt-1.5 text-xl font-bold tabular-nums text-[var(--color-text)]">{value}</p>
    </div>
  );
}

function SectionCard({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
      {title && (
        <div className="mb-3 flex items-center gap-2">
          {icon && <span className="text-[var(--color-text-muted)]">{icon}</span>}
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{title}</h3>
        </div>
      )}
      {children}
    </div>
  );
}

function DetailRow({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
        {icon}
        <span>{label}</span>
      </div>
      <span className="text-xs font-medium text-[var(--color-text)]">{value}</span>
    </div>
  );
}

// QC Timeline stages
const QC_STAGES = [
  'assigned',
  'site_inspection_started',
  'structure_verified',
  'panels_verified',
  'inverter_verified',
  'electrical_verified',
  'safety_verified',
  'documentation_verified',
  'customer_signoff',
  'qc_approved',
  'commissioning_eligible',
] as const;

const QC_STAGE_LABELS: Record<string, string> = {
  assigned: 'Assigned',
  site_inspection_started: 'Site Inspection Started',
  structure_verified: 'Structure Verified',
  panels_verified: 'Panels Verified',
  inverter_verified: 'Inverter Verified',
  electrical_verified: 'Electrical Verified',
  safety_verified: 'Safety Verified',
  documentation_verified: 'Documentation Verified',
  customer_signoff: 'Customer Signoff',
  qc_approved: 'QC Approved',
  commissioning_eligible: 'Commissioning Eligible',
};

// ── Props ───────────────────────────────────────────────────

export interface QCOverviewProps {
  qc: QCRecord | null;
  project?: Record<string, unknown> | null;
  installation?: Record<string, unknown> | null;
}

// ── Main Component ──────────────────────────────────────────

export default function QCOverview({ qc, project, installation }: QCOverviewProps) {
  const navigate = useNavigate();

  if (!qc) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center">
        <ClipboardCheck className="h-10 w-10 text-[var(--color-text-muted)] opacity-40" />
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">No QC data available</p>
      </div>
    );
  }

  const status = qc?.status || 'pending';
  const totalItems = qc?.totalItems || qc?.checklistItems?.length || 0;
  const passedCount = qc?.passedCount || qc?.checklistItems?.filter((i) => i.passed)?.length || 0;
  const failedCount = qc?.failedCount ?? (totalItems - passedCount);
  const passRate = totalItems > 0 ? Math.round((passedCount / totalItems) * 100) : 0;
  const daysOpen = qc?.createdAt ? Math.floor((Date.now() - new Date(qc.createdAt).getTime()) / 86400000) : 0;

  // Safety score — prefer real field, fall back to mock
  const safetyScore = typeof (qc as any).safetyScore === 'number' ? (qc as any).safetyScore : (status === 'passed' ? 95 : status === 'in_progress' ? 70 : 0);
  const defectsFound = failedCount;
  const reworkItems = status === 'failed' ? failedCount : 0;

  // Current stage index for timeline (derived from status)
  const currentStageIndex = status === 'passed' ? QC_STAGES.length - 1 : status === 'failed' ? QC_STAGES.indexOf('qc_approved') - 1 : status === 'in_progress' ? QC_STAGES.indexOf('site_inspection_started') : 0;

  const commissioningEligible = typeof (qc as any).commissioningEligible === 'boolean' ? ((qc as any).commissioningEligible ? 'Yes' : 'No') : (status === 'passed' ? 'Yes' : status === 'failed' ? 'No' : 'Pending');
  const customerSignoff = typeof (qc as any).customerSignoff === 'boolean' ? ((qc as any).customerSignoff ? 'Yes' : 'No') : (currentStageIndex >= QC_STAGES.indexOf('customer_signoff') ? 'Yes' : 'Pending');

  const inspectorName = qc?.inspectorName || '—';
  const projectId = qc?.projectId || '—';
  const installationName = qc?.installationName || (installation as any)?.name || '—';
  const customerName = (project as any)?.customerName || '—';
  const capacity = (project as any)?.capacityKw || (project as any)?.systemSizeKW || '—';
  const site = (project as any)?.siteAddress || (project as any)?.site || '—';
  const installationTeam = (installation as any)?.assignedEngineerName || '—';

  const passFailStatus = status === 'passed' ? 'Passed' : status === 'failed' ? 'Failed' : status === 'in_progress' ? 'In Progress' : 'Pending';

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* ── Section 1: Header ──────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-[var(--color-text-muted)]" />
            <span className="text-xs font-mono font-medium text-[var(--color-text-muted)]">
              {qc?.id ? `#${String(qc.id).slice(-8)}` : '—'}
            </span>
            <Badge variant={status === 'passed' ? 'success' : status === 'failed' ? 'danger' : status === 'in_progress' ? 'warning' : 'default'}>
              {passFailStatus}
            </Badge>
          </div>
          <h2 className="text-lg font-bold text-[var(--color-text)]">QC Check {qc?.id ? String(qc.id).slice(-8) : ''}</h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-sunken)] px-2 py-0.5">
              <FolderKanban className="h-3 w-3" />
              {projectId}
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-sunken)] px-2 py-0.5">
              <User className="h-3 w-3" />
              {inspectorName}
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-sunken)] px-2 py-0.5">
              <ClipboardCheck className="h-3 w-3" />
              {passedCount}/{totalItems} passed
            </span>
          </div>
        </div>
      </div>

      {/* ── Section 2: 6 KPI Cards ─────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricTile label="Checklist Completion" value={`${passRate}%`} icon={<ClipboardCheck className="h-4 w-4" />} />
        <MetricTile label="Defects Found" value={defectsFound} icon={<XCircle className="h-4 w-4" />} />
        <MetricTile label="Rework Items" value={reworkItems} icon={<RotateCcw className="h-4 w-4" />} />
        <MetricTile label="Days Open" value={daysOpen} icon={<Clock className="h-4 w-4" />} />
        <MetricTile label="Safety Score" value={typeof safetyScore === 'number' ? `${safetyScore}%` : safetyScore} icon={<Shield className="h-4 w-4" />} />
        <MetricTile label="Commissioning Ready" value={commissioningEligible} icon={<CheckCircle2 className="h-4 w-4" />} />
      </div>

      {/* ── Section 3: Timeline + Section 4: Installation Summary ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
        {/* Checklist Timeline */}
        <SectionCard title="QC Checklist Timeline" icon={<Clock className="h-3.5 w-3.5" />}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-2">
            {QC_STAGES.map((stage, i) => (
              <TimelineStage
                key={stage}
                index={i}
                total={QC_STAGES.length}
                isCurrent={i === currentStageIndex}
                isPast={i < currentStageIndex}
                label={QC_STAGE_LABELS[stage] || stage.replace(/_/g, ' ')}
              />
            ))}
          </div>
        </SectionCard>

        {/* Installation Summary */}
        <div className="space-y-4">
          <SectionCard title="Installation Summary" icon={<HardHat className="h-3.5 w-3.5" />}>
            <div className="space-y-2">
              <DetailRow label="Project" value={projectId} icon={<FolderKanban className="h-3 w-3" />} />
              <DetailRow label="Installation" value={installationName} icon={<Building2 className="h-3 w-3" />} />
              <DetailRow label="Customer" value={customerName} icon={<User className="h-3 w-3" />} />
              <DetailRow label="Capacity" value={String(capacity)} icon={<Zap className="h-3 w-3" />} />
              <DetailRow label="Site" value={site} icon={<MapPin className="h-3 w-3" />} />
              <DetailRow label="Installation Team" value={installationTeam} icon={<Users className="h-3 w-3" />} />
              <DetailRow label="Inspector" value={inspectorName} icon={<User className="h-3 w-3" />} />
            </div>
          </SectionCard>

          {/* Dates */}
          <SectionCard title="Timeline" icon={<Calendar className="h-3.5 w-3.5" />}>
            <div className="space-y-2">
              <DetailRow label="Created" value={fmtDateSafe(qc?.createdAt)} />
              <DetailRow label="Submitted" value={qc?.submittedAt ? fmtDateSafe(qc.submittedAt) : '—'} />
              <DetailRow label="Completed" value={qc?.completedAt ? fmtDateSafe(qc.completedAt) : '—'} />
              <DetailRow label="Days Open" value={String(daysOpen)} />
            </div>
          </SectionCard>
        </div>
      </div>

      {/* ── Section 5: Defects & Observations ──────────────── */}
      <SectionCard title="Defects & Observations" icon={<XCircle className="h-3.5 w-3.5" />}>
        {failedCount === 0 ? (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/10 px-3 py-2.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">No defects found — all checklist items passed</p>
          </div>
        ) : (
          <div className="space-y-2">
            {qc?.checklistItems?.filter((item) => !item.passed).map((item, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/10 px-3 py-2.5">
                <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-red-800 dark:text-red-200">{item.item}</p>
                  {item.notes && <p className="text-[10px] text-red-600 dark:text-red-400 mt-0.5">{item.notes}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── Section 6: QC Checklist ────────────────────────── */}
      <SectionCard title="QC Checklist" icon={<ClipboardCheck className="h-3.5 w-3.5" />}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {qc?.checklistItems?.map((item, i) => {
            const isChecked = item.inspectedAt != null;
            return (
              <div
                key={i}
                className={cn(
                  'flex items-start gap-2.5 rounded-lg border p-2.5 text-xs',
                  item.passed === true && 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/10',
                  item.passed === false && 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/10',
                  !isChecked && 'border-[var(--color-border-subtle)] bg-[var(--color-bg)]',
                )}
              >
                <div className={cn(
                  'mt-0.5 h-4 w-4 rounded border-2 flex items-center justify-center shrink-0',
                  item.passed === true && 'bg-emerald-500 border-emerald-500 text-white',
                  item.passed === false && 'bg-red-500 border-red-500 text-white',
                  !isChecked && 'border-[var(--color-border)]',
                )}>
                  {item.passed === true && <CheckCircle2 className="h-3 w-3" />}
                  {item.passed === false && <XCircle className="h-3 w-3" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    'font-medium',
                    item.passed === true && 'line-through text-emerald-700 dark:text-emerald-300',
                    item.passed === false && 'text-red-700 dark:text-red-300',
                  )}>
                    {item.item}
                  </p>
                  {item.notes && (
                    <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">{item.notes}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* ── Section 7 & 8: Tasks + Activity (bottom row) ─── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Tasks Overview */}
        <SectionCard title="Tasks Overview" icon={<ClipboardCheck className="h-3.5 w-3.5" />}>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-[var(--color-bg-sunken)] p-3 text-center">
              <p className="text-lg font-bold tabular-nums text-[var(--color-text)]">—</p>
              <p className="text-[10px] font-medium text-[var(--color-text-muted)]">Total</p>
            </div>
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/10 p-3 text-center">
              <p className="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">—</p>
              <p className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">Completed</p>
            </div>
            <div className="rounded-lg bg-amber-50 dark:bg-amber-900/10 p-3 text-center">
              <p className="text-lg font-bold tabular-nums text-amber-600 dark:text-amber-400">—</p>
              <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400">Pending</p>
            </div>
          </div>
        </SectionCard>

        {/* Recent Activity */}
        <SectionCard title="Recent Activity" icon={<Activity className="h-3.5 w-3.5" />}>
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <Activity className="h-5 w-5 text-[var(--color-text-muted)] mb-2 opacity-40" />
            <p className="text-xs text-[var(--color-text-muted)]">No recent activity</p>
            <p className="text-[10px] text-[var(--color-text-muted)] opacity-60">Activity will appear here as work progresses</p>
          </div>
        </SectionCard>
      </div>

      {/* Notes */}
      {qc?.overallNotes && (
        <SectionCard title="Overall Notes">
          <p className="text-sm text-[var(--color-text)] whitespace-pre-wrap">{qc.overallNotes}</p>
        </SectionCard>
      )}
    </div>
  );
}

// ── Timeline Stage Helper ─────────────────────────────────

function TimelineStage({ index, total, isCurrent, isPast, label }: {
  index: number; total: number; isCurrent: boolean; isPast: boolean; label: string;
}) {
  const isLast = index === total - 1;
  return (
    <div className="flex items-start gap-2">
      <div className="flex flex-col items-center">
        <div
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-all',
            isPast ? 'bg-emerald-500 text-white' :
            isCurrent ? 'bg-indigo-500 text-white ring-2 ring-indigo-200 dark:ring-indigo-800' :
            'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]',
          )}
        >
          {isPast ? (
            <CheckCircle2 className="h-3 w-3" />
          ) : isCurrent ? (
            <Clock className="h-3 w-3" />
          ) : (
            <div className="h-1.5 w-1.5 rounded-full bg-current" />
          )}
        </div>
        {!isLast && <div className={cn('w-px flex-1 min-h-[12px]', isPast ? 'bg-emerald-200 dark:bg-emerald-800' : 'bg-[var(--color-border-subtle)]')} />}
      </div>
      <div className={cn('pb-2 text-[11px] font-medium', isCurrent ? 'text-[var(--color-text)]' : isPast ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--color-text-muted)]')}>
        {label}
      </div>
    </div>
  );
}
