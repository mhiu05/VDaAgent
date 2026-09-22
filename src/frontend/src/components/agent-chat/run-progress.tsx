'use client';

import { Check, CircleAlert, LoaderCircle, Square } from 'lucide-react';
import type { AnalysisRun, RunEvent, RunTask } from '@vda/contracts';

type RunDetail = { run: AnalysisRun; tasks: RunTask[]; events: RunEvent[] };

const taskLabels: Record<string, string> = {
  coordinator: 'Coordinator decision',
  analyst: 'Evidence-bound analysis',
  reviewer: 'Draft review',
  publication: 'Publication gate',
  orchestrator: 'Chuẩn bị',
  data: 'Đọc snapshot đã khóa',
  calculation: 'Tính chỉ số',
  comparison: 'Tạo so sánh',
  chart: 'Tạo biểu đồ',
  insight: 'Liên kết insight với bằng chứng',
  validation: 'Kiểm tra bằng chứng',
  report: 'Chuẩn bị báo cáo',
};
const statusLabels: Record<string, string> = {
  queued: 'Đang chờ',
  running: 'Đang phân tích',
  succeeded: 'Hoàn thành',
  failed: 'Thất bại',
  cancelled: 'Đã hủy',
};

export function taskLabel(kind: string): string {
  return taskLabels[kind] ?? 'Đang xử lý';
}

export function RunProgress({
  detail,
  canWrite,
  cancelling,
  onCancel,
}: {
  detail: RunDetail;
  canWrite: boolean;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const active = detail.run.status === 'queued' || detail.run.status === 'running';
  return (
    <section className="agent-run-progress card" aria-live="polite">
      <header className="section-heading">
        <div>
          <span className="eyebrow">ANALYTICAL PIPELINE</span>
          <h2>{statusLabels[detail.run.status] ?? detail.run.status}</h2>
        </div>
        {active && canWrite && (
          <button
            className="secondary"
            disabled={cancelling || detail.run.cancel_requested}
            onClick={onCancel}
          >
            <Square size={12} />
            {detail.run.cancel_requested ? 'Đang hủy…' : 'Hủy lượt chạy'}
          </button>
        )}
      </header>
      <div className="task-track">
        {detail.tasks.map((task) => (
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
            <strong>{taskLabel(task.kind)}</strong>
          </div>
        ))}
      </div>
      {detail.run.error_code && <p className="error-box">{detail.run.error_code}</p>}
    </section>
  );
}
