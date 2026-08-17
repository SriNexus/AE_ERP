/**
 * channelPartnerWorkflow — Workflow Foundation for Channel Partner Operations
 *
 * This file provides the orchestration layer for partner-related business processes.
 * It integrates with existing ERP systems:
 *   - lib/workflow.ts   → logActivity (activity/audit logging)
 *   - lib/notifications.ts → sendNotification, notifyRoleUsers
 *   - lib/firestore.ts  → CRUD operations
 *   - services/ChannelPartnerDomainService.ts → domain logic
 *
 * Full workflow implementations (commission engine, wallet settlement, etc.)
 * will be implemented in later phases. This file provides the foundation:
 *   - Function signatures (typesafe contracts)
 *   - Shared utility functions
 *   - Activity logging wrappers
 *   - Notification helpers
 *   - Workflow state validation
 */

import { logActivity } from './workflow';
import { sendNotification, notifyRoleUsers } from './notifications';
import { useAppStore } from '../store/useAppStore';
import { NotificationType } from '../types';
import { ChannelPartnerDomainService } from '../services/ChannelPartnerDomainService';
import { db, firebaseConfig } from './firebase';
import { doc, getOne, getAll, writeBatch } from './firestore';
import { COLLECTIONS } from './firebase';
import { partnerManagerEligibilityError } from '../features/users/orgHierarchy';
import { createUserProjection } from '../features/users/hooks/useUsers';
import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import type { ChannelPartner } from '../features/channel-partner/types';
import type { AppUser } from '../types';

// ═══════════════════════════════════════════════════════════
//  PHASE 1 — IDENTITY & PROVISIONING
// ═══════════════════════════════════════════════════════════
// Canonical identity model (CP spec §9.1 / Vendor Lock boundary):
//
//   Authenticated User
//       ↓ userId
//   users/{userId}
//       ↓ channelPartnerId  (denormalized link, set by linkPartnerUser)
//   channel_partners/{partnerId}
//       ↓ managerId
//   users/{managerId}  (TL/Manager who supervises the partner)
//
// `channel_partners.userId` is the canonical partner↔user relationship
// (mandatory for the linked state); `users.channelPartnerId` is the
// denormalized mirror that lets `usePartnerSelf()` resolve the partner
// record from the authenticated identity WITHOUT trusting a partnerId
// supplied by the URL/UI.
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
//  SHARED UTILITIES
// ═══════════════════════════════════════════════════════════

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveCompanyId(): string {
  const state = useAppStore.getState();
  return (
    (state.activeCompanyId && state.activeCompanyId !== 'all'
      ? state.activeCompanyId
      : '') ||
    state.company?.id ||
    state.user?.companyId ||
    'default'
  );
}

function currentUserId(): string {
  return useAppStore.getState().user?.id || 'system';
}

function currentUserName(): string {
  return useAppStore.getState().user?.name || 'System';
}

// ═══════════════════════════════════════════════════════════
//  PARTNER VALIDATION HELPERS
// ═══════════════════════════════════════════════════════════

/**
 * Validates that a partner is in a valid state for operations.
 * Throws if the partner cannot perform actions.
 */
export async function validatePartnerCanAct(partnerId: string): Promise<ChannelPartner> {
  const partner = await ChannelPartnerDomainService.getById(partnerId);
  if (!partner) throw new Error(`Channel partner ${partnerId} not found`);
  if (partner.isDeleted) throw new Error('Channel partner account has been deleted');
  if (partner.status === 'suspended') throw new Error('Channel partner account is suspended');
  if (partner.status === 'inactive') throw new Error('Channel partner account is inactive');
  if (partner.status === 'pending_approval') throw new Error('Channel partner account is pending approval');
  if (partner.kycStatus !== 'verified') throw new Error('KYC verification is required');
  return partner;
}

