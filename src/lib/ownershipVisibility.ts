/**
 * ownershipVisibility — query-level self/team scoping for non-project
 * collections (Leads, Customers, Orders, Tasks, etc.).
 *
 * Mirrors projectVisibility.ts's buildProjectVisibilityQueryPlan() pattern
 * (Blueprint Phase 13: "extend buildProjectVisibilityQueryPlan()'s pattern
 * ... do not invent a second pattern") rather than inventing a new
 * architecture, but matches against the generic ownership fields every
 * non-project collection actually uses (`assignedToId` falling back to
 * `createdBy` — see firestore.ts's applyAccessFilters()) instead of the
 * project-specific assignment fields.
 *
 * This narrows the network fetch for 'self'/'team' visibility roles instead
 * of always pulling the full company dataset to the client and filtering in
 * memory (Audit §22, CONFIRMED HIGH data-exposure risk). applyAccessFilters()
 * still re-checks ownership in memory afterward as defense-in-depth — the
 * same two-layer pattern already used for company scoping (Audit §10) — so
 * this is a pure narrowing: it can only ever fetch a subset of what the old
 * client-side-only filter already reduced to, never a different result.
 */
import { where, type QueryConstraint } from 'firebase/firestore';
import type { Visibility } from './permissions';

// Phase 3 (§8.3 IMPLEMENTATION DECISION): `partnerId` is added so `self`
// matching also works for agent-owned records regardless of who converted
// them — e.g. a Customer converted from a partner Lead by a Sales employee
// carries createdBy = the employee's user id but partnerId = the partner doc
// id; the partner must still see it. partnerId is compared against the
// authenticated partner's DOC id (see partnerOwnership.ts), which is threaded
// through as the optional partnerDocId argument — never against user ids.
export const OWNERSHIP_FIELDS = ['assignedToId', 'createdBy', 'partnerId'] as const;

export type OwnershipVisibilityMode = 'all' | 'owned';

export type OwnershipVisibilityQueryPlan = {
  mode: OwnershipVisibilityMode;
  queries: QueryConstraint[][];
};

// Firestore's `in` operator accepts at most 30 comparison values per clause
// (current JS SDK limit) — a 'team' visibility query must chunk the
// [self, ...teamMemberIds] id set rather than assume it always fits in one
// query. Resolves the Blueprint Phase 13 [UNKNOWN] flag on this point.
const FIRESTORE_IN_CHUNK_SIZE = 30;

function chunk<T>(items: T[], size: number): T[][] {
  if (items.length <= size) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

export function buildOwnershipVisibilityQueryPlan(
  companyId: string | undefined,
  userId: string | null | undefined,
  visibility: Visibility,
  teamMemberIds: (string | null | undefined)[] = [],
  /** Phase 3: the authenticated partner's channel_partners DOC id — appended
   *  to the allowed-id set so the `partnerId` ownership field matches. */
  partnerDocId?: string | null,
): OwnershipVisibilityQueryPlan {
  const normalizedCompanyId = String(companyId ?? '').trim();
  const companyConstraint = normalizedCompanyId && normalizedCompanyId !== 'all'
    ? [where('companyId', '==', normalizedCompanyId)]
    : [];

  const resolvedUserId = String(userId ?? '').trim();
  if (visibility === 'all' || !resolvedUserId) {
    return { mode: 'all', queries: [companyConstraint] };
  }

  const partnerId = String(partnerDocId ?? '').trim();
  const ids = visibility === 'team'
    ? Array.from(new Set([resolvedUserId, ...teamMemberIds.map((id) => String(id ?? '').trim()).filter(Boolean), ...(partnerId ? [partnerId] : [])]))
    : Array.from(new Set([resolvedUserId, ...(partnerId ? [partnerId] : [])]));
  const idChunks = chunk(ids, FIRESTORE_IN_CHUNK_SIZE);

  return {
    mode: 'owned',
    queries: OWNERSHIP_FIELDS.flatMap((field) =>
      idChunks.map((idChunk) => [
        ...companyConstraint,
        idChunk.length === 1 ? where(field, '==', idChunk[0]) : where(field, 'in', idChunk),
      ])
    ),
  };
}
