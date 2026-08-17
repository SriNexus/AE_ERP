import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { deleteApp, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { collection, connectFirestoreEmulator, doc, getDocs, getFirestore, writeBatch } from 'firebase/firestore';

import {
  buildPartnerOwnershipBackfillPlan,
  formatPartnerOwnershipBackfillSummary,
  PARTNER_OWNERSHIP_BACKFILL_COLLECTIONS,
  type PartnerOwnershipBackfillInput,
} from '../src/lib/partnerOwnershipBackfill.ts';

// Phase 3 (Channel Partner ownership propagation): backfills `partnerId`/
// `partnerName` on records created before propagation existed —
//   customers ← their source lead (customer.sourceLeadId → lead.partnerId),
//   projects  ← their customer (project.customerId → customer.partnerId),
//             plus project.leadId from customer.sourceLeadId when absent.
// Mirrors scripts/backfill-partner-user-links.ts exactly (env loading,
// dry-run default, batched writes) — no new script pattern. NEVER runs
// against production data without explicit authorization; dry-run is default.
//
//   npx tsx scripts/backfill-partner-ownership.ts                 # dry run
//   npx tsx scripts/backfill-partner-ownership.ts --dryRun=false  # apply
//   npx tsx scripts/backfill-partner-ownership.ts --companyId=... # scope

type ScriptOptions = {
  companyId?: string;
  dryRun: boolean;
};

let firebaseApp: FirebaseApp | null = null;

function clearProxyEnvironment() {
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'] as const) {
    delete process.env[key];
  }
  process.env.NO_PROXY = '*';
  process.env.no_proxy = '*';
}

async function shutdown(code: number) {
  if (firebaseApp) {
    try {
      await deleteApp(firebaseApp);
    } catch (error) {
      console.warn('[CP-OWNERSHIP] Firebase app shutdown warning', error);
    }
  }
  process.exit(code);
}

function loadDotEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex <= 0) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function loadEnvironment() {
  const cwd = process.cwd();
  loadDotEnvFile(resolve(cwd, '.env.local'));
  loadDotEnvFile(resolve(cwd, '.env'));
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseArgs(): ScriptOptions {
  const args = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    args.set(key, rest.join('=') || 'true');
  }

  return {
    companyId: args.get('companyId') || args.get('company') || process.env.CP_OWNERSHIP_BACKFILL_COMPANY_ID?.trim() || undefined,
    dryRun: String(args.get('dryRun') || process.env.CP_OWNERSHIP_BACKFILL_DRY_RUN || 'true').toLowerCase() !== 'false',
  };
}

async function loadCollection<T>(db: ReturnType<typeof getFirestore>, name: string): Promise<T[]> {
  const snapshot = await getDocs(collection(db, name));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as T[];
}

