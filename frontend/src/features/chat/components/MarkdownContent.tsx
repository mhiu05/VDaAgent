import { Children, memo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";
import { safeUrl } from "../../../shared/lib/url-policy";
import { Button } from "../../../shared/ui/button";
import { useFeedback } from "../../../shared/ui/feedback";
import { Tooltip } from "../../../shared/ui/overlay";

function linkDescription(href: string, t: (key: string, options?: Record<string, unknown>) => string) {
  try {
    const url = new URL(href, window.location.origin);
    const path = url.pathname.toLowerCase();
    if (url.origin !== window.location.origin)
      return t("acLinkExternal", { host: url.hostname });
    if (path.startsWith("/agents")) return t("acLinkAgents");
    if (path.startsWith("/reports")) return t("acLinkReports");
    if (path.startsWith("/chat")) return t("acLinkChat");
    if (path.startsWith("/setting")) return t("acLinkSettings");
    return t("acLinkInternal");
  } catch {
    return t("acLinkExternal", { host: href });
  }
}
export const MarkdownContent = memo(function MarkdownContent({
  body,
}: {
  body: string;
}) {
  const { t } = useTranslation(["chat", "app"]);
  const notify = useFeedback();
  return (
    <div className="markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url) => safeUrl(url) ?? ""}
        components={{
          h1: ({ children }) => <h3>{children}</h3>,
          h2: ({ children }) => <h3>{children}</h3>,
          h3: ({ children }) => <h4>{children}</h4>,
          a: ({ href, children, title }) => {
            if (!href) return <span>{children}</span>;
            const previewTitle = Children.toArray(children)
              .filter((child): child is string | number => typeof child === "string" || typeof child === "number")
              .join("")
              .trim() || href;
            const previewSummary = title?.trim() || linkDescription(href, t);
            return (
              <Tooltip label={
                <span className="link-preview">
                  <strong>{previewTitle}</strong>
                  <span>{previewSummary}</span>
                </span>
              }>
                <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
              </Tooltip>
            );
          },
          img: ({ alt }) => <span className="muted">[{alt}]</span>,
          table: ({ children }) => (
            <div
              className="table-scroll"
              role="region"
              tabIndex={0}
              aria-label={t("mockResponse")}
            >
              <table>{children}</table>
            </div>
          ),
          pre: ({ children }) => (
            <div className="code-block">
              <Button
                variant="ghost"
                onClick={async (e) => {
                  try {
                    const code =
                      e.currentTarget.parentElement?.querySelector("code")
                        ?.textContent ?? "";
                    await navigator.clipboard.writeText(code);
                    notify({ kind: "success", title: t("app:copied") });
                  } catch {
                    notify({ kind: "error", title: t("app:copyError") });
                  }
                }}
              >
                {t("copyCode")}
              </Button>
              <pre tabIndex={0}>{children}</pre>
            </div>
          ),
        }}
      >
        {body}
      </Markdown>
    </div>
  );
});
