/**
 * channelPartnerSettlement — Settlement & Withdrawal Workflow Engine
 *
 * Complete workflow layer for settlement operations and withdrawal processing.
 * Follows the exact same patterns as partnerLeadIntegration.ts:
 *   - Uses firestore.ts helpers (no Firestore SDK)
 *   - Logs activity via existing logActivity
 *   - Sends notifications via existing system
 *   - Works in both Demo Mode and Firebase Mode
 *
 * Workflow pipeline:
 *   Lead Installed → Commission Generated → Admin Approves Commission
 *   → Settlement Created → Settlement Processed → Wallet Credited
 *   → Partner Requests Withdrawal → Admin Processes Withdrawal
 */

import { updateDocById, genId, createDocWithId, getOne, getAll, resolveWriteCompanyId } from './firestore';
import { COLLECTIONS } from './firebase';
import { useAppStore } from '../store/useAppStore';
import { logActivity } from './workflow';
import { sendNotification, notifyRoleUsers } from './notifications';
import { NotificationType } from '../types';
import type {
  SettlementRecord,
  SettlementStatus,
  CommissionRecord,
  ChannelPartner,
  PartnerWalletTransaction,
  WithdrawalStatus,
} from '../features/channel-partner/types';

// ── Helpers ─────────────────────────────────────────────────

function resolveCompanyId(): string {
  const state = useAppStore.getState();
  return state.activeCompanyId && state.activeCompanyId !== 'all'
    ? state.activeCompanyId
    // Canonical tenant resolution — never the neutral 'default' placeholder.
    : resolveWriteCompanyId();
}

const SETTLEMENT_STATUS_LABELS: Record<SettlementStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const WITHDRAWAL_STATUS_LABELS: Record<WithdrawalStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  processing: 'Processing',
  paid: 'Paid',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

// ═══════════════════════════════════════════════════════════════
//  SETTLEMENT WORKFLOW
// ═══════════════════════════════════════════════════════════════

/**
 * Creates a settlement batch from approved commission records.
 * Validates all records are in 'approved' status before creating the batch.
 * Logs activity and notifies relevant parties.
 */
export async function createSettlementBatch(
  commissionIds: string[],
  metadata?: { partnerId?: string },
): Promise<string | null> {
  const state = useAppStore.getState();
  const companyId = resolveCompanyId();
  const userId = state.user?.id || 'system';

  if (!commissionIds || commissionIds.length === 0) return null;

  // Fetch all commission records
  const records: CommissionRecord[] = [];
  for (const id of commissionIds) {
    const record = await getOne<CommissionRecord>(COLLECTIONS.COMMISSION_RECORDS, id);
    if (record && !record.isDeleted) records.push(record);
  }

  // Filter to only approved records
  const approvedRecords = records.filter((r) => r.status === 'approved');
  if (approvedRecords.length === 0) return null;

  // Group by partner
  const byPartner = new Map<string, CommissionRecord[]>();
  for (const r of approvedRecords) {
    const pid = r.partnerId;
    if (!byPartner.has(pid)) byPartner.set(pid, []);
    byPartner.get(pid)!.push(r);
  }

  // Create a settlement per partner (or single settlement for filtered partner)
  const targetPartnerId = metadata?.partnerId;
  let settlementId: string | null = null;

  for (const [partnerId, partnerRecords] of byPartner) {
    if (targetPartnerId && partnerId !== targetPartnerId) continue;

    const totalAmount = partnerRecords.reduce((sum, r) => sum + (r.approvedAmount || r.amount || 0), 0);
    const id = genId.generic('STL');
    const partner = await getOne<any>(COLLECTIONS.CHANNEL_PARTNERS, partnerId);

    const settlementData = {
      id,
      companyId,
      partnerId,
      partnerName: partner?.firmName || partner?.contactPerson || partnerId,
      commissionIds: partnerRecords.map((r) => r.id),
      commissionCount: partnerRecords.length,
      totalAmount,
      status: 'pending' as const,
      successCount: 0,
      skippedCount: 0,
      failedCount: 0,
      createdBy: userId,
    };

    // Write to partner_wallet_transactions (original - always required for wallet integration)
    await createDocWithId(COLLECTIONS.PARTNER_WALLET_TXNS, id, settlementData);

    // Dual-write: ALSO write to dedicated settlements collection (Phase 2F normalization)
    await createDocWithId(COLLECTIONS.SETTLEMENTS, id, settlementData);

    settlementId = id;

    // Log activity
    await logActivity('Settlements', 'Settlement Batch Created', partnerId, {
      settlementId: id,
      commissionCount: partnerRecords.length,
      totalAmount,
      entityName: partner?.firmName || partnerId,
      actionLabel: `Settlement batch created: ${partnerRecords.length} commissions, ₹${totalAmount.toLocaleString('en-IN')}`,
    });

    // Notify admins
    void notifyRoleUsers(
      ['Admin'],
      NotificationType.SETTLEMENT_COMPLETED,
      'Settlement batch created',
      `Settlement batch for ${partnerRecords.length} approved commissions worth ₹${totalAmount.toLocaleString('en-IN')} created for ${partner?.firmName || partnerId}.`,
      'settlement',
      id,
      companyId,
    ).catch(() => {});
  }

  return settlementId;
}

