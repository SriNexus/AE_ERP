// Phase 8 (Master Plan §17.3) — local emulator-backed Platform/Group flow
// E2E. Never targets the real Firebase project: baseURL is the
// emulator-mode dev server only (see tests/platform-e2e/run-emulator-tests.mjs).
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/platform-e2e',
  testMatch: /.*\.spec\.ts/,
  // 5 min, not the Playwright default — this flow performs 4 platformAdmin.ts
  // mutations, each of which sequentially awaits multiple audit-log writes
  // (see waitForNoModal()'s comment in platformGroupFlow.spec.ts) over real
  // browser<->emulator round-trips, PLUS one documented 30s TanStack Query
  // staleTime wait (shared ['platform-users'] cache, see the Grant Group
  // Admin step's comment). Each contributing wait is individually understood
  // and bounded — this is their worst-case sum, not a blind timeout bump to
  // paper over a hang.
  timeout: 480_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.PLATFORM_E2E_BASE_URL || 'http://127.0.0.1:5299',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
  },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],
});
