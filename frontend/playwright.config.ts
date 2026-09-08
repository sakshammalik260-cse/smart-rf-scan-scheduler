import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  outputDir: './spatial-test-artifacts',
  timeout: 60_000,
  workers: 1,
  use: { headless: true },
})
