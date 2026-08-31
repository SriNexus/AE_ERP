/**
 * Face Attendance product-integration follow-up (post-Phase-13) —
 * source-text/structural tests for the new unified single-action employee
 * experience: `useFaceEnrollmentStatus.ts`, `useFaceAttendanceFlow.ts`,
 * `FaceAttendanceFlow.tsx`, and their wiring into `CheckInPanel.tsx` /
 * `src/pages/Attendance.tsx`. Same convention as every other UI-tier test
 * in this codebase (no `@testing-library/react` installed) — source-text/
 * structural assertions against the actual shipped code, matching
 * `faceAttendance.structural.test.ts` (Phase 8) and
 * `faceCapture.structural.test.ts` (Phase 7) exactly.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const componentsDir = join(__dirname, '..');
const hooksDir = join(__dirname, '..', '..', '..', 'features', 'attendance', 'hooks');
const servicesDir = join(__dirname, '..', '..', '..', 'features', 'attendance', 'services');
const pagesDir = join(__dirname, '..', '..', '..', 'pages');
const apiBiometricsDir = join(__dirname, '..', '..', '..', '..', 'api', 'biometrics');

const checkInPanel = readFileSync(join(componentsDir, 'CheckInPanel.tsx'), 'utf-8');
const faceAttendanceFlow = readFileSync(join(componentsDir, 'FaceAttendanceFlow.tsx'), 'utf-8');
const useFaceEnrollmentStatus = readFileSync(join(hooksDir, 'useFaceEnrollmentStatus.ts'), 'utf-8');
const useFaceAttendanceFlow = readFileSync(join(hooksDir, 'useFaceAttendanceFlow.ts'), 'utf-8');
const attendanceButtonState = readFileSync(join(servicesDir, 'attendanceButtonState.ts'), 'utf-8');
const attendancePage = readFileSync(join(pagesDir, 'Attendance.tsx'), 'utf-8');
const statusRoute = readFileSync(join(apiBiometricsDir, 'status.ts'), 'utf-8');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const useFaceAttendanceFlowCode = stripComments(useFaceAttendanceFlow);
const useFaceEnrollmentStatusCode = stripComments(useFaceEnrollmentStatus);
const faceAttendanceFlowCode = stripComments(faceAttendanceFlow);
const checkInPanelCode = stripComments(checkInPanel);
const attendancePageCode = stripComments(attendancePage);

// ── useFaceEnrollmentStatus — the server-authoritative status check ────

describe('useFaceEnrollmentStatus — reads the real, existing server-authoritative status endpoint', () => {
  it('calls GET /api/biometrics/status — the new, minimal projection endpoint, never a second/parallel one', () => {
    // The URL is a variable as of the Employee-View "Register Face" follow-up
    // (it conditionally appends ?targetUserId=), but it is built from, and
    // only ever from, this exact literal path — never a second endpoint.
    expect(useFaceEnrollmentStatusCode).toContain("/api/biometrics/status?targetUserId=");
    expect(useFaceEnrollmentStatusCode).toContain("'/api/biometrics/status'");
    expect(useFaceEnrollmentStatusCode).toContain('fetch(url');
    expect(useFaceEnrollmentStatusCode).toContain("method: 'GET'");
  });

  it('sends the request with an Authorization Bearer token, the same established mechanism as every other biometric route', () => {
    expect(useFaceEnrollmentStatusCode).toContain('Authorization: `Bearer ${idToken}`');
    expect(useFaceEnrollmentStatusCode).toContain('getIdToken()');
  });

  it('never sends a request body on this GET call — an optional target identity is carried in the query string only, and only for the Employee-View on-behalf-of case, never a raw client-trusted write', () => {
    expect(useFaceEnrollmentStatusCode).not.toMatch(/body:\s*JSON\.stringify/);
    // targetUserId is now a deliberate, server-authorized (resolveEnrollmentTarget)
    // capability — see api/biometrics/status.ts's own tests for the
    // authorization boundary. What must still never appear is a body, or any
    // OTHER client-chosen identity field (companyId/groupId) bypassing that.
    expect(useFaceEnrollmentStatusCode).not.toMatch(/\bemployeeId\b(?!Status)|\bcompanyId\b|\bgroupId\b/);
  });

  it('uses the query key ["biometricFaceReference"] as the default (self) case — the EXACT key useFaceEnrollment.ts already invalidates on a successful self-enrollment — and a distinct, additional key for an explicit target', () => {
    expect(useFaceEnrollmentStatusCode).toContain(": ['biometricFaceReference']");
    expect(useFaceEnrollmentStatusCode).toContain("['biometricFaceReference', targetUserId]");
    const enrollmentHook = readFileSync(join(hooksDir, 'useFaceEnrollment.ts'), 'utf-8');
    expect(enrollmentHook).toContain("queryKey: ['biometricFaceReference']");
  });

  it('never logs or persists the status result to console/localStorage/sessionStorage', () => {
    expect(useFaceEnrollmentStatusCode).not.toMatch(/console\.(log|info|warn|error|debug)/);
    expect(useFaceEnrollmentStatusCode).not.toContain('localStorage');
    expect(useFaceEnrollmentStatusCode).not.toContain('sessionStorage');
  });
});

// ── api/biometrics/status.ts — the server side of the above ────────────

describe('api/biometrics/status.ts — minimal, self-only, never leaks the embedding', () => {
  it('only ever returns {status} — never the embedding or any other reference field', () => {
    expect(statusRoute).toContain('sendSuccess(res, { status })');
  });

  it('reads the reference for the RESOLVED target (self by default) — an explicit ?targetUserId= is only ever honored after resolveEnrollmentTarget() re-derives and authorizes it server-side, never trusted as a raw client-suppliable id', () => {
    expect(statusRoute).toContain('store.getReference(target.targetUserId)');
    expect(statusRoute).toContain('resolveEnrollmentTarget(user, requestedTargetUserId,');
    // Never a direct, unauthorized use of the raw query param.
    expect(statusRoute).not.toMatch(/store\.getReference\(requestedTargetUserId\)/);
  });

  it('reuses the existing createDefaultBiometricReferenceStore() — never a second storage model/collection', () => {
    expect(statusRoute).toContain("import { createDefaultBiometricReferenceStore } from '../_lib/biometrics/referenceStore'");
  });

  it('is authenticated via the same verifyAuthToken/rateLimit mechanism as enroll.ts/verify.ts', () => {
    expect(statusRoute).toContain("import { verifyAuthToken } from '../_lib/auth'");
    expect(statusRoute).toContain("import { checkRateLimit, getRateLimitKey } from '../_lib/rateLimit'");
  });
});

// ── useFaceAttendanceFlow — composition, never a fourth API call ───────

describe('useFaceAttendanceFlow — composes existing hooks only, adds no new API surface', () => {
  it('composes useFaceEnrollmentStatus + useFaceEnrollment + useFaceAttendance — never reimplements their logic', () => {
    expect(useFaceAttendanceFlowCode).toContain("import { useFaceEnrollmentStatus");
    expect(useFaceAttendanceFlowCode).toContain("import { useFaceEnrollment }");
    expect(useFaceAttendanceFlowCode).toContain("import { useFaceAttendance");
  });

  it('never calls fetch/getUserMedia itself — every network/camera call is delegated to the composed hooks', () => {
    expect(useFaceAttendanceFlowCode).not.toContain('fetch(');
    expect(useFaceAttendanceFlowCode).not.toContain('getUserMedia');
  });

  it('a first-time submit calls enrollment.submit(blob), never attendance.submit(blob) directly', () => {
    const submitFnIdx = useFaceAttendanceFlowCode.indexOf('function submit(blob: Blob)');
    const submitFnBlock = useFaceAttendanceFlowCode.slice(submitFnIdx, submitFnIdx + 400);
    expect(submitFnBlock).toContain('enrollment.submit(blob)');
    expect(submitFnBlock).toContain('attendance.submit(blob)');
    // needsEnrollment gates which one runs first — both calls exist, but
    // under an if/else, never both unconditionally for the same submit.
    expect(submitFnBlock).toMatch(/if\s*\(needsEnrollment\)/);
  });

  it('chains attendance.submit(blob) automatically once enrollment succeeds — the employee never captures a second photo', () => {
    expect(useFaceAttendanceFlowCode).toMatch(/enrollment\.status === 'success'[\s\S]{0,200}attendance\.submit\(/);
  });

  it('never sends a client-supplied identity field anywhere in this file (no targetUserId/employeeId/companyId/groupId)', () => {
    expect(useFaceAttendanceFlowCode).not.toMatch(/\btargetUserId\b|\bemployeeId\b|\bcompanyId\b|\bgroupId\b/);
  });

  it('never logs the captured image/blob/base64/embedding to the console', () => {
    expect(useFaceAttendanceFlowCode).not.toMatch(/console\.(log|info|warn|error|debug)/);
  });
});

// ── FaceAttendanceFlow.tsx — the one camera experience ──────────────────

describe('FaceAttendanceFlow — reuses the existing generic FaceCapture, no parallel camera implementation', () => {
  it('imports and renders the existing, generic FaceCapture component', () => {
    expect(faceAttendanceFlowCode).toContain("import FaceCapture from './FaceCapture'");
    expect(faceAttendanceFlowCode).toMatch(/<FaceCapture\b/);
  });

  it('never calls getUserMedia directly — all camera lifecycle stays inside FaceCapture/useFaceCapture', () => {
    expect(faceAttendanceFlowCode).not.toContain('getUserMedia');
  });

  it('shows first-time-setup copy only when the flow actually needs enrollment (awaitingEnrollmentConfirmation is derived from flow.needsEnrollment)', () => {
    expect(faceAttendanceFlowCode).toMatch(/const awaitingEnrollmentConfirmation = flow\.needsEnrollment/);
    const jsxGateIdx = faceAttendanceFlowCode.indexOf('{awaitingEnrollmentConfirmation ?');
    const registerCopyIdx = faceAttendanceFlowCode.indexOf('register your face');
    expect(jsxGateIdx).toBeGreaterThan(-1);
    expect(registerCopyIdx).toBeGreaterThan(jsxGateIdx);
    expect(registerCopyIdx - jsxGateIdx).toBeLessThan(600);
  });

  it('requires an explicit "Register Face" tap before automatic scanning begins for a first-time employee — never silently enrolls', () => {
    expect(faceAttendanceFlowCode).toContain('Register Face');
    expect(faceAttendanceFlowCode).toMatch(/onClick=\{\(\) => setEnrollmentConfirmed\(true\)\}/);
    // Captured frames are discarded (never submitted) while still awaiting that tap.
    const handleCaptureIdx = faceAttendanceFlowCode.indexOf('function handleCapture(blob: Blob)');
    const handleCaptureBlock = faceAttendanceFlowCode.slice(handleCaptureIdx, handleCaptureIdx + 700);
    expect(handleCaptureBlock).toMatch(/if \(awaitingEnrollmentConfirmation\) return;/);
  });

  it('never exposes internal biometric detail (threshold value, distance, provider/model name, DeepFace) to the employee', () => {
    expect(faceAttendanceFlowCode).not.toMatch(/0\.68|DeepFace|ArcFace|distance|threshold|provider/i);
  });

  it('passes isSubmitting to FaceCapture so retake/submit controls are disabled mid-flight — no double submission', () => {
    expect(faceAttendanceFlowCode).toContain('isSubmitting={flow.isSubmitting}');
  });

  it('never writes to localStorage/sessionStorage/IndexedDB, never logs the captured image', () => {
    expect(faceAttendanceFlowCode).not.toContain('localStorage');
    expect(faceAttendanceFlowCode).not.toContain('sessionStorage');
    expect(faceAttendanceFlowCode).not.toContain('indexedDB');
    expect(faceAttendanceFlowCode).not.toMatch(/console\.(log|info|warn|error|debug)/);
  });
});

// ── CheckInPanel — exactly ONE primary attendance action ────────────────

describe('CheckInPanel — exactly ONE primary attendance action, not two independent controls', () => {
  it('imports the unified FaceAttendanceFlow + useFaceEnrollmentStatus + deriveAttendanceButtonState — the single decision point', () => {
    expect(checkInPanelCode).toContain("import FaceAttendanceFlow from './FaceAttendanceFlow'");
    expect(checkInPanelCode).toContain('useFaceEnrollmentStatus');
    expect(checkInPanelCode).toContain('deriveAttendanceButtonState');
  });

  it('never imports the old separate GPS-only useCheckIn/useCheckOut hooks — the primary action is always biometric+GPS together', () => {
    expect(checkInPanelCode).not.toMatch(/from '\.\.\/\.\.\/features\/attendance\/hooks\/useCheckIn'/);
    expect(checkInPanelCode).not.toMatch(/from '\.\.\/\.\.\/features\/attendance\/hooks\/useCheckOut'/);
  });

  it('renders the camera flow inside a Modal — one shared, already-tested overlay implementation, not a bespoke one', () => {
    expect(checkInPanelCode).toContain('Modal');
    expect(checkInPanelCode).toContain('<FaceAttendanceFlow');
  });

  it('a revoked enrollment status is checked and blocks the camera from ever being offered — self-service can never bypass revocation', () => {
    const revokedIdx = checkInPanelCode.indexOf("enrollmentStatus.status === 'revoked'");
    expect(revokedIdx).toBeGreaterThan(-1);
    const cameraOpenIdx = checkInPanelCode.indexOf('setCameraAction', revokedIdx);
    // The revoked branch returns its own JSX before the code that could
    // ever open the camera — proven by the revoked check appearing before
    // the first place setCameraAction is actually invoked from a button.
    expect(cameraOpenIdx).toBeGreaterThan(revokedIdx);
  });

  it('the camera closes automatically once the parent\'s todayRecord confirms the targeted action actually succeeded', () => {
    expect(checkInPanelCode).toMatch(/cameraAction === 'checkIn' && isCheckedIn/);
    expect(checkInPanelCode).toMatch(/cameraAction === 'checkOut' && isCheckedOut/);
  });

  it('never sends/references a client-supplied identity field', () => {
    expect(checkInPanelCode).not.toMatch(/\btargetUserId\b|\bemployeeId\b(?!:)/);
  });
});

// ── Attendance.tsx (desktop) — the same unified action, not a separate implementation ──

describe('Attendance.tsx (desktop header) — same unified Face Attendance action as mobile, one shared implementation', () => {
  it('imports the SAME FaceAttendanceFlow/useFaceEnrollmentStatus/deriveAttendanceButtonState used by CheckInPanel — no separate desktop-only camera logic', () => {
    expect(attendancePageCode).toContain("import FaceAttendanceFlow from '../components/attendance/FaceAttendanceFlow'");
    expect(attendancePageCode).toContain('useFaceEnrollmentStatus');
    expect(attendancePageCode).toContain('deriveAttendanceButtonState');
  });

  it('no longer imports the old separate GPS-only useCheckIn/useCheckOut header hooks', () => {
    expect(attendancePageCode).not.toMatch(/from '\.\.\/features\/attendance\/hooks\/useCheckIn'/);
    expect(attendancePageCode).not.toMatch(/from '\.\.\/features\/attendance\/hooks\/useCheckOut'/);
  });

  it('the header shows the action only while one is available (hidden once today\'s attendance is complete)', () => {
    expect(attendancePageCode).toMatch(/headerButtonState\.action\s*&&/);
  });

  it('the camera modal closes automatically once todayAttendance confirms the targeted action succeeded, mirroring CheckInPanel\'s own pattern', () => {
    expect(attendancePageCode).toMatch(/cameraAction === 'checkIn' && isCheckedInToday/);
    expect(attendancePageCode).toMatch(/cameraAction === 'checkOut' && isCheckedOutToday/);
  });

  // Regression test (bug fix, product-integration follow-up verification
  // pass): the desktop header originally had NO revoked-enrollment check at
  // all — deriveAttendanceButtonState deliberately doesn't know about
  // 'revoked' (see its own test's documented contract), so without a guard
  // at this call site, a revoked employee could open the camera and
  // complete a capture before ever being told, unlike CheckInPanel (mobile)
  // which already blocked correctly. The backend always failed closed
  // either way (no bypass was ever possible) — this fixes the UX/parity gap.
  it('checks enrollmentStatus.status === "revoked" and hides the action button, mirroring CheckInPanel\'s own block — a revoked employee is told BEFORE the camera can open, on desktop too', () => {
    expect(attendancePageCode).toContain("enrollmentStatus.status === 'revoked'");
    expect(attendancePageCode).toMatch(/headerButtonState\.action\s*&&\s*!isEnrollmentRevoked/);
  });

  it('shows a clear revoked-enrollment message on desktop, not silence', () => {
    expect(attendancePageCode).toMatch(/isEnrollmentRevoked\s*&&/);
    expect(attendancePageCode).toContain('biometric enrollment has been revoked');
  });
});

// ── deriveAttendanceButtonState is the SAME function on both surfaces ──

describe('Single source of truth — mobile and desktop derive the button label/action from the exact same pure function', () => {
  it('CheckInPanel and Attendance.tsx both call deriveAttendanceButtonState — never two independently-hand-rolled label decisions', () => {
    expect(checkInPanelCode).toContain('deriveAttendanceButtonState(todayRecord, enrollmentStatus.status)');
    expect(attendancePageCode).toContain('deriveAttendanceButtonState(todayAttendance, enrollmentStatus.status)');
  });

  it('attendanceButtonState.ts has zero Firebase/React/DOM dependency — pure and directly unit-testable', () => {
    expect(attendanceButtonState).not.toMatch(/from 'react'|firebase|useState|useEffect/);
  });
});
