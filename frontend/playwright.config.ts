import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:3000", headless: true },
  webServer: {
    command: "pnpm dev -- --hostname 127.0.0.1 --port 3000",
    url: "http://127.0.0.1:3000/datasets",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
