'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleAlert, RefreshCw } from 'lucide-react';
import { z } from 'zod';
import {
  ArtifactListSchema,
  DecisionBriefResponseSchema,
  DecisionIntelligenceResponseSchema,
  RunDetailSchema,
  type AgentKey,
  type AgentWorkflowStatus,
  type Catalog,
  type DecisionBriefResponse,
  type DecisionIntelligenceResponse,
  type AgentTurnRequest,
  type Message,
} from '@vda/contracts';
import {
  ApiError,
  api,
  createTurnIdentity,
  errorMessage,
  getAgentWorkflowStatus,
  listConversationMessages,
  listConversations,
  post,
  scoped,
  sendTurn,
  type TurnRequestIdentity,
} from '../../lib/client-api';
import { AnalysisResult } from '../analysis-result';
import { EvidenceDrawer } from '../evidence';
import { Composer } from './composer';
import { ConversationList } from './conversation-list';
import { MessageThread } from './message-thread';
import { isReadOnlyRunView } from './run-view';
import { RunProgress } from './run-progress';
import { WorkflowCheckpointStatus } from './workflow-checkpoint-status';

type RunDetail = z.infer<typeof RunDetailSchema>;
type ArtifactList = z.infer<typeof ArtifactListSchema>;
type TurnInput = Omit<AgentTurnRequest, 'org_id' | 'client_turn_id'>;
type RetryTurn = {
  input: TurnInput;
  identity: TurnRequestIdentity;
  conversationId?: string;
};

const terminalStatuses = new Set(['succeeded', 'failed', 'cancelled']);

