/**
 * ChannelPartnerDomainService — Domain Service for Channel Partner Operations
 *
 * Follows the same pattern as LeadDomainService and CustomerDomainService.
 * Provides CRUD abstractions that work in both Demo Mode and Firebase Mode.
 *
 * Architecture:
 *   - Static methods for all domain operations
 *   - Uses centralized firestore.ts helpers (getOne, updateDocById, softDelete, createDocWithId)
 *   - Uses centralized COLLECTIONS constants
 *   - No direct Firebase SDK imports — all through lib/firestore.ts
 */

import { COLLECTIONS } from '../lib/firebase';
import {
  createDocWithId,
  genId,
  getOne,
  softDelete,
  updateDocById,
  getAll,
} from '../lib/firestore';
import type { ChannelPartner, PartnerWalletTransaction, CommissionRule } from '../features/channel-partner/types';

type UnknownRecord = Record<string, unknown>;

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function compactDelta(payload: UnknownRecord): UnknownRecord {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== null)
  );
}

export class ChannelPartnerDomainService {
  // ── Partner CRUD ──────────────────────────────────────────

  /**
   * Creates a new channel partner record.
   * Generates the ID automatically following the genId pattern.
   */
  static async create(data: Partial<ChannelPartner> & UnknownRecord): Promise<string> {
    const id = genId.generic('PRT');
    await createDocWithId(COLLECTIONS.CHANNEL_PARTNERS, id, compactDelta(data));
    return id;
  }

  /**
   * Creates a partner record with a specific ID (used for demo seed data).
   */
  static async createWithId(id: string, data: Partial<ChannelPartner> & UnknownRecord): Promise<string> {
    await createDocWithId(COLLECTIONS.CHANNEL_PARTNERS, id, compactDelta(data));
    return id;
  }

  /**
   * Retrieves a single channel partner by ID.
   */
  static async getById(partnerId: string): Promise<ChannelPartner | null> {
    return getOne<ChannelPartner>(COLLECTIONS.CHANNEL_PARTNERS, partnerId);
  }

  /**
   * Retrieves all channel partners for a given company.
   */
  static async getAll(companyId: string): Promise<ChannelPartner[]> {
    const all = await getAll<ChannelPartner>(COLLECTIONS.CHANNEL_PARTNERS);
    return all.filter((p) => p.companyId === companyId && !p.isDeleted);
  }

  /**
   * Updates a channel partner record.
   * Only includes defined fields (skips undefined/null).
   */
  static async update(partnerId: string, delta: Partial<ChannelPartner> & UnknownRecord): Promise<void> {
    return updateDocById(COLLECTIONS.CHANNEL_PARTNERS, partnerId, compactDelta(delta));
  }

  /**
   * Soft-deletes a channel partner.
   */
  static async delete(partnerId: string): Promise<void> {
    return softDelete(COLLECTIONS.CHANNEL_PARTNERS, partnerId);
  }

  /**
   * Updates KYC status and related fields atomically.
   */
  static async updateKYCStatus(
    partnerId: string,
    kycStatus: string,
    metadata: { verifiedBy?: string; rejectionReason?: string } = {}
  ): Promise<void> {
    const delta: UnknownRecord = {
      kycStatus,
      kycVerifiedAt: kycStatus === 'verified' ? new Date().toISOString() : undefined,
      kycVerifiedBy: metadata.verifiedBy,
      kycRejectionReason: metadata.rejectionReason || undefined,
      kycSubmittedAt: kycStatus === 'submitted' ? new Date().toISOString() : undefined,
    };
    return updateDocById(COLLECTIONS.CHANNEL_PARTNERS, partnerId, compactDelta(delta));
  }

  // ── Partner Status Transitions ────────────────────────────

  /**
   * Updates partner status and appends to status history.
   */
  static async transitionStatus(
    partnerId: string,
    newStatus: string,
    changedBy: string,
    reason?: string
  ): Promise<void> {
    const partner = await getOne<ChannelPartner>(COLLECTIONS.CHANNEL_PARTNERS, partnerId);
    const currentHistory = partner?.statusHistory ?? [];
    const entry = {
      status: newStatus,
      changedBy,
      changedAt: new Date().toISOString(),
      ...(reason ? { reason } : {}),
    };

    return updateDocById(COLLECTIONS.CHANNEL_PARTNERS, partnerId, {
      status: newStatus,
      statusHistory: [...currentHistory, entry],
    });
  }

  // ── Wallet Operations ─────────────────────────────────────

  /**
   * Records a wallet transaction and updates partner balance.
   *
   * ⚠️ ATOMICITY WARNING
   * This foundation method performs three sequential async operations:
   *   1. Create wallet transaction document
   *   2. Fetch partner to get current balance
   *   3. Update partner with new balance
   *
   * Under concurrent access, steps 2 and 3 can race — two simultaneous
   * transactions could read the same balance and produce incorrect results.
   * When wallet operations are fully implemented in Phase 5, this method
   * MUST use atomic operations to ensure consistency in both modes:
   *   - Firebase Mode: Firestore writeBatch or runTransaction
   *   - Demo Mode: Separate code path with manual consistency checks
   *
   * See lib/workflow.ts → stockIn() for the best dual-mode reference:
   * it demonstrates the complete pattern with `if (!firebaseEnv.isConfigured)`
   * for demo mode and `runTransaction` for Firebase mode.
   *
   * This is a foundation method — full wallet logic (commission engine,
   * settlement) will be implemented in later phases.
   */
  static async recordWalletTransaction(
    data: Partial<PartnerWalletTransaction> & UnknownRecord
  ): Promise<string> {
    const id = genId.generic('WLT');
    await createDocWithId(COLLECTIONS.PARTNER_WALLET_TXNS, id, compactDelta(data));

    // Update partner balance denormalized fields
    const amount = Number(data.amount) || 0;
    const partnerId = stringValue(data.partnerId);
    if (partnerId && amount !== 0) {
      const partner = await getOne<ChannelPartner>(COLLECTIONS.CHANNEL_PARTNERS, partnerId);
      if (partner) {
        const delta: UnknownRecord = {
          walletBalance: (partner.walletBalance || 0) + amount,
        };
        if (data.type === 'commission_credit') {
          delta.totalCommissionEarned = (partner.totalCommissionEarned || 0) + Math.abs(amount);
        }
        await updateDocById(COLLECTIONS.CHANNEL_PARTNERS, partnerId, delta);
      }
    }

    return id;
  }

  // ── Commission Rules ──────────────────────────────────────

  /**
   * Creates a new commission rule.
   */
  static async createCommissionRule(data: Partial<CommissionRule> & UnknownRecord): Promise<string> {
    const id = genId.generic('CRL');
    await createDocWithId(COLLECTIONS.COMMISSION_RULES, id, compactDelta(data));
    return id;
  }

  /**
   * Retrieves a commission rule by ID.
   */
  static async getCommissionRule(ruleId: string): Promise<CommissionRule | null> {
    return getOne<CommissionRule>(COLLECTIONS.COMMISSION_RULES, ruleId);
  }

  /**
   * Retrieves all active commission rules for a company.
   */
  static async getActiveCommissionRules(companyId: string): Promise<CommissionRule[]> {
    const all = await getAll<CommissionRule>(COLLECTIONS.COMMISSION_RULES);
    return all.filter(
      (r) => r.companyId === companyId && r.isActive && !r.isDeleted
    );
  }

  /**
   * Updates a commission rule.
   */
  static async updateCommissionRule(ruleId: string, delta: Partial<CommissionRule> & UnknownRecord): Promise<void> {
    return updateDocById(COLLECTIONS.COMMISSION_RULES, ruleId, compactDelta(delta));
  }

  /**
   * Soft-deletes a commission rule.
   */
  static async deleteCommissionRule(ruleId: string): Promise<void> {
    return softDelete(COLLECTIONS.COMMISSION_RULES, ruleId);
  }
}