/**
 * Processes a single settlement batch.
 * Validates current status is 'pending' or 'processing'.
 * Creates wallet credit transactions for each commission.
 * Updates commission records to 'paid' status.
 * Updates settlement status to 'completed'.
 * Returns summary of results.
 */
export async function processSettlementBatch(
  settlementId: string,
): Promise<{ success: number; skipped: number; failed: number; total: number }> {
  const state = useAppStore.getState();
  const companyId = resolveCompanyId();
  const userId = state.user?.id || 'system';

  // Read from dedicated settlements collection (Phase 2F normalization), fallback to legacy
  let settlement = await getOne<any>(COLLECTIONS.SETTLEMENTS, settlementId);
  if (!settlement) {
    settlement = await getOne<any>(COLLECTIONS.PARTNER_WALLET_TXNS, settlementId);
  }
  if (!settlement) throw new Error(`Settlement ${settlementId} not found`);
  if (settlement.status !== 'pending' && settlement.status !== 'processing') {
    throw new Error(`Settlement is not in pending/processing status (current: ${settlement.status})`);
  }

  // Mark as processing — write to BOTH collections
  const processingUpdate = {
    status: 'processing' as SettlementStatus,
    processedBy: userId,
    processedAt: new Date().toISOString(),
  };
  await updateDocById(COLLECTIONS.PARTNER_WALLET_TXNS, settlementId, processingUpdate);
  await updateDocById(COLLECTIONS.SETTLEMENTS, settlementId, processingUpdate);

  const commissionIds: string[] = settlement.commissionIds || [];
  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (const commissionId of commissionIds) {
    try {
      const record = await getOne<CommissionRecord>(COLLECTIONS.COMMISSION_RECORDS, commissionId);
      if (!record) { skipped++; continue; }

      // Skip if already paid
      if (record.status === 'paid') { skipped++; continue; }
      if (record.status !== 'approved') { skipped++; continue; }

      // Credit the wallet via prepareWalletTransaction from partnerLeadIntegration
      // We need to create a wallet transaction and update partner balance
      const amount = record.approvedAmount || record.amount || 0;
      if (amount <= 0) { skipped++; continue; }

      // Get partner's current wallet balance
      const partner = await getOne<any>(COLLECTIONS.CHANNEL_PARTNERS, record.partnerId);
      if (!partner) { skipped++; continue; }

      const balanceBefore = partner.walletBalance || 0;
      const balanceAfter = balanceBefore + amount;

      // Create wallet transaction
      const txnId = genId.generic('WLT');
      await createDocWithId(COLLECTIONS.PARTNER_WALLET_TXNS, txnId, {
        id: txnId,
        partnerId: record.partnerId,
        companyId,
        type: 'commission_credit' as const,
        amount,
        balanceBefore,
        balanceAfter,
        sourceType: 'settlement' as const,
        sourceId: settlementId,
        description: `Settlement processed: ${record.ruleName || 'Commission'} for lead ${record.leadId}`,
        createdBy: userId,
      });

      // Update partner wallet
      await updateDocById(COLLECTIONS.CHANNEL_PARTNERS, record.partnerId, {
        walletBalance: balanceAfter,
        totalCommissionEarned: (partner.totalCommissionEarned || 0) + amount,
      });

      // Mark commission as paid
      await updateDocById(COLLECTIONS.COMMISSION_RECORDS, commissionId, {
        status: 'paid',
        paidBy: userId,
        paidAt: new Date().toISOString(),
        walletTransactionId: txnId,
      });

      // Log activity for this commission
      await logActivity('Settlements', 'Commission Paid via Settlement', record.leadId, {
        settlementId,
        commissionId,
        transactionId: txnId,
        amount,
        partnerId: record.partnerId,
        entityName: record.leadId,
        actionLabel: `Commission of ₹${amount.toLocaleString('en-IN')} paid via settlement ${settlementId}`,
      });

      success++;
    } catch (err) {
      console.error(`Failed to process commission ${commissionId}:`, err);
      failed++;
    }
  }

  const finalStatus: SettlementStatus = failed > 0 ? 'completed' : 'completed';

  // Update settlement record in BOTH collections (dual-write)
  const settlementUpdate: Record<string, unknown> = {
    status: finalStatus,
    completedAt: new Date().toISOString(),
    successCount: success,
    skippedCount: skipped,
    failedCount: failed,
  };
  if (failed > 0 && success === 0) {
    settlementUpdate.status = 'failed';
    settlementUpdate.failureReason = `All ${failed} commission(s) failed to process`;
    settlementUpdate.failedAt = new Date().toISOString();
  }
  await updateDocById(COLLECTIONS.PARTNER_WALLET_TXNS, settlementId, settlementUpdate);
  await updateDocById(COLLECTIONS.SETTLEMENTS, settlementId, settlementUpdate);

  // Log activity
  await logActivity('Settlements', 'Settlement Batch Processed', settlement.partnerId || settlementId, {
    settlementId,
    success,
    skipped,
    failed,
    total: commissionIds.length,
    entityName: settlement.partnerName || settlementId,
    actionLabel: `Settlement processed: ${success} success, ${skipped} skipped, ${failed} failed`,
  });

  // Notify partner and admins
  if (settlement.partnerId) {
    const partner = await getOne<any>(COLLECTIONS.CHANNEL_PARTNERS, settlement.partnerId);
    if (partner?.userId) {
      void sendNotification(
        String(partner.userId),
        NotificationType.SETTLEMENT_COMPLETED,
        'Settlement completed',
        `Settlement of ₹${settlement.totalAmount?.toLocaleString('en-IN') || '0'} has been processed. ${success} commission(s) credited.`,
        'settlement',
        settlementId,
        companyId,
      ).catch(() => {});
    }
  }

  void notifyRoleUsers(
    ['Admin'],
    NotificationType.SETTLEMENT_COMPLETED,
    'Settlement batch completed',
    `Settlement processed: ${success} success, ${skipped} skipped, ${failed} failed. Total: ${commissionIds.length} records.`,
    'settlement',
    settlementId,
    companyId,
  ).catch(() => {});

  return { success, skipped, failed, total: commissionIds.length };
}

