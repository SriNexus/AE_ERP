/**
 * Channel Partner — Mapping Utilities
 *
 * Helper functions for transforming partner data between formats.
 * Follows the same pattern as src/lib/entityMappers.ts.
 */

import type {
  ChannelPartner,
  CommissionRule,
  PartnerWalletTransaction,
  SettlementRecord,
  SettlementStatus,
  PartnerStatus,
  KYCStatus,
  PartnerTier,
} from '../types';

type UnknownRecord = Record<string, unknown>;

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numericValue(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function booleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return Boolean(value);
}

/**
 * Maps a raw Firestore document to a typed ChannelPartner.
 */
export function mapToChannelPartner(data: UnknownRecord): ChannelPartner {
  return {
    id: stringValue(data.id),
    companyId: stringValue(data.companyId),
    userId: stringValue(data.userId),
    firmName: stringValue(data.firmName),
    contactPerson: stringValue(data.contactPerson),
    email: stringValue(data.email),
    phone: stringValue(data.phone),
    alternatePhone: stringValue(data.alternatePhone),
    address: (data.address as any) || { line1: '', city: '', state: '', pincode: '', country: 'India' },
    gstNumber: stringValue(data.gstNumber),
    panNumber: stringValue(data.panNumber),
    kycStatus: (stringValue(data.kycStatus) || 'not_started') as KYCStatus,
    kycDocuments: Array.isArray(data.kycDocuments) ? data.kycDocuments.map(String) : [],
    kycVerifiedAt: stringValue(data.kycVerifiedAt),
    kycVerifiedBy: stringValue(data.kycVerifiedBy),
    kycRejectionReason: stringValue(data.kycRejectionReason),
    kycSubmittedAt: stringValue(data.kycSubmittedAt),
    status: (stringValue(data.status) || 'pending_approval') as PartnerStatus,
    statusHistory: Array.isArray(data.statusHistory) ? data.statusHistory : [],
    tier: (stringValue(data.tier) || 'bronze') as PartnerTier,
    tierHistory: Array.isArray(data.tierHistory) ? data.tierHistory : [],
    defaultCommissionType: stringValue(data.defaultCommissionType) as any || undefined,
    defaultCommissionValue: numericValue(data.defaultCommissionValue),
    commissionRuleId: stringValue(data.commissionRuleId),
    bankDetails: data.bankDetails as any || undefined,
    walletBalance: numericValue(data.walletBalance),
    pendingBalance: numericValue(data.pendingBalance),
    totalCommissionEarned: numericValue(data.totalCommissionEarned),
    totalCommissionPaid: numericValue(data.totalCommissionPaid),
    totalLeadsCreated: numericValue(data.totalLeadsCreated),
    totalLeadsConverted: numericValue(data.totalLeadsConverted),
    conversionRate: numericValue(data.conversionRate),
    averageCommissionPerLead: numericValue(data.averageCommissionPerLead),
    assignedSalesPerson: stringValue(data.assignedSalesPerson),
    approvedBy: stringValue(data.approvedBy),
    approvedAt: stringValue(data.approvedAt),
    notes: stringValue(data.notes),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    createdBy: stringValue(data.createdBy),
    createdAt: stringValue(data.createdAt),
    updatedAt: stringValue(data.updatedAt),
    isDeleted: booleanValue(data.isDeleted),
  };
}

/**
 * Maps a raw Firestore document to a typed CommissionRule.
 */
export function mapToCommissionRule(data: UnknownRecord): CommissionRule {
  return {
    id: stringValue(data.id),
    companyId: stringValue(data.companyId),
    name: stringValue(data.name),
    description: stringValue(data.description),
    type: stringValue(data.type) as CommissionRule['type'],
    isActive: booleanValue(data.isActive),
    value: numericValue(data.value),
    minAmount: numericValue(data.minAmount) || undefined,
    maxAmount: numericValue(data.maxAmount) || undefined,
    applicableTo: stringValue(data.applicableTo) as CommissionRule['applicableTo'],
    applicableIds: Array.isArray(data.applicableIds) ? data.applicableIds.map(String) : undefined,
    partnerTier: stringValue(data.partnerTier) as any || undefined,
    minSystemSizeKW: numericValue(data.minSystemSizeKW) || undefined,
    maxSystemSizeKW: numericValue(data.maxSystemSizeKW) || undefined,
    productCategoryId: stringValue(data.productCategoryId) || undefined,
    locationPinCodes: Array.isArray(data.locationPinCodes) ? data.locationPinCodes.map(String) : undefined,
    locationStates: Array.isArray(data.locationStates) ? data.locationStates.map(String) : undefined,
    slabs: Array.isArray(data.slabs) ? data.slabs : undefined,
    effectiveFrom: stringValue(data.effectiveFrom),
    effectiveTo: stringValue(data.effectiveTo) || undefined,
    priority: numericValue(data.priority),
    createdBy: stringValue(data.createdBy),
    createdAt: stringValue(data.createdAt),
    updatedAt: stringValue(data.updatedAt),
    isDeleted: booleanValue(data.isDeleted),
  };
}

