import { batchCreate, createDocWithId, deleteDocById, getOne, hardDelete, resolveWriteCompanyId, resolveWriteGroupId, updateDocById } from './firestore';
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

// Phase 11 (OWNERSHIP-001, Master Plan "Record Ownership / Business
// Authorization Audit"): createdBy/updatedBy are audit-trail identity
// anchors — unlike companyId (systemCompanyId() above), which has a
// rules-layer safety net (sameCompany() independently re-validates any
// client-supplied companyId against the actor), NOTHING re-validates
// createdBy/updatedBy server-side; the generic fallback's
// canCreateCompanyScoped()/canUpdateCompanyScoped() never inspect these
// fields. Previously trusted `payload[field]` FIRST — since this is
// client-side (browser) code, any authenticated user could forge who a
// create/update is attributed to (e.g. `createLeadProjection(id, {
// createdBy: 'someone-else-id', ... })` via devtools, not just the normal
// UI form), corrupting the audit trail every downstream logCreate()/
// logUpdate() and "created/updated by" display relies on. No legitimate
// caller needs the payload value to win — the one call site that supplied
// its own `createdBy` (Users.tsx) always passed its own current user id,
// identical to what the authoritative store already resolves.
function systemUserId(_payload: Record<string, unknown>, _field: 'createdBy' | 'updatedBy'): string {
  return stringValue(useAppStore.getState().user?.id) || 'system';
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

async function attachUserId<T extends Record<string, unknown>>(
  col: ProjectionCollection,
  id: string,
  payload: T,
): Promise<T & { userId: string; __masterIdentityId: string; __masterIdentityCreated: boolean }> {
  const config = getProjectionRole(col);
  const preferredId = col === COLLECTIONS.USERS ? id : undefined;
  const resolved = await createOrResolveUserByPhone(payload, config.role, preferredId);
  return {
    ...payload,
    [config.ownerField]: resolved.id,
    // Internal, stripped by the caller before any Firestore write — carries
    // enough to compensate an orphaned master-identity doc on partial failure.
    __masterIdentityId: resolved.id,
    __masterIdentityCreated: resolved.created,
  } as T & { userId: string; __masterIdentityId: string; __masterIdentityCreated: boolean };
}

// Mirrors compensateOrphanedEntity(): a master-identity users/MUSR-* doc that
// THIS creation flow brought into existence (never a resolved pre-existing
// contact — shared identities are never touched) is hard-deleted if a later
// write in the same createProjectionWithUserId() call throws. Closes the
// non-atomic partial-failure the forensic audit found: W1 (users create) had
// no rollback, so any downstream denial left an orphan users record while the
// Lead itself was never written.
async function compensateOrphanedMasterIdentity(userId: string, justCreated: boolean): Promise<void> {
  if (!justCreated || !userId) return;
  try {
    await hardDelete(COLLECTIONS.USERS, userId);
  } catch {
    // Best-effort — the ORIGINAL error is what the caller must see (matching
    // compensateOrphanedEntity / authProvisioning.ts rollback precedent).
  }
}

/**
 * Duplicate-user root cause fix.
 *
 * For every OTHER projection (Lead/Customer/Employee), attachUserId()'s
 * phone-based master-identity resolution (userIdentity.ts's
 * createOrResolveUserByPhone/resolveOrCreateMasterUser) is genuinely used:
 * its `userId` result is written onto the projection document and is not
 * blocked by that collection's write path.
 *
 * For COLLECTIONS.USERS specifically it is NOT: `userId` is unconditionally
 * stripped by projectionUpdateWithoutIdentityOverwrite()'s blocklist below,
 * so the result of attachUserId() was never actually persisted onto the real
 * users/{authId} document. Its only observable effect was the side effect of
 * createOrResolveUserByPhone()'s "no existing match" branch: it unconditionally
 * creates a NEW users/MUSR-{companyId}-{phone} document — in the SAME
 * `users` collection — seeded from the same name/email/role/status the real
 * user is being created with. Because Users.tsx's list query
 * (getAll(COLLECTIONS.USERS), no filter) renders every document in the
 * collection, that orphaned master-identity document was indistinguishable
 * from a second, real user account: the reported "two NITESH rows" bug.
 *
 * A User's identity is already anchored by the strongest possible key this
 * architecture has — the Firebase Auth UID (`id` here) — so it never needs
 * (and, per the above, was never actually using) phone-based resolution.
 * Genuine cross-module identity linkage for Users is already provided by
 * attachEntityId() below (writes `entityId`, which IS persisted) and by the
 * explicit `employeeId` field a caller may set on the payload — neither of
 * which this skip affects.
 */
function shouldResolveMasterIdentity(col: ProjectionCollection): boolean {
  return col !== COLLECTIONS.USERS;
}

async function attachEntityId<T extends Record<string, unknown>>(col: ProjectionCollection, payload: T): Promise<T & { entityId: string; entityJustCreated: boolean }> {
  const entityInput = mapProjectionToEntity(col, payload);
  const result = await createOrResolveEntity(entityInput);
  if (!result.entity?.id) throw new Error('Entity relation could not be resolved');
  if (result.matched) {
    const updatedBy = stringValue(payload.updatedBy) || stringValue(payload.createdBy) || 'system';
    await addEntityRole(result.entity.id, entityInput.primaryRole, updatedBy);
    await updateEntity(result.entity.id, entityUpdatePayload(entityInput, updatedBy));
  }
  return { ...payload, entityId: result.entity.id, entityJustCreated: result.created === true };
}

// TXN-001 (Phase 5): createOrResolveEntity() genuinely needs a read
// (detectEntityMatch) before it decides whether to create or match — that
// read-then-conditionally-write shape can't be folded into a plain
// writeBatch with the primary-collection write below without a much larger,
// cross-cutting rework of the shared entities/detectEntityMatch machinery
// (used identically by Leads/Customers/Employees/Users), which is out of
// this fix's scope. Instead — mirroring authProvisioning.ts's own
// compensating-delete pattern for the Auth account — a BRAND NEW entity doc
// (never a MATCHED, pre-existing, possibly-shared one) is hard-deleted if
// the subsequent primary-collection write throws, so a failed provisioning
// attempt never leaves a masterless `entities` record behind. Matched
// (pre-existing) entities are never touched here.
async function compensateOrphanedEntity(entityId: string, entityJustCreated: boolean): Promise<void> {
  if (!entityJustCreated) return;
  try {
    await hardDelete(COLLECTIONS.ENTITIES, entityId);
  } catch {
    // Best-effort, matching authProvisioning.ts's own rollback precedent —
    // the ORIGINAL error is what the caller must see; a failed compensation
    // is a (rare) follow-up cleanup concern, not a reason to mask it.
  }
}

export async function createProjectionWithUserId<T extends Record<string, unknown>>(
  col: ProjectionCollection,
  id: string,
  payload: T
) {
  const hydrated = hydrateCreatePayload({ ...payload, id });

  // TXN-002 (forensic audit — non-atomic Lead creation): the master-identity
  // (W1/W2) and entity (W3) writes are performed OUTSIDE the try below in the
  // original code, so any failure there (or in the primary write W4) left an
  // orphan users/MUSR-* doc and a raw permission error while the Lead was never
  // created. All of W1–W4 are now inside one try, and BOTH a just-created
  // master identity AND a just-created entity are compensated on any failure.
  let masterIdentityId = '';
  let masterIdentityCreated = false;
  let entityId = '';
  let entityJustCreated = false;
  try {
    let withUser: Record<string, unknown> = hydrated;
    if (shouldResolveMasterIdentity(col)) {
      const attached = await attachUserId(col, id, hydrated);
      const { __masterIdentityId, __masterIdentityCreated, ...rest } = attached;
      masterIdentityId = __masterIdentityId;
      masterIdentityCreated = __masterIdentityCreated;
      withUser = rest;
    }

    const attachedEntity = await attachEntityId(col, withUser);
    entityId = attachedEntity.entityId;
    entityJustCreated = attachedEntity.entityJustCreated;
    const { entityJustCreated: _drop, ...withEntity } = attachedEntity;

    if (col === COLLECTIONS.USERS) {
      // users write path bypasses the groupId-stamping write helpers (USERS is
      // excluded from the generic auto-stamp by design — it has its own groupId
      // semantics per Master Plan §3.2) — hydrateCreatePayload already stamped
      // the authoritative groupId derived from companyId above.
      await updateDocById(col, id, projectionUpdateWithoutIdentityOverwrite(withEntity));
      return await getOne(col, id);
    }
    return await createDocWithId(col, id, withEntity);
  } catch (error) {
    if (entityId) await compensateOrphanedEntity(entityId, entityJustCreated);
    await compensateOrphanedMasterIdentity(masterIdentityId, masterIdentityCreated);
    throw error;
  }
}

export async function batchCreateProjectionsWithUserId<T extends Record<string, unknown>>(
  col: ProjectionCollection,
  items: T[]
) {
  const payload = await Promise.all(items.map(async (item) => {
    const id = stringValue(item.id);
    const hydrated = hydrateCreatePayload({ ...item, id });
    const { __masterIdentityId: _mid, __masterIdentityCreated: _mc, ...withUser } = await attachUserId(col, id, hydrated);
    const { entityJustCreated: _entityJustCreated, ...withEntity } = await attachEntityId(col, withUser);
    return withEntity;
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

  // User -> Employee cascade: every login-capable User provisioned via
  // Users.tsx gets a linked HR/Employee record (EmployeeDomainService
  // .linkOrCreateForUser stamps users/{id}.employeeId at creation time).
  // Without this, deleting the User left that Employee record behind as an
  // orphan — still Active, still visible in the HR module, with no
  // corresponding login. Soft-deletes the same way every other record in
  // this app is retired (deleteDocById -> isDeleted:true), never a hard
  // delete, so it can still be recovered/audited like any other record.
  if (col === COLLECTIONS.USERS) {
    const employeeId = stringValue(current?.employeeId);
    if (employeeId) {
      await deleteDocById(COLLECTIONS.EMPLOYEES, employeeId);
    }
  }
}
