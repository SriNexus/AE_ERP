/**
 * NetMeteringOverview — Phase 7E Government Integration
 *
 * 8 sections:
 *   1. Header (Application Number, Project Name, Status, DISCOM)
 *   2. 6 KPI cards (Days Open, Meter Status, Export Status, Inspection Status, Subsidy Eligibility, Completion %)
 *   3. Net Metering Timeline (9 stages)
 *   4. Application Details (project, commissioning, customer, capacity, DISCOM, app number)
 *   5. DISCOM Details (name, circle, officer, contact, submission date, expected approval)
 *   6. Document Checklist (7 mandatory items)
 *   7. Tasks Overview
 *   8. Recent Activity
 */

import { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Zap,
  CheckCircle2,
  XCircle,
  Clock,
  User,
  Building2,
  FolderKanban,
  Calendar,
  Activity,
  FileText,
  ClipboardCheck,
  Shield,
  HardHat,
} from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { cn } from '../../../utils/cn';
import type { NetMeteringApplication, NetMeteringStatus } from '../../../lib/netMeteringWorkflow';

// ── Status colors ─────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  Submitted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  UnderReview: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  Approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  MeterInstalled: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  Rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

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

// Net Metering Timeline stages
const NM_STAGES = [
  'application_created',
  'submitted_to_discom',
  'documents_verified',
  'inspection_scheduled',
  'inspection_completed',
  'meter_installed',
  'export_enabled',
  'approved',
  'subsidy_eligible',
] as const;

const NM_STAGE_LABELS: Record<string, string> = {
  application_created: 'Application Created',
  submitted_to_discom: 'Submitted to DISCOM',
  documents_verified: 'Documents Verified',
  inspection_scheduled: 'Inspection Scheduled',
  inspection_completed: 'Inspection Completed',
  meter_installed: 'Meter Installed',
  export_enabled: 'Export Enabled',
  approved: 'Approved',
  subsidy_eligible: 'Subsidy Eligible',
};

// Map NetMetering status to timeline stage index
function statusToStageIndex(status: NetMeteringStatus): number {
  switch (status) {
    case 'Submitted': return 1; // submitted_to_discom
    case 'UnderReview': return 3; // inspection_scheduled
    case 'Approved': return 7; // approved
    case 'MeterInstalled': return 5; // meter_installed
    case 'Rejected': return 4; // inspection_completed (before meter)
    default: return 0;
  }
}

// ── Props ───────────────────────────────────────────────────

export interface NetMeteringOverviewProps {
  record: NetMeteringApplication | null;
  project?: Record<string, unknown> | null;
  commissioningRecords?: Record<string, unknown>[];
  subsidyApps?: Record<string, unknown>[];
}

// ── Main Component ──────────────────────────────────────────

