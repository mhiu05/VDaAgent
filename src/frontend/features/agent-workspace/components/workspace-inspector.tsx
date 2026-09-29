import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import type { AgentKey } from '@vda/contracts';
import { agentIdentity } from '../../../components/agents/agent-identity';
import { canonicalAgentKey } from '../../agent-chat/agent-workspace-model';
import { agentExecutionEventLabel, workflowStatusLabel } from '../../../lib/format/status-label';
import { ContextTab } from '../../evidence/components/context-tab';
import { EvidenceTab } from '../../evidence/components/evidence-tab';
import { FilesTab } from '../../evidence/components/files-tab';
import { RunTab } from '../../evidence/components/run-tab';
import { EvidenceDetail } from '../../evidence/components/evidence-detail';
import { projectQueryUsage } from '../../evidence/query-usage';
import { RuntimeTree } from './runtime-tree';
import { WorkflowCheckpointStatus } from '../../agent-chat/workflow-checkpoint-status';
import type { useAgentChatController } from '../../agent-chat/hooks/use-agent-chat-controller';
import type { WorkspaceContextState } from '../../workspace/context';
import { ThreadContextControls } from './thread-context-controls';
import styles from './agent-workspace.module.css';

type Controller = ReturnType<typeof useAgentChatController>;
type Tab = 'context' | 'evidence' | 'run';
const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'context', label: 'Ngữ cảnh' },
  { id: 'run', label: 'Lượt chạy' },
  { id: 'evidence', label: 'Bằng chứng' },
];

function InvocationIdentity({ agentKey }: { agentKey: string }) {
  const identity = agentIdentity(canonicalAgentKey(agentKey) as AgentKey);
  const Icon = identity?.icon;
  return (
    <>
      {Icon && <Icon size={15} aria-hidden={true} />}
      {identity?.label ?? agentKey}
    </>
  );
}