// ═══════════════════════════════════════════════════════════════
//  SETTLEMENT STATUS TRANSITIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Validates and transitions a settlement to a new status.
 */
async function transitionSettlementStatus(
  settlementId: string,
  newStatus: SettlementStatus,
  metadata?: { failureReason?: string; cancelledBy?: string; cancellationReason?: string },
): Promise<void> {
  const state = useAppStore.getState();
  // Read from settlements collection first (Phase 2F normalization), fallback to legacy
  let settlement = await getOne<any>(COLLECTIONS.SETTLEMENTS, settlementId);
  if (!settlement) {
    settlement = await getOne<any>(COLLECTIONS.PARTNER_WALLET_TXNS, settlementId);
  }
  if (!settlement) throw new Error(`Settlement ${settlementId} not found`);

  const current = settlement.status as SettlementStatus;
  const validTransitions: Record<SettlementStatus, SettlementStatus[]> = {
    pending: ['processing', 'cancelled'],
    processing: ['completed', 'failed', 'cancelled'],
    completed: [],
    failed: ['processing'],
    cancelled: [],
  };

  if (!validTransitions[current]?.includes(newStatus)) {
    throw new Error(`Cannot transition settlement from ${current} to ${newStatus}`);
  }

  const updates: Record<string, unknown> = {
    status: newStatus,
    updatedBy: state.user?.id || 'system',
  };

  if (newStatus === 'cancelled') {
    updates.cancelledBy = metadata?.cancelledBy || state.user?.id || 'system';
    updates.cancelledAt = new Date().toISOString();
    updates.cancellationReason = metadata?.cancellationReason || '';
  }
  if (newStatus === 'failed') {
    updates.failedAt = new Date().toISOString();
    updates.failureReason = metadata?.failureReason || '';
  }
  if (newStatus === 'completed') {
    updates.completedAt = new Date().toISOString();
  }

  // Dual-write status update to BOTH collections (Phase 2F normalization)
  await updateDocById(COLLECTIONS.PARTNER_WALLET_TXNS, settlementId, updates);
  await updateDocById(COLLECTIONS.SETTLEMENTS, settlementId, updates);

  await logActivity('Settlements', `Settlement ${SETTLEMENT_STATUS_LABELS[newStatus]}`, settlement.partnerId || settlementId, {
    settlementId,
    fromStatus: current,
    toStatus: newStatus,
    entityName: settlement.partnerName || settlementId,
    actionLabel: `Settlement status changed from ${SETTLEMENT_STATUS_LABELS[current]} to ${SETTLEMENT_STATUS_LABELS[newStatus]}`,
  });
}

