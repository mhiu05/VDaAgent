import { useTranslation } from "react-i18next";
import { usePreferences } from "../../../app/providers/PreferencesProvider";
import { formatDate } from "../../../shared/lib/format";
import { Button } from "../../../shared/ui/button";
import { StatusBadge } from "../../../shared/ui/data";
import type { ManagedUser } from "../model/types";

export function AdminUserCards({
  users,
  open,
  change,
}: {
  users: readonly ManagedUser[];
  open(id: string): void;
  change(user: ManagedUser): void;
}) {
  const { t } = useTranslation("admin-users");
  const { preferences } = usePreferences();
  return (
    <ul className="admin-user-cards">
      {users.map((user) => (
        <li key={user.id}>
          <article>
            <div className="row spread">
              <span className="badge">USER</span>
              <StatusBadge
                label={t(user.status)}
                tone={user.status === "active" ? "success" : "neutral"}
              />
            </div>
            <h3>
              <Button variant="ghost" onClick={() => open(user.id)}>
                {user.name}
              </Button>
            </h3>
            <p className="admin-card-email" translate="no">
              {user.email}
            </p>
            <dl>
              <dt>{t("createdAt")}</dt>
              <dd>
                {formatDate(
                  user.createdAt,
                  preferences.locale,
                  preferences.timezone,
                  { dateStyle: "medium" },
                )}
              </dd>
              <dt>{t("lastActiveAt")}</dt>
              <dd>
                {user.lastActiveAt
                  ? formatDate(
                      user.lastActiveAt,
                      preferences.locale,
                      preferences.timezone,
                      { dateStyle: "medium" },
                    )
                  : t("noActivity")}
              </dd>
            </dl>
            <div className="row">
              <Button
                onClick={() => open(user.id)}
                aria-label={`${t("view")} ${user.email}`}
              >
                {t("view")}
              </Button>
              <Button
                variant="ghost"
                onClick={() => change(user)}
                aria-label={`${t(user.status === "active" ? "disable" : "enable")} ${user.email}`}
              >
                {t(user.status === "active" ? "disable" : "enable")}
              </Button>
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}
