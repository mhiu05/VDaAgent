import { useCallback, useEffect, useRef, useState } from 'react';
import type { Conversation } from '@vda/contracts';
import { ApiError, errorMessage } from '../../../lib/http/api-client';
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
  const exhausted = useRef(false);
  const clearConversations = useCallback(() => {
    requestScope.current.sequence++;
    exhausted.current = false;
    setConversations([]);
    setConversationCursor(null);
    setSelectedConversationId(null);
    setSelectedMetadata(null);
  }, []);
  useEffect(() => {
    if (requestScope.current.orgId === orgId) return;
    requestScope.current = { orgId, sequence: 0 };
    exhausted.current = false;
    setConversations([]);
    setConversationCursor(null);
    setSelectedConversationId(null);
    setSelectedMetadata(null);
  }, [orgId]);
  const loadConversations = useCallback(
    async (cursor: string | null, append: boolean) => {
      const request = { orgId, sequence: ++requestScope.current.sequence };
      setLoadingConversations(true);
      try {
        const page = await listConversations(orgId, { limit: 30, cursor });
        if (requestScope.current.orgId !== request.orgId || requestScope.current.sequence !== request.sequence) return;
        if (append) exhausted.current = page.next_cursor === null;
        setConversations((current) => {
          const byId = new Map(current.map((item) => [item.conversation_id, item]));
          for (const item of page.conversations) {
            const prior = byId.get(item.conversation_id);
            if (!prior || item.updated_at >= prior.updated_at) byId.set(item.conversation_id, item);
          }
          return [...byId.values()].sort((a,b) => b.updated_at.localeCompare(a.updated_at) ||
            b.conversation_id.localeCompare(a.conversation_id));
        });
        setConversationCursor((current) => append ? page.next_cursor : exhausted.current ? null : (current ?? page.next_cursor));
        return page;
      } catch (cause) {
        if (requestScope.current.orgId === request.orgId && requestScope.current.sequence === request.sequence) {
          if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
            setConversations([]);
            setConversationCursor(null);
            setSelectedConversationId(null);
            setSelectedMetadata(null);
          }
          onError(errorMessage(cause));
        }
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
      (cause: unknown) => {
        if (obsolete) return;
        if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
          setConversations([]);
          setConversationCursor(null);
          setSelectedConversationId(null);
          setSelectedMetadata(null);
        }
        onError(errorMessage(cause));
      },
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
    clearConversations,
  };
}