export function WorkspaceInspector({
  controller,
  context,
  organizationName,
  onArtifact,
}: {
  controller: Controller;
  context: WorkspaceContextState;
  organizationName: string;
  onArtifact: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('context');
  const runActive =
    controller.currentRunDetail?.run.status === 'running' ||
    controller.currentRunDetail?.run.status === 'queued';
  useEffect(() => {
    if (runActive) setTab('run');
  }, [runActive]);
  useEffect(() => {
    if (context.active_evidence_ref) setTab('evidence');
  }, [context.active_evidence_ref]);
  const id = useId();
  const detail = controller.currentRunDetail;
  const bundle = detail ? controller.bundle : { artifacts: [], validations: [], sources: [] };
  const artifacts = bundle.artifacts.filter(
    (item) => item.kind !== 'report_draft' && item.kind !== 'review_result',
  );
  const selected =
    artifacts.find((item) => item.artifact_id === context.active_artifact_id) ?? null;
  const validation =
    bundle.validations.find((item) => item.artifact_id === selected?.artifact_id) ?? null;
  const noRun = !context.active_run_id;
  const unavailable = controller.readState === 'unavailable';
  const loading = controller.readState === 'loading' || controller.readState === 'error';
  const queryUsage =
    detail && !unavailable && !loading
      ? projectQueryUsage(detail.run, artifacts, bundle.validations)
      : null;
  const workflowStatus = controller.workflowStatus;
  const review =
    controller.canWrite && workflowStatus && workflowStatus.run_id === detail?.run.run_id
      ? workflowStatus.review
      : null;
  const executionErrorCode =
    controller.agentExecution?.job.error_code ??
    [...(controller.agentExecution?.events ?? [])].reverse().find((event) => event.data.error_code)
      ?.data.error_code;
  const measuredContexts = controller.runtime.snapshot.records.filter(
    (record) => record.kind === 'invocation' && record.context_tokens !== undefined,
  );
  function move(event: KeyboardEvent<HTMLButtonElement>, current: Tab) {
    const index = tabs.findIndex((item) => item.id === current);
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index + tabs.length - 1) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : index;
    if (next === index) return;
    event.preventDefault();
    setTab(tabs[next]!.id);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  }
  return (
    <aside className={styles.inspector} aria-label="Bối cảnh và bằng chứng">
      <div className={styles.inspectorTabs} role="tablist" aria-label="Thông tin lượt chạy">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            id={`${id}-${item.id}-tab`}
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`${id}-panel`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => move(event, item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        className={styles.inspectorBody}
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-${tab}-tab`}
      >
        {tab === 'context' && (
          <>
            <section className={styles.inspectorContextControls}>
              <h3>Ngữ cảnh hội thoại</h3>
              <ThreadContextControls chat={controller} />
            </section>
            <ContextTab
              organizationName={organizationName}
              context={context}
              detail={detail}
              noRun={noRun}
              unavailable={unavailable}
              loading={loading}
            />
            <section className={styles.contextSummary}>
              <h3>Ngữ cảnh hội thoại</h3>
              <dl>
                <dt>Tập dữ liệu</dt>
                <dd>
                  {controller.threadWorkspace.context.dataset_ids.length
                    ? controller.threadWorkspace.context.dataset_ids
                        .map(
                          (id) =>
                            controller.threadWorkspace.datasets.find(
                              (dataset) => dataset.import_id === id,
                            )?.source_name ?? id.slice(0, 12),
                        )
                        .join(', ')
                    : 'Ảnh chụp dữ liệu dự án'}
                </dd>
                <dt>Phạm vi phân tích</dt>
                <dd>
                  {controller.project || 'Không có'} · {controller.dataAsOf || 'Chưa có dữ liệu'}
                </dd>
                <dt>Báo cáo đang chọn</dt>
                <dd>
                  {controller.threadWorkspace.context.active_report_id?.slice(0, 12) ??
                    'Chưa chọn báo cáo'}
                </dd>
                <dt>Bằng chứng đang chọn</dt>
                <dd>
                  {controller.threadWorkspace.context.active_artifact_id?.slice(0, 12) ??
                    'Không có'}
                </dd>
                <dt>Bằng chứng đã tham chiếu</dt>
                <dd>{controller.threadWorkspace.context.referenced_artifact_ids.length}</dd>
                <dt>Tham chiếu cho tin nhắn tiếp theo</dt>
                <dd>{controller.messageContextRefs.length}</dd>
                {measuredContexts.length > 0 && (
                  <>
                    <dt>Ngữ cảnh ước tính</dt>
                    <dd>
                      {measuredContexts
                        .reduce((sum, record) => sum + (record.context_tokens ?? 0), 0)
                        .toLocaleString()}{' '}
                      token trong {measuredContexts.length} lượt tác nhân
                    </dd>
                  </>
                )}
              </dl>
            </section>
            <section className={styles.contextSummary}>
              <h3>Ghi nhớ</h3>
              {(['working', 'episodic', 'workspace'] as const).map((layer) => {
                const items = controller.threadWorkspace.memory.filter(
                  (item) => item.layer === layer,
                );
                return (
                  <details key={layer}>
                    <summary>
                      {layer === 'workspace'
                        ? 'Kiến thức chung'
                        : layer === 'working'
                          ? 'Ghi nhớ đang dùng'
                          : 'Ghi nhớ theo lượt'}{' '}
                      · {items.length}
                    </summary>
                    {items.map((item) => (
                      <p key={item.memory_id}>{item.summary}</p>
                    ))}
                  </details>
                );
              })}
            </section>
            <section className={styles.contextSummary}>
              <h3>Bằng chứng</h3>
              {artifacts.length ? (
                <ul className={styles.artifacts}>
                  {artifacts.map((item) => (
                    <li key={item.artifact_id}>
                      <button
                        type="button"
                        onClick={() => {
                          onArtifact(item.artifact_id);
                          setTab('evidence');
                        }}
                      >
                        <strong>{item.kind.replaceAll('_', ' ')}</strong>
                        <span>{item.artifact_id.slice(0, 12)}</span>
                      </button>
                      {controller.canWrite &&
                        bundle.validations.some(
                          (validation) =>
                            validation.artifact_id === item.artifact_id && validation.valid,
                        ) && (
                          <button
                            type="button"
                            disabled={controller.threadWorkspace.saving}
                            aria-pressed={
                              controller.threadWorkspace.context.active_artifact_id ===
                              item.artifact_id
                            }
                            onClick={() =>
                              void controller.threadWorkspace.update({
                                active_artifact_id: item.artifact_id,
                                active_report_id: null,
                                referenced_artifact_ids: [],
                              })
                            }
                          >
                            Dùng làm ngữ cảnh hội thoại
                          </button>
                        )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Lượt chạy này chưa có bằng chứng.</p>
              )}
            </section>
          </>
        )}
        {tab === 'evidence' && (
          <>
            <EvidenceTab
              noRun={noRun}
              unavailable={unavailable}
              loading={loading}
              artifactsUnavailable={false}
              artifacts={artifacts}
              validations={bundle.validations}
              selectedArtifact={selected}
              selectedValidation={validation}
              context={context}
            />
            {selected && (
              <EvidenceDetail
                artifact={selected}
                validation={validation}
                artifacts={artifacts}
                sources={bundle.sources}
                path={
                  context.active_evidence_ref?.artifact_id === selected.artifact_id
                    ? context.active_evidence_ref.evidence_path
                    : null
                }
                onSelect={onArtifact}
              />
            )}
            <FilesTab
              noRun={noRun}
              unavailable={unavailable}
              loading={loading}
              artifactsUnavailable={false}
              sources={bundle.sources}
            />
          </>
        )}
        {tab === 'run' && (
          <>
            <div className={styles.runHeading}>
              <h3>Lượt chạy hiện tại</h3>
              <span data-status={detail?.run.status}>
                {workflowStatusLabel(
                  detail?.run.status ?? controller.agentExecution?.job.status ?? 'idle',
                )}
              </span>
            </div>
            {detail && (
              <>
                <code>{detail.run.run_id}</code>
                <p className={styles.railHint}>
                  Bắt đầu {new Date(detail.run.created_at).toLocaleTimeString()} ·{' '}
                  {workflowStatusLabel(controller.runtime.connection)}
                </p>
                {detail.run.error_code && (
                  <p>
                    <strong>Mã lỗi an toàn</strong> <code>{detail.run.error_code}</code>
                  </p>
                )}
              </>
            )}
            {detail && (
              <p>
                <strong>Truy vấn đã dùng</strong>{' '}
                {queryUsage ? (
                  <span title="Truy vấn có kết quả đã xác thực / truy vấn đã lưu">
                    {queryUsage.used} / {queryUsage.total}
                  </span>
                ) : (
                  <span>Chưa có thông tin truy vấn đã xác thực.</span>
                )}
              </p>
            )}
            {controller.runtime.snapshot.records.length > 0 ? (
              <RuntimeTree
                records={controller.runtime.snapshot.records}
                agents={controller.threadWorkspace.agents}
              />
            ) : (
              <RunTab
                noRun={noRun}
                unavailable={unavailable}
                loading={loading}
                detail={detail}
                panelId={id}
              />
            )}
            {review && (
              <p>
                Rà soát bản nháp {review.draft_revision}:{' '}
                {workflowStatusLabel(review.status.toLowerCase())}
              </p>
            )}
            {controller.workflowStatus && controller.canWrite && (
              <WorkflowCheckpointStatus
                status={controller.workflowStatus}
                runStatus={detail?.run.status}
              />
            )}
            {controller.agentExecution &&
              (detail
                ? controller.agentExecution.job.run_id === detail.run.run_id
                : controller.agentExecution.job.run_id === null &&
                  controller.agentExecution.job.conversation_id ===
                    controller.selectedConversationId) && (
                <section className={styles.executionTrace} aria-label="Dấu vết thực thi nội bộ">
                  <h3>Thực thi nội bộ</h3>
                  <p>
                    Tác vụ {controller.agentExecution.job.job_id} ·{' '}
                    {workflowStatusLabel(controller.agentExecution.job.status)}
                  </p>
                  {executionErrorCode && (
                    <p>
                      <strong>Mã lỗi an toàn</strong> <code>{executionErrorCode}</code>
                    </p>
                  )}
                  {controller.agentExecution.invocations.length > 0 && (
                    <ul>
                      {controller.agentExecution.invocations.map((invocation) => (
                        <li key={invocation.invocation_id}>
                          <InvocationIdentity agentKey={invocation.agent_key} /> ·{' '}
                          {workflowStatusLabel(invocation.status)}
                        </li>
                      ))}
                    </ul>
                  )}
                  {controller.agentExecution.events.length > 0 && (
                    <details>
                      <summary>Sự kiện thực thi</summary>
                      <ol>
                        {controller.agentExecution.events.map((event) => (
                          <li key={event.event_id}>
                            {agentExecutionEventLabel(event.type)} ·{' '}
                            <time dateTime={event.created_at}>{event.created_at}</time>
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                </section>
              )}
          </>
        )}
      </div>
    </aside>
  );
}
