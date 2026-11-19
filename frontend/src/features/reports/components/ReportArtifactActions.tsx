import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import type { Principal } from "../../../shared/contracts/auth";
import { useWorkspaceService } from "../../../app/providers/ServicesProvider";
import { Button } from "../../../shared/ui/button";
import { InlineAlert } from "../../../shared/ui/feedback";
import type { ReportsService } from "../services/reports-service";
import type { ReportDetail } from "../model/types";
export function ReportArtifactActions({
  principal,
  detail,
}: {
  principal: Principal;
  detail: ReportDetail;
}) {
  const { t } = useTranslation("reports");
  const service = useWorkspaceService<ReportsService>("reports");
  const [state, setState] = useState<"idle" | "pending" | "error" | "success">(
    "idle",
  );
  const controller = useRef<AbortController | null>(null);
  const urls = useRef(new Set<string>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(
    () => () => {
      controller.current?.abort();
      urls.current.forEach((url) => URL.revokeObjectURL(url));
      timers.current.forEach((timer) => clearTimeout(timer));
    },
    [],
  );
  async function download(artifactId: string) {
    if (!detail.version) return;
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setState("pending");
    try {
      const result = await service.download(
        principal,
        detail.summary.record.id,
        detail.version.id,
        artifactId,
        active.signal,
      );
      if (active.signal.aborted) return;
      if (result.error || result.data.versionId !== detail.version.id) {
        setState("error");
        return;
      }
      const artifact = result.data;
      const url = URL.createObjectURL(
        new Blob([artifact.content], {
          type: `${artifact.mediaType};charset=utf-8`,
        }),
      );
      urls.current.add(url);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = artifact.filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      const timer = setTimeout(() => {
        URL.revokeObjectURL(url);
        urls.current.delete(url);
        timers.current.delete(timer);
      }, 1000);
      timers.current.add(timer);
      setState("success");
    } catch {
      if (!active.signal.aborted) setState("error");
    }
  }
  return (
    <div className="report-downloads">
      {detail.artifacts.length ? (
        <div className="row">
          {detail.artifacts.map((artifact) => (
            <Button
              key={artifact.id}
              pending={state === "pending"}
              onClick={() => void download(artifact.id)}
            >
              <Download size={16} />
              {t(detail.version?.schema ? "downloadReport" : "download", {
                format:
                  artifact.filename.split(".").at(-1)?.toUpperCase() ??
                  artifact.mediaType,
              })}
            </Button>
          ))}
        </div>
      ) : (
        <p className="muted">{t("noArtifact")}</p>
      )}
      {state === "error" ? (
        <InlineAlert kind="error">{t("downloadError")}</InlineAlert>
      ) : state === "success" ? (
        <p role="status" className="muted">
          {t(detail.version?.schema ? "reportDownloaded" : "downloaded")}
        </p>
      ) : state === "pending" ? (
        <p role="status">{t("downloading")}</p>
      ) : null}
    </div>
  );
}
