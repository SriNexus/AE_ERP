/**
 * PartnerWalletTransactionDrawer — Read-only transaction detail modal for Partner Portal
 *
 * Displays transaction details, timestamps, source, reference, balance before/after, status.
 * Read-only — no editing or actions.
 */

import { Calendar, Hash, ArrowUpRight, ArrowDownLeft, Wallet, FileText, Clock, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { fmtDate, fmtDateTime, fmtCurrency } from '../../lib/firestore';
import type { PartnerWalletTransaction, WalletTransactionType } from '../../features/channel-partner/types';

interface PartnerWalletTransactionDrawerProps {
  transaction: PartnerWalletTransaction | null;
  open: boolean;
  onClose: () => void;
}

const TXN_TYPE_LABELS: Record<WalletTransactionType, string> = {
  commission_credit: 'Commission Credit',
  withdrawal_request: 'Withdrawal Requested',
  withdrawal_approved: 'Withdrawal Approved',
  withdrawal_rejected: 'Withdrawal Rejected',
  withdrawal_paid: 'Withdrawal Paid',
  adjustment: 'Adjustment',
  reversal: 'Reversal',
};

const TXN_TYPE_COLORS: Record<WalletTransactionType, string> = {
  commission_credit: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400',
  withdrawal_request: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400',
  withdrawal_approved: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-400',
  withdrawal_rejected: 'text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400',
  withdrawal_paid: 'text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400',
  adjustment: 'text-purple-600 bg-purple-50 dark:bg-purple-900/20 dark:text-purple-400',
  reversal: 'text-rose-600 bg-rose-50 dark:bg-rose-900/20 dark:text-rose-400',
};

const STATUS_BADGE: Record<string, { label: string; class: string }> = {
  pending: { label: 'Pending', class: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  approved: { label: 'Approved', class: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  paid: { label: 'Paid', class: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  rejected: { label: 'Rejected', class: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
};

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-[var(--color-border-subtle)] last:border-b-0">
      <span className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] shrink-0 min-w-[120px]">
        {label}
      </span>
      <span className="text-sm font-medium text-[var(--color-text)] text-right break-all">
        {children}
      </span>
    </div>
  );
}

export function PartnerWalletTransactionDrawer({ transaction, open, onClose }: PartnerWalletTransactionDrawerProps) {
  if (!transaction) return null;

  const isCredit = transaction.amount > 0;
  const typeLabel = TXN_TYPE_LABELS[transaction.type] || transaction.type.replace(/_/g, ' ');
  const typeColor = TXN_TYPE_COLORS[transaction.type] || 'text-gray-600 bg-gray-50 dark:bg-gray-900/20 dark:text-gray-400';
  const withdrawalStatus = transaction.withdrawalStatus;
  const statusInfo = withdrawalStatus ? STATUS_BADGE[withdrawalStatus] : null;

  return (
    <Modal open={open} onClose={onClose} size="md">
      <div className="space-y-6 text-sm">
        {/* ── Type badge + Amount ────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            {isCredit ? (
              <ArrowDownLeft className="h-4 w-4 text-emerald-500" />
            ) : (
              <ArrowUpRight className="h-4 w-4 text-red-500" />
            )}
            <span className="font-semibold text-[var(--color-text)]">{typeLabel}</span>
          </div>
          {statusInfo && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${statusInfo.class}`}>
              {statusInfo.label}
            </span>
          )}
        </div>

        <p className={`text-2xl font-bold ${isCredit ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
          {isCredit ? '+' : ''}{fmtCurrency(transaction.amount)}
        </p>

        {/* ── Details ────────────────────────────────────── */}
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-sunken)] divide-y divide-[var(--color-border-subtle)]">
          <DetailRow label="Transaction ID">
            <code className="text-xs font-mono bg-[var(--color-surface)] px-1.5 py-0.5 rounded">{transaction.id}</code>
          </DetailRow>
          <DetailRow label="Date & Time">{fmtDateTime(transaction.createdAt)}</DetailRow>
          <DetailRow label="Description">{transaction.description || '—'}</DetailRow>
          <DetailRow label="Source Type">
            <span className="capitalize">{transaction.sourceType || '—'}</span>
          </DetailRow>
          {transaction.sourceId && (
            <DetailRow label="Source ID">
              <code className="text-xs font-mono">{transaction.sourceId}</code>
            </DetailRow>
          )}
          <DetailRow label="Balance Before">{fmtCurrency(transaction.balanceBefore)}</DetailRow>
          <DetailRow label="Balance After">{fmtCurrency(transaction.balanceAfter)}</DetailRow>
        </div>

        {/* ── Withdrawal-specific Details ────────────────── */}
        {transaction.type.startsWith('withdrawal') && (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-sunken)] divide-y divide-[var(--color-border-subtle)]">
            <p className="px-4 pt-3 pb-1 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
              Withdrawal Details
            </p>
            {transaction.withdrawalRequestedAt && (
              <DetailRow label="Requested At">{fmtDateTime(transaction.withdrawalRequestedAt)}</DetailRow>
            )}
            {transaction.withdrawalApprovedAt && (
              <DetailRow label="Approved At">{fmtDateTime(transaction.withdrawalApprovedAt)}</DetailRow>
            )}
            {transaction.withdrawalPaidAt && (
              <DetailRow label="Paid At">{fmtDateTime(transaction.withdrawalPaidAt)}</DetailRow>
            )}
            {transaction.withdrawalRejectedAt && (
              <DetailRow label="Rejected At">{fmtDateTime(transaction.withdrawalRejectedAt)}</DetailRow>
            )}
            {transaction.withdrawalRejectionReason && (
              <DetailRow label="Rejection Reason">{transaction.withdrawalRejectionReason}</DetailRow>
            )}
            {transaction.paymentReference && (
              <DetailRow label="Payment Ref">{transaction.paymentReference}</DetailRow>
            )}
            {transaction.paymentMethod && (
              <DetailRow label="Payment Method">
                <span className="capitalize">{transaction.paymentMethod.replace(/_/g, ' ')}</span>
              </DetailRow>
            )}
          </div>
        )}

        {/* ── Status Timeline ────────────────────────────── */}
        <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
          <p className="px-4 pt-3 pb-1 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            Status Timeline
          </p>
          <div className="px-4 pb-3 space-y-2">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
              <div>
                <p className="text-sm font-medium text-[var(--color-text)]">Transaction Created</p>
                <p className="text-xs text-[var(--color-text-muted)]">{fmtDateTime(transaction.createdAt)}</p>
              </div>
            </div>
            {transaction.withdrawalStatus === 'approved' && (
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-4 w-4 text-blue-500 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">Approved</p>
                  {transaction.withdrawalApprovedAt && (
                    <p className="text-xs text-[var(--color-text-muted)]">{fmtDateTime(transaction.withdrawalApprovedAt)}</p>
                  )}
                </div>
              </div>
            )}
            {transaction.withdrawalStatus === 'paid' && (
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">Paid</p>
                  {transaction.withdrawalPaidAt && (
                    <p className="text-xs text-[var(--color-text-muted)]">{fmtDateTime(transaction.withdrawalPaidAt)}</p>
                  )}
                </div>
              </div>
            )}
            {transaction.withdrawalStatus === 'rejected' && (
              <div className="flex items-center gap-3">
                <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">Rejected</p>
                  {transaction.withdrawalRejectionReason && (
                    <p className="text-xs text-[var(--color-text-muted)]">{transaction.withdrawalRejectionReason}</p>
                  )}
                </div>
              </div>
            )}
            {transaction.updatedAt && transaction.updatedAt !== transaction.createdAt && (
              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 text-[var(--color-text-muted)] shrink-0" />
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">Last Updated</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{fmtDateTime(transaction.updatedAt)}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default PartnerWalletTransactionDrawer;
