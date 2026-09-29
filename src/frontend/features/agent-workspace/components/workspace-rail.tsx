import { useEffect, useRef, useState } from 'react';
import type {
  AgentDefinition,
  AgentInvocation,
  AgentKey,
  Conversation,
  ConversationListItem,
  RuntimeActivity,
  AcceptedWork,
  ConversationAgents,
  AgentWorkPage,
} from '@vda/contracts';
import { Bot, Plus } from 'lucide-react';
import { dateTime } from '../../../lib/format/date-time';
import { workflowStatusLabel } from '../../../lib/format/status-label';
import {
  agentRuntimeStatus,
  canonicalAgentKey,
  recipientKey,
} from '../../agent-chat/agent-workspace-model';
import { agentIdentity } from '../../../components/agents/agent-identity';
import { listAgentWork } from '../../agent-chat/api/conversations';
import { errorMessage } from '../../../lib/http/api-client';
import styles from './agent-workspace.module.css';

function activityDescription(summary: ConversationAgents['agents'][number] | undefined): string | null {
  if (!summary) return null;
  const work =
    summary.previews.find((item) => item.state === 'running') ??
    summary.previews.find((item) => item.state === 'waiting') ??
    summary.previews.find((item) => item.state === 'queued');
  if (!work) return null;
  const request = work.summary.replace(/\s+/g, ' ').trim();
  const shortRequest = request.length > 68 ? `${request.slice(0, 67).trimEnd()}…` : request;
  if (work.state === 'waiting') return 'Đang chờ tác nhân khác';
  if (!shortRequest) return work.state === 'queued' ? 'Đã nhận yêu cầu' : 'Đang xử lý yêu cầu';
  return `${work.state === 'queued' ? 'Đã nhận' : 'Đang xử lý'}: ${shortRequest}`;
}

