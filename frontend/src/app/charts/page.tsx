"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { ProfileRunPicker } from "@/components/profile-run-picker";
import { ChartsTab } from "@/components/command-center/charts-tab";
import { getProfile } from "@/lib/api";
import { LoadingBlock, Notice, PageHeader } from "@/components/ui";

export default function ChartsPage() {
  const router = useRouter();
  const [runId, setRunId] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      return localStorage.getItem("p170_selected_chart_run_id") || "";
    } catch {
      return "";
    }
  });

  useEffect(() => {
    if (typeof window === "undefined" || !runId) return;
    try {
      localStorage.setItem("p170_selected_chart_run_id", runId);
    } catch {}
  }, [runId]);

  const profile = useQuery({
    queryKey: ["profile", runId],
    queryFn: ({ signal }) => getProfile(runId, signal),
    enabled: Boolean(runId),
  });

  return <>
    <PageHeader
      eyebrow="AI ANALYTICS WORKSPACE · PHÂN TÍCH TRỰC QUAN"
      title="Biểu đồ & Phân tích"
      description="Không gian tạo biểu đồ tự động bằng AI, phân tích trọn gói và ghim kết quả vào báo cáo."
    />

    <section className="panel chart-dataset-selector" style={{ marginBottom: "1rem" }}>
      <div className="panel-title">
        <div><h2>Chọn bộ dữ liệu cần phân tích</h2><small>Chỉ phiên profiling đã hoàn tất mới được sử dụng</small></div>
        <span className="chip">Bounded analysis</span>
      </div>
      <ProfileRunPicker
        id="chart-profile-run"
        label="Dataset và phiên profiling"
        value={runId}
        onChange={setRunId}
        helpText="Biểu đồ luôn gắn với đúng phiên dữ liệu, context version và evidence hash."
      />
    </section>

    {runId ? (
      profile.isLoading ? (
        <LoadingBlock label="Đang tải dữ liệu phiên profiling…" />
      ) : profile.data ? (
        <ChartsTab
          runId={runId}
          profile={profile.data}
          onExplain={() => router.push(`/profiles/${runId}?tab=agent`)}
        />
      ) : (
        <Notice tone="warning">Không tìm thấy thông tin phiên profiling này.</Notice>
      )
    ) : (
      <div className="grid two charts-entry-grid">
        <section className="panel charts-entry-guide">
          <h2>Quy trình tạo biểu đồ</h2>
          <ol className="charts-entry-flow">
            <li><b>Chọn Dataset & Phiên profiling</b><span>Lấy toàn bộ grain, dimension, measure đã được kiểm định.</span></li>
            <li><b>Nhập câu hỏi hoặc tạo trọn gói</b><span>AI Agent tự động phân tích câu hỏi kinh doanh và chọn biểu đồ tối ưu.</span></li>
            <li><b>Kiểm tra Preview → Official</b><span>Chỉ kết quả Official được dùng làm evidence báo cáo.</span></li>
            <li><b>Xem biểu đồ đa dạng</b><span>Donut, Heatmap 2D, Histogram, Boxplot, Outlier, Line, Bar.</span></li>
            <li><b>Ghim vào Báo cáo</b><span>Lưu trữ biểu đồ và insight trực tiếp vào Report Draft.</span></li>
          </ol>
        </section>

        <Notice tone="info">
          <b>Dữ liệu được bảo vệ an toàn trong toàn bộ quy trình.</b>
          <p>Renderer chỉ nhận aggregate result; raw rows và giá trị PII không bao giờ được đưa vào prompt hoặc biểu đồ.</p>
        </Notice>
      </div>
    )}
  </>;
}