/**
 * Validates that a partner can create a lead.
 * Separated from validatePartnerCanAct for future expansion
 * (e.g., daily lead limits, spam detection).
 */
export async function validatePartnerCanCreateLead(partnerId: string): Promise<ChannelPartner> {
  return validatePartnerCanAct(partnerId);
}

// ═══════════════════════════════════════════════════════════
//  PARTNER ACTIVITY LOGGING
// ═══════════════════════════════════════════════════════════

/**
 * Logs a channel partner activity event using the existing logActivity system.
 */
export async function logPartnerActivity(
  action: string,
  partnerId: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const partner = await ChannelPartnerDomainService.getById(partnerId);
  await logActivity('Channel Partners', action, partnerId, {
    ...metadata,
    entityName: partner?.firmName || partner?.contactPerson || partnerId,
    actionLabel: `${action} — ${partner?.firmName || partnerId}`,
  });
}

// ═══════════════════════════════════════════════════════════
//  PARTNER NOTIFICATION HELPERS
// ═══════════════════════════════════════════════════════════

/**
 * Sends a notification to a specific partner by their user ID.
 * Uses the existing sendNotification system.
 */
export async function notifyPartner(
  partnerId: string,
  type: NotificationType,
  title: string,
  body: string,
  entityType: string,
  entityId: string
): Promise<void> {
  const partner = await ChannelPartnerDomainService.getById(partnerId);
  const recipientUserId = partner?.userId;
  if (!recipientUserId) {
    console.warn(`Cannot notify partner ${partnerId}: no userId found`);
    return;
  }
  await sendNotification(recipientUserId, type, title, body, entityType, entityId, resolveCompanyId());
}

/**
 * Sends a notification to all admin/manager users.
 * Used when a partner action requires admin attention (e.g., KYC submitted).
 */
export async function notifyAdminsOfPartnerAction(
  type: NotificationType,
  title: string,
  body: string,
  entityType: string,
  entityId: string
): Promise<void> {
  await notifyRoleUsers(['Admin', 'Manager'], type, title, body, entityType, entityId, resolveCompanyId());
}

// ═══════════════════════════════════════════════════════════
//  PHASE 1 — IDENTITY SERVICES
// ═══════════════════════════════════════════════════════════

/**
 * Canonical partner↔user linking operation (Phase 1).
 *
 * Persists BOTH sides of the identity link atomically:
 *   channel_partners/{partnerId}.userId = userId
 *   users/{userId}.channelPartnerId      = partnerId
 *
 * Guards:
 *  - partner + user must exist in the SAME company (tenant boundary)
 *  - no ambiguous links: one user ↔ one partner, one partner ↔ one user
 *  - idempotent: re-linking the SAME pair is a no-op success
 *  - conflict-rejecting: never silently overwrites an existing different link
 *
 * Backend enforcement: Firestore rules gate `channel_partners` writes to
 * admin/management (Phase 1) and make `users.channelPartnerId` immutable once
 * established, so this client-side service is the controlled action path.
 */
