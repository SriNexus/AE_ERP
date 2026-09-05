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
      'src/lib/__tests__/rbacPhase8CumulativeSecurity.emulator.test.ts',
      'src/lib/__tests__/groupAdminFullGroupAccess.emulator.test.ts',
      'src/lib/__tests__/settingsPersonalOwnershipBackfillFix.emulator.test.ts',
      'src/lib/__tests__/rolesSystemRolePermissionEditFix.emulator.test.ts',
      'src/lib/__tests__/missingIsSuperAdminFieldFix.emulator.test.ts',
      'src/lib/__tests__/phase8GroupPerformance.emulator.test.ts',
      'src/lib/__tests__/attendanceRules.emulator.test.ts',
      'src/lib/__tests__/stockAdjustTransaction.emulator.test.ts',
      'src/lib/__tests__/stockRoleMatrix.emulator.test.ts',
      'src/lib/__tests__/dispatchStockOutTransaction.emulator.test.ts',
      'src/lib/__tests__/grnReceiptTransaction.emulator.test.ts',
      'src/lib/__tests__/orderLifecycleTransaction.emulator.test.ts',
      'src/lib/inventory/__tests__/stockMovementEngine.emulator.test.ts',
      'src/lib/__tests__/stockReconciliation.emulator.test.ts',
      'src/lib/__tests__/stockReservationTransaction.emulator.test.ts',
      'src/lib/__tests__/stockTransferTransaction.emulator.test.ts',
      'src/lib/__tests__/customerReturnTransaction.emulator.test.ts',
      'src/lib/__tests__/dispatchSerialLock.emulator.test.ts',
      'src/lib/__tests__/productSkuLock.emulator.test.ts',
      'src/lib/__tests__/sensitiveCollectionsRoleEnforcement.emulator.test.ts',
      'src/lib/__tests__/biometricFaceReferences.emulator.test.ts',
      'src/lib/__tests__/leadCreationProjectionWrites.emulator.test.ts',
      'src/lib/__tests__/rolesReservedSystemNameProtection.emulator.test.ts',
      'src/lib/__tests__/banksRoleAliasParity.emulator.test.ts',
    ],
  },
});
