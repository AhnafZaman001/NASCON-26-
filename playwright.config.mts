import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
export default defineConfig({
  testDir: './e2e/tests',
  testIgnore: '**/public.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]],
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5179', timezoneId: 'Asia/Karachi', screenshot: 'only-on-failure', trace: 'retain-on-failure', launchOptions: { executablePath } },
  webServer: { command: 'node e2e/serve.mjs', url: 'http://127.0.0.1:5179/api/health', reuseExistingServer: false, timeout: 60_000 },
});
