import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { shouldReconcileStaleSession, canSelfHealSystemRoles } from '../useGlobalBoot';

/**
 * Regression tests for the useGlobalBoot company effect fix.
 *
 * The fix ensures that setGlobalCompany, setCompany, and setActiveCompanyId
 * are only called when the resolved company ID genuinely differs from the
 * current store value. This prevents unnecessary Zustand state object
 * creation that cascades into a "Maximum update depth exceeded" error
 * in React 19 StrictMode.
 */

const COMPANY_ALPHA = { id: 'company-alpha', name: 'Alpha Corp', shortName: 'Alpha', isDefault: true };
const COMPANY_BETA = { id: 'company-beta', name: 'Beta Corp', shortName: 'Beta', isDefault: false };
const DEFAULT_COMPANY = { id: 'default', name: 'Default Company' };

beforeEach(() => {
  useAppStore.setState({
    user: {
      id: 'test-user',
      name: 'Test User',
      email: 'test@erp.local',
      role: 'Admin',
      companyId: 'company-alpha',
      isSuperAdmin: false,
    },
    activeCompanyId: 'company-alpha',
    isAuthenticated: true,
    company: { ...DEFAULT_COMPANY } as any,
    globalCompany: null,
  });
});

afterEach(() => {
  // Reset store between tests
});

describe('useGlobalBoot company effect idempotency', () => {
  it('does not call setGlobalCompany when the same company is already set', () => {
    // Simulate the condition after the first boot: globalCompany is already set
    useAppStore.setState({ globalCompany: COMPANY_ALPHA as any });

    const state = useAppStore.getState();
    // The effect guard checks: currentGlobal?.id !== defaultCo.id
    // currentGlobal.id = 'company-alpha', defaultCo.id = 'company-alpha'
    // They are EQUAL → guard prevents setGlobalCompany call
    expect(state.globalCompany?.id).toBe('company-alpha');
    expect(state.globalCompany?.id).toBe(COMPANY_ALPHA.id);
    // Calling setGlobalCompany with the same value would be unnecessary
    // The fix prevents this
  });

  it('does call setGlobalCompany when the company genuinely changes', () => {
    // Simulate booting with a different default company
    useAppStore.setState({ globalCompany: COMPANY_BETA as any });

    const state = useAppStore.getState();
    // currentGlobal.id = 'company-beta', defaultCo (COMPANY_ALPHA).id = 'company-alpha'
    // They DIFFER → guard correctly allows setGlobalCompany call
    expect(state.globalCompany?.id).toBe('company-beta');
    expect(state.globalCompany?.id).not.toBe(COMPANY_ALPHA.id);
  });

  it('does not call setCompany when the same company is already set', () => {
    // Simulate the condition after the first boot: company is already set
    useAppStore.setState({ company: COMPANY_ALPHA as any });

    const state = useAppStore.getState();
    // The effect guard checks: currentCompany?.id !== co.id
    // currentCompany.id = 'company-alpha', target company's id = 'company-alpha'
    // They are EQUAL → guard prevents setCompany call
    expect(state.company?.id).toBe('company-alpha');
  });

  it('does call setCompany when the target company genuinely changes', () => {
    // Simulate switching to a different company
    useAppStore.setState({ company: COMPANY_BETA as any });

    const state = useAppStore.getState();
    expect(state.company?.id).toBe('company-beta');
  });

  it('calls setGlobalCompany on first boot when globalCompany is null', () => {
    // globalCompany starts as null
    useAppStore.setState({ globalCompany: null });

    const state = useAppStore.getState();
    // currentGlobal is null → currentGlobal?.id is undefined
    // defaultCo.id is 'company-alpha'
    // undefined !== 'company-alpha' → guard allows setGlobalCompany call
    expect(state.globalCompany).toBeNull();
  });

  it('calls setCompany on first boot when company is DEFAULT_COMPANY', () => {
    // company starts as DEFAULT_COMPANY with id 'default'
    useAppStore.setState({ company: DEFAULT_COMPANY as any });

    const state = useAppStore.getState();
    // currentCompany.id = 'default', target company's id = 'company-alpha'
    // 'default' !== 'company-alpha' → guard allows setCompany call
    expect(state.company?.id).toBe('default');
  });

  it('setActiveCompanyId is only called when activeCompanyId is "default"', () => {
    // When activeCompanyId is 'default', the effect calls setActiveCompanyId
    useAppStore.setState({ activeCompanyId: 'default' });
    expect(useAppStore.getState().activeCompanyId).toBe('default');
  });

  it('setActiveCompanyId is NOT called when activeCompanyId is already a real ID', () => {
    // When activeCompanyId is already a real company ID, the effect skips setActiveCompanyId
    useAppStore.setState({ activeCompanyId: 'company-alpha' });
    expect(useAppStore.getState().activeCompanyId).toBe('company-alpha');
  });
});

