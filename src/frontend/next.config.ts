import type { NextConfig } from 'next';
const config: NextConfig = {
  // Isolate Playwright's dev server from a developer's active `.next` lock.
  distDir: process.env.NEXT_DIST_DIR === '.next-e2e' ? '.next-e2e' : '.next',
  transpilePackages: [
    '@vda/contracts',
    '@vda/config',
    '@vda/db',
    '@vda/agents',
    '@vda/semantic',
    '@vda/domain',
  ],
  serverExternalPackages: ['postgres'],
  poweredByHeader: false,
};
export default config;
