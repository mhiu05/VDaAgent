'use client';

import { CircleAlert, RefreshCw } from 'lucide-react';
import { AnalysisResult } from '../analysis/components/analysis-result';
import { EvidenceDrawer } from '../evidence/components/evidence';
import { Composer } from './composer';
import { ActivityTimeline } from './activity-timeline';
import { ConversationList } from './conversation-list';
import { MessageThread } from './message-thread';
import { RunProgress } from './run-progress';
import { WorkflowCheckpointStatus } from './workflow-checkpoint-status';
import { AgentExecutionInspector } from './agent-execution-inspector';
import { useAgentChatController } from './hooks/use-agent-chat-controller';

export function AgentChat(props: Parameters<typeof useAgentChatController>[0]) {
  const {
    catalog, canWrite, capabilityMode, focusComposerRequest,
    onWorkspaceAction, onReport, onClearExternalRun,
  } = props;
  const {
    showConversationList, conversations, conversationCursor, selectedConversationId,
    loadingConversations, loadConversations, messages, messageCursor, loadingMessages,
    loadMessages, project, zone, dataAsOf, updateProject, updateZone,
    updateDataAsOf, visibleRunId, currentRunDetail, workflowStatus, bundle,
    brief, decision, briefStatus, detailsLoading, selectedArtifact, setEvidenceId,
    loadRunArtifacts, openEvidence, scheduledReadOnly, draft, setDraft,
    agentTarget, setAgentTarget, busy, retryTurn, activity, submit,
    submitSignalAction, agentExecution, selectedAgent, setSelectedAgent,
    reportId, cancelling, error, setError, runMessageId, workspaceControlled,
    selectConversation, newConversation, cancelRun, updateActiveRun, setRunMessageId, selectRun,
  } = useAgentChatController(props);
  return (
    <div className="agent-chat-layout">
      {showConversationList && <ConversationList
          conversations={conversations}
          selectedId={selectedConversationId}
          loading={loadingConversations}
          hasMore={conversationCursor !== null}
          onNew={newConversation}
          onSelect={selectConversation}
          onLoadMore={() => conversationCursor && void loadConversations(conversationCursor, true)}
          execution={agentExecution}
          selectedAgent={selectedAgent}
          onSelectAgent={setSelectedAgent}
          showConversations={showConversationList}
        />}
      <div className="agent-chat-main">
        {!showConversationList && (
          <div className="agent-chat-compact-controls">
            <button className="text-button" onClick={newConversation}>
              Hội thoại mới
            </button>
          </div>
        )}
        {error && (
          <div className="error-box" role="alert">
            <CircleAlert size={18} />
            <div>{error}</div>
            {retryTurn ? (
              <button className="text-button" disabled={busy} onClick={() => void submit()}>
                <RefreshCw size={13} /> Thử lại
              </button>
            ) : (
              <button className="text-button" onClick={() => setError('')}>
                Đóng
              </button>
            )}
          </div>
        )}
        {currentRunDetail && (
          <RunProgress
            detail={currentRunDetail}
            canWrite={canWrite && !scheduledReadOnly}
            cancelling={cancelling}
            onCancel={() => void cancelRun()}
          />
        )}
        <ActivityTimeline events={activity} />
        {currentRunDetail && workflowStatus && <WorkflowCheckpointStatus status={workflowStatus} />}
        <MessageThread
          messages={messages}
          loading={loadingMessages}
          hasEarlier={messageCursor !== null}
          onLoadEarlier={() =>
            selectedConversationId &&
            messageCursor &&
            void loadMessages(selectedConversationId, messageCursor, true)
          }
          onOpenRun={(id, messageId) => {
            selectRun(id, messageId);
          }}
          onOpenReport={(id) => onReport?.(id)}
          onOpenArtifact={(artifactRunId, artifactId) => {
            selectRun(artifactRunId);
            setRunMessageId(null);
            void openEvidence(artifactId, artifactRunId);
          }}
          onWorkspaceAction={onWorkspaceAction}
        />
        {!workspaceControlled && currentRunDetail?.run.status === 'succeeded' && (
          <div
            className="agent-run-result"
            data-agent-message-id={runMessageId ?? undefined}
            data-run-id={visibleRunId}
          >
            <AnalysisResult
              artifacts={bundle.artifacts}
              decision={decision}
              brief={brief}
              briefStatus={briefStatus}
              detailsLoading={detailsLoading}
              onEvidence={(id) => void openEvidence(id)}
              onLoadDetails={() => void loadRunArtifacts()}
              onInspectSignal={(signalRunId, signalId) =>
                void submitSignalAction(signalRunId, signalId, 'inspect')
              }
              onAnalyzeSegment={(signalRunId, signalId) =>
                void submitSignalAction(signalRunId, signalId, 'analyze_segment')
              }
              canInspect={canWrite && !scheduledReadOnly}
              onReport={reportId && onReport ? () => onReport(reportId) : undefined}
            />
          </div>
        )}
        <Composer
          catalog={catalog}
          canWrite={canWrite}
          project={project}
          zone={zone}
          dataAsOf={dataAsOf}
          capabilityMode={capabilityMode}
          focusRequest={focusComposerRequest}
          showAgentTarget={capabilityMode === undefined}
          draft={draft}
          busy={busy}
          agentTarget={agentTarget}
          scheduledReadOnly={scheduledReadOnly}
          onProject={updateProject}
          onZone={updateZone}
          onDate={updateDataAsOf}
          onDraft={setDraft}
          onAgentTarget={setAgentTarget}
          onSubmit={() => void submit()}
        />
      </div>
      {selectedConversationId && (
        <AgentExecutionInspector
          snapshot={agentExecution}
          selectedAgent={selectedAgent}
          tasks={currentRunDetail?.tasks ?? []}
          artifacts={agentExecution?.job.run_id === visibleRunId ? bundle.artifacts : []}
          reportId={reportId}
          onRun={(id) => { onClearExternalRun?.(); updateActiveRun(id); }}
          onArtifact={(id, artifactId) => { onClearExternalRun?.(); updateActiveRun(id); void openEvidence(artifactId,id); }}
          onReport={onReport}
        />
      )}
      {!workspaceControlled && selectedArtifact && (
        <EvidenceDrawer
          artifact={selectedArtifact}
          artifacts={bundle.artifacts}
          validations={bundle.validations}
          sources={bundle.sources}
          onSelect={setEvidenceId}
          onClose={() => setEvidenceId(null)}
        />
      )}
    </div>
  );
}
