import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 20000,
    // Audit §54A Task 7: this sandboxed environment's Firestore emulator has a
    // slow cold-start — the default 10s beforeAll hook timeout fails during
    // initializeTestEnvironment()'s connection handshake. Environment
    // characteristic, not a defect in the tests or rules.
    hookTimeout: 90000,
    include: [
      'src/lib/__tests__/firestoreDemoIsolation.emulator.test.ts',
      'src/lib/__tests__/multiTenantSecurity.emulator.test.ts',
      'src/lib/__tests__/phase8GroupPerformance.emulator.test.ts',
    ],
  },
});
