import { applicationDefault, cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

export type DemoAdminContext = { app: App; projectId: string; db: ReturnType<typeof getFirestore>; auth: ReturnType<typeof getAuth> };

function projectFromFirebaseConfig(): string {
  try { return JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId || ''; } catch { return ''; }
}

export function resolveAdminProjectId(env = process.env): string {
  if (env.FIRESTORE_EMULATOR_HOST) return env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT || env.DEMO_FIREBASE_PROJECT_ID || '';
  if (env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try { return JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY).project_id || ''; } catch { throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON.'); }
  }
  return env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT || env.DEMO_FIREBASE_PROJECT_ID || projectFromFirebaseConfig();
}

export function createDemoAdminContext(env = process.env): DemoAdminContext {
  const projectId = resolveAdminProjectId(env);
  if (!projectId) throw new Error('Firebase project is unknown. Set DEMO_FIREBASE_PROJECT_ID or trusted Firebase environment.');
  let app = getApps().find((candidate) => candidate.name === 'neozy-demo-tooling');
  if (!app) {
    const serviceRaw = env.FIREBASE_SERVICE_ACCOUNT_KEY;
    const credential = serviceRaw ? cert(JSON.parse(serviceRaw)) : applicationDefault();
    app = initializeApp({ projectId, credential }, 'neozy-demo-tooling');
  }
  return { app, projectId, db: getFirestore(app), auth: getAuth(app) };
}
