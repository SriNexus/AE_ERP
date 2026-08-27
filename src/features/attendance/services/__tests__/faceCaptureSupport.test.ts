/**
 * Face Attendance + DeepFace Master Plan, Phase 7 — `faceCaptureSupport.ts`
 * unit tests. Pure, deterministic, no DOM/React dependency — direct
 * function-level tests, per this repo's own convention for the logic layer
 * behind a UI-tier component (Master Plan §20 item 1's own shape, applied
 * to the frontend capture support module).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  blobToBase64DataUrl,
  buildFaceCaptureConstraints,
  describeEnrollmentErrorCode,
  describeFaceCaptureErrorReason,
  describeVerificationErrorCode,
  isCapturedBlobUsable,
  isGetUserMediaSupported,
  isSecureContextAvailable,
  mapGetUserMediaError,
} from '../faceCaptureSupport';

describe('buildFaceCaptureConstraints', () => {
  it('always requests the front camera, never the rear one, and no audio', () => {
    const constraints = buildFaceCaptureConstraints();
    expect(constraints).toEqual({ video: { facingMode: 'user' }, audio: false });
    expect(JSON.stringify(constraints)).not.toContain('environment');
  });
});

describe('isSecureContextAvailable', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true when window.isSecureContext is true', () => {
    vi.stubGlobal('window', { isSecureContext: true });
    expect(isSecureContextAvailable()).toBe(true);
  });

  it('returns false when window.isSecureContext is false', () => {
    vi.stubGlobal('window', { isSecureContext: false });
    expect(isSecureContextAvailable()).toBe(false);
  });

  it('returns false when window is undefined (non-browser environment)', () => {
    vi.stubGlobal('window', undefined);
    expect(isSecureContextAvailable()).toBe(false);
  });
});

describe('isGetUserMediaSupported', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true when navigator.mediaDevices.getUserMedia exists', () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => Promise.resolve() } });
    expect(isGetUserMediaSupported()).toBe(true);
  });

  it('returns false when navigator.mediaDevices is missing', () => {
    vi.stubGlobal('navigator', {});
    expect(isGetUserMediaSupported()).toBe(false);
  });

  it('returns false when getUserMedia is not a function', () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: undefined } });
    expect(isGetUserMediaSupported()).toBe(false);
  });

  it('returns false when navigator is undefined entirely', () => {
    vi.stubGlobal('navigator', undefined);
    expect(isGetUserMediaSupported()).toBe(false);
  });
});

describe('mapGetUserMediaError', () => {
  it('maps NotAllowedError/PermissionDeniedError/SecurityError to permission_denied', () => {
    expect(mapGetUserMediaError({ name: 'NotAllowedError' })).toBe('permission_denied');
    expect(mapGetUserMediaError({ name: 'PermissionDeniedError' })).toBe('permission_denied');
    expect(mapGetUserMediaError({ name: 'SecurityError' })).toBe('permission_denied');
  });

  it('maps NotFoundError/NotReadableError/OverconstrainedError/AbortError to camera_unavailable', () => {
    expect(mapGetUserMediaError({ name: 'NotFoundError' })).toBe('camera_unavailable');
    expect(mapGetUserMediaError({ name: 'DevicesNotFoundError' })).toBe('camera_unavailable');
    expect(mapGetUserMediaError({ name: 'NotReadableError' })).toBe('camera_unavailable');
    expect(mapGetUserMediaError({ name: 'TrackStartError' })).toBe('camera_unavailable');
    expect(mapGetUserMediaError({ name: 'OverconstrainedError' })).toBe('camera_unavailable');
    expect(mapGetUserMediaError({ name: 'AbortError' })).toBe('camera_unavailable');
  });

  it('maps an unrecognized/unnamed error to unknown', () => {
    expect(mapGetUserMediaError({ name: 'SomeFutureBrowserError' })).toBe('unknown');
    expect(mapGetUserMediaError(new Error('plain error, no name override'))).toBe('unknown');
    expect(mapGetUserMediaError(null)).toBe('unknown');
    expect(mapGetUserMediaError('a string, not an Error object')).toBe('unknown');
  });
});

describe('describeFaceCaptureErrorReason', () => {
  it('returns a distinct, safe, non-empty message for every reason code', () => {
    const reasons = ['unsupported', 'insecure_context', 'permission_denied', 'camera_unavailable', 'capture_failed', 'network_error', 'unknown'] as const;
    const messages = reasons.map(describeFaceCaptureErrorReason);
    expect(new Set(messages).size).toBe(reasons.length); // every reason gets its own message
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(0);
    }
  });
});

describe('isCapturedBlobUsable', () => {
  it('rejects null/undefined', () => {
    expect(isCapturedBlobUsable(null)).toBe(false);
    expect(isCapturedBlobUsable(undefined)).toBe(false);
  });

  it('rejects an empty (zero-byte) blob', () => {
    expect(isCapturedBlobUsable(new Blob([]))).toBe(false);
  });

  it('accepts a non-empty blob', () => {
    expect(isCapturedBlobUsable(new Blob([new Uint8Array([1, 2, 3])]))).toBe(true);
  });
});

describe('blobToBase64DataUrl', () => {
  it('produces a correctly-prefixed data URL with the blob\'s own MIME type', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 255])], { type: 'image/jpeg' });
    const dataUrl = await blobToBase64DataUrl(blob);
    expect(dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('round-trips the exact byte content through base64', async () => {
    const original = new Uint8Array([0, 1, 2, 3, 254, 255, 128, 64]);
    const blob = new Blob([original], { type: 'image/png' });
    const dataUrl = await blobToBase64DataUrl(blob);
    const base64 = dataUrl.split(',')[1];
    const decoded = new Uint8Array(Buffer.from(base64, 'base64'));
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it('falls back to image/jpeg when the blob carries no MIME type', async () => {
    const blob = new Blob([new Uint8Array([1])]);
    const dataUrl = await blobToBase64DataUrl(blob);
    expect(dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
  });
});

describe('describeEnrollmentErrorCode', () => {
  it('maps every real backend reason code (api/biometrics/enroll.ts REASON_STATUS keys, uppercased) to a distinct, safe message', () => {
    const codes = [
      'NO_FACE', 'MULTIPLE_FACES', 'POOR_QUALITY', 'LIVENESS_FAILED', 'NOT_AUTHORIZED',
      'CROSS_TENANT_DENIED', 'ENROLLMENT_REVOKED', 'PERSISTENCE_FAILED', 'MALFORMED_IMAGE',
      'PROVIDER_UNAVAILABLE', 'TIMEOUT',
    ];
    const messages = codes.map(describeEnrollmentErrorCode);
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(0);
      // Never leaks a raw code/internal token into the user-facing string.
      expect(message).not.toMatch(/_/);
    }
  });

  it('maps generic route-level codes (UNAUTHORIZED, RATE_LIMITED) distinctly', () => {
    expect(describeEnrollmentErrorCode('UNAUTHORIZED')).toContain('sign in');
    expect(describeEnrollmentErrorCode('RATE_LIMITED')).toContain('wait');
  });

  it('falls back to a generic, safe message for null/undefined/unrecognized codes — never throws, never echoes the raw code', () => {
    expect(describeEnrollmentErrorCode(null)).toBe('Enrollment failed. Please try again.');
    expect(describeEnrollmentErrorCode(undefined)).toBe('Enrollment failed. Please try again.');
    const unknownMessage = describeEnrollmentErrorCode('SOME_CODE_THAT_DOES_NOT_EXIST');
    expect(unknownMessage).toBe('Enrollment failed. Please try again.');
    expect(unknownMessage).not.toContain('SOME_CODE_THAT_DOES_NOT_EXIST');
  });
});

describe('describeVerificationErrorCode — Phase 8', () => {
  it('maps every real backend verify-endpoint reason code to a distinct, safe message, including the verify-only codes enroll never reaches', () => {
    const codes = [
      'NO_FACE', 'MULTIPLE_FACES', 'POOR_QUALITY', 'LIVENESS_FAILED', 'AMBIGUOUS_MATCH',
      'VERIFICATION_FAILED', 'NOT_AUTHORIZED', 'CROSS_TENANT_DENIED', 'NO_ENROLLMENT',
      'ENROLLMENT_REVOKED', 'PERSISTENCE_FAILED', 'MALFORMED_IMAGE', 'PROVIDER_UNAVAILABLE', 'TIMEOUT',
    ];
    const messages = codes.map(describeVerificationErrorCode);
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toMatch(/_/);
    }
    // Every code maps to ITS OWN distinct message (no accidental collisions).
    expect(new Set(messages).size).toBe(codes.length);
  });

  it('face-mismatch (VERIFICATION_FAILED) and inconclusive-match (AMBIGUOUS_MATCH) get distinct, actionable messages, not a generic fallback', () => {
    expect(describeVerificationErrorCode('VERIFICATION_FAILED')).toContain('did not match');
    expect(describeVerificationErrorCode('AMBIGUOUS_MATCH')).toContain('inconclusive');
  });

  it('no-enrollment gets a distinct, actionable "enroll first" message', () => {
    expect(describeVerificationErrorCode('NO_ENROLLMENT')).toContain('enroll');
  });

  it('falls back to a generic, safe message for null/undefined/unrecognized codes — never throws, never echoes the raw code', () => {
    expect(describeVerificationErrorCode(null)).toBe('Verification failed. Please try again.');
    expect(describeVerificationErrorCode(undefined)).toBe('Verification failed. Please try again.');
    const unknownMessage = describeVerificationErrorCode('SOME_CODE_THAT_DOES_NOT_EXIST');
    expect(unknownMessage).toBe('Verification failed. Please try again.');
    expect(unknownMessage).not.toContain('SOME_CODE_THAT_DOES_NOT_EXIST');
  });
});
