import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { Message } from '@vda/contracts';
import { errorMessage } from '../../../lib/http/api-client';
import { listConversationMessages } from '../api/conversations';
import { mergeMessages } from '../timeline-model';

export function useSelectedMessages(
  orgId: string,
  selectedConversationId: string | null,
  setMessages: Dispatch<SetStateAction<Message[]>>,
  setMessageCursor: Dispatch<SetStateAction<string | null>>,
  onError: (message: string) => void,
  activateConversation?: (id: string | null) => void,
) {
  useEffect(() => {
    activateConversation?.(selectedConversationId);
    if (!selectedConversationId) return;
    let obsolete = false;
    setMessages([]);
    setMessageCursor(null);
    void listConversationMessages(orgId, selectedConversationId, { limit: 30 }).then(
      (page) => {
        if (obsolete) return;
        setMessages((current) => mergeMessages(current, page.messages));
        setMessageCursor(page.next_cursor);
      },
      (cause: unknown) => {
        if (!obsolete) onError(errorMessage(cause));
      },
    );
    return () => {
      obsolete = true;
    };
  }, [orgId, selectedConversationId, onError, setMessages, setMessageCursor, activateConversation]);
}
