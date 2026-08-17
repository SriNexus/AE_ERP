// Phase 5.1 Runtime Validation — throwaway seed script for the LOCAL Firebase
// emulator suite only. Never run this against a real project: it uses
// firebase-admin's Application Default credential path, which the Admin SDK
// automatically routes to the emulator when FIRESTORE_EMULATOR_HOST /
// FIREBASE_AUTH_EMULATOR_HOST env vars are set (see run-emulator-tests.mjs).
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error('REFUSING TO SEED: FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST not set. This script must only run against the local emulator.');
  process.exit(1);
}

const PROJECT_ID = 'demo-neozy-local';
const app = initializeApp({ projectId: PROJECT_ID });
const db = getFirestore(app);
const auth = getAuth(app);

export const SEED = {
  companyId: 'COMP-TEST-1',
  adminUid: 'USER-ADMIN-1',
  adminEmail: 'admin@test.local',
  adminPassword: 'TestPass123!',
  viewOnlyUid: 'USER-VIEWONLY-1',
  viewOnlyEmail: 'viewonly@test.local',
  viewOnlyPassword: 'TestPass123!',
  viewOnlyRoleId: 'ROLE-VIEWONLY-1',
  customerB2B: 'CUST-B2B-1',
  customerB2C: 'CUST-B2C-1',
  customerThird: 'CUST-EXTRA-1',
  customerFromLead: 'CUST-FROM-LEAD-1',
  leadId: 'LEAD-SOURCE-1',
  customerB2CWithProject: 'CUST-B2C-PROJECT-1',
  projectForB2C: 'PROJ-SEED-1',
};

