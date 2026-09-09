/**
 * partnerEligibility (server) — RBAC Master Plan §15 BD-3, OWNER-APPROVED
 * 2026-09-09.
 *
 * The REST API is the second authorization plane (it uses the Admin SDK and
 * bypasses firestore.rules). This module mirrors the rules-layer
 * `partnerCreateEligible()` gate: a Channel-Partner caller may CREATE a new
 * `leads` / `customers` / `projects` / `scheme_registrations` record only
 * while their `channel_partners.status` is `'active'`.
 *
 *   - 'suspended' / 'inactive' / 'pending_approval' → 403 on create
 *   - missing status field                          → grandfathered to 'active'
 *   - KYC status                                     → advisory, never checked
 *   - non-Partner callers                            → unaffected
 *
 * READ / UPDATE / DELETE are NOT gated here — a suspended partner keeps access
 * to existing/in-flight work, and a terminated ('inactive') partner is cut off
 * by having their linked login deactivated (actorIsActive() in the SDK plane /
 * profile status check in api/_lib/auth.ts).
 */

import type { AuthenticatedUser } from './auth.js';

/** Collections a Partner may create through the generic REST facade that are
 *  subject to the BD-3 lifecycle gate. */
export const PARTNER_CREATE_GATED_COLLECTIONS = new Set<string>([
  'leads',
  'customers',
  'projects',
  'scheme_registrations',
]);

interface EligibilityDb {
  collection(name: string): {
    doc(id: string): {
      get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
    };
  };
}

export class PartnerNotEligibleError extends Error {
  statusCode = 403;
  code = 'PARTNER_NOT_ELIGIBLE';
  constructor(message: string) {
    super(message);
    this.name = 'PartnerNotEligibleError';
  }
}

const trimmed = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function isPartnerRole(role: unknown): boolean {
  // 'Partner' has no aliases in either permission table — an exact,
  // case-insensitive match is the whole set.
  return trimmed(role).toLowerCase() === 'partner';
}

/**
 * Throw `PartnerNotEligibleError` (→ 403) when a Partner caller may not create
 * a record in `collection`. No-op for non-Partner callers and non-gated
 * collections. Call AFTER `requirePermission(user, 'create', ...)`.
 */
export async function assertApiPartnerCanCreate(
  db: EligibilityDb,
  user: AuthenticatedUser,
  collection: string,
): Promise<void> {
  if (!PARTNER_CREATE_GATED_COLLECTIONS.has(collection)) return;
  if (!isPartnerRole(user.role)) return;

  const channelPartnerId = trimmed(user.channelPartnerId);
  if (!channelPartnerId) {
    // A Partner-role login with no resolvable channel_partners link cannot be
    // confirmed active — fail closed.
    throw new PartnerNotEligibleError(
      'This partner account is not linked to a channel partner profile and cannot create new records.',
    );
  }

  const snap = await db.collection('channel_partners').doc(channelPartnerId).get();
  const data = snap.exists ? snap.data() || {} : {};
  if (!snap.exists) {
    throw new PartnerNotEligibleError(
      'This partner account is not linked to a channel partner profile and cannot create new records.',
    );
  }
  if (data.isDeleted === true) {
    throw new PartnerNotEligibleError('This channel partner account is not available.');
  }

  const status = (trimmed(data.status) || 'active').toLowerCase();
  if (status === 'active') return;

  if (status === 'suspended') {
    throw new PartnerNotEligibleError(
      'This channel partner account is suspended. Existing work can still be updated, but new records cannot be created until the account is reactivated.',
    );
  }
  if (status === 'inactive') {
    throw new PartnerNotEligibleError('This channel partner account has been deactivated.');
  }
  if (status === 'pending_approval') {
    throw new PartnerNotEligibleError('This channel partner account is pending approval.');
  }
  throw new PartnerNotEligibleError(`This channel partner account is ${status} and cannot create new records.`);
}
