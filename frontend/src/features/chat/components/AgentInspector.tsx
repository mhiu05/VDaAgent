import { useTranslation } from "react-i18next";
import { X, BookOpen, Wrench, Users } from "lucide-react";
import type { Agent, AgentId, Conversation } from "../model/types";
import { Avatar } from "../../../shared/ui/identity";
import { IconButton } from "../../../shared/ui/button";
import { usePreferences } from "../../../app/providers/PreferencesProvider";
import { PinnedReportLink } from "./ReportReferenceCard";
export function AgentInspector({
  agent,
  agents,
  participants,
  conversation,
  onSelect,
  onAgent,
  onClose,
}: {
  agent: Agent;
  agents: readonly Agent[];
  participants: AgentId[];
  conversation: Conversation;
  onSelect(id: AgentId): void;
  onAgent(id: AgentId): void;
  onClose?(): void;
}) {
  const { t } = useTranslation(["chat", "app"]);
  const { preferences } = usePreferences();
  const group = conversation.kind === "group";
  return (
    <aside className="agent-inspector" aria-label={t("inspector")}>
      <div className="inspector-heading">
        <span className="eyebrow">
          {t(group ? "groupContext" : "inspector")}
        </span>
        {onClose ? (
          <IconButton label={t("app:close")} onClick={onClose}>
            <X size={17} />
          </IconButton>
        ) : null}
      </div>
      <div className="inspector-identity">
        <Avatar
          name={group ? conversation.title : agent.name}
          glyph={group ? <Users size={26} /> : agent.glyph}
          size={48}
        />
        <h2>
          {group
            ? conversation.scenarioId
              ? "Nhóm Riverside"
              : conversation.title
            : agent.name}
        </h2>
        <p>
          {group ? t("teamDescription") : agent.summary[preferences.locale]}
        </p>
      </div>
      {group ? (
        <section>
          <h3>
            <Users size={15} />
            {t("participants")}
          </h3>
          <ul className="fleet-roster">
            {participants.map((id) => {
              const member = agents.find((a) => a.id === id)!;
              return (
                <li key={id}>
                  <button
                    onClick={() => {
                      onSelect(id);
                      onAgent(id);
                    }}
                  >
                    <Avatar name={member.name} glyph={member.glyph} />
                    <span>
                      <strong>{member.name}</strong>
                      <small>{t(`role-${id}`)}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {!group ? (
        <>
          <section>
            <h3>
              <BookOpen size={15} />
              {t("skills")}
            </h3>
            <ul>
              {agent.skills.map((skill) => (
                <li key={skill}>{skill}</li>
              ))}
            </ul>
          </section>
          {agent.tools.length ? (
            <section>
              <h3>
                <Wrench size={15} />
                {t("tools")}
              </h3>
              <ul>
                {agent.tools.map((tool) => (
                  <li key={tool}>{tool}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
      {conversation.reportRef ? (
        <section className="fleet-inspector-report">
          <h3>{t("analysisContext")}</h3>
          <dl>
            <dt>{t("project")}</dt>
            <dd>{conversation.context?.project}</dd>
            <dt>{t("reportShort")}</dt>
            <dd>{conversation.reportRef.versionId}</dd>
          </dl>
          <PinnedReportLink reference={conversation.reportRef}>
            {t("viewReport")} ↗
          </PinnedReportLink>
        </section>
      ) : null}
    </aside>
  );
}
