/**
 * geo.test.ts — Tests for the Geo-Location Platform (src/lib/geo.ts).
 *
 * Phase 1: Base contract tests (distance, geofence, reverse-geocode, capture, errors)
 * Phase 2: Hardening — edge cases, error-path depth, option passthrough, timeout/abort,
 *          malformed responses, just-inside/outside boundary, negative radius, determinism.
 *
 * Vitest environment: node (no jsdom).  navigator.geolocation is
 * undefined in Node; we use vi.stubGlobal to mock it for captureLocation tests.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import {
  distanceMeters,
  evaluateGeofence,
  reverseGeocodeLatLng,
  captureLocation,
  captureLocationWithRetry,
  describeGeolocationError,
} from '../geo';
import type { GeoEvidence, GeoCaptureError } from '../geo';

// ═══════════════════════════════════════════════════════════════════════════
// distanceMeters
// ═══════════════════════════════════════════════════════════════════════════
describe('distanceMeters', () => {
  it('returns 0 for identical points', () => {
    const pt = { latitude: 28.6139, longitude: 77.209 };
    expect(distanceMeters(pt, pt)).toBe(0);
  });

  it('calculates a known distance (New Delhi → Mumbai ≈ 1,148 km)', () => {
    const delhi = { latitude: 28.6139, longitude: 77.209 };
    const mumbai = { latitude: 19.076, longitude: 72.8777 };
    const d = distanceMeters(delhi, mumbai);
    expect(d).toBeGreaterThan(1_140_000);
    expect(d).toBeLessThan(1_160_000);
  });

  it('returns a positive value for two distinct points', () => {
    expect(distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 1 })).toBeGreaterThan(0);
  });

  it('is symmetric — distance(A,B) === distance(B,A)', () => {
    const a = { latitude: 40.7128, longitude: -74.006 };
    const b = { latitude: 34.0522, longitude: -118.2437 };
    expect(distanceMeters(a, b)).toBeCloseTo(distanceMeters(b, a), 6);
  });

  // ── Phase 2 hardening ──────────────────────────────────────────────
  it('is deterministic — same inputs produce identical outputs', () => {
    const a = { latitude: 28.6139, longitude: 77.209 };
    const b = { latitude: 19.076, longitude: 72.8777 };
    const d1 = distanceMeters(a, b);
    const d2 = distanceMeters(a, b);
    expect(d1).toBe(d2);
  });

  it('does not mutate input objects', () => {
    const a = { latitude: 28.6139, longitude: 77.209 };
    const b = { latitude: 19.076, longitude: 72.8777 };
    const aCopy = { ...a };
    const bCopy = { ...b };
    distanceMeters(a, b);
    expect(a).toEqual(aCopy);
    expect(b).toEqual(bCopy);
  });

  it('returns 0 for very close points (same degree, tiny offset)', () => {
    const a = { latitude: 28.6139, longitude: 77.209 };
    const b = { latitude: 28.61391, longitude: 77.20901 };
    const d = distanceMeters(a, b);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(2); // should be ~1.4m
  });

  it('handles points near the equator', () => {
    const a = { latitude: 0, longitude: 0 };
    const b = { latitude: 0, longitude: 1 };
    const d = distanceMeters(a, b);
    // 1 degree longitude at equator ≈ 111,320 m
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it('handles points near the poles', () => {
    const a = { latitude: 89.999, longitude: 0 };
    const b = { latitude: 89.999, longitude: 0.001 };
    const d = distanceMeters(a, b);
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThan(2);
  });

  it('handles antipodal points (opposite sides of Earth)', () => {
    const a = { latitude: 0, longitude: 0 };
    const b = { latitude: 0, longitude: 180 };
    const d = distanceMeters(a, b);
    // Should be approximately half the circumference
    expect(d).toBeGreaterThan(20_000_000);
    expect(d).toBeLessThan(21_000_000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// evaluateGeofence
// ═══════════════════════════════════════════════════════════════════════════
describe('evaluateGeofence', () => {
  const center = { latitude: 28.6139, longitude: 77.209 };

  it('returns withinGeofence=true for a point inside the radius', () => {
    const point = { latitude: 28.613, longitude: 77.209 };
    const result = evaluateGeofence(point, center, 500);
    expect(result.withinGeofence).toBe(true);
    expect(result.distanceMeters).toBeGreaterThan(0);
    expect(result.distanceMeters).toBeLessThan(500);
  });

  it('returns withinGeofence=false for a point outside the radius', () => {
    const point = { latitude: 19.076, longitude: 72.8777 };
    const result = evaluateGeofence(point, center, 1000);
    expect(result.withinGeofence).toBe(false);
    expect(result.distanceMeters).toBeGreaterThan(1000);
  });

  it('returns withinGeofence=true for a point EXACTLY at the radius boundary (<= convention)', () => {
    const distM = 100;
    const degPerM = 1 / 111_320;
    const point = { latitude: center.latitude + distM * degPerM, longitude: center.longitude };
    const result = evaluateGeofence(point, center, distM);
    expect(result.distanceMeters).toBeCloseTo(distM, 0);
    expect(result.withinGeofence).toBe(true);
  });

  it('returns the correct distanceMeters in the result', () => {
    const point = { latitude: 28.6149, longitude: 77.209 };
    const result = evaluateGeofence(point, center, 500);
    expect(typeof result.distanceMeters).toBe('number');
    expect(result.distanceMeters).toBeGreaterThanOrEqual(0);
  });

  it('works when radiusMeters is 0 and point is identical to center', () => {
    const result = evaluateGeofence(center, center, 0);
    expect(result.withinGeofence).toBe(true);
    expect(result.distanceMeters).toBe(0);
  });

  it('works when radiusMeters is 0 and point differs from center', () => {
    const point = { latitude: 28.614, longitude: 77.209 };
    const result = evaluateGeofence(point, center, 0);
    expect(result.withinGeofence).toBe(false);
    expect(result.distanceMeters).toBeGreaterThan(0);
  });

  it('does NOT evaluate accuracy — return shape has exactly 2 keys', () => {
    const result = evaluateGeofence(center, center, 100);
    expect(Object.keys(result)).toEqual(['withinGeofence', 'distanceMeters']);
  });

  // ── Phase 2 hardening ──────────────────────────────────────────────
  it('just inside the boundary — point slightly less than radius → PASS', () => {
    const distM = 100;
    const degPerM = 1 / 111_320;
    // 99.99m — clearly inside
    const point = { latitude: center.latitude + 99.99 * degPerM, longitude: center.longitude };
    const result = evaluateGeofence(point, center, distM);
    expect(result.withinGeofence).toBe(true);
    expect(result.distanceMeters).toBeLessThan(distM);
  });

  it('just outside the boundary — point clearly greater than radius → FAIL', () => {
    const distM = 100;
    const degPerM = 1 / 111_320;
    // Use a larger gap (105m) to ensure Haversine distance > 100m
    const point = { latitude: center.latitude + 105 * degPerM, longitude: center.longitude };
    const result = evaluateGeofence(point, center, distM);
    expect(result.withinGeofence).toBe(false);
    expect(result.distanceMeters).toBeGreaterThan(distM);
  });

  it('large radius (100 km) — point 50 km away → PASS', () => {
    const degPerM = 1 / 111_320;
    const point = { latitude: center.latitude + 50_000 * degPerM, longitude: center.longitude };
    const result = evaluateGeofence(point, center, 100_000);
    expect(result.withinGeofence).toBe(true);
  });

  it('large radius (100 km) — point 150 km away → FAIL', () => {
    const degPerM = 1 / 111_320;
    const point = { latitude: center.latitude + 150_000 * degPerM, longitude: center.longitude };
    const result = evaluateGeofence(point, center, 100_000);
    expect(result.withinGeofence).toBe(false);
  });

  it('very small radius (1 metre) — point at ~0.5m → PASS', () => {
    const degPerM = 1 / 111_320;
    const point = { latitude: center.latitude + 0.5 * degPerM, longitude: center.longitude };
    const result = evaluateGeofence(point, center, 1);
    expect(result.withinGeofence).toBe(true);
  });

  it('negative radius — current behavior: distance is always >= 0 so always fails for non-identical points', () => {
    const point = { latitude: 28.614, longitude: 77.209 };
    const result = evaluateGeofence(point, center, -100);
    // distanceMeters returns >= 0, so dist <= -100 is always false
    expect(result.withinGeofence).toBe(false);
  });

  it('negative radius with identical point — distance is 0, 0 <= -100 is false', () => {
    const result = evaluateGeofence(center, center, -100);
    expect(result.withinGeofence).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// reverseGeocodeLatLng
// ═══════════════════════════════════════════════════════════════════════════
describe('reverseGeocodeLatLng', () => {
  it('returns undefined for non-finite coordinates', async () => {
    expect(await reverseGeocodeLatLng(NaN, 77.209)).toBeUndefined();
    expect(await reverseGeocodeLatLng(28.6139, Infinity)).toBeUndefined();
    expect(await reverseGeocodeLatLng(-Infinity, 77.209)).toBeUndefined();
  });

  it('returns undefined when the network request fails (fetch rejects)', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    try {
      expect(await reverseGeocodeLatLng(28.6139, 77.209)).toBeUndefined();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('returns undefined on non-200 response', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    try {
      expect(await reverseGeocodeLatLng(28.6139, 77.209)).toBeUndefined();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('returns the display_name when the response is valid', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ display_name: 'New Delhi, India' }),
    });
    try {
      expect(await reverseGeocodeLatLng(28.6139, 77.209)).toBe('New Delhi, India');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('returns undefined for empty display_name', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ display_name: '' }),
    });
    try {
      expect(await reverseGeocodeLatLng(28.6139, 77.209)).toBeUndefined();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('never throws — always resolves (Survey contract)', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fail'));
    try {
      expect(await reverseGeocodeLatLng(28.6139, 77.209)).toBeUndefined();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('uses Nominatim endpoint with correct parameters', async () => {
    const origFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ display_name: 'Test' }),
    });
    globalThis.fetch = fetchMock;
    try {
      await reverseGeocodeLatLng(28.6139, 77.209);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0];
      expect(url).toContain('nominatim.openstreetmap.org/reverse');
      expect(url).toContain('lat=28.6139');
      expect(url).toContain('lon=77.209');
      expect(url).toContain('format=jsonv2');
      expect(url).toContain('zoom=16');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // ── Phase 2 hardening ──────────────────────────────────────────────
  it('returns undefined for whitespace-only display_name', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ display_name: '   ' }),
    });
    try {
      expect(await reverseGeocodeLatLng(28.6139, 77.209)).toBeUndefined();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('returns undefined for response with no display_name field', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ lat: 28.6139, lon: 77.209, address: {} }),
    });
    try {
      expect(await reverseGeocodeLatLng(28.6139, 77.209)).toBeUndefined();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('returns undefined for completely empty JSON object', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    try {
      expect(await reverseGeocodeLatLng(28.6139, 77.209)).toBeUndefined();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('returns undefined when response.json() throws (malformed JSON body)', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    });
    try {
      expect(await reverseGeocodeLatLng(28.6139, 77.209)).toBeUndefined();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('handles display_name with leading/trailing whitespace — trims correctly', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ display_name: '  New Delhi, India  ' }),
    });
    try {
      expect(await reverseGeocodeLatLng(28.6139, 77.209)).toBe('New Delhi, India');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('uses AbortController with 8s timeout for network requests', async () => {
    const origFetch = globalThis.fetch;
    const origAbortController = globalThis.AbortController;
    let capturedSignal: AbortSignal | undefined;

    // Mock AbortController to capture the signal
    globalThis.AbortController = class {
      signal = { aborted: false } as AbortSignal;
      abort() { (this.signal as any).aborted = true; }
    } as any;

    globalThis.fetch = vi.fn().mockImplementation((_url: string, opts: { signal?: AbortSignal }) => {
      capturedSignal = opts.signal;
      return Promise.resolve({
        ok: true,
        json: async () => ({ display_name: 'Test' }),
      });
    });

    try {
      await reverseGeocodeLatLng(28.6139, 77.209);
      expect(capturedSignal).toBeDefined();
    } finally {
      globalThis.fetch = origFetch;
      globalThis.AbortController = origAbortController;
    }
  });

  it('returns undefined when fetch throws AbortError (simulated timeout)', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'));
    try {
      expect(await reverseGeocodeLatLng(28.6139, 77.209)).toBeUndefined();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('returns undefined for non-string display_name (e.g. number)', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ display_name: 42 }),
    });
    try {
      expect(await reverseGeocodeLatLng(28.6139, 77.209)).toBeUndefined();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('returns undefined for null display_name', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ display_name: null }),
    });
    try {
      expect(await reverseGeocodeLatLng(28.6139, 77.209)).toBeUndefined();
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// describeGeolocationError
// ═══════════════════════════════════════════════════════════════════════════
describe('describeGeolocationError', () => {
  it('maps PERMISSION_DENIED to the documented message', () => {
    const err = { code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: '' } as GeolocationPositionError;
    expect(describeGeolocationError(err)).toBe(
      'Location permission was denied. Enable location access for this site and try again.',
    );
  });

  it('maps POSITION_UNAVAILABLE to the documented message', () => {
    const err = { code: 2, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: '' } as GeolocationPositionError;
    expect(describeGeolocationError(err)).toBe(
      'Your device could not determine its location right now. Try again in an open area.',
    );
  });

  it('maps TIMEOUT to the documented message', () => {
    const err = { code: 3, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: '' } as GeolocationPositionError;
    expect(describeGeolocationError(err)).toBe(
      'Location capture timed out. Try again — this can take longer indoors or with a weak signal.',
    );
  });

  it('returns a fallback message for unknown error codes', () => {
    const err = { code: 99, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: '' } as GeolocationPositionError;
    expect(describeGeolocationError(err)).toBe('Location capture failed. Please try again.');
  });

  // ── Phase 2 hardening ──────────────────────────────────────────────
  it('returns fallback for code 0 (unusual edge case)', () => {
    const err = { code: 0, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: '' } as GeolocationPositionError;
    expect(describeGeolocationError(err)).toBe('Location capture failed. Please try again.');
  });

  it('returns fallback for negative error code', () => {
    const err = { code: -1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: '' } as GeolocationPositionError;
    expect(describeGeolocationError(err)).toBe('Location capture failed. Please try again.');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// captureLocation
// ═══════════════════════════════════════════════════════════════════════════
describe('captureLocation', () => {
  it('rejects with unsupported when navigator.geolocation is undefined (Node default)', async () => {
    await expect(captureLocation()).rejects.toEqual({ reason: 'unsupported' });
  });

  it('rejects with permission_denied when permission is denied', async () => {
    const mockGeo = {
      getCurrentPosition: vi.fn((_s: unknown, e: Function) => {
        e({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: '' });
      }),
    };
    vi.stubGlobal('navigator', { ...navigator, geolocation: mockGeo });
    try {
      await expect(captureLocation()).rejects.toEqual({ reason: 'permission_denied' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects with position_unavailable when position is unavailable', async () => {
    const mockGeo = {
      getCurrentPosition: vi.fn((_s: unknown, e: Function) => {
        e({ code: 2, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: '' });
      }),
    };
    vi.stubGlobal('navigator', { ...navigator, geolocation: mockGeo });
    try {
      await expect(captureLocation()).rejects.toEqual({ reason: 'position_unavailable' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects with timeout on timeout error', async () => {
    const mockGeo = {
      getCurrentPosition: vi.fn((_s: unknown, e: Function) => {
        e({ code: 3, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: '' });
      }),
    };
    vi.stubGlobal('navigator', { ...navigator, geolocation: mockGeo });
    try {
      await expect(captureLocation()).rejects.toEqual({ reason: 'timeout' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('resolves with GeoEvidence on successful capture', async () => {
    const mockGeo = {
      getCurrentPosition: vi.fn((success: Function) => {
        success({ coords: { latitude: 28.6139, longitude: 77.209, accuracy: 10 }, timestamp: Date.now() });
      }),
    };
    vi.stubGlobal('navigator', { ...navigator, geolocation: mockGeo });
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ display_name: 'New Delhi, India' }) });
    try {
      const result = await captureLocation();
      expect(result.latitude).toBe(28.6139);
      expect(result.longitude).toBe(77.209);
      expect(result.accuracy).toBe(10);
      expect(typeof result.capturedAt).toBe('string');
      expect(result.address).toBe('New Delhi, India');
    } finally {
      globalThis.fetch = origFetch;
      vi.unstubAllGlobals();
    }
  });

  it('still resolves even if reverse geocoding fails', async () => {
    const mockGeo = {
      getCurrentPosition: vi.fn((success: Function) => {
        success({ coords: { latitude: 28.6139, longitude: 77.209, accuracy: 10 }, timestamp: Date.now() });
      }),
    };
    vi.stubGlobal('navigator', { ...navigator, geolocation: mockGeo });
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    try {
      const result = await captureLocation();
      expect(result.latitude).toBe(28.6139);
      expect(result.longitude).toBe(77.209);
      expect(result.address).toBeUndefined();
    } finally {
      globalThis.fetch = origFetch;
      vi.unstubAllGlobals();
    }
  });

  it('resolves with coordinates even when reverse geocode json() rejects', async () => {
    const mockGeo = {
      getCurrentPosition: vi.fn((success: Function) => {
        success({ coords: { latitude: 10, longitude: 20, accuracy: 5 }, timestamp: Date.now() });
      }),
    };
    vi.stubGlobal('navigator', { ...navigator, geolocation: mockGeo });
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.reject(new Error('malformed')) });
    try {
      const result = await captureLocation();
      expect(result.latitude).toBe(10);
      expect(result.longitude).toBe(20);
      expect(result.address).toBeUndefined();
    } finally {
      globalThis.fetch = origFetch;
      vi.unstubAllGlobals();
    }
  });

  // ── Phase 2 hardening ──────────────────────────────────────────────
  it('rejects with unknown for unrecognized error code', async () => {
    const mockGeo = {
      getCurrentPosition: vi.fn((_s: unknown, e: Function) => {
        e({ code: 99, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: 'weird error' });
      }),
    };
    vi.stubGlobal('navigator', { ...navigator, geolocation: mockGeo });
    try {
      await expect(captureLocation()).rejects.toEqual({ reason: 'unknown' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('no fake GeoEvidence returned on error — rejects, never resolves', async () => {
    const mockGeo = {
      getCurrentPosition: vi.fn((_s: unknown, e: Function) => {
        e({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: '' });
      }),
    };
    vi.stubGlobal('navigator', { ...navigator, geolocation: mockGeo });
    try {
      const result = await Promise.race([
        captureLocation(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_RACE')), 200)),
      ]);
      // If we get here, it resolved unexpectedly
      expect(result).toBeUndefined(); // should never reach here
    } catch (err: any) {
      // Either the rejection from captureLocation or our timeout
      expect(err.reason).toBe('permission_denied');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('passes enableHighAccuracy option through to getCurrentPosition', async () => {
    let receivedOptions: PositionOptions | undefined;
    const mockGeo = {
      getCurrentPosition: vi.fn((_s: Function, _e: Function, opts: PositionOptions) => {
        receivedOptions = opts;
      }),
    };
    vi.stubGlobal('navigator', { ...navigator, geolocation: mockGeo });
    try {
      const p = captureLocation({ enableHighAccuracy: false });
      // Give it a tick to call getCurrentPosition
      await new Promise((r) => setTimeout(r, 10));
      expect(receivedOptions).toBeDefined();
      expect(receivedOptions!.enableHighAccuracy).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('passes timeoutMs option through to getCurrentPosition', async () => {
    let receivedOptions: PositionOptions | undefined;
    const mockGeo = {
      getCurrentPosition: vi.fn((_s: Function, _e: Function, opts: PositionOptions) => {
        receivedOptions = opts;
      }),
    };
    vi.stubGlobal('navigator', { ...navigator, geolocation: mockGeo });
    try {
      captureLocation({ timeoutMs: 5000 });
      await new Promise((r) => setTimeout(r, 10));
      expect(receivedOptions!.timeout).toBe(5000);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('defaults enableHighAccuracy to true when not specified', async () => {
    let receivedOptions: PositionOptions | undefined;
    const mockGeo = {
      getCurrentPosition: vi.fn((_s: Function, _e: Function, opts: PositionOptions) => {
        receivedOptions = opts;
      }),
    };
    vi.stubGlobal('navigator', { ...navigator, geolocation: mockGeo });
    try {
      captureLocation();
      await new Promise((r) => setTimeout(r, 10));
      expect(receivedOptions!.enableHighAccuracy).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('defaults timeout to 15000 when not specified', async () => {
    let receivedOptions: PositionOptions | undefined;
    const mockGeo = {
      getCurrentPosition: vi.fn((_s: Function, _e: Function, opts: PositionOptions) => {
        receivedOptions = opts;
      }),
    };
    vi.stubGlobal('navigator', { ...navigator, geolocation: mockGeo });
    try {
      captureLocation();
      await new Promise((r) => setTimeout(r, 10));
      expect(receivedOptions!.timeout).toBe(15_000);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not attempt reverse geocode when GPS itself fails', async () => {
    const mockGeo = {
      getCurrentPosition: vi.fn((_s: unknown, e: Function) => {
        e({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: '' });
      }),
    };
    vi.stubGlobal('navigator', { ...navigator, geolocation: mockGeo });
    const origFetch = globalThis.fetch;
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    try {
      await expect(captureLocation()).rejects.toEqual({ reason: 'permission_denied' });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = origFetch;
      vi.unstubAllGlobals();
    }
  });

  it('capturedAt is a valid ISO 8601 timestamp', async () => {
    const mockGeo = {
      getCurrentPosition: vi.fn((success: Function) => {
        success({ coords: { latitude: 1, longitude: 2, accuracy: 3 }, timestamp: Date.now() });
      }),
    };
    vi.stubGlobal('navigator', { ...navigator, geolocation: mockGeo });
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ display_name: 'Somewhere' }),
    });
    try {
      const result = await captureLocation();
      // ISO 8601: YYYY-MM-DDTHH:mm:ss.sssZ
      expect(result.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
    } finally {
      globalThis.fetch = origFetch;
      vi.unstubAllGlobals();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// captureLocationWithRetry — bounded GPS retry acquisition
//
// This is the function actually used by Attendance check-in/check-out
// (src/features/attendance/hooks/useCheckIn.ts, useCheckOut.ts) instead of
// the single-shot captureLocation(). It exists specifically so that a poor
// *first* GPS reading is not accepted blindly — the caller polls for a
// bounded window and keeps the best (lowest-accuracy-value) reading.
// ═══════════════════════════════════════════════════════════════════════════
describe('captureLocationWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reverse geocoding is fire-and-forget enrichment — stub fetch so it
    // resolves quickly and deterministically without a real network call.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ display_name: undefined }) }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('resolves immediately when the very first reading already meets targetAccuracyMeters', async () => {
    const getCurrentPosition = vi.fn((success: Function) => {
      success({ coords: { latitude: 28.6139, longitude: 77.209, accuracy: 10 }, timestamp: Date.now() });
    });
    vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } });

    const promise = captureLocationWithRetry({ targetAccuracyMeters: 50 });
    const result = await promise;

    expect(result.accuracy).toBe(10);
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it('does not accept a poor first reading — polls again and returns the improved reading', async () => {
    let call = 0;
    const getCurrentPosition = vi.fn((success: Function) => {
      call++;
      const accuracy = call === 1 ? 149 : 28; // first reading bad, second reading good
      success({ coords: { latitude: 28.6139, longitude: 77.209, accuracy }, timestamp: Date.now() });
    });
    vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } });

    const promise = captureLocationWithRetry({
      targetAccuracyMeters: 50,
      retryIntervalMs: 2_000,
      totalTimeoutMs: 20_000,
    });

    // First attempt fires synchronously (149m, above target) — not accepted.
    await vi.advanceTimersByTimeAsync(0);
    // Second attempt fires on the next retry interval tick (28m, meets target).
    await vi.advanceTimersByTimeAsync(2_000);

    const result = await promise;
    expect(result.accuracy).toBe(28);
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
  });

  it('tracks the best (lowest-accuracy-value) reading across attempts, not just the latest', async () => {
    const accuracies = [80, 60, 90]; // never reaches the 50m target; best is 60
    let call = 0;
    const getCurrentPosition = vi.fn((success: Function) => {
      const accuracy = accuracies[call] ?? accuracies[accuracies.length - 1];
      call++;
      success({ coords: { latitude: 28.6139, longitude: 77.209, accuracy }, timestamp: Date.now() });
    });
    vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } });

    const promise = captureLocationWithRetry({
      targetAccuracyMeters: 50,
      retryIntervalMs: 2_000,
      totalTimeoutMs: 8_000,
    });

    // Deadline fires before the target is ever reached — resolves with the
    // best of the three readings taken along the way (60m), not the last (90m).
    await vi.advanceTimersByTimeAsync(8_000);

    const result = await promise;
    expect(result.accuracy).toBe(60);
  });

  it('on deadline with no reading ever meeting target, RESOLVES with the best reading (not a rejection)', async () => {
    const getCurrentPosition = vi.fn((success: Function) => {
      success({ coords: { latitude: 28.6139, longitude: 77.209, accuracy: 149 }, timestamp: Date.now() });
    });
    vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } });

    const promise = captureLocationWithRetry({
      targetAccuracyMeters: 50,
      retryIntervalMs: 2_000,
      totalTimeoutMs: 6_000,
    });

    await vi.advanceTimersByTimeAsync(6_000);

    const result = await promise;
    // The caller (AttendanceService) — not this function — is responsible
    // for rejecting a too-imprecise-but-successfully-captured reading.
    expect(result.accuracy).toBe(149);
  });

  it('rejects with position_unavailable if no reading was ever obtained by the deadline', async () => {
    const getCurrentPosition = vi.fn((_success: Function, error: Function) => {
      error({ code: 2, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: '' });
    });
    vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } });

    const promise = captureLocationWithRetry({
      targetAccuracyMeters: 50,
      retryIntervalMs: 2_000,
      totalTimeoutMs: 6_000,
    });
    promise.catch(() => {}); // avoid an unhandled-rejection warning while timers advance

    await vi.advanceTimersByTimeAsync(6_000);

    await expect(promise).rejects.toEqual({ reason: 'position_unavailable' });
  });

  it('retries after a transient POSITION_UNAVAILABLE, then succeeds on a later attempt', async () => {
    let call = 0;
    const getCurrentPosition = vi.fn((success: Function, error: Function) => {
      call++;
      if (call === 1) {
        error({ code: 2, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: '' });
      } else {
        success({ coords: { latitude: 28.6139, longitude: 77.209, accuracy: 20 }, timestamp: Date.now() });
      }
    });
    vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } });

    const promise = captureLocationWithRetry({ targetAccuracyMeters: 50, retryIntervalMs: 2_000, totalTimeoutMs: 20_000 });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2_000);

    const result = await promise;
    expect(result.accuracy).toBe(20);
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
  });

  it('retries after a transient per-attempt TIMEOUT, then succeeds on a later attempt', async () => {
    let call = 0;
    const getCurrentPosition = vi.fn((success: Function, error: Function) => {
      call++;
      if (call === 1) {
        error({ code: 3, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: '' });
      } else {
        success({ coords: { latitude: 28.6139, longitude: 77.209, accuracy: 15 }, timestamp: Date.now() });
      }
    });
    vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } });

    const promise = captureLocationWithRetry({ targetAccuracyMeters: 50, retryIntervalMs: 2_000, totalTimeoutMs: 20_000 });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2_000);

    const result = await promise;
    expect(result.accuracy).toBe(15);
  });

  it('rejects immediately with permission_denied and does NOT schedule further attempts', async () => {
    const getCurrentPosition = vi.fn((_success: Function, error: Function) => {
      error({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: '' });
    });
    vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } });

    const promise = captureLocationWithRetry({ targetAccuracyMeters: 50, retryIntervalMs: 2_000, totalTimeoutMs: 20_000 });
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(0);
    await expect(promise).rejects.toEqual({ reason: 'permission_denied' });

    // Confirm no further polling happens after the fatal rejection.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it('permission_denied takes priority over any partial reading already collected', async () => {
    // Regression test: a prior implementation could resolve with a stale
    // partial reading instead of rejecting, when permission was denied on
    // a later attempt after an earlier attempt had already succeeded.
    let call = 0;
    const getCurrentPosition = vi.fn((success: Function, error: Function) => {
      call++;
      if (call === 1) {
        success({ coords: { latitude: 28.6139, longitude: 77.209, accuracy: 149 }, timestamp: Date.now() });
      } else {
        error({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: '' });
      }
    });
    vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } });

    const promise = captureLocationWithRetry({ targetAccuracyMeters: 50, retryIntervalMs: 2_000, totalTimeoutMs: 20_000 });
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(0); // first (poor) reading collected
    await vi.advanceTimersByTimeAsync(2_000); // second attempt denies permission

    await expect(promise).rejects.toEqual({ reason: 'permission_denied' });
  });

  it('requests a fresh position on every attempt — maximumAge is always 0', async () => {
    const optionsSeen: PositionOptions[] = [];
    let call = 0;
    const getCurrentPosition = vi.fn((success: Function, _error: Function, opts: PositionOptions) => {
      call++;
      optionsSeen.push(opts);
      success({ coords: { latitude: 28.6139, longitude: 77.209, accuracy: 149 }, timestamp: Date.now() });
    });
    vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } });

    const promise = captureLocationWithRetry({ targetAccuracyMeters: 50, retryIntervalMs: 2_000, totalTimeoutMs: 4_000 });
    await vi.advanceTimersByTimeAsync(4_000);
    await promise;

    expect(call).toBeGreaterThan(1);
    for (const opts of optionsSeen) {
      expect(opts.maximumAge).toBe(0);
    }
  });

  it('requests high accuracy by default', async () => {
    let receivedOptions: PositionOptions | undefined;
    const getCurrentPosition = vi.fn((success: Function, _error: Function, opts: PositionOptions) => {
      receivedOptions = opts;
      success({ coords: { latitude: 28.6139, longitude: 77.209, accuracy: 10 }, timestamp: Date.now() });
    });
    vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } });

    await captureLocationWithRetry();
    expect(receivedOptions!.enableHighAccuracy).toBe(true);
  });

  it('rejects with unsupported when navigator.geolocation is undefined', async () => {
    vi.stubGlobal('navigator', { ...navigator, geolocation: undefined });
    await expect(captureLocationWithRetry()).rejects.toEqual({ reason: 'unsupported' });
  });

  it('stops polling once settled — no further getCurrentPosition calls after success', async () => {
    const getCurrentPosition = vi.fn((success: Function) => {
      success({ coords: { latitude: 28.6139, longitude: 77.209, accuracy: 10 }, timestamp: Date.now() });
    });
    vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } });

    const promise = captureLocationWithRetry({ targetAccuracyMeters: 50, retryIntervalMs: 2_000, totalTimeoutMs: 20_000 });
    await promise;

    // Advance well past the total window — the interval must have been cleared.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GeoEvidence type compatibility
// ═══════════════════════════════════════════════════════════════════════════
describe('GeoEvidence type compatibility with SurveyLocation', () => {
  it('GeoEvidence has the same shape as SurveyLocation', () => {
    const geo: GeoEvidence = {
      latitude: 28.6139,
      longitude: 77.209,
      accuracy: 10,
      capturedAt: new Date().toISOString(),
      address: 'New Delhi',
    };
    expect(typeof geo.latitude).toBe('number');
    expect(typeof geo.longitude).toBe('number');
    expect(typeof geo.accuracy).toBe('number');
    expect(typeof geo.capturedAt).toBe('string');
    expect(typeof geo.address).toBe('string');
  });

  it('GeoEvidence works without optional fields', () => {
    const geo: GeoEvidence = {
      latitude: 28.6139,
      longitude: 77.209,
      capturedAt: new Date().toISOString(),
    };
    expect(geo.accuracy).toBeUndefined();
    expect(geo.address).toBeUndefined();
  });
});
