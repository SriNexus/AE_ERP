/**
 * Phase 7 — AttendanceService
 *
 * Domain service for geo-fenced self-service Attendance Check-In.
 * Consumes the Geo-Location Platform (src/lib/geo.ts) and persists
 * check-in evidence on the existing `attendance` Firestore collection.
 *
 * Architecture:
 *   UI → useCheckIn hook → AttendanceService.checkIn()
 *       → captureLocation() (Geo Platform)
 *       → evaluateGeofence() (Geo Platform)
 *       → accuracy policy check (Attendance domain)
 *       → Firestore upsert (attendance document)
 *
 * Source of truth: Master Plan §14, Phase 7 specification, audit §28/§29.
 */

import {
  collection, getDocs, query, where,
} from 'firebase/firestore';
import { db, COLLECTIONS } from '../lib/firebase';
import { getOne, createDocWithId, genId, resolveWriteGroupId } from '../lib/firestore';
import { sanitizePayload } from '../lib/sanitizer';
import { useAppStore } from '../store/useAppStore';
import { evaluateGeofenceWithConfidence, isValidCoordinate, type GeoEvidence } from '../lib/geo';
import { computeStatus, hasEarlyExit, generatePolicyVersion } from '../features/attendance/services/attendanceRuleEngine';
import type {
  AttendanceCheckSubRecord,
  AttendanceRecord,
  AttendanceCheckResult,
  AttendanceCorrection,
  AttendanceSettings,
} from '../features/attendance/types';
import { DEFAULT_ATTENDANCE_SETTINGS } from '../features/attendance/types';
import { normalizeAttendanceSettings } from '../features/settings/attendanceRuntime';
import { loadSettings } from '../features/settings/services/settingsService';
import type { Warehouse } from '../features/warehouses/types';
import type { CompanyConfig } from '../config/company';
import type { BiometricFaceReference } from '../lib/biometrics/biometricFaceReference';

/**
 * Phase 8 (Face Attendance + DeepFace Master Plan §14) — a passing biometric
 * verification's proof-of-freshness, threaded through checkIn()/checkOut()
 * to buildCheckSubRecord(). Optional and additive: omitting this parameter
 * entirely reproduces the exact pre-Phase-8 GPS-only call shape and behavior
 * byte-for-byte.
 */
export interface BiometricVerificationClaim {
  /** Must equal the caller's own `biometric_face_references` document's
   * server-stamped `lastVerifiedAt` value exactly (checked by
   * `validateBiometricVerificationClaim()` below) — never trusted as a bare
   * client assertion. */
  verificationId: string;
}

// ═══════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════

/** Today's date in YYYY-MM-DD format (local timezone) */
function todayDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════════════════════════════

/**
 * Resolve the current user's identity from the Zustand store.
 * Throws if no user is logged in.
 */
function resolveCurrentUser() {
  const state = useAppStore.getState();
  const user = state.user;
  if (!user || !user.id) {
    throw new AttendanceCheckError('not_authenticated', 'You must be signed in to check in.');
  }
  return user;
}

/**
 * Type representing a resolved attendance location (either warehouse or company).
 * Used to distinguish the source for debugging/auditability.
 */
type ResolvedAttendanceLocation = {
  latitude: number;
  longitude: number;
  geofenceRadiusMeters: number;
  name: string;
  address?: string;
  source: 'warehouse' | 'company';
  id: string;
};

/** Join non-empty address parts into one display string ("addr, city, state pincode"). */
function composeAddress(parts: { address?: string; city?: string; state?: string; pincode?: string }): string | undefined {
  const line = [parts.address, parts.city, parts.state].filter(Boolean).join(', ');
  const full = [line, parts.pincode].filter(Boolean).join(' ');
  return full.trim() || undefined;
}

/**
 * Production fix (docs/audits/GEO_ATTENDANCE_CURRENT_STATE_AUDIT.md Finding
 * F1): resolveAttendanceLocation() now distinguishes WHY a location isn't
 * usable instead of collapsing every case to one "no_attendance_location"
 * message — a Warehouse that's missing only its radius is a different,
 * more specific, more actionable problem than an employee with no
 * assignment at all (§12 of the production-fix brief).
 */
type AttendanceLocationResolution =
  | { ok: true; location: ResolvedAttendanceLocation }
  | { ok: false; reason: 'no_assigned_location' }
  | { ok: false; reason: 'location_incomplete'; name: string; missing: string[] }
  | { ok: false; reason: 'location_inactive'; name: string };

/**
 * Check whether a set of geo fields are valid and complete for geofence
 * evaluation. Deliberately kept STRICT — all three fields are required,
 * with no fallback to a company-wide default radius (per the audit's
 * Finding F1: the fix is to make the UI require the radius up front, not
 * to make the attendance engine tolerate an incomplete location — see
 * `AttendanceSettings.geofenceRadiusDefaultMeters`'s updated doc comment
 * in features/attendance/types/index.ts for where that setting's value
 * actually is used instead: pre-filling the *form*, not the runtime).
 */
function hasValidGeo(
  latitude?: number,
  longitude?: number,
  geofenceRadiusMeters?: number,
): boolean {
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    typeof geofenceRadiusMeters === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Number.isFinite(geofenceRadiusMeters) &&
    geofenceRadiusMeters > 0
  );
}

/** Human-readable list of which of the three geo fields are missing/invalid. */
function missingGeoFields(latitude?: number, longitude?: number, geofenceRadiusMeters?: number): string[] {
  const missing: string[] = [];
  if (typeof latitude !== 'number' || !Number.isFinite(latitude)) missing.push('Latitude');
  if (typeof longitude !== 'number' || !Number.isFinite(longitude)) missing.push('Longitude');
  if (typeof geofenceRadiusMeters !== 'number' || !Number.isFinite(geofenceRadiusMeters) || geofenceRadiusMeters <= 0) {
    missing.push('Geofence Radius');
  }
  return missing;
}

