/**
 * ServiceOverview — Overview tab content for ServiceTicketsWorkspace
 *
 * 7 sections:
 *   1. KPI cards (6)
 *   2. Ticket Summary + SLA Information (side-by-side)
 *   3. Customer & AMC Information
 *   4. Resolution Timeline
 *   5. Engineer Assignment
 *   6. Linked Records
 *   7. Recent Activity
 */

import { useNavigate } from 'react-router-dom';
import {
  Calendar, User, FileText, Clock,
  CheckCircle2, XCircle, Shield, Hash, Zap,
  Activity, FolderKanban, AlertCircle,
} from 'lucide-react';
import { fmtDate } from '../../../lib/firestore';
import { cn } from '../../../utils/cn';
import type { ServiceTicketRecord } from '../../../lib/serviceTicketWorkflow';

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
        {date && <p className="text-[10px] text-[var(--color-text-muted)]">{fmtDate(date as string)}</p>}
      </div>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  Open: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  InProgress: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  Resolved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  Closed: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  Cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

function StatusBadgeSt({ status }: { status?: string }) {
  if (!status) return null;
  const display = status === 'InProgress' ? 'In Progress' : status;
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
      STATUS_COLORS[status] || 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    )}>
      {status === 'Resolved' || status === 'Closed' ? <CheckCircle2 className="mr-1 h-3 w-3" /> : null}
      {status === 'Cancelled' ? <XCircle className="mr-1 h-3 w-3" /> : null}
      {display}
    </span>
  );
}

function PriorityBadge({ priority }: { priority?: string }) {
  const colors: Record<string, string> = {
    Low: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    Medium: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    High: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
    Urgent: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  };
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold', colors[priority || 'Medium'])}>
      {priority === 'Urgent' && <AlertCircle className="mr-1 h-3 w-3" />}
      {priority}
    </span>
  );
}

