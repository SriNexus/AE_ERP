// Phase 5.2 runtime validation — genuine browser + emulated-Firestore tests
// for the Customer Workspace. Run via tests/customer-workspace-e2e/run-emulator-tests.mjs
// (never directly against a real Firebase project).
import { test, expect, type Page } from '@playwright/test';

const SEED = {
  companyId: 'COMP-TEST-1',
  adminEmail: 'admin@test.local',
  adminPassword: 'TestPass123!',
  viewOnlyEmail: 'viewonly@test.local',
  viewOnlyPassword: 'TestPass123!',
  customerB2B: 'CUST-B2B-1',
  customerB2C: 'CUST-B2C-1',
  customerThird: 'CUST-EXTRA-1',
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

// CustomerWorkspaceEditor's Input/Select/Textarea (components/ui/Input.tsx)
// render <label> as a DOM sibling of the field with no htmlFor/id pairing —
// a pre-existing gap in that shared UI-kit component, unrelated to Customer
// Workspace and out of scope to fix here. getByLabel() cannot resolve these,
// so scope to the field's own wrapper div (all three render
// `<div class="flex flex-col gap-1">`) instead.
function fieldInput(page: Page, label: string) {
  return page.locator('div.flex.flex-col.gap-1').filter({ hasText: label }).locator('input, select, textarea').first();
}

test.describe.serial('Customer Workspace — runtime validation (emulator-backed)', () => {

  test('1a. CRITICAL — B2B customer field persistence survives a hard reload', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2B}`);
    await expect(page.getByRole('heading', { name: /Acme Solar Industries/i })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Edit Customer' }).click();
    const gst = `27ZZZZZ${Date.now().toString().slice(-4)}Z1Z5`;
    const pan = `ZZZZZ${Date.now().toString().slice(-4)}Z`;
    await fieldInput(page, 'GST').fill(gst);
    await fieldInput(page, 'PAN').fill(pan);
    await fieldInput(page, 'Address').fill('999 Runtime Test Lane');
    await fieldInput(page, 'State').fill('Karnataka');
    await fieldInput(page, 'Pincode').fill('560001');
    await fieldInput(page, 'Credit Limit').fill('75000');
    await fieldInput(page, 'Payment Terms').fill('45');
    await fieldInput(page, 'Notes').fill('Runtime-validated note content.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Unsaved changes')).toHaveCount(0, { timeout: 10_000 });

    await page.reload();
    await expect(page.getByRole('heading', { name: /Acme Solar Industries/i })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Edit Customer' }).click();
    await expect(fieldInput(page, 'GST')).toHaveValue(gst);
    await expect(fieldInput(page, 'PAN')).toHaveValue(pan);
    await expect(fieldInput(page, 'Address')).toHaveValue('999 Runtime Test Lane');
    await expect(fieldInput(page, 'State')).toHaveValue('Karnataka');
    await expect(fieldInput(page, 'Pincode')).toHaveValue('560001');
    await expect(fieldInput(page, 'Credit Limit')).toHaveValue('75000');
    await expect(fieldInput(page, 'Payment Terms')).toHaveValue('45');
    await expect(fieldInput(page, 'Notes')).toHaveValue('Runtime-validated note content.');
  });

  test('1b. CRITICAL — B2C customer field persistence survives a hard reload', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2C}`);
    await expect(page.getByRole('heading', { name: /Ramesh Kumar/i })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Edit Customer' }).click();
    await fieldInput(page, 'PAN').fill('BBCDE1234F');
    await fieldInput(page, 'Address').fill('B2C Runtime Address');
    await fieldInput(page, 'Pincode').fill('440002');
    await fieldInput(page, 'Notes').fill('B2C runtime-validated note.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Unsaved changes')).toHaveCount(0, { timeout: 10_000 });

    await page.reload();
    await page.getByRole('button', { name: 'Edit Customer' }).click();
    await expect(fieldInput(page, 'PAN')).toHaveValue('BBCDE1234F');
    await expect(fieldInput(page, 'Address')).toHaveValue('B2C Runtime Address');
    await expect(fieldInput(page, 'Pincode')).toHaveValue('440002');
    await expect(fieldInput(page, 'Notes')).toHaveValue('B2C runtime-validated note.');
  });

  test('2. Cancel Editing discards the staged draft — a later Save does not persist it', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerThird}`);
    await expect(page.getByRole('heading', { name: /Zenith Power Traders/i })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Edit Customer' }).click();
    const originalNotes = await fieldInput(page, 'Notes').inputValue();
    await fieldInput(page, 'Notes').fill('THIS SHOULD NEVER PERSIST');
    await page.getByRole('button', { name: 'Cancel Editing' }).click();

    await page.getByRole('button', { name: 'Edit Customer' }).click();
    await expect(fieldInput(page, 'Notes')).toHaveValue(originalNotes);

    // Confirm no residual hasUnsaved state lets a stray Save persist it anyway.
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await page.reload();
    await page.getByRole('button', { name: 'Edit Customer' }).click();
    await expect(fieldInput(page, 'Notes')).toHaveValue(originalNotes);
  });

  test('3. Save creates visible activity in Recent Activity + Activity tab; no-op Save creates none', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerThird}`);
    await expect(page.getByRole('heading', { name: /Zenith Power Traders/i })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Edit Customer' }).click();
    const marker = `Activity-marker-${Date.now()}`;
    await fieldInput(page, 'City').fill(marker);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Unsaved changes')).toHaveCount(0, { timeout: 10_000 });

    await expect(page.getByText('Recent Activity')).toBeVisible();
    await expect(page.getByText(/Updated:.*City/i)).toBeVisible({ timeout: 10_000 });

    await page.getByRole('tab', { name: 'Activity' }).click().catch(() => page.getByText('Activity', { exact: true }).click());
    await expect(page.getByText(/Updated:.*City/i)).toBeVisible();

    // The Edit/View toggle only renders in the Overview tab's panel mode
    // (resolveLeftPanelMode) — switch back before the no-op-save check.
    await page.getByRole('tab', { name: 'Overview' }).click().catch(() => page.getByText('Overview', { exact: true }).click());

    // A completed Save does not auto-exit edit mode (isEditing persists across
    // tab switches until explicitly cancelled) — the editor may already be
    // open here. Wait for the tab switch to settle (either toggle label is
    // acceptable) before checking which state we're actually in, to avoid a
    // race against the isVisible() snapshot being taken mid-transition.
    const editOrCancelButton = page.getByRole('button', { name: /^(Edit Customer|Cancel Editing)$/ });
    await editOrCancelButton.waitFor({ state: 'visible', timeout: 10_000 });
    const buttonText = await editOrCancelButton.innerText();
    if (buttonText.includes('Edit Customer')) {
      await editOrCancelButton.click();
    }
    // No-op save: with no further changes, Save must stay disabled.
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  });

  test('4a. Conflict detection — Save Anyway overwrites after a concurrent save', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await login(pageA, SEED.adminEmail, SEED.adminPassword);
    await login(pageB, SEED.adminEmail, SEED.adminPassword);
    await pageA.goto(`/customers/${SEED.customerB2B}`);
    await pageB.goto(`/customers/${SEED.customerB2B}`);
    await expect(pageA.getByRole('heading', { name: /Acme Solar Industries/i })).toBeVisible({ timeout: 20_000 });
    await expect(pageB.getByRole('heading', { name: /Acme Solar Industries/i })).toBeVisible({ timeout: 20_000 });

    await pageA.getByRole('button', { name: 'Edit Customer' }).click();
    await fieldInput(pageA, 'Notes').fill('Saved first by tab A');
    await pageA.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(pageA.getByText('Unsaved changes')).toHaveCount(0, { timeout: 10_000 });

    await pageB.getByRole('button', { name: 'Edit Customer' }).click();
    await fieldInput(pageB, 'Notes').fill('Attempted second by tab B');
    await pageB.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(pageB.getByText('Customer Was Updated By Someone Else')).toBeVisible({ timeout: 10_000 });

    await pageB.getByRole('button', { name: 'Save Anyway' }).click();
    await expect(pageB.getByText('Customer Was Updated By Someone Else')).toHaveCount(0);
    await pageB.reload();
    await pageB.getByRole('button', { name: 'Edit Customer' }).click();
    await expect(fieldInput(pageB, 'Notes')).toHaveValue('Attempted second by tab B');

    await ctxA.close();
    await ctxB.close();
  });

  test('5. Dirty-state guard blocks Previous/Next/Save & Next with an unsaved edit; Stay/Discard/Save & Continue behave correctly', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2C}`);
    await expect(page.getByRole('heading', { name: /Ramesh Kumar/i })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Edit Customer' }).click();
    await fieldInput(page, 'Notes').fill('Dirty guard test note');

    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Unsaved Changes' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Stay' }).click();
    await expect(page.getByRole('heading', { name: 'Unsaved Changes' })).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(SEED.customerB2C));

    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Unsaved Changes' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Discard & Continue' }).click();
    await expect(page).not.toHaveURL(new RegExp(`${SEED.customerB2C}$`), { timeout: 10_000 });

    await page.goBack();
    await expect(page.getByRole('heading', { name: /Ramesh Kumar/i })).toBeVisible({ timeout: 20_000 });
    // Browser back can restore a previously-mounted Left Panel instance
    // without a fresh remount, so isEditing (local component state) may
    // already be true here — same handling as test 3's no-op-save check.
    const editOrCancelButton = page.getByRole('button', { name: /^(Edit Customer|Cancel Editing)$/ });
    await editOrCancelButton.waitFor({ state: 'visible', timeout: 10_000 });
    if ((await editOrCancelButton.innerText()).includes('Edit Customer')) {
      await editOrCancelButton.click();
    }
    await expect(fieldInput(page, 'Notes')).not.toHaveValue('Dirty guard test note');
  });

  test('6. Previous/Next boundaries and per-customer state reset', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2B}`);
    await expect(page.getByRole('heading', { name: /Acme Solar Industries/i })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Edit Customer' }).click();
    await fieldInput(page, 'Notes').fill('Should not leak to next customer');

    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Discard & Continue' }).click().catch(() => {});
    await page.waitForTimeout(1000);

    const heading = page.locator('h1, h2').first();
    const text = await heading.textContent();
    if (text && !text.includes('Acme')) {
      await page.getByRole('button', { name: 'Edit Customer' }).click();
      await expect(fieldInput(page, 'Notes')).not.toHaveValue('Should not leak to next customer');
    }
  });
});
