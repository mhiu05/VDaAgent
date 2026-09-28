import type { Artifact, RunTask } from '@vda/contracts';
import type { AgentTurnJobSnapshot } from './api/conversations';
import { agentExecutionEventLabel, artifactKindLabel, workflowStatusLabel } from '../../lib/format/status-label';

const labels: Record<string,string> = { root:'Điều phối viên',data:'Tác nhân dữ liệu',compare:'Tác nhân so sánh',insight:'Tác nhân nhận định',report:'Tác nhân báo cáo' };
const stageLabels: Record<string,string> = {
  coordinator:'Điều phối viên',data:'Tác nhân dữ liệu',calculation:'Tính toán',comparison:'Tác nhân so sánh',chart:'Tác nhân biểu đồ',
  analyst:'Tác nhân phân tích',insight:'Tác nhân nhận định',report:'Tác nhân báo cáo',reviewer:'Người rà soát',publication:'Phát hành',
};


export function AgentExecutionInspector({
  snapshot, selectedAgent, tasks, artifacts, reportId, onRun, onArtifact, onReport,
}: {
  snapshot: AgentTurnJobSnapshot | null;
  selectedAgent: string | null;
  tasks: RunTask[];
  artifacts: Artifact[];
  reportId: string | null;
  onRun: (runId: string) => void;
  onArtifact: (runId: string, artifactId: string) => void;
  onReport?: (reportId: string) => void;
}) {
  const persona = selectedAgent ?? 'root';
  const invocation = snapshot?.invocations.find((item) => item.step_key === persona);
  const status = persona === 'root' ? snapshot?.job.status : invocation?.status;
  const relevant = persona === 'root' ? tasks : tasks.filter((task) => {
    const map: Record<string,string[]> = { data:['data'],compare:['comparison'],insight:['analyst','insight'],report:['chart','report','reviewer','publication'] };
    return map[persona]?.includes(task.kind) ?? false;
  });
  const events = snapshot?.events.filter((event) => !event.invocation_id || event.invocation_id === invocation?.invocation_id).slice(-12) ?? [];
  const timedEvents = events.filter((event) => invocation ? event.invocation_id === invocation.invocation_id : event.invocation_id === null);
  const startedAt = timedEvents.find((event) => event.type === 'invocation_started')?.created_at ?? null;
  const completedAt = timedEvents.find((event) => ['invocation_completed','invocation_failed','invocation_cancelled'].includes(event.type))?.created_at ?? null;
  const duration = startedAt && completedAt ? Math.max(0,Date.parse(completedAt)-Date.parse(startedAt)) : null;
  const safeErrorCode = snapshot?.job.error_code ?? events.find((event) => event.data.error_code)?.data.error_code;
  return <aside className="agent-execution-inspector" aria-label="Trình theo dõi thực thi của tác nhân">
    <div className="agent-inspector-heading"><span className="eyebrow">CHI TIẾT THỰC THI</span><h2>{labels[persona] ?? 'Tác nhân'}</h2></div>
    {!snapshot ? <p>Không có nhật ký thực thi cho lượt chạy đã lưu này.</p> : <>
      <p><strong>Trạng thái</strong><span>{status ? workflowStatusLabel(status) : 'Đang chờ'}</span></p>
      <p><strong>Yêu cầu bởi</strong><span>Điều phối viên</span></p>
      <p><strong>Tạo lúc</strong><time dateTime={invocation?.created_at ?? snapshot.job.created_at}>{invocation?.created_at ?? snapshot.job.created_at}</time></p>
      {startedAt && <p><strong>Bắt đầu lúc</strong><time dateTime={startedAt}>{startedAt}</time></p>}
      {completedAt && <p><strong>Hoàn tất lúc</strong><time dateTime={completedAt}>{completedAt}</time></p>}
      {duration !== null && <p><strong>Thời lượng</strong><span>{Math.round(duration/1000)} giây</span></p>}
      <p><strong>Cập nhật</strong><time dateTime={invocation?.updated_at ?? snapshot.job.updated_at}>{invocation?.updated_at ?? snapshot.job.updated_at}</time></p>
      {snapshot.job.run_id && <p><strong>Lượt phân tích</strong><button className="text-button" onClick={() => onRun(snapshot.job.run_id!)}>Mở lượt chạy liên kết</button></p>}
      {safeErrorCode && <p role="status"><strong>Mã lỗi an toàn</strong><code>{safeErrorCode}</code></p>}
      <section><h3>Các bước nội bộ</h3>{relevant.length ? <ul>{relevant.map((task) => <li key={task.task_id}>{stageLabels[task.kind] ?? task.kind}<span>{workflowStatusLabel(task.status)}</span></li>)}</ul> : <p>Chưa có thông tin bước xử lý.</p>}</section>
      <section><h3>Bằng chứng</h3>{artifacts.length ? <ul>{artifacts.map((artifact) => <li key={artifact.artifact_id}><button className="text-button" onClick={() => onArtifact(artifact.run_id,artifact.artifact_id)}>{artifactKindLabel(artifact.kind)}</button></li>)}</ul> : <p>Không có bằng chứng được phép xem.</p>}{reportId && onReport && <button className="text-button" onClick={() => onReport(reportId)}>Mở báo cáo đã phát hành</button>}</section>
      <section><h3>Dòng thời gian thực thi</h3>{events.length ? <ol>{events.map((event) => <li key={event.event_id}><span>{agentExecutionEventLabel(event.type)}</span><time dateTime={event.created_at}>{event.created_at}</time></li>)}</ol> : <p>Chưa có sự kiện cho tác nhân này.</p>}</section>
    </>}
  </aside>;
}
