import { useCallback, useEffect, useRef, useState } from 'react';
import type { Conversation } from '@vda/contracts';
import { errorMessage } from '../../../lib/http/api-client';
import { getConversation, listConversations } from '../api/conversations';

export function useConversations(orgId: string, onError: (message: string) => void) {
  const [conversations, setConversations] = useState<
    Awaited<ReturnType<typeof listConversations>>['conversations']
  >([]);
  const [conversationCursor, setConversationCursor] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [selectedMetadata, setSelectedMetadata] = useState<Conversation | null>(null);
  const requestScope = useRef({ orgId, sequence: 0 });
  useEffect(() => { requestScope.current = { orgId, sequence: 0 }; }, [orgId]);
  const loadConversations = useCallback(
    async (cursor: string | null, append: boolean) => {
      const request = { orgId, sequence: ++requestScope.current.sequence };
      setLoadingConversations(true);
      try {
        const page = await listConversations(orgId, { limit: 30, cursor });
        if (requestScope.current.orgId !== request.orgId || requestScope.current.sequence !== request.sequence) return;
        setConversations((current) => {
          if (!append) return page.conversations;
          const byId = new Map(current.map((item) => [item.conversation_id, item]));
          for (const item of page.conversations) byId.set(item.conversation_id, item);
          return [...byId.values()];
        });
        setConversationCursor(page.next_cursor);
        return page;
      } catch (cause) {
        if (requestScope.current.orgId === request.orgId && requestScope.current.sequence === request.sequence)
          onError(errorMessage(cause));
      } finally {
        if (requestScope.current.orgId === request.orgId && requestScope.current.sequence === request.sequence)
          setLoadingConversations(false);
      }
    },
    [orgId, onError],
  );

  useEffect(() => {
    if (!selectedConversationId || conversations.some((item) => item.conversation_id === selectedConversationId)) {
      setSelectedMetadata(null);
      return;
    }
    let obsolete = false;
    setSelectedMetadata(null);
    void getConversation(orgId, selectedConversationId).then(
      (value) => { if (!obsolete) setSelectedMetadata(value); },
      (cause: unknown) => { if (!obsolete) onError(errorMessage(cause)); },
    );
    return () => { obsolete = true; };
  }, [orgId, selectedConversationId, conversations, onError]);

  const selectedConversation = conversations.find((item) => item.conversation_id === selectedConversationId) ??
    (selectedMetadata?.conversation_id === selectedConversationId ? selectedMetadata : null);

  return {
    conversations,
    conversationCursor,
    selectedConversationId,
    selectedConversation,
    setSelectedConversationId,
    loadingConversations,
    loadConversations,
  };
}
