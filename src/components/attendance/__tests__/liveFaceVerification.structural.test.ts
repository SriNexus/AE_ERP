/**
 * Camera-first live face verification hardening pass — source-text/
 * structural regression tests for the conversion from click-to-capture to
 * continuous automatic scanning: `useFaceCapture.ts`'s `captureFrame()` +
 * secure-context-check-order fix, `FaceCapture.tsx`'s `autoCapture` mode,
 * `useFaceAttendance.ts`/`useFaceAttendanceFlow.ts`'s new `errorCode`
 * field, `faceCaptureSupport.ts`'s retriable/terminal/duplicate
 * classification, and `FaceAttendanceFlow.tsx`'s orchestration of all of
 * it. Same convention as every other UI-tier test in this codebase (no
 * `@testing-library/react`): source-text/structural assertions.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  describeLiveScanGuidance,
  isDuplicateAttendanceErrorCode,
  isRetriableBiometricErrorCode,
} from '../../../features/attendance/services/faceCaptureSupport';

const hooksDir = join(__dirname, '..', '..', '..', 'features', 'attendance', 'hooks');
const componentsDir = join(__dirname, '..');
const servicesDir = join(__dirname, '..', '..', '..', 'features', 'attendance', 'services');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const useFaceCapture = readFileSync(join(hooksDir, 'useFaceCapture.ts'), 'utf-8');
const useFaceCaptureCode = stripComments(useFaceCapture);
const faceCaptureComponent = readFileSync(join(componentsDir, 'FaceCapture.tsx'), 'utf-8');
const faceCaptureCode = stripComments(faceCaptureComponent);
const faceAttendanceFlow = readFileSync(join(componentsDir, 'FaceAttendanceFlow.tsx'), 'utf-8');
const faceAttendanceFlowCode = stripComments(faceAttendanceFlow);
const useFaceAttendance = readFileSync(join(hooksDir, 'useFaceAttendance.ts'), 'utf-8');
const useFaceAttendanceFlow = readFileSync(join(hooksDir, 'useFaceAttendanceFlow.ts'), 'utf-8');
const attendanceService = readFileSync(join(__dirname, '..', '..', '..', 'services', 'AttendanceService.ts'), 'utf-8');

// ── A. CAMERA — the real bug: check ORDER, not just existence ──────────

describe('useFaceCapture — secure-context checked BEFORE getUserMedia support (the real "browser unsupported" bug)', () => {
  it('checks isSecureContextAvailable() first — on an insecure origin, navigator.mediaDevices is undefined regardless of browser capability, so checking "supported" first always produced a false "unsupported browser" diagnosis', () => {
    const secureIdx = useFaceCaptureCode.indexOf('isSecureContextAvailable()');
    const supportedIdx = useFaceCaptureCode.indexOf('isGetUserMediaSupported()', useFaceCaptureCode.indexOf('const start = useCallback'));
    expect(secureIdx).toBeGreaterThan(-1);
    expect(supportedIdx).toBeGreaterThan(-1);
    expect(secureIdx).toBeLessThan(supportedIdx);
  });

  it('fails with insecure_context, not unsupported, when the secure-context check fails first', () => {
    const startIdx = useFaceCaptureCode.indexOf('const start = useCallback');
    const startBlock = useFaceCaptureCode.slice(startIdx, startIdx + 500);
    expect(startBlock).toMatch(/if \(!isSecureContextAvailable\(\)\) \{\s*\n\s*fail\('insecure_context'\)/);
  });
});

describe('useFaceCapture — captureFrame() (camera-first live verification primitive)', () => {
  it('exists, is exposed from the hook, and never transitions status to "captured" (no freeze-frame/preview step)', () => {
    expect(useFaceCaptureCode).toContain('captureFrame');
    const fnIdx = useFaceCaptureCode.indexOf('const captureFrame = useCallback');
    const nextFnIdx = useFaceCaptureCode.indexOf('const retake = useCallback');
    const fnBlock = useFaceCaptureCode.slice(fnIdx, nextFnIdx);
    expect(fnBlock).not.toContain("setStatus('captured')");
  });

  it('resolves null (never throws) when not currently streaming, so the auto-scan loop can safely skip a tick', () => {
    const fnIdx = useFaceCaptureCode.indexOf('const captureFrame = useCallback');
    const fnBlock = useFaceCaptureCode.slice(fnIdx, fnIdx + 400);
    expect(fnBlock).toMatch(/if \(!video \|\| status !== 'streaming'\) \{\s*\n\s*resolve\(null\)/);
  });

  it('is exported in the hook\'s return object', () => {
    expect(useFaceCaptureCode).toMatch(/return \{[^}]*captureFrame[^}]*\}/);
  });
});

// ── B. LIVE VERIFICATION — FaceCapture's autoCapture mode ──────────────

describe('FaceCapture — autoCapture mode: no Capture button, continuous timed sampling', () => {
  it('accepts autoCapture (default false, preserving the original manual-capture behavior for any other caller)', () => {
    expect(faceCaptureCode).toContain('autoCapture?: boolean');
    expect(faceCaptureCode).toContain('autoCapture = false');
  });

  it('when autoCapture is true, the streaming branch renders NO "Capture" button', () => {
    const streamingIdx = faceCaptureCode.indexOf("status === 'streaming' &&");
    const streamingBlockEnd = faceCaptureCode.indexOf("status === 'captured'");
    const streamingBlock = faceCaptureCode.slice(streamingIdx, streamingBlockEnd);
    // The manual-mode-only Capture button is inside an `autoCapture ? (...) : (<>...Capture...</>)` branch.
    expect(streamingBlock).toMatch(/autoCapture \? \(/);
  });

  it('samples one frame on a fixed interval, gated on isSubmitting via a ref (never firing while a request is already in flight)', () => {
    expect(faceCaptureCode).toContain('AUTO_CAPTURE_INTERVAL_MS');
    expect(faceCaptureCode).toMatch(/setInterval\(\(\) => \{\s*\n\s*if \(isSubmittingRef\.current\) return;/);
  });

  it('the interval only restarts on autoCapture/status changes — NOT on every isSubmitting/onCapture change (isSubmitting and onCapture are read via refs)', () => {
    const effectIdx = faceCaptureCode.indexOf('if (!autoCapture || status !== \'streaming\') return;');
    const depsIdx = faceCaptureCode.indexOf('}, [autoCapture, status, captureFrame]);', effectIdx);
    expect(depsIdx).toBeGreaterThan(effectIdx);
  });

  it('cleans up the interval on unmount/dependency change — never a leaked timer', () => {
    expect(faceCaptureCode).toMatch(/return \(\) => \{\s*\n\s*cancelled = true;\s*\n\s*clearInterval\(timer\);/);
  });

  it('accepts scanMessage/scanTone to show live guidance text, driven by the caller — never a hardcoded threshold/reason string inside this generic component', () => {
    expect(faceCaptureCode).toContain('scanMessage?: string');
    expect(faceCaptureCode).toContain("scanTone?: 'muted' | 'danger'");
  });
});

describe('faceCaptureSupport — retriable vs terminal biometric error classification', () => {
  it('classifies every routine rejection (no face, wrong face, poor quality, multiple faces, liveness) as retriable — keep scanning', () => {
    for (const code of ['NO_FACE', 'MULTIPLE_FACES', 'POOR_QUALITY', 'LIVENESS_FAILED', 'VERIFICATION_FAILED', 'AMBIGUOUS_MATCH', 'MALFORMED_IMAGE']) {
      expect(isRetriableBiometricErrorCode(code)).toBe(true);
    }
  });

  it('classifies network/provider/rate-limit/auth/GPS-policy reasons as terminal — pause and require an explicit retry', () => {
    for (const code of [
      'NETWORK_ERROR', 'PROVIDER_UNAVAILABLE', 'TIMEOUT', 'RATE_LIMITED', 'UNAUTHORIZED',
      'ENROLLMENT_REVOKED', 'NOT_AUTHORIZED', 'CROSS_TENANT_DENIED', 'PERSISTENCE_FAILED',
      'outside_geofence', 'gps_unusable', 'no_assigned_location',
    ]) {
      expect(isRetriableBiometricErrorCode(code)).toBe(false);
    }
  });

  it('is case-insensitive (FaceAttendanceError.code is UPPERCASE; AttendanceCheckError.reason is lowercase snake_case — both real sources)', () => {
    expect(isRetriableBiometricErrorCode('no_face')).toBe(true);
    expect(isRetriableBiometricErrorCode('NO_FACE')).toBe(true);
  });

  it('never classifies null/undefined/empty as retriable', () => {
    expect(isRetriableBiometricErrorCode(null)).toBe(false);
    expect(isRetriableBiometricErrorCode(undefined)).toBe(false);
    expect(isRetriableBiometricErrorCode('')).toBe(false);
  });

  it('a duplicate-attendance code is explicitly NOT retriable (handled as its own success-adjacent reconciliation, never looped on)', () => {
    expect(isRetriableBiometricErrorCode('duplicate_check_in')).toBe(false);
    expect(isRetriableBiometricErrorCode('duplicate_check_out')).toBe(false);
  });

  it('isDuplicateAttendanceErrorCode recognizes exactly the two AttendanceService reasons, case-insensitively', () => {
    expect(isDuplicateAttendanceErrorCode('duplicate_check_in')).toBe(true);
    expect(isDuplicateAttendanceErrorCode('DUPLICATE_CHECK_OUT')).toBe(true);
    expect(isDuplicateAttendanceErrorCode('no_face')).toBe(false);
  });

  it('describeLiveScanGuidance never returns a blank string or the raw code itself, for any input', () => {
    for (const code of ['no_face', 'MULTIPLE_FACES', 'poor_quality', 'liveness_failed', 'verification_failed', 'ambiguous_match', 'something_unrecognized', null, undefined]) {
      const text = describeLiveScanGuidance(code as any);
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toBe(code);
    }
  });

  it('describeLiveScanGuidance text is short (scan-appropriate, refreshed every ~2s) — never the longer one-shot terminal message', () => {
    expect(describeLiveScanGuidance('no_face').length).toBeLessThan(80);
  });
});

// ── B (cont'd). errorCode plumbing — needed for the classification above to work at all ──

describe('useFaceAttendance / useFaceAttendanceFlow — errorCode exposed (mirrors useFaceEnrollment\'s existing pattern)', () => {
  it('useFaceAttendance.ts returns errorCode, sourced from FaceAttendanceError.code OR AttendanceCheckError.reason', () => {
    expect(useFaceAttendance).toMatch(/errorCode,?\s*\n\s*isSubmitting/);
    expect(useFaceAttendance).toContain('mutation.error instanceof FaceAttendanceError\n    ? mutation.error.code');
    expect(useFaceAttendance).toContain('mutation.error instanceof AttendanceCheckError\n      ? mutation.error.reason');
  });

  it('useFaceAttendanceFlow.ts combines enrollment/attendance errorCode with the same precedence as errorMessage', () => {
    expect(useFaceAttendanceFlow).toMatch(/errorCode,?\s*\n\s*record/);
    expect(useFaceAttendanceFlow).toContain('attendance.status === \'error\'\n    ? attendance.errorCode');
  });
});

// ── C. FIRST-TIME ENROLLMENT — camera-first, consent-gated ─────────────

describe('FaceAttendanceFlow — first-time enrollment is camera-first but still consent-gated', () => {
  it('the camera is live (autoStart) even before enrollment is confirmed — the employee sees themselves before tapping Register Face', () => {
    expect(faceAttendanceFlowCode).toContain('autoStart');
  });

  it('automatic scanning frames are silently discarded (never submitted, never a network call) until the explicit "Register Face" tap', () => {
    const idx = faceAttendanceFlowCode.indexOf('function handleCapture(blob: Blob)');
    const block = faceAttendanceFlowCode.slice(idx, idx + 400);
    expect(block).toMatch(/if \(awaitingEnrollmentConfirmation\) return;/);
    expect(block).toContain('flow.submit(blob);');
  });

  it('after confirmation, the SAME auto-capture mechanism drives enrollment — no separate/parallel enrollment camera flow', () => {
    // autoCapture is the same single prop for both enrollment and
    // verification (gated only on the terminal-error pause and, as of the
    // no-enrollment-before-verification fix, on enrollment-status being
    // actually known) — proving enrollment and verification share the
    // exact same scanning loop, never a second/parallel one.
    expect(faceAttendanceFlowCode).toMatch(/autoCapture=\{!pausedForTerminalError && !flow\.isEnrollmentStatusUnknown\}/);
  });
});

// ── B (cont'd). Terminal-error pause + duplicate-attendance reconciliation ──

describe('FaceAttendanceFlow — terminal errors pause scanning; duplicate-attendance is reconciled, never retried', () => {
  it('a non-retriable error pauses auto-capture (autoCapture is gated on !pausedForTerminalError)', () => {
    expect(faceAttendanceFlowCode).toMatch(/if \(!isRetriableBiometricErrorCode\(flow\.errorCode\)\) \{\s*\n\s*setPausedForTerminalError\(true\);/);
  });

  it('"Try Again" clears the pause AND resets the underlying mutations (flow.reset()) — scanning resumes automatically, not via a new manual capture', () => {
    const idx = faceAttendanceFlowCode.indexOf('function handleTryAgain()');
    const block = faceAttendanceFlowCode.slice(idx, idx + 200);
    expect(block).toContain('setPausedForTerminalError(false)');
    expect(block).toContain('flow.reset()');
  });

  it('a duplicate_check_in/out is never shown as a scary error — it is reconciled from the server and treated as success-adjacent', () => {
    expect(faceAttendanceFlowCode).toContain('isDuplicateReconciliation');
    expect(faceAttendanceFlowCode).toMatch(/isDuplicateAttendanceErrorCode\(flow\.errorCode\)/);
    expect(faceAttendanceFlowCode).toContain("qc.invalidateQueries({ queryKey: ['attendance'] })");
  });

  it('the duplicate-attendance path is explicitly excluded from ever setting the terminal-error pause (it is reconciliation, not a failure)', () => {
    const idx = faceAttendanceFlowCode.indexOf('if (flow.phase !== \'error\') return;');
    const block = faceAttendanceFlowCode.slice(idx, idx + 300);
    expect(block).toMatch(/if \(isDuplicateAttendanceErrorCode\(flow\.errorCode\)\) return;/);
  });
});

// ── AttendanceService's own pre-existing duplicate guard, re-confirmed (not re-implemented) ──

describe('AttendanceService — the duplicate-check-in/out guard this reconciliation relies on already existed, unmodified', () => {
  it('checkIn() throws duplicate_check_in when a checkIn already exists for today', () => {
    expect(attendanceService).toContain("'duplicate_check_in'");
  });

  it('checkOut() throws duplicate_check_out when a checkOut already exists for today', () => {
    expect(attendanceService).toContain("'duplicate_check_out'");
  });
});
