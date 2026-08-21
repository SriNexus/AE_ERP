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
import { useAppStore } from '../store/useAppStore';
import { evaluateGeofence, type GeoEvidence } from '../lib/geo';
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
  source: 'warehouse' | 'company';
  id: string;
};

/**
 * Check whether a set of geo fields are valid and complete for geofence evaluation.
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

/**
 * Resolve the attendance location for the current user.
 *
 * Precedence (Part 4 of the authoritative requirement):
 * 1. Employee/User's assigned Warehouse → if complete valid geo → use it
 * 2. Otherwise → Company fallback → if complete valid geo → use it
 * 3. Otherwise → null (no_attendance_location error)
 *
 * IMPORTANT: The fallback is ATOMIC. We never mix fields between
 * Warehouse and Company. Either the Warehouse has all three valid
 * geo fields, or we fall back entirely to the Company's geo fields.
 */
async function resolveAttendanceLocation(
  warehouseId: string | undefined,
  companyId: string,
): Promise<ResolvedAttendanceLocation | null> {
  // ── Step 1: Try warehouse geo ───────────────────────────────
  if (warehouseId) {
    const warehouse = await getOne<Warehouse>(COLLECTIONS.WAREHOUSES, warehouseId).catch(() => null);
    if (warehouse && hasValidGeo(warehouse.latitude, warehouse.longitude, warehouse.geofenceRadiusMeters)) {
      // Validate company ownership: warehouse must belong to user's company
      if (warehouse.companyId === companyId) {
        return {
          latitude: warehouse.latitude!,
          longitude: warehouse.longitude!,
          geofenceRadiusMeters: warehouse.geofenceRadiusMeters!,
          name: warehouse.name,
          source: 'warehouse',
          id: warehouse.id,
        };
      }
      // Warehouse belongs to another company — reject it silently
      // (do not cross company boundaries)
    }
  }

  // ── Step 2: Fallback to company geo ─────────────────────────
  const company = await getOne<CompanyConfig>(COLLECTIONS.COMPANIES, companyId).catch(() => null);
  if (company && hasValidGeo(company.latitude, company.longitude, company.geofenceRadiusMeters)) {
    return {
      latitude: company.latitude!,
      longitude: company.longitude!,
      geofenceRadiusMeters: company.geofenceRadiusMeters!,
      name: company.name,
      source: 'company',
      id: company.id,
    };
  }

  // ── Step 3: No valid geo anywhere ──────────────────────────
  return null;
}

/**
 * Resolve the employee's assigned Warehouse (kept for backward compatibility).
 * Returns null if no warehouse is assigned or the warehouse lacks geo-fence fields.
 * @deprecated Use resolveAttendanceLocation() instead.
 */
