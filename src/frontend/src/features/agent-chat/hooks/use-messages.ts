import { useCallback, useEffect, useRef, useState } from 'react';
import type { Message } from '@vda/contracts';
import { ApiError, errorMessage } from '../../../lib/http/api-client';
import { getConversationMessage, listConversationMessages } from '../api/conversations';
import { mergeMessages } from '../timeline-model';

export function useMessages(orgId: string, onError: (message: string) => void) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageCursor, setMessageCursor] = useState<string | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const activeConversation = useRef<string | null>(null);
  const activeOrg = useRef(orgId);
  const generation = useRef(0);
  const exhausted = useRef(false);
  useEffect(() => {
    if (activeOrg.current !== orgId) {
      activeOrg.current = orgId;
      generation.current += 1;
      activeConversation.current = null;
      exhausted.current = false;
      setMessages([]);
      setMessageCursor(null);
      setLoadingMessages(false);
    }
  }, [orgId]);
  const activateConversation = useCallback((id: string | null) => {
    if (activeConversation.current !== id) {
      exhausted.current = false;
      generation.current += 1;
      setMessages([]);
      setMessageCursor(null);
      setLoadingMessages(false);
    }
    activeConversation.current = id;
  }, []);
  const loadMessages = useCallback(
    async (conversationId: string, cursor: string | null, appendEarlier: boolean) => {
      if (activeConversation.current !== conversationId || activeOrg.current !== orgId) return 'stale';
      const requestGeneration = generation.current;
      setLoadingMessages(true);
      try {
        const page = await listConversationMessages(orgId, conversationId, { limit: 30, cursor });
        if (activeConversation.current !== conversationId || activeOrg.current !== orgId || generation.current !== requestGeneration) return 'stale';
        setMessages((current) => mergeMessages(current, page.messages));
        if (appendEarlier) exhausted.current = page.next_cursor === null;
        setMessageCursor((current) => appendEarlier ? page.next_cursor : exhausted.current ? null : (current ?? page.next_cursor));
        return 'ok';
      } catch (cause) {
        if (activeConversation.current === conversationId && activeOrg.current === orgId && generation.current === requestGeneration) {
          if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
            setMessages([]);
            setMessageCursor(null);
          }
          onError(errorMessage(cause));
        }
        return cause instanceof ApiError && (cause.status === 401 || cause.status === 403)
          ? 'unauthorized' : 'error';
      } finally {
        if (activeConversation.current === conversationId && activeOrg.current === orgId && generation.current === requestGeneration) setLoadingMessages(false);
      }
    },
    [orgId, onError],
  );

  const refreshMessage = useCallback(async (conversationId: string, messageId: string) => {
    if (activeConversation.current !== conversationId || activeOrg.current !== orgId) return 'stale';
    const requestGeneration = generation.current;
    try {
      const message = await getConversationMessage(orgId, conversationId, messageId);
      if (activeConversation.current !== conversationId || activeOrg.current !== orgId ||
          generation.current !== requestGeneration) return 'stale';
      setMessages((current) => mergeMessages(current, [message]));
      return ['completed', 'failed', 'cancelled'].includes(message.status) ? 'terminal' : 'pending';
    } catch (cause) {
      if (activeConversation.current !== conversationId || activeOrg.current !== orgId ||
          generation.current !== requestGeneration) return 'stale';
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
        setMessages([]);
        setMessageCursor(null);
        onError(errorMessage(cause));
        return 'unauthorized';
      }
      if (cause instanceof ApiError && cause.status === 404) {
        onError(errorMessage(cause));
        return 'missing';
      }
      return 'error';
    }
  }, [orgId, onError]);

  return { messages, setMessages, messageCursor, setMessageCursor, loadingMessages, loadMessages, refreshMessage, activateConversation };
}
