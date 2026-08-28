import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { generateProfilingPdf } from "./pdf-report";

const enabled = Boolean(process.env.PDF_CHROMIUM_EXECUTABLE_PATH);

describe("profiling PDF visual fixture", () => {
  (enabled ? it : it.skip)("renders a representative Vietnamese report", async () => {
    const pdf = await generateProfilingPdf({
      profile: {
        dataset: { name: "Dữ liệu doanh thu 2026" },
        run: {
          id: "visual-run-001",
          status: "completed",
          row_count: 124_560,
          scan_mode: "full",
          created_at: "2026-08-23T04:00:00.000Z",
          narrative_report: "# Nhận định chính\n- Tỷ lệ thiếu dữ liệu thấp.\n- Doanh thu cần được theo dõi theo khu vực.",
          risk_warnings: ["Cột email đã được che PII trong báo cáo xuất."],
        },
        column_stats: [
          { column_name: "doanh_thu", dtype: "float64", null_pct: 0.018, cardinality: 122_100, uniqueness_ratio: 0.98 },
          { column_name: "khu_vuc", dtype: "object", null_pct: 0.004, cardinality: 12, uniqueness_ratio: 0.0001, top_values: [{ value: "Miền Nam", count: 51_420 }, { value: "Miền Bắc", count: 43_500 }] },
          { column_name: "email", dtype: "object", null_pct: 0.09, cardinality: 110_300, uniqueness_ratio: 0.89, pii_masked: true },
        ],
        correlation_matrix: { doanh_thu: { doanh_thu: 1, chi_phi: 0.73 }, chi_phi: { doanh_thu: 0.73, chi_phi: 1 } },
        drift_reports: [{
          profile_run_id_a: "run-2025",
          profile_run_id_b: "visual-run-001",
          summary: "Tăng tỷ trọng giao dịch khu vực miền Nam.",
          drift_columns: [
            { column_name: "doanh_thu", drift_type: "numeric_shift", severity: "major", psi: 0.1234, baseline_value: 52000, current_value: 58000, detail: "Giá trị trung bình tăng so với baseline." },
            { column_name: "khu_vuc", drift_type: "null_rate_shift", severity: "minor", metric: "null_pct", baseline_value: 0.01, current_value: 0.018, detail: "Tỷ lệ thiếu tăng nhẹ." },
          ],
        }],
      },
      report_snapshot: {
        title: "Báo cáo chất lượng dữ liệu doanh thu",
        items: [{
          id: "chart-1",
          item_type: "chart",
          title: "Doanh thu theo khu vực",
          note: "Chỉ dùng số liệu tổng hợp đã được phê duyệt.",
          content_json: {
            result: { columns: ["khu_vuc", "doanh_thu"], data: [{ label: "Miền Nam", value: 51420 }, { label: "Miền Bắc", value: 43500 }, { label: "Miền Trung", value: 29640 }] },
            insight: "Khu vực miền Nam đóng góp tỷ trọng lớn nhất trong kỳ phân tích.",
          },
        }],
      },
    });
    const outputDir = path.resolve(process.cwd(), "..", "output", "pdf");
    await mkdir(outputDir, { recursive: true });
    const output = path.join(outputDir, "data-profiling-report-visual-check.pdf");
    await writeFile(output, pdf);
    expect(pdf.subarray(0, 4)).toEqual(new Uint8Array([37, 80, 68, 70]));
  }, 60_000);
});
