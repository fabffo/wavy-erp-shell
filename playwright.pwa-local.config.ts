import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: 'pwa-notes-frais.local.spec.ts', workers: 1,
  timeout: 45000, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:14327', serviceWorkers: 'block' },
  webServer: { command: 'python3 ../wavy-devops/preparation/pwa-notes-frais/local-browser-server.py', url: 'http://127.0.0.1:14327', reuseExistingServer: false },
});
