/**
 * useUserNameResolver — Centralized user identity resolution hook.
 *
 * Provides a `resolveUserName(id)` function that translates any internal
 * user ID (e.g. "DEMO-V1-USR-001") into the person's actual display name.
 *
 * If the input is already a human-readable name (not a known user ID),
 * it is returned unchanged. If the user cannot be resolved, a safe
 * fallback is returned.
 *
 * Uses the same ['users'] query key the entire app already shares
 * (React Query deduplicates — no extra Firestore reads).
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAll } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';

/** Resolve a single user ID to a display name. */
export type ResolveUserName = (id: string | undefined | null) => string;

const EMPTY = '—';

/**
 * Shared React hook. Wraps the company-scoped users query and returns
 * a memoized resolver function.
 *
 * Usage:
 * ```
 * const resolveUserName = useUserNameResolver();
 * <span>{resolveUserName(project.salesOwner)}</span>
 * ```
 */
export function useUserNameResolver(): ResolveUserName {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => getAll<{ id: string; name?: string; displayName?: string; email?: string }>(COLLECTIONS.USERS),
    staleTime: 300_000,
  });

  const usersMap = useMemo(() => {
    const map = new Map<string, { name?: string; displayName?: string; email?: string }>();
    for (const u of users) {
      map.set(u.id, u);
    }
    return map;
  }, [users]);

  const resolve = useMemo<ResolveUserName>(() => {
    return (id) => {
      if (!id || typeof id !== 'string') return EMPTY;
      const trimmed = id.trim();
      if (!trimmed) return EMPTY;
      // Look up by exact ID match
      const user = usersMap.get(trimmed);
      if (user) {
        return user.name || user.displayName || user.email || trimmed;
      }
      // If not found in the users map, the value might already be a name
      // (e.g. the editor stores names, not IDs). If it doesn't look like
      // a technical ID pattern, return it as-is.
      if (!looksLikeUserId(trimmed)) return trimmed;
      // It looks like an ID but we can't resolve it — return safe fallback
      return 'Unknown User';
    };
  }, [usersMap]);

  return resolve;
}

/**
 * Heuristic check: does the string look like an internal user ID
 * rather than a human-readable name?
 *
 * Patterns detected:
 * - Contains "USR-" (e.g. DEMO-V1-USR-001, USR-abc123)
 * - Starts with "usr_" (Firebase Auth UIDs)
 * - Is purely alphanumeric with no spaces and follows ID-like patterns
 */
function looksLikeUserId(s: string): boolean {
  if (s.includes('USR-') || s.startsWith('usr_')) return true;
  // Firebase Auth UIDs are typically 28+ chars of alphanumeric + _-
  if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return true;
  return false;
}
