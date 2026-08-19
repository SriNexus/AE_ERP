import { batchCreate, createDocWithId, deleteDocById, getOne, resolveWriteCompanyId, resolveWriteGroupId, updateDocById } from './firestore';
import { COLLECTIONS } from './firebase';
import { addEntityRole, createOrResolveEntity, softDeleteEntity, updateEntity } from './entities';
import {
  mapCustomerToEntity,
  mapEmployeeToEntity,
  mapLeadToEntity,
  mapUserToEntity,
} from './entityMappers';
import { createOrResolveUserByPhone, getProjectionRole } from './userIdentity';
import { useAppStore } from '../store/useAppStore';

type ProjectionCollection =
  | typeof COLLECTIONS.LEADS
  | typeof COLLECTIONS.CUSTOMERS
  | typeof COLLECTIONS.EMPLOYEES
  | typeof COLLECTIONS.USERS;

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Tenant safety (Admin companyId='default' 403-storm root cause, entity-
 * creation instance): this previously duplicated resolveWriteCompanyId()'s
 * logic with its own local `activeCompanyId !== 'all'` check — which did NOT
 * exclude the neutral 'default' placeholder, so a truthy `activeCompanyId ===
 * 'default'` (the pre-boot/post-logout state) was returned as-is, and the
 * final fallback was the literal string 'default' rather than failing
 * closed. Any entity created while activeCompanyId briefly held 'default'
 * (e.g. an owner/super-admin session mid pre-boot resolution) would be
 * silently stamped with the forbidden 'default' tenant — including new ERP
 * users created via the Admin "Add User" flow, since createProjectionWithUserId
 * routes through this function. Delegating to the canonical
 * resolveWriteCompanyId() (lib/firestore.ts) removes the duplicated logic and
 * guarantees the same fail-closed behavior ('' when no real company is
 * resolvable) used everywhere else in the app.
 */
function systemCompanyId(payload: Record<string, unknown>): string {
  return stringValue(payload.companyId) || resolveWriteCompanyId();
}

function systemUserId(payload: Record<string, unknown>, field: 'createdBy' | 'updatedBy'): string {
  return stringValue(payload[field])
    || stringValue(useAppStore.getState().user?.id)
    || 'system';
}

function hydrateCreatePayload<T extends Record<string, unknown>>(payload: T): T & { companyId: string; createdBy: string; updatedBy: string; groupId?: string } {
  const createdBy = systemUserId(payload, 'createdBy');
  const companyId = systemCompanyId(payload);
  // Phase 1 (Multi-Tenant, Master Plan §3.2 users): groupId is denormalized
  // from the user's companyId's owning Group at write time — NEVER
  // client-supplied. Any client-supplied groupId is stripped unconditionally
  // and the authoritative value (derived from companyId's owning Group) is
  // stamped instead; when no group resolves, the field is omitted entirely
  // (fail closed, matching resolveWriteGroupId's '' contract). For non-users
  // projections the downstream createDocWithId/batchCreate strip and
  // re-stamp anyway; for the users write path (which routes through
  // updateDocById, not the stamped helpers) this is the authoritative
  // stamping point.
  const { groupId: _clientGroupId, ...rest } = payload;
  const groupId = companyId ? resolveWriteGroupId(companyId) : '';
  return {
    ...rest,
    companyId,
    ...(groupId ? { groupId } : {}),
    createdBy,
    updatedBy: systemUserId(payload, 'updatedBy') || createdBy,
  } as T & { companyId: string; createdBy: string; updatedBy: string; groupId?: string };
}

function hydrateUpdatePayload<T extends Record<string, unknown>>(payload: T): T & { updatedBy: string } {
  return {
    ...payload,
    updatedBy: systemUserId(payload, 'updatedBy'),
  };
}

function mapProjectionToEntity(col: ProjectionCollection, payload: Record<string, unknown>) {
  if (col === COLLECTIONS.LEADS) return mapLeadToEntity(payload);
  if (col === COLLECTIONS.CUSTOMERS) return mapCustomerToEntity(payload);
  if (col === COLLECTIONS.EMPLOYEES) return mapEmployeeToEntity(payload);
  if (col === COLLECTIONS.USERS) return mapUserToEntity(payload);
  throw new Error(`Projection role is not registered for ${col}`);
}

function entityUpdatePayload(entityInput: ReturnType<typeof mapProjectionToEntity>, updatedBy: string) {
  return {
    displayName: entityInput.displayName,
    legalName: entityInput.legalName,
    phones: entityInput.phones,
    emails: entityInput.emails,
    addresses: entityInput.addresses,
    ...(entityInput.leadData ? { leadData: entityInput.leadData } : {}),
    ...(entityInput.customerData ? { customerData: entityInput.customerData } : {}),
    ...(entityInput.employeeData ? { employeeData: entityInput.employeeData } : {}),
    ...(entityInput.userData ? { userData: entityInput.userData } : {}),
    tags: entityInput.tags,
    legacyRefs: entityInput.legacyRefs,
    updatedBy,
  };
}

function projectionUpdateWithoutIdentityOverwrite(payload: Record<string, unknown>) {
  // companyId is deliberately NOT blocked: it is the account's tenant and is a
  // required identity field (authIdentity.validateProfile rejects profiles
  // without it). Stripping it here produced login identities with no company,
  // which also duplicated the email against the MUSR master doc created by the
  // same projection flow (ambiguous-identity on login).
  const blocked = new Set([
    'id',
    'userId',
    'identityPhone',
    'roles',
    'linkedModules',
    'profile',
    'filters',
    'createdAt',
    'createdBy',
  ]);
  return Object.fromEntries(
    Object.entries(payload).filter(([key, value]) => !blocked.has(key) && value !== undefined)
  );
}

