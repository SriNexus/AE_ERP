// Central Panel Refinement & B2B/B2C Workflow Implementation mission —
// genuine browser + emulated-Firestore runtime check. Run via
// node tests/customer-workspace-e2e/run-emulator-tests.mjs.
import { test, expect, type Page } from '@playwright/test';

const SEED = {
  adminEmail: 'admin@test.local',
  adminPassword: 'TestPass123!',
  customerB2B: 'CUST-B2B-1',
  customerB2C: 'CUST-B2C-1',
  customerB2CWithProject: 'CUST-B2C-PROJECT-1',
  customerThird: 'CUST-EXTRA-1',
};

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
  await page.locator('#login-email:visible').fill(email);
  await page.locator('#login-password:visible').fill(password);
  await page.locator('button[type="submit"]:visible').click();
  await expect(page).not.toHaveURL(/login/, { timeout: 20_000 });
}

// components/ui/Input.tsx's Input/Select/Textarea render <label> as a DOM
// sibling with no htmlFor/id pairing, so getByLabel() can't resolve them —
// same established workaround as the other emulator specs in this suite:
// scope to the field's own wrapper div instead.
function fieldControl(scope: Page | import('@playwright/test').Locator, label: string) {
  return scope.locator('div.flex.flex-col.gap-1').filter({ hasText: label }).locator('input, select, textarea').first();
}

