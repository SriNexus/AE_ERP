/**
 * Face Attendance + DeepFace Master Plan, Phase 8 — source-text structural
 * tests for `useFaceAttendance.ts` / `FaceAttendancePanel.tsx` / the
 * biometric additions to `CheckInPanel.tsx`. Same convention as Phase 7's
 * `faceCapture.structural.test.ts` — no `@testing-library/react` in this
 * repo, so UI-tier component logic is verified via source-text/structural
 * assertions against the actual shipped code.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (relPath: string) => readFileSync(join(__dirname, '..', relPath), 'utf-8');
const readHook = (relPath: string) => readFileSync(join(__dirname, '..', '..', '..', 'features', 'attendance', 'hooks', relPath), 'utf-8');

const checkInPanel = read('CheckInPanel.tsx');
const faceAttendancePanel = read('FaceAttendancePanel.tsx');
const useFaceAttendance = readHook('useFaceAttendance.ts');

function stripLeadingDocComment(source: string): string {
  return source.replace(/^\/\*\*[\s\S]*?\*\/\s*/, '');
}
function stripAllBlockComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

const useFaceAttendanceCode = stripLeadingDocComment(useFaceAttendance);

// ── FaceCapture reuse — no duplicated decision logic ────────────────────

describe('FaceAttendancePanel — reuses FaceCapture exactly, adds no biometric decision logic', () => {
  it('imports and renders the existing, generic FaceCapture component rather than a parallel camera implementation', () => {
    expect(faceAttendancePanel).toContain("import FaceCapture from './FaceCapture'");
    expect(faceAttendancePanel).toMatch(/<FaceCapture\b/);
  });

  it('never calls getUserMedia directly — all camera lifecycle stays inside FaceCapture/useFaceCapture', () => {
    expect(faceAttendancePanel).not.toContain('getUserMedia');
    expect(useFaceAttendance).not.toContain('getUserMedia');
  });

  it('never computes or claims a liveness/match/verification verdict itself — no local "verified"/"isLive"/"matched" assignment', () => {
    for (const source of [faceAttendancePanel, useFaceAttendanceCode]) {
      expect(source).not.toMatch(/const\s+(verified|isLive|matched)\s*=\s*(true|false)/);
    }
  });
});

// ── API boundary — exactly one endpoint, no DeepFace, no forged identity ─

