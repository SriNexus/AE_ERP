/**
 * BatchWithdrawalModal — Batch withdrawal processing with progress indicator and summary
 *
 * Handles: approve, reject, process, mark paid, cancel of multiple withdrawals at once.
 * Internally calls the existing single-withdrawal workflow functions.
 * Logs activity and generates notifications for each processed withdrawal.
 */

import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  XCircle,
  PlayCircle,
  CreditCard,
  Ban,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { approveWithdrawal, rejectWithdrawal, processWithdrawal, completeWithdrawal, cancelWithdrawal } from '../../lib/channelPartnerSettlement';
import { queryKeys } from '../../lib/queryKeys';
import { useAppStore } from '../../store/useAppStore';

type BatchAction = 'approve' | 'reject' | 'process' | 'pay' | 'cancel';

interface BatchWithdrawalModalProps {
  open: boolean;
  onClose: () => void;
  withdrawals: any[];
  action: BatchAction;
  partnerNames: Record<string, string>;
  onComplete: (summary: { success: number; failed: number; errors: string[] }) => void;
}

interface ProgressItem {
  id: string;
  status: 'pending' | 'processing' | 'success' | 'failed';
  error?: string;
}

export function BatchWithdrawalModal({ open, onClose, withdrawals, action, partnerNames, onComplete }: BatchWithdrawalModalProps) {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const companyKeys = queryKeys.forCompany(activeCompanyId);
  const queryClient = useQueryClient();

  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [paymentRef, setPaymentRef] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');

  const isRejectAction = action === 'reject';
  const isPayAction = action === 'pay';

  const actionLabel = {
    approve: 'Approve',
    reject: 'Reject',
    process: 'Mark Processing',
    pay: 'Mark Paid',
    cancel: 'Cancel',
  }[action];

  const actionIcon = {
    approve: <CheckCircle2 className="h-4 w-4" />,
    reject: <XCircle className="h-4 w-4" />,
    process: <PlayCircle className="h-4 w-4" />,
    pay: <CreditCard className="h-4 w-4" />,
    cancel: <Ban className="h-4 w-4" />,
  }[action];

  const totalAmount = withdrawals.reduce((sum, w) => sum + Math.abs(w.amount || 0), 0);

  const processWithdrawalFn = useCallback(async (w: any): Promise<void> => {
    switch (action) {
      case 'approve':
        await approveWithdrawal(w.id);
        break;
      case 'reject':
        if (!rejectionReason.trim()) throw new Error('Rejection reason is required');
        await rejectWithdrawal(w.id, rejectionReason);
        break;
      case 'process':
        await processWithdrawal(w.id);
        break;
      case 'pay':
        if (!paymentRef.trim()) throw new Error('Payment reference is required');
        await completeWithdrawal(w.id, { paymentReference: paymentRef, paymentMethod: 'bank_transfer' });
        break;
      case 'cancel':
        await cancelWithdrawal(w.id);
        break;
    }
  }, [action, rejectionReason, paymentRef]);

  const executeBatch = useMutation({
    mutationFn: async () => {
      setProgress(withdrawals.map(w => ({ id: w.id, status: 'pending' as const })));
      const results: ProgressItem[] = [];
      const errors: string[] = [];

      for (let i = 0; i < withdrawals.length; i++) {
        const w = withdrawals[i];
        setProgress(prev => prev.map((p, idx) => idx === i ? { ...p, status: 'processing' } : p));
        try {
          await processWithdrawalFn(w);
          results.push({ id: w.id, status: 'success' });
          setProgress(prev => prev.map((p, idx) => idx === i ? { ...p, status: 'success' } : p));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${w.id}: ${msg}`);
          results.push({ id: w.id, status: 'failed', error: msg });
          setProgress(prev => prev.map((p, idx) => idx === i ? { ...p, status: 'failed', error: msg } : p));
        }
      }

      return {
        success: results.filter(r => r.status === 'success').length,
        failed: results.filter(r => r.status === 'failed').length,
        errors,
      };
    },
    onSuccess: (summary) => {
      queryClient.invalidateQueries({ queryKey: companyKeys.partnerWalletTxns });
      if (summary.failed === 0) {
        toast.success(`Successfully ${actionLabel === 'Mark Paid' ? 'paid' : actionLabel === 'Mark Processing' ? 'marked as processing' : actionLabel === 'Cancel' ? 'cancelled' : actionLabel + 'd'} ${summary.success} withdrawal(s)`);
      } else {
        toast.success(`${summary.success} processed, ${summary.failed} failed`);
      }
      onComplete(summary);
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Batch processing failed');
    },
  });

  const running = executeBatch.isPending;
  const successCount = progress.filter(p => p.status === 'success').length;
  const failedCount = progress.filter(p => p.status === 'failed').length;

  return (
    <Modal open={open} onClose={running ? () => {} : onClose} size="md">
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-xl ${
            action === 'approve' ? 'bg-emerald-100 text-emerald-600' :
            action === 'reject' ? 'bg-red-100 text-red-600' :
            action === 'process' ? 'bg-indigo-100 text-indigo-600' :
            action === 'pay' ? 'bg-blue-100 text-blue-600' :
            'bg-gray-100 text-gray-600'
          }`}>
            {actionIcon}
          </div>
          <div>
            <h3 className="text-sm font-bold text-[var(--color-text)]">Batch {actionLabel}</h3>
            <p className="text-xs text-[var(--color-text-muted)]">
              {withdrawals.length} withdrawal(s) · Total: ₹{totalAmount.toLocaleString('en-IN')}
            </p>
          </div>
        </div>

        {/* Input fields for reject/pay */}
        {isRejectAction && !running && (
          <div>
            <label className="block text-[10px] font-semibold uppercase text-[var(--color-text-muted)] mb-1">
              Rejection Reason <span className="text-red-500">*</span>
            </label>
            <Input
              placeholder="Enter reason for rejection..."
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
            />
          </div>
        )}

        {isPayAction && !running && (
          <div>
            <label className="block text-[10px] font-semibold uppercase text-[var(--color-text-muted)] mb-1">
              Payment Reference <span className="text-red-500">*</span>
            </label>
            <Input
              placeholder="e.g., NEFT-12345, UPI-REF-678"
              value={paymentRef}
              onChange={(e) => setPaymentRef(e.target.value)}
            />
          </div>
        )}

        {/* Withdrawal list */}
        <div className="space-y-1.5 max-h-52 overflow-y-auto">
          {withdrawals.map((w, i) => {
            const p = progress[i];
            const partnerName = partnerNames[w.partnerId] || w.partnerId || '—';
            return (
              <div key={w.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-xs ${
                p?.status === 'success' ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800' :
                p?.status === 'failed' ? 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800' :
                p?.status === 'processing' ? 'bg-indigo-50 border-indigo-200 dark:bg-indigo-900/20 dark:border-indigo-800' :
                'border-[var(--color-border-subtle)]'
              }`}>
                {p?.status === 'success' ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" /> :
                 p?.status === 'failed' ? <XCircle className="h-4 w-4 text-red-500 shrink-0" /> :
                 p?.status === 'processing' ? <Loader2 className="h-4 w-4 text-indigo-500 animate-spin shrink-0" /> :
                 <div className="h-4 w-4 rounded-full border-2 border-[var(--color-border)] shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{partnerName}</p>
                  <p className="text-[10px] text-[var(--color-text-muted)] font-mono">{w.id?.slice(0, 16)}…</p>
                </div>
                <span className="font-semibold tabular-nums">₹{Math.abs(w.amount || 0).toLocaleString('en-IN')}</span>
                {p?.error && <AlertTriangle className="h-3 w-3 text-red-500 shrink-0" aria-label={p.error} />}
              </div>
            );
          })}
        </div>

        {/* Progress bar */}
        {running && progress.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-[var(--color-text-muted)]">
                Processing {successCount + failedCount} of {withdrawals.length}
              </span>
              <span className="text-xs font-semibold">{Math.round(((successCount + failedCount) / withdrawals.length) * 100)}%</span>
            </div>
            <div className="h-2 bg-[var(--color-bg-sunken)] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all duration-300"
                style={{ width: `${((successCount + failedCount) / withdrawals.length) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Summary */}
        {!running && progress.length > 0 && (successCount > 0 || failedCount > 0) && (
          <div className="flex gap-3">
            {successCount > 0 && (
              <div className="flex-1 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3 text-center">
                <p className="text-lg font-bold text-emerald-600">{successCount}</p>
                <p className="text-[10px] font-medium text-emerald-700">Success</p>
              </div>
            )}
            {failedCount > 0 && (
              <div className="flex-1 bg-red-50 dark:bg-red-900/20 rounded-xl p-3 text-center">
                <p className="text-lg font-bold text-red-600">{failedCount}</p>
                <p className="text-[10px] font-medium text-red-700">Failed</p>
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--color-border-subtle)]">
          {!running && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              {successCount > 0 || failedCount > 0 ? 'Close' : 'Cancel'}
            </Button>
          )}
          {!running && progress.length === 0 && (
            <Button
              size="sm"
              onClick={() => executeBatch.mutate()}
              disabled={(isRejectAction && !rejectionReason.trim()) || (isPayAction && !paymentRef.trim())}
              icon={actionIcon}
            >
              {actionLabel} {withdrawals.length} Withdrawal(s)
            </Button>
          )}
          {running && (
            <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Processing...
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default BatchWithdrawalModal;
