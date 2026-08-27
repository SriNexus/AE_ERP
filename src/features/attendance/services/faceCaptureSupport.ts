/**
 * Face Attendance + DeepFace Master Plan, Phase 7 — pure, framework-free
 * support logic for the `FaceCapture` component and its `useFaceCapture`/
 * `useFaceEnrollment` hooks.
 *
 * Deliberately extracted into a plain-TypeScript module with zero React/DOM
 * rendering dependency — this repo has no `@testing-library/react` (or any
 * DOM test environment) installed, so every UI-tier component in this
 * codebase keeps its actual decision logic in a directly-unit-testable pure
 * module and reduces the component itself to source-text/structural
 * assertions (Master Plan §20 item 6, mirrored from the established
 * `attendanceRuleEngine.ts`/`geo.ts` convention: pure, deterministic,
 * side-effect-free, no Firebase/UI dependency).
 *
 * The browser never decides a biometric outcome here — every function below
 * is either (a) camera/UX plumbing (constraints, error classification,
 * capture-validity checks) or (b) translating an ALREADY-SERVER-DECIDED
 * error code into a safe, user-facing message. Nothing here inspects pixel
 * content, computes a face/liveness/match verdict, or fabricates a result
 * the server did not return.
 */

// ── Camera capability / constraints ─────────────────────────────────────

/**
 * Always requests the FRONT camera (Master Plan §16: "front camera, live
 * stream" / this session's own "no accidental rear-camera default"
 * requirement) — `facingMode: 'user'` as an ideal constraint, not `exact`,
 * so a desktop with a single (non-selfie-oriented) camera still gets a
 * usable stream rather than a hard failure, while every device WITH a
 * front/back distinction reliably gets the front one.
 */
export function buildFaceCaptureConstraints(): MediaStreamConstraints {
  return { video: { facingMode: 'user' }, audio: false };
}

/**
 * `getUserMedia` requires a secure context (HTTPS, or `localhost` for local
 * dev) — checked explicitly so an insecure deployment produces a clear,
 * specific message instead of a generic camera failure.
 */
export function isSecureContextAvailable(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext === true;
}

/** Whether this browser exposes the APIs `FaceCapture` needs at all. */
export function isGetUserMediaSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

// ── Error classification ─────────────────────────────────────────────────

export type FaceCaptureErrorReason =
  | 'unsupported'
  | 'insecure_context'
  | 'permission_denied'
  | 'camera_unavailable'
  | 'capture_failed'
  | 'network_error'
  | 'unknown';

/**
 * Maps a `getUserMedia()` rejection to one of this module's own reason
 * codes — DOMException names per the MediaDevices spec, including the
 * legacy names still seen on some older browsers/polyfills.
 */
export function mapGetUserMediaError(error: unknown): FaceCaptureErrorReason {
  const name = error && typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'permission_denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'NotReadableError':
    case 'TrackStartError':
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
    case 'AbortError':
      return 'camera_unavailable';
    default:
      return 'unknown';
  }
}

/** User-facing copy for each capture-flow error reason — never a raw
 * DOMException/exception message (which can vary by browser and leak
 * implementation detail), mirroring `useCheckIn.ts`'s own
 * `describeGeoCaptureErrorReason()` convention exactly. */
export function describeFaceCaptureErrorReason(reason: FaceCaptureErrorReason): string {
  switch (reason) {
    case 'unsupported':
      return 'Your browser does not support camera capture. Try a recent version of Chrome, Edge, or Safari.';
    case 'insecure_context':
      return 'Camera capture requires a secure (HTTPS) connection.';
    case 'permission_denied':
      return 'Camera permission was denied. Enable camera access for this site and try again.';
    case 'camera_unavailable':
      return 'No usable camera could be found or started on this device.';
    case 'capture_failed':
      return 'The photo could not be captured. Please try again.';
    case 'network_error':
      return 'Could not reach the server. Check your connection and try again.';
    default:
      return 'Camera capture failed. Please try again.';
  }
}

// ── Capture validity (UX pre-flight only — never a security decision) ───

/**
 * A cheap, local sanity check before spending a network round-trip — NOT a
 * quality/liveness/face decision (that stays exclusively server-side, per
 * this phase's own security boundary). Only guards against the capture
 * mechanism itself producing nothing (e.g. `canvas.toBlob()` returning
 * `null`, or an empty blob) — "avoid sending obviously empty/invalid
 * captures to the API when the frontend can safely detect that condition."
 */
export function isCapturedBlobUsable(blob: Blob | null | undefined): blob is Blob {
  return !!blob && blob.size > 0;
}

