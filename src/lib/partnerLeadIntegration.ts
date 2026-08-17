/**
 * partnerLeadIntegration — Workflow layer connecting Channel Partners to the Lead system
 *
 * This file bridges the Channel Partner domain and the existing Lead module.
 * It does NOT create a parallel lead system — it extends the existing one.
 *
 * Every function:
 * 1. Operates on the existing `leads` collection
 * 2. Logs activity via the existing `logActivity` function
 * 3. Sends notifications via the existing notification system
 * 4. Works in both Demo Mode and Firebase Mode
 *
 * The Lead module remains the single source of truth for all leads.
 */

import { updateDocById, genId, createDocWithId, getOne, getAll, resolveWriteCompanyId } from './firestore';
import { resolveCurrentPartnerDocId } from './partnerOwnership';
import { COLLECTIONS } from './firebase';
import { useAppStore } from '../store/useAppStore';
import { logActivity } from './workflow';
import { sendNotification, notifyRoleUsers } from './notifications';
import { NotificationType } from '../types';
import {
  type CommissionStatus,
  type InstallationStatus,
  type DocumentationStatus,
  type PayoutStatus,
} from '../features/channel-partner/types/leadIntegration';
import type { CommissionRule, CommissionRecord } from '../features/channel-partner/types';
import {
  resolveCommissionRule,
  calculateCommission,
  getCommissionBreakdown,
} from './channelPartnerCommissionEngine';

// ── Helpers ─────────────────────────────────────────────────

function resolveCompanyId(): string {
  const state = useAppStore.getState();
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  return resolveWriteCompanyId();
}

/**
 * Phase 3 (§9.2 rule 3 / Services): resolve the partner attribution of a
 * Customer — used by project creation to propagate partnerId/partnerName
 * onward (Customer → Project) instead of dropping ownership.
 */
export async function resolvePartnerFromCustomer(customerId: string): Promise<{ partnerId?: string; partnerName?: string } | null> {
  const customer = await getOne<{ partnerId?: string; partnerName?: string }>(COLLECTIONS.CUSTOMERS, customerId);
  if (!customer) return null;
  return { partnerId: customer.partnerId, partnerName: customer.partnerName };
}

/**
 * Phase 3 (§9.2 rule 3 / Services): resolve the partner attribution of a
 * Project — used by downstream phases (survey/registration/commission) to
 * keep the ownership chain intact without re-deriving ownership from the
 * current user, URL, or UI state.
 */
export async function resolvePartnerFromProject(projectId: string): Promise<{ partnerId?: string; partnerName?: string } | null> {
  const project = await getOne<{ partnerId?: string; partnerName?: string }>(COLLECTIONS.PROJECTS, projectId);
  if (!project) return null;
  return { partnerId: project.partnerId, partnerName: project.partnerName };
}

/**
 * Mark a lead as partner-originated.
 * Called when creating a lead identified as coming from a partner.
 */
export async function assignLeadToPartner(
  leadId: string,
  partnerId: string,
  partnerName: string,
): Promise<void> {
  await updateDocById(COLLECTIONS.LEADS, leadId, {
    partnerId,
    partnerName,
    commissionStatus: 'eligible',
    installationStatus: 'pending',
    documentationStatus: 'pending',
    payoutStatus: 'pending',
    updatedBy: useAppStore.getState().user?.id || 'system',
  });

  await logActivity('Leads', 'Assigned to Partner', leadId, {
    partnerId,
    partnerName,
    entityName: partnerName || partnerId,
    actionLabel: 'Lead assigned to channel partner',
  });
}

/**
 * Auto-generates a CommissionRecord when status reaches `installation_complete`.
 * Update installation progress on a partner-lead.
 */
