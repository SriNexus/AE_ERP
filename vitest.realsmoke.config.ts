import { defineConfig } from 'vitest/config';
// Face Attendance + DeepFace Master Plan, Phase 5 — dedicated config for the
// REAL DeepFaceProvider integration smoke test, mirroring this repo's own
// established `vitest.emulator.config.ts` precedent (a suite that needs a
// real running external dependency gets its own config, never the default
// `include` glob, so it is never picked up by a routine `npm test` run).
// Requires `biometric-service/` running locally first — see that test
// file's own doc comment for the exact startup command.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    include: ['api/_lib/biometrics/providers/__tests__/deepFaceProvider.realSmoke.manual.ts'],
  },
});
