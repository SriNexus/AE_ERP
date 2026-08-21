/**
 * Pre-Phase-9 Gap Closure — Attendance Rules Tests
 *
 * Verifies the `match /attendance/{id}` rules block from Phase 6 against
 * the actual write shapes produced by Phase 7 (check-in) and Phase 8 (checkout).
 *
 * Coverage:
 * A. Manual Attendance regression (Admin create/read/update)
 * B. Self-service check-in (employee creates own record)
 * C. Check-in identity enforcement (cannot claim another employee)
 * D. Check-in immutability (non-Admin cannot alter checkIn)
 * E. Checkout (self adds checkOut + workingHours)
 * F. Checkout immutability (cannot modify checkIn or existing checkOut)
 * G. Admin behavior
 * H. Delete denial
 * I. Company isolation
 * J. audit_logs unchanged
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection, query, where } from 'firebase/firestore';

// ═══════════════════════════════════════════════════════════════════
// Test environment setup
// ═══════════════════════════════════════════════════════════════════

const PROJECT = 'neozy-attendance-rules-test';
const COMPANY_A = 'company-a';
const COMPANY_B = 'company-b';
const GROUP_A = 'group-a';
const GROUP_B = 'group-b';
const ADMIN_UID = 'admin-uid';
const EMPLOYEE_A_UID = 'employee-a-uid';
const EMPLOYEE_B_UID = 'employee-b-uid';
const ADMIN_USER_ID = 'USR-ADMIN-A';
const EMPLOYEE_A_USER_ID = 'USR-EMP-A';
const EMPLOYEE_B_USER_ID = 'USR-EMP-B';
const GROUP_ADMIN_A_UID = 'group-admin-a-uid';
const GROUP_ADMIN_A_USER_ID = 'USR-GA-A';
const GROUP_ADMIN_B_UID = 'group-admin-b-uid';
const GROUP_ADMIN_B_USER_ID = 'USR-GA-B';

let env: RulesTestEnvironment;

// ── Seed data ────────────────────────────────────────────────

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    // Companies
    await setDoc(doc(db, 'companies', COMPANY_A), {
      id: COMPANY_A, companyId: COMPANY_A, name: 'Company A', status: 'Active', groupId: GROUP_A,
    });
    await setDoc(doc(db, 'companies', COMPANY_B), {
      id: COMPANY_B, companyId: COMPANY_B, name: 'Company B', status: 'Active', groupId: GROUP_B,
    });

    // Groups
    await setDoc(doc(db, 'groups', GROUP_A), { id: GROUP_A, name: 'Group A', status: 'Active' });
    await setDoc(doc(db, 'groups', GROUP_B), { id: GROUP_B, name: 'Group B', status: 'Active' });

    // Users
    await setDoc(doc(db, 'users', ADMIN_USER_ID), {
      id: ADMIN_USER_ID, companyId: COMPANY_A, email: 'admin@a.com', role: 'Admin', status: 'Active', isSuperAdmin: false,
    });
    await setDoc(doc(db, 'users', EMPLOYEE_A_USER_ID), {
      id: EMPLOYEE_A_USER_ID, companyId: COMPANY_A, email: 'emp@a.com', role: 'Employee', status: 'Active', isSuperAdmin: false,
    });
    await setDoc(doc(db, 'users', EMPLOYEE_B_USER_ID), {
      id: EMPLOYEE_B_USER_ID, companyId: COMPANY_A, email: 'emp2@a.com', role: 'Employee', status: 'Active', isSuperAdmin: false,
    });
    // GroupAdmin identities (§9.3): role 'GroupAdmin', groupId mirrored on
    // both the users doc and the auth-map (actorGroupId()/actorIsGroupAdmin()
    // read through the auth-map path, per rules helper convention above).
    await setDoc(doc(db, 'users', GROUP_ADMIN_A_USER_ID), {
      id: GROUP_ADMIN_A_USER_ID, companyId: COMPANY_A, email: 'ga.a@a.com', role: 'GroupAdmin', status: 'Active', isSuperAdmin: false, groupId: GROUP_A,
    });
    await setDoc(doc(db, 'users', GROUP_ADMIN_B_USER_ID), {
      id: GROUP_ADMIN_B_USER_ID, companyId: COMPANY_B, email: 'ga.b@b.com', role: 'GroupAdmin', status: 'Active', isSuperAdmin: false, groupId: GROUP_B,
    });

    // User auth maps
    await setDoc(doc(db, 'user_auth_maps', ADMIN_UID), {
      authUid: ADMIN_UID, userId: ADMIN_USER_ID, companyId: COMPANY_A, email: 'admin@a.com',
    });
    await setDoc(doc(db, 'user_auth_maps', EMPLOYEE_A_UID), {
      authUid: EMPLOYEE_A_UID, userId: EMPLOYEE_A_USER_ID, companyId: COMPANY_A, email: 'emp@a.com',
    });
    await setDoc(doc(db, 'user_auth_maps', EMPLOYEE_B_UID), {
      authUid: EMPLOYEE_B_UID, userId: EMPLOYEE_B_USER_ID, companyId: COMPANY_A, email: 'emp2@a.com',
    });
    await setDoc(doc(db, 'user_auth_maps', GROUP_ADMIN_A_UID), {
      authUid: GROUP_ADMIN_A_UID, userId: GROUP_ADMIN_A_USER_ID, companyId: COMPANY_A, email: 'ga.a@a.com', groupId: GROUP_A,
    });
    await setDoc(doc(db, 'user_auth_maps', GROUP_ADMIN_B_UID), {
      authUid: GROUP_ADMIN_B_UID, userId: GROUP_ADMIN_B_USER_ID, companyId: COMPANY_B, email: 'ga.b@b.com', groupId: GROUP_B,
    });

    // Warehouses
    await setDoc(doc(db, 'warehouses', 'WH-001'), {
      id: 'WH-001', companyId: COMPANY_A, name: 'Warehouse A', code: 'WHA', status: 'Active',
      latitude: 28.6139, longitude: 77.2090, geofenceRadiusMeters: 500,
    });
  });
}

// ── Context helpers ───────────────────────────────────────────

function adminDb() {
  return env.authenticatedContext(ADMIN_UID, { email: 'admin@a.com' }).firestore();
}

function employeeADb() {
  return env.authenticatedContext(EMPLOYEE_A_UID, { email: 'emp@a.com' }).firestore();
}

function employeeBDb() {
  return env.authenticatedContext(EMPLOYEE_B_UID, { email: 'emp2@a.com' }).firestore();
}

function unauthenticatedDb() {
  return env.unauthenticatedContext().firestore();
}

function groupAdminADb() {
  return env.authenticatedContext(GROUP_ADMIN_A_UID, { email: 'ga.a@a.com' }).firestore();
}

function groupAdminBDb() {
  return env.authenticatedContext(GROUP_ADMIN_B_UID, { email: 'ga.b@b.com' }).firestore();
}

// ── Lifecycle ────────────────────────────────────────────────

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await seed();
});

afterAll(async () => {
  await env.cleanup();
});

// ═══════════════════════════════════════════════════════════════════
// A. Manual Attendance Regression (Admin)
// ═══════════════════════════════════════════════════════════════════

describe('A. Manual Attendance Regression (Admin)', () => {
  const MANUAL_DOC = 'ATT-MANUAL-001';
  const manualPayload = {
    id: MANUAL_DOC,
    companyId: COMPANY_A,
    employeeId: EMPLOYEE_A_USER_ID,
    employee: 'Employee A',
    date: '2026-08-20',
    status: 'Present',
    inTime: '09:00',
    outTime: '18:00',
    notes: 'Regular day',
    createdBy: ADMIN_USER_ID,
  };

  it('Admin can CREATE a manual attendance record (no GPS fields)', async () => {
    await assertSucceeds(
      setDoc(doc(adminDb(), 'attendance', MANUAL_DOC), manualPayload),
    );
  });

  it('Admin can READ a manual attendance record', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'attendance', MANUAL_DOC), manualPayload);
    });
    await assertSucceeds(getDoc(doc(adminDb(), 'attendance', MANUAL_DOC)));
  });

  it('Admin can UPDATE manual attendance fields', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'attendance', MANUAL_DOC), manualPayload);
    });
    await assertSucceeds(
      updateDoc(doc(adminDb(), 'attendance', MANUAL_DOC), { status: 'Absent', notes: 'Updated' }),
    );
  });

  it('manual record without checkIn/checkOut is valid', async () => {
    await assertSucceeds(
      setDoc(doc(adminDb(), 'attendance', MANUAL_DOC), manualPayload),
    );
    const snap = await getDoc(doc(adminDb(), 'attendance', MANUAL_DOC));
    expect(snap.exists()).toBe(true);
    const data = snap.data();
    expect(data?.checkIn).toBeUndefined();
    expect(data?.checkOut).toBeUndefined();
    expect(data?.status).toBe('Present');
  });
});

// ═══════════════════════════════════════════════════════════════════
// B. Self-Service Check-In (Employee creates own record)
// ═══════════════════════════════════════════════════════════════════

describe('B. Self-Service Check-In', () => {
  const CHECKIN_DOC = 'ATT-CHECKIN-001';
  const checkInPayload = {
    id: CHECKIN_DOC,
    companyId: COMPANY_A,
    employeeId: EMPLOYEE_A_USER_ID,
    employee: 'Employee A',
    date: '2026-08-20',
    checkIn: {
      timestamp: '2026-08-20T09:00:00.000Z',
      location: { latitude: 28.6142, longitude: 77.2095, accuracy: 15, capturedAt: '2026-08-20T09:00:00.000Z', address: 'New Delhi' },
      approvedLocationId: 'WH-001',
      distanceFromLocationMeters: 50,
      withinGeofence: true,
      accuracyAccepted: true,
      source: 'gps',
    },
    createdBy: EMPLOYEE_A_USER_ID,
  };

  it('employee can CREATE own attendance record with checkIn', async () => {
    await assertSucceeds(
      setDoc(doc(employeeADb(), 'attendance', CHECKIN_DOC), checkInPayload),
    );
  });

  it('employee can READ own attendance record', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'attendance', CHECKIN_DOC), checkInPayload);
    });
    await assertSucceeds(getDoc(doc(employeeADb(), 'attendance', CHECKIN_DOC)));
  });

  it('employee can add checkIn to existing manual record', async () => {
    // First: Admin creates a manual record
    const manualDoc = 'ATT-MERGE-001';
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'attendance', manualDoc), {
        id: manualDoc,
        companyId: COMPANY_A,
        employeeId: EMPLOYEE_A_USER_ID,
        employee: 'Employee A',
        date: '2026-08-20',
        status: 'Present',
        createdBy: ADMIN_USER_ID,
      });
    });
    // Then: Employee adds checkIn via update
    await assertSucceeds(
      updateDoc(doc(employeeADb(), 'attendance', manualDoc), {
        checkIn: checkInPayload.checkIn,
        updatedAt: '2026-08-20T09:00:05.000Z',
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// C. Check-In Identity Enforcement
// ═══════════════════════════════════════════════════════════════════

describe('C. Check-In Identity Enforcement', () => {
  it('employee CANNOT create attendance claiming another employee\'s employeeId', async () => {
    await assertFails(
      setDoc(doc(employeeADb(), 'attendance', 'ATT-FORGED-001'), {
        id: 'ATT-FORGED-001',
        companyId: COMPANY_A,
        employeeId: EMPLOYEE_B_USER_ID, // FORGED: different employee
        employee: 'Employee B',
        date: '2026-08-20',
        createdBy: EMPLOYEE_A_USER_ID,
      }),
    );
  });

  it('employee CANNOT read another employee\'s record', async () => {
    const docId = 'ATT-OTHER-001';
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'attendance', docId), {
        id: docId,
        companyId: COMPANY_A,
        employeeId: EMPLOYEE_B_USER_ID,
        employee: 'Employee B',
        date: '2026-08-20',
        createdBy: EMPLOYEE_B_USER_ID,
      });
    });
    await assertFails(getDoc(doc(employeeADb(), 'attendance', docId)));
  });
});

// ═══════════════════════════════════════════════════════════════════
// D. Check-In Immutability (non-Admin cannot alter checkIn)
// ═══════════════════════════════════════════════════════════════════

describe('D. Check-In Immutability', () => {
  const IMM_DOC = 'ATT-IMM-001';
  const baseRecord = {
    id: IMM_DOC,
    companyId: COMPANY_A,
    employeeId: EMPLOYEE_A_USER_ID,
    employee: 'Employee A',
    date: '2026-08-20',
    checkIn: {
      timestamp: '2026-08-20T09:00:00.000Z',
      location: { latitude: 28.6142, longitude: 77.2095, accuracy: 15, capturedAt: '2026-08-20T09:00:00.000Z' },
      withinGeofence: true,
      accuracyAccepted: true,
      source: 'gps' as const,
    },
    createdBy: EMPLOYEE_A_USER_ID,
  };

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'attendance', IMM_DOC), baseRecord);
    });
  });

  it('employee CANNOT modify existing checkIn', async () => {
    await assertFails(
      updateDoc(doc(employeeADb(), 'attendance', IMM_DOC), {
        checkIn: {
          ...baseRecord.checkIn,
          timestamp: '2026-08-20T10:00:00.000Z', // CHANGED
        },
      }),
    );
  });

  it('employee CANNOT remove checkIn', async () => {
    await assertFails(
      updateDoc(doc(employeeADb(), 'attendance', IMM_DOC), {
        checkIn: null,
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// E. Checkout (Phase 8 write shape)
// ═══════════════════════════════════════════════════════════════════

describe('E. Checkout', () => {
  const CO_DOC = 'ATT-CO-001';
  const baseRecord = {
    id: CO_DOC,
    companyId: COMPANY_A,
    employeeId: EMPLOYEE_A_USER_ID,
    employee: 'Employee A',
    date: '2026-08-20',
    checkIn: {
      timestamp: '2026-08-20T09:00:00.000Z',
      location: { latitude: 28.6142, longitude: 77.2095, accuracy: 15, capturedAt: '2026-08-20T09:00:00.000Z' },
      approvedLocationId: 'WH-001',
      withinGeofence: true,
      accuracyAccepted: true,
      source: 'gps' as const,
    },
    createdBy: EMPLOYEE_A_USER_ID,
  };

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'attendance', CO_DOC), baseRecord);
    });
  });

  it('employee can add checkOut + workingHours (Phase 8 write shape)', async () => {
    await assertSucceeds(
      updateDoc(doc(employeeADb(), 'attendance', CO_DOC), {
        checkOut: {
          timestamp: '2026-08-20T18:00:00.000Z',
          location: { latitude: 28.6145, longitude: 77.2098, accuracy: 12, capturedAt: '2026-08-20T18:00:00.000Z' },
          approvedLocationId: 'WH-001',
          distanceFromLocationMeters: 55,
          withinGeofence: true,
          accuracyAccepted: true,
          source: 'gps',
        },
        workingHours: 9,
        updatedAt: '2026-08-20T18:00:05.000Z',
      }),
    );
  });

  it('employee can add checkOut with withinGeofence=false (outside-geofence checkout succeeds)', async () => {
    await assertSucceeds(
      updateDoc(doc(employeeADb(), 'attendance', CO_DOC), {
        checkOut: {
          timestamp: '2026-08-20T18:00:00.000Z',
          location: { latitude: 19.0760, longitude: 72.8777, accuracy: 20, capturedAt: '2026-08-20T18:00:00.000Z' },
          withinGeofence: false, // outside geofence
          accuracyAccepted: false, // poor accuracy
          source: 'gps',
        },
        workingHours: 9,
        updatedAt: '2026-08-20T18:00:05.000Z',
      }),
    );
  });

  it('employee CANNOT modify checkIn during checkout', async () => {
    await assertFails(
      updateDoc(doc(employeeADb(), 'attendance', CO_DOC), {
        checkIn: { ...baseRecord.checkIn, timestamp: '2026-08-20T08:00:00.000Z' }, // CHANGED
        checkOut: { timestamp: '2026-08-20T18:00:00.000Z', location: { latitude: 28.61, longitude: 77.21 }, withinGeofence: true, accuracyAccepted: true, source: 'gps' },
        workingHours: 10,
      }),
    );
  });

  it('employee CANNOT modify existing checkOut (immutable once set)', async () => {
    // First: add a checkout
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'attendance', CO_DOC), {
        checkOut: {
          timestamp: '2026-08-20T18:00:00.000Z',
          location: { latitude: 28.61, longitude: 77.21 },
          withinGeofence: true,
          accuracyAccepted: true,
          source: 'gps',
        },
        workingHours: 9,
      });
    });
    // Then: try to modify the existing checkOut
    await assertFails(
      updateDoc(doc(employeeADb(), 'attendance', CO_DOC), {
        checkOut: {
          timestamp: '2026-08-20T19:00:00.000Z', // CHANGED
          location: { latitude: 28.61, longitude: 77.21 },
          withinGeofence: true,
          accuracyAccepted: true,
          source: 'gps',
        },
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// F. Admin Behavior
// ═══════════════════════════════════════════════════════════════════

describe('F. Admin Behavior', () => {
  const ADMIN_DOC = 'ATT-ADMIN-001';

  it('Admin can CREATE any attendance record', async () => {
    await assertSucceeds(
      setDoc(doc(adminDb(), 'attendance', ADMIN_DOC), {
        id: ADMIN_DOC,
        companyId: COMPANY_A,
        employeeId: EMPLOYEE_A_USER_ID,
        employee: 'Employee A',
        date: '2026-08-20',
        status: 'Present',
        createdBy: ADMIN_USER_ID,
      }),
    );
  });

  it('Admin can UPDATE attendance fields', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'attendance', ADMIN_DOC), {
        id: ADMIN_DOC, companyId: COMPANY_A, employeeId: EMPLOYEE_A_USER_ID,
        employee: 'Employee A', date: '2026-08-20', createdBy: ADMIN_USER_ID,
      });
    });
    await assertSucceeds(
      updateDoc(doc(adminDb(), 'attendance', ADMIN_DOC), { status: 'Late', notes: 'Updated by admin' }),
    );
  });

  it('Admin can read company attendance records', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'attendance', ADMIN_DOC), {
        id: ADMIN_DOC, companyId: COMPANY_A, employeeId: EMPLOYEE_A_USER_ID,
        employee: 'Employee A', date: '2026-08-20', createdBy: ADMIN_USER_ID,
      });
    });
    await assertSucceeds(getDoc(doc(adminDb(), 'attendance', ADMIN_DOC)));
  });
});

// ═══════════════════════════════════════════════════════════════════
// G. Delete Denial
// ═══════════════════════════════════════════════════════════════════

describe('G. Delete Denial', () => {
  const DEL_DOC = 'ATT-DEL-001';

  it('employee cannot DELETE attendance', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'attendance', DEL_DOC), {
        id: DEL_DOC, companyId: COMPANY_A, employeeId: EMPLOYEE_A_USER_ID,
        employee: 'Employee A', date: '2026-08-20', createdBy: EMPLOYEE_A_USER_ID,
      });
    });
    await assertFails(deleteDoc(doc(employeeADb(), 'attendance', DEL_DOC)));
  });

  it('Admin cannot DELETE attendance (delete: if false)', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'attendance', DEL_DOC), {
        id: DEL_DOC, companyId: COMPANY_A, employeeId: EMPLOYEE_A_USER_ID,
        employee: 'Employee A', date: '2026-08-20', createdBy: ADMIN_USER_ID,
      });
    });
    await assertFails(deleteDoc(doc(adminDb(), 'attendance', DEL_DOC)));
  });
});

// ═══════════════════════════════════════════════════════════════════
// H. Company Isolation
// ═══════════════════════════════════════════════════════════════════

describe('H. Company Isolation', () => {
  const CROSS_DOC = 'ATT-CROSS-001';

  it('employee cannot READ cross-company attendance', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'attendance', CROSS_DOC), {
        id: CROSS_DOC, companyId: COMPANY_B, employeeId: 'emp-b',
        employee: 'Employee B', date: '2026-08-20', createdBy: 'emp-b',
      });
    });
    await assertFails(getDoc(doc(employeeADb(), 'attendance', CROSS_DOC)));
  });

  it('employee cannot CREATE cross-company attendance', async () => {
    await assertFails(
      setDoc(doc(employeeADb(), 'attendance', 'ATT-XCOMP-001'), {
        id: 'ATT-XCOMP-001', companyId: COMPANY_B, employeeId: EMPLOYEE_A_USER_ID,
        employee: 'Employee A', date: '2026-08-20', createdBy: EMPLOYEE_A_USER_ID,
      }),
    );
  });

  it('unauthenticated user cannot READ attendance', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'attendance', CROSS_DOC), {
        id: CROSS_DOC, companyId: COMPANY_A, employeeId: EMPLOYEE_A_USER_ID,
        employee: 'Employee A', date: '2026-08-20', createdBy: EMPLOYEE_A_USER_ID,
      });
    });
    await assertFails(getDoc(doc(unauthenticatedDb(), 'attendance', CROSS_DOC)));
  });

  it('unauthenticated user cannot CREATE attendance', async () => {
    await assertFails(
      setDoc(doc(unauthenticatedDb(), 'attendance', 'ATT-UNAUTH-001'), {
        id: 'ATT-UNAUTH-001', companyId: COMPANY_A, employeeId: EMPLOYEE_A_USER_ID,
        employee: 'Employee A', date: '2026-08-20',
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// I. audit_logs Unchanged
// ═══════════════════════════════════════════════════════════════════

describe('I. audit_logs Unchanged', () => {
  it('non-Admin CANNOT create audit_logs (unchanged Admin-only rule)', async () => {
    await assertFails(
      setDoc(doc(employeeADb(), 'audit_logs', 'LOG-001'), {
        id: 'LOG-001', companyId: COMPANY_A, action: 'test',
      }),
    );
  });

  it('Admin CAN create audit_logs (unchanged)', async () => {
    await assertSucceeds(
      setDoc(doc(adminDb(), 'audit_logs', 'LOG-002'), {
        id: 'LOG-002', companyId: COMPANY_A, action: 'test',
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// J. Phase 15 — Admin Correction Guard (requiresGPSReason)
// ═══════════════════════════════════════════════════════════════════

describe('J. Phase 15 — Admin Correction Guard', () => {
  const CORRECTION_BASE = {
    companyId: COMPANY_A,
    employeeId: EMPLOYEE_A_USER_ID,
    employee: 'Employee A',
    date: '2026-08-20',
    status: 'Present',
  };

  const CHECKIN_SNAPSHOT = {
    timestamp: '2026-08-20T09:00:00Z',
    location: { latitude: 28.6139, longitude: 77.2090, accuracy: 10 },
    withinGeofence: true,
    accuracyAccepted: true,
    source: 'gps',
  };

  const CORRECTION_OBJ = {
    correctedBy: 'admin-uid',
    correctedAt: '2026-08-20T12:00:00Z',
    reason: 'GPS showed incorrect location due to device error',
  };

  it('Admin CAN update checkIn WITH correction — ALLOW', async () => {
    // First create a record with checkIn via Admin
    const docRef = doc(adminDb(), 'attendance', 'ATT-CORR-001');
    await assertSucceeds(setDoc(docRef, {
      ...CORRECTION_BASE,
      checkIn: CHECKIN_SNAPSHOT,
    }));
    // Now Admin updates checkIn WITH correction — must succeed
    await assertSucceeds(updateDoc(docRef, {
      checkIn: { ...CHECKIN_SNAPSHOT, timestamp: '2026-08-20T09:05:00Z' },
      correction: CORRECTION_OBJ,
    }));
  });

  it('Admin CANNOT update checkIn WITHOUT correction — DENY', async () => {
    const docRef = doc(adminDb(), 'attendance', 'ATT-CORR-002');
    await assertSucceeds(setDoc(docRef, {
      ...CORRECTION_BASE,
      checkIn: CHECKIN_SNAPSHOT,
    }));
    // Admin updates checkIn WITHOUT correction — must fail
    await assertFails(updateDoc(docRef, {
      checkIn: { ...CHECKIN_SNAPSHOT, timestamp: '2026-08-20T09:10:00Z' },
    }));
  });

  it('Admin CAN update checkOut WITH correction — ALLOW', async () => {
    const docRef = doc(adminDb(), 'attendance', 'ATT-CORR-003');
    await assertSucceeds(setDoc(docRef, {
      ...CORRECTION_BASE,
      checkIn: CHECKIN_SNAPSHOT,
      checkOut: { ...CHECKIN_SNAPSHOT, timestamp: '2026-08-20T18:00:00Z' },
    }));
    // Admin updates checkOut WITH correction — must succeed
    await assertSucceeds(updateDoc(docRef, {
      checkOut: { ...CHECKIN_SNAPSHOT, timestamp: '2026-08-20T17:30:00Z' },
      correction: CORRECTION_OBJ,
    }));
  });

  it('Admin CANNOT update checkOut WITHOUT correction — DENY', async () => {
    const docRef = doc(adminDb(), 'attendance', 'ATT-CORR-004');
    await assertSucceeds(setDoc(docRef, {
      ...CORRECTION_BASE,
      checkIn: CHECKIN_SNAPSHOT,
      checkOut: { ...CHECKIN_SNAPSHOT, timestamp: '2026-08-20T18:00:00Z' },
    }));
    // Admin updates checkOut WITHOUT correction — must fail
    await assertFails(updateDoc(docRef, {
      checkOut: { ...CHECKIN_SNAPSHOT, timestamp: '2026-08-20T17:45:00Z' },
    }));
  });

  it('Admin CAN update non-GPS fields WITHOUT correction — ALLOW', async () => {
    const docRef = doc(adminDb(), 'attendance', 'ATT-CORR-005');
    await assertSucceeds(setDoc(docRef, {
      ...CORRECTION_BASE,
      checkIn: CHECKIN_SNAPSHOT,
    }));
    // Admin updates status (non-GPS) WITHOUT correction — must succeed
    await assertSucceeds(updateDoc(docRef, {
      status: 'Late',
      notes: 'Updated manually',
    }));
  });

  it('Non-Admin CANNOT update checkIn even WITH correction — DENY', async () => {
    const docRef = doc(adminDb(), 'attendance', 'ATT-CORR-006');
    await assertSucceeds(setDoc(docRef, {
      ...CORRECTION_BASE,
      checkIn: CHECKIN_SNAPSHOT,
    }));
    // Non-Admin attempts to update checkIn with correction — must fail
    await assertFails(updateDoc(doc(employeeADb(), 'attendance', 'ATT-CORR-006'), {
      checkIn: { ...CHECKIN_SNAPSHOT, timestamp: '2026-08-20T09:15:00Z' },
      correction: CORRECTION_OBJ,
    }));
  });
});

// ═══════════════════════════════════════════════════════════════════
// K. GroupAdmin Manual Attendance (§9.3)
//
// isAdmin() only matches the literal role 'Admin' — GroupAdmin needs its
// own groupAdminCanCreate()/groupAdminCanUpdate() branch, the same fix
// class already applied to the `stock` collection this session. These
// tests prove: (1) a GroupAdmin can now manually check an employee in
// their own Group in/out (previously a hard permission-denied), and
// (2) a GroupAdmin still CANNOT reach across Group boundaries — the fix
// is additive scope, not a rules weakening.
// ═══════════════════════════════════════════════════════════════════

describe('K. GroupAdmin Manual Attendance', () => {
  it('GroupAdmin CAN create a manual check-in for an employee in their own Group', async () => {
    await assertSucceeds(
      setDoc(doc(groupAdminADb(), 'attendance', 'ATT-GA-001'), {
        id: 'ATT-GA-001',
        companyId: COMPANY_A,
        groupId: GROUP_A,
        employeeId: 'EMP-TARGET-001',
        employee: 'Target Employee',
        date: '2026-08-21',
        checkIn: {
          timestamp: '2026-08-21T09:00:00.000Z',
          withinGeofence: false,
          accuracyAccepted: false,
          source: 'manual_admin',
        },
        createdBy: GROUP_ADMIN_A_USER_ID,
      }),
    );
  });

  it('GroupAdmin CAN manual check-out (update) a same-Group record', async () => {
    const docRef = doc(groupAdminADb(), 'attendance', 'ATT-GA-002');
    await assertSucceeds(setDoc(docRef, {
      id: 'ATT-GA-002',
      companyId: COMPANY_A,
      groupId: GROUP_A,
      employeeId: 'EMP-TARGET-002',
      employee: 'Target Employee 2',
      date: '2026-08-21',
      checkIn: {
        timestamp: '2026-08-21T09:00:00.000Z',
        withinGeofence: false,
        accuracyAccepted: false,
        source: 'manual_admin',
      },
      createdBy: GROUP_ADMIN_A_USER_ID,
    }));
    await assertSucceeds(updateDoc(docRef, {
      checkOut: {
        timestamp: '2026-08-21T18:00:00.000Z',
        withinGeofence: false,
        accuracyAccepted: false,
        source: 'manual_admin',
      },
      workingHours: 9,
      updatedAt: '2026-08-21T18:00:01.000Z',
    }));
  });

  it('GroupAdmin CANNOT create a manual record for another Group — DENY', async () => {
    await assertFails(
      setDoc(doc(groupAdminADb(), 'attendance', 'ATT-GA-CROSS-001'), {
        id: 'ATT-GA-CROSS-001',
        companyId: COMPANY_B,
        groupId: GROUP_B, // GroupAdmin A's own group is GROUP_A
        employeeId: 'EMP-TARGET-003',
        employee: 'Target Employee 3',
        date: '2026-08-21',
        checkIn: {
          timestamp: '2026-08-21T09:00:00.000Z',
          withinGeofence: false,
          accuracyAccepted: false,
          source: 'manual_admin',
        },
        createdBy: GROUP_ADMIN_A_USER_ID,
      }),
    );
  });

  it('GroupAdmin CANNOT update a record belonging to another Group — DENY', async () => {
    const docRef = doc(adminDb(), 'attendance', 'ATT-GA-CROSS-002');
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'attendance', 'ATT-GA-CROSS-002'), {
        id: 'ATT-GA-CROSS-002',
        companyId: COMPANY_B,
        groupId: GROUP_B,
        employeeId: 'EMP-TARGET-004',
        employee: 'Target Employee 4',
        date: '2026-08-21',
        checkIn: {
          timestamp: '2026-08-21T09:00:00.000Z',
          withinGeofence: false,
          accuracyAccepted: false,
          source: 'manual_admin',
        },
        createdBy: GROUP_ADMIN_B_USER_ID,
      });
    });
    await assertFails(updateDoc(doc(groupAdminADb(), 'attendance', 'ATT-GA-CROSS-002'), {
      checkOut: {
        timestamp: '2026-08-21T18:00:00.000Z',
        withinGeofence: false,
        accuracyAccepted: false,
        source: 'manual_admin',
      },
      workingHours: 9,
    }));
  });

  it('GroupAdmin without groupId on the payload CANNOT create (fails closed)', async () => {
    await assertFails(
      setDoc(doc(groupAdminADb(), 'attendance', 'ATT-GA-NOGROUP-001'), {
        id: 'ATT-GA-NOGROUP-001',
        companyId: COMPANY_A,
        // groupId intentionally omitted — must fail closed, not fall through
        employeeId: 'EMP-TARGET-005',
        employee: 'Target Employee 5',
        date: '2026-08-21',
        checkIn: {
          timestamp: '2026-08-21T09:00:00.000Z',
          withinGeofence: false,
          accuracyAccepted: false,
          source: 'manual_admin',
        },
        createdBy: GROUP_ADMIN_A_USER_ID,
      }),
    );
  });

  it('GroupAdmin B in their own Group is unaffected (sanity, sibling Group)', async () => {
    await assertSucceeds(
      setDoc(doc(groupAdminBDb(), 'attendance', 'ATT-GA-B-001'), {
        id: 'ATT-GA-B-001',
        companyId: COMPANY_B,
        groupId: GROUP_B,
        employeeId: 'EMP-TARGET-006',
        employee: 'Target Employee 6',
        date: '2026-08-21',
        checkIn: {
          timestamp: '2026-08-21T09:00:00.000Z',
          withinGeofence: false,
          accuracyAccepted: false,
          source: 'manual_admin',
        },
        createdBy: GROUP_ADMIN_B_USER_ID,
      }),
    );
  });
});
