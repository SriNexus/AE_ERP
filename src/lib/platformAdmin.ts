/**
 * platformAdmin.ts — Super Admin control plane mutations (Phase 4, Master
 * Plan §6).
 *
 * This module is the ONLY client write path for platform-tier collections
 * (groups, group_members, platform_settings) and for the two platform-only
 * mutations that touch tenant documents (GroupAdmin grant/revoke on users,
 * Group bootstrap company). It deliberately uses RAW Firestore writes for the
 * groupId-bearing paths: the generic write helpers (createDoc/createDocWithId/
 * updateDocById) STRIP client-supplied groupId by Phase 1 design (§3.4) and
 * only re-stamp the value derived from the target company — but group_members,
 * users.groupId (on grant) and companies.groupId (on bootstrap) ARE the cases
 * where the platform identity legitimately ASSIGNS the groupId. The Firestore
 * rules are the real security boundary for every one of these writes
 * (owner/Super Admin only, id-anchored, groupId coherence checked per
 * collection) — this module never bypasses them, it just performs the writes
 * the generic helpers were deliberately built not to perform.
 *
 * Every mutation calls logSecurityEvent()/logRoleChange() (F-16: critical
 * platform actions must leave an audit trail; §6.9 requires the emergency
 * controls — Suspend Group, Maintenance Mode — to log severity 'critical').
 */

import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, COLLECTIONS, firebaseEnv } from './firebase';
import { useAppStore } from '../store/useAppStore';
import { genId } from './firestore';
import { logRoleChange, logSecurityEvent, logCreate, logUpdate } from './auditLogger';

const NOT_CONFIGURED_MSG = 'Firebase is not configured. This application requires a valid Firebase configuration.';

/** Fail-closed platform gate: every mutation requires the owner/Super Admin identity. */
function requirePlatformIdentity(): { actorId: string } {
  const state = useAppStore.getState();
  if (!state.user?.isOwner && !state.user?.isSuperAdmin) {
    throw new Error('Platform operations require the Super Admin identity.');
  }
  return { actorId: state.user.id || 'system' };
}

// ── Groups (§6.3) ───────────────────────────────────────────

export type GroupInput = {
  name: string;
  shortName: string;
  isDefault?: boolean;
  isDemo?: boolean;
};

/**
 * Create a Group (groups/{id}). Super Admin only — the rules require
 * owner/Super Admin + `request.resource.data.id == groupId`. The groupId is
 * generated here (never client-chosen) and the payload carries `id` so the
 * rules' id-anchor is satisfiable. Does NOT create a Company or Group Admin
 * in the same flow (§4.3: a Company must exist before a Group Admin can be
 * created — the UI directs the Super Admin to the bootstrap action next).
 */
export async function createGroup(input: GroupInput): Promise<{ id: string }> {
  const { actorId } = requirePlatformIdentity();
  const id = genId.generic('GRP');
  const payload = {
    id,
    name: input.name.trim(),
    shortName: input.shortName.trim(),
    status: 'Active',
    ...(input.isDefault ? { isDefault: true } : {}),
    ...(input.isDemo ? { isDemo: true } : {}),
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    isDeleted: false,
  };
  await setDoc(doc(db, COLLECTIONS.GROUPS, id), payload);
  await logCreate('group', id, { name: payload.name, shortName: payload.shortName, status: payload.status }, 'groups');
  await logSecurityEvent('group_create', `Group created: ${payload.name}`, { groupId: id });
  return { id };
}

/** Suspend / reactivate a Group (§6.3, §6.9 emergency control). */
export async function setGroupStatus(groupId: string, status: 'Active' | 'Suspended'): Promise<void> {
  const { actorId } = requirePlatformIdentity();
  const snap = await getDoc(doc(db, COLLECTIONS.GROUPS, groupId));
  if (!snap.exists()) throw new Error('Group not found.');
  const name = String((snap.data() as any)?.name || groupId);
  await updateDoc(doc(db, COLLECTIONS.GROUPS, groupId), {
    id: groupId,
    status,
    updatedBy: actorId,
    updatedAt: serverTimestamp(),
  });
  await logUpdate('group', groupId, { status: (snap.data() as any)?.status }, { status }, 'groups');
  // §6.9: Suspend Group is an emergency/break-glass control — critical severity.
  await logSecurityEvent(status === 'Suspended' ? 'group_suspend' : 'group_reactivate',
    `Group ${status === 'Suspended' ? 'suspended' : 'reactivated'}: ${name}`,
    { groupId, status });
}

