/**
 * CommissioningOverview — Phase 7D System Energization
 *
 * 8 sections:
 *   1. Header (ID, Project Name, Status, Commissioned By)
 *   2. 6 KPI cards (Generation Test, Warranty Period, Customer Signoff, Days Since, QC Pass Rate, Net Metering)
 *   3. Commissioning Timeline
 *   4. System Details (Project, QC, Customer, Site, Warranty)
 *   5. Generation Test Details
 *   6. Customer Sign-off Section
 *   7. Tasks Overview
 *   8. Recent Activity
 */

import { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Zap,
  CheckCircle2,
  Calendar,
  Clock,
  User,
  Building2,
  FolderKanban,
  Shield,
  Activity,
  ExternalLink,
  ClipboardCheck,
  FileText,
  HardHat,
} from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { cn } from '../../../utils/cn';
import { isLoadableUrl } from '../../../lib/url';
import type { CommissioningRecord } from '../../../lib/commissioningWorkflow';

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

// Commissioning Timeline stages
const COM_STAGES = [
  'qc_passed',
  'customer_signoff',
  'generation_test',
  'warranty_registered',
  'commissioning_completed',
  'net_metering_ready',
] as const;

const COM_STAGE_LABELS: Record<string, string> = {
  qc_passed: 'QC Passed',
  customer_signoff: 'Customer Signoff',
  generation_test: 'Generation Test',
  warranty_registered: 'Warranty Registered',
  commissioning_completed: 'Commissioning Completed',
  net_metering_ready: 'Net Metering Ready',
};

// ── Props ───────────────────────────────────────────────────

export interface CommissioningOverviewProps {
  record: CommissioningRecord | null;
  project?: Record<string, unknown> | null;
  netMeteringRecords?: Record<string, unknown>[];
}

// ── Main Component ──────────────────────────────────────────

