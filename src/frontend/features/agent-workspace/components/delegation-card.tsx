import type { AgentKey, DelegationView } from '@vda/contracts';
import { agentIdentity } from '../../../components/agents/agent-identity';
import styles from './agent-workspace.module.css';

const statusLabel: Record<DelegationView['status'], string> = {
  queued: 'Đã nhận · đang chờ',
  running: 'Đang xử lý',
  waiting: 'Đang chờ tác nhân khác',
  completed: 'Đã hoàn tất',
  failed: 'Đã dừng do lỗi',
  cancelled: 'Đã hủy',
  unknown: 'Chưa có chi tiết kết quả',
};
export function DelegationCard({
  delegation,
  viewAgent,
  onOpenAgent,
  onViewExecution,
  onEvidence,
}: {
  delegation: DelegationView;
  viewAgent: AgentKey;
  onOpenAgent: (agent: AgentKey, item: string, runId: string, invocationId: string | null) => void;
  onViewExecution: (runId: string, invocationId: string | null, item: string) => void;
  onEvidence: (runId: string, artifactId: string) => void;
}) {
  const outgoing = viewAgent === delegation.caller_agent;
  const counterpart = outgoing ? delegation.callee_agent : delegation.caller_agent;
  const counterpartName = agentIdentity(counterpart)?.label ?? counterpart;
  const requestItem = `activity:${delegation.request_activity_id}`;
  const duration =
    delegation.duration_ms === null ? '' : ` · ${(delegation.duration_ms / 1000).toFixed(1)}s`;
  return (
    <article className={styles.delegationCard} data-status={delegation.status}>
      <strong>{outgoing ? `Đã giao cho ${counterpartName}` : `Từ ${counterpartName}`}</strong>
      <span className={styles.delegationState}>
        {statusLabel[delegation.status]}
        {duration}
      </span>
      <p>{delegation.request_summary}</p>
      {delegation.result_summary && (
        <p className={styles.delegationResult}>{delegation.result_summary}</p>
      )}
      {(delegation.error_code || delegation.linkage === 'historical_partial') && (
        <details className={styles.delegationDetails}>
          <summary>Chi tiết</summary>
          {delegation.error_code && <small>Mã lỗi: {delegation.error_code}</small>}
          {delegation.linkage === 'historical_partial' && (
            <small>Chi tiết liên kết lịch sử chưa đầy đủ.</small>
          )}
        </details>
      )}
      <div className={styles.delegationActions}>
        <button
          type="button"
          className="text-button"
          onClick={() =>
            onOpenAgent(
              counterpart,
              requestItem,
              delegation.run_id,
              delegation.child?.source === 'runtime' ? delegation.child.activity_id : null,
            )
          }
        >
          {outgoing ? `Mở hội thoại ${counterpartName}` : `Mở yêu cầu từ ${counterpartName}`} →
        </button>
        <button
          type="button"
          className="text-button"
          onClick={() =>
            onViewExecution(
              delegation.run_id,
              delegation.child?.source === 'runtime' ? delegation.child.activity_id : null,
              requestItem,
            )
          }
        >
          Xem quá trình
        </button>
        {delegation.artifact_refs.map((id) => (
          <button
            key={id}
            type="button"
            className="text-button"
            onClick={() => onEvidence(delegation.run_id, id)}
          >
            Mở bằng chứng · {id.slice(0, 8)}
          </button>
        ))}
      </div>
    </article>
  );
}
