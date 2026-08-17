/**
 * PartnerWithdrawalModal — Withdrawal request for Partner Portal
 *
 * Fields: Amount, Bank Account (read-only), Notes
 * Validation: amount > 0, amount <= available balance
 * Calls existing requestWithdrawal workflow.
 * If workflow throws "not implemented", shows a friendly toast.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Wallet, Building2, AlertTriangle, Handshake } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input, Textarea } from '../../components/ui/Input';
import { fmtCurrency } from '../../lib/firestore';
import { requestWithdrawal } from '../../lib/channelPartnerWorkflow';
import type { ChannelPartner } from '../../features/channel-partner/types';

interface PartnerWithdrawalModalProps {
  open: boolean;
  onClose: () => void;
  partner: ChannelPartner | undefined;
}

export function PartnerWithdrawalModal({ open, onClose, partner }: PartnerWithdrawalModalProps) {
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');

  const availableBalance = partner?.walletBalance ?? 0;
  const bankDetails = partner?.bankDetails;
  const hasBank = Boolean(bankDetails?.accountNumber && bankDetails?.ifscCode);

  const submitWithdrawal = useMutation({
    mutationFn: async () => {
      if (!partner?.id) throw new Error('Partner profile not found');
      const amt = Number(amount);
      if (!amt || amt <= 0) throw new Error('Amount must be greater than 0');
      if (amt > availableBalance) throw new Error(`Insufficient balance. Available: ${fmtCurrency(availableBalance)}`);

      // Call the workflow — may throw "not implemented" for stubs
      try {
        return await requestWithdrawal(partner.id, amt);
      } catch (err: any) {
        // If the workflow stub throws "not implemented", show friendly message
        const msg = String(err?.message || err);
        if (msg.toLowerCase().includes('not implemented') || msg.toLowerCase().includes('later phase')) {
          toast.error('Withdrawal requests will be available in a future release.');
          return null;
        }
        throw err;
      }
    },
    onSuccess: (result) => {
      if (result === null) {
        // Already showed the friendly toast inside the mutationFn
        handleClose();
        return;
      }
      toast.success('Withdrawal request submitted successfully!');
      handleClose();
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to submit withdrawal request');
    },
  });

  function handleClose() {
    setAmount('');
    setNotes('');
    onClose();
  }

  function handleSubmit() {
    if (submitWithdrawal.isPending) return;
    submitWithdrawal.mutate();
  }

  return (
    <Modal open={open} onClose={handleClose} title="Request Withdrawal" size="lg">
      <div className="space-y-5">
        {/* Available balance info */}
        <div className="flex items-center gap-3 rounded-xl border border-[var(--color-primary-muted)] bg-[var(--color-primary-light)] px-4 py-3 text-sm">
          <Wallet className="h-5 w-5 text-[var(--color-primary-text)] shrink-0" />
          <div>
            <p className="font-semibold text-[var(--color-primary-text)]">
              Available Balance: {fmtCurrency(availableBalance)}
            </p>
            <p className="text-xs text-[var(--color-primary-text)] opacity-80">
              Enter the amount you wish to withdraw from your wallet.
            </p>
          </div>
        </div>

        {/* Bank Account (read-only) */}
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-4">
          <div className="flex items-center gap-2 mb-2">
            <Building2 className="h-4 w-4 text-[var(--color-text-muted)]" />
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
              Bank Account on File
            </p>
          </div>
          {hasBank ? (
            <div className="space-y-1 text-sm">
              <p className="font-medium text-[var(--color-text)]">
                {bankDetails!.accountHolderName || partner?.contactPerson || '—'}
              </p>
              <p className="text-[var(--color-text-secondary)]">
                {bankDetails!.bankName} · {bankDetails!.accountNumber}
              </p>
              <p className="text-[var(--color-text-muted)] text-xs">
                IFSC: {bankDetails!.ifscCode}
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span>No bank account configured. Contact your administrator.</span>
            </div>
          )}
        </div>

        {/* Amount input */}
        <Input
          label="Withdrawal Amount (₹)"
          type="number"
          min={1}
          max={availableBalance}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Enter amount to withdraw"
          required
        />

        {/* Notes */}
        <Textarea
          label="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any additional information..."
          rows={2}
        />

        {/* Validation summary */}
        {amount && Number(amount) > availableBalance && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Amount exceeds available balance of {fmtCurrency(availableBalance)}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-border-subtle)]">
          <Button variant="outline" onClick={handleClose} disabled={submitWithdrawal.isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            loading={submitWithdrawal.isPending}
            disabled={!amount || Number(amount) <= 0 || Number(amount) > availableBalance}
          >
            Request Withdrawal
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default PartnerWithdrawalModal;
