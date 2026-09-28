import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HEADERS, assertRecord } from './source-contract.js';
import { records } from './source-reader.js';
import { retry } from './retry.js';

const paths: Array<{ file: string; directory: string }> = [];

async function csvFile(content: string) {
  const directory = await mkdtemp(join(tmpdir(), 'vda-mock-source-'));
  const file = join(directory, 'organization.csv');
  await writeFile(file, content);
  paths.push({ file, directory });
  return file;
}

afterEach(async () => {
  for (const { file, directory } of paths.splice(0)) {
    await unlink(file);
    await rmdir(directory);
  }
  vi.useRealTimers();
});

describe('mock import source and retry boundaries', () => {
  it('requires exact curated CSV headers and mock organization identity', async () => {
    const row = ['org-1', 'Organization', 'VN', 'v1', 'MOCK_ONLY'];
    const file = await csvFile(`${HEADERS.organization.join(',')}\n${row.join(',')}\n`);
    const values = [];
    for await (const record of records(file, 'organization')) values.push(record);
    expect(values).toHaveLength(1);
    expect(() => assertRecord(values[0]!, 'v1', 'org-1', file)).not.toThrow();
    expect(() => assertRecord(values[0]!, 'v1', 'another-org', file)).toThrow(
      'cross-organization row',
    );

    const badFile = await csvFile('org_id,wrong_header\norg-1,value\n');
    await expect(async () => {
      for await (const _record of records(badFile, 'organization')) {
        // Header validation rejects before any record is emitted.
      }
    }).rejects.toThrow('CSV header does not match organization');
  });

  it('retries transient failures but rejects permanent failures immediately', async () => {
    vi.useFakeTimers();
    const transient = Object.assign(new Error('serialization'), { code: '40001' });
    const operation = vi.fn().mockRejectedValueOnce(transient).mockResolvedValue('ok');
    const pending = retry(operation);
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);

    const permanent = vi.fn().mockRejectedValue(new Error('invalid source'));
    await expect(retry(permanent)).rejects.toThrow('invalid source');
    expect(permanent).toHaveBeenCalledOnce();
  });
});