// ── Group Admin grant/revoke (§6.6) ─────────────────────────

export type GrantGroupAdminInput = {
  groupId: string;
  userId: string;
  userEmail: string;
  /** The user's EXISTING company — §4.3's "home company". The rules make
   *  users.companyId immutable on every update path, so the grant keeps the
   *  user's current company (which the UI validates is inside the target
   *  Group). companyId is not part of this write at all. */
  currentRole: string;
};

/**
 * Grant GroupAdmin: writes group_members/{groupId}_{userId} (role
 * 'GroupAdmin', status 'Active') and updates users/{userId} with
 * role='GroupAdmin' + groupId=<groupId>. Preconditions (UI-enforced and
 * rules-enforced): the target Group exists and is Active (rules check via
 * groupIsActive on the users update path? NO — the users update rule's owner
 * statement does not validate the group; the UI validates, and the group
 * creation flow only ever writes real groupIds. The group_members create rule
 * requires id/groupId/userId shape only. The REAL boundary is that only the
 * owner/Super Admin identity can perform this write at all — every other
 * identity is denied by the users update + group_members create rules).
 * Must call logRoleChange() (F-16, non-negotiable).
 */
export async function grantGroupAdmin(input: GrantGroupAdminInput): Promise<void> {
  const { actorId } = requirePlatformIdentity();
  const memberId = `${input.groupId}_${input.userId}`;

  // 1) group_members/{groupId}_{userId} — raw setDoc: the generic helper would
  //    strip groupId (GROUP_ID_EXCLUDED_COLLECTIONS includes group_members),
  //    and the rules REQUIRE groupId on this document.
  await setDoc(doc(db, COLLECTIONS.GROUP_MEMBERS, memberId), {
    id: memberId,
    groupId: input.groupId,
    userId: input.userId,
    role: 'GroupAdmin',
    status: 'Active',
    grantedBy: actorId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    isDeleted: false,
  });

  // 2) users/{userId} — raw updateDoc: the generic updateDocById strips
  //    groupId for users (GROUP_ID_EXCLUDED_COLLECTIONS includes users), and
  //    the grant is the ONE users path where the platform assigns groupId.
  //    companyId is left untouched (immutable at the rules layer).
  await updateDoc(doc(db, COLLECTIONS.USERS, input.userId), {
    role: 'GroupAdmin',
    groupId: input.groupId,
    updatedBy: actorId,
    updatedAt: serverTimestamp(),
  });

  await logRoleChange(input.userId, input.userEmail, input.currentRole, 'GroupAdmin');
  await logSecurityEvent('group_admin_grant', `Group Admin granted to ${input.userEmail}`, {
    groupId: input.groupId, userId: input.userId,
  });
}

/**
 * Revoke GroupAdmin: sets group_members status 'Revoked' and reverts the
 * target users/{id}.role to 'Admin' (scoped to their existing companyId,
 * which they retain — the user does not lose ERP access, they drop back to
 * Company Admin of their home company, §6.6). groupId is left unchanged
 * (their company still belongs to the Group, so the stored groupId remains
 * coherent with their company's group).
 */
