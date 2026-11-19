import { useCallback } from "react";
import { Link, useLocation } from "react-router";
import { FileText, ArrowUpRight, Clock, Layers } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWorkspaceService } from "../../../app/providers/ServicesProvider";
import { useAuth } from "../../auth/providers/AuthProvider";
import { usePreferences } from "../../../app/providers/PreferencesProvider";
import { useServiceRead } from "../../reports/hooks/useServiceRead";
import { useReportRefresh } from "../../reports/hooks/useReportRefresh";
import type { ReportsService } from "../../reports/services/reports-service";
import type { SchemaBlock } from "../../reports/model/report-schema";
import { ReportKpis } from "../../reports/components/ReportKpis";
import { InlineAlert, Skeleton } from "../../../shared/ui/feedback";
import { Button } from "../../../shared/ui/button";
import { formatDate } from "../../../shared/lib/format";
import { pinnedReportPath } from "../model/report-navigation";
import type { ReportReference } from "../model/types";
import { useState } from "react";
import "./report-reference-card.css";

export function PinnedReportLink({
  reference,
  children,
  className,
}: {
  reference: ReportReference;
  children: React.ReactNode;
  className?: string;
}) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const [focusMessage, setFocusMessage] = useState<string>();
  return (
    <Link
      className={className}
      onFocus={(event) =>
        setFocusMessage(
          event.currentTarget.closest<HTMLElement>("[data-message-id]")?.dataset
            .messageId,
        )
      }
      onPointerDown={(event) =>
        setFocusMessage(
          event.currentTarget.closest<HTMLElement>("[data-message-id]")?.dataset
            .messageId,
        )
      }
      to={pinnedReportPath(reference, location.search)}
      state={{
        chatOrigin: `${location.pathname}${location.search}`,
        chatConversation: params.get("conversation"),
        chatFocusMessage: focusMessage,
        reportViewerDepth: 1,
      }}
    >
      {children}
    </Link>
  );
}

const chartIds = (blocks: readonly SchemaBlock[]): string[] =>
  blocks.flatMap((b) =>
    b.kind === "chart"
      ? [b.chart.id]
      : b.kind === "section"
        ? chartIds(b.blocks)
        : [],
  );

/** Resolve metadata and status through the existing service, never the chat narrative. */
export function ReportReferenceCard({
  reference,
}: {
  reference: ReportReference;
}) {
  const { snapshot } = useAuth();
  const principal =
    snapshot.status === "authenticated" ? snapshot.principal : null;
  const service = useWorkspaceService<ReportsService>("reports");
  const { t } = useTranslation(["chat", "reports"]);
  const { preferences } = usePreferences();
  const read = useCallback(
    (signal: AbortSignal) =>
      service.detail(
        principal!,
        reference.reportId,
        reference.versionId,
        signal,
      ),
    [service, principal, reference.reportId, reference.versionId],
  );
  const { result, retry } = useServiceRead(
    `${principal?.id}:${reference.reportId}:${reference.versionId}`,
    read,
  );
  useReportRefresh(service, reference.reportId, retry);
  if (!result) return <Skeleton label={t("reports:loading")} />;
  const detail = result.data;
  if (!detail?.version || detail.version.id !== reference.versionId)
    return (
      <InlineAlert kind="error">
        {t("reportUnavailable")}{" "}
        <Button onClick={retry}>{t("app:retry")}</Button>
      </InlineAlert>
    );
  const schema = detail.version.schema;
  const metrics = schema?.dashboard.find((b) => b.kind === "metric-grid");
  const executive = schema?.dashboard.find((b) => b.kind === "text");
  const status = detail.summary.status;
  return (
    <section
      className="fleet-report-card"
      aria-label={`${detail.summary.record.title} · ${reference.versionId}`}
    >
      <header className="fleet-report-heading">
        <span className="fleet-report-badge">
          <FileText size={14} />
          {t("savedReport")}
        </span>
        <span className={`fleet-report-status fleet-report-status-${status}`}>
          {t(`reports:${status}`)}
        </span>
      </header>
      <div className="fleet-report-identity">
        <h4 title={detail.summary.record.title}>
          {detail.summary.record.title}
        </h4>
        <dl className="fleet-report-meta">
          <div>
            <dt>{t("reportCode")}</dt>
            <dd>{reference.versionId}</dd>
          </div>
          <div>
            <dt>
              <Clock size={12} />
              {t("reports:dataThrough")}
            </dt>
            <dd>
              {formatDate(
                detail.version.source.dataThrough,
                preferences.locale,
                preferences.timezone,
              )}
            </dd>
          </div>
        </dl>
      </div>
      {schema?.summary || executive?.title ? (
        <p className="fleet-report-summary">
          {schema?.summary ?? executive?.title}
        </p>
      ) : null}
      {metrics?.kind === "metric-grid" ? (
        <ReportKpis metrics={metrics.metrics} />
      ) : null}
      <footer>
        <span className="fleet-report-contents">
          <Layers size={14} />
          {schema?.sections.length ?? detail.version.sections.length}{" "}
          {t("sections")} · {new Set(chartIds(schema?.sections ?? [])).size}{" "}
          {t("charts")}
        </span>
        <PinnedReportLink
          reference={reference}
          className="button button-primary fleet-report-cta"
        >
          {t("viewReport")}
          <ArrowUpRight size={16} />
        </PinnedReportLink>
      </footer>
    </section>
  );
}