/**
 * Maps a raw Firestore document to a typed PartnerWalletTransaction.
 */
export function mapToWalletTransaction(data: UnknownRecord): PartnerWalletTransaction {
  return {
    id: stringValue(data.id),
    companyId: stringValue(data.companyId),
    partnerId: stringValue(data.partnerId),
    type: stringValue(data.type) as PartnerWalletTransaction['type'],
    amount: numericValue(data.amount),
    balanceBefore: numericValue(data.balanceBefore),
    balanceAfter: numericValue(data.balanceAfter),
    sourceType: stringValue(data.sourceType) as PartnerWalletTransaction['sourceType'],
    sourceId: stringValue(data.sourceId),
    description: stringValue(data.description),
    withdrawalStatus: stringValue(data.withdrawalStatus) as any || undefined,
    withdrawalRequestedAt: stringValue(data.withdrawalRequestedAt) || undefined,
    withdrawalApprovedAt: stringValue(data.withdrawalApprovedAt) || undefined,
    withdrawalPaidAt: stringValue(data.withdrawalPaidAt) || undefined,
    withdrawalRejectedAt: stringValue(data.withdrawalRejectedAt) || undefined,
    withdrawalRejectionReason: stringValue(data.withdrawalRejectionReason) || undefined,
    processedBy: stringValue(data.processedBy) || undefined,
    paymentReference: stringValue(data.paymentReference) || undefined,
    paymentMethod: stringValue(data.paymentMethod) as any || undefined,
    createdBy: stringValue(data.createdBy),
    createdAt: stringValue(data.createdAt),
    updatedAt: stringValue(data.updatedAt),
    isDeleted: booleanValue(data.isDeleted),
  };
}

/**
 * Maps a raw Firestore document to a typed SettlementRecord.
 */
export function mapToSettlementRecord(data: UnknownRecord): SettlementRecord {
  return {
    id: stringValue(data.id),
    companyId: stringValue(data.companyId),
    partnerId: stringValue(data.partnerId),
    partnerName: stringValue(data.partnerName) || undefined,
    commissionIds: Array.isArray(data.commissionIds) ? data.commissionIds.map(String) : [],
    commissionCount: numericValue(data.commissionCount) || (Array.isArray(data.commissionIds) ? data.commissionIds.length : 0),
    totalAmount: numericValue(data.totalAmount),
    walletTransactionId: stringValue(data.walletTransactionId) || undefined,
    status: (stringValue(data.status) || 'pending') as SettlementStatus,
    processedBy: stringValue(data.processedBy) || undefined,
    processedAt: stringValue(data.processedAt) || undefined,
    completedAt: stringValue(data.completedAt) || undefined,
    failedAt: stringValue(data.failedAt) || undefined,
    failureReason: stringValue(data.failureReason) || undefined,
    cancelledBy: stringValue(data.cancelledBy) || undefined,
    cancelledAt: stringValue(data.cancelledAt) || undefined,
    cancellationReason: stringValue(data.cancellationReason) || undefined,
    successCount: numericValue(data.successCount),
    skippedCount: numericValue(data.skippedCount),
    failedCount: numericValue(data.failedCount),
    createdBy: stringValue(data.createdBy),
    createdAt: stringValue(data.createdAt),
    updatedAt: stringValue(data.updatedAt),
    isDeleted: booleanValue(data.isDeleted),
  };
}

/**
 * Computes wallet balance from a list of transactions.
 */
export function computeWalletBalance(
  transactions: PartnerWalletTransaction[]
): { available: number; pending: number; totalEarned: number } {
  let available = 0;
  let pending = 0;
  let totalEarned = 0;

  for (const txn of transactions) {
    if (txn.type === 'commission_credit') {
      totalEarned += Math.abs(txn.amount);
      if (txn.withdrawalStatus === 'pending') {
        pending += Math.abs(txn.amount);
      } else {
        available += Math.abs(txn.amount);
      }
    } else if (txn.type === 'withdrawal_request') {
      available -= Math.abs(txn.amount);
    } else if (txn.type === 'withdrawal_paid') {
      available -= Math.abs(txn.amount);
    } else if (txn.type === 'withdrawal_rejected') {
      available += Math.abs(txn.amount);
      pending -= Math.abs(txn.amount);
    } else if (txn.type === 'adjustment') {
      available += txn.amount;
    }
  }

  return { available, pending, totalEarned };
}
