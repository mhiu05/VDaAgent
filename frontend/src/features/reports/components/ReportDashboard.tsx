import { lazy, Suspense, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useMemo } from "react";
import { usePreferences } from "../../../app/providers/PreferencesProvider";
import { formatDate } from "../../../shared/lib/format";
import { useAnalyticalMotion } from "../../../shared/motion/useAnalyticalMotion";
import type { ReportDetail } from "../model/types";
import { deriveReportDashboardView } from "../model/dashboard-view";
import { ReportChart } from "./ReportChart";
import { ReportKpis } from "./ReportKpis";
const ReportBlocks = lazy(() =>
  import("./ReportBlocks").then((module) => ({ default: module.ReportBlocks })),
);

export function ReportDashboard({ detail }: { detail: ReportDetail }) {
  const { t } = useTranslation("reports");
  const { preferences } = usePreferences();
  const root = useRef<HTMLDivElement>(null);
  const view = useMemo(() => deriveReportDashboardView(detail), [detail]);
  useAnalyticalMotion(root, view?.versionId ?? "empty", "dashboard");
  if (!view) return null;
  const { summary, schema } = view;
  const savedSchema = detail.version?.schema;
  return (
    <div ref={root} className="report-dashboard" data-version={view.versionId}>
      {schema ? (
        <Suspense fallback={<p role="status">{t("loading")}</p>}>
          {schema.introduction.length ? (
            <div className="report-executive-summary">
              <ReportBlocks
                blocks={schema.introduction}
                detail={detail}
                presentation="compact"
              />
            </div>
          ) : null}
          <ReportBlocks
            blocks={schema.metrics}
            detail={detail}
            presentation="compact"
          />
          <div
            className={
              schema.charts.length === 1 && schema.finding.length
                ? "report-primary-analysis report-paired-analysis"
                : "report-primary-analysis"
            }
          >
            <div className="report-primary-charts">
              <ReportBlocks
                blocks={schema.charts}
                detail={detail}
                presentation="compact"
              />
            </div>
            {schema.finding.length ? (
              <div className="report-primary-finding">
                <ReportBlocks
                  blocks={schema.finding}
                  detail={detail}
                  presentation="compact"
                />
              </div>
            ) : null}
          </div>
          {savedSchema && !savedSchema.dashboard.length ? (
            <p>{t("documentOnly")}</p>
          ) : null}
          {savedSchema?.description || savedSchema?.summary ? (
            <details className="report-overview-description">
              <summary>{t("savedSummary")}</summary>
              <p>{savedSchema.description ?? savedSchema.summary}</p>
              {savedSchema.scope ? (
                <p>
                  {savedSchema.scope.from} – {savedSchema.scope.to} ·{" "}
                  {savedSchema.scope.timezone}
                </p>
              ) : null}
            </details>
          ) : null}
          {schema.remaining.length ? (
            <section className="report-supporting">
              <h3 className="report-section-label">
                {t("supportingAnalysis")}
              </h3>
              <ReportBlocks
                blocks={schema.remaining}
                detail={detail}
                presentation="compact"
              />
            </section>
          ) : null}
        </Suspense>
      ) : (
        <>
          {summary.kpis.length ? (
            <section aria-label={t("keyMetrics")}>
              <h3 className="sr-only">{t("keyMetrics")}</h3>
              <ReportKpis metrics={summary.kpis} precision={1} />
            </section>
          ) : null}
          {view.legacy.charts.length ? (
            <section
              className="report-dashboard-charts"
              aria-label={t("charts")}
            >
              {view.legacy.charts.map((chart) => (
                <ReportChart
                  key={chart.id}
                  chart={chart}
                  dataThrough={summary.dataCutoff}
                  presentation="compact"
                />
              ))}
            </section>
          ) : null}
          {view.legacy.finding.length ? (
            <section
              className="report-findings report-primary-finding"
              data-motion="insight"
            >
              <h3>{t("keyFindings")}</h3>
              {view.legacy.finding.map((finding) => (
                <div key={finding.id}>
                  <h4>{finding.title}</h4>
                  <p>{finding.text}</p>
                  {finding.evidenceIds.length ? (
                    <details>
                      <summary>{t("evidence")}</summary>
                      <p className="muted">{finding.evidenceIds.join(", ")}</p>
                      {summary.evidence
                        .filter((e) => finding.evidenceIds.includes(e.id))
                        .map((e) => (
                          <p key={e.id}>
                            {e.label} · {e.sourceId} · {e.limitation}
                          </p>
                        ))}
                    </details>
                  ) : null}
                </div>
              ))}
            </section>
          ) : null}
          {view.legacy.chartsRemaining.length ? (
            <section
              className="report-dashboard-charts"
              aria-label={t("supportingAnalysis")}
            >
              {view.legacy.chartsRemaining.map((chart) => (
                <ReportChart
                  key={chart.id}
                  chart={chart}
                  dataThrough={summary.dataCutoff}
                  presentation="compact"
                />
              ))}
            </section>
          ) : null}
          {view.legacy.findingsRemaining.length ? (
            <section className="report-findings">
              <h3>{t("keyFindings")}</h3>
              {view.legacy.findingsRemaining.map((finding) => (
                <div key={finding.id}>
                  <h4>{finding.title}</h4>
                  <p>{finding.text}</p>
                  <p className="muted">{finding.evidenceIds.join(", ")}</p>
                </div>
              ))}
            </section>
          ) : null}
          {summary.recommendations.length ? (
            <section className="report-findings report-recommendations">
              <h3>{t("recommendations")}</h3>
              {summary.recommendations.map((item) => (
                <div key={item.id}>
                  <h4>{item.title}</h4>
                  <p>{item.text}</p>
                </div>
              ))}
            </section>
          ) : null}
          {!summary.kpis.length &&
          !summary.charts.length &&
          !summary.findings.length ? (
            <p className="muted">{t("documentOnly")}</p>
          ) : null}
        </>
      )}
      <details className="report-provenance">
        <summary>{t("provenance")}</summary>
        <dl>
          <dt>{t("source")}</dt>
          <dd>
            {summary.source.label} · {summary.source.id}
          </dd>
          <dt>{t("dataThrough")}</dt>
          <dd>
            {formatDate(
              summary.dataCutoff,
              preferences.locale,
              preferences.timezone,
            )}
          </dd>
          <dt>{t("policy")}</dt>
          <dd>
            {summary.policyVersion} · {summary.contentRevision}
          </dd>
          {summary.evidence.map((item) => (
            <div key={item.id}>
              <dt>{item.label}</dt>
              <dd>
                {item.sourceId} · {item.snapshotId ?? "—"}
                <br />
                {item.limitation}
              </dd>
            </div>
          ))}
        </dl>
        {savedSchema?.skill ? (
          <p>
            {savedSchema.skill.name} · {savedSchema.skill.revision}
          </p>
        ) : null}
        {[...summary.limitations, ...(savedSchema?.limitations ?? [])].map(
          (text, index) => (
            <p key={index}>{text}</p>
          ),
        )}
      </details>
    </div>
  );
}
