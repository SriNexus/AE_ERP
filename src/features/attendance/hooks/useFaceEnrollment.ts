/**
 * Face Attendance + DeepFace Master Plan, Phase 7 — `useFaceEnrollment` hook.
 *
 * The ONLY place a captured frame is ever sent anywhere — straight to the
 * existing, already-authorized `POST /api/biometrics/enroll` boundary
 * (Phases 4/6), over the same Firebase ID token / `Authorization: Bearer`
 * mechanism `api/_lib/auth.ts` already expects (§13's "same mechanism as
 * every other api/ call", confirmed via `auth.currentUser.getIdToken()`
 * being this codebase's own established pattern for it —
 * `src/lib/userProfile.ts`). No DeepFace call, no second enrollment
 * endpoint, no client-computed authorization decision — this hook only
 * submits and translates the server's already-final verdict.
 *
 * Self-enrollment only in this phase (no `targetUserId` is ever sent) —
 * matching the deliberate, recorded Phase 7 scope decision (see the master
 * document's Phase 7 completion record): an Admin/HR "enroll on behalf of"
 * employee-picker UI is a separate, larger surface not built here. The
 * backend (Phase 4/6) already fully supports on-behalf-of enrollment
 * server-side; only the picker UI is deferred.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { auth } from '../../../lib/firebase';
import { blobToBase64DataUrl, describeEnrollmentErrorCode } from '../services/faceCaptureSupport';

export class FaceEnrollmentError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'FaceEnrollmentError';
  }
}

export interface FaceEnrollmentResult {
  readonly enrolled: true;
  readonly userId: string;
  readonly reEnrolled: boolean;
  readonly duplicateFaceWarning?: { suspectedDuplicateOfUserIds: readonly string[] };
}

interface ApiResponseBody {
  success: boolean;
  data?: FaceEnrollmentResult;
  error?: { code?: string; message?: string };
}

async function submitEnrollment(blob: Blob): Promise<FaceEnrollmentResult> {
  const user = auth.currentUser;
  if (!user) {
    throw new FaceEnrollmentError('UNAUTHORIZED', 'Your session has expired. Please sign in again.');
  }

  // Converted to base64 ONLY here, immediately before the request — never
  // stored in React state at any point (see faceCaptureSupport.ts's and
  // useFaceCapture.ts's own doc comments on this).
  const image = await blobToBase64DataUrl(blob);
  const idToken = await user.getIdToken();

  let response: Response;
  try {
    response = await fetch('/api/biometrics/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ image }),
    });
  } catch {
    throw new FaceEnrollmentError('NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.');
  }

  let body: ApiResponseBody | null = null;
  try {
    body = await response.json();
  } catch {
    // Malformed/non-JSON response — fall through to the generic mapping below.
  }

  if (!response.ok || !body?.success || !body.data) {
    const code = body?.error?.code;
    throw new FaceEnrollmentError(code || 'UNKNOWN', describeEnrollmentErrorCode(code));
  }

  return body.data;
}

export function useFaceEnrollment() {
  const qc = useQueryClient();

  const mutation = useMutation<FaceEnrollmentResult, FaceEnrollmentError, Blob>({
    mutationFn: (blob: Blob) => submitEnrollment(blob),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['biometricFaceReference'] });
      // Master Plan §11/Phase 6's duplicate-face policy is advisory-only —
      // enrollment already succeeded regardless; the warning (if any) is
      // still shown to the user via the panel's own banner, not repeated
      // in the toast, matching this app's "small, auto-dismissing toast,
      // never a modal" convention (toastMessages.ts).
      toast.success(result.reEnrolled ? 'Face re-enrolled successfully.' : 'Face enrolled successfully.');
    },
    onError: (err) => {
      if (!(err instanceof FaceEnrollmentError)) {
        toast.error('Something went wrong. Please try again.');
      }
    },
  });

  const status: 'idle' | 'submitting' | 'success' | 'error' = mutation.isPending
    ? 'submitting'
    : mutation.isSuccess
      ? 'success'
      : mutation.isError
        ? 'error'
        : 'idle';

  const errorMessage = mutation.error instanceof FaceEnrollmentError
    ? mutation.error.message
    : mutation.isError
      ? 'Something went wrong. Please try again.'
      : null;

  return {
    status,
    result: mutation.data ?? null,
    errorMessage,
    errorCode: mutation.error instanceof FaceEnrollmentError ? mutation.error.code : null,
    isSubmitting: mutation.isPending,
    submit: (blob: Blob) => mutation.mutate(blob),
    reset: () => mutation.reset(),
  };
}
