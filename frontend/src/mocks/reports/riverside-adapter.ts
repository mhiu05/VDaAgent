import fixture from "./data/riverside-r010-v2/report.json";
import narrative from "./data/riverside-r010-v2/report.md?raw";
import type {
  ReportDataset,
  ReportVersion,
} from "../../features/reports/model/types";
import type {
  SchemaBlock,
  ReportSchema,
} from "../../features/reports/model/report-schema";
import type { ChartSpec } from "../../shared/charts/chart-contract";
import { renderSchemaArtifact } from "./render-schema-artifact";

const format = (value: number) =>
  value.toLocaleString("vi-VN", { maximumFractionDigits: 1 });
const metricUnit = (k: (typeof fixture.kpis)[number]) =>
  k.display_value && !k.unit.startsWith("%") ? `% · ${k.unit}` : k.unit;
const base = (id: string, title: string) => ({ id, title, evidenceIds: [] });
type TableBlock = Extract<SchemaBlock, { kind: "data-table" | "comparison" }>;

/** Boundary from supplied Report Agent output into the existing saved report schema. */
export function mapRiversideReport(
  data = fixture,
  markdown = narrative,
): ReportSchema {
  const { current, previous } = data.snapshots;
  const charts: ChartSpec[] = data.charts.map((chart) => ({
    id: chart.id,
    title: chart.title,
    description: `${chart.subtitle}. ${chart.quick_read}`,
    type: chart.kind === "bar-horizontal" ? "bar" : "grouped-bar",
    dimension: {
      label: chart.kind === "bar-horizontal" ? "Nhóm tuổi tồn" : "Chỉ tiêu",
      kind: "categorical",
    },
    labels: chart.series.map((s) => s.label),
    series:
      chart.kind === "bar-horizontal"
        ? [
            {
              id: "current",
              label: chart.title,
              unit: chart.unit,
              values: chart.series.map((s) => ("value" in s ? s.value : null)),
            },
          ]
        : [
            {
              id: "previous",
              label: "Mốc trước",
              unit: chart.unit,
              values: chart.series.map((s) =>
                "previous" in s ? s.previous : null,
              ),
            },
            {
              id: "current",
              label: "Hiện tại",
              unit: chart.unit,
              values: chart.series.map((s) =>
                "current" in s ? s.current : null,
              ),
            },
          ],
    semantic: "comparison",
    sourceId: `Tổng hợp tồn kho · ${data.report.project}`,
    evidenceIds: [],
  }));
  const chartBlock = (index: number): SchemaBlock => ({
    ...base(charts[index].id, charts[index].title),
    kind: "chart",
    chart: charts[index],
  });
  const actions: SchemaBlock = {
    ...base("actions", "Đề xuất kế hoạch hành động"),
    kind: "section",
    description:
      "Đơn vị phụ trách và thời hạn là đề xuất; chưa tạo hoặc giao công việc.",
    blocks: data.actions.map((a) => ({
      ...base(a.id, `${a.priority} · ${a.title}`),
      kind: "recommendation",
      text: `${a.owner} · ${a.due}. Kết quả mong đợi: ${a.definition_of_done}.`,
    })),
  };
  const tables: Record<string, TableBlock> = {
    "01": {
      ...base("executive-metrics", "Chỉ số điều hành chính"),
      kind: "comparison",
      columns: ["Chỉ số", "Hiện tại", "Mốc trước", "Biến động"],
      unit: "căn, % và điểm phần trăm",
      rows: data.kpis.map((k) => [
        k.label,
        k.display_value ?? `${format(k.value)} ${k.unit}`,
        `${format(k.comparison.value)} ${k.display_value ? "%" : k.unit}`,
        k.comparison.delta_display,
      ]),
    },
    "03": {
      ...base("age-buckets", "Phân bố theo nhóm tuổi"),
      kind: "data-table",
      columns: ["Nhóm tuổi tồn", "Số căn", "Tỷ trọng trên tổng tồn (%)"],
      unit: "căn và % trên tổng tồn",
      rows: [
        ...data.age_buckets.map((b) => [
          b.label,
          b.count,
          b.share_available_pct,
        ]),
        ["Tổng cộng", current.available, 100],
      ],
    },
    "04": {
      ...base("snapshot-comparison", "So sánh với mốc trước"),
      kind: "comparison",
      columns: ["Chỉ tiêu", "Mốc trước", "Hiện tại", "Thay đổi"],
      unit: "căn; riêng tỷ lệ dùng % và điểm phần trăm",
      rows: [
        [
          "Tồn khả dụng",
          previous.available,
          current.available,
          data.kpis[0].comparison.delta_display,
        ],
        [
          "Căn đủ tuổi tồn",
          previous.valid_age,
          current.valid_age,
          `${current.valid_age - previous.valid_age} căn`,
        ],
        [
          "Căn ≥180 ngày",
          previous.aged_180_plus,
          current.aged_180_plus,
          data.kpis[1].comparison.delta_display,
        ],
        [
          "Căn chưa rõ tuổi",
          previous.unknown_age,
          current.unknown_age,
          `+${current.unknown_age - previous.unknown_age} căn`,
        ],
        [
          "Tỷ lệ ≥180 ngày / đủ tuổi",
          `${format(data.derived_metrics.aged_rate_previous_valid_pct)}%`,
          `${format(data.derived_metrics.aged_rate_valid_pct)}%`,
          data.kpis[2].comparison.delta_display,
        ],
      ],
    },
    "06": {
      ...base("action-plan", "Kế hoạch đề xuất"),
      kind: "data-table",
      columns: [
        "Ưu tiên",
        "Hạng mục",
        "Đơn vị phụ trách đề xuất",
        "Thời hạn gợi ý",
        "Kết quả mong đợi",
      ],
      unit: "kế hoạch đề xuất, chưa giao việc",
      rows: data.actions.map((a) => [
        a.priority,
        a.title,
        a.owner,
        a.due,
        a.definition_of_done,
      ]),
    },
  };
  const matches = [
    ...markdown.matchAll(
      /^## (0[1-8])\. (.+)\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm,
    ),
  ];
  if (matches.length !== 8)
    throw new Error(
      "Riverside source must contain exactly eight business sections.",
    );
  const sections: SchemaBlock[] = matches.map((match, index) => {
    const [, number, name] = match;
    const title = `${number}. ${name}`;
    // Keep all business prose; replace source figures/tables with canonical JSON blocks.
    const body = match[3].split(/\r?\n---\s*\r?\n/)[0].trim();
    const tokens = body.split(/(!\[[^\]]*\]\([^)]+\)|(?:^\|.*\r?\n?)+)/m);
    const blocks: SchemaBlock[] = [];
    for (const token of tokens) {
      const text = token
        .trim()
        .replace(/^### Chỉ số điều hành chính\s*$/m, "")
        .trim();
      if (!text) continue;
      if (text.startsWith("![")) blocks.push(chartBlock(index === 2 ? 0 : 1));
      else if (text.startsWith("|")) {
        if (!tables[number])
          throw new Error(`Unmapped canonical table in section ${number}`);
        blocks.push(tables[number]);
      } else
        blocks.push({
          ...base(`prose-${blocks.length}`, title),
          kind: "text",
          markdown: text,
        });
    }
    return { ...base(`section-${number}`, title), kind: "section", blocks };
  });
  return {
    schemaVersion: 1,
    reportId: "R010",
    versionId: data.report.version_id,
    reportTypeId: "inventory",
    title: data.report.title,
    language: data.report.language,
    limitations: [],
    diagnostics: [],
    sections,
    dashboard: [
      {
        ...base("executive-summary", data.hero.headline),
        kind: "text",
        markdown: `${data.hero.description}\n\n**Đề xuất:** ${data.hero.decision}`,
      },
      {
        ...base("kpis", "Chỉ số điều hành"),
        kind: "metric-grid",
        metrics: data.kpis.map((k) => ({
          id: k.id,
          label: k.label,
          value: k.value,
          unit: metricUnit(k),
          comparison: `${k.comparison.delta_display} · ${k.comparison.note}`,
          definition: k.denominator
            ? `${current.aged_180_plus}/${k.denominator} căn có tuổi hợp lệ; không tính trên tổng ${current.available} căn.`
            : k.id === "age_quality"
              ? `${current.valid_age}/${current.available} căn có ngày mở bán hợp lệ.`
              : `${format(k.comparison.value)} ${k.unit} ở mốc trước. ${data.hero.disclaimer}`,
        })),
      },
      chartBlock(0),
      {
        ...base("findings", "Phát hiện trọng yếu"),
        kind: "section",
        blocks: data.findings.map((f) => ({
          ...base(f.id, f.title),
          kind: "finding",
          text: f.description,
        })),
      },
      {
        ...base("snapshot-analysis", "Diễn biến qua hai mốc"),
        kind: "section",
        blocks: [chartBlock(1)],
      },
      actions,
    ],
  };
}

