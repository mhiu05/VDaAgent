import { Check, Circle, CircleAlert, LoaderCircle, Square } from 'lucide-react';
import type { RunTask } from '@vda/contracts';
import { stageLabel, stageStateLabel, workflowViewModel } from './workflow-view-model';
import styles from './workflow-graph.module.css';

function mark(status: RunTask['status'], active: boolean) {
  if (status === 'succeeded') return <Check size={14} />;
  if (status === 'running' && active) return <LoaderCircle className="spin" size={14} />;
  if (status === 'failed') return <CircleAlert size={14} />;
  if (status === 'cancelled') return <Square size={14} />;
  return <Circle size={14} />;
}

export function WorkflowGraph({ tasks, workflowVersion, active = true }: { tasks: RunTask[]; workflowVersion?: string; active?: boolean }) {
  const view = workflowViewModel(workflowVersion, tasks);
  return <div className={`${styles.graph} ${styles[view.layout]}`} aria-label="Các bước quy trình và quan hệ phụ thuộc">
    {view.tasks.map((task) => <article
      className={`${styles.node} ${styles[task.status]} ${styles[task.kind] ?? ''}`}
      key={task.task_id}
      data-status={task.status}
    >
      <span>{mark(task.status, active)}</span>
      <span>
        <strong>{stageLabel(task.kind, workflowVersion)}</strong>
        <em>{!active && ['running', 'pending'].includes(task.status) ? 'Chờ đồng bộ kết quả đã lưu' : stageStateLabel(task.status)}</em>
        <small>{task.dependencies.length
          ? `Sau: ${task.dependencies.map((kind) => stageLabel(kind, workflowVersion)).join(', ')}`
          : 'Bước đầu tiên'}</small>
      </span>
    </article>)}
  </div>;
}