export async function updateInstallationStatus(
  leadId: string,
  status: InstallationStatus,
  note?: string,
): Promise<void> {
  const companyId = resolveCompanyId();
  const state = useAppStore.getState();

  await updateDocById(COLLECTIONS.LEADS, leadId, {
    installationStatus: status,
    ...(status === 'installation_complete' ? { installationCompletedAt: new Date().toISOString() } : {}),
    updatedBy: state.user?.id || 'system',
  });

  const statusLabel = status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  await logActivity('Leads', `Installation ${statusLabel}`, leadId, {
    entityName: leadId,
    actionLabel: `Installation status updated to ${statusLabel}`,
    note,
  });

  // Notify the partner if lead has one
  const lead = await getOne(COLLECTIONS.LEADS, leadId) as any;
  if (lead?.userId) {
    const notifType = status === 'installation_complete'
      ? NotificationType.INSTALLATION_COMPLETED
      : NotificationType.INSTALLATION_SCHEDULED;
    void sendNotification(
      String(lead.userId),
      notifType,
      'Installation updated',
      `Installation for lead ${lead.name || leadId} is now: ${statusLabel}`,
      'lead',
      leadId,
      companyId,
    ).catch(() => {});
  }

  // Auto-generate commission record when installation completes
  if (status === 'installation_complete') {
    await generateCommissionRecord(leadId);
  }
}

/**
 * Update documentation status on a partner-lead.
 */
export async function updateDocumentationStatus(
  leadId: string,
  status: DocumentationStatus,
  documentName?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const companyId = resolveCompanyId();
  const state = useAppStore.getState();

  await updateDocById(COLLECTIONS.LEADS, leadId, {
    documentationStatus: status,
    updatedBy: state.user?.id || 'system',
  });

  const statusLabel = status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  await logActivity('Leads', `Documentation ${statusLabel}`, leadId, {
    entityName: leadId,
    actionLabel: `Documentation status updated to ${statusLabel}`,
    documentName,
    ...metadata,
  });

  const lead = await getOne(COLLECTIONS.LEADS, leadId) as any;
  if (lead?.userId) {
    const notificationType = status === 'verified'
      ? NotificationType.DOCUMENT_VERIFIED
      : status === 'rejected'
        ? NotificationType.DOCUMENT_REJECTED
        : NotificationType.DOCUMENT_REQUIRED;

    void sendNotification(
      String(lead.userId),
      notificationType,
      'Document update',
      status === 'verified'
        ? `Document "${documentName || 'document'}" was verified.`
        : status === 'rejected'
          ? `Document "${documentName || 'document'}" was rejected.`
          : 'Additional documents are required.',
      'lead',
      leadId,
      companyId,
    ).catch(() => {});
  }
}

/**
 * Update commission status on a partner-lead (state management only — no calculation).
 */
export async function updateCommissionStatus(
  leadId: string,
  status: CommissionStatus,
  metadata?: { amount?: number; ruleId?: string },
): Promise<void> {
  const companyId = resolveCompanyId();
  const state = useAppStore.getState();

  const updates: Record<string, unknown> = {
    commissionStatus: status,
    updatedBy: state.user?.id || 'system',
  };
  if (metadata?.amount !== undefined) updates.commissionAmount = metadata.amount;
  if (metadata?.ruleId) updates.partnerCommissionRuleId = metadata.ruleId;
  if (status === 'generated') updates.commissionGeneratedAt = new Date().toISOString();

  await updateDocById(COLLECTIONS.LEADS, leadId, updates);

  const statusLabel = status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  await logActivity('Leads', `Commission ${statusLabel}`, leadId, {
    entityName: leadId,
    actionLabel: `Commission status updated to ${statusLabel}`,
    ...metadata,
  });

  // Notify partner & admins
  const lead = await getOne(COLLECTIONS.LEADS, leadId) as any;
  const notificationCompanyId = resolveCompanyId();

  if (lead?.userId) {
    const type = status === 'approved'
      ? NotificationType.COMMISSION_APPROVED
      : NotificationType.COMMISSION_GENERATED;
    void sendNotification(
      String(lead.userId),
      type,
      'Commission update',
      `Commission for lead ${lead.name || leadId} is now: ${statusLabel}`,
      'lead',
      leadId,
      notificationCompanyId,
    ).catch(() => {});
  }
}

/**
 * Update payout status on a partner-lead.
 */
