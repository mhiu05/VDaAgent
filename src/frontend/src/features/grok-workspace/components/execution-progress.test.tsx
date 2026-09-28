import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RunSchema, RuntimeActivityRecordSchema } from '@vda/contracts';
import { AgentTurnJobSnapshotSchema } from '../../agent-chat/api/conversations';
import { WorkflowCheckpointStatus } from '../../agent-chat/workflow-checkpoint-status';
import { ExecutionProgress } from './execution-progress';
import { RunProgress } from '../../agent-chat/run-progress';

const id = '70000000-0000-4000-8000-000000000042';
const date = '2026-09-27T00:00:00Z';
const run = RunSchema.parse({ run_id: id, org_id: id, created_by: id, status: 'queued',
  request: { org_id: id, scope: { project_external_id: 'P', zone_external_id: null }, data_as_of: '2026-09-19', question: 'Analyze inventory', conversation_id: id },
  workflow_version: 'agent-v1', created_at: date, updated_at: date,
  idempotency_key: 'progress', request_hash: 'progress', entrypoint: 'interactive', occurrence_id: null,
  attempt: 0, fencing_token: 0, lease_until: null, cancel_requested: false, error_code: null, report_artifact_id: null,
});
const record = RuntimeActivityRecordSchema.parse({ activity_id: id, org_id: id, run_id: id, conversation_id: id,
  kind: 'invocation', step_key: 'team:main', agent_key: 'coordinator', status: 'waiting', summary: 'Waiting for verified data', created_at: date, updated_at: date });
const job = AgentTurnJobSnapshotSchema.parse({ job: { job_id: id, conversation_id: id, user_message_id: id, assistant_message_id: id,
  status: 'waiting', run_id: id, error_code: null, created_at: date, updated_at: date }, invocations: [], events: [] });
const base = { run: null, job: null, accepted: true, records: [], onDetails: () => undefined };

describe('persisted execution progress', () => {
  it.each(['run', 'job'] as const)('explains authentication failures from the %s without recommending an unchanged retry', source => {
    const failed = { ...run, status: 'failed' as const, error_code: 'LLM_AUTHENTICATION_FAILED' };
    const html = renderToStaticMarkup(<ExecutionProgress {...base}
      run={{ run: source === 'run' ? failed : run, tasks: [], events: [] }}
      job={source === 'job' ? { ...job, job: { ...job.job, status: 'failed', error_code: failed.error_code } } : null} />);
    expect(html).toContain('Dịch vụ AI từ chối thông tin xác thực');
    expect(html).toContain('Quản trị viên');
    expect(html).not.toContain('Bạn có thể gửi lại yêu cầu');
    expect(html).not.toContain('aria-label="Đang xử lý phân tích"');
  });

  it('acknowledges queued work before a run or any tasks exist', () => {
    const html = renderToStaticMarkup(<ExecutionProgress {...base} />);
    expect(html).toContain('đang xếp hàng chờ xử lý');
    expect(html).not.toContain('0/0');
    expect(html).toContain('aria-label="Đang xử lý phân tích"');
  });
  it('keeps the job agent icon and label beside progress before a run is loaded', () => {
    const activeJob = AgentTurnJobSnapshotSchema.parse({ ...job, job: { ...job.job, status: 'running' }, invocations: [{
      invocation_id: id, org_id: id, job_id: id, parent_invocation_id: null, step_key: 'team:main',
      agent_key: 'coordinator', depth: 0, status: 'running', run_id: id, analysis_stage_id: null,
      created_at: date, updated_at: date,
    }] });
    const html = renderToStaticMarkup(<ExecutionProgress {...base} job={activeJob} />);
    expect(html).toContain('lucide-bot');
    expect(html).toContain('Main Agent');
    expect(html).toContain('aria-label="\u0110ang x\u1eed l\u00fd ph\u00e2n t\u00edch"');
  });
  it('distinguishes running from waiting using persisted agent activity', () => {
    const detail = { run: { ...run, status: 'running' as const }, tasks: [], events: [] };
    const running = renderToStaticMarkup(<ExecutionProgress {...base} run={detail} />);
    expect(running).toContain('Phân tích đã bắt đầu');
    const waiting = renderToStaticMarkup(<ExecutionProgress {...base} run={detail} job={job} records={[record]} />);
    expect(waiting).toContain('Đang chờ kết quả');
    expect(waiting).toContain('Waiting for verified data');
    expect(waiting).toContain('Main Agent');
    expect(waiting).toContain('lucide-bot');
  });
  it.each(['failed', 'cancelled', 'succeeded'] as const)('stops pending progress for %s before tasks were created', status => {
    const html = renderToStaticMarkup(<ExecutionProgress {...base} run={{ run: { ...run, status }, tasks: [], events: [] }} records={[record]} />);
    expect(html).not.toMatch(/0\/0|Waiting for verified data|class="spin"/);
    expect(html).not.toContain('aria-label="Đang xử lý phân tích"');
    if (status === 'failed') expect(html).toContain('gửi lại yêu cầu');
    if (status === 'succeeded') expect(html).toContain('Kết quả đã được lưu');
  });
  it('explains exhausted execution attempts without naming internal worker concepts', () => {
    const detail = { run: { ...run, status: 'failed' as const, error_code: 'MAX_ATTEMPTS' }, tasks: [], events: [] };
    const html = renderToStaticMarkup(<ExecutionProgress {...base} run={detail} />);
    expect(html).toContain('Phân tích bị gián đoạn nhiều lần');
    expect(html).toContain('Các bước đã hoàn tất vẫn được lưu');
    expect(html).not.toContain('worker');
    expect(html).not.toContain('aria-label="Đang xử lý phân tích"');
  });
  it('lets a failed job stop a stale active run display', () => {
    const html = renderToStaticMarkup(<ExecutionProgress {...base} run={{ run, tasks: [], events: [] }} job={{ ...job, job: { ...job.job, status: 'failed' } }} />);
    expect(html).toContain('Phân tích đã dừng do lỗi');
    expect(html).not.toContain('đang xếp hàng');
  });
  it('does not spin forever at a review checkpoint after an early failure', () => {
    const html = renderToStaticMarkup(<WorkflowCheckpointStatus runStatus="failed" status={{ run_id: id, org_id: id,
      workflow_version: 'agent-v1', stages: [], draft_revision: null, review: null, publication_status: null }} />);
    expect(html).not.toMatch(/spin|Đang chờ/);
    expect(html).toContain('Phân tích đã kết thúc');
  });
  it('stops task animations when a terminal run arrives ahead of its final task poll', () => {
    const html = renderToStaticMarkup(<RunProgress detail={{ run: { ...run, status: 'failed' }, events: [], tasks: [{
      task_id: id, org_id: id, run_id: id, kind: 'data', status: 'running', dependencies: [], attempt: 1, error_code: null,
    }] }} canWrite cancelling={false} onCancel={() => undefined} />);
    expect(html).not.toContain('class="spin"');
    expect(html).toContain('Chờ đồng bộ kết quả đã lưu');
  });
});
