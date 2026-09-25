import { useEffect, type Dispatch, type SetStateAction } from 'react';
import {
  type AgentWorkflowStatus,
  type DecisionBriefResponse,
  type DecisionIntelligenceResponse,
  ArtifactListSchema,
  ReportDetailSchema,
  RunDetailSchema,
} from '@vda/contracts';
import { z } from 'zod';
import { ApiError, errorMessage } from '../../../lib/http/api-client';
import {
  getRunArtifacts,
  getRunBrief,
  getRunDecision,
  getRunDetail,
} from '../../analysis/api/run-data';
import { getAgentWorkflowStatus } from '../../analysis/api/workflow-status';
import { getReportDetail, listReports } from '../../reports/api/reports';
import type { useConversations } from './use-conversations';
import type { useMessages } from './use-messages';

type RunDetail = z.infer<typeof RunDetailSchema>;
type ArtifactList = z.infer<typeof ArtifactListSchema>;
type ReportDetail = z.infer<typeof ReportDetailSchema>;
const terminalStatuses = new Set(['succeeded', 'failed', 'cancelled']);

export function useChatRunPolling({
  orgId,
  visibleRunId,
  canWrite,
  externalRunId,
  workspaceControlled,
  selectedConversationId,
  loadConversations,
  loadMessages,
  setSelectedConversationId,
  onAccessRevoked,
  setRunDetail,
  setWorkflowStatus,
  setBundle,
  setBrief,
  setDecision,
  setReportDetail,
  setBriefStatus,
  setReadState,
  onError,
}: {
  orgId: string;
  visibleRunId: string | null;
  canWrite: boolean;
  externalRunId?: string | null;
  workspaceControlled: boolean;
  selectedConversationId: string | null;
  loadConversations: ReturnType<typeof useConversations>['loadConversations'];
  loadMessages: ReturnType<typeof useMessages>['loadMessages'];
  setSelectedConversationId: Dispatch<SetStateAction<string | null>>;
  onAccessRevoked: () => void;
  setRunDetail: Dispatch<SetStateAction<RunDetail | null>>;
  setWorkflowStatus: Dispatch<SetStateAction<AgentWorkflowStatus | null>>;
  setBundle: Dispatch<SetStateAction<ArtifactList>>;
  setBrief: Dispatch<SetStateAction<DecisionBriefResponse | null>>;
  setDecision: Dispatch<SetStateAction<DecisionIntelligenceResponse | null>>;
  setReportDetail: Dispatch<SetStateAction<ReportDetail | null>>;
  setBriefStatus: Dispatch<SetStateAction<'idle' | 'loading' | 'available' | 'unavailable'>>;
  setReadState: Dispatch<SetStateAction<'idle' | 'loading' | 'ready' | 'stale' | 'error' | 'unavailable'>>;
  onError: (message: string) => void;
}) {
  useEffect(() => {
    if (!visibleRunId) {
      setReadState('idle');
      return;
    }
    const pollingRunId: string = visibleRunId;
    setBrief(null);
    setDecision(null);
    setReportDetail(null);
    setBriefStatus('idle');
    setBundle({ artifacts: [], validations: [], sources: [] });
    setWorkflowStatus(null);
    setReadState('loading');
    let obsolete = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastTaskSignature = '';
    let failures = 0;
    let reads = 0;
    let finalAttempts = 0;
    let workflowLoaded = false;
    let artifactsLoaded = false;
    let reportLoaded = false;
    let decisionLoaded = false;
    let messagesLoaded = false;
    async function pollPublishedReport() {
      const { reports } = await listReports(orgId);
      if (obsolete) return false;
      const matched = reports.find((report) => report.org_id === orgId && report.run_id === pollingRunId);
      if (!matched) return false;
      const report = await getReportDetail(orgId, matched.report_id);
      if (obsolete) return false;
      if (report.report.run_id === pollingRunId) {
        setReportDetail(report);
        return true;
      }
      return false;
    }
    async function poll() {
      try {
        const detail = await getRunDetail(orgId, pollingRunId);
        if (obsolete) return;
        if (detail.run.run_id !== pollingRunId || detail.run.org_id !== orgId) return;
        setRunDetail(detail);
        setReadState('ready');
        failures = 0;
        const signature = detail.tasks.map((task) => `${task.task_id}:${task.status}:${task.attempt}`).join('|');
        const tasksChanged = signature !== lastTaskSignature;
        lastTaskSignature = signature;
        if (canWrite && detail.run.workflow_version === 'agent-v1' && (tasksChanged || !workflowLoaded)) {
          try {
            const status = await getAgentWorkflowStatus(orgId, pollingRunId);
            if (!obsolete) { setWorkflowStatus(status); workflowLoaded = true; }
          } catch (cause) {
            if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) throw cause;
          }
        }
        if (tasksChanged || !artifactsLoaded || terminalStatuses.has(detail.run.status)) {
          try {
            const artifacts = await getRunArtifacts(orgId, pollingRunId);
            if (!obsolete) { setBundle(artifacts); artifactsLoaded = true; }
          } catch (cause) {
            if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) throw cause;
          }
        }
        const conversationId = detail.run.request.conversation_id;
        if (externalRunId && conversationId) {
          if (selectedConversationId !== conversationId) setSelectedConversationId(conversationId);
          if (selectedConversationId !== conversationId) void loadMessages(conversationId, null, false);
        }
        if (detail.run.status === 'succeeded' && !decisionLoaded) {
          if (!obsolete) setBriefStatus('loading');
          try {
            const nextDecision = await getRunDecision(orgId, pollingRunId);
            if (!obsolete) setDecision(nextDecision);
            if (nextDecision.status === 'available' || nextDecision.status === 'legacy_report_brief') {
              if (!obsolete) { setBriefStatus('available'); decisionLoaded = true; }
            } else {
              try {
                const nextBrief = await getRunBrief(orgId, pollingRunId);
                if (!obsolete) { setBrief(nextBrief); setBriefStatus('available'); decisionLoaded = true; }
              } catch (cause) {
                if (!(cause instanceof ApiError && cause.status === 404)) throw cause;
                if (!obsolete) { setBriefStatus('unavailable'); decisionLoaded = true; }
              }
            }
          } catch (cause) {
            if (cause instanceof ApiError && cause.status === 404) {
              if (!obsolete) { setBriefStatus('unavailable'); decisionLoaded = true; }
            } else if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) throw cause;
          }
        }
        if (terminalStatuses.has(detail.run.status)) {
          if (detail.run.status === 'succeeded' && !reportLoaded) {
            try { reportLoaded = await pollPublishedReport() || !detail.run.report_artifact_id; }
            catch (cause) {
              if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) throw cause;
            }
          }
          if (detail.run.status !== 'succeeded' && !obsolete) setBriefStatus('unavailable');
          if (!messagesLoaded && selectedConversationId) {
            const result = await loadMessages(selectedConversationId, null, false);
            if (result === 'unauthorized') throw new ApiError('WORKSPACE_FORBIDDEN', 403);
            messagesLoaded = result === 'ok' || result === 'stale';
          } else if (!selectedConversationId) messagesLoaded = true;
          if (!obsolete) void loadConversations(null, false);
          const ready = artifactsLoaded && messagesLoaded &&
            (!canWrite || detail.run.workflow_version !== 'agent-v1' || workflowLoaded) &&
            (detail.run.status !== 'succeeded' || decisionLoaded) &&
            (detail.run.status !== 'succeeded' || reportLoaded);
          if (!ready && !obsolete) {
            finalAttempts++;
            if (finalAttempts < 6) timer = setTimeout(() => void poll(), Math.min(10_000, finalAttempts * 2_000));
            else {
              setReadState('stale');
              onError('Chưa tải đủ kết quả cuối. Tải lại trang để thử lại.');
            }
          }
        } else if (!obsolete) {
          reads += 1;
          if (selectedConversationId && (tasksChanged || reads % 3 === 0))
            void loadMessages(selectedConversationId, null, false);
          timer = setTimeout(() => void poll(), document.hidden ? 5_000 : 1_100);
        }
      } catch (cause) {
        if (obsolete) return;
        if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
          setRunDetail(null);
          setBundle({ artifacts: [], validations: [], sources: [] });
          setWorkflowStatus(null);
          setBrief(null);
          setDecision(null);
          setReportDetail(null);
          setReadState('unavailable');
          onAccessRevoked();
          onError(errorMessage(cause));
          return;
        }
        if (cause instanceof ApiError && cause.status === 404) {
          setRunDetail(null);
          setBundle({ artifacts: [], validations: [], sources: [] });
          setReportDetail(null);
          setReadState('unavailable');
          onError(errorMessage(cause));
          return;
        }
        failures += 1;
        setReadState((state) => state === 'ready' || state === 'stale' ? 'stale' : 'error');
        if (failures < 6) timer = setTimeout(() => void poll(), Math.min(10_000, failures === 1 ? 2_000 : 5_000));
        else onError('Không thể tải lượt chạy đã chọn. Tải lại trang để thử lại.');
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
    workspaceControlled,
    setSelectedConversationId,
    onAccessRevoked,
    setRunDetail,
    setWorkflowStatus,
    setBundle,
    setBrief,
    setDecision,
    setReportDetail,
    setBriefStatus,
    setReadState,
    onError,
  ]);
}