async function resolveAttendanceWarehouse(
  warehouseId: string | undefined,
): Promise<Warehouse | null> {
  if (!warehouseId) return null;
  const warehouse = await getOne<Warehouse>(COLLECTIONS.WAREHOUSES, warehouseId);
  if (!warehouse) return null;
  if (!hasValidGeo(warehouse.latitude, warehouse.longitude, warehouse.geofenceRadiusMeters)) {
    return null;
  }
  return warehouse;
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
 * Build the immutable check-in sub-record from GPS evidence + evaluation results.
 */
function buildCheckInSubRecord(
  location: GeoEvidence,
  attLocation: { id: string; source: string },
  geofenceResult: { withinGeofence: boolean; distanceMeters: number },
  accuracyAccepted: boolean,
): AttendanceCheckSubRecord {
  return {
    timestamp: new Date().toISOString(),
    location,
    approvedLocationId: attLocation.id,
    distanceFromLocationMeters: geofenceResult.distanceMeters,
    withinGeofence: geofenceResult.withinGeofence,
    accuracyAccepted,
    source: 'gps',
    deviceInfo: {
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      platform: typeof navigator !== 'undefined' ? navigator.platform : undefined,
    },
  };
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
   * Flow (Master Plan §14):
   * 1. Resolve current user/employee identity
   * 2. Resolve employee's assigned Warehouse (via User.warehouseId)
   * 3. Load attendance settings
   * 4. Evaluate geofence (evaluateGeofence from Geo platform)
   * 5. Evaluate GPS accuracy (separate from geofence, per audit §28)
   * 6. Evaluate location staleness (capturedAt vs. staleLocationMaxAgeSeconds)
   * 7. Duplicate check (no existing checkIn today)
   * 8. Upsert attendance document (create new or merge onto existing manual record)
   * 9. Return result
   *
   * Blocked attempts (GPS denied, outside geofence, accuracy fail, etc.)
   * produce NO Firestore write — per audit §29.2.
   *
   * @param location - GPS evidence from captureLocation()
   * @returns AttendanceCheckResult with the persisted record or error
   */
  static async checkIn(location: GeoEvidence): Promise<AttendanceCheckResult> {
    // ── Step 1: Resolve identity ──────────────────────────────
    const user = resolveCurrentUser();
    const companyId = user.companyId || (useAppStore.getState().activeCompanyId || '');
    if (!companyId) {
      throw new AttendanceCheckError('no_company', 'No company is associated with your account.');
    }

    // ── Step 2: Resolve attendance location ──────────────────
    // Precedence: Warehouse geo → Company geo → error
    const attLocation = await resolveAttendanceLocation(user.warehouseId, companyId);
    if (!attLocation) {
      throw new AttendanceCheckError(
        'no_attendance_location',
        'No attendance location is configured for your company or assigned warehouse. Ask an administrator to configure the Company Attendance Location or Warehouse Geo-Fence.',
      );
    }

    // ── Step 3: Load settings ─────────────────────────────────
    const settings = await loadAttendanceSettings();

    // ── Step 4: Evaluate geofence ─────────────────────────────
    const point = { latitude: location.latitude, longitude: location.longitude };
    const center = { latitude: attLocation.latitude, longitude: attLocation.longitude };
    const geoResult = evaluateGeofence(point, center, attLocation.geofenceRadiusMeters);

    if (!geoResult.withinGeofence) {
      throw new AttendanceCheckError(
        'outside_geofence',
        `You are too far from ${attLocation.name} to check in (${Math.round(geoResult.distanceMeters)}m away, allowed ${attLocation.geofenceRadiusMeters}m).`,
      );
    }

    // ── Step 5: Evaluate accuracy ─────────────────────────────
    const accuracyAccepted =
      typeof location.accuracy === 'number' &&
      location.accuracy <= settings.gpsAccuracyThresholdMeters;

    if (!accuracyAccepted) {
      const accuracyVal = typeof location.accuracy === 'number' ? Math.round(location.accuracy) : 'unknown';
      throw new AttendanceCheckError(
        'accuracy_rejected',
        `GPS accuracy is too low to check in here (±${accuracyVal}m, need ±${settings.gpsAccuracyThresholdMeters}m or better). Your device reported multiple readings but none were accurate enough. Move outdoors, enable precise location, and try again.`,
      );
    }

    // ── Step 6: Evaluate location staleness ───────────────────
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

    // ── Step 7: Duplicate check ───────────────────────────────
    const existing = await getTodayAttendance(user.id);
    if (existing?.checkIn) {
      throw new AttendanceCheckError(
        'duplicate_check_in',
        `You've already checked in today at ${new Date(existing.checkIn.timestamp).toLocaleTimeString()}.`,
      );
    }

    // ── Step 8: Build check-in sub-record ─────────────────────
    const checkInRecord = buildCheckInSubRecord(location, attLocation, geoResult, accuracyAccepted);

    // ── Step 9: Upsert attendance document ────────────────────
    let record: AttendanceRecord;

    if (existing) {
      // Merge checkIn onto existing document (manual record or empty record)
      // This handles the "HR pre-marked status, employee then checks in" case
      await import('firebase/firestore').then(({ updateDoc, doc: docRef }) =>
        updateDoc(docRef(db, COLLECTIONS.ATTENDANCE, existing.id), {
          checkIn: checkInRecord,
          updatedAt: new Date().toISOString(),
        } as any),
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
   * @returns AttendanceCheckResult with the persisted record or error
   */
  static async checkOut(location: GeoEvidence): Promise<AttendanceCheckResult> {
    // ── Step 1: Resolve identity ──────────────────────────────
    const user = resolveCurrentUser();

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
        attLoc = await resolveAttendanceLocation(currentUser.warehouseId, companyId);
      }
    }

    // ── Step 5: Evaluate geofence + accuracy (DO NOT BLOCK) ───
    // Master Plan: checkout outside geofence = FLAG, not BLOCK.
    let withinGeofence = false;
    let distanceMeters = 0;
    let accuracyAccepted = false;
    let locationForRecord: GeoEvidence | undefined = location;

    if (attLoc) {
      const point = { latitude: location.latitude, longitude: location.longitude };
      const center = { latitude: attLoc.latitude, longitude: attLoc.longitude };
      const geoResult = evaluateGeofence(point, center, attLoc.geofenceRadiusMeters);
      withinGeofence = geoResult.withinGeofence;
      distanceMeters = geoResult.distanceMeters;

      const settings = await loadAttendanceSettings();
      accuracyAccepted =
        typeof location.accuracy === 'number' &&
        location.accuracy <= settings.gpsAccuracyThresholdMeters;
    }
    // If no warehouse, we still proceed — checkout is not blocked.
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
      distanceFromLocationMeters: distanceMeters || undefined,
      withinGeofence,
      accuracyAccepted,
      source: 'gps',
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
    await import('firebase/firestore').then(({ updateDoc, doc: docRef }) =>
      updateDoc(docRef(db, COLLECTIONS.ATTENDANCE, existing.id), updateData as any),
    );

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
        await import('firebase/firestore').then(({ updateDoc, doc: docRef }) =>
          updateDoc(docRef(db, COLLECTIONS.ATTENDANCE, existing.id), {
            checkIn: checkInRecord,
            updatedAt: new Date().toISOString(),
          } as any),
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
    await import('firebase/firestore').then(({ updateDoc, doc: docRef }) =>
      updateDoc(docRef(db, COLLECTIONS.ATTENDANCE, existing.id), updateData as any),
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
    await import('firebase/firestore').then(({ updateDoc, doc: docRef }) =>
      updateDoc(docRef(db, COLLECTIONS.ATTENDANCE, attendanceId), updateData as any),
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
