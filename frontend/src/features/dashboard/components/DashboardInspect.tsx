import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspaceService } from "../../../app/providers/ServicesProvider";
import { usePreferences } from "../../../app/providers/PreferencesProvider";
import { formatDate } from "../../../shared/lib/format";
import { useServiceRead } from "../../reports/hooks/useServiceRead";
import type { Principal } from "../../../shared/contracts/auth";
import type { ReportScope } from "../../reports/model/types";
import type { DashboardService } from "../services/dashboard-service";
import type { BreakdownKind, BreakdownQuery } from "../model/types";
import { Pagination, TableSurface } from "../../../shared/ui/data";
import { PageState } from "../../../shared/ui/page";
import { Button } from "../../../shared/ui/button";
import { Skeleton } from "../../../shared/ui/feedback";

export function DashboardInspect({
  principal,
  scope,
  kind,
  query,
  onPage,
}: {
  principal: Principal;
  scope: ReportScope;
  kind: BreakdownKind;
  query: BreakdownQuery;
  onPage(page: number): void;
}) {
  const { preferences } = usePreferences();
  const { t } = useTranslation("dashboard");
  const service = useWorkspaceService<DashboardService>("dashboard");
  const key = JSON.stringify([principal.id, scope, kind, query]);
  const read = useCallback(
    (signal: AbortSignal) =>
      service.breakdown(principal, kind, scope, query, signal),
    [service, principal, scope, kind, query],
  );
  const { result, retry } = useServiceRead(key, read);
  if (!result) return <Skeleton label={t("loading")} />;
  if (result.error)
    return (
      <PageState
        kind="error"
        title={t("error")}
        action={<Button onClick={retry}>{t("retry")}</Button>}
      />
    );
  const data = result.data;
  return (
    <div className="stack">
      <TableSurface
        caption={`${t("inspect")} · ${t(kind === "tasks" ? "active" : kind)}`}
        header={
          <tr>
            <th scope="col">{t("id")}</th>
            <th scope="col">{t("project")}</th>
            <th scope="col">{t("state")}</th>
            <th scope="col">{t("date")}</th>
          </tr>
        }
        empty={!data.rows.length ? <p>{t("noRows")}</p> : undefined}
      >
        {data.rows.map((row) => (
          <tr key={row.id}>
            <th scope="row">{row.id}</th>
            <td>{row.projectId}</td>
            <td>
              {"status" in row ? row.status : "state" in row ? row.state : "—"}
            </td>
            <td>
              {"listedBusinessDate" in row
                ? (row.listedBusinessDate ?? t("unknown"))
                : "completedAt" in row
                  ? row.completedAt
                    ? formatDate(
                        row.completedAt,
                        preferences.locale,
                        preferences.timezone,
                      )
                    : t("unknown")
                  : formatDate(
                      row.failedAt ?? row.observedAt,
                      preferences.locale,
                      preferences.timezone,
                    )}
            </td>
          </tr>
        ))}
      </TableSurface>
      <Pagination
        page={data.page}
        pageCount={data.pageCount}
        onPageChange={onPage}
        label={t("pagination")}
        previousLabel={t("previousPage")}
        nextLabel={t("nextPage")}
      />
    </div>
  );
}