export async function updatePayoutStatus(
  leadId: string,
  status: PayoutStatus,
): Promise<void> {
  const state = useAppStore.getState();

  await updateDocById(COLLECTIONS.LEADS, leadId, {
    payoutStatus: status,
    updatedBy: state.user?.id || 'system',
  });

  const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
  await logActivity('Leads', `Payout ${statusLabel}`, leadId, {
    entityName: leadId,
    actionLabel: `Payout status updated to ${statusLabel}`,
  });

  if (status === 'paid') {
    const companyId = resolveCompanyId();
    const lead = await getOne(COLLECTIONS.LEADS, leadId) as any;
    if (lead?.userId) {
      void sendNotification(
        String(lead.userId),
        NotificationType.SETTLEMENT_COMPLETED,
        'Settlement completed',
        `Settlement for lead ${lead.name || leadId} has been completed.`,
        'lead',
        leadId,
        companyId,
      ).catch(() => {});
    }
  }
}

// ── Partner Creates Lead ────────────────────────────────────

export interface PartnerCreateLeadInput {
  name: string;
  phone: string;
  email?: string;
  city?: string;
  state?: string;
  notes?: string;
  partnerId: string;
  partnerName: string;
}

/**
 * A partner creates a lead through their portal.
 * The lead is created in the standard `leads` collection with partner attribution.
 * Company employees then work the lead as usual.
 */
export async function partnerCreateLead(input: PartnerCreateLeadInput): Promise<string> {
  const state = useAppStore.getState();
  const companyId = resolveCompanyId();
  const leadId = genId.lead('PLD'); // Partner Lead prefix

  // Phase 3 (§9.3 server-side validation): a Partner-role actor may only
  // attribute a lead to THEIR OWN linked channel_partners doc. The canonical
  // partner id is derived from the authenticated user (users.channelPartnerId,
  // resolved+cached by partnerOwnership); a supplied input.partnerId that
  // differs is rejected outright — a partner cannot claim another partner's
  // lead by tampering with the payload. Non-partner actors (e.g. an Admin
  // creating a lead on behalf of a partner) have no resolved link, so the
  // supplied id is accepted unchanged.
  const authenticatedPartnerId = await resolveCurrentPartnerDocId();
  const suppliedPartnerId = String(input.partnerId || '').trim();
  const effectivePartnerId = suppliedPartnerId || authenticatedPartnerId;
  if (!effectivePartnerId) {
    throw new Error('Partner profile not found. Cannot create lead.');
  }
  if (authenticatedPartnerId && suppliedPartnerId && authenticatedPartnerId !== suppliedPartnerId) {
    throw new Error('Lead partner attribution does not match the authenticated partner account.');
  }

  const leadDoc = {
    id: leadId,
    companyId,
    name: input.name,
    phone: input.phone,
    email: input.email || '',
    city: input.city || '',
    state: input.state || '',
    source: 'Channel Partner',
    status: 'New',
    notes: input.notes || '',
    partnerId: effectivePartnerId,
    partnerName: input.partnerName,
    // Store the partner's user UID so notifications reach them
    userId: state.user?.id || '',
    // Partner workflow fields
    commissionStatus: 'eligible' as CommissionStatus,
    installationStatus: 'pending' as InstallationStatus,
    documentationStatus: 'pending' as DocumentationStatus,
    payoutStatus: 'pending' as PayoutStatus,
    // Phase 3 (audit G5/§9.1): createdBy must be the authenticated USER id,
    // never the partner doc id — ownership resolution and self-visibility
    // key off users docs. createdByName is the user's display name.
    createdBy: state.user?.id || '',
    createdByName: state.user?.name || input.partnerName || effectivePartnerId,
    updatedBy: state.user?.id || '',
    isDeleted: false,
  };

  await createDocWithId(COLLECTIONS.LEADS, leadId, leadDoc);

  // Activity log
  await logActivity('Leads', 'Lead Created by Partner', leadId, {
    partnerId: effectivePartnerId,
    partnerName: input.partnerName,
    entityName: input.name || input.phone || leadId,
    actionLabel: `Lead created by partner ${input.partnerName}`,
  });

  // Notify company roles
  const notificationCompanyId = resolveCompanyId();
  await notifyRoleUsers(
    ['Admin', 'Sales'],
    NotificationType.LEAD_CREATED_BY_PARTNER,
    'New partner lead',
    `${input.partnerName} created a new lead: ${input.name || input.phone}`,
    'lead',
    leadId,
    notificationCompanyId,
  );

  return leadId;
}


// ═══════════════════════════════════════════════════════════
//  COMMISSION RECORD GENERATION (state management — no calculation)
// ═══════════════════════════════════════════════════════════

