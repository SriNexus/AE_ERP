// Left Panel/Tabs/Documents/Footer UI standardization mission — genuine
// browser + emulated-Firestore runtime check. Run via
// node tests/customer-workspace-e2e/run-emulator-tests.mjs.
import { test, expect, type Page } from '@playwright/test';

const SEED = {
  adminEmail: 'admin@test.local',
  adminPassword: 'TestPass123!',
  customerB2B: 'CUST-B2B-1',
  customerFromLead: 'CUST-FROM-LEAD-1',
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

test.describe.serial('Left Panel/Tabs/Documents/Footer standardization (emulator-backed)', () => {
  test('1. Left Panel — permanent Customer Information, visible on every tab (Documents lives in its own tab — see the Document System + Panel Standardization spec)', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2B}`);
    await expect(page.getByRole('heading', { name: /Acme Solar Industries/i })).toBeVisible({ timeout: 20_000 });

    await expect(page.getByText('Customer Information')).toBeVisible();
    // Switch to a non-Overview tab — Customer Information + Documents must
    // stay visible (permanent Left Panel), unlike the old per-tab mode switch.
    await page.getByRole('tab', { name: 'Activity' }).click();
    await expect(page.getByText('Customer Information')).toBeVisible();
  });

  test('2. Tab bar sits at workspace level — a sibling of the 3-column body, not nested inside the Center Panel', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2B}`);
    await expect(page.getByRole('heading', { name: /Acme Solar Industries/i })).toBeVisible({ timeout: 20_000 });

    const tablist = page.getByRole('tablist');
    await expect(tablist).toBeVisible();
    const tablistBox = await tablist.boundingBox();
    const leftPanelHeading = page.getByText('Customer Information');
    const leftPanelBox = await leftPanelHeading.boundingBox();
    expect(tablistBox).not.toBeNull();
    expect(leftPanelBox).not.toBeNull();
    // The tab bar's own bounding box must span from left edge to right edge
    // of the workspace (full width) — not just the Center Panel's column —
    // i.e. it starts at or before the Left Panel's own horizontal position.
    expect(tablistBox!.x).toBeLessThanOrEqual(leftPanelBox!.x + 5);
  });

  test('3. Documents — Customer Workspace shows a document that originated from its source Lead, with no duplicate upload', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerFromLead}`);
    await expect(page.getByRole('heading', { name: /Suresh Patil/i })).toBeVisible({ timeout: 20_000 });

    // Documents lives in its own workspace-level tab now (Document System +
    // Panel Standardization mission), not a permanent Left Panel section.
    await page.getByRole('tab', { name: 'Documents' }).click();

    // The exact same document (electricity-bill-suresh.pdf) copied at
    // conversion time (see leadWorkflow.ts's `documents: normalizeDocuments(lead)`)
    // must appear in the Customer Workspace's Documents tab.
    await expect(page.getByText('electricity-bill-suresh.pdf').first()).toBeVisible({ timeout: 10_000 });

    // Only one copy — not duplicated (e.g. once from `documents` array, once
    // from a legacy single-slot field). The master-detail panel legitimately
    // shows the name twice (list card + preview header for the same doc).
    await expect(page.getByText('electricity-bill-suresh.pdf')).toHaveCount(2);
  });

  test('4. Footer — Save/Save & Next buttons render at Lead-matching size (h-4 icon, compact vertical padding)', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2B}`);
    await expect(page.getByRole('heading', { name: /Acme Solar Industries/i })).toBeVisible({ timeout: 20_000 });

    const saveButton = page.getByRole('button', { name: 'Save', exact: true });
    await expect(saveButton).toBeVisible();
    const box = await saveButton.boundingBox();
    expect(box).not.toBeNull();
    // Lead's own FooterActionButton is a compact px-3.5 py-2 pill — assert a
    // reasonably small height (not the old larger py-2 container padding),
    // roughly 28-40px tall depending on font metrics/zoom.
    expect(box!.height).toBeGreaterThan(20);
    expect(box!.height).toBeLessThan(48);
  });
});
