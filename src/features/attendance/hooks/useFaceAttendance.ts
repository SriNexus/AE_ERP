/**
 * Face Attendance + DeepFace Master Plan, Phase 8 — `useFaceAttendance` hook.
 *
 * End-to-end biometric-verified check-in/check-out orchestration, entirely
 * client-side (mirroring `useCheckIn.ts`'s own established shape): a
 * captured frame → `POST /api/biometrics/verify` (Phases 4/5, authoritative
 * server-side match/liveness/quality decision, never trusted from the
 * client) → on a genuine pass, GPS is captured exactly as the GPS-only path
 * already does (§12: biometric SUPPLEMENTS GPS, never replaces it) → the
 * EXISTING `AttendanceService.checkIn()`/`checkOut()` (Phase 8 addition:
 * an optional `{verificationId}` claim, independently re-validated against
 * the caller's own server-stamped `biometric_face_references.lastVerifiedAt`
 * before the write is accepted — see that file's
 * `validateBiometricVerificationClaim()`).
 *
 * This hook never decides a biometric outcome itself — it only sequences
 * three already-authoritative steps and translates their results into UI
 * state. A failed verification step throws before GPS is ever requested and
 * before `AttendanceService` is ever called — no attendance write is
 * possible on that path, by construction (nothing downstream runs).
 */

import { useCallback, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { auth } from '../../../lib/firebase';
import { AttendanceService, AttendanceCheckError, type BiometricVerificationClaim } from '../../../services/AttendanceService';
import { captureLocationWithRetry, type GeoCaptureError, type CaptureProgressInfo } from '../../../lib/geo';
import { loadSettings } from '../../settings/services/settingsService';
import { normalizeAttendanceSettings } from '../../settings/attendanceRuntime';
import { describeCheckInToast, describeCheckOutToast } from '../toastMessages';
import { blobToBase64DataUrl, describeVerificationErrorCode } from '../services/faceCaptureSupport';
import type { AttendanceCheckResult } from '../types';

export type FaceAttendanceAction = 'checkIn' | 'checkOut';

export class FaceAttendanceError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'FaceAttendanceError';
  }
}

/** Fine-grained sub-status while the mutation is pending — mirrors
 * `useCheckIn.ts`'s own `progress` convention (a plain spinner would hide
 * which of the three steps is actually running). */
export type FaceAttendanceStep = 'verifying' | 'capturing-location' | 'submitting' | null;

interface VerifyApiResponseBody {
  success: boolean;
  data?: { verified: true; userId: string; verifiedAt: string };
  error?: { code?: string; message?: string };
}

function describeGeoCaptureErrorReason(reason: GeoCaptureError['reason']): string {
  switch (reason) {
    case 'permission_denied':
      return 'Location permission was denied. Enable location access for this site and try again.';
    case 'position_unavailable':
      return 'Your device could not determine its location right now. Try again in an open area.';
    case 'timeout':
      return 'Location capture timed out. Try again — this can take longer indoors or with a weak signal.';
    case 'unsupported':
      return 'GPS is not available on this device.';
    default:
      return 'Location capture failed. Please try again.';
  }
}

async function callVerifyApi(blob: Blob): Promise<{ verifiedAt: string }> {
  const user = auth.currentUser;
  if (!user) {
    throw new FaceAttendanceError('UNAUTHORIZED', 'Your session has expired. Please sign in again.');
  }

  const image = await blobToBase64DataUrl(blob);
  const idToken = await user.getIdToken();

  let response: Response;
  try {
    response = await fetch('/api/biometrics/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ image }),
    });
  } catch {
    throw new FaceAttendanceError('NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.');
  }

  let body: VerifyApiResponseBody | null = null;
  try {
    body = await response.json();
  } catch {
    // Falls through to the generic mapping below.
  }

  if (!response.ok || !body?.success || !body.data) {
    const code = body?.error?.code;
    throw new FaceAttendanceError(code || 'UNKNOWN', describeVerificationErrorCode(code));
  }

  return { verifiedAt: body.data.verifiedAt };
}

