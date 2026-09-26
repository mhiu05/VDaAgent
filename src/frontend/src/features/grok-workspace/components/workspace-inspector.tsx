import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { ContextTab } from '../../evidence/components/context-tab';
import { EvidenceTab } from '../../evidence/components/evidence-tab';
import { FilesTab } from '../../evidence/components/files-tab';
import { RunTab } from '../../evidence/components/run-tab';
import { EvidenceDetail } from '../../evidence/components/evidence-detail';
import { RuntimeTree } from './runtime-tree';
import { WorkflowCheckpointStatus } from '../../agent-chat/workflow-checkpoint-status';
import type { useAgentChatController } from '../../agent-chat/hooks/use-agent-chat-controller';
import type { WorkspaceContextState } from '../../workspace/context';
import styles from './grok-workspace.module.css';

type Controller = ReturnType<typeof useAgentChatController>;
type Tab = 'context' | 'evidence' | 'run';
const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'run', label: 'Run' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'context', label: 'Context' },
];

export function WorkspaceInspector({ controller, context, organizationName, onArtifact }: {
  controller: Controller;
  context: WorkspaceContextState;
  organizationName: string;
  onArtifact: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('run');
  const runActive = controller.currentRunDetail?.run.status === 'running' || controller.currentRunDetail?.run.status === 'queued';
  useEffect(() => { if (runActive) setTab('run'); }, [runActive]);
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
  const measuredContexts = controller.runtime.snapshot.records.filter((record) => record.kind === 'invocation' && record.context_tokens !== undefined);
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
      {tab === 'context' && <>
        <ContextTab organizationName={organizationName} context={context} detail={detail} noRun={noRun} unavailable={unavailable} loading={loading} />
        <section className={styles.contextSummary}><h3>Thread context</h3><dl>
          <dt>Dataset</dt><dd>{controller.threadWorkspace.context.dataset_ids.length
            ? controller.threadWorkspace.context.dataset_ids.map((id) => controller.threadWorkspace.datasets.find((dataset) => dataset.import_id === id)?.source_name ?? id.slice(0, 12)).join(', ')
            : 'Project snapshots'}</dd>
          <dt>Analysis scope</dt><dd>{controller.project || 'None'} · {controller.dataAsOf || 'No snapshot'}</dd>
          <dt>Active report</dt><dd>{controller.threadWorkspace.context.active_report_id?.slice(0, 12) ?? 'No report context'}</dd>
          <dt>Active artifact</dt><dd>{controller.threadWorkspace.context.active_artifact_id?.slice(0, 12) ?? 'None'}</dd>
          <dt>Referenced artifacts</dt><dd>{controller.threadWorkspace.context.referenced_artifact_ids.length}</dd>
          <dt>Next message references</dt><dd>{controller.messageContextRefs.length}</dd>
          {measuredContexts.length > 0 && <><dt>Estimated context</dt><dd>{measuredContexts.reduce((sum, record) => sum + (record.context_tokens ?? 0), 0).toLocaleString()} tokens across {measuredContexts.length} invocations</dd></>}
        </dl></section>
        <section className={styles.contextSummary}><h3>Memory</h3>
          {(['working', 'episodic', 'workspace'] as const).map((layer) => {
            const items = controller.threadWorkspace.memory.filter((item) => item.layer === layer);
            return <details key={layer}><summary>{layer === 'workspace' ? 'Workspace knowledge' : `${layer[0]!.toUpperCase()}${layer.slice(1)} memory`} · {items.length}</summary>{items.map((item) => <p key={item.memory_id}>{item.summary}</p>)}</details>;
          })}
        </section>
        <section className={styles.contextSummary}><h3>Artifacts</h3>{artifacts.length ? <ul className={styles.artifacts}>{artifacts.map((item) => <li key={item.artifact_id}>
          <button type="button" onClick={() => { onArtifact(item.artifact_id); setTab('evidence'); }}><strong>{item.kind.replaceAll('_', ' ')}</strong><span>{item.artifact_id.slice(0, 12)}</span></button>
          {controller.canWrite && bundle.validations.some((validation) => validation.artifact_id === item.artifact_id && validation.valid) && <button type="button" disabled={controller.threadWorkspace.saving} aria-pressed={controller.threadWorkspace.context.active_artifact_id === item.artifact_id} onClick={() => void controller.threadWorkspace.update({ active_artifact_id: item.artifact_id, active_report_id: null, referenced_artifact_ids: [] })}>Use as thread context</button>}
        </li>)}</ul> : <p>No artifacts in this run yet.</p>}</section>
      </>}
      {tab === 'evidence' && <>
        <EvidenceTab noRun={noRun} unavailable={unavailable} loading={loading} artifactsUnavailable={false} artifacts={artifacts} validations={bundle.validations} selectedArtifact={selected} selectedValidation={validation} context={context} />
        {selected && <EvidenceDetail artifact={selected} validation={validation} artifacts={artifacts} sources={bundle.sources} path={context.active_evidence_ref?.artifact_id === selected.artifact_id ? context.active_evidence_ref.evidence_path : null} onSelect={onArtifact} />}
        <FilesTab noRun={noRun} unavailable={unavailable} loading={loading} artifactsUnavailable={false} sources={bundle.sources} />
      </>}
      {tab === 'run' && <>
        <div className={styles.runHeading}><h3>Current run</h3><span data-status={detail?.run.status}>{detail?.run.status ?? controller.agentExecution?.job.status ?? 'Idle'}</span></div>
        {detail && <><code>{detail.run.run_id}</code><p className={styles.railHint}>Started {new Date(detail.run.created_at).toLocaleTimeString()} · {controller.runtime.connection}</p></>}
        {controller.runtime.snapshot.records.length > 0 ? <RuntimeTree records={controller.runtime.snapshot.records} agents={controller.threadWorkspace.agents} /> : <RunTab noRun={noRun} unavailable={unavailable} loading={loading} detail={detail} panelId={id} />}
        {review && <p>Rà soát bản nháp {review.draft_revision}: {review.status}</p>}
        {controller.workflowStatus && controller.canWrite && <WorkflowCheckpointStatus status={controller.workflowStatus} />}
        {controller.agentExecution &&
          (detail ? controller.agentExecution.job.run_id === detail.run.run_id : controller.agentExecution.job.run_id === null && controller.agentExecution.job.conversation_id === controller.selectedConversationId) &&
          <section className={styles.executionTrace} aria-label="Dấu vết thực thi nội bộ">
            <h3>Thực thi nội bộ</h3>
            <p>Tác vụ {controller.agentExecution.job.job_id} · {controller.agentExecution.job.status}</p>
            {controller.agentExecution.invocations.length > 0 && <ul>{controller.agentExecution.invocations.map((invocation) =>
              <li key={invocation.invocation_id}>{invocation.agent_key} · {invocation.status}</li>)}</ul>}
            {controller.agentExecution.events.length > 0 && <details><summary>Execution events</summary><ol>{controller.agentExecution.events.map((event) =>
              <li key={event.event_id}>{event.type} · <time dateTime={event.created_at}>{event.created_at}</time></li>)}</ol></details>}
          </section>}
      </>}
    </div>
  </aside>;
}
