import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3010", headless: true },
  webServer: {
    command: "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3010",
    env: {
      ...process.env,
      NEXT_PUBLIC_UX_COMMAND_CENTER_ENABLED: "true",
      // Keep E2E requests deterministic in CI and prevent Next from inheriting
      // a developer machine's root .env API endpoint.
      NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api/v1",
      NEXT_DIST_DIR: process.env.NEXT_DIST_DIR || ".next-playwright",
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "https://supabase.test.invalid",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "test-publishable-key",
    },
    url: "http://127.0.0.1:3010/datasets",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
