import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  cacheDir: process.env.VITE_CACHE_DIR ?? "node_modules/.vite",
  build: {
    rolldownOptions: {
      output: {
        postBanner: (chunk) =>
          chunk.moduleIds.some((id) =>
            /[\\/]node_modules[\\/](gsap|@gsap[\\/]react)[\\/]/.test(id),
          )
            ? "/*! GSAP 3.15.0 | Copyright 2008-2026, GreenSock. All rights reserved.\n * @gsap/react 2.1.2 | Copyright 2008-2025, GreenSock. All rights reserved.\n * https://gsap.com | License: https://gsap.com/standard-license */"
            : "",
      },
    },
  },
  plugins: [react(), tailwindcss()],
  // `npm run dev` against a running backend (doc 14g "Running against the API").
  server: { proxy: { "/api": process.env.VITE_API_PROXY ?? "http://127.0.0.1:8010" } },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/shared/testing/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    // the journey tests render whole app trees; the 5 s default loses to parallel load
    testTimeout: 15_000,
    restoreMocks: true,
  },
});
