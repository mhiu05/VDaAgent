import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

const rootEnvPath = resolve(import.meta.dirname, '../../.env');

if (existsSync(rootEnvPath)) {
  loadEnvFile(rootEnvPath);
}

await import('next/dist/bin/next');
