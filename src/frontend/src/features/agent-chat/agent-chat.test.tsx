import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AgentWorkflowStatus, Message } from '@vda/contracts';
import { MessageThread, senderLabel } from './message-thread';
import { isReadOnlyRunView } from './run-view';
import { taskLabel } from './run-progress';
import { WorkflowCheckpointStatus } from './workflow-checkpoint-status';
import { ActivityTimeline } from './activity-timeline';
import { ConversationList } from './conversation-list';
import { AgentExecutionInspector } from './agent-execution-inspector';
import { ReportArtifactRow } from '../reports/components/report-artifact-row';

const executionSnapshot = {
  job: {
    job_id:'85000000-0000-4000-8000-000000000001',org_id:'10000000-0000-4000-8000-000000000001',
    conversation_id:'81000000-0000-4000-8000-000000000001',user_message_id:'86000000-0000-4000-8000-000000000001',
    assistant_message_id:'86000000-0000-4000-8000-000000000002',created_by:'20000000-0000-4000-8000-000000000001',
    status:'waiting' as const,run_id:'82000000-0000-4000-8000-000000000001',attempt:0,fencing_token:1,
    worker_id:null,lease_until:null,error_code:null,created_at:'2026-09-25T00:00:00.000Z',updated_at:'2026-09-25T00:00:03.000Z',
  },
  invocations:[
    ...(['data','compare','insight','report'] as const).map((step_key,index) => ({
      invocation_id:`87000000-0000-4000-8000-00000000000${index+1}`,org_id:'10000000-0000-4000-8000-000000000001',
      job_id:'85000000-0000-4000-8000-000000000001',parent_invocation_id:'87000000-0000-4000-8000-000000000000',
      step_key,agent_key:step_key,depth:1,status:(step_key === 'data' ? 'completed' : step_key === 'compare' ? 'running' : 'queued') as 'completed'|'running'|'queued',
      run_id:'82000000-0000-4000-8000-000000000001',analysis_stage_id:null,created_at:'2026-09-25T00:00:00.000Z',updated_at:'2026-09-25T00:00:03.000Z',
    })),
  ],
  events:[],
};

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
  it('shows a historical published report even without agent packs or a decision brief', () => {
    const runId = '82000000-0000-4000-8000-000000000001';
    const reportId = '84000000-0000-4000-8000-000000000001';
    const artifactId = '84000000-0000-4000-8000-000000000002';
    const detail = {
      report:{org_id:message.org_id,run_id:runId,report_id:reportId,artifact_id:artifactId,
        created_at:'2026-09-20T00:00:00.000Z'},
      artifact:{org_id:message.org_id,run_id:runId,artifact_id:artifactId,kind:'report',
        payload:{title:'Historical inventory report'}},
    } as unknown as Parameters<typeof ReportArtifactRow>[0]['detail'];
    const output = renderToStaticMarkup(<ReportArtifactRow orgId={message.org_id} runId={runId}
      detail={detail} onOpen={() => undefined}/>);
    expect(output).toContain('Historical inventory report');
    expect(output).toContain('Mở báo cáo và in');
    expect(output).toContain('JSON');
    expect(output).toContain('CSV');
    expect(output).not.toContain('report_draft');
  });
  it('shows persisted persona statuses and a historical trace fallback', () => {
    const output = renderToStaticMarkup(<ConversationList conversations={[]} selectedId={null} loading={false} hasMore={false}
      onNew={() => undefined} onSelect={() => undefined} onLoadMore={() => undefined} execution={executionSnapshot}
      selectedAgent="compare" onSelectAgent={() => undefined} />);
    expect(output).toContain('Điều phối');
    expect(output).toContain('Dữ liệu</span><span>Hoàn tất');
    expect(output).toContain('So sánh</span><span>Đang chạy');
    expect(output).toContain('Báo cáo</span><span>Đang chờ');
    expect(output).toContain('aria-pressed="true"');
    const historical = renderToStaticMarkup(<ConversationList conversations={[]} selectedId="81000000-0000-4000-8000-000000000001" loading={false} hasMore={false}
      onNew={() => undefined} onSelect={() => undefined} onLoadMore={() => undefined} execution={null} />);
    expect(historical).toContain('Không có nhật ký thực thi cho hội thoại đã lưu này.');
    expect(historical).not.toContain('Báo cáo</span><span>Đang chờ');
  });

  it('opens persisted run stages in the selected persona inspector', () => {
    const output = renderToStaticMarkup(<AgentExecutionInspector snapshot={executionSnapshot} selectedAgent="insight"
      tasks={[{task_id:'88000000-0000-4000-8000-000000000001',run_id:'82000000-0000-4000-8000-000000000001',org_id:'10000000-0000-4000-8000-000000000001',kind:'analyst',dependencies:[],status:'succeeded',attempt:1,error_code:null}]}
      artifacts={[]} reportId={null} onRun={() => undefined} onArtifact={() => undefined} />);
    expect(output).toContain('Nhận định</h2>');
    expect(output).toContain('Các bước nội bộ');
    expect(output).toContain('Phân tích<span>Thành công');
    expect(output).toContain('Lượt phân tích');
    expect(output).toContain('Dòng thời gian thực thi');
  });
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
    expect(taskLabel('coordinator')).toBe('Quyết định điều phối');
    expect(taskLabel('reviewer')).toBe('Rà soát bản nháp');
    expect(taskLabel('calculation')).toBe('Tính chỉ số');
    expect(taskLabel('untrusted-task')).toBe('Đang xử lý');
  });

  it('keeps persisted specialist names while preserving the legacy label', () => {
    expect(senderLabel('reviewer')).toBe('Người rà soát');
    expect(senderLabel(null)).toBe('VDaAgent');
  });

  it('renders a persisted specialist card without inventing conversation content', () => {
    const output = renderToStaticMarkup(
      <MessageThread
        messages={[{ ...message, sender_agent: 'analyst', status: 'completed', parts: [] }]}
        loading={false}
        hasEarlier={false}
        onLoadEarlier={() => undefined}
        onOpenRun={() => undefined}
        onOpenReport={() => undefined}
        onOpenArtifact={() => undefined}
      />,
    );
    expect(output).toContain('Tác nhân phân tích');
    expect(output).toContain('Phân tích có bằng chứng');
    expect(output).toContain('&lt;script&gt;unsafe()&lt;/script&gt;');
  });

  it('renders compact draft/review state without draft contents', () => {
    const output = renderToStaticMarkup(<WorkflowCheckpointStatus status={checkpointStatus} />);
    expect(output).toContain('Bản sửa bất biến 2 đã được lưu');
    expect(output).toContain('Người rà soát đã duyệt bản nháp 2.');
    expect(output).toContain('Đã phát hành sau khi qua bước kiểm tra');
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
    expect(output).toContain('Trợ lý đã kết thúc với trạng thái an toàn');
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
    expect(output).toContain('Mở bằng chứng đã xác thực');
    expect(output).toContain('<button');
    expect(output).not.toContain('40000000-0000-4000-8000-000000000001');
  });

  it('keeps unresolved and scheduled external runs non-mutating in AgentChat', () => {
    const runId = '82000000-0000-4000-8000-000000000001';
    expect(isReadOnlyRunView(runId, null, undefined)).toBe(true);
    expect(isReadOnlyRunView(runId, { run_id: runId, entrypoint: 'scheduled' }, 'scheduled')).toBe(
      true,
    );
    expect(
      isReadOnlyRunView(runId, { run_id: runId, entrypoint: 'interactive' }, 'interactive'),
    ).toBe(true);
    expect(isReadOnlyRunView(runId,
      { run_id: runId, entrypoint: 'interactive', workflow_version: 'legacy-v1' },
      'interactive')).toBe(true);
  });
});
