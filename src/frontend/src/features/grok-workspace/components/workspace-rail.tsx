import type { AgentDefinition, AgentInvocation, AgentKey, Conversation, ConversationListItem, RuntimeActivity } from '@vda/contracts';
import { Bot, Plus } from 'lucide-react';
import { dateTime } from '../../../lib/format/date-time';
import { workflowStatusLabel } from '../../../lib/format/status-label';
import { agentRuntimeStatus, canonicalAgentKey, recipientKey } from '../../agent-chat/agent-workspace-model';
import { agentIdentity } from '../../../components/agents/agent-identity';
import styles from './grok-workspace.module.css';

export function WorkspaceRail({
  conversations,
  selectedConversation,
  selectedId,
  agents,
  records,
  invocations = [],
  recipient,
  onRecipient,
  canWrite,
  loading,
  hasMore,
  onNew,
  onSelect,
  onLoadMore,
}: {
  conversations: ConversationListItem[];
  selectedConversation: Conversation | null;
  selectedId: string | null;
  agents: AgentDefinition[];
  records: RuntimeActivity[];
  invocations?: AgentInvocation[];
  recipient: AgentKey | null;
  onRecipient: (recipient: AgentKey | null) => void;
  canWrite: boolean;
  loading: boolean;
  hasMore: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
  onLoadMore: () => void;
}) {
  const selectedOutsidePage = selectedConversation && !conversations.some((item) => item.conversation_id === selectedConversation.conversation_id);
  const rows: Conversation[] = selectedOutsidePage ? [selectedConversation, ...conversations] : conversations;
  return <nav className={styles.rail} aria-label="Hội thoại và quy trình">
    <div className={styles.railHeading}><h2>Tác nhân</h2><span className={styles.railHint}>Một hội thoại · một nhóm</span></div>
    <ul className={styles.agentList} aria-label="Chọn tác nhân">
      {agents.map((agent) => {
        const recordState = agentRuntimeStatus(agent.id, records);
        const state = recordState === 'idle' ? invocations.find((invocation) => canonicalAgentKey(invocation.agent_key) === agent.id)?.status ?? 'idle' : recordState;
        const Icon = agentIdentity(agent.id as AgentKey)?.icon ?? Bot;
        return <li key={agent.id}><button type="button" aria-label={`${agentIdentity(agent.id as AgentKey)?.label ?? agent.name} · ${workflowStatusLabel(state)}`} aria-pressed={(recipient ?? 'coordinator') === agent.id} onClick={() => onRecipient(recipientKey(agent))}>
          <span className={styles.agentAvatar} data-agent={agent.id}><Icon size={18} aria-hidden="true" /></span>
          <span className={styles.agentCopy}><strong>{agentIdentity(agent.id as AgentKey)?.label ?? agent.name}</strong></span>
        </button></li>;
      })}
    </ul>
    {!agents.length && <p className={styles.railHint}>Đang tải danh sách tác nhân…</p>}
    <section className={styles.railSection} aria-label="Hội thoại đã lưu">
      <div className={styles.railHeading}><h3>Hội thoại</h3>{canWrite && <button type="button" className="icon-button" onClick={onNew} aria-label="Hội thoại mới"><Plus size={18} /></button>}</div>
      {rows.length ? <ul className={styles.conversationList}>{rows.map((conversation) => <li key={conversation.conversation_id}>
        <button type="button" onClick={() => onSelect(conversation.conversation_id)} aria-current={selectedId === conversation.conversation_id ? 'page' : undefined}>
          <strong>{conversation.title}</strong>
          <time dateTime={conversation.updated_at}>{dateTime(conversation.updated_at)}</time>
        </button>
      </li>)}</ul> : !loading && <p>Chưa có hội thoại đã lưu.</p>}
      {hasMore && <button type="button" className="text-button" onClick={onLoadMore}>Tải thêm hội thoại</button>}
    </section>
  </nav>;
}
