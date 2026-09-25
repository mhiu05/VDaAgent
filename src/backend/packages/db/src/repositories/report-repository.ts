import type { Artifact, ReportRecord } from '@vda/contracts';
import { authorizeInTransaction } from '../authorization/authorization-repository';
import type { Driver } from '../driver';
import { fail } from '../errors';
import { json } from '../mapping/rows';
import { StorageError, type StorageUploader } from '../storage';
import { resolveStorage } from '../storage/storage';

export function listReports(db: Driver, user: string, org: string): Promise<ReportRecord[]> {
  return db.transaction(async (tx) => {
    await authorizeInTransaction(tx, user, org);
    const rows = await tx.query('SELECT payload FROM reports WHERE org_id=$1', [org]);
    return (rows.map(json) as ReportRecord[]).sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    );
  });
}

export function getReport(db: Driver, user: string, org: string, id: string) {
  return db.transaction(async (tx) => {
    await authorizeInTransaction(tx, user, org);
    const rows = await tx.query('SELECT payload FROM reports WHERE org_id=$1 AND id=$2', [org, id]);
    if (!rows[0]) fail('REPORT_NOT_FOUND', 404);
    const report = json(rows[0]) as ReportRecord;
    const artifacts = await tx.query('SELECT payload FROM artifacts WHERE org_id=$1 AND id=$2', [
      org,
      report.artifact_id,
    ]);
    return { report, artifact: json(artifacts[0]) as Artifact };
  });
}

export async function storeReportExport(
  db: Driver,
  storageOptions: { storage?: StorageUploader; storageUrl?: string; storageKey?: string },
  user: string,
  org: string,
  reportId: string,
  format: 'json' | 'csv',
  contentHash: string,
  body: string,
  contentType: string,
): Promise<{ storage_path: string }> {
  const storagePath = `${org}/${reportId}/${contentHash}.${format}`;
  await db.transaction(async (tx) => {
    await authorizeInTransaction(tx, user, org, false);
    const record = await tx.query('SELECT payload FROM reports WHERE org_id=$1 AND id=$2', [
      org,
      reportId,
    ]);
    if (!record[0]) fail('REPORT_NOT_FOUND', 404);
  });
  try {
    await resolveStorage(storageOptions).upload({
      bucket: 'report-exports',
      path: storagePath,
      body,
      contentType,
      allowExisting: true,
    });
  } catch (error) {
    if (error instanceof StorageError)
      fail(error.code, error.code === 'STORAGE_CONFIG_REQUIRED' ? 503 : 502);
    throw error;
  }
  await db.transaction(async (tx) => {
    // Export is a read entitlement; the ledger is a server-owned projection.
    await authorizeInTransaction(tx, user, org, false);
    const record = await tx.query('SELECT payload FROM reports WHERE org_id=$1 AND id=$2', [
      org,
      reportId,
    ]);
    if (!record[0]) fail('REPORT_NOT_FOUND', 404);
    if (!storagePath.startsWith(`${org}/${reportId}/`)) fail('EXPORT_PATH_MISMATCH', 403);
    await tx.query('RESET ROLE');
    await tx.query(
      'INSERT INTO report_exports(org_id,report_id,format,storage_path,content_hash,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(org_id,report_id,format) DO NOTHING',
      [org, reportId, format, storagePath, contentHash, new Date().toISOString()],
    );
  });
  return { storage_path: storagePath };
}
