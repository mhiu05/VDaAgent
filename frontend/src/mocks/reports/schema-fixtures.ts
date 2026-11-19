import type { ChartSpec } from "../../shared/charts/chart-contract";
import type {
  ReportSchema,
  SchemaBlock,
} from "../../features/reports/model/report-schema";
import type {
  ReportBlock,
  ReportDataset,
  ReportVersion,
} from "../../features/reports/model/types";
import { createReportFixtures, demoScope } from "./fixtures";

export const showcaseTypes = [
  { id: "inventory", name: "Inventory" },
  { id: "transactions", name: "Sales performance" },
  { id: "comparison", name: "Project benchmarking" },
  {
    id: "customer-segmentation",
    name: "Customer segmentation",
    description: "Custom skill · deterministic demonstration",
    category: "Custom skills",
  },
];
function fromLegacy(block: ReportBlock): SchemaBlock {
  const base = {
    id: block.id,
    title: block.title,
    evidenceIds: "evidenceIds" in block ? block.evidenceIds : [],
  };
  if ("paragraphs" in block)
    return { ...base, kind: "text", markdown: block.paragraphs.join("\n\n") };
  if ("text" in block) return { ...base, kind: block.kind, text: block.text };
  if ("rows" in block) {
    if (block.kind === "metric-table")
      return {
        ...base,
        kind: "metric-grid",
        metrics: block.rows.map((r, i) => ({
          id: String(i),
          label: String(r[0]),
          value: typeof r[1] === "number" ? r[1] : null,
          unit: block.unit,
          definition: typeof r[2] === "string" ? r[2] : undefined,
        })),
      };
    return {
      ...base,
      kind: "comparison",
      columns: block.columns,
      rows: block.rows,
      unit: block.unit,
    };
  }
  return {
    ...base,
    kind: "chart",
    chart: {
      id: block.id,
      title: block.title,
      description: block.question,
      type: block.chartType ?? "bar",
      labels: block.labels,
      dimension: { label: block.title, kind: "categorical" },
      series: [
        {
          id: "observed",
          label: block.title,
          unit: block.unit,
          values: block.values,
        },
      ],
      sourceId: block.sourceId,
    },
  };
}
function schemaFor(version: ReportVersion, data: ReportDataset): ReportSchema {
  const record = data.records.find((r) => r.id === version.reportId)!;
  const sections = version.sections.map(fromLegacy);
  return {
    schemaVersion: 1,
    reportId: version.reportId,
    versionId: version.id,
    reportTypeId: record.type,
    title: record.title,
    domain: "demo-analysis",
    skill: { id: "demo-report", name: "VDA Demo Report", revision: "1" },
    scope: { ...demoScope },
    description:
      "DỮ LIỆU MÔ PHỎNG · DEMO · Các khối dùng chung từ bản lưu đã chọn.",
    limitations: ["Dữ liệu mô phỏng, không phản ánh thị trường thực tế."],
    dashboard: sections.filter((b) =>
      [
        "metric-grid",
        "chart",
        "finding",
        "recommendation",
        "comparison",
      ].includes(b.kind),
    ),
    sections,
    diagnostics: [],
  };
}
const chartBlock = (
  chart: ChartSpec,
  evidenceIds: readonly string[] = [],
  span: "full" | "half" = "half",
): SchemaBlock => ({
  id: chart.id,
  title: chart.title,
  kind: "chart",
  chart,
  evidenceIds,
  span,
});