/**
 * Cancels a settlement. Only pending settlements can be cancelled.
 */
export async function cancelSettlement(
  settlementId: string,
  reason?: string,
): Promise<void> {
  return transitionSettlementStatus(settlementId, 'cancelled', {
    cancellationReason: reason || 'Cancelled by admin',
  });
}

/**
 * Retries a failed settlement.
 */
export async function retrySettlement(settlementId: string): Promise<void> {
  await transitionSettlementStatus(settlementId, 'processing');
  return processSettlementBatch(settlementId).then(() => {});
}

// ═══════════════════════════════════════════════════════════════
//  WITHDRAWAL PROCESSING
// ═══════════════════════════════════════════════════════════════

/**
 * Validates a withdrawal state transition is allowed.
 */
function validateWithdrawalTransition(
  current: WithdrawalStatus | undefined,
  next: WithdrawalStatus,
): void {
  const valid: Record<WithdrawalStatus, WithdrawalStatus[]> = {
    pending: ['approved', 'rejected', 'cancelled'],
    approved: ['processing', 'rejected', 'cancelled'],
    processing: ['paid', 'cancelled'],
    paid: [],
    rejected: [],
    cancelled: [],
  };

  const currentStatus: WithdrawalStatus = current || 'pending';
  const allowed = valid[currentStatus];
  if (!allowed?.includes(next)) {
    throw new Error(
      `Invalid withdrawal status transition: ${WITHDRAWAL_STATUS_LABELS[currentStatus]} → ${WITHDRAWAL_STATUS_LABELS[next]}`,
    );
  }
}

/**
 * Approves a pending withdrawal request.
 * Status: pending → approved
 * Updates the wallet transaction and partner record.
 */
export async function approveWithdrawal(
  withdrawalId: string,
  metadata?: { approvedBy?: string },
): Promise<void> {
  const state = useAppStore.getState();
  const companyId = resolveCompanyId();
  const userId = metadata?.approvedBy || state.user?.id || 'system';

  const txn = await getOne<PartnerWalletTransaction>(COLLECTIONS.PARTNER_WALLET_TXNS, withdrawalId);
  if (!txn) throw new Error(`Withdrawal transaction ${withdrawalId} not found`);
  if (txn.type !== 'withdrawal_request') throw new Error('Transaction is not a withdrawal request');

  validateWithdrawalTransition(txn.withdrawalStatus, 'approved');

  await updateDocById(COLLECTIONS.PARTNER_WALLET_TXNS, withdrawalId, {
    withdrawalStatus: 'approved' as WithdrawalStatus,
    withdrawalApprovedAt: new Date().toISOString(),
    processedBy: userId,
  });

  await logActivity('Settlements', 'Withdrawal Approved', txn.partnerId || withdrawalId, {
    withdrawalId,
    amount: Math.abs(txn.amount),
    approvedBy: userId,
    entityName: withdrawalId,
    actionLabel: `Withdrawal of ₹${Math.abs(txn.amount || 0).toLocaleString('en-IN')} approved`,
  });

  // Notify partner
  const partner = await getOne<any>(COLLECTIONS.CHANNEL_PARTNERS, txn.partnerId);
  if (partner?.userId) {
    void sendNotification(
      String(partner.userId),
      NotificationType.WITHDRAWAL_APPROVED,
      'Withdrawal approved',
      `Your withdrawal request of ₹${Math.abs(txn.amount || 0).toLocaleString('en-IN')} has been approved.`,
      'withdrawal',
      withdrawalId,
      companyId,
    ).catch(() => {});
  }
}

/**
 * Rejects a pending/approved withdrawal request.
 * Status: pending/approved → rejected
 * Returns funds to wallet balance.
 */
export async function rejectWithdrawal(
  withdrawalId: string,
  reason: string,
  metadata?: { rejectedBy?: string },
): Promise<void> {
  const state = useAppStore.getState();
  const companyId = resolveCompanyId();
  const userId = metadata?.rejectedBy || state.user?.id || 'system';

  const txn = await getOne<PartnerWalletTransaction>(COLLECTIONS.PARTNER_WALLET_TXNS, withdrawalId);
  if (!txn) throw new Error(`Withdrawal transaction ${withdrawalId} not found`);
  if (txn.type !== 'withdrawal_request') throw new Error('Transaction is not a withdrawal request');

  validateWithdrawalTransition(txn.withdrawalStatus, 'rejected');

  // Return funds to wallet
  const amount = Math.abs(txn.amount);
  const partner = await getOne<any>(COLLECTIONS.CHANNEL_PARTNERS, txn.partnerId);

  await updateDocById(COLLECTIONS.PARTNER_WALLET_TXNS, withdrawalId, {
    withdrawalStatus: 'rejected' as WithdrawalStatus,
    withdrawalRejectedAt: new Date().toISOString(),
    withdrawalRejectionReason: reason,
    processedBy: userId,
  });

  // Reverse the wallet hold (add funds back)
  if (partner) {
    await updateDocById(COLLECTIONS.CHANNEL_PARTNERS, txn.partnerId, {
      walletBalance: (partner.walletBalance || 0) + amount,
    });
  }

  await logActivity('Settlements', 'Withdrawal Rejected', txn.partnerId || withdrawalId, {
    withdrawalId,
    amount,
    reason,
    rejectedBy: userId,
    entityName: withdrawalId,
    actionLabel: `Withdrawal of ₹${amount.toLocaleString('en-IN')} rejected: ${reason}`,
  });

  // Notify partner
  if (partner?.userId) {
    void sendNotification(
      String(partner.userId),
      NotificationType.WITHDRAWAL_REJECTED,
      'Withdrawal rejected',
      `Your withdrawal request of ₹${amount.toLocaleString('en-IN')} was rejected. Reason: ${reason}`,
      'withdrawal',
      withdrawalId,
      companyId,
    ).catch(() => {});
  }
}

/**
 * Marks a withdrawal as processing.
 * Status: approved → processing
 */
export async function processWithdrawal(
  withdrawalId: string,
  metadata?: { processedBy?: string },
): Promise<void> {
  const state = useAppStore.getState();
  const userId = metadata?.processedBy || state.user?.id || 'system';

  const txn = await getOne<PartnerWalletTransaction>(COLLECTIONS.PARTNER_WALLET_TXNS, withdrawalId);
  if (!txn) throw new Error(`Withdrawal transaction ${withdrawalId} not found`);

  validateWithdrawalTransition(txn.withdrawalStatus, 'processing' as WithdrawalStatus);

  await updateDocById(COLLECTIONS.PARTNER_WALLET_TXNS, withdrawalId, {
    withdrawalStatus: 'processing' as WithdrawalStatus,
    processedBy: userId,
  });

  await logActivity('Settlements', 'Withdrawal Processing', txn.partnerId || withdrawalId, {
    withdrawalId,
    amount: Math.abs(txn.amount),
    processedBy: userId,
    entityName: withdrawalId,
    actionLabel: `Withdrawal of ₹${Math.abs(txn.amount || 0).toLocaleString('en-IN')} marked as processing`,
  });
}

/**
 * Marks a withdrawal as paid — final step.
 * Status: processing/approved → paid
 * Deducts the amount from the partner's wallet permanently.
 */