export function WorkspaceRail({
  orgId,
  conversations,
  selectedConversation,
  selectedId,
  agents,
  records,
  invocations = [],
  summaries,
  recipient,
  onRecipient,
  onWork,
  canWrite,
  loading,
  hasMore,
  onNew,
  onSelect,
  onLoadMore,
}: {
  orgId: string;
  conversations: ConversationListItem[];
  selectedConversation: Conversation | null;
  selectedId: string | null;
  agents: AgentDefinition[];
  records: RuntimeActivity[];
  invocations?: AgentInvocation[];
  summaries?: ConversationAgents['agents'];
  recipient: AgentKey | null;
  onRecipient: (recipient: AgentKey | null) => void;
  onWork?: (work: AcceptedWork) => void;
  canWrite: boolean;
  loading: boolean;
  hasMore: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
  onLoadMore: () => void;
}) {
  const [workPage, setWorkPage] = useState<AgentWorkPage | null>(null);
  const [workLoading, setWorkLoading] = useState(false);
  const [workError, setWorkError] = useState<string | null>(null);
  const workScope = useRef('');
  useEffect(() => {
    workScope.current = `${orgId}:${selectedId}:${recipient ?? 'coordinator'}`;
    setWorkPage(null);
    setWorkError(null);
  }, [orgId, selectedId, recipient]);
  async function loadWork(cursor?: string) {
    if (!selectedId) return;
    const agent = recipient ?? 'coordinator';
    const scope = `${orgId}:${selectedId}:${agent}`;
    workScope.current = scope;
    setWorkLoading(true);
    try {
      const next = await listAgentWork(orgId, selectedId, agent, { cursor });
      if (workScope.current !== scope) return;
      setWorkPage((previous) =>
        cursor && previous ? { ...next, items: [...previous.items, ...next.items] } : next,
      );
      setWorkError(null);
    } catch (cause) {
      if (workScope.current === scope) setWorkError(errorMessage(cause));
    } finally {
      if (workScope.current === scope) setWorkLoading(false);
    }
  }
  const selectedOutsidePage =
    selectedConversation &&
    !conversations.some((item) => item.conversation_id === selectedConversation.conversation_id);
  const rows: Conversation[] = selectedOutsidePage
    ? [selectedConversation, ...conversations]
    : conversations;
  return (
    <nav className={styles.rail} aria-label="Hội thoại và quy trình">
      <div className={styles.railHeading}>
        <h2>Tác nhân</h2>
        <span className={styles.railHint}>Một hội thoại · một nhóm</span>
      </div>
      <ul className={styles.agentList} aria-label="Chọn tác nhân">
        {agents.map((agent) => {
          const summary = summaries?.find((item) => item.agent_key === agent.id);
          const recordState = agentRuntimeStatus(agent.id, records);
          const state =
            summary?.state ??
            (recordState === 'idle'
              ? (invocations.find(
                  (invocation) => canonicalAgentKey(invocation.agent_key) === agent.id,
                )?.status ?? 'idle')
              : recordState);
          const stateLabel = summary
            ? (
                {
                  idle: 'Rảnh',
                  queued: 'Đã nhận',
                  working: 'Đang xử lý',
                  waiting: 'Đang chờ',
                } as const
              )[summary.state]
            : workflowStatusLabel(state);
          const description = activityDescription(summary);
          const visibleState = summary?.recent_error && summary.state === 'idle' ? 'Có lỗi gần đây' : stateLabel;
          const Icon = agentIdentity(agent.id as AgentKey)?.icon ?? Bot;
          return (
            <li key={agent.id}>
              <button
                type="button"
                aria-label={`${agentIdentity(agent.id as AgentKey)?.label ?? agent.name} · ${visibleState}`}
                aria-pressed={(recipient ?? 'coordinator') === agent.id}
                data-state={summary?.recent_error && summary.state === 'idle' ? 'error' : state}
                onClick={() => onRecipient(recipientKey(agent))}
              >
                <span className={styles.agentAvatar} data-agent={agent.id}>
                  <Icon size={18} aria-hidden="true" />
                </span>
                <span className={styles.agentCopy}>
                  <strong>{agentIdentity(agent.id as AgentKey)?.label ?? agent.name}</strong>
                  <small>
                    {description ?? visibleState}
                    {summary?.active_count && !description ? ` · ${summary.active_count} đang hoạt động` : ''}
                    {summary?.queued_count ? ` · ${summary.queued_count} chờ` : ''}
                    {summary?.recent_error && summary.state !== 'idle' ? ' · Có lỗi gần đây' : ''}
                  </small>
                </span>
              </button>
              {(recipient ?? 'coordinator') === agent.id && summary && summary.active_count > 0 ? (
                <ul className={styles.agentWorkPreview} aria-label="Công việc đã nhận">
                  {(workPage?.agent_key === agent.id && workPage.conversation_id === selectedId
                    ? workPage.items
                    : (summary?.previews ?? [])
                  ).map((work) => (
                    <li key={work.work_id}>
                      <button type="button" onClick={() => onWork?.(work)} disabled={!onWork}>
                        <span>
                          {work.caller === 'human'
                            ? 'Bạn'
                            : (agentIdentity(work.caller)?.label ?? work.caller)}{' '}
                          ·{' '}
                          {work.state === 'queued'
                            ? 'Đã nhận'
                            : work.state === 'waiting'
                              ? 'Đang chờ'
                              : 'Đang xử lý'}
                        </span>
                        <small>{work.summary}</small>
                      </button>
                    </li>
                  ))}
                  {summary && summary.active_count > summary.previews.length && !workPage && (
                    <li>
                      <button type="button" onClick={() => void loadWork()} disabled={workLoading}>
                        Xem tất cả công việc
                      </button>
                    </li>
                  )}
                  {workPage?.agent_key === agent.id &&
                    workPage.conversation_id === selectedId &&
                    workPage.next_cursor && (
                      <li>
                        <button
                          type="button"
                          onClick={() => void loadWork(workPage.next_cursor!)}
                          disabled={workLoading}
                        >
                          Tải thêm công việc
                        </button>
                      </li>
                    )}
                  {workError && <li role="alert">{workError}</li>}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
      {!agents.length && <p className={styles.railHint}>Đang tải danh sách tác nhân…</p>}
      <section className={styles.railSection} aria-label="Hội thoại đã lưu">
        <div className={styles.railHeading}>
          <h3>Hội thoại</h3>
          {canWrite && (
            <button
              type="button"
              className="icon-button"
              onClick={onNew}
              aria-label="Hội thoại mới"
            >
              <Plus size={18} />
            </button>
          )}
        </div>
        {rows.length ? (
          <ul className={styles.conversationList}>
            {rows.map((conversation) => (
              <li key={conversation.conversation_id}>
                <button
                  type="button"
                  onClick={() => onSelect(conversation.conversation_id)}
                  aria-current={selectedId === conversation.conversation_id ? 'page' : undefined}
                >
                  <strong>{conversation.title}</strong>
                  <time dateTime={conversation.updated_at}>
                    {dateTime(conversation.updated_at)}
                  </time>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          !loading && <p>Chưa có hội thoại đã lưu.</p>
        )}
        {hasMore && (
          <button type="button" className="text-button" onClick={onLoadMore}>
            Tải thêm hội thoại
          </button>
        )}
      </section>
    </nav>
  );
}
