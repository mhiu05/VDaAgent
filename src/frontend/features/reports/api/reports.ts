import { z } from 'zod';
import { ExportResponseSchema, ReportDetailSchema, ReportRecordSchema } from '@vda/contracts';
import { api, post, scoped } from '../../../lib/http/api-client';

export async function getReportDetail(orgId: string, reportId: string) {
  const detail = await api(scoped(`/reports/${reportId}`, orgId), ReportDetailSchema);
  if (detail.report.report_id !== reportId || detail.report.org_id !== orgId ||
    detail.artifact.kind !== 'report' || detail.artifact.artifact_id !== detail.report.artifact_id ||
    detail.artifact.org_id !== orgId || detail.artifact.run_id !== detail.report.run_id)
    throw new Error('Báo cáo không khớp với tổ chức hoặc hiện vật được yêu cầu.');
  return detail;
}

export function listReports(orgId: string) {
  return api(scoped('/reports', orgId), z.object({ reports: z.array(ReportRecordSchema) }));
}

export function requestReportExport(orgId: string, reportId: string, format: 'json' | 'csv') {
  return api(scoped(`/reports/${reportId}/exports`, orgId), ExportResponseSchema, post({ format }));
}
