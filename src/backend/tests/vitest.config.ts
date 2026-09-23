import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

export default defineConfig({
  root: repositoryRoot,
  resolve: {
    alias: Object.fromEntries(
      ['contracts', 'config', 'semantic', 'agents', 'db', 'domain'].map((name) => [
        `@vda/${name}`,
        resolve(repositoryRoot, `src/backend/packages/${name}/src/index.ts`),
      ]),
    ),
  },
  test: {
    // PGlite starts an in-process PostgreSQL instance for each file. Running
    // the workflow suites concurrently starves their lease/teardown timers and
    // creates false timeout/LEASE_LOST failures; production workers remain
    // independently concurrent.
    fileParallelism: false,
    include: [
      'src/backend/packages/**/*.test.ts',
      'src/backend/tests/unit/**/*.test.ts',
      'src/frontend/src/**/*.test.ts',
      'src/frontend/src/**/*.test.tsx',
    ],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
