import type { ArtifactListSchema, ArtifactOf, DecisionIntelligenceResponse } from '@vda/contracts';
import { ArrowDownToLine, ArrowUpRight, Printer } from 'lucide-react';
import type { z } from 'zod';
import { ReportBody } from '../../analysis/components/analysis-result';
import type { useWorkspaceReport } from '../hooks/use-workspace-report';

type Report = NonNullable<ReturnType<typeof useWorkspaceReport>['report']>;

export function WorkspaceReportDetail({
  report,
  artifact,
  decision,
  artifacts,
  busy,
  onClose,
  onExport,
  onEvidence,
}: {
  report: Report['report'];
  artifact: ArtifactOf<'report'>;
  decision: DecisionIntelligenceResponse | null;
  artifacts: z.infer<typeof ArtifactListSchema>['artifacts'];
  busy: boolean;
  onClose: () => void;
  onExport: (format: 'json' | 'csv') => void;
  onEvidence: (id: string) => void;
}) {
  return (
    <div className="card report-detail">
      <header className="section-heading no-print">
        <button className="text-button" onClick={onClose}>
          ← Thư viện báo cáo
        </button>
        <div className="button-row">
          <button className="secondary" disabled={busy} onClick={() => onExport('json')}>
            <ArrowDownToLine size={15} />
            JSON
          </button>
          <button className="secondary" disabled={busy} onClick={() => onExport('csv')}>
            <ArrowDownToLine size={15} />
            CSV
          </button>
          <button className="secondary" onClick={() => window.print()}>
            <Printer size={15} />
            In báo cáo
          </button>
        </div>
      </header>
      <ReportBody
        payload={artifact.payload}
        dataAsOf={artifact.data_as_of}
        decision={decision}
        visualEvidence={
          artifacts.find(
            (item): item is ArtifactOf<'visual_evidence'> => item.kind === 'visual_evidence',
          )?.payload
        }
        onEvidence={onEvidence}
      />
      <details className="no-print">
        <summary>Metadata báo cáo</summary>
        <code>
          run_id: {report.run_id}
          <br />
          artifact_id: {artifact.artifact_id}
          <br />
          content_hash: {artifact.content_hash}
        </code>
        <button className="text-button" onClick={() => onEvidence(artifact.artifact_id)}>
          Mở artifact báo cáo
          <ArrowUpRight size={14} />
        </button>
      </details>
    </div>
  );
}
