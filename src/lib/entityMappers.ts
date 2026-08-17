import type { EntityContact, EntityCreateInput } from './entityTypes';
import { resolveWriteCompanyId } from './firestore';
import { useAppStore } from '../store/useAppStore';

type UnknownRecord = Record<string, unknown>;

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

// Tenant safety: delegates to the canonical resolveWriteCompanyId() (see
// lib/firestore.ts) instead of a local duplicate that treated the neutral
// 'default' placeholder as real and fell back to the literal string
// 'default' — the same bug class fixed in entityProjection.ts's
// systemCompanyId (Admin companyId='default' 403-storm root cause).
function systemCompanyId(input: UnknownRecord): string {
  return stringValue(input.companyId) || resolveWriteCompanyId();
}

function systemUserId(input: UnknownRecord, fallback = 'system'): string {
  return stringValue(input.createdBy)
    || stringValue(input.updatedBy)
    || stringValue(useAppStore.getState().user?.id)
    || fallback;
}

function contact(value: unknown, label?: string): EntityContact[] {
  const normalized = stringValue(value);
  return normalized ? [{ value: normalized, ...(label ? { label } : {}), isPrimary: true }] : [];
}

function addressFrom(input: UnknownRecord) {
  const line1 = stringValue(input.address) || stringValue(input.shippingAddress);
  const city = stringValue(input.city);
  const state = stringValue(input.state);
  const pincode = stringValue(input.pincode);

  if (!line1 && !city && !state && !pincode) return [];

  return [{
    ...(line1 ? { line1 } : {}),
    ...(city ? { city } : {}),
    ...(state ? { state } : {}),
    ...(pincode ? { pincode } : {}),
    isPrimary: true,
  }];
}

function baseInput(
  input: UnknownRecord,
  primaryRole: EntityCreateInput['primaryRole'],
  createdByFallback = 'system'
): Pick<EntityCreateInput, 'companyId' | 'primaryRole' | 'roles' | 'displayName' | 'legalName' | 'phones' | 'emails' | 'addresses' | 'tags' | 'createdBy'> {
  const displayName =
    stringValue(input.name) ||
    stringValue(input.company) ||
    stringValue(input.displayName) ||
    stringValue(input.email) ||
    stringValue(input.phone);

  return {
    companyId: systemCompanyId(input),
    primaryRole,
    roles: [primaryRole],
    displayName,
    legalName: stringValue(input.legalName) || stringValue(input.company) || displayName,
    phones: contact(input.phone || input.mobile, 'Primary'),
    emails: contact(input.email || input.businessEmail, 'Primary'),
    addresses: addressFrom(input),
    tags: [],
    createdBy: systemUserId(input, createdByFallback),
  };
}

export function mapLeadToEntity(input: UnknownRecord): EntityCreateInput {
  return {
    ...baseInput(input, 'Lead'),
    leadData: { ...input },
    legacyRefs: {
      leadId: stringValue(input.id),
    },
  };
}

export function mapCustomerToEntity(input: UnknownRecord): EntityCreateInput {
  return {
    ...baseInput(input, 'Customer'),
    customerData: { ...input },
    legacyRefs: {
      customerId: stringValue(input.id),
      leadId: stringValue(input.sourceLeadId),
    },
  };
}

export function mapEmployeeToEntity(input: UnknownRecord): EntityCreateInput {
  return {
    ...baseInput(input, 'Employee'),
    employeeData: { ...input },
    legacyRefs: {
      employeeId: stringValue(input.id),
      userId: stringValue(input.userId),
    },
  };
}

export function mapUserToEntity(input: UnknownRecord): EntityCreateInput {
  return {
    ...baseInput(input, 'User'),
    userData: {
      id: input.id,
      role: input.role,
      managerId: input.managerId,
      warehouseId: input.warehouseId,
      status: input.status,
    },
    legacyRefs: {
      userId: stringValue(input.id),
      employeeId: stringValue(input.employeeId),
    },
  };
}
