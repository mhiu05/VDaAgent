"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { ProfileRunPicker } from "@/components/profile-run-picker";
import { ChartsTab } from "@/components/command-center/charts-tab";
import { ensureExplorerSession, getProfile, getProfileReportDraft, listForecastAlgorithms } from "@/lib/api";
import { LoadingBlock, Notice, PageHeader } from "@/components/ui";

export default function ChartsPage() {
  const router = useRouter();
  const [runId, setRunId] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      return new URLSearchParams(window.location.search).get("runId")
        || localStorage.getItem("p170_selected_chart_run_id")
        || "";
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
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: (previousData) => previousData,
  });

  // Start the two chart-specific requests as soon as a run is known. ChartsTab
  // observes these exact keys, so it reuses the in-flight request (or cache)
  // instead of starting its work only after the profile request finishes.
  useQuery({
    queryKey: ["command-center", runId, "explorer-session"],
    queryFn: () => ensureExplorerSession(runId),
    enabled: Boolean(runId),
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
    placeholderData: (previousData) => previousData,
  });
  useQuery({
    queryKey: ["command-center", runId, "forecast-algorithms"],
    queryFn: () => listForecastAlgorithms(runId),
    enabled: Boolean(runId),
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
    placeholderData: (previousData) => previousData,
  });

  const reportDraft = useQuery({
    queryKey: ["report-draft", runId],
    queryFn: () => getProfileReportDraft(runId),
    enabled: Boolean(runId),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: (previousData) => previousData,
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
          onExplain={() => router.push("/chat")}
        />
      ) : (
        <Notice tone="warning">Không tìm thấy thông tin phiên profiling này.</Notice>
      )
    ) : (
      <div className="grid two charts-entry-grid">
        <section className="panel charts-entry-guide">
          <h2>Quy trình tạo biểu đồ</h2>
          <ol className="charts-entry-flow">
            <li><b>Chọn bộ dữ liệu & phiên lập hồ sơ</b><span>Lấy toàn bộ cấp độ, chiều dữ liệu và chỉ số đã được kiểm định.</span></li>
            <li><b>Nhập câu hỏi hoặc tạo trọn gói</b><span>Trợ lý AI tự động phân tích câu hỏi kinh doanh và chọn biểu đồ tối ưu.</span></li>
            <li><b>Kiểm tra bản xem trước → chính thức</b><span>Chỉ kết quả chính thức được dùng làm bằng chứng báo cáo.</span></li>
            <li><b>Xem biểu đồ đa dạng</b><span>Donut, Heatmap 2D, Histogram, Boxplot, Outlier, Line, Bar.</span></li>
            <li><b>Ghim vào báo cáo</b><span>Lưu trữ biểu đồ và nhận định trực tiếp vào bản nháp báo cáo.</span></li>
          </ol>
        </section>

        <Notice tone="info">
          <b>Dữ liệu được bảo vệ an toàn trong toàn bộ quy trình.</b>
          <p>Renderer chỉ nhận aggregate result; raw rows và giá trị PII không bao giờ được đưa vào prompt hoặc biểu đồ.</p>
        </Notice>
      </div>
    )}

    {/* BƯỚC TIẾP THEO MỞ RỘNG (Navigation Links) */}
    <section className="panel" style={{ marginTop: "1.5rem", padding: "1.5rem", background: "linear-gradient(135deg, rgba(248, 250, 252, 1) 0%, rgba(241, 245, 249, 1) 100%)", border: "1px solid #e2e8f0", display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
      <div>
        <p className="eyebrow" style={{ color: "#475569" }}>Lựa chọn tiếp theo</p>
        <h2 style={{ margin: "0.25rem 0 0 0", color: "#1e293b", fontSize: "1.25rem" }}>Đã phân tích xong?</h2>
        <p className="muted" style={{ margin: "0.25rem 0 0 0" }}>Bạn có thể so sánh sự thay đổi dữ liệu hoặc xem lại tất cả báo cáo hoàn chỉnh.</p>
      </div>
      <div style={{ display: "flex", gap: "10px" }}>
        <Link href="/compare" className="button secondary" style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
          ⚖️ So sánh dữ liệu
        </Link>
        <Link href={runId && reportDraft.data?.id ? `/reports/${reportDraft.data.id}` : "/reports"} className="button primary" style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
          📖 {runId && reportDraft.data?.id ? "Xem báo cáo phiên này →" : "Xem tất cả báo cáo →"}
        </Link>
      </div>
    </section>
  </>;
}