/**
 * Generates a CommissionRecord when an installation is completed.
 * Uses the Commission Engine for actual calculation.
 * Stores: partnerId, leadId, ruleId, systemKW, calculated amount, breakdown.
 */
export async function generateCommissionRecord(leadId: string): Promise<string | null> {
  const state = useAppStore.getState();
  const companyId = resolveCompanyId();
  const lead = await getOne(COLLECTIONS.LEADS, leadId) as any;
  if (!lead || !lead.partnerId) return null;

  // Resolve the best matching rule using the Commission Engine
  const allRules = await getAll<CommissionRule>(COLLECTIONS.COMMISSION_RULES);
  const companyRules = allRules.filter(r => r.companyId === companyId);
  const resolution = resolveCommissionRule(companyRules, {
    partnerId: lead.partnerId,
  });

  const activeRule = resolution.rule;
  const dealValue = lead.dealValue || 0;
  const systemSizeKW = lead.systemSizeKW || 0;

  // Calculate commission using the engine
  const calculation = activeRule
    ? calculateCommission({
        dealValue,
        systemSizeKW,
        rule: activeRule,
      })
    : null;

  const recordId = genId.generic('CRM');
  const commissionAmount = calculation?.finalAmount || 0;
  const breakdown = calculation ? getCommissionBreakdown(calculation) : null;

  const commissionRecord: Partial<CommissionRecord> = {
    id: recordId,
    companyId,
    leadId,
    partnerId: lead.partnerId,
    dealValue,
    systemSizeKW,
    ruleId: activeRule?.id || lead.partnerCommissionRuleId,
    ruleName: activeRule?.name || resolution.explanation || 'No Rule',
    ruleType: activeRule?.type || 'per_kw',
    ruleValue: activeRule?.value || 0,
    amount: commissionAmount,
    // Store calculation breakdown for audit/display
    ...(breakdown ? { calculationBreakdown: breakdown } : {}),
    status: 'pending',
    generatedDate: new Date().toISOString(),
    createdBy: state.user?.id || 'system',
  };

  await createDocWithId(COLLECTIONS.COMMISSION_RECORDS, recordId, commissionRecord as any);

  // Update lead status
  await updateDocById(COLLECTIONS.LEADS, leadId, {
    commissionStatus: 'generated',
    commissionAmount,
    partnerCommissionRuleId: activeRule?.id || lead.partnerCommissionRuleId,
    commissionGeneratedAt: new Date().toISOString(),
    updatedBy: state.user?.id || 'system',
  });

  const ruleInfo = activeRule?.name || resolution.explanation || 'No matching rule';
  const calcSummary = calculation
    ? `₹${commissionAmount.toLocaleString('en-IN')} (${calculation.formula})`
    : '₹0 — No matching rule';

  await logActivity('Leads', 'Commission Generated', leadId, {
    recordId,
    ruleName: ruleInfo,
    ruleApplied: activeRule?.id,
    amount: commissionAmount,
    formula: calculation?.formula,
    calculationBreakdown: breakdown,
    entityName: lead.name || leadId,
    actionLabel: `Commission generated: ${calcSummary}`,
  });

  // Notify admins
  void notifyRoleUsers(
    ['Admin'],
    NotificationType.COMMISSION_GENERATED,
    'Commission record generated',
    `Commission of ₹${commissionAmount.toLocaleString('en-IN')} generated for lead ${lead.name || leadId}. Rule: ${ruleInfo}`,
    'commission',
    recordId,
    companyId,
  ).catch(() => {});

  return recordId;
}

/**
 * Approve or reject a pending commission record.
 */