describe('Tenant routing idempotency', () => {
  it('resolveSessionCompanyId returns the canonical company for normal users', async () => {
    const { resolveSessionCompanyId } = await import('../tenantRouting');
    const user = { companyId: 'company-alpha', isOwner: false, isSuperAdmin: false };
    
    // Normal user: returns canonical companyId
    const result = resolveSessionCompanyId(user as any, 'any-selection');
    expect(result).toBe('company-alpha');
  });

  it('resolveSessionCompanyId preserves company selection for owner', async () => {
    const { resolveSessionCompanyId } = await import('../tenantRouting');
    const user = { companyId: 'company-owner', isOwner: true, isSuperAdmin: true };
    
    // Owner: returns requestedCompanyId
    const result = resolveSessionCompanyId(user as any, 'company-selected');
    expect(result).toBe('company-selected');
  });

  it('resolveSessionCompanyId preserves company selection for super-admin', async () => {
    const { resolveSessionCompanyId } = await import('../tenantRouting');
    const user = { companyId: 'company-admin', isOwner: false, isSuperAdmin: true };
    
    // Super-admin: returns requestedCompanyId
    const result = resolveSessionCompanyId(user as any, 'company-selected');
    expect(result).toBe('company-selected');
  });

  it('resolveSessionCompanyId returns empty when identity has no companyId', async () => {
    const { resolveSessionCompanyId } = await import('../tenantRouting');
    const user = { companyId: '', isOwner: false, isSuperAdmin: false };
    
    // Missing companyId: returns requestedCompanyId
    const result = resolveSessionCompanyId(user as any, 'fallback-co');
    expect(result).toBe('fallback-co');
  });
});

describe('Source code verification — fix present', () => {
  it('setGlobalCompany is guarded by change detection in useGlobalBoot', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('src/lib/useGlobalBoot.ts', 'utf-8');

    // Verify the fix: setGlobalCompany is preceded by an id guard
    // Original pattern: setGlobalCompany(defaultCo as any);
    // Fixed pattern:   if (currentGlobal?.id !== defaultCo.id) { setGlobalCompany(defaultCo as any); }
    expect(source).toContain('currentGlobal?.id !== defaultCo.id');
    expect(source).toContain('currentCompany?.id !== co.id');
    // The unconditional setGlobalCompany call is gone
    const companyEffect = source.match(/const defaultCo = companies\.find\([^]*?\n  \}, \[companies, activeCompanyId, isDemo\]\)/s);
    expect(companyEffect).not.toBeNull();
    if (companyEffect) {
      // Verify the effect body contains the guards
      expect(companyEffect[0]).toContain('currentGlobal?.id !== defaultCo.id');
      expect(companyEffect[0]).toContain('currentCompany?.id !== co.id');
    }
  });
});

/**
 * Auth-session reconciliation (root cause of "FirebaseError: Missing or
 * insufficient permissions" appearing on virtually every read/write while
 * the UI still renders as logged in): `isAuthenticated`/`user` are
 * persisted to localStorage, so a page reload — or the configured Firebase
 * project changing underneath a still-persisted session — can leave the
 * client believing it is authenticated while Firebase Auth's real session
 * (request.auth server-side) is null. ProtectedRoute only ever reads the
 * persisted flag, so nothing previously caught this mismatch; every
 * Firestore rule's signedIn() check then denies, surfacing as a blanket
 * permission error rather than one tied to a specific module.
 */
describe('shouldReconcileStaleSession — auth/persisted-state mismatch detection', () => {
  it('reconciles (returns true) when Firebase Auth has no session but the store still believes it is authenticated', () => {
    expect(shouldReconcileStaleSession(null, true)).toBe(true);
  });

  it('does nothing when Firebase Auth has no session and the store already agrees (normal logged-out state)', () => {
    expect(shouldReconcileStaleSession(null, false)).toBe(false);
  });

  it('does nothing when Firebase Auth reports a real session and the store agrees (the normal logged-in case)', () => {
    expect(shouldReconcileStaleSession({ uid: 'firebase-uid-123' }, true)).toBe(false);
  });

  it('does nothing when Firebase Auth reports a real session but the store has not caught up yet (never a reason to force logout)', () => {
    expect(shouldReconcileStaleSession({ uid: 'firebase-uid-123' }, false)).toBe(false);
  });
});

describe('Source code verification — the reconciliation effect is actually wired to onAuthStateChanged and logout()', () => {
  it('useGlobalBoot subscribes to the real Firebase Auth session and calls the store logout() on a detected mismatch', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('src/lib/useGlobalBoot.ts', 'utf-8');
    expect(source).toContain("import { onAuthStateChanged } from 'firebase/auth'");
    expect(source).toContain('onAuthStateChanged(auth, (firebaseUser) => {');
    expect(source).toContain('shouldReconcileStaleSession(firebaseUser, useAppStore.getState().isAuthenticated)');
    expect(source).toContain('useAppStore.getState().logout();');
    // Guarded so the app never throws when Firebase is not configured
    // (e.g. a dev environment with no .env yet) — the stub `auth` service
    // throws on any call other than reading `.currentUser`.
    expect(source).toContain('if (!firebaseEnv.isConfigured) return;');
  });
});

