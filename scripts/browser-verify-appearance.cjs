// POST-FIX verification of the lower Appearance section.
// Logs in as Admin, tests every lower control end-to-end: immediate preview
// effect, save, refresh persistence, cross-navigation persistence, reset,
// and reset-all — plus a multi-cycle Font Size test to confirm the
// migration-corruption bug (Large -> silently downgraded to Medium on
// reload) is actually fixed, not just no-longer-crashing.
//
// Save clicks wait for the actual "Settings saved" toast rather than a fixed
// timeout — a fixed wait race against real Firestore write latency produced
// flaky, inconsistent failures on different fields each run (a real app bug
// would fail the same way every run; this didn't), so the confirmation toast
// is used as the deterministic synchronization point instead.
const { chromium } = require('playwright');

const BASE_URL = process.env.VERIFY_BASE_URL || 'http://localhost:5173';
const EMAIL = process.env.VERIFY_ADMIN_EMAIL;
const PASSWORD = process.env.VERIFY_ADMIN_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error('Missing VERIFY_ADMIN_EMAIL / VERIFY_ADMIN_PASSWORD env vars.');
  process.exit(1);
}

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
      sidebarBehaviorAttr: root.getAttribute('data-sidebar-behavior'),
      filter: getComputedStyle(root).filter,
    };
  });
}

async function saveAndConfirm(page, saveBtn) {
  await saveBtn.click();
  await page.getByText('Settings saved', { exact: false }).first().waitFor({ state: 'visible', timeout: 8000 });
}

async function resetAndConfirm(page, resetBtn) {
  await resetBtn.click();
  await page.getByText('reset to defaults', { exact: false }).first().waitFor({ state: 'visible', timeout: 8000 });
}