export function useFaceAttendance(action: FaceAttendanceAction) {
  const qc = useQueryClient();
  const [step, setStep] = useState<FaceAttendanceStep>(null);
  const [progress, setProgress] = useState<CaptureProgressInfo | null>(null);

  const mutation = useMutation<AttendanceCheckResult, Error, Blob>({
    mutationFn: async (blob: Blob) => {
      // ── Step 1: server-authoritative biometric verification ──────
      // A rejection here throws immediately — no GPS capture, no
      // AttendanceService call, no attendance write of any kind occurs.
      setStep('verifying');
      const { verifiedAt } = await callVerifyApi(blob);

      // ── Step 2: GPS — still fully captured and validated, exactly
      // like the GPS-only path (§12) ─────────────────────────────
      setStep('capturing-location');
      setProgress(null);
      const settings = normalizeAttendanceSettings(await loadSettings('attendance').catch(() => null));
      let location;
      try {
        location = await captureLocationWithRetry({
          enableHighAccuracy: true,
          targetAccuracyMeters: settings.gpsAccuracyThresholdMeters,
          onProgress: (info) => setProgress(info),
        });
      } catch (err) {
        if (err && typeof err === 'object' && 'reason' in err) {
          const geoErr = err as GeoCaptureError;
          throw new AttendanceCheckError(geoErr.reason, describeGeoCaptureErrorReason(geoErr.reason));
        }
        throw new AttendanceCheckError('unknown', 'An unexpected error occurred while capturing location.');
      }

      // ── Step 3: the EXISTING AttendanceService write path, with the
      // Phase 8 biometric claim — independently re-validated there,
      // never trusted as a bare parameter (see that file). ─────────
      setStep('submitting');
      const claim: BiometricVerificationClaim = { verificationId: verifiedAt };
      const result = action === 'checkIn'
        ? await AttendanceService.checkIn(location, claim)
        : await AttendanceService.checkOut(location, claim);
      return result;
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['attendance'] });
      if (action === 'checkIn') {
        toast.success(describeCheckInToast(result.record?.employee || '', result.record?.checkIn));
      } else {
        toast.success(describeCheckOutToast(result.record?.employee || '', result.record?.checkOut, result.record?.workingHours));
      }
      setStep(null);
      setProgress(null);
    },
    onError: (err) => {
      if (!(err instanceof FaceAttendanceError) && !(err instanceof AttendanceCheckError)) {
        toast.error('Something went wrong. Please try again.');
      }
      setStep(null);
      setProgress(null);
    },
  });

  const status: 'idle' | 'submitting' | 'success' | 'error' = mutation.isPending
    ? 'submitting'
    : mutation.isSuccess
      ? 'success'
      : mutation.isError
        ? 'error'
        : 'idle';

  const errorMessage = mutation.error instanceof FaceAttendanceError || mutation.error instanceof AttendanceCheckError
    ? mutation.error.message
    : mutation.isError
      ? 'Something went wrong. Please try again.'
      : null;

  // Live-scan hardening: the raw reason code, distinct from the human
  // message above — lets a caller (e.g. `useFaceAttendanceFlow`'s
  // continuous auto-verification loop) distinguish a RETRIABLE outcome
  // (no_face/poor_quality/verification_failed — keep scanning) from a
  // TERMINAL one (network/provider/rate-limit — pause and require an
  // explicit retry), and specifically recognize `duplicate_check_in`/
  // `duplicate_check_out` (AttendanceService's own existing, pre-Phase-8
  // duplicate-write guard) as a reconciliation signal — the attendance
  // state the user wanted already exists server-side, not a failure to
  // surface as a scary error. Mirrors `useFaceEnrollment.ts`'s own
  // existing `errorCode` field exactly (additive, same pattern).
  const errorCode = mutation.error instanceof FaceAttendanceError
    ? mutation.error.code
    : mutation.error instanceof AttendanceCheckError
      ? mutation.error.reason
      : null;

  const submit = useCallback((blob: Blob) => mutation.mutate(blob), [mutation]);
  const reset = useCallback(() => { mutation.reset(); setStep(null); setProgress(null); }, [mutation]);

  return {
    status,
    step: mutation.isPending ? step : null,
    progress: mutation.isPending ? progress : null,
    record: mutation.data?.record ?? null,
    errorMessage,
    errorCode,
    isSubmitting: mutation.isPending,
    submit,
    reset,
  };
}
