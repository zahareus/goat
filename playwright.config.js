import { defineConfig } from '@playwright/test';
import { config } from 'dotenv';

config({ path: './tests/e2e/.env' });

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  retries: 1,
  workers: 3,
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    // Set localStorage before each page load to dismiss Driver.js tour
    storageState: undefined,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        // Add script to run before each page
        actionTimeout: 10000,
      },
    },
  ],
});