// ── Transient image encoding (no FileReader — see module doc comment) ───

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * Converts a captured frame to the base64 data-URL string the existing
 * `POST /api/biometrics/enroll` contract expects (`api/biometrics/enroll.ts`'s
 * `decodeBase64Image()` already strips an optional `data:...;base64,`
 * prefix, so sending the full data URL is correct and requires no extra
 * work on the server side). Deliberately called only once, immediately
 * before the network request — the caller must never persist this string.
 */
export async function blobToBase64DataUrl(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);
  const mimeType = blob.type || 'image/jpeg';
  return `data:${mimeType};base64,${base64}`;
}

// ── Enrollment API error-code → user-facing message ─────────────────────

/**
 * Maps `api/biometrics/enroll.ts`'s own response `error.code` (always
 * `reason.toUpperCase()` for a `BiometricPipelineError`, or one of the
 * route's own generic codes) to a safe, actionable, user-facing message.
 * Every branch here corresponds to a reason this phase's own backend
 * (Phases 4/5/6) can genuinely return — never a guess, and never the raw
 * `error.message` from the server response body (defense in depth: even
 * though the server itself already never leaks internals, the client
 * should not blindly trust/display an arbitrary server string either).
 */
export function describeEnrollmentErrorCode(code: string | undefined | null): string {
  switch (code) {
    case 'NO_FACE':
      return 'No face was detected in the photo. Make sure your face is clearly visible and try again.';
    case 'MULTIPLE_FACES':
      return 'More than one face was detected. Make sure only your face is in frame and try again.';
    case 'POOR_QUALITY':
      return 'The photo quality was not good enough. Try better lighting and hold still.';
    case 'LIVENESS_FAILED':
      return 'The liveness check failed. Make sure you are using a live camera, not a photo or screen.';
    case 'NOT_AUTHORIZED':
      return 'You are not authorized to enroll this face.';
    case 'CROSS_TENANT_DENIED':
      return 'This action is not allowed across companies or groups.';
    case 'ENROLLMENT_REVOKED':
      return 'This biometric enrollment has been revoked. Contact an administrator.';
    case 'PERSISTENCE_FAILED':
      return 'Your photo was validated, but saving it failed. Please try again.';
    case 'MALFORMED_IMAGE':
      return 'The captured photo could not be processed. Please try capturing again.';
    case 'PROVIDER_UNAVAILABLE':
      return 'The face recognition service is temporarily unavailable. Please try again shortly.';
    case 'TIMEOUT':
      return 'The request took too long. Please try again.';
    case 'UNAUTHORIZED':
      return 'Your session has expired. Please sign in again.';
    case 'RATE_LIMITED':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'METHOD_NOT_ALLOWED':
    case 'BAD_REQUEST':
      return 'Something went wrong with the request. Please try again.';
    case 'INTERNAL_ERROR':
      return 'Something went wrong on our end. Please try again.';
    default:
      return 'Enrollment failed. Please try again.';
  }
}

// ── Verification API error-code → user-facing message (Phase 8) ─────────

/**
 * Same shape and same safety discipline as `describeEnrollmentErrorCode()`
 * above, for `POST /api/biometrics/verify`'s own reachable reason set
 * (`api/biometrics/verify.ts`'s `REASON_STATUS` map) — kept as its own
 * function rather than merged with the enrollment mapper: the two
 * endpoints share most reason codes but not all (`AMBIGUOUS_MATCH`/
 * `VERIFICATION_FAILED`/`NO_ENROLLMENT` are verify-only; small, deliberate
 * duplication here is preferable to a shared abstraction that would need
 * per-endpoint branches anyway.
 */
export function describeVerificationErrorCode(code: string | undefined | null): string {
  switch (code) {
    case 'NO_FACE':
      return 'No face was detected. Make sure your face is clearly visible and try again.';
    case 'MULTIPLE_FACES':
      return 'More than one face was detected. Make sure only your face is in frame and try again.';
    case 'POOR_QUALITY':
      return 'The photo quality was not good enough. Try better lighting and hold still.';
    case 'LIVENESS_FAILED':
      return 'The liveness check failed. Make sure you are using a live camera, not a photo or screen.';
    case 'AMBIGUOUS_MATCH':
      return 'Your face match was inconclusive. Please try again with better lighting.';
    case 'VERIFICATION_FAILED':
      return 'Your face did not match your enrolled profile. Please try again, or contact HR if this keeps happening.';
    case 'NOT_AUTHORIZED':
      return 'You are not authorized to verify.';
    case 'CROSS_TENANT_DENIED':
      return 'This action is not allowed across companies or groups.';
    case 'NO_ENROLLMENT':
      return 'You have not enrolled your face yet. Please enroll first.';
    case 'ENROLLMENT_REVOKED':
      return 'Your biometric enrollment has been revoked. Contact an administrator.';
    case 'PERSISTENCE_FAILED':
      return 'Verification succeeded, but we could not save the result. Please try again.';
    case 'MALFORMED_IMAGE':
      return 'The captured photo could not be processed. Please try capturing again.';
    case 'PROVIDER_UNAVAILABLE':
      return 'The face recognition service is temporarily unavailable. Please try again shortly.';
    case 'TIMEOUT':
      return 'The request took too long. Please try again.';
    case 'UNAUTHORIZED':
      return 'Your session has expired. Please sign in again.';
    case 'RATE_LIMITED':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'METHOD_NOT_ALLOWED':
    case 'BAD_REQUEST':
      return 'Something went wrong with the request. Please try again.';
    case 'INTERNAL_ERROR':
      return 'Something went wrong on our end. Please try again.';
    default:
      return 'Verification failed. Please try again.';
  }
}

