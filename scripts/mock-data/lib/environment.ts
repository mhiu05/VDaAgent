import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const DATASET_ROOT = resolve(REPOSITORY_ROOT, 'vda_vinhomes_mock');
export const CURATED_ROOT = resolve(DATASET_ROOT, 'curated');
export const DEFAULT_BATCH_SIZE = 1_000;

export async function environmentValue(name: string): Promise<string | undefined> {
  if (process.env[name]) return process.env[name];
  const dotenvPath = resolve(REPOSITORY_ROOT, '.env');
  let source: string;
  try {
    source = await readFile(dotenvPath, 'utf8');
  } catch {
    return undefined;
  }
  const line = source.split(/\r?\n/).find((entry) => entry.startsWith(`${name}=`));
  if (!line) return undefined;
  const value = line.slice(name.length + 1).trim();
  return value.replace(/^(?:"|')|(?:"|')$/g, '');
}
