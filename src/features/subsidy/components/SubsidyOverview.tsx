/**
 * SubsidyOverview — Overview tab content for SubsidyWorkspace
 *
 * 8 sections matching PHASE_7F spec:
 *   1. Header (Subsidy ID, project, status, amount)
 *   2. KPI cards (6)
 *   3. Timeline + Application Details (side-by-side)
 *   4. Financial Details
 *   5. Document Checklist (PM Surya Ghar)
 *   6. Tasks Overview
 *   7. Recent Activity
 *   8. Immutable disbursement ledger notice
 */

import { useNavigate } from 'react-router-dom';
import {
  Landmark, Calendar, User, Building2, FileText, DollarSign,
  CheckCircle2, XCircle, Clock, Shield, FolderKanban, Hash,
  AlertTriangle,
} from 'lucide-react';
import { fmtDate, fmtCurrency } from '../../../lib/firestore';
import { cn } from '../../../utils/cn';
import type { SubsidyApplication, SubsidyStatus } from '../../../lib/subsidyWorkflow';

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
      {title && (
        <div className="flex items-center gap-2 mb-3">
          {Icon && <Icon className="h-4 w-4 text-[var(--color-text-muted)]" />}
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{title}</p>
        </div>
      )}
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

const STATUS_COLORS: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  Submitted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  UnderReview: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  Approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  Disbursed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  Rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

function StatusBadgeSub({ status }: { status?: string }) {
  if (!status) return null;
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
      STATUS_COLORS[status] || 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    )}>
      {status === 'UnderReview' ? 'Under Review' : status}
    </span>
  );
}

// ── Timeline stage order ───────────────────────────────────

const TIMELINE_STAGES = [
  'Eligible', 'Application Created', 'Submitted', 'Under Review',
  'Approved', 'Payment Initiated', 'Amount Credited', 'Financial Closure',
] as const;

function statusToStageIndex(status: SubsidyStatus): number {
  const map: Record<string, number> = {
    Draft: 1, Submitted: 2, UnderReview: 3,
    Approved: 4, Disbursed: 6, Rejected: -1,
  };
  return map[status] ?? 0;
}

// ── Document checklist items ───────────────────────────────

const DOC_CHECKLIST = [
  'Aadhaar Card', 'Bank Passbook', 'Electricity Bill',
  'Commissioning Certificate', 'Net Metering Approval',
  'PM Surya Ghar Documents', 'Subsidy Approval Letter',
  'Credit Confirmation Proof',
];

