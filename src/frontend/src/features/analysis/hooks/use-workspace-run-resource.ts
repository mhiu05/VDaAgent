import { useEffect, useState } from 'react';
import {
  type AgentWorkflowStatus,
  type DecisionBriefResponse,
  type DecisionIntelligenceResponse,
  ArtifactListSchema,
  ReportDetailSchema,
  RunDetailSchema,
} from '@vda/contracts';
import { z } from 'zod';
import { useChatEvidence } from '../../agent-chat/hooks/use-chat-evidence';
import { useChatRunPolling } from '../../agent-chat/hooks/use-chat-run-polling';
import type { useConversations } from '../../agent-chat/hooks/use-conversations';
import type { useMessages } from '../../agent-chat/hooks/use-messages';

const emptyBundle = (): ArtifactList => ({ artifacts: [], validations: [], sources: [] });
type ArtifactList = z.infer<typeof ArtifactListSchema>;
type RunDetail = z.infer<typeof RunDetailSchema>;
type ReportDetail = z.infer<typeof ReportDetailSchema>;

/** The selected org/run is the read boundary for every workspace region. */
export function useWorkspaceRunResource({
  orgId,
  runId,
  canWrite,
  externalRunId,
  workspaceControlled,
  selectedConversationId,
  loadConversations,
  loadMessages,
  setSelectedConversationId,
  onError,
}: {
  orgId: string;
  runId: string | null;
  canWrite: boolean;
  externalRunId?: string | null;
  workspaceControlled: boolean;
  selectedConversationId: string | null;
  loadConversations: ReturnType<typeof useConversations>['loadConversations'];
  loadMessages: ReturnType<typeof useMessages>['loadMessages'];
  setSelectedConversationId: ReturnType<typeof useConversations>['setSelectedConversationId'];
  onError: (message: string) => void;
}) {
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [workflowStatus, setWorkflowStatus] = useState<AgentWorkflowStatus | null>(null);
  const [bundle, setBundle] = useState<ArtifactList>(emptyBundle);
  const [brief, setBrief] = useState<DecisionBriefResponse | null>(null);
  const [decision, setDecision] = useState<DecisionIntelligenceResponse | null>(null);
  const [reportDetail, setReportDetail] = useState<ReportDetail | null>(null);
  const [briefStatus, setBriefStatus] = useState<'idle' | 'loading' | 'available' | 'unavailable'>('idle');
  const [readState, setReadState] = useState<'idle' | 'loading' | 'ready' | 'stale' | 'error' | 'unavailable'>('idle');
  const currentRunDetail = runDetail?.run.run_id === runId && runDetail.run.org_id === orgId ? runDetail : null;
  const evidence = useChatEvidence({
    orgId,
    visibleRunId: runId,
    currentRunDetail,
    bundle,
    setBundle,
    onError,
  });
  const { setDetailsLoading, setEvidenceId } = evidence;

  useEffect(() => {
    setRunDetail(null);
    setWorkflowStatus(null);
    setBundle(emptyBundle());
    setBrief(null);
    setDecision(null);
    setReportDetail(null);
    setBriefStatus('idle');
    setReadState(runId ? 'loading' : 'idle');
    setDetailsLoading(false);
    setEvidenceId(null);
  }, [orgId, runId, setDetailsLoading, setEvidenceId]);

  useChatRunPolling({
    orgId,
    visibleRunId: runId,
    canWrite,
    externalRunId,
    workspaceControlled,
    selectedConversationId,
    loadConversations,
    loadMessages,
    setSelectedConversationId,
    setRunDetail,
    setWorkflowStatus,
    setBundle,
    setBrief,
    setDecision,
    setReportDetail,
    setBriefStatus,
    setReadState,
    onError,
  });

  return {
    currentRunDetail,
    runDetail,
    setRunDetail,
    workflowStatus,
    setWorkflowStatus,
    bundle,
    setBundle,
    brief,
    setBrief,
    decision,
    setDecision,
    reportDetail: reportDetail?.report.run_id === runId && reportDetail.report.org_id === orgId ? reportDetail : null,
    briefStatus,
    setBriefStatus,
    readState,
    ...evidence,
  };
}
