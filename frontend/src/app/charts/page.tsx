"use client";

import Link from "next/link";
import { useState } from "react";

import { ProfileRunPicker } from "@/components/profile-run-picker";
import { Notice, PageHeader } from "@/components/ui";

export default function ChartsPage() {
  const [runId, setRunId] = useState("");

  return <>
    <PageHeader
      eyebrow="PROFILE → AGENT → ANALYSIS → CHART → INSIGHT → REPORT"
      title="Biểu đồ"
      description="Chọn một phiên profiling đã hoàn tất để mở workspace tạo nhiều biểu đồ từ Preview/Official evidence."
    />

    <div className="grid two charts-entry-grid">
      <section className="panel charts-entry-picker">
        <div className="panel-title">
          <div><h2>Chọn dữ liệu phân tích</h2><small>Chỉ Profile Run đã hoàn tất mới được sử dụng</small></div>
          <span className="chip">Bounded analysis</span>
        </div>
        <ProfileRunPicker
          id="chart-profile-run"
          label="Dataset và phiên profiling"
          value={runId}
          onChange={setRunId}
          helpText="Biểu đồ luôn gắn với đúng phiên dữ liệu, context version và evidence hash."
        />
        <div className="form-actions">
          {runId
            ? <Link className="button primary" href={`/profiles/${encodeURIComponent(runId)}?tab=charts`}>Mở workspace Biểu đồ →</Link>
            : <button className="button primary" type="button" disabled>Chọn Profile Run để tiếp tục</button>}
        </div>
      </section>

      <section className="panel charts-entry-guide">
        <h2>Quy trình tạo biểu đồ</h2>
        <ol className="charts-entry-flow">
          <li><b>Agent hiểu Profile</b><span>Xác định grain, dimension, measure và giới hạn.</span></li>
          <li><b>Chọn bài toán và thuật toán</b><span>So sánh, xu hướng, phân phối hoặc mối quan hệ.</span></li>
          <li><b>Kiểm tra Preview → Official</b><span>Chỉ kết quả Official được dùng làm evidence báo cáo.</span></li>
          <li><b>Vẽ chart và review insight</b><span>Hỗ trợ line, bar, KPI, table, histogram, scatter, box, heatmap và forecast có prediction interval.</span></li>
          <li><b>Ghim vào Report Draft</b><span>Xuất PDF với biểu đồ trực tiếp và bảng số liệu đối chiếu.</span></li>
        </ol>
      </section>
    </div>

    <Notice tone="info">
      <b>Dữ liệu được bảo vệ trong toàn bộ quy trình.</b>
      <p>Renderer chỉ nhận aggregate result; raw rows và giá trị PII không được đưa vào chart hoặc prompt insight.</p>
    </Notice>
  </>;
}