export async function linkPartnerUser(partnerId: string, userId: string): Promise<void> {
  const partnerIdClean = stringValue(partnerId);
  const userIdClean = stringValue(userId);
  if (!partnerIdClean || !userIdClean) {
    throw new Error('Both partner ID and user ID are required to link.');
  }

  const partner = await ChannelPartnerDomainService.getById(partnerIdClean);
  if (!partner || partner.isDeleted) {
    throw new Error('Channel partner not found.');
  }
  const user = await getOne<AppUser>(COLLECTIONS.USERS, userIdClean);
  if (!user || user.isDeleted) {
    throw new Error('User not found.');
  }

  // Tenant boundary — never link across companies.
  if (partner.companyId !== user.companyId) {
    throw new Error('Cannot link a partner to a user in a different company.');
  }

  // Idempotent: the same pair is already linked → no-op success.
  if (partner.userId === userIdClean && user.channelPartnerId === partnerIdClean) {
    return;
  }

  // Conflict: partner already linked to a DIFFERENT user.
  if (partner.userId && partner.userId !== userIdClean) {
    throw new Error('This partner is already linked to a different user. Unlink it first.');
  }
  // Conflict: user already linked to a DIFFERENT partner.
  if (user.channelPartnerId && user.channelPartnerId !== partnerIdClean) {
    throw new Error('This user is already linked to a different partner.');
  }
  // Ambiguity guard: no OTHER partner may already claim this user.
  const allPartners = await ChannelPartnerDomainService.getAll(partner.companyId);
  const claimedByOther = allPartners.find((p) => p.id !== partnerIdClean && p.userId === userIdClean && !p.isDeleted);
  if (claimedByOther) {
    throw new Error(`This user is already linked to partner ${claimedByOther.firmName || claimedByOther.id}.`);
  }

  // Atomic dual write.
  const batch = writeBatch(db);
  batch.update(doc(db, COLLECTIONS.CHANNEL_PARTNERS, partnerIdClean), { userId: userIdClean });
  batch.update(doc(db, COLLECTIONS.USERS, userIdClean), { channelPartnerId: partnerIdClean });
  await batch.commit();

  await logPartnerActivity('partner-user-linked', partnerIdClean, { userId: userIdClean });
}

/**
 * Assigns (or clears) the partner's TL/Manager (`channel_partners.managerId`).
 *
 * Manager is validated with the EXISTING organization hierarchy
 * (features/users/orgHierarchy.ts) — the locked hierarchy is
 * Admin → Management → TL/Manager → Agent/Partner; a partner's manager must be
 * a manager-capable user in the SAME company. Passing an empty managerId
 * clears the assignment.
 */
export async function assignPartnerManager(partnerId: string, managerId: string): Promise<void> {
  const partnerIdClean = stringValue(partnerId);
  const managerIdClean = stringValue(managerId);
  if (!partnerIdClean) throw new Error('Partner ID is required.');

  const partner = await ChannelPartnerDomainService.getById(partnerIdClean);
  if (!partner || partner.isDeleted) {
    throw new Error('Channel partner not found.');
  }

  const delta: Record<string, unknown> = {};
  if (managerIdClean) {
    const manager = await getOne<AppUser>(COLLECTIONS.USERS, managerIdClean);
    if (!manager || manager.isDeleted) {
      throw new Error('Manager user not found.');
    }
    if (manager.companyId !== partner.companyId) {
      throw new Error('Cannot assign a manager from a different company.');
    }
    const eligibility = partnerManagerEligibilityError(manager, null);
    if (eligibility) throw new Error(eligibility);
    delta.managerId = managerIdClean;
    delta.managerName = stringValue(manager.displayName || manager.name);
  } else {
    // ChannelPartnerDomainService.update compacts null/undefined out of the
    // payload, so a clear is expressed as empty strings (stored as "").
    delta.managerId = '';
    delta.managerName = '';
  }

  await ChannelPartnerDomainService.update(partnerIdClean, delta);
  await logPartnerActivity('partner-manager-assigned', partnerIdClean, { managerId: managerIdClean });
}

/**
 * Provisioning foundation (Phase 1): creates the authenticated ERP user for a
 * partner (role 'Partner') using the EXISTING auth/provisioning architecture
 * (Users.tsx canonical path — Firebase Auth email/password via a secondary app
 * + createUserProjection), then optionally links it to the partner record.
 *
 * Does NOT create a parallel auth system: reuses Firebase Auth + the canonical
 * user-identity projection. The caller supplies the password for the account.
 *
 * @returns the created users/{userId} id
 */
