import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { ContextTab } from '../../evidence/components/context-tab';
import { EvidenceTab } from '../../evidence/components/evidence-tab';
import { FilesTab } from '../../evidence/components/files-tab';
import { RunTab } from '../../evidence/components/run-tab';
import { EvidenceDetail } from '../../evidence/components/evidence-detail';
import type { useAgentChatController } from '../../agent-chat/hooks/use-agent-chat-controller';
import type { WorkspaceContextState } from '../../workspace/context';
import styles from './grok-workspace.module.css';

type Controller = ReturnType<typeof useAgentChatController>;
type Tab = 'context' | 'evidence' | 'artifacts' | 'details';
const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'context', label: 'Bối cảnh' },
  { id: 'evidence', label: 'Bằng chứng' },
  { id: 'artifacts', label: 'Hiện vật' },
  { id: 'details', label: 'Chi tiết' },
];

export function WorkspaceInspector({ controller, context, organizationName, selectedStage, onArtifact }: {
  controller: Controller;
  context: WorkspaceContextState;
  organizationName: string;
  selectedStage: string | null;
  onArtifact: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('context');
  useEffect(() => { if (selectedStage) setTab('details'); }, [selectedStage]);
  useEffect(() => { if (context.active_evidence_ref) setTab('evidence'); }, [context.active_evidence_ref]);
  const id = useId();
  const detail = controller.currentRunDetail;
  const bundle = detail ? controller.bundle : { artifacts: [], validations: [], sources: [] };
  const artifacts = bundle.artifacts.filter((item) => item.kind !== 'report_draft' && item.kind !== 'review_result');
  const selected = artifacts.find((item) => item.artifact_id === context.active_artifact_id) ?? null;
  const validation = bundle.validations.find((item) => item.artifact_id === selected?.artifact_id) ?? null;
  const noRun = !context.active_run_id;
  const unavailable = controller.readState === 'unavailable';
  const loading = controller.readState === 'loading' || controller.readState === 'error';
  const workflowStatus = controller.workflowStatus;
  const review = controller.canWrite && workflowStatus && workflowStatus.run_id === detail?.run.run_id
    ? workflowStatus.review : null;
  function move(event: KeyboardEvent<HTMLButtonElement>, current: Tab) {
    const index = tabs.findIndex((item) => item.id === current);
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : index;
    if (next === index) return;
    event.preventDefault();
    setTab(tabs[next]!.id);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }
  return <aside className={styles.inspector} aria-label="Bối cảnh và bằng chứng">
    <div className={styles.inspectorTabs} role="tablist" aria-label="Thông tin lượt chạy">
      {tabs.map((item) => <button key={item.id} type="button" id={`${id}-${item.id}-tab`} role="tab" aria-selected={tab === item.id} aria-controls={`${id}-panel`} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)} onKeyDown={(event) => move(event, item.id)}>{item.label}</button>)}
    </div>
    <div className={styles.inspectorBody} id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}-tab`}>
      {tab === 'context' && <ContextTab organizationName={organizationName} context={context} detail={detail} noRun={noRun} unavailable={unavailable} loading={loading} />}
      {tab === 'evidence' && <>
        <EvidenceTab noRun={noRun} unavailable={unavailable} loading={loading} artifactsUnavailable={false} artifacts={artifacts} validations={bundle.validations} selectedArtifact={selected} selectedValidation={validation} context={context} />
        {selected && <EvidenceDetail artifact={selected} validation={validation} artifacts={artifacts} sources={bundle.sources} path={context.active_evidence_ref?.artifact_id === selected.artifact_id ? context.active_evidence_ref.evidence_path : null} onSelect={onArtifact} />}
        <FilesTab noRun={noRun} unavailable={unavailable} loading={loading} artifactsUnavailable={false} sources={bundle.sources} />
      </>}
      {tab === 'artifacts' && (artifacts.length ? <ul className={styles.artifacts}>{artifacts.map((item) => <li key={item.artifact_id}>
        <button type="button" onClick={() => { onArtifact(item.artifact_id); setTab('evidence'); }}>
          <strong>{item.kind.replaceAll('_', ' ')}</strong>
          <span>{bundle.validations.find((entry) => entry.artifact_id === item.artifact_id)?.valid ? 'Đã xác thực' : 'Chưa có xác nhận'}</span>
        </button>
      </li>)}</ul> : <p>Chưa có hiện vật được phép xem.</p>)}
      {tab === 'details' && <>
        <RunTab noRun={noRun} unavailable={unavailable} loading={loading} detail={detail} panelId={id} />
        {selectedStage && <p>Đang xem giai đoạn: {detail?.tasks.find((task) => task.task_id === selectedStage)?.kind ?? 'Không khả dụng'}</p>}
        {review && <p>Rà soát bản nháp {review.draft_revision}: {review.status}</p>}
        {controller.agentExecution &&
          (detail ? controller.agentExecution.job.run_id === detail.run.run_id : controller.agentExecution.job.run_id === null && controller.agentExecution.job.conversation_id === controller.selectedConversationId) &&
          <section className={styles.executionTrace} aria-label="Dấu vết thực thi nội bộ">
            <h3>Thực thi nội bộ</h3>
            <p>Tác vụ {controller.agentExecution.job.job_id} · {controller.agentExecution.job.status}</p>
            {controller.agentExecution.invocations.length > 0 && <ul>{controller.agentExecution.invocations.map((invocation) =>
              <li key={invocation.invocation_id}>{invocation.agent_key} · {invocation.status}</li>)}</ul>}
            {controller.agentExecution.events.length > 0 && <ol>{controller.agentExecution.events.map((event) =>
              <li key={event.event_id}>{event.type} · <time dateTime={event.created_at}>{event.created_at}</time></li>)}</ol>}
          </section>}
      </>}
    </div>
  </aside>;
}
