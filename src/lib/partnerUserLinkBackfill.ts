/**
 * partnerUserLinkBackfill — Phase 1 data-migration logic for Channel Partner
 * identity links (pre-Phase-1 data only carried `channel_partners.userId`; the
 * canonical Phase 1 model ALSO writes the denormalized mirror
 * `users/{uid}.channelPartnerId` so `usePartnerSelf()` resolves the partner
 * without scanning the whole collection).
 *
 * Pure planning logic only — mirrors the existing `orderTypeBackfill.ts` /
 * `scripts/backfill-order-type.ts` pattern (compute a plan here, execute it
 * from a thin CLI script with real Firestore access). Never guesses: an
 * ambiguous match (same email/phone on multiple users or partners, or a
 * conflict where either side is already linked differently) is reported as
 * AMBIGUOUS/CONFLICT, never silently merged or overwritten.
 */

export const PARTNER_USER_LINK_BACKFILL_COLLECTIONS = {
  CHANNEL_PARTNERS: 'channel_partners',
  USERS: 'users',
} as const;

export type PartnerLinkBackfillPartnerRecord = {
  id: string;
  companyId?: string;
  userId?: string;
  email?: string;
  phone?: string;
  firmName?: string;
  contactPerson?: string;
  isDeleted?: boolean;
};

export type PartnerLinkBackfillUserRecord = {
  id: string;
  companyId?: string;
  channelPartnerId?: string;
  email?: string;
  phone?: string;
  name?: string;
  displayName?: string;
  role?: string;
  isDeleted?: boolean;
};

export type PartnerLinkBackfillInput = {
  partners: PartnerLinkBackfillPartnerRecord[];
  users: PartnerLinkBackfillUserRecord[];
};

export type PartnerLinkBackfillOptions = {
  /** Restrict the plan to a single company. Omit to scan every company. */
  companyId?: string;
};

export type PartnerLinkCandidate = {
  partnerId: string;
  userId: string;
  companyId: string;
  /** How the match was found (email or phone). */
  matchedBy: 'email' | 'phone';
  /** The partner's existing partner-side link, if any. */
  existingPartnerUserId?: string;
  /** The user's existing user-side link, if any. */
  existingUserPartnerId?: string;
  /** True when BOTH sides are already linked consistently (no write needed). */
  alreadyLinked: boolean;
};

export type PartnerLinkConflictReason =
  | 'partner_linked_to_other_user'
  | 'user_linked_to_other_partner'
  | 'cross_company'
  | 'ambiguous_partner_email'
  | 'ambiguous_partner_phone'
  | 'ambiguous_user_email'
  | 'ambiguous_user_phone';

export type PartnerLinkConflictRecord = {
  partnerId: string;
  userId: string;
  companyId: string;
  reason: PartnerLinkConflictReason;
};

export type PartnerLinkBackfillSummary = {
  partnersScanned: number;
  usersScanned: number;
  alreadyLinked: number;
  candidates: number;
  conflicts: number;
  byReason: Record<PartnerLinkConflictReason, number>;
};

export type PartnerLinkBackfillPlan = {
  /** Link pairs that can be written safely (both sides currently unlinked). */
  links: PartnerLinkCandidate[];
  /** Pairs that must be reviewed manually — never auto-written. */
  conflicts: PartnerLinkConflictRecord[];
  summary: PartnerLinkBackfillSummary;
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim().toLowerCase() : '');

/**
 * Deterministically builds the safe link plan. A candidate is only emitted
 * when:
 *   - the partner and user are in the SAME company (tenant boundary), and
 *   - neither side is already linked to a DIFFERENT record (conflict), and
 *   - the match key (email/phone) is unambiguous on both sides.
 * An existing consistent pair is reported as alreadyLinked (no write).
 * Everything else lands in `conflicts` for manual review — never guessed.
 */
