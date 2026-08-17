/**
 * WithdrawalDetailDrawer — Admin withdrawal processing drawer
 *
 * Read-only detail view with admin action buttons for each status transition.
 * Actions: approve, reject (with reason), process, pay (with reference), cancel.
 * Every transition validates state and logs activity.
 * Includes immutable audit trail timeline.
 */

import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DollarSign,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ArrowUpRight,
  ThumbsUp,
  Ban,
  CreditCard,
  PlayCircle,
  User,
  RefreshCw,
  Archive,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input, Textarea } from '../ui/Input';
import { fmtDateTime, fmtCurrency } from '../../lib/firestore';
import {
  approveWithdrawal,
  rejectWithdrawal,
  processWithdrawal,
  completeWithdrawal,
  cancelWithdrawal,
} from '../../lib/channelPartnerSettlement';
import { queryKeys } from '../../lib/queryKeys';
import { useAppStore } from '../../store/useAppStore';
import { loadSettlementAuditTrail, type SettlementAuditEntry } from '../../lib/settlementAudit';

interface WithdrawalDetailDrawerProps {
  withdrawal: any;
  open: boolean;
  onClose: () => void;
  onRefresh?: () => void;
}

const STATUS_STYLES: Record<string, string> = {
  pending:    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  approved:   'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  processing: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  paid:       'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  rejected:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  cancelled:  'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

const STATUS_LABELS: Record<string, string> = {
  pending:    'Pending',
  approved:   'Approved',
  processing: 'Processing',
  paid:       'Paid',
  rejected:   'Rejected',
  cancelled:  'Cancelled',
};

const AUDIT_ICONS: Record<string, React.ReactNode> = {
  requested: <ArrowUpRight className="h-4 w-4 text-amber-500" />,
  created: <Clock className="h-4 w-4 text-amber-500" />,
  approved: <ThumbsUp className="h-4 w-4 text-blue-500" />,
  rejected: <XCircle className="h-4 w-4 text-red-500" />,
  processing: <PlayCircle className="h-4 w-4 text-indigo-500" />,
  paid: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
  completed: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
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

export function WithdrawalDetailDrawer({ withdrawal, open, onClose, onRefresh }: WithdrawalDetailDrawerProps) {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const companyKeys = queryKeys.forCompany(activeCompanyId);
  const queryClient = useQueryClient();
  const [auditEntries, setAuditEntries] = useState<SettlementAuditEntry[]>([]);

  useEffect(() => {
    if (open && withdrawal?.id) {
      loadSettlementAuditTrail(withdrawal.id).then(setAuditEntries).catch(() => setAuditEntries([]));
    } else {
      setAuditEntries([]);
    }
  }, [open, withdrawal?.id]);

  const [paymentRef, setPaymentRef] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer');
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [showPaymentInput, setShowPaymentInput] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancelInput, setShowCancelInput] = useState(false);

  function invalidateAndClose() {
    queryClient.invalidateQueries({ queryKey: companyKeys.partnerWalletTxns });
    if (onRefresh) onRefresh();
    setPaymentRef('');
    setRejectionReason('');
    setShowRejectInput(false);
    setShowPaymentInput(false);
    setCancelReason('');
    setShowCancelInput(false);
  }

  const approveMutation = useMutation({
    mutationFn: () => approveWithdrawal(withdrawal.id),
    onSuccess: () => { toast.success('Withdrawal approved'); invalidateAndClose(); },
    onError: (err: any) => toast.error(err?.message || 'Failed to approve'),
  });

  const rejectMutation = useMutation({
    mutationFn: () => rejectWithdrawal(withdrawal.id, rejectionReason),
    onSuccess: () => { toast.success('Withdrawal rejected'); invalidateAndClose(); },
    onError: (err: any) => toast.error(err?.message || 'Failed to reject'),
  });

  const processMutation = useMutation({
    mutationFn: () => processWithdrawal(withdrawal.id),
    onSuccess: () => { toast.success('Withdrawal marked as processing'); invalidateAndClose(); },
    onError: (err: any) => toast.error(err?.message || 'Failed to process'),
  });

  const payMutation = useMutation({
    mutationFn: () => completeWithdrawal(withdrawal.id, {
      paymentReference: paymentRef,
      paymentMethod,
    }),
    onSuccess: () => { toast.success('Withdrawal completed'); invalidateAndClose(); },
    onError: (err: any) => toast.error(err?.message || 'Failed to complete'),
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelWithdrawal(withdrawal.id, cancelReason),
    onSuccess: () => { toast.success('Withdrawal cancelled'); invalidateAndClose(); },
    onError: (err: any) => toast.error(err?.message || 'Failed to cancel'),
  });

  if (!withdrawal) return null;

  const status = withdrawal.withdrawalStatus || 'pending';
  const isPending = status === 'pending';
  const isApproved = status === 'approved';
  const isProcessing = status === 'processing';
  const isPaid = status === 'paid';
  const isRejected = status === 'rejected';
  const isCancelled = status === 'cancelled';

  return (
    <Modal open={open} onClose={onClose} size="md">
      <div className="space-y-6 text-sm">
        {/* ── Header ──────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ArrowUpRight className="h-5 w-5 text-red-500" />
            <span className="font-semibold text-[var(--color-text)]">Withdrawal</span>
          </div>
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[status] || ''}`}>
            {STATUS_LABELS[status] || status}
          </span>
        </div>

        <p className="text-2xl font-bold text-red-600 dark:text-red-400">
          -{fmtCurrency(Math.abs(withdrawal.amount || 0))}
        </p>

        {/* ── Withdrawal Info ─────────────────────────────── */}
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-sunken)] divide-y divide-[var(--color-border-subtle)]">
          <DetailRow label="Txn ID">
            <code className="text-xs font-mono bg-[var(--color-surface)] px-1.5 py-0.5 rounded">{withdrawal.id}</code>
          </DetailRow>
          <DetailRow label="Partner">{withdrawal.partnerName || withdrawal.partnerId || '—'}</DetailRow>
          <DetailRow label="Amount">{fmtCurrency(Math.abs(withdrawal.amount || 0))}</DetailRow>
          <DetailRow label="Description">{withdrawal.description || '—'}</DetailRow>
          <DetailRow label="Requested">{fmtDateTime(withdrawal.createdAt)}</DetailRow>
          {withdrawal.withdrawalApprovedAt && <DetailRow label="Approved At">{fmtDateTime(withdrawal.withdrawalApprovedAt)}</DetailRow>}
          {withdrawal.withdrawalPaidAt && <DetailRow label="Paid At">{fmtDateTime(withdrawal.withdrawalPaidAt)}</DetailRow>}
          {withdrawal.withdrawalRejectedAt && <DetailRow label="Rejected At">{fmtDateTime(withdrawal.withdrawalRejectedAt)}</DetailRow>}
          {withdrawal.withdrawalRejectionReason && <DetailRow label="Rejection Reason"><span className="text-red-600">{withdrawal.withdrawalRejectionReason}</span></DetailRow>}
          {withdrawal.paymentReference && <DetailRow label="Payment Ref">{withdrawal.paymentReference}</DetailRow>}
          {withdrawal.paymentMethod && <DetailRow label="Method"><span className="capitalize">{withdrawal.paymentMethod.replace(/_/g, ' ')}</span></DetailRow>}
          {withdrawal.processedBy && <DetailRow label="Processed By">{withdrawal.processedBy}</DetailRow>}
        </div>

        {/* ── Balance Info ────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-[var(--color-bg-sunken)] p-3 text-center">
            <p className="text-[10px] font-medium text-[var(--color-text-muted)]">Balance Before</p>
            <p className="text-sm font-semibold">{fmtCurrency(withdrawal.balanceBefore || 0)}</p>
          </div>
          <div className="rounded-lg bg-[var(--color-bg-sunken)] p-3 text-center">
            <p className="text-[10px] font-medium text-[var(--color-text-muted)]">Amount</p>
            <p className="text-sm font-semibold text-red-500">{fmtCurrency(Math.abs(withdrawal.amount || 0))}</p>
          </div>
          <div className="rounded-lg bg-[var(--color-bg-sunken)] p-3 text-center">
            <p className="text-[10px] font-medium text-[var(--color-text-muted)]">Balance After</p>
            <p className="text-sm font-semibold">{fmtCurrency(withdrawal.balanceAfter || 0)}</p>
          </div>
        </div>

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

        {/* ── Admin Actions ───────────────────────────────── */}
        <div className="flex flex-wrap gap-2 pt-2 border-t border-[var(--color-border-subtle)]">
          {isPending && (
            <>
              <Button size="sm" icon={<ThumbsUp className="h-3.5 w-3.5" />} onClick={() => approveMutation.mutate()} loading={approveMutation.isPending}>
                Approve
              </Button>
              {!showRejectInput ? (
                <Button size="sm" variant="outline" icon={<XCircle className="h-3.5 w-3.5" />} onClick={() => setShowRejectInput(true)}>
                  Reject
                </Button>
              ) : (
                <div className="flex items-center gap-2 w-full">
                  <Input
                    placeholder="Rejection reason..."
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    className="flex-1"
                  />
                  <Button size="sm" variant="danger" onClick={() => rejectMutation.mutate()} loading={rejectMutation.isPending} disabled={!rejectionReason.trim()}>
                    Confirm Reject
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowRejectInput(false)}>Cancel</Button>
                </div>
              )}
              <Button size="sm" variant="ghost" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => setShowCancelInput(true)}>
                Cancel
              </Button>
            </>
          )}

          {isApproved && (
            <>
              <Button size="sm" icon={<PlayCircle className="h-3.5 w-3.5" />} onClick={() => processMutation.mutate()} loading={processMutation.isPending}>
                Mark Processing
              </Button>
              {!showRejectInput ? (
                <Button size="sm" variant="outline" icon={<XCircle className="h-3.5 w-3.5" />} onClick={() => setShowRejectInput(true)}>
                  Reject
                </Button>
              ) : (
                <div className="flex items-center gap-2 w-full">
                  <Input placeholder="Rejection reason..." value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} className="flex-1" />
                  <Button size="sm" variant="danger" onClick={() => rejectMutation.mutate()} loading={rejectMutation.isPending} disabled={!rejectionReason.trim()}>Confirm Reject</Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowRejectInput(false)}>Cancel</Button>
                </div>
              )}
            </>
          )}

          {isProcessing && (
            <>
              {!showPaymentInput ? (
                <Button size="sm" icon={<CreditCard className="h-3.5 w-3.5" />} onClick={() => setShowPaymentInput(true)}>
                  Mark as Paid
                </Button>
              ) : (
                <div className="space-y-2 w-full">
                  <Input placeholder="Payment reference (e.g., NEFT-12345)" value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} />
                  <div className="flex items-center gap-2">
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                      className="text-xs border border-[var(--color-border)] rounded-lg px-2 py-1.5 bg-[var(--color-surface)]"
                    >
                      <option value="bank_transfer">Bank Transfer</option>
                      <option value="cheque">Cheque</option>
                      <option value="upi">UPI</option>
                      <option value="cash">Cash</option>
                    </select>
                    <Button size="sm" onClick={() => payMutation.mutate()} loading={payMutation.isPending} disabled={!paymentRef.trim()}>
                      Confirm Paid
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowPaymentInput(false)}>Cancel</Button>
                  </div>
                </div>
              )}
            </>
          )}

          {isPending && showCancelInput && (
            <div className="flex items-center gap-2 w-full">
              <Input placeholder="Cancellation reason..." value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="flex-1" />
              <Button size="sm" variant="danger" onClick={() => cancelMutation.mutate()} loading={cancelMutation.isPending}>
                Confirm Cancel
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowCancelInput(false)}>Back</Button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default WithdrawalDetailDrawer;
