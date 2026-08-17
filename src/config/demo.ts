export const OFFICIAL_DEMO_EMAIL = 'demo@neozy.in' as const;
export const DEMO_COMPANY_ID = 'company-demo-neozy' as const;
export const DEMO_ERP_USER_ID = 'MUSR-DEMO-0001' as const;
export const DEMO_ROLE_ID = 'Demo Operator' as const;
// Root cause of "the live Demo tenant still shows old data despite the
// corrected generator": isDemoSeeded() (src/lib/sandboxReset.ts) compares
// this exact value against a per-browser localStorage marker, and only
// calls triggerDemoReset() when they DIFFER. This value had never changed
// across every prior correction (Phase 15, 15.1, 16, 17) — meaning any
// browser that had EVER completed a demo reset before those fixes shipped
// had a marker that already matched, so Login.tsx's `if (!isDemoSeeded())`
// check was false and the corrected reset never ran again for that browser,
// no matter how many times the user logged out and back in. Bumping this
// value invalidates every existing marker unconditionally, forcing exactly
// one fresh reset (against the now-correct buildCompleteDemoPlan()) on each
// browser's next login. DEMO_ID_PREFIX is deliberately NOT bumped alongside
// this — every demo document id stays stable, so the reset remains a clean
// delete-then-reseed rather than leaving two id generations to reconcile.
export const DEMO_SEED_ID = 'DEMO_V3' as const;
export const DEMO_ID_PREFIX = 'DEMO-V1-' as const;
export const DEMO_HIDDEN_MODULES = ['users', 'roles', 'companies'] as const;

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