export async function completeWithdrawal(
  withdrawalId: string,
  metadata?: {
    paymentReference?: string;
    paymentMethod?: string;
    paidBy?: string;
  },
): Promise<void> {
  const state = useAppStore.getState();
  const companyId = resolveCompanyId();
  const userId = metadata?.paidBy || state.user?.id || 'system';

  const txn = await getOne<PartnerWalletTransaction>(COLLECTIONS.PARTNER_WALLET_TXNS, withdrawalId);
  if (!txn) throw new Error(`Withdrawal transaction ${withdrawalId} not found`);

  validateWithdrawalTransition(txn.withdrawalStatus, 'paid');

  const amount = Math.abs(txn.amount);

  await updateDocById(COLLECTIONS.PARTNER_WALLET_TXNS, withdrawalId, {
    withdrawalStatus: 'paid' as WithdrawalStatus,
    withdrawalPaidAt: new Date().toISOString(),
    paymentReference: metadata?.paymentReference || '',
    paymentMethod: (metadata?.paymentMethod as any) || 'bank_transfer',
    processedBy: userId,
  });

  await logActivity('Settlements', 'Withdrawal Paid', txn.partnerId || withdrawalId, {
    withdrawalId,
    amount,
    paymentReference: metadata?.paymentReference,
    paidBy: userId,
    entityName: withdrawalId,
    actionLabel: `Withdrawal of ₹${amount.toLocaleString('en-IN')} completed (Ref: ${metadata?.paymentReference || 'N/A'})`,
  });

  // Notify partner
  const partner = await getOne<any>(COLLECTIONS.CHANNEL_PARTNERS, txn.partnerId);
  if (partner?.userId) {
    void sendNotification(
      String(partner.userId),
      NotificationType.WITHDRAWAL_PAID,
      'Withdrawal completed',
      `Your withdrawal of ₹${amount.toLocaleString('en-IN')} has been paid.${metadata?.paymentReference ? ` Reference: ${metadata.paymentReference}` : ''}`,
      'withdrawal',
      withdrawalId,
      companyId,
    ).catch(() => {});
  }

  // Create a reversal transaction to reflect the permanent deduction
  const reversalId = genId.generic('WLT');
  const partnerBalance = partner?.walletBalance || 0;
  await createDocWithId(COLLECTIONS.PARTNER_WALLET_TXNS, reversalId, {
    id: reversalId,
    partnerId: txn.partnerId,
    companyId,
    type: 'withdrawal_paid' as const,
    amount: -amount,
    balanceBefore: partnerBalance,
    balanceAfter: partnerBalance - amount,
    sourceType: 'withdrawal' as const,
    sourceId: withdrawalId,
    description: `Withdrawal paid: ${amount.toLocaleString('en-IN')} (Ref: ${metadata?.paymentReference || 'N/A'})`,
    withdrawalStatus: 'paid' as WithdrawalStatus,
    withdrawalPaidAt: new Date().toISOString(),
    paymentReference: metadata?.paymentReference || '',
    paymentMethod: (metadata?.paymentMethod as any) || 'bank_transfer',
    processedBy: userId,
    createdBy: userId,
  });

  // Deduct from wallet permanently
  await updateDocById(COLLECTIONS.CHANNEL_PARTNERS, txn.partnerId, {
    walletBalance: Math.max(0, partnerBalance - amount),
    totalCommissionPaid: (partner?.totalCommissionPaid || 0) + amount,
  });
}

/**
 * Cancels a pending withdrawal.
 * Status: pending → cancelled
 */
export async function cancelWithdrawal(
  withdrawalId: string,
  reason?: string,
): Promise<void> {
  const state = useAppStore.getState();

  const txn = await getOne<PartnerWalletTransaction>(COLLECTIONS.PARTNER_WALLET_TXNS, withdrawalId);
  if (!txn) throw new Error(`Withdrawal transaction ${withdrawalId} not found`);

  validateWithdrawalTransition(txn.withdrawalStatus, 'cancelled');

  // Return funds to wallet
  const amount = Math.abs(txn.amount);
  const partner = await getOne<any>(COLLECTIONS.CHANNEL_PARTNERS, txn.partnerId);

  await updateDocById(COLLECTIONS.PARTNER_WALLET_TXNS, withdrawalId, {
    withdrawalStatus: 'cancelled' as WithdrawalStatus,
  });

  if (partner) {
    await updateDocById(COLLECTIONS.CHANNEL_PARTNERS, txn.partnerId, {
      walletBalance: (partner.walletBalance || 0) + amount,
    });
  }

  await logActivity('Settlements', 'Withdrawal Cancelled', txn.partnerId || withdrawalId, {
    withdrawalId,
    amount,
    reason: reason || 'Cancelled by admin',
    entityName: withdrawalId,
    actionLabel: `Withdrawal of ₹${amount.toLocaleString('en-IN')} cancelled${reason ? `: ${reason}` : ''}`,
  });
}

export default {
  createSettlementBatch,
  processSettlementBatch,
  cancelSettlement,
  retrySettlement,
  approveWithdrawal,
  rejectWithdrawal,
  processWithdrawal,
  completeWithdrawal,
  cancelWithdrawal,
};
