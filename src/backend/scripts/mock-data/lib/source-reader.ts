import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'csv-parse';
import { CURATED_ROOT, DATASET_ROOT } from './environment.js';
import {
  HEADERS,
  MOCK_MARKER,
  assertRecord,
  type HeaderKey,
  type Manifest,
  type RawRecord,
  type SourceImport,
} from './source-contract.js';

export async function* records(file: string, headerKey: HeaderKey): AsyncGenerator<RawRecord> {
  const expected = HEADERS[headerKey];
  const stream = createReadStream(file, { encoding: 'utf8' });
  let headerSeen = false;
  const parser = parse({
    bom: true,
    columns(headers: string[]) {
      if (headers.length !== expected.length || headers.some((header, i) => header !== expected[i]))
        throw new Error(`${file}: CSV header does not match ${headerKey}`);
      headerSeen = true;
      return headers;
    },
    skip_empty_lines: true,
    relax_column_count: false,
  });
  stream.pipe(parser);
  try {
    for await (const row of parser) yield row as RawRecord;
    if (!headerSeen) throw new Error(`${file}: missing CSV header`);
  } finally {
    stream.destroy();
  }
}

export async function firstRecord(file: string, headerKey: HeaderKey): Promise<RawRecord> {
  const iterator = records(file, headerKey);
  try {
    const first = await iterator.next();
    if (first.done || !first.value) throw new Error(`${file}: expected at least one data row`);
    return first.value;
  } finally {
    await iterator.return?.(undefined as never);
  }
}

export async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(file);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

export async function factFiles(prefix: string, expectedShards: number): Promise<string[]> {
  const files = (await readdir(CURATED_ROOT))
    .filter((name) => new RegExp(`^${prefix}_\\d{3}\\.csv$`).test(name))
    .sort()
    .map((name) => resolve(CURATED_ROOT, name));
  if (files.length !== expectedShards)
    throw new Error(`${prefix}: expected ${expectedShards} curated shards, found ${files.length}`);
  return files;
}

export async function inventoryImports(
  files: readonly string[],
  orgId: string,
  datasetVersion: string,
  expectedImportCount: number,
): Promise<SourceImport[]> {
  const imports = new Map<string, SourceImport>();
  for (const file of files) {
    for await (const row of records(file, 'inventory')) {
      assertRecord(row, datasetVersion, orgId, file);
      const prior = imports.get(row.import_id);
      if (prior && prior.snapshotDate !== row.snapshot_date)
        throw new Error(`${file}: import_id is associated with multiple snapshot dates`);
      if (prior) prior.rowCount += 1;
      else
        imports.set(row.import_id, {
          importId: row.import_id,
          snapshotDate: row.snapshot_date,
          rowCount: 1,
        });
    }
  }
  if (imports.size !== expectedImportCount)
    throw new Error(
      `expected ${expectedImportCount} deterministic inventory import ids, found ${imports.size}`,
    );
  return [...imports.values()].sort((left, right) =>
    left.snapshotDate.localeCompare(right.snapshotDate),
  );
}

export type ImportSource = {
  manifest: Manifest;
  orgId: string;
  organization: RawRecord;
  inventoryFiles: string[];
  sourceImports: SourceImport[];
  expectedManifestChecksum: string;
};

export async function loadSource(): Promise<ImportSource> {
  const manifest = JSON.parse(
    await readFile(resolve(DATASET_ROOT, 'manifest.json'), 'utf8'),
  ) as Manifest;
  if (manifest.synthetic_marker !== MOCK_MARKER)
    throw new Error('manifest is not marked MOCK_ONLY');
  const checksumLines = await readFile(resolve(DATASET_ROOT, 'checksums.sha256'), 'utf8');
  const expectedManifestChecksum = checksumLines
    .split(/\r?\n/)
    .find((line) => line.endsWith('  manifest.json'))
    ?.split('  ')[0];
  if (
    !expectedManifestChecksum ||
    (await sha256(resolve(DATASET_ROOT, 'manifest.json'))) !== expectedManifestChecksum
  )
    throw new Error('manifest checksum verification failed');

  const organizationFile = resolve(CURATED_ROOT, 'dim_organizations.csv');
  const organization = await firstRecord(organizationFile, 'organization');
  const orgId = organization.org_id;
  assertRecord(organization, manifest.dataset_version, orgId, organizationFile);
  const inventoryFiles = await factFiles('fact_inventory_snapshot', 12);
  const sourceImports = await inventoryImports(
    inventoryFiles,
    orgId,
    manifest.dataset_version,
    manifest.snapshot_dates.length,
  );

  return { manifest, orgId, organization, inventoryFiles, sourceImports, expectedManifestChecksum };
}
