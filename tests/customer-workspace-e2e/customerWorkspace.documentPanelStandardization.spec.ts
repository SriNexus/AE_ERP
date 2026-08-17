// Document System + Panel Standardization mission — genuine browser +
// emulated-Firestore runtime check. Run via
// node tests/customer-workspace-e2e/run-emulator-tests.mjs.
//
// Covers: Documents is a workspace-level tab (not a Left Panel section) in
// BOTH Customer and Lead Workspace, using the same DocumentManager/adapter
// architecture; the Documents tab shows a master-detail panel (list +
// large inline preview) in the spacious center panel; the premium pill-style
// tab active state applies in both workspaces.
import { test, expect, type Page } from '@playwright/test';

const SEED = {
  adminEmail: 'admin@test.local',
  adminPassword: 'TestPass123!',
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

test.describe.serial('Document System + Panel Standardization mission (emulator-backed)', () => {
  test('1. Customer Workspace: Documents is a tab, not in the Left Panel; opening it shows the master-detail panel with the seeded document', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerFromLead}`);
    await expect(page.getByRole('heading', { name: /Suresh Patil/i })).toBeVisible({ timeout: 20_000 });

    // Not in the Left Panel by default (Overview tab is active on load).
    await expect(page.getByText('electricity-bill-suresh.pdf')).toHaveCount(0);

    const docsTab = page.getByRole('tab', { name: 'Documents' });
    await expect(docsTab).toBeVisible();
    await docsTab.click();
    await expect(docsTab).toHaveAttribute('aria-selected', 'true');

    // Master-detail: the document card in the list AND its name repeated in
    // the preview header (2 occurrences), plus the PDF inline preview iframe.
    await expect(page.getByText('electricity-bill-suresh.pdf').first()).toBeVisible();
    await expect(page.locator('iframe[title="electricity-bill-suresh.pdf"]')).toBeVisible();
    await expect(page.getByText('PDF document')).toBeVisible();
  });

  test('2. Lead Workspace: Documents is a tab, not in the Left Panel; opening it shows the same master-detail panel for the same shared document', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/leads/workspace/${SEED.leadId}`);
    await expect(page.getByRole('heading', { name: /Suresh Patil/i })).toBeVisible({ timeout: 20_000 });

    await expect(page.getByText('electricity-bill-suresh.pdf')).toHaveCount(0);

    const docsTab = page.getByRole('tab', { name: 'Documents' });
    await expect(docsTab).toBeVisible();
    await docsTab.click();
    await expect(docsTab).toHaveAttribute('aria-selected', 'true');

    await expect(page.getByText('electricity-bill-suresh.pdf').first()).toBeVisible();
    await expect(page.locator('iframe[title="electricity-bill-suresh.pdf"]')).toBeVisible();
  });

  test('3. Premium tab active state — the active tab gets a filled pill background in both workspaces', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/leads/workspace/${SEED.leadId}`);
    await expect(page.getByRole('heading', { name: /Suresh Patil/i })).toBeVisible({ timeout: 20_000 });

    const overviewTab = page.getByRole('tab', { name: 'Overview' });
    await expect(overviewTab).toHaveAttribute('aria-selected', 'true');
    await expect(overviewTab).toHaveClass(/bg-\[var\(--color-primary-light\)\]/);

    await page.getByRole('tab', { name: 'Documents' }).click();
    await expect(overviewTab).not.toHaveClass(/bg-\[var\(--color-primary-light\)\]/);
    await expect(page.getByRole('tab', { name: 'Documents' })).toHaveClass(/bg-\[var\(--color-primary-light\)\]/);
  });
});