async function attachUserId<T extends Record<string, unknown>>(col: ProjectionCollection, id: string, payload: T): Promise<T & { userId: string }> {
  const config = getProjectionRole(col);
  const preferredId = col === COLLECTIONS.USERS ? id : undefined;
  const userId = await createOrResolveUserByPhone(payload, config.role, preferredId);
  return { ...payload, [config.ownerField]: userId } as T & { userId: string };
}

async function attachEntityId<T extends Record<string, unknown>>(col: ProjectionCollection, payload: T): Promise<T & { entityId: string }> {
  const entityInput = mapProjectionToEntity(col, payload);
  const result = await createOrResolveEntity(entityInput);
  if (!result.entity?.id) throw new Error('Entity relation could not be resolved');
  if (result.matched) {
    const updatedBy = stringValue(payload.updatedBy) || stringValue(payload.createdBy) || 'system';
    await addEntityRole(result.entity.id, entityInput.primaryRole, updatedBy);
    await updateEntity(result.entity.id, entityUpdatePayload(entityInput, updatedBy));
  }
  return { ...payload, entityId: result.entity.id };
}

export async function createProjectionWithUserId<T extends Record<string, unknown>>(
  col: ProjectionCollection,
  id: string,
  payload: T
) {
  const hydrated = hydrateCreatePayload({ ...payload, id });
  const withUser = await attachUserId(col, id, hydrated);
  const withEntity = await attachEntityId(col, withUser);
  if (col === COLLECTIONS.USERS) {
    // users write path bypasses the groupId-stamping write helpers (USERS is
    // excluded from the generic auto-stamp by design — it has its own groupId
    // semantics per Master Plan §3.2) — hydrateCreatePayload already stamped
    // the authoritative groupId derived from companyId above.
    await updateDocById(col, id, projectionUpdateWithoutIdentityOverwrite(withEntity));
    return getOne(col, id);
  }
  return createDocWithId(col, id, withEntity);
}

export async function batchCreateProjectionsWithUserId<T extends Record<string, unknown>>(
  col: ProjectionCollection,
  items: T[]
) {
  const payload = await Promise.all(items.map(async (item) => {
    const id = stringValue(item.id);
    const hydrated = hydrateCreatePayload({ ...item, id });
    const withUser = await attachUserId(col, id, hydrated);
    return attachEntityId(col, withUser);
  }));
  return batchCreate(col, payload);
}

export async function updateProjectionWithEntity<T extends Record<string, unknown>>(
  col: ProjectionCollection,
  id: string,
  payload: T
) {
  const current = await getOne<Record<string, unknown>>(col, id);
  let hydrated = hydrateUpdatePayload(payload);
  // Phase 1 (Multi-Tenant): keep users.groupId denormalized on update —
  // re-derive from the effective companyId (payload companyId wins, else the
  // existing doc's) so an admin reassigning a user to another company moves
  // their groupId with them (companyId stays immutable at the rules layer;
  // groupId follows the derived relationship).
  if (col === COLLECTIONS.USERS) {
    // Phase 1 (Multi-Tenant): users.groupId is NEVER client-controlled — any
    // client-supplied value is stripped and the authoritative value is
    // re-derived from the effective companyId (payload companyId wins, else
    // the existing doc's), so an admin reassigning a user to another company
    // moves their groupId with them (companyId stays immutable at the rules
    // layer; groupId follows the derived relationship). When no group
    // resolves the field is dropped entirely (fail closed).
    const { groupId: _clientGroupId, ...restHydrated } = hydrated as Record<string, unknown>;
    const companyForGroup = stringValue(restHydrated.companyId) || stringValue(current?.companyId);
    const groupId = companyForGroup ? resolveWriteGroupId(companyForGroup) : '';
    // Only stamp when a group actually resolves — when it does not (pre-boot
    // window, unmapped company) the field is left ABSENT so an existing
    // valid value on the doc is never zeroed (fail closed = do no harm).
    if (groupId) {
      restHydrated.groupId = groupId;
    }
    hydrated = restHydrated as typeof hydrated;
  }
  await updateDocById(col, id, hydrated);

  let entityId = stringValue(current?.entityId);
  if (!entityId && current) {
    const withEntity = await attachEntityId(col, {
      ...current,
      ...hydrated,
      id,
      companyId: current.companyId || systemCompanyId(current),
      createdBy: current.createdBy || systemUserId(current, 'updatedBy'),
    });
    entityId = withEntity.entityId;
    await updateDocById(col, id, { entityId, updatedBy: systemUserId(payload, 'updatedBy') });
  }

  if (entityId) {
    const entityInput = mapProjectionToEntity(col, {
      ...(current || {}),
      ...hydrated,
      id,
      companyId: current?.companyId || systemCompanyId(current || payload),
      createdBy: current?.createdBy || systemUserId(payload, 'updatedBy'),
    });
    await updateEntity(entityId, {
      ...entityUpdatePayload(entityInput, systemUserId(payload, 'updatedBy')),
    });
  }
}

export async function deleteProjectionWithEntity(col: ProjectionCollection, id: string) {
  const current = await getOne<Record<string, unknown>>(col, id);
  await deleteDocById(col, id);

  const entityId = stringValue(current?.entityId);
  if (entityId) {
    await softDeleteEntity(entityId, systemUserId(current || {}, 'updatedBy'));
  }
}