export async function revokeGroupAdmin(groupId: string, userId: string, userEmail: string): Promise<void> {
  const { actorId } = requirePlatformIdentity();
  const memberId = `${groupId}_${userId}`;

  const memberSnap = await getDoc(doc(db, COLLECTIONS.GROUP_MEMBERS, memberId));
  if (!memberSnap.exists()) throw new Error('Group membership record not found.');
  await updateDoc(doc(db, COLLECTIONS.GROUP_MEMBERS, memberId), {
    id: memberId,
    groupId,
    userId,
    status: 'Revoked',
    updatedBy: actorId,
    updatedAt: serverTimestamp(),
  });

  const userSnap = await getDoc(doc(db, COLLECTIONS.USERS, userId));
  const currentRole = userSnap.exists() ? String((userSnap.data() as any)?.role || 'Admin') : 'Admin';
  await updateDoc(doc(db, COLLECTIONS.USERS, userId), {
    role: 'Admin',
    updatedBy: actorId,
    updatedAt: serverTimestamp(),
  });

  await logRoleChange(userId, userEmail, currentRole, 'Admin');
  await logSecurityEvent('group_admin_revoke', `Group Admin revoked for ${userEmail}`, {
    groupId, userId,
  });
}

// ── Company bootstrap (§6.4) ────────────────────────────────

export type BootstrapCompanyInput = {
  groupId: string;
  name: string;
  businessMode?: string;
  [key: string]: unknown;
};

/**
 * Bootstrap the FIRST Company for a Group with zero existing Companies
 * (§4.3/§6.4). Super Admin only — the companies create rule's Admin branch
 * allows the owner/Super Admin to create a company with any id/companyId
 * (sameCompany() bypasses for the platform identity). groupId is stamped
 * explicitly by the platform (companies.groupId is assigned by the Super
 * Admin Groups UI per Phase 1 design — never derived from itself). Raw
 * setDoc: the generic createDocWithId strips groupId for companies
 * (GROUP_ID_EXCLUDED_COLLECTIONS includes companies).
 */
export async function bootstrapCompany(input: BootstrapCompanyInput): Promise<{ id: string }> {
  const { actorId } = requirePlatformIdentity();
  const id = genId.generic('CO');
  const { groupId, name, ...rest } = input;
  const payload = {
    id,
    companyId: id,
    groupId,
    name: String(name).trim(),
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
  await logSecurityEvent('company_bootstrap', `Company bootstrapped: ${payload.name}`, { companyId: id, groupId });
  return { id };
}

// ── Platform Settings (§6.8) ────────────────────────────────

export type PlatformSettings = {
  id: string;
  maintenanceMode: boolean;
  maintenanceMessage?: string;
  updatedBy?: string;
  updatedAt?: unknown;
};

/** Read platform_settings/global (owner/Super Admin only; rules-enforced). */
export async function getPlatformSettings(): Promise<PlatformSettings | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.PLATFORM_SETTINGS, 'global'));
  if (!snap.exists()) return null;
  const data = snap.data() as PlatformSettings;
  return { ...data, id: 'global' };
}

/**
 * Set platform settings (maintenanceMode + maintenanceMessage) on
 * platform_settings/global (§6.8). §6.9: Maintenance Mode is an
 * emergency/break-glass control — typed-name confirmation in the UI, and a
 * severity 'critical' security_logs entry here.
 */
export async function setPlatformSettings(
  settings: { maintenanceMode: boolean; maintenanceMessage?: string },
): Promise<void> {
  const { actorId } = requirePlatformIdentity();
  const ref = doc(db, COLLECTIONS.PLATFORM_SETTINGS, 'global');
  const existing = await getDoc(ref);
  const payload = {
    id: 'global',
    maintenanceMode: Boolean(settings.maintenanceMode),
    ...(settings.maintenanceMessage ? { maintenanceMessage: settings.maintenanceMessage } : {}),
    updatedBy: actorId,
    updatedAt: serverTimestamp(),
  };
  if (existing.exists()) {
    await updateDoc(ref, payload);
  } else {
    await setDoc(ref, payload);
  }
  await logUpdate('platform_settings', 'global',
    existing.exists() ? { maintenanceMode: (existing.data() as any)?.maintenanceMode } : {},
    { maintenanceMode: payload.maintenanceMode },
    'settings');
  await logSecurityEvent('maintenance_mode', `Maintenance mode ${payload.maintenanceMode ? 'ENABLED' : 'disabled'}`,
    { maintenanceMode: payload.maintenanceMode });
}

export default {
  createGroup, setGroupStatus, grantGroupAdmin, revokeGroupAdmin,
  bootstrapCompany, getPlatformSettings, setPlatformSettings,
};