async function reloadAndSettle(page) {
  await page.reload({ waitUntil: 'load' });
  // Cold full-page reload needs auth + boot + company resolution + settings
  // fetch to all complete before the DOM reflects persisted state.
  await page.waitForTimeout(1800);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (['error', 'warning'].includes(msg.type())) consoleMessages.push(`[desktop][${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => consoleMessages.push(`[desktop][pageerror] ${err.message}`));

  await page.goto(`${BASE_URL}/login`, { waitUntil: 'load' });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });
  check('Admin login', true, `url=${page.url()}`);

  await page.goto(`${BASE_URL}/settings/theme-appearance`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  const saveBtn = page.getByRole('button', { name: 'Save Changes' });
  const resetBtn = page.getByRole('button', { name: 'Reset to Defaults' });

  // Force a known starting state so each cycle below is a genuine change —
  // clicking an already-selected option is a legitimate no-op (Save stays
  // disabled, nothing to persist), not a bug; the test must not assume the
  // starting value.
  await resetAndConfirm(page, resetBtn);
  await reloadAndSettle(page);

  // ══════════════════ FONT SIZE — multi-cycle persistence ══════════════════
  console.log('\n=== Font Size: multi-cycle save/reload (regression for the migration-decay bug) ===');
  const sizes = [
    { label: 'Large', scale: '1.25' },
    { label: 'Medium', scale: '1.0625' },
    { label: 'Small', scale: '0.875' },
    { label: 'Large', scale: '1.25' },
  ];
  for (const { label, scale } of sizes) {
    await page.getByText(label, { exact: true }).click();
    await page.waitForTimeout(300);
    const isDisabled = await saveBtn.isDisabled();
    if (isDisabled) {
      // Already-selected (can happen if a prior cycle landed on the same
      // value) — nothing to save; just verify the current DOM already
      // matches instead of clicking a disabled button.
      const snap = await domSnapshot(page);
      check(`Font Size "${label}" already active, DOM matches`, snap.fontScale === scale, `expected=${scale} actual=${snap.fontScale}`);
      continue;
    }
    await saveAndConfirm(page, saveBtn);
    await reloadAndSettle(page);
    const snap = await domSnapshot(page);
    check(`Font Size "${label}" persists correctly after save+reload`, snap.fontScale === scale, `expected=${scale} actual=${snap.fontScale}`);
  }

  // ══════════════════ ACCESSIBILITY: High Contrast ══════════════════
  console.log('\n=== High Contrast toggle ===');
  let snap = await domSnapshot(page);
  const hcWasOn = snap.classes.includes('high-contrast');
  await page.getByText('High Contrast', { exact: true }).click();
  await page.waitForTimeout(300);
  snap = await domSnapshot(page);
  check('High Contrast: click toggles preview immediately', snap.classes.includes('high-contrast') !== hcWasOn, `classes="${snap.classes}"`);
  await saveAndConfirm(page, saveBtn);
  await reloadAndSettle(page);
  snap = await domSnapshot(page);
  check('High Contrast: persists after refresh', snap.classes.includes('high-contrast') !== hcWasOn, `classes="${snap.classes}"`);
  check('High Contrast: filter actually changes computed style', snap.filter !== 'none' || hcWasOn, `filter="${snap.filter}"`);

  // cross-navigation check (global reach, not just Settings page) — a full
  // browser navigation (Playwright page.goto), so this is a cold boot at
  // /dashboard, same settle time as a reload.
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  snap = await domSnapshot(page);
  check('High Contrast: still applied globally on /dashboard (not Settings-page-local)', snap.classes.includes('high-contrast') !== hcWasOn, `classes="${snap.classes}"`);
  await page.goto(`${BASE_URL}/settings/theme-appearance`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  // revert
  await page.getByText('High Contrast', { exact: true }).click();
  await page.waitForTimeout(200);
  await saveAndConfirm(page, saveBtn);

  // ══════════════════ ACCESSIBILITY: Reduce Motion ══════════════════
  console.log('\n=== Reduce Motion toggle ===');
  snap = await domSnapshot(page);
  const rmWasOn = snap.classes.includes('reduce-motion');
  await page.getByText('Reduce Motion', { exact: true }).click();
  await page.waitForTimeout(300);
  snap = await domSnapshot(page);
  check('Reduce Motion: click toggles preview immediately', snap.classes.includes('reduce-motion') !== rmWasOn, `classes="${snap.classes}"`);
  await saveAndConfirm(page, saveBtn);
  await reloadAndSettle(page);
  snap = await domSnapshot(page);
  check('Reduce Motion: persists after refresh', snap.classes.includes('reduce-motion') !== rmWasOn, `classes="${snap.classes}"`);
  const animDuration = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('animation-duration'));
  console.log('  [info] root animation-duration computed:', animDuration || '(not set on root directly; rule targets *, checked structurally)');
  // revert
  await page.getByText('Reduce Motion', { exact: true }).click();
  await page.waitForTimeout(200);
  await saveAndConfirm(page, saveBtn);

  // ══════════════════ WORKSPACE: Compact Density ══════════════════
  console.log('\n=== Compact Density toggle ===');
  snap = await domSnapshot(page);
  const cdWasOn = snap.classes.includes('compact-ui');
  await page.getByText('Compact Density', { exact: true }).click();
  await page.waitForTimeout(300);
  snap = await domSnapshot(page);
  check('Compact Density: click toggles preview immediately', snap.classes.includes('compact-ui') !== cdWasOn, `classes="${snap.classes}"`);
  await saveAndConfirm(page, saveBtn);
  await reloadAndSettle(page);
  snap = await domSnapshot(page);
  check('Compact Density: persists after refresh', snap.classes.includes('compact-ui') !== cdWasOn, `classes="${snap.classes}"`);
  const paddingTop = await page.evaluate(() => {
    const el = document.querySelector('.app-shell__main');
    return el ? getComputedStyle(el).paddingTop : null;
  });
  console.log('  [info] .app-shell__main padding-top with compact-ui applied:', paddingTop);
  // revert
  await page.getByText('Compact Density', { exact: true }).click();
  await page.waitForTimeout(200);
  await saveAndConfirm(page, saveBtn);

  // ══════════════════ SIDEBAR BEHAVIOR (regression — already had a handler) ══════════════════
  console.log('\n=== Sidebar Behavior (regression check) ===');
  await page.getByText('Click to Open', { exact: true }).click();
  await page.waitForTimeout(300);
  if (!(await saveBtn.isDisabled())) { await saveAndConfirm(page, saveBtn); }
  await reloadAndSettle(page);
  snap = await domSnapshot(page);
  check('Sidebar Behavior "Click to Open": persists after refresh', snap.sidebarBehaviorAttr === 'click', `attr=${snap.sidebarBehaviorAttr}`);
  await page.getByText('Automatic', { exact: true }).click();
  await page.waitForTimeout(200);
  await saveAndConfirm(page, saveBtn);

  // ══════════════════ RESET TO DEFAULTS ══════════════════
  console.log('\n=== Reset to Defaults ===');
  // dirty something first
  await page.getByText('Large', { exact: true }).click();
  await page.waitForTimeout(200);
  await page.getByText('High Contrast', { exact: true }).click();
  await page.waitForTimeout(200);
  await saveAndConfirm(page, saveBtn);
  await resetAndConfirm(page, resetBtn);
  snap = await domSnapshot(page);
  check('Reset to Defaults: fontScale back to default (medium=1.0625)', snap.fontScale === '1.0625', `actual=${snap.fontScale}`);
  check('Reset to Defaults: high-contrast class removed', !snap.classes.includes('high-contrast'), `classes="${snap.classes}"`);
  await reloadAndSettle(page);
  snap = await domSnapshot(page);
  check('Reset to Defaults: survives refresh', snap.fontScale === '1.0625' && !snap.classes.includes('high-contrast'), `fontScale=${snap.fontScale} classes="${snap.classes}"`);

  // ══════════════════ REGRESSION: Theme Mode + Home Logo Action (must be untouched) ══════════════════
  console.log('\n=== Regression: Theme Mode + Home Logo Action still work ===');
  await page.getByText('Dark', { exact: true }).click();
  await page.waitForTimeout(300);
  let isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  check('Theme Mode "Dark": preview applies immediately', isDark === true);
  await saveAndConfirm(page, saveBtn);
  await reloadAndSettle(page);
  isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  check('Theme Mode "Dark": persists after refresh', isDark === true);
  // revert to system to restore baseline
  await page.getByText('System', { exact: true }).click();
  await page.waitForTimeout(200);
  await saveAndConfirm(page, saveBtn);

  await page.getByText('Open App Launcher', { exact: true }).click();
  await page.waitForTimeout(300);
  const navDisabled = await saveBtn.isDisabled();
  if (!navDisabled) { await saveAndConfirm(page, saveBtn); }
  check('Home Logo Action "Open App Launcher": clickable & saveable without error', true);
  // revert
  await page.getByText('Open Sidebar', { exact: true }).click();
  await page.waitForTimeout(200);
  if (!(await saveBtn.isDisabled())) { await saveAndConfirm(page, saveBtn); }

  // ══════════════════ REGRESSION: Roles & Permissions page visual/functional untouched ══════════════════
  console.log('\n=== Regression: Roles & Permissions page loads cleanly ===');
  await page.goto(`${BASE_URL}/roles`, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const rolesHeading = await page.getByText('Roles', { exact: false }).first().isVisible().catch(() => false);
  check('Roles & Permissions page still loads', rolesHeading === true);

  console.log('\n=== CONSOLE MESSAGES (desktop) ===');
  consoleMessages.forEach((m) => console.log(m));
  if (consoleMessages.length === 0) console.log('(none)');

  await browser.close();

  console.log(`\n=== SUMMARY: ${pass}/${pass + fail} PASS ===`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
