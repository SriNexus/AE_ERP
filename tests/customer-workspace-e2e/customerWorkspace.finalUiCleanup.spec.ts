// Final UI Cleanup mission — genuine browser + emulated-Firestore runtime
// check. Run via node tests/customer-workspace-e2e/run-emulator-tests.mjs.
//
// Covers: KPI bar removed from both Customer and Lead Workspace; Create
// Quotation/Create Order/Call/WhatsApp/Email removed from the Customer
// Right Panel's Quick Actions; Active Orders/Relationship Age moved into
// Customer's Relationship Health; the Note is manageable from both the
// Left Panel's Edit Customer form and the Right Panel's new Add Note button,
// both against the same customer.notes field.
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

function fieldInput(page: Page, label: string) {
  return page.locator('div.flex.flex-col.gap-1').filter({ hasText: label }).locator('input, select, textarea').first();
}

test.describe.serial('Final UI Cleanup mission (emulator-backed)', () => {
  test('1. Customer Workspace: KPI bar is gone — header goes straight into the tab bar', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2B}`);
    await expect(page.getByRole('heading', { name: /Acme Solar Industries/i })).toBeVisible({ timeout: 20_000 });

    // "Order Count" / "Total Order Value" were exclusive to the removed KPI
    // bar — not reused anywhere else on this page (Orders tab shows
    // different labels: Lifetime Value/Active Orders/Total Revenue/Outstanding).
    await expect(page.getByText('Order Count', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Total Order Value', { exact: true })).toHaveCount(0);
  });

  test('2. Lead Workspace: KPI bar is gone', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/leads/workspace/${SEED.leadId}`);
    await expect(page.getByRole('heading', { name: /Suresh Patil/i })).toBeVisible({ timeout: 20_000 });

    // "Stage" (the KPI bar's own label) was exclusive to that bar — the
    // actual status value is shown as a badge elsewhere, never under this label.
    await expect(page.getByText('Stage', { exact: true })).toHaveCount(0);
  });

  test('3. Customer Right Panel: Create Quotation/Create Order/Call/WhatsApp/Email are gone; Add Note is present', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2B}`);
    await expect(page.getByRole('heading', { name: /Acme Solar Industries/i })).toBeVisible({ timeout: 20_000 });

    const rightPanel = page.getByText('Quick Actions', { exact: true }).locator('../..');
    await expect(rightPanel.getByRole('button', { name: 'Create Quotation' })).toHaveCount(0);
    await expect(rightPanel.getByRole('button', { name: 'Create Order' })).toHaveCount(0);
    await expect(rightPanel.getByRole('link', { name: 'Call' })).toHaveCount(0);
    await expect(rightPanel.getByRole('link', { name: 'WhatsApp' })).toHaveCount(0);
    await expect(rightPanel.getByRole('link', { name: 'Email' })).toHaveCount(0);
    await expect(rightPanel.getByRole('button', { name: 'Add Note' })).toBeVisible();
  });

  test('4. Relationship Health shows Active Orders and Relationship Age for the B2B customer', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2B}`);
    await expect(page.getByRole('heading', { name: /Acme Solar Industries/i })).toBeVisible({ timeout: 20_000 });

    const healthPanel = page.getByText('Relationship Health', { exact: true }).locator('..');
    await expect(healthPanel.getByText('Active Orders', { exact: true })).toBeVisible();
    // Seed has 3 orders for this customer, 1 Delivered (excluded) + 2 active.
    await expect(healthPanel.getByText('2', { exact: true })).toBeVisible();
    await expect(healthPanel.getByText('Relationship Age', { exact: true })).toBeVisible();
  });

  test('5. Add Note (Right Panel) edits the same customer.notes field the Left Panel Edit Customer form reads/writes', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2B}`);
    await expect(page.getByRole('heading', { name: /Acme Solar Industries/i })).toBeVisible({ timeout: 20_000 });

    // Left Panel shows the existing note directly. The same text also
    // legitimately appears elsewhere on the page (e.g. an Overview/tab notes
    // display) — CUST-B2B-1 has no sourceLeadId so "Source Lead" isn't a
    // reliable anchor here; the Left Panel column renders first in DOM
    // order (it's the first of the 3 body columns), so `.first()` reliably
    // targets it instead of the later Overview-tab occurrence.
    const leftPanelNote = page.getByText('Original seed notes for B2B customer.').first();
    await expect(leftPanelNote).toBeVisible();

    await page.getByRole('button', { name: 'Add Note' }).click();
    const noteField = page.getByRole('dialog').locator('textarea').first();
    await expect(noteField).toHaveValue('Original seed notes for B2B customer.');
    await noteField.fill('Updated via right panel Add Note');
    await page.getByRole('button', { name: 'Save Note' }).click();
    await expect(page.getByText('Note saved')).toBeVisible({ timeout: 10_000 });

    // Left Panel reflects the same write immediately.
    await expect(page.getByText('Updated via right panel Add Note').first()).toBeVisible({ timeout: 10_000 });

    // The Left Panel's own Edit Customer form reads the identical field.
    await page.getByRole('button', { name: 'Edit Customer' }).click();
    const notesField = fieldInput(page, 'Notes');
    await expect(notesField).toHaveValue('Updated via right panel Add Note');
  });
});
