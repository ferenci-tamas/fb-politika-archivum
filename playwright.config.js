import { defineConfig, devices } from '@playwright/test';

// The e2e tests drive the mobile collapse / auto-hide UI against a Vite dev server.
// They live in ./e2e (*.spec.js) so they never clash with the node:test unit suite
// in ./tests (*.test.mjs), which stays the one run by `npm test` / CI.
const APP_URL = 'http://localhost:5173/fb-politika-archivum/';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // On CI also emit an HTML report (uploaded as a build artifact) for debugging.
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: APP_URL,
    trace: 'on-first-retry',
    // Pixel 5: 393x851, touch, mobile UA — well under the app's 720px breakpoint.
    ...devices['Pixel 5']
  },
  webServer: {
    command: 'npm run dev',
    url: APP_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
