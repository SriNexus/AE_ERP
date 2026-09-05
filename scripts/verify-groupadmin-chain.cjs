/**
 * verify-groupadmin-chain.cjs — READ-ONLY GroupAdmin identity / tenant-chain
 * consistency probe (RBAC Master Plan Phase 8 runtime closure).
 *
 * Answers, for one GroupAdmin account, the exact question Phase 8's live
 * acceptance depends on: "is this identity chain complete enough for the
 * desktop app to let this GroupAdmin create/read/edit records in their own
 * company AND across their group — and if not, WHICH record is the problem?"
 *
 * It reads and cross-checks:
 *
 *   Firebase Auth UID  (argv)
 *        -> user_auth_maps/{uid}         .userId .companyId .groupId
 *        -> users/{userId}               .role .companyId .groupId .status .isDeleted
 *        -> companies/{homeCompanyId}    .groupId
 *        -> groups/{groupId}             .status
 *        -> group_members/*              (GroupAdmin grant for this user)
 *        -> every companies doc whose .groupId == the actor's group (the
 *           companies the switcher should list)
 *
 * Prints NO secrets — only ids, roles, statuses, and boolean consistency
 * results. Read-only: issues zero writes. Safe to run at any time.
 *
 * Usage:
 *   node scripts/verify-groupadmin-chain.cjs <authUid>
 *   node scripts/verify-groupadmin-chain.cjs --email ga@example.com
 *
 * Env: GCLOUD_PROJECT / DEMO_FIREBASE_PROJECT_ID (Firebase Admin SDK,
 *      applicationDefault credentials). Defaults to the production project id
 *      used by the other live-diagnostic scripts.
 *
 * Exit code: 0 = IDENTITY VALID (home CRUD will work at the rules layer),
 *            1 = IDENTITY INVALID (prints the exact mismatch + the smallest
 *                repair — never performs it).
 */
const { applicationDefault, getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.DEMO_FIREBASE_PROJECT_ID || 'ae-erp-d933d';
const text = (v) => (typeof v === 'string' ? v.trim() : '');
const INACTIVE = ['inactive', 'suspended', 'disabled'];

const args = process.argv.slice(2);
let authUid = '';
let email = '';
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--email') { email = text(args[i + 1]); i += 1; }
  else if (!authUid) authUid = text(args[i]);
}

if (!authUid && !email) {
  console.error('Usage: node scripts/verify-groupadmin-chain.cjs <authUid> | --email <address>');
  process.exit(2);
}

