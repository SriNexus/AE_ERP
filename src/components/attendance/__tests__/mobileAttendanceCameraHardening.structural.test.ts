/**
 * Final mobile attendance UX + camera reliability hardening pass —
 * source-text/structural regression tests for the real bug found and fixed
 * this turn (a genuine `srcObject`-attachment race that left the camera
 * preview blank on every platform, not a mobile-Chrome-only quirk — see
 * `useFaceCapture.ts`'s own doc comment for the full trace) and the mobile
 * navigation/manual-attendance changes. Same convention as every other
 * UI-tier test in this codebase (no `@testing-library/react` installed):
 * source-text/structural assertions against the actual shipped code.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const hooksDir = join(__dirname, '..', '..', '..', 'features', 'attendance', 'hooks');
const componentsDir = join(__dirname, '..');
const mobileDir = join(__dirname, '..', '..', 'mobile');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const useFaceCapture = readFileSync(join(hooksDir, 'useFaceCapture.ts'), 'utf-8');
const useFaceCaptureCode = stripComments(useFaceCapture);
const faceCaptureComponent = readFileSync(join(componentsDir, 'FaceCapture.tsx'), 'utf-8');
const faceAttendanceFlow = readFileSync(join(componentsDir, 'FaceAttendanceFlow.tsx'), 'utf-8');
const mobileBottomNav = readFileSync(join(mobileDir, 'shell', 'MobileBottomNav.tsx'), 'utf-8');
const mobileAttendanceWorkspace = readFileSync(join(mobileDir, 'attendance', 'MobileAttendanceWorkspace.tsx'), 'utf-8');
const mobileAttendanceWorkspaceCode = stripComments(mobileAttendanceWorkspace);

// ── The real camera bug: srcObject attached before the <video> element exists ──

describe('useFaceCapture — the srcObject-attachment race is fixed, not worked around with a delay', () => {
  it('the getUserMedia().then() callback no longer assigns videoRef.current.srcObject directly (that assignment always ran before <video> was mounted)', () => {
    const thenIdx = useFaceCaptureCode.indexOf('.then((stream) => {');
    const thenBlockEnd = useFaceCaptureCode.indexOf('.catch(', thenIdx);
    const thenBlock = useFaceCaptureCode.slice(thenIdx, thenBlockEnd);
    expect(thenBlock).not.toContain('videoRef.current.srcObject');
  });

  it('attaches the stream in a separate effect keyed on status, which only runs after React commits the "streaming" render (guaranteeing <video> exists)', () => {
    expect(useFaceCapture).toMatch(/useEffect\(\(\) => \{\s*\n\s*if \(status !== 'streaming'\) return;/);
    expect(useFaceCapture).toContain('video.srcObject = stream;');
  });

  it('calls video.play() as defense-in-depth alongside the autoPlay attribute, swallowing a harmless rejection rather than treating it as a real error', () => {
    expect(useFaceCapture).toMatch(/video\.play\(\)\.catch\(\(\) => \{\}\)/);
  });

  it('the fix does not use setTimeout/a magic delay — it is keyed on real React lifecycle (the status dependency), not fragile timing', () => {
    const effectIdx = useFaceCapture.indexOf("if (status !== 'streaming') return;");
    const surrounding = useFaceCapture.slice(Math.max(0, effectIdx - 200), effectIdx + 200);
    expect(surrounding).not.toContain('setTimeout');
  });

  it('the same effect re-attaches on retake() too (status transitions captured -> streaming again, remounting a fresh <video> element)', () => {
    // The effect is keyed on [status] alone, so it re-runs on every
    // transition INTO 'streaming' — including the one retake() causes —
    // not just the very first one. Documented explicitly, not just implied.
    expect(useFaceCapture).toMatch(/effect runs after React's commit phase[\s\S]{0,300}retake\(\)/);
  });
});

describe('FaceCapture / FaceAttendanceFlow — camera opens immediately, no extra "Start Camera" tap in the real attendance flow', () => {
  it('FaceCapture accepts an autoStart prop, defaulting to false (preserving the original manual-start behavior for any other caller)', () => {
    expect(faceCaptureComponent).toContain('autoStart?: boolean');
    expect(faceCaptureComponent).toContain('autoStart = false');
  });

  it('autoStart triggers start() via useLayoutEffect (not useEffect) so the transient idle/"Start Camera" state is never actually painted', () => {
    expect(faceCaptureComponent).toContain('useLayoutEffect');
    expect(faceCaptureComponent).toMatch(/useLayoutEffect\(\(\) => \{\s*\n\s*if \(autoStart\) start\(\);/);
  });

  it('the auto-start effect has an empty dependency array — fires exactly once per mount, never re-requests the camera on every re-render', () => {
    const idx = faceCaptureComponent.indexOf('if (autoStart) start();');
    const after = faceCaptureComponent.slice(idx, idx + 60);
    expect(after).toMatch(/\},\s*\[\]\)/);
  });

  it('FaceAttendanceFlow passes autoStart to FaceCapture — the real employee flow never requires a redundant manual "Start Camera" tap', () => {
    expect(faceAttendanceFlow).toMatch(/<FaceCapture[\s\S]{0,300}autoStart/);
  });
});

// ── Mobile bottom navigation: Records (2nd) / Create -> immediate camera (3rd) ──

describe('MobileBottomNav — Attendance module 2nd tab is labeled Records, never the camera action', () => {
  it('the /attendance list-tab label is "Records", distinct from the generic "Create" 3rd tab', () => {
    expect(mobileBottomNav).toMatch(/'\/attendance':\s*\{\s*label:\s*'Records'/);
  });
});

describe('MobileAttendanceWorkspace — Create Attendance (3rd nav tab) opens the camera immediately, no intermediate page', () => {
  it('detects ?create=1 (what the 3rd bottom-nav tab navigates to) and renders BEFORE the normal records view', () => {
    const createCheckIdx = mobileAttendanceWorkspace.indexOf("params.get('create') === '1'");
    const normalHeaderIdx = mobileAttendanceWorkspace.indexOf('mobile-attendance-header');
    expect(createCheckIdx).toBeGreaterThan(-1);
    const earlyReturnIdx = mobileAttendanceWorkspace.indexOf('if (isCreateAttendanceRequested)');
    expect(earlyReturnIdx).toBeGreaterThan(-1);
    expect(earlyReturnIdx).toBeLessThan(normalHeaderIdx);
  });

  it('renders FaceAttendanceFlow directly in the create-attendance branch — never a second "Mark Attendance" button the employee must additionally press', () => {
    const branchIdx = mobileAttendanceWorkspace.indexOf('if (isCreateAttendanceRequested)');
    const branchEnd = mobileAttendanceWorkspace.indexOf('\n  return (\n    <div className="space-y-4 pb-2 pt-2">\n      <div className="px-1 pb-1 pt-2">');
    const branch = mobileAttendanceWorkspace.slice(branchIdx, branchEnd);
    expect(branch).toContain('<FaceAttendanceFlow');
    expect(branch).not.toContain('Mark Attendance');
  });

  it('a revoked enrollment blocks the camera in the create-attendance branch too, before FaceAttendanceFlow is ever reached', () => {
    const branchIdx = mobileAttendanceWorkspace.indexOf('if (isCreateAttendanceRequested)');
    const flowIdx = mobileAttendanceWorkspace.indexOf('<FaceAttendanceFlow', branchIdx);
    const revokedCheckIdx = mobileAttendanceWorkspace.indexOf('isEnrollmentRevoked ?', branchIdx);
    expect(revokedCheckIdx).toBeGreaterThan(branchIdx);
    expect(revokedCheckIdx).toBeLessThan(flowIdx);
  });

  it('closing (cancel or success) clears the create param via history replace — returns to the normal records view, never a broken blank page', () => {
    expect(mobileAttendanceWorkspace).toContain('function closeCreateAttendance()');
    expect(mobileAttendanceWorkspace).toMatch(/next\.delete\('create'\)/);
    expect(mobileAttendanceWorkspace).toMatch(/setParams\(next, \{ replace: true \}\)/);
    expect(mobileAttendanceWorkspace).toContain('onCancel={closeCreateAttendance}');
    expect(mobileAttendanceWorkspace).toContain('onSuccess={closeCreateAttendance}');
  });
});

// ── No manual (no-GPS/no-biometric) attendance path anywhere in employee UX ──

describe('No manual attendance option remains in the employee-facing mobile attendance experience', () => {
  it('MobileAttendanceWorkspace no longer imports or renders ManualAttendancePanel in actual code (a doc comment may still name the file to explain why it was removed — checked against code with comments stripped)', () => {
    expect(mobileAttendanceWorkspaceCode).not.toContain('ManualAttendancePanel');
  });

  it('the desktop Attendance.tsx page never had a manual-attendance path either (re-confirmed, not assumed)', () => {
    const attendancePage = stripComments(readFileSync(join(__dirname, '..', '..', '..', 'pages', 'Attendance.tsx'), 'utf-8'));
    expect(attendancePage).not.toContain('ManualAttendancePanel');
    expect(attendancePage).not.toContain('useSelfAttendance');
  });

  it('CheckInPanel (the one attendance action left) never uses AttendanceService.markAttendance() — only the biometric+GPS Face Attendance flow', () => {
    const checkInPanel = stripComments(readFileSync(join(componentsDir, 'CheckInPanel.tsx'), 'utf-8'));
    expect(checkInPanel).not.toContain('markAttendance');
    expect(checkInPanel).not.toContain('useSelfAttendance');
  });
});
