import { defineConfig } from "@playwright/test";
const externalURL = process.env.WORKSPACE_BASE_URL;
const localURL = "http://127.0.0.1:5179";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: externalURL ?? localURL,
    headless: true,
    launchOptions: {
      executablePath:
        process.env.CHROME_PATH ??
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
    },
    screenshot: "only-on-failure",
  },
  webServer: externalURL
    ? undefined
    : {
        command:
          "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5179 --strictPort",
        url: localURL,
        reuseExistingServer: false,
      },
  reporter: [["list"], ["html", { open: "never" }]],
});
