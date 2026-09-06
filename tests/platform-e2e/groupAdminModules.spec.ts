// Phase 8 (Master Plan §17.x) — REAL-BROWSER acceptance, multi-module: the demo
// GroupAdmin identity (demo@neozy.in — the same constants src/config/demo.ts
// defines) must be able to open and manage every module the desktop ERP
// exposes, not just Products: master data (Categories, Warehouses, Vendors,
// Banks), the sales chain (Leads, Customers, Quotations, Orders, Invoices),
// Stock/Inventory, Payments, and user administration (Users, Roles) — each
// through the real desktop UI against the REAL firestore.rules, plus the
// three-tenant-context model (home / same-group sibling / foreign group).
//
// Run via:
//   DEMO_E2E_PASSWORD=<the demo GroupAdmin password> \
//     node tests/platform-e2e/run-emulator-tests.mjs --grep "GroupAdmin Modules"
// (the password is supplied by the test environment only — never committed,
// never logged — and is applied to the throwaway LOCAL Auth emulator).
//
// Documented-by-design limitations the spec asserts rather than fabricates:
//   - Categories DELETE/Merge are SuperAdmin-only (client gate isSuperAdmin +
//     rules `allow delete: if actorIsActive() && isSuperAdmin()`); the
//     GroupAdmin path is create/edit + Archive (soft-delete via update).
//   - The desktop Purchase Orders page's create/edit form is a simulated stub
//     ("PO created (simulated)" — no Firestore write) for EVERY role; the real
//     writer purchaseOrderWorkflow.createPurchaseOrder() has no desktop UI
//     caller. PO creation is therefore verified as: the page OPENS and LISTS
//     (read scope), GRN creation against a seeded sent PO is fully real.
import { test, expect, type Page } from '@playwright/test';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

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
  // The login route is a lazy chunk behind SafePage's Suspense; on a cold /
  // busy dev server the first paint can stall on an empty shell (observed
  // intermittently). Retry the navigation until the form is really there.
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
  // Scope to the sidebar's real landmark — <aside role="navigation"
  // aria-label="Main navigation"> in Sidebar.tsx (the explicit role overrides
  // the implicit `complementary` landmark, so getByRole('complementary') never
  // matches). Breadcrumb trails on already-open pages carry same-named buttons.
  //
  // The collapsed flyout opens on HOVER and auto-closes ~120ms after the
  // cursor leaves (Sidebar.tsx handleLeave). A bare hover() on the group can
  // leave the cursor on the group's edge where the OPENING submenu steals
  // pointer events, so: move to the button center, then keep the pointer
  // engaged while the flyout opens and the child is clickable — all inside
  // one expect().toPass() retry window (a lost hover simply re-opens it).
  const sidebar = page.getByRole('navigation', { name: 'Main navigation' });
  const groupButton = sidebar.getByRole('button', { name: groupLabel, exact: true });
  await groupButton.hover();
  const groupContainer = groupButton.locator('xpath=..');
  const child = groupContainer.getByRole('menuitem', { name: childLabel, exact: true })
    .or(groupContainer.getByRole('link', { name: childLabel, exact: true }));
  await expect(async () => {
    await groupButton.hover(); // re-establish hover if the flyout closed
    await child.click({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  // Route paths are slugified label text ('Goods Receipts' → /goods-receipts).
  const slug = childLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  await expect(page).toHaveURL(new RegExp(slug), { timeout: 15_000 });
}

/** Navigate to a top-level route via URL (root pages, no sidebar group). */
async function gotoPath(page: Page, path: string) {
  await page.evaluate((p) => { window.history.pushState({}, '', p); }, path);
  await page.goto(path);
}

/** The shared Input/Select don't associate labels via htmlFor/id.
 * Matching is START-ANCHORED: hasText is substring matching, and 'Name *'
 * is a substring of 'Company Name *' — the loose version silently filled
 * the wrong field (the required contact Name stayed empty, so the form's
 * native validation blocked submit). The trailing (\s*\*)? tolerates the
 * required-indicator span the Input component appends to the label text. */
function fieldByLabelText(page: Page, labelText: string) {
  const anchored = new RegExp(`^${labelText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s*\\*)?$`);
  return page.locator('label').filter({ hasText: anchored })
    .locator('xpath=following-sibling::*[self::input or self::select or self::textarea][1]')
    .first();
}

async function switchCompany(page: Page, option: RegExp) {
  await page.getByRole('button', { name: 'Switch company' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.getByRole('menu').getByRole('button', { name: option }).click();
  await page.waitForTimeout(600); // company state settles (boot effect + query invalidation)
}

test.describe('Phase 8 — GroupAdmin multi-module desktop ERP end-to-end', () => {
  test('demo GroupAdmin manages master data, sales chain, stock, finance, and user administration across the group', async ({ page, browser }) => {
    test.skip(!process.env.DEMO_E2E_PASSWORD, 'DEMO_E2E_PASSWORD is required and must be supplied only by the test environment.');
    const password = process.env.DEMO_E2E_PASSWORD!;
    const stamp = Date.now();
    const foreignGroupId = `GRP-X-${stamp}`;
    const siblingCompanyId = `COMP-SIB-${stamp}`;
    const foreignCompanyId = `COMP-X-${stamp}`;
    const authUid = `demo-auth-${stamp}`;
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
    // Admin role templates for BOTH companies (GroupAdmin resolves to the
    // focused company's Admin template per Master Plan §5.2).
    await db.collection('roles').doc(`${DEMO_COMPANY_ID}_Admin`).set({
      id: `${DEMO_COMPANY_ID}_Admin`, companyId: DEMO_COMPANY_ID, name: 'Admin', schemaVersion: 1,
      isSystem: true, description: 'Seeded demo Admin template', permissions: fullAdminPermissions(),
    });
    await db.collection('roles').doc(`${siblingCompanyId}_Admin`).set({
      id: `${siblingCompanyId}_Admin`, companyId: siblingCompanyId, name: 'Admin', schemaVersion: 1,
      isSystem: true, description: 'Seeded E2E Admin template', permissions: fullAdminPermissions(),
    });
    // Categories (required picker for Products/Stock + the Categories module).
    await db.collection('product_categories').doc('CAT-DEMO-0001').set({
      id: 'CAT-DEMO-0001', companyId: DEMO_COMPANY_ID, groupId: DEMO_GROUP_ID, name: 'E2E Demo Category', isDeleted: false,
    });
    await db.collection('product_categories').doc(`CAT-S-${stamp}`).set({
      id: `CAT-S-${stamp}`, companyId: siblingCompanyId, groupId: DEMO_GROUP_ID, name: 'E2E Sibling Category', isDeleted: false,
    });
    // Warehouses (home + sibling) — required for stock entries and GRN FK checks.
    await db.collection('warehouses').doc(`WH-DEMO-${stamp}`).set({
      id: `WH-DEMO-${stamp}`, warehouseId: `WH-DEMO-${stamp}`, companyId: DEMO_COMPANY_ID, groupId: DEMO_GROUP_ID,
      name: 'Demo Main WH', isDeleted: false,
    });
    await db.collection('warehouses').doc(`WH-S-${stamp}`).set({
      id: `WH-S-${stamp}`, warehouseId: `WH-S-${stamp}`, companyId: siblingCompanyId, groupId: DEMO_GROUP_ID,
      name: 'Sibling WH', isDeleted: false,
    });
    // A sent purchase order in the home company — the real GRN creation flow
    // requires an existing PO (goodsReceiptWorkflow reads it + transitions it).
    await db.collection('purchase_orders').doc(`PO-SEED-${stamp}`).set({
      id: `PO-SEED-${stamp}`, purchaseOrderId: `PO-SEED-${stamp}`, companyId: DEMO_COMPANY_ID, groupId: DEMO_GROUP_ID,
      vendorId: 'VEN-SEED', vendorName: 'E2E Seed Vendor', status: 'Sent',
      orderDate: new Date().toISOString().split('T')[0],
      items: [{ productId: 'PRD-SEED-1', product: 'Seed Product', qty: 10, unit: 'PCS', price: 100, receivedQty: 0 }],
      total: 1000, subtotal: 1000, taxTotal: 0, isDeleted: false,
    });
    // A product to receive stock against.
    await db.collection('products').doc('PRD-SEED-1').set({
      id: 'PRD-SEED-1', name: 'Seed Product', sku: `SEED-${stamp}`, category: 'E2E Demo Category',
      price: 100, companyId: DEMO_COMPANY_ID, groupId: DEMO_GROUP_ID, isDeleted: false, unit: 'PCS',
    });
    // A same-group user in the SIBLING company (user administration reach)
    // and a foreign-group user (cross-group denial).
    const siblingUserId = `MUSR-SIB-U-${stamp}`;
    await db.collection('users').doc(siblingUserId).set({
      id: siblingUserId, companyId: siblingCompanyId, groupId: DEMO_GROUP_ID,
      email: `sibuser-${stamp}@e2e.test`, name: 'Sibling User', role: 'Sales', status: 'Active', isDeleted: false,
    });
    // A Sales-eligible user in the HOME company — lead creation's round-robin
    // auto-assign (getNextAssignee) throws 'No sales team members available'
    // without one, which is legitimate app behavior, not an auth defect.
    await db.collection('users').doc(`MUSR-DEMO-SALES-${stamp}`).set({
      id: `MUSR-DEMO-SALES-${stamp}`, companyId: DEMO_COMPANY_ID, groupId: DEMO_GROUP_ID,
      email: `salesuser-${stamp}@e2e.test`, name: 'Demo Sales User', role: 'Sales', status: 'Active', isDeleted: false,
    });
    const foreignUserId = `MUSR-FGN-U-${stamp}`;
    await db.collection('users').doc(foreignUserId).set({
      id: foreignUserId, companyId: foreignCompanyId, groupId: foreignGroupId,
      email: `fgnuser-${stamp}@e2e.test`, name: 'Foreign User', role: 'Sales', status: 'Active', isDeleted: false,
    });
    // Foreign-group data that must NEVER be visible/reachable.
    await db.collection('products').doc('PRD-FGN-1').set({
      id: 'PRD-FGN-1', name: 'FOREIGN_PRODUCT', sku: `FGN-${stamp}`, companyId: foreignCompanyId,
      groupId: foreignGroupId, price: 999, isDeleted: false, unit: 'PCS',
    });
    await db.collection('leads').doc(`LD-FGN-${stamp}`).set({
      id: `LD-FGN-${stamp}`, name: 'FOREIGN_LEAD', phone: '9000000000', companyId: foreignCompanyId,
      groupId: foreignGroupId, status: 'New', isDeleted: false,
    });

    // ── 2. Login ──────────────────────────────────────────────────────────
    const gaContext = await browser.newContext();
    const gaPage = await gaContext.newPage();
    const runtimeErrors: string[] = [];
    gaPage.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));
    gaPage.on('console', (message) => {
      if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
    });
    await login(gaPage, DEMO_EMAIL, password);

    // ═══════════════════════ MASTER DATA ═══════════════════════

    // ── A. CATEGORIES: open (via Products → Categories), create, edit ─────
    await navigateViaSidebar(gaPage, 'Inventory', 'Products');
    // First post-login navigation can race the lazy chunk's first compile on
    // the dev server (main renders empty, observed once) — recover by a plain
    // reload of the same route; the UI-driven click above remains the entry.
    await expect(async () => {
      if (!(await gaPage.getByRole('heading', { name: 'Products' }).isVisible().catch(() => false))) {
        await gaPage.goto('/products');
      }
      await expect(gaPage.getByRole('heading', { name: 'Products' })).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 45_000 });
    await gaPage.getByRole('button', { name: 'Categories', exact: true }).click();
    await expect(gaPage).toHaveURL(/\/categories/);
    const categoryName = `E2E_CAT_${stamp}`;
    await gaPage.getByRole('button', { name: 'Add Category', exact: true }).first().click();
    await expect(gaPage.getByRole('dialog')).toBeVisible();
    await fieldByLabelText(gaPage, 'Name *').fill(categoryName);
    await gaPage.locator('[role="dialog"]').getByRole('button', { name: 'Add Category', exact: true }).click();
    await expect(gaPage.getByText('Category added')).toBeVisible({ timeout: 20_000 });
    // The created category is listed (and offered in the parent/child pickers).
    await expect(gaPage.getByRole('button', { name: `Select ${categoryName}` })).toBeVisible({ timeout: 15_000 });
    const catSnap = await db.collection('product_categories').where('name', '==', categoryName).limit(1).get();
    expect(catSnap.empty).toBe(false);
    expect(catSnap.docs[0].data().companyId).toBe(DEMO_COMPANY_ID);
    expect(catSnap.docs[0].data().groupId).toBe(DEMO_GROUP_ID);
    // Edit (rename) through the details modal → Update → persistence.
    const catId = catSnap.docs[0].id;
    await gaPage.getByRole('button', { name: `Select ${categoryName}` }).click();
    await gaPage.getByRole('button', { name: 'Edit', exact: true }).nth(1).click();
    const renamedCat = `${categoryName} RENAMED`;
    await fieldByLabelText(gaPage, 'Name *').fill(renamedCat);
    await gaPage.locator('[role="dialog"]').getByRole('button', { name: 'Update', exact: true }).click();
    await expect(gaPage.getByText('Category updated')).toBeVisible({ timeout: 20_000 });
    const catAfter = await db.collection('product_categories').doc(catId).get();
    expect(catAfter.data()?.name).toBe(renamedCat);
    // Cross-group isolation: foreign product never listed on any inventory screen.
    await expect(gaPage.getByText('FOREIGN_PRODUCT')).toHaveCount(0);

    // ── B. WAREHOUSES: open, create, verify tenant stamp ──────────────────
    await navigateViaSidebar(gaPage, 'Inventory', 'Warehouses');
    await expect(gaPage).toHaveURL(/\/warehouses/);
    await expect(gaPage.getByText('Demo Main WH')).toBeVisible({ timeout: 20_000 });
    const whName = `E2E_WH_${stamp}`;
    await gaPage.getByRole('button', { name: 'Add Warehouse', exact: true }).first().click();
    await expect(gaPage.getByRole('dialog')).toBeVisible();
    await fieldByLabelText(gaPage, 'Warehouse Name').fill(whName);
    // The demo company's AttendanceSettings.geofenceRadiusDefaultMeters (200)
    // pre-fills the radius, which makes the geo section "attempted" — lat/lng
    // become required together (real validation, mirrored from AttendanceService).
    await fieldByLabelText(gaPage, 'Latitude').fill('18.5204');
    await fieldByLabelText(gaPage, 'Longitude').fill('73.8567');
    await gaPage.getByRole('button', { name: 'Add Warehouse', exact: true }).last().click();
    await expect(gaPage.getByText('Warehouse added')).toBeVisible({ timeout: 20_000 });
    await expect(gaPage.getByText(whName)).toBeVisible({ timeout: 15_000 });
    const whSnap = await db.collection('warehouses').where('name', '==', whName).limit(1).get();
    expect(whSnap.empty).toBe(false);
    expect(whSnap.docs[0].data().companyId).toBe(DEMO_COMPANY_ID);

    // ── C. VENDORS: open, create, soft-delete ─────────────────────────────
    await navigateViaSidebar(gaPage, 'Procurement', 'Vendors');
    await expect(gaPage).toHaveURL(/\/vendors/);
    const vendorName = `E2E_VENDOR_${stamp}`;
    await gaPage.getByRole('button', { name: 'Add vendor', exact: true }).click();
    await expect(gaPage.getByRole('dialog')).toBeVisible();
    await fieldByLabelText(gaPage, 'Vendor Name *').fill(vendorName);
    await gaPage.getByRole('button', { name: 'Save Vendor', exact: true }).click();
    await expect(gaPage.getByText('Vendor created')).toBeVisible({ timeout: 20_000 });
    await expect(gaPage.getByText(vendorName).first()).toBeVisible({ timeout: 15_000 });
    const vendorSnap = await db.collection('vendors').where('name', '==', vendorName).limit(1).get();
    expect(vendorSnap.empty).toBe(false);
    expect(vendorSnap.docs[0].data().companyId).toBe(DEMO_COMPANY_ID);
    // Delete (soft) → gone from list, isDeleted:true in Firestore. Real flow:
    // row View → detail modal → "Delete Vendor" → ConfirmDialog → soft delete.
    await gaPage.locator('tr', { hasText: vendorName }).getByRole('button', { name: 'View' }).click();
    await expect(gaPage.getByRole('dialog')).toBeVisible();
    await gaPage.getByRole('dialog').getByRole('button', { name: 'Delete Vendor' }).click();
    const vendorConfirm = gaPage.locator('[role="dialog"]', { hasText: 'Delete this vendor permanently?' });
    await expect(vendorConfirm).toBeVisible({ timeout: 10_000 });
    // transition-all button can re-render under load — use force to skip the stability wait.
    await vendorConfirm.getByRole('button', { name: 'Delete', exact: true }).click({ force: true });
    await expect(gaPage.getByText('Vendor deleted')).toBeVisible({ timeout: 20_000 });
    await expect(gaPage.locator('tr', { hasText: vendorName })).toHaveCount(0, { timeout: 15_000 });
    const vendorAfter = await db.collection('vendors').doc(vendorSnap.docs[0].id).get();
    expect(vendorAfter.data()?.isDeleted).toBe(true);

    // ── D. BANKS: open, create ────────────────────────────────────────────
    await gotoPath(gaPage, '/banks');
    const bankName = `E2E_BANK_${stamp}`;
    await gaPage.getByRole('button', { name: 'Add Bank', exact: true }).first().click();
    await expect(gaPage.getByRole('dialog')).toBeVisible();
    await fieldByLabelText(gaPage, 'Bank Code').fill(`EB${String(stamp).slice(-4)}`);
    await fieldByLabelText(gaPage, 'Bank Name').fill(bankName);
    await gaPage.getByRole('button', { name: 'Add Bank', exact: true }).last().click();
    await expect(gaPage.getByText('Bank saved')).toBeVisible({ timeout: 20_000 });
    await expect(gaPage.getByText(bankName)).toBeVisible({ timeout: 15_000 });
    const bankSnap = await db.collection('banks').where('bankName', '==', bankName).limit(1).get();
    expect(bankSnap.empty).toBe(false);
    expect(bankSnap.docs[0].data().companyId).toBe(DEMO_COMPANY_ID);

    // ═══════════════════════ SALES CHAIN ═══════════════════════

    // ── E. LEADS: open, create, edit, delete, foreign-lead invisible ──────
    await navigateViaSidebar(gaPage, 'Sales', 'Leads');
    await expect(gaPage).toHaveURL(/\/leads/);
    await expect(gaPage.getByText('FOREIGN_LEAD')).toHaveCount(0);
    const leadName = `E2E_LEAD_${stamp}`;
    await gaPage.getByRole('button', { name: 'Add Lead', exact: true }).click();
    await expect(gaPage.getByRole('dialog')).toBeVisible();
    await fieldByLabelText(gaPage, 'Full Name').fill(leadName);
    await fieldByLabelText(gaPage, 'Phone').first().fill(`98${String(stamp).slice(-8)}`);
    await gaPage.locator('[data-tour="lead-form-save"]').click().catch(async () => {
      await gaPage.locator('[role="dialog"]').getByRole('button', { name: 'Add Lead', exact: true }).click();
    });
    await expect(gaPage.getByText('Lead created').or(gaPage.getByText(leadName)).first()).toBeVisible({ timeout: 20_000 });
    const leadSnap = await db.collection('leads').where('name', '==', leadName).limit(1).get();
    expect(leadSnap.empty).toBe(false);
    expect(leadSnap.docs[0].data().companyId).toBe(DEMO_COMPANY_ID);
    expect(leadSnap.docs[0].data().groupId).toBe(DEMO_GROUP_ID);
    // Delete: per the page's own design, deleting happens via bulk actions
    // (row-selection checkbox → bulk Delete), not per-row. The create just
    // above invalidated the list query, so a re-render can race the checkbox
    // click (mousedown/up landing on the row → navigates to Workspace);
    // retry until the selection bar actually appears.
    await expect(async () => {
      await gaPage.goto('/leads');
      await gaPage.getByRole('checkbox', { name: `Select ${leadName}` }).click();
      await expect(gaPage.getByRole('button', { name: 'Delete', exact: true })).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 20_000 });
    await gaPage.getByRole('button', { name: 'Delete', exact: true }).click();
    const leadConfirm = gaPage.locator('[role="dialog"]', { hasText: 'selected leads permanently' });
    await expect(leadConfirm).toBeVisible({ timeout: 10_000 });
    await leadConfirm.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(gaPage.getByText('Deleted', { exact: true })).toBeVisible({ timeout: 20_000 });
    const leadAfter = await db.collection('leads').where('name', '==', leadName).limit(1).get();
    expect(leadAfter.empty).toBe(false); // soft delete — doc retained
    expect(leadAfter.docs[0].data().isDeleted).toBe(true);

    // ── F. CUSTOMERS: type chooser → B2B create → verify ──────────────────
    await navigateViaSidebar(gaPage, 'Sales', 'Customers');
    await expect(gaPage).toHaveURL(/\/customers/);
    await expect(gaPage.getByText('FOREIGN_PRODUCT')).toHaveCount(0);
    const customerContact = `E2E_CUST_${stamp}`;
    const customerCompany = `E2E_CUSTCO_${stamp}`;
    await gaPage.getByRole('button', { name: 'Add Customer', exact: true }).first().click();
    await gaPage.getByRole('button', { name: /B2B Business/ }).click();
    // The type-chooser dialog stays mounted behind the B2B form — scope to it.
    // (getByRole has no hasText option — filter instead, or the option is ignored.)
    const b2bDialog = gaPage.getByRole('dialog').filter({ hasText: 'Add B2B Customer' });
    await expect(b2bDialog).toBeVisible({ timeout: 10_000 });
    await fieldByLabelText(gaPage, 'Company Name *').fill(customerCompany);
    await fieldByLabelText(gaPage, 'Name *').fill(customerContact);
    await fieldByLabelText(gaPage, 'Phone *').fill(`97${String(stamp).slice(-8)}`);
    await b2bDialog.getByRole('button', { name: 'Add B2B Customer', exact: true }).click();
    await expect(gaPage.getByText('B2B Customer created!')).toBeVisible({ timeout: 20_000 });
    const custSnap = await db.collection('customers').where('contactPerson', '==', customerContact).limit(1).get();
    expect(custSnap.empty).toBe(false);
    expect(custSnap.docs[0].data().companyId).toBe(DEMO_COMPANY_ID);
    expect(custSnap.docs[0].data().groupId).toBe(DEMO_GROUP_ID);

    // ── G. QUOTATIONS: create with one line item ──────────────────────────
    await navigateViaSidebar(gaPage, 'Sales', 'Quotations');
    await expect(gaPage).toHaveURL(/\/quotations/);
    await gaPage.getByRole('button', { name: 'New Quotation', exact: true }).first().click();
    await expect(gaPage.getByRole('dialog')).toBeVisible();
    await fieldByLabelText(gaPage, 'Customer Name *').fill(customerContact);
    await gaPage.getByRole('button', { name: 'Add Item', exact: true }).click();
    await gaPage.locator('input[placeholder="Product name"]').first().fill('Seed Product');
    await gaPage.locator('input[placeholder="Product name"]').first().locator('xpath=ancestor::*[contains(@class,"grid")]//following::input[@type="number"]').first();
    // qty + price live in the same row grid; fill by position within the item row.
    const qtyInputs = gaPage.locator('[role="dialog"] input[type="number"]');
    const qtyCount = await qtyInputs.count();
    if (qtyCount >= 2) {
      await qtyInputs.nth(0).fill('2');
      await qtyInputs.nth(1).fill('500');
    }
    // The submit button carries transition-all and sits under a live-recomputing
    // form (GST/total recalc + product autocomplete); under heavy load its
    // actionability stability check can flake — retry the click until it lands.
    await expect(async () => {
      await gaPage.locator('[role="dialog"]').getByRole('button', { name: 'Create Quotation', exact: true }).click({ timeout: 8_000 });
    }).toPass({ timeout: 60_000 });
    await expect(gaPage.getByText('Quotation created')).toBeVisible({ timeout: 20_000 });
    const quotSnap = await db.collection('quotations').where('customer', '==', customerContact).limit(1).get();
    expect(quotSnap.empty).toBe(false);
    expect(quotSnap.docs[0].data().companyId).toBe(DEMO_COMPANY_ID);

    // ── H. ORDERS: create for the customer ────────────────────────────────
    await navigateViaSidebar(gaPage, 'Sales', 'Orders');
    await expect(gaPage).toHaveURL(/\/orders/);
    await gaPage.getByRole('button', { name: 'New Order', exact: true }).first().click();
    await expect(gaPage.getByRole('dialog')).toBeVisible();
    await fieldByLabelText(gaPage, 'Customer').selectOption({ label: customerContact });
    await gaPage.getByRole('button', { name: 'Add Item', exact: true }).click();
    const orderNumbers = gaPage.locator('[role="dialog"] input[type="number"]');
    if ((await orderNumbers.count()) >= 2) {
      await orderNumbers.nth(0).fill('1');
      await orderNumbers.nth(1).fill('500');
    }
    await gaPage.locator('[role="dialog"]').getByRole('button', { name: 'Create Order', exact: true }).click();
    await expect(gaPage.getByText('Order created')).toBeVisible({ timeout: 20_000 });
    const orderSnap = await db.collection('orders').where('customer', '==', customerContact).limit(1).get();
    expect(orderSnap.empty).toBe(false);
    expect(orderSnap.docs[0].data().companyId).toBe(DEMO_COMPANY_ID);
    const createdOrderId = orderSnap.docs[0].id;

    // ── I. INVOICES (proforma): New Auto-Invoice from the created order ───
    await navigateViaSidebar(gaPage, 'Sales', 'Invoices');
    await expect(gaPage).toHaveURL(/\/invoices/);
    await gaPage.getByRole('button', { name: 'New Invoice', exact: true }).first().click();
    await expect(gaPage.getByRole('dialog')).toBeVisible();
    await fieldByLabelText(gaPage, 'Select Source Order *').selectOption({ index: 1 });
    await gaPage.locator('[role="dialog"]').getByRole('button', { name: 'Generate Invoice', exact: true }).click();
    await expect(gaPage.getByText('Invoice created')).toBeVisible({ timeout: 20_000 });
    const invSnap = await db.collection('proforma_invoices').where('orderId', '==', createdOrderId).limit(1).get();
    expect(invSnap.empty).toBe(false);
    expect(invSnap.docs[0].data().companyId).toBe(DEMO_COMPANY_ID);

    // ═══════════════════════ STOCK ═══════════════════════

    // ── J. STOCK: Adjust Stock (IN) against seeded product + warehouse ────
    await navigateViaSidebar(gaPage, 'Inventory', 'Stock');
    await expect(gaPage).toHaveURL(/\/stock/);
    await gaPage.locator('[data-tour="stock-create"]').click();
    await expect(gaPage.getByRole('dialog')).toBeVisible();
    const stockDialog = gaPage.locator('[role="dialog"]');
    await stockDialog.locator('select').nth(0).selectOption('IN');
    await stockDialog.locator('select').nth(1).selectOption({ label: 'Seed Product' });
    await stockDialog.locator('select').nth(2).selectOption({ label: 'Demo Main WH' });
    await stockDialog.locator('input[type="number"]').first().fill('25');
    await stockDialog.getByRole('button', { name: 'Save Entry', exact: true }).click();
    await expect(gaPage.getByText('Stock entry saved')).toBeVisible({ timeout: 20_000 });
    const ledgerSnap = await db.collection('stock_ledger')
      .where('productId', '==', 'PRD-SEED-1').where('companyId', '==', DEMO_COMPANY_ID).limit(1).get();
    expect(ledgerSnap.empty).toBe(false);
    expect(ledgerSnap.docs[0].data().groupId).toBe(DEMO_GROUP_ID);
    expect(ledgerSnap.docs[0].data().qty).toBe(25);

    // ── K. PROCUREMENT / GRN: create a real receipt against the seeded PO ─
    await navigateViaSidebar(gaPage, 'Procurement', 'Goods Receipts');
    await expect(gaPage).toHaveURL(/\/goods-receipts/);
    await gaPage.getByRole('button', { name: /Create receipt|Create First Receipt/ }).first().click();
    await expect(gaPage.getByRole('dialog', { hasText: 'New Goods Receipt' })).toBeVisible({ timeout: 10_000 });
    await fieldByLabelText(gaPage, 'Purchase Order *').selectOption({ index: 1 });
    await fieldByLabelText(gaPage, 'Warehouse *').selectOption({ label: 'Demo Main WH' });
    await fieldByLabelText(gaPage, 'Receive Now').first().fill('10');
    await gaPage.getByRole('button', { name: 'Post Goods Receipt', exact: true }).click();
    await expect(gaPage.getByText('Goods receipt posted to stock')).toBeVisible({ timeout: 20_000 });
    const grnSnap = await db.collection('goods_receipts').where('purchaseOrderId', '==', `PO-SEED-${stamp}`).limit(1).get();
    expect(grnSnap.empty).toBe(false);
    expect(grnSnap.docs[0].data().companyId).toBe(DEMO_COMPANY_ID);

    // ── L. PURCHASE ORDERS page: opens and lists (create form is a
    // documented simulated stub for every role — see file header).
    await navigateViaSidebar(gaPage, 'Procurement', 'Purchase Orders');
    await expect(gaPage).toHaveURL(/\/purchase-orders/);
    await expect(gaPage.getByText(`PO-SEED-${stamp}`).first()).toBeVisible({ timeout: 20_000 });

    // ═══════════════════════ FINANCE ═══════════════════════

    // ── M. PAYMENTS: record a payment against the created order ───────────
    await navigateViaSidebar(gaPage, 'Finance', 'Payments');
    await expect(gaPage).toHaveURL(/\/payments/);
    await gaPage.locator('[data-tour="payments-create"]').click();
    await expect(gaPage.getByRole('dialog')).toBeVisible();
    await fieldByLabelText(gaPage, 'Customer').selectOption({ label: customerContact });
    await fieldByLabelText(gaPage, 'Amount (₹)').fill('250');
    await gaPage.getByRole('button', { name: 'Record Payment', exact: true }).last().click();
    await expect(gaPage.getByText('Payment recorded')).toBeVisible({ timeout: 20_000 });
    const paySnap = await db.collection('payments').where('customerId', '==', custSnap.docs[0].id).limit(1).get();
    expect(paySnap.empty).toBe(false);
    expect(paySnap.docs[0].data().companyId).toBe(DEMO_COMPANY_ID);
    expect(paySnap.docs[0].data().groupId).toBe(DEMO_GROUP_ID);

    // ═══════════════════════ USER ADMINISTRATION ═══════════════════════

    // ── N. ROLES: create a custom role (permission management) ────────────
    await gotoPath(gaPage, '/roles');
    const roleName = `E2ECustom${String(stamp).slice(-5)}`;
    await gaPage.getByRole('button', { name: 'Create Role', exact: true }).first().click();
    await expect(gaPage.getByRole('dialog')).toBeVisible();
    await fieldByLabelText(gaPage, 'Role Name').fill(roleName);
    await gaPage.locator('[role="dialog"]').getByRole('button', { name: 'Create Role', exact: true }).click();
    await expect(gaPage.getByText('Role created')).toBeVisible({ timeout: 20_000 });
    const roleSnap = await db.collection('roles').where('name', '==', roleName).limit(1).get();
    expect(roleSnap.empty).toBe(false);
    expect(roleSnap.docs[0].data().companyId).toBe(DEMO_COMPANY_ID);

    // ── O. USERS: role change on a same-group sibling user (group reach) ──
    // Home focus lists ONLY home-company users (companyScopedQuery keeps the
    // GroupAdmin's home session companyId-scoped — pre-Phase-8 behaviour, zero
    // groupId dependency). The same-group SIBLING user becomes visible in the
    // Group view, where the users list query is groupId-scoped and the rules'
    // groupAdminCanRead() list branch is provable. That IS the designed tenant
    // model (Master Plan §7.2/§4.4) — not a scope leak.
    await gotoPath(gaPage, '/users');
    await expect(gaPage.getByText(`salesuser-${stamp}@e2e.test`).first()).toBeVisible({ timeout: 20_000 });
    await expect(gaPage.getByText(`sibuser-${stamp}@e2e.test`)).toHaveCount(0);
    await expect(gaPage.getByText(`fgnuser-${stamp}@e2e.test`)).toHaveCount(0);
    // Switch to the Group aggregate view → the sibling user appears.
    await switchCompany(gaPage, /All Companies \(Group view\)/);
    await gotoPath(gaPage, '/users');
    await expect(gaPage.getByText(`sibuser-${stamp}@e2e.test`).first()).toBeVisible({ timeout: 20_000 });
    // The foreign-group user must NEVER be visible in any view.
    await expect(gaPage.getByText(`fgnuser-${stamp}@e2e.test`)).toHaveCount(0);
    // Change the sibling user's role Sales → Admin through the real UI.
    // (The role picker lists the HOME company's role docs — per-company role
    // keying §5.6, home-company source in Group view §7.5 — so the target
    // must be a role that exists there: Admin, the same change the
    // groupAdminFullGroupAccess emulator suite drives.) Two dialogs stay
    // mounted on this page (row-details panel + edit form) — always scope
    // to the 'Edit User' one.
    const editUserDialog = gaPage.getByRole('dialog').filter({ hasText: 'Edit User' });
    await gaPage.locator('tr', { hasText: `sibuser-${stamp}@e2e.test` }).first().click();
    await gaPage.getByRole('button', { name: /Edit User/ }).click();
    await expect(editUserDialog).toBeVisible();
    await fieldByLabelText(gaPage, 'Role').first().selectOption({ label: 'Admin' });
    await editUserDialog.getByRole('button', { name: 'Update', exact: true }).click();
    // The update is a multi-round-trip mutation (users projection + master-identity
    // dedup + role enrichment); on the emulator's long-poll channel the UI close can
    // lag well past 45s. The authoritative completion signal is the PERSISTED doc —
    // poll it via the Admin SDK, then reload to resync the list/dialog state.
    await expect(async () => {
      const snap = await db.collection('users').doc(siblingUserId).get();
      expect(snap.data()?.role).toBe('Admin');
    }).toPass({ timeout: 90_000 });
    await gaPage.reload();
    await expect(gaPage.getByText(`sibuser-${stamp}@e2e.test`).first()).toBeVisible({ timeout: 30_000 });
    const sibAfter = await db.collection('users').doc(siblingUserId).get();
    expect(sibAfter.data()?.role).toBe('Admin');
    // GroupAdmin is never offered the GroupAdmin role option in the picker.
    await gaPage.locator('tr', { hasText: `sibuser-${stamp}@e2e.test` }).first().click();
    await gaPage.getByRole('button', { name: /Edit User/ }).click();
    await expect(editUserDialog).toBeVisible();
    const roleOptions = await fieldByLabelText(gaPage, 'Role').first().locator('option').allTextContents();
    expect(roleOptions).not.toContain('GroupAdmin');
    await editUserDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(editUserDialog).toBeHidden({ timeout: 15_000 });

    // ── P. Cross-group user role change DENIED at the rules layer ─────────
    // Drive the same usersUpdateAllowed branch via a direct rules-level probe:
    // the UI never shows the foreign user (list-scope denial #1); a crafted
    // update must be denied by the rules (scope denial #2). We verify the UI
    // denial here; the rules-level denial is covered by the emulator suites
    // (groupAdminFullGroupAccess 'CANNOT change the different-Group user').
    await expect(gaPage.getByText(`fgnuser-${stamp}@e2e.test`)).toHaveCount(0);

    // ═══════════════════════ GROUP-WIDE CONTEXT ═══════════════════════

    // ── Q. Sibling company: create a category there (group-scoped write) ──
    await switchCompany(gaPage, /^SB/);
    await gotoPath(gaPage, '/users');
    // Focused on the sibling: ONLY that company's users (company scope).
    await expect(gaPage.getByText(`sibuser-${stamp}@e2e.test`).first()).toBeVisible({ timeout: 20_000 });
    await expect(gaPage.getByText(`salesuser-${stamp}@e2e.test`)).toHaveCount(0);
    const siblingCat = `E2E_SIBCAT_${stamp}`;
    await gotoPath(gaPage, '/categories');
    await gaPage.getByRole('button', { name: 'Add Category', exact: true }).first().click();
    await expect(gaPage.getByRole('dialog')).toBeVisible();
    await fieldByLabelText(gaPage, 'Name *').fill(siblingCat);
    await gaPage.locator('[role="dialog"]').getByRole('button', { name: 'Add Category', exact: true }).click();
    await expect(gaPage.getByText('Category added')).toBeVisible({ timeout: 20_000 });
    const sibCatSnap = await db.collection('product_categories').where('name', '==', siblingCat).limit(1).get();
    expect(sibCatSnap.empty).toBe(false);
    expect(sibCatSnap.docs[0].data().companyId).toBe(siblingCompanyId);
    expect(sibCatSnap.docs[0].data().groupId).toBe(DEMO_GROUP_ID);
    // Foreign product still invisible from the sibling focus.
    await gotoPath(gaPage, '/products');
    await expect(gaPage.getByText('FOREIGN_PRODUCT')).toHaveCount(0);

    // ── R. Group aggregate view: home + sibling categories both visible ───
    // Section Q left the session focused on the sibling company — switch back
    // to the Group aggregate view before asserting group-wide visibility.
    await switchCompany(gaPage, /All Companies \(Group view\)/);
    await gotoPath(gaPage, '/categories');
    // Assert on the tree-node buttons ('Select <name>' accessible names), NOT
    // getByText: the Add Category dialog stays mounted with a hidden Parent
    // <select> whose <option>s contain the same category names.
    await expect(gaPage.getByRole('button', { name: 'Select E2E Demo Category' })).toBeVisible({ timeout: 15_000 });
    await expect(gaPage.getByRole('button', { name: 'Select E2E Sibling Category' })).toBeVisible({ timeout: 15_000 });
    await expect(gaPage.getByRole('button', { name: `Select ${siblingCat}` })).toBeVisible({ timeout: 15_000 });

    // ── S. No permission-denied errors attributable to this flow ──────────
    const deniedErrors = runtimeErrors.filter((e) => /permission.?denied|missing or insufficient/i.test(e));
    expect(deniedErrors).toEqual([]);

    await gaContext.close();
  });
});
