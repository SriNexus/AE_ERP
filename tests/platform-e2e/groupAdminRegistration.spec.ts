// REAL-BROWSER acceptance for the 2026-09-10 Registration RBAC fix: a demo
// GroupAdmin (demo@neozy.in, company-demo-neozy, group-demo-neozy) must be
// able to open a B2C Project, see the Registration stage ACTIVE, and create a
// Scheme Registration from the actual Project Workspace UI — against the REAL
// firestore.rules, with NO "missing or insufficient permissions" — exactly as
// they can already create the parent Lead / Customer / Project.
//
// Run via:
//   DEMO_E2E_PASSWORD=<pw> node tests/platform-e2e/run-emulator-tests.mjs \
//     --grep "GroupAdmin Registration"
//
// Nothing here touches the real Firebase project: the app runs in emulator
// mode and this spec seeds the throwaway local emulator via the Admin SDK.
import { test, expect, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const DIAG_FILE = 'test-results/registration-e2e-diag.txt';

const DEMO_EMAIL = 'demo@neozy.in';
const DEMO_COMPANY_ID = 'company-demo-neozy';
const DEMO_ERP_USER_ID = 'MUSR-DEMO-0001';
const DEMO_GROUP_ID = 'group-demo-neozy';

const PROJECT_ID = 'demo-neozy-local';
const app = getApps().length ? getApps()[0] : initializeApp({ projectId: PROJECT_ID });
const db = getFirestore(app);
const auth = getAuth(app);

const MODULES = [
  'dashboard', 'projects', 'leads', 'customers', 'quotations', 'orders', 'dispatch',
  'surveys', 'engineering', 'installations', 'qc', 'commissioning', 'net_metering', 'subsidy',
  'service_tickets', 'inventory', 'stock', 'products', 'payments', 'invoices', 'employees',
  'users', 'roles', 'reports', 'categories', 'warehouses', 'attendance', 'payroll',
  'companies', 'settings', 'partners', 'tax_invoices', 'vendors', 'purchase_orders',
  'cases', 'loan_applications', 'banks', 'payouts', 'scheme_registration',
];
const ACTIONS = ['view', 'create', 'edit', 'delete', 'cancel', 'approve', 'disburse', 'export', 'import', 'view_pricing'];
function fullAdminPermissions() {
  return Object.fromEntries(MODULES.map((m) => [m, Object.fromEntries(ACTIONS.map((a) => [a, true]).concat([['visibility', 'all']]))]));
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await expect(async () => {
    if (!(await page.locator('#login-email:visible').isVisible().catch(() => false))) {
      await page.goto('/login');
    }
    await expect(page.locator('#login-email:visible')).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  await page.locator('#login-email:visible').fill(email);
  await page.locator('#login-password:visible').fill(password);
  await page.locator('button[type="submit"]:visible').click();
  await expect(page).not.toHaveURL(/login/, { timeout: 30_000 });
}

async function navigateViaSidebar(page: Page, groupLabel: string, childLabel: string) {
  const groupButton = page.getByRole('button', { name: groupLabel, exact: true });
  await groupButton.hover();
  const groupContainer = groupButton.locator('xpath=..');
  const child = groupContainer.getByRole('menuitem', { name: childLabel, exact: true })
    .or(groupContainer.getByRole('link', { name: childLabel, exact: true }));
  await expect(child).toBeVisible({ timeout: 10_000 });
  await child.click();
}

function fieldByLabelText(page: Page, labelText: string) {
  return page.locator('label', { hasText: labelText })
    .locator('xpath=following-sibling::*[self::input or self::select or self::textarea][1]')
    .first();
}

test.describe('Registration RBAC fix — GroupAdmin Registration end-to-end', () => {
  test('demo GroupAdmin opens a B2C project, Registration stage is active, and creates a Scheme Registration with no permission error', async ({ browser }) => {
    test.skip(!process.env.DEMO_E2E_PASSWORD, 'DEMO_E2E_PASSWORD is required and must be supplied only by the test environment.');
    const password = process.env.DEMO_E2E_PASSWORD!;
    const stamp = Date.now();
    const authUid = `demo-auth-${stamp}`;
    const customerId = `CUS-E2E-${stamp}`;
    const projectId = `PRJ-E2E-${stamp}`;            // seeded already at SchemeRegistration
    const legacyProjectId = `PRJ-LEGACY-${stamp}`;   // seeded at 'New' — proves the read-time stage map

    // ── 1. Seed the demo GroupAdmin identity chain + tenant + a B2C project ──
    try { await auth.deleteUser(authUid); } catch { /* did not exist */ }
    await auth.createUser({ uid: authUid, email: DEMO_EMAIL, password, emailVerified: true });
    await db.collection('users').doc(DEMO_ERP_USER_ID).set({
      id: DEMO_ERP_USER_ID, companyId: DEMO_COMPANY_ID, groupId: DEMO_GROUP_ID, email: DEMO_EMAIL,
      name: 'Neozy Demo Operator', displayName: 'Demo Operator',
      role: 'GroupAdmin', status: 'Active', isSuperAdmin: false, isDeleted: false,
    });
    await db.collection('user_auth_maps').doc(authUid).set({
      authUid, userId: DEMO_ERP_USER_ID, companyId: DEMO_COMPANY_ID, groupId: DEMO_GROUP_ID, email: DEMO_EMAIL,
      createdAt: new Date(), updatedAt: new Date(),
    });
    await db.collection('groups').doc(DEMO_GROUP_ID).set({
      id: DEMO_GROUP_ID, name: 'Neozy Demo Group', shortName: 'NeozyDemo', status: 'Active',
    });
    await db.collection('companies').doc(DEMO_COMPANY_ID).set({
      id: DEMO_COMPANY_ID, companyId: DEMO_COMPANY_ID, groupId: DEMO_GROUP_ID, name: 'Neozy Demo Company',
      shortName: 'NeozyDemo', status: 'Active', isDefault: true, businessMode: 'Both',
      currency: 'INR', currencySymbol: '₹',
    });
    await db.collection('roles').doc(`${DEMO_COMPANY_ID}_Admin`).set({
      id: `${DEMO_COMPANY_ID}_Admin`, companyId: DEMO_COMPANY_ID, name: 'Admin', schemaVersion: 1,
      isSystem: true, description: 'Seeded demo Admin template', permissions: fullAdminPermissions(),
    });

    await db.collection('customers').doc(customerId).set({
      id: customerId, companyId: DEMO_COMPANY_ID, groupId: DEMO_GROUP_ID, type: 'B2C',
      name: 'E2E Reg Customer', phone: '9990001234', email: 'e2e.reg.customer@example.test',
      status: 'Active', isDeleted: false, createdBy: 'seed', updatedBy: 'seed',
    });

    const projBase = {
      companyId: DEMO_COMPANY_ID, groupId: DEMO_GROUP_ID, customerId,
      capacityKw: 5, projectType: 'Residential', siteAddress: { city: 'Pune', state: 'Maharashtra', country: 'India' },
      linkedQuotationIds: [], linkedOrderIds: [], linkedDispatchIds: [],
      isDeleted: false, createdBy: 'seed', updatedBy: 'seed',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await db.collection('projects').doc(projectId).set({
      ...projBase, id: projectId, projectId,
      currentStage: 'SchemeRegistration',
      stageHistory: [{ stage: 'SchemeRegistration', changedAt: new Date().toISOString(), changedBy: 'seed', note: 'Project created' }],
    });
    await db.collection('projects').doc(legacyProjectId).set({
      ...projBase, id: legacyProjectId, projectId: legacyProjectId,
      currentStage: 'New',
      stageHistory: [{ stage: 'New', changedAt: new Date().toISOString(), changedBy: 'seed', note: 'legacy' }],
    });

    // ── 2. Log in as the GroupAdmin ──────────────────────────────────────
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const runtimeErrors: string[] = [];
    const allConsole: string[] = [];
    page.on('pageerror', (e) => runtimeErrors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      const line = `console.${m.type()}: ${m.text()}`;
      allConsole.push(line);
      if (m.type() === 'error') runtimeErrors.push(line);
    });
    const seenRequests: string[] = [];
    page.on('requestfinished', async (req) => {
      const u = req.url();
      if (/scheme_registration|Firestore|Write|Commit/i.test(u)) {
        const resp = await req.response();
        seenRequests.push(`${req.method()} ${u.slice(0, 120)} -> ${resp?.status()}`);
      }
    });
    await login(page, DEMO_EMAIL, password);

    // ── 3. Open the B2C project ──────────────────────────────────────────
    await navigateViaSidebar(page, 'Projects', 'Projects');
    await expect(page).toHaveURL(/\/projects/);
    await page.locator('tr', { hasText: 'E2E Reg Customer' }).first().click().catch(async () => {
      // fallback: direct nav if the list row isn't clickable
      await page.goto(`/projects/${projectId}`);
    });
    await expect(page).toHaveURL(new RegExp(`/projects/`), { timeout: 20_000 });

    // ── 4. Registration stage must be ACTIVE (not a locked card) ─────────
    const regCard = page.locator('[data-testid="project-stage-card"], .project-stage-card')
      .filter({ hasText: 'Registration' })
      .or(page.locator('div', { hasText: /^Registration/ }).first());
    // The stage rail renders each stage title; the Registration one must be
    // expandable (status current), not disabled/locked.
    const regToggle = page.getByRole('button', { name: /Registration/ }).first();
    await expect(regToggle).toBeVisible({ timeout: 20_000 });
    await regToggle.click();

    // ── 5. The create form renders (proves the card is not locked) ───────
    await expect(page.getByRole('button', { name: 'Create Registration Draft' })).toBeVisible({ timeout: 15_000 });

    // Vendor is auto-derived from the company; scheme is optional. Fill a
    // scheme so the record is meaningful, then submit.
    await fieldByLabelText(page, 'Scheme').selectOption({ index: 1 }).catch(() => {});

    // ── 6. CREATE — the exact operation that returned "missing or
    //       insufficient permissions" before the fix ────────────────────
    const submitBtn = page.getByRole('button', { name: 'Create Registration Draft' });
    const btnCount = await submitBtn.count();
    const btnEnabled = btnCount ? await submitBtn.first().isEnabled() : false;
    // Catch the success toast (react-hot-toast success auto-dismisses ~2s) —
    // set the waiter up BEFORE the click.
    const okToast = page.getByText('Scheme registration draft created');
    const okToastSeen = okToast.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
    await submitBtn.first().click();
    const toastOk = await okToastSeen;

    // The DURABLE success signal: the create form is replaced by the record
    // view (showCreateForm=false once a non-Cancelled record exists) and the
    // record persisted in Firestore.
    const recordViewShown = await page.getByText(/^No registration filed yet/).isHidden({ timeout: 15_000 }).catch(() => false)
      || await page.getByText('Status Timeline').isVisible({ timeout: 5_000 }).catch(() => false);
    await page.waitForTimeout(1500);
    const snap = await db.collection('scheme_registrations').where('projectId', '==', projectId).limit(1).get();
    const rec = snap.empty ? null : snap.docs[0].data();

    const diag = [
      `RESULT: ${rec ? 'SUCCESS (persisted)' : 'FAILURE'}`,
      `success toast seen: ${toastOk}`,
      `record view shown (form gone): ${recordViewShown}`,
      `submit button: count=${btnCount} enabled=${btnEnabled}`,
      `persisted scheme_registration: ${rec ? JSON.stringify({ companyId: rec.companyId, groupId: rec.groupId, status: rec.status, vendorName: rec.vendorName, applicantName: rec.applicantName }) : 'NONE'}`,
      `runtimeErrors:\n${runtimeErrors.join('\n') || '(none)'}`,
      `--- console (last 40) ---\n${allConsole.slice(-40).join('\n')}`,
    ].join('\n');
    writeFileSync(DIAG_FILE, diag);

    // No Firestore permission error surfaced anywhere on the page.
    const permErrors = runtimeErrors.filter((e) => /permission|insufficient|PERMISSION_DENIED/i.test(e));
    expect(permErrors, `unexpected permission errors:\n${permErrors.join('\n')}`).toEqual([]);

    // ── 7. The record actually persisted under the demo tenant ───────────
    expect(rec, `CREATE DID NOT PERSIST — see ${DIAG_FILE}\n${diag.slice(0, 1500)}`).not.toBeNull();
    expect(rec!.companyId).toBe(DEMO_COMPANY_ID);
    expect(rec!.status).toBe('Draft');
    if (rec!.groupId !== undefined) expect(rec!.groupId).toBe(DEMO_GROUP_ID);
    // Applicant + vendor auto-derived from the Customer / Company.
    expect(rec!.vendorName).toBe('Neozy Demo Company');
    expect(rec!.applicantName).toBe('E2E Reg Customer');

    // ── 8. The UI transitioned to the record view (the form is gone,
    //       proving the create round-tripped and re-rendered). ───────────
    await expect(page.getByText('Status Timeline')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Create Registration Draft' })).toHaveCount(0);

    // ── 9. The legacy 'New'-stage project ALSO surfaces Registration as the
    //       active stage (resolveProjectWorkspaceStages read-time map) —
    //       the Stage 1 card must NOT be a locked "Not Available Yet" card. ──
    await page.goto(`/projects/${legacyProjectId}`);
    const legacyStage1 = page.getByRole('button', { name: /Stage 1\s+Registration/ });
    await expect(legacyStage1).toBeVisible({ timeout: 20_000 });
    await expect(legacyStage1).toBeEnabled();
    await expect(legacyStage1).not.toContainText('Not Available Yet');
    await expect(legacyStage1).toContainText('In Progress');

    writeFileSync(DIAG_FILE, diag + '\n\nSTEP 9 (legacy New-stage project): Registration card = In Progress, not locked — PASS');
    await ctx.close();
  });
});
