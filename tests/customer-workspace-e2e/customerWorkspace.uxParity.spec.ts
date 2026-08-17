// Customer + Lead Workspace — Final UX Parity mission — genuine browser +
// emulated-Firestore runtime check. Run via
// node tests/customer-workspace-e2e/run-emulator-tests.mjs.
//
// Covers: Lead Workspace's edit form now uses the same shared Input/Select/
// Textarea components as Customer's editor (not the old bespoke inline-label
// EditInfoRow); Quick Actions render as a compact 2-column tile grid in both
// workspaces.
import { test, expect, type Page } from '@playwright/test';

const SEED = {
  adminEmail: 'admin@test.local',
  adminPassword: 'TestPass123!',
  customerB2B: 'CUST-B2B-1',
  leadId: 'LEAD-SOURCE-1',
};

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
  await page.locator('#login-email:visible').fill(email);
  await page.locator('#login-password:visible').fill(password);
  await page.locator('button[type="submit"]:visible').click();
  await expect(page).not.toHaveURL(/login/, { timeout: 20_000 });
}

function fieldControl(scope: Page | import('@playwright/test').Locator, label: string) {
  return scope.locator('div.flex.flex-col.gap-1').filter({ hasText: label }).locator('input, select, textarea').first();
}

test.describe.serial('Final UX Parity mission (emulator-backed)', () => {
  test('1. Lead Workspace edit form uses the same premium field components as Customer\'s editor — labeled fields in a stacked form, not the old inline-label two-column rows', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/leads/workspace/${SEED.leadId}`);
    await expect(page.getByRole('heading', { name: /Suresh Patil/i })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Edit lead' }).click();

    // The shared Input/Select/Textarea components render each field's own
    // label in a `div.flex.flex-col.gap-1` wrapper (the same structural
    // convention CustomerWorkspaceEditor.tsx's fields use, and the same one
    // this suite's own fieldControl() helper already relies on elsewhere).
    const nameField = fieldControl(page, 'Full Name');
    await expect(nameField).toBeVisible();
    await expect(nameField).toHaveValue('Suresh Patil');

    const statusField = fieldControl(page, 'Status');
    await expect(statusField).toBeVisible();

    // Editing and saving through the real, unchanged Lead save path still
    // works. The page also has the Footer's own unrelated "Save" button, so
    // scope to the Left Panel's own edit-mode Save (the first one in DOM
    // order — it sits above the Footer).
    await fieldControl(page, 'City').fill('Pune Updated');
    await page.getByRole('button', { name: 'Save', exact: true }).first().click();
    await expect(page.getByText('Lead updated')).toBeVisible({ timeout: 10_000 });
    // Also appears in Recent Activity's own summary of the change — scope
    // to the first occurrence (the City InfoRow itself).
    await expect(page.getByText('Pune Updated').first()).toBeVisible();
  });

  test('2. Customer Workspace Quick Actions render as a compact tile grid (Right Panel, 15% width)', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2B}`);
    await expect(page.getByRole('heading', { name: /Acme Solar Industries/i })).toBeVisible({ timeout: 20_000 });

    const quickActions = page.locator('div', { has: page.getByRole('heading', { name: 'Quick Actions', exact: true }) }).last();
    await expect(quickActions.locator('div.grid.grid-cols-2')).toBeVisible();
    await expect(quickActions.getByRole('button', { name: 'Schedule Follow-up' })).toBeVisible();
    await expect(quickActions.getByRole('button', { name: 'Add Note' })).toBeVisible();
  });

  test('3. Lead Workspace Quick Actions also render as a compact tile grid, same treatment', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/leads/workspace/${SEED.leadId}`);
    await expect(page.getByRole('heading', { name: /Suresh Patil/i })).toBeVisible({ timeout: 20_000 });

    const quickActions = page.locator('div', { has: page.getByRole('heading', { name: 'Quick Actions', exact: true }) }).last();
    await expect(quickActions.locator('div.grid.grid-cols-2')).toBeVisible();
    await expect(quickActions.getByRole('button', { name: 'Transfer' })).toBeVisible();
    await expect(quickActions.getByRole('button', { name: 'Mark Lost' })).toBeVisible();
  });
});
