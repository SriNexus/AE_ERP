// Phase 8 (Master Plan §17.x) — REAL-BROWSER acceptance: the actual demo
// GroupAdmin identity (demo@neozy.in, company-demo-neozy, group-demo-neozy —
// the same constants src/config/demo.ts defines) must be able to open
// Products, create/edit/delete a product, refresh, switch to an in-group
// sibling company, and use the Group aggregate view — all through the real
// desktop UI, against the REAL firestore.rules, with no permission-denied
// errors — while a cross-group company stays unreachable.
//
// Run via:
//   DEMO_E2E_PASSWORD=<the demo GroupAdmin password> \
//     node tests/platform-e2e/run-emulator-tests.mjs --grep "GroupAdmin Products"
// (the password is supplied by the test environment only, exactly like
// tests/demo-e2e/demo.smoke.spec.ts — never committed, never logged).
//
// The password is never written into this file or into the emulator seed
// data as a literal — it is applied to the throwaway local Auth emulator at
// test time via the Admin SDK, and the browser logs in against that same
// emulator. Nothing here touches the real Firebase project.
//
// Seed strategy (mirrors platformGroupFlow.spec.ts + the real demo
// foundation seed): the demo identity chain (Auth user demo@neozy.in →
// users/{MUSR-DEMO-0001} → user_auth_maps/{authUid}) is created via the
// Admin SDK against the SAME running emulator the browser talks to, plus the
// tenant documents the boot flow and the rules need: the Active demo Group,
// the demo company + an in-group SIBLING company, a FOREIGN company of a
// DIFFERENT group (cross-group denial), the demo company's `_Admin` role
// document (full permissions — the GroupAdmin resolves to the target
// company's Admin template per Master Plan §5.2), and product_categories
// (the Add Product form's Category select is a required picker backed by
// that collection).
import { test, expect, type Page } from '@playwright/test';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// The real demo GroupAdmin identity constants — src/config/demo.ts.
const DEMO_EMAIL = 'demo@neozy.in';
const DEMO_COMPANY_ID = 'company-demo-neozy';
const DEMO_ERP_USER_ID = 'MUSR-DEMO-0001';
const DEMO_GROUP_ID = 'group-demo-neozy';

const PROJECT_ID = 'demo-neozy-local';
const app = getApps().length ? getApps()[0] : initializeApp({ projectId: PROJECT_ID });
const db = getFirestore(app);
const auth = getAuth(app);

// Full-permission map for the per-company Admin role documents — the same
// shape roleBootstrap.ts's createAllModulePermissions() produces (all
// modules, every action, visibility 'all'), mirrored here because this spec
// must not import browser/store-coupled src/lib modules (the established
// script convention — see scripts/demo/datasets/foundation.ts).
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
  // The login route is a lazy chunk behind SafePage's Suspense; on a cold /
  // busy dev server the first paint can stall on an empty shell (observed
  // intermittently). Retry the navigation until the form is really there —
  // same proven recovery as groupAdminModules.spec.ts.
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

/**
 * Expands the hover-expand sidebar group and clicks a child link — never a
 * page.goto() (see platformGroupFlow.spec.ts's file-level comment: a full
 * reload races the synchronous route guards against Firebase Auth's async
 * session restore). Scoped strictly to the group button's own parent
 * container to avoid collisions with same-named main-content links.
 */
async function navigateViaSidebar(page: Page, groupLabel: string, childLabel: string) {
  const groupButton = page.getByRole('button', { name: groupLabel, exact: true });
  await groupButton.hover();
  const groupContainer = groupButton.locator('xpath=..');
  const child = groupContainer.getByRole('menuitem', { name: childLabel, exact: true })
    .or(groupContainer.getByRole('link', { name: childLabel, exact: true }));
  await expect(child).toBeVisible({ timeout: 10_000 });
  await child.click();
}

/**
 * The shared Input/Select components don't associate labels via htmlFor/id
 * (a known codebase-wide accessibility gap) — locate the field as the first
 * input/select/textarea sibling of its label instead.
 */
function fieldByLabelText(page: Page, labelText: string) {
  return page.locator('label', { hasText: labelText })
    .locator('xpath=following-sibling::*[self::input or self::select or self::textarea][1]')
    .first();
}

