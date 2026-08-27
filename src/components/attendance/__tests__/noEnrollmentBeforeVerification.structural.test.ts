/**
 * Final production-readiness pass (post camera-first hardening) — Critical
 * Bug #1: an employee with NO active face reference (or whose reference
 * status just hasn't loaded yet) must never reach `/api/biometrics/verify`
 * before being offered enrollment. `useFaceAttendanceFlow.ts`'s previous
 * `needsEnrollment` check failed OPEN — `enrollmentStatus.status`
 * `undefined` (still loading, or the status check itself errored) was
 * treated as "already enrolled, go straight to verify" — which is exactly
 * what produced the reported "camera opens, immediately verification
 * failed" bug for an employee whose enrollment-status check was slow or
 * failed. This file covers the fix plus the related fixes made alongside it
 * in this same pass (the `todayAttendance` loading gate, and the desktop
 * camera modal sizing). Same convention as every other UI-tier test in this
 * codebase (no `@testing-library/react`) — source-text/structural
 * assertions against the actual shipped code.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const componentsDir = join(__dirname, '..');
const hooksDir = join(__dirname, '..', '..', '..', 'features', 'attendance', 'hooks');
const servicesDir = join(__dirname, '..', '..', '..', 'features', 'attendance', 'services');
const pagesDir = join(__dirname, '..', '..', '..', 'pages');
const mobileAttendanceDir = join(__dirname, '..', '..', '..', 'components', 'mobile', 'attendance');
const apiBiometricsDir = join(__dirname, '..', '..', '..', '..', 'api', 'biometrics');

const useFaceAttendanceFlow = readFileSync(join(hooksDir, 'useFaceAttendanceFlow.ts'), 'utf-8');
const faceAttendanceFlow = readFileSync(join(componentsDir, 'FaceAttendanceFlow.tsx'), 'utf-8');
const faceCapture = readFileSync(join(componentsDir, 'FaceCapture.tsx'), 'utf-8');
const checkInPanel = readFileSync(join(componentsDir, 'CheckInPanel.tsx'), 'utf-8');
const attendancePage = readFileSync(join(pagesDir, 'Attendance.tsx'), 'utf-8');
const mobileWorkspace = readFileSync(join(mobileAttendanceDir, 'MobileAttendanceWorkspace.tsx'), 'utf-8');
const verifyRoute = readFileSync(join(apiBiometricsDir, 'verify.ts'), 'utf-8');
const faceCaptureSupport = readFileSync(join(servicesDir, 'faceCaptureSupport.ts'), 'utf-8');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const flowHookCode = stripComments(useFaceAttendanceFlow);
const flowComponentCode = stripComments(faceAttendanceFlow);
const captureCode = stripComments(faceCapture);
const checkInPanelCode = stripComments(checkInPanel);
const attendancePageCode = stripComments(attendancePage);
const mobileWorkspaceCode = stripComments(mobileWorkspace);
const verifyRouteCode = stripComments(verifyRoute);

// ── Fail-closed enrollment-status gate (Critical Bug #1) ────────────────

describe('useFaceAttendanceFlow — never verifies or enrolls while enrollment status is unknown', () => {
  it('computes isEnrollmentStatusUnknown from an undefined status (covers both still-loading and errored)', () => {
    expect(flowHookCode).toMatch(/isEnrollmentStatusUnknown\s*=\s*!enrolledThisSession\s*&&\s*enrollmentStatus\.status\s*===\s*undefined/);
  });

  it('submit() refuses to call either enroll or verify while status is unknown — a hard invariant, not just a UI-layer check', () => {
    const submitFn = flowHookCode.slice(flowHookCode.indexOf('function submit'), flowHookCode.indexOf('function reset'));
    expect(submitFn).toMatch(/if\s*\(\s*isEnrollmentStatusUnknown\s*\)\s*return;/);
  });

  it('the unknown-guard appears BEFORE both the enrollment.submit and attendance.submit calls', () => {
    const submitFn = flowHookCode.slice(flowHookCode.indexOf('function submit'), flowHookCode.indexOf('function reset'));
    const guardIndex = submitFn.indexOf('if (isEnrollmentStatusUnknown) return;');
    const enrollCallIndex = submitFn.indexOf('enrollment.submit(blob)');
    const verifyCallIndex = submitFn.indexOf('attendance.submit(blob)');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(enrollCallIndex);
    expect(guardIndex).toBeLessThan(verifyCallIndex);
  });

  it('exposes isEnrollmentStatusUnknown, isEnrollmentStatusError, and refetchEnrollmentStatus to callers', () => {
    const returnStatement = flowHookCode.slice(flowHookCode.lastIndexOf('return {'));
    expect(returnStatement).toContain('isEnrollmentStatusUnknown,');
    expect(returnStatement).toContain('isEnrollmentStatusError: enrollmentStatus.isError,');
    expect(returnStatement).toContain('refetchEnrollmentStatus: enrollmentStatus.refetch,');
  });

  it('needsEnrollment still requires the exact string "none" — revoked/active/unknown never satisfy it (revoked must never silently fall into enrollment)', () => {
    expect(flowHookCode).toMatch(/needsEnrollment\s*=\s*!enrolledThisSession\s*&&\s*enrollmentStatus\.status\s*===\s*'none'/);
  });

  it('the original action binding is unaffected by this fix — useFaceAttendance(action) is still called once, with the caller-supplied action, never re-derived after enrollment', () => {
    expect(flowHookCode).toContain('const attendance = useFaceAttendance(action);');
    // The enroll-then-verify chaining effect must still submit through this
    // SAME `attendance` instance — proving Check In stays Check In and
    // Check Out stays Check Out through an in-flow enrollment (Section 11).
    const chainingEffect = flowHookCode.slice(flowHookCode.indexOf('pendingBlobRef.current && !chainedRef'), flowHookCode.indexOf('const needsEnrollment'));
    expect(chainingEffect).toContain('attendance.submit(blob)');
  });
});

describe('FaceAttendanceFlow — surfaces the unknown-status state instead of silently scanning', () => {
  it('pauses autoCapture while enrollment status is unknown', () => {
    expect(flowComponentCode).toContain('autoCapture={!pausedForTerminalError && !flow.isEnrollmentStatusUnknown}');
  });

  it('shows a distinct "checking status" message instead of the normal scan guidance', () => {
    expect(flowComponentCode).toContain('Checking your registration status');
    expect(flowComponentCode).toMatch(/flow\.isEnrollmentStatusUnknown\s*\?\s*'Checking your registration status/);
  });

  it('offers an explicit retry when the status check genuinely failed (not just still loading), wired to refetchEnrollmentStatus', () => {
    expect(flowComponentCode).toContain('flow.isEnrollmentStatusUnknown && flow.isEnrollmentStatusError');
    expect(flowComponentCode).toContain('flow.refetchEnrollmentStatus()');
  });

  it('never shows the enrollment-consent prompt while status is unknown — needsEnrollment stays false until status resolves to "none"', () => {
    // awaitingEnrollmentConfirmation is derived from flow.needsEnrollment,
    // which (per the hook test above) requires the resolved string 'none' —
    // an unknown/undefined status can never satisfy it, so no separate
    // component-level guard is needed here; this test documents that
    // invariant explicitly rather than leaving it implicit.
    expect(flowComponentCode).toContain('const awaitingEnrollmentConfirmation = flow.needsEnrollment && !enrollmentConfirmed;');
  });
});

// ── Real-device follow-up: surface the REAL error, never a hardcoded ──
// ── "check your connection" string (a real report showed exactly that ──
// ── message for a non-network failure — see api/_lib/__tests__/auth.test.ts ──
// ── for the actual root cause this was masking). ─────────────────────────

describe('useFaceEnrollmentStatus — exposes the real, server-sourced failure reason, never swallows it', () => {
  it('derives errorMessage from the actual thrown Error, not a hardcoded string', () => {
    const statusHookCode = stripComments(readFileSync(join(hooksDir, 'useFaceEnrollmentStatus.ts'), 'utf-8'));
    expect(statusHookCode).toMatch(/errorMessage:\s*query\.error instanceof Error\s*\?\s*query\.error\.message/);
  });

  it('never hardcodes a "connection"-flavored message in place of the real one', () => {
    const statusHookCode = stripComments(readFileSync(join(hooksDir, 'useFaceEnrollmentStatus.ts'), 'utf-8'));
    expect(statusHookCode).not.toMatch(/check your connection/i);
  });
});

describe('useFaceAttendanceFlow — threads the real error message through, does not re-hardcode it', () => {
  it('exposes enrollmentStatusErrorMessage sourced from useFaceEnrollmentStatus, not a literal string', () => {
    const returnStatement = flowHookCode.slice(flowHookCode.lastIndexOf('return {'));
    expect(returnStatement).toContain('enrollmentStatusErrorMessage: enrollmentStatus.errorMessage,');
  });
});

describe('FaceAttendanceFlow — displays the real error message, never the old hardcoded "check your connection" text', () => {
  it('the retry banner renders flow.enrollmentStatusErrorMessage', () => {
    expect(flowComponentCode).toContain('{flow.enrollmentStatusErrorMessage ||');
  });

  it('the old hardcoded, misdiagnosing message is gone', () => {
    expect(flowComponentCode).not.toContain('Could not confirm your face registration status. Check your connection and try again.');
  });
});

// ── todayAttendance loading gate (Section 4/5: two independent state machines) ──

describe('the intended attendance action (Check In vs Check Out) is never acted on before it is actually known', () => {
  it('MobileAttendanceWorkspace create-attendance branch waits for BOTH enrollment status AND todayAttendance before rendering the camera', () => {
    expect(mobileWorkspaceCode).toContain("const { data: todayAttendance, isLoading: isTodayAttendanceLoading } = useQuery({");
    expect(mobileWorkspaceCode).toContain('enrollmentStatus.isLoading || isTodayAttendanceLoading ? (');
  });

  it('MobileAttendanceWorkspace passes the combined loading state into CheckInPanel, not just the unrelated full-list loading flag', () => {
    expect(mobileWorkspaceCode).toContain('<CheckInPanel todayRecord={todayAttendance} isLoading={isLoading || isTodayAttendanceLoading} />');
  });

  it('desktop Attendance.tsx header button is disabled until todayAttendance has actually loaded, not just enrollment status', () => {
    expect(attendancePageCode).toContain("const { data: todayAttendance, isLoading: isTodayAttendanceLoading } = useQuery({");
    expect(attendancePageCode).toContain('disabled={enrollmentStatus.isLoading || isTodayAttendanceLoading}');
  });
});

// ── Desktop camera modal sizing (Section 8) ──────────────────────────────

describe('desktop camera modal is substantially larger than the old size, scaled to this content (not blindly copying Create Employee\'s exact width)', () => {
  it('Attendance.tsx no longer uses the tiny "sm" modal for the Face Attendance camera', () => {
    const modalBlock = attendancePageCode.slice(attendancePageCode.indexOf('open={!!cameraAction}'), attendancePageCode.indexOf('open={!!cameraAction}') + 400);
    expect(modalBlock).toContain('size="lg"');
    expect(modalBlock).not.toContain('size="sm"');
  });

  it('the mobile-only CheckInPanel modal is untouched — stays "sm", since mobile must not inherit desktop dimensions', () => {
    expect(checkInPanelCode).toContain('size="sm"');
    expect(checkInPanelCode).not.toContain('size="lg"');
  });

  it('FaceCapture\'s camera-preview cap grew from the old 480px, in both the streaming and captured (preview) states', () => {
    const occurrences = captureCode.match(/maxWidth:\s*520/g) || [];
    expect(occurrences.length).toBe(2);
    expect(captureCode).not.toContain('maxWidth: 480');
  });

  it('mobile is structurally unaffected by the desktop modal-size change — the mobile create-attendance camera renders FaceAttendanceFlow inline, never inside a Modal', () => {
    const createBranch = mobileWorkspaceCode.slice(mobileWorkspaceCode.indexOf('isCreateAttendanceRequested) {'), mobileWorkspaceCode.indexOf('isCreateAttendanceRequested) {') + 2000);
    expect(createBranch).toContain('<FaceAttendanceFlow');
    expect(createBranch).not.toContain('<Modal');
  });
});

// ── NO_ENROLLMENT semantic (Section 2/3) stays a distinct, honored code ──

describe('the server\'s own distinct NO_ENROLLMENT reason remains intact and reachable', () => {
  it('verify.ts still maps no_enrollment to its own HTTP status, distinct from a generic verification failure', () => {
    expect(verifyRouteCode).toContain('no_enrollment: 404');
    expect(verifyRouteCode).not.toContain('no_enrollment: 422');
  });

  it('the client still translates NO_ENROLLMENT into an actionable, distinct message (never displayed if the new gate works, but must remain correct as defense in depth)', () => {
    expect(stripComments(faceCaptureSupport)).toContain("case 'NO_ENROLLMENT':");
  });
});
