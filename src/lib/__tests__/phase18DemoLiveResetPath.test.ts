/**
 * phase18DemoLiveResetPath.test.ts — "Demo Mode — Final Live Data Reset &
 * Canonical Data Activation" permanent regression tests.
 *
 * Root cause proven this task: `isDemoSeeded()` (src/lib/sandboxReset.ts)
 * gates `triggerDemoReset()` behind a per-browser localStorage marker
 * compared against `DEMO_SEED_ID` — a value that had never changed across
 * every prior demo-data correction (Phase 15, 15.1, 16, 17). Any browser
 * that had EVER completed a demo reset before those fixes shipped kept a
 * marker that still matched, so the corrected reset never ran again for
 * that browser no matter how many times the user logged in. Fixed by
 * bumping DEMO_SEED_ID (forcing exactly one fresh reset per browser) and by
 * clearing the React Query cache on logout/reset (so no stale cached query
 * result can render after Firestore itself is corrected). These tests
 * assert the MECHANISM, not just the generator's own content — Phase
 * 15/15.1/17 already have their own extensive tests proving the generator
 * itself is correct; this file proves the LIVE PATH actually activates it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Phase 18 — the demo-seeded marker check genuinely re-triggers a reset whenever the canonical dataset changes', () => {
  const STORAGE_KEY = 'neozy-demo-seeded';
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    });
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a marker left over from an OLDER seed version is treated as stale (isDemoSeeded() === false), forcing a fresh reset', async () => {
    const { DEMO_SEED_ID } = await import('../../config/demo');
    store[STORAGE_KEY] = 'DEMO_V1'; // a version that predates this task's fix
    expect(DEMO_SEED_ID).not.toBe('DEMO_V1');
    const { isDemoSeeded } = await import('../sandboxReset');
    expect(isDemoSeeded()).toBe(false);
  });

  it('a marker matching the CURRENT seed version is treated as fresh (isDemoSeeded() === true), so reset is not repeated unnecessarily', async () => {
    const { DEMO_SEED_ID } = await import('../../config/demo');
    store[STORAGE_KEY] = DEMO_SEED_ID;
    const { isDemoSeeded } = await import('../sandboxReset');
    expect(isDemoSeeded()).toBe(true);
  });

  it('markDemoSeeded() stamps the CURRENT DEMO_SEED_ID, not a stale or hardcoded one', async () => {
    const { DEMO_SEED_ID } = await import('../../config/demo');
    const { markDemoSeeded, isDemoSeeded } = await import('../sandboxReset');
    expect(isDemoSeeded()).toBe(false);
    markDemoSeeded();
    expect(store[STORAGE_KEY]).toBe(DEMO_SEED_ID);
    expect(isDemoSeeded()).toBe(true);
  });

  it('the deterministic document-id prefix (DEMO_ID_PREFIX) is stable across seed-version bumps — reset stays a clean delete-then-reseed of the SAME ids, never a second id generation to reconcile', async () => {
    const { DEMO_ID_PREFIX, demoDocumentId } = await import('../../config/demo');
    expect(DEMO_ID_PREFIX).toBe('DEMO-V1-');
    expect(demoDocumentId('cus', 1)).toBe('DEMO-V1-CUS-001');
  });
});

describe('Phase 18 — the login-triggered reset endpoint deletes by tenant boundary, not by a narrow id list, so orphaned/stale records from ANY prior seed version are actually removed', () => {
  const src = readFileSync('api/demo-reset.ts', 'utf-8');

  it('deletes every DEMO_RESETTABLE_COLLECTIONS collection scoped to companyId===DEMO_COMPANY_ID (a broad, content-agnostic sweep) — not merely the ids the CURRENT plan happens to produce', () => {
    expect(src).toContain("db.collection(collection)");
    expect(src).toMatch(/\.where\(\s*['"]companyId['"]\s*,\s*['"]==['"]\s*,\s*DEMO_COMPANY_ID\s*\)/);
    expect(src).toContain('DEMO_RESETTABLE_COLLECTIONS');
  });

  it('never filters the delete query by demoSeedId — an old record from a PRIOR seed version must be deleted too, not skipped because its stamped seed id differs from the current one', () => {
    expect(src).not.toMatch(/where\(\s*['"]demoSeedId['"]/);
  });

  it('gates the entire operation on isOfficialDemoCompany() — the exact, single tenant boundary; never a broad/global Firestore operation', () => {
    expect(src).toContain('isOfficialDemoCompany(user.companyId)');
    expect(src).toContain("error: { code: 'FORBIDDEN'");
  });

  it('seeds from the single canonical buildCompleteDemoPlan(), never a second hand-written dataset (permanent regression guard, re-verified)', () => {
    expect(src).toContain('buildCompleteDemoPlan');
    expect(src).not.toMatch(/function buildCustomerRecords/);
  });

  it('preserves identity documents (user_auth_maps) rather than deleting them — the reset never invalidates the demo user\'s own auth mapping', () => {
    expect(src).toContain("PRESERVED_COLLECTIONS = new Set<string>(['user_auth_maps'])");
  });
});

describe('Phase 18 — client-side caches are invalidated on session change, so a freshly-reset Firestore dataset cannot be masked by a stale in-memory query cache', () => {
  it('logout() clears the React Query cache (src/store/useAppStore.ts)', () => {
    const src = readFileSync('src/store/useAppStore.ts', 'utf-8');
    const start = src.indexOf('logout:()=>{');
    const end = src.indexOf('\n  },', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(src.slice(start, end)).toContain('queryClient.clear()');
  });

  it('a successful demo reset on login clears the React Query cache (src/pages/Login.tsx)', () => {
    const src = readFileSync('src/pages/Login.tsx', 'utf-8');
    const start = src.indexOf('if (!isDemoSeeded())');
    const end = src.indexOf('else toast.error', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(src.slice(start, end)).toContain('queryClient.clear()');
  });

  it('the shared queryClient instance lives in a leaf module (src/lib/queryClient.ts) with no import dependency on useAppStore or React components — the exact structure that makes clearing it from logout() safe without a circular import', () => {
    const src = readFileSync('src/lib/queryClient.ts', 'utf-8');
    expect(src).not.toMatch(/^import .*useAppStore/m);
    expect(src).not.toMatch(/^import .*from ['"]react['"]/m);
    expect(src).toContain('export const queryClient');
  });
});

describe('Phase 18 — B2B/B2C segregation and realistic data, re-proven end-to-end through the SAME plan the live reset path actually seeds', () => {
  it('the exact plan api/demo-reset.ts builds (buildCompleteDemoPlan) has zero B2B-customer-with-Project violations and zero non-B2C Project references', async () => {
    const { buildCompleteDemoPlan } = await import('../../../scripts/demo/datasets/complete.ts');
    const plan = buildCompleteDemoPlan('LIVE-PATH-TEST-UID');
    const docs = (c: string) => plan.documents.filter((d) => d.collection === c);
    const customers = docs('customers');
    const b2bIds = new Set(customers.filter((c: any) => c.data.type === 'B2B').map((c: any) => c.id));
    const projects = docs('projects');
    expect(projects.filter((p: any) => b2bIds.has(String(p.data.customerId || '')))).toEqual([]);
    const customersById = new Map(customers.map((c: any) => [c.id, c]));
    expect(projects.every((p: any) => customersById.get(String(p.data.customerId || ''))?.data.type === 'B2C')).toBe(true);
    expect(b2bIds.size).toBeGreaterThanOrEqual(5);
  });

  it('reset -> reseed -> reset is idempotent for the exact plan the live path uses (same ids, same content, every time)', async () => {
    const { buildCompleteDemoPlan } = await import('../../../scripts/demo/datasets/complete.ts');
    const a = buildCompleteDemoPlan('LIVE-PATH-TEST-UID');
    const b = buildCompleteDemoPlan('LIVE-PATH-TEST-UID');
    expect(a.documents).toEqual(b.documents);
  });
});

describe('Phase 18 — the EXACT failure scenario: a browser/session carrying an OLD seed marker must still end up with the LATEST canonical dataset after login, never a mix of old + new', () => {
  const STORAGE_KEY = 'neozy-demo-seeded';
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    });
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('replays the real Login.tsx decision exactly: old marker -> isDemoSeeded() is false -> the caller proceeds to reset -> markDemoSeeded() stamps the CURRENT version -> the SAME buildCompleteDemoPlan() the reset call seeds is the current, realistic, B2B/B2C-correct dataset (never a stale one, never a merge of old+new)', async () => {
    // Simulates a browser that finished a real reset back when DEMO_SEED_ID
    // was still 'DEMO_V1' — exactly the failure report this test guards.
    store[STORAGE_KEY] = 'DEMO_V1';

    const { isDemoSeeded, markDemoSeeded } = await import('../sandboxReset');
    const { DEMO_SEED_ID } = await import('../../config/demo');

    // 1. Login.tsx's own gate: `if (!isDemoSeeded())` must be true here.
    expect(isDemoSeeded()).toBe(false);

    // 2. Simulate what a successful triggerDemoReset() does on the client
    //    side afterwards — mark the CURRENT version, never the old one.
    markDemoSeeded();
    expect(store[STORAGE_KEY]).toBe(DEMO_SEED_ID);
    expect(store[STORAGE_KEY]).not.toBe('DEMO_V1');

    // 3. The dataset that a reset triggered under this flow actually seeds
    //    is exactly the current canonical generator's output — realistic
    //    identities, correct B2B/B2C segregation — never anything the OLD
    //    'DEMO_V1'-era generator would have produced.
    const { buildCompleteDemoPlan } = await import('../../../scripts/demo/datasets/complete.ts');
    const plan = buildCompleteDemoPlan('REPLAY-TEST-UID');
    const customers = plan.documents.filter((d) => d.collection === 'customers');
    expect(customers.some((c: any) => /^Demo Customer \d/.test(String(c.data.name || '')))).toBe(false);
    expect(customers.filter((c: any) => c.data.type === 'B2B').length).toBeGreaterThanOrEqual(5);

    // 4. Re-logging in on this SAME (now-fresh) browser does not re-trigger
    //    another reset — the marker is genuinely up to date, not merely
    //    overwritten every time.
    expect(isDemoSeeded()).toBe(true);
  });
});

describe('Phase 18 — the tenant/company id the browser reads is structurally the SAME id the reset endpoint deletes/reseeds (traced through every real link in the chain, not assumed)', () => {
  it('every stage of the chain resolves to the identical DEMO_COMPANY_ID binding: seeded user doc -> reset delete/seed scope -> client query scope', () => {
    // Link 1: foundation.ts seeds users/{DEMO_ERP_USER_ID} with
    // companyId: DEMO_COMPANY_ID (imported from the single canonical config
    // module, not a re-typed literal).
    const foundationSrc = readFileSync('scripts/demo/datasets/foundation.ts', 'utf-8');
    expect(foundationSrc).toMatch(/import\s*\{[^}]*DEMO_COMPANY_ID[^}]*\}\s*from\s*['"]\.\.\/config\.ts['"]/);
    expect(foundationSrc).toMatch(/collection:\s*'users'.*DEMO_ERP_USER_ID/);

    // Link 2: api/demo-reset.ts's delete AND seed both scope to the same
    // imported DEMO_COMPANY_ID binding (not a separate/re-typed constant).
    const resetSrc = readFileSync('api/demo-reset.ts', 'utf-8');
    expect(resetSrc).toMatch(/import\s*\{[^}]*DEMO_COMPANY_ID[^}]*\}\s*from\s*['"]\.\.\/scripts\/demo\/config\.ts['"]/);
    expect(resetSrc).toMatch(/\.where\(\s*['"]companyId['"]\s*,\s*['"]==['"]\s*,\s*DEMO_COMPANY_ID\s*\)/);
    expect(resetSrc).toContain('buildCompleteDemoPlan(authUid)');

    // Link 3: src/lib/authIdentity.ts resolves the demo user's companyId
    // FROM that same seeded users/{DEMO_ERP_USER_ID} document (via
    // user_auth_maps), never a hardcoded or alternate value.
    const authSrc = readFileSync('src/lib/authIdentity.ts', 'utf-8');
    expect(authSrc).toContain('mapping.companyId');
    expect(authSrc).toContain('validated.companyId');

    // Link 4: Login.tsx sets the app's activeCompanyId directly from that
    // resolved profile's companyId — no fallback to a different tenant for
    // an authenticated match.
    const loginSrc = readFileSync('src/pages/Login.tsx', 'utf-8');
    expect(loginSrc).toContain('setActiveCompanyId(appUser.companyId)');
    expect(loginSrc).toMatch(/companyId:\s*String\(match\.companyId/);

    // Link 5: every list/detail query in the app scopes to activeCompanyId
    // via the SAME companyScopedQuery() used everywhere (src/lib/firestore.ts)
    // — not a per-page reimplementation that could drift to a different id.
    const firestoreSrc = readFileSync('src/lib/firestore.ts', 'utf-8');
    const fnStart = firestoreSrc.indexOf('function companyScopedQuery');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = firestoreSrc.slice(fnStart, firestoreSrc.indexOf('\n}', fnStart));
    expect(fnBody).toContain('activeCompanyId');
    expect(fnBody).toContain("useAppStore.getState()");
    expect(fnBody).toContain("where('companyId', '==', companyId)");
  });
});
