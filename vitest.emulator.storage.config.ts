import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 90000,
    // Kept in its own vitest config + npm script (test:rules:storage),
    // separate from vitest.emulator.config.ts's Firestore-only suites
    // (Phase 8, Master Plan §9.5). Reason: the local Storage Emulator binds
    // to exactly ONE project for its entire process lifetime (the CLI's
    // `--project` flag) — unlike the Firestore emulator, which is genuinely
    // multi-project within one running instance. Storage Rules' cross-service
    // firestore.get()/firestore.exists() calls are always issued against
    // that ONE bound project, so this test's declared projectId must match
    // the `--project` flag `test:rules:storage` launches with
    // (neozy-multitenant-storage-test) — a different project than
    // firestoreDemoIsolation.emulator.test.ts's `neozy-demo-isolation-test`.
    // Running this file under vitest.emulator.config.ts's shared invocation
    // would force a projectId collision with that file's own clearFirestore()
    // calls (or leave storage cross-service lookups permanently unresolved
    // if left mismatched) — a dedicated command avoids both.
    include: [
      'src/lib/__tests__/multiTenantStorageSecurity.emulator.test.ts',
    ],
  },
});
