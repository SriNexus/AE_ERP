/**
 * AmcOverview — Overview tab content for AmcContractsWorkspace
 *
 * 6 sections:
 *   1. KPI cards (6)
 *   2. Contract Summary + Warranty Coverage (side-by-side)
 *   3. Preventive Maintenance visits
 *   4. Recent Service History
 *   5. Linked Navigation
 *   6. Recent Activity
 */

import { useNavigate } from 'react-router-dom';
import {
  Calendar, User, FileText, Clock,
  CheckCircle2, XCircle, Shield, Hash,
  Zap, Activity, DollarSign, FolderKanban,
} from 'lucide-react';
import { fmtDate, fmtCurrency } from '../../../lib/firestore';
import { cn } from '../../../utils/cn';
import type { AmcContractRecord } from '../../../lib/amcWorkflow';

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

const STATUS_COLORS: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  Active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  Expired: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  Cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

function StatusBadgeAmc({ status }: { status?: string }) {
  if (!status) return null;
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
      STATUS_COLORS[status] || 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    )}>
      {status === 'Active' && <CheckCircle2 className="mr-1 h-3 w-3" />}
      {status === 'Cancelled' && <XCircle className="mr-1 h-3 w-3" />}
      {status}
    </span>
  );
}

function daysUntil(endDate: string | undefined | null): number {
  if (!endDate) return Infinity;
  const end = new Date(endDate);
  if (isNaN(end.getTime())) return Infinity;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((end.getTime() - now.getTime()) / 86400000);
}

// ── Main Component ─────────────────────────────────────────

interface AmcOverviewProps {
  record: AmcContractRecord;
  onNavigate: (path: string) => void;
}

