import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const frontendRoot = fileURLToPath(new URL('../src/frontend/', import.meta.url));

export default defineConfig({
  root: repositoryRoot,
  resolve: {
    alias: [{ find: /^@\//, replacement: `${frontendRoot.replaceAll('\\', '/')}/` }],
  },
  test: {
    fileParallelism: false,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