export function buildPartnerUserLinkBackfillPlan(
  input: PartnerLinkBackfillInput,
  options: PartnerLinkBackfillOptions = {},
): PartnerLinkBackfillPlan {
  const companyFilter = String(options.companyId || '').trim();
  const activePartners = input.partners.filter(
    (p) => !p.isDeleted && (!companyFilter || p.companyId === companyFilter),
  );
  const activeUsers = input.users.filter((u) => !u.isDeleted);

  // Index users by email/phone for ambiguous-match detection.
  const byEmail = new Map<string, PartnerLinkBackfillUserRecord[]>();
  const byPhone = new Map<string, PartnerLinkBackfillUserRecord[]>();
  for (const user of activeUsers) {
    const email = text(user.email);
    const phone = text(user.phone);
    if (email) {
      const list = byEmail.get(email) ?? [];
      list.push(user);
      byEmail.set(email, list);
    }
    if (phone) {
      const list = byPhone.get(phone) ?? [];
      list.push(user);
      byPhone.set(phone, list);
    }
  }

  const byReason: PartnerLinkBackfillSummary['byReason'] = {
    partner_linked_to_other_user: 0,
    user_linked_to_other_partner: 0,
    cross_company: 0,
    ambiguous_partner_email: 0,
    ambiguous_partner_phone: 0,
    ambiguous_user_email: 0,
    ambiguous_user_phone: 0,
  };

  const links: PartnerLinkCandidate[] = [];
  const conflicts: PartnerLinkConflictRecord[] = [];

  function addConflict(partnerId: string, userId: string, companyId: string, reason: PartnerLinkConflictReason) {
    byReason[reason] += 1;
    conflicts.push({ partnerId, userId, companyId, reason });
  }

  for (const partner of activePartners) {
    // A partner may already carry a partner-side link (legacy shape) — that
    // is the anchor: find the user by id first.
    if (partner.userId) {
      const user = activeUsers.find((u) => u.id === partner.userId);
      if (!user) {
        addConflict(partner.id, partner.userId, partner.companyId || '', 'partner_linked_to_other_user');
        continue;
      }
      if (user.companyId && partner.companyId && user.companyId !== partner.companyId) {
        addConflict(partner.id, user.id, partner.companyId || '', 'cross_company');
        continue;
      }
      if (user.channelPartnerId && user.channelPartnerId !== partner.id) {
        addConflict(partner.id, user.id, user.companyId || '', 'user_linked_to_other_partner');
        continue;
      }
      const alreadyLinked = user.channelPartnerId === partner.id;
      links.push({
        partnerId: partner.id,
        userId: user.id,
        companyId: partner.companyId || user.companyId || '',
        matchedBy: 'email',
        existingPartnerUserId: partner.userId,
        existingUserPartnerId: user.channelPartnerId,
        alreadyLinked,
      });
      continue;
    }

    // No partner-side link: try email/phone match against active users.
    const candidates: { user: PartnerLinkBackfillUserRecord; matchedBy: 'email' | 'phone' }[] = [];
    const email = text(partner.email);
    const phone = text(partner.phone);

    if (email) {
      const matches = byEmail.get(email) ?? [];
      if (matches.length > 1) {
        addConflict(partner.id, email, partner.companyId || '', 'ambiguous_partner_email');
      } else if (matches.length === 1) {
        candidates.push({ user: matches[0], matchedBy: 'email' });
      }
    }
    if (phone && candidates.length === 0) {
      const matches = byPhone.get(phone) ?? [];
      if (matches.length > 1) {
        addConflict(partner.id, phone, partner.companyId || '', 'ambiguous_partner_phone');
      } else if (matches.length === 1) {
        candidates.push({ user: matches[0], matchedBy: 'phone' });
      }
    }

    if (candidates.length === 0) continue; // no match — nothing to plan

    const { user, matchedBy } = candidates[0];
    if (user.companyId && partner.companyId && user.companyId !== partner.companyId) {
      addConflict(partner.id, user.id, partner.companyId, 'cross_company');
      continue;
    }
    if (user.channelPartnerId && user.channelPartnerId !== partner.id) {
      addConflict(partner.id, user.id, user.companyId || '', 'user_linked_to_other_partner');
      continue;
    }
    const alreadyLinked = user.channelPartnerId === partner.id;
    links.push({
      partnerId: partner.id,
      userId: user.id,
      companyId: partner.companyId || user.companyId || '',
      matchedBy,
      existingUserPartnerId: user.channelPartnerId,
      alreadyLinked,
    });
  }

  return {
    links,
    conflicts,
    summary: {
      partnersScanned: activePartners.length,
      usersScanned: activeUsers.length,
      alreadyLinked: links.filter((l) => l.alreadyLinked).length,
      candidates: links.filter((l) => !l.alreadyLinked).length,
      conflicts: conflicts.length,
      byReason,
    },
  };
}

/** Human-readable plan report (used by the CLI script). */
export function formatPartnerUserLinkBackfillSummary(plan: PartnerLinkBackfillPlan): string {
  const lines: string[] = [];
  lines.push('─ Partner ↔ User link backfill plan ─');
  lines.push(`Partners scanned:  ${plan.summary.partnersScanned}`);
  lines.push(`Users scanned:     ${plan.summary.usersScanned}`);
  lines.push(`Already linked:    ${plan.summary.alreadyLinked}`);
  lines.push(`Safe candidates:   ${plan.summary.candidates}`);
  lines.push(`Conflicts:         ${plan.summary.conflicts}`);
  if (plan.summary.conflicts > 0) {
    lines.push('Conflicts by reason:');
    for (const [reason, count] of Object.entries(plan.summary.byReason)) {
      if (count > 0) lines.push(`  - ${reason}: ${count}`);
    }
  }
  if (plan.links.length > 0) {
    lines.push('Candidates (partner → user):');
    for (const link of plan.links) {
      lines.push(
        `  ${link.alreadyLinked ? '[ok]' : '[!!]'} ${link.partnerId} → ${link.userId} (${link.matchedBy}, ${link.companyId})`,
      );
    }
  }
  return lines.join('\n');
}
