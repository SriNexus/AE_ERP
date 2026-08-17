import { createDocWithId, genId, getOne, updateDocById } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { resolveOrCreateMasterUser } from '../lib/userIdentity';

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
}