test.describe.serial('Central Panel Refinement — B2B/B2C (emulator-backed)', () => {
  test('1. Orders tab shows the Financial Summary KPIs + order history (moved out of Overview)', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2B}`);
    await expect(page.getByRole('heading', { name: /Acme Solar Industries/i })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('tab', { name: 'Orders' }).click();
    await expect(page.getByText('Lifetime Value')).toBeVisible();
    await expect(page.getByText('Order History (Last')).toBeVisible();
    await expect(page.getByText('ORD-0003')).toBeVisible();

    // Overview tab itself no longer shows Financial Summary.
    await page.getByRole('tab', { name: 'Overview' }).click();
    await expect(page.getByText('Financial Summary')).toHaveCount(0);
  });

  test('2. Activity tab shows Timeline & Activity KPIs above the activity log', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2B}`);
    await expect(page.getByRole('heading', { name: /Acme Solar Industries/i })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('tab', { name: 'Activity' }).click();
    await expect(page.getByText('Timeline & Activity')).toBeVisible();
    await expect(page.getByText('Created At')).toBeVisible();
  });

  test('3. Linked Records tab shows the Related Records quick-nav above the linked-records content', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2B}`);
    await expect(page.getByRole('heading', { name: /Acme Solar Industries/i })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('tab', { name: 'Linked Records' }).click();
    await expect(page.getByText('Related Records')).toBeVisible();
    await expect(page.getByText(/Quotations →|View Quotations/).first()).toBeVisible();
  });

  test('4. B2B pipeline shows all 5 stages; the Invoice stage is order-specific — Acme\'s LATEST order (ORD-0002) has no invoice yet, so Generate Invoice is active and View Latest falls back to ORD-0001\'s INV-0001, not a misleading "already invoiced" state', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2B}`);
    await expect(page.getByRole('heading', { name: /Acme Solar Industries/i })).toBeVisible({ timeout: 20_000 });

    for (const stage of ['Quotation', 'Order', 'Invoice', 'Payment', 'Dispatch']) {
      await expect(page.getByText(stage, { exact: true })).toBeVisible();
    }
    // "ORD-0002" legitimately appears twice (Order stage's own summary, and
    // the Invoice stage's "Order ORD-0002 has no invoice yet" message) — use
    // .first() rather than a bare getByText, which would hit a strict-mode
    // violation on 2 matches.
    await expect(page.getByText('ORD-0002').first()).toBeVisible();
    // DSP-0001 belongs to the OLDER order (ORD-0001), not the latest — the
    // Dispatch stage is order-specific too (see test 5), so it must not
    // appear here as if it were the current order's dispatch.
    await expect(page.getByText('DSP-0001')).toHaveCount(0);

    // Walk up from the exact "Invoice" label to its own stage card (label ->
    // icon+label row -> header row -> card, 3 levels) rather than a
    // has()+filter() combo, which can ambiguously match several nested
    // ancestor divs that all happen to contain both texts.
    const invoiceCard = page.getByText('Invoice', { exact: true }).locator('../../..');
    await expect(invoiceCard.getByText('ORD-0002')).toBeVisible();
    // Final UX Parity mission: both actions ALWAYS render — Generate
    // Invoice is active (an order exists with no invoice yet).
    await expect(invoiceCard.getByRole('button', { name: 'Generate Invoice' })).toBeEnabled();

    // View Latest is also active — it falls back to the previous (OLDER,
    // already-invoiced) order's invoice since the current order has none —
    // "previous orders/invoices remain accessible", never a dead click.
    const invoiceViewLatest = invoiceCard.getByRole('button', { name: 'View Latest' });
    await expect(invoiceViewLatest).toBeEnabled();
    await invoiceViewLatest.click();
    await expect(page).toHaveURL(/\/invoices\/INV-SEED-1/);
    await expect(page.getByText('INV-0001').first()).toBeVisible({ timeout: 15_000 });
  });

  test('4b. Generate Invoice creates a real invoice for the specific latest order (reusing generatePIsFromOrder — the same function Orders.tsx\'s own Generate PI button calls), and the stage updates so View Latest opens it — no duplicate popup, no second invoice implementation', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2B}`);
    await expect(page.getByRole('heading', { name: /Acme Solar Industries/i })).toBeVisible({ timeout: 20_000 });

    const invoiceCard = page.getByText('Invoice', { exact: true }).locator('../../..');
    await invoiceCard.getByRole('button', { name: 'Generate Invoice' }).click();
    await expect(page.getByText(/PI generated|Generated PI/i)).toBeVisible({ timeout: 15_000 });

    // The button stays visible (never omitted) but becomes INACTIVE — this
    // specific order already has its invoice, so generating another would
    // be wrong; View Latest becomes active and now targets THIS order's
    // own new invoice, not the fallback previous one.
    await expect(invoiceCard.getByRole('button', { name: 'Generate Invoice' })).toBeDisabled({ timeout: 15_000 });
    const viewButton = invoiceCard.getByRole('button', { name: 'View Latest' });
    await expect(viewButton).toBeEnabled();
    await viewButton.click();
    await expect(page).toHaveURL(/\/invoices\/[^/]+$/);
    await expect(page).not.toHaveURL(/\/invoices\/INV-SEED-1/);
    // Real Invoice Workspace loaded — not a blank/error page.
    await expect(page.getByText(/Draft|Pending/).first()).toBeVisible({ timeout: 15_000 });
  });

  test('5. B2B Dispatch stage is order-specific — Acme\'s LATEST order (ORD-0002) has no dispatch yet, so it shows Action Needed with an active Request Dispatch (repeat business), while View Latest falls back to the previous order\'s dispatch (DSP-0001); can submit a new dispatch request with vehicle/driver details', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2B}`);
    await expect(page.getByRole('heading', { name: /Acme Solar Industries/i })).toBeVisible({ timeout: 20_000 });

    const dispatchCard = page.getByText('Dispatch', { exact: true }).locator('../../..');
    await expect(dispatchCard.getByText('Action Needed')).toBeVisible();
    await expect(dispatchCard.getByRole('button', { name: 'Request Dispatch' })).toBeEnabled();

    // DSP-0001 belongs to the OLDER order, not ORD-0002 — it must not be
    // shown as if it were the current order's dispatch, but View Latest
    // still reaches it as the fallback.
    await dispatchCard.getByRole('button', { name: 'View Latest' }).click();
    await expect(page).toHaveURL(/\/dispatch\/DISPATCH-SEED-1/);
    await expect(page.getByText('Ramesh Driver').first()).toBeVisible({ timeout: 15_000 });
    await page.goBack();
    await expect(page.getByRole('heading', { name: /Acme Solar Industries/i })).toBeVisible({ timeout: 20_000 });

    // Request Dispatch stays available even though this customer already
    // has an existing (older-order) dispatch — B2B is a repeat-business
    // relationship, not a one-shot pipeline.
    await dispatchCard.getByRole('button', { name: 'Request Dispatch' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Request Dispatch')).toBeVisible();

    await fieldControl(dialog, 'Select Order').selectOption({ label: 'ORDER-DISPATCH-TEST-1 - Acme Solar Industries' });
    await fieldControl(dialog, 'From Warehouse').selectOption({ label: 'Main Warehouse' });
    await fieldControl(dialog, 'Vehicle No').fill('MH14XY9999');
    await fieldControl(dialog, 'Driver Name').fill('Suresh Driver');
    await fieldControl(dialog, 'Driver Phone').fill('9888800000');

    await dialog.getByRole('button', { name: 'Submit Request' }).click();
    await expect(page.getByText('Dispatch request submitted')).toBeVisible({ timeout: 10_000 });
  });

  test('5b. First-time B2B customer (zero history) — Final UX Parity + B2B Production Readiness mission: the complete 5-stage workflow stays visible; Quotation/Order are active (always creatable), Invoice/Payment/Dispatch show "Not Available Yet" with BOTH actions visible but inactive, never hidden', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    // Zenith Power Traders (CUST-EXTRA-1) is a genuine B2B customer with no
    // quotation/order/invoice/payment/dispatch history anywhere in the seed.
    await page.goto(`/customers/${SEED.customerThird}`);
    await expect(page.getByRole('heading', { name: /Zenith Power Traders/i })).toBeVisible({ timeout: 20_000 });

    for (const stage of ['Quotation', 'Order', 'Invoice', 'Payment', 'Dispatch']) {
      await expect(page.getByText(stage, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('Not Started')).toHaveCount(2); // Quotation, Order
    await expect(page.getByText('Not Available Yet')).toHaveCount(3); // Invoice, Payment, Dispatch

    const quotationCard = page.getByText('Quotation', { exact: true }).locator('../../..');
    await expect(quotationCard.getByRole('button', { name: 'Create Quotation' })).toBeEnabled();
    await expect(quotationCard.getByRole('button', { name: 'View Latest' })).toBeDisabled();

    const orderCard = page.getByText('Order', { exact: true }).locator('../../..');
    await expect(orderCard.getByRole('button', { name: 'Create Order' })).toBeEnabled();
    await expect(orderCard.getByRole('button', { name: 'View Latest' })).toBeDisabled();

    // The three blocked stages: both actions render (never omitted) and are
    // both disabled — a real, honest "not yet available" state, not a dead
    // or missing button.
    for (const [stageLabel, actionLabel] of [
      ['Invoice', 'Generate Invoice'],
      ['Payment', 'Record Payment'],
      ['Dispatch', 'Request Dispatch'],
    ] as const) {
      const card = page.getByText(stageLabel, { exact: true }).locator('../../..');
      await expect(card.getByRole('button', { name: actionLabel })).toBeVisible();
      await expect(card.getByRole('button', { name: actionLabel })).toBeDisabled();
      await expect(card.getByRole('button', { name: 'View Latest' })).toBeVisible();
      await expect(card.getByRole('button', { name: 'View Latest' })).toBeDisabled();
    }
  });

  test('6. B2C without a Project shows an inactive Project Timeline placeholder', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2C}`);
    await expect(page.getByRole('heading', { name: /Ramesh Kumar/i })).toBeVisible({ timeout: 20_000 });

    // Explicit timeout (not the 5s default): this panel renders only after
    // useCustomerBillingContext's projects/loan applications queries resolve,
    // which — like the heading above — can occasionally take longer than
    // 5s against the local emulator on a cold navigation.
    await expect(page.getByText('Project Timeline')).toBeVisible({ timeout: 10_000 });
    // Scoped to the placeholder text alone — the original .or('Not started')
    // was a broken locator: the KPI bar's own "Loan Application Status" tile
    // legitimately shows "Not Started" text too, so the combined locator
    // matched 2 elements and intermittently hit a strict-mode violation on
    // toBeVisible(). Both texts coexisting is correct product behavior; only
    // the test's assertion was wrong.
    await expect(page.getByText(/becomes active once a Project/)).toBeVisible({ timeout: 10_000 });
  });

  test('7. B2C with a Project shows the active, real-stage Project Timeline', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2CWithProject}`);
    await expect(page.getByRole('heading', { name: /Anita Deshmukh/i })).toBeVisible({ timeout: 20_000 });

    await expect(page.getByText('Project Timeline')).toBeVisible();
    await expect(page.getByText('becomes active once a Project')).toHaveCount(0);
    // Installation is the seeded currentStage — its stage card should read "current".
    await expect(page.getByText('Installation').first()).toBeVisible();
  });

  test('8. Payment stage is order-specific — Acme\'s LATEST order (ORD-0002) has no payment yet, so it shows Action Needed (not a misleading "already paid" state) with an active Record Payment action, while View Latest falls back to the previous order\'s payment and navigates to the real Payments workspace', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2B}`);
    await expect(page.getByRole('heading', { name: /Acme Solar Industries/i })).toBeVisible({ timeout: 20_000 });

    const paymentCard = page.getByText('Payment', { exact: true }).locator('../../..');
    await expect(paymentCard.getByText('Action Needed')).toBeVisible();
    await expect(paymentCard.getByRole('button', { name: 'Record Payment' })).toBeEnabled();

    await paymentCard.getByRole('button', { name: 'View Latest' }).click();
    await expect(page).toHaveURL(/\/payments\/PAY-SEED-1/);
  });

  test('8b. Record Payment records a real payment against the specific latest order (reusing useSavePayment — the same hook the real Payments.tsx page uses), and the stage updates so View Latest opens it', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);
    await page.goto(`/customers/${SEED.customerB2B}`);
    await expect(page.getByRole('heading', { name: /Acme Solar Industries/i })).toBeVisible({ timeout: 20_000 });

    const paymentCard = page.getByText('Payment', { exact: true }).locator('../../..');
    await paymentCard.getByRole('button', { name: 'Record Payment' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Record Payment' })).toBeVisible();

    await fieldControl(dialog, 'Amount').fill('72000');
    await dialog.getByRole('button', { name: 'Record Payment', exact: true }).click();
    await expect(page.getByText('Payment recorded')).toBeVisible({ timeout: 10_000 });

    // The card now reflects a real payment for THIS order — no longer "Action Needed".
    await expect(paymentCard.getByText('Action Needed')).toHaveCount(0, { timeout: 15_000 });
    const viewButton = paymentCard.getByRole('button', { name: 'View Latest' });
    await expect(viewButton).toBeEnabled();
    await viewButton.click();
    await expect(page).toHaveURL(/\/payments\/[^/]+$/);
    await expect(page).not.toHaveURL(/\/payments\/PAY-SEED-1/);
  });

  test('9. Active Batch shows only when an order exists within the last 30 days; header no longer shows raw phone/email text', async ({ page }) => {
    await login(page, SEED.adminEmail, SEED.adminPassword);

    // CUST-B2B-1 has ORDER-NEWER-1 dated well within the last 30 days.
    await page.goto(`/customers/${SEED.customerB2B}`);
    await expect(page.getByRole('heading', { name: /Acme Solar Industries/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Active Batch')).toBeVisible({ timeout: 10_000 });

    // 2 levels up from h1 reaches the name/chips container (used for the
    // "no raw text" checks); Call/WhatsApp/Email live in a SIBLING div one
    // level further out (the whole header row), so that check needs 3.
    const identityBlock = page.locator('h1', { hasText: 'Acme Solar Industries' }).locator('../..');
    const fullHeader = page.locator('h1', { hasText: 'Acme Solar Industries' }).locator('../../..');
    await expect(identityBlock.getByText('9876500001')).toHaveCount(0);
    await expect(identityBlock.getByText('acme@example.com')).toHaveCount(0);
    // Call/WhatsApp/Email quick-action buttons stay — only the raw text was removed.
    await expect(fullHeader.getByRole('link', { name: 'Call' })).toBeVisible();
    await expect(fullHeader.getByRole('link', { name: 'WhatsApp' })).toBeVisible();
    await expect(fullHeader.getByRole('link', { name: 'Email' })).toBeVisible();

    // CUST-EXTRA-1 (Zenith) has no recent order — no Active Batch.
    await page.goto(`/customers/${SEED.customerThird}`);
    await expect(page.getByRole('heading', { name: /Zenith Power Traders/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Active Batch')).toHaveCount(0);
  });
});