/**
 * Resolve the attendance location for the current user.
 *
 * Precedence (Part 4 of the authoritative requirement):
 * 1. Employee/User's assigned Warehouse → if complete valid geo → use it
 * 2. Otherwise → Company fallback → if complete valid geo → use it
 * 3. Otherwise → a specific failure reason (see AttendanceLocationResolution)
 *
 * IMPORTANT: The fallback is ATOMIC. We never mix fields between
 * Warehouse and Company. Either the Warehouse has all three valid
 * geo fields, or we fall back entirely to the Company's geo fields.
 *
 * If the assigned Warehouse exists but is incomplete or inactive, that is
 * reported directly (not silently swallowed into a Company-fallback
 * attempt) — an employee's own assignment being broken is the more
 * actionable, more specific thing to tell them and their admin about.
 */
async function resolveAttendanceLocation(
  warehouseId: string | undefined,
  companyId: string,
): Promise<AttendanceLocationResolution> {
  // ── Step 1: Try warehouse geo ───────────────────────────────
  if (warehouseId) {
    const warehouse = await getOne<Warehouse>(COLLECTIONS.WAREHOUSES, warehouseId).catch(() => null);
    if (warehouse && warehouse.companyId === companyId) {
      const missing = missingGeoFields(warehouse.latitude, warehouse.longitude, warehouse.geofenceRadiusMeters);
      if (missing.length > 0) {
        // Only report "incomplete" (as opposed to falling through to the
        // Company fallback) when there was actually an attempt to
        // configure THIS warehouse's geo-fence — i.e. at least one of the
        // three fields is set. Most warehouses in a tenant were never
        // intended to be attendance locations at all; treating an
        // untouched warehouse's total absence of geo data as a
        // misconfiguration would wrongly block the Company fallback for
        // the (common) case of an employee assigned to a plain,
        // non-attendance warehouse.
        const attempted = typeof warehouse.latitude === 'number' || typeof warehouse.longitude === 'number' || typeof warehouse.geofenceRadiusMeters === 'number';
        if (attempted) {
          return { ok: false, reason: 'location_incomplete', name: warehouse.name, missing };
        }
      } else {
        if (warehouse.status && warehouse.status !== 'Active') {
          return { ok: false, reason: 'location_inactive', name: warehouse.name };
        }
        return {
          ok: true,
          location: {
            latitude: warehouse.latitude!,
            longitude: warehouse.longitude!,
            geofenceRadiusMeters: warehouse.geofenceRadiusMeters!,
            name: warehouse.name,
            address: composeAddress(warehouse),
            source: 'warehouse',
            id: warehouse.id,
          },
        };
      }
    }
    // Warehouse not found, belongs to another company, or was never
    // configured for geo-attendance at all — fall through to the Company
    // fallback rather than reporting on a warehouse the employee can't
    // see the details of anyway.
  }

  // ── Step 2: Fallback to company geo ─────────────────────────
  const company = await getOne<CompanyConfig>(COLLECTIONS.COMPANIES, companyId).catch(() => null);
  if (company) {
    const missing = missingGeoFields(company.latitude, company.longitude, company.geofenceRadiusMeters);
    if (missing.length > 0) {
      // Only report "incomplete" (as opposed to "nothing assigned") when
      // there was actually an attempt to configure the company location —
      // i.e. at least one of the three fields was set. An untouched
      // company with zero geo fields is indistinguishable from "not
      // configured at all", same as "no_assigned_location".
      const attempted = typeof company.latitude === 'number' || typeof company.longitude === 'number' || typeof company.geofenceRadiusMeters === 'number';
      if (attempted) {
        return { ok: false, reason: 'location_incomplete', name: company.name, missing };
      }
    } else {
      if (company.status && company.status !== 'Active') {
        return { ok: false, reason: 'location_inactive', name: company.name };
      }
      return {
        ok: true,
        location: {
          latitude: company.latitude!,
          longitude: company.longitude!,
          geofenceRadiusMeters: company.geofenceRadiusMeters!,
          name: company.name,
          address: composeAddress(company),
          source: 'company',
          id: company.id,
        },
      };
    }
  }

  // ── Step 3: Nothing assigned anywhere ──────────────────────
  return { ok: false, reason: 'no_assigned_location' };
}

/** User-facing message for a resolveAttendanceLocation() failure (§12). */
function describeLocationResolutionFailure(resolution: Extract<AttendanceLocationResolution, { ok: false }>): { reason: string; message: string } {
  switch (resolution.reason) {
    case 'location_incomplete':
      return {
        reason: 'location_incomplete',
        message: `Your attendance location "${resolution.name}" is not fully configured yet — missing: ${resolution.missing.join(', ')}. Ask an administrator to complete its geo-fence setup.`,
      };
    case 'location_inactive':
      return {
        reason: 'location_inactive',
        message: `Attendance location "${resolution.name}" is currently inactive. Ask an administrator to reactivate it or reassign you to an active location.`,
      };
    case 'no_assigned_location':
    default:
      return {
        reason: 'no_assigned_location',
        message: 'No attendance location is assigned to your account, and no company-wide default is configured. Ask an administrator to assign you to a warehouse or configure a Company Attendance Location.',
      };
  }
}

/**
 * Load attendance settings for the current company.
 * Loads attendance settings from the company-scoped Settings section.
 * Falls back to normalized defaults if no settings document exists.
 */
async function loadAttendanceSettings(): Promise<AttendanceSettings> {
  const raw = await loadSettings('attendance');
  return normalizeAttendanceSettings(raw);
}

/**
 * Find the attendance record for the given employee on the given date
 * (defaults to today). Queries the attendance collection with
 * companyId + employeeId + date.
 * Returns null if no record exists for that date.
 */
async function getTodayAttendance(employeeId: string, date: string = todayDate()): Promise<AttendanceRecord | null> {
  const state = useAppStore.getState();
  const companyId = state.user?.companyId || state.activeCompanyId;
  if (!companyId) return null;

  const constraints = [
    where('companyId', '==', companyId),
    where('employeeId', '==', employeeId),
    where('date', '==', date),
  ];
  // GroupAdmin read-provability fix (live-verified 2026-08-21, same class as
  // the companyScopedQuery() attendance fix): company+employeeId alone is
  // provable against isSelfServiceAttendanceWrite (the actor's OWN record —
  // GPS self-service already worked without this), but a GroupAdmin querying
  // a DIFFERENT employee's record (the manualCheckIn/manualCheckOut
  // duplicate-check) can only be granted via groupAdminCanRead(), which
  // depends on resource.data.groupId. Adding the constraint is a harmless
  // no-op for self-service (their own record is groupId-stamped too, see
  // checkIn()'s create branch above).
  if (state.user?.role === 'GroupAdmin') {
    const groupId = resolveWriteGroupId(companyId);
    if (groupId) constraints.push(where('groupId', '==', groupId));
  }

  const q = query(collection(db, COLLECTIONS.ATTENDANCE), ...constraints);

  const snap = await getDocs(q);
  if (snap.empty) return null;

  const doc = snap.docs[0];
  return { ...doc.data(), id: doc.id } as AttendanceRecord;
}

