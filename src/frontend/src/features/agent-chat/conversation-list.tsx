'use client';

import { MessageSquarePlus, Plus } from 'lucide-react';
import type { ConversationListItem } from '@vda/contracts';
import { dateTime } from '../../lib/format/date-time';
import type { AgentTurnJobSnapshot } from './api/conversations';
import { workflowStatusLabel } from '../../lib/format/status-label';

export function ConversationList({
  conversations,
  selectedId,
  loading,
  hasMore,
  onNew,
  onSelect,
  onLoadMore,
  execution = null,
  selectedAgent = null,
  onSelectAgent,
  showConversations = true,
}: {
  conversations: ConversationListItem[];
  selectedId: string | null;
  loading: boolean;
  hasMore: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
  onLoadMore: () => void;
  execution?: AgentTurnJobSnapshot | null;
  selectedAgent?: string | null;
  onSelectAgent?: (stepKey: string) => void;
  showConversations?: boolean;
}) {
  return (
    <aside className="agent-conversation-list" aria-label="Hội thoại phân tích">
      {showConversations && <>
      <div className="agent-conversation-heading">
        <div>
          <span className="eyebrow">TRỢ LÝ AI</span>
          <h2>Hội thoại</h2>
        </div>
        <button className="icon-button" onClick={onNew} aria-label="Hội thoại mới">
          <Plus size={17} />
        </button>
      </div>
      <button className="agent-new-conversation" onClick={onNew}>
        <MessageSquarePlus size={16} /> Hội thoại mới
      </button>
      </>}
      <section className="agent-persona-list" aria-label="Các tác nhân">
        <h3>Tác nhân</h3>
        {([
          ['root','Điều phối'],['data','Dữ liệu'],['compare','So sánh'],['insight','Nhận định'],['report','Báo cáo'],
        ] as const).map(([key,label]) => {
          const invocation = key === 'root' ? null : execution?.invocations.find((item) => item.step_key === key);
          const status = key === 'root' ? execution?.job.status : invocation?.status;
          const text = status ? workflowStatusLabel(status) : !selectedId ? 'Sẵn sàng' : execution && (key === 'root' || invocation) ? 'Đang chờ' : 'Chưa có dữ liệu';
          return <button type="button" className={`agent-persona-item ${key !== 'root' ? 'child' : ''} ${selectedAgent === key ? 'active' : ''}`}
            key={key} onClick={() => onSelectAgent?.(key)} aria-pressed={selectedAgent === key} aria-label={`${label}, ${text}`}>
            <span>{label}</span><span>{text}</span>
          </button>;
        })}
        {selectedId && execution === null && <p className="agent-trace-unavailable">Không có nhật ký thực thi cho hội thoại đã lưu này.</p>}
      </section>
      {showConversations && <div className="agent-conversation-items">
        {conversations.map((conversation) => (
          <button
            key={conversation.conversation_id}
            className={`agent-conversation-item ${selectedId === conversation.conversation_id ? 'active' : ''}`}
            onClick={() => onSelect(conversation.conversation_id)}
            aria-current={selectedId === conversation.conversation_id ? 'page' : undefined}
          >
            <strong>{conversation.title}</strong>
            <span>
              {conversation.latest_status && (
                <i
                  className={`agent-status-dot ${conversation.latest_status}`}
                  aria-hidden="true"
                />
              )}
              {dateTime(conversation.updated_at)}
            </span>
          </button>
        ))}
      </div>}
      {showConversations && !loading && !conversations.length && (
        <p className="agent-list-empty">Gửi câu hỏi đầu tiên để bắt đầu một hội thoại.</p>
      )}
      {showConversations && hasMore && (
        <button className="text-button agent-load-more" onClick={onLoadMore}>
          Tải thêm hội thoại
        </button>
      )}
    </aside>
  );
}
