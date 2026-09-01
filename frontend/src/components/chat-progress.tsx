"use client";

import React, { useEffect, useState } from "react";

import type { ChatMessage } from "@/lib/chat-history";

function elapsedLabel(startedAt?: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - (startedAt || Date.now())) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** Real request elapsed time alongside a backend-authored lifecycle stage. */
export function ChatProgress({ message, fallback }: { message: ChatMessage; fallback: string }) {
  const active = message.status === "streaming";
  const [elapsed, setElapsed] = useState(() => elapsedLabel(message.startedAt));

  useEffect(() => {
    setElapsed(elapsedLabel(message.startedAt));
    if (!active) return undefined;
    const interval = window.setInterval(() => setElapsed(elapsedLabel(message.startedAt)), 1_000);
    return () => window.clearInterval(interval);
  }, [active, message.startedAt]);

  return <span className="chat-progress" aria-hidden="true">{message.statusDetail || fallback} · {elapsed}</span>;
}
