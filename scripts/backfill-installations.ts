import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { deleteApp, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { collection, connectFirestoreEmulator, doc, getDocs, getFirestore, writeBatch } from 'firebase/firestore';

import {
  buildInstallationBackfillPlan,
  formatInstallationBackfillSummary,
  INSTALLATION_BACKFILL_COLLECTIONS,
  type InstallationBackfillInput,
} from '../src/lib/installationBackfill.ts';

// Phase 10: creates the real, Project-scoped `installations` document for
// historical Leads whose installation progress predates
// installationEngine.ts's dual-write fix. Mirrors
// scripts/backfill-order-type.ts's structure exactly (env loading, dry-run
// support, batched writes) — no new script pattern.

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
      console.warn('[P10-INSTALLATIONS] Firebase app shutdown warning', error);
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
    companyId: args.get('companyId') || args.get('company') || process.env.P10_INSTALLATIONS_COMPANY_ID?.trim() || undefined,
    dryRun: String(args.get('dryRun') || process.env.P10_INSTALLATIONS_DRY_RUN || 'true').toLowerCase() !== 'false',
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

  const email = process.env.P10_INSTALLATIONS_FIREBASE_EMAIL?.trim() || 'admin@neozy.in';
  const password = process.env.P10_INSTALLATIONS_FIREBASE_PASSWORD?.trim() || 'admin123';
  if (!process.env.P10_INSTALLATIONS_FIREBASE_EMAIL || !process.env.P10_INSTALLATIONS_FIREBASE_PASSWORD) {
    console.warn('[P10-INSTALLATIONS] Falling back to the documented demo admin credentials. Provide P10_INSTALLATIONS_FIREBASE_EMAIL/P10_INSTALLATIONS_FIREBASE_PASSWORD for a non-default run.');
  }
  await signInWithEmailAndPassword(auth, email, password);
  const userId = auth.currentUser?.uid || 'system';

  console.info('[P10-INSTALLATIONS] Loading source records...');
  const [leads, installations] = await Promise.all([
    loadCollection(db, INSTALLATION_BACKFILL_COLLECTIONS.LEADS),
    loadCollection(db, INSTALLATION_BACKFILL_COLLECTIONS.INSTALLATIONS),
  ]);

  const input: InstallationBackfillInput = { leads, installations } as InstallationBackfillInput;
  const plan = buildInstallationBackfillPlan(input, { companyId: options.companyId });

  console.info(`[P10-INSTALLATIONS] Signed in as ${userId}`);
  if (options.companyId) {
    console.info(`[P10-INSTALLATIONS] Company filter: ${options.companyId}`);
  }
  console.info(formatInstallationBackfillSummary(plan.summary));

  if (plan.orphaned.length > 0) {
    console.warn(`[P10-INSTALLATIONS] ${plan.orphaned.length} Lead(s) have installation data but no linked Project and were left untouched. Review manually:`);
    for (const item of plan.orphaned.slice(0, 50)) {
      console.warn(`  - lead ${item.leadId} (company ${item.companyId}): ${item.reason}`);
    }
    if (plan.orphaned.length > 50) {
      console.warn(`  ...and ${plan.orphaned.length - 50} more.`);
    }
  }

  if (options.dryRun) {
    console.info('[P10-INSTALLATIONS] Dry run (default). No Firestore writes were made. Pass --dryRun=false to apply.');
    return;
  }

  if (plan.creations.length === 0) {
    console.info('[P10-INSTALLATIONS] No installation documents to create.');
    return;
  }

  const batchSize = 450;
  let committed = 0;
  const now = new Date().toISOString();
  for (let index = 0; index < plan.creations.length; index += batchSize) {
    const slice = plan.creations.slice(index, index + batchSize);
    const batch = writeBatch(db);
    for (const item of slice) {
      const id = `INST-BACKFILL-${item.leadId}`;
      batch.set(doc(db, INSTALLATION_BACKFILL_COLLECTIONS.INSTALLATIONS, id), {
        id,
        installationId: id,
        projectId: item.projectId,
        leadId: item.leadId,
        companyId: item.companyId || 'default',
        installationStatus: item.installationStatus,
        checklist: item.checklist,
        capturedSerialNumbers: item.capturedSerialNumbers,
        assignedEngineerId: item.assignedEngineerId,
        assignedEngineerName: item.assignedEngineerName,
        assignedEngineerPhone: item.assignedEngineerPhone,
        createdBy: userId,
        updatedBy: userId,
        createdAt: now,
        updatedAt: now,
        isDeleted: false,
      });
    }
    await batch.commit();
    committed += slice.length;
    console.info(`[P10-INSTALLATIONS] Created ${committed}/${plan.creations.length} installation documents`);
  }

  console.info('[P10-INSTALLATIONS] Backfill completed successfully.');
}

main().catch((error) => {
  console.error('[P10-INSTALLATIONS] Backfill failed');
  console.error(error);
  void shutdown(1);
}).then(() => {
  void shutdown(0);
});
