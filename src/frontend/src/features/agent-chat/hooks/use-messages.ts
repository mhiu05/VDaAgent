import { useCallback, useEffect, useRef, useState } from 'react';
import type { Message } from '@vda/contracts';
import { errorMessage } from '../../../lib/http/api-client';
import { listConversationMessages } from '../api/conversations';
import { mergeMessages } from '../timeline-model';

export function useMessages(orgId: string, onError: (message: string) => void) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageCursor, setMessageCursor] = useState<string | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const activeConversation = useRef<string | null>(null);
  const activeOrg = useRef(orgId);
  useEffect(() => { activeOrg.current = orgId; }, [orgId]);
  const exhausted = useRef(false);
  const activateConversation = useCallback((id: string | null) => {
    if (activeConversation.current !== id) exhausted.current = false;
    activeConversation.current = id;
  }, []);
  const loadMessages = useCallback(
    async (conversationId: string, cursor: string | null, appendEarlier: boolean) => {
      if (activeConversation.current !== conversationId || activeOrg.current !== orgId) return;
      setLoadingMessages(true);
      try {
        const page = await listConversationMessages(orgId, conversationId, { limit: 30, cursor });
        if (activeConversation.current !== conversationId || activeOrg.current !== orgId) return;
        setMessages((current) => mergeMessages(current, page.messages));
        if (appendEarlier) exhausted.current = page.next_cursor === null;
        setMessageCursor((current) => appendEarlier ? page.next_cursor : exhausted.current ? null : (current ?? page.next_cursor));
      } catch (cause) {
        if (activeConversation.current === conversationId && activeOrg.current === orgId) onError(errorMessage(cause));
      } finally {
        if (activeConversation.current === conversationId && activeOrg.current === orgId) setLoadingMessages(false);
      }
    },
    [orgId, onError],
  );

  return { messages, setMessages, messageCursor, setMessageCursor, loadingMessages, loadMessages, activateConversation };
}
