/**
 * backfill-org-hierarchy.cjs — additive, idempotent backfill of the
 * data-driven section (department / manager) model.
 *
 * 1. ROLE docs:
 *    - System roles (name in the system list) get their authoritative
 *      `department` + `isManager` + `isSystem: true` (from roleBootstrap).
 *    - Custom roles are LEFT UNTOUCHED (admins manage them via the Roles UI).
 * 2. USER docs:
 *    - `department` + `isManager` are recomputed from the user's role document
 *      and written (denormalized — Firestore rules enforce the manager↔
 *      department coherence from these fields).
 *    - `managerName` is resolved from managerId when missing.
 *
 * SAFETY: additive only — never deletes fields, never changes companyId/role/
 * email/status, never touches mappings. Re-runnable.
 *
 * Usage: node scripts/backfill-org-hierarchy.cjs
 */
const fs = require('fs');
const path = require('path');
const { applicationDefault, getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const app = getApps()[0] || initializeApp({ credential: applicationDefault() });
const db = getFirestore(app);

const SYSTEM_ROLE_DEPARTMENTS = {
  Admin: 'Management',
  Director: 'Management',
  Manager: 'Management',
  Sales: 'Sales',
  Accounts: 'Accounts',
  Warehouse: 'Warehouse',
  HR: 'HR',
  Operations: 'Operations',
  Partner: 'Channel Partner',
  Surveyor: 'Engineering',
  Engineer: 'Engineering',
  InstallationLead: 'Installation',
  ServiceTechnician: 'Service',
  ComplianceOfficer: 'Compliance',
  Procurement: 'Procurement',
};
const SYSTEM_MANAGER_ROLES = new Set(['Manager']);

const text = (value) => (typeof value === 'string' ? value.trim() : '');

async function main() {
  const rolesSnap = await db.collection('roles').get();
  const roleDocs = rolesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const roleByName = new Map();
  for (const role of roleDocs) {
    const name = text(role.name).toLowerCase();
    if (name) roleByName.set(name, role);
  }

  let rolesUpdated = 0;
  const writes = [];
  for (const role of roleDocs) {
    const name = text(role.name);
    const systemDept = SYSTEM_ROLE_DEPARTMENTS[name];
    if (!systemDept) continue; // custom role — leave to the Roles UI
    const patch = {};
    if (text(role.department) !== systemDept) patch.department = systemDept;
    if (role.isManager !== SYSTEM_MANAGER_ROLES.has(name)) patch.isManager = SYSTEM_MANAGER_ROLES.has(name);
    if (role.isSystem !== true) patch.isSystem = true;
    if (Object.keys(patch).length > 0) {
      writes.push(db.collection('roles').doc(role.id).update(patch).then(() => {
        rolesUpdated += 1;
        console.log(`role ${name}: +${Object.keys(patch).join(',')}`);
      }));
    }
  }
  await Promise.all(writes);
  console.log(`roles backfilled: ${rolesUpdated}/${roleDocs.length}`);

  const usersSnap = await db.collection('users').get();
  const userDocs = usersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  let usersUpdated = 0;
  const userWrites = [];
  for (const user of userDocs) {
    const roleName = text(user.role).toLowerCase();
    const role = roleByName.get(roleName);
    const patch = {};
    const dept = text(role ? role.department : user.department);
    if (text(user.department) !== dept) patch.department = dept;
    const isManager = role ? role.isManager === true : user.isManager === true;
    if (user.isManager !== isManager) patch.isManager = isManager;
    const managerId = text(user.managerId);
    if (managerId && !text(user.managerName)) {
      const manager = userDocs.find((u) => u.id === managerId);
      const managerName = manager ? text(manager.name) || text(manager.displayName) : '';
      if (managerName) patch.managerName = managerName;
    }
    if (Object.keys(patch).length > 0) {
      userWrites.push(db.collection('users').doc(user.id).update(patch).then(() => {
        usersUpdated += 1;
        console.log(`user ${user.id}: +${Object.keys(patch).join(',')} (role=${roleName || '?'} dept=${dept || '?'})`);
      }));
    }
  }
  await Promise.all(userWrites);
  console.log(`users backfilled: ${usersUpdated}/${userDocs.length}`);
  console.log('DONE — additive backfill complete.');
}

main().catch((e) => { console.error('FATAL:', e.message); process.exitCode = 2; });