/** Opt-in showcase keeps all original persisted fixtures and baseline counts unchanged. */
export function createSchemaFixtures(
  scenario = "report-showcase",
): ReportDataset {
  const data = createReportFixtures();
  const preservedSchemas = new Set(
    data.versions.filter((v) => v.schema).map((v) => v.id),
  );
  for (const version of data.versions.filter((v) =>
    ["R001", "R004", "R007"].includes(v.reportId),
  )) {
    const schema = schemaFor(version, data);
    if (version.reportId === "R004") {
      const original = version.sections.find((b) => b.kind === "chart")!;
      const previous = original.labels.map(
        (_, day) =>
          Array.from({ length: 28 }, (_, i) => (i * 7) % 30).filter(
            (i) => i === day,
          ).length,
      );
      const trend = chartBlock(
        {
          id: "sales-trend",
          title: "Giao dịch hai kỳ · Sales trend",
          type: "line",
          semantic: "trend",
          dimension: {
            label: "Ngày tương ứng trong hai kỳ 30 ngày",
            kind: "temporal",
          },
          labels: original.labels,
          series: [
            {
              id: "current",
              label: "Hiện tại",
              unit: "giao dịch",
              values: original.values,
            },
            {
              id: "previous",
              label: "Kỳ trước",
              unit: "giao dịch",
              values: previous,
            },
          ],
          sourceId: original.sourceId,
        },
        version.evidenceIds,
        "full",
      );
      const breakdown = chartBlock(
        {
          id: "sales-breakdown",
          title: "Phân bổ giao dịch trong kỳ",
          type: "column",
          dimension: { label: "Ngày trong kỳ", kind: "categorical" },
          labels: ["Ngày 1–10", "Ngày 11–20", "Ngày 21–30"],
          series: [
            {
              id: "completed",
              label: "Hoàn tất",
              unit: "giao dịch",
              values: [0, 10, 20].map((start) =>
                original.values
                  .slice(start, start + 10)
                  .reduce<number>((a, v) => a + (v ?? 0), 0),
              ),
            },
          ],
          sourceId: original.sourceId,
        },
        version.evidenceIds,
      );
      schema.dashboard = [
        ...schema.dashboard.filter((b) => b.kind !== "chart"),
        trend,
        breakdown,
      ];
      schema.sections = [
        ...schema.sections.filter((b) => b.kind !== "chart"),
        trend,
        breakdown,
      ];
    }
    if (version.reportId === "R007") {
      const comparison = version.sections.find((b) => b.kind === "comparison")!;
      if (!("rows" in comparison)) throw new Error("Missing benchmark table");
      const spec: ChartSpec = {
        id: "benchmark-grouped",
        type: "grouped-bar",
        title: "Đối chiếu chỉ số hai snapshot",
        dimension: {
          label: "Chỉ số (các nhóm không cộng gộp)",
          kind: "categorical",
        },
        labels: comparison.rows.map((r) => String(r[0])),
        series: [1, 2].map((col) => ({
          id: String(col),
          label: comparison.columns[col],
          unit: "căn",
          values: comparison.rows.map((r) => Number(r[col])),
        })),
        sourceId: "source-inventory",
      };
      const grouped = chartBlock(spec, version.evidenceIds, "full");
      const delta: SchemaBlock = {
        id: "benchmark-delta",
        title: "Chênh lệch với baseline hợp lệ",
        kind: "comparison",
        columns: ["Chỉ số", "Chênh lệch (căn)", "Thay đổi (%)"],
        rows: comparison.rows.map((r) => [
          String(r[0]),
          Number(r[1]) - Number(r[2]),
          Number(r[2]) === 0
            ? null
            : ((Number(r[1]) - Number(r[2])) / Number(r[2])) * 100,
        ]),
        unit: "căn / %",
        evidenceIds: version.evidenceIds,
      };
      schema.dashboard = [...schema.dashboard, grouped, delta];
      schema.sections = [...schema.sections, grouped, delta];
      const projects = chartBlock(
        {
          id: "benchmark-projects",
          type: "grouped-bar",
          title: "So sánh tồn khả dụng giữa dự án",
          semantic: "comparison",
          dimension: { label: "Dự án", kind: "categorical" },
          labels: ["Riverside", "Green Park", "Long Garden"],
          series: [
            {
              id: "current",
              label: "Snapshot hiện tại",
              unit: "căn",
              values: [60, 40, 20],
            },
            {
              id: "previous",
              label: "Snapshot trước",
              unit: "căn",
              values: [66, 44, 22],
            },
          ],
          sourceId: "source-inventory",
        },
        version.evidenceIds,
        "full",
      );
      schema.dashboard = [...schema.dashboard, projects];
      schema.sections = [...schema.sections, projects];
      data.records = data.records.map((r) =>
        r.id === version.reportId
          ? {
              ...r,
              projectIds: ["P-A", "P-B", "P-C"],
              marketIds: ["HCM", "BD", "LA"],
            }
          : r,
      );
      data.evidence = data.evidence.map((e) =>
        version.evidenceIds.includes(e.id)
          ? {
              ...e,
              projectIds: ["P-A", "P-B", "P-C"],
              label: "Nguồn demo ba dự án · source-inventory",
            }
          : e,
      );
    }
    version.schema = schema;
  }
  const record = {
    ...data.records[0],
    id: "R019",
    code: "VDA-DEMO-CUSTOM",
    title: "Phân khúc khách hàng · Custom skill",
    type: "customer-segmentation",
    versionIds: ["R019-v1", "R019-v2"],
    latestAttemptId: null,
    agent: "Custom segmentation skill",
  };
  data.records = [...data.records, record];
  for (const sequence of [1, 2]) {
    const id = `R019-v${sequence}`;
    const evidenceId = `${id}-evidence`;
    const counts = sequence === 1 ? [20, 30, 10] : [24, 36, 12];
    const base = data.versions[0];
    const evidence = {
      ...data.evidence[0],
      id: evidenceId,
      label: `Nguồn phân khúc mô phỏng v${sequence}`,
      sourceId: "source-segmentation",
      snapshotId: `segments-v${sequence}`,
    };
    const composition: ChartSpec = {
      id: "segments",
      type: "donut",
      title: "Cơ cấu phân khúc",
      semantic: "composition",
      dimension: { label: "Phân khúc", kind: "categorical" },
      labels: ["Khám phá", "Cân nhắc", "Sẵn sàng"],
      series: [
        {
          id: "customers",
          label: "Khách hàng",
          unit: "khách hàng",
          values: counts,
        },
      ],
      sourceId: evidence.sourceId,
    };
    const metrics: SchemaBlock = {
      id: "segment-kpis",
      title: "Quy mô mẫu mô phỏng",
      kind: "metric-grid",
      evidenceIds: [evidenceId],
      metrics: [
        {
          id: "total",
          label: "Khách hàng trong mẫu",
          value: counts.reduce((a, b) => a + b, 0),
          unit: "khách hàng",
        },
        {
          id: "missing",
          label: "Thu nhập chưa cung cấp",
          value: null,
          unit: "VND",
        },
      ],
    };
    const finding: SchemaBlock = {
      id: "segment-finding",
      kind: "finding",
      title: "Phân khúc lớn nhất",
      text: `Nhóm Cân nhắc có ${counts[1]} khách hàng trong mẫu v${sequence}; chưa đủ bằng chứng để suy ra hành vi thị trường.`,
      evidenceIds: [evidenceId],
    };
    const table: SchemaBlock = {
      id: "segment-table",
      kind: "data-table",
      title: "Số khách hàng theo phân khúc",
      columns: ["Phân khúc", "Khách hàng"],
      rows: composition.labels.map((l, i) => [l, counts[i]]),
      unit: "khách hàng",
      evidenceIds: [evidenceId],
    };
    const charts: SchemaBlock[] = [
      chartBlock(composition, [evidenceId]),
      chartBlock({
        ...composition,
        id: "segments-pie",
        type: "pie",
        title: "Tỷ trọng mẫu · Pie",
      }),
      chartBlock({
        ...composition,
        id: "segments-area",
        type: "area",
        semantic: "trend",
        title: "Tích lũy mẫu theo ngày quan sát",
        dimension: { label: "Ngày quan sát", kind: "temporal" },
        labels: ["2026-10-01", "2026-10-08", "2026-10-15"],
        series: [
          {
            id: "cumulative",
            label: "Mẫu tích lũy",
            unit: "khách hàng",
            values: [
              counts[0],
              counts[0] * 2,
              counts.reduce((a, b) => a + b, 0),
            ],
          },
        ],
      }),
      chartBlock({
        ...composition,
        id: "segments-stack",
        type: "stacked-bar",
        semantic: "composition",
        title: "Phân khúc theo nguồn tiếp cận",
        series: [
          {
            id: "direct",
            label: "Trực tiếp",
            unit: "khách hàng",
            values: counts.map((v) => v / 2),
          },
          {
            id: "referral",
            label: "Giới thiệu",
            unit: "khách hàng",
            values: counts.map((v) => v / 2),
          },
        ],
      }),
      chartBlock({
        id: "segment-scatter",
        type: "scatter",
        title: "Điểm quan tâm và số lần xem (mô phỏng)",
        dimension: { label: "Lần xem", kind: "numeric", unit: "lần" },
        labels: [1, 2, 4, 6, 8],
        series: [
          {
            id: "score",
            label: "Điểm quan tâm",
            unit: "điểm",
            values: [2, 4, null, 7, 8],
          },
        ],
        sourceId: evidence.sourceId,
      }),
      chartBlock({
        id: "segment-heatmap",
        type: "heatmap",
        semantic: "matrix",
        title: "Mức quan tâm theo kênh",
        dimension: { label: "Kênh", kind: "categorical" },
        labels: ["Web", "Tư vấn", "Sự kiện"],
        series: [
          { id: "new", label: "Khám phá", unit: "điểm", values: [3, 2, null] },
          { id: "ready", label: "Sẵn sàng", unit: "điểm", values: [5, 8, 6] },
        ],
        sourceId: evidence.sourceId,
      }),
      chartBlock({
        id: "segment-histogram",
        type: "histogram",
        semantic: "distribution",
        title: "Phân phối số lượt xem",
        dimension: {
          label: "Lượt xem [đầu, cuối)",
          kind: "numeric",
          unit: "lượt",
        },
        labels: [0, 3, 6],
        binEnds: [3, 6, 10],
        series: [
          {
            id: "frequency",
            label: "Tần số",
            unit: "khách hàng",
            values: counts,
          },
        ],
        sourceId: evidence.sourceId,
      }),
    ];
    const text: SchemaBlock = {
      id: "segment-method",
      kind: "text",
      title: "Phương pháp và giới hạn",
      markdown:
        "**DEMO** · Phân nhóm cấu hình cố định.\n\n- Không chạy mô hình hoặc agent thật.\n- Giá trị thiếu giữ nguyên; không xem là 0.\n\nKhông dùng mẫu này để dự báo.",
      evidenceIds: [],
    };
    const evidenceBlock: SchemaBlock = {
      id: "segment-evidence",
      kind: "evidence",
      title: "Bằng chứng bản lưu",
      references: [evidenceId],
      evidenceIds: [],
    };
    const version: ReportVersion = {
      ...base,
      id,
      reportId: record.id,
      sequence,
      contentRevision: `custom-${sequence}`,
      policyVersion: "demo-segmentation-v1",
      sections: [],
      evidenceIds: [evidenceId],
      artifactIds: [`${id}-html`],
    };
    version.schema = {
      schemaVersion: 1,
      reportId: record.id,
      versionId: id,
      reportTypeId: record.type,
      title: record.title,
      description: "Custom skill · schema-driven · DEMO",
      domain: "customer-research",
      skill: {
        id: "custom-segmentation",
        name: "Custom segmentation",
        revision: "1",
      },
      scope: { ...demoScope },
      summary: `Bản lưu ${id}: ${counts.reduce((a, b) => a + b, 0)} khách hàng mô phỏng.`,
      limitations: ["Mẫu tổng hợp mô phỏng; không chứa dữ liệu cá nhân thật."],
      dashboard: [metrics, ...charts, finding, table],
      sections: [
        text,
        metrics,
        {
          id: "visual-analysis",
          kind: "section",
          title: "Phân tích trực quan",
          evidenceIds: [],
          blocks: charts,
        },
        finding,
        table,
        evidenceBlock,
      ],
      diagnostics: [],
    };
    if (scenario === "report-unknown-chart")
      version.schema.dashboard = [
        chartBlock({ ...composition, type: "future-chart" }),
      ];
    if (scenario === "report-invalid-chart")
      version.schema.dashboard = [
        chartBlock({
          ...composition,
          type: "pie",
          series: [{ ...composition.series[0], values: [-1, 2, null] }],
        }),
      ];
    if (scenario === "report-unknown-type")
      version.schema.reportTypeId = record.type = "future-custom-skill";
    if (scenario === "report-empty-schema") {
      version.schema.dashboard = [];
      version.schema.sections = [];
    }
    if (scenario === "report-large-table") {
      const appendix: SchemaBlock = {
        ...table,
        title: "Phụ lục kiểm tra phân trang · dữ liệu độc lập",
        columns: ["Mẫu kiểm thử", "Điểm kiểm thử"],
        unit: "điểm mô phỏng",
        rows: Array.from({ length: 1200 }, (_, i) => [`Mẫu ${i + 1}`, i % 50]),
      };
      version.schema.dashboard = [appendix];
      version.schema.sections = [text, appendix, evidenceBlock];
    }
    data.versions = [...data.versions, version];
    data.evidence = [...data.evidence, evidence];
  }
  // Artifacts use the same selected schema, escaped text and tables, never executable report content.
  data.artifacts = [
    ...data.artifacts.filter(
      (a) =>
        preservedSchemas.has(a.versionId) ||
        !data.versions.find((v) => v.id === a.versionId)?.schema,
    ),
    ...data.versions
      .filter((v) => v.schema && !preservedSchemas.has(v.id))
      .map((v) => ({
        id: v.artifactIds[0],
        versionId: v.id,
        filename: `DEMO-${v.id}.html`,
        mediaType: "text/html" as const,
        content: schemaHtml(v),
      })),
  ];
  data.versions = data.versions.map((v) =>
    v.schema && !preservedSchemas.has(v.id)
      ? { ...v, artifactIds: [v.artifactIds[0]] }
      : v,
  );
  if (scenario === "report-unknown-schema") {
    data.versions = data.versions.map((v) =>
      v.reportId === "R019"
        ? {
            ...v,
            schema: {
              ...v.schema!,
              schemaVersion: 99,
            } as unknown as ReportSchema,
          }
        : v,
    );
  }
  return data;
}
const escape = (v: unknown) =>
  String(v ?? "—").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
