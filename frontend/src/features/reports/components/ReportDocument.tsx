import { useTranslation } from "react-i18next";
import { usePreferences } from "../../../app/providers/PreferencesProvider";
import { formatDate } from "../../../shared/lib/format";
import { PagedDataTable } from "../../../shared/charts/PagedDataTable";
import type { ReportDetail } from "../model/types";
import { ReportChart } from "./ReportChart";
import type { MouseEvent } from "react";
import { lazy, Suspense } from "react";
const SchemaDocument = lazy(() =>
  import("./ReportBlocks").then((module) => ({
    default: module.SchemaDocument,
  })),
);

export function ReportDocument({ detail }: { detail: ReportDetail }) {
  const { preferences } = usePreferences();
  const { t } = useTranslation("reports");
  const version = detail.version;
  if (!version) return null;
  if (version.schema)
    return (
      <Suspense fallback={<p role="status">{t("loading")}</p>}>
        <SchemaDocument schema={version.schema} detail={detail} />
      </Suspense>
    );
  function goTo(event: MouseEvent<HTMLAnchorElement>, id: string) {
    event.preventDefault();
    const target = document.getElementById(id);
    target?.scrollIntoView({ block: "start", behavior: "instant" });
    target?.focus({ preventScroll: true });
  }
  return (
    <div className="report-reader">
      <details className="report-contents" open>
        <summary>{t("contents")}</summary>
        <nav aria-label={t("contents")}>
          <ol>
            {version.sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  onClick={(event) => goTo(event, section.id)}
                >
                  {section.title}
                </a>
              </li>
            ))}
            <li>
              <a
                href="#report-evidence"
                onClick={(event) => goTo(event, "report-evidence")}
              >
                {t("evidence")}
              </a>
            </li>
          </ol>
        </nav>
      </details>
      <article className="report-document" lang="vi">
        <p className="report-document-language">{t("documentLanguage")}</p>
        {version.sections.map((section) => (
          <section
            key={section.id}
            id={section.id}
            tabIndex={-1}
            className={`report-section report-section-${section.kind}`}
          >
            <h2>{section.title}</h2>
            {"paragraphs" in section ? (
              section.paragraphs.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))
            ) : "text" in section ? (
              <>
                <p>{section.text}</p>
                <div className="report-evidence-links">
                  {section.evidenceIds.map((id) => (
                    <a
                      href={`#${id}`}
                      key={id}
                      onClick={(event) => goTo(event, id)}
                    >
                      {t("evidence")}: {id}
                    </a>
                  ))}
                </div>
              </>
            ) : "rows" in section ? (
              <>
                <p className="muted">
                  {t("units")}: {section.unit}
                </p>
                <PagedDataTable
                  key={`${version.id}:${section.id}`}
                  caption={section.title}
                  columns={section.columns}
                  rows={section.rows}
                />
              </>
            ) : (
              <ReportChart
                chart={section}
                dataThrough={version.source.dataThrough}
              />
            )}
          </section>
        ))}
        <section id="report-evidence" tabIndex={-1} className="report-section">
          <h2>{t("evidence")}</h2>
          {detail.evidence.length ? (
            detail.evidence.map((evidence) => (
              <div
                key={evidence.id}
                id={evidence.id}
                tabIndex={-1}
                className="report-evidence-item"
              >
                <h3>{evidence.label}</h3>
                <dl>
                  <dt>{t("source")}</dt>
                  <dd>
                    {evidence.sourceId} · {evidence.snapshotId ?? "—"}
                  </dd>
                  <dt>{t("dataThrough")}</dt>
                  <dd>
                    {formatDate(
                      evidence.dataThrough,
                      preferences.locale,
                      preferences.timezone,
                    )}
                  </dd>
                  <dt>{t("limitations")}</dt>
                  <dd>{evidence.limitation}</dd>
                </dl>
              </div>
            ))
          ) : (
            <p>{t("noEvidence")}</p>
          )}
        </section>
      </article>
    </div>
  );
}
