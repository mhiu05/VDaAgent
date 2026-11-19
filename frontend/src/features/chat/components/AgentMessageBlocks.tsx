import { useTranslation } from "react-i18next";
import type { AgentContentBlock } from "../model/types";
import { MarkdownContent } from "./MarkdownContent";
import { ReportKpis } from "../../reports/components/ReportKpis";
import { ChartRenderer } from "../../../shared/charts/ChartRenderer";
import { ChartExpansion } from "../../../shared/charts/ChartExpansion";
import { PagedDataTable } from "../../../shared/charts/PagedDataTable";
import { Button } from "../../../shared/ui/button";
import { ReportReferenceCard } from "./ReportReferenceCard";

export function agentResultText(
  body: string,
  blocks: readonly AgentContentBlock[] = [],
): string {
  return [
    body,
    ...blocks.map((b) => {
      switch (b.kind) {
        case "text":
          return b.markdown;
        case "metric-grid":
          return b.metrics
            .map(
              (m) =>
                `${m.label}: ${m.value ?? "—"} ${m.unit}. ${m.comparison ?? ""}. ${m.definition ?? ""}`,
            )
            .join("\n");
        case "comparison":
        case "data-table":
          return [
            b.title,
            b.columns.join("\t"),
            ...b.rows.map((r) => r.join("\t")),
          ].join("\n");
        case "chart":
          return [
            b.chart.title,
            ...b.chart.labels.map(
              (l, i) =>
                `${l}: ${b.chart.series.map((s) => `${s.label} ${s.values[i]} ${s.unit}`).join(", ")}`,
            ),
          ].join("\n");
        case "finding":
        case "recommendation":
          return `${b.title}. ${b.text}. ${b.description ?? ""}`;
        case "details":
        case "section":
          return agentResultText(b.title, b.blocks);
        case "report-ref":
          return `${b.reference.reportId} · ${b.reference.versionId}`;
        default:
          return "title" in b ? b.title : "";
      }
    }),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function Content({
  blocks,
  scope,
  onAction,
}: {
  blocks: readonly AgentContentBlock[];
  scope: string;
  onAction(action: "report" | "group"): void;
}) {
  const { t } = useTranslation("chat");
  return (
    <div className="fleet-blocks">
      {blocks.map((b, index) => {
        const key = `${b.id}-${index}`;
        switch (b.kind) {
          case "text":
            return <MarkdownContent key={key} body={b.markdown} />;
          case "metric-grid":
            return <ReportKpis key={key} metrics={b.metrics} />;
          case "chart":
            return (
              <ChartRenderer
                key={key}
                spec={b.chart}
                scope={scope}
                presentation="compact"
              />
            );
          case "comparison":
          case "data-table":
            return (
              <div key={key} className="fleet-data-table">
                <PagedDataTable
                  caption={b.title}
                  columns={b.columns}
                  rows={b.rows}
                />
                <p className="muted">{b.unit}</p>
              </div>
            );
          case "finding":
          case "recommendation":
            return (
              <section
                key={key}
                data-block-kind={b.kind}
                className={`fleet-finding fleet-${b.kind}`}
              >
                <h4>{b.title}</h4>
                <p>{b.text}</p>
                {b.description ? (
                  <p className="fleet-caveat">{b.description}</p>
                ) : null}
              </section>
            );
          case "details":
            return (
              <details key={key} className="fleet-details">
                <summary>{b.title}</summary>
                <Content blocks={b.blocks} scope={scope} onAction={onAction} />
              </details>
            );
          case "section":
            return (
              <section key={key}>
                <h4>{b.title}</h4>
                <Content blocks={b.blocks} scope={scope} onAction={onAction} />
              </section>
            );
          case "report-ref":
            return <ReportReferenceCard key={key} reference={b.reference} />;
          case "action":
            return (
              <Button
                key={key}
                variant="secondary"
                onClick={() => onAction(b.action)}
              >
                {b.label}
              </Button>
            );
          case "unsupported":
            return (
              <p key={key} role="status">
                {t("artifactFallback")}
              </p>
            );
          case "evidence":
            return (
              <p key={key} className="fleet-source">
                {b.title}: {b.references.join(", ")}
              </p>
            );
        }
      })}
    </div>
  );
}

export function AgentMessageBlocks(props: {
  blocks: readonly AgentContentBlock[];
  scope: string;
  onAction(action: "report" | "group"): void;
}) {
  return (
    <ChartExpansion scrollSelector=".timeline">
      <Content {...props} />
    </ChartExpansion>
  );
}
