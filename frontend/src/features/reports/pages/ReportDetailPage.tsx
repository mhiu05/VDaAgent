import { useCallback, useEffect, useRef, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { Principal } from "../../../shared/contracts/auth";
import { useWorkspaceService } from "../../../app/providers/ServicesProvider";
import { usePreferences } from "../../../app/providers/PreferencesProvider";
import { formatDate } from "../../../shared/lib/format";
import { PageState } from "../../../shared/ui/page";
import { Button } from "../../../shared/ui/button";
import { InlineAlert, Skeleton } from "../../../shared/ui/feedback";
import type {
  ReportsService,
  WorkspaceCatalog,
} from "../services/reports-service";
import { useServiceRead } from "../hooks/useServiceRead";
import { useReportRefresh } from "../hooks/useReportRefresh";
import { ReportDocument } from "../components/ReportDocument";
import { ReportDashboard } from "../components/ReportDashboard";
import {
  ReportViewerActions,
  ReportViewerHeader,
} from "../components/ReportViewerHeader";
import { Dialog } from "../../../shared/ui/overlay";
import { ChartExpansion } from "../../../shared/charts/ChartExpansion";
import { useAnalyticalMotion } from "../../../shared/motion/useAnalyticalMotion";

/** One dialog and one version read serve both analytical and document modes. */
export default function ReportViewer({
  principal,
  id,
  versionId,
  mode,
  onClose,
  onViewChange,
  onVersionChange,
  triggerRef,
  projects,
  reportTypes,
  returnToChat = false,
}: {
  principal: Principal;
  id: string;
  versionId?: string;
  mode: "dashboard" | "detail";
  onClose(): void;
  onViewChange(mode: "dashboard" | "detail"): void;
  onVersionChange(version: string, replace?: boolean): void;
  triggerRef: RefObject<HTMLElement | null>;
  projects: WorkspaceCatalog["projects"];
  reportTypes?: WorkspaceCatalog["reportTypes"];
  returnToChat?: boolean;
}) {
  const { preferences } = usePreferences();
  const { t } = useTranslation("reports");
  const service = useWorkspaceService<ReportsService>("reports");
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const positions = useRef({ dashboard: 0, detail: 0 });
  const read = useCallback(
    (signal: AbortSignal) => service.detail(principal, id, versionId, signal),
    [service, principal, id, versionId],
  );
  const { result, retry } = useServiceRead(
    `${principal.id}:${id}:${versionId}`,
    read,
  );
  useReportRefresh(service, id, retry);
  const detail = result?.data;
  const selectedVersion = detail?.version?.id;
  useAnalyticalMotion(
    content,
    `${selectedVersion ?? "loading"}:${mode}`,
    "content",
  );
  useEffect(() => {
    if (!versionId && selectedVersion) onVersionChange(selectedVersion, true);
  }, [versionId, selectedVersion, onVersionChange]);
  // URL normalization changes the read key. Keep controls disabled through that
  // transition instead of briefly enabling them before the canonical read.
  const controlDetail = versionId ? detail : undefined;
  useEffect(() => {
    positions.current = { dashboard: 0, detail: 0 };
  }, [id, selectedVersion]);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = positions.current[mode];
  }, [mode, selectedVersion]);
  function changeView() {
    if (scroll.current) positions.current[mode] = scroll.current.scrollTop;
    onViewChange(mode === "dashboard" ? "detail" : "dashboard");
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onEscapeKeyDown={(event) => {
        const collapse = scroll.current?.querySelector<HTMLButtonElement>(
          '[data-expanded="true"] button[aria-expanded="true"]',
        );
        if (collapse) {
          event.preventDefault();
          collapse.click();
        }
      }}
      title={
        detail?.version?.schema?.title ??
        detail?.summary.record.title ??
        t("detail")
      }
      description={t(
        mode === "dashboard" ? "dashboardDescription" : "detailDescription",
      )}
      closeLabel={returnToChat ? t("chat:returnToChat") : t("close")}
      triggerRef={triggerRef}
      className="report-viewer"
      headerActions={
        <>
          {returnToChat ? (
            <Button variant="secondary" onClick={onClose}>
              {t("chat:returnToChat")}
            </Button>
          ) : null}
          <ReportViewerActions
            principal={principal}
            detail={controlDetail ?? undefined}
            mode={mode}
            onViewChange={changeView}
          />
        </>
      }
    >
      <ReportViewerHeader
        detail={controlDetail ?? undefined}
        projects={projects}
        onVersionChange={onVersionChange}
      />
      <div ref={scroll} className="report-viewer-scroll" data-view={mode}>
        {!result ? (
          <Skeleton label={t("loading")} />
        ) : result.error ? (
          <PageState
            kind="error"
            title={t(
              result.error.code === "forbidden"
                ? "denied"
                : result.error.code === "notFound"
                  ? "notFound"
                  : "error",
            )}
            action={<Button onClick={retry}>{t("retry")}</Button>}
          />
        ) : detail ? (
          <div
            ref={content}
            className="reports-workspace report-detail"
            data-motion-region
          >
            {detail.summary.latestAttempt?.state === "failed" &&
            detail.version ? (
              <InlineAlert>{t("newAttemptFailed")}</InlineAlert>
            ) : (detail.summary.latestAttempt?.state === "running" ||
                detail.summary.latestAttempt?.state === "queued") &&
              detail.version ? (
              <InlineAlert>{t("newAttemptRunning")}</InlineAlert>
            ) : null}
            {detail.version?.schemaIssue ? (
              <InlineAlert>{t("schemaFallback")}</InlineAlert>
            ) : null}
            {detail.version ? (
              <>
                <ChartExpansion key={`${id}:${selectedVersion}:${mode}`}>
                  {mode === "dashboard" ? (
                    <ReportDashboard detail={detail} />
                  ) : (
                    <ReportDocument detail={detail} />
                  )}
                </ChartExpansion>
                <details className="report-provenance report-viewer-metadata">
                  <summary>{t("reportContext")}</summary>
                  <div className="report-metadata">
                    <span translate="no">{detail.summary.record.code}</span>
                    <span>
                      {t(detail.summary.record.type, {
                        defaultValue:
                          reportTypes?.find(
                            (type) => type.id === detail.summary.record.type,
                          )?.name ?? detail.summary.record.type,
                      })}
                    </span>
                    <span>
                      {detail.summary.record.author.name} ·{" "}
                      {detail.summary.record.agent}
                    </span>
                    <span>
                      {t("completedAt")}:{" "}
                      {formatDate(
                        detail.version.completedAt,
                        preferences.locale,
                        preferences.timezone,
                      )}
                    </span>
                    <span>{detail.version.contentRevision}</span>
                  </div>
                </details>
              </>
            ) : (
              <PageState
                kind="empty"
                title={t("noVersion")}
                description={t("noVersionNote")}
              />
            )}
          </div>
        ) : null}
      </div>
      <span aria-live="polite" aria-atomic="true" className="sr-only">
        {selectedVersion
          ? `${selectedVersion} · ${t(mode === "dashboard" ? "dashboardView" : "detail")}`
          : t("loading")}
      </span>
    </Dialog>
  );
}
