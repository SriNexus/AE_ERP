/**
 * partnerOwnership — Phase 3 (Channel Partner ownership propagation) data-layer
 * support.
 *
 * Resolves the authenticated user's Channel Partner DOCUMENT id (e.g. "PART-1")
 * so the ownership/visibility engines can match `partnerId`-keyed records
 * (leads/customers/projects) against the partner's own doc id — NOT the user
 * id (they are intentionally distinct per §9.1: partnerId = channel_partners
 * doc id; userId/createdBy = users doc id).
 *
 * Canonical source: the Phase 1 user-side denormalized link
 *   users/{uid}.channelPartnerId == channel_partners/{partnerId}
 * with a legacy fallback to the partner-side `userId` field for records linked
 * before the Phase 1 dual-write existed (channel_partners.userId == uid).
 *
 * The resolver is cached per user session (one users-doc read) so the
 * synchronous visibility filters (applyAccessFilters, listenCollection) can
 * read it without awaiting Firestore.
 */
import { collection, getDoc, getDocs, doc, query, where } from 'firebase/firestore';
import { db, COLLECTIONS, firebaseEnv } from './firebase';
import { useAppStore } from '../store/useAppStore';

let cachedPartnerDocId: string | null = null;
let cachedForUserId: string | null = null;

/** Synchronous read of the session-cached partner doc id (null if unknown). */
export function getCachedPartnerDocId(): string | null {
  const user = useAppStore.getState().user;
  if (!user) return null;
  return cachedForUserId === user.id ? cachedPartnerDocId : null;
}

/**
 * Resolves (and caches) the current user's channel_partners document id.
 * Returns null for non-partner users or unlinked accounts. Idempotent per user
 * session; the first call performs at most one users-doc get plus (only when
 * the canonical link is absent) one legacy channel_partners query.
 */
export async function resolveCurrentPartnerDocId(): Promise<string | null> {
  const state = useAppStore.getState();
  const user = state.user;
  if (!user?.id) return null;
  if (cachedForUserId === user.id) return cachedPartnerDocId;

  let partnerId: string | null = null;
  try {
    if (firebaseEnv.isConfigured) {
      // Canonical Phase 1 link: users/{uid}.channelPartnerId.
      const userSnap = await getDoc(doc(db, COLLECTIONS.USERS, user.id));
      const channelPartnerId = userSnap.exists() ? userSnap.data()?.channelPartnerId : null;
      if (typeof channelPartnerId === 'string' && channelPartnerId) {
        partnerId = channelPartnerId;
      } else {
        // Legacy fallback: channel_partners.userId == uid (pre-Phase-1 links).
        const snap = await getDocs(query(
          collection(db, COLLECTIONS.CHANNEL_PARTNERS),
          where('userId', '==', user.id),
        ));
        partnerId = snap.docs[0]?.id ?? null;
      }
    }
  } catch {
    // Fail soft in the data layer: a missing resolution only means
    // partnerId-keyed matching is inactive for this session; createdBy/
    // assignedToId matching still applies. The portal's usePartnerSelf hook is
    // the authoritative surface for partner identity.
    partnerId = null;
  }

  cachedPartnerDocId = partnerId;
  cachedForUserId = user.id;
  return partnerId;
}

/** Test/teardown helper: clear the per-user cache. */
export function resetPartnerDocIdCache(): void {
  cachedPartnerDocId = null;
  cachedForUserId = null;
}

/**
 * Canonical partner-lead ownership filter (Phase 4).
 *
 * The same predicate was previously copy-pasted inline across the partner
 * portal surfaces (PartnerLeads, PartnerMobileLeadsWorkspace, PartnerDashboard,
 * PartnerDocuments, PartnersWorkspace) and the internal Leads drill-down.
 * Centralizing it guarantees desktop/mobile and drill-down/list views all
 * apply the identical ownership contract: a lead belongs to a partner exactly
 * when `partnerId` matches the partner DOC id and the lead is not deleted.
 */
export function filterPartnerOwnedLeads<T extends object>(
  leads: T[] | null | undefined,
  partnerId: string | null | undefined,
): T[] {
  return filterPartnerOwnedRecords(leads, partnerId);
}

/**
 * Canonical partner-customer ownership filter (Phase 5).
 *
 * Same contract as `filterPartnerOwnedLeads`: a customer belongs to a partner
 * exactly when `partnerId` matches the partner DOC id and the record is not
 * deleted. Used by the Partner Portal Customers workspace (desktop + mobile).
 */
export function filterPartnerOwnedCustomers<T extends object>(
  customers: T[] | null | undefined,
  partnerId: string | null | undefined,
): T[] {
  return filterPartnerOwnedRecords(customers, partnerId);
}

/**
 * Canonical partner-project ownership filter (Phase 5).
 *
 * Same contract as `filterPartnerOwnedLeads`: a project belongs to a partner
 * exactly when `partnerId` matches the partner DOC id and the record is not
 * deleted. Used by the Partner Portal Projects workspace (desktop + mobile).
 */
export function filterPartnerOwnedProjects<T extends object>(
  projects: T[] | null | undefined,
  partnerId: string | null | undefined,
): T[] {
  return filterPartnerOwnedRecords(projects, partnerId);
}

/**
 * Canonical partner scheme-registration ownership filter (Phase 6).
 *
 * Same contract as the other partner-owned filters: a scheme registration
 * belongs to a partner exactly when `partnerId` matches the partner DOC id
 * and the record is not deleted. Used by the Partner Portal surfaces when
 * the Vendor Lock / Registration surfaces land in later phases.
 */
export function filterPartnerOwnedRegistrations<T extends object>(
  registrations: T[] | null | undefined,
  partnerId: string | null | undefined,
): T[] {
  return filterPartnerOwnedRecords(registrations, partnerId);
}

/**
 * Shared predicate backing every partner-owned record filter.
 * A record is partner-owned iff it is not deleted and its `partnerId` matches
 * the partner DOC id. `partnerId` matching is normalized (trimmed string) so
 * legacy records carrying whitespace still resolve.
 */
export function filterPartnerOwnedRecords<T extends object>(
  records: T[] | null | undefined,
  partnerId: string | null | undefined,
): T[] {
  if (!records) return [];
  const pid = String(partnerId ?? '').trim();
  if (!pid) return [];
  return records.filter((record) => {
    const r = record as { partnerId?: unknown; isDeleted?: unknown };
    return !r.isDeleted && String(r.partnerId ?? '').trim() === pid;
  });
}
