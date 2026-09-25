import { useEffect } from 'react';
import type { useMessages } from './use-messages';

export function useSelectedMessages(
  selectedConversationId: string | null,
  loadMessages: ReturnType<typeof useMessages>['loadMessages'],
  activateConversation: ReturnType<typeof useMessages>['activateConversation'],
) {
  useEffect(() => {
    activateConversation(selectedConversationId);
    if (!selectedConversationId) return;
    void loadMessages(selectedConversationId, null, false);
  }, [selectedConversationId, loadMessages, activateConversation]);
}
