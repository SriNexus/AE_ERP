/**
 * Face Attendance product-integration follow-up (post-Phase-13) —
 * `useFaceEnrollmentStatus` hook.
 *
 * Determines whether the authenticated employee already has an ACTIVE
 * biometric face reference, using the existing server-authoritative
 * `GET /api/biometrics/status` boundary (new, thin, Admin-SDK-backed
 * projection of the existing `biometric_face_references` collection —
 * never a second enrollment-status store, never a client-side flag).
 *
 * Deliberately reuses the EXACT `['biometricFaceReference']` query key
 * `useFaceEnrollment.ts` already invalidates on a successful enrollment —
 * so a successful enrollment automatically refreshes whatever is reading
 * this hook, with zero additional wiring required on either side.
 *
 * Employee-View "Register Face" follow-up: accepts an optional `targetUserId`
 * so an Admin/HR viewer can check ANOTHER employee's status (Employee View
 * popup) — forwarded as `?targetUserId=` to the server, which authorizes it
 * via the SAME `resolveEnrollmentTarget()` boundary `enroll.ts` already uses
 * (self, or Admin/HR/SuperAdmin same-company). Omitted (the default), this
 * hook's behavior is byte-for-byte unchanged from before — self only, same
 * query key, same cache.
 */

import { useQuery } from '@tanstack/react-query';
import { auth } from '../../../lib/firebase';

export type BiometricEnrollmentStatus = 'none' | 'active' | 'revoked';

interface StatusApiResponseBody {
  success: boolean;
  data?: { status: BiometricEnrollmentStatus };
  error?: { code?: string; message?: string };
}

async function fetchEnrollmentStatus(targetUserId?: string): Promise<BiometricEnrollmentStatus> {
  const user = auth.currentUser;
  if (!user) return 'none';

  const idToken = await user.getIdToken();
  const url = targetUserId
    ? `/api/biometrics/status?targetUserId=${encodeURIComponent(targetUserId)}`
    : '/api/biometrics/status';
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${idToken}` },
  });

  let body: StatusApiResponseBody | null = null;
  try {
    body = await response.json();
  } catch {
    // Falls through to the throw below.
  }

  if (!response.ok || !body?.success || !body.data) {
    throw new Error(body?.error?.message || 'Could not determine face enrollment status.');
  }

  return body.data.status;
}

export function useFaceEnrollmentStatus(targetUserId?: string, options?: { enabled?: boolean }) {
  const query = useQuery({
    queryKey: targetUserId ? ['biometricFaceReference', targetUserId] : ['biometricFaceReference'],
    queryFn: () => fetchEnrollmentStatus(targetUserId),
    // `options.enabled` (default true) lets a caller that conditionally has
    // a target — e.g. Employees.tsx's "Face Registration" card, only
    // meaningful once an employee's detail popup is actually open — skip
    // the fetch entirely rather than either crashing the Rules of Hooks (by
    // calling this hook conditionally) or wastefully fetching the wrong
    // (self) status while there is no real target yet.
    enabled: (options?.enabled ?? true) && !!auth.currentUser,
    staleTime: 30_000,
  });

  return {
    /** `undefined` only while the very first fetch is still in flight or the
     * user isn't yet resolved — callers must treat `undefined` as "not yet
     * known", never assume it means "none" (that would show the wrong
     * first-open button label for a fraction of a second on every load). */
    status: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    /** The real reason the status check failed (server error text, e.g.
     * "API server unavailable: start `vercel dev`..." or "Authentication
     * required...") — `null` while not errored. Callers must show THIS,
     * never a hardcoded generic string, per the hard-won lesson that
     * collapsing every failure into "check your connection" hides genuine,
     * actionable server-side problems (missing local API server, missing
     * Admin SDK credentials, auth resolution failures) behind a misleading
     * network-sounding message. */
    errorMessage: query.error instanceof Error ? query.error.message : query.isError ? 'Could not determine face enrollment status.' : null,
    refetch: query.refetch,
  };
}
