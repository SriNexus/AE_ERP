import { getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import {
  connectFirestoreEmulator,
  getCountFromServer,
  getDocs,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Query,
  type Firestore,
} from 'firebase/firestore';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage';

const REQUIRED_FIREBASE_ENV_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

const PLACEHOLDER_VALUE_PATTERN = /^(your_.+_here|REPLACE_WITH_.+)$/i;

function readFirebaseEnv(name: string) {
  const value = (import.meta.env as Record<string, string | undefined>)[name]?.trim();
  return value && !PLACEHOLDER_VALUE_PATTERN.test(value) ? value : undefined;
}

function createMissingFirebaseConfigError() {
  return new Error(getFirebaseConfigErrorMessage());
}

function createUnavailableFirebaseService<T extends object>(): T {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'currentUser') return null;
        if (prop === 'signOut') return () => Promise.reject(createMissingFirebaseConfigError());
        throw createMissingFirebaseConfigError();
      },
    }
  ) as T;
}

export const firebaseConfig = {
  apiKey: readFirebaseEnv('VITE_FIREBASE_API_KEY'),
  authDomain: readFirebaseEnv('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: readFirebaseEnv('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: readFirebaseEnv('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: readFirebaseEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: readFirebaseEnv('VITE_FIREBASE_APP_ID'),
  measurementId: readFirebaseEnv('VITE_FIREBASE_MEASUREMENT_ID'),
};

export const firebaseEnv = {
  isConfigured: REQUIRED_FIREBASE_ENV_KEYS.every((key) => Boolean(readFirebaseEnv(key))),
  missingKeys: REQUIRED_FIREBASE_ENV_KEYS.filter((key) => !readFirebaseEnv(key)),
};

export function getFirebaseConfigErrorMessage() {
  if (import.meta.env.DEV) {
    return [
      'Missing Firebase Configuration',
      '',
      'Missing:',
      ...firebaseEnv.missingKeys.map((key) => `- ${key}`),
      '',
      'Action:',
      'Create .env.local using .env.example and restart Vite.',
    ].join('\n');
  }

  return [
    'Firebase Configuration Unavailable',
    '',
    'This deployment is missing required Firebase environment variables:',
    ...firebaseEnv.missingKeys.map((key) => `- ${key}`),
    '',
    'This is a deployment configuration issue, not a code issue.',
    'An administrator must add these variables to the hosting provider\'s',
    'environment configuration (scoped to this deployment environment) and',
    'trigger a new build — Firebase configuration is applied at build time',
    'and will not appear until the app is rebuilt after the variables are added.',
  ].join('\n');
}

if (!firebaseEnv.isConfigured) {
  console.info('[Neozy] Firebase configuration not found; the application requires a valid Firebase configuration. Sign in with demo@neozy.in on the deployed application, or configure VITE_FIREBASE_* environment variables for local development.');
}

export const app = (firebaseEnv.isConfigured
  ? getApps()[0] ?? initializeApp(firebaseConfig as FirebaseOptions)
  : null) as FirebaseApp;
// Modern offline persistence (Firebase v11+): replaces deprecated enableIndexedDbPersistence
export const db = (firebaseEnv.isConfigured
  ? initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(), // Supports multiple browser tabs safely
      }),
    })
  : createUnavailableFirebaseService<Firestore>());
export const auth = (firebaseEnv.isConfigured ? getAuth(app) : createUnavailableFirebaseService<Auth>());
export const storage = (firebaseEnv.isConfigured ? getStorage(app) : createUnavailableFirebaseService<FirebaseStorage>());

type FirebaseRuntimeState = {
  diagnosticsLogged?: boolean;
  emulatorConnected?: boolean;
  aggregationWarningLogged?: boolean;
  aggregationFallbackCache?: Map<string, { count: number; expiresAt: number }>;
};

const firebaseRuntimeState = globalThis as typeof globalThis & {
  __NEOZY_FIREBASE__?: FirebaseRuntimeState;
};

const runtimeState = firebaseRuntimeState.__NEOZY_FIREBASE__ ??= {};
runtimeState.aggregationFallbackCache ??= new Map();
const useEmulator = import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true';

if (firebaseEnv.isConfigured && useEmulator && !runtimeState.emulatorConnected) {
  const firestoreHost = import.meta.env.VITE_FIRESTORE_EMULATOR_HOST || '127.0.0.1';
  const firestorePort = Number(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT || 8080);
  const authUrl = import.meta.env.VITE_AUTH_EMULATOR_URL || 'http://127.0.0.1:9099';
  const storageHost = import.meta.env.VITE_STORAGE_EMULATOR_HOST || '127.0.0.1';
  const storagePort = Number(import.meta.env.VITE_STORAGE_EMULATOR_PORT || 9199);

  connectFirestoreEmulator(db, firestoreHost, firestorePort);
  connectAuthEmulator(auth, authUrl, { disableWarnings: true });
  connectStorageEmulator(storage, storageHost, storagePort);
  runtimeState.emulatorConnected = true;
}

if (firebaseEnv.isConfigured && !runtimeState.diagnosticsLogged) {
  const firestoreHost = import.meta.env.VITE_FIRESTORE_EMULATOR_HOST || '127.0.0.1';
  const firestorePort = Number(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT || 8080);
  console.info(
    `[Firebase]\nmode=${import.meta.env.MODE}\nproject=${firebaseConfig.projectId}\nauth=${useEmulator ? 'emulator' : 'cloud'}\nfirestore=${useEmulator ? `emulator:${firestoreHost}:${firestorePort}` : 'cloud'}`
  );
  runtimeState.diagnosticsLogged = true;
}

