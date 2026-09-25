import type { Conversation, ConversationListItem, RunTask } from '@vda/contracts';
import { Plus } from 'lucide-react';
import { dateTime } from '../../../lib/format/date-time';
import { stageLabel, stageStateLabel } from '../../agent-chat/workflow-view-model';
import styles from './grok-workspace.module.css';

export function WorkspaceRail({
  conversations,
  selectedConversation,
  selectedId,
  tasks,
  workflowVersion,
  canWrite,
  loading,
  hasMore,
  onNew,
  onSelect,
  onLoadMore,
  onStage,
}: {
  conversations: ConversationListItem[];
  selectedConversation: Conversation | null;
  selectedId: string | null;
  tasks: RunTask[];
  workflowVersion?: string;
  canWrite: boolean;
  loading: boolean;
  hasMore: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
  onLoadMore: () => void;
  onStage: (task: RunTask) => void;
}) {
  const selectedOutsidePage = selectedConversation && !conversations.some((item) => item.conversation_id === selectedConversation.conversation_id);
  const rows: Conversation[] = selectedOutsidePage ? [selectedConversation, ...conversations] : conversations;
  return <nav className={styles.rail} aria-label="Hội thoại và quy trình">
    <div className={styles.railHeading}>
      <h2>Hội thoại</h2>
      {canWrite && <button type="button" className="icon-button" onClick={onNew} aria-label="Hội thoại mới"><Plus size={18} /></button>}
    </div>
    {tasks.length > 0 && <section className={styles.railSection} aria-label="Các bước phân tích">
      <h3>Các bước phân tích</h3>
      <ol className={styles.stageList}>
        {tasks.map((task) => <li key={task.task_id}>
          <button type="button" onClick={() => onStage(task)} data-status={task.status} aria-label={`${stageLabel(task.kind, workflowVersion)}, ${stageStateLabel(task.status)}`}>
            <strong>{stageLabel(task.kind, workflowVersion)}</strong>
            <span>{stageStateLabel(task.status)}</span>
          </button>
        </li>)}
      </ol>
    </section>}
    <section className={styles.railSection} aria-label="Hội thoại đã lưu">
      <h3>Đã lưu</h3>
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
