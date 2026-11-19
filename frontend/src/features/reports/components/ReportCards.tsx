import { Link } from "react-router";
import { ArrowUpRight, FileChartColumn, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePreferences } from "../../../app/providers/PreferencesProvider";
import { formatDate } from "../../../shared/lib/format";
import { StatusBadge } from "../../../shared/ui/data";
import { IconButton } from "../../../shared/ui/button";
import type { ReportQuery, ReportSummary } from "../model/types";
import { reportRowPresentation } from "../model/row-presentation";
import type { WorkspaceCatalog } from "../services/reports-service";

export function ReportCards({
  rows,
  projects,
  dateField,
  returnTo,
  onOpen,
  onDelete,
  reportTypes,
}: {
  rows: readonly ReportSummary[];
  projects: WorkspaceCatalog["projects"];
  dateField: ReportQuery["dateField"];
  returnTo: string;
  onOpen(row: ReportSummary, trigger: HTMLElement): void;
  onDelete?(row: ReportSummary): void;
  reportTypes?: WorkspaceCatalog["reportTypes"];
}) {
  const { t } = useTranslation("reports");
  const { preferences } = usePreferences();
  return (
    <ul className="report-cards" aria-label={t("title")}>
      {rows.map((row) => {
        const { version, projectLabel, date, tone, attemptNote } =
          reportRowPresentation(row, projects, dateField);
        const query = new URLSearchParams(returnTo.split("?")[1]);
        query.set("report", row.record.id);
        query.set("view", "dashboard");
        if (version) query.set("version", version.id);
        return (
          <li key={row.record.id}>
            <article className="report-card">
              <div className="row spread">
                <span className="report-card-kind">
                  <FileChartColumn size={17} aria-hidden="true" />
                  {t(row.record.type, {
                    defaultValue:
                      reportTypes?.find((type) => type.id === row.record.type)
                        ?.name ?? row.record.type,
                  })}
                </span>
                <StatusBadge label={t(row.status)} tone={tone} />
              </div>
              {onDelete && !row.latestVersion ? (
                <IconButton
                  label={t("deleteReport")}
                  className="report-card-delete"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onDelete(row);
                  }}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </IconButton>
              ) : null}
              <h2>
                <Link
                  to={`/reports?${query}`}
                  onClick={(event) => {
                    if (
                      event.button !== 0 ||
                      event.ctrlKey ||
                      event.metaKey ||
                      event.shiftKey ||
                      event.altKey
                    )
                      return;
                    event.preventDefault();
                    onOpen(row, event.currentTarget);
                  }}
                >
                  {row.record.title}
                </Link>
              </h2>
              <p className="muted">
                {projectLabel} · {row.record.marketIds.join(", ")}
                {row.record.agent ? ` · ${row.record.agent}` : ""}
              </p>
              {attemptNote ? (
                <p className="report-attempt-note">{t(attemptNote)}</p>
              ) : null}
              <dl>
                <dt>{t(dateField)}</dt>
                <dd>
                  <time dateTime={date}>
                    {date
                      ? formatDate(
                          date,
                          preferences.locale,
                          preferences.timezone,
                          { dateStyle: "medium" },
                        )
                      : "—"}
                  </time>
                </dd>
                <dt>{t("version")}</dt>
                <dd>
                  {version ? `v${version.sequence}` : "—"}
                  {version && version.id !== row.latestVersion?.id
                    ? ` · ${t("matched")} · ${t("latest")}: v${row.latestVersion?.sequence}`
                    : ""}
                </dd>
                {version?.schema ? (
                  <>
                    <dt>{t("dataThrough")}</dt>
                    <dd>
                      <time dateTime={version.source.dataThrough}>
                        {formatDate(
                          version.source.dataThrough,
                          preferences.locale,
                          preferences.timezone,
                          { dateStyle: "medium" },
                        )}
                      </time>
                    </dd>
                  </>
                ) : null}
              </dl>
              <footer className="report-card-footer">
                <small className="muted" translate="no">
                  {row.record.code}
                </small>
                <span aria-hidden="true">
                  {t("openDashboard")} <ArrowUpRight size={16} />
                </span>
              </footer>
            </article>
          </li>
        );
      })}
    </ul>
  );
}
