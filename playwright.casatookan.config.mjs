import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './browser-tests/casatookan',
  timeout: 60_000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3411', trace: 'retain-on-failure', hasTouch: true },
  webServer: {
    command: 'npm run dev --workspace apps/web -- --hostname 127.0.0.1 --port 3411',
    url: 'http://127.0.0.1:3411/.well-known/wallet-app.json',
    timeout: 180_000,
    env: { NEXT_PUBLIC_CASATOOKAN_ENABLED: process.env.CASATOOKAN_TEST_ENABLED ?? 'true' },
  },
})
