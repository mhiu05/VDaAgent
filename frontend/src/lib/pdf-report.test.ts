import { describe, expect, it } from "vitest";

import { __test__ } from "./pdf-report";

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
    expect(__test__.coverHtml(source)).toContain("DATA PROFILING REPORT");
    expect(__test__.backCoverHtml(source)).toContain("KẾT THÚC BÁO CÁO");
  });
});
