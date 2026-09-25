'use client';

import { Check, CircleAlert, LoaderCircle, Square } from 'lucide-react';
import type { AnalysisRun, RunEvent, RunTask } from '@vda/contracts';
import { WorkflowGraph } from './workflow-graph';
import { workflowViewModel } from './workflow-view-model';

type RunDetail = { run: AnalysisRun; tasks: RunTask[]; events: RunEvent[] };

const taskLabels: Record<string, string> = {
  coordinator: 'Quyết định điều phối',
  analyst: 'Phân tích gắn với bằng chứng',
  reviewer: 'Rà soát bản nháp',
  publication: 'Cổng phát hành',
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
  succeeded: 'Hoàn tất',
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
  compact = false,
}: {
  detail: RunDetail;
  canWrite: boolean;
  cancelling: boolean;
  onCancel: () => void;
  compact?: boolean;
}) {
  const active = detail.run.status === 'queued' || detail.run.status === 'running';
  const view = workflowViewModel(detail.run.workflow_version, detail.tasks);
  return (
    <section className="agent-run-progress card" aria-label="Tiến độ lượt chạy">
      <header className="section-heading">
        <div>
          <span className="eyebrow">LUỒNG PHÂN TÍCH</span>
          <h2>{statusLabels[detail.run.status] ?? detail.run.status}</h2>
          {compact && <p>{view.completed}/{detail.tasks.length} bước hoàn tất</p>}
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
      <WorkflowGraph tasks={detail.tasks} workflowVersion={detail.run.workflow_version} />
      {!compact && <div className="task-track">
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
      </div>}
      {detail.run.error_code && <p className="error-box">{detail.run.error_code}</p>}
    </section>
  );
}
