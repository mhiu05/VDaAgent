// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/frontend/lib/http/api-client';
import {
  getRunArtifacts,
  getRunBrief,
  getRunDecision,
  getRunDetail,
} from '../../src/frontend/features/analysis/api/run-data';
import { getReportDetail, listReports } from '../../src/frontend/features/reports/api/reports';
import { useChatRunPolling } from '../../src/frontend/features/agent-chat/hooks/use-chat-run-polling';

vi.mock('../../src/frontend/features/analysis/api/run-data', () => ({
  getRunArtifacts: vi.fn(),
  getRunBrief: vi.fn(),
  getRunDecision: vi.fn(),
  getRunDetail: vi.fn(),
}));
vi.mock('../../src/frontend/features/analysis/api/workflow-status', () => ({
  getAgentWorkflowStatus: vi.fn(),
}));
vi.mock('../../src/frontend/features/reports/api/reports', () => ({
  getReportDetail: vi.fn(),
  listReports: vi.fn(),
}));

const orgId = '10000000-0000-4000-8000-000000000001';
const runId = '60000000-0000-4000-8000-000000000001';
const conversationId = '81000000-0000-4000-8000-000000000001';
const reportId = '84000000-0000-4000-8000-000000000001';
const artifactId = '85000000-0000-4000-8000-000000000001';
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('terminal analysis polling', () => {
  it('retries transient bundle, report and message reads once, then clears the timer', async () => {
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
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue({ artifacts: [], validations: [], sources: [] });
    vi.mocked(getRunDecision).mockResolvedValue({
      status: 'unavailable',
      org_id: orgId,
      run_id: runId,
      reason: 'DECISION_ARTIFACT_NOT_AVAILABLE',
    });
    vi.mocked(getRunBrief).mockRejectedValue(new ApiError('Missing', 404));
    vi.mocked(listReports)
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue({ reports: [report.report] } as Awaited<ReturnType<typeof listReports>>);
    vi.mocked(getReportDetail).mockResolvedValue(report);
    const loadMessages = vi.fn().mockResolvedValueOnce('error').mockResolvedValue('ok');
    const setReportDetail = vi.fn();
    const onError = vi.fn();
    function Harness() {
      useChatRunPolling({
        orgId,
        visibleRunId: runId,
        canWrite: false,
        workspaceControlled: false,
        selectedConversationId: conversationId,
        loadConversations: vi.fn(),
        loadMessages,
        setSelectedConversationId: vi.fn(),
        setRunDetail: vi.fn(),
        setWorkflowStatus: vi.fn(),
        setBundle: vi.fn(),
        setBrief: vi.fn(),
        setDecision: vi.fn(),
        setReportDetail,
        setBriefStatus: vi.fn(),
        setReadState: vi.fn(),
        onAccessRevoked: vi.fn(),
        onError,
      });
      return null;
    }
    try {
      await act(async () => root.render(<Harness />));
      expect(vi.getTimerCount()).toBe(1);
      await act(async () => vi.advanceTimersByTimeAsync(2_000));
      expect(getRunArtifacts).toHaveBeenCalledTimes(2);
      expect(listReports).toHaveBeenCalledTimes(2);
      expect(loadMessages).toHaveBeenCalledTimes(2);
      expect(setReportDetail).toHaveBeenCalledWith(report);
      expect(vi.getTimerCount()).toBe(0);
      expect(onError).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
