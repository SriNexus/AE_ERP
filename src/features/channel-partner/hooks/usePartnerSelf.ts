/**
 * usePartnerSelf — Resolve the CURRENT authenticated user's Channel Partner
 *
 * Phase 1 (Identity & Provisioning) deliverable — the canonical self-resolution
 * for the Partner Portal (fixes G4/R3 "portal cannot resolve partner record").
 *
 * The hook is USER-KEYED: given the authenticated `users/{uid}` identity it
 * resolves exactly ONE `channel_partners` record through the canonical link:
 *
 *   users/{currentUserId}.channelPartnerId → channel_partners/{partnerId}
 *
 * It NEVER trusts a partnerId supplied by the URL/UI. A legacy fallback scans
 * `channel_partners.userId === currentUserId` (the pre-Phase-1 data shape where
 * only the partner side carried the link) so existing records keep resolving
 * until backfilled.
 *
 * States (see PartnerSelfState): loading / linked / unlinked / not-found /
 * error. Desktop and mobile Partner pages share this single hook — no
 * mobile-specific identity logic.
 */

import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../../../store/useAppStore';
import { queryKeys } from '../../../lib/queryKeys';
import { getOne, getAll } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import type { ChannelPartner } from '../types';
import type { AppUser } from '../../../types';

/** Result of the self-resolution query. */
export type PartnerSelfResult = {
  partner: ChannelPartner | null;
  /** Why `partner` may be null. */
  state: 'linked' | 'unlinked' | 'not-found';
};

/** The resolution logic, exposed separately for unit tests. */
export async function resolvePartnerSelf(userId: string): Promise<PartnerSelfResult> {
  if (!userId) return { partner: null, state: 'unlinked' };

  // Canonical path (Phase 1): users.channelPartnerId → channel_partners/{id}.
  const userDoc = await getOne<AppUser>(COLLECTIONS.USERS, userId);
  const partnerId = userDoc?.channelPartnerId;
  if (partnerId) {
    const partner = await getOne<ChannelPartner>(COLLECTIONS.CHANNEL_PARTNERS, partnerId);
    if (partner && !partner.isDeleted) return { partner, state: 'linked' };
    return { partner: null, state: 'not-found' };
  }

  // Legacy fallback (pre-Phase-1 data): channel_partners.userId === currentUser.
  const all = await getAll<ChannelPartner>(COLLECTIONS.CHANNEL_PARTNERS);
  const legacy = all.find((p) => p.userId === userId && !p.isDeleted);
  return legacy ? { partner: legacy, state: 'linked' } : { partner: null, state: 'unlinked' };
}

/**
 * Resolve the currently authenticated user's own partner record.
 *
 * Keyed by the authenticated user id (never a URL-supplied partnerId), scoped
 * to the active company, disabled until identity is ready.
 */
export function usePartnerSelf() {
  const user = useAppStore((s) => s.user);
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useQuery({
    queryKey: [...keys.partnerSelf, user?.id],
    queryFn: () => resolvePartnerSelf(user?.id ?? ''),
    enabled: Boolean(user?.id) && Boolean(activeCompanyId) && activeCompanyId !== 'all',
    staleTime: 30_000,
  });
}
