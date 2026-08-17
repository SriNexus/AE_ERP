export type CanonicalTenantIdentity = {
  companyId?: unknown;
  isOwner?: boolean;
  isSuperAdmin?: boolean;
};

/**
 * Ordinary users are always bound to the company on their canonical ERP profile.
 * Only the existing owner/super-admin identities may retain an intentional company selection.
 */
export function resolveSessionCompanyId(
  identity: CanonicalTenantIdentity | null | undefined,
  requestedCompanyId: string,
): string {
  const canonicalCompanyId = typeof identity?.companyId === 'string' ? identity.companyId.trim() : '';
  if (!canonicalCompanyId || identity?.isOwner || identity?.isSuperAdmin) return requestedCompanyId;
  return canonicalCompanyId;
}