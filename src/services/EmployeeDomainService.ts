import { collection, getDocs, query, where } from 'firebase/firestore';
import { createDocWithId, genId, getOne, updateDocById } from '../lib/firestore';
import { COLLECTIONS, db } from '../lib/firebase';
import { masterUserId, normalizePhone, resolveOrCreateMasterUser } from '../lib/userIdentity';

type EmployeeDelta = Record<string, unknown>;

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function compactDelta(delta: EmployeeDelta) {
  return Object.fromEntries(
    Object.entries(delta).filter(([, value]) => value !== undefined && value !== null)
  );
}

// Phase 12: warehouseId/managerId are User-domain fields (Option A — link,
// not consolidate). They never live on the Employee document itself, so
// they're excluded here rather than spread onto COLLECTIONS.EMPLOYEES,
// keeping a single source of truth instead of two copies that could drift.
function omitUserOnlyFields(delta: EmployeeDelta): EmployeeDelta {
  const { warehouseId, managerId, ...rest } = delta;
  return rest;
}

export class EmployeeDomainService {
  static async create(employeeData: EmployeeDelta): Promise<string> {
    const companyId = stringValue(employeeData.companyId);
    const phone = stringValue(employeeData.phone);
    if (!companyId) throw new Error('companyId is required for employee creation');
    if (!phone) throw new Error('phone is required for employee creation');

    const masterUser = await resolveOrCreateMasterUser(phone, companyId, {
      name: stringValue(employeeData.name),
      email: stringValue(employeeData.email),
      role: stringValue(employeeData.role) || 'Employee',
      linkedModules: ['employees'],
      createdBy: stringValue(employeeData.createdBy),
    });

    const userDelta = compactDelta({ warehouseId: employeeData.warehouseId, managerId: employeeData.managerId });
    if (Object.keys(userDelta).length > 0) {
      await updateDocById(COLLECTIONS.USERS, masterUser.id, userDelta);
    }

    const employeeId = stringValue(employeeData.id) || genId.employee();
    await createDocWithId(COLLECTIONS.EMPLOYEES, employeeId, {
      ...omitUserOnlyFields(employeeData),
      id: employeeId,
      companyId,
      userId: masterUser.id,
    });
    return employeeId;
  }

  static async update(employeeId: string, delta: EmployeeDelta): Promise<void> {
    const employee = await getOne<Record<string, unknown>>(COLLECTIONS.EMPLOYEES, employeeId);
    await updateDocById(COLLECTIONS.EMPLOYEES, employeeId, compactDelta(omitUserOnlyFields(delta)));

    const userId = stringValue(employee?.userId);
    const userDelta = compactDelta({
      name: delta.name,
      phone: delta.phone,
      warehouseId: delta.warehouseId,
      managerId: delta.managerId,
    });
    if (userId && Object.keys(userDelta).length > 0) {
      await updateDocById(COLLECTIONS.USERS, userId, userDelta);
    }
  }

  /**
   * User → Employee provisioning (closes the "user created but no
   * corresponding Employee/HR record" gap).
   *
   * Called after a new login-capable User is created (Users.tsx), never the
   * other way around — `create()` above already handles Employee-first
   * provisioning via resolveOrCreateMasterUser(), which this method
   * deliberately does NOT call: `userId` here is already a real,
   * just-created Firebase-Auth-keyed users/{id} document, so no further
   * phone-based identity resolution is needed (and calling it again would
   * itself create a second, MUSR-prefixed users/ document — the very
   * duplicate-user bug createProjectionWithUserId() was fixed for).
   *
   * Idempotent / duplicate-safe:
   *  - a User already linked to an Employee (Employee.userId === userId)
   *    is returned as-is — never creates a second Employee for one login.
   *  - an EXISTING Employee that predates this login (created by HR via
   *    `create()` above, which links Employee.userId to a deterministic
   *    MUSR-{companyId}-{phone} identity — never a raw phone-string
   *    comparison, which would be unreliable against inconsistently
   *    formatted Employee.phone values) is re-linked to this real login
   *    instead of leaving a duplicate, unlinked Employee behind.
   *  - only when neither match is found is a brand-new Employee created.
   */
  static async linkOrCreateForUser(
    userId: string,
    userData: {
      name?: unknown; phone?: unknown; email?: unknown; role?: unknown;
      companyId: string; createdBy?: unknown;
    },
  ): Promise<string> {
    const companyId = stringValue(userData.companyId);
    if (!companyId) throw new Error('companyId is required to link an employee');
    const createdBy = stringValue(userData.createdBy) || 'system';

    const alreadyLinked = await findEmployeeByUserId(companyId, userId);
    if (alreadyLinked) return alreadyLinked.id;

    const phone = normalizePhone(stringValue(userData.phone));
    if (phone) {
      const candidateMusrId = masterUserId(companyId, phone);
      const byMasterIdentity = await findEmployeeByUserId(companyId, candidateMusrId);
      if (byMasterIdentity) {
        await updateDocById(COLLECTIONS.EMPLOYEES, byMasterIdentity.id, { userId });
        return byMasterIdentity.id;
      }
    }

    const employeeId = genId.employee();
    await createDocWithId(COLLECTIONS.EMPLOYEES, employeeId, {
      id: employeeId,
      companyId,
      userId,
      name: stringValue(userData.name),
      phone: stringValue(userData.phone),
      email: stringValue(userData.email),
      role: stringValue(userData.role) || 'Employee',
      status: 'Active',
      createdBy,
    });
    return employeeId;
  }
}

async function findEmployeeByUserId(companyId: string, userId: string): Promise<{ id: string } | null> {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.EMPLOYEES),
    where('companyId', '==', companyId),
    where('userId', '==', userId),
  ));
  const live = snap.docs.filter((d) => (d.data() as Record<string, unknown>).isDeleted !== true);
  return live.length > 0 ? { id: live[0].id } : null;
}
