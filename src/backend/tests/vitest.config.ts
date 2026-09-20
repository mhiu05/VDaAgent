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
    include: [
      'src/backend/packages/**/*.test.ts',
      'src/backend/tests/unit/**/*.test.ts',
      'src/frontend/src/**/*.test.tsx',
    ],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
