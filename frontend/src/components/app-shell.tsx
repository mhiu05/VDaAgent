"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { CHAT_HISTORY_EVENT, createConversation, listConversations, type ChatConversation } from "@/lib/chat-history";

const navigation = [
  { href: "/datasets", label: "Datasets", icon: "▦" },
  { href: "/compare", label: "So sánh drift", icon: "↔" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("p170-theme");
    const nextTheme = savedTheme === "dark" ? "dark" : "light";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }, []);

  useEffect(() => {
    const refresh = () => setConversations(listConversations());
    refresh();
    window.addEventListener(CHAT_HISTORY_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(CHAT_HISTORY_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  function startNewChat() {
    const conversation = createConversation();
    router.push(`/chat?conversation=${conversation.id}`);
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("p170-chat-navigation", { detail: { conversationId: conversation.id } })), 0);
  }

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem("p170-theme", nextTheme);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Điều hướng chính">
        <Link href="/chat" className="brand" aria-label="P-170 Data Profile">
          <span className="brand-mark" aria-hidden="true">P</span>
          <span><b>Profile</b><small>Data intelligence</small></span>
        </Link>
        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={`Chuyển sang chế độ ${theme === "dark" ? "sáng" : "tối"}`}
          aria-pressed={theme === "dark"}
        >
          <span className="theme-toggle-icon" aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
          <span>{theme === "dark" ? "Chế độ sáng" : "Chế độ tối"}</span>
          <span className="theme-toggle-track" aria-hidden="true"><span /></span>
        </button>
        <section className="chat-history" aria-label="Lịch sử chat">
          <div className="sidebar-section-heading"><span>Lịch sử chat</span><button type="button" className="new-chat-button" onClick={startNewChat}>+ New chat</button></div>
          <div className="chat-history-list">
            {conversations.length === 0 && <p className="sidebar-empty">Chưa có cuộc trò chuyện</p>}
            {conversations.slice(0, 12).map((conversation) => {
              const active = pathname === "/chat";
              return <Link className={active ? "chat-history-item active" : "chat-history-item"} href={`/chat?conversation=${conversation.id}`} key={conversation.id} onClick={() => setTimeout(() => window.dispatchEvent(new CustomEvent("p170-chat-navigation", { detail: { conversationId: conversation.id } })), 0)}>{conversation.title}</Link>;
            })}
          </div>
        </section>
        <nav className="nav-list sidebar-navigation" aria-label="Điều hướng dữ liệu">
          <span className="sidebar-section-label">Phân tích dữ liệu</span>
          {navigation.map((item) => {
            const active = (item.href === "/datasets" && pathname.startsWith("/datasets"))
              || (item.href === "/compare" && pathname.startsWith("/compare"));
            return <Link className={active ? "nav-link active" : "nav-link"} href={item.href} key={item.href}><span aria-hidden="true">{item.icon}</span>{item.label}</Link>;
          })}
        </nav>
      </aside>
      <main className="main-content">{children}</main>
    </div>
  );
}
