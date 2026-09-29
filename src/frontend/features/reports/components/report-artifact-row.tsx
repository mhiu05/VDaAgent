'use client';

import { useState } from 'react';
import { z } from 'zod';
import { ReportDetailSchema } from '@vda/contracts';
import { errorMessage } from '../../../lib/http/api-client';
import { dateTime } from '../../../lib/format/date-time';
import { requestReportExport } from '../api/reports';

type ReportDetail = z.infer<typeof ReportDetailSchema>;

export function ReportArtifactRow({ orgId, runId, detail, onOpen }: {
  orgId: string;
  runId: string;
  detail: ReportDetail;
  onOpen: (reportId: string) => void;
}) {
  const [busy, setBusy] = useState<'json' | 'csv' | null>(null);
  const [error, setError] = useState('');
  if (detail.report.org_id !== orgId || detail.report.run_id !== runId || detail.artifact.kind !== 'report' ||
    detail.artifact.artifact_id !== detail.report.artifact_id || detail.artifact.org_id !== orgId ||
    detail.artifact.run_id !== runId) return null;
  async function exportFormat(format: 'json' | 'csv') {
    setBusy(format);
    setError('');
    try {
      const response = await requestReportExport(orgId, detail.report.report_id, format);
      const link = document.createElement('a');
      link.href = response.url;
      link.rel = 'noopener';
      link.click();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(null); }
  }
  return <section aria-label="Báo cáo đã phát hành" data-stage-output="publication">
    <h3>{detail.artifact.payload.title}</h3>
    <p>Đã phát hành · {dateTime(detail.report.created_at)}</p>
    <div className="button-row">
      <button type="button" onClick={() => onOpen(detail.report.report_id)}>Mở báo cáo và in</button>
      <button type="button" disabled={busy !== null} onClick={() => void exportFormat('json')}>JSON</button>
      <button type="button" disabled={busy !== null} onClick={() => void exportFormat('csv')}>CSV</button>
    </div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
