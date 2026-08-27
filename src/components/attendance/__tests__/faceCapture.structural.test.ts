/**
 * Face Attendance + DeepFace Master Plan, Phase 7 — source-text structural
 * tests for `FaceCapture.tsx` / `useFaceCapture.ts` / `useFaceEnrollment.ts`
 * / `FaceEnrollmentPanel.tsx`.
 *
 * This repo has no `@testing-library/react` (confirmed: not in
 * `package.json`, no `jsdom`/`happy-dom` test environment configured
 * anywhere) — every UI-tier component test in this codebase is therefore a
 * source-text/structural assertion rather than a render harness, exactly
 * the established convention Master Plan §20 item 6 names explicitly
 * (`customerWorkspaceHeaderCleanup.test.ts` etc.: `readFileSync` + string/
 * regex assertions on the actual component source).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (relPath: string) => readFileSync(join(__dirname, '..', relPath), 'utf-8');
const readHook = (relPath: string) => readFileSync(join(__dirname, '..', '..', '..', 'features', 'attendance', 'hooks', relPath), 'utf-8');

const faceCaptureComponent = read('FaceCapture.tsx');
const faceEnrollmentPanel = read('FaceEnrollmentPanel.tsx');
const useFaceCapture = readHook('useFaceCapture.ts');
const useFaceEnrollment = readHook('useFaceEnrollment.ts');

/** Strips the leading `/** ... *\/` doc comment so assertions about what
 * the CODE does/doesn't do aren't tripped up by prose in the doc comment
 * that legitimately discusses (e.g. explicitly disclaims) the very thing
 * being asserted against. */
function stripLeadingDocComment(source: string): string {
  return source.replace(/^\/\*\*[\s\S]*?\*\/\s*/, '');
}

const faceCaptureCode = stripLeadingDocComment(faceCaptureComponent);
const useFaceEnrollmentCode = stripLeadingDocComment(useFaceEnrollment);

// ── Camera lifecycle / cleanup ──────────────────────────────────────────

