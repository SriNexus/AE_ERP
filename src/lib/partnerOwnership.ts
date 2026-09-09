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

// The cache holds ONLY a SUCCESSFUL resolution (a non-null partner doc id).
// A null result — non-partner user, not-yet-linked partner, or a transient
// read error — is never cached, so a partner who is linked/approved DURING an
// open portal session (or after a transient Firestore hiccup) resolves on the
// next call without a page reload. `cachedForUserId` also guards against a
// stale value leaking across a logout→login as a different identity.
let cachedPartnerDocId: string | null = null;
let cachedForUserId: string | null = null;

/** Synchronous read of the session-cached partner doc id (null if unknown). */
export function getCachedPartnerDocId(): string | null {
  const user = useAppStore.getState().user;
  if (!user?.id) return null;
  return cachedForUserId === user.id ? cachedPartnerDocId : null;
}

/**
 * Resolves (and caches on success) the current user's channel_partners doc id.
 * Returns null for non-partner users or not-yet-linked accounts.
 *
 * The single canonical data-layer partner-identity resolver (the portal UI's
 * peer is usePartnerSelf, which resolves the SAME `users.channelPartnerId →
 * channel_partners/{id}` link). One users-doc get per session once resolved;
 * a null result is retried on the next call rather than being cached.
 */
export async function resolveCurrentPartnerDocId(): Promise<string | null> {
  const state = useAppStore.getState();
  const user = state.user;
  if (!user?.id) return null;

  // PERF: fast path — NO Firestore read. This resolver is awaited at the start
  // of EVERY getAll() call; the old code re-ran two round-trips (a users-doc
  // get + a channel_partners scan) on every list load for every NON-partner
  // user, because it only cached a *successful* resolution. Two facts remove
  // that tax:
  //   1. the canonical link (users.channelPartnerId) is now carried into the
  //      session at login (userProfile.profileToAppUser) — a linked partner
  //      resolves from memory;
  //   2. only a Partner-role identity is ever linked to a channel_partners
  //      doc — every other role short-circuits to null with zero reads.
  const sessionLink = typeof user.channelPartnerId === 'string' ? user.channelPartnerId.trim() : '';
  if (sessionLink) return sessionLink;
  if (String(user.role || '').trim().toLowerCase() !== 'partner') return null;

  if (cachedForUserId === user.id && cachedPartnerDocId) return cachedPartnerDocId;

  try {
    if (!firebaseEnv?.isConfigured) return null;
    // Canonical Phase 1 link: users/{uid}.channelPartnerId.
    const userSnap = await getDoc(doc(db, COLLECTIONS.USERS, user.id));
    const channelPartnerId = userSnap.exists() ? userSnap.data()?.channelPartnerId : null;
    let partnerId: string | null = typeof channelPartnerId === 'string' && channelPartnerId
      ? channelPartnerId
      : null;

    if (!partnerId) {
      // Legacy fallback: channel_partners.userId == uid (pre-Phase-1 links).
      const snap = await getDocs(query(
        collection(db, COLLECTIONS.CHANNEL_PARTNERS),
        where('userId', '==', user.id),
      ));
      partnerId = snap.docs.find((d) => (d.data() as { isDeleted?: unknown }).isDeleted !== true)?.id ?? null;
    }

    if (partnerId) {
      cachedPartnerDocId = partnerId;
      cachedForUserId = user.id;
    }
    return partnerId;
  } catch {
    // Fail soft in the data layer: a missing resolution only means
    // partnerId-keyed matching is inactive for THIS call; createdBy/
    // assignedToId matching still applies, and the next call retries.
    return null;
  }
}

/** Test/teardown helper: clear the per-user cache. */
export function resetPartnerDocIdCache(): void {
  cachedPartnerDocId = null;
  cachedForUserId = null;
}

/**
 * THE canonical human-readable name for a Channel Partner.
 *
 * Architectural correction: a Channel Partner is a HUMAN / AGENT, not a
 * company. `firmName` is OPTIONAL business metadata — an individual agent
 * legitimately has none. Every surface that shows a partner name, and every
 * flow that stamps `partnerName` onto an attributed record (leads, customers,
 * commissions, notifications), MUST use this resolver so a firm-less agent is
 * never rendered as "—" and lead/customer creation is never blocked for the
 * absence of a firm.
 *
 * Order: firm (if the partner IS a firm) → the human contact → the linked
 * login's display name → a neutral fallback (never an empty string).
 */
type PartnerNameSource = {
  firmName?: unknown;
  contactPerson?: unknown;
  name?: unknown;
  displayName?: unknown;
};

export function partnerDisplayName(
  partner: PartnerNameSource | null | undefined,
  fallback = 'Partner',
): string {
  if (!partner) return fallback;
  const pick = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  return (
    pick(partner.firmName)
    || pick(partner.contactPerson)
    || pick(partner.name)
    || pick(partner.displayName)
    || fallback
  );
}

/**
 * The login-account readiness of a Channel Partner, derived from the canonical
 * link (`channel_partners.userId` ←→ `users/{uid}.channelPartnerId`, set
 * atomically by linkPartnerUser).
 *
 *   'linked'                — a login identity exists; the person can sign in
 *                             and the portal (usePartnerSelf) resolves them.
 *   'pending_account_setup' — the partner RELATIONSHIP exists but no login is
 *                             linked yet. Approving here still transitions the
 *                             business status, but "active" does not yet mean
 *                             "can log in" — the reviewer must be told.
 *
 * Keeping this a DERIVED value (not a new stored status enum) means there is
 * one source of truth (the link) and no possibility of the two drifting.
 */
export function partnerAccountState(
  partner: { userId?: unknown } | null | undefined,
): 'linked' | 'pending_account_setup' {
  const uid = typeof partner?.userId === 'string' ? partner.userId.trim() : '';
  return uid ? 'linked' : 'pending_account_setup';
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
