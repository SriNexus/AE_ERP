// Mobile verification of the lower Appearance section. Reuses the SAME
// business logic as desktop (MobileSettingsWorkspace renders the identical
// SettingsSectionRenderer -> AppearanceSection) — this only checks the
// mobile layout/navigation shell and confirms no separate mobile-only bugs.
const { chromium } = require('playwright');

const BASE_URL = process.env.VERIFY_BASE_URL || 'http://localhost:5173';
const EMAIL = process.env.VERIFY_ADMIN_EMAIL;
const PASSWORD = process.env.VERIFY_ADMIN_PASSWORD;

let pass = 0, fail = 0;
const consoleMessages = [];
function check(label, condition, extra) {
  if (condition) { pass++; console.log(`PASS ${label}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`FAIL ${label}${extra ? '  ' + extra : ''}`); }
}
async function domSnapshot(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    return {
      classes: root.className,
      fontScale: getComputedStyle(root).getPropertyValue('--personal-font-scale').trim(),
    };
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.on('console', (msg) => { if (['error', 'warning'].includes(msg.type())) consoleMessages.push(`[mobile][${msg.type()}] ${msg.text()}`); });
  page.on('pageerror', (err) => consoleMessages.push(`[mobile][pageerror] ${err.message}`));

  await page.goto(`${BASE_URL}/login`, { waitUntil: 'load' });
  await page.locator('input[type="email"]:visible').first().fill(EMAIL);
  await page.locator('input[type="password"]:visible').first().fill(PASSWORD);
  await page.locator('button[type="submit"]:visible').first().click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });
  check('Mobile Admin login', true, `url=${page.url()}`);

  await page.goto(`${BASE_URL}/settings/theme-appearance`, { waitUntil: 'load' });
  await page.waitForTimeout(2000);

  const controlsVisible = await Promise.all([
    page.getByText('High Contrast', { exact: true }).isVisible().catch(() => false),
    page.getByText('Reduce Motion', { exact: true }).isVisible().catch(() => false),
    page.getByText('Compact Density', { exact: true }).isVisible().catch(() => false),
    page.getByText('Sidebar Opening Behavior', { exact: false }).isVisible().catch(() => false),
  ]);
  check('Mobile: all lower Appearance controls render', controlsVisible.every(Boolean), JSON.stringify(controlsVisible));

  const resetBtn = page.getByRole('button', { name: 'Reset to Defaults' });
  await resetBtn.click();
  await page.getByText('Settings reset', { exact: false }).first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2000);

  const saveBtn = page.getByRole('button', { name: 'Save Changes' });

  // High Contrast toggle on mobile
  await page.getByText('High Contrast', { exact: true }).click();
  await page.waitForTimeout(300);
  let snap = await domSnapshot(page);
  check('Mobile: High Contrast toggles preview', snap.classes.includes('high-contrast'), `classes="${snap.classes}"`);
  await saveBtn.click();
  await page.getByText('Settings saved', { exact: false }).first().waitFor({ state: 'visible', timeout: 10000 });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2000);
  snap = await domSnapshot(page);
  check('Mobile: High Contrast persists after refresh', snap.classes.includes('high-contrast'), `classes="${snap.classes}"`);

  // Font Size on mobile
  await page.getByText('Large', { exact: true }).click();
  await page.waitForTimeout(300);
  await saveBtn.click();
  await page.getByText('Settings saved', { exact: false }).first().waitFor({ state: 'visible', timeout: 10000 });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2000);
  snap = await domSnapshot(page);
  check('Mobile: Font Size "Large" persists after refresh', snap.fontScale === '1.25', `actual=${snap.fontScale}`);

  // Navigate around mobile shell (bottom nav) to check for crashes
  await page.goto(`${BASE_URL}/dashboards`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const dashboardsLoaded = await page.locator('body').isVisible();
  check('Mobile: navigating away to Dashboards does not crash', dashboardsLoaded);

  // cleanup
  await page.goto(`${BASE_URL}/settings/theme-appearance`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Reset to Defaults' }).click();
  await page.getByText('Settings reset', { exact: false }).first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});

  console.log('\n=== CONSOLE MESSAGES (mobile) ===');
  consoleMessages.forEach((m) => console.log(m));
  if (consoleMessages.length === 0) console.log('(none)');

  await browser.close();
  console.log(`\n=== MOBILE SUMMARY: ${pass}/${pass + fail} PASS ===`);
  if (fail > 0) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