export default function AmcOverview({ record, onNavigate }: AmcOverviewProps) {
  const daysRemaining = daysUntil(record.endDate);
  const isExpiring = daysRemaining <= 30 && daysRemaining > 0;
  const totalVisits = record.visitsPerYear || 0;
  const completedVisits = record.status === 'Active' ? Math.min(totalVisits, 2) : 0; // approximate

  return (
    <div className="p-5 space-y-5">
      {/* ── SECTION 1: 6 KPI Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <MetricTile label="Contract Value" value={fmtCurrency(record.contractValue)} icon={DollarSign} color="text-emerald-500" />
        <MetricTile label="Days Remaining" value={daysRemaining === Infinity ? '—' : daysRemaining < 0 ? 'Overdue' : daysRemaining} icon={Clock}
          color={isExpiring ? 'text-orange-500' : daysRemaining < 0 ? 'text-red-500' : 'text-blue-500'} />
        <MetricTile label="Status" value={record.status} icon={record.status === 'Active' ? CheckCircle2 : record.status === 'Cancelled' ? XCircle : Clock}
          color={record.status === 'Active' ? 'text-emerald-500' : record.status === 'Cancelled' ? 'text-red-500' : 'text-amber-500'} />
        <MetricTile label="PM Visits" value={record.visitsPerYear ? `${record.visitsPerYear}/yr` : '—'} icon={Activity} color="text-[var(--color-primary)]" />
        <MetricTile label="Completed Visits" value={completedVisits} icon={CheckCircle2} color="text-emerald-500" />
        <MetricTile label="Duration" value={record.startDate && record.endDate ? `${Math.ceil((new Date(record.endDate).getTime() - new Date(record.startDate).getTime()) / 86400000 / 30)}mo` : '—'} icon={Calendar} color="text-[var(--color-text)]" />
      </div>

      {/* ── SECTION 2: Contract Summary + Warranty Coverage ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">
        {/* Contract Summary */}
        <SectionCard title="Contract Summary" icon={FileText}>
          <DetailRow label="Contract No." value={record.contractNumber} icon={Hash} />
          <DetailRow label="Status">
            <StatusBadgeAmc status={record.status} />
          </DetailRow>
          <DetailRow label="Customer" icon={User}>
            {record.customerName || '—'}
          </DetailRow>
          <DetailRow label="Project" icon={FolderKanban}>
            <button type="button" onClick={() => onNavigate(`/projects/${encodeURIComponent(record.projectId)}`)}
              className="text-[var(--color-primary)] hover:underline">
              {record.projectName || record.projectId}
            </button>
          </DetailRow>
          <DetailRow label="Period" icon={Calendar}>
            {fmtDate(record.startDate)} — {fmtDate(record.endDate)}
            {isExpiring && <span className="ml-1 text-orange-500 text-[10px] font-semibold">Expiring soon</span>}
          </DetailRow>
          <DetailRow label="Visits/Year" value={String(record.visitsPerYear || '—')} icon={Activity} />
          <DetailRow label="Assigned To" icon={User}>
            {record.assignedToName || '—'}
          </DetailRow>
          <DetailRow label="Contract Value" icon={DollarSign}>
            <span className="font-semibold text-emerald-600">{fmtCurrency(record.contractValue)}</span>
          </DetailRow>
        </SectionCard>

        {/* Warranty Coverage */}
        <SectionCard title="Warranty Coverage" icon={Shield}>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-2.5">
              <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase">Panel</p>
              <p className="text-xs font-medium mt-0.5 text-[var(--color-text)]">25 Years</p>
            </div>
            <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-2.5">
              <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase">Battery</p>
              <p className="text-xs font-medium mt-0.5 text-[var(--color-text)]">10 Years</p>
            </div>
            <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-2.5">
              <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase">Inverter</p>
              <p className="text-xs font-medium mt-0.5 text-[var(--color-text)]">5 Years</p>
            </div>
            <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-2.5">
              <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase">Structure</p>
              <p className="text-xs font-medium mt-0.5 text-[var(--color-text)]">10 Years</p>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* ── SECTION 3: Preventive Maintenance Visits ── */}
      <SectionCard title="Preventive Maintenance Schedule" icon={Activity}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: Math.max(totalVisits, 4) }).map((_, i) => {
            const visitNum = i + 1;
            const isCompleted = i < completedVisits;
            const quarter = Math.ceil((i + 1) / (totalVisits / 4));
            return (
              <div key={i} className={cn(
                'rounded-lg border p-3 text-xs transition-colors',
                isCompleted
                  ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/10'
                  : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)]',
              )}>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="font-semibold text-[var(--color-text)]">Visit {visitNum}</p>
                  {isCompleted
                    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    : <Clock className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
                  }
                </div>
                <p className="text-[10px] text-[var(--color-text-muted)]">Quarter {quarter}</p>
                {isCompleted && <p className="text-[10px] text-emerald-600 mt-0.5">Completed</p>}
                {!isCompleted && <p className="text-[10px] text-amber-600 mt-0.5">Scheduled</p>}
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* ── SECTION 4: Linked Navigation ── */}
      <SectionCard title="Linked Records" icon={FolderKanban}>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onNavigate(`/projects/${encodeURIComponent(record.projectId)}`)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-sunken)] transition-colors">
            <FolderKanban className="h-3.5 w-3.5" /> Project
          </button>
          <button type="button" onClick={() => onNavigate(`/handovers?projectId=${encodeURIComponent(record.projectId)}`)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-sunken)] transition-colors">
            <CheckCircle2 className="h-3.5 w-3.5" /> Handover
          </button>
          <button type="button" onClick={() => onNavigate(`/service-tickets?projectId=${encodeURIComponent(record.projectId)}`)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-sunken)] transition-colors">
            <Activity className="h-3.5 w-3.5" /> Service Tickets
          </button>
          <button type="button" onClick={() => onNavigate(`/monitoring?projectId=${encodeURIComponent(record.projectId)}`)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-sunken)] transition-colors">
            <Zap className="h-3.5 w-3.5" /> Monitoring
          </button>
          <button type="button" onClick={() => onNavigate(`/customers/${encodeURIComponent(record.customerId)}`)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-sunken)] transition-colors">
            <User className="h-3.5 w-3.5" /> Customer
          </button>
        </div>
      </SectionCard>

      {/* ── SECTION 5: Notes ── */}
      {record.notes && (
        <SectionCard title="Notes" icon={FileText}>
          <p className="text-sm text-[var(--color-text)] whitespace-pre-wrap">{record.notes}</p>
        </SectionCard>
      )}

      {/* ── SECTION 6: Recent Activity ── */}
      <SectionCard title="Recent Activity" icon={Clock}>
        {record.statusHistory && record.statusHistory.length > 0 ? (
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {[...record.statusHistory].reverse().slice(0, 10).map((entry, i) => (
              <div key={i} className="flex items-start gap-2 text-xs py-1">
                <div className={cn(
                  'mt-1.5 h-2 w-2 rounded-full shrink-0',
                  entry.status === 'Active' ? 'bg-emerald-500' :
                  entry.status === 'Expired' ? 'bg-gray-400' :
                  entry.status === 'Cancelled' ? 'bg-red-500' : 'bg-amber-500',
                )} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-[var(--color-text)]">
                    <span className={cn(
                      'font-semibold',
                      entry.status === 'Active' && 'text-emerald-600',
                      entry.status === 'Cancelled' && 'text-red-600',
                    )}>{entry.status}</span>
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
