import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AgentWorkflowStatus, Message } from '@vda/contracts';
import { MessageThread, senderLabel } from './message-thread';
import { isReadOnlyRunView, shouldRenderAgentChat } from './run-view';
import { taskLabel } from './run-progress';
import { WorkflowCheckpointStatus } from './workflow-checkpoint-status';
import { ActivityTimeline } from './activity-timeline';

const message: Message = {
  message_id: '80000000-0000-4000-8000-000000000001',
  org_id: '10000000-0000-4000-8000-000000000001',
  conversation_id: '81000000-0000-4000-8000-000000000001',
  run_id: '82000000-0000-4000-8000-000000000001',
  client_turn_id: '83000000-0000-4000-8000-000000000001',
  role: 'assistant',
  status: 'failed',
  content: '<script>unsafe()</script>',
  parts: [
    { type: 'run_ref', run_id: '82000000-0000-4000-8000-000000000001', status: 'failed' },
    {
      type: 'report_ref',
      run_id: '82000000-0000-4000-8000-000000000001',
      report_id: '84000000-0000-4000-8000-000000000001',
    },
    { type: 'error', code: 'ANALYSIS_ACTION_FAILED', retryable: true },
  ],
  created_at: '2026-09-20T00:00:00.000Z',
  updated_at: '2026-09-20T00:00:00.000Z',
};

const checkpointStatus: AgentWorkflowStatus = {
  run_id: '82000000-0000-4000-8000-000000000001',
  org_id: '10000000-0000-4000-8000-000000000001',
  workflow_version: 'agent-v1',
  stages: [],
  draft_revision: 2,
  review: { draft_revision: 2, status: 'PASS' },
  publication_status: 'succeeded',
};

describe('Agent Chat message presentation', () => {
  it('renders typed run/error parts and escapes message text', () => {
    const output = renderToStaticMarkup(
      <MessageThread
        messages={[message]}
        loading={false}
        hasEarlier={false}
        onLoadEarlier={() => undefined}
        onOpenRun={() => undefined}
        onOpenReport={() => undefined}
        onOpenArtifact={() => undefined}
      />,
    );
    expect(output).toContain('Lượt phân tích · failed');
    expect(output).toContain('Báo cáo đã liên kết');
    expect(output).toContain('Không thể khởi tạo hoặc tải kết quả phân tích.');
    expect(output).toContain('&lt;script&gt;unsafe()&lt;/script&gt;');
    expect(output).not.toContain('<script>unsafe()</script>');
  });

  it('maps only known task states to display labels', () => {
    expect(taskLabel('coordinator')).toBe('Coordinator decision');
    expect(taskLabel('reviewer')).toBe('Draft review');
    expect(taskLabel('calculation')).toBe('Tính chỉ số');
    expect(taskLabel('untrusted-task')).toBe('Đang xử lý');
  });

  it('keeps persisted specialist names while preserving the legacy label', () => {
    expect(senderLabel('reviewer')).toBe('Reviewer');
    expect(senderLabel(null)).toBe('VDaAgent');
  });

  it('renders compact draft/review state without draft contents', () => {
    const output = renderToStaticMarkup(<WorkflowCheckpointStatus status={checkpointStatus} />);
    expect(output).toContain('Immutable revision 2 persisted');
    expect(output).toContain('Reviewer passed draft revision 2.');
    expect(output).toContain('Published after deterministic gate');
    expect(output).not.toContain('content_hash');
  });

  it('renders only fixed safe activity labels', () => {
    const output = renderToStaticMarkup(
      <ActivityTimeline
        events={[
          {
            version: 'agent-activity-v1',
            sequence: 0,
            type: 'error',
            label: 'safe_error',
            capability: null,
            run_id: null,
            artifact_id: null,
            error_code: 'PROVIDER_UNAVAILABLE',
          },
        ]}
      />,
    );
    expect(output).toContain('The assistant completed with a safe status');
    expect(output).not.toContain('PROVIDER_UNAVAILABLE');
  });

  it('renders a validated workspace action as a fixed-label control', () => {
    const output = renderToStaticMarkup(
      <MessageThread
        messages={[
          {
            ...message,
            parts: [
              {
                type: 'workspace_action',
                action: {
                  type: 'open_evidence',
                  run_id: '82000000-0000-4000-8000-000000000001',
                  artifact_id: '40000000-0000-4000-8000-000000000001',
                  evidence_path: null,
                },
              },
            ],
          },
        ]}
        loading={false}
        hasEarlier={false}
        onLoadEarlier={() => undefined}
        onOpenRun={() => undefined}
        onOpenReport={() => undefined}
        onOpenArtifact={() => undefined}
        onWorkspaceAction={() => undefined}
      />,
    );
    expect(output).toContain('Open authorized evidence');
    expect(output).toContain('<button');
    expect(output).not.toContain('40000000-0000-4000-8000-000000000001');
  });

  it('keeps unresolved and scheduled external runs non-mutating in AgentChat', () => {
    const runId = '82000000-0000-4000-8000-000000000001';
    expect(shouldRenderAgentChat(runId, undefined)).toBe(true);
    expect(shouldRenderAgentChat(runId, 'agent-v1')).toBe(true);
    expect(shouldRenderAgentChat(runId, 'legacy-v1')).toBe(false);

    expect(isReadOnlyRunView(runId, null, undefined)).toBe(true);
    expect(isReadOnlyRunView(runId, { run_id: runId, entrypoint: 'scheduled' }, 'scheduled')).toBe(
      true,
    );
    expect(
      isReadOnlyRunView(runId, { run_id: runId, entrypoint: 'interactive' }, 'interactive'),
    ).toBe(false);
  });
});
