/**
 * Channel Partner — Domain Types
 *
 * Central type definitions for the Channel Partner module.
 * Follows the same pattern as existing ERP type definitions.
 * Feature-specific types live here, global types live in src/types/index.ts.
 */

import type { BaseRecord } from '../../../types';

// ── Status Enums ─────────────────────────────────────────────

export type PartnerStatus =
  | 'pending_approval'
  | 'active'
  | 'suspended'
  | 'inactive';

export type KYCStatus =
  | 'not_started'
  | 'pending'
  | 'submitted'
  | 'verified'
  | 'rejected';

export type CommissionStatus =
  | 'pending'
  | 'calculated'
  | 'approved'
  | 'paid'
  | 'voided';

export type CommissionRuleType =
  | 'percentage'
  | 'fixed'
  | 'per_kw'
  | 'per_deal'
  | 'slab';

export type CommissionApplicability =
  | 'all'
  | 'partner'
  | 'partner_tier'
  | 'product_category'
  | 'location';

export type PartnerTier =
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'platinum';

export type WalletTransactionType =
  | 'commission_credit'
  | 'withdrawal_request'
  | 'withdrawal_approved'
  | 'withdrawal_rejected'
  | 'withdrawal_paid'
  | 'adjustment'
  | 'reversal';

export type WithdrawalStatus =
  | 'pending'
  | 'approved'
  | 'processing'
  | 'paid'
  | 'rejected'
  | 'cancelled';

export type SettlementStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type PaymentMethod =
  | 'bank_transfer'
  | 'cheque'
  | 'cash'
  | 'upi';

// ── Address ──────────────────────────────────────────────────

export interface PartnerAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
}

// ── Bank Details ─────────────────────────────────────────────

export interface PartnerBankDetails {
  accountNumber: string;
  ifscCode: string;
  bankName: string;
  branchName?: string;
  accountHolderName: string;
  accountType: 'savings' | 'current';
  verified: boolean;
}

// ── Status History Entry ─────────────────────────────────────

export interface PartnerStatusChange {
  status: string;
  changedBy: string;
  changedAt: string;
  reason?: string;
}

// ── Commission Slab ──────────────────────────────────────────

export interface CommissionSlab {
  fromKW: number;
  toKW: number;
  value: number;
  type: 'percentage' | 'fixed' | 'per_kw';
}

// ═════════════════════════════════════════════════════════════
//  CHANNEL PARTNER
// ═════════════════════════════════════════════════════════════

export interface ChannelPartner extends BaseRecord {
  /** Authenticated Neozy users doc id — the one-to-one link between the
   * partner record and their login identity (Phase 0 contract §9.1: partnerId
   * = channel_partners doc id, userId/createdBy = users doc id; never conflate). */
  userId: string;
  /** TL/Manager users doc id who supervises this partner (Phase 0 contract
   * §9.1 / §7 hierarchy: Admin → Management → Manager/TL → Partner). Used by
   * team-visibility machinery (`teamMemberIds`) in later phases. */
  managerId?: string;
  /** Denormalized display name of the assigned manager (set alongside
   * `managerId` by assignPartnerManager for read-friendly UIs). */
  managerName?: string;
  firmName: string;
  contactPerson: string;
  email: string;
  phone: string;
  alternatePhone?: string;
  address: PartnerAddress;
  gstNumber?: string;
  panNumber?: string;

  // KYC
  kycStatus: KYCStatus;
  kycDocuments: string[];
  kycVerifiedAt?: string;
  kycVerifiedBy?: string;
  kycRejectionReason?: string;
  kycSubmittedAt?: string;

  // Status
  status: PartnerStatus;
  statusHistory: PartnerStatusChange[];

  // Tier
  tier: PartnerTier;
  tierHistory: TierChangeEntry[];

  // Commission Configuration
  defaultCommissionType?: CommissionRuleType;
  defaultCommissionValue?: number;
  commissionRuleId?: string;

