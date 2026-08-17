import type {
  ProjectionRoleRegistration,
  ProjectionSafePayload,
  UserIdentityConsistencyIssue,
  UserIdentityRecord,
  UserIdentityRole,
  UserIdentityUniquenessKey,
} from './userIdentity.types';

const SUPPORTED_ROLES: readonly UserIdentityRole[] = [
  'Lead',
  'Customer',
  'Employee',
  'User',
  'Driver',
  'Vendor',
  'InstallationPartner',
  'FieldAgent',
];

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeIdentityPhone(value: unknown): string {
  const digits = stringValue(value).replace(/\D/g, '');
  if (digits.length > 10) return digits.slice(-10);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

export function phoneFromPayload(payload: ProjectionSafePayload): string {
  return normalizeIdentityPhone(payload.phone || payload.mobile || payload.businessPhone);
}

export function uniqueIdentityValues(values: readonly unknown[]): string[] {
  return Array.from(new Set(values.map(stringValue).filter(Boolean))).sort();
}

export function getIdentityUniquenessKey(companyId: string, identityPhone: string): UserIdentityUniquenessKey {
  const normalizedCompanyId = stringValue(companyId);
  const normalizedPhone = normalizeIdentityPhone(identityPhone);
  if (!normalizedCompanyId) throw new Error('companyId is required for user identity uniqueness');
  if (!normalizedPhone) throw new Error('identityPhone is required for user identity uniqueness');
  return { companyId: normalizedCompanyId, identityPhone: normalizedPhone };
}

export function validateIdentityPayload(payload: ProjectionSafePayload): {
  companyId: string;
  identityPhone: string;
  createdBy: string;
} {
  const companyId = stringValue(payload.companyId);
  const identityPhone = phoneFromPayload(payload);

  if (!companyId) throw new Error('companyId is required for user identity');
  if (!identityPhone) throw new Error('phone is required for user identity');

  return {
    companyId,
    identityPhone,
    createdBy: stringValue(payload.createdBy) || 'system',
  };
}

export function validatePhoneOwnership(existingPhone: unknown, incomingPhone: string): void {
  const normalizedExisting = normalizeIdentityPhone(existingPhone);
  const normalizedIncoming = normalizeIdentityPhone(incomingPhone);
  if (!normalizedExisting || normalizedExisting !== normalizedIncoming) {
    throw new Error('userId phone does not match identity phone');
  }
}

export function validateRoleAssignment(role: UserIdentityRole): void {
  if (!SUPPORTED_ROLES.includes(role)) {
    throw new Error(`Unsupported user identity role ${String(role)}`);
  }
}

export function validateProjectionRegistration(config: ProjectionRoleRegistration): void {
  validateRoleAssignment(config.role);
  if (!config.collection) throw new Error(`Projection collection is required for ${config.role}`);
  if (config.ownerField !== 'userId') throw new Error(`Projection owner field must be userId for ${config.role}`);
}

export function validateIdentityOwnership(record: ProjectionSafePayload, expected: UserIdentityUniquenessKey): void {
  const companyId = stringValue(record.companyId);
  const identityPhone = normalizeIdentityPhone(record.identityPhone || phoneFromPayload(record));
  if (companyId !== expected.companyId) throw new Error('userId company does not match identity company');
  validatePhoneOwnership(identityPhone, expected.identityPhone);
}

export function getRoleLinkedModule(config: ProjectionRoleRegistration): string {
  validateProjectionRegistration(config);
  return config.collection;
}

export function validateIdentityConsistency(
  records: readonly UserIdentityRecord[],
  registry: Readonly<Record<UserIdentityRole, ProjectionRoleRegistration>>
): UserIdentityConsistencyIssue[] {
  const issues: UserIdentityConsistencyIssue[] = [];
  const seen = new Map<string, UserIdentityRecord>();

  for (const record of records) {
    const identityPhone = normalizeIdentityPhone(record.identityPhone);
    if (!identityPhone) {
      issues.push({ code: 'missing_identity_phone', userId: record.id, companyId: record.companyId });
      continue;
    }

    const key = `${record.companyId}:${identityPhone}`;
    const existing = seen.get(key);
    if (existing && existing.id !== record.id) {
      issues.push({
        code: 'duplicate_identity_phone',
        userId: record.id,
        companyId: record.companyId,
        identityPhone,
      });
    } else {
      seen.set(key, record);
    }

    for (const role of record.roles || []) {
      const linkedModule = registry[role]?.collection;
      if (!linkedModule) {
        issues.push({ code: 'missing_role', userId: record.id, role });
      } else if (!record.linkedModules?.includes(linkedModule)) {
        issues.push({ code: 'missing_linked_module', userId: record.id, role, linkedModule });
      }
    }
  }

  return issues;
}
