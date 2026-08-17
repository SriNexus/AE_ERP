/**
 * PartnerCommissionsTab — Read-only commission records tab for Partner Workspace
 *
 * Phase 2D — Shows commission records filtered by partnerId.
 * Reuses existing table patterns. No approval/settlement/wallet logic.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { DollarSign, FileText } from 'lucide-react';
import { getAll, fmtDate, fmtCurrency } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { useAppStore } from '../../../store/useAppStore';
import { cn } from '../../../utils/cn';

// ── Status Styles ─────────────────────────────────────────

const COMMISSION_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  calculated: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  paid: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  voided: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  const style = COMMISSION_STATUS_STYLES[status] || 'bg-gray-100 text-gray-600';
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
      style,
    )}>
      {label}
    </span>
  );
}

function formatDateSafe(value: unknown): string {
  if (!value) return '—';
  if (typeof value === 'object' && value && 'toDate' in value && typeof (value as any).toDate === 'function') {
    return fmtDate((value as any).toDate());
  }
  if (typeof value === 'object' && value && 'seconds' in (value as any)) {
    return fmtDate(new Date(Number((value as any).seconds) * 1000));
  }
  return fmtDate(String(value));
}

// ── Props ─────────────────────────────────────────────────

interface PartnerCommissionsTabProps {
  partnerId: string;
}

// ── Component ─────────────────────────────────────────────

export function PartnerCommissionsTab({ partnerId }: PartnerCommissionsTabProps) {
  const navigate = useNavigate();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);

  const { data: commissions = [], isLoading } = useQuery({
    queryKey: ['commission_records', activeCompanyId],
    queryFn: () => getAll(COLLECTIONS.COMMISSION_RECORDS),
    staleTime: 30_000,
    enabled: Boolean(activeCompanyId),
  });

  const partnerCommissions = useMemo(() => {
    return (commissions as any[])
      .filter((r: any) => r.partnerId === partnerId && !r.isDeleted)
      .sort((a: any, b: any) => {
        const dateA = a.generatedDate || a.createdAt || '';
        const dateB = b.generatedDate || b.createdAt || '';
        return String(dateB).localeCompare(String(dateA));
      });
  }, [commissions, partnerId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 border-2 border-[var(--color-border)] border-t-[var(--color-primary)] rounded-full animate-spin" />
          <p className="text-sm text-[var(--color-text-muted)]">Loading commissions...</p>
        </div>
      </div>
    );
  }

  if (partnerCommissions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-[var(--color-text-muted)]">
        <DollarSign className="h-10 w-10 mb-3 opacity-40" />
        <p className="text-sm font-medium">No commission records</p>
        <p className="text-xs mt-1">Commission records appear when leads from this partner convert and reach approval.</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Summary */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 mb-6">
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Total Records</p>
          <p className="mt-1 text-lg font-bold text-[var(--color-text)]">{partnerCommissions.length}</p>
        </div>
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Pending</p>
          <p className="mt-1 text-lg font-bold text-amber-600">
            {partnerCommissions.filter((r: any) => r.status === 'pending').length}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Approved</p>
          <p className="mt-1 text-lg font-bold text-emerald-600">
            {partnerCommissions.filter((r: any) => r.status === 'approved').length}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Total Amount</p>
          <p className="mt-1 text-lg font-bold text-[var(--color-text)]">
            {fmtCurrency(partnerCommissions.reduce((sum: number, r: any) => sum + (r.approvedAmount || r.amount || 0), 0))}
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-[var(--color-border-subtle)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--color-bg-sunken)]">
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Lead</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Rule</th>
              <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">System</th>
              <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Amount</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Status</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Generated</th>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Approved</th>
            </tr>
          </thead>
          <tbody>
            {partnerCommissions.map((r: any, idx: number) => (
              <tr
                key={r.id || idx}
                className="border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-sunken)]/50 cursor-pointer transition-colors"
                onClick={() => navigate(`/partners/commission-approvals?open=${encodeURIComponent(r.id || '')}`)}
              >
                <td className="px-4 py-3 font-medium text-xs">
                  <span className="font-mono text-[var(--color-text-muted)]">{r.leadId || '—'}</span>
                </td>
                <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                  {r.ruleName || r.ruleType || '—'}
                </td>
                <td className="px-4 py-3 text-right text-xs tabular-nums">
                  {r.systemSizeKW ? `${r.systemSizeKW} kW` : '—'}
                </td>
                <td className="px-4 py-3 text-right text-xs font-semibold tabular-nums">
                  {fmtCurrency(r.approvedAmount || r.amount || 0)}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.status || 'pending'} />
                </td>
                <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                  {formatDateSafe(r.generatedDate || r.createdAt)}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                  {r.approvedAt ? formatDateSafe(r.approvedAt) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default PartnerCommissionsTab;
