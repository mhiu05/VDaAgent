import { z } from 'zod';
import { exportReport } from '@vda/agents';
import { RepositoryError, type Repository } from '@vda/db';
import { readGrant, signGrant } from '../../context';

type DownloadGrant = {
  user_id: string;
  org_id: string;
  report_id: string;
  format: 'json' | 'csv';
  expires: number;
};

export async function createReportExport(
  repo: Repository,
  userId: string,
  orgId: string,
  reportId: string,
  format: 'json' | 'csv',
) {
  const { artifact } = await repo.getReport(userId, orgId, reportId);
  if (artifact.kind !== 'report') throw new RepositoryError('INVALID_REPORT', 409);
  const exported = exportReport(artifact, format);
  await repo.storeReportExport(
    userId,
    orgId,
    reportId,
    format,
    artifact.content_hash,
    exported.body,
    exported.contentType,
  );
  const expires = Date.now() + 5 * 60_000;
  const token = signGrant({ user_id: userId, org_id: orgId, report_id: reportId, format, expires });
  return {
    url: `/api/v1/reports/${reportId}/download?token=${encodeURIComponent(token)}`,
    expires_at: new Date(expires).toISOString(),
  };
}

export async function resolveReportDownload(
  repo: Repository,
  userId: string,
  reportId: string,
  tokenValue: string | null,
) {
  const grant = readGrant<DownloadGrant>(z.string().max(2000).parse(tokenValue));
  if (
    grant.user_id !== userId ||
    grant.report_id !== reportId ||
    !['json', 'csv'].includes(grant.format)
  )
    throw new RepositoryError('DOWNLOAD_DENIED', 403);
  const { artifact } = await repo.getReport(userId, grant.org_id, reportId);
  if (artifact.kind !== 'report') throw new RepositoryError('INVALID_REPORT', 409);
  return { exported: exportReport(artifact, grant.format), format: grant.format };
}