// ── Live/continuous scanning (camera-first flow) ─────────────────────────
//
// The employee never presses "Capture" for normal attendance — the camera
// auto-samples frames on a timer and each one is submitted automatically.
// A single bad frame (no face yet, blinked, moved) is normal and expected,
// not a terminal failure — these two helpers classify a returned reason
// code (from EITHER `FaceAttendanceError.code`, always UPPERCASE per the
// HTTP layer's `reason.toUpperCase()` convention, OR `AttendanceCheckError.
// reason`, always lowercase snake_case as `AttendanceService.ts` throws it)
// so the scanning loop can decide: keep quietly retrying next tick
// (RETRIABLE), or stop and show a distinct message requiring an explicit
// "Try Again" tap (TERMINAL) — never silently loop forever against a
// genuinely broken/unavailable backend, per this session's own explicit
// "protection against duplicate concurrent verification requests... no
// request storm" requirement.

const RETRIABLE_BIOMETRIC_REASONS = new Set([
  'no_face',
  'multiple_faces',
  'poor_quality',
  'liveness_failed',
  'verification_failed',
  'ambiguous_match',
  'malformed_image', // a single bad frame — the next auto-captured frame is a safe, cheap retry
]);

/** Reasons meaning "the attendance state the employee wanted already
 * exists" (AttendanceService's own pre-existing duplicate-write guard) —
 * never shown as an error and never retried; the caller should treat this
 * as a reconciliation signal and refresh from the server. */
const DUPLICATE_ATTENDANCE_REASONS = new Set(['duplicate_check_in', 'duplicate_check_out']);

function normalizeReasonCode(code: string | null | undefined): string {
  return (code || '').trim().toLowerCase();
}

export function isDuplicateAttendanceErrorCode(code: string | null | undefined): boolean {
  return DUPLICATE_ATTENDANCE_REASONS.has(normalizeReasonCode(code));
}

/** True for a reason the live-scan loop should silently keep retrying on
 * its next timed tick (updating the on-screen guidance text only); false
 * for anything else — including every GPS/geofence/attendance-policy
 * reason (moving the face around a second time can never fix "outside the
 * geofence"), every auth/session reason, and every network/provider/rate-
 * limit reason (retrying instantly against a struggling backend would be
 * exactly the "request storm" this session's instructions forbid). A
 * duplicate-attendance code is deliberately NOT retriable here — it is
 * handled as its own, earlier, success-adjacent branch by the caller
 * (`isDuplicateAttendanceErrorCode`), never reaching this classification.
 */
export function isRetriableBiometricErrorCode(code: string | null | undefined): boolean {
  const normalized = normalizeReasonCode(code);
  if (!normalized) return false;
  if (DUPLICATE_ATTENDANCE_REASONS.has(normalized)) return false;
  return RETRIABLE_BIOMETRIC_REASONS.has(normalized);
}

/** Short, scan-appropriate guidance text — deliberately terser than
 * `describeEnrollmentErrorCode()`/`describeVerificationErrorCode()` above
 * (those are written for a one-time terminal message; this is refreshed
 * on-screen every ~2s during continuous scanning, so it stays brief and
 * non-alarming). Falls back to a neutral "keep scanning" prompt for any
 * code not explicitly listed (including a genuinely unrecognized one) —
 * never blank, never the raw code itself. */
export function describeLiveScanGuidance(code: string | null | undefined): string {
  switch (normalizeReasonCode(code)) {
    case 'no_face':
      return 'No face detected — position your face inside the frame.';
    case 'multiple_faces':
      return 'Only one face should be visible — make sure it’s just you.';
    case 'poor_quality':
      return 'Move into better lighting and hold still.';
    case 'liveness_failed':
      return 'Liveness check failed — please try again.';
    case 'verification_failed':
      return 'Face not matched. Please position your face correctly and try again.';
    case 'ambiguous_match':
      return 'Not quite clear — hold still for a moment.';
    case 'malformed_image':
      return 'Trying again…';
    default:
      return 'Scanning…';
  }
}
