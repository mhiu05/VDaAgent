import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { FileText, X } from "lucide-react";
import { IconButton } from "../../../shared/ui/button";
import { Skeleton } from "../../../shared/ui/feedback";
import { MarkdownContent } from "../components/MarkdownContent";
import { OfficeDocumentPreview, type OfficeKind } from "../components/OfficeDocumentPreview";
import "./agent-chat.css";

function useTextPreview(url: string, enabled: boolean) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setText(null);
    setFailed(false);
    if (!enabled || !url) return undefined;
    const controller = new AbortController();
    fetch(url, { credentials: "include", signal: controller.signal })
      .then((response) => response.ok ? response.text() : Promise.reject(new Error(String(response.status))))
      .then((value) => { if (!controller.signal.aborted) setText(value); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [url, enabled]);
  return { text, failed };
}

function usePdfObjectUrl(url: string, enabled: boolean) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setObjectUrl(null);
    setFailed(false);
    if (!enabled || !url) return undefined;
    const controller = new AbortController();
    let created = "";
    fetch(url, { credentials: "include", signal: controller.signal })
      .then((response) => response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status))))
      .then((buffer) => {
        if (controller.signal.aborted) return;
        created = URL.createObjectURL(new Blob([buffer], { type: "application/pdf" }));
        setObjectUrl(created);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => {
      controller.abort();
      if (created) URL.revokeObjectURL(created);
    };
  }, [url, enabled]);
  return { objectUrl, failed };
}

export default function BrowserFilePreviewPage() {
  const { t } = useTranslation(["chat", "app"]);
  const [params] = useSearchParams();
  const filename = params.get("name") ?? t("acDocumentPreview");
  const mime = params.get("mime") ?? "";
  const url = params.get("url") ?? "";
  const lower = filename.toLowerCase();
  const markdown = mime === "text/markdown" || /\.mdx?$/.test(lower);
  const pdf = mime === "application/pdf" || lower.endsWith(".pdf");
  const officeKind: OfficeKind | null = lower.endsWith(".docx") ? "docx"
    : lower.endsWith(".xlsx") ? "xlsx"
      : lower.endsWith(".pptx") ? "pptx" : null;
  const { text, failed: textFailed } = useTextPreview(url, markdown);
  const { objectUrl, failed: pdfFailed } = usePdfObjectUrl(url, pdf);
  const failed = !url || textFailed || pdfFailed;

  return (
    <main className="browser-file-preview">
      <header className="browser-file-preview-header">
        <div>
          <span>{t("acDocumentPreview")}</span>
          <h1>{filename}</h1>
        </div>
        <IconButton label={t("acCloseDocument")} onClick={() => window.close()}><X size={19} /></IconButton>
      </header>
      <section className="browser-file-preview-content">
        {pdf && !objectUrl && !failed ? <Skeleton label={t("app:loading")} /> : null}
        {pdf && objectUrl ? <iframe src={objectUrl} title={filename} /> : null}
        {officeKind ? <OfficeDocumentPreview url={url} filename={filename} kind={officeKind} /> : null}
        {markdown && text === null && !failed ? <Skeleton label={t("app:loading")} /> : null}
        {markdown && text !== null ? (
          <article className="ac-report-paper ac-text-document">
            <header className="ac-report-masthead"><span>{t("acProfessionalReport")}</span><strong>{filename.replace(/\.[^.]+$/, "")}</strong><small>MD · {t("acPreviewMode")}</small></header>
            <div className="ac-report-rule" />
            <div className="ac-report-body"><MarkdownContent body={text} /></div>
            <footer className="ac-report-footer"><span>VDaAgent</span><span>{t("acPreviewMode")}</span></footer>
          </article>
        ) : null}
        {!pdf && !markdown && !officeKind ? (
          <div className="ac-document-unsupported"><FileText size={52} /><strong>{filename}</strong><p className="muted">{t("acDocumentUnsupported")}</p></div>
        ) : null}
        {failed ? <p className="muted ac-document-error">{t("acDocumentLoadError")}</p> : null}
      </section>
    </main>
  );
}
