/**
 * RBAC Master Plan Phase 10 (N1 / AUTH-C1) — REST-API self/team ownership
 * visibility for `leads` and `customers`.
 *
 * Phase 7 gave `firestore.rules` a real ownership predicate for these two
 * collections (`canReadLeadScoped` / `canReadCustomerScoped`): a Partner
 * ('self' seed) sees only its own records, a Manager/TL ('team' seed) sees
 * its own + its direct reports'. Every other role stays company-wide
 * (BD-1/BD-2, both RESOLVED (a)). The generic REST list/get path enforced
 * only company/group scope, so a Partner or Manager calling `/api/leads` or
 * `/api/customers` directly retrieved every same-company record — the exact
 * exposure AUTH-C1 named, on the API plane.
 *
 * This module resolves the allowed ownership ids for the authenticated caller
 * and decides whether a single record is visible under that scope. It mirrors
 * the established client model verbatim — it does NOT invent a new policy:
 *   - candidate ownership fields: `assignedToId`, `createdBy`, `partnerId`
 *     (`src/lib/ownershipVisibility.ts` OWNERSHIP_FIELDS,
 *     `src/lib/firestore.ts` applyAccessFilters)
 *   - `assignedToId` / `createdBy` hold a USERS id; `partnerId` holds a
 *     `channel_partners` DOC id — they are different identity types and are
 *     never compared against each other
 *   - team membership is the SAME one-level `users.managerId == <manager>`
 *     relationship `useGlobalBoot` and `firestore.rules`' `isTeamMemberOf`
 *     use — resolved server-side from the trusted `users` collection, bounded
 *     to the manager's own company, excluding deleted users. No recursion.
 */

import type { AuthenticatedUser } from './auth';
import { resolveEffectiveVisibility } from './permissions';

/** Registered entities whose seed narrows some role below 'all' visibility. */
export const OWNERSHIP_SCOPED_COLLECTIONS = new Set<string>(['leads', 'customers']);

export type ApiOwnershipScope =
  | { mode: 'all' }
  | { mode: 'owned'; allowIds: Set<string> };

/** Minimal Admin-SDK surface this module needs — keeps it decoupled/testable. */
interface OwnershipDb {
  collection(name: string): {
    where(field: string, op: '==', value: unknown): {
      get(): Promise<{ docs: Array<{ id: string; data(): Record<string, unknown> | undefined }> }>;
    };
  };
}

const trimmed = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * Resolve the caller's ownership scope for a collection.
 *
 * `mode: 'all'` → no ownership filtering (Super Admin / Owner / Admin /
 * GroupAdmin / Sales / Director / any role seeded 'all' on the module, and
 * every collection outside OWNERSHIP_SCOPED_COLLECTIONS).
 *
 * `mode: 'owned'` → `allowIds` is the set of ids a record's `assignedToId` /
 * `createdBy` / `partnerId` may match: the caller's own ERP user id, their
 * non-empty `channelPartnerId` (partner-linked accounts only), and — for a
 * 'team' caller — the ids of their same-company, non-deleted direct reports.
 */
export async function resolveApiOwnershipScope(
  db: OwnershipDb,
  user: AuthenticatedUser,
  collection: string,
  module: string,
): Promise<ApiOwnershipScope> {
  if (!OWNERSHIP_SCOPED_COLLECTIONS.has(collection)) return { mode: 'all' };

  const visibility = await resolveEffectiveVisibility(user, module);
  if (visibility === 'all') return { mode: 'all' };

  const allowIds = new Set<string>();
  const erpUserId = trimmed(user.erpUserId);
  if (erpUserId) allowIds.add(erpUserId);

  const channelPartnerId = trimmed(user.channelPartnerId);
  if (channelPartnerId) allowIds.add(channelPartnerId);

  if (visibility === 'team' && erpUserId) {
    const companyId = trimmed(user.companyId);
    const reports = await db.collection('users').where('managerId', '==', erpUserId).get();
    for (const doc of reports.docs) {
      const data = doc.data() || {};
      if (trimmed(data.companyId) === companyId && data.isDeleted !== true) {
        allowIds.add(doc.id);
      }
    }
  }

  return { mode: 'owned', allowIds };
}

/**
 * Is this record visible to a caller whose scope is `mode: 'owned'`?
 * Mirrors `applyAccessFilters`'s candidate check: any of `assignedToId`,
 * `createdBy`, `partnerId` in the allowed-id set.
 */
export function apiRecordIsOwned(record: Record<string, unknown> | undefined, allowIds: Set<string>): boolean {
  if (!record) return false;
  const candidates = [record.assignedToId, record.createdBy, record.partnerId];
  return candidates.some((c) => {
    const s = trimmed(c);
    return s.length > 0 && allowIds.has(s);
  });
}
