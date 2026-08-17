/**
 * Firebase Admin SDK — Server-side Firestore access
 *
 * Initialized lazily as a singleton. Requires FIREBASE_SERVICE_ACCOUNT_KEY
 * environment variable (set in Vercel dashboard or .env for local dev).
 */

import { initializeApp, getApps, cert, type AppOptions } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
type Bucket = ReturnType<ReturnType<typeof getStorage>['bucket']>;

let _db: Firestore | null = null;
let _bucket: Bucket | null = null;

export function getAdminDb(): Firestore {
  if (_db) return _db;

  const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountRaw) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_KEY is not set. '
      + 'Set it in Vercel dashboard or .env with the Firebase service account JSON.'
    );
  }

  let serviceAccount: Record<string, string>;
  try {
    serviceAccount = JSON.parse(serviceAccountRaw);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON.');
  }

  if (getApps().length === 0) {
    const options: AppOptions = {
      credential: cert(serviceAccount as any),
      projectId: serviceAccount.project_id,
    };
    initializeApp(options);
  }

  _db = getFirestore();
  return _db;
}

/**
 * Get the Firebase project ID from the service account, or fallback to env.
 */
export function getProjectId(): string {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return parsed.project_id || process.env.VITE_FIREBASE_PROJECT_ID || '';
    } catch {
      // fall through
    }
  }
  return process.env.VITE_FIREBASE_PROJECT_ID || '';
}

/**
 * Get the default Firebase Storage bucket for secure server-side secret storage.
 */
export function getAdminStorageBucket(): Bucket {
  if (_bucket) return _bucket;

  const bucketName =
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.VITE_FIREBASE_STORAGE_BUCKET ||
    (getProjectId() ? `${getProjectId()}.appspot.com` : '');

  if (!bucketName) {
    throw new Error(
      'Firebase storage bucket is not configured. ' +
      'Set FIREBASE_STORAGE_BUCKET or VITE_FIREBASE_STORAGE_BUCKET in the server environment.'
    );
  }

  _bucket = getStorage().bucket(bucketName);
  return _bucket;
}

/**
 * Verify the admin SDK is properly configured.
 */
export function isAdminConfigured(): boolean {
  try {
    getAdminDb();
    return true;
  } catch {
    return false;
  }
}
