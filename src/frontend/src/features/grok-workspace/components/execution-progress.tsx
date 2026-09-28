'use client';

import { ThinkingOrb, type OrbState } from 'thinking-orbs';
import type { AgentKey, RuntimeActivityRecord } from '@vda/contracts';
import { agentIdentity } from '../../../components/agents/agent-identity';
import { canonicalAgentKey } from '../../agent-chat/agent-workspace-model';
import type { AgentTurnJobSnapshot } from '../../agent-chat/api/conversations';
import type { RunDetail } from '../../evidence/components/tab-primitives';
import { workflowStatusLabel } from '../../../lib/format/status-label';
import { analysisErrorMessage } from '../../../lib/format/analysis-error';
import styles from './grok-workspace.module.css';

function activityOrbState(status: string, activity?: RuntimeActivityRecord): OrbState {
  if (status === 'queued') return 'breathing';
  if (activity?.status === 'waiting') return 'connecting';
  if (activity?.tool_name?.startsWith('data.') || activity?.agent_key === 'data') return 'searching';
  if (activity?.tool_name?.startsWith('report.') || activity?.agent_key === 'report') return 'composing';
  if (activity?.tool_name === 'chart.build' || activity?.agent_key === 'chart') return 'shaping';
  if (['comparison', 'analyst', 'reviewer'].includes(activity?.agent_key ?? '')) return 'solving';
  if (activity?.agent_key === 'insight') return 'weaving';
  if (status === 'waiting') return 'connecting';
  return 'working';
}

export function ExecutionProgress({ run, job, accepted, records, onDetails }: {
  run: RunDetail | null;
  job: AgentTurnJobSnapshot | null;
  accepted: boolean;
  records: RuntimeActivityRecord[];
  onDetails: () => void;
}) {
  if (!run && !job && !accepted) return null;
  const matchingJob = !run || job?.job.run_id === run.run.run_id ? job : null;
  const root = records.find(record => record.kind === 'invocation' && !record.parent_step_key);
  let status = run?.run.status ?? matchingJob?.job.status ?? 'queued';
  if (matchingJob && ['failed', 'cancelled'].includes(matchingJob.job.status)) status = matchingJob.job.status;
  else if (status === 'running' && root?.status === 'waiting') status = 'waiting';
  else if (status === 'succeeded' && matchingJob && ['running', 'waiting'].includes(matchingJob.job.status)) status = 'waiting';
  const terminal = ['failed', 'cancelled', 'succeeded', 'completed'].includes(status);
  const completed = run?.tasks.filter(task => task.status === 'succeeded').length ?? 0;
  const total = run?.tasks.length ?? 0;
  const latest = records.filter(record => (record.kind === 'invocation' || record.kind === 'tool') && ['queued', 'running', 'waiting'].includes(record.status ?? ''))
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at) || Number(right.status === 'running') - Number(left.status === 'running'))[0];
  const latestInvocation = matchingJob?.invocations.filter(invocation => ['queued', 'running', 'waiting'].includes(invocation.status))
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at) || Number(right.status === 'running') - Number(left.status === 'running'))[0];
  const activeAgentKey = latest?.agent_key ?? latestInvocation?.agent_key;
  const identity = activeAgentKey ? agentIdentity(canonicalAgentKey(activeAgentKey) as AgentKey) : null;
  const AgentIcon = identity?.icon;
  const failedTask = run?.tasks.find(task => task.status === 'failed');
  const failedAgent = failedTask ? agentIdentity(failedTask.kind as AgentKey)?.shortLabel : null;
  const maxAttempts = run?.run.error_code === 'MAX_ATTEMPTS' || matchingJob?.job.error_code === 'MAX_ATTEMPTS';
  const failureMessage = analysisErrorMessage(matchingJob?.job.error_code) ?? analysisErrorMessage(run?.run.error_code);
  const description = status === 'failed' && failureMessage ? failureMessage
    : status === 'failed' && maxAttempts
    ? 'Phân tích bị gián đoạn nhiều lần nên đã dừng. Các bước đã hoàn tất vẫn được lưu trong chi tiết phân tích. Bạn có thể gửi lại yêu cầu để bắt đầu lượt mới.'
    : status === 'failed' ? `Phân tích đã dừng${failedAgent ? ` ở bước ${failedAgent}` : ' do lỗi'}. Các kết quả đã lưu vẫn có thể xem trong chi tiết phân tích. Bạn có thể gửi lại yêu cầu để bắt đầu lượt mới.`
    : status === 'cancelled' ? 'Phân tích đã được hủy.'
    : terminal ? 'Kết quả đã được lưu.'
    : status === 'queued' ? 'Yêu cầu đã được nhận, đang xếp hàng chờ xử lý. Bạn có thể rời trang và quay lại.'
    : status === 'waiting' ? (run?.run.status === 'succeeded' ? 'Đang hoàn tất câu trả lời từ kết quả đã lưu.' : 'Đang chờ kết quả từ các bước phân tích.')
    : 'Phân tích đã bắt đầu. Tiến độ sẽ cập nhật khi có hoạt động mới.';
  return <div className={styles.runSummary} aria-label="Tiến độ lượt chạy" role="status" data-status={status}>
    {terminal ? <span className={styles.runtimeDot} data-status={status === 'succeeded' ? 'completed' : status} />
      : <ThinkingOrb state={activityOrbState(status, latest)} size={20} theme="dark" aria-label="Đang xử lý phân tích" />}
    <strong>{workflowStatusLabel(status)}</strong>
    <span>{description}</span>
    {total > 0 && <span>{completed}/{total} bước đã hoàn tất</span>}
    {!terminal && activeAgentKey && <span className={styles.progressActivity}>{AgentIcon && <AgentIcon size={15} aria-hidden={true} />}<strong>{identity?.label ?? activeAgentKey}</strong>{latest?.summary ? ` · ${latest.summary} · ` : ' · '}{workflowStatusLabel(latest?.status ?? latestInvocation?.status ?? 'queued')}</span>}
    {run && <button type="button" className="text-button" onClick={onDetails}>Chi tiết phân tích</button>}
  </div>;
}