/**
 * Build the immutable check-in/check-out sub-record from GPS evidence +
 * the uncertainty-aware geofence evaluation. Phase 8: an optional `biometric`
 * claim additively stamps `source: 'biometric'` + `biometricVerificationId`
 * instead of the default `source: 'gps'` — every other field (including
 * every GPS/geofence field) is computed identically regardless, since a
 * biometric check-in still captures and validates GPS in full (§12).
 */
function buildCheckSubRecord(
  location: GeoEvidence,
  attLocation: ResolvedAttendanceLocation | undefined,
  geofenceResult: { withinGeofence: boolean; distanceMeters: number; confidence: 'high' | 'medium' | 'low' | 'none'; accuracyUsable: boolean },
  biometric?: BiometricVerificationClaim,
): AttendanceCheckSubRecord {
  return {
    timestamp: new Date().toISOString(),
    location,
    approvedLocationId: attLocation?.id,
    // Denormalized at write time (docs/attendance-page-fix): the detail
    // view must be able to show which Warehouse/Company verified this
    // check-in/out, its saved address, and the radius actually used —
    // without a second Firestore fetch, and without losing the answer if
    // the location is later renamed/reconfigured.
    approvedLocationName: attLocation?.name,
    approvedLocationSource: attLocation?.source,
    approvedLocationAddress: attLocation?.address,
    approvedLocationLatitude: attLocation?.latitude,
    approvedLocationLongitude: attLocation?.longitude,
    geofenceRadiusMeters: attLocation?.geofenceRadiusMeters,
    distanceFromLocationMeters: geofenceResult.distanceMeters,
    withinGeofence: geofenceResult.withinGeofence,
    accuracyAccepted: geofenceResult.accuracyUsable,
    geoConfidence: geofenceResult.confidence,
    source: biometric ? 'biometric' : 'gps',
    ...(biometric ? { biometricVerificationId: biometric.verificationId } : {}),
    deviceInfo: {
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      platform: typeof navigator !== 'undefined' ? navigator.platform : undefined,
    },
  };
}

/**
 * Face Attendance + DeepFace Master Plan §5's threat table, Phase 8:
 * "Stale verification result reused for a later check-in | Verification
 * result is bound to a single attendance write attempt (short-lived
 * server-side token/nonce, consumed once) — not a standing 'verified' flag
 * an employee could reuse hours later."
 *
 * Implemented WITHOUT a new Firestore collection/token store: reuses
 * `biometric_face_references.lastVerifiedAt` — a field only the Admin-SDK
 * verification flow (`api/_lib/biometrics/verification.ts`) can ever set
 * (firestore.rules' `biometricUpdateAllowed()` now forbids ANY client-SDK
 * write to it, Phase 8 addition — see that rule's own doc comment). A
 * caller claiming `source: 'biometric'` must supply the EXACT current value
 * of their own reference's `lastVerifiedAt` as `verificationId`; this
 * function independently re-reads that reference (never trusts the claim)
 * and additionally requires it to be recent (bounds replay — an old,
 * genuinely-passed verification cannot power a check-in/out hours later).
 * Genuine single-use is achieved together with the PRE-EXISTING duplicate
 * check-in/check-out guards (Step 9 of checkIn(), Step 3 of checkOut(),
 * both unchanged) — the same `lastVerifiedAt` claim cannot power two
 * check-ins the same day regardless, since the second attempt is already
 * rejected as `duplicate_check_in`/`duplicate_check_out` before this
 * function's result would even matter.
 *
 * Fails closed: any mismatch, missing reference, revoked reference, or
 * staleness throws — never silently downgrades to `source: 'gps'` (that
 * would misrepresent what actually happened) and never allows the write
 * to proceed unverified.
 */
const BIOMETRIC_VERIFICATION_FRESHNESS_MS = 5 * 60 * 1000; // 5 minutes — provisional, Phase 11 may tune from real usage data, matching this codebase's own established practice of leaving un-benchmarked thresholds explicitly provisional.

async function validateBiometricVerificationClaim(userId: string, verificationId: string): Promise<void> {
  const invalid = () => new AttendanceCheckError(
    'biometric_verification_invalid',
    'Your face verification could not be confirmed or has expired. Please verify your face again.',
  );

  if (!verificationId) throw invalid();

  const reference = await getOne<BiometricFaceReference>(COLLECTIONS.BIOMETRIC_FACE_REFERENCES, userId).catch(() => null);
  if (!reference || reference.status !== 'active') throw invalid();
  if (!reference.lastVerifiedAt || reference.lastVerifiedAt !== verificationId) throw invalid();

  const verifiedAtMs = Date.parse(reference.lastVerifiedAt);
  if (!Number.isFinite(verifiedAtMs) || (Date.now() - verifiedAtMs) > BIOMETRIC_VERIFICATION_FRESHNESS_MS) {
    throw invalid();
  }
}

/** Diagnostic payload logged (console only, never shown to the end user)
 * for every check-in/check-out attempt — §25 of the production-fix brief:
 * developers/admins must be able to tell a GPS failure from a geofence
 * failure from a policy failure from a database failure, without exposing
 * internal details to the employee. */
function logAttendanceDiagnostics(stage: string, detail: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console.info(`[AttendanceService] ${stage}`, detail);
}

// ═══════════════════════════════════════════════════════════════════
// Error types
// ═══════════════════════════════════════════════════════════════════