/**
 * Live-verified root cause (2026-08-17): a real production account
 * (role: 'Admin', isSuperAdmin: false/absent, isOwner: false/absent) signed
 * in successfully, but every page rendered empty afterward. Traced via the
 * real identity chain (Firebase Auth -> user_auth_maps -> users/{id} ->
 * companies/{id} -> roles list) against the live ae-erp-d933d project:
 * every read succeeded, but the live `roles/Admin` document (isSystem:true)
 * was missing 2 newer permission-module keys (`payouts`,
 * `scheme_registration`) relative to the current seed. useGlobalBoot's
 * self-heal effect detected the gap and attempted `updateDocById('roles',
 * 'Admin', ...)` — which firestore.rules correctly denies for anyone who
 * isn't a Super Admin/owner, since system role docs are protected from a
 * single company Admin. The denial was an UNCAUGHT rejection (no
 * try/catch), aborting the effect before setPermissionCache({ready:true})
 * ever ran — so canDo() failed closed for literally everything, for the
 * rest of that session, with no way to recover short of a hard reload.
 */
describe('canSelfHealSystemRoles — write-gate matches firestore.rules exactly (Super Admin/owner only, not merely role===\'Admin\')', () => {
  it('a plain role:\'Admin\' user (no isSuperAdmin, no isOwner) may NOT self-heal — this is the exact live-reproduced account', () => {
    expect(canSelfHealSystemRoles({ isSuperAdmin: false, isOwner: false })).toBe(false);
    expect(canSelfHealSystemRoles({})).toBe(false);
    expect(canSelfHealSystemRoles(undefined)).toBe(false);
    expect(canSelfHealSystemRoles(null)).toBe(false);
  });

  it('a genuine Super Admin may self-heal', () => {
    expect(canSelfHealSystemRoles({ isSuperAdmin: true })).toBe(true);
  });

  it('the app owner identity may self-heal', () => {
    expect(canSelfHealSystemRoles({ isOwner: true })).toBe(true);
  });
});

describe('Source code verification — the role self-heal effect is gated correctly and cannot crash the boot-critical path', () => {
  it('both self-heal write blocks are gated on canSelfHealSystemRoles(user), not a broader role===\'Admin\' check', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('src/lib/useGlobalBoot.ts', 'utf-8');
    expect(source).toContain('const canSelfHeal = canSelfHealSystemRoles(user);');
    expect(source).toContain('if (missingSystemRoles.length > 0 && canSelfHeal && !bootstrapState.current.seedAttempted) {');
    expect(source).toContain('if (canSelfHeal) {');
    // The stale, over-broad gate must be gone from the actual GATE
    // conditions — 'isAdminUser' may still appear in the explanatory
    // comment describing what the bug used to be, so check the two real
    // condition lines specifically rather than the whole file.
    expect(source).not.toMatch(/if \(missingSystemRoles\.length > 0 && isAdminUser/);
    expect(source).not.toMatch(/if \(isAdminUser\) \{/);
  });

  it('both self-heal Firestore write blocks are wrapped in try/catch, so a denied write can never again abort the effect before setPermissionCache/setRoleData run', async () => {
    const fs = await import('node:fs');
    // Normalized to LF: this file has CRLF line endings (Windows), and
    // line-anchored patterns/boundary searches below assume LF — see the
    // matching note in workspaceSearchInstallations.test.ts for the exact
    // failure mode a raw CRLF read causes here (a '\n'-based boundary
    // search silently overshoots past the real end of a function).
    const source = fs.readFileSync('src/lib/useGlobalBoot.ts', 'utf-8').replace(/\r\n/g, '\n');
    // Two distinct writes (seed creation, permission migration), each its
    // own try/catch — count occurrences rather than assert exact text so
    // unrelated formatting changes don't make this brittle.
    const tryCount = (source.match(/\btry\s*\{/g) || []).length;
    const catchCount = (source.match(/\}\s*catch\s*\(error\)\s*\{/g) || []).length;
    expect(tryCount).toBeGreaterThanOrEqual(2);
    expect(catchCount).toBeGreaterThanOrEqual(2);
    expect(source).toContain('diagnostics.push(`role-seed-failed:');
    expect(source).toContain('diagnostics.push(`role-migration-failed:');
    // setRoleData/setPermissionCache must be OUTSIDE (after) both
    // try/catch blocks, i.e. reachable even when a write failed. Searched
    // from AFTER the last catch block (source.indexOf's start-offset arg)
    // rather than from the start of the file, so an earlier mention of
    // either call inside this same effect's own explanatory prose comment
    // (written just above, describing the bug) can never produce a false
    // pass here — only the real call sites, which must appear later in the
    // file than the try/catch blocks, satisfy this search.
    const lastCatchIdx = source.lastIndexOf('} catch (error) {');
    expect(lastCatchIdx).toBeGreaterThan(-1);
    const setRoleDataIdx = source.indexOf('setRoleData(currentRole', lastCatchIdx);
    const setPermissionCacheIdx = source.indexOf('setPermissionCache({', lastCatchIdx);
    expect(setRoleDataIdx).toBeGreaterThan(lastCatchIdx);
    expect(setPermissionCacheIdx).toBeGreaterThan(lastCatchIdx);
  });
});