export default function NetMeteringOverview({
  record,
  project,
  commissioningRecords,
  subsidyApps,
}: NetMeteringOverviewProps) {
  const navigate = useNavigate();

  if (!record) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center">
        <Zap className="h-10 w-10 text-[var(--color-text-muted)] opacity-40" />
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">No net metering data available</p>
      </div>
    );
  }

  const status = record?.status || 'Submitted';
  const daysOpen = record?.createdAt ? Math.floor((Date.now() - new Date(record.createdAt).getTime()) / 86400000) : 0;
  const meterInstalled = status === 'MeterInstalled' || status === 'Approved';
  const exportEnabled = status === 'MeterInstalled' || status === 'Approved';
  const inspectionCompleted = status === 'UnderReview' || status === 'Approved' || status === 'MeterInstalled';
  const subsidyEligible = status === 'MeterInstalled' || status === 'Approved';
  const completionPct = status === 'MeterInstalled' ? 100 : status === 'Approved' ? 85 : status === 'UnderReview' ? 50 : status === 'Submitted' ? 25 : 10;

  const projectName = (project as any)?.projectId || record?.projectName || record?.projectId || '—';
  const customerName = (project as any)?.customerName || '—';
  const capacity = (project as any)?.capacityKw || (project as any)?.systemSizeKW || '—';
  const commissioningRef = commissioningRecords && commissioningRecords.length > 0
    ? String((commissioningRecords[0] as any).id || '').slice(-8)
    : '—';
  const subsidyCount = subsidyApps?.length || 0;

  const docChecklist = [
    { name: 'Customer ID', done: true },
    { name: 'Electricity Bill', done: true },
    { name: 'Installation Photos', done: status !== 'Submitted' },
    { name: 'Commissioning Certificate', done: true },
    { name: 'DISCOM Forms', done: true },
    { name: 'Approval Letter', done: status === 'Approved' || status === 'MeterInstalled' },
    { name: 'Meter Installation Proof', done: status === 'MeterInstalled' },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* ── Section 1: Header ──────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-[var(--color-text-muted)]" />
            <span className="text-xs font-mono font-medium text-[var(--color-text-muted)]">
              {record?.applicationNumber ? `#${record.applicationNumber}` : '—'}
            </span>
            <span className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
              STATUS_COLORS[status] || 'bg-gray-100 text-gray-700',
            )}>
              {status === 'UnderReview' ? 'Under Review' : status}
            </span>
          </div>
          <h2 className="text-lg font-bold text-[var(--color-text)]">Net Metering — {record?.applicationNumber || ''}</h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-sunken)] px-2 py-0.5">
              <FolderKanban className="h-3 w-3" />
              {projectName}
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-sunken)] px-2 py-0.5">
              <Building2 className="h-3 w-3" />
              {record?.discomName}
            </span>
          </div>
        </div>
      </div>

      {/* ── Section 2: 6 KPI Cards ─────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricTile label="Days Open" value={daysOpen} icon={<Clock className="h-4 w-4" />} />
        <MetricTile label="Meter Status" value={meterInstalled ? 'Installed' : 'Pending'} icon={<HardHat className="h-4 w-4" />} />
        <MetricTile label="Export Status" value={exportEnabled ? 'Enabled' : 'Pending'} icon={<Zap className="h-4 w-4" />} />
        <MetricTile label="Inspection" value={inspectionCompleted ? 'Completed' : 'Pending'} icon={<ClipboardCheck className="h-4 w-4" />} />
        <MetricTile label="Subsidy Eligibility" value={subsidyEligible ? 'Eligible' : 'Pending'} icon={<Shield className="h-4 w-4" />} />
        <MetricTile label="Completion" value={`${completionPct}%`} icon={<CheckCircle2 className="h-4 w-4" />} />
      </div>

      {/* ── Section 3: Timeline + Section 4: Application Details ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
        {/* Net Metering Timeline */}
        <SectionCard title="Net Metering Timeline" icon={<Clock className="h-3.5 w-3.5" />}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-2">
            {NM_STAGES.map((stage, i) => {
              const currentStageIdx = statusToStageIndex(status);
              return (
                <TimelineStage
                  key={stage}
                  index={i}
                  total={NM_STAGES.length}
                  isCurrent={i === currentStageIdx}
                  isPast={i < currentStageIdx}
                  label={NM_STAGE_LABELS[stage] || stage.replace(/_/g, ' ')}
                />
              );
            })}
          </div>
        </SectionCard>

        {/* Application Details */}
        <div className="space-y-4">
          <SectionCard title="Application Details" icon={<FileText className="h-3.5 w-3.5" />}>
            <div className="space-y-2">
              <DetailRow label="Project" value={projectName} icon={<FolderKanban className="h-3 w-3" />} />
              <DetailRow label="Commissioning" value={commissioningRef} icon={<Zap className="h-3 w-3" />} />
              <DetailRow label="Customer" value={customerName} icon={<User className="h-3 w-3" />} />
              <DetailRow label="Capacity" value={String(capacity)} icon={<Shield className="h-3 w-3" />} />
              <DetailRow label="DISCOM" value={record?.discomName || '—'} icon={<Building2 className="h-3 w-3" />} />
              <DetailRow label="Application No." value={record?.applicationNumber || '—'} icon={<FileText className="h-3 w-3" />} />
            </div>
          </SectionCard>

          {/* Dates */}
          <SectionCard title="Timeline" icon={<Calendar className="h-3.5 w-3.5" />}>
            <div className="space-y-2">
              <DetailRow label="Submitted" value={fmtDateSafe(record?.submittedDate)} />
              <DetailRow label="Approved" value={record?.approvedDate ? fmtDateSafe(record.approvedDate) : '—'} />
              <DetailRow label="Meter Installed" value={record?.meterInstalledDate ? fmtDateSafe(record.meterInstalledDate) : '—'} />
              <DetailRow label="Created" value={fmtDateSafe(record?.createdAt)} />
            </div>
          </SectionCard>
        </div>
      </div>

      {/* ── Section 5: DISCOM Details ──────────────────────── */}
      <SectionCard title="DISCOM Details" icon={<Building2 className="h-3.5 w-3.5" />}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">DISCOM Name</p>
            <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">{record?.discomName || '—'}</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Circle / Region</p>
            <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">—</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Submission Date</p>
            <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">{fmtDateSafe(record?.submittedDate)}</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Expected Approval</p>
            <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">{record?.expectedMeterInstallationDate ? fmtDateSafe(record.expectedMeterInstallationDate) : '—'}</p>
          </div>
        </div>
      </SectionCard>

      {/* ── Section 6: Document Checklist ──────────────────── */}
      <SectionCard title="Document Checklist" icon={<ClipboardCheck className="h-3.5 w-3.5" />}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {docChecklist.map((doc, i) => (
            <div
              key={i}
              className={cn(
                'flex items-center gap-2.5 rounded-lg border p-2.5 text-xs',
                doc.done
                  ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/10'
                  : 'border-[var(--color-border-subtle)]',
              )}
            >
              {doc.done ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
              ) : (
                <Clock className="h-4 w-4 text-amber-500 shrink-0" />
              )}
              <span className={doc.done ? 'text-emerald-700 dark:text-emerald-300 line-through' : 'text-[var(--color-text)]'}>
                {doc.name}
              </span>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* ── Section 7 & 8: Tasks + Activity ────────────────── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
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

        <SectionCard title="Recent Activity" icon={<Activity className="h-3.5 w-3.5" />}>
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <Activity className="h-5 w-5 text-[var(--color-text-muted)] mb-2 opacity-40" />
            <p className="text-xs text-[var(--color-text-muted)]">No recent activity</p>
          </div>
        </SectionCard>
      </div>

      {/* Notes */}
      {record?.notes && (
        <SectionCard title="Notes">
          <p className="text-sm text-[var(--color-text)] whitespace-pre-wrap">{record.notes}</p>
        </SectionCard>
      )}

      {/* Rejection banner */}
      {status === 'Rejected' && record?.rejectionReason && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/10 p-3">
          <div className="flex items-start gap-2">
            <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-red-700 dark:text-red-300">Application Rejected</p>
              <p className="text-[10px] text-red-600 dark:text-red-400 mt-0.5">{record.rejectionReason}</p>
            </div>
          </div>
        </div>
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