function isAggregationFallbackError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  const message = error instanceof Error ? error.message : String(error);
  return (
    code.includes('permission-denied') ||
    code.includes('failed-precondition') ||
    code.includes('unavailable') ||
    message.includes('RunAggregationQuery')
  );
}

export async function countDocumentsSafe<T>(firestoreQuery: Query<T>, cacheKey = String(firestoreQuery)): Promise<number> {
  if (!firebaseEnv.isConfigured) return 0;

  const cache = runtimeState.aggregationFallbackCache;
  const cached = cache?.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.count;
  }

  try {
    const snapshot = await getCountFromServer(firestoreQuery);
    return snapshot.data().count;
  } catch (error) {
    if (!isAggregationFallbackError(error)) {
      return 0;
    }

    if (!runtimeState.aggregationWarningLogged) {
      console.warn('[Firebase] aggregate count unavailable; falling back to document count.');
      runtimeState.aggregationWarningLogged = true;
    }

    try {
      const snapshot = await getDocs(firestoreQuery);
      const count = snapshot.size;
      cache?.set(cacheKey, { count, expiresAt: Date.now() + 30_000 });
      return count;
    } catch {
      cache?.set(cacheKey, { count: 0, expiresAt: Date.now() + 30_000 });
      return 0;
    }
  }
}

export const COLLECTIONS = {
  USERS:              'users',
  USER_AUTH_MAPS:     'user_auth_maps',
  COMPANIES:          'companies',
  LEADS:              'leads',
  FOLLOWUPS:          'followups',
  CUSTOMERS:          'customers',
  PROJECTS:           'projects',
  SURVEYS:            'surveys',
  ENGINEERING_DESIGNS:'engineering_designs',
  DOCUMENTS:          'documents',
  VENDORS:            'vendors',
  PURCHASE_ORDERS:    'purchase_orders',
  GOODS_RECEIPTS:     'goods_receipts',
  PRODUCTS:           'products',
  PRODUCT_CATEGORIES: 'product_categories',
  WAREHOUSES:         'warehouses',
  TEAMS:              'teams',
  STOCK:              'stock',
  STOCK_LEDGER:       'stock_ledger',
  ORDERS:             'orders',
  ORDER_ITEMS:        'order_items',
  PROFORMA_INVOICES:  'proforma_invoices',
  INVOICES:           'proforma_invoices',  // Alias: useDashboardData references INVOICES
  TAX_INVOICES:       'tax_invoices',
  PI_ITEMS:           'pi_items',
  QUOTATIONS:         'quotations',
  DISPATCH:           'dispatch',
  DISPATCH_ITEMS:     'dispatch_items',
  TRANSPORT:          'transport',
  PAYMENTS:           'payments',
  NOTIFICATIONS:      'notifications',
  SERIAL_NUMBERS:     'serial_numbers',
  DOCUMENT_COUNTERS:  'document_counters',
  AUDIT_LOGS:         'audit_logs',
  ENTITIES:           'entities',
  ENTITY_RELATIONSHIPS: 'entity_relationships',
  ACTIVITY:           'activity',
  EMPLOYEES:          'employees',
  ATTENDANCE:         'attendance',
  PAYROLL:            'payroll',
  ROLES:              'roles',
  CHANNEL_PARTNERS:   'channel_partners',
  PARTNER_WALLET_TXNS: 'partner_wallet_transactions',
  COMMISSION_RULES:   'commission_rules',
  COMMISSION_RECORDS: 'commission_records',
  // Phase 10: real, Project-scoped Installation entity — was previously
  // fields on Lead (installationChecklist/capturedSerialNumbers); see
  // src/lib/installationEngine.ts for the dual-write migration.
  INSTALLATIONS:      'installations',
  QC_CHECKS:          'qc_checks',
  COMMISSIONING_RECORDS: 'commissioning_records',
  NET_METERING_APPLICATIONS: 'net_metering_applications',
  SUBSIDY_APPLICATIONS:   'subsidy_applications',
  PROJECT_HANDOVERS:  'project_handovers',
  AMC_CONTRACTS:      'amc_contracts',
  SERVICE_TICKETS:    'service_tickets',
  GENERATION_READINGS:'generation_readings',
  SETTLEMENTS:        'settlements',
  SETTINGS:           'settings',
  BANKS:              'banks',
  LOAN_APPLICATIONS:      'registrations',
  // Phase 0 (Channel Partner / Vendor Lock): the NEW Registration
  // (Vendor Lock / Portal Registration) collection. Deliberately distinct
  // from the loan module's retained `registrations` collection.
  SCHEME_REGISTRATIONS:   'scheme_registrations',
  CASES:              'cases',
  DEVICE_TOKENS:      'device_tokens',
  NOTIFICATION_TEMPLATES: 'notification_templates',
  NOTIFICATION_LOGS:  'notification_logs',
  SECURITY_LOGS:      'security_logs',
  // Phase 1 (Multi-Tenant): Group tier — the tenant boundary above Company.
  GROUPS:             'groups',
  GROUP_MEMBERS:      'group_members',
  // Phase 1: platform-level collections with no tenant scoping.
  PLATFORM_SETTINGS:  'platform_settings',
  DEMO_OPERATIONS:    'demo_operations',
} as const;

export type CollectionKey = keyof typeof COLLECTIONS;
export type CollectionName = typeof COLLECTIONS[CollectionKey];
