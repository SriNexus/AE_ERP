import {defineConfig,devices} from '@playwright/test';
export default defineConfig({testDir:'./tests/demo-e2e',timeout:120_000,retries:1,workers:1,use:{baseURL:process.env.DEMO_E2E_BASE_URL||'http://127.0.0.1:4173',trace:'retain-on-failure'},projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['Pixel 7']}}]});
