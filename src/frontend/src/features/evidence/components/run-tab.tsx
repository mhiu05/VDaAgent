import { LoaderCircle, Workflow } from 'lucide-react';
import { dateTime } from '../../../lib/format/date-time';
import { workflowStatusLabel } from '../../../lib/format/status-label';
import { EmptyState, label, type RunDetail } from './tab-primitives';
import styles from './context-evidence-panel.module.css';

export function RunTab({
  noRun,
  unavailable,
  loading,
  detail,
  panelId,
}: {
  noRun: boolean;
  unavailable: boolean;
  loading: boolean;
  detail: RunDetail | null;
  panelId: string;
}) {
  if (noRun)
    return (
      <EmptyState icon={Workflow} title="Chưa có lượt chạy">
        Trạng thái và các bước quy trình sẽ xuất hiện sau khi chọn một lượt phân tích.
      </EmptyState>
    );
  if (unavailable)
    return (
      <EmptyState icon={Workflow} title="Lượt chạy không khả dụng">
        Không thể xác thực lại quyền truy cập lượt chạy này trong workspace.
      </EmptyState>
    );
  if (loading)
    return (
      <EmptyState icon={LoaderCircle} title="Đang tải lượt chạy">
        Đang lấy trạng thái quy trình và lịch sử sự kiện đã lưu.
      </EmptyState>
    );
  if (!detail) return null;

  return (
    <div className={styles.stack}>
      <section className={styles.runStatus}>
        <span className={styles.sectionLabel}>Trạng thái đã lưu</span>
        <strong data-status={detail.run.status}>{workflowStatusLabel(detail.run.status)}</strong>
        <span>Cập nhật {dateTime(detail.run.updated_at)}</span>
      </section>
      <ul className={styles.taskList} aria-label="Các bước lượt chạy">
        {detail.tasks.map((task) => (
          <li key={task.task_id} data-status={task.status}>
            <span aria-hidden={true} />
            <div>
              <strong>{label(task.kind)}</strong>
              <small>
                {task.dependencies.length
                  ? `Sau bước: ${task.dependencies.map(label).join(', ')}`
                  : 'Bước đầu của quy trình'}
              </small>
            </div>
            <em>{workflowStatusLabel(task.status)}</em>
          </li>
        ))}
      </ul>
      {detail.events.length > 0 && (
        <section className={styles.events} aria-labelledby={`${panelId}-events`}>
          <span id={`${panelId}-events`} className={styles.sectionLabel}>
            Sự kiện gần đây đã lưu
          </span>
          <ul>
            {detail.events
              .slice(-4)
              .reverse()
              .map((event) => (
                <li key={event.event_id}>
                  <time dateTime={event.created_at}>{dateTime(event.created_at)}</time>
                  <span>{event.message}</span>
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}
