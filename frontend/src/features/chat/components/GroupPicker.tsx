import { useState } from "react";
import { useTranslation } from "react-i18next";
import { canUse, type Agent, type AgentId } from "../model/types";
import { Button } from "../../../shared/ui/button";
export function GroupPicker({
  agents,
  onCreate,
}: {
  agents: readonly Agent[];
  onCreate(ids: AgentId[]): void;
}) {
  const { t } = useTranslation(["chat", "app"]);
  const [selected, setSelected] = useState<AgentId[]>([]);
  return (
    <div className="stack">
      <p className="muted">{t("pickParticipants")}</p>
      {agents
        .filter((a) => canUse(a.capabilities.group))
        .map((a) => (
          <label key={a.id} className="switch">
            <span>{a.name}</span>
            <input
              type="checkbox"
              checked={selected.includes(a.id)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, a.id]
                    : selected.filter((id) => id !== a.id),
                )
              }
            />
          </label>
        ))}
      <Button
        variant="primary"
        disabled={selected.length < 2}
        onClick={() => onCreate(selected)}
      >
        {t("newGroup")}
      </Button>
    </div>
  );
}
