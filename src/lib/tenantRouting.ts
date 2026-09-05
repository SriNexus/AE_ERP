export type CanonicalTenantIdentity = {
  companyId?: unknown;
  isOwner?: boolean;
  isSuperAdmin?: boolean;
  /** RBAC Master Plan Phase 8 — needed to recognize a GroupAdmin, whose
   *  valid tenant contexts are broader than a single company. */
  role?: unknown;
  /** The GroupAdmin's authoritative Group (Master Plan §3.2). A GroupAdmin
   *  WITHOUT a real groupId has no group scope to resolve and is treated
   *  exactly like an ordinary single-company user (fail closed). */
  groupId?: unknown;
};

const NON_COMPANY_SENTINELS = new Set(['', 'all', 'default', 'group']);

/**
 * RBAC Master Plan Phase 8 — GroupAdmin is a group-wide scope-extension of
 * Admin (§5.2/§10), NOT an ordinary single-company user. Its valid tenant
 * contexts are the `'group'` aggregate view sentinel OR any real company id
 * inside its own group (the home company or an in-group sibling). The
 * client query layer (companyScopedQuery / applyAccessFilters /
 * resolveWriteCompanyId) issues a groupId-scoped read for a GroupAdmin
 * regardless of which specific company is focused, and firestore.rules'
 * actorGroupId() is the real, independent boundary (§11 Bucket A) — a
 * selection outside the group simply resolves to empty screens, and the
 * CompanySwitcher only ever offers in-group companies.
 *
 * Before this branch existed, `resolveSessionCompanyId` had only the
 * owner/super-admin ("free selection") and everyone-else ("pinned to home
 * company") cases — so a GroupAdmin's "Group view" / sibling-company
 * selection in the CompanySwitcher was snapped straight back to their home
 * company by useGlobalBoot's tenant-routing effect on the very next render,
 * leaving all the group-context client infrastructure as dead code and
 * every client authorization plane home-company-only while the rules grant
 * group-wide access. This branch is the keystone that lets that selection
 * persist. It deliberately does NOT grant the platform-wide `'all'`
 * sentinel (owner/super-admin only) and does NOT bypass any rules-layer
 * group/company boundary.
 */
function isGroupAdmin(identity: CanonicalTenantIdentity | null | undefined): boolean {
  return typeof identity?.role === 'string' && identity.role.trim().toLowerCase() === 'groupadmin';
}

function hasRealGroupId(identity: CanonicalTenantIdentity | null | undefined): boolean {
  const groupId = typeof identity?.groupId === 'string' ? identity.groupId.trim() : '';
  return groupId.length > 0 && !NON_COMPANY_SENTINELS.has(groupId);
}

/**
 * Ordinary users are always bound to the company on their canonical ERP profile.
 * Only the existing owner/super-admin identities may retain an arbitrary
 * company selection; a GroupAdmin may retain the `'group'` view or its own
 * home company (see the doc comment above).
 */
export function resolveSessionCompanyId(
  identity: CanonicalTenantIdentity | null | undefined,
  requestedCompanyId: string,
): string {
  const canonicalCompanyId = typeof identity?.companyId === 'string' ? identity.companyId.trim() : '';
  if (!canonicalCompanyId || identity?.isOwner || identity?.isSuperAdmin) return requestedCompanyId;

  if (isGroupAdmin(identity) && hasRealGroupId(identity)) {
    // Neutral pre-boot placeholder: let the companies effect resolve it
    // (to the home company for a GroupAdmin) — exactly as it already does.
    if (!requestedCompanyId || requestedCompanyId === 'default') return requestedCompanyId;
    // The platform-wide sentinel is owner/super-admin only — a GroupAdmin's
    // equivalent is the 'group' view.
    if (requestedCompanyId === 'all') return 'group';
    // The 'group' aggregate view and ANY real company id (the home company
    // OR an in-group sibling) are all valid, fully query-supported contexts:
    // companyScopedQuery() now issues a groupId-scoped read for a GroupAdmin
    // regardless of which specific company is focused, and firestore.rules'
    // actorGroupId() is the real boundary (a selection outside the group
    // simply resolves to empty screens — the CompanySwitcher only ever
    // offers in-group companies). Never snapped back to home.
    return requestedCompanyId;
  }

  return canonicalCompanyId;
}