export async function approveCommissionRecord(
  recordId: string,
  approved: boolean,
  metadata?: { approvedAmount?: number; rejectionReason?: string },
): Promise<void> {
  const state = useAppStore.getState();
  const companyId = resolveCompanyId();

  const record = await getOne<CommissionRecord>(COLLECTIONS.COMMISSION_RECORDS, recordId);
  if (!record) throw new Error(`Commission record ${recordId} not found`);
  if (record.status !== 'pending') throw new Error('Commission record is not pending');

  const newStatus = approved ? 'approved' : 'voided';
  await updateDocById(COLLECTIONS.COMMISSION_RECORDS, recordId, {
    status: newStatus,
    approvedBy: state.user?.id || 'system',
    approvedAt: new Date().toISOString(),
    approvedAmount: metadata?.approvedAmount,
    rejectionReason: metadata?.rejectionReason,
    updatedBy: state.user?.id || 'system',
  });

  // Also update the lead's commission status
  const notificationType = approved
    ? NotificationType.COMMISSION_APPROVED
    : NotificationType.COMMISSION_GENERATED;
  await logActivity('Leads', `Commission ${approved ? 'Approved' : 'Rejected'}`, record.leadId, {
    recordId,
    entityName: record.leadId,
    actionLabel: `Commission record ${approved ? 'approved' : 'rejected'}`,
  });

  // Notify the partner
  const lead = await getOne(COLLECTIONS.LEADS, record.leadId) as any;
  if (lead?.userId) {
    void sendNotification(
      String(lead.userId),
      notificationType,
      approved ? 'Commission approved' : 'Commission rejected',
      approved
        ? `Commission of ₹${metadata?.approvedAmount || record.amount} has been approved.`
        : `Commission was rejected: ${metadata?.rejectionReason || 'No reason provided'}.`,
      'commission',
      recordId,
      companyId,
    ).catch(() => {});
  }
}

// ═══════════════════════════════════════════════════════════
//  WALLET INTEGRATION HOOKS (Phase 8.1)
// ═══════════════════════════════════════════════════════════

/**
 * Marks a lead's commission as eligible.
 * Called when a partner lead reaches a qualifying status.
 */
export async function markCommissionEligible(leadId: string): Promise<void> {
  const state = useAppStore.getState();
  await updateDocById(COLLECTIONS.LEADS, leadId, {
    commissionStatus: 'eligible',
    updatedBy: state.user?.id || 'system',
  });

  await logActivity('Leads', 'Commission Eligible', leadId, {
    entityName: leadId,
    actionLabel: 'Lead marked as commission-eligible',
  });
}

/**
 * Marks a commission record as approved and updates the lead status.
 * Does NOT create a wallet transaction — that is done by prepareWalletTransaction.
 */
export async function markCommissionApproved(
  recordId: string,
  metadata?: { approvedAmount?: number; approvedBy?: string },
): Promise<void> {
  const state = useAppStore.getState();
  const companyId = resolveCompanyId();

  const record = await getOne<CommissionRecord>(COLLECTIONS.COMMISSION_RECORDS, recordId);
  if (!record) throw new Error(`Commission record ${recordId} not found`);
  if (record.status !== 'pending') throw new Error('Commission record is not in pending status');

  const approvedAmount = metadata?.approvedAmount || record.amount || 0;
  const approvedBy = metadata?.approvedBy || state.user?.id || 'system';

  await updateDocById(COLLECTIONS.COMMISSION_RECORDS, recordId, {
    status: 'approved' as CommissionStatus,
    approvedBy,
    approvedAt: new Date().toISOString(),
    approvedAmount,
    updatedBy: state.user?.id || 'system',
  });

  await updateDocById(COLLECTIONS.LEADS, record.leadId, {
    commissionStatus: 'approved',
    commissionAmount: approvedAmount,
    updatedBy: state.user?.id || 'system',
  });

  await logActivity('Leads', 'Commission Approved', record.leadId, {
    recordId,
    amount: approvedAmount,
    approvedBy,
    entityName: record.leadId,
    actionLabel: `Commission of ₹${approvedAmount.toLocaleString('en-IN')} approved`,
  });

  // Notify partner
  const lead = await getOne(COLLECTIONS.LEADS, record.leadId) as any;
  if (lead?.userId) {
    void sendNotification(
      String(lead.userId),
      NotificationType.COMMISSION_APPROVED,
      'Commission approved',
      `Commission of ₹${approvedAmount.toLocaleString('en-IN')} has been approved for lead ${lead.name || record.leadId}.`,
      'commission',
      recordId,
      companyId,
    ).catch(() => {});
  }
}

/**
 * Marks a commission record as paid and updates the lead status.
 * Called after settlement has been processed.
 */