export class AttendanceCheckError extends Error {
  reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = 'AttendanceCheckError';
    this.reason = reason;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Public service
// ═══════════════════════════════════════════════════════════════════

export class AttendanceService {
  /**
   * Self-service GPS check-in for the current user.
   *
   * Flow (Master Plan §14, revised by the production geofence-accuracy fix
   * — docs/audits/GEO_ATTENDANCE_CURRENT_STATE_AUDIT.md):
   * 1. Resolve current user/employee identity
   * 2. Resolve employee's assigned attendance location (Warehouse → Company)
   *    — a SPECIFIC failure reason if it isn't usable (§12)
   * 3. Load attendance settings
   * 4. Validate the captured coordinates themselves (sanity check)
   * 5. Validate GPS accuracy is usable at all (below the hard ceiling)
   * 6. Validate multi-reading consistency (readingSpreadMeters)
   * 7. Evaluate geofence WITH accuracy folded in as uncertainty, not as a
   *    second independent gate (evaluateGeofenceWithConfidence — this is
   *    the actual fix for the reported ±116m/±50m production bug: distance
   *    and accuracy are combined into one decision, not two separate ones)
   * 8. Evaluate location staleness (capturedAt vs. staleLocationMaxAgeSeconds)
   * 9. Duplicate check (no existing checkIn today)
   * 10. Upsert attendance document (create new or merge onto existing manual record)
   * 11. Return result
   *
   * Blocked attempts (GPS denied, outside geofence, accuracy fail, etc.)
   * produce NO Firestore write — per audit §29.2. A failure AFTER
   * validation passes (the Firestore write itself failing) is reported as
   * its own distinct 'persistence_failed' reason (§12) rather than being
   * indistinguishable from a validation rejection.
   *
   * @param location - GPS evidence from captureLocation()/captureLocationWithRetry()
   * @param biometric - Phase 8, optional: a passing biometric verification's
   *   claim (`{verificationId}`). When provided, independently re-validated
   *   against the caller's own `biometric_face_references` document
   *   (`validateBiometricVerificationClaim()`) BEFORE any GPS step runs —
   *   fails closed on any mismatch/staleness. GPS is still fully captured
   *   and validated exactly as the omitted-parameter (GPS-only) call shape
   *   always has (§12: biometric supplements GPS, never replaces it).
   *   Omitting this parameter entirely reproduces the exact pre-Phase-8
   *   behavior byte-for-byte — every existing caller is unaffected.
   * @returns AttendanceCheckResult with the persisted record or error
   */
  static async checkIn(location: GeoEvidence, biometric?: BiometricVerificationClaim): Promise<AttendanceCheckResult> {
    // ── Step 1: Resolve identity ──────────────────────────────
    const user = resolveCurrentUser();
    const companyId = user.companyId || (useAppStore.getState().activeCompanyId || '');
    if (!companyId) {
      throw new AttendanceCheckError('no_company', 'No company is associated with your account.');
    }

    // ── Step 1.5 (Phase 8): validate the biometric claim, if any ──
    // Runs BEFORE any GPS step — a forged/stale/missing claim fails closed
    // immediately, never falling through to a silent GPS-only check-in.
    if (biometric) {
      await validateBiometricVerificationClaim(user.id, biometric.verificationId);
    }

    // ── Step 2: Resolve attendance location ──────────────────
    // Precedence: Warehouse geo → Company geo → a specific failure reason
    const resolution = await resolveAttendanceLocation(user.warehouseId, companyId);
    if (!resolution.ok) {
      const { reason, message } = describeLocationResolutionFailure(resolution);
      logAttendanceDiagnostics('checkIn:location_unresolved', { userId: user.id, warehouseId: user.warehouseId, reason });
      throw new AttendanceCheckError(reason, message);
    }
    const attLocation = resolution.location;

    // ── Step 3: Load settings ─────────────────────────────────
    const settings = await loadAttendanceSettings();

    // ── Step 4: Validate captured coordinates ─────────────────
    if (!isValidCoordinate(location.latitude, location.longitude)) {
      throw new AttendanceCheckError(
        'invalid_coordinates',
        'Your device reported a location that could not be verified. Please try again.',
      );
    }

    // ── Step 5: Validate accuracy is usable at all ────────────
    // A hard ceiling, independent of distance — a reading this poor
    // provides no useful signal for ANY reasonably-sized geofence, so it
    // is rejected outright rather than fed into the uncertainty math.
    // Below the ceiling, accuracy is no longer an independent gate — it
    // becomes uncertainty folded into Step 7's geofence decision.
    if (
      typeof location.accuracy !== 'number' ||
      !Number.isFinite(location.accuracy) ||
      location.accuracy <= 0 ||
      location.accuracy > settings.gpsAccuracyCeilingMeters
    ) {
      const accuracyVal = typeof location.accuracy === 'number' && Number.isFinite(location.accuracy)
        ? Math.round(location.accuracy) : undefined;
      throw new AttendanceCheckError(
        'gps_unusable',
        accuracyVal === undefined
          ? "We couldn't get a reliable enough location to verify attendance. Your device did not report a GPS accuracy value. Try: turn on precise/high-accuracy location, move outdoors or near a window, keep your phone still, and try again."
          : `We couldn't get a reliable enough location to verify attendance. Current GPS accuracy: ±${accuracyVal}m (device limit: ±${settings.gpsAccuracyCeilingMeters}m). Try: turn on precise/high-accuracy location, move outdoors or near a window, keep your phone still for a few seconds, and make sure browser location permission is allowed.`,
      );
    }

    // ── Step 6: Validate multi-reading consistency ────────────
    // If captureLocationWithRetry() collected more than one reading and
    // they disagree with each other by more than a sane amount, the
    // device's own GPS is jittering — a distinct problem from "accuracy
    // is poor" (a single stable-but-imprecise reading is fine; readings
    // that jump around are not).
    if (
      typeof location.readingSpreadMeters === 'number' &&
      Number.isFinite(location.readingSpreadMeters) &&
      location.readingSpreadMeters > settings.locationConsistencyMaxSpreadMeters
    ) {
      throw new AttendanceCheckError(
        'location_inconsistent',
        `Your device reported inconsistent location readings (moved by ~${Math.round(location.readingSpreadMeters)}m between attempts), so we couldn't verify your attendance location reliably. Please try again while keeping your phone still, ideally outdoors.`,
      );
    }

    // ── Step 7: Evaluate geofence + accuracy-as-uncertainty ───
    const point = { latitude: location.latitude, longitude: location.longitude };
    const center = { latitude: attLocation.latitude, longitude: attLocation.longitude };
    const geoResult = evaluateGeofenceWithConfidence(
      point, center, attLocation.geofenceRadiusMeters, location.accuracy, settings.gpsAccuracyCeilingMeters,
    );

    if (!geoResult.withinGeofence) {
      logAttendanceDiagnostics('checkIn:outside_geofence', {
        userId: user.id, locationId: attLocation.id, distanceMeters: geoResult.distanceMeters,
        configuredRadius: attLocation.geofenceRadiusMeters, accuracy: location.accuracy,
      });
      throw new AttendanceCheckError(
        'outside_geofence',
        `You appear to be outside the allowed attendance area for ${attLocation.name} (~${Math.round(geoResult.distanceMeters)}m away, allowed ${attLocation.geofenceRadiusMeters}m, GPS accuracy ±${Math.round(location.accuracy)}m).`,
      );
    }

    // ── Step 8: Evaluate location staleness ───────────────────
    // Reject evidence that is not actually fresh by the time it reaches
    // the server (clock skew tolerated; genuinely old readings are not),
    // per Settings' staleLocationMaxAgeSeconds (Master Plan §18).
    const capturedAtMs = Date.parse(location.capturedAt);
    const ageSeconds = Number.isFinite(capturedAtMs)
      ? (Date.now() - capturedAtMs) / 1000
      : Number.POSITIVE_INFINITY;
    if (ageSeconds > settings.staleLocationMaxAgeSeconds) {
      throw new AttendanceCheckError(
        'stale_location',
        'Your location reading is too old to check in with. Please capture your location again and try immediately.',
      );
    }

    // ── Step 9: Duplicate check ───────────────────────────────
    const existing = await getTodayAttendance(user.id);
    if (existing?.checkIn) {
      throw new AttendanceCheckError(
        'duplicate_check_in',
        `You've already checked in today at ${new Date(existing.checkIn.timestamp).toLocaleTimeString()}.`,
      );
    }

    // ── Step 10: Build check-in sub-record ────────────────────
    const checkInRecord = buildCheckSubRecord(location, attLocation, geoResult, biometric);

    // ── Step 11: Upsert attendance document ───────────────────
    let record: AttendanceRecord;

    try {
      if (existing) {
        // Merge checkIn onto existing document (manual record or empty record)
        // This handles the "HR pre-marked status, employee then checks in" case
        // Phase 9 (DI-02 sweep): checkInRecord carries several optional
        // approvedLocation*/deviceInfo fields (attLocation?.x — undefined
        // when no configured location matched) that reach this RAW updateDoc()
        // unsanitized, unlike the sibling create branch below (which already
        // goes through createDocWithId's own sanitizePayload()). A real,
        // live-reproducible undefined-reaches-Firestore case, not latent.
        await import('firebase/firestore').then(({ updateDoc, doc: docRef }) =>
          updateDoc(docRef(db, COLLECTIONS.ATTENDANCE, existing.id), sanitizePayload({
            checkIn: checkInRecord,
            updatedAt: new Date().toISOString(),
          }) as any),
        );
        record = { ...existing, checkIn: checkInRecord };
      } else {
        // Create new attendance document for today
        const id = genId.generic('ATT');
        const newDoc: Record<string, unknown> = {
          id,
          companyId,
          groupId: resolveWriteGroupId(companyId),
          employeeId: user.id,
          employee: user.name || user.displayName || '',
          date: todayDate(),
          checkIn: checkInRecord,
          createdBy: user.id,
        };
        await createDocWithId(COLLECTIONS.ATTENDANCE, id, newDoc as any);
        record = newDoc as unknown as AttendanceRecord;
      }
    } catch (err) {
      logAttendanceDiagnostics('checkIn:persistence_failed', { userId: user.id, error: err instanceof Error ? err.message : String(err) });
      throw new AttendanceCheckError(
        'persistence_failed',
        'Your location was verified, but we could not save your attendance. Please check your connection and try again.',
      );
    }

    return { success: true, record };
  }

