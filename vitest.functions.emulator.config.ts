import { defineConfig } from 'vitest/config';
// Face Attendance + DeepFace Master Plan, Phase 11 — dedicated config for
// functions/'s real-runtime Cloud Function test, mirroring this repo's own
// established vitest.emulator.config.ts precedent (its own include list,
// its own generous hookTimeout for the documented slow emulator cold-start
// in this sandboxed environment). Run via `npm run test:functions:emulator`,
// which wraps this in `firebase emulators:exec --only firestore,auth`.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 90000,
    include: ['functions/**/*.emulator.test.ts'],
  },
});