export async function markCommissionPaid(
  recordId: string,
  metadata?: { paidBy?: string; paymentReference?: string },
): Promise<void> {
  const state = useAppStore.getState();
  const companyId = resolveCompanyId();

  const record = await getOne<CommissionRecord>(COLLECTIONS.COMMISSION_RECORDS, recordId);
  if (!record) throw new Error(`Commission record ${recordId} not found`);
  if (record.status !== 'approved') throw new Error('Commission record is not in approved status');

  const paidBy = metadata?.paidBy || state.user?.id || 'system';

  await updateDocById(COLLECTIONS.COMMISSION_RECORDS, recordId, {
    status: 'paid' as CommissionStatus,
    paidBy,
    paidAt: new Date().toISOString(),
    paymentReference: metadata?.paymentReference || '',
    updatedBy: state.user?.id || 'system',
  });

  await updateDocById(COLLECTIONS.LEADS, record.leadId, {
    commissionStatus: 'paid',
    updatedBy: state.user?.id || 'system',
  });

  await logActivity('Leads', 'Commission Paid', record.leadId, {
    recordId,
    amount: record.approvedAmount || record.amount,
    paymentReference: metadata?.paymentReference,
    entityName: record.leadId,
    actionLabel: `Commission payment of ₹${(record.approvedAmount || record.amount || 0).toLocaleString('en-IN')} completed`,
  });

  // Notify partner
  const lead = await getOne(COLLECTIONS.LEADS, record.leadId) as any;
  if (lead?.userId) {
    void sendNotification(
      String(lead.userId),
      NotificationType.SETTLEMENT_COMPLETED,
      'Commission paid',
      `Commission of ₹${(record.approvedAmount || record.amount || 0).toLocaleString('en-IN')} has been paid for lead ${lead.name || record.leadId}.${metadata?.paymentReference ? ` Reference: ${metadata.paymentReference}` : ''}`,
      'commission',
      recordId,
      companyId,
    ).catch(() => {});
  }
}

/**
 * Prepares a wallet transaction for an approved commission.
 * Creates a commission_credit transaction in the partner's wallet.
 * Does NOT modify the commission record — that should be done first via markCommissionApproved.
 */
export async function prepareWalletTransaction(recordId: string): Promise<string | null> {
  const state = useAppStore.getState();
  const companyId = resolveCompanyId();

  const record = await getOne<CommissionRecord>(COLLECTIONS.COMMISSION_RECORDS, recordId);
  if (!record) {
    throw new Error(`Commission record ${recordId} not found`);
  }
  if (record.status !== 'approved' && record.status !== 'paid') {
    throw new Error(`Commission record is not approved or paid (status: ${record.status})`);
  }

  const amount = record.approvedAmount || record.amount || 0;
  if (amount <= 0) {
    throw new Error(`Commission amount must be positive (got ₹${amount})`);
  }

  // Get partner's current wallet balance
  const partner = await getOne<any>(COLLECTIONS.CHANNEL_PARTNERS, record.partnerId);
  const balanceBefore = partner?.walletBalance || 0;
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
    sourceType: 'commission' as const,
    sourceId: recordId,
    description: `Commission credit: ${record.ruleName || 'Commission'} for lead ${record.leadId}`,
    createdBy: state.user?.id || 'system',
  });

  // Update partner's wallet balance
  await updateDocById(COLLECTIONS.CHANNEL_PARTNERS, record.partnerId, {
    walletBalance: balanceAfter,
    totalCommissionEarned: (partner?.totalCommissionEarned || 0) + amount,
  });

  // Update commission record with wallet transaction reference
  await updateDocById(COLLECTIONS.COMMISSION_RECORDS, recordId, {
    walletTransactionId: txnId,
  });

  await logActivity('Leads', 'Wallet Credited', record.leadId, {
    recordId,
    transactionId: txnId,
    amount,
    balanceAfter,
    entityName: record.leadId,
    actionLabel: `Wallet credited with ₹${amount.toLocaleString('en-IN')} (Transaction: ${txnId})`,
  });

  return txnId;
}

export default {
  assignLeadToPartner,
  updateInstallationStatus,
  updateDocumentationStatus,
  updateCommissionStatus,
  updatePayoutStatus,
  partnerCreateLead,
  generateCommissionRecord,
  approveCommissionRecord,
  markCommissionEligible,
  markCommissionApproved,
  markCommissionPaid,
  prepareWalletTransaction,
};
