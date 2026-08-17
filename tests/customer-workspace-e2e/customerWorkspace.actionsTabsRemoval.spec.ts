// Remove Unnecessary Actions & Tabs mission — genuine browser +
// emulated-Firestore runtime check. Run via
// node tests/customer-workspace-e2e/run-emulator-tests.mjs.
import { test, expect, type Page } from '@playwright/test';

const SEED = {
  adminEmail: 'admin@test.local',
  adminPassword: 'TestPass123!',
  customerB2B: 'CUST-B2B-1',
};

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
  await page.locator('#login-email:visible').fill(email);
  await page.locator('#login-password:visible').fill(password);
  await page.locator('button[type="submit"]:visible').click();
  await expect(page).not.toHaveURL(/login/, { timeout: 20_000 });
}

test.describe.serial('Remove Unnecessary Actions & Tabs (emulator-backed)', () => {
  test('1. Tab bar shows exactly the 7 remaining tabs — History/Notes/Permissions/Attachments are gone; Documents is back as its own tab (Document System + Panel Standardization mission)', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2B}`);
    await expect(page.getByRole('heading', { name: /Acme Solar Industries/i })).toBeVisible({ timeout: 20_000 });

    const tablist = page.getByRole('tablist');
    for (const label of ['Overview', 'Documents', 'Orders', 'Invoices', 'Activity', 'Tasks', 'Linked Records']) {
      await expect(tablist.getByRole('tab', { name: label })).toBeVisible();
    }
    for (const label of ['History', 'Notes', 'Permissions', 'Attachments']) {
      await expect(tablist.getByRole('tab', { name: label })).toHaveCount(0);
    }
  });

  test('2. Header no longer shows Generate Invoice or Create Task buttons', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2B}`);
    await expect(page.getByRole('heading', { name: /Acme Solar Industries/i })).toBeVisible({ timeout: 20_000 });

    const fullHeader = page.locator('h1', { hasText: 'Acme Solar Industries' }).locator('../../..');
    await expect(fullHeader.getByRole('button', { name: 'Generate Invoice' })).toHaveCount(0);
    await expect(fullHeader.getByRole('button', { name: 'Create Task' })).toHaveCount(0);
  });

  test('3. The Left Panel\'s permanent Customer Information section still works, untouched by the tab removal (Documents itself now lives in its own tab, not here)', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2B}`);
    await expect(page.getByRole('heading', { name: /Acme Solar Industries/i })).toBeVisible({ timeout: 20_000 });

    await expect(page.getByText('Customer Information')).toBeVisible();
  });

  test('4. The Right Panel\'s own separate "Create Task" quick action still works — only the header button was removed', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2B}`);
    await expect(page.getByRole('heading', { name: /Acme Solar Industries/i })).toBeVisible({ timeout: 20_000 });

    const quickActions = page.locator('div', { has: page.getByRole('heading', { name: 'Quick Actions', exact: true }) }).last();
    await expect(quickActions.getByRole('button', { name: 'Create Task' })).toBeVisible();
  });
});
