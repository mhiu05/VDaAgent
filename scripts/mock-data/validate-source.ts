import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DATASET = resolve(ROOT, 'vda_vinhomes_mock');

async function main(): Promise<void> {
  const python = process.env.PYTHON ?? 'python';
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    const child = spawn(python, ['validate_mock_data.py'], { cwd: DATASET, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => resolveExit(code ?? 1));
  });
  if (exitCode !== 0) throw new Error('source validation failed');
  const report = JSON.parse(await readFile(resolve(DATASET, 'validation_report.json'), 'utf8')) as {
    passed?: boolean;
    error_count?: number;
  };
  if (!report.passed || report.error_count)
    throw new Error('source validation report is not clean');
}

void main().catch((error: unknown) => {
  console.error(
    `Mock source validation failed: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
});
