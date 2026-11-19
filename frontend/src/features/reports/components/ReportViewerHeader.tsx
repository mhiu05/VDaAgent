import { ArrowLeft, FileText } from "lucide-react";
import { useRef } from "react";
import { useAnalyticalMotion } from "../../../shared/motion/useAnalyticalMotion";
import { useTranslation } from "react-i18next";
import { usePreferences } from "../../../app/providers/PreferencesProvider";
import { formatDate } from "../../../shared/lib/format";
import { Button } from "../../../shared/ui/button";
import { FormField, Select } from "../../../shared/ui/form";
import { StatusBadge } from "../../../shared/ui/data";
import type { Principal } from "../../../shared/contracts/auth";
import type { ReportDetail } from "../model/types";
import type { WorkspaceCatalog } from "../services/reports-service";
import { ReportArtifactActions } from "./ReportArtifactActions";

export function ReportViewerActions({
  principal,
  detail,
  mode,
  onViewChange,
}: {
  principal: Principal;
  detail?: ReportDetail;
  mode: "dashboard" | "detail";
  onViewChange(): void;
}) {
  const { t } = useTranslation("reports");
  return (
    <div className="report-header-actions">
      {detail?.version ? (
        <ReportArtifactActions
          key={detail.version.id}
          principal={principal}
          detail={detail}
        />
      ) : null}
      <Button
        variant={mode === "dashboard" ? "primary" : "secondary"}
        disabled={!detail?.version}
        onClick={onViewChange}
      >
        {mode === "dashboard" ? (
          <FileText size={16} />
        ) : (
          <ArrowLeft size={16} />
        )}
        {t(mode === "dashboard" ? "fullReport" : "backDashboard")}
      </Button>
    </div>
  );
}

export function ReportViewerHeader({
  detail,
  projects,
  onVersionChange,
}: {
  detail?: ReportDetail;
  projects: WorkspaceCatalog["projects"];
  onVersionChange(id: string): void;
}) {
  const { t } = useTranslation("reports");
  const { preferences } = usePreferences();
  const version = detail?.version;
  const root = useRef<HTMLDivElement>(null);
  useAnalyticalMotion(root, version?.id ?? "loading");
  return (
    <div ref={root} className="report-viewer-header">
      {version && detail ? (
        <div className="report-version-bar">
          <FormField id="report-version" label={t("savedVersions")}>
            <Select
              id="report-version"
              value={version.id}
              onChange={(e) => onVersionChange(e.target.value)}
            >
              {detail.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.sequence} · {v.id}
                </option>
              ))}
            </Select>
          </FormField>
          <div className="report-snapshot">
            <span>
              {t("dataThrough")}:{" "}
              <time dateTime={version.source.dataThrough}>
                {formatDate(
                  version.source.dataThrough,
                  preferences.locale,
                  preferences.timezone,
                )}
              </time>
            </span>
            <span>
              {t("scope")}:{" "}
              {detail.summary.record.projectIds
                .map((id) => projects.find((p) => p.id === id)?.name ?? id)
                .join(", ")}
            </span>
            <span>
              {t(
                version.source.mode === "mock"
                  ? "intendedProducer"
                  : "producer",
              )}
              : {detail.summary.record.agent}
            </span>
          </div>
          {version.source.mode === "mock" ? (
            <StatusBadge tone="neutral" label={t("simulatedData")} />
          ) : null}
          <StatusBadge tone="success" label={t("completed")} />
          <StatusBadge
            tone={
              version.source.completeness === "full" ? "success" : "warning"
            }
            label={t(
              version.source.completeness === "full"
                ? "fullData"
                : version.source.completeness === "missing"
                  ? "missingData"
                  : "partialData",
            )}
          />
        </div>
      ) : null}
    </div>
  );
}