  /**
   * Self-service GPS check-out for the current user.
   *
   * Flow (Master Plan Phase 8):
   * 1. Resolve current user/employee identity
   * 2. Load today's attendance document
   * 3. Confirm checkIn exists, checkOut does NOT exist
   * 4. Resolve the ORIGINAL check-in Warehouse (from checkIn.approvedLocationId)
   * 5. Capture GPS + evaluate geofence + accuracy (but DO NOT BLOCK on failure)
   * 6. Compute workingHours (in HOURS, not minutes)
   * 7. Update the existing attendance document (checkOut + workingHours only)
   * 8. Return result
   *
   * CRITICAL DESIGN DECISION (Master Plan §14/Phase 8):
   * Checkout does NOT block on geofence/accuracy failure.
   * Outside-geofence checkout SUCCEEDS but is FLAGGED.
   * This is a deliberate asymmetry with check-in.
   *
   * @param location - GPS evidence from captureLocation()
   * @param biometric - Phase 8, optional: see checkIn()'s own doc comment —
   *   identical semantics, independently validated here too (checkOut() is
   *   a separate biometric verification event from checkIn(), per §12's
   *   flow — each attendance action gets its own fresh claim).
   * @returns AttendanceCheckResult with the persisted record or error
   */
  static async checkOut(location: GeoEvidence, biometric?: BiometricVerificationClaim): Promise<AttendanceCheckResult> {
    // ── Step 1: Resolve identity ──────────────────────────────
    const user = resolveCurrentUser();

    // ── Step 1.5 (Phase 8): validate the biometric claim, if any ──
    if (biometric) {
      await validateBiometricVerificationClaim(user.id, biometric.verificationId);
    }

    // ── Step 2: Load today's attendance ───────────────────────
    const existing = await getTodayAttendance(user.id);
    if (!existing) {
      throw new AttendanceCheckError(
        'no_check_in',
        'You have not checked in today. Please check in first.',
      );
    }

    // ── Step 3: Validate check-in state ───────────────────────
    if (!existing.checkIn) {
      throw new AttendanceCheckError(
        'no_check_in',
        'You have not checked in today. Please check in first.',
      );
    }
    if (existing.checkOut) {
      throw new AttendanceCheckError(
        'duplicate_check_out',
        `You've already checked out today at ${new Date(existing.checkOut.timestamp).toLocaleTimeString()}.`,
      );
    }

    // ── Step 4: Resolve ORIGINAL check-in location ───────────
    // Master Plan: use the location from the original check-in,
    // not the current assignment, for consistent daily evidence.
    const originalLocationId = existing.checkIn.approvedLocationId;
    let attLoc: ResolvedAttendanceLocation | null = null;
    if (originalLocationId) {
      // Try to resolve as warehouse first
      const origWarehouse = await getOne<Warehouse>(COLLECTIONS.WAREHOUSES, originalLocationId).catch(() => null);
      if (origWarehouse && hasValidGeo(origWarehouse.latitude, origWarehouse.longitude, origWarehouse.geofenceRadiusMeters)) {
        attLoc = {
          latitude: origWarehouse.latitude!,
          longitude: origWarehouse.longitude!,
          geofenceRadiusMeters: origWarehouse.geofenceRadiusMeters!,
          name: origWarehouse.name,
          address: composeAddress(origWarehouse),
          source: 'warehouse',
          id: origWarehouse.id,
        };
      } else {
        // Try as company (original location might have been a company fallback)
        const origCompany = await getOne<CompanyConfig>(COLLECTIONS.COMPANIES, originalLocationId).catch(() => null);
        if (origCompany && hasValidGeo(origCompany.latitude, origCompany.longitude, origCompany.geofenceRadiusMeters)) {
          attLoc = {
            latitude: origCompany.latitude!,
            longitude: origCompany.longitude!,
            geofenceRadiusMeters: origCompany.geofenceRadiusMeters!,
            name: origCompany.name,
            address: composeAddress(origCompany),
            source: 'company',
            id: origCompany.id,
          };
        }
      }
    }
    // Fallback: if original location not found, try current user's location
    if (!attLoc) {
      const currentUser = resolveCurrentUser();
      const companyId = currentUser.companyId || (useAppStore.getState().activeCompanyId || '');
      if (companyId) {
        const resolution = await resolveAttendanceLocation(currentUser.warehouseId, companyId);
        if (resolution.ok) attLoc = resolution.location;
      }
    }

    // ── Step 5: Evaluate geofence + accuracy (DO NOT BLOCK) ───
    // Master Plan: checkout outside geofence = FLAG, not BLOCK. Uses the
    // same uncertainty-aware evaluation as check-in (accuracy folded in as
    // uncertainty, not a separate gate) purely for a more meaningful flag —
    // checkout still never throws on a poor/outside reading.
    let withinGeofence = false;
    let distanceMeters = 0;
    let accuracyAccepted = false;
    let confidence: 'high' | 'medium' | 'low' | 'none' = 'none';
    const locationForRecord: GeoEvidence = location;

    if (attLoc && isValidCoordinate(location.latitude, location.longitude)) {
      const point = { latitude: location.latitude, longitude: location.longitude };
      const center = { latitude: attLoc.latitude, longitude: attLoc.longitude };

      const settings = await loadAttendanceSettings();
      const geoResult = evaluateGeofenceWithConfidence(point, center, attLoc.geofenceRadiusMeters, location.accuracy, settings.gpsAccuracyCeilingMeters);
      withinGeofence = geoResult.withinGeofence;
      distanceMeters = geoResult.distanceMeters;
      accuracyAccepted = geoResult.accuracyUsable;
      confidence = geoResult.confidence;
    }
    // If no location resolved, we still proceed — checkout is not blocked.
    // locationForRecord remains the captured GPS evidence.

    // ── Step 6: Compute workingHours (in HOURS) ───────────────
    const checkInTime = new Date(existing.checkIn.timestamp).getTime();
    const checkOutTime = new Date().getTime();
    const workingHours = Math.max(0, (checkOutTime - checkInTime) / (1000 * 60 * 60));

    // ── Step 7: Build check-out sub-record ────────────────────
    const checkOutRecord: AttendanceCheckSubRecord = {
      timestamp: new Date().toISOString(),
      location: locationForRecord || existing.checkIn.location, // use captured GPS or fallback to check-in location
      approvedLocationId: attLoc?.id,
      approvedLocationName: attLoc?.name,
      approvedLocationSource: attLoc?.source,
      approvedLocationAddress: attLoc?.address,
      approvedLocationLatitude: attLoc?.latitude,
      approvedLocationLongitude: attLoc?.longitude,
      geofenceRadiusMeters: attLoc?.geofenceRadiusMeters,
      distanceFromLocationMeters: distanceMeters || undefined,
      withinGeofence,
      accuracyAccepted,
      geoConfidence: confidence,
      source: biometric ? 'biometric' : 'gps',
      ...(biometric ? { biometricVerificationId: biometric.verificationId } : {}),
      deviceInfo: {
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        platform: typeof navigator !== 'undefined' ? navigator.platform : undefined,
      },
    };

    // ── Step 8: Compute status via Rule Engine (Phase 9) ──────
    const settings = await loadAttendanceSettings();
    const policyVersion = generatePolicyVersion(settings);
    const workingHoursRounded = Math.round(workingHours * 100) / 100;

    // Build a record with the new checkout data for the Rule Engine
    const recordForEngine: AttendanceRecord = {
      ...existing,
      checkOut: checkOutRecord,
      workingHours: workingHoursRounded,
    };
    const computedStatus = computeStatus(recordForEngine, settings);

    // Phase 11: compute earlyExit flag independently of computedStatus.
    // When both Late and EarlyExit co-occur, computedStatus = 'Late'
    // (Phase 9 precedence) but earlyExit = true preserves both facts.
    const earlyExitResult = hasEarlyExit(recordForEngine, settings);

    // ── Step 9: Update the existing attendance document ────────
    // Update checkOut + workingHours + computedStatus + earlyExit + policyVersion.
    // Do NOT touch checkIn or manual status fields.
    const updateData: Record<string, unknown> = {
      checkOut: checkOutRecord,
      workingHours: workingHoursRounded,
      earlyExit: earlyExitResult,
      updatedAt: new Date().toISOString(),
    };
    if (computedStatus) {
      updateData.computedStatus = computedStatus;
      updateData.policyVersion = policyVersion;
    }
    try {
      // Phase 9 (DI-02 sweep): checkOutRecord carries the same optional
      // approvedLocation*/deviceInfo/distanceFromLocationMeters fields as
      // checkInRecord — sanitize before this RAW updateDoc().
      await import('firebase/firestore').then(({ updateDoc, doc: docRef }) =>
        updateDoc(docRef(db, COLLECTIONS.ATTENDANCE, existing.id), sanitizePayload(updateData) as any),
      );
    } catch (err) {
      logAttendanceDiagnostics('checkOut:persistence_failed', { userId: user.id, error: err instanceof Error ? err.message : String(err) });
      throw new AttendanceCheckError(
        'persistence_failed',
        'Your location was recorded, but we could not save your check-out. Please check your connection and try again.',
      );
    }

    const record: AttendanceRecord = {
      ...existing,
      checkOut: checkOutRecord,
      workingHours: workingHoursRounded,
      earlyExit: earlyExitResult,
      ...(computedStatus ? { computedStatus, policyVersion } : {}),
    };

    return { success: true, record };
  }

