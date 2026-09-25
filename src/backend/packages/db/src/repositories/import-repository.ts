import { createHash, randomUUID } from 'node:crypto';
import type { ImportManifest, UnitSnapshot } from '@vda/contracts/imports/inventory';
import { parseInventoryCsv } from '@vda/domain/imports/parse-inventory-csv';
import { validateHierarchy } from '@vda/domain/imports/hierarchy';
import type { Driver } from '../driver';
import { fail } from '../errors';
import { json } from '../mapping/rows';
import { StorageError, type StorageUploader } from '../storage';
import { resolveStorage } from '../storage/storage';
import { authorizeInTransaction } from '../authorization/authorization-repository';

export async function insertSnapshot(tx: Driver, row: UnitSnapshot) {
  await tx.query(
    'INSERT INTO snapshots(org_id,id,import_id,unit_external_id,snapshot_date,project_external_id,zone_external_id,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      row.org_id,
      row.snapshot_id,
      row.import_id,
      row.unit_external_id,
      row.snapshot_date,
      row.project_external_id,
      row.zone_external_id,
      JSON.stringify(row),
    ],
  );
}

export function importCsv(
  db: Driver,
  options: { storage?: StorageUploader; storageUrl?: string; storageKey?: string },
  user: string,
  input: { org_id: string; source_name: string; csv: string },
): Promise<ImportManifest> {
  const rows = parseInventoryCsv(input.csv);
  return db.transaction(async (tx) => {
    await authorizeInTransaction(tx, user, input.org_id, true);
    await tx.query('SELECT org_id FROM organizations WHERE org_id=$1 FOR UPDATE', [input.org_id]);
    const fileHash = createHash('sha256').update(input.csv).digest('hex');
    const prior = await tx.query('SELECT payload FROM imports WHERE org_id=$1 AND file_hash=$2', [
      input.org_id,
      fileHash,
    ]);
    if (prior[0]) return json(prior[0]) as ImportManifest;
    const existing = (
      await tx.query('SELECT payload FROM snapshots WHERE org_id=$1', [input.org_id])
    ).map(json) as UnitSnapshot[];
    validateHierarchy(rows, existing);
    const keys = new Set(existing.map((r) => `${r.unit_external_id}|${r.snapshot_date}`));
    if (rows.some((r) => keys.has(`${r.unit_external_id}|${r.snapshot_date}`)))
      fail('IMMUTABLE_SNAPSHOT_CONFLICT', 409);
    const id = randomUUID();
    const storagePath = `${input.org_id}/${id}/source.csv`;
    try {
      await resolveStorage(options).upload({
        bucket: 'source-imports',
        path: storagePath,
        body: input.csv,
        contentType: 'text/csv',
      });
    } catch (error) {
      if (error instanceof StorageError)
        fail(error.code, error.code === 'STORAGE_CONFIG_REQUIRED' ? 503 : 502);
      throw error;
    }
    const manifest: ImportManifest = {
      import_id: id,
      org_id: input.org_id,
      created_by: user,
      created_at: new Date().toISOString(),
      source_name: input.source_name,
      file_hash: fileHash,
      row_count: rows.length,
      storage_path: storagePath,
      schema_version: 'csv-v1',
      provisional: true,
    };
    await tx.query('INSERT INTO imports(org_id,id,file_hash,payload) VALUES($1,$2,$3,$4)', [
      input.org_id,
      id,
      fileHash,
      JSON.stringify(manifest),
    ]);
    for (const row of rows)
      await insertSnapshot(tx, {
        ...row,
        org_id: input.org_id,
        import_id: id,
        snapshot_id: randomUUID(),
      });
    return manifest;
  });
}

export function listImports(db: Driver, user: string, org: string): Promise<ImportManifest[]> {
  return db.transaction(async (tx) => {
    await authorizeInTransaction(tx, user, org);
    const rows = await tx.query('SELECT payload FROM imports WHERE org_id=$1', [org]);
    return rows.map(json) as ImportManifest[];
  });
}