  // Financial
  bankDetails?: PartnerBankDetails;
  walletBalance: number;
  pendingBalance: number;
  totalCommissionEarned: number;
  totalCommissionPaid: number;

  // Metrics
  totalLeadsCreated: number;
  totalLeadsConverted: number;
  conversionRate: number;
  averageCommissionPerLead: number;

  // Relationships
  assignedSalesPerson?: string;
  approvedBy?: string;
  approvedAt?: string;

  // Metadata
  notes?: string;
  tags?: string[];
}

// ═════════════════════════════════════════════════════════════
//  PARTNER WALLET TRANSACTION
// ═════════════════════════════════════════════════════════════

export interface PartnerWalletTransaction extends BaseRecord {
  partnerId: string;

  // Transaction details
  type: WalletTransactionType;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;

  // Source
  sourceType: 'commission' | 'withdrawal' | 'adjustment' | 'settlement';
  sourceId: string;
  description: string;

  // Withdrawal-specific
  withdrawalStatus?: WithdrawalStatus;
  withdrawalRequestedAt?: string;
  withdrawalApprovedAt?: string;
  withdrawalPaidAt?: string;
  withdrawalRejectedAt?: string;
  withdrawalRejectionReason?: string;
  processedBy?: string;
  paymentReference?: string;
  paymentMethod?: PaymentMethod;
}

// ═════════════════════════════════════════════════════════════
//  COMMISSION RULE
// ═════════════════════════════════════════════════════════════

export interface CommissionRule extends BaseRecord {
  name: string;
  description?: string;
  type: CommissionRuleType;
  isActive: boolean;
  value: number;
  minAmount?: number;
  maxAmount?: number;

  // Applicability
  applicableTo: CommissionApplicability;
  applicableIds?: string[];
  partnerTier?: PartnerTier;

  // Conditions
  minSystemSizeKW?: number;
  maxSystemSizeKW?: number;
  productCategoryId?: string;
  locationPinCodes?: string[];
  locationStates?: string[];

  // Slab-based rules
  slabs?: CommissionSlab[];

  // Validity
  effectiveFrom: string;
  effectiveTo?: string;
  priority: number;
}

// ═════════════════════════════════════════════════════════════
//  COMMISSION RECORD
// ═════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════
//  SETTLEMENT RECORD
// ═════════════════════════════════════════════════════════════

export interface SettlementRecord extends BaseRecord {
  partnerId: string;
  partnerName?: string;

  // Linked commission records
  commissionIds: string[];
  commissionCount: number;

  // Financial
  totalAmount: number;
  walletTransactionId?: string;

  // Status
  status: SettlementStatus;

  // Processing
  processedBy?: string;
  processedAt?: string;
  completedAt?: string;
  failedAt?: string;
  failureReason?: string;
  cancelledBy?: string;
  cancelledAt?: string;
  cancellationReason?: string;

  // Summary
  successCount: number;
  skippedCount: number;
  failedCount: number;
}

// ═════════════════════════════════════════════════════════════
//  TIER CHANGE ENTRY
// ═════════════════════════════════════════════════════════════

export interface TierChangeEntry {
  oldTier: PartnerTier;
  newTier: PartnerTier;
  changedAt: string;
  reason: string;
  changeType: 'automatic' | 'manual';
  changedBy: string;
  changedByName: string;
  /** Snapshot of metrics at time of change */
  metricsAtChange?: {
    totalRevenue: number;
    totalCommissionEarned: number;
    totalLeadsCreated: number;
    totalLeadsConverted: number;
    conversionRate: number;
    performanceScore: number;
    activeMonths: number;
  };
}

// ═════════════════════════════════════════════════════════════
//  TIER RULE
// ═════════════════════════════════════════════════════════════

export interface TierRule {
  /** From tier */
  fromTier: PartnerTier;
  /** To tier (upgrade target) — if null, this is a 'stay' rule */
  toTier: PartnerTier | null;
  /** Comparison direction */
  direction: 'upgrade' | 'downgrade' | 'stay';
  /** Conditions that must all be met */
  conditions: TierCondition[];
  /** Whether this rule is active */
  enabled: boolean;
}

