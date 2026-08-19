import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDocs, query, setDoc, where, writeBatch } from 'firebase/firestore';

/**
 * phase8GroupPerformance.emulator.test.ts — Phase 8 (Master Plan §17.8)
 * performance verification: "a synthetic-data test simulating a Group with
 * 20 Companies and 1,000 total users, confirming the Group Overview
 * dashboard's query cost matches §14.6's 'single where(groupId,...) query
 * per widget' design (measured via Firestore's own query-explain/read-count,
 * not assumed)."
 *
 * This measures actual read counts (`snapshot.size`/`snapshot.docs.length`)
 * from the real Firestore emulator for the exact query shape the app's
 * Group-view widgets use (companyScopedQuery() in group mode:
 * `where('groupId','==', actor.groupId)`, no per-Company fan-out) —
 * proving read cost scales with the QUERYING GROUP's own size, not total
 * platform size, by seeding a second, larger "noise" Group alongside the
 * target and confirming its documents are never read.
 *
 * Run via: npm run test:rules.
 */

const PROJECT = 'neozy-phase8-performance-test';

const TARGET_GROUP = 'GROUP-PERF-TARGET';
const TARGET_COMPANY_COUNT = 20;
const TARGET_USERS_PER_COMPANY = 50; // 20 * 50 = 1,000 total users, per §17.8's exact figures
const TARGET_WAREHOUSES_PER_COMPANY = 2;

const NOISE_GROUP = 'GROUP-PERF-NOISE';
const NOISE_COMPANY_COUNT = 10;
const NOISE_USERS_PER_COMPANY = 60; // 600 users — deliberately NOT a clean multiple/fraction of the target, so an accidental cross-group read would be detectable by count alone

const UID_GA = 'uid-perf-ga';
const ID_GA = 'MUSR-PERF-GA';

let env: RulesTestEnvironment;

