'use client';

import { MessageSquarePlus, Plus } from 'lucide-react';
import type { ConversationListItem } from '@vda/contracts';
import { dateTime } from '../../lib/client-api';

export function ConversationList({
  conversations,
  selectedId,
  loading,
  hasMore,
  onNew,
  onSelect,
  onLoadMore,
}: {
  conversations: ConversationListItem[];
  selectedId: string | null;
  loading: boolean;
  hasMore: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
  onLoadMore: () => void;
}) {
  return (
    <aside className="agent-conversation-list" aria-label="Hội thoại phân tích">
      <div className="agent-conversation-heading">
        <div>
          <span className="eyebrow">AGENT CHAT</span>
          <h2>Hội thoại</h2>
        </div>
        <button className="icon-button" onClick={onNew} aria-label="Hội thoại mới">
          <Plus size={17} />
        </button>
      </div>
      <button className="agent-new-conversation" onClick={onNew}>
        <MessageSquarePlus size={16} /> Hội thoại mới
      </button>
      <div className="agent-conversation-items">
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
      </div>
      {!loading && !conversations.length && (
        <p className="agent-list-empty">Gửi câu hỏi đầu tiên để bắt đầu một hội thoại.</p>
      )}
      {hasMore && (
        <button className="text-button agent-load-more" onClick={onLoadMore}>
          Tải thêm hội thoại
        </button>
      )}
    </aside>
  );
}
