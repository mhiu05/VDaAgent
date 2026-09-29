import { useEffect } from 'react';
import type { AgentFeedPage, AgentKey, WorkspaceActionV1 } from '@vda/contracts';
import { MessageThread } from '../../agent-chat/message-thread';
import type { AgentTurnJobSnapshot } from '../../agent-chat/api/conversations';
import { DelegationCard } from './delegation-card';
import styles from './agent-workspace.module.css';

export function AgentConversationFeed({
  page,
  agent,
  loading,
  error,
  execution,
  onOlder,
  onNewer,
  canLoadNewer,
  onRun,
  onReport,
  onArtifact,
  onAction,
  onReply,
  onOpenAgent,
  onExecution,
}: {
  page: AgentFeedPage | null;
  agent: AgentKey;
  loading: boolean;
  error: string | null;
  execution: AgentTurnJobSnapshot | null;
  onOlder: () => void;
  onRun: (runId: string, messageId: string) => void;
  onReport: (reportId: string) => void;
  onNewer: () => void;
  canLoadNewer: boolean;
  onArtifact: (runId: string, artifactId: string) => void;
  onAction: (action: WorkspaceActionV1) => void;
  onReply?: (messageId: string) => void;
  onOpenAgent: (agent: AgentKey, item: string, runId: string, invocationId: string | null) => void;
  onExecution: (runId: string, invocationId: string | null, item: string) => void;
}) {
  useEffect(() => {
    if (!page?.focus_item) return;
    const row = document.getElementById(page.focus_item);
    if (!row) return;
    row.scrollIntoView({
      block: 'center',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
    row.focus({ preventScroll: true });
  }, [page?.focus_item, page?.revision]);
  return (
    <section aria-label={`Hội thoại tác nhân ${agent}`}>
      {page?.older_cursor && (
        <button type="button" className="text-button" onClick={onOlder}>
          Tải hoạt động cũ hơn
        </button>
      )}
      {loading && !page && <p role="status">Đang tải hội thoại tác nhân…</p>}
      {error && (
        <p role="alert" className={styles.stale}>
          {error}
        </p>
      )}
      {page?.items.map((item) => (
        <div key={item.item_id} id={item.item_id} tabIndex={-1} data-agent-item={item.item_id}>
          {item.kind === 'message' ? (
            <MessageThread
              embedded
              messages={[item.message]}
              execution={execution}
              loading={false}
              hasEarlier={false}
              onLoadEarlier={onOlder}
              onOpenRun={onRun}
              onOpenReport={onReport}
              onOpenArtifact={onArtifact}
              onWorkspaceAction={onAction}
              onReply={onReply}
            />
          ) : item.kind === 'delegated_result' ? (
            <div className={styles.delegationCard}>
              <strong>Kết quả gửi cho {item.delegation.caller_agent}</strong>
              <p>{item.delegation.result_summary ?? 'Chi tiết kết quả chưa có.'}</p>
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  onOpenAgent(
                    item.delegation.caller_agent,
                    `activity:${item.delegation.request_activity_id}`,
                    item.delegation.run_id,
                    item.delegation.child?.source === 'runtime'
                      ? item.delegation.child.activity_id
                      : null,
                  )
                }
              >
                Mở yêu cầu gốc →
              </button>
            </div>
          ) : (
            <DelegationCard
              delegation={item.delegation}
              viewAgent={agent}
              onOpenAgent={onOpenAgent}
              onViewExecution={onExecution}
              onEvidence={onArtifact}
            />
          )}
        </div>
      ))}
      {page && canLoadNewer && (
        <button type="button" className="text-button" onClick={onNewer}>
          Tải hoạt động mới hơn
        </button>
      )}
      {page && !page.items.length && (
        <p className="agent-empty-thread">Chưa có hoạt động cho tác nhân này trong hội thoại.</p>
      )}
    </section>
  );
}