function daysSince(date: string | undefined | null): number {
  if (!date) return 0;
  const d = new Date(date);
  if (isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

// ── Main Component ─────────────────────────────────────────

interface SubsidyOverviewProps {
  record: SubsidyApplication;
  project?: Record<string, any> | null;
  projectNetMeteringRecs?: Record<string, any>[];
  projectHandoverRecs?: Record<string, any>[];
  projectCommissioningRecs?: Record<string, any>[];
  status: string;
  totalSanctioned: number;
  totalDisbursed: number;
  remainingAmount: number;
  disbursements: any[];
  onNavigate: (path: string) => void;
}

export default function SubsidyOverview({
  record, project, projectNetMeteringRecs = [],
  projectHandoverRecs = [], projectCommissioningRecs = [],
  status, totalSanctioned, totalDisbursed, remainingAmount,
  disbursements, onNavigate,
}: SubsidyOverviewProps) {
  const stageIdx = statusToStageIndex(status as SubsidyStatus);
  const daysOpen = daysSince(record.createdAt);
  const hasDocSubmitted = (record.documentsSubmitted?.length || 0) > 0;

  return (
    <div className="p-5 space-y-5">
      {/* ── SECTION 2: 6 KPI Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <MetricTile label="Days Open" value={daysOpen} icon={Clock} color="text-blue-500" />
        <MetricTile
          label="Expected Amount"
          value={totalSanctioned > 0 ? fmtCurrency(totalSanctioned) : '—'}
          icon={DollarSign}
          color="text-emerald-500"
        />
        <MetricTile
          label="Credited Amount"
          value={totalDisbursed > 0 ? fmtCurrency(totalDisbursed) : '—'}
          icon={DollarSign}
          color="text-green-500"
        />
        <MetricTile
          label="Approval Status"
          value={status === 'Approved' || status === 'Disbursed' ? 'Approved' : status === 'Rejected' ? 'Rejected' : 'Pending'}
          icon={status === 'Approved' || status === 'Disbursed' ? CheckCircle2 : status === 'Rejected' ? XCircle : Clock}
          color={status === 'Approved' || status === 'Disbursed' ? 'text-emerald-500' : status === 'Rejected' ? 'text-red-500' : 'text-amber-500'}
        />
        <MetricTile
          label="Completion %"
          value={stageIdx >= 0 ? `${Math.round((stageIdx / (TIMELINE_STAGES.length - 1)) * 100)}%` : '0%'}
          icon={CheckCircle2}
          color="text-[var(--color-primary)]"
        />
        <MetricTile
          label="Financial Closure"
          value={status === 'Disbursed' ? 'Closed' : status === 'Rejected' ? 'Rejected' : 'Open'}
          icon={Shield}
          color={status === 'Disbursed' ? 'text-green-500' : status === 'Rejected' ? 'text-red-500' : 'text-amber-500'}
        />
      </div>

      {/* ── SECTION 3: Timeline + Application Details ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">
        {/* Timeline */}
        <SectionCard title="Subsidy Timeline" icon={Clock}>
          <div className="mt-2">
            {TIMELINE_STAGES.map((stage, i) => {
              const stageStatus = stageIdx === -1 && status === 'Rejected' && i <= 2
                ? 'completed' as const
                : i < stageIdx
                  ? 'completed' as const
                  : i === stageIdx
                    ? 'current' as const
                    : 'pending' as const;
              const stageDate = stage === 'Application Created' ? record.createdAt
                : stage === 'Submitted' ? record.submittedDate
                : stage === 'Approved' ? record.approvedDate
                : stage === 'Amount Credited' || stage === 'Payment Initiated' ? record.disbursedDate
                : undefined;
              return (
                <TimelineStage
                  key={stage}
                  label={stage}
                  status={stageStatus}
                  date={stageDate}
                  isLast={i === TIMELINE_STAGES.length - 1}
                />
              );
            })}
          </div>
          {status === 'Rejected' && (
            <div className="mt-3 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 p-2.5 flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-red-700 dark:text-red-300">Rejected</p>
                {record.rejectionReason && (
                  <p className="text-[10px] text-red-600 dark:text-red-400 mt-0.5">{record.rejectionReason}</p>
                )}
              </div>
            </div>
          )}
        </SectionCard>

        {/* Application Details */}
        <SectionCard title="Application Details" icon={FileText}>
          <DetailRow label="Application No." value={record.applicationNumber} icon={FileText} />
          <DetailRow label="Project" icon={FolderKanban}>
            {record.projectId ? (
              <button type="button" onClick={() => onNavigate(`/projects/${encodeURIComponent(record.projectId)}`)}
                className="text-[var(--color-primary)] hover:underline">
                {record.projectName || record.projectId}
              </button>
            ) : '—'}
          </DetailRow>
          <DetailRow label="Customer" icon={User}>
            {project?.customerName || project?.customerId || '—'}
          </DetailRow>
          <DetailRow label="Scheme" value={record.schemeName} icon={Landmark} />
          <DetailRow label="Scheme Type" icon={Building2}>
            {record.schemeType || '—'}
          </DetailRow>
          <DetailRow label="Capacity" icon={Hash}>
            {project?.capacity ? `${project.capacity} kW` : '—'}
          </DetailRow>
          <DetailRow label="Created" value={fmtDate(record.createdAt) || '—'} icon={Calendar} />
        </SectionCard>
      </div>

      {/* ── SECTION 5: Financial Details ── */}
      <SectionCard title="Financial Details" icon={DollarSign}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
            <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Expected Subsidy</p>
            <p className="text-lg font-bold text-[var(--color-text)] mt-1">
              {totalSanctioned > 0 ? fmtCurrency(totalSanctioned) : '—'}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
            <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Approved Subsidy</p>
            <p className="text-lg font-bold text-emerald-600 mt-1">
              {status === 'Approved' || status === 'Disbursed' ? (totalSanctioned > 0 ? fmtCurrency(totalSanctioned) : '—') : 'Pending'}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
            <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Credited Amount</p>
            <p className="text-lg font-bold text-green-600 mt-1">
              {totalDisbursed > 0 ? fmtCurrency(totalDisbursed) : '—'}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
            <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Financial Status</p>
            <div className="mt-1">
              <StatusBadgeSub status={status} />
            </div>
          </div>
        </div>

        {/* Disbursement Ledger */}
        {disbursements && disbursements.length > 0 && (
          <div className="border-t border-[var(--color-border-subtle)] pt-3 mt-3">
            <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
              Disbursement Ledger ({disbursements.length})
            </p>
            <div className="space-y-1.5">
              {[...disbursements].reverse().map((entry: any, i: number) => (
                <div key={entry.id || i} className="flex items-start gap-2 text-xs rounded-lg border border-emerald-100 dark:border-emerald-900/30 bg-emerald-50 dark:bg-emerald-900/10 p-2">
                  <DollarSign className="h-3 w-3 text-emerald-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-emerald-700 dark:text-emerald-300">{fmtCurrency(entry.amount)}</p>
                    <p className="text-[10px] text-[var(--color-text-muted)]">
                      {fmtDate(entry.disbursedDate)}
                      {entry.referenceNumber ? ` · Ref: ${entry.referenceNumber}` : ''}
                    </p>
                    {entry.notes && <p className="text-[10px] text-[var(--color-text-muted)]">{entry.notes}</p>}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[9px] text-[var(--color-text-muted)] italic">
              Immutable ledger — entries cannot be modified or deleted.
            </p>
          </div>
        )}

        {/* Transaction Reference */}
        {record.disbursedDate && (
          <DetailRow label="Credited Date" value={fmtDate(record.disbursedDate)} icon={Calendar} />
        )}
        {record.approvedDate && (
          <DetailRow label="Approved Date" value={fmtDate(record.approvedDate)} icon={CheckCircle2} />
        )}
        {record.submittedDate && (
          <DetailRow label="Submitted Date" value={fmtDate(record.submittedDate)} icon={Clock} />
        )}
      </SectionCard>

      {/* ── SECTION 6: Document Checklist ── */}
      <SectionCard title="Document Checklist" icon={FileText}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {DOC_CHECKLIST.map((doc) => {
            const present = hasDocSubmitted;
            return (
              <div key={doc} className={cn(
                'flex items-center gap-2 rounded-lg border p-2.5 text-xs transition-colors',
                present
                  ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/10'
                  : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)]',
              )}>
                {present
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  : <FileText className="h-3.5 w-3.5 text-[var(--color-text-muted)] shrink-0" />
                }
                <span className={present ? 'text-emerald-700 dark:text-emerald-300 font-medium' : 'text-[var(--color-text-muted)]'}>
                  {doc}
                </span>
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* ── SECTION 7: Tasks Overview ── */}
      <SectionCard title="Tasks Overview" icon={CheckCircle2}>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3 text-center">
            <p className="text-lg font-bold text-[var(--color-text)]">—</p>
            <p className="text-[10px] text-[var(--color-text-muted)]">Total</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3 text-center">
            <p className="text-lg font-bold text-emerald-600">—</p>
            <p className="text-[10px] text-[var(--color-text-muted)]">Completed</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3 text-center">
            <p className="text-lg font-bold text-amber-600">—</p>
            <p className="text-[10px] text-[var(--color-text-muted)]">Pending</p>
          </div>
        </div>
      </SectionCard>

      {/* ── SECTION 8: Recent Activity ── */}
      <SectionCard title="Recent Activity" icon={Clock}>
        {record.statusHistory && record.statusHistory.length > 0 ? (
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {[...record.statusHistory].reverse().slice(0, 10).map((entry: any, i: number) => (
              <div key={i} className="flex items-start gap-2 text-xs py-1">
                <div className="mt-1.5 h-2 w-2 rounded-full bg-[var(--color-primary)] shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-[var(--color-text)]">
                    <span className={cn(
                      'font-semibold',
                      entry.status === 'Approved' && 'text-emerald-600',
                      entry.status === 'Disbursed' && 'text-green-600',
                      entry.status === 'Rejected' && 'text-red-600',
                    )}>
                      {entry.status === 'UnderReview' ? 'Under Review' : entry.status}
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
      {status === 'Disbursed' && (
        <div className="rounded-xl bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800 p-3 text-xs text-green-700 dark:text-green-300">
          <CheckCircle2 className="inline h-3.5 w-3.5 mr-1" />
          Subsidy fully disbursed ({fmtCurrency(totalDisbursed)}). This project is ready for handover.
        </div>
      )}
      {status === 'Rejected' && (
        <div className="rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 p-3 text-xs text-red-700 dark:text-red-300">
          <XCircle className="inline h-3.5 w-3.5 mr-1" />
          This application was rejected. A new application can be submitted for this project.
        </div>
      )}
    </div>
  );
}
