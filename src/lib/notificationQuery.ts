import {
  and,
  limit,
  or,
  orderBy,
  query,
  where,
  type CollectionReference,
} from 'firebase/firestore';

export type NotificationQueryContext = {
  companyId: string;
  userId: string;
  isAdmin: boolean;
};

/**
 * Builds the live notification query with a single top-level tenant filter.
 *
 * Visibility is limited to the two EQUALITY branches — recipientUserId and
 * createdBy — deliberately WITHOUT the visibleTo array-contains branch:
 *
 * 1. Rules validation: Firestore's rules engine cannot validate an
 *    array-contains disjunct against the rule term `currentUserId() in
 *    data.visibleTo` (the left operand is a get()-derived value), so ANY query
 *    including that branch is rejected with PERMISSION_DENIED before it runs.
 *    Live-verified against the demo tenant: the full 3-branch OR returned 403
 *    while `recipientUserId ==` and `createdBy ==` each returned 200, and the
 *    reduced 2-branch OR returned 200 with the full result set.
 * 2. Redundancy: sendNotification() (src/lib/notifications.ts) always writes
 *    `visibleTo = [recipientUserId, createdBy]`, so `visibleTo contains U` can
 *    never match a document the two equality branches do not already match.
 *
 * The rule's visibleTo clause is retained for direct single-document reads
 * (useNotification → getDoc), where per-document rule evaluation is unaffected
 * — no security rule was weakened to make this query pass.
 */
export function buildNotificationQuery(ref: CollectionReference, context: NotificationQueryContext) {
  const companyFilter = where('companyId', '==', context.companyId);
  const sortAndLimit = [orderBy('createdAt', 'desc'), limit(100)] as const;

  if (context.isAdmin) {
    return query(ref, companyFilter, ...sortAndLimit);
  }

  return query(
    ref,
    and(
      companyFilter,
      or(
        where('recipientUserId', '==', context.userId),
        where('createdBy', '==', context.userId)
      )
    ),
    ...sortAndLimit
  );
}
