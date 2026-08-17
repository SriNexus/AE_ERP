import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 15000,
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'src/lib/__tests__/*.emulator.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/lib/channelPartnerCommissionEngine.ts',
        'src/lib/fraudDetection.ts',
        'src/lib/tierRules.ts',
        'src/lib/crmEngine.ts',
        'src/lib/installationEngine.ts',
        'src/lib/leadWorkflow.ts',
        'src/lib/quotationWorkflow.ts',
        'src/lib/dispatchWorkflow.ts',
        'src/lib/stockWorkflow.ts',
        'src/lib/invoiceWorkflow.ts',
        'src/lib/taskWorkflow.ts',
      ],
    },
  },
});
