/**
 * partnerEligibility — Channel Partner lifecycle → action authorization
 *
 * RBAC Master Plan §15 BD-3 — OWNER-APPROVED 2026-09-09.
 *
 * A Channel Partner may perform NEW business-creating actions (creating a new
 * Lead, Customer, Project, or Scheme Registration) only while their
 * `channel_partners.status` is `'active'`.
 *
 *   | Partner state        | Login | Existing / in-flight work | New Lead/Customer/Project/Scheme |
 *   |----------------------|-------|---------------------------|---------------------------------|
 *   | Verified + Active    | ALLOW | ALLOW                     | ALLOW                           |
 *   | KYC Pending          | ALLOW | ALLOW                     | ALLOW                           |
 *   | KYC Rejected         | ALLOW | ALLOW                     | ALLOW                           |
 *   | Suspended            | ALLOW | ALLOW                     | BLOCK                           |
 *   | Inactive / Terminated| BLOCK | BLOCK                     | BLOCK                           |
 *
 * Interpretation notes (from the owner decision):
 *   - KYC status is ADVISORY. It never blocks a business action. A partner
 *     with kycStatus `not_started` / `pending` / `submitted` / `rejected`
 *     works exactly like a `verified` one — only `channel_partners.status`
 *     gates actions.
 *   - `suspended` blocks NEW records only; the partner keeps portal access and
 *     may still view/edit legitimate existing/in-flight work where the
 *     ownership model already permits it. Commission already earned before
 *     suspension is preserved (nothing here removes or voids it).
 *   - `inactive` (terminated) is a full stop — enforced primarily by
 *     deactivating the linked login (`ChannelPartnerDomainService.transitionStatus`
 *     sets `users/{userId}.status = 'Inactive'`, so `firestore.rules`'
 *     `actorIsActive()` cuts every read/write and `onUserDeactivated` revokes
 *     tokens). The `'active'`-status create gate below also blocks it.
 *   - `pending_approval` is not yet operational — treated the same as any
 *     non-`active` status here.
 *
 * This module is the CLIENT defense-in-depth + a single source of the
 * user-facing message. The AUTHORITATIVE boundaries are `firestore.rules`
 * (`partnerCreateEligible()`) and the REST API (`api/_lib/partnerEligibility.ts`).
 */

export type PartnerLifecycleStatus =
  | 'active'
  | 'suspended'
  | 'inactive'
  | 'pending_approval'
  | (string & {});

interface PartnerLike {
  status?: PartnerLifecycleStatus | null;
  isDeleted?: boolean | null;
}

/**
 * True when this partner may create NEW Lead / Customer / Project / Scheme
 * records. A missing `status` is grandfathered to `'active'` (legacy docs
 * created before the status field existed; an explicit transition always
 * writes a concrete value).
 */
export function partnerCanCreateNewRecords(partner: PartnerLike | null | undefined): boolean {
  if (!partner || partner.isDeleted === true) return false;
  const status = (partner.status ?? 'active').toString().trim().toLowerCase();
  return status === 'active';
}

/**
 * A human-readable reason a partner cannot create new records, or `null` when
 * they can. Used to render a clear message instead of a bare rules rejection.
 */
export function partnerCreateBlockReason(
  partner: PartnerLike | null | undefined,
  actionLabel = 'creating new records',
): string | null {
  if (!partner || partner.isDeleted === true) {
    return 'This channel partner account is not available.';
  }
  const status = (partner.status ?? 'active').toString().trim().toLowerCase();
  if (status === 'active') return null;
  if (status === 'suspended') {
    return `This channel partner account is suspended. Existing work can still be viewed and updated, but ${actionLabel} is not permitted until the account is reactivated.`;
  }
  if (status === 'inactive') {
    return 'This channel partner account has been deactivated.';
  }
  if (status === 'pending_approval') {
    return 'This channel partner account is pending approval.';
  }
  return `This channel partner account is ${status} — ${actionLabel} is not permitted.`;
}

/**
 * Throws a clear `Error` when the partner may not create new records; a no-op
 * otherwise. Call before a partner-initiated create.
 */
export function assertPartnerCanCreate(
  partner: PartnerLike | null | undefined,
  actionLabel = 'creating new records',
): void {
  const reason = partnerCreateBlockReason(partner, actionLabel);
  if (reason) {
    const err = new Error(reason);
    (err as Error & { code?: string }).code = 'PARTNER_NOT_ELIGIBLE';
    throw err;
  }
}
