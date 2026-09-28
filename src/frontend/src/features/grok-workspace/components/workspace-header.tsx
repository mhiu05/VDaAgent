import type { Conversation } from '@vda/contracts';
import type { AgentTurnJobSnapshot } from '../../agent-chat/api/conversations';
import type { RunDetail } from '../../evidence/components/tab-primitives';
import { workflowStatusLabel } from '../../../lib/format/status-label';
import { PanelRight } from 'lucide-react';
import styles from './grok-workspace.module.css';

export function WorkspaceHeader({
  conversation,
  run,
  job,
  canCancel,
  cancelling,
  onCancel,
  onCancelJob,
  onOpenRail,
  onOpenInspector,
}: {
  conversation: Conversation | null;
  run: RunDetail | null;
  job: AgentTurnJobSnapshot | null;
  canCancel: boolean;
  cancelling: boolean;
  onCancel: () => void;
  onCancelJob: () => void;
  onOpenRail: () => void;
  onOpenInspector: () => void;
}) {
  const active = run && (run.run.status === 'queued' || run.run.status === 'running');
  return <header className={styles.header}>
    <div className={styles.headerMain}>
      <button type="button" className={`${styles.paneTrigger} ${styles.railTrigger}`} onClick={onOpenRail}>Hội thoại và quy trình</button>
      <div className={styles.headerTitle}>
        <h1>{conversation?.title ?? (run ? 'Chi tiết lượt chạy' : 'Hội thoại mới')}</h1>
        {run && <span className={styles.status} data-status={run.run.status}>{workflowStatusLabel(run.run.status)}</span>}
        {!run && job && <span className={styles.status} data-status={job.job.status}>{workflowStatusLabel(job.job.status)}</span>}
      </div>
      {active && canCancel && <button type="button" className="text-button" aria-label="Hủy lượt phân tích" disabled={cancelling || run.run.cancel_requested} onClick={onCancel}>
        {run.run.cancel_requested ? 'Đang hủy…' : 'Hủy'}
      </button>}
      {!run && job && !job.job.run_id && ['queued', 'running', 'waiting'].includes(job.job.status) && canCancel &&
        <button type="button" className="text-button" disabled={cancelling} onClick={onCancelJob}>Hủy</button>}
      <button type="button" className={styles.paneTrigger} onClick={onOpenInspector} aria-label="Mở hoặc thu gọn bảng thông tin"><PanelRight size={18} aria-hidden="true" /></button>
    </div>
  </header>;
}