function schemaHtml(v: ReportVersion): string {
  function table(
    columns: readonly string[],
    rows: readonly (readonly unknown[])[],
  ): string {
    return `<table><thead><tr>${columns.map((c) => `<th scope="col">${escape(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${escape(c)}</th>` : `<td>${escape(c)}</td>`)).join("")}</tr>`).join("")}</tbody></table>`;
  }
  function render(blocks: readonly SchemaBlock[]): string {
    return blocks
      .map((b) => {
        let body = "";
        if (b.kind === "section") body = render(b.blocks);
        else if (b.kind === "text") body = `<p>${escape(b.markdown)}</p>`;
        else if (b.kind === "metric-grid")
          body = table(
            ["Metric", "Value", "Unit"],
            b.metrics.map((m) => [m.label, m.value, m.unit]),
          );
        else if (b.kind === "chart")
          body = table(
            [
              b.chart.dimension.label,
              ...(b.chart.binEnds ? ["Bin end"] : []),
              ...b.chart.series.map((s) => `${s.label} (${s.unit})`),
            ],
            b.chart.labels.map((l, i) => [
              l,
              ...(b.chart.binEnds ? [b.chart.binEnds[i]] : []),
              ...b.chart.series.map((s) => s.values[i]),
            ]),
          );
        else if ("rows" in b) body = table(b.columns, b.rows);
        else if ("text" in b) body = `<p>${escape(b.text)}</p>`;
        else if (b.kind === "evidence")
          body = b.references.map(escape).join(", ");
        return `<section><h2>${escape(b.title)}</h2>${body}</section>`;
      })
      .join("");
  }
  return `<!doctype html><html lang="vi"><meta charset="utf-8"><title>DEMO ${escape(v.id)}</title><body><h1>${escape(v.schema!.title)}</h1><p>DEMO · ${escape(v.id)} · ${escape(v.completedAt)}</p>${render(v.schema!.sections)}<p>${v.evidenceIds.map(escape).join(", ")}</p></body></html>`;
}