  /**
   * Get today's attendance record for the current user.
   * Used by the UI to determine check-in state (already checked in? etc.)
   */
  static async getTodayAttendanceForCurrentUser(): Promise<AttendanceRecord | null> {
    const user = resolveCurrentUser();
    return getTodayAttendance(user.id);
  }

  /**
   * Employee-facing "Manual Attendance" — a single-click self-service action
   * with no location capture. There is no employee/date/time selection: the
   * current user, the current instant, and whichever half of today's
   * check-in/check-out pair is still missing are all derived automatically.
   * First call of the day performs Check In; the next performs Check Out;
   * once both exist, it refuses (no third action).
   *
   * This is NOT an admin-targeting form — it can only ever act on the
   * calling identity's own attendance (same identity anchor as checkIn()/
   * checkOut() below: resolveCurrentUser()). An Admin/GroupAdmin managing
   * OTHER employees' historical attendance is a separate, not-yet-built
   * capability (Master Plan note, 2026-08-21) — deliberately not mixed in
   * here.
   *
   * Shares the exact identity resolution (getTodayAttendanceForCurrentUser,
   * itself built on the same getTodayAttendance() the GPS path uses),
   * document shape, and rule-engine invocation the GPS self-service
   * checkIn()/checkOut() above use — the only difference is no location
   * evidence is captured or validated (source: 'manual_admin' instead of
   * 'gps', geofence/accuracy fields default to false/not-applicable).
   */
  static async markAttendance(): Promise<AttendanceCheckResult & { action: 'checkIn' | 'checkOut' }> {
    const user = resolveCurrentUser();
    const companyId = user.companyId || (useAppStore.getState().activeCompanyId || '');
    if (!companyId) {
      throw new AttendanceCheckError('no_company', 'No company is associated with your account.');
    }

    const existing = await AttendanceService.getTodayAttendanceForCurrentUser();

    if (existing?.checkIn && existing?.checkOut) {
      throw new AttendanceCheckError(
        'already_completed',
        `You've already completed attendance for today — checked in at ${new Date(existing.checkIn.timestamp).toLocaleTimeString()} and checked out at ${new Date(existing.checkOut.timestamp).toLocaleTimeString()}.`,
      );
    }

    const now = new Date().toISOString();

    // ── No check-in yet today: this click performs Check In ────
    if (!existing?.checkIn) {
      const checkInRecord: AttendanceCheckSubRecord = {
        timestamp: now,
        withinGeofence: false,
        accuracyAccepted: false,
        source: 'manual_admin',
      };

      let record: AttendanceRecord;
      if (existing) {
        // Merge onto an existing (e.g. status-only, pre-Phase-6) record.
        // Phase 9 (DI-02 sweep): sanitize for consistency with the other
        // checkIn/checkOut merge sites — this literal is currently fully
        // specified (manual_admin path, no attLocation?. fields), so it is
        // latent-only today, but the wrap is defense-in-depth per the same
        // reasoning as bootstrapCompany's fix.
        await import('firebase/firestore').then(({ updateDoc, doc: docRef }) =>
          updateDoc(docRef(db, COLLECTIONS.ATTENDANCE, existing.id), sanitizePayload({
            checkIn: checkInRecord,
            updatedAt: new Date().toISOString(),
          }) as any),
        );
        record = { ...existing, checkIn: checkInRecord };
      } else {
        const id = genId.generic('ATT');
        const newDoc: Record<string, unknown> = {
          id,
          companyId,
          groupId: resolveWriteGroupId(companyId),
          employeeId: user.id,
          employee: user.name || user.displayName || '',
          date: todayDate(),
          checkIn: checkInRecord,
          createdBy: user.id,
        };
        await createDocWithId(COLLECTIONS.ATTENDANCE, id, newDoc as any);
        record = newDoc as unknown as AttendanceRecord;
      }

      return { success: true, record, action: 'checkIn' };
    }

    // ── Checked in, not checked out: this click performs Check Out ─
    const checkOutRecord: AttendanceCheckSubRecord = {
      timestamp: now,
      withinGeofence: false,
      accuracyAccepted: false,
      source: 'manual_admin',
    };

    const checkInTime = new Date(existing.checkIn.timestamp).getTime();
    const checkOutTime = new Date(now).getTime();
    const workingHoursRounded = Math.round(Math.max(0, (checkOutTime - checkInTime) / (1000 * 60 * 60)) * 100) / 100;

    const settings = await loadAttendanceSettings();
    const policyVersion = generatePolicyVersion(settings);
    const recordForEngine: AttendanceRecord = {
      ...existing,
      checkOut: checkOutRecord,
      workingHours: workingHoursRounded,
    };
    const computedStatus = computeStatus(recordForEngine, settings);
    const earlyExitResult = hasEarlyExit(recordForEngine, settings);

    const updateData: Record<string, unknown> = {
      checkOut: checkOutRecord,
      workingHours: workingHoursRounded,
      earlyExit: earlyExitResult,
      updatedAt: new Date().toISOString(),
    };
    if (computedStatus) {
      updateData.computedStatus = computedStatus;
      updateData.policyVersion = policyVersion;
    }
    // Phase 9 (DI-02 sweep): checkOutRecord here is currently a fully
    // specified literal (manual_admin path), but sanitize for consistency
    // with the other updateData writes in this file — defense-in-depth.
    await import('firebase/firestore').then(({ updateDoc, doc: docRef }) =>
      updateDoc(docRef(db, COLLECTIONS.ATTENDANCE, existing.id), sanitizePayload(updateData) as any),
    );

    const record: AttendanceRecord = {
      ...existing,
      checkOut: checkOutRecord,
      workingHours: workingHoursRounded,
      earlyExit: earlyExitResult,
      ...(computedStatus ? { computedStatus, policyVersion } : {}),
    };

    return { success: true, record, action: 'checkOut' };
  }