test.describe('Phase 8 — GroupAdmin desktop ERP end-to-end (Products first)', () => {
  test('demo GroupAdmin opens Products, creates/edits/deletes a product, works group-wide, and stays blocked from a foreign group', async ({ page, browser }) => {
    test.skip(!process.env.DEMO_E2E_PASSWORD, 'DEMO_E2E_PASSWORD is required and must be supplied only by the test environment.');
    const password = process.env.DEMO_E2E_PASSWORD!;
    const stamp = Date.now();
    const foreignGroupId = `GRP-X-${stamp}`;
    const siblingCompanyId = `COMP-SIB-${stamp}`;
    const foreignCompanyId = `COMP-X-${stamp}`;
    const authUid = `demo-auth-${stamp}`;
    const productName = `GROUPADMIN_RUNTIME_TEST_${stamp}`;
    const productSku = `GA-RUNTIME-${stamp}`;
    // Short names must yield DISTINCT 2-letter initials — the CompanySwitcher
    // menu's option buttons expose only the initials as their accessible name.
    const siblingShort = `SB${stamp}`;
    const foreignShort = `FX${stamp}`;

    // ── 1. Seed the demo GroupAdmin identity chain + tenant documents ─────
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
    await db.collection('groups').doc(foreignGroupId).set({
      id: foreignGroupId, name: `E2E Foreign Group ${stamp}`, shortName: `E2EF${stamp}`.slice(0, 10), status: 'Active',
    });

    await db.collection('companies').doc(DEMO_COMPANY_ID).set({
      id: DEMO_COMPANY_ID, companyId: DEMO_COMPANY_ID, groupId: DEMO_GROUP_ID, name: 'Neozy Demo Company',
      shortName: 'NeozyDemo', status: 'Active', isDefault: true, businessMode: 'Both',
      currency: 'INR', currencySymbol: '₹',
    });
    await db.collection('companies').doc(siblingCompanyId).set({
      id: siblingCompanyId, companyId: siblingCompanyId, groupId: DEMO_GROUP_ID, name: `E2E Sibling Co ${stamp}`,
      shortName: siblingShort, status: 'Active', isDefault: false, businessMode: 'Both',
      currency: 'INR', currencySymbol: '₹',
    });
    await db.collection('companies').doc(foreignCompanyId).set({
      id: foreignCompanyId, companyId: foreignCompanyId, groupId: foreignGroupId, name: `E2E Foreign Co ${stamp}`,
      shortName: foreignShort, status: 'Active', isDefault: false, businessMode: 'Both',
      currency: 'INR', currencySymbol: '₹',
    });

    // Per-company Admin role documents — the GroupAdmin's grants per §5.2.
    await db.collection('roles').doc(`${DEMO_COMPANY_ID}_Admin`).set({
      id: `${DEMO_COMPANY_ID}_Admin`, companyId: DEMO_COMPANY_ID, name: 'Admin', schemaVersion: 1,
      isSystem: true, description: 'Seeded demo Admin template', permissions: fullAdminPermissions(),
    });
    await db.collection('roles').doc(`${siblingCompanyId}_Admin`).set({
      id: `${siblingCompanyId}_Admin`, companyId: siblingCompanyId, name: 'Admin', schemaVersion: 1,
      isSystem: true, description: 'Seeded E2E Admin template', permissions: fullAdminPermissions(),
    });

    // Categories for the required Category select, per company.
    await db.collection('product_categories').doc('CAT-DEMO-0001').set({
      id: 'CAT-DEMO-0001', companyId: DEMO_COMPANY_ID, groupId: DEMO_GROUP_ID, name: 'E2E Demo Category', isDeleted: false,
    });
    await db.collection('product_categories').doc(`CAT-S-${stamp}`).set({
      id: `CAT-S-${stamp}`, companyId: siblingCompanyId, groupId: DEMO_GROUP_ID, name: 'E2E Sibling Category', isDeleted: false,
    });

    // Pre-seeded products for scope verification:
    //  - one in the SIBLING company (must be visible only via group scope),
    //  - one in the FOREIGN company (must NEVER be visible to this actor).
    const siblingProduct = `SIBLING_PRODUCT_${stamp}`;
    const foreignProduct = `FOREIGN_PRODUCT_${stamp}`;
    await db.collection('products').doc(`PRD-SIB-${stamp}`).set({
      id: `PRD-SIB-${stamp}`, name: siblingProduct, sku: `SIB-${stamp}`, category: 'E2E Sibling Category',
      price: 100, companyId: siblingCompanyId, groupId: DEMO_GROUP_ID, createdBy: 'seed', updatedBy: 'seed',
      isDeleted: false, status: 'Active', unit: 'PCS',
    });
    await db.collection('products').doc(`PRD-X-${stamp}`).set({
      id: `PRD-X-${stamp}`, name: foreignProduct, sku: `X-${stamp}`, category: 'E2E Foreign Category',
      price: 999, companyId: foreignCompanyId, groupId: foreignGroupId, createdBy: 'seed', updatedBy: 'seed',
      isDeleted: false, status: 'Active', unit: 'PCS',
    });

    // ── 2. The demo GroupAdmin logs in (fresh context) ────────────────────
    const gaContext = await browser.newContext();
    const gaPage = await gaContext.newPage();
    const runtimeErrors: string[] = [];
    gaPage.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));
    gaPage.on('console', (message) => {
      if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
    });
    await login(gaPage, DEMO_EMAIL, password);

    // ── 3. Products opens + list loads (no permission-denied) ─────────────
    await navigateViaSidebar(gaPage, 'Inventory', 'Products');
    await expect(gaPage).toHaveURL(/\/products/);
    await expect(gaPage.getByRole('heading', { name: 'Products' })).toBeVisible({ timeout: 20_000 });
    // While focused on the HOME company the list is companyId-scoped — the
    // sibling's seeded product is correctly NOT shown here (it surfaces via
    // the group scope in step 9), and the foreign product never shows at all.
    await expect(gaPage.getByText(siblingProduct)).toHaveCount(0, { timeout: 20_000 });
    await expect(gaPage.getByText(foreignProduct)).toHaveCount(0);

    // ── 4. Add Product → fill minimum valid fields → Submit (the blocker) ─
    await gaPage.getByRole('button', { name: 'Add Product', exact: true }).click();
    await expect(gaPage.getByRole('dialog')).toBeVisible();
    await fieldByLabelText(gaPage, 'Product Name').fill(productName);
    await fieldByLabelText(gaPage, 'SKU').fill(productSku);
    await fieldByLabelText(gaPage, 'Category').selectOption({ label: 'E2E Demo Category' });
    await fieldByLabelText(gaPage, 'Price').fill('1250');
    await gaPage.getByRole('button', { name: 'Add Product', exact: true }).last().click();
    // CREATE must succeed — the toast is the mutation's onSuccess signal.
    await expect(gaPage.getByText('Product added')).toBeVisible({ timeout: 20_000 });
    await expect(gaPage.getByText(productName)).toBeVisible({ timeout: 15_000 });

    // The created product must actually be in Firestore under the demo tenant.
    const createdSnap = await db.collection('products').where('name', '==', productName).limit(1).get();
    expect(createdSnap.empty).toBe(false);
    const createdDoc = createdSnap.docs[0].data();
    expect(createdDoc.companyId).toBe(DEMO_COMPANY_ID);
    expect(createdDoc.groupId).toBe(DEMO_GROUP_ID);

    // ── 5. EDIT → save → verify persistence ───────────────────────────────
    await gaPage.locator('tr', { hasText: productName }).click();
    await expect(gaPage.getByRole('button', { name: 'Edit Product' })).toBeVisible({ timeout: 10_000 });
    await gaPage.getByRole('button', { name: 'Edit Product' }).click();
    await expect(gaPage.getByRole('button', { name: 'Update', exact: true })).toBeVisible({ timeout: 10_000 });
    const renamed = `${productName} EDITED`;
    await fieldByLabelText(gaPage, 'Product Name').fill(renamed);
    await gaPage.getByRole('button', { name: 'Update', exact: true }).click();
    await expect(gaPage.getByText('Product updated')).toBeVisible({ timeout: 20_000 });
    await expect(gaPage.getByText(renamed)).toBeVisible({ timeout: 15_000 });
    const editedSnap = await db.collection('products').doc(createdSnap.docs[0].id).get();
    expect(editedSnap.data()?.name).toBe(renamed);
    expect(editedSnap.data()?.companyId).toBe(DEMO_COMPANY_ID);

    // ── 6. Refresh (cache invalidation path) ──────────────────────────────
    await gaPage.getByRole('button', { name: 'Refresh' }).click();
    await expect(gaPage.getByText(renamed)).toBeVisible({ timeout: 15_000 });

    // ── 7. DELETE → confirm → gone from list + Firestore soft-delete ──────
    await gaPage.locator('tr', { hasText: renamed }).click();
    await expect(gaPage.getByRole('button', { name: 'Delete', exact: true })).toBeVisible({ timeout: 10_000 });
    await gaPage.getByRole('button', { name: 'Delete', exact: true }).click();
    // The details modal is closing while the ConfirmDialog opens — scope the
    // confirm click to the dialog that actually carries the confirmation text.
    const confirmDialog = gaPage.locator('[role="dialog"]', { hasText: 'Delete this product?' });
    await expect(confirmDialog).toBeVisible({ timeout: 10_000 });
    await confirmDialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(gaPage.getByText('Product deleted')).toBeVisible({ timeout: 20_000 });
    await expect(gaPage.getByText(renamed)).toHaveCount(0, { timeout: 15_000 });
    const deletedSnap = await db.collection('products').doc(createdSnap.docs[0].id).get();
    expect(deletedSnap.data()?.isDeleted).toBe(true);

    // ── 8. SIBLING company focus: create a product there via the UI ───────
    await gaPage.getByRole('button', { name: 'Switch company' }).click();
    await expect(gaPage.getByRole('menu')).toBeVisible();
    await gaPage.getByRole('menu').getByRole('button', { name: /^SB/ }).click();
    const siblingProductName = `SIBLING_UI_${stamp}`;
    await gaPage.getByRole('button', { name: 'Add Product', exact: true }).click();
    await expect(gaPage.getByRole('dialog')).toBeVisible();
    await fieldByLabelText(gaPage, 'Product Name').fill(siblingProductName);
    await fieldByLabelText(gaPage, 'SKU').fill(`SIB-UI-${stamp}`);
    await fieldByLabelText(gaPage, 'Category').selectOption({ label: 'E2E Sibling Category' });
    await fieldByLabelText(gaPage, 'Price').fill('750');
    await gaPage.getByRole('button', { name: 'Add Product', exact: true }).last().click();
    await expect(gaPage.getByText('Product added')).toBeVisible({ timeout: 20_000 });
    await expect(gaPage.getByText(siblingProductName)).toBeVisible({ timeout: 15_000 });
    // The seeded sibling product is visible once focused on the sibling.
    await expect(gaPage.getByText(siblingProduct)).toBeVisible({ timeout: 15_000 });
    const siblingSnap = await db.collection('products').where('name', '==', siblingProductName).limit(1).get();
    expect(siblingSnap.empty).toBe(false);
    expect(siblingSnap.docs[0].data()?.companyId).toBe(siblingCompanyId);
    expect(siblingSnap.docs[0].data()?.groupId).toBe(DEMO_GROUP_ID);
    // Foreign product still invisible from the sibling focus.
    await expect(gaPage.getByText(foreignProduct)).toHaveCount(0);

    // ── 9. GROUP aggregate view: both companies' products visible ─────────
    await gaPage.getByRole('button', { name: 'Switch company' }).click();
    await expect(gaPage.getByRole('menu')).toBeVisible();
    await gaPage.getByRole('menu').getByRole('button', { name: /All Companies \(Group view\)/ }).click();
    await expect(gaPage.getByText(siblingProductName)).toBeVisible({ timeout: 15_000 });
    await expect(gaPage.getByText(siblingProduct)).toBeVisible({ timeout: 15_000 });
    // The foreign company is not part of this group — never surfaces.
    await expect(gaPage.getByText(foreignProduct)).toHaveCount(0);

    // ── 10. No permission-denied errors attributable to this flow ─────────
    const deniedErrors = runtimeErrors.filter((e) => /permission.?denied|missing or insufficient/i.test(e));
    expect(deniedErrors).toEqual([]);

    await gaContext.close();
  });
});