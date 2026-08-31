import { describe, expect, it } from "vitest";

import { __test__ } from "./pdf-report";
import { DRIFT_PART_TITLE } from "./drift-evidence";

describe("profiling PDF document model", () => {
  it("derives a contiguous hierarchy and document-only cover/back cover", () => {
    const source = {
      profile: {
        dataset: { name: "Báo cáo tiếng Việt" },
        run: { id: "run-1", row_count: 42, narrative_report: "Tóm tắt dữ liệu" },
        column_stats: [{ column_name: "doanh_thu", dtype: "number", null_pct: 0.1, cardinality: 42 }],
        drift_reports: [],
      },
      report_snapshot: { items: [{ id: "chart-1", title: "Doanh thu theo tháng", item_type: "chart", content_json: { result: { data: [{ label: "T1", value: 10 }] } } }] },
    };
    const sections = __test__.buildSections(source);
    __test__.numberSections(sections);
    const document = __test__.bodyHtml(source, sections);
    const toc = __test__.tocHtml(sections);

    expect(sections.map((section) => section.number)).toEqual([undefined, "1", "2", "3", undefined, "4"]);
    expect(sections[5].children?.map((section) => section.number)).toEqual(["4.1"]);
    expect(toc).toContain("Mục lục");
    expect(document).toContain("1. Tổng quan Dataset");
    expect(document).toContain("<svg");
    expect(document).toContain("T1");
    expect(__test__.coverHtml(source)).toContain("DATA PROFILING REPORT");
    expect(__test__.backCoverHtml(source)).toContain("KẾT THÚC BÁO CÁO");
  });
  it("includes detailed drift evidence in the final report", () => {
    const source = {
      profile: {
        dataset: { name: "sales" },
        run: { id: "run-1", row_count: 10 },
        column_stats: [],
        drift_reports: [{
          profile_run_id_a: "run-a",
          profile_run_id_b: "run-b",
          summary: "Revenue shifted",
          drift_columns: [{
            column_name: "revenue",
            drift_type: "numeric_shift",
            severity: "major",
            metric: "mean",
            psi: 0.12345,
            baseline_value: "10.1234",
            current_value: 20.98765,
            detail: "Mean increased",
          }, {
            column_name: "revenue",
            drift_type: "null_rate_shift",
            severity: "minor",
            metric: "null_pct",
            baseline_value: null,
            current_value: 0.1,
            detail: "Missing values increased",
          }],
        }],
      },
      report_snapshot: { items: [] },
    };
    const sections = __test__.buildSections(source);
    const document = __test__.bodyHtml(source, sections);

    expect(sections.map((section) => section.title)).toContain(DRIFT_PART_TITLE);
    expect(document).toContain("revenue");
    expect(document).toContain("Mean increased");
    expect(document).toContain("Baseline");
    expect(document).toContain("Current");
    expect(document).toContain("Revenue shifted");
    expect(document.match(/PSI 0,123/g)?.length).toBe(2);
    expect(document).toContain("Tỷ lệ thiếu");
    expect(document).toContain("10.1234");
    expect(document).toContain("20,988");
    expect(document).toContain("2 signal từ backend");
    expect(document).toContain("—");
  });
  it("keeps an empty drift report consistent with the preview", () => {
    const source = {
      profile: {
        dataset: { name: "sales" },
        run: { id: "run-1", row_count: 10 },
        column_stats: [],
        drift_reports: [{ profile_run_id_a: "run-a", profile_run_id_b: "run-b", summary: "No material drift", drift_columns: [] }],
      },
      report_snapshot: { items: [] },
    };
    const sections = __test__.buildSections(source);
    const document = __test__.bodyHtml(source, sections);

    expect(document).toContain(DRIFT_PART_TITLE);
    expect(document).toContain("0 signal");
    expect(document).not.toContain("<th>Cột</th>");
  });
  it("uses the preview chart renderer without appending a second values table", () => {
    const source = {
      profile: { dataset: { name: "sales" }, run: { id: "run-1", row_count: 2 }, column_stats: [], drift_reports: [] },
      report_snapshot: { items: [{
        id: "chart-1",
        title: "Revenue trend",
        item_type: "chart",
        query_spec: { analysis_kind: "aggregate", aggregate: "sum", dimensions: ["month"], filters: [], limit: 15, x_column: "month", y_column: "value" },
        content_json: {
          chart_spec: { chart_type: "line", renderer: "native-svg", aggregation: "sum", x_column: "month", y_column: "value" },
          result: { data: [{ month: "Jan", value: 10 }, { month: "Feb", value: 14 }], columns: ["month", "value"], row_count: 2 },
        },
      }] },
    };
    const sections = __test__.buildSections(source);
    const document = __test__.bodyHtml(source, sections);

    expect(document).toContain("chart-line-wrap");
    expect(document).toContain("chart-line-svg");
    expect(document).not.toContain('class="table-wrap chart-result-table"');
  });
});
