import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleAlert,
  Database,
  FileText,
  LoaderCircle,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Workflow,
} from 'lucide-react';
import { dateTime } from '../../../lib/format/date-time';
import { ScopeFields } from '../../../components/forms/scope-fields';
import { AnalysisResult } from './analysis-result';
import type { useAnalysisRun } from '../hooks/use-analysis-run';
import { useLegacyAnalysisActions } from '../hooks/use-legacy-analysis-actions';
import type { useWorkspaceBootstrap } from '../../workspace/hooks/use-workspace-bootstrap';

const taskNames: Record<string, string> = {
  orchestrator: 'Điều phối',
  data: 'Dữ liệu',
  calculation: 'Tính toán',
  comparison: 'So sánh',
  chart: 'Biểu đồ',
  insight: 'Nhận định',
  validation: 'Kiểm tra',
  report: 'Báo cáo',
};
const statusNames: Record<string, string> = {
  queued: 'Đang chờ',
  running: 'Đang phân tích',
  succeeded: 'Hoàn thành',
  failed: 'Thất bại',
  cancelled: 'Đã hủy',
};

export function LegacyAnalysisWorkspace({
  orgId,
  catalog,
  canWrite,
  project,
  zone,
  dataAsOf,
  question,
  setProject,
  setZone,
  setDataAsOf,
  setQuestion,
  analysis,
  runId,
  reportBusy,
  onError,
  onSelectRun,
  onOpenRunReport,
  onOpenEvidence,
}: {
  orgId: string;
  catalog: ReturnType<typeof useWorkspaceBootstrap>['catalog'];
  canWrite: boolean;
  project: string;
  zone: string;
  dataAsOf: string;
  question: string;
  setProject: (value: string) => void;
  setZone: (value: string) => void;
  setDataAsOf: (value: string) => void;
  setQuestion: (value: string) => void;
  analysis: ReturnType<typeof useAnalysisRun>;
  runId: string;
  reportBusy: boolean;
  onError: (message: string) => void;
  onSelectRun: (id: string, conversation?: string) => void;
  onOpenRunReport: () => void;
  onOpenEvidence: (id: string) => void;
}) {
  const {
    busy: actionBusy,
    startAnalysis,
    cancelRun,
  } = useLegacyAnalysisActions(orgId, onSelectRun, onError);
  const busy = actionBusy || reportBusy;
  const {
    conversationId,
    runDetail,
    messages,
    bundle,
    decision,
    brief,
    briefStatus,
    detailsLoading,
    loadRunArtifacts,
  } = analysis;
  const active = runDetail && ['queued', 'running'].includes(runDetail.run.status);
  return (
    <div className="result-stack">
      <section className="card analysis-composer">
        <header className="section-heading">
          <div className="composer-title">
            <span className="spark-icon">
              <Sparkles size={20} />
            </span>
            <div>
              <h2>Bạn muốn tìm hiểu điều gì?</h2>
              <p>Chọn phạm vi, đặt câu hỏi và để dữ liệu trả lời.</p>
            </div>
          </div>
          <span className="badge">Dự án / Phân khu</span>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void startAnalysis(project, zone, dataAsOf, question, conversationId);
          }}
        >
          <div className="scope-row">
            <ScopeFields
              catalog={catalog}
              project={project}
              zone={zone}
              setProject={setProject}
              setZone={setZone}
            />
            <label>
              Ngày dữ liệu
              <input
                type="date"
                required
                value={dataAsOf}
                onChange={(event) => setDataAsOf(event.target.value)}
              />
            </label>
          </div>
          <label className="question-label">
            <span className="sr-only">Câu hỏi phân tích</span>
            <textarea
              aria-label="Câu hỏi phân tích"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              maxLength={2000}
              required
              rows={2}
              placeholder="Ví dụ: Phân khu nào có sản phẩm chậm luân chuyển?"
              disabled={!canWrite}
            />
          </label>
          <div className="composer-footer">
            <span>
              <span className="live-dot" />
              {catalog.latest_snapshot_date
                ? `Snapshot mới nhất: ${catalog.latest_snapshot_date}`
                : 'Chưa có snapshot'}{' '}
              · {zone ? 'Phạm vi Zone' : 'Phạm vi Project'}
            </span>
            <button
              className="primary"
              type="submit"
              disabled={!canWrite || busy || !!active || !project || !dataAsOf || !question.trim()}
            >
              {busy || active ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}
              {busy || active ? 'Đang phân tích…' : 'Phân tích'}
            </button>
          </div>
        </form>
        {!canWrite && (
          <p className="viewer-notice">
            <ShieldCheck size={15} />
            Bạn đang ở chế độ xem. Mở lịch sử hoặc báo cáo để khám phá bằng chứng.
          </p>
        )}
      </section>
      {!runId && (
        <>
          <div className="suggestion-row">
            {[
              'Tổng quan tồn kho hiện tại',
              'Phân tích tuổi tồn và chậm luân chuyển',
              'So sánh sản phẩm với nhóm tương đồng',
            ].map((suggestion) => (
              <button
                key={suggestion}
                className="suggestion"
                disabled={!canWrite}
                onClick={() => setQuestion(suggestion)}
              >
                {suggestion}
                <ArrowUpRight size={14} />
              </button>
            ))}
          </div>
          <section className="card welcome-card">
            <div className="welcome-orbit">
              <Workflow size={35} strokeWidth={1.3} />
            </div>
            <span className="eyebrow">MỘT CÂU HỎI. TOÀN BỘ BỐI CẢNH.</span>
            <h2>
              {catalog.projects.length ? 'Bắt đầu từ dữ liệu của bạn' : 'Workspace chưa có dữ liệu'}
            </h2>
            <p>
              {catalog.projects.length
                ? 'Kết quả phân tích, biểu đồ và nhận định sẽ xuất hiện tại đây. Mỗi giá trị đều liên kết tới phép tính và snapshot nguồn.'
                : 'Nhập snapshot CSV trong Nguồn dữ liệu để bắt đầu phân tích.'}
            </p>
            <div className="welcome-steps">
              <span>
                <Database size={17} />
                Dữ liệu
              </span>
              <ArrowRight size={14} />
              <span>
                <Activity size={17} />
                Phân tích
              </span>
              <ArrowRight size={14} />
              <span>
                <ShieldCheck size={17} />
                Bằng chứng
              </span>
              <ArrowRight size={14} />
              <span>
                <FileText size={17} />
                Báo cáo
              </span>
            </div>
          </section>
        </>
      )}
      {runId && (
        <section className="card progress-card" aria-live="polite">
          <header className="section-heading">
            <div>
              <span className="eyebrow">QUY TRÌNH PHÂN TÍCH</span>
              <h2>{runDetail ? statusNames[runDetail.run.status] : 'Đang tải lượt phân tích…'}</h2>
            </div>
            <div className="button-row">
              {runDetail?.run.status === 'succeeded' && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void onOpenRunReport()}
                >
                  <FileText size={16} />
                  Xem báo cáo
                </button>
              )}
              {active && canWrite && (
                <button
                  className="secondary"
                  disabled={busy || runDetail.run.cancel_requested}
                  onClick={() => {
                    void cancelRun(runId);
                  }}
                >
                  <Square size={12} />
                  {runDetail.run.cancel_requested ? 'Đang hủy…' : 'Hủy lượt chạy'}
                </button>
              )}
            </div>
          </header>
          <div className="task-track">
            {runDetail?.tasks.map((task) => (
              <div className={`task-step task-${task.status}`} key={task.task_id}>
                <span>
                  {task.status === 'succeeded' ? (
                    <Check size={15} />
                  ) : task.status === 'running' ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : task.status === 'failed' ? (
                    <CircleAlert size={15} />
                  ) : (
                    <span className="task-point" />
                  )}
                </span>
                <strong>{taskNames[task.kind]}</strong>
              </div>
            ))}
          </div>
          {runDetail?.run.error_code && <p className="error-box">{runDetail.run.error_code}</p>}
          <details className="diagnostics">
            <summary>Chẩn đoán · run_id: {runId}</summary>
            <dl className="metadata-list">
              <dt>Phạm vi</dt>
              <dd>
                {runDetail?.run.request.scope.project_external_id} /{' '}
                {runDetail?.run.request.scope.zone_external_id ?? 'Project'}
              </dd>
              <dt>Ngày dữ liệu</dt>
              <dd>{runDetail?.run.request.data_as_of}</dd>
              <dt>Số lần thực thi</dt>
              <dd>{runDetail?.run.attempt}</dd>
            </dl>
            {runDetail?.events.map((event) => (
              <p key={event.event_id}>
                <time>{dateTime(event.created_at)}</time> {event.message}
              </p>
            ))}
          </details>
        </section>
      )}
      {messages.length > 0 && (
        <section className="card conversation">
          <header className="section-heading">
            <h2>Hội thoại phân tích</h2>
            <span className="badge">{messages.length} tin nhắn</span>
          </header>
          {messages.map((message) => (
            <div className={`message message-${message.role}`} key={message.message_id}>
              <span className="message-role">{message.role === 'user' ? 'Bạn' : 'VDaAgent'}</span>
              <p>{message.content}</p>
              {message.run_id && (
                <button
                  className="text-button"
                  onClick={() => onSelectRun(message.run_id!, message.conversation_id)}
                >
                  Xem lượt phân tích
                  <ArrowUpRight size={13} />
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      <AnalysisResult
        artifacts={bundle.artifacts}
        decision={decision}
        brief={brief}
        briefStatus={briefStatus}
        detailsLoading={detailsLoading}
        onEvidence={(id) => void onOpenEvidence(id)}
        onLoadDetails={() => void loadRunArtifacts()}
        onReport={runDetail?.run.status === 'succeeded' ? () => void onOpenRunReport() : undefined}
      />
    </div>
  );
}