/** Update the one existing record; historical versions and other reports stay untouched. */
export function withRiversideReport(seed: ReportDataset): ReportDataset {
  const schema = mapRiversideReport();
  const record = seed.records.find((r) => r.id === schema.reportId);
  const historical = seed.versions.find((v) => v.reportId === schema.reportId);
  if (!record || !historical)
    throw new Error(
      "Riverside fixture requires its existing report and history.",
    );
  if (seed.versions.some((v) => v.id === schema.versionId)) return seed;
  record.title = schema.title;
  record.agent = fixture.report.author.display_name;
  record.versionIds = [...record.versionIds, schema.versionId];
  const version: ReportVersion = {
    ...historical,
    id: schema.versionId,
    sequence: fixture.report.version,
    completedAt: fixture.report.as_of,
    source: {
      ...historical.source,
      label: "Dữ liệu mô phỏng",
      dataThrough: fixture.report.as_of,
      updatedAt: fixture.report.as_of,
      completeness: "partial",
    },
    contentRevision: fixture.schema_version,
    schema,
    sections: [],
    evidenceIds: [],
    artifactIds: [`${schema.versionId}-html`, `${schema.versionId}-csv`],
  };
  seed.versions = [...seed.versions, version];
  // Preserve the existing saved-attempt history. This fixture does not claim a new agent run.
  const csv = [
    [schema.title, schema.versionId, "Dữ liệu mô phỏng (DEMO)"],
    ["Chỉ số", "Hiện tại", "Mốc trước", "Biến động", "Đơn vị"],
    ...fixture.kpis.map((k) => [
      k.label,
      k.value,
      k.comparison.value,
      k.comparison.delta_display,
      metricUnit(k),
    ]),
    [],
    ["Chỉ tiêu snapshot", "Mốc trước", "Hiện tại"],
    [
      "Căn khả dụng",
      fixture.snapshots.previous.available,
      fixture.snapshots.current.available,
    ],
    [
      "Căn có tuổi hợp lệ",
      fixture.snapshots.previous.valid_age,
      fixture.snapshots.current.valid_age,
    ],
    [
      "Căn từ 180 ngày",
      fixture.snapshots.previous.aged_180_plus,
      fixture.snapshots.current.aged_180_plus,
    ],
    [
      "Căn chưa rõ tuổi",
      fixture.snapshots.previous.unknown_age,
      fixture.snapshots.current.unknown_age,
    ],
    [],
    ["Nhóm tuổi tồn", "Số căn", "Tỷ trọng trên tổng tồn (%)"],
    ...fixture.age_buckets.map((b) => [
      b.label,
      b.count,
      b.share_available_pct,
    ]),
    [],
    [
      "Ưu tiên",
      "Đề xuất",
      "Đơn vị dự kiến",
      "Thời hạn gợi ý",
      "Kết quả mong đợi",
    ],
    ...fixture.actions.map((a) => [
      a.priority,
      a.title,
      a.owner,
      a.due,
      a.definition_of_done,
    ]),
  ]
    .map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
    )
    .join("\r\n");
  seed.artifacts = [
    ...seed.artifacts,
    {
      id: version.artifactIds[0],
      versionId: version.id,
      filename: `${version.id}.html`,
      mediaType: "text/html",
      content: renderSchemaArtifact(schema, fixture.report.as_of),
    },
    {
      id: version.artifactIds[1],
      versionId: version.id,
      filename: `${version.id}.csv`,
      mediaType: "text/csv",
      content: `\uFEFF${csv}\r\n`,
    },
  ];
  return seed;
}