describe('useFaceAttendance — server boundary respected', () => {
  it('calls only the existing, already-authorized verification endpoint — never DeepFace/the Python service directly', () => {
    expect(useFaceAttendanceCode).toContain("fetch('/api/biometrics/verify'");
    expect(useFaceAttendanceCode).not.toMatch(/DEEPFACE_SERVICE_URL|biometric-service|DeepFaceProvider/);
  });

  it('never creates a second/parallel verification endpoint', () => {
    const endpointMatches = [...useFaceAttendanceCode.matchAll(/\/api\/biometrics\/[a-zA-Z-]+/g)];
    const uniqueEndpoints = new Set(endpointMatches.map((m) => m[0]));
    expect(uniqueEndpoints).toEqual(new Set(['/api/biometrics/verify']));
  });

  it('sends the request with an Authorization Bearer token, the same established mechanism as enrollment', () => {
    expect(useFaceAttendanceCode).toContain('Authorization: `Bearer ${idToken}`');
    expect(useFaceAttendanceCode).toContain('getIdToken()');
  });

  it('the verify request body carries only the image — no employeeId/userId/companyId/groupId/target field of any kind', () => {
    const bodyMatch = useFaceAttendanceCode.match(/body: JSON\.stringify\(\{([^}]*)\}\)/);
    expect(bodyMatch?.[1].trim()).toBe('image');
    expect(useFaceAttendanceCode).not.toMatch(/\btargetUserId\b|\bemployeeId\b|\bcompanyId\b|\bgroupId\b/);
  });

  it('handles a missing authenticated session before ever attempting the network call', () => {
    expect(useFaceAttendanceCode).toMatch(/if \(!user\)[\s\S]{0,120}UNAUTHORIZED/);
  });

  it('handles a network failure (fetch throwing) as a distinct, safe error rather than an unhandled rejection', () => {
    expect(useFaceAttendanceCode).toMatch(/catch\s*\{\s*\n\s*throw new FaceAttendanceError\('NETWORK_ERROR'/);
  });

  it('never displays a raw server error.message directly — always routes through describeVerificationErrorCode()', () => {
    expect(useFaceAttendanceCode).toContain('describeVerificationErrorCode(code)');
  });
});

// ── Orchestration order — verify MUST pass before GPS/AttendanceService run ─

describe('useFaceAttendance — verify-then-GPS-then-write ordering', () => {
  it('calls the verify API before capturing GPS, and captures GPS before calling AttendanceService — a rejected verification never reaches AttendanceService', () => {
    const verifyIdx = useFaceAttendanceCode.indexOf('callVerifyApi(blob)');
    const gpsIdx = useFaceAttendanceCode.indexOf('captureLocationWithRetry(');
    const attendanceCallIdx = useFaceAttendanceCode.indexOf('AttendanceService.checkIn(location, claim)');
    expect(verifyIdx).toBeGreaterThan(-1);
    expect(gpsIdx).toBeGreaterThan(verifyIdx);
    expect(attendanceCallIdx).toBeGreaterThan(gpsIdx);
  });

  it('GPS is genuinely captured (not skipped/stubbed) on the biometric path — reuses the same captureLocationWithRetry Geo Platform call the GPS-only path uses', () => {
    expect(useFaceAttendanceCode).toContain('captureLocationWithRetry');
    expect(useFaceAttendanceCode).toContain('enableHighAccuracy: true');
  });

  it('calls the EXISTING AttendanceService.checkIn()/checkOut() — never a parallel/duplicate attendance-writing path', () => {
    expect(useFaceAttendanceCode).toContain('AttendanceService.checkIn(location, claim)');
    expect(useFaceAttendanceCode).toContain('AttendanceService.checkOut(location, claim)');
    expect(useFaceAttendanceCode).not.toMatch(/createDocWithId|updateDoc\(/);
  });

  it('passes only a {verificationId} claim to AttendanceService — never a raw verified/liveness boolean, never an identity field', () => {
    expect(useFaceAttendanceCode).toMatch(/const claim: BiometricVerificationClaim = \{ verificationId: verifiedAt \}/);
  });
});

// ── Duplicate-submission / race prevention ───────────────────────────────

describe('FaceAttendancePanel / useFaceAttendance — duplicate submission prevention', () => {
  it('FaceCapture is passed isSubmitting, disabling its own retake/submit controls while a mutation is in flight (same mechanism as FaceEnrollmentPanel, Phase 7)', () => {
    expect(faceAttendancePanel).toContain('isSubmitting={attendance.isSubmitting}');
  });

  it('isSubmitting is derived from the TanStack Query mutation\'s own isPending flag, not a hand-rolled boolean that could desync', () => {
    expect(useFaceAttendanceCode).toContain('isSubmitting: mutation.isPending');
  });
});

// ── Privacy: no persistence, no logging of sensitive data ───────────────

describe('useFaceAttendance / FaceAttendancePanel — privacy', () => {
  it('never writes to localStorage/sessionStorage/IndexedDB', () => {
    for (const source of [faceAttendancePanel, useFaceAttendanceCode]) {
      expect(source).not.toContain('localStorage');
      expect(source).not.toContain('sessionStorage');
      expect(source).not.toContain('indexedDB');
    }
  });

  it('never logs the captured image, blob, base64 payload, or embedding to the console', () => {
    for (const source of [faceAttendancePanel, useFaceAttendanceCode]) {
      expect(source).not.toMatch(/console\.(log|info|warn|error|debug)/);
    }
  });

  it('the base64 conversion happens only inside callVerifyApi(), immediately before the fetch call — never stored in React state', () => {
    expect(useFaceAttendanceCode).not.toMatch(/useState.*(base64|dataUrl|Base64)/i);
    const encodeIdx = useFaceAttendanceCode.indexOf('blobToBase64DataUrl(blob)');
    const fetchIdx = useFaceAttendanceCode.indexOf("fetch('/api/biometrics/verify'");
    expect(encodeIdx).toBeGreaterThan(-1);
    expect(fetchIdx).toBeGreaterThan(encodeIdx);
  });
});

// ── CheckInPanel wiring — Phase 8's additive icon-toggle superseded ──────
// by the product-integration follow-up's single unified action. This
// describe block was rewritten (not merely extended) to match: the
// separate GPS-only Check In/Check Out buttons and the additive biometric
// IconButton toggle no longer exist in CheckInPanel — see
// `faceAttendanceUnifiedFlow.structural.test.ts` for the new single-action
// contract's own dedicated coverage. This block keeps only what remains
// true: DocumentManager is still never referenced.

describe('CheckInPanel — DocumentManager.tsx is never imported or referenced (Phase 8\'s own explicit "must not be changed" line, still true)', () => {
  it('DocumentManager.tsx is never imported or referenced by any of these files', () => {
    for (const source of [checkInPanel, faceAttendancePanel, useFaceAttendanceCode]) {
      expect(source).not.toMatch(/DocumentManager/);
    }
  });
});

// ── AttendanceService.ts — the anti-replay claim validation itself ─────

describe('AttendanceService.ts — Phase 8 biometric claim validation (source-level)', () => {
  const attendanceServiceSource = readFileSync(join(__dirname, '..', '..', '..', 'services', 'AttendanceService.ts'), 'utf-8');
  const code = stripAllBlockComments(attendanceServiceSource);

  it('validates the biometric claim BEFORE any GPS validation step runs, in both checkIn() and checkOut()', () => {
    const checkInIdx = code.indexOf('static async checkIn(');
    const checkInValidateIdx = code.indexOf('await validateBiometricVerificationClaim(user.id, biometric.verificationId);', checkInIdx);
    const checkInGpsIdx = code.indexOf('isValidCoordinate(location.latitude', checkInIdx);
    expect(checkInValidateIdx).toBeGreaterThan(checkInIdx);
    expect(checkInGpsIdx).toBeGreaterThan(checkInValidateIdx);
  });

  it('never silently downgrades an invalid biometric claim to a GPS-only write — it throws', () => {
    const fnIdx = code.indexOf('async function validateBiometricVerificationClaim');
    const fnBlock = code.slice(fnIdx, fnIdx + 900);
    expect(fnBlock).toMatch(/throw invalid\(\)/);
    expect(fnBlock).not.toMatch(/source:\s*['"]gps['"]/);
  });

  it('re-reads the reference via the caller\'s own resolved userId, never a client-supplied field', () => {
    expect(code).toContain('getOne<BiometricFaceReference>(COLLECTIONS.BIOMETRIC_FACE_REFERENCES, userId)');
  });

  it('enforces a freshness window on the claimed lastVerifiedAt, bounding replay of an old verification', () => {
    expect(code).toContain('BIOMETRIC_VERIFICATION_FRESHNESS_MS');
    expect(code).toMatch(/Date\.now\(\) - verifiedAtMs\) > BIOMETRIC_VERIFICATION_FRESHNESS_MS/);
  });

  it('the omitted-biometric-parameter call shape is unchanged — checkIn/checkOut still accept a bare GeoEvidence argument', () => {
    expect(code).toContain('static async checkIn(location: GeoEvidence, biometric?: BiometricVerificationClaim)');
    expect(code).toContain('static async checkOut(location: GeoEvidence, biometric?: BiometricVerificationClaim)');
  });
});
