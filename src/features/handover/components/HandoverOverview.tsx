/**
 * HandoverOverview — Overview tab content for ProjectHandoverWorkspace
 *
 * 7 sections:
 *   1. Header (via WorkspaceShell)
 *   2. KPI cards (6)
 *   3. Handover Checklist Timeline + Handover Details (side-by-side)
 *   4. Customer Acceptance
 *   5. Warranty Information
 *   6. Training & Demo
 *   7. Recent Activity
 */

import { useNavigate } from 'react-router-dom';
import {
  Calendar, User, Building2, FileText, Clock,
  CheckCircle2, XCircle, Shield, Hash,
  Award, BookOpen, ClipboardCheck,
} from 'lucide-react';
import { fmtDate, fmtCurrency } from '../../../lib/firestore';
import { cn } from '../../../utils/cn';
import type { HandoverRecord } from '../../../lib/projectHandoverWorkflow';

// ── Sub-components ─────────────────────────────────────────

function MetricTile({ label, value, icon: Icon, color }: {
  label: string; value: string | number; icon?: React.ComponentType<{ className?: string }>;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3.5 transition-colors duration-150 hover:border-[var(--color-border)]">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{label}</p>
        {Icon && <Icon className={`h-4 w-4 ${color || 'text-[var(--color-text-muted)]'} opacity-60`} />}
      </div>
      <p className={`mt-2 text-xl font-bold ${color || 'text-[var(--color-text)]'}`}>{value}</p>
    </div>
  );
}

function SectionCard({ title, icon: Icon, children }: {
  title: string; icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-enterprise-surface)]">
      <div className="flex items-center gap-2 mb-3">
        {Icon && <Icon className="h-4 w-4 text-[var(--color-text-muted)]" />}
        <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{title}</p>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function DetailRow({ label, value, icon: Icon, children }: {
  label: string; value?: React.ReactNode; icon?: React.ComponentType<{ className?: string }>;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-[var(--color-border-subtle)] last:border-0">
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className="h-3 w-3 text-[var(--color-text-muted)] shrink-0" />}
        <span className="text-xs text-[var(--color-text-muted)]">{label}</span>
      </div>
      <span className="text-xs font-medium text-[var(--color-text)] text-right truncate ml-4 max-w-[60%]">
        {children ?? value ?? <span className="text-[var(--color-text-disabled)]">—</span>}
      </span>
    </div>
  );
}

function TimelineStage({ label, status, date, isLast }: {
  label: string; status: 'completed' | 'current' | 'pending'; date?: string; isLast?: boolean;
}) {
  const dotColor = status === 'completed'
    ? 'bg-emerald-500'
    : status === 'current'
      ? 'bg-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/30'
      : 'bg-gray-300 dark:bg-gray-600';
  const textColor = status === 'completed'
    ? 'text-emerald-600 dark:text-emerald-400'
    : status === 'current'
      ? 'text-[var(--color-text)] font-semibold'
      : 'text-[var(--color-text-muted)]';
  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col items-center">
        <div className={`h-3 w-3 rounded-full ${dotColor} shrink-0 mt-0.5`} />
        {!isLast && <div className="w-px flex-1 min-h-[20px] bg-[var(--color-border-subtle)]" />}
      </div>
      <div className="pb-2 flex-1">
        <p className={`text-xs ${textColor}`}>{label}</p>
        {date && <p className="text-[10px] text-[var(--color-text-muted)]">{fmtDate(date)}</p>}
      </div>
    </div>
  );
}

// ── Handover checklist items ───────────────────────────────

const HANDOVER_CHECKLIST = [
  'Plant Installed', 'QC Approved', 'Commissioning Complete',
  'Net Metering Approved', 'Subsidy Documents Submitted',
  'User Manual Delivered', 'Warranty Card Delivered',
  'Customer Training Complete', 'Final Photos Uploaded',
  'Customer Acceptance Signed', 'Project Closed',
];

