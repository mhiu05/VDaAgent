import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, MessagesSquare, Pin } from "lucide-react";
import type { Agent, AgentId, ChatBundle, Conversation } from "../model/types";
import { canUse } from "../model/types";
import { usePreferences } from "../../../app/providers/PreferencesProvider";
import { Avatar } from "../../../shared/ui/identity";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/form";
import { useOverlay } from "../../../app/providers/OverlayProvider";
import { GroupPicker } from "./GroupPicker";
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .toLowerCase();
export function AgentSidebar({
  agents,
  bundle,
  current,
  onSelect,
  onCreate,
}: {
  agents: readonly Agent[];
  bundle: ChatBundle;
  current: Conversation;
  onSelect(id: string): void;
  onCreate(ids: AgentId[]): void;
}) {
  const { t } = useTranslation("chat");
  const { preferences } = usePreferences();
  const [query, setQuery] = useState("");
  const overlay = useOverlay();
  const matches = (text: string) => normalize(text).includes(normalize(query));
  const groups = bundle.conversations.filter(
    (c) => c.kind === "group" && matches(c.title),
  );
  const pinned = groups.filter((c) => c.scenarioId || c.id === current.id);
  const otherGroups = groups.filter((c) => !pinned.includes(c));
  const visibleAgents = agents.filter((a) =>
    matches(`${a.name} ${a.description[preferences.locale]}`),
  );
  const history = bundle.conversations
    .filter((c) => !c.scenarioId && c.kind === "direct" && matches(c.title))
    .slice()
    .reverse();
  const row = (c: Conversation) => (
    <button
      key={c.id}
      className={`agent-row conversation-row ${current.id === c.id ? "selected" : ""}`}
      aria-pressed={current.id === c.id}
      onClick={() => onSelect(c.id)}
    >
      <span aria-hidden="true">
        <Avatar
          name={c.title}
          glyph={
            c.scenarioId ? <Pin size={16} /> : <MessagesSquare size={16} />
          }
        />
      </span>
      <span>
        <strong>{c.scenarioId ? "Riverside · Đợt 10" : c.title}</strong>{" "}
        <small>
          {c.participants.length} {t("participants").toLowerCase()}
          {c.scenarioId ? ` · ${t("inventoryAnalysis")}` : ""}
        </small>
      </span>
    </button>
  );
  return (
    <aside className="agent-sidebar" aria-label={t("agents")}>
      <header>
        <h2>{t("agents")}</h2>
        <p>{t("agentHint")}</p>
      </header>
      <div className="agent-search">
        <Search size={15} />
        <Input
          aria-label={t("search")}
          placeholder={t("search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="agent-list">
        <section aria-label={t("conversations")}>
          <h3 className="eyebrow">{t("conversations")}</h3>
          {pinned.map(row)}
        </section>
        <section aria-label={t("specialists")}>
          <h3 className="eyebrow">{t("specialists")}</h3>
          {visibleAgents.map((a) => {
            const conversation = bundle.conversations
              .slice()
              .reverse()
              .find(
                (c) =>
                  c.kind === "direct" &&
                  c.participants[0] === a.id &&
                  c.scenarioId === current.scenarioId,
              );
            const active =
              current.kind === "direct" && current.participants[0] === a.id;
            return (
              <button
                key={a.id}
                className={`agent-row agent-${a.id} ${active ? "selected" : ""}`}
                aria-pressed={active}
                onClick={() =>
                  conversation ? onSelect(conversation.id) : onCreate([a.id])
                }
              >
                <span aria-hidden="true">
                  <Avatar name={a.name} glyph={a.glyph} />
                </span>
                <span>
                  <strong>{a.name}</strong>{" "}
                  <small>{a.description[preferences.locale]}</small>
                </span>
              </button>
            );
          })}
        </section>
        {otherGroups.length ? (
          <details className="conversation-history" open={!!query}>
            <summary>
              {t("groups")} <span>{otherGroups.length}</span>
            </summary>
            {otherGroups.map(row)}
          </details>
        ) : null}
        {history.length ? (
          <details className="conversation-history">
            <summary>
              {t("history")} <span>{history.length}</span>
            </summary>
            {history.map((c) => (
              <button
                key={c.id}
                onClick={() => onSelect(c.id)}
                className={current.id === c.id ? "active-history" : ""}
              >
                <span>{c.title}</span>
                <small>{c.messages.length}</small>
              </button>
            ))}
          </details>
        ) : null}
        {!groups.length && !visibleAgents.length && !history.length ? (
          <p className="fleet-empty-search" role="status">
            {t("noResults")}
          </p>
        ) : null}
      </div>
      <footer>
        {agents.some((a) => canUse(a.capabilities.group)) ? (
          <Button
            variant="ghost"
            onClick={() =>
              overlay.open({
                id: "feature-dialog",
                title: t("newGroup"),
                content: (
                  <GroupPicker
                    agents={agents}
                    onCreate={(ids) => {
                      onCreate(ids);
                      overlay.close();
                    }}
                  />
                ),
              })
            }
          >
            <MessagesSquare size={16} />
            {t("newGroup")}
          </Button>
        ) : null}
      </footer>
    </aside>
  );
}
