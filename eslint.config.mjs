import tseslint from 'typescript-eslint';
import next from 'eslint-config-next/core-web-vitals';
export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.next-e2e/**',
      '**/dist/**',
      '**/next-env.d.ts',
      '**/.turbo/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  ...tseslint.configs.recommended,
  ...next.map((config) => ({ ...config, files: ['src/frontend/**/*.{ts,tsx,js,mjs}'] })),
  {
    files: ['src/frontend/**/*.{ts,tsx,js,mjs}'],
    settings: { next: { rootDir: 'src/frontend/' } },
    rules: {
      // This client workspace fetches BFF resources in effects; state follows async responses.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
];