export function AgentChat({
  orgId,
  catalog,
  canWrite,
  externalRunId,
  onClearExternalRun,
  onReport,
}: {
  orgId: string;
  catalog: Catalog;
  canWrite: boolean;
  externalRunId?: string | null;
  onClearExternalRun?: () => void;
  onReport?: (reportId: string) => void;
}) {
  const [conversations, setConversations] = useState<
    Awaited<ReturnType<typeof listConversations>>['conversations']
  >([]);
  const [conversationCursor, setConversationCursor] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageCursor, setMessageCursor] = useState<string | null>(null);
  const [project, setProject] = useState(catalog.projects[0]?.project_external_id ?? '');
  const [zone, setZone] = useState('');
  const [dataAsOf, setDataAsOf] = useState(catalog.latest_snapshot_date ?? '');
  const [draft, setDraft] = useState('');
  const [agentTarget, setAgentTarget] = useState<AgentKey | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [runMessageId, setRunMessageId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [workflowStatus, setWorkflowStatus] = useState<AgentWorkflowStatus | null>(null);
  const [bundle, setBundle] = useState<ArtifactList>({
    artifacts: [],
    validations: [],
    sources: [],
  });
  const [brief, setBrief] = useState<DecisionBriefResponse | null>(null);
  const [decision, setDecision] = useState<DecisionIntelligenceResponse | null>(null);
  const [briefStatus, setBriefStatus] = useState<'idle' | 'loading' | 'available' | 'unavailable'>(
    'idle',
  );
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [retryTurn, setRetryTurn] = useState<RetryTurn | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setProject((value) =>
      catalog.projects.some((item) => item.project_external_id === value)
        ? value
        : (catalog.projects[0]?.project_external_id ?? ''),
    );
    setDataAsOf((value) => value || catalog.latest_snapshot_date || '');
  }, [catalog]);

  const loadConversations = useCallback(
    async (cursor: string | null, append: boolean) => {
      setLoadingConversations(true);
      try {
        const page = await listConversations(orgId, { limit: 30, cursor });
        setConversations((current) =>
          append ? [...current, ...page.conversations] : page.conversations,
        );
        setConversationCursor(page.next_cursor);
        return page;
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setLoadingConversations(false);
      }
    },
    [orgId],
  );

  useEffect(() => {
    setSelectedConversationId(null);
    setMessages([]);
    setRunId(null);
    setRunMessageId(null);
    setRunDetail(null);
    setRunMessageId(null);
    setBundle({ artifacts: [], validations: [], sources: [] });
    setBrief(null);
    setDecision(null);
    setBriefStatus('idle');
    setError('');
    void loadConversations(null, false).then((page) => {
      if (!externalRunId && page?.conversations[0]) {
        setSelectedConversationId(page.conversations[0].conversation_id);
      }
    });
  }, [externalRunId, loadConversations, orgId]);

  const loadMessages = useCallback(
    async (conversationId: string, cursor: string | null, appendEarlier: boolean) => {
      setLoadingMessages(true);
      try {
        const page = await listConversationMessages(orgId, conversationId, { limit: 30, cursor });
        setMessages((current) => (appendEarlier ? [...page.messages, ...current] : page.messages));
        setMessageCursor(page.next_cursor);
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setLoadingMessages(false);
      }
    },
    [orgId],
  );

  useEffect(() => {
    if (!selectedConversationId) return;
    let obsolete = false;
    setMessages([]);
    setMessageCursor(null);
    setRunDetail(null);
    setBundle({ artifacts: [], validations: [], sources: [] });
    setBrief(null);
    setDecision(null);
    setBriefStatus('idle');
    void listConversationMessages(orgId, selectedConversationId, { limit: 30 }).then(
      (page) => {
        if (obsolete) return;
        setMessages(page.messages);
        setMessageCursor(page.next_cursor);
      },
      (cause: unknown) => {
        if (!obsolete) setError(errorMessage(cause));
      },
    );
    return () => {
      obsolete = true;
    };
  }, [orgId, selectedConversationId]);

  useEffect(() => {
    if (externalRunId) {
      setRunId(externalRunId);
      setRunMessageId(null);
      return;
    }
    const latest = [...messages].reverse().find((message) => {
      if (message.role !== 'assistant') return false;
      return message.run_id !== null || message.parts.some((part) => part.type === 'run_ref');
    });
    const referencedRunId =
      latest?.run_id ?? latest?.parts.find((part) => part.type === 'run_ref')?.run_id ?? null;
    if (latest && referencedRunId) {
      setRunId(referencedRunId);
      setRunMessageId(latest.message_id);
    }
  }, [externalRunId, messages]);

  const visibleRunId = externalRunId ?? runId;
  useEffect(() => {
    if (!visibleRunId) setWorkflowStatus(null);
  }, [visibleRunId]);
  const scheduledReadOnly = isReadOnlyRunView(
    externalRunId,
    runDetail?.run ?? null,
    conversations.find((conversation) => conversation.conversation_id === selectedConversationId)
      ?.kind,
  );
  useEffect(() => {
    if (!visibleRunId) return;
    const pollingRunId: string = visibleRunId;
    setBrief(null);
    setDecision(null);
    setBriefStatus('idle');
    setBundle({ artifacts: [], validations: [], sources: [] });
    setWorkflowStatus(null);
    let obsolete = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const detail = await api(scoped(`/runs/${pollingRunId}`, orgId), RunDetailSchema);
        if (obsolete) return;
        setRunDetail(detail);
        if (canWrite && detail.run.workflow_version === 'agent-v1') {
          try {
            const status = await getAgentWorkflowStatus(orgId, pollingRunId);
            if (!obsolete) setWorkflowStatus(status);
          } catch {
            // A checkpoint status failure must never block the durable run view.
            if (!obsolete) setWorkflowStatus(null);
          }
        }
        const conversationId = detail.run.request.conversation_id;
        if (externalRunId && conversationId) {
          if (selectedConversationId !== conversationId) setSelectedConversationId(conversationId);
          void loadMessages(conversationId, null, false);
        }
        if (detail.run.status === 'succeeded') {
          if (!obsolete) setBriefStatus('loading');
          try {
            const nextDecision = await api(
              scoped(`/runs/${pollingRunId}/decision-intelligence`, orgId),
              DecisionIntelligenceResponseSchema,
            );
            if (!obsolete) setDecision(nextDecision);
            if (nextDecision.status === 'available') {
              if (!obsolete) setBriefStatus('available');
            } else {
              const nextBrief = await api(
                scoped(`/runs/${pollingRunId}/brief`, orgId),
                DecisionBriefResponseSchema,
              );
              if (!obsolete) {
                setBrief(nextBrief);
                setBriefStatus('available');
              }
            }
          } catch (cause) {
            if (!(cause instanceof ApiError && cause.status === 404)) throw cause;
            if (!obsolete) setBriefStatus('unavailable');
            const artifacts = await api(
              scoped(`/runs/${pollingRunId}/artifacts`, orgId),
              ArtifactListSchema,
            );
            if (!obsolete) setBundle(artifacts);
          }
          if (!obsolete) {
            void loadConversations(null, false);
            if (selectedConversationId) void loadMessages(selectedConversationId, null, false);
          }
        } else if (terminalStatuses.has(detail.run.status)) {
          if (!obsolete) setBriefStatus('unavailable');
          const artifacts = await api(
            scoped(`/runs/${pollingRunId}/artifacts`, orgId),
            ArtifactListSchema,
          );
          if (!obsolete) setBundle(artifacts);
        } else if (!document.hidden && !obsolete) timer = setTimeout(() => void poll(), 1_100);
        else if (!obsolete) timer = setTimeout(() => void poll(), 5_000);
      } catch (cause) {
        if (!obsolete) setError(errorMessage(cause));
      }
    }
    void poll();
    return () => {
      obsolete = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    canWrite,
    externalRunId,
    loadConversations,
    loadMessages,
    orgId,
    selectedConversationId,
    visibleRunId,
  ]);

  const selectedArtifact = useMemo(
    () => bundle.artifacts.find((artifact) => artifact.artifact_id === evidenceId),
    [bundle.artifacts, evidenceId],
  );
  const reportId = useMemo(() => {
    for (const message of [...messages].reverse())
      for (const part of message.parts) if (part.type === 'report_ref') return part.report_id;
    return null;
  }, [messages]);

  function selectConversation(id: string) {
    onClearExternalRun?.();
    setSelectedConversationId(id);
    setRunId(null);
    setRunMessageId(null);
    setBrief(null);
    setDecision(null);
    setBriefStatus('idle');
    setEvidenceId(null);
    setError('');
  }
  function newConversation() {
    onClearExternalRun?.();
    setSelectedConversationId(null);
    setMessages([]);
    setMessageCursor(null);
    setRunId(null);
    setRunMessageId(null);
    setRunDetail(null);
    setBundle({ artifacts: [], validations: [], sources: [] });
    setBrief(null);
    setDecision(null);
    setBriefStatus('idle');
    setDetailsLoading(false);
    setEvidenceId(null);
    setDraft('');
    setAgentTarget(null);
    setRetryTurn(null);
    setError('');
  }
  async function submit(providedAttempt?: RetryTurn) {
    const attempt = providedAttempt ??
      retryTurn ?? {
        input: {
          text: draft.trim(),
          scope: { project_external_id: project, zone_external_id: zone || null },
          data_as_of: dataAsOf,
          agent_target: agentTarget,
        },
        identity: createTurnIdentity(),
        conversationId: selectedConversationId ?? undefined,
      };
    if (!attempt.input.text || busy || !canWrite || scheduledReadOnly) return;
    setBusy(true);
    setError('');
    try {
      const accepted = await sendTurn(
        orgId,
        attempt.input,
        attempt.identity,
        attempt.conversationId,
      );
      setRetryTurn(null);
      setDraft('');
      setAgentTarget(null);
      setSelectedConversationId(accepted.conversation_id);
      setRunId(accepted.run_id);
      setRunMessageId(accepted.assistant_message_id);
      setRunDetail(null);
      setBundle({ artifacts: [], validations: [], sources: [] });
      setBrief(null);
      setDecision(null);
      setBriefStatus(accepted.run_id ? 'idle' : 'unavailable');
      await loadConversations(null, false);
      await loadMessages(accepted.conversation_id, null, false);
    } catch (cause) {
      setRetryTurn(attempt);
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function submitSignalAction(
    runId: string,
    signalId: string,
    action: Extract<NonNullable<TurnInput['signal_action']>, 'inspect' | 'analyze_segment'>,
  ) {
    if (!canWrite || busy || scheduledReadOnly) return;
    const attempt: RetryTurn = {
      input: {
        text:
          action === 'inspect'
            ? 'Inspect this validated signal.'
            : 'Analyze this validated zone segment.',
        scope: { project_external_id: project, zone_external_id: zone || null },
        data_as_of: dataAsOf,
        signal_ref: { run_id: runId, signal_id: signalId },
        signal_action: action,
      },
      identity: createTurnIdentity(),
      conversationId: selectedConversationId ?? undefined,
    };
    await submit(attempt);
  }
  async function cancelRun() {
    if (!visibleRunId || !canWrite || scheduledReadOnly) return;
    setCancelling(true);
    try {
      await api(
        scoped(`/runs/${visibleRunId}/cancel`, orgId),
        z.object({ ok: z.literal(true) }),
        post({ org_id: orgId }),
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setCancelling(false);
    }
  }
  async function loadRunArtifacts() {
    if (!visibleRunId || bundle.artifacts.length || detailsLoading) return;
    setDetailsLoading(true);
    try {
      setBundle(await api(scoped(`/runs/${visibleRunId}/artifacts`, orgId), ArtifactListSchema));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setDetailsLoading(false);
    }
  }
  async function openEvidence(id: string, artifactRunId = visibleRunId) {
    if (!bundle.artifacts.some((artifact) => artifact.artifact_id === id)) {
      if (!artifactRunId) return;
      setDetailsLoading(true);
      try {
        const artifacts = await api(
          scoped(`/runs/${artifactRunId}/artifacts`, orgId),
          ArtifactListSchema,
        );
        setBundle(artifacts);
        if (!artifacts.artifacts.some((artifact) => artifact.artifact_id === id)) {
          setError('The referenced evidence artifact is unavailable for this run.');
          return;
        }
      } catch (cause) {
        setError(errorMessage(cause));
        return;
      } finally {
        setDetailsLoading(false);
      }
    }
    setEvidenceId(id);
  }

  return (
    <div className="agent-chat-layout">
      <ConversationList
        conversations={conversations}
        selectedId={selectedConversationId}
        loading={loadingConversations}
        hasMore={conversationCursor !== null}
        onNew={newConversation}
        onSelect={selectConversation}
        onLoadMore={() => conversationCursor && void loadConversations(conversationCursor, true)}
      />
      <div className="agent-chat-main">
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
        {runDetail && (
          <RunProgress
            detail={runDetail}
            canWrite={canWrite && !scheduledReadOnly}
            cancelling={cancelling}
            onCancel={() => void cancelRun()}
          />
        )}
        {workflowStatus && <WorkflowCheckpointStatus status={workflowStatus} />}
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
            onClearExternalRun?.();
            setRunId(id);
            setRunMessageId(messageId);
          }}
          onOpenReport={(id) => onReport?.(id)}
          onOpenArtifact={(artifactRunId, artifactId) => {
            onClearExternalRun?.();
            setRunId(artifactRunId);
            setRunMessageId(null);
            void openEvidence(artifactId, artifactRunId);
          }}
        />
        {runDetail?.run.status === 'succeeded' && (
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
          draft={draft}
          busy={busy}
          agentTarget={agentTarget}
          scheduledReadOnly={scheduledReadOnly}
          onProject={setProject}
          onZone={setZone}
          onDate={setDataAsOf}
          onDraft={setDraft}
          onAgentTarget={setAgentTarget}
          onSubmit={() => void submit()}
        />
      </div>
      {selectedArtifact && (
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
