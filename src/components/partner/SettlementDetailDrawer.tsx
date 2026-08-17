/**
 * SettlementDetailDrawer — Read-only settlement detail modal for admin workspace
 *
 * Displays: settlement info, partner details, commission list, totals,
 * wallet transaction reference, status timeline with audit trail.
 * Supports processing action from parent page.
 */

import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DollarSign,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  PlayCircle,
  FileText,
  RefreshCw,
  Archive,
  User,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { fmtDate, fmtDateTime, fmtCurrency, getAll } from '../../lib/firestore';
import { COLLECTIONS } from '../../lib/firebase';
import { useAppStore } from '../../store/useAppStore';
import { queryKeys } from '../../lib/queryKeys';
import { loadSettlementAuditTrail, type SettlementAuditEntry } from '../../lib/settlementAudit';
import type { CommissionRecord } from '../../features/channel-partner/types';

interface SettlementDetailDrawerProps {
  settlement: any;
  open: boolean;
  onClose: () => void;
  onProcess?: (id: string) => void;
  onProcessLoading?: boolean;
}

const STATUS_STYLES: Record<string, string> = {
  pending:    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  processing: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  completed:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  failed:     'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  cancelled:  'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

const STATUS_LABELS: Record<string, string> = {
  pending:    'Pending',
  processing: 'Processing',
  completed:  'Completed',
  failed:     'Failed',
  cancelled:  'Cancelled',
};

const AUDIT_ICONS: Record<string, React.ReactNode> = {
  created: <Clock className="h-4 w-4 text-amber-500" />,
  processing: <RefreshCw className="h-4 w-4 text-blue-500" />,
  processed: <PlayCircle className="h-4 w-4 text-indigo-500" />,
  completed: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
  failed: <XCircle className="h-4 w-4 text-red-500" />,
  cancelled: <Archive className="h-4 w-4 text-gray-500" />,
};

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-[var(--color-border-subtle)] last:border-b-0">
      <span className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] shrink-0 min-w-[120px]">{label}</span>
      <span className="text-sm font-medium text-[var(--color-text)] text-right break-all">{children}</span>
    </div>
  );
}

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const s = status.toLowerCase();
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[s] || 'bg-gray-100 text-gray-600'}`}>
      {STATUS_LABELS[s] || s}
    </span>
  );
}

export function SettlementDetailDrawer({ settlement, open, onClose, onProcess, onProcessLoading }: SettlementDetailDrawerProps) {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const companyKeys = queryKeys.forCompany(activeCompanyId);
  const [auditEntries, setAuditEntries] = useState<SettlementAuditEntry[]>([]);

  const { data: commissionRecords = [] } = useQuery({
    queryKey: companyKeys.commissionRules,
    queryFn: () => getAll(COLLECTIONS.COMMISSION_RECORDS),
    staleTime: 30_000,
    enabled: open && Boolean(activeCompanyId),
  });

  const { data: partners = [] } = useQuery({
    queryKey: companyKeys.partnersAll,
    queryFn: () => getAll(COLLECTIONS.CHANNEL_PARTNERS),
    staleTime: 60_000,
    enabled: open && Boolean(activeCompanyId),
  });

  // Load audit trail when drawer opens
  useEffect(() => {
    if (open && settlement?.id) {
      loadSettlementAuditTrail(settlement.id).then(setAuditEntries).catch(() => setAuditEntries([]));
    } else {
      setAuditEntries([]);
    }
  }, [open, settlement?.id]);

  const partnerName = useMemo(() => {
    if (settlement?.partnerName) return settlement.partnerName;
    const p = (partners as any[]).find((p: any) => p.id === settlement?.partnerId);
    return p?.firmName || p?.contactPerson || settlement?.partnerId || '—';
  }, [settlement, partners]);

  const linkedCommissions = useMemo(() => {
    if (!settlement?.commissionIds) return [];
    return (commissionRecords as any[])
      .filter((r: any) => settlement.commissionIds.includes(r.id) && !r.isDeleted);
  }, [settlement, commissionRecords]);

  if (!settlement) return null;

  const isPending = settlement.status === 'pending';
  const canProcess = isPending && onProcess;

  return (
    <Modal open={open} onClose={onClose} size="md">
      <div className="space-y-6 text-sm">
        {/* ── Header ──────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-[var(--color-primary)]" />
            <span className="font-semibold text-[var(--color-text)]">Settlement</span>
          </div>
          <StatusBadge status={settlement.status} />
        </div>

        <p className="text-2xl font-bold text-[var(--color-text)]">
          {fmtCurrency(settlement.totalAmount || 0)}
        </p>

        {/* ── Settlement Info ─────────────────────────────── */}
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-sunken)] divide-y divide-[var(--color-border-subtle)]">
          <DetailRow label="Settlement ID">
            <code className="text-xs font-mono bg-[var(--color-surface)] px-1.5 py-0.5 rounded">{settlement.id}</code>
          </DetailRow>
          <DetailRow label="Partner">
            <span className="font-medium">{partnerName}</span>
          </DetailRow>
          <DetailRow label="Commission Count">{settlement.commissionCount || 0}</DetailRow>
          <DetailRow label="Total Amount">{fmtCurrency(settlement.totalAmount || 0)}</DetailRow>
          <DetailRow label="Created">{fmtDateTime(settlement.createdAt)}</DetailRow>
          {settlement.completedAt && <DetailRow label="Completed">{fmtDateTime(settlement.completedAt)}</DetailRow>}
          {settlement.processedBy && <DetailRow label="Processed By">{settlement.processedBy}</DetailRow>}
        </div>

        {/* ── Results Summary ─────────────────────────────── */}
        {settlement.status === 'completed' && (
          <div className="grid grid-cols-4 gap-3">
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 p-3 text-center">
              <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{settlement.successCount || 0}</p>
              <p className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300">Success</p>
            </div>
            <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3 text-center">
              <p className="text-lg font-bold text-amber-600 dark:text-amber-400">{settlement.skippedCount || 0}</p>
              <p className="text-[10px] font-medium text-amber-700 dark:text-amber-300">Skipped</p>
            </div>
            <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-center">
              <p className="text-lg font-bold text-red-600 dark:text-red-400">{settlement.failedCount || 0}</p>
              <p className="text-[10px] font-medium text-red-700 dark:text-red-300">Failed</p>
            </div>
            <div className="rounded-lg bg-indigo-50 dark:bg-indigo-900/20 p-3 text-center">
              <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{settlement.commissionCount || 0}</p>
              <p className="text-[10px] font-medium text-indigo-700 dark:text-indigo-300">Total</p>
            </div>
          </div>
        )}

        {settlement.status === 'failed' && settlement.failureReason && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 p-3">
            <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-red-700 dark:text-red-300">Failure Reason</p>
              <p className="text-xs text-red-600 dark:text-red-400">{settlement.failureReason}</p>
            </div>
          </div>
        )}

        {/* ── Linked Commissions ──────────────────────────── */}
        {linkedCommissions.length > 0 && (
          <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
            <p className="px-4 pt-3 pb-1 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
              Commission Records ({linkedCommissions.length})
            </p>
            <div className="px-4 pb-3 space-y-2 max-h-[200px] overflow-y-auto">
              {linkedCommissions.map((cr: any) => (
                <div key={cr.id} className="flex items-center justify-between py-1.5 border-b border-[var(--color-border-subtle)] last:border-b-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-3.5 w-3.5 text-[var(--color-text-muted)] shrink-0" />
                    <code className="text-xs font-mono text-[var(--color-text-secondary)]">{cr.id}</code>
                    <span className="text-xs text-[var(--color-text-muted)] truncate max-w-[120px]">{cr.ruleName || ''}</span>
                  </div>
                  <span className="text-xs font-semibold">{fmtCurrency(cr.approvedAmount || cr.amount || 0)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Audit Trail ─────────────────────────────────── */}
        {auditEntries.length > 0 && (
          <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
            <p className="px-4 pt-3 pb-1 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
              Audit Trail ({auditEntries.length})
            </p>
            <div className="px-4 pb-3 space-y-3 max-h-[240px] overflow-y-auto">
              {auditEntries.map((entry) => (
                <div key={entry.id} className="flex items-start gap-3">
                  <div className="shrink-0 mt-0.5">
                    {AUDIT_ICONS[entry.action.toLowerCase()] || <RefreshCw className="h-4 w-4 text-gray-400" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-[var(--color-text)] capitalize">
                        {entry.action}
                      </span>
                      <span className="text-[10px] text-[var(--color-text-muted)]">
                        {entry.previousStatus} → {entry.newStatus}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <User className="h-3 w-3 text-[var(--color-text-muted)]" />
                      <span className="text-[10px] text-[var(--color-text-muted)]">{entry.performedByName}</span>
                      <Clock className="h-3 w-3 text-[var(--color-text-muted)]" />
                      <span className="text-[10px] text-[var(--color-text-muted)]">{fmtDateTime(entry.timestamp)}</span>
                    </div>
                    {entry.notes && (
                      <p className="text-[10px] text-[var(--color-text-secondary)] mt-0.5 italic">{entry.notes}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Actions ─────────────────────────────────────── */}
        {canProcess && (
          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-border-subtle)]">
            <Button
              onClick={() => onProcess(settlement.id)}
              loading={onProcessLoading}
              icon={<PlayCircle className="h-4 w-4" />}
            >
              Process Settlement
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default SettlementDetailDrawer;
