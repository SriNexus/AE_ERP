/**
 * Geo-Location Platform — a reusable, business-neutral module for GPS
 * capture, reverse geocoding, distance calculation, and geo-fence
 * evaluation.  Lives in src/lib/ to sit alongside other cross-cutting
 * services (storage.ts, auditLogger.ts, permissions.ts).
 *
 * Architecture guarantee (Master Plan §12–§13):
 *   UI → Domain Service → **Geo-Location Platform** → browser / network
 *
 * This module MUST NOT import from any domain module (features/hr,
 * features/attendance, etc.) and MUST NOT contain attendance, employee,
 * warehouse, or company-policy logic.  It provides location primitives
 * only; callers decide what to do with them.
 */

import { useState, useCallback, useRef } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Structurally compatible with the existing SurveyLocation
 * (src/features/surveys/types/index.ts).  The eventual goal is a
 * type-alias from SurveyLocation → GeoEvidence; today both carry the
 * same shape so no migration break is required.
 */
export interface GeoEvidence {
  latitude: number;
  longitude: number;
  /** Horizontal accuracy in metres (from navigator.geolocation). */
  accuracy?: number;
  /** ISO-8601 timestamp of when the coordinates were captured. */
  capturedAt: string;
  /** Best-effort reverse-geocoded human-readable label — never required. */
  address?: string;
}

/** Typed rejection shape for captureLocation(). */
export interface GeoCaptureError {
  /** One of the predefined reason strings (see §16 Error Handling Contract). */
  reason:
    | 'permission_denied'
    | 'position_unavailable'
    | 'timeout'
    | 'unsupported'
    | 'unknown';
}

// ---------------------------------------------------------------------------
// Error message helpers (matching §16 of the Master Plan exactly)
// ---------------------------------------------------------------------------

/** Maps browser GeolocationPositionError codes → user-facing messages. */
export function describeGeolocationError(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return 'Location permission was denied. Enable location access for this site and try again.';
    case err.POSITION_UNAVAILABLE:
      return 'Your device could not determine its location right now. Try again in an open area.';
    case err.TIMEOUT:
      return 'Location capture timed out. Try again — this can take longer indoors or with a weak signal.';
    default:
      return 'Location capture failed. Please try again.';
  }
}

// ---------------------------------------------------------------------------
// Reverse geocoding (relocated verbatim from
//   src/features/surveys/services/reverseGeocode.ts)
// ---------------------------------------------------------------------------

/**
 * Free reverse geocoding via OpenStreetMap Nominatim — no API key.
 * Returns a human-readable address string, or `undefined` on any failure
 * (network error, timeout, rate limit, no match).  **Never throws.**
 */
