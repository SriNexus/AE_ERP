import { COLLECTIONS } from './firebase';
import { getAll, getOne } from './firestore';

type UnknownRecord = Record<string, unknown>;

export type IdentityUser = {
  id: string;
  name?: string;
  email?: string;
  role?: string;
  roleId?: string;
  companyId?: string;
  employeeId?: string;
  managerId?: string;
  warehouseId?: string;
  status?: string;
  raw: UnknownRecord;
};

export type IdentityEmployee = {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  userId?: string;
  companyId?: string;
  department?: string;
  designation?: string;
  managerId?: string;
  managerEmployeeId?: string;
  status?: string;
  raw: UnknownRecord;
};

export type IdentityRole = {
  id: string;
  name?: string;
  description?: string;
  permissions?: unknown;
  raw: UnknownRecord;
};

export type IdentityGraphNode = {
  user?: IdentityUser;
  employee?: IdentityEmployee;
  role?: IdentityRole;
  managerUser?: IdentityUser;
  managerEmployee?: IdentityEmployee;
};

const isRecord = (value: unknown): value is UnknownRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const asRecord = (value: unknown): UnknownRecord => (isRecord(value) ? value : {});

const stringValue = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  return undefined;
};

const normalizedEmail = (value: unknown): string | undefined =>
  stringValue(value)?.toLowerCase();

const normalizedName = (value: unknown): string | undefined =>
  stringValue(value)?.toLowerCase();

const hasId = <T extends { id: string }>(value: T | undefined): value is T =>
  Boolean(value?.id);

export function normalizeUser(record: unknown): IdentityUser {
  const data = asRecord(record);

  return {
    id: stringValue(data.id) || '',
    name: stringValue(data.name) || stringValue(data.displayName) || stringValue(data.fullName),
    email: stringValue(data.email),
    role: stringValue(data.role),
    roleId: stringValue(data.roleId),
    companyId: stringValue(data.companyId),
    employeeId: stringValue(data.employeeId),
    managerId: stringValue(data.managerId),
    warehouseId: stringValue(data.warehouseId),
    status: stringValue(data.status),
    raw: data,
  };
}

export function normalizeEmployee(record: unknown): IdentityEmployee {
  const data = asRecord(record);

  return {
    id: stringValue(data.id) || '',
    name: stringValue(data.name) || stringValue(data.fullName),
    email: stringValue(data.email),
    phone: stringValue(data.phone),
    userId: stringValue(data.userId),
    companyId: stringValue(data.companyId),
    department: stringValue(data.department) || stringValue(data.dept),
    designation: stringValue(data.designation) || stringValue(data.position),
    managerId: stringValue(data.managerId),
    managerEmployeeId: stringValue(data.managerEmployeeId),
    status: stringValue(data.status),
    raw: data,
  };
}

export function normalizeRole(record: unknown): IdentityRole {
  const data = asRecord(record);

  return {
    id: stringValue(data.id) || '',
    name: stringValue(data.name),
    description: stringValue(data.description),
    permissions: data.permissions,
    raw: data,
  };
}

export async function getUsers(): Promise<IdentityUser[]> {
  const users = await getAll<UnknownRecord>(COLLECTIONS.USERS);
  return users.map(normalizeUser).filter(hasId);
}

export async function getEmployees(): Promise<IdentityEmployee[]> {
  const employees = await getAll<UnknownRecord>(COLLECTIONS.EMPLOYEES);
  return employees.map(normalizeEmployee).filter(hasId);
}

export async function getRoles(): Promise<IdentityRole[]> {
  const roles = await getAll<UnknownRecord>(COLLECTIONS.ROLES);
  return roles.map(normalizeRole).filter(hasId);
}

export function findEmployeeForUser(
  user: IdentityUser | undefined,
  employees: IdentityEmployee[]
): IdentityEmployee | undefined {
  if (!user) {
    return undefined;
  }

  if (user.employeeId) {
    const employeeByUserLink = employees.find((employee) => employee.id === user.employeeId);
    if (employeeByUserLink) return employeeByUserLink;
  }

  const employeeByReverseLink = employees.find((employee) => employee.userId === user.id);
  if (employeeByReverseLink) return employeeByReverseLink;

  const userEmail = normalizedEmail(user.email);
  if (!userEmail) {
    return undefined;
  }

  return employees.find((employee) => normalizedEmail(employee.email) === userEmail);
}

export function findRoleForUser(
  user: IdentityUser | undefined,
  roles: IdentityRole[]
): IdentityRole | undefined {
  if (!user) {
    return undefined;
  }

  if (user.roleId) {
    const roleById = roles.find((role) => role.id === user.roleId);
    if (roleById) return roleById;
  }

  const userRole = normalizedName(user.role);
  if (!userRole) {
    return undefined;
  }

  return roles.find((role) => normalizedName(role.name) === userRole);
}

