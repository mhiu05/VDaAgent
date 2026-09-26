'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type CapabilityMode,
  type Catalog,
  type WorkspaceActionV1,
  type WorkspaceModeV1,
  type MessageContextRef,
} from '@vda/contracts';
import { errorMessage } from '../../../lib/http/api-client';
import { cancelAcknowledgedRun } from '../../analysis/api/run-data';
import { useAgentTurn } from './use-agent-turn';
import { useConversations } from './use-conversations';
import { useMessages } from './use-messages';
import { useSelectedMessages } from './use-selected-messages';
import { useAgentExecution } from './use-agent-execution';
import { useRunRuntime } from './use-run-runtime';
import { useThreadWorkspace } from './use-thread-workspace';
import { withThreadReportContext } from '../agent-workspace-model';
import { cancelAgentTurnJob } from '../api/conversations';
import { getThreadContext, putThreadContext } from '../api/runtime';
import { useWorkspaceRunResource } from '../../analysis/hooks/use-workspace-run-resource';
import { isReadOnlyRunView } from '../run-view';
import {
  initialWorkspaceContextState,
  toWorkspaceContext,
  type WorkspaceContextState,
} from '../../workspace/context';

export function useAgentChatController({
  orgId,
  catalog,
  canWrite,
  sseEnabled = false,
  project: controlledProject,
  zone: controlledZone,
  dataAsOf: controlledDataAsOf,
  activeRunId: controlledRunId,
  workspaceState,
  workspaceMode = 'agent_chat',
  workspaceLayout = false,
  showConversationList = true,
  capabilityMode,
  focusComposerRequest,
  onProject,
  onZone,
  onDataAsOf,
  onActiveRunChange,
  onWorkspaceAction,
  externalRunId,
  initialConversationId,
  onClearExternalRun,
  onReport,
}: {
  orgId: string;
  catalog: Catalog;
  canWrite: boolean;
  sseEnabled?: boolean;
  project?: string;
  zone?: string;
  dataAsOf?: string;
  activeRunId?: string | null;
  /** Existing navigation state; converted to a wire snapshot only on submit. */
  workspaceState?: WorkspaceContextState;
  /** Wire mode is deliberately separate from the richer UI capability mode. */
  workspaceMode?: WorkspaceModeV1;
  /** Enables compact report-dashboard presentation behavior. */
  workspaceLayout?: boolean;
  showConversationList?: boolean;
  capabilityMode?: CapabilityMode;
  focusComposerRequest?: number;
  onProject?: (value: string) => void;
  onZone?: (value: string) => void;
  onDataAsOf?: (value: string) => void;
  onActiveRunChange?: (value: string | null) => void;
  onWorkspaceAction?: (action: WorkspaceActionV1) => void;
  externalRunId?: string | null;
  /** Route-selected persisted conversation, if one is supplied. */
  initialConversationId?: string;
  onClearExternalRun?: () => void;
  onReport?: (reportId: string) => void;
}) {
  const [localProject, setLocalProject] = useState(catalog.projects[0]?.project_external_id ?? '');
  const [localZone, setLocalZone] = useState('');
  const [localDataAsOf, setLocalDataAsOf] = useState(catalog.latest_snapshot_date ?? '');
  const [runId, setRunId] = useState<string | null>(null);
  const [runMessageId, setRunMessageId] = useState<string | null>(null);
  const [acceptedJobId, setAcceptedJobId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<string | null>('root');
  const [messageContextRefs, setMessageContextRefs] = useState<MessageContextRef[]>([]);
  const [reportIntent, setReportIntent] = useState<'new' | 'update' | null>(null);
  const [replyToMessageId, setReplyToMessageId] = useState<string | null>(null);
  const {
    conversations,
    conversationCursor,
    selectedConversationId,
    selectedConversation,
    setSelectedConversationId,
    loadingConversations,
    loadConversations,
    clearConversations,
  } = useConversations(orgId, setError);
  const { messages, setMessages, messageCursor, setMessageCursor, loadingMessages, loadMessages, refreshMessage, activateConversation } =
    useMessages(orgId, setError);
  const project = controlledProject ?? localProject;
  const zone = controlledZone ?? localZone;
  const dataAsOf = controlledDataAsOf ?? localDataAsOf;
  const runIsControlled = controlledRunId !== undefined;
  const workspaceControlled = workspaceLayout && onWorkspaceAction !== undefined;
  const selectedRunId = runIsControlled ? controlledRunId : runId;
  const runSelectionIntent = useRef<'automatic' | 'manual' | 'cleared'>('automatic');
  const skipNextRouteReset = useRef(false);
  const onActiveRunChangeRef = useRef(onActiveRunChange);

  useEffect(() => {
    onActiveRunChangeRef.current = onActiveRunChange;
  }, [onActiveRunChange]);

  function updateProject(value: string) {
    runSelectionIntent.current = 'cleared';
    if (value !== project) setRetryTurn(null);
    if (controlledProject === undefined) setLocalProject(value);
    onProject?.(value);
  }
  function updateZone(value: string) {
    runSelectionIntent.current = 'cleared';
    if (value !== zone) setRetryTurn(null);
    if (controlledZone === undefined) setLocalZone(value);
    onZone?.(value);
  }
  function updateDataAsOf(value: string) {
    runSelectionIntent.current = 'cleared';
    if (value !== dataAsOf) setRetryTurn(null);
    if (controlledDataAsOf === undefined) setLocalDataAsOf(value);
    onDataAsOf?.(value);
  }
  const updateActiveRun = useCallback(
    (value: string | null) => {
      if (!runIsControlled) setRunId(value);
      onActiveRunChangeRef.current?.(value);
    },
    [runIsControlled],
  );

  const visibleRunId = externalRunId ?? selectedRunId;
  const { snapshot: agentExecution, setSnapshot: setAgentExecution, error: executionError } = useAgentExecution(orgId, selectedConversationId, acceptedJobId, sseEnabled);
  const agentRunId = agentExecution?.job.run_id;
  const agentAssistantMessageId = agentExecution?.job.assistant_message_id;
  const agentJobId = agentExecution?.job.job_id;
  const agentJobStatus = agentExecution?.job.status;
  const agentConversationId = agentExecution?.job.conversation_id;
  const agentAssistantTerminal = messages.some((message) =>
    message.message_id === agentAssistantMessageId &&
    ['completed', 'failed', 'cancelled'].includes(message.status));
  const onAccessRevoked = useCallback(() => {
    clearConversations();
    activateConversation(null);
    setMessages([]);
    setMessageCursor(null);
    setAgentExecution(null);
  }, [clearConversations, activateConversation, setMessages, setMessageCursor, setAgentExecution]);
  useEffect(() => {
    if (!agentJobId || !agentAssistantMessageId || agentConversationId !== selectedConversationId ||
      !agentJobStatus || !['completed', 'failed', 'cancelled'].includes(agentJobStatus) ||
      agentAssistantTerminal) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const refresh = async () => {
      const [messageResult] = await Promise.all([
        refreshMessage(agentConversationId, agentAssistantMessageId),
        loadConversations(null, false),
      ]);
      if (!disposed && messageResult === 'unauthorized') onAccessRevoked();
      if (!disposed && messageResult !== 'terminal' && messageResult !== 'stale' &&
          messageResult !== 'missing' && messageResult !== 'unauthorized' && ++attempts < 5)
        timer = setTimeout(() => void refresh(), Math.min(5000, attempts * 1000));
      else if (!disposed && (messageResult === 'error' || messageResult === 'pending') && attempts >= 5)
        setError('Không thể đồng bộ tin nhắn cuối. Tải lại trang để thử lại.');
    };
    void refresh();
    return () => { disposed = true; if (timer) clearTimeout(timer); };
  }, [agentAssistantMessageId, agentAssistantTerminal, agentConversationId, agentJobId,
      agentJobStatus, loadConversations, onAccessRevoked, refreshMessage, selectedConversationId]);
  useEffect(() => {
    if (!agentRunId || externalRunId || runSelectionIntent.current !== 'automatic' || selectedRunId ||
      agentExecution?.job.conversation_id !== selectedConversationId ||
      (acceptedJobId && agentExecution.job.job_id !== acceptedJobId)) return;
    updateActiveRun(agentRunId);
    setRunMessageId(agentAssistantMessageId ?? null);
  }, [agentAssistantMessageId, agentRunId, externalRunId, selectedRunId, selectedConversationId, agentExecution, acceptedJobId, updateActiveRun]);
  const {
    currentRunDetail,
    setRunDetail,
    workflowStatus,
    bundle,
    setBundle,
    brief,
    setBrief,
    decision,
    setDecision,
    reportDetail,
    briefStatus,
    setBriefStatus,
    readState,
    detailsLoading,
    setDetailsLoading,
    setEvidenceId,
    selectedArtifact,
    loadRunArtifacts,
    openEvidence,
  } = useWorkspaceRunResource({
    orgId,
    runId: visibleRunId ?? null,
    canWrite,
    externalRunId,
    workspaceControlled,
    selectedConversationId,
    loadConversations,
    loadMessages,
    setSelectedConversationId,
    onAccessRevoked,
    onError: setError,
  });
  const scheduledReadOnly = isReadOnlyRunView(
    externalRunId,
    currentRunDetail?.run ?? null,
    selectedConversation?.kind,
  );
  const threadWorkspace = useThreadWorkspace(orgId, selectedConversationId, currentRunDetail?.run.status);
  const runtime = useRunRuntime(orgId, visibleRunId ?? null, sseEnabled,
    Boolean(currentRunDetail && ['queued', 'running'].includes(currentRunDetail.run.status)));
  const buildWorkspaceContext = useCallback(
    (conversationId: string | null, activeRunId?: string | null) => {
      const state = workspaceState ?? initialWorkspaceContextState;
      const snapshot = toWorkspaceContext(state, {
        org_id: orgId, conversation_id: conversationId,
        scope: { project_external_id: project, zone_external_id: zone || null },
        data_as_of: dataAsOf, mode: workspaceMode,
        active_run_id: activeRunId ?? selectedRunId ?? state.active_run_id,
      });
      if (!workspaceLayout) return snapshot;
      // Report selection belongs to the thread, independent of the run being inspected.
      // Never let an old dashboard selection override an explicit no-report selection.
      const report = replyToMessageId ? undefined : threadWorkspace.reports.find((item) => item.report_id === threadWorkspace.context.active_report_id);
      return withThreadReportContext(snapshot, report);
    },
    [dataAsOf, orgId, project, selectedRunId, workspaceMode, workspaceState, zone, workspaceLayout, threadWorkspace.reports, threadWorkspace.context.active_report_id, replyToMessageId],
  );
  const submissionContextRefs = useMemo<MessageContextRef[]>(() => {
    if (messageContextRefs.length || selectedConversationId) return messageContextRefs;
    return threadWorkspace.context.dataset_ids.map((id) => ({ type: 'dataset', id }));
  }, [messageContextRefs, selectedConversationId, threadWorkspace.context.dataset_ids]);
  const {
    draft,
    setDraft,
    agentTarget,
    setAgentTarget,
    busy,
    retryTurn,
    setRetryTurn,
    activity,
    setActivity,
    submit,
    submitSignalAction,
  } = useAgentTurn({
    orgId,
    canWrite,
    sseEnabled,
    scheduledReadOnly,
    selectedConversationId,
    buildWorkspaceContext,
    updateActiveRun,
    setSelectedConversationId,
    setRunMessageId,
    setRunDetail,
    setBundle,
    setBrief,
    setDecision,
    setBriefStatus,
    loadConversations,
    loadMessages,
    activateConversation,
    setAcceptedJobId,
    onAcceptedTurn: async (conversationId) => {
      runSelectionIntent.current = 'automatic';
      if (!selectedConversationId && threadWorkspace.context.dataset_ids.length) {
        try {
          const current = await getThreadContext(orgId, conversationId);
          await putThreadContext(orgId, conversationId, { ...current, dataset_ids: threadWorkspace.context.dataset_ids });
        }
        catch (cause) { setError(errorMessage(cause)); }
      }
    },
    setError,
    messageContextRefs: submissionContextRefs,
    reportIntent,
    replyToMessageId,
    onClearMessageContext: () => { setMessageContextRefs([]); setReportIntent(null); setReplyToMessageId(null); },
  });
  useEffect(() => {
    if (controlledProject === undefined)
      setLocalProject((value) =>
        catalog.projects.some((item) => item.project_external_id === value)
          ? value
          : (catalog.projects[0]?.project_external_id ?? ''),
      );
    if (controlledDataAsOf === undefined)
      setLocalDataAsOf((value) => value || catalog.latest_snapshot_date || '');
  }, [catalog, controlledDataAsOf, controlledProject]);

  useEffect(() => {
    if (skipNextRouteReset.current) {
      skipNextRouteReset.current = false;
      return;
    }
    let obsolete = false;
    runSelectionIntent.current = 'automatic';
    setSelectedConversationId(null);
    activateConversation(null);
    setMessages([]);
    if (!runIsControlled) updateActiveRun(null);
    setRunMessageId(null);
    setAcceptedJobId(null);
    setRunDetail(null);
    setRunMessageId(null);
    setBundle({ artifacts: [], validations: [], sources: [] });
    setBrief(null);
    setDecision(null);
    setBriefStatus('idle');
    setActivity([]);
    setError('');
    if (!externalRunId && initialConversationId) {
      activateConversation(initialConversationId);
      setSelectedConversationId(initialConversationId);
    }
    void loadConversations(null, false).then((page) => {
      if (obsolete) return;
      if (!externalRunId && !initialConversationId && !workspaceLayout && page?.conversations[0]) {
        activateConversation(page.conversations[0].conversation_id);
        setSelectedConversationId(page.conversations[0].conversation_id);
      }
    });
    return () => { obsolete = true; };
  }, [
    externalRunId,
    initialConversationId,
    loadConversations,
    orgId,
    runIsControlled,
    updateActiveRun,
    setMessages,
    setSelectedConversationId,
    setActivity,
    activateConversation,
    workspaceLayout,
    setRunDetail,
    setBundle,
    setBrief,
    setDecision,
    setBriefStatus,
  ]);

  useSelectedMessages(selectedConversationId, loadMessages, activateConversation);
  useEffect(() => {
    if (!selectedConversationId) return;
    setRunDetail(null);
    setBundle({ artifacts: [], validations: [], sources: [] });
    setBrief(null);
    setDecision(null);
    setBriefStatus('idle');
    setActivity([]);
  }, [orgId, selectedConversationId, setActivity, setRunDetail, setBundle, setBrief, setDecision, setBriefStatus]);

  useEffect(() => {
    if (externalRunId) {
      runSelectionIntent.current = 'manual';
      setRunId(externalRunId);
      setRunMessageId(null);
      return;
    }
    if (runSelectionIntent.current !== 'automatic') return;
    const latest = [...messages].reverse().find((message) => {
      if (message.role !== 'assistant') return false;
      return message.run_id !== null || message.parts.some((part) => part.type === 'run_ref');
    });
    const referencedRunId =
      latest?.run_id ?? latest?.parts.find((part) => part.type === 'run_ref')?.run_id ?? null;
    if (latest && referencedRunId) {
      updateActiveRun(referencedRunId);
      setRunMessageId(latest.message_id);
    }
  }, [externalRunId, messages, updateActiveRun]);

  const reportId = useMemo(() => {
    if (!visibleRunId) return null;
    for (const message of [...messages].reverse())
      for (const part of message.parts) if (part.type === 'report_ref' && part.run_id === visibleRunId) return part.report_id;
    return null;
  }, [visibleRunId, messages]);

  function selectRun(id: string, messageId: string | null = null) {
    runSelectionIntent.current = 'manual';
    if (externalRunId) {
      skipNextRouteReset.current = true;
      onClearExternalRun?.();
    }
    updateActiveRun(id);
    setRunMessageId(messageId);
  }

  function selectConversation(id: string) {
    setReplyToMessageId(null);
    setMessageContextRefs([]);
    setReportIntent(null);
    runSelectionIntent.current = 'automatic';
    setAcceptedJobId(null);
    activateConversation(id);
    if (externalRunId) onClearExternalRun?.();
    setSelectedConversationId(id);
    setMessages([]);
    updateActiveRun(null);
    setRunMessageId(null);
    setBrief(null);
    setDecision(null);
    setBriefStatus('idle');
    setEvidenceId(null);
    setActivity([]);
    setError('');
  }
  function newConversation() {
    setReplyToMessageId(null);
    setMessageContextRefs([]);
    setReportIntent(null);
    runSelectionIntent.current = 'cleared';
    setAcceptedJobId(null);
    activateConversation(null);
    if (externalRunId) onClearExternalRun?.();
    setSelectedConversationId(null);
    setMessages([]);
    setMessageCursor(null);
    updateActiveRun(null);
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
    setActivity([]);
    setError('');
  }
  async function cancelRun() {
    if (!visibleRunId || !canWrite || scheduledReadOnly) return;
    setCancelling(true);
    try {
      await cancelAcknowledgedRun(orgId, visibleRunId);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setCancelling(false);
    }
  }
  async function cancelJob() {
    const job = agentExecution?.job;
    if (!job || job.run_id || !canWrite || scheduledReadOnly || !['queued', 'running', 'waiting'].includes(job.status) ||
      job.conversation_id !== selectedConversationId || (acceptedJobId && job.job_id !== acceptedJobId)) return;
    setCancelling(true);
    try {
      const result = await cancelAgentTurnJob(orgId, job.job_id);
      setAgentExecution((current) => current?.job.job_id === result.job_id ? { ...current, job: result } : current);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setCancelling(false);
    }
  }
  return {
    orgId, catalog, canWrite, capabilityMode, focusComposerRequest, showConversationList,
    onWorkspaceAction, onReport, onClearExternalRun,
    conversations, conversationCursor, selectedConversationId, selectedConversation, loadingConversations,
    loadConversations, messages, messageCursor, loadingMessages, loadMessages,
    project, zone, dataAsOf, updateProject, updateZone, updateDataAsOf,
    visibleRunId, currentRunDetail, workflowStatus, bundle, brief, decision, reportDetail, briefStatus, readState,
    detailsLoading, selectedArtifact, setEvidenceId, loadRunArtifacts, openEvidence,
    scheduledReadOnly, draft, setDraft, agentTarget, setAgentTarget, busy,
    retryTurn, setRetryTurn, activity, submit, submitSignalAction,
    agentExecution, executionError, acceptedJobId, selectedAgent, setSelectedAgent, reportId, cancelling, error, setError,
    runMessageId, workspaceControlled, selectConversation, newConversation, cancelRun, cancelJob,
    updateActiveRun, setRunMessageId, selectRun,
    threadWorkspace, runtime, messageContextRefs, setMessageContextRefs, reportIntent, setReportIntent,
    replyToMessageId, setReplyToMessageId,
  };
}
