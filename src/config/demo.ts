export const OFFICIAL_DEMO_EMAIL = 'demo@neozy.in' as const;
export const DEMO_COMPANY_ID = 'company-demo-neozy' as const;
export const DEMO_ERP_USER_ID = 'MUSR-DEMO-0001' as const;
export const DEMO_ROLE_ID = 'Demo Operator' as const;
// Phase 1 (Multi-Tenant): the demo tenant's own Group. The demo dataset is a
// fully self-contained tenant (company + users + business data), so it gets
// its own Group per Master Plan §10.3 step 1 (isDemo: true) rather than being
// folded into the production default Group.
export const DEMO_GROUP_ID = 'group-demo-neozy' as const;
// Seed-version marker for the manual/operator-triggered reset tooling
// (scripts/demo/*, api/demo-reset.ts, .github/workflows/demo-reset.yml —
// Demo-to-Group conversion removed the old per-browser auto-reset-on-login
// path entirely; reset is now an explicit maintenance action, same as any
// Group's data could be reset by an administrator on purpose). Bumping this
// value is how an operator forces a fresh reseed against a corrected
// generator. DEMO_ID_PREFIX is deliberately independent of this — every
// demo document id stays stable across a reseed, so it remains a clean
// delete-then-reseed rather than leaving two id generations to reconcile.
export const DEMO_SEED_ID = 'DEMO_V3' as const;
export const DEMO_ID_PREFIX = 'DEMO-V1-' as const;

export function isOfficialDemoCompany(companyId: unknown): boolean {
  return String(companyId || '').trim() === DEMO_COMPANY_ID;
}

export function isOfficialDemoEmail(email: unknown): boolean {
  return String(email || '').trim().toLowerCase() === OFFICIAL_DEMO_EMAIL;
}

export function demoDocumentId(kind: string, ordinal: number): string {
  const normalized = kind.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!normalized || !Number.isInteger(ordinal) || ordinal < 1) {
    throw new Error('Demo document ID requires a valid kind and positive ordinal.');
  }
  return `${DEMO_ID_PREFIX}${normalized}-${String(ordinal).padStart(3, '0')}`;
}