export async function provisionPartnerUser(input: {
  name: string;
  email: string;
  phone?: string;
  password: string;
  companyId: string;
  partnerId?: string;
  managerId?: string;
}): Promise<string> {
  const email = stringValue(input.email).toLowerCase();
  const name = stringValue(input.name) || stringValue(input.email);
  if (!email) throw new Error('Email is required to provision a partner user.');
  if (!stringValue(input.password)) throw new Error('Password is required to provision a partner user.');
  if (!stringValue(input.companyId)) throw new Error('Company is required to provision a partner user.');

  // Mirror Users.tsx: create the Firebase Auth account with a secondary app,
  // then persist the canonical ERP user projection (role 'Partner').
  const secondaryApp = initializeApp(firebaseConfig, `PartnerProvision-${Date.now()}`);
  const secondaryAuth = getAuth(secondaryApp);
  let userId = '';
  try {
    const authResult = await createUserWithEmailAndPassword(secondaryAuth, email, input.password);
    userId = authResult.user.uid;
  } finally {
    await secondaryAuth.signOut().catch(() => undefined);
  }

  const state = useAppStore.getState();
  await createUserProjection(userId, {
    id: userId,
    name,
    displayName: name,
    email,
    phone: stringValue(input.phone),
    role: 'Partner',
    companyId: input.companyId,
    status: 'Active',
    createdBy: state.user?.id || 'system',
  });

  if (input.partnerId) {
    await linkPartnerUser(input.partnerId, userId);
    if (input.managerId) {
      await assignPartnerManager(input.partnerId, input.managerId);
    }
  }

  return userId;
}

// ═══════════════════════════════════════════════════════════
//  WORKFLOW FUNCTION SIGNATURES (Foundation)
// ═══════════════════════════════════════════════════════════
//
// These functions will be fully implemented in later phases:
//   - Phase 4 (Partner Portal) — lead creation, partner dashboard
//   - Phase 5 (Commission & Wallet) — commission calculation, wallet operations
//   - Phase 6 (Notifications & Activity) — notification routing
//
// The signatures below define the contract for future implementation.
// They throw a descriptive error until implemented.
// ═══════════════════════════════════════════════════════════

function notImplemented(name: string): never {
  throw new Error(`${name} will be implemented in a later phase`);
}

// ── Partner Registration & KYC ─────────────────────────────

export async function registerChannelPartner(data: Record<string, unknown>): Promise<string> {
  notImplemented('registerChannelPartner');
}

export async function submitKycDocuments(partnerId: string, documentIds: string[]): Promise<void> {
  notImplemented('submitKycDocuments');
}

export async function approveKyc(partnerId: string, approvedBy: string): Promise<void> {
  notImplemented('approveKyc');
}

export async function rejectKyc(partnerId: string, reason: string): Promise<void> {
  notImplemented('rejectKyc');
}

// ── Lead Management ────────────────────────────────────────

export async function createPartnerLead(
  partnerId: string,
  leadData: { name: string; phone: string; email?: string; city?: string; notes?: string }
): Promise<string> {
  notImplemented('createPartnerLead');
}

export async function checkDuplicateLead(phone: string): Promise<boolean> {
  notImplemented('checkDuplicateLead');
}

// ── Commission ─────────────────────────────────────────────

export async function generateCommission(leadId: string): Promise<{ amount: number; ruleId: string | null }> {
  notImplemented('generateCommission');
}

export async function approveCommission(commissionId: string, approvedBy: string): Promise<void> {
  notImplemented('approveCommission');
}

// ── Wallet ─────────────────────────────────────────────────

export async function creditPartnerWallet(partnerId: string, amount: number, sourceId: string): Promise<void> {
  notImplemented('creditPartnerWallet');
}

export async function requestWithdrawal(partnerId: string, amount: number): Promise<string> {
  notImplemented('requestWithdrawal');
}

export async function approveWithdrawal(withdrawalId: string, approvedBy: string): Promise<void> {
  notImplemented('approveWithdrawal');
}

export async function rejectWithdrawal(withdrawalId: string, reason: string): Promise<void> {
  notImplemented('rejectWithdrawal');
}
