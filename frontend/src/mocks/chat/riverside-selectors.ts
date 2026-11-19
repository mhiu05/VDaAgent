import fixture from "../reports/data/riverside-r010-v2/report.json";
import { mapRiversideReport } from "../reports/riverside-adapter";
import type { SchemaBlock } from "../../features/reports/model/report-schema";

const format = (n: number) =>
  new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(n);
const schema = mapRiversideReport();
const flatten = (blocks: readonly SchemaBlock[]): SchemaBlock[] =>
  blocks.flatMap((b) =>
    b.kind === "section" ? [b, ...flatten(b.blocks)] : [b],
  );
const blocks = flatten(schema.sections);
const base = (id: string, title: string) => ({ id, title, evidenceIds: [] });

/** Read-only projections of the same source and schema used by the Reports repository. */
export function selectRiverside() {
  const current = fixture.snapshots.current;
  const previous = fixture.snapshots.previous;
  const age: SchemaBlock = {
    ...base("age-buckets", "Phân bố tuổi tồn"),
    kind: "data-table",
    unit: "căn; % trên tổng tồn và % trên tập đủ tuổi",
    columns: [
      "Nhóm tuổi",
      "Số căn",
      `% / ${current.available} căn`,
      `% / ${current.valid_age} căn đủ tuổi`,
    ],
    rows: fixture.age_buckets.map((b) => [
      b.label,
      b.count,
      b.share_available_pct,
      b.share_valid_pct,
    ]),
  };
  const comparison = blocks.find((b) => b.id === "snapshot-comparison")!;
  const metrics = schema.dashboard.find((b) => b.kind === "metric-grid")!;
  const findings: SchemaBlock[] = fixture.findings.map((f) => ({
    ...base(f.id, `${f.id} · ${f.title}`),
    kind: "finding",
    text: f.description,
    description: f.note,
  }));
  const actions: SchemaBlock[] = fixture.actions.map((a) => ({
    ...base(a.id, `${a.priority} · ${a.title}`),
    kind: "recommendation",
    text: `${a.owner} · ${a.due}. Kết quả mong đợi: ${a.definition_of_done}.`,
    description: "Đề xuất · chưa phê duyệt hoặc giao việc",
  }));
  const methodology = `**Tỷ lệ tồn lâu:** ${current.aged_180_plus}/${current.valid_age} = ${format(fixture.derived_metrics.aged_rate_valid_pct)}%; mốc trước ${previous.aged_180_plus}/${previous.valid_age} = ${format(fixture.derived_metrics.aged_rate_previous_valid_pct)}%. Chênh lệch **+${format(fixture.derived_metrics.aged_rate_change_pp)} điểm phần trăm**.\n\n**Độ đầy đủ:** ${current.valid_age}/${current.available} = ${format(fixture.derived_metrics.known_age_coverage_pct)}%. ${current.unknown_age} căn chưa rõ tuổi vẫn thuộc tổng tồn, không được gán tuổi bằng 0. Tỷ trọng tồn lâu trên *toàn bộ* ${current.available} căn là ${format(fixture.derived_metrics.aged_rate_total_pct)}%, khác với tỷ lệ trên tập đủ tuổi.\n\nHai snapshot không phải cùng một tập căn cố định. Không có ngày chốt mốc trước, dữ liệu giá, CRM hoặc giao dịch để kết luận nguyên nhân.`;
  return structuredClone({
    reference: { reportId: schema.reportId, versionId: schema.versionId },
    asOf: fixture.report.as_of,
    project: fixture.report.project,
    metrics,
    age,
    comparison,
    findings,
    actions,
    methodology,
    qualitySummary: `Có **${current.available} căn khả dụng**: **${current.valid_age} căn đủ tuổi** và **${current.unknown_age} căn chưa rõ tuổi**. Mẫu số tỷ lệ tồn lâu là ${current.valid_age}, còn độ đầy đủ tính trên ${current.available} căn.`,
    changes: `Tồn khả dụng ${previous.available} → ${current.available} (${format(fixture.derived_metrics.available_change_pct)}%); tồn từ 180 ngày ${previous.aged_180_plus} → ${current.aged_180_plus} (+${format(fixture.derived_metrics.aged_count_change_pct)}%). Tỷ lệ tồn lâu ${format(fixture.derived_metrics.aged_rate_previous_valid_pct)}% → ${format(fixture.derived_metrics.aged_rate_valid_pct)}%, **+${format(fixture.derived_metrics.aged_rate_change_pp)} điểm phần trăm**.`,
    charts: fixture.charts.map((chart) => ({
      block: blocks.find((b) => b.kind === "chart" && b.chart.id === chart.id)!,
      quickRead: chart.quick_read,
      subtitle: chart.subtitle,
    })),
  });
}

export function bindRiversideText(
  body: string,
  bindings: Record<string, string> = {},
) {
  return body.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const path = bindings[key];
    if (!path) throw new Error(`Missing Riverside text binding: ${key}`);
    let value: unknown = fixture;
    for (const part of path.split("."))
      value =
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[part]
          : undefined;
    if (typeof value !== "number" && typeof value !== "string")
      throw new Error(`Invalid Riverside binding: ${path}`);
    return typeof value === "number" ? format(value) : value;
  });
}