async function seed() {
  const now = Timestamp.now();

  try {
    await auth.deleteUser(SEED.adminUid);
  } catch { /* did not exist */ }
  await auth.createUser({
    uid: SEED.adminUid,
    email: SEED.adminEmail,
    password: SEED.adminPassword,
    emailVerified: true,
  });

  await db.collection('companies').doc(SEED.companyId).set({
    id: SEED.companyId,
    name: 'Test Solar Co',
    shortName: 'TestSolar',
    companyCode: 'TSC',
    tagline: 'Runtime validation tenant',
    address: '1 Test Park', city: 'Pune', state: 'Maharashtra', pincode: '411001', country: 'India',
    phone: '9800000000', email: 'ops@testsolar.local',
    gst: '27TESTS0001Z5', pan: 'TESTS0001A',
    bankName: 'Test Bank', bankAccount: '000111222333', bankIfsc: 'TEST0000001', bankBranch: 'Pune Main',
    currency: 'INR', currencySymbol: '₹', status: 'Active', isDefault: true,
    primaryColor: '#4f46e5', accentColor: '#10b981',
  });

  await db.collection('users').doc(SEED.adminUid).set({
    id: SEED.adminUid,
    companyId: SEED.companyId,
    email: SEED.adminEmail,
    name: 'Runtime Validator',
    displayName: 'Runtime Validator',
    phone: '9800000001',
    role: 'Admin',
    status: 'Active',
    isSuperAdmin: false,
  });

  // firestore.rules resolves the caller's identity via
  // user_auth_maps/{authUid} -> userId -> users/{userId}, NOT via custom auth
  // claims and NOT by assuming users/{authUid} directly (hasUserProfile() /
  // sameCompany() / isAdmin() all fail without this doc, which silently
  // breaks every permission check for a seeded user). The real app's sign-up
  // flow creates this mapping; this throwaway seed must replicate it.
  await db.collection('user_auth_maps').doc(SEED.adminUid).set({
    authUid: SEED.adminUid,
    userId: SEED.adminUid,
    companyId: SEED.companyId,
    email: SEED.adminEmail,
    createdAt: now, updatedAt: now,
  });

  // Permission-audit user: a real role document with customers.edit = false,
  // to prove Save is actually rejected server/handler-side, not merely hidden.
  try { await auth.deleteUser(SEED.viewOnlyUid); } catch { /* did not exist */ }
  await auth.createUser({
    uid: SEED.viewOnlyUid,
    email: SEED.viewOnlyEmail,
    password: SEED.viewOnlyPassword,
    emailVerified: true,
  });
  // lib/permissions.ts's resolveCompatibleRole() only resolves a role name
  // reliably via its static EXACT_ROLE_COMPATIBILITY table (a dynamic-cache
  // lookup by an unrecognized custom name like the original 'ViewOnly' is not
  // dependable) — but a name that collides with a REAL auto-bootstrapped
  // system role (e.g. 'Accounts') gets shadowed in the name-keyed permission
  // cache by a second, separately-created system-default role document
  // (useGlobalBoot.ts seeds any "missing system role" the moment an Admin
  // logs in, under a doc ID equal to the role's own name) — confirmed via a
  // direct Firestore read showing both 'ROLE-VIEWONLY-1' (this doc) and a
  // distinct 'Accounts' doc after the Admin-user tests ran first. 'Acc' is in
  // the same static compatibility table ('acc': 'Acc') but is NOT one of the
  // real auto-seeded system roles, so it resolves reliably without colliding.
  await db.collection('roles').doc(SEED.viewOnlyRoleId).set({
    id: SEED.viewOnlyRoleId,
    name: 'Acc',
    schemaVersion: 1,
    description: 'Runtime-validation role with view-only customers access.',
    permissions: {
      customers: { view: true, create: false, edit: false, delete: false, cancel: false, approve: false, export: false, import: false, view_pricing: false, visibility: 'all' },
      leads: { view: true, create: false, edit: false, delete: false, cancel: false, approve: false, export: false, import: false, view_pricing: false, visibility: 'all' },
      dashboard: { view: true, create: false, edit: false, delete: false, cancel: false, approve: false, export: false, import: false, view_pricing: false, visibility: 'all' },
    },
  });
  await db.collection('users').doc(SEED.viewOnlyUid).set({
    id: SEED.viewOnlyUid,
    companyId: SEED.companyId,
    email: SEED.viewOnlyEmail,
    name: 'Runtime ViewOnly',
    displayName: 'Runtime ViewOnly',
    phone: '9800000002',
    role: 'Acc',
    status: 'Active',
    isSuperAdmin: false,
  });
  await db.collection('user_auth_maps').doc(SEED.viewOnlyUid).set({
    authUid: SEED.viewOnlyUid,
    userId: SEED.viewOnlyUid,
    companyId: SEED.companyId,
    email: SEED.viewOnlyEmail,
    createdAt: now, updatedAt: now,
  });

  await db.collection('customers').doc(SEED.customerB2B).set({
    id: SEED.customerB2B,
    companyId: SEED.companyId,
    type: 'B2B',
    name: 'Acme Solar Industries',
    phone: '9876500001',
    email: 'acme@example.com',
    company: 'Acme Solar Industries Pvt Ltd',
    gst: '27AAAAA0000A1Z5',
    pan: 'AAAAA0000A',
    address: '123 Industrial Area, Phase 2',
    city: 'Pune', state: 'Maharashtra', pincode: '411001', country: 'India',
    creditLimit: 50000, paymentTerms: 30,
    notes: 'Original seed notes for B2B customer.',
    assignedToId: '', assignedToName: '',
    isDeleted: false,
    activityLog: [],
    createdAt: now, updatedAt: now, createdBy: SEED.adminUid, updatedBy: SEED.adminUid,
  });

  await db.collection('customers').doc(SEED.customerB2C).set({
    id: SEED.customerB2C,
    companyId: SEED.companyId,
    type: 'B2C',
    name: 'Ramesh Kumar',
    phone: '9876500002',
    email: 'ramesh@example.com',
    company: '',
    gst: '', pan: '',
    address: '45 MG Road', city: 'Nagpur', state: 'Maharashtra', pincode: '440001', country: 'India',
    creditLimit: 0, paymentTerms: 30,
    notes: 'Original seed notes for B2C customer.',
    assignedToId: '', assignedToName: '',
    isDeleted: false,
    activityLog: [],
    createdAt: now, updatedAt: now, createdBy: SEED.adminUid, updatedBy: SEED.adminUid,
  });

  // Two orders for the B2B customer — Header/action cleanup mission's
  // Generate Invoice modal (order selection, newest-first sort).
  await db.collection('orders').doc('ORDER-OLDER-1').set({
    id: 'ORDER-OLDER-1', companyId: SEED.companyId,
    customerId: SEED.customerB2B, customer: 'Acme Solar Industries',
    orderNumber: 'ORD-0001', orderType: 'B2B', status: 'Delivered',
    date: '2026-01-05', total: 45000, subtotal: 45000, taxAmount: 0, discount: 0,
    items: [{ name: '5kW Solar Panel Set', qty: 1, price: 45000 }],
    isDeleted: false, createdAt: now, updatedAt: now, createdBy: SEED.adminUid, updatedBy: SEED.adminUid,
  });
  await db.collection('orders').doc('ORDER-NEWER-1').set({
    id: 'ORDER-NEWER-1', companyId: SEED.companyId,
    customerId: SEED.customerB2B, customer: 'Acme Solar Industries',
    orderNumber: 'ORD-0002', orderType: 'B2B', status: 'Pending',
    date: '2026-07-20', total: 72000, subtotal: 72000, taxAmount: 0, discount: 0,
    items: [{ name: '8kW Solar Panel Set', qty: 1, price: 72000 }],
    isDeleted: false, createdAt: now, updatedAt: now, createdBy: SEED.adminUid, updatedBy: SEED.adminUid,
  });

  // Central Panel Refinement mission — B2B Invoice/Dispatch section
  // fixtures: a dispatch-ready order (with productId/pendingQty, matching
  // the real Order schema requestDispatch()'s loadOrderForDispatch expects),
  // its product, a warehouse, an existing invoice, and an existing dispatch.
  await db.collection('products').doc('PROD-TEST-1').set({
    id: 'PROD-TEST-1', companyId: SEED.companyId, name: 'Test Solar Panel 5kW',
    trackingType: 'none', unit: 'PCS', price: 15000, tax: 0,
    isDeleted: false, createdAt: now, updatedAt: now,
  });
  await db.collection('warehouses').doc('WH-TEST-1').set({
    id: 'WH-TEST-1', companyId: SEED.companyId, name: 'Main Warehouse',
    isDeleted: false, createdAt: now, updatedAt: now,
  });
  // Dated between the two existing seed orders (2026-01-05 / 2026-07-20) so
  // it doesn't disturb customerWorkspace.headerCleanup.spec.ts's own
  // "ORD-0002 is most recent" assertion for the Generate Invoice modal.
  await db.collection('orders').doc('ORDER-DISPATCH-TEST-1').set({
    id: 'ORDER-DISPATCH-TEST-1', companyId: SEED.companyId,
    customerId: SEED.customerB2B, customer: 'Acme Solar Industries',
    orderNumber: 'ORD-0003', orderType: 'B2B', status: 'Pending',
    date: '2026-03-01', total: 30000, subtotal: 30000, taxAmount: 0, discount: 0,
    items: [{ productId: 'PROD-TEST-1', product: 'Test Solar Panel 5kW', qty: 2, pendingQty: 2, unit: 'PCS', price: 15000 }],
    isDeleted: false, createdAt: now, updatedAt: now, createdBy: SEED.adminUid, updatedBy: SEED.adminUid,
  });
  await db.collection('proforma_invoices').doc('INV-SEED-1').set({
    id: 'INV-SEED-1', companyId: SEED.companyId,
    customerId: SEED.customerB2B, customer: 'Acme Solar Industries',
    orderId: 'ORDER-OLDER-1', invoiceNumber: 'INV-0001', piNumber: 'INV-0001',
    date: '2026-01-06', total: 45000, subtotal: 45000, taxAmount: 0,
    status: 'Draft', paymentStatus: 'Pending', approvalStatus: 'Pending', items: [],
    isDeleted: false, createdAt: now, updatedAt: now, createdBy: SEED.adminUid, updatedBy: SEED.adminUid,
  });
  await db.collection('dispatch').doc('DISPATCH-SEED-1').set({
    id: 'DISPATCH-SEED-1', dispatchId: 'DISPATCH-SEED-1', dispatchNumber: 'DSP-0001', companyId: SEED.companyId,
    customerId: SEED.customerB2B, customer: 'Acme Solar Industries',
    orderId: 'ORDER-OLDER-1', warehouseId: 'WH-TEST-1', warehouse: 'Main Warehouse',
    vehicleNo: 'MH12AB1234', driverName: 'Ramesh Driver', driverPhone: '9999900000',
    status: 'Pending Verification', approvalStatus: 'Pending',
    date: '2026-01-07', items: [],
    isDeleted: false, createdAt: now, updatedAt: now, createdBy: SEED.adminUid, updatedBy: SEED.adminUid,
  });
  // Compact Workspace & Central Panel B2B Workflow mission — Payment stage
  // fixture (lib/paymentWorkflow.ts's own PaymentRecord shape, customerId
  // directly on the record like every other B2B stage).
  await db.collection('payments').doc('PAY-SEED-1').set({
    id: 'PAY-SEED-1', companyId: SEED.companyId,
    customerId: SEED.customerB2B, customerName: 'Acme Solar Industries',
    orderId: 'ORDER-OLDER-1', taxInvoiceId: 'INV-SEED-1',
    amount: 45000, mode: 'Bank Transfer', reference: 'TXN-SEED-1', notes: '',
    date: '2026-01-08', status: 'Received', statusHistory: [],
    isDeleted: false, createdAt: now, updatedAt: now, createdBy: SEED.adminUid, updatedBy: SEED.adminUid,
  });

  await db.collection('customers').doc(SEED.customerThird).set({
    id: SEED.customerThird,
    companyId: SEED.companyId,
    type: 'B2B',
    name: 'Zenith Power Traders',
    phone: '9876500003',
    email: 'zenith@example.com',
    company: 'Zenith Power Traders',
    gst: '', pan: '',
    address: '9 Market Yard', city: 'Nashik', state: 'Maharashtra', pincode: '422001', country: 'India',
    creditLimit: 10000, paymentTerms: 15,
    notes: 'Third seed customer for previous/next boundary testing.',
    assignedToId: '', assignedToName: '',
    isDeleted: false,
    activityLog: [],
    createdAt: now, updatedAt: now, createdBy: SEED.adminUid, updatedBy: SEED.adminUid,
  });

  // Left Panel/Tabs/Documents/Footer UI standardization mission: a shared
  // document reference (same id/url on both records), simulating exactly
  // what convertLeadToCustomer() now does at conversion time — carries the
  // lead's already-normalized document list onto the new customer as the
  // SAME reference, not a re-upload. Runtime tests assert this same document
  // is visible in the Customer Workspace without a second upload.
  const sharedDocument = {
    id: 'DOC-SHARED-1',
    name: 'electricity-bill-suresh.pdf',
    url: 'https://example.com/fake-storage/electricity-bill-suresh.pdf',
    mimeType: 'application/pdf',
    size: 102400,
    uploadedAt: now.toDate().toISOString(),
    label: 'Electricity Bill',
  };

  await db.collection('leads').doc(SEED.leadId).set({
    id: SEED.leadId,
    companyId: SEED.companyId,
    name: 'Suresh Patil',
    phone: '9876500004',
    email: 'suresh@example.com',
    city: 'Pune', state: 'Maharashtra',
    source: 'Website', status: 'Converted',
    assignedToId: '', assignedToName: '',
    notes: 'Converted lead, source for CUST-FROM-LEAD-1.',
    convertedCustomerId: SEED.customerFromLead,
    documents: [sharedDocument],
    isDeleted: false,
    createdAt: now, updatedAt: now, createdBy: SEED.adminUid, updatedBy: SEED.adminUid,
  });

  await db.collection('customers').doc(SEED.customerFromLead).set({
    id: SEED.customerFromLead,
    companyId: SEED.companyId,
    type: 'B2C',
    name: 'Suresh Patil',
    phone: '9876500004',
    email: 'suresh@example.com',
    company: '',
    gst: '', pan: '',
    address: '', city: 'Pune', state: 'Maharashtra', pincode: '', country: 'India',
    creditLimit: 0, paymentTerms: 30,
    notes: 'Created from lead conversion — identity locked.',
    assignedToId: '', assignedToName: '',
    sourceLeadId: SEED.leadId,
    documents: [sharedDocument],
    isDeleted: false,
    activityLog: [],
    createdAt: now, updatedAt: now, createdBy: SEED.adminUid, updatedBy: SEED.adminUid,
  });

  // Central Panel Business Model Correction mission: a B2C customer with an
  // existing Project — exercises the "Customer Workspace becomes a tracking
  // view, Project Workspace becomes the operational workspace" state.
  await db.collection('customers').doc(SEED.customerB2CWithProject).set({
    id: SEED.customerB2CWithProject,
    companyId: SEED.companyId,
    type: 'B2C',
    name: 'Anita Deshmukh',
    phone: '9876500005',
    email: 'anita@example.com',
    company: '',
    gst: '', pan: '',
    address: '12 Lake View Road', city: 'Nashik', state: 'Maharashtra', pincode: '422002', country: 'India',
    creditLimit: 0, paymentTerms: 30,
    notes: 'B2C customer with an active project — Central Panel lifecycle correction fixture.',
    assignedToId: '', assignedToName: '',
    isDeleted: false,
    activityLog: [],
    createdAt: now, updatedAt: now, createdBy: SEED.adminUid, updatedBy: SEED.adminUid,
  });

  await db.collection('projects').doc(SEED.projectForB2C).set({
    id: SEED.projectForB2C,
    projectId: 'PRJ-0001',
    companyId: SEED.companyId,
    customerId: SEED.customerB2CWithProject,
    capacityKw: 5,
    siteAddress: { line1: '12 Lake View Road', line2: '', landmark: '', city: 'Nashik', district: 'Nashik', state: 'Maharashtra', pincode: '422002', country: 'India' },
    currentStage: 'Installation',
    stageHistory: [
      { stage: 'Survey', changedAt: now.toDate().toISOString() },
      { stage: 'Engineering', changedAt: now.toDate().toISOString() },
      { stage: 'Quotation', changedAt: now.toDate().toISOString() },
      { stage: 'Order', changedAt: now.toDate().toISOString() },
      { stage: 'Procurement', changedAt: now.toDate().toISOString() },
      { stage: 'Dispatch', changedAt: now.toDate().toISOString() },
    ],
    linkedQuotationIds: [], linkedOrderIds: [], linkedDispatchIds: [],
    isDeleted: false,
    createdAt: now, updatedAt: now, createdBy: SEED.adminUid, updatedBy: SEED.adminUid,
  });

  // The real app's createCustomerProjectionInTransaction() always creates a
  // matching customer_phone_locks/{companyId}_{phone} doc atomically with
  // every customer (useCustomers.ts). This seed wrote customer docs directly
  // (bypassing that transaction), so it must replicate the lock docs too —
  // firestore.rules' canReadCompanyScoped() crashes with a null-value error
  // when a get() targets a genuinely nonexistent document (resource.data is
  // null), which is exactly what updateCustomerProjectionWithPhoneLock's own
  // transaction.get(nextLockRef) hits on Save otherwise.
  const phoneLocks = [
    { phone: '9876500001', customerId: SEED.customerB2B },
    { phone: '9876500002', customerId: SEED.customerB2C },
    { phone: '9876500003', customerId: SEED.customerThird },
    { phone: '9876500004', customerId: SEED.customerFromLead },
    { phone: '9876500005', customerId: SEED.customerB2CWithProject },
  ];
  for (const { phone, customerId } of phoneLocks) {
    const lockId = `${SEED.companyId}_${phone}`;
    await db.collection('customer_phone_locks').doc(lockId).set({
      id: lockId, companyId: SEED.companyId, phone, customerId,
      createdAt: now, updatedAt: now, isDeleted: false,
    });
  }

  console.log('SEED_OK', JSON.stringify(SEED));
}

await seed();
process.exit(0);
