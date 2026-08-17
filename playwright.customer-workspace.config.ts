// Phase 5.2 runtime validation — local emulator-backed Customer Workspace E2E.
// Never targets the real ae-erp-d933d project: baseURL is the emulator-mode dev
// server only (see tests/customer-workspace-e2e/run-emulator-tests.mjs).
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/customer-workspace-e2e',
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.CW_E2E_BASE_URL || 'http://127.0.0.1:5199',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
  },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],
});
