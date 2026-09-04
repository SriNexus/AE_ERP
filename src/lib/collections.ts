/**
 * Firestore collection name constants — deliberately extracted from
 * `src/lib/firebase.ts` into their own zero-dependency module.
 *
 * `src/lib/firebase.ts` is a CLIENT-ONLY module: it reads
 * `import.meta.env.VITE_FIREBASE_*` at top level and calls the client SDK's
 * `initializeApp()`. `import.meta.env` only exists because Vite statically
 * transforms it at build time for browser bundles — it is `undefined` in a
 * plain Node.js runtime (e.g. a Vercel serverless function invoked via
 * `vercel dev` or in production), so importing ANYTHING from
 * `src/lib/firebase.ts` — even a single named export like `COLLECTIONS` —
 * executes that whole module's top-level code and throws
 * `Cannot read properties of undefined (reading 'VITE_FIREBASE_API_KEY')`
 * the moment it runs server-side. Three server files
 * (`api/_lib/biometrics/referenceStore.ts`, `api/_lib/biometrics/audit.ts`,
 * `api/biometrics/enroll.ts`) imported `COLLECTIONS` from
 * `src/lib/firebase.ts` for exactly this reason — this crashed EVERY
 * biometric API route on first invocation in a real Node.js runtime,
 * discovered via a real `vercel dev` run, not source inspection alone.
 *
 * This module has no imports and no side effects — safe for both the
 * browser bundle and every Node.js serverless function. `src/lib/
 * firebase.ts` re-exports from here so no existing client-side import path
 * (`import { COLLECTIONS } from '../lib/firebase'`, used across the whole
 * `src/` tree) needs to change.
 */

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
  STOCK_RESERVATIONS: 'stock_reservations',
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
  // Face Attendance + DeepFace Master Plan, Phase 3: one document per
  // enrolled employee's biometric reference (embedding only, never a raw
  // image — see docs/implementation/FACE_ATTENDANCE_DEEPFACE_MASTER_PLAN.md §9).
  BIOMETRIC_FACE_REFERENCES: 'biometric_face_references',
} as const;

export type CollectionKey = keyof typeof COLLECTIONS;
export type CollectionName = typeof COLLECTIONS[CollectionKey];
