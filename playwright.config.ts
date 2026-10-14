import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests for the critical flows. They run against a locally started
 * production server (or `npm run dev`) and use the isolated dev accounts.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    locale: "fa-IR",
    timezoneId: "Asia/Tehran",
    screenshot: "off",
    trace: "off",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run build && npm run start",
        url: "http://127.0.0.1:3000/api/health",
        timeout: 180_000,
        reuseExistingServer: true,
        env: { APP_ENV: "preview" },
      },
});
