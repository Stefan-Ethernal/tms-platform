import { defineConfig, devices } from '@playwright/test';

const adminUrl = process.env['E2E_ADMIN_URL'] ?? 'http://localhost:8080';
const driverUrl = process.env['E2E_DRIVER_URL'] ?? 'http://localhost:8081';
const ci = Boolean(process.env['CI']);

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    {
      name: 'web-admin',
      testDir: './tests/web-admin',
      use: { ...devices['Desktop Chrome'], baseURL: adminUrl },
    },
    {
      name: 'web-driver',
      testDir: './tests/web-driver',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: driverUrl,
        viewport: { width: 1280, height: 1024 },
        hasTouch: true,
      },
    },
  ],
});