function findManagerUser(
  user: IdentityUser | undefined,
  employee: IdentityEmployee | undefined,
  users: IdentityUser[]
): IdentityUser | undefined {
  const managerUserId = user?.managerId || employee?.managerId;
  if (!managerUserId) {
    return undefined;
  }

  return users.find((candidate) => candidate.id === managerUserId);
}

function findManagerEmployee(
  managerUser: IdentityUser | undefined,
  employee: IdentityEmployee | undefined,
  employees: IdentityEmployee[]
): IdentityEmployee | undefined {
  if (employee?.managerEmployeeId) {
    const directManager = employees.find((candidate) => candidate.id === employee.managerEmployeeId);
    if (directManager) return directManager;
  }

  if (!managerUser) {
    return undefined;
  }

  return findEmployeeForUser(managerUser, employees);
}

async function readUserById(userId: string): Promise<IdentityUser | undefined> {
  if (!userId) {
    return undefined;
  }

  const user = await getOne<UnknownRecord>(COLLECTIONS.USERS, userId);
  return user ? normalizeUser(user) : undefined;
}

async function readEmployeeById(employeeId: string): Promise<IdentityEmployee | undefined> {
  if (!employeeId) {
    return undefined;
  }

  const employee = await getOne<UnknownRecord>(COLLECTIONS.EMPLOYEES, employeeId);
  return employee ? normalizeEmployee(employee) : undefined;
}

export async function getIdentityGraphForUser(userId: string): Promise<IdentityGraphNode> {
  if (!userId) {
    return {};
  }

  const [users, employees, roles] = await Promise.all([
    getUsers(),
    getEmployees(),
    getRoles(),
  ]);

  const user = users.find((candidate) => candidate.id === userId) || await readUserById(userId);
  const employee = findEmployeeForUser(user, employees);
  const role = findRoleForUser(user, roles);
  const managerUser = findManagerUser(user, employee, users);
  const managerEmployee = findManagerEmployee(managerUser, employee, employees);

  return {
    ...(user ? { user } : {}),
    ...(employee ? { employee } : {}),
    ...(role ? { role } : {}),
    ...(managerUser ? { managerUser } : {}),
    ...(managerEmployee ? { managerEmployee } : {}),
  };
}

export async function getTeamUsersForManager(managerUserId: string): Promise<IdentityUser[]> {
  if (!managerUserId) {
    return [];
  }

  const users = await getUsers();
  return users.filter((user) => user.managerId === managerUserId);
}

export async function getTeamEmployeesForManager(
  managerUserIdOrEmployeeId: string
): Promise<IdentityEmployee[]> {
  if (!managerUserIdOrEmployeeId) {
    return [];
  }

  const employees = await getEmployees();
  return employees.filter(
    (employee) =>
      employee.managerId === managerUserIdOrEmployeeId ||
      employee.managerEmployeeId === managerUserIdOrEmployeeId
  );
}

export async function resolveOwnerIdentity(ownerId: string): Promise<IdentityGraphNode> {
  if (!ownerId) {
    return {};
  }

  const [users, employees, roles] = await Promise.all([
    getUsers(),
    getEmployees(),
    getRoles(),
  ]);

  const user = users.find((candidate) => candidate.id === ownerId) || await readUserById(ownerId);
  if (user) {
    const employee = findEmployeeForUser(user, employees);
    const role = findRoleForUser(user, roles);
    const managerUser = findManagerUser(user, employee, users);
    const managerEmployee = findManagerEmployee(managerUser, employee, employees);

    return {
      user,
      ...(employee ? { employee } : {}),
      ...(role ? { role } : {}),
      ...(managerUser ? { managerUser } : {}),
      ...(managerEmployee ? { managerEmployee } : {}),
    };
  }

  const employee =
    employees.find((candidate) => candidate.id === ownerId) ||
    await readEmployeeById(ownerId);
  if (!employee) {
    return {};
  }

  const linkedUser = employee.userId
    ? users.find((candidate) => candidate.id === employee.userId) || await readUserById(employee.userId)
    : users.find((candidate) => normalizedEmail(candidate.email) === normalizedEmail(employee.email));
  const role = findRoleForUser(linkedUser, roles);
  const managerUser = findManagerUser(linkedUser, employee, users);
  const managerEmployee = findManagerEmployee(managerUser, employee, employees);

  return {
    ...(linkedUser ? { user: linkedUser } : {}),
    employee,
    ...(role ? { role } : {}),
    ...(managerUser ? { managerUser } : {}),
    ...(managerEmployee ? { managerEmployee } : {}),
  };
}
