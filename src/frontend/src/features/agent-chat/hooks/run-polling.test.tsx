// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/http/api-client';
import {
  getRunArtifacts,
  getRunBrief,
  getRunDecision,
  getRunDetail,
} from '../../analysis/api/run-data';
import { getReportDetail, listReports } from '../../reports/api/reports';
import { useChatRunPolling } from './use-chat-run-polling';

vi.mock('../../analysis/api/run-data', () => ({
  getRunArtifacts: vi.fn(),
  getRunBrief: vi.fn(),
  getRunDecision: vi.fn(),
  getRunDetail: vi.fn(),
}));
vi.mock('../../analysis/api/workflow-status', () => ({ getAgentWorkflowStatus: vi.fn() }));
vi.mock('../../reports/api/reports', () => ({ getReportDetail: vi.fn(), listReports: vi.fn() }));

const orgId = '10000000-0000-4000-8000-000000000001';
const runId = '60000000-0000-4000-8000-000000000001';
const conversationId = '81000000-0000-4000-8000-000000000001';
const reportId = '84000000-0000-4000-8000-000000000001';
const artifactId = '85000000-0000-4000-8000-000000000001';

describe('terminal run reads', () => {
  it('retries transient artifact, report and message reads with one timer, then stops', async () => {
    vi.useFakeTimers();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const detail = {
      run: {
        org_id: orgId,
        run_id: runId,
        status: 'succeeded',
        workflow_version: 'legacy-v1',
        report_artifact_id: artifactId,
        request: { conversation_id: conversationId },
      },
      tasks: [],
      events: [],
    } as unknown as Awaited<ReturnType<typeof getRunDetail>>;
    const report = {
      report: { org_id: orgId, run_id: runId, report_id: reportId, artifact_id: artifactId },
      artifact: { org_id: orgId, run_id: runId, artifact_id: artifactId, kind: 'report' },
    } as unknown as Awaited<ReturnType<typeof getReportDetail>>;
    vi.mocked(getRunDetail).mockResolvedValue(detail);
    vi.mocked(getRunArtifacts)
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue({ artifacts: [], validations: [], sources: [] });
    vi.mocked(getRunDecision).mockResolvedValue({
      status: 'unavailable',
      org_id: orgId,
      run_id: runId,
      reason: 'DECISION_ARTIFACT_NOT_AVAILABLE',
    });
    vi.mocked(getRunBrief).mockRejectedValue(new ApiError('Missing', 404));
    vi.mocked(listReports)
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue({ reports: [report.report] } as Awaited<ReturnType<typeof listReports>>);
    vi.mocked(getReportDetail).mockResolvedValue(report);
    const loadMessages = vi.fn().mockResolvedValueOnce('error').mockResolvedValue('ok');
    const loadConversations = vi.fn().mockResolvedValue(undefined);
    const setRunDetail = vi.fn();
    const setWorkflowStatus = vi.fn();
    const setBundle = vi.fn();
    const setBrief = vi.fn();
    const setDecision = vi.fn();
    const setReportDetail = vi.fn();
    const setBriefStatus = vi.fn();
    const setReadState = vi.fn();
    const onError = vi.fn();
    function Harness() {
      useChatRunPolling({
        orgId,
        visibleRunId: runId,
        canWrite: false,
        workspaceControlled: false,
        selectedConversationId: conversationId,
        loadConversations,
        loadMessages,
        setSelectedConversationId: vi.fn(),
        setRunDetail,
        setWorkflowStatus,
        setBundle,
        setBrief,
        setDecision,
        setReportDetail,
        setBriefStatus,
        setReadState,
        onAccessRevoked: vi.fn(),
        onError,
      });
      return null;
    }
    try {
      await act(async () => {
        root.render(<Harness />);
      });
      expect(vi.getTimerCount()).toBe(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(getRunArtifacts).toHaveBeenCalledTimes(2);
      expect(listReports).toHaveBeenCalledTimes(2);
      expect(loadMessages).toHaveBeenCalledTimes(2);
      expect(setReportDetail).toHaveBeenCalledWith(report);
      expect(vi.getTimerCount()).toBe(0);
      expect(onError).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        root.unmount();
      });
      host.remove();
      vi.useRealTimers();
    }
  });
});
