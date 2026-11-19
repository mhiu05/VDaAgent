import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";
import { usePreferences } from "../../../app/providers/PreferencesProvider";
import { formatDate } from "../../../shared/lib/format";
import { ReportKpis } from "./ReportKpis";
import type { ChartPresentation } from "../../../shared/charts/ChartRenderer";
import { safeUrl } from "../../../shared/lib/url-policy";
import { ChartRenderer } from "../../../shared/charts/ChartRenderer";
import { PagedDataTable } from "../../../shared/charts/PagedDataTable";
import type { ReportDetail } from "../model/types";
import type { ReportSchema, SchemaBlock } from "../model/report-schema";
import type { MouseEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { useAnalyticalMotion } from "../../../shared/motion/useAnalyticalMotion";

function anchor(event: MouseEvent<HTMLAnchorElement>, id: string) {
  event.preventDefault();
  const target = document.getElementById(id);
  target?.scrollIntoView({ block: "start", behavior: "instant" });
  target?.focus({ preventScroll: true });
}
const blockId = (path: string) => `schema-${encodeURIComponent(path)}`;
export function ReportBlocks({
  blocks,
  detail,
  path = "dashboard",
  level = 3,
  presentation = "reading",
  parentTitle,
}: {
  blocks: readonly SchemaBlock[];
  detail: ReportDetail;
  path?: string;
  level?: number;
  presentation?: ChartPresentation;
  parentTitle?: string;
}) {
  const { t } = useTranslation("reports");
  const { preferences } = usePreferences();
  const root = useRef<HTMLDivElement>(null);
  useAnalyticalMotion(root, `${detail.version?.id}:${path}`, "dashboard");
  const Heading = `h${Math.min(6, level)}` as "h2" | "h3" | "h4" | "h5" | "h6";
  return (
    <div ref={root} className="report-block-grid" data-motion-owner>
      {blocks.map((b) => {
        const currentPath = `${path}/${b.id}`;
        const evidenceIds = [
          ...new Set([
            ...b.evidenceIds,
            ...(b.kind === "chart" ? (b.chart.evidenceIds ?? []) : []),
          ]),
        ];
        return (
          <section
            key={b.id}
            id={blockId(currentPath)}
            tabIndex={-1}
            data-motion={b.kind === "finding" ? "insight" : undefined}
            className={`report-schema-block report-schema-${b.kind} report-span-${b.span ?? "full"}`}
          >
            {b.kind !== "chart" && b.title !== parentTitle ? (
              <Heading>{b.title}</Heading>
            ) : null}
            {b.description ? <p className="muted">{b.description}</p> : null}
            {b.kind === "metric-grid" ? (
              <ReportKpis metrics={b.metrics} />
            ) : null}
            {b.kind === "chart" ? (
              <ChartRenderer
                key={`${detail.version?.id}:${b.chart.id}`}
                spec={b.chart}
                presentation={presentation}
                sourceDetails={
                  evidenceIds.length
                    ? evidenceIds.map((id) => {
                        const e = detail.evidence.find(
                          (e) =>
                            e.id === id &&
                            detail.version?.evidenceIds.includes(id),
                        );
                        return (
                          <p key={id}>
                            {e
                              ? `${e.label} · ${e.sourceId} · ${e.snapshotId ?? "—"} · ${e.limitation}`
                              : t("noEvidence")}
                          </p>
                        );
                      })
                    : undefined
                }
                scope={formatDate(
                  detail.version!.source.dataThrough,
                  preferences.locale,
                  preferences.timezone,
                )}
              />
            ) : null}
            {b.kind === "text" ? (
              <div className="markdown">
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  skipHtml
                  urlTransform={(url) => safeUrl(url) ?? ""}
                  components={{
                    h1: ({ children }) => <Heading>{children}</Heading>,
                    h2: ({ children }) => <Heading>{children}</Heading>,
                    h3: ({ children }) => <Heading>{children}</Heading>,
                    a: ({ href, children }) =>
                      href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {children}
                        </a>
                      ) : (
                        <span>{children}</span>
                      ),
                    img: ({ alt }) => <span>{alt}</span>,
                    table: ({ children }) => (
                      <div
                        className="table-scroll"
                        tabIndex={0}
                        role="region"
                        aria-label={b.title}
                      >
                        <table>{children}</table>
                      </div>
                    ),
                  }}
                >
                  {b.markdown}
                </Markdown>
              </div>
            ) : null}
            {b.kind === "finding" || b.kind === "recommendation" ? (
              <p>{b.text}</p>
            ) : null}
            {b.kind === "data-table" || b.kind === "comparison" ? (
              <>
                <p className="muted">
                  {t("units")}: {b.unit}
                </p>
                <PagedDataTable
                  key={`${detail.version?.id}:${currentPath}`}
                  caption={b.title}
                  columns={b.columns}
                  rows={b.rows}
                  pageSize={presentation === "compact" ? 25 : 100}
                />
              </>
            ) : null}
            {b.kind === "section" ? (
              <ReportBlocks
                blocks={b.blocks}
                detail={detail}
                path={currentPath}
                level={level + 1}
                presentation={presentation}
                parentTitle={b.title}
              />
            ) : null}
            {b.kind === "unsupported" ? (
              <p role="status">
                {t("unsupportedBlock", { kind: b.originalKind })}
              </p>
            ) : null}
            {b.kind === "evidence"
              ? b.references.map((id) => {
                  const evidence = detail.evidence.find(
                    (e) =>
                      e.id === id && detail.version?.evidenceIds.includes(id),
                  );
                  return evidence ? (
                    <dl key={id}>
                      <dt>{evidence.label}</dt>
                      <dd>
                        {evidence.sourceId} · {evidence.snapshotId ?? "—"}
                        <br />
                        {evidence.limitation}
                      </dd>
                    </dl>
                  ) : (
                    <p key={id}>{t("noEvidence")}</p>
                  );
                })
              : null}
            {evidenceIds.length && b.kind !== "chart" ? (
              <details className="report-block-evidence">
                <summary>{t("evidence")}</summary>
                {evidenceIds.map((id) => {
                  const e = detail.evidence.find(
                    (e) =>
                      e.id === id && detail.version?.evidenceIds.includes(id),
                  );
                  return (
                    <p key={id}>
                      {e
                        ? `${e.label} · ${e.sourceId} · ${e.limitation}`
                        : t("noEvidence")}
                    </p>
                  );
                })}
              </details>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
export function SchemaDocument({
  schema,
  detail,
}: {
  schema: ReportSchema;
  detail: ReportDetail;
}) {
  const { t } = useTranslation("reports");
  const reader = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState<string | undefined>(
    schema.sections[0]?.id,
  );
  useEffect(() => {
    const scroll = reader.current?.closest(".report-viewer-scroll");
    if (!scroll) return;
    let frame = 0;
    const update = () => {
      const top = scroll.getBoundingClientRect().top + 56;
      const active =
        scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop < 2
          ? schema.sections.at(-1)
          : (schema.sections
              .filter((b) => {
                const element = document.getElementById(
                  blockId(`document/${b.id}`),
                );
                return element && element.getBoundingClientRect().top <= top;
              })
              .at(-1) ?? schema.sections[0]);
      setActiveSection(active?.id);
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    scroll.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      scroll.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [schema]);
  return (
    <div ref={reader} className="report-reader" data-version={schema.versionId}>
      <details className="report-contents" open>
        <summary>{t("contents")}</summary>
        <nav aria-label={t("contents")}>
          <ol>
            {schema.sections.map((b) => (
              <li key={b.id}>
                <a
                  href={`#${blockId(`document/${b.id}`)}`}
                  aria-current={activeSection === b.id ? "location" : undefined}
                  onClick={(e) => {
                    anchor(e, blockId(`document/${b.id}`));
                    setActiveSection(b.id);
                  }}
                >
                  {b.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </details>
      <article className="report-document" lang={schema.language ?? "vi"}>
        <p className="report-document-language">{t("savedDocument")}</p>
        {schema.summary ? (
          <p className="report-schema-summary">{schema.summary}</p>
        ) : null}
        <ReportBlocks
          blocks={schema.sections}
          detail={detail}
          path="document"
          level={2}
        />
        {schema.limitations.length ? (
          <section>
            <h2>{t("limitations")}</h2>
            {schema.limitations.map((l, i) => (
              <p key={i}>{l}</p>
            ))}
          </section>
        ) : null}
      </article>
    </div>
  );
}
