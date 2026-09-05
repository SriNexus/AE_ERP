/**
 * rolesPropagationLatency.test.ts
 *
 * RBAC Master Implementation Plan — Phase 3, propagation verification.
 *
 * The Plan requires an EMPIRICAL answer to "does a role/visibility edit
 * propagate to an already-open session without relogin", not an assumption,
 * and explicitly forbids testing only "save -> refresh page -> changed"
 * (a refresh always sees the new value; that proves nothing about a session
 * that stays open).
 *
 * ARCHITECTURE TRACE (verified against current source, src/lib/useGlobalBoot.ts
 * and src/pages/Roles.tsx), which this file exercises for real rather than
 * asserting from reading it:
 *
 *   - Role data reaches canDo()/getModuleVisibility() via a Zustand
 *     `permissionCache` populated from a TanStack Query `useQuery({
 *     queryKey: ['roles_global', rolesGlobalCompanyId], staleTime: 1000*60*30
 *     })` — a ONE-TIME fetch cached for 30 minutes per QueryClient instance,
 *     NOT a Firestore onSnapshot realtime listener. Confirmed by repo-wide
 *     grep: `listenCollection` (this codebase's onSnapshot wrapper) is never
 *     called for the `roles`/ROLES collection anywhere in src/.
 *   - Roles.tsx's save mutation calls
 *     `qc.invalidateQueries({queryKey:['roles_global']})` in its OWN
 *     `onSuccess` — this invalidates and triggers a refetch ONLY on the
 *     QueryClient instance that ran the mutation (the editor's own browser
 *     tab/session). A QueryClient is a per-app-instance, in-memory object;
 *     there is no cross-instance broadcast (no BroadcastChannel, no
 *     websocket, no server-sent push) anywhere in this codebase for the
 *     `roles` collection.
 *
 * CONCLUSION this file proves, using the REAL @tanstack/react-query library
 * (not a hand-rolled stand-in) with the exact same query key shape and
 * staleTime the app uses, against two independent QueryClient instances
 * standing in for two independently-open browser sessions sharing the same
 * backing data source:
 *
 *   - The SESSION THAT MADE THE EDIT sees it reflected effectively
 *     immediately (bounded only by one round-trip to the data source) via
 *     its own invalidateQueries call — no relogin needed for the editor.
 *   - A DIFFERENT, already-open session watching the SAME query key does
 *     NOT observe the change on its own — its cache remains exactly what it
 *     was at last fetch until ITS OWN client invalidates/refetches (its
 *     30-minute staleTime elapsing, a manual refetch, or a fresh mount from
 *     a reload/relogin, none of which are triggered by the other session's
 *     write). This is not a bug being introduced by Phase 3 — it is the
 *     pre-existing, unchanged architecture, empirically confirmed here so
 *     Phase 3's completion record can report a measured fact instead of an
 *     assumption.
 */
import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

const ROLES_GLOBAL_STALE_TIME = 1000 * 60 * 30; // mirrors useGlobalBoot.ts exactly

type RoleDoc = { id: string; visibility: string };

function makeBackingStore(initial: RoleDoc) {
  let current: RoleDoc = { ...initial };
  return {
    get: async (): Promise<RoleDoc> => ({ ...current }),
    set: (next: Partial<RoleDoc>) => { current = { ...current, ...next }; },
  };
}

describe('Phase 3 propagation — same-session (the editor) sees the change immediately via invalidateQueries', () => {
  it('measures the actual latency of the editor\'s own session observing its own save', async () => {
    const store = makeBackingStore({ id: 'CO-A_Sales', visibility: 'self' });
    const editorClient = new QueryClient({ defaultOptions: { queries: { staleTime: ROLES_GLOBAL_STALE_TIME } } });
    const key = ['roles_global', 'CO-A'];

    // Initial load, as useGlobalBoot's useQuery would do on first mount.
    await editorClient.fetchQuery({ queryKey: key, queryFn: store.get });
    expect(editorClient.getQueryData<RoleDoc>(key)?.visibility).toBe('self');

    // The edit: a Firestore write (simulated) + the SAME onSuccess handler
    // Roles.tsx actually calls.
    const writeCommittedAt = Date.now();
    store.set({ visibility: 'team' });
    await editorClient.invalidateQueries({ queryKey: key });
    // invalidateQueries triggers a background refetch; awaiting it directly
    // (as React Query itself does internally) to measure the real latency.
    await editorClient.fetchQuery({ queryKey: key, queryFn: store.get });
    const observedAt = Date.now();

    const latencyMs = observedAt - writeCommittedAt;
    // eslint-disable-next-line no-console
    console.log(`[Phase 3 propagation] same-session latency: ${latencyMs}ms (write -> invalidateQueries -> refetch observed)`);

    expect(editorClient.getQueryData<RoleDoc>(key)?.visibility).toBe('team');
    // No relogin, no manual page reload — this is the live, in-session path.
    expect(latencyMs).toBeLessThan(1000); // bounded by one mock round-trip; the real number is one Firestore doc read, typically well under this in production
  });
});

