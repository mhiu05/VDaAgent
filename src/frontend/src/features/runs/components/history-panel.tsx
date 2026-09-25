'use client';

import { ArrowRight, Clock3, FileText, RefreshCw } from 'lucide-react';
import { useHistory } from '../hooks/use-history';
import { dateTime } from '../../../lib/format/date-time';
import { workflowStatusLabel } from '../../../lib/format/status-label';
import { EmptyState } from '../../../components/feedback/empty-state';
import { Status } from '../../../components/ui';

export function HistoryPanel({
  orgId,
  kind,
  onOpen,
}: {
  orgId: string;
  kind: 'runs' | 'reports';
  onOpen: (id: string) => void;
}) {
  const { runs, reports, error, loading, refresh } = useHistory(orgId, kind);
  return (
    <section className="card">
      <header className="section-heading">
        <div>
          <span className="eyebrow">{kind === 'runs' ? 'LỊCH SỬ PHÂN TÍCH' : 'THƯ VIỆN BÁO CÁO'}</span>
          <h2>{kind === 'runs' ? 'Lịch sử phân tích' : 'Thư viện báo cáo'}</h2>
        </div>
        <button className="secondary" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw size={15} /> Làm mới
        </button>
      </header>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status" className="empty-inline">
          Đang tải…
        </p>
      ) : (
        <div className="history-list">
          {kind === 'runs'
            ? runs.map((run) => (
                <button
                  className="history-item"
                  key={run.run_id}
                  onClick={() => onOpen(run.run_id)}
                >
                  <span className="list-icon">
                    <Clock3 size={20} />
                  </span>
                  <span className="history-content">
                    <strong>{run.request.question}</strong>
                    <span>
                      {run.request.scope.project_external_id}
                      {run.request.scope.zone_external_id
                        ? ` / ${run.request.scope.zone_external_id}`
                        : ''}{' '}
                      · {run.request.data_as_of} · {run.entrypoint}
                    </span>
                    <code>{run.run_id}</code>
                  </span>
                  <Status state={run.status}>{workflowStatusLabel(run.status)}</Status>
                  <ArrowRight size={18} />
                </button>
              ))
            : reports.map((report) => (
                <button
                  className="history-item"
                  key={report.report_id}
                  onClick={() => onOpen(report.report_id)}
                >
                  <span className="list-icon">
                    <FileText size={20} />
                  </span>
                  <span className="history-content">
                    <strong>Báo cáo tồn kho · {dateTime(report.created_at)}</strong>
                    <span>
                      {report.occurrence_id ? 'Báo cáo theo lịch' : 'Báo cáo theo yêu cầu'}
                    </span>
                    <code>{report.report_id}</code>
                  </span>
                  <ArrowRight size={18} />
                </button>
              ))}
        </div>
      )}
      {!loading && !(kind === 'runs' ? runs.length : reports.length) && (
        <EmptyState title={kind === 'runs' ? 'Chưa có lượt phân tích' : 'Chưa có báo cáo'}>
          Chạy phân tích đầu tiên để tạo bộ bằng chứng và báo cáo cho workspace.
        </EmptyState>
      )}
    </section>
  );
}
