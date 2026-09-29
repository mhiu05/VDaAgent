'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentFeedItem, AgentFeedPage, AgentKey } from '@vda/contracts';
import { ApiError, errorMessage } from '../../../lib/http/api-client';
import { listAgentConversationMessages } from '../api/conversations';

function merge(previous: AgentFeedItem[], incoming: AgentFeedItem[]): AgentFeedItem[] {
  const byId = new Map(previous.map((item) => [item.item_id, item]));
  for (const item of incoming) byId.set(item.item_id, item);
  return [...byId.values()];
}

/** Scoped server history with bounded refreshes for the latest or focused window. */
export function useAgentConversation(
  orgId: string,
  conversationId: string | null,
  agent: AgentKey,
  focusItem: string | null,
  revision: string | number = '',
) {
  const [page, setPage] = useState<AgentFeedPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const pageRef = useRef<AgentFeedPage | null>(null);
  const [canLoadNewer, setCanLoadNewer] = useState(false);
  const refresh = useCallback(
    async (focus = false) => {
      if (!conversationId) return;
      const current = generation.current;
      try {
        const next = await listAgentConversationMessages(
          orgId,
          conversationId,
          agent,
          focusItem ? { focus_item: focusItem } : {},
        );
        if (current !== generation.current) return;
        const previous = pageRef.current;
        const merged =
          !previous || focus
            ? next
            : focusItem
              ? {
                  ...previous,
                  items: previous.items.map(
                    (item) => next.items.find((fresh) => fresh.item_id === item.item_id) ?? item,
                  ),
                }
              : {
                  ...next,
                  items: merge(previous.items, next.items),
                  older_cursor: previous.older_cursor ?? next.older_cursor,
                };
        pageRef.current = merged;
        setPage(merged);
        if (focus && focusItem) setCanLoadNewer(true);
        setError(null);
      } catch (cause) {
        if (current === generation.current) {
          if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) {
            pageRef.current = null;
            setPage(null);
          }
          setError(errorMessage(cause));
        }
      } finally {
        if (current === generation.current) setLoading(false);
      }
    },
    [orgId, conversationId, agent, focusItem],
  );
  useEffect(() => {
    const scope = generation.current + 1;
    generation.current = scope;
    pageRef.current = null;
    setPage(null);
    setCanLoadNewer(false);
    setError(null);
    if (!conversationId) return;
    setLoading(true);
    void refresh(Boolean(focusItem));
    const timer = setInterval(() => void refresh(false), document.hidden ? 5000 : 1500);
    const onFocus = () => void refresh(false);
    window.addEventListener('focus', onFocus);
    return () => {
      if (generation.current === scope) generation.current = scope + 1;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [orgId, conversationId, agent, focusItem, refresh]);
  useEffect(() => {
    if (page && conversationId) void refresh(false);
  }, [revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadOlder = useCallback(async () => {
    const cursor = page?.older_cursor;
    if (!conversationId || !cursor) return;
    const current = generation.current;
    setLoading(true);
    try {
      const older = await listAgentConversationMessages(orgId, conversationId, agent, { cursor });
      if (current !== generation.current) return;
      const previous = pageRef.current;
      const merged = previous
        ? {
            ...previous,
            items: merge(older.items, previous.items),
            older_cursor: older.items.length ? older.older_cursor : null,
          }
        : older;
      pageRef.current = merged;
      setPage(merged);
      setError(null);
    } catch (cause) {
      if (current === generation.current) {
        if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) {
          pageRef.current = null;
          setPage(null);
        }
        setError(errorMessage(cause));
      }
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [orgId, conversationId, agent, page?.older_cursor]);
  const loadNewer = useCallback(async () => {
    const cursor = pageRef.current?.newer_cursor;
    if (!conversationId || !cursor) return;
    const current = generation.current;
    setLoading(true);
    try {
      const newer = await listAgentConversationMessages(orgId, conversationId, agent, { cursor });
      if (current !== generation.current) return;
      const previous = pageRef.current;
      const merged = previous
        ? {
            ...previous,
            items: merge(previous.items, newer.items),
            newer_cursor: newer.items.length ? newer.newer_cursor : previous.newer_cursor,
          }
        : newer;
      pageRef.current = merged;
      setPage(merged);
      setCanLoadNewer(newer.items.length > 0);
      setError(null);
    } catch (cause) {
      if (current === generation.current) {
        if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) {
          pageRef.current = null;
          setPage(null);
        }
        setError(errorMessage(cause));
      }
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [orgId, conversationId, agent]);
  return { page, loading, error, loadOlder, loadNewer, canLoadNewer, refresh };
}