export interface TierCondition {
  field: TierConditionField;
  operator: '>=' | '<=' | '>' | '<' | '==';
  value: number;
  /** Human-readable label for the condition */
  label: string;
}

export type TierConditionField =
  | 'totalRevenue'
  | 'totalCommissionEarned'
  | 'totalLeadsCreated'
  | 'totalLeadsConverted'
  | 'conversionRate'
  | 'successfulSettlements'
  | 'activeMonths'
  | 'performanceScore'
  | 'manualBonusScore';

// ── Tier Evaluation ────────────────────────────────────────

export interface TierEvaluationInput {
  partnerId: string;
  currentTier: PartnerTier;
  metrics: {
    totalRevenue: number;
    totalCommissionEarned: number;
    totalLeadsCreated: number;
    totalLeadsConverted: number;
    conversionRate: number;
    successfulSettlements: number;
    activeMonths: number;
    performanceScore: number;
    manualBonusScore?: number;
  };
}

export interface TierEvaluationResult {
  recommendedTier: PartnerTier;
  direction: 'upgrade' | 'downgrade' | 'stay';
  passedConditions: { label: string }[];
  failedConditions: { label: string; required: number; actual: number }[];
  reasons: string[];
  score: number; // 0-100 confidence score
}

export interface TierPreview {
  partnerId: string;
  partnerName: string;
  currentTier: PartnerTier;
  recommendedTier: PartnerTier;
  direction: 'upgrade' | 'downgrade' | 'stay';
  reasons: string[];
  score: number;
  metrics: TierEvaluationInput['metrics'];
}

export interface CommissionRecord extends BaseRecord {
  leadId: string;
  partnerId: string;

  // Calculation inputs
  dealValue: number;
  systemSizeKW: number;
  ruleId?: string;
  ruleName?: string;
  ruleType: string;
  ruleValue: number;

  // Result
  amount: number;
  cappedAmount?: number;
  status: CommissionStatus;

  // Generated
  generatedDate?: string;

  // Approval
  approvedBy?: string;
  approvedAt?: string;
  approvedAmount?: number;
  rejectionReason?: string;

  // Payment
  paidAt?: string;
  paidBy?: string;
  paymentReference?: string;
  walletTransactionId?: string;

  // Calculation breakdown from engine (stored for audit/reports)
  calculationBreakdown?: Record<string, unknown>;

  // ── Rule Snapshot (for recalculation/preview) ──────────────
  /** Historical snapshot of the rule used when this commission was generated */
  ruleSnapshot?: RuleSnapshot;
  /** Previous recalculated amounts, most recent first — enables undo */
  recalculationHistory?: RecalculationEntry[];
}

// ── Rule Snapshot ──────────────────────────────────────────

export interface RuleSnapshot {
  ruleId: string;
  ruleName: string;
  ruleType: CommissionRuleType;
  ruleValue: number;
  minAmount?: number;
  maxAmount?: number;
  slabs?: CommissionSlab[];
  effectiveFrom?: string;
  effectiveTo?: string;
  priority: number;
}

// ── Recalculation Entry ────────────────────────────────────

export interface RecalculationEntry {
  timestamp: string;
  recalculatedBy: string;
  recalculatedByName: string;
  useCurrentRules: boolean;
  previousAmount: number;
  newAmount: number;
  difference: number;
  reason: string;
}

// ── Recalculation Preview ──────────────────────────────────

export interface RecalculationPreview {
  commissionId: string;
  leadId: string;
  partnerId: string;
  partnerName: string;
  /** Current (old) values */
  oldAmount: number;
  oldStatus: string;
  /** Proposed (new) values */
  newAmount: number;
  /** Difference */
  difference: number;
  /** Human-readable reason for the change */
  reason: string;
  /** Whether preview suggests a change */
  changed: boolean;
  /** Rule used for recalculation */
  ruleUsed: string;
}