describe('useFaceCapture — camera stream cleanup', () => {
  it('stops every MediaStreamTrack in an unmount cleanup effect (camera indicator light must not persist after navigating away)', () => {
    expect(useFaceCapture).toMatch(/useEffect\(\(\) => \{\s*return \(\) => \{[\s\S]{0,80}stopStream/);
    expect(useFaceCapture).toContain('.getTracks().forEach((track) => track.stop())');
  });

  it('revokes the captured-frame object URL on unmount, retake, and cancel — never left dangling', () => {
    const revokeCount = (useFaceCapture.match(/revokePreview\(\)/g) || []).length;
    expect(revokeCount).toBeGreaterThanOrEqual(3); // unmount effect, retake, cancel
    expect(useFaceCapture).toContain('URL.revokeObjectURL');
  });

  it('explicitly stops the stream on cancel(), not just on unmount', () => {
    const cancelFnIdx = useFaceCapture.indexOf('const cancel = useCallback(() => {');
    const cancelBlock = useFaceCapture.slice(cancelFnIdx, cancelFnIdx + 300);
    expect(cancelBlock).toContain('stopStream()');
  });
});

// ── Front-camera-only, never rear/environment ───────────────────────────

describe('useFaceCapture — front camera only', () => {
  it('requests camera access via buildFaceCaptureConstraints() (facingMode: user), never a hardcoded environment constraint', () => {
    expect(useFaceCapture).toContain('buildFaceCaptureConstraints()');
    expect(useFaceCapture).not.toContain('environment');
  });

  it('never reuses DocumentManager.tsx\'s rear-camera capture="environment" input pattern', () => {
    expect(faceCaptureCode).not.toContain('capture="environment"');
    expect(faceCaptureCode).not.toContain("capture='environment'");
    expect(faceCaptureCode).not.toMatch(/from ['"].*DocumentManager['"]/);
  });
});

// ── Security boundary: no direct DeepFace/provider access, one API only ─

describe('FaceCapture / useFaceEnrollment — server boundary respected', () => {
  it('FaceCapture itself never calls fetch or any API endpoint — capture-only, decision-free component', () => {
    expect(faceCaptureComponent).not.toContain('fetch(');
    expect(faceCaptureComponent).not.toContain('/api/');
  });

  it('useFaceEnrollment calls only the existing, already-authorized enrollment endpoint — never DeepFace/the Python service directly', () => {
    expect(useFaceEnrollment).toContain("fetch('/api/biometrics/enroll'");
    expect(useFaceEnrollment).not.toMatch(/DEEPFACE_SERVICE_URL|biometric-service|DeepFaceProvider/);
  });

  it('never creates a second/parallel enrollment endpoint or duplicates server-side authorization logic', () => {
    // Only one endpoint string should ever appear across both files.
    const endpointMatches = [...faceEnrollmentPanel.matchAll(/\/api\/biometrics\/[a-zA-Z-]+/g), ...useFaceEnrollment.matchAll(/\/api\/biometrics\/[a-zA-Z-]+/g)];
    const uniqueEndpoints = new Set(endpointMatches.map((m) => m[0]));
    expect(uniqueEndpoints).toEqual(new Set(['/api/biometrics/enroll']));
  });

  it('sends the request with an Authorization Bearer token, matching api/_lib/auth.ts\'s existing expected mechanism', () => {
    expect(useFaceEnrollment).toContain('Authorization: `Bearer ${idToken}`');
    expect(useFaceEnrollment).toContain('getIdToken()');
  });

  it('self-enrollment only in this phase — never sends a targetUserId (or any other client-chosen identity field) in the request body', () => {
    expect(useFaceEnrollmentCode).not.toContain('targetUserId');
    expect(useFaceEnrollmentCode).not.toMatch(/\bemployeeId\b|\bcompanyId\b|\bgroupId\b|\benrolledBy\b/);
    // The only body field ever sent is the image itself.
    const bodyMatch = useFaceEnrollment.match(/body: JSON\.stringify\(\{([^}]*)\}\)/);
    expect(bodyMatch?.[1].trim()).toBe('image');
  });
});

// ── Privacy: transient handling, no persistence, no logging ─────────────

describe('FaceCapture / useFaceCapture / useFaceEnrollment — privacy (transient image handling)', () => {
  const allSources = [faceCaptureComponent, faceEnrollmentPanel, useFaceCapture, useFaceEnrollment];

  it('never writes to localStorage/sessionStorage/IndexedDB anywhere in the capture/enrollment flow', () => {
    for (const source of allSources) {
      expect(source).not.toContain('localStorage');
      expect(source).not.toContain('sessionStorage');
      expect(source).not.toContain('indexedDB');
    }
  });

  it('never logs the captured image, blob, base64 payload, or embedding to the console', () => {
    for (const source of allSources) {
      expect(source).not.toMatch(/console\.(log|info|warn|error|debug)/);
    }
  });

  it('the base64 conversion happens only inside submitEnrollment(), immediately before the fetch call — never stored in a hook\'s React state', () => {
    // No useState call anywhere in this file holds a base64/data-url value.
    expect(useFaceEnrollment).not.toMatch(/useState.*(base64|dataUrl|Base64)/i);
    const blobToBase64Idx = useFaceEnrollment.indexOf('blobToBase64DataUrl(blob)');
    const fetchIdx = useFaceEnrollment.indexOf("fetch('/api/biometrics/enroll'");
    expect(blobToBase64Idx).toBeGreaterThan(-1);
    expect(fetchIdx).toBeGreaterThan(blobToBase64Idx); // encoded, then immediately sent
  });

  it('useFaceCapture keeps the captured Blob itself (not a base64 string) in state — the base64 string never enters component state at all', () => {
    expect(useFaceCapture).toContain('useState<Blob | null>(null)');
    expect(useFaceCapture).not.toMatch(/useState.*<string.*base64/i);
  });

  it('the duplicate-face warning (Phase 6) is surfaced without ever rendering another employee\'s userId into the DOM', () => {
    expect(faceEnrollmentPanel).not.toContain('suspectedDuplicateOfUserIds[0]');
    expect(faceEnrollmentPanel).not.toMatch(/\{.*suspectedDuplicateOfUserIds.*\}/);
  });
});

// ── Error handling coverage — every server reason surfaced safely ───────

describe('useFaceEnrollment — error handling', () => {
  it('never displays the raw server error.message directly — always routes through describeEnrollmentErrorCode()', () => {
    expect(useFaceEnrollment).toContain('describeEnrollmentErrorCode(code)');
    expect(useFaceEnrollment).not.toMatch(/errorMessage:\s*body\?\.error\?\.message/);
  });

  it('handles a network failure (fetch throwing) as a distinct, safe error rather than an unhandled rejection', () => {
    expect(useFaceEnrollment).toMatch(/catch\s*\{\s*\n\s*throw new FaceEnrollmentError\('NETWORK_ERROR'/);
  });

  it('handles a missing authenticated session before ever attempting the network call', () => {
    expect(useFaceEnrollment).toMatch(/if \(!user\)[\s\S]{0,120}UNAUTHORIZED/);
  });
});

// ── Accessibility ─────────────────────────────────────────────────────

describe('FaceCapture — accessibility', () => {
  it('every status line is announced via role="status" aria-live="polite", not color alone', () => {
    expect(faceCaptureComponent).toContain('role="status"');
    expect(faceCaptureComponent).toContain('aria-live="polite"');
  });

  it('the cancel/close control has an accessible label', () => {
    expect(faceCaptureComponent).toContain('title="Cancel"');
  });

  it('the live camera preview and decorative framing guide are marked appropriately for assistive tech', () => {
    expect(faceCaptureComponent).toContain('aria-label="Live camera preview"');
    expect(faceCaptureComponent).toMatch(/aria-hidden="true"[\s\S]{0,40}<div\s*$|aria-hidden="true"/);
  });

  it('privacy disclosure text is rendered before any camera stream is requested (idle state renders it, not the streaming state)', () => {
    const idleBlockIdx = faceCaptureComponent.indexOf("status === 'idle'");
    const streamingBlockIdx = faceCaptureComponent.indexOf("status === 'streaming'");
    const disclosureIdx = faceCaptureComponent.indexOf('never stored as');
    expect(disclosureIdx).toBeGreaterThan(idleBlockIdx);
    expect(disclosureIdx).toBeLessThan(streamingBlockIdx);
  });

  it('every action button has visible text content, not an icon-only control (except the explicitly-labeled cancel icon button)', () => {
    // Every <Button> usage in the component carries text as JSX children,
    // not an icon-only render — spot-check the key action labels exist as
    // literal text nodes.
    for (const label of ['Start Camera', 'Capture', 'Retake', 'Use This Photo', 'Try Again']) {
      expect(faceCaptureComponent).toContain(label);
    }
  });
});

// ── Cancellation / retry flows ────────────────────────────────────────

describe('FaceCapture — cancellation and retry', () => {
  it('cancel() is wired to both stop the camera and notify the parent via onCancel', () => {
    expect(faceCaptureComponent).toMatch(/function handleCancel\(\)\s*\{\s*cancel\(\);\s*onCancel\?\.\(\);/);
  });

  it('retake and cancel are distinct actions (retake keeps the stream alive, cancel tears it down)', () => {
    expect(useFaceCapture).toContain('const retake = useCallback');
    expect(useFaceCapture).toContain('const cancel = useCallback');
    const retakeIdx = useFaceCapture.indexOf('const retake = useCallback');
    const cancelIdx = useFaceCapture.indexOf('const cancel = useCallback');
    const retakeBlock = useFaceCapture.slice(retakeIdx, cancelIdx);
    expect(retakeBlock).not.toContain('stopStream()');
  });

  it('FaceEnrollmentPanel supports retrying the same captured photo after a server-side rejection, without re-opening the camera', () => {
    expect(faceEnrollmentPanel).toContain('handleRetrySubmit');
    expect(faceEnrollmentPanel).toContain('lastBlobRef');
  });

  it('a duplicate submission is prevented while one is already in flight — the "Use This Photo" / retry controls are disabled during submission', () => {
    expect(faceCaptureComponent).toMatch(/onClick=\{handleUsePhoto\}\s*\n\s*disabled=\{isSubmitting\}/);
    expect(faceCaptureComponent).toMatch(/onClick=\{retake\}\s*\n\s*disabled=\{isSubmitting\}/);
  });
});
