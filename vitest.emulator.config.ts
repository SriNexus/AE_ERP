import { defineConfig } from 'vitest/config';
export default defineConfig({ test:{ globals:true, environment:'node', testTimeout:20000, include:['src/lib/__tests__/firestoreDemoIsolation.emulator.test.ts'] } });
