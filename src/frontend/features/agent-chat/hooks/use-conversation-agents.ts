'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationAgents } from '@vda/contracts';
import { ApiError, errorMessage } from '../../../lib/http/api-client';
import { getConversationAgents } from '../api/conversations';

/** A single bounded discovery poll covers all eight agents and all active runs. */
export function useConversationAgents(orgId: string, conversationId: string | null) {
  const [summary, setSummary] = useState<ConversationAgents | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (!conversationId || inFlight.current) return;
    const current = generation.current;
    inFlight.current = true;
    try {
      const value = await getConversationAgents(orgId, conversationId);
      if (current === generation.current) {
        setSummary(value);
        setError(null);
      }
    } catch (cause) {
      if (current === generation.current) {
        if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) setSummary(null);
        setError(errorMessage(cause));
      }
    } finally {
      if (current === generation.current) inFlight.current = false;
    }
  }, [orgId, conversationId]);
  useEffect(() => {
    const scope = generation.current + 1;
    generation.current = scope;
    inFlight.current = false;
    setSummary(null);
    setError(null);
    if (!conversationId) return;
    let timer: ReturnType<typeof setTimeout>;
    let disposed = false;
    const poll = async () => {
      if (disposed) return;
      await refresh();
      if (!disposed) timer = setTimeout(() => void poll(), document.hidden ? 5000 : 1500);
    };
    void poll();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      disposed = true;
      if (generation.current === scope) generation.current = scope + 1;
      clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [conversationId, orgId, refresh]);
  return { summary, error, refresh };
}