function daysSince(date: string | undefined | null): number {
  if (!date) return 0;
  const d = new Date(date);
  if (isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

const RESOLUTION_STAGES = [
  'Reported', 'Assigned', 'In Progress', 'Waiting Customer', 'Resolved', 'Closed',
];

function statusToStageIdx(status: string): number {
  const map: Record<string, number> = {
    Open: 0, Assigned: 1, InProgress: 2, WaitingCustomer: 3, Resolved: 4, Closed: 5,
  };
  return map[status] ?? 0;
}

// ── Main Component ─────────────────────────────────────────

interface ServiceOverviewProps {
  record: ServiceTicketRecord;
  onNavigate: (path: string) => void;
}

export default function ServiceOverview({ record, onNavigate }: ServiceOverviewProps) {
  const daysOpen = daysSince(record.reportedDate || record.createdAt);
  const stageIdx = statusToStageIdx(record.status);
  const isUrgent = record.priority === 'Urgent' || record.priority === 'High';

  return (
    <div className="p-5 space-y-5">
      {/* ── SECTION 1: 6 KPI Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <MetricTile label="Days Open" value={daysOpen} icon={Clock} color="text-blue-500" />
        <MetricTile label="Priority" value={record.priority || '—'} icon={AlertCircle}
          color={isUrgent ? 'text-red-500' : 'text-[var(--color-text)]'} />
        <MetricTile label="Status" value={record.status === 'InProgress' ? 'In Progress' : record.status} icon={record.status === 'Resolved' || record.status === 'Closed' ? CheckCircle2 : Clock}
          color={record.status === 'Resolved' || record.status === 'Closed' ? 'text-emerald-500' : record.status === 'Cancelled' ? 'text-red-500' : 'text-amber-500'} />
        <MetricTile label="Issue Type" value={record.issueType || '—'} icon={Activity} color="text-[var(--color-primary)]" />
        <MetricTile label="Assigned" value={record.assignedTechnicianName ? 'Yes' : 'No'} icon={User}
          color={record.assignedTechnicianName ? 'text-emerald-500' : 'text-amber-500'} />
        <MetricTile label="SLA" value={isUrgent ? 'Urgent' : daysOpen > 7 ? 'At Risk' : 'On Track'} icon={Shield}
          color={isUrgent ? 'text-red-500' : daysOpen > 7 ? 'text-orange-500' : 'text-emerald-500'} />
      </div>

      {/* ── SECTION 2: Ticket Summary + Timeline ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">
        {/* Ticket Details */}
        <SectionCard title="Ticket Summary" icon={FileText}>
          <DetailRow label="Ticket No." value={record.ticketNumber} icon={Hash} />
          <DetailRow label="Status">
            <StatusBadgeSt status={record.status} />
          </DetailRow>
          <DetailRow label="Priority">
            <PriorityBadge priority={record.priority} />
          </DetailRow>
          <DetailRow label="Issue Type" value={record.issueType} icon={Activity} />
          <DetailRow label="Project" icon={FolderKanban}>
            <button type="button" onClick={() => onNavigate(`/projects/${encodeURIComponent(record.projectId)}`)}
              className="text-[var(--color-primary)] hover:underline">
              {record.projectName || record.projectId}
            </button>
          </DetailRow>
          <DetailRow label="Reported Date" value={fmtDate(record.reportedDate) || '—'} icon={Calendar} />
          {record.resolvedDate && (
            <DetailRow label="Resolved Date" value={fmtDate(record.resolvedDate)} icon={CheckCircle2} />
          )}
          {record.closedDate && (
            <DetailRow label="Closed Date" value={fmtDate(record.closedDate)} icon={CheckCircle2} />
          )}
        </SectionCard>

        {/* Resolution Timeline */}
        <SectionCard title="Resolution Timeline" icon={Clock}>
          <div className="mt-2">
            {RESOLUTION_STAGES.map((stage, i) => {
              const stageStatus = record.status === 'Cancelled' && i <= 1
                ? 'completed' as const
                : i < stageIdx
                  ? 'completed' as const
                  : i === stageIdx
                    ? 'current' as const
                    : 'pending' as const;
              const stageDate = stage === 'Reported' ? record.reportedDate
                : stage === 'Resolved' ? record.resolvedDate
                : stage === 'Closed' ? record.closedDate
                : undefined;
              return (
                <TimelineStage
                  key={stage}
                  label={stage}
                  status={stageStatus}
                  date={stageDate}
                  isLast={i === RESOLUTION_STAGES.length - 1}
                />
              );
            })}
          </div>
        </SectionCard>
      </div>

      {/* ── SECTION 3: Description ── */}
      <SectionCard title="Description" icon={FileText}>
        <p className="text-sm text-[var(--color-text)] whitespace-pre-wrap">
          {record.description || 'No description provided.'}
        </p>
      </SectionCard>

      {/* ── SECTION 4: Customer & AMC Info ── */}
      <SectionCard title="Customer & AMC Information" icon={User}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
            <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Customer</p>
            <p className="text-xs font-medium mt-1 text-[var(--color-text)]">{record.customerName || '—'}</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
            <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Project</p>
            <p className="text-xs font-medium mt-1 text-[var(--color-text)]">{record.projectName || '—'}</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
            <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">AMC Contract</p>
            <p className="text-xs font-medium mt-1 text-[var(--color-text)]">
              {record.amcContractNumber ? (
                <button type="button" onClick={() => onNavigate(`/amc-contracts/${encodeURIComponent(record.amcContractId || '')}`)}
                  className="text-[var(--color-primary)] hover:underline">
                  {record.amcContractNumber}
                </button>
              ) : '—'}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
            <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Technician</p>
            <p className="text-xs font-medium mt-1 text-[var(--color-text)]">{record.assignedTechnicianName || 'Unassigned'}</p>
          </div>
        </div>
      </SectionCard>

      {/* ── SECTION 5: Linked Records ── */}
      <SectionCard title="Linked Records" icon={FolderKanban}>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onNavigate(`/projects/${encodeURIComponent(record.projectId)}`)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-sunken)] transition-colors">
            <FolderKanban className="h-3.5 w-3.5" /> Project
          </button>
          {record.amcContractId && (
            <button type="button" onClick={() => onNavigate(`/amc-contracts/${encodeURIComponent(record.amcContractId || '')}`)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-sunken)] transition-colors">
              <Shield className="h-3.5 w-3.5" /> AMC Contract
            </button>
          )}
          {record.projectId && (
            <button type="button" onClick={() => onNavigate(`/monitoring?projectId=${encodeURIComponent(record.projectId)}`)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-sunken)] transition-colors">
              <Zap className="h-3.5 w-3.5" /> Monitoring
            </button>
          )}
          {record.customerId && (
            <button type="button" onClick={() => onNavigate(`/customers/${encodeURIComponent(record.customerId)}`)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-sunken)] transition-colors">
              <User className="h-3.5 w-3.5" /> Customer
            </button>
          )}
        </div>
      </SectionCard>

      {/* ── SECTION 6: Notes ── */}
      {record.notes && (
        <SectionCard title="Notes" icon={FileText}>
          <p className="text-sm text-[var(--color-text)] whitespace-pre-wrap">{record.notes}</p>
        </SectionCard>
      )}

      {/* ── SECTION 7: Recent Activity ── */}
      <SectionCard title="Recent Activity" icon={Clock}>
        {record.statusHistory && record.statusHistory.length > 0 ? (
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {[...record.statusHistory].reverse().slice(0, 10).map((entry, i) => (
              <div key={i} className="flex items-start gap-2 text-xs py-1">
                <div className={cn(
                  'mt-1.5 h-2 w-2 rounded-full shrink-0',
                  entry.status === 'Resolved' || entry.status === 'Closed' ? 'bg-emerald-500' :
                  entry.status === 'Cancelled' ? 'bg-red-500' :
                  entry.status === 'InProgress' ? 'bg-purple-500' :
                  entry.status === 'Open' ? 'bg-amber-500' : 'bg-gray-400',
                )} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-[var(--color-text)]">
                    <span className={cn(
                      'font-semibold',
                      (entry.status === 'Resolved' || entry.status === 'Closed') && 'text-emerald-600',
                      entry.status === 'Cancelled' && 'text-red-600',
                    )}>
                      {entry.status === 'InProgress' ? 'In Progress' : entry.status}
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
    </div>
  );
}
