import { defineConfig, devices } from '@playwright/test';
const baseURL = `http://127.0.0.1:${process.env.COIN_DESK_TEST_PORT || '5190'}`;
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  outputDir: process.env.COIN_DESK_TEST_OUTPUT_DIR || 'test-results',
  fullyParallel: false,
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 45000,
  expect: { timeout: 12000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer:
    process.env.COIN_DESK_FIXTURE_MANAGED_EXTERNALLY === '1'
      ? undefined
      : {
          command: 'node scripts/e2e-server.mjs',
          url: baseURL,
          reuseExistingServer: false,
          timeout: 60000,
        },
});