// ── Training items ─────────────────────────────────────────

const TRAINING_ITEMS = [
  'Plant Overview', 'App Demonstration', 'Shutdown Procedure',
  'Emergency Procedure', 'Cleaning Instructions',
  'Warranty Explanation', 'Service Process',
];

// ── Status helpers ─────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  Scheduled: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  Completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  Cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

function StatusBadgeHdo({ status }: { status?: string }) {
  if (!status) return null;
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
      STATUS_COLORS[status] || 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    )}>
      {status === 'Completed' && <CheckCircle2 className="mr-1 h-3 w-3" />}
      {status === 'Cancelled' && <XCircle className="mr-1 h-3 w-3" />}
      {status}
    </span>
  );
}

function daysSince(date: string | undefined | null): number {
  if (!date) return 0;
  const d = new Date(date);
  if (isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

// ── Main Component ─────────────────────────────────────────

interface HandoverOverviewProps {
  record: HandoverRecord;
  project?: Record<string, any> | null;
  projectSubsidyApps?: Record<string, any>[];
  projectNetMeteringApps?: Record<string, any>[];
  projectCommissioningRecs?: Record<string, any>[];
  projectAmcContracts?: Record<string, any>[];
  status: string;
  onNavigate: (path: string) => void;
}

export default function HandoverOverview({
  record, project, projectSubsidyApps = [],
  projectNetMeteringApps = [], projectCommissioningRecs = [],
  projectAmcContracts = [], status, onNavigate,
}: HandoverOverviewProps) {
  const daysOpen = daysSince(record.createdAt);
  const hasCompletedStages = (record.statusHistory?.length || 0) > 1;
  const completedCount = record.status === 'Completed' ? HANDOVER_CHECKLIST.length
    : record.status === 'Scheduled' ? Math.floor(HANDOVER_CHECKLIST.length * 0.6)
    : 0;

  // Count actively linked upstream records
  const linkedCount =
    (projectCommissioningRecs.length > 0 ? 1 : 0) +
    (projectNetMeteringApps.length > 0 ? 1 : 0) +
    (projectSubsidyApps.length > 0 ? 1 : 0) +
    (projectAmcContracts.length > 0 ? 1 : 0);

  return (
    <div className="p-5 space-y-5">
      {/* ── SECTION 2: 6 KPI Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <MetricTile label="Days Open" value={daysOpen} icon={Clock} color="text-blue-500" />
        <MetricTile
          label="Checklist"
          value={`${completedCount}/${HANDOVER_CHECKLIST.length}`}
          icon={ClipboardCheck}
          color="text-[var(--color-primary)]"
        />
        <MetricTile
          label="Status"
          value={status === 'Completed' ? 'Done' : status === 'Cancelled' ? 'Cancelled' : status}
          icon={status === 'Completed' ? CheckCircle2 : status === 'Cancelled' ? XCircle : Clock}
          color={status === 'Completed' ? 'text-emerald-500' : status === 'Cancelled' ? 'text-red-500' : 'text-amber-500'}
        />
        <MetricTile
          label="Training"
          value={status === 'Completed' ? 'Done' : 'Pending'}
          icon={BookOpen}
          color={status === 'Completed' ? 'text-emerald-500' : 'text-amber-500'}
        />
        <MetricTile
          label="Warranty"
          value={status === 'Completed' ? 'Active' : 'Pending'}
          icon={Award}
          color={status === 'Completed' ? 'text-emerald-500' : 'text-amber-500'}
        />
        <MetricTile
          label="Linked Records"
          value={linkedCount}
          icon={FileText}
          color="text-[var(--color-text)]"
        />
      </div>

      {/* ── SECTION 3: Handover Checklist Timeline + Details ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">
        {/* Timeline */}
        <SectionCard title="Handover Checklist Timeline" icon={ClipboardCheck}>
          <div className="mt-2 max-h-80 overflow-y-auto">
            {HANDOVER_CHECKLIST.map((item, i) => {
              const stageIdx = completedCount;
              const itemStatus = i < stageIdx
                ? 'completed' as const
                : i === stageIdx && status !== 'Draft'
                  ? 'current' as const
                  : 'pending' as const;
              return (
                <TimelineStage
                  key={item}
                  label={item}
                  status={itemStatus}
                  isLast={i === HANDOVER_CHECKLIST.length - 1}
                />
              );
            })}
          </div>
          {status === 'Completed' && (
            <div className="mt-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800 p-2.5 flex items-start gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
              <p className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">
                All checklist items completed. Project ready for after-sales lifecycle.
              </p>
            </div>
          )}
        </SectionCard>

        {/* Handover Details */}
        <div className="space-y-4">
          <SectionCard title="Handover Details" icon={FileText}>
            <DetailRow label="Handover No." value={record.handoverNumber} icon={Hash} />
            <DetailRow label="Status">
              <StatusBadgeHdo status={status} />
            </DetailRow>
            <DetailRow label="Project" icon={Building2}>
              {record.projectId ? (
                <button type="button" onClick={() => onNavigate(`/projects/${encodeURIComponent(record.projectId)}`)}
                  className="text-[var(--color-primary)] hover:underline">
                  {record.projectName || record.projectId}
                </button>
              ) : '—'}
            </DetailRow>
            <DetailRow label="Customer" icon={User}>
              {record.customerName || '—'}
            </DetailRow>
            <DetailRow label="Assigned Engineer" icon={User}>
              {record.assignedEngineerName || '—'}
            </DetailRow>
            <DetailRow label="Handover Date" value={fmtDate(record.handoverDate) || '—'} icon={Calendar} />
            {record.scheduledDate && (
              <DetailRow label="Scheduled Date" value={fmtDate(record.scheduledDate)} icon={Clock} />
            )}
            {record.completedDate && (
              <DetailRow label="Completed Date" value={fmtDate(record.completedDate)} icon={CheckCircle2} />
            )}
          </SectionCard>

          {/* Customer Acceptance */}
          <SectionCard title="Customer Acceptance" icon={User}>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-2.5">
                <p className="text-[10px] font-semibold text-[var(--color-text-muted)]">Status</p>
                <p className="text-xs font-medium mt-0.5">
                  {status === 'Completed'
                    ? <span className="text-emerald-600 font-semibold">✓ Signed</span>
                    : <span className="text-amber-600">Pending</span>}
                </p>
              </div>
              <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-2.5">
                <p className="text-[10px] font-semibold text-[var(--color-text-muted)]">Customer</p>
                <p className="text-xs font-medium mt-0.5 truncate">{record.customerName || '—'}</p>
              </div>
            </div>
            {status === 'Completed' && (
              <div className="mt-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/10 p-2 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                <CheckCircle2 className="h-3 w-3 shrink-0" />
                Customer acceptance completed
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      {/* ── SECTION 5: Warranty Information ── */}
      <SectionCard title="Warranty & AMC" icon={Award}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
            <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Inverter Warranty</p>
            <p className="text-xs font-medium mt-1 text-[var(--color-text)]">5 Years</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
            <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Panel Warranty</p>
            <p className="text-xs font-medium mt-1 text-[var(--color-text)]">25 Years</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
            <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Structure Warranty</p>
            <p className="text-xs font-medium mt-1 text-[var(--color-text)]">10 Years</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
            <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Workmanship</p>
            <p className="text-xs font-medium mt-1 text-[var(--color-text)]">5 Years</p>
          </div>
        </div>
        {projectAmcContracts.length > 0 && (
          <div className="mt-3 border-t border-[var(--color-border-subtle)] pt-3">
            <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
              AMC Contracts ({projectAmcContracts.length})
            </p>
            <div className="space-y-1.5">
              {projectAmcContracts.map((amc: any, i: number) => (
                <div key={amc.id || i} className="flex items-start gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-2 text-xs">
                  <Shield className="h-3 w-3 text-[var(--color-primary)] mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-[var(--color-text)]">{amc.status || 'Active'}</p>
                    <p className="text-[10px] text-[var(--color-text-muted)]">
                      {fmtDate(amc.startDate)} — {fmtDate(amc.endDate)}
                      {amc.amount ? ` · ${fmtCurrency(amc.amount)}` : ''}
                    </p>
                    <button
                      type="button"
                      onClick={() => onNavigate(`/amc-contracts/${encodeURIComponent(amc.id || '')}`)}
                      className="text-[var(--color-primary)] hover:underline text-[10px] mt-0.5"
                    >
                      View AMC →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {!projectAmcContracts.length && (
          <div className="mt-2 rounded-lg border border-dashed border-[var(--color-border-subtle)] p-2.5 text-xs text-[var(--color-text-muted)] text-center">
            No AMC contracts yet. Generate after handover completion.
          </div>
        )}
      </SectionCard>

      {/* ── SECTION 6: Training & Demo ── */}
      <SectionCard title="Customer Training & Demo" icon={BookOpen}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {TRAINING_ITEMS.map((item) => (
            <div key={item} className={cn(
              'flex items-center gap-2 rounded-lg border p-2.5 text-xs transition-colors',
              status === 'Completed'
                ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/10'
                : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)]',
            )}>
              {status === 'Completed'
                ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                : <BookOpen className="h-3.5 w-3.5 text-[var(--color-text-muted)] shrink-0" />
              }
              <span className={status === 'Completed' ? 'text-emerald-700 dark:text-emerald-300 font-medium' : 'text-[var(--color-text-muted)]'}>
                {item}
              </span>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* ── SECTION 7: Recent Activity ── */}
      <SectionCard title="Recent Activity" icon={Clock}>
        {record.statusHistory && record.statusHistory.length > 0 ? (
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {[...record.statusHistory].reverse().slice(0, 10).map((entry, i) => (
              <div key={i} className="flex items-start gap-2 text-xs py-1">
                <div className={cn(
                  'mt-1.5 h-2 w-2 rounded-full shrink-0',
                  entry.status === 'Completed' ? 'bg-emerald-500' :
                  entry.status === 'Cancelled' ? 'bg-red-500' :
                  entry.status === 'Scheduled' ? 'bg-amber-500' : 'bg-gray-400',
                )} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-[var(--color-text)]">
                    <span className={cn(
                      'font-semibold',
                      entry.status === 'Completed' && 'text-emerald-600',
                      entry.status === 'Cancelled' && 'text-red-600',
                    )}>
                      {entry.status}
                    </span>
                  </p>
                  {entry.note && <p className="text-[var(--color-text-muted)] truncate">{entry.note}</p>}
                  <p className="text-[10px] text-[var(--color-text-muted)]">
                    {fmtDate(entry.changedAt)} · {entry.changedBy || 'System'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6">
            <Clock className="mx-auto h-6 w-6 text-[var(--color-text-muted)] opacity-40" />
            <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">No activity yet.</p>
          </div>
        )}
      </SectionCard>

      {/* Status Banners */}
      {status === 'Completed' && (
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800 p-3 text-xs text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="inline h-3.5 w-3.5 mr-1" />
          Project handover completed. The project is now ready for after-sales lifecycle (AMC, Service, Monitoring).
        </div>
      )}
      {status === 'Cancelled' && (
        <div className="rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 p-3 text-xs text-red-700 dark:text-red-300">
          <XCircle className="inline h-3.5 w-3.5 mr-1" />
          This handover was cancelled.{record.cancellationReason ? ` Reason: ${record.cancellationReason}` : ''}
        </div>
      )}
    </div>
  );
}
