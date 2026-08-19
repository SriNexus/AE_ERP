/**
 * groupAdmin.ts — Group Admin control-plane mutations (Phase 5, Master Plan
 * §7).
 *
 * This module is the client write path for the Group Admin's SELF-SERVICE
 * capabilities (§7.9): adding a SECOND Group Admin for the actor's own Group,
 * and creating a Company inside the actor's own Group (§7.3). It deliberately
 * uses RAW Firestore writes for the groupId-bearing paths for the same reason
 * platformAdmin.ts does — the generic write helpers STRIP client-supplied
 * groupId by Phase 1 design (§3.4) and only re-stamp the value derived from
 * the target company, but `group_members` and a new Company's `groupId` are
 * exactly the cases where the actor's authoritative Group is the assigner.
 *
 * The Firestore rules are the real security boundary for every write here:
 *   - group_members create requires an active GroupAdmin of that exact Group,
 *     grantedBy == the actor, target != self (§7.9/§3.1 — Phase 5).
 *   - companies create requires groupId == actorGroupId() + Active Group
 *     (§5.2/§7.3 — Phase 2, reused unchanged).
 * A Group Admin can NEVER cross the Group boundary through this module: the
 * groupId used is always the actor's own authoritative Group from the trusted
 * store identity, never a client-supplied value.
 */

import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, COLLECTIONS, firebaseEnv } from './firebase';
import { useAppStore } from '../store/useAppStore';
import { genId } from './firestore';
import { logRoleChange, logSecurityEvent, logCreate, logUpdate } from './auditLogger';

const NOT_CONFIGURED_MSG = 'Firebase is not configured. This application requires a valid Firebase configuration.';

export type GroupAdminIdentity = {
  actorId: string;
  groupId: string;
};

/** Fail-closed GroupAdmin gate: requires an active GroupAdmin identity with a real Group. */
export function requireGroupAdminIdentity(): GroupAdminIdentity {
  const state = useAppStore.getState();
  const user = state.user;
  if (!user || user.role !== 'GroupAdmin' || user.status === 'Inactive') {
    throw new Error('Group Admin operations require an active Group Admin identity.');
  }
  const groupId = user.groupId || '';
  if (!groupId) {
    throw new Error('Group Admin identity has no Group assigned. Contact the Super Admin.');
  }
  return { actorId: user.id || 'system', groupId };
}

// ── §7.9: Self-service second Group Admin ───────────────────

export type GrantGroupAdminInput = {
  userId: string;
  userEmail: string;
  currentRole: string;
};

/**
 * Add a SECOND Group Admin for the actor's own Group (§7.9). The member
 * record is created FIRST (deterministic id `${groupId}_${userId}`,
 * grantedBy = the actor) and the target user's role is then promoted — the
 * users-update rule's exists() guard on the member doc makes the ordering
 * mandatory at the rules layer, so a role-only promotion without the
 * auditable membership record can never happen. Never the actor themself:
 * requireGroupAdminIdentity() + the group_members create rule's
 * `userId != currentUserId()` guard both forbid self-grant. Revoke remains a
 * platform-tier (Super Admin) operation — the group_members update rule is
 * unchanged (§7.9 scopes self-service to ADD).
 */
export async function grantGroupAdminForGroup(
  _groupId: string,
  input: GrantGroupAdminInput,
): Promise<void> {
  if (!firebaseEnv.isConfigured) throw new Error(NOT_CONFIGURED_MSG);
  // Fail closed: the authoritative Group is the ACTOR's, never a caller-
  // supplied groupId (the rules enforce groupId == actorGroupId() as the real
  // boundary; the client never even reads the passed value).
  const { actorId, groupId } = requireGroupAdminIdentity();

  // Self-grant is forbidden at the rules layer (userId != currentUserId); the
  // client fails closed BEFORE any write as defense-in-depth.
  if (input.userId === actorId) {
    throw new Error('A Group Admin cannot grant themselves the Group Admin role.');
  }

  const memberId = `${groupId}_${input.userId}`;
  // 1) group_members create FIRST (rules: active GroupAdmin of this group,
  //    grantedBy == actor, target != self).
  await setDoc(doc(db, COLLECTIONS.GROUP_MEMBERS, memberId), {
    id: memberId,
    groupId,
    userId: input.userId,
    role: 'GroupAdmin',
    status: 'Active',
    grantedBy: actorId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    isDeleted: false,
  });

  // 2) users role promotion (rules: same-group, groupId unchanged,
  //    isSuperAdmin unchanged, member doc exists, target != self).
  await updateDoc(doc(db, COLLECTIONS.USERS, input.userId), {
    role: 'GroupAdmin',
    groupId,
    updatedBy: actorId,
    updatedAt: serverTimestamp(),
  });

  await logRoleChange(input.userId, input.userEmail, input.currentRole, 'GroupAdmin');
  await logSecurityEvent('group_admin_grant', `Group Admin granted for ${input.userEmail}`, {
    groupId,
    userId: input.userId,
  });
}

// ── §7.3: Company creation inside the actor's own Group ─────

export type GroupCompanyInput = {
  name: string;
  shortName?: string;
  businessMode?: string;
  [key: string]: unknown;
};

/**
 * Create a Company inside the actor's own Group (§7.3). groupId is the
 * actor's authoritative Group — never a form field. The rules require
 * groupId == actorGroupId() + Active Group, so a forged groupId (e.g. a
 * different Group) is rejected even if this client tried to send one.
 */
export async function createCompanyInGroup(input: GroupCompanyInput): Promise<{ id: string }> {
  if (!firebaseEnv.isConfigured) throw new Error(NOT_CONFIGURED_MSG);
  const { actorId, groupId } = requireGroupAdminIdentity();

  const id = genId.generic('CO');
  const { name, ...rest } = input;
  const payload = {
    id,
    companyId: id,
    groupId,
    name: String(name || '').trim(),
    status: 'Active',
    isDeleted: false,
    ...rest,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(doc(db, COLLECTIONS.COMPANIES, id), payload);
  await logCreate('company', id, { name: payload.name, groupId, status: payload.status }, 'companies');
  return { id };
}

/**
 * Update a Company inside the actor's own Group (§7.3 Edit flow). Raw write:
 * updateDocById() strips groupId for companies (GROUP_ID_EXCLUDED), but the
 * companies update rule requires the request to carry groupId == the actor's
 * authoritative Group — so the Group Admin edit path supplies it explicitly
 * (never a form field). The rules also enforce groupIdUnchanged() and
 * companyIdUnchanged(), so this can never re-point a Company to another Group.
 */
export async function updateCompanyInGroup(id: string, input: Record<string, unknown>): Promise<void> {
  if (!firebaseEnv.isConfigured) throw new Error(NOT_CONFIGURED_MSG);
  const { actorId, groupId } = requireGroupAdminIdentity();

  const { groupId: _strip, ...rest } = input as { groupId?: string; [key: string]: unknown };
  await updateDoc(doc(db, COLLECTIONS.COMPANIES, id), {
    ...rest,
    groupId,
    updatedBy: actorId,
    updatedAt: serverTimestamp(),
  });
  await logUpdate('company', id, {}, { ...rest, groupId }, 'companies');
}
