import { useLayoutEffect } from 'react';
import { CircleAlert, RefreshCw } from 'lucide-react';
import type { Catalog, WorkspaceActionV1 } from '@vda/contracts';
import { ActivityTimeline } from '../../agent-chat/activity-timeline';
import { Composer } from '../../agent-chat/composer';
import { MessageThread } from '../../agent-chat/message-thread';
import { RunProgress } from '../../agent-chat/run-progress';
import { WorkflowCheckpointStatus } from '../../agent-chat/workflow-checkpoint-status';
import type { useAgentChatController } from '../../agent-chat/hooks/use-agent-chat-controller';
import { InlineRunOutput } from '../../analysis/components/inline-run-output';
import { DecisionResultSummary } from '../../analysis/components/decision-result-summary';
import { ReportArtifactRow } from '../../reports/components/report-artifact-row';
import { WorkspaceHeader } from './workspace-header';
import { useTimelineScroll } from '../hooks/use-timeline-scroll';
import styles from './grok-workspace.module.css';

type Controller = ReturnType<typeof useAgentChatController>;

export function WorkspaceConversation({
  controller,
  catalog,
  organizationName,
  directRun,
  onWorkspaceAction,
  onOpenRail,
  onOpenInspector,
}: {
  controller: Controller;
  catalog: Catalog;
  organizationName: string;
  directRun: boolean;
  onWorkspaceAction: (action: WorkspaceActionV1) => void;
  onOpenRail: () => void;
  onOpenInspector: () => void;
}) {
  const chat = controller;
  const timelineKey = [
    chat.selectedConversationId,
    ...chat.messages.map((message) => `${message.message_id}:${message.updated_at}`),
    ...chat.activity.map((event) => event.sequence),
    ...(chat.currentRunDetail?.tasks ?? []).map((task) => `${task.task_id}:${task.status}`),
    ...chat.bundle.artifacts.map((artifact) => artifact.artifact_id),
    chat.reportDetail?.report.report_id,
  ].join('|');
  const {
    element: timelineElement, hasNewUpdates, onScroll, beforeEarlier,
    afterOwnSubmission, scrollToLatest, scrollToStart,
  } = useTimelineScroll(timelineKey);
  const loadedRunId = chat.currentRunDetail?.run.run_id;
  useLayoutEffect(() => {
    if (directRun && loadedRunId) scrollToStart();
  }, [directRun, loadedRunId, scrollToStart]);
  return <section className={styles.conversation} aria-label="Không gian hội thoại">
    <WorkspaceHeader
      conversation={chat.selectedConversation}
      run={chat.currentRunDetail}
      job={chat.agentExecution}
      organizationName={organizationName}
      canCancel={chat.canWrite && !chat.scheduledReadOnly}
      cancelling={chat.cancelling}
      onCancel={() => void chat.cancelRun()}
      onCancelJob={() => void chat.cancelJob()}
      onOpenRail={onOpenRail}
      onOpenInspector={onOpenInspector}
    />
    <div className={styles.timeline} ref={timelineElement} onScroll={onScroll}>
      {chat.readState === 'stale' && <p className={styles.stale} role="status">Kết nối tạm gián đoạn. Đang thử cập nhật lượt chạy đã chọn.</p>}
      {chat.error && <div className="error-box" role="alert"><CircleAlert size={18} /><span>{chat.error}</span>
        {chat.retryTurn ? <button type="button" className="text-button" disabled={chat.busy} onClick={() => void chat.submit()}><RefreshCw size={14} /> Thử lại yêu cầu gốc</button>
          : <button type="button" className="text-button" onClick={() => chat.setError('')}>Đóng</button>}
      </div>}
      {chat.currentRunDetail && <RunProgress detail={chat.currentRunDetail} canWrite={false} cancelling={false} onCancel={() => {}} compact />}
      <ActivityTimeline events={chat.activity} />
      {chat.workflowStatus && chat.canWrite && <WorkflowCheckpointStatus status={chat.workflowStatus} />}
      <MessageThread
        messages={chat.messages}
        loading={chat.loadingMessages}
        hasEarlier={chat.messageCursor !== null}
        onLoadEarlier={() => { if (chat.selectedConversationId && chat.messageCursor) { beforeEarlier(); void chat.loadMessages(chat.selectedConversationId, chat.messageCursor, true); } }}
        onOpenRun={(id, messageId) => { chat.selectRun(id, messageId); scrollToStart(); }}
        onOpenReport={(id) => chat.onReport?.(id)}
        onOpenArtifact={(runId, id) => { chat.selectRun(runId); void chat.openEvidence(id, runId); }}
        onWorkspaceAction={onWorkspaceAction}
      />
      {chat.currentRunDetail && <InlineRunOutput
        orgId={chat.orgId}
        runId={chat.currentRunDetail.run.run_id}
        tasks={chat.currentRunDetail.tasks}
        artifacts={chat.bundle.artifacts}
        validations={chat.bundle.validations}
        onEvidence={(artifactId, path) => onWorkspaceAction({
          type: 'open_evidence', run_id: chat.currentRunDetail!.run.run_id,
          artifact_id: artifactId, evidence_path: path,
        })}
      />}
      {chat.currentRunDetail?.run.status === 'succeeded' && <DecisionResultSummary
        runId={chat.currentRunDetail.run.run_id}
        decision={chat.decision}
        brief={chat.brief}
        onEvidence={(artifactId, path) => onWorkspaceAction({ type: 'open_evidence', run_id: chat.currentRunDetail!.run.run_id, artifact_id: artifactId, evidence_path: path })}
      />}
      {chat.currentRunDetail?.run.status === 'succeeded' && chat.reportDetail && <ReportArtifactRow
        orgId={chat.orgId}
        runId={chat.currentRunDetail.run.run_id}
        detail={chat.reportDetail}
        onOpen={(id) => chat.onReport?.(id)}
      />}
    </div>
    {hasNewUpdates && <button type="button" className={styles.newUpdates} onClick={scrollToLatest}>Có cập nhật mới</button>}
    <div className={styles.composer}>
      <Composer
        compact
        catalog={catalog}
        canWrite={chat.canWrite}
        project={chat.project}
        zone={chat.zone}
        dataAsOf={chat.dataAsOf}
        capabilityMode={chat.capabilityMode}
        focusRequest={chat.focusComposerRequest}
        draft={chat.draft}
        busy={chat.busy}
        agentTarget={chat.agentTarget}
        scheduledReadOnly={chat.scheduledReadOnly}
        onProject={chat.updateProject}
        onZone={chat.updateZone}
        onDate={chat.updateDataAsOf}
        onDraft={chat.setDraft}
        onAgentTarget={chat.setAgentTarget}
        onSubmit={() => { afterOwnSubmission(); void chat.submit(); }}
      />
    </div>
  </section>;
}
