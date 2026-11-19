import { defineConfig, devices } from "@playwright/test";

// The end-to-end journeys of doc 17 run headless against the fake-mode stack (`make e2e`);
// BASE_URL is the Caddy proxy of the compose project.
export default defineConfig({
  testDir: ".",
  timeout: 600_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://proxy:8080",
    headless: true,
    viewport: { width: 1440, height: 900 },
    locale: "vi-VN",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