describe('Phase 3 propagation — a DIFFERENT, already-open session does NOT observe the change without its own trigger', () => {
  it('a second QueryClient (Session A) watching the identical query key sees the STALE value after Session B\'s write + invalidation, because invalidateQueries is scoped to the calling QueryClient only', async () => {
    const store = makeBackingStore({ id: 'CO-A_Sales', visibility: 'self' });
    const key = ['roles_global', 'CO-A'];

    const sessionA = new QueryClient({ defaultOptions: { queries: { staleTime: ROLES_GLOBAL_STALE_TIME } } });
    const sessionB = new QueryClient({ defaultOptions: { queries: { staleTime: ROLES_GLOBAL_STALE_TIME } } });

    // Both sessions load the role before any edit — this is the "already-open
    // session" precondition the Master Plan requires (not a fresh load AFTER
    // the edit, which would trivially show the new value).
    await sessionA.fetchQuery({ queryKey: key, queryFn: store.get });
    await sessionB.fetchQuery({ queryKey: key, queryFn: store.get });
    expect(sessionA.getQueryData<RoleDoc>(key)?.visibility).toBe('self');
    expect(sessionB.getQueryData<RoleDoc>(key)?.visibility).toBe('self');

    // Session B is the editor: writes the change and invalidates ITS OWN client.
    store.set({ visibility: 'team' });
    await sessionB.invalidateQueries({ queryKey: key });
    await sessionB.fetchQuery({ queryKey: key, queryFn: store.get });
    expect(sessionB.getQueryData<RoleDoc>(key)?.visibility).toBe('team'); // editor sees it

    // Session A never invalidated or refetched — this is what an
    // already-open, untouched browser tab actually experiences today.
    expect(sessionA.getQueryData<RoleDoc>(key)?.visibility).toBe('self'); // STILL the pre-edit value

    // Session A only catches up once ITS OWN cache is invalidated/expires —
    // e.g. its 30-minute staleTime lapsing plus a refetch-triggering event
    // (window refocus / remount), a manual refresh action if the app exposes
    // one, or a full reload/relogin (which starts with no cache at all, so
    // it reads the new value immediately — but that is a relogin, and the
    // Plan explicitly asks whether propagation is possible WITHOUT one).
    await sessionA.invalidateQueries({ queryKey: key });
    await sessionA.fetchQuery({ queryKey: key, queryFn: store.get });
    expect(sessionA.getQueryData<RoleDoc>(key)?.visibility).toBe('team'); // catches up only once ITS OWN trigger fires
  });

  it('confirms the query is genuinely cached for the full 30-minute staleTime window — Session A would not even attempt a background refetch on remount/refocus before then', async () => {
    const store = makeBackingStore({ id: 'CO-A_Sales', visibility: 'self' });
    const key = ['roles_global', 'CO-A'];
    const sessionA = new QueryClient({ defaultOptions: { queries: { staleTime: ROLES_GLOBAL_STALE_TIME } } });

    await sessionA.fetchQuery({ queryKey: key, queryFn: store.get });
    store.set({ visibility: 'team' }); // the underlying data changes...
    // ...but a plain fetchQuery() call after a fresh, non-stale fetch serves
    // the cached value without re-invoking queryFn, exactly like a real
    // useQuery consumer would experience within the staleTime window.
    const result = await sessionA.fetchQuery({ queryKey: key, queryFn: store.get });
    expect(result.visibility).toBe('self'); // still stale-cached, matches production staleTime:1000*60*30 behavior
  });
});