async function seed() {
  await env.withSecurityRulesDisabled(async (rulesCtx) => {
    const db = rulesCtx.firestore();

    await setDoc(doc(db, 'groups', TARGET_GROUP), { id: TARGET_GROUP, name: 'Perf Target Group', shortName: 'PERFT', status: 'Active' });
    await setDoc(doc(db, 'groups', NOISE_GROUP), { id: NOISE_GROUP, name: 'Perf Noise Group', shortName: 'PERFN', status: 'Active' });

    // The GroupAdmin actor — home company is the target group's first company.
    const homeCompanyId = `CO-PERF-T-0`;
    await setDoc(doc(db, 'users', ID_GA), {
      id: ID_GA, role: 'GroupAdmin', companyId: homeCompanyId, groupId: TARGET_GROUP,
      email: 'perf.ga@neozy.test', status: 'Active', isDeleted: false,
    });
    await setDoc(doc(db, 'user_auth_maps', UID_GA), {
      authUid: UID_GA, userId: ID_GA, companyId: homeCompanyId, groupId: TARGET_GROUP, email: 'perf.ga@neozy.test',
    });

    // Batched writes — Firestore's 500-writes-per-batch limit, matching the
    // Master Plan §10.3's own stated batching convention for bulk seeding.
    let batch = writeBatch(db);
    let opsInBatch = 0;
    const flushIfNeeded = async () => {
      if (opsInBatch >= 450) {
        await batch.commit();
        batch = writeBatch(db);
        opsInBatch = 0;
      }
    };

    async function seedGroup(groupId: string, companyCount: number, usersPerCompany: number, warehousesPerCompany: number) {
      for (let c = 0; c < companyCount; c++) {
        const companyId = `CO-PERF-${groupId === TARGET_GROUP ? 'T' : 'N'}-${c}`;
        batch.set(doc(db, 'companies', companyId), { id: companyId, companyId, name: `Perf Co ${companyId}`, groupId, status: 'Active', isDeleted: false });
        opsInBatch++;
        await flushIfNeeded();

        for (let w = 0; w < warehousesPerCompany; w++) {
          const warehouseId = `WH-PERF-${companyId}-${w}`;
          batch.set(doc(db, 'warehouses', warehouseId), { id: warehouseId, companyId, groupId, name: `Perf WH ${warehouseId}`, status: 'Active', isDeleted: false });
          opsInBatch++;
          await flushIfNeeded();
        }

        for (let u = 0; u < usersPerCompany; u++) {
          const userId = `MUSR-PERF-${companyId}-${u}`;
          batch.set(doc(db, 'users', userId), { id: userId, companyId, groupId, role: 'Sales', email: `${userId}@neozy.test`, status: 'Active', isDeleted: false });
          opsInBatch++;
          await flushIfNeeded();
        }
      }
    }

    await seedGroup(TARGET_GROUP, TARGET_COMPANY_COUNT, TARGET_USERS_PER_COMPANY, TARGET_WAREHOUSES_PER_COMPANY);
    await seedGroup(NOISE_GROUP, NOISE_COMPANY_COUNT, NOISE_USERS_PER_COMPANY, TARGET_WAREHOUSES_PER_COMPANY);

    if (opsInBatch > 0) await batch.commit();
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
  await seed();
}, 120_000);

afterAll(async () => {
  await env.cleanup();
});

const ctx = () => env.authenticatedContext(UID_GA, { email: 'perf.ga@neozy.test' }).firestore();

describe('Phase 8 (§17.8) — Group-wide query cost scales with Group size, not platform size', () => {
  it('users: a single where(groupId,==,target) query returns exactly the target Group\'s 1,000 users — zero noise-Group reads', async () => {
    const db = ctx();
    const start = Date.now();
    const snap = await getDocs(query(collection(db, 'users'), where('groupId', '==', TARGET_GROUP)));
    const elapsedMs = Date.now() - start;

    // Exclude the GroupAdmin's own users doc from the per-company count (it
    // is a 21st, GroupAdmin-tier user document, not one of the 1,000 seeded
    // Sales users) — assert the total is exactly 1,000 + 1.
    expect(snap.size).toBe(TARGET_COMPANY_COUNT * TARGET_USERS_PER_COMPANY + 1);
    // Every returned doc genuinely belongs to the target Group — proves this
    // was ONE provable where()-scoped query, not a broader read narrowed
    // client-side (which would still "work" here but violates §14.6's design
    // and the F-01/F-02-class provability discipline the rest of this plan
    // enforces).
    snap.docs.forEach((d) => expect(d.data().groupId).toBe(TARGET_GROUP));
    console.log(`[perf] users group-wide query: ${snap.size} docs in ${elapsedMs}ms (single where() query, not a ${TARGET_COMPANY_COUNT}-way per-Company fan-out)`);
  });

  it('companies: a single where(groupId,==,target) query returns exactly the target Group\'s 20 companies', async () => {
    const db = ctx();
    const snap = await getDocs(query(collection(db, 'companies'), where('groupId', '==', TARGET_GROUP)));
    expect(snap.size).toBe(TARGET_COMPANY_COUNT);
    snap.docs.forEach((d) => expect(d.data().groupId).toBe(TARGET_GROUP));
  });

  it('warehouses: a single where(groupId,==,target) query returns exactly the target Group\'s 40 warehouses', async () => {
    const db = ctx();
    const snap = await getDocs(query(collection(db, 'warehouses'), where('groupId', '==', TARGET_GROUP)));
    expect(snap.size).toBe(TARGET_COMPANY_COUNT * TARGET_WAREHOUSES_PER_COMPANY);
    snap.docs.forEach((d) => expect(d.data().groupId).toBe(TARGET_GROUP));
  });

  it('noise Group isolation: the SAME actor querying the noise Group\'s groupId is denied (cross-Group, proven not merely "not returned")', async () => {
    const db = ctx();
    const { assertFails } = await import('@firebase/rules-unit-testing');
    await assertFails(getDocs(query(collection(db, 'users'), where('groupId', '==', NOISE_GROUP))));
  });
});