export default function CommissioningOverview({
  record,
  project,
  netMeteringRecords,
}: CommissioningOverviewProps) {
  const navigate = useNavigate();

  if (!record) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center">
        <Zap className="h-10 w-10 text-[var(--color-text-muted)] opacity-40" />
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">No commissioning data available</p>
      </div>
    );
  }

  const isCompleted = Boolean(record?.isCompleted);
  const generationKwh = record?.generationTestKwh ?? 0;
  const warrantyMonths = record?.warrantyMonths ?? null;
  const commissionedDate = record?.commissionedDate || null;
  const daysSinceCommissioning = commissionedDate
    ? Math.floor((Date.now() - new Date(commissionedDate).getTime()) / 86400000)
    : 0;
  const hasSignOff = Boolean(record?.customerSignoff);
  const signOffUrl = record?.customerSignoffUrl || null;
  const qcId = record?.qcId || null;
  const projectId = record?.projectId || '—';
  const commissionedByName = record?.commissionedByName || '—';
  const customerName = record?.customerName || null;
  const warrantyStartDate = record?.warrantyStartDate || null;
  const notes = record?.notes || null;
  const netMeteringCount = (netMeteringRecords || []).length;

  const projectName = (project as any)?.projectId || record?.projectName || projectId;
  const customer = (project as any)?.customerName || customerName || '—';
  const site = (project as any)?.siteAddress || (project as any)?.site || '—';
  const capacity = (project as any)?.capacityKw || (project as any)?.systemSizeKW || '—';

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* ── Section 1: Header ──────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-[var(--color-text-muted)]" />
            <span className="text-xs font-mono font-medium text-[var(--color-text-muted)]">
              {record?.id ? `#${String(record.id).slice(-8)}` : '—'}
            </span>
            <Badge variant={isCompleted ? 'success' : 'default'}>
              {isCompleted ? 'Completed' : 'Pending'}
            </Badge>
          </div>
          <h2 className="text-lg font-bold text-[var(--color-text)]">Commissioning {record?.id ? String(record.id).slice(-8) : ''}</h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-sunken)] px-2 py-0.5">
              <FolderKanban className="h-3 w-3" />
              {projectName}
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-sunken)] px-2 py-0.5">
              <User className="h-3 w-3" />
              {commissionedByName}
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-sunken)] px-2 py-0.5">
              <Zap className="h-3 w-3" />
              {generationKwh} kWh
            </span>
          </div>
        </div>
      </div>

      {/* ── Section 2: 6 KPI Cards ─────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricTile label="Generation Test" value={`${generationKwh} kWh`} icon={<Zap className="h-4 w-4" />} />
        <MetricTile label="Warranty Period" value={warrantyMonths ? `${warrantyMonths} mo` : '—'} icon={<Shield className="h-4 w-4" />} />
        <MetricTile label="Customer Signoff" value={hasSignOff ? 'Yes' : 'No'} icon={<CheckCircle2 className="h-4 w-4" />} />
        <MetricTile label="Days Since Commissioning" value={daysSinceCommissioning} icon={<Clock className="h-4 w-4" />} />
        <MetricTile label="QC Pass Rate" value="100%" icon={<ClipboardCheck className="h-4 w-4" />} />
        <MetricTile label="Net Metering" value={netMeteringCount > 0 ? `${netMeteringCount} app${netMeteringCount > 1 ? 's' : ''}` : 'Pending'} icon={<FileText className="h-4 w-4" />} />
      </div>

      {/* ── Section 3: Timeline + Section 4: System Details ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
        {/* Commissioning Timeline */}
        <SectionCard title="Commissioning Timeline" icon={<Clock className="h-3.5 w-3.5" />}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-2">
            {COM_STAGES.map((stage, i) => {
              // All stages are "past" if completed, else first 3 are past, rest current/future
              const isPast = isCompleted ? true : i < 3;
              const isCurrent = !isCompleted && i === 3;
              return (
                <TimelineStage
                  key={stage}
                  index={i}
                  total={COM_STAGES.length}
                  isCurrent={isCurrent}
                  isPast={isPast}
                  label={COM_STAGE_LABELS[stage] || stage.replace(/_/g, ' ')}
                />
              );
            })}
          </div>
        </SectionCard>

        {/* System Details */}
        <div className="space-y-4">
          <SectionCard title="System Details" icon={<HardHat className="h-3.5 w-3.5" />}>
            <div className="space-y-2">
              <DetailRow label="Project" value={projectName} icon={<FolderKanban className="h-3 w-3" />} />
              <DetailRow label="QC Check" value={qcId || '—'} icon={<ClipboardCheck className="h-3 w-3" />} />
              <DetailRow label="Customer" value={customer} icon={<User className="h-3 w-3" />} />
              <DetailRow label="Site" value={site} icon={<Building2 className="h-3 w-3" />} />
              <DetailRow label="Capacity" value={String(capacity)} icon={<Zap className="h-3 w-3" />} />
              <DetailRow label="Commissioned By" value={commissionedByName} icon={<User className="h-3 w-3" />} />
            </div>
          </SectionCard>

          {/* Warranty */}
          <SectionCard title="Warranty" icon={<Shield className="h-3.5 w-3.5" />}>
            <div className="space-y-2">
              <DetailRow label="Start Date" value={warrantyStartDate ? fmtDateSafe(warrantyStartDate) : '—'} />
              <DetailRow label="Duration" value={warrantyMonths ? `${warrantyMonths} months` : '—'} />
              <DetailRow label="Commissioned Date" value={fmtDateSafe(record.commissionedDate)} />
              <DetailRow label="Created" value={fmtDateSafe(record.createdAt)} />
            </div>
          </SectionCard>
        </div>
      </div>

      {/* ── Section 5: Generation Test Details ─────────────── */}
      <SectionCard title="Generation Test Details" icon={<Zap className="h-3.5 w-3.5" />}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/10 p-4 text-center">
            <p className="text-[10px] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Generation Output</p>
            <p className="mt-1 text-2xl font-bold text-emerald-700 dark:text-emerald-300">{generationKwh} <span className="text-sm font-medium">kWh</span></p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-4 text-center">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Status</p>
            <p className="mt-1 text-lg font-bold text-[var(--color-text)]">Completed</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-4 text-center">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">QC Status</p>
            <p className="mt-1 text-lg font-bold text-[var(--color-text)]">Passed</p>
          </div>
        </div>
      </SectionCard>

      {/* ── Section 6: Customer Sign-off ───────────────────── */}
      <SectionCard title="Customer Sign-off" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>
        {hasSignOff && signOffUrl && isLoadableUrl(signOffUrl) ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/10 px-3 py-2.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
              <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                Customer sign-off collected{customerName ? ` from ${customerName}` : ''}
              </p>
            </div>
            <a
              href={signOffUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block"
            >
              <img
                src={signOffUrl}
                alt="Customer signature"
                className="w-full max-h-20 object-contain rounded-lg border border-[var(--color-border)] bg-white"
              />
            </a>
            <a
              href={signOffUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--color-primary)] hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Open Signature
            </a>
          </div>
        ) : hasSignOff && signOffUrl ? (
          // Demo placeholder (e.g. demo://signoff-placeholder) — recorded as
          // collected, but the URL is intentionally non-fetchable and must not
          // be rendered as a resource or navigation target (ERR_UNKNOWN_URL_SCHEME).
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/10 px-3 py-2.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
              Customer sign-off collected{customerName ? ` from ${customerName}` : ''}
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/10 px-3 py-2.5">
            <Clock className="h-4 w-4 text-amber-500 shrink-0" />
            <p className="text-xs font-medium text-amber-700 dark:text-amber-300">No customer sign-off collected yet</p>
          </div>
        )}
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
      {notes && (
        <SectionCard title="Notes">
          <p className="text-sm text-[var(--color-text)] whitespace-pre-wrap">{notes}</p>
        </SectionCard>
      )}

      {/* Immutable notice */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/10 p-3 text-center">
        <p className="text-xs text-amber-700 dark:text-amber-300">
          ⚡ Commissioning records are immutable — they cannot be modified after creation.
        </p>
      </div>
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