(async () => {
  const app = getApps()[0] || initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore(app);
  console.log('PROJECT:', PROJECT_ID);

  const problems = [];
  const fail = (msg, repair) => { problems.push({ msg, repair }); console.log('  ✗ ' + msg); };
  const ok = (msg) => console.log('  ✓ ' + msg);

  // ── 1. Resolve the auth mapping ────────────────────────────────────
  let mapSnap;
  if (authUid) {
    mapSnap = await db.collection('user_auth_maps').doc(authUid).get();
    if (!mapSnap.exists) {
      // Fall back to a query by field (older docs keyed differently).
      const q = await db.collection('user_auth_maps').where('authUid', '==', authUid).limit(1).get();
      mapSnap = q.empty ? mapSnap : q.docs[0];
    }
  } else {
    const q = await db.collection('user_auth_maps').where('email', '==', email).limit(1).get();
    if (q.empty) { console.error(`No user_auth_maps doc with email == "${email}"`); process.exit(1); }
    mapSnap = q.docs[0];
    authUid = mapSnap.id;
  }

  console.log('\n=== 1. user_auth_maps ===');
  if (!mapSnap || !mapSnap.exists) {
    fail(`user_auth_maps/${authUid} MISSING`, 'Sign in once on the desktop app (the mapping is lazily bootstrapped at first login).');
    return finish(problems);
  }
  const map = mapSnap.data();
  const mapUserId = text(map.userId);
  const mapCompanyId = text(map.companyId);
  const mapGroupId = text(map.groupId);
  console.log(`  authUid=${authUid}`);
  console.log(`  userId=${mapUserId || '(missing)'}`);
  console.log(`  companyId=${mapCompanyId || '(missing)'}   <-- firestore.rules userCompanyId()`);
  console.log(`  groupId=${mapGroupId || '(missing)'}   <-- firestore.rules actorGroupId()`);
  if (!mapUserId) fail('user_auth_maps.userId is empty', 'Re-run first-login identity bootstrap (authIdentity.ts).');
  if (!mapCompanyId) fail('user_auth_maps.companyId is empty', 'refreshAuthMappingIfStale() heals this from users/{id}.companyId on next boot.');

  // ── 2. The ERP user doc ───────────────────────────────────────────
  console.log('\n=== 2. users ===');
  const userSnap = mapUserId ? await db.collection('users').doc(mapUserId).get() : null;
  if (!userSnap || !userSnap.exists) {
    fail(`users/${mapUserId} MISSING`, 'The auth mapping points at a non-existent ERP user — repair user_auth_maps.userId.');
    return finish(problems);
  }
  const u = userSnap.data();
  const uRole = text(u.role);
  const uCompanyId = text(u.companyId);
  const uGroupId = text(u.groupId);
  const uStatus = text(u.status);
  console.log(`  id=${userSnap.id}`);
  console.log(`  role=${uRole}`);
  console.log(`  companyId=${uCompanyId || '(missing)'}`);
  console.log(`  groupId=${uGroupId || '(missing)'}`);
  console.log(`  status=${uStatus || '(unset -> treated active)'} | isDeleted=${u.isDeleted === true}`);

  if (uRole.toLowerCase() !== 'groupadmin') fail(`users.role is "${uRole}", not "GroupAdmin"`, 'This probe is for a GroupAdmin account.');
  if (u.isDeleted === true) fail('users.isDeleted == true', 'Restore the user (actorIsActive() denies every write).');
  if (INACTIVE.includes(uStatus.toLowerCase())) fail(`users.status == "${uStatus}"`, 'Set status to Active (actorIsActive() denies every write otherwise).');
  if (!uCompanyId) fail('users.companyId is empty', 'Assign the GroupAdmin a home company (SuperAdmin / platform admin).');

  // ── 3. companyId agreement (the rules check data.companyId == userCompanyId()) ──
  console.log('\n=== 3. companyId agreement (home-company CRUD depends on this) ===');
  if (uCompanyId && mapCompanyId && uCompanyId === mapCompanyId) {
    ok(`users.companyId == user_auth_maps.companyId == ${uCompanyId}`);
  } else {
    fail(`users.companyId ("${uCompanyId}") != user_auth_maps.companyId ("${mapCompanyId}")`,
      'refreshAuthMappingIfStale() (useGlobalBoot.ts) rewrites the mapping to match users/{id} on next boot — have the GroupAdmin reload the app once. If it does not self-heal, the mapping\'s groupId may be blocking the write (groupId is immutable once set).');
  }

  // ── 4. groupId agreement ──────────────────────────────────────────
  console.log('\n=== 4. groupId agreement (in-group SIBLING access depends on this) ===');
  if (!uGroupId && !mapGroupId) {
    fail('neither users.groupId nor user_auth_maps.groupId is set',
      'Home-company CRUD still works (it keys on companyId only). SIBLING / group-view access needs users/{id}.groupId set by a SuperAdmin (the client cannot self-set it — Bucket A), then the mapping self-heals.');
  } else if (uGroupId && mapGroupId && uGroupId === mapGroupId) {
    ok(`users.groupId == user_auth_maps.groupId == ${uGroupId}`);
  } else if (uGroupId && !mapGroupId) {
    fail(`users.groupId == "${uGroupId}" but user_auth_maps.groupId is empty`,
      'First-set is allowed if it matches users/{id} — refreshAuthMappingIfStale() sets it on next boot. Have the GroupAdmin reload once.');
  } else {
    fail(`users.groupId ("${uGroupId}") != user_auth_maps.groupId ("${mapGroupId}")`,
      'The mapping groupId is IMMUTABLE once set (firestore.rules). A SuperAdmin must correct users/{id}.groupId AND the mapping (platformAdmin path), or delete+recreate the mapping.');
  }

  // ── 5. Home company -> group link + group active (companyGroupIsActive) ──
  console.log('\n=== 5. home company group-link + group status (ALL roles need this) ===');
  const homeId = uCompanyId || mapCompanyId;
  const homeSnap = homeId ? await db.collection('companies').doc(homeId).get() : null;
  if (!homeSnap || !homeSnap.exists) {
    fail(`companies/${homeId} MISSING`, 'The home company record does not exist.');
  } else {
    const homeGroupId = text(homeSnap.data().groupId);
    console.log(`  companies/${homeId}.groupId=${homeGroupId || '(missing)'}`);
    if (!homeGroupId) {
      fail(`companies/${homeId} has NO groupId`,
        'sameCompany()/companyGroupIsActive() denies EVERY create+read for EVERY role in this company. Backfill companies/{id}.groupId via scripts/backfill-groups.cjs (a data task, not a code fix).');
    } else {
      const gSnap = await db.collection('groups').doc(homeGroupId).get();
      const gStatus = gSnap.exists ? text(gSnap.data().status) : '';
      console.log(`  groups/${homeGroupId}.status=${gStatus || (gSnap.exists ? '(unset)' : '(group MISSING)')}`);
      if (!gSnap.exists) fail(`groups/${homeGroupId} MISSING`, 'companies.groupId points at a non-existent group.');
      else if (gStatus !== 'Active') fail(`groups/${homeGroupId}.status == "${gStatus}" (not "Active")`, 'A suspended group suspends every write for every user under it (§9.6). Reactivate the group.');
      else ok(`home company is linked to active group ${homeGroupId}`);

      if (uGroupId && homeGroupId && uGroupId !== homeGroupId) {
        fail(`users.groupId ("${uGroupId}") != home company's group ("${homeGroupId}")`, 'The GroupAdmin\'s identity group disagrees with their home company\'s group — a SuperAdmin must reconcile.');
      }
    }
  }

  // ── 6. GroupAdmin grant record ────────────────────────────────────
  console.log('\n=== 6. group_members grant ===');
  const gm = await db.collection('group_members').where('userId', '==', mapUserId).get();
  const activeGrants = gm.docs.map((d) => d.data()).filter((x) => text(x.status).toLowerCase() === 'active');
  if (activeGrants.length === 0) {
    fail(`no active group_members record for user ${mapUserId}`,
      'A GroupAdmin promotion needs a group_members grant (firestore.rules gate for role == "GroupAdmin" assignment). Without it the role reassignment itself would have been denied.');
  } else {
    for (const g of activeGrants) console.log(`  group_members: groupId=${text(g.groupId)} role=${text(g.role)} status=${text(g.status)}`);
    ok(`${activeGrants.length} active grant(s)`);
  }

  // ── 7. The companies the switcher should list ─────────────────────
  console.log('\n=== 7. companies in the actor group (CompanySwitcher contents) ===');
  const actorGroup = uGroupId || mapGroupId;
  if (actorGroup) {
    const inGroup = await db.collection('companies').where('groupId', '==', actorGroup).get();
    console.log(`  ${inGroup.size} company(ies) with groupId == ${actorGroup}:`);
    inGroup.docs.forEach((d) => console.log(`    ${d.id} | ${text(d.data().name) || text(d.data().shortName)}`));
    if (inGroup.size === 0) fail(`no companies carry groupId == "${actorGroup}"`, 'The switcher will show nothing / only the home company. Backfill companies.groupId.');
  } else {
    console.log('  (skipped — actor has no resolved groupId)');
  }

  return finish(problems);
})().catch((e) => {
  console.error('DIAGNOSTIC FAILED:', e.message);
  process.exit(1);
});

function finish(problems) {
  console.log('\n=== VERDICT ===');
  if (problems.length === 0) {
    console.log('  IDENTITY VALID — the identity chain is complete; home-company CRUD and');
    console.log('  in-group sibling access are unblocked at the rules layer.');
    process.exit(0);
  }
  console.log(`  IDENTITY INVALID — ${problems.length} issue(s):`);
  problems.forEach((p, i) => {
    console.log(`   ${i + 1}. ${p.msg}`);
    if (p.repair) console.log(`      smallest fix: ${p.repair}`);
  });
  console.log('\n  Nothing was modified. Apply the smallest fix above (data repairs go');
  console.log('  through a SuperAdmin / the documented backfill scripts, never ad hoc).');
  process.exit(1);
}
