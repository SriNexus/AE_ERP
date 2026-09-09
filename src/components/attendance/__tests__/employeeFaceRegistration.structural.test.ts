/**
 * Final completion pass — Employee → View → Register Face.
 *
 * Source-text/structural tests for the new primary registration path,
 * matching this codebase's established convention (no
 * `@testing-library/react`): `EmployeeFaceRegistrationFlow.tsx`,
 * `useFaceEnrollment.ts`'s/`useFaceEnrollmentStatus.ts`'s new `targetUserId`
 * support, `Employees.tsx`'s Face Registration card wiring, and
 * `api/biometrics/status.ts`'s new on-behalf-of status lookup.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const componentsDir = join(__dirname, '..');
const hooksDir = join(__dirname, '..', '..', '..', 'features', 'attendance', 'hooks');
const pagesDir = join(__dirname, '..', '..', '..', 'pages');
const apiBiometricsDir = join(__dirname, '..', '..', '..', '..', 'api', 'biometrics');
const apiBiometricsLibDir = join(__dirname, '..', '..', '..', '..', 'api', '_lib', 'biometrics');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const registrationFlowCode = stripComments(readFileSync(join(componentsDir, 'EmployeeFaceRegistrationFlow.tsx'), 'utf-8'));
const faceAttendanceFlowCode = stripComments(readFileSync(join(componentsDir, 'FaceAttendanceFlow.tsx'), 'utf-8'));
const useFaceEnrollmentCode = stripComments(readFileSync(join(hooksDir, 'useFaceEnrollment.ts'), 'utf-8'));
const useFaceEnrollmentStatusCode = stripComments(readFileSync(join(hooksDir, 'useFaceEnrollmentStatus.ts'), 'utf-8'));
const employeesPageCode = stripComments(readFileSync(join(pagesDir, 'Employees.tsx'), 'utf-8'));
const statusRouteCode = stripComments(readFileSync(join(apiBiometricsDir, 'status.ts'), 'utf-8'));
const authorizationCode = stripComments(readFileSync(join(apiBiometricsLibDir, 'authorization.ts'), 'utf-8'));

// ── EmployeeFaceRegistrationFlow — reuses the enrollment pipeline, never verify/GPS ──

describe('EmployeeFaceRegistrationFlow — enrollment-only, camera-first, no attendance side effects', () => {
  it('submits through useFaceEnrollment bound to the target employee, never useFaceAttendance/useFaceAttendanceFlow', () => {
    expect(registrationFlowCode).toContain('useFaceEnrollment(targetUserId)');
    expect(registrationFlowCode).not.toContain('useFaceAttendance');
    expect(registrationFlowCode).not.toContain('AttendanceService');
    expect(registrationFlowCode).not.toContain('captureLocationWithRetry');
    expect(registrationFlowCode).not.toContain('GPS');
  });

  it('is camera-first with automatic capture, no manual "Capture" step for the admin', () => {
    expect(registrationFlowCode).toContain('autoStart');
    expect(registrationFlowCode).toMatch(/autoCapture=\{!pausedForTerminalError\}/);
  });

  it('reuses the SAME retriable/terminal classification as FaceAttendanceFlow — not a reimplementation', () => {
    expect(registrationFlowCode).toContain("from '../../features/attendance/services/faceCaptureSupport'");
    expect(registrationFlowCode).toContain('isRetriableBiometricErrorCode');
    expect(registrationFlowCode).toContain('describeLiveScanGuidance');
  });

  it('a terminal failure pauses scanning and offers Try Again (via enrollment.reset(), not a page reload)', () => {
    expect(registrationFlowCode).toMatch(/if \(!isRetriableBiometricErrorCode\(enrollment\.errorCode\)\) \{\s*\n\s*setPausedForTerminalError\(true\);/);
    expect(registrationFlowCode).toContain('enrollment.reset()');
  });

  it('shows a distinct success view and calls onSuccess once, matching FaceAttendanceFlow\'s own timing convention', () => {
    expect(registrationFlowCode).toContain("enrollment.status === 'success'");
    expect(registrationFlowCode).toContain('onSuccess?.()');
  });
});

// ── useFaceEnrollment — targetUserId threading, backward-compatible ─────

describe('useFaceEnrollment — optional on-behalf-of targetUserId, self-service default unchanged', () => {
  it('accepts an optional targetUserId parameter', () => {
    expect(useFaceEnrollmentCode).toContain('export function useFaceEnrollment(targetUserId?: string)');
  });

  it('forwards targetUserId in the request body only when provided — omitting it keeps the exact original self-only payload shape', () => {
    expect(useFaceEnrollmentCode).toContain('JSON.stringify(targetUserId ? { image, targetUserId } : { image })');
  });

  it('on success, invalidates the target-specific status query key in addition to the self one, so the Employee View popup refreshes immediately', () => {
    expect(useFaceEnrollmentCode).toContain("qc.invalidateQueries({ queryKey: ['biometricFaceReference'] })");
    expect(useFaceEnrollmentCode).toContain("if (targetUserId) qc.invalidateQueries({ queryKey: ['biometricFaceReference', targetUserId] })");
  });
});

// ── useFaceEnrollmentStatus — targetUserId + enabled gate ────────────────

describe('useFaceEnrollmentStatus — optional targetUserId and enabled gate for a conditionally-open popup', () => {
  it('accepts an optional targetUserId and an enabled override', () => {
    expect(useFaceEnrollmentStatusCode).toContain('export function useFaceEnrollmentStatus(targetUserId?: string, options?: { enabled?: boolean })');
  });

  it('the enabled gate defaults to true (self-service callers everywhere else are unaffected)', () => {
    expect(useFaceEnrollmentStatusCode).toContain('enabled: (options?.enabled ?? true) && !!auth.currentUser');
  });

  it('forwards targetUserId as a query-string parameter, never in a request body', () => {
    expect(useFaceEnrollmentStatusCode).toContain('?targetUserId=${encodeURIComponent(targetUserId)}');
    expect(useFaceEnrollmentStatusCode).not.toMatch(/method:\s*'POST'/);
  });
});

// ── api/biometrics/status.ts — on-behalf-of lookup reuses enroll.ts's exact authorization ──

describe('api/biometrics/status.ts — on-behalf-of status reuses resolveEnrollmentTarget(), no new authorization model', () => {
  it('reads targetUserId from the query string, never the request body', () => {
    expect(statusRouteCode).toContain('req.query.targetUserId');
    expect(statusRouteCode).not.toMatch(/req\.body[^;]*targetUserId/);
  });

  it('imports and calls the SAME resolveEnrollmentTarget() enroll.ts uses — no duplicate/parallel authorization function', () => {
    expect(statusRouteCode).toMatch(/import \{ resolveEnrollmentTarget \} from '\.\.\/_lib\/biometrics\/authorization(?:\.js)?'/);
    expect(statusRouteCode).toContain('resolveEnrollmentTarget(user, requestedTargetUserId,');
  });

  it('reads the reference for the RESOLVED target, not the raw client-supplied id', () => {
    expect(statusRouteCode).toContain('store.getReference(target.targetUserId)');
  });

  it('maps not_authorized/cross_tenant_denied to their correct HTTP statuses, mirroring enroll.ts\'s own REASON_STATUS convention', () => {
    expect(statusRouteCode).toContain('not_authorized: 403');
    expect(statusRouteCode).toContain('cross_tenant_denied: 403');
  });

  // The on-behalf-of role gate was widened by RBAC Master Plan AUTH-D10
  // (commit 38f3077) to also admit GroupAdmin — a false-DENY closure, since
  // GroupAdmin is a same-company scope-extension alias of Admin everywhere
  // else this exact check is made (client/server canDo(), firestore.rules'
  // own biometricCreateAllowed `sameCo` branch). Phase 8 (f53cc18) then
  // added the SAME-GROUP sibling-company branch. This assertion is updated
  // to pin the current, approved gate; the test's purpose is unchanged —
  // status.ts still routes through this ONE authorization function, with no
  // duplicate or weakened parallel path.
  it('status.ts reuses the SAME resolveEnrollmentTarget() gate (Admin/HR/GroupAdmin/SuperAdmin, post-AUTH-D10) — no duplicate or weakened authorization path', () => {
    expect(authorizationCode).toContain("auth.role !== 'Admin' && auth.role !== 'HR' && auth.role !== 'GroupAdmin' && !auth.isSuperAdmin");
    expect(authorizationCode).toContain('crossTenantDenied()');
  });
});

// ── Employees.tsx — Face Registration card wiring ────────────────────────

describe('Employees.tsx — Face Registration is the PRIMARY registration surface in the Employee View popup', () => {
  it('renders a "Face Registration" card in the Employee View popup', () => {
    expect(employeesPageCode).toContain('title="Face Registration"');
  });

  it('checks status for the employee\'s LINKED USER identity (viewItem.userId), never the employees-collection doc id', () => {
    expect(employeesPageCode).toContain('useFaceEnrollmentStatus(viewItem?.userId, { enabled: !!viewItem?.userId })');
  });

  it('gates the Register Face action on the same edit permission used for Edit/Delete Employee elsewhere in this popup — never exposed to a view-only user', () => {
    const cardBlock = employeesPageCode.slice(employeesPageCode.indexOf('title="Face Registration"'), employeesPageCode.indexOf('title="Quick Actions"'));
    expect(cardBlock).toContain("perms.canEdit('employees')");
  });

  it('handles the no-linked-user edge case explicitly rather than crashing or silently misbehaving', () => {
    const cardBlock = employeesPageCode.slice(employeesPageCode.indexOf('title="Face Registration"'), employeesPageCode.indexOf('title="Quick Actions"'));
    expect(cardBlock).toContain('!viewItem.userId');
  });

  it('renders the camera modal at size="lg", matching the desktop Face Attendance camera modal convention', () => {
    const modalBlock = employeesPageCode.slice(employeesPageCode.indexOf('open={faceRegistrationOpen}'), employeesPageCode.indexOf('open={faceRegistrationOpen}') + 300);
    expect(modalBlock).toContain('size="lg"');
  });

  it('closing or completing the detail view also resets the face-registration modal state, so reopening a different employee never shows a stale open camera', () => {
    expect(employeesPageCode).toContain('setFaceRegistrationOpen(false);');
    const closeDetailBlock = employeesPageCode.slice(employeesPageCode.indexOf('function closeDetail()'), employeesPageCode.indexOf('function closeDetail()') + 300);
    expect(closeDetailBlock).toContain('setFaceRegistrationOpen(false)');
  });
});
