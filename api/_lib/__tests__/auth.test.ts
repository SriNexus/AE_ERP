/**
 * Real-device follow-up — root cause of a real "Could not confirm your face
 * registration status" report that turned out to have nothing to do with
 * the network: `api/_lib/auth.ts`'s `verifyIdToken` dependency called
 * `getAuth()` (from `firebase-admin/auth`) directly, with no prior call to
 * anything that runs `initializeApp()` (that only ever happens inside
 * `getAdminDb()`, in `api/_lib/firebase.ts`). On a fresh serverless
 * instance, `getAuth()` (no-arg) resolves the Admin SDK's default app via
 * `getApp()`, which throws "The default Firebase app does not exist" if no
 * app was ever initialized — silently swallowed by `verifyAuthToken()`'s
 * catch-all into a bare 401, for EVERY Bearer-token-authenticated route,
 * not just biometrics. This is the one test file in this repo that
 * exercises the REAL (non-injected) `createDefaultDependencies()` — every
 * other auth-related test in this codebase injects a fake `AuthDependencies`
 * object, which is exactly why this ordering bug escaped 3000+ passing
 * tests: none of them ever executed the real `verifyIdToken` closure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = vi.hoisted(() => [] as string[]);

vi.mock('../firebase', () => ({
  getAdminDb: vi.fn(() => {
    calls.push('getAdminDb');
    return {} as unknown;
  }),
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => {
    calls.push('getAuth');
    return {
      verifyIdToken: vi.fn(async () => ({ uid: 'test-uid', email: 'test@example.com' })),
    };
  }),
}));

describe('api/_lib/auth.ts — Admin SDK initialization ordering', () => {
  beforeEach(() => {
    calls.length = 0;
    vi.clearAllMocks();
    // `createDefaultDependencies()` runs once at module load and caches its
    // own `db` singleton (`let db = null; const getDb = () => db || (db =
    // getAdminDb())`) — each test gets a fresh module instance so it
    // observes the SAME cold-start ordering a real fresh serverless
    // instance would, rather than a warm instance where `getAdminDb()` was
    // already called and cached by an earlier test/request.
    vi.resetModules();
  });

  it('verifyIdToken calls getAdminDb() (which runs initializeApp()) BEFORE getAuth() — the actual root cause of a real "auth failed" report', async () => {
    const { defaultAuthDependencies } = await import('../auth');
    await defaultAuthDependencies.verifyIdToken('fake-token');
    expect(calls).toEqual(['getAdminDb', 'getAuth']);
    const firstAdminDbIndex = calls.indexOf('getAdminDb');
    const firstGetAuthIndex = calls.indexOf('getAuth');
    expect(firstAdminDbIndex).toBeGreaterThanOrEqual(0);
    expect(firstAdminDbIndex).toBeLessThan(firstGetAuthIndex);
  });

  it('the getDb() singleton means a SECOND call does not need to re-initialize — still never calls getAuth() before the app has been initialized at least once', async () => {
    const { defaultAuthDependencies } = await import('../auth');
    await defaultAuthDependencies.verifyIdToken('fake-token-1');
    await defaultAuthDependencies.verifyIdToken('fake-token-2');
    // getAdminDb (init) happened at least once, strictly before the first
    // getAuth call — subsequent calls may reuse the cached app, which is
    // correct production behavior, not a regression.
    expect(calls[0]).toBe('getAdminDb');
    expect(calls.filter((c) => c === 'getAuth').length).toBe(2);
  });

  it('verifyAuthToken logs a safe, non-sensitive diagnostic on failure (server-side only) instead of failing silently', async () => {
    const { verifyAuthToken } = await import('../auth');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // No Authorization header at all -> resolveAuthenticatedUser throws
    // AuthResolutionError('UNAUTHORIZED') before ever reaching verifyIdToken.
    const result = await verifyAuthToken(undefined, undefined);
    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const loggedMessage = consoleSpy.mock.calls[0].join(' ');
    expect(loggedMessage).toContain('[auth] verifyAuthToken failed');
    // Never logs token contents, headers, or credentials — only the error's
    // own name/message/code.
    expect(loggedMessage).not.toMatch(/Bearer\s/i);
    consoleSpy.mockRestore();
  });
});
