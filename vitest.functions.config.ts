import { defineConfig } from 'vitest/config';
// Face Attendance + DeepFace Master Plan, Phase 9 — dedicated config for
// functions/'s own pure-logic tests, mirroring this repo's own established
// vitest.api.config.ts precedent (a separate tree from src/, needing its
// own `include` glob rather than the default src/**/*.test.ts).
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 15000,
    include: ['functions/**/*.test.ts'],
    // Phase 11: the real Cloud Function runtime test needs the Firestore +
    // Auth emulators running (see vitest.functions.emulator.config.ts /
    // `npm run test:functions:emulator`) — excluded here so a plain run of
    // this config (no emulator) doesn't hang/fail trying to reach them.
    exclude: ['functions/**/*.emulator.test.ts'],
  },
});
