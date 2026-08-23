/**
 * profileSelfHealCancelledFlagFix.test.ts — RBAC regression fix
 * (live-verified, 2026-08-23).
 *
 * ROOT CAUSE: useGlobalBoot.ts's profile self-heal effect (added to fix an
 * earlier "stale persisted groupId" bug) used the standard React
 * `cancelled` flag pattern to discard a stale async result from a
 * SUPERSEDED effect run. That pattern is wrong for this specific effect:
 * React 18/19 StrictMode's development-only mount -> cleanup -> remount
 * cycle runs SYNCHRONOUSLY, so `cancelled` was already `true` long before
 * the `await loadCurrentUserProfile(...)` Firestore read could ever
 * resolve. Live-verified against a real GroupAdmin account: the fetch
 * always returned the CORRECT, server-side-repaired profile (including
 * `groupId`), but `if (!cancelled) syncCurrentUserProfile(profile);` never
 * fired — `syncCurrentUserProfile` was silently never called, with no
 * error, no diagnostic, and no way to observe it from outside. The
 * persisted client identity stayed permanently stale for the lifetime of
 * the browser tab, no matter how many times the page was reloaded, blocking
 * the "Select a Company" flow (and everything downstream of it) even though
 * the underlying Firestore data was completely healthy.
 *
 * FIX: the `cancelled` flag and its cleanup function were removed.
 * `profileSyncRef` already provides the real protection this effect needs
 * (set synchronously before the async work starts, so StrictMode's
 * remount correctly bails out via the ref check before a second fetch ever
 * starts — there is only ever one in-flight attempt per user.id).
 * `syncCurrentUserProfile()` itself also re-checks the current store state
 * before applying anything, so no cancellation flag is needed here at all.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

const source = readFileSync(new URL('../useGlobalBoot.ts', import.meta.url), 'utf-8');

describe('the profile self-heal effect no longer discards its own fetch via a cancelled flag', () => {
  it('the effect body contains no `cancelled` variable, check, or cleanup function', () => {
    // Scope the check to this specific effect's block only (identified by
    // its own preceding doc comment anchor) — the file has other,
    // legitimate effects elsewhere that are not in scope here.
    const effectStart = source.indexOf('const profileSyncRef = useRef<string | null>(null);');
    expect(effectStart).toBeGreaterThan(-1);
    const effectBlock = source.slice(effectStart, effectStart + 1200);
    expect(effectBlock).not.toContain('cancelled');
    expect(effectBlock).not.toMatch(/return\s*\(\)\s*=>\s*\{/); // no cleanup function
  });

  it('syncCurrentUserProfile is still called unconditionally once the profile loads (no dead condition guarding it)', () => {
    const effectStart = source.indexOf('const profileSyncRef = useRef<string | null>(null);');
    const effectBlock = source.slice(effectStart, effectStart + 1200);
    expect(effectBlock).toContain('syncCurrentUserProfile(profile);');
    expect(effectBlock).not.toContain('if (!cancelled) syncCurrentUserProfile');
  });

  it('profileSyncRef itself is unmodified — it remains the actual protection against duplicate fetches', () => {
    expect(source).toContain('if (profileSyncRef.current === user.id) return;');
    expect(source).toContain('profileSyncRef.current = user.id;');
  });
});

describe('syncCurrentUserProfile (userProfile.ts) is unmodified — its own internal guard is what makes removing the cancelled flag safe', () => {
  it('still re-checks the current store state before applying anything', () => {
    const userProfileSource = readFileSync(new URL('../userProfile.ts', import.meta.url), 'utf-8');
    const fnStart = userProfileSource.indexOf('export function syncCurrentUserProfile');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBlock = userProfileSource.slice(fnStart, fnStart + 300);
    expect(fnBlock).toContain('if (!current || current.id !== profile.id) return;');
    expect(fnBlock).toContain('setUser(profileToAppUser(profile));');
  });
});
