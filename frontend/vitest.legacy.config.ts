import { defineConfig } from "vitest/config";
import base from "./vite.config.ts";

// The repository's feature-owned domain suites predate the TS test globs.
export default defineConfig({ ...base, test: { ...base.test, include: ["src/**/*.test.mjs"] } });
