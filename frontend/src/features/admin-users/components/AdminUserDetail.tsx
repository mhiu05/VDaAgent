import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { Principal } from "../../../shared/contracts/auth";
import { useWorkspaceService } from "../../../app/providers/ServicesProvider";
import { usePreferences } from "../../../app/providers/PreferencesProvider";
import { formatDate } from "../../../shared/lib/format";
import { Button } from "../../../shared/ui/button";
import { PageState } from "../../../shared/ui/page";
import { Skeleton } from "../../../shared/ui/feedback";
import { StatusBadge, TableSurface } from "../../../shared/ui/data";
import type { AdminUsersService } from "../services/admin-users-service";
import type { ManagedUser } from "../model/types";
import { useServiceRead } from "../../reports/hooks/useServiceRead";

export function AdminUserDetail({
  principal,
  id,
  revision,
  onClose,
  onChange,
}: {
  principal: Principal;
  id: string;
  revision: number;
  onClose(): void;
  onChange(user: ManagedUser): void;
}) {
  const { preferences } = usePreferences();
  const { t } = useTranslation("admin-users");
  const service = useWorkspaceService<AdminUsersService>("admin-users");
  const heading = useRef<HTMLHeadingElement>(null);
  const read = useCallback(
    (signal: AbortSignal) => service.detail(principal, id, signal),
    [service, principal, id],
  );
  const { result, retry } = useServiceRead(
    `${principal.id}:${id}:${revision}`,
    read,
  );
  useEffect(() => heading.current?.focus(), [id]);
  return (
    <section className="admin-user-detail">
      <div className="row spread">
        <h2 ref={heading} tabIndex={-1}>
          {t("detail")}
        </h2>
        <Button onClick={onClose}>{t("close")}</Button>
      </div>
      {!result ? (
        <Skeleton label={t("loading")} />
      ) : result.error ? (
        <PageState
          kind="error"
          title={t(result.error.code === "notFound" ? "notFound" : "error")}
          action={<Button onClick={retry}>{t("retry")}</Button>}
        />
      ) : (
        <>
          <div className="admin-detail-identity">
            <h3>{result.data.user.name}</h3>
            <p>{result.data.user.email}</p>
            <StatusBadge
              label={t(result.data.user.status)}
              tone={
                result.data.user.status === "active" ? "success" : "neutral"
              }
            />
          </div>
          <dl>
            <dt>{t("role")}</dt>
            <dd>USER</dd>
            <dt>{t("revision")}</dt>
            <dd>{result.data.user.revision}</dd>
            <dt>{t("createdAt")}</dt>
            <dd>
              {formatDate(
                result.data.user.createdAt,
                preferences.locale,
                preferences.timezone,
              )}
            </dd>
            <dt>{t("lastActiveAt")}</dt>
            <dd>
              {result.data.user.lastActiveAt
                ? formatDate(
                    result.data.user.lastActiveAt,
                    preferences.locale,
                    preferences.timezone,
                  )
                : t("noActivity")}
            </dd>
          </dl>
          <Button
            variant={
              result.data.user.status === "active" ? "danger" : "primary"
            }
            onClick={() => onChange(result.data.user)}
          >
            {t(result.data.user.status === "active" ? "disable" : "enable")}
          </Button>
          <h3>{t("audit")}</h3>
          {result.data.audit.length ? (
            <TableSurface
              caption={t("audit")}
              header={
                <tr>
                  <th scope="col">{t("status")}</th>
                  <th scope="col">{t("time")}</th>
                  <th scope="col">{t("operation")}</th>
                </tr>
              }
            >
              {result.data.audit.map((event) => (
                <tr key={event.id}>
                  <th scope="row">
                    {t(event.fromStatus)} → {t(event.toStatus)}
                    <small>
                      {t("actor")}: {event.actorId}
                    </small>
                  </th>
                  <td>
                    {formatDate(
                      event.occurredAt,
                      preferences.locale,
                      preferences.timezone,
                    )}
                  </td>
                  <td>{event.operationId}</td>
                </tr>
              ))}
            </TableSurface>
          ) : (
            <p className="muted">{t("noAudit")}</p>
          )}
        </>
      )}
    </section>
  );
}
