import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/** Follow updates only while the reader is near the end of the timeline. */
export function useTimelineScroll(contentKey: string) {
  const element = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const forceFollow = useRef(false);
  const olderAnchor = useRef<{ height: number; top: number } | null>(null);
  const [hasNewUpdates, setHasNewUpdates] = useState(false);

  const onScroll = useCallback(() => {
    const node = element.current;
    if (!node) return;
    follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 96;
    if (follow.current) setHasNewUpdates(false);
  }, []);
  const beforeEarlier = useCallback(() => {
    const node = element.current;
    if (node) olderAnchor.current = { height: node.scrollHeight, top: node.scrollTop };
  }, []);
  const afterOwnSubmission = useCallback(() => {
    forceFollow.current = true;
    setHasNewUpdates(false);
  }, []);
  const scrollToLatest = useCallback(() => {
    const node = element.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    follow.current = true;
    setHasNewUpdates(false);
  }, []);
  const scrollToStart = useCallback(() => {
    const node = element.current;
    if (!node) return;
    node.scrollTop = 0;
    follow.current = false;
    forceFollow.current = false;
    setHasNewUpdates(false);
  }, []);
  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;
    if (olderAnchor.current) {
      const anchor = olderAnchor.current;
      node.scrollTop = anchor.top + node.scrollHeight - anchor.height;
      olderAnchor.current = null;
    } else if (follow.current || forceFollow.current) {
      scrollToLatest();
      forceFollow.current = false;
    } else {
      setHasNewUpdates(true);
    }
  }, [contentKey, scrollToLatest]);
  return { element, hasNewUpdates, onScroll, beforeEarlier, afterOwnSubmission, scrollToLatest, scrollToStart };
}
