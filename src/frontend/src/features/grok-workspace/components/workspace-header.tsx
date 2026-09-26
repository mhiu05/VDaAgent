import type { Conversation } from '@vda/contracts';
import type { AgentTurnJobSnapshot } from '../../agent-chat/api/conversations';
import type { RunDetail } from '../../evidence/components/tab-primitives';
import { workflowStatusLabel } from '../../../lib/format/status-label';
import styles from './grok-workspace.module.css';
import type { ReactNode } from 'react';

export function WorkspaceHeader({
  conversation,
  run,
  job,
  organizationName,
  canCancel,
  cancelling,
  onCancel,
  onCancelJob,
  onOpenRail,
  onOpenInspector,
  children,
}: {
  conversation: Conversation | null;
  run: RunDetail | null;
  job: AgentTurnJobSnapshot | null;
  organizationName: string;
  canCancel: boolean;
  cancelling: boolean;
  onCancel: () => void;
  onCancelJob: () => void;
  onOpenRail: () => void;
  onOpenInspector: () => void;
  children?: ReactNode;
}) {
  const active = run && (run.run.status === 'queued' || run.run.status === 'running');
  const request = run?.run.request;
  return <header className={styles.header}>
    <div className={styles.headerMain}>
      <button type="button" className={`${styles.paneTrigger} ${styles.railTrigger}`} onClick={onOpenRail}>Hội thoại và quy trình</button>
      <div className={styles.headerTitle}>
        <h1>{conversation?.title ?? (run ? 'Chi tiết lượt chạy' : 'Hội thoại mới')}</h1>
        {run && <span className={styles.status} data-status={run.run.status}>{workflowStatusLabel(run.run.status)}</span>}
        {!run && job && <span className={styles.status} data-status={job.job.status}>{job.job.status}</span>}
      </div>
      {active && canCancel && <button type="button" className="text-button" aria-label="Stop run" disabled={cancelling || run.run.cancel_requested} onClick={onCancel}>
        {run.run.cancel_requested ? 'Stopping…' : 'Stop'}
      </button>}
      {!run && job && !job.job.run_id && ['queued', 'running', 'waiting'].includes(job.job.status) && canCancel &&
        <button type="button" className="text-button" disabled={cancelling} onClick={onCancelJob}>Stop</button>}
      <button type="button" className={styles.paneTrigger} onClick={onOpenInspector} aria-label="Toggle run inspector">Inspector</button>
    </div>
    {children}
    <div className={styles.headerMeta}>
      <span>{organizationName}</span>
      {request && <>
        <span>Dự án: {request.scope.project_external_id}</span>
        {request.scope.zone_external_id && <span>Phân khu: {request.scope.zone_external_id}</span>}
        <span>Ngày yêu cầu: {request.data_as_of}</span>
        <span>Quy trình: {run.run.workflow_version ?? 'legacy-v1'}</span>
      </>}
    </div>
  </header>;
}