export async function reverseGeocodeLatLng(
  latitude: number,
  longitude: number,
): Promise<string | undefined> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude))
    return undefined;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=16&addressdetails=1`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return undefined;
    const data = await response.json();
    return typeof data?.display_name === 'string' && data.display_name.trim()
      ? data.display_name.trim()
      : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// GPS Capture — non-hook primitive
// ---------------------------------------------------------------------------

export interface CaptureLocationOptions {
  enableHighAccuracy?: boolean;
  timeoutMs?: number;
}

/**
 * Acquire a GPS fix from the browser.
 * Returns a GeoEvidence on success, or rejects with a typed GeoCaptureError.
 *
 * Reverse geocoding is applied as fire-and-forget enrichment **after**
 * the GeoEvidence is returned — the caller receives the resolved address
 * asynchronously (via the returned promise's GeoEvidence.address field).
 * A reverse-geocode failure never causes captureLocation to reject.
 */
export function captureLocation(
  options?: CaptureLocationOptions,
): Promise<GeoEvidence> {
  return new Promise<GeoEvidence>((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject({ reason: 'unsupported' } satisfies GeoCaptureError);
    }

    const timeoutMs = options?.timeoutMs ?? 15_000;

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const captured: GeoEvidence = {
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy,
          capturedAt: new Date().toISOString(),
        };

        // Best-effort reverse-geocoding enrichment — resolved once,
        // right after capture.  Any failure here leaves `address`
        // unset; the coordinates remain the source of truth.
        void reverseGeocodeLatLng(captured.latitude, captured.longitude)
          .then((address) => {
            if (address) captured.address = address;
            resolve(captured);
          })
          .catch(() => {
            // Reverse geocode failed — still resolve with the
            // captured coordinates; address simply stays undefined.
            resolve(captured);
          });
      },
      (err: GeolocationPositionError) => {
        let reason: GeoCaptureError['reason'];
        switch (err.code) {
          case err.PERMISSION_DENIED:
            reason = 'permission_denied';
            break;
          case err.POSITION_UNAVAILABLE:
            reason = 'position_unavailable';
            break;
          case err.TIMEOUT:
            reason = 'timeout';
            break;
          default:
            reason = 'unknown';
        }
        reject({ reason } satisfies GeoCaptureError);
      },
      { enableHighAccuracy: options?.enableHighAccuracy ?? true, timeout: timeoutMs },
    );
  });
}

// ---------------------------------------------------------------------------
// GPS Capture with Bounded Retry
// ---------------------------------------------------------------------------

export interface CaptureLocationWithRetryOptions extends CaptureLocationOptions {
  /** Target GPS accuracy in meters. Stops retrying early when achieved. */
  targetAccuracyMeters?: number;
  /** Total acquisition window in ms (default 20 000). */
  totalTimeoutMs?: number;
  /** Interval between GPS attempts in ms (default 2 000). */
  retryIntervalMs?: number;
}

/**
 * Bounded GPS retry acquisition (attendance-grade positioning).
 *
 * Unlike `captureLocation()` which makes a single `getCurrentPosition()`
 * call and returns immediately, this function makes *multiple* calls within
 * a bounded time window, tracking the best (lowest-accuracy) reading.
 *
 * Behavior:
 * 1. Requests a fresh high-accuracy position (`maximumAge: 0`).
 * 2. If accuracy meets `targetAccuracyMeters`, resolves immediately.
 * 3. Otherwise, polls every `retryIntervalMs` for a better reading.
 * 4. Stops when either the target accuracy is achieved, or `totalTimeoutMs`
 *    elapses (returning the best reading obtained).
 * 5. Only the final best reading gets reverse-geocoded.
 *
 * Failure conditions (reject immediately, no retry):
 * - navigator.geolocation unavailable → 'unsupported'
 * - permission denied → 'permission_denied'
 *
 * Transient failures (retry):
 * - POSITION_UNAVAILABLE → may improve on next attempt
 * - TIMEOUT on individual attempt → may improve on next attempt
 *
 * @returns The best GeoEvidence obtained within the time window.
 * @rejects GeoCaptureError if no position was ever obtained.
 */
export function captureLocationWithRetry(
  options?: CaptureLocationWithRetryOptions,
): Promise<GeoEvidence> {
  return new Promise<GeoEvidence>((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject({ reason: 'unsupported' } satisfies GeoCaptureError);
    }

    const totalMs = options?.totalTimeoutMs ?? 20_000;
    const intervalMs = options?.retryIntervalMs ?? 2_000;
    const targetAccuracy = options?.targetAccuracyMeters ?? 50;
    const enableHighAcc = options?.enableHighAccuracy ?? true;
    // Individual attempt timeout — generous to allow the device to
    // acquire a satellite lock (indoor / weak signal can be slow).
    const attemptTimeoutMs = Math.min(options?.timeoutMs ?? 10_000, totalMs);

    let bestEvidence: GeoEvidence | null = null;
    let settled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingAttempts = 0;

    const finish = (result?: GeoEvidence) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      clearTimeout(deadlineTimer);

      const evidence = result ?? bestEvidence;
      if (!evidence) {
        return reject({
          reason: bestEvidence ? 'timeout' : 'position_unavailable',
        } satisfies GeoCaptureError);
      }

      // Best-effort reverse-geocoding enrichment on the final best reading.
      void reverseGeocodeLatLng(evidence.latitude, evidence.longitude)
        .then((address) => {
          if (address) evidence.address = address;
        })
        .catch(() => { /* address stays undefined */ })
        .finally(() => resolve(evidence));
    };

    const attempt = () => {
      if (settled) return;
      pendingAttempts++;

      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          if (settled) return;
          pendingAttempts--;

          const captured: GeoEvidence = {
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy: coords.accuracy,
            capturedAt: new Date().toISOString(),
          };

          // Track best reading (lowest accuracy value = most precise).
          if (
            !bestEvidence ||
            (typeof captured.accuracy === 'number' &&
              (typeof bestEvidence.accuracy !== 'number' ||
                captured.accuracy < bestEvidence.accuracy))
          ) {
            bestEvidence = captured;
          }

          // Early exit: target accuracy achieved.
          if (
            typeof captured.accuracy === 'number' &&
            captured.accuracy <= targetAccuracy
          ) {
            finish(captured);
          }
          // Otherwise: wait for next interval or deadline.
        },
        (err: GeolocationPositionError) => {
          pendingAttempts--;
          if (settled) return;

          switch (err.code) {
            case err.PERMISSION_DENIED:
              // Fatal — stop immediately, do not retry, and do not fall
              // back to any partial reading already collected: a denied
              // permission must always surface as 'permission_denied',
              // never masked as a successful resolve or a different
              // rejection reason (settling directly here, bypassing
              // finish()'s bestEvidence logic, avoids both failure modes).
              if (settled) return;
              settled = true;
              clearInterval(timer);
              clearTimeout(deadlineTimer);
              reject({ reason: 'permission_denied' } satisfies GeoCaptureError);
              return;
            case err.POSITION_UNAVAILABLE:
            case err.TIMEOUT:
              // Transient — retry on next interval tick.
              break;
            default:
              break;
          }
          // If no bestEvidence yet and this is the first error, record as pending
          // so finish() knows there was never a successful read.
        },
        {
          enableHighAccuracy: enableHighAcc,
          timeout: attemptTimeoutMs,
          // Force fresh readings — never return a stale cached position.
          maximumAge: 0,
        },
      );
    };

    // Kick off the first attempt immediately.
    attempt();

    // Schedule subsequent attempts at regular intervals.
    timer = setInterval(() => {
      if (settled) {
        clearInterval(timer);
        return;
      }
      attempt();
    }, intervalMs);

    // Hard deadline — stop after totalTimeoutMs.
    deadlineTimer = setTimeout(() => {
      finish();
    }, totalMs);
  });
}

// ---------------------------------------------------------------------------
// useGeoCapture() — React hook wrapping captureLocation()
// ---------------------------------------------------------------------------

export interface UseGeoCaptureOptions {
  enableHighAccuracy?: boolean;
  timeoutMs?: number;
}

export interface UseGeoCaptureResult {
  status: 'idle' | 'capturing' | 'captured' | 'error';
  location?: GeoEvidence;
  /** One of the §16 user-facing messages when status === 'error'. */
  error?: string;
  capture: () => void;
}

/**
 * Reusable GPS-capture hook exposing the three-state UX pattern from
 * SurveyReportForm.tsx (idle → capturing → captured/error).
 *
 * Guards against duplicate rapid captures (double-tap protection).
 */
export function useGeoCapture(
  options?: UseGeoCaptureOptions,
): UseGeoCaptureResult {
  const [status, setStatus] = useState<
    'idle' | 'capturing' | 'captured' | 'error'
  >('idle');
  const [location, setLocation] = useState<GeoEvidence>();
  const [error, setError] = useState<string>();
  const capturingRef = useRef(false);

  const capture = useCallback(() => {
    // Prevent duplicate in-flight captures (mirrors SurveyReportForm's
    // `if (capturingLocation) return;` guard).
    if (capturingRef.current) return;

    capturingRef.current = true;
    setStatus('capturing');
    setError(undefined);

    captureLocation(options)
      .then((loc) => {
        setLocation(loc);
        setStatus('captured');
      })
      .catch((err: GeoCaptureError) => {
        // Map reason → user-facing message (§16)
        setError(describeGeocodeErrorReason(err.reason));
        setStatus('error');
      })
      .finally(() => {
        capturingRef.current = false;
      });
  }, [options]);

  return { status, location, error, capture };
}

/**
 * Maps the typed GeoCaptureError.reason to the exact user-facing message
 * specified by the §16 Error Handling Contract.  The 'unsupported' case
 * reuses SurveyReportForm.tsx's existing exact string.
 */
function describeGeocodeErrorReason(
  reason: GeoCaptureError['reason'],
): string {
  switch (reason) {
    case 'permission_denied':
      return 'Location permission was denied. Enable location access for this site and try again.';
    case 'position_unavailable':
      return 'Your device could not determine its location right now. Try again in an open area.';
    case 'timeout':
      return 'Location capture timed out. Try again — this can take longer indoors or with a weak signal.';
    case 'unsupported':
      return 'GPS is not available on this device.';
    default:
      return 'Location capture failed. Please try again.';
  }
}

// ---------------------------------------------------------------------------
// Geometry — pure functions, no I/O
// ---------------------------------------------------------------------------

/**
 * Haversine distance between two geographic points in metres.
 * Pure function — no Firestore, no network, no UI dependencies.
 */
export function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6_371_000; // Earth mean radius in metres
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Evaluate whether a point falls within a circular geo-fence.
 *
 * Returns `{ withinGeofence: boolean; distanceMeters: number }`.
 *
 * IMPORTANT — deliberate separation of concerns (Master Plan §12):
 *   This function evaluates **only** distance vs. radius.
 *   Accuracy evaluation (GeoEvidence.accuracy vs. a threshold) is the
 *   caller's responsibility (AttendanceService / domain layer), not
 *   folded into this function.  The audit's schema records
 *   `withinGeofence` and `accuracyAccepted` as independent fields;
 *   merging them here would contradict that committed design.
 *
 * Boundary convention: **<=** (exactly at radius boundary = PASS).
 */
export function evaluateGeofence(
  point: { latitude: number; longitude: number },
  center: { latitude: number; longitude: number },
  radiusMeters: number,
): { withinGeofence: boolean; distanceMeters: number } {
  const dist = distanceMeters(point, center);
  return { withinGeofence: dist <= radiusMeters, distanceMeters: dist };
}

/**
 * Human-readable distance label for Attendance evidence display (the
 * "Distance" column/detail, check-in/check-out panels): metres below 1km,
 * kilometres (1 decimal place) at or above it. Returns `undefined` for a
 * missing/invalid value — callers render a neutral placeholder ("—") rather
 * than fabricating a distance for records with no GPS evidence.
 */
export function formatDistanceMeters(meters: number | undefined | null): string | undefined {
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0) return undefined;
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
