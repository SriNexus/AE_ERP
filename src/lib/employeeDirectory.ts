/**
 * employeeDirectory — Employee <-> AppUser <-> Warehouse join helpers
 *
 * Phase 12: warehouseId/managerId live on AppUser (COLLECTIONS.USERS), not
 * on Employee (COLLECTIONS.EMPLOYEES) — confirmed still true this phase.
 * The link itself already exists (Option A, "link" not "consolidate"):
 * EmployeeDomainService.create() already resolves/creates a master User and
 * stores its id as Employee.userId. What was missing was anywhere that
 * actually reads through that link — "which warehouse does this employee
 * work at" and "who is their reporting manager" were structurally
 * unanswerable in the UI despite the FK already existing in the data.
 *
 * A reverse AppUser.employeeId pointer was deliberately not added — every
 * required query (employee->warehouse, employee->manager, employee->team,
 * warehouse->employee-count) is resolvable from the existing one-directional
 * Employee.userId link plus a full employees scan, which every one of these
 * queries already needs anyway (there is no per-user index available client
 * side that a reverse pointer would let us skip).
 */

export interface DirectoryUser {
  id: string;
  name?: string;
  warehouseId?: string;
  managerId?: string;
}

export interface DirectoryWarehouse {
  id: string;
  name?: string;
}

export interface DirectoryEmployee {
  id: string;
  userId?: string;
  isDeleted?: boolean;
}

export function buildUserMap<T extends DirectoryUser>(users: T[]): Map<string, T> {
  return new Map(users.map((u) => [u.id, u]));
}

export function buildWarehouseMap<T extends DirectoryWarehouse>(warehouses: T[]): Map<string, T> {
  return new Map(warehouses.map((w) => [w.id, w]));
}

export interface EmployeeWarehouseInfo {
  warehouseId: string;
  warehouseName: string;
  managerId: string;
  managerName: string;
}

const EMPTY_INFO: EmployeeWarehouseInfo = { warehouseId: '', warehouseName: '', managerId: '', managerName: '' };

/** Resolves an Employee's warehouse and reporting manager via its linked User. */
export function resolveEmployeeWarehouseInfo(
  employee: DirectoryEmployee | null | undefined,
  usersById: Map<string, DirectoryUser>,
  warehousesById: Map<string, DirectoryWarehouse>,
): EmployeeWarehouseInfo {
  if (!employee?.userId) return EMPTY_INFO;
  const user = usersById.get(employee.userId);
  if (!user) return EMPTY_INFO;

  const warehouseId = user.warehouseId || '';
  const warehouse = warehouseId ? warehousesById.get(warehouseId) : undefined;
  const managerId = user.managerId || '';
  const manager = managerId ? usersById.get(managerId) : undefined;

  return {
    warehouseId,
    warehouseName: warehouse?.name || '',
    managerId,
    managerName: manager?.name || '',
  };
}

/** Real, query-backed warehouse-wise employee counts (excludes soft-deleted employees). */
export function getWarehouseEmployeeCounts(
  employees: DirectoryEmployee[],
  usersById: Map<string, DirectoryUser>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const employee of employees) {
    if (employee.isDeleted) continue;
    const user = employee.userId ? usersById.get(employee.userId) : undefined;
    const warehouseId = user?.warehouseId;
    if (!warehouseId) continue;
    counts.set(warehouseId, (counts.get(warehouseId) || 0) + 1);
  }
  return counts;
}

/** Real, query-backed direct-report lookup: every Employee whose linked User reports to managerId. */
export function getDirectReportEmployeeIds(
  managerId: string,
  employees: DirectoryEmployee[],
  usersById: Map<string, DirectoryUser>,
): string[] {
  if (!managerId) return [];
  return employees
    .filter((employee) => {
      if (employee.isDeleted || !employee.userId) return false;
      const user = usersById.get(employee.userId);
      return user?.managerId === managerId;
    })
    .map((employee) => employee.id);
}
