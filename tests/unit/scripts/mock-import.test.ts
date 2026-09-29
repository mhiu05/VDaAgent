import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HEADERS,
  assertRecord,
  type RawRecord,
} from '../../../scripts/mock-data/lib/source-contract';
import { records } from '../../../scripts/mock-data/lib/source-reader';
import { retry } from '../../../scripts/mock-data/lib/retry';

const directories: string[] = [];
async function sourceCsv(content: string) {
  const directory = await mkdtemp(join(tmpdir(), 'vda-source-contract-'));
  directories.push(directory);
  const path = join(directory, 'organization.csv');
  await writeFile(path, content);
  return path;
}
afterEach(async () => {
  vi.useRealTimers();
  for (const directory of directories.splice(0)) {
    await unlink(join(directory, 'organization.csv'));
    await rmdir(directory);
  }
});

describe('mock data import boundary', () => {
  it('requires exact headers and the selected organization', async () => {
    const path = await sourceCsv(
      `${HEADERS.organization.join(',')}\norg-1,Organization,VN,v1,MOCK_ONLY\n`,
    );
    const values: RawRecord[] = [];
    for await (const record of records(path, 'organization')) values.push(record);
    expect(values).toHaveLength(1);
    expect(() => assertRecord(values[0]!, 'v1', 'org-1', path)).not.toThrow();
    expect(() => assertRecord(values[0]!, 'v1', 'org-2', path)).toThrow('cross-organization row');

    const malformed = await sourceCsv('org_id,wrong_header\norg-1,value\n');
    await expect(async () => {
      for await (const _record of records(malformed, 'organization')) {
        /* header fails first */
      }
    }).rejects.toThrow('CSV header does not match organization');
  });

  it('retries serialization errors but rejects permanent input failures immediately', async () => {
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