  // ── Phase 15: Admin correction of GPS-verified attendance ───────

  /**
   * Admin-only correction of GPS-verified attendance evidence.
   *
   * This is the ONLY legitimate path for modifying immutable checkIn/checkOut
   * sub-records. It must be paired with a mandatory auditLogger call.
   *
   * Flow (Master Plan Phase 15):
   * 1. Verify the record exists and has GPS data
   * 2. Validate correction reason (mandatory, non-empty)
   * 3. Write the attendance correction (checkIn/checkOut + correction field)
   * 4. Write the audit log via auditLogger.logUpdate()
   * 5. If audit-log write fails, surface a distinct warning (not a silent swallow)
   *
   * Ordering: attendance correction is written FIRST (primary record), then
   * audit log. If audit-log fails, the Admin receives a warning rather than
   * a false failure — the correction itself succeeded.
   *
   * @param attendanceId - The attendance document ID to correct
   * @param correction - The correction payload containing reason + optional checkIn/checkOut overrides
   * @returns AttendanceCheckResult with the corrected record or error
   */
  static async correctAttendance(
    attendanceId: string,
    correction: {
      reason: string;
      checkIn?: Partial<AttendanceCheckSubRecord>;
      checkOut?: Partial<AttendanceCheckSubRecord>;
    },
  ): Promise<AttendanceCheckResult> {
    // ── Step 1: Verify identity and Admin role ──────────────────
    const user = resolveCurrentUser();
    const { usePermissions } = await import('../lib/permissions');
    const perms = usePermissions();
    if (!perms.canEdit('attendance')) {
      throw new AttendanceCheckError('not_authorized', 'You do not have permission to correct attendance records.');
    }

    // ── Step 2: Validate correction reason (mandatory) ────────────
    const trimmedReason = (correction.reason || '').trim();
    if (!trimmedReason) {
      throw new AttendanceCheckError('missing_reason', 'A correction reason is required. Please provide a reason for this correction.');
    }

    // ── Step 3: Load the existing attendance record ───────────────
    const existing = await getOne<AttendanceRecord>(COLLECTIONS.ATTENDANCE, attendanceId);
    if (!existing) {
      throw new AttendanceCheckError('record_not_found', 'Attendance record not found.');
    }

    // ── Step 4: Verify the record has GPS data (correction is for GPS evidence only) ──
    if (!existing.checkIn && !existing.checkOut) {
      throw new AttendanceCheckError(
        'no_gps_data',
        'This is a manual attendance record. Use the Edit Record action for manual attendance.',
      );
    }

    // ── Step 5: Build the correction payload ─────────────────────
    const correctionRecord: AttendanceCorrection = {
      correctedBy: user.id,
      correctedAt: new Date().toISOString(),
      reason: trimmedReason,
      previousValues: {
        ...(existing.checkIn ? { checkIn: existing.checkIn } : {}),
        ...(existing.checkOut ? { checkOut: existing.checkOut } : {}),
      },
    };

    const updateData: Record<string, unknown> = {
      correction: correctionRecord,
      updatedAt: new Date().toISOString(),
    };

    // Merge partial checkIn/checkOut overrides if provided
    if (correction.checkIn) {
      updateData.checkIn = { ...existing.checkIn, ...correction.checkIn };
    }
    if (correction.checkOut) {
      updateData.checkOut = { ...existing.checkOut, ...correction.checkOut };
    }

    // ── Step 6: Write the attendance correction (primary record) ──
    // Phase 9 (DI-02 sweep): updateData.checkIn/checkOut are spread from an
    // ADMIN-SUPPLIED partial correction object (correction.checkIn/checkOut)
    // — a live-reproducible undefined-reaches-Firestore path (a correction
    // form field left blank maps to `undefined` in the merged object,
    // exactly the bug class this sweep targets), not merely latent.
    await import('firebase/firestore').then(({ updateDoc, doc: docRef }) =>
      updateDoc(docRef(db, COLLECTIONS.ATTENDANCE, attendanceId), sanitizePayload(updateData) as any),
    );

    // ── Step 7: Write the audit log (secondary) ─────────────────
    // If this fails, the correction is still saved — surface a warning.
    let auditFailed = false;
    try {
      const { logUpdate } = await import('../lib/auditLogger');
      await logUpdate(
        'attendance',
        attendanceId,
        existing.checkIn ? { checkIn: existing.checkIn } : {},
        updateData,
        'attendance',
      );
    } catch {
      auditFailed = true;
      console.warn('[AttendanceService] Correction saved but audit log write failed — please note this manually.');
    }

    // ── Step 8: Return result ───────────────────────────────────
    const correctedRecord: AttendanceRecord = {
      ...existing,
      ...updateData,
      ...(updateData.checkIn ? { checkIn: updateData.checkIn } : {}),
      ...(updateData.checkOut ? { checkOut: updateData.checkOut } : {}),
      correction: correctionRecord,
    } as AttendanceRecord;

    if (auditFailed) {
      return {
        success: true,
        record: correctedRecord,
        error: 'Correction saved, but the audit log entry failed to record — please note this manually.',
      };
    }

    return { success: true, record: correctedRecord };
  }
}
