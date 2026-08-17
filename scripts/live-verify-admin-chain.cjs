/**
 * LIVE DIAGNOSTIC — Admin identity / tenant chain on ae-erp-d933d.
 * Read-only. Prints no secrets (only ids, companyIds, roles, statuses).
 */
const { applicationDefault, getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const app = getApps()[0] || initializeApp({ credential: applicationDefault(), projectId: 'ae-erp-d933d' });
const db = getFirestore(app);

const ADMIN_USER_ID = 'MUSR-default-0234824979';
const ADMIN_AUTH_UID = 'emFItT3XFZeMJxvZIDQ8anE1oN83';

(async () => {
  console.log('=== COMPANIES ===');
  const companies = await db.collection('companies').get();
  for (const d of companies.docs) {
    const x = d.data();
    console.log(`  ${d.id} | name=${x.name || x.companyName || ''} | isDefault=${x.isDefault === true}`);
  }

  console.log('=== ADMIN ERP USER ===');
  const adm = await db.collection('users').doc(ADMIN_USER_ID).get();
  if (adm.exists) {
    const x = adm.data();
    console.log(`  id=${adm.id}`);
    console.log(`  email=${x.email} | name=${x.name}`);
    console.log(`  companyId=${JSON.stringify(x.companyId)} | role=${JSON.stringify(x.role)} | status=${JSON.stringify(x.status)}`);
    console.log(`  isOwner=${x.isOwner === true} | isSuperAdmin=${x.isSuperAdmin === true} | isDeleted=${x.isDeleted === true}`);
    console.log(`  masterUserId=${x.masterUserId || ''} | department=${x.department || ''} | isManager=${x.isManager === true}`);
  } else {
    console.log('  MISSING users doc');
  }

  console.log('=== ADMIN AUTH MAP ===');
  const map = await db.collection('user_auth_maps').doc(ADMIN_AUTH_UID).get();
  if (map.exists) {
    const x = map.data();
    console.log(`  userId=${x.userId} | companyId=${JSON.stringify(x.companyId)} | email=${x.email} | isActive=${x.isActive === false ? 'false' : (x.isActive === true ? 'true' : 'undefined')}`);
  } else {
    console.log('  MISSING user_auth_maps doc (lazy bootstrap on first login)');
  }

  console.log('=== USERS WITH companyId == "default" (any) ===');
  const defUsers = await db.collection('users').where('companyId', '==', 'default').get();
  console.log(`  count=${defUsers.size}`);
  defUsers.docs.slice(0, 10).forEach((d) => console.log(`    ${d.id} | ${d.data().email || ''} | ${d.data().role || ''}`));

  console.log('=== AUTH MAPS WITH companyId == "default" (any) ===');
  const defMaps = await db.collection('user_auth_maps').where('companyId', '==', 'default').get();
  console.log(`  count=${defMaps.size}`);
  defMaps.docs.slice(0, 10).forEach((d) => console.log(`    ${d.id} -> ${d.data().userId || ''} | ${d.data().email || ''}`));

  console.log('=== user_auth_maps TOTAL ===');
  const allMaps = await db.collection('user_auth_maps').get();
  console.log(`  count=${allMaps.size}`);

  console.log('=== users TOTAL ===');
  const allUsers = await db.collection('users').get();
  console.log(`  count=${allUsers.size}`);
})().catch((e) => {
  console.error('DIAGNOSTIC FAILED:', e.message);
  process.exit(1);
});
