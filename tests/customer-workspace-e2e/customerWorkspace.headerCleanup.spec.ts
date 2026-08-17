// Header/action cleanup mission — genuine browser + emulated-Firestore
// runtime check. Run via node tests/customer-workspace-e2e/run-emulator-tests.mjs,
// or against an already running emulator+dev-server (see the session notes).
//
// The "Generate Invoice modal" tests that used to live here were removed by
// the Remove Unnecessary Actions & Tabs mission — that modal (and the
// header's Generate Invoice / Create Task buttons) no longer exist. See
// customerWorkspace.actionsTabsRemoval.spec.ts for their replacement
// (absence) coverage.
import { test, expect, type Page } from '@playwright/test';

const SEED = {
  adminEmail: 'admin@test.local',
  adminPassword: 'TestPass123!',
  customerB2B: 'CUST-B2B-1',
  customerB2C: 'CUST-B2C-1',
};

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
  await page.locator('#login-email:visible').fill(email);
  await page.locator('#login-password:visible').fill(password);
  await page.locator('button[type="submit"]:visible').click();
  await expect(page).not.toHaveURL(/login/, { timeout: 20_000 });
}

function fieldInput(page: Page, label: string) {
  return page.locator('div.flex.flex-col.gap-1').filter({ hasText: label }).locator('input, select, textarea').first();
}

test.describe.serial('Header cleanup (emulator-backed)', () => {
  test('1. Header no longer shows company/city/From Lead; Type sits beside the name', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2B}`);
    await expect(page.getByRole('heading', { name: /Acme Solar Industries/i })).toBeVisible({ timeout: 20_000 });

    const header = page.locator('h1', { hasText: 'Acme Solar Industries' }).locator('../..');
    await expect(header.getByText('Disposable Demo Solar Works')).toHaveCount(0);
    await expect(header.getByText('Pune')).toHaveCount(0); // seeded B2B city
    await expect(header.getByText('From Lead')).toHaveCount(0);

    // TypeChip ("B2B") is right next to the name heading.
    await expect(header.getByText('B2B', { exact: true })).toBeVisible();
  });

  test('2. Removed header actions are gone, including Generate Invoice and Create Task (Remove Unnecessary Actions & Tabs mission)', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2B}`);
    await expect(page.getByRole('heading', { name: /Acme Solar Industries/i })).toBeVisible({ timeout: 20_000 });

    // Scoped to the full header container (outermost) — the Center Panel has
    // its OWN, separate, legitimate "Create Order"/"Create Quotation"
    // buttons for the embedded Tier B workflow, untouched by this mission.
    const fullHeader = page.locator('h1', { hasText: 'Acme Solar Industries' }).locator('../../..');
    await expect(fullHeader.getByRole('button', { name: 'Edit Type' })).toHaveCount(0);
    await expect(fullHeader.getByRole('button', { name: 'Create Order' })).toHaveCount(0);
    await expect(fullHeader.getByRole('button', { name: 'Add AMC Contract' })).toHaveCount(0);
    await expect(fullHeader.getByRole('button', { name: 'Create Ticket' })).toHaveCount(0);
    await expect(fullHeader.getByRole('button', { name: 'View History' })).toHaveCount(0);
    await expect(fullHeader.getByRole('button', { name: 'Generate Invoice' })).toHaveCount(0);
    await expect(fullHeader.getByRole('button', { name: 'Create Task' })).toHaveCount(0);
  });

  test('3. Customer Type is changeable through the normal Edit Customer flow, and persists on Save', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2C}`);
    await expect(page.getByRole('heading', { name: /Ramesh Kumar/i })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Edit Customer' }).click();
    const typeField = fieldInput(page, 'Customer Type');
    await expect(typeField).toHaveValue('B2C');

    // Switching live-updates the form's own B2B-only fields (no Save needed to preview).
    await expect(page.locator('div.flex.flex-col.gap-1').filter({ hasText: 'GST' })).toHaveCount(0);
    await typeField.selectOption('B2B');
    await expect(page.locator('div.flex.flex-col.gap-1').filter({ hasText: 'GST' })).toHaveCount(1);

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Unsaved changes')).toHaveCount(0, { timeout: 10_000 });

    await page.reload();
    const header = page.locator('h1', { hasText: 'Ramesh Kumar' }).locator('..');
    await expect(header.getByText('B2B', { exact: true })).toBeVisible({ timeout: 20_000 });
  });
});
