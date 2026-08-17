// B2C Center Panel Restructure mission (B2B long-term relationship hub vs
// B2C one-time project lifecycle) — genuine browser + emulated-Firestore
// runtime check. Run via
// node tests/customer-workspace-e2e/run-emulator-tests.mjs.
import { test, expect, type Page } from '@playwright/test';

const SEED = {
  adminEmail: 'admin@test.local',
  adminPassword: 'TestPass123!',
  customerB2B: 'CUST-B2B-1',
  customerB2C: 'CUST-B2C-1',
  customerB2CWithProject: 'CUST-B2C-PROJECT-1',
  projectForB2C: 'PROJ-SEED-1',
};

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
  await page.locator('#login-email:visible').fill(email);
  await page.locator('#login-password:visible').fill(password);
  await page.locator('button[type="submit"]:visible').click();
  await expect(page).not.toHaveURL(/login/, { timeout: 20_000 });
}

function centerPanelCard(page: Page) {
  // The heading sits in <div className="flex items-center justify-between
  // mb-4"> (direct parent), itself inside the outer card
  // <div className="rounded-2xl ... p-5 shadow-sm"> (grandparent) which also
  // contains <CustomerCenterPanel>'s actual body — walk up two levels from
  // the heading itself rather than guess among ambiguous "has:" matches.
  return page.getByRole('heading', { name: /Work on This Customer/ }).locator('../..');
}

function projectTimelineCard(page: Page) {
  return page.getByRole('heading', { name: 'Project Timeline' }).locator('../..');
}

test.describe.serial('Central Panel B2B/B2C lifecycle (emulator-backed)', () => {
  test('1. B2B customer loads correctly, keeps the 5-stage pipeline (Create Quotation + Create Order), no Project Timeline', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2B}`);
    await expect(page.getByRole('heading', { name: /Acme Solar Industries/i })).toBeVisible({ timeout: 20_000 });

    const card = centerPanelCard(page);
    await expect(card.getByRole('heading', { name: 'Work on This Customer' })).toBeVisible();
    await expect(card.getByText('Create Quotation')).toBeVisible();
    await expect(card.getByText('Create Order')).toBeVisible();
    await expect(card.getByText('Go to Project Workspace')).toHaveCount(0);
    // B2B is never routed to the B2C Project Timeline section.
    await expect(page.getByRole('heading', { name: 'Project Timeline' })).toHaveCount(0);
  });

  test('2. B2C customer (no project yet) shows ONLY Project in Work on This Customer, plus the Project Timeline placeholder below', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2C}`);
    await expect(page.getByRole('heading', { name: /Ramesh Kumar/i })).toBeVisible({ timeout: 20_000 });

    const card = centerPanelCard(page);
    await expect(card.getByRole('heading', { name: 'Work on This Customer' })).toBeVisible();
    await expect(card.getByText('Create Project', { exact: true })).toBeVisible();
    // Quotation and Registration were removed from this section only.
    await expect(card.getByText('Create Quotation')).toHaveCount(0);
    await expect(card.getByText('Start Registration')).toHaveCount(0);
    await expect(card.getByText('Create Order')).toHaveCount(0);

    // Project Timeline sits immediately below, in its placeholder state.
    const timeline = projectTimelineCard(page);
    await expect(timeline).toBeVisible();
    await expect(timeline.getByText(/becomes active once a Project is created/)).toBeVisible();

    // Right Panel Quick Actions: no B2C creation shortcuts beyond Create
    // Project (Loan Application is reached via its own /loan-applications page).
    const quickActions = page.locator('div', { has: page.getByRole('heading', { name: 'Quick Actions', exact: true }) }).last();
    await expect(quickActions.getByRole('button', { name: 'Create Quotation' })).toHaveCount(0);
    await expect(quickActions.getByRole('button', { name: 'Create Order' })).toHaveCount(0);
    await expect(quickActions.getByRole('button', { name: 'Start Registration' })).toHaveCount(0);
    await expect(quickActions.getByRole('button', { name: 'Create Project' })).toBeVisible();
  });

  test('3. B2C customer with an existing Project keeps the Project card visible (done state with real project info, Create disabled) and surfaces the Project Timeline as the main visualization; navigating opens the correct Project Workspace', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2CWithProject}`);
    await expect(page.getByRole('heading', { name: /Anita Deshmukh/i })).toBeVisible({ timeout: 20_000 });

    // The Project card stays in place — "Work on This Customer" always
    // renders. Its body transitions to the done state: real project info
    // (PRJ-0001) instead of a Create action, and the Create Project button
    // is rendered but disabled (never a second creation opportunity).
    const card = centerPanelCard(page);
    await expect(card.getByRole('heading', { name: 'Work on This Customer' })).toBeVisible();
    await expect(card.getByText('PRJ-0001')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Create Project' })).toBeDisabled();

    const timeline = projectTimelineCard(page);
    await expect(timeline).toBeVisible();
    await expect(timeline.getByText(/stages/)).toBeVisible();

    // Right Panel Quick Actions must not offer a B2C creation action once a
    // project exists.
    const quickActions = page.locator('div', { has: page.getByRole('heading', { name: 'Quick Actions', exact: true }) }).last();
    await expect(quickActions.getByRole('button', { name: 'Create Quotation' })).toHaveCount(0);
    await expect(quickActions.getByRole('button', { name: 'Start Registration' })).toHaveCount(0);
    await expect(quickActions.getByRole('button', { name: 'Create Project' })).toHaveCount(0);

    const goToProjectButton = timeline.getByRole('button', { name: 'Go to Project Workspace' });
    await expect(goToProjectButton).toBeVisible();
    await goToProjectButton.click();

    await expect(page).toHaveURL(new RegExp(`/projects/${SEED.projectForB2C}`));
    await expect(page.getByText('PRJ-0001')).toBeVisible({ timeout: 20_000 });
  });

  test('4. No Project Workspace business logic duplicated — Customer Workspace still functions after visiting Project Workspace and returning', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2CWithProject}`);
    await expect(page.getByRole('heading', { name: /Anita Deshmukh/i })).toBeVisible({ timeout: 20_000 });
    await page.goto(`/projects/${SEED.projectForB2C}`);
    await expect(page.getByText('PRJ-0001')).toBeVisible({ timeout: 20_000 });
    await page.goBack();
    await expect(page.getByRole('heading', { name: /Anita Deshmukh/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Project Timeline' })).toBeVisible();
  });
});
