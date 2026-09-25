import { environmentValue, DEFAULT_BATCH_SIZE } from './lib/environment.js';
import { integer, required } from './lib/source-contract.js';
import { loadSource } from './lib/source-reader.js';
import { importMockData } from './lib/postgres-writer.js';

async function main(): Promise<void> {
  const argumentsList = process.argv.slice(2);
  if (!argumentsList.includes('--import')) {
    throw new Error(
      'usage: pnpm exec tsx scripts/mock-data/import-mock-data.ts --import [--batch-size 1000]',
    );
  }
  const batchSizeIndex = argumentsList.indexOf('--batch-size');
  const batchSize =
    batchSizeIndex === -1
      ? DEFAULT_BATCH_SIZE
      : integer(required(argumentsList[batchSizeIndex + 1], '--batch-size'), 'batch size');
  if (batchSize < 100 || batchSize > 5_000)
    throw new Error('batch size must be between 100 and 5000');

  const databaseUrl = required(
    await environmentValue('WAREHOUSE_DB_URL'),
    'WAREHOUSE_DB_URL (this importer intentionally never falls back to SUPABASE_DB_URL)',
  );
  const source = await loadSource();
  await importMockData({ ...source, databaseUrl, batchSize });
}

void main().catch((error: unknown) => {
  console.error(
    `Mock data import failed: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
});
