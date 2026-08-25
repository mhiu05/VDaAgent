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
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "https://supabase.test.invalid",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "test-publishable-key",
    },
    url: "http://127.0.0.1:3010/datasets",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