async function main() {
  loadEnvironment();
  clearProxyEnvironment();
  const options = parseArgs();

  const firebaseConfig: FirebaseOptions = {
    apiKey: requiredEnv('VITE_FIREBASE_API_KEY'),
    authDomain: requiredEnv('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: requiredEnv('VITE_FIREBASE_PROJECT_ID'),
    storageBucket: requiredEnv('VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: requiredEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: requiredEnv('VITE_FIREBASE_APP_ID'),
    measurementId: process.env.VITE_FIREBASE_MEASUREMENT_ID?.trim() || undefined,
  };

  firebaseApp = initializeApp(firebaseConfig);
  const auth = getAuth(firebaseApp);
  const db = getFirestore(firebaseApp);

  const useEmulator = String(process.env.VITE_USE_FIREBASE_EMULATOR || '').toLowerCase() === 'true';
  if (useEmulator) {
    const firestoreHost = process.env.VITE_FIRESTORE_EMULATOR_HOST || '127.0.0.1';
    const firestorePort = Number(process.env.VITE_FIRESTORE_EMULATOR_PORT || 8080);
    const authUrl = process.env.VITE_AUTH_EMULATOR_URL || 'http://127.0.0.1:9099';
    connectFirestoreEmulator(db, firestoreHost, firestorePort);
    connectAuthEmulator(auth, authUrl, { disableWarnings: true });
  }

  const email = process.env.CP_OWNERSHIP_BACKFILL_FIREBASE_EMAIL?.trim() || 'admin@neozy.in';
  const password = process.env.CP_OWNERSHIP_BACKFILL_FIREBASE_PASSWORD?.trim() || 'admin123';
  if (!process.env.CP_OWNERSHIP_BACKFILL_FIREBASE_EMAIL || !process.env.CP_OWNERSHIP_BACKFILL_FIREBASE_PASSWORD) {
    console.warn('[CP-OWNERSHIP] Falling back to the documented demo admin credentials. Provide CP_OWNERSHIP_BACKFILL_FIREBASE_EMAIL/CP_OWNERSHIP_BACKFILL_FIREBASE_PASSWORD for a non-default run.');
  }
  await signInWithEmailAndPassword(auth, email, password);
  const userId = auth.currentUser?.uid || 'system';

  console.info('[CP-OWNERSHIP] Loading source records...');
  const [leads, customers, projects] = await Promise.all([
    loadCollection(db, PARTNER_OWNERSHIP_BACKFILL_COLLECTIONS.LEADS),
    loadCollection(db, PARTNER_OWNERSHIP_BACKFILL_COLLECTIONS.CUSTOMERS),
    loadCollection(db, PARTNER_OWNERSHIP_BACKFILL_COLLECTIONS.PROJECTS),
  ]);

  const input: PartnerOwnershipBackfillInput = { leads, customers, projects } as PartnerOwnershipBackfillInput;
  const plan = buildPartnerOwnershipBackfillPlan(input, { companyId: options.companyId });

  console.info(`[CP-OWNERSHIP] Signed in as ${userId}`);
  if (options.companyId) {
    console.info(`[CP-OWNERSHIP] Company filter: ${options.companyId}`);
  }
  console.info(formatPartnerOwnershipBackfillSummary(plan));

  if (plan.conflicts.length > 0) {
    console.warn(`[CP-OWNERSHIP] ${plan.conflicts.length} record(s) carry a conflicting partnerId and were left untouched. Review manually:`);
    for (const item of plan.conflicts.slice(0, 50)) {
      console.warn(`  - ${item.entity}/${item.entityId} (source ${item.sourceId}, company ${item.companyId}): existing=${item.existingPartnerId} source=${item.sourcePartnerId} (${item.reason})`);
    }
    if (plan.conflicts.length > 50) {
      console.warn(`  ...and ${plan.conflicts.length - 50} more.`);
    }
  }

  if (options.dryRun) {
    console.info('[CP-OWNERSHIP] Dry run (default). No Firestore writes were made. Pass --dryRun=false to apply.');
    return;
  }

  const customersToWrite = plan.customers.filter((c) => !c.alreadyOwned);
  const projectsToWrite = plan.projects.filter((p) => !p.alreadyOwned);
  const total = customersToWrite.length + projectsToWrite.length;
  if (total === 0) {
    console.info('[CP-OWNERSHIP] No records to write.');
    return;
  }

  const batchSize = 450;
  let committed = 0;
  for (let index = 0; index < total; index += batchSize) {
    const slice = [
      ...customersToWrite.slice(index, index + batchSize),
      ...projectsToWrite.slice(Math.max(0, index - customersToWrite.length), Math.max(0, index - customersToWrite.length + batchSize)),
    ];
    const batch = writeBatch(db);
    for (const item of slice) {
      if ('customerId' in item && 'leadId' in item) {
        // Customer candidate ({ customerId, leadId, partnerId, partnerName })
        batch.update(doc(db, PARTNER_OWNERSHIP_BACKFILL_COLLECTIONS.CUSTOMERS, item.customerId), {
          partnerId: item.partnerId,
          ...(item.partnerName ? { partnerName: item.partnerName } : {}),
        });
      } else if ('projectId' in item) {
        const projectItem = item as typeof projectsToWrite[number];
        batch.update(doc(db, PARTNER_OWNERSHIP_BACKFILL_COLLECTIONS.PROJECTS, projectItem.projectId), {
          partnerId: projectItem.partnerId,
          ...(projectItem.partnerName ? { partnerName: projectItem.partnerName } : {}),
          ...(projectItem.leadId ? { leadId: projectItem.leadId } : {}),
        });
      }
    }
    await batch.commit();
    committed += slice.length;
    console.info(`[CP-OWNERSHIP] Updated ${committed}/${total} records`);
  }

  console.info('[CP-OWNERSHIP] Backfill completed successfully.');
}

main().catch((error) => {
  console.error('[CP-OWNERSHIP] Backfill failed');
  console.error(error);
  void shutdown(1);
}).then(() => {
  void shutdown(0);
});
