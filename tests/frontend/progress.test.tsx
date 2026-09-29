// @vitest-environment happy-dom
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunSchema, RuntimeActivityRecordSchema } from '@vda/contracts';
import { AgentTurnJobSnapshotSchema } from '../../src/frontend/features/agent-chat/api/conversations';
import { WorkflowCheckpointStatus } from '../../src/frontend/features/agent-chat/workflow-checkpoint-status';
import { ExecutionProgress } from '../../src/frontend/features/agent-workspace/components/execution-progress';

const id = '70000000-0000-4000-8000-000000000042';
const date = '2026-09-27T00:00:00Z';
const run = RunSchema.parse({
  run_id: id,
  org_id: id,
  created_by: id,
  status: 'queued',
  request: {
    org_id: id,
    scope: { project_external_id: 'P', zone_external_id: null },
    data_as_of: '2026-09-19',
    question: 'Analyze inventory',
    conversation_id: id,
  },
  workflow_version: 'agent-v1',
  created_at: date,
  updated_at: date,
  idempotency_key: 'progress',
  request_hash: 'progress',
  entrypoint: 'interactive',
  occurrence_id: null,
  attempt: 0,
  fencing_token: 0,
  lease_until: null,
  cancel_requested: false,
  error_code: null,
  report_artifact_id: null,
});
const job = AgentTurnJobSnapshotSchema.parse({
  job: {
    job_id: id,
    conversation_id: id,
    user_message_id: id,
    assistant_message_id: id,
    status: 'waiting',
    run_id: id,
    error_code: null,
    created_at: date,
    updated_at: date,
  },
  invocations: [],
  events: [],
});
const record = RuntimeActivityRecordSchema.parse({
  activity_id: id,
  org_id: id,
  run_id: id,
  conversation_id: id,
  kind: 'invocation',
  step_key: 'team:main',
  agent_key: 'coordinator',
  status: 'waiting',
  summary: 'Waiting for verified data',
  created_at: date,
  updated_at: date,
});
const base = { run: null, job: null, accepted: true, records: [], onDetails: () => undefined };

afterEach(() => vi.restoreAllMocks());

describe('persisted execution status', () => {
  it('shows queued work before a run exists and hydrates its progress display', async () => {
    const html = renderToStaticMarkup(<ExecutionProgress {...base} />);
    expect(html).toContain('đang xếp hàng chờ xử lý');
    expect(html).not.toContain('0/0');
    const host = document.createElement('div');
    host.innerHTML = renderToString(<ExecutionProgress {...base} />);
    document.body.append(host);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(host, <ExecutionProgress {...base} />);
      });
      expect(host.querySelector('canvas')).not.toBeNull();
      expect(errors.mock.calls.flat().join(' ')).not.toMatch(/hydration|did not match/i);
    } finally {
      await act(async () => root?.unmount());
      host.remove();
    }
  });

  it('shows the agent while its job runs before run details are available', () => {
    const active = AgentTurnJobSnapshotSchema.parse({
      ...job,
      job: { ...job.job, status: 'running' },
      invocations: [
        {
          invocation_id: id,
          org_id: id,
          job_id: id,
          parent_invocation_id: null,
          step_key: 'team:main',
          agent_key: 'coordinator',
          depth: 0,
          status: 'running',
          run_id: id,
          analysis_stage_id: null,
          created_at: date,
          updated_at: date,
        },
      ],
    });
    const html = renderToStaticMarkup(<ExecutionProgress {...base} job={active} />);
    expect(html).toContain('Điều phối viên');
    expect(html).toContain('lucide-bot');
  });

  it('uses persisted activity to distinguish waiting from running', () => {
    const detail = { run: { ...run, status: 'running' as const }, tasks: [], events: [] };
    const running = renderToStaticMarkup(<ExecutionProgress {...base} run={detail} />);
    const waiting = renderToStaticMarkup(
      <ExecutionProgress {...base} run={detail} job={job} records={[record]} />,
    );
    expect(running).toContain('Phân tích đã bắt đầu');
    expect(waiting).toContain('Waiting for verified data');
    expect(waiting).toContain('Điều phối viên');
  });

  it.each(['failed', 'cancelled', 'succeeded'] as const)(
    'stops pending animation for a %s run',
    (status) => {
      const html = renderToStaticMarkup(
        <ExecutionProgress
          {...base}
          run={{ run: { ...run, status }, tasks: [], events: [] }}
          records={[record]}
        />,
      );
      expect(html).not.toMatch(/0\/0|Waiting for verified data|class="spin"/);
      if (status === 'succeeded') expect(html).toContain('Kết quả đã được lưu');
    },
  );

  it('ends at an early failure without exposing worker terminology', () => {
    const detail = {
      run: { ...run, status: 'failed' as const, error_code: 'MAX_ATTEMPTS' },
      tasks: [],
      events: [],
    };
    const html = renderToStaticMarkup(<ExecutionProgress {...base} run={detail} />);
    expect(html).not.toContain('worker');
    const checkpoint = renderToStaticMarkup(
      <WorkflowCheckpointStatus
        runStatus="failed"
        status={{
          run_id: id,
          org_id: id,
          workflow_version: 'agent-v1',
          stages: [],
          draft_revision: null,
          review: null,
          publication_status: null,
        }}
      />,
    );
    expect(checkpoint).not.toMatch(/spin|Đang chờ/);
  });

  it('honors terminal status even when a final task poll is stale', () => {
    const html = renderToStaticMarkup(
      <ExecutionProgress
        {...base}
        run={{
          run: { ...run, status: 'failed' },
          events: [],
          tasks: [
            {
              task_id: id,
              org_id: id,
              run_id: id,
              kind: 'data',
              status: 'running',
              dependencies: [],
              attempt: 1,
              error_code: null,
            },
          ],
        }}
      />,
    );
    expect(html).not.toContain('class="spin"');
  });
});
