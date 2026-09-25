import { useState, type Dispatch, type SetStateAction } from 'react';
import { z } from 'zod';
import {
  ArtifactListSchema,
  RunDetailSchema,
  type AgentActivityEventV1,
  type AgentKey,
  type AgentTurnRequest,
  type DecisionBriefResponse,
  type DecisionIntelligenceResponse,
} from '@vda/contracts';
import { errorMessage } from '../../../lib/http/api-client';
import { createTurnIdentity, type TurnRequestIdentity } from '../../../lib/http/turn-identity';
import { toWorkspaceContext } from '../../workspace/context';
import { deliverAgentTurn } from '../api/turn-delivery';
import type { useConversations } from './use-conversations';
import type { useMessages } from './use-messages';

type TurnInput = Omit<AgentTurnRequest, 'org_id' | 'client_turn_id'>;
type RetryTurn = {
  input: TurnInput;
  identity: TurnRequestIdentity;
  conversationId?: string;
};

type TurnDependencies = {
  orgId: string;
  canWrite: boolean;
  sseEnabled: boolean;
  scheduledReadOnly: boolean;
  selectedConversationId: string | null;
  buildWorkspaceContext: (
    conversationId: string | null,
    activeRunId?: string | null,
  ) => ReturnType<typeof toWorkspaceContext>;
  updateActiveRun: (value: string | null) => void;
  setSelectedConversationId: ReturnType<typeof useConversations>['setSelectedConversationId'];
  setRunMessageId: Dispatch<SetStateAction<string | null>>;
  setRunDetail: Dispatch<SetStateAction<z.infer<typeof RunDetailSchema> | null>>;
  setBundle: Dispatch<SetStateAction<z.infer<typeof ArtifactListSchema>>>;
  setBrief: Dispatch<SetStateAction<DecisionBriefResponse | null>>;
  setDecision: Dispatch<SetStateAction<DecisionIntelligenceResponse | null>>;
  setBriefStatus: Dispatch<SetStateAction<'idle' | 'loading' | 'available' | 'unavailable'>>;
  loadConversations: ReturnType<typeof useConversations>['loadConversations'];
  loadMessages: ReturnType<typeof useMessages>['loadMessages'];
  activateConversation: ReturnType<typeof useMessages>['activateConversation'];
  setAcceptedJobId: Dispatch<SetStateAction<string | null>>;
  onAcceptedTurn: () => void;
  setError: Dispatch<SetStateAction<string>>;
};

export function useAgentTurn({
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
  onAcceptedTurn,
  setError,
}: TurnDependencies) {
  const [draft, setDraft] = useState('');
  const [agentTarget, setAgentTarget] = useState<AgentKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryTurn, setRetryTurn] = useState<RetryTurn | null>(null);
  const [activity, setActivity] = useState<AgentActivityEventV1[]>([]);
  function editDraft(value: string) {
    setDraft(value);
    // A changed prompt is a new request, never a replay of the failed identity.
    if (value !== draft) setRetryTurn(null);
  }
  function editAgentTarget(value: AgentKey | null) {
    setAgentTarget(value);
    if (value !== agentTarget) setRetryTurn(null);
  }

  async function submit(providedAttempt?: RetryTurn) {
    // The compatibility fields and versioned snapshot intentionally come
    // from one derived object. That keeps the browser from accidentally
    // sending two different scope/date views of the same turn.
    const workspaceContext = buildWorkspaceContext(selectedConversationId);
    const attempt = providedAttempt ??
      retryTurn ?? {
        input: {
          text: draft.trim(),
          scope: workspaceContext.scope,
          data_as_of: workspaceContext.data_as_of,
          agent_target: agentTarget,
          workspace_context: workspaceContext,
        },
        identity: createTurnIdentity(),
        conversationId: selectedConversationId ?? undefined,
      };
    if (!attempt.input.text || busy || !canWrite || scheduledReadOnly) return;
    setBusy(true);
    setError('');
    setActivity([]);
    try {
      const accepted = await deliverAgentTurn(
        orgId,
        attempt.input,
        attempt.identity,
        attempt.conversationId,
        sseEnabled,
        (event) =>
          setActivity((current) =>
            event.sequence > (current[current.length - 1]?.sequence ?? -1)
              ? [...current, event]
              : current,
          ),
      );
      setRetryTurn(null);
      onAcceptedTurn();
      setDraft('');
      setAgentTarget(null);
      setSelectedConversationId(accepted.conversation_id);
      activateConversation(accepted.conversation_id);
      setAcceptedJobId(accepted.agent_turn_job_id ?? null);
      updateActiveRun(accepted.run_id);
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
      if (attempt.conversationId) void loadMessages(attempt.conversationId, null, false);
      void loadConversations(null, false);
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
    const workspaceContext = buildWorkspaceContext(selectedConversationId, runId);
    const attempt: RetryTurn = {
      input: {
        text:
          action === 'inspect'
            ? 'Inspect this validated signal.'
            : 'Analyze this validated zone segment.',
        scope: workspaceContext.scope,
        data_as_of: workspaceContext.data_as_of,
        signal_ref: { run_id: runId, signal_id: signalId },
        signal_action: action,
        workspace_context: workspaceContext,
      },
      identity: createTurnIdentity(),
      conversationId: selectedConversationId ?? undefined,
    };
    await submit(attempt);
  }

  return {
    draft,
    setDraft: editDraft,
    agentTarget,
    setAgentTarget: editAgentTarget,
    busy,
    retryTurn,
    setRetryTurn,
    activity,
    setActivity,
    submit,
    submitSignalAction,
  };
}
