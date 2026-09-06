"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorNotice, LoadingBlock, Notice, PageHeader } from "@/components/ui";
import { getWorkspaceConfiguration, updateWorkspaceConfiguration } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";

type SettingsSection = "general" | "context" | "theme" | "engine" | "security";

const SECTIONS = [
  { id: "context" as const, label: "Ngữ cảnh AI & Nghiệp vụ", icon: "🌐", desc: "Định hướng AI hiểu đúng lĩnh vực & mục tiêu" },
  { id: "theme" as const, label: "Giao diện & Thương hiệu", icon: "🎨", desc: "Bảng màu, chủ đề hiển thị và xuất PDF" },
  { id: "engine" as const, label: "Engine & Tính toán", icon: "📊", desc: "Chế độ quét, mức ý nghĩa và thuật toán" },
  { id: "security" as const, label: "Bảo mật & Quyền riêng tư", icon: "🔒", desc: "Chính sách PII & quy trình duyệt HITL" },
  { id: "general" as const, label: "Thông tin Workspace", icon: "🏢", desc: "Tên không gian làm việc & thành viên" },
];

const COLOR_PRESETS = [
  { name: "Oceanic Cyan (Chuẩn)", primary: "#0ea5e9", secondary: "#10b981" },
  { name: "Royal Indigo", primary: "#6366f1", secondary: "#ec4899" },
  { name: "Cyber Emerald", primary: "#10b981", secondary: "#3b82f6" },
  { name: "Deep Navy", primary: "#1e3a8a", secondary: "#06b6d4" },
  { name: "Amber Sunset", primary: "#f59e0b", secondary: "#ef4444" },
];

export default function SettingsPage() {
  const { workspaceId } = useAuth();
  const client = useQueryClient();
  const configuration = useQuery({
    queryKey: ["workspace-configuration"],
    queryFn: getWorkspaceConfiguration,
  });

  const [activeSection, setActiveSection] = useState<SettingsSection>("context");

  // Context & Theme State
  const [domain, setDomain] = useState("");
  const [goal, setGoal] = useState("");
  const [audience, setAudience] = useState("");
  const [primary, setPrimary] = useState("#0ea5e9");
  const [secondary, setSecondary] = useState("#10b981");
  const [tone, setTone] = useState<"concise" | "professional" | "friendly">("professional");
  const [language, setLanguage] = useState<"vi" | "en">("vi");

  // Engine & Preferences
  const [scanMode, setScanMode] = useState<"full" | "sample">("full");
  const [defaultAlpha, setDefaultAlpha] = useState("0.05");
  const [maskPiiByDefault, setMaskPiiByDefault] = useState(true);
  const [requireHitlReview, setRequireHitlReview] = useState(true);
  const [autoExportPdfCharts, setAutoExportPdfCharts] = useState(true);

  // Load preferences from backend & localStorage
  useEffect(() => {
    if (configuration.data) {
      const { context, theme } = configuration.data;
      setDomain(context?.domain || "");
      setGoal(context?.primary_goal || "");
      setAudience(context?.target_audience || "");
      setPrimary(theme?.primary_color || "#0ea5e9");
      setSecondary(theme?.secondary_color || "#10b981");
      setTone(theme?.tone || "professional");
      setLanguage(theme?.default_language || "vi");
    }

    try {
      const savedEngine = localStorage.getItem("p170_workspace_engine_settings");
      if (savedEngine) {
        const parsed = JSON.parse(savedEngine);
        if (parsed.scanMode) setScanMode(parsed.scanMode);
        if (parsed.defaultAlpha) setDefaultAlpha(parsed.defaultAlpha);
        if (typeof parsed.maskPiiByDefault === "boolean") setMaskPiiByDefault(parsed.maskPiiByDefault);
        if (typeof parsed.requireHitlReview === "boolean") setRequireHitlReview(parsed.requireHitlReview);
        if (typeof parsed.autoExportPdfCharts === "boolean") setAutoExportPdfCharts(parsed.autoExportPdfCharts);
      }
    } catch {
      // ignore
    }
  }, [configuration.data]);

  const updateMutation = useMutation({
    mutationFn: () =>
      updateWorkspaceConfiguration({
        context: { domain, primary_goal: goal, target_audience: audience },
        theme: { primary_color: primary, secondary_color: secondary, tone, default_language: language },
        expected_context_version: configuration.data?.context?.version,
        expected_theme_version: configuration.data?.theme?.version,
      }),
    onSuccess: (next) => {
      client.setQueryData(["workspace-configuration"], next);
      try {
        localStorage.setItem(
          "p170_workspace_engine_settings",
          JSON.stringify({
            scanMode,
            defaultAlpha,
            maskPiiByDefault,
            requireHitlReview,
            autoExportPdfCharts,
          })
        );
      } catch {
        // ignore
      }
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    updateMutation.mutate();
  };

  if (configuration.isLoading) return <LoadingBlock label="Đang tải cấu hình workspace…" />;
  if (configuration.isError) return <ErrorNotice error={configuration.error} retry={() => configuration.refetch()} />;

  const contextVersion = configuration.data?.context?.version ?? 1;
  const themeVersion = configuration.data?.theme?.version ?? 1;

  return (
    <main className="page workspace-settings" style={{ maxWidth: "1280px", margin: "0 auto" }}>
      <PageHeader
        title="Cài đặt Workspace"
        description="Trung tâm điều khiển cấu hình toàn diện: Ngữ cảnh AI Agent, bảng màu giao diện, engine tính toán và chính sách bảo mật."
      />

      {updateMutation.isError && <ErrorNotice error={updateMutation.error} retry={() => updateMutation.reset()} />}
      {updateMutation.isSuccess && (
        <div style={{ marginTop: "1rem" }}>
          <Notice tone="success">
            <b>Đã lưu cấu hình thành công!</b> Tất cả thay đổi đã được áp dụng cho toàn bộ Workspace.
          </Notice>
        </div>
      )}

      {/* 2-COLUMN ENTERPRISE LAYOUT */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "280px minmax(0, 1fr)",
          gap: "2rem",
          marginTop: "1.5rem",
          alignItems: "start",
        }}
      >
        {/* LEFT NAV MENU */}
        <aside
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            background: "var(--card-bg, #ffffff)",
            padding: "12px",
            borderRadius: "14px",
            border: "1px solid var(--border)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
          }}
        >
          <div style={{ padding: "8px 12px 6px", fontSize: "0.75rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Danh mục cài đặt
          </div>

          {SECTIONS.map((sec) => {
            const active = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => setActiveSection(sec.id)}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "12px",
                  padding: "12px 14px",
                  borderRadius: "10px",
                  border: active ? "1px solid #38bdf8" : "1px solid transparent",
                  background: active ? "linear-gradient(135deg, rgba(2, 132, 199, 0.12) 0%, rgba(14, 165, 233, 0.05) 100%)" : "transparent",
                  color: active ? "#0284c7" : "var(--foreground)",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "all 0.15s ease",
                  width: "100%",
                }}
              >
                <span style={{ fontSize: "1.2rem", lineHeight: 1 }}>{sec.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ display: "block", fontSize: "0.9rem", fontWeight: active ? 700 : 600 }}>
                    {sec.label}
                  </b>
                  <small style={{ display: "block", fontSize: "0.72rem", color: active ? "#0369a1" : "#64748b", marginTop: "2px" }}>
                    {sec.desc}
                  </small>
                </div>
              </button>
            );
          })}
        </aside>

        {/* RIGHT CONTENT FORM */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* SECTION: CONTEXT */}
          {activeSection === "context" && (
            <div
              style={{
                background: "var(--card-bg, #ffffff)",
                border: "1px solid var(--border)",
                borderRadius: "16px",
                padding: "1.5rem",
                boxShadow: "0 2px 10px rgba(0,0,0,0.04)",
                display: "flex",
                flexDirection: "column",
                gap: "1.5rem",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid var(--border)", paddingBottom: "1rem" }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>🌐 Ngữ cảnh AI & Nghiệp vụ (AI Context)</h2>
                  <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.85rem" }}>
                    Định hình cách AI Agent hiểu dữ liệu, diễn giải các chỉ số và đưa ra khuyến nghị chuẩn ngành.
                  </p>
                </div>
                <span className="chip" style={{ fontSize: "0.75rem", background: "rgba(56, 189, 248, 0.15)", color: "#0284c7" }}>
                  Context v{contextVersion}
                </span>
              </div>

              {/* FIELD: DOMAIN */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "0.9rem", fontWeight: 600 }}>
                  Lĩnh vực hoạt động (Domain)
                </label>
                <input
                  type="text"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  maxLength={120}
                  placeholder="Ví dụ: Tài chính & Ngân hàng, Bán lẻ & E-commerce, Y tế, Logistics..."
                  list="domain-options"
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background: "var(--background)",
                    color: "var(--foreground)",
                    fontSize: "0.92rem",
                  }}
                />
                <datalist id="domain-options">
                  <option value="Thương mại điện tử & Bán lẻ (E-commerce / Retail)" />
                  <option value="Tài chính, Ngân hàng & Fintech (Banking & Finance)" />
                  <option value="Y tế & Dược phẩm (Healthcare & Pharma)" />
                  <option value="Giáo dục & Công nghệ giáo dục (EdTech)" />
                  <option value="Logistics, Giao vận & Chuỗi cung ứng" />
                  <option value="Công nghệ & Phần mềm (SaaS / IT)" />
                  <option value="Sản xuất & Vận hành công nghiệp" />
                </datalist>
                <small className="muted" style={{ fontSize: "0.78rem" }}>
                  AI sẽ tự động kích hoạt bộ từ điển và quy chuẩn đo lường của lĩnh vực này khi phân tích cột.
                </small>
              </div>

              {/* FIELD: PRIMARY GOAL */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "0.9rem", fontWeight: 600 }}>
                  Mục tiêu phân tích chính (Primary Goal)
                </label>
                <textarea
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="Ví dụ: Rà soát tính toàn vẹn dữ liệu, tối ưu tỷ lệ giữ chân khách hàng (Retention), phát hiện bất thường doanh thu..."
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background: "var(--background)",
                    color: "var(--foreground)",
                    fontSize: "0.92rem",
                    resize: "vertical",
                  }}
                />
              </div>

              {/* GRID: AUDIENCE & TONE */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.2rem" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "0.9rem", fontWeight: 600 }}>
                    Đối tượng đọc báo cáo (Target Audience)
                  </label>
                  <input
                    type="text"
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                    maxLength={120}
                    placeholder="Ví dụ: Ban Giám Đốc, Trưởng phòng kinh doanh..."
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: "8px",
                      border: "1px solid var(--border)",
                      background: "var(--background)",
                      color: "var(--foreground)",
                      fontSize: "0.92rem",
                    }}
                  />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "0.9rem", fontWeight: 600 }}>
                    Giọng văn diễn giải (Tone of Voice)
                  </label>
                  <select
                    value={tone}
                    onChange={(e) => setTone(e.target.value as typeof tone)}
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: "8px",
                      border: "1px solid var(--border)",
                      background: "var(--background)",
                      color: "var(--foreground)",
                      fontSize: "0.92rem",
                    }}
                  >
                    <option value="professional">Chuyên nghiệp & Chuẩn mực (Khuyến nghị)</option>
                    <option value="concise">Ngắn gọn & Tập trung số liệu</option>
                    <option value="friendly">Thân thiện & Dễ hiểu</option>
                  </select>
                </div>
              </div>

              {/* FIELD: LANGUAGE */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "0.9rem", fontWeight: 600 }}>
                  Ngôn ngữ báo cáo mặc định
                </label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as typeof language)}
                  style={{
                    width: "260px",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background: "var(--background)",
                    color: "var(--foreground)",
                    fontSize: "0.92rem",
                  }}
                >
                  <option value="vi">🇻🇳 Tiếng Việt (Mặc định)</option>
                  <option value="en">🇺🇸 English (Quốc tế)</option>
                </select>
              </div>
            </div>
          )}

          {/* SECTION: THEME */}
          {activeSection === "theme" && (
            <div
              style={{
                background: "var(--card-bg, #ffffff)",
                border: "1px solid var(--border)",
                borderRadius: "16px",
                padding: "1.5rem",
                boxShadow: "0 2px 10px rgba(0,0,0,0.04)",
                display: "flex",
                flexDirection: "column",
                gap: "1.5rem",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid var(--border)", paddingBottom: "1rem" }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>🎨 Giao diện & Chủ đề (Theme Styling)</h2>
                  <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.85rem" }}>
                    Tùy biến bảng màu thương hiệu doanh nghiệp khi xuất file PDF và bảng điều khiển biểu đồ.
                  </p>
                </div>
                <span className="chip" style={{ fontSize: "0.75rem", background: "rgba(56, 189, 248, 0.15)", color: "#0284c7" }}>
                  Theme v{themeVersion}
                </span>
              </div>

              {/* PALETTES */}
              <div>
                <label style={{ display: "block", fontSize: "0.9rem", fontWeight: 600, marginBottom: "8px" }}>
                  Bảng màu mẫu chuẩn (Palette Presets):
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "10px" }}>
                  {COLOR_PRESETS.map((preset) => {
                    const isSelected = primary === preset.primary && secondary === preset.secondary;
                    return (
                      <button
                        key={preset.name}
                        type="button"
                        onClick={() => {
                          setPrimary(preset.primary);
                          setSecondary(preset.secondary);
                        }}
                        style={{
                          padding: "10px 14px",
                          borderRadius: "10px",
                          border: isSelected ? "2px solid #0284c7" : "1px solid var(--border)",
                          background: isSelected ? "rgba(2, 132, 199, 0.08)" : "var(--background)",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <div style={{ display: "flex", gap: "3px" }}>
                          <span style={{ width: "16px", height: "16px", borderRadius: "50%", background: preset.primary }} />
                          <span style={{ width: "16px", height: "16px", borderRadius: "50%", background: preset.secondary }} />
                        </div>
                        <span style={{ fontSize: "0.85rem", fontWeight: isSelected ? 700 : 500, color: isSelected ? "#0284c7" : "var(--foreground)" }}>
                          {preset.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* COLOR PICKERS */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.2rem" }}>
                <div
                  style={{
                    padding: "1.2rem",
                    borderRadius: "12px",
                    border: "1px solid var(--border)",
                    background: "rgba(56, 189, 248, 0.05)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div>
                    <b style={{ display: "block", fontSize: "0.95rem" }}>Màu thương hiệu chính (Primary)</b>
                    <small className="muted" style={{ fontSize: "0.78rem" }}>Tiêu đề, nút chính, cột biểu đồ</small>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input
                      type="color"
                      value={primary}
                      onChange={(e) => setPrimary(e.target.value)}
                      style={{ width: "42px", height: "42px", borderRadius: "8px", border: "none", cursor: "pointer" }}
                    />
                    <code style={{ fontSize: "0.85rem" }}>{primary}</code>
                  </div>
                </div>

                <div
                  style={{
                    padding: "1.2rem",
                    borderRadius: "12px",
                    border: "1px solid var(--border)",
                    background: "rgba(16, 185, 129, 0.05)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div>
                    <b style={{ display: "block", fontSize: "0.95rem" }}>Màu phụ trợ (Secondary)</b>
                    <small className="muted" style={{ fontSize: "0.78rem" }}>Đường xu hướng, trạng thái đạt chuẩn</small>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input
                      type="color"
                      value={secondary}
                      onChange={(e) => setSecondary(e.target.value)}
                      style={{ width: "42px", height: "42px", borderRadius: "8px", border: "none", cursor: "pointer" }}
                    />
                    <code style={{ fontSize: "0.85rem" }}>{secondary}</code>
                  </div>
                </div>
              </div>

              {/* LIVE PREVIEW BOX */}
              <div
                style={{
                  padding: "1.25rem",
                  borderRadius: "14px",
                  border: `1.5px solid ${primary}`,
                  background: "var(--card-bg, rgba(255,255,255,0.02))",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                }}
              >
                <span style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", color: primary, letterSpacing: "0.05em" }}>
                  Xem trước trực quan bản báo cáo
                </span>
                <h3 style={{ margin: 0, color: primary, fontSize: "1.1rem" }}>
                  Báo cáo Phân tích Dữ liệu Toàn diện
                </h3>
                <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
                  Dữ liệu được trích xuất và đối chiếu qua công cụ DuckDB deterministic compute engine.
                </p>
                <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
                  <span style={{ background: primary, color: "#fff", padding: "6px 14px", borderRadius: "6px", fontSize: "0.8rem", fontWeight: 600 }}>
                    Nút hành động
                  </span>
                  <span style={{ background: secondary, color: "#fff", padding: "6px 14px", borderRadius: "6px", fontSize: "0.8rem", fontWeight: 600 }}>
                    Chỉ số chất lượng cao
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* SECTION: ENGINE */}
          {activeSection === "engine" && (
            <div
              style={{
                background: "var(--card-bg, #ffffff)",
                border: "1px solid var(--border)",
                borderRadius: "16px",
                padding: "1.5rem",
                boxShadow: "0 2px 10px rgba(0,0,0,0.04)",
                display: "flex",
                flexDirection: "column",
                gap: "1.5rem",
              }}
            >
              <div style={{ borderBottom: "1px solid var(--border)", paddingBottom: "1rem" }}>
                <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>📊 Engine Tính toán & Thống kê (Compute Engine)</h2>
                <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.85rem" }}>
                  Thiết lập chế độ chạy deterministic compute trên DuckDB, Scipy và Pandas.
                </p>
              </div>

              {/* SCAN MODE */}
              <div style={{ padding: "1.2rem", borderRadius: "12px", border: "1px solid var(--border)" }}>
                <b style={{ display: "block", fontSize: "0.95rem", marginBottom: "8px" }}>
                  Chế độ quét dữ liệu mặc định (Default Scan Mode)
                </b>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                  <label
                    style={{
                      padding: "12px 14px",
                      borderRadius: "10px",
                      border: scanMode === "full" ? "2px solid #0284c7" : "1px solid var(--border)",
                      background: scanMode === "full" ? "rgba(2, 132, 199, 0.06)" : "transparent",
                      cursor: "pointer",
                      display: "flex",
                      gap: "10px",
                    }}
                  >
                    <input
                      type="radio"
                      name="scanMode"
                      value="full"
                      checked={scanMode === "full"}
                      onChange={() => setScanMode("full")}
                    />
                    <div>
                      <b style={{ fontSize: "0.9rem", display: "block" }}>Full Scan (100% dữ liệu)</b>
                      <small className="muted" style={{ fontSize: "0.78rem" }}>Độ chính xác tuyệt đối, dùng cho báo cáo chính thức.</small>
                    </div>
                  </label>

                  <label
                    style={{
                      padding: "12px 14px",
                      borderRadius: "10px",
                      border: scanMode === "sample" ? "2px solid #0284c7" : "1px solid var(--border)",
                      background: scanMode === "sample" ? "rgba(2, 132, 199, 0.06)" : "transparent",
                      cursor: "pointer",
                      display: "flex",
                      gap: "10px",
                    }}
                  >
                    <input
                      type="radio"
                      name="scanMode"
                      value="sample"
                      checked={scanMode === "sample"}
                      onChange={() => setScanMode("sample")}
                    />
                    <div>
                      <b style={{ fontSize: "0.9rem", display: "block" }}>Sampling (Lấy mẫu nhanh)</b>
                      <small className="muted" style={{ fontSize: "0.78rem" }}>Tối ưu thời gian cho tập dữ liệu nhiều triệu dòng.</small>
                    </div>
                  </label>
                </div>
              </div>

              {/* ALPHA LEVEL */}
              <div style={{ padding: "1.2rem", borderRadius: "12px", border: "1px solid var(--border)" }}>
                <b style={{ display: "block", fontSize: "0.95rem", marginBottom: "4px" }}>
                  Mức ý nghĩa thống kê (Significance Level α)
                </b>
                <p className="muted" style={{ fontSize: "0.8rem", margin: "0 0 10px" }}>
                  Ngưỡng p-value dùng cho các kiểm định phân phối, ANOVA, Chi-square và phát hiện Data Drift.
                </p>
                <select
                  value={defaultAlpha}
                  onChange={(e) => setDefaultAlpha(e.target.value)}
                  style={{
                    width: "280px",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background: "var(--background)",
                    color: "var(--foreground)",
                    fontSize: "0.9rem",
                  }}
                >
                  <option value="0.05">α = 0.05 (Độ tin cậy 95% - Chuẩn khoa học)</option>
                  <option value="0.01">α = 0.01 (Độ tin cậy 99% - Nghiêm ngặt)</option>
                  <option value="0.10">α = 0.10 (Độ tin cậy 90% - Thăm dò nhanh)</option>
                </select>
              </div>

              {/* AUTO EXPORT CHARTS */}
              <div style={{ padding: "1.2rem", borderRadius: "12px", border: "1px solid var(--border)" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={autoExportPdfCharts}
                    onChange={(e) => setAutoExportPdfCharts(e.target.checked)}
                    style={{ width: "20px", height: "20px" }}
                  />
                  <div>
                    <b style={{ fontSize: "0.92rem", display: "block" }}>
                      Tự động đính kèm đầy đủ Biểu đồ & Diễn giải của AI vào Báo cáo PDF
                    </b>
                    <small className="muted" style={{ fontSize: "0.78rem" }}>
                      Đảm bảo file PDF xuất bản có Mục lục tự động, biểu đồ ghim và diễn giải agent đầy đủ.
                    </small>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* SECTION: SECURITY */}
          {activeSection === "security" && (
            <div
              style={{
                background: "var(--card-bg, #ffffff)",
                border: "1px solid var(--border)",
                borderRadius: "16px",
                padding: "1.5rem",
                boxShadow: "0 2px 10px rgba(0,0,0,0.04)",
                display: "flex",
                flexDirection: "column",
                gap: "1.5rem",
              }}
            >
              <div style={{ borderBottom: "1px solid var(--border)", paddingBottom: "1rem" }}>
                <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>🔒 Bảo mật & Quyền riêng tư (Security & PII Policy)</h2>
                <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.85rem" }}>
                  Kiểm soát an toàn dữ liệu, chống rò rỉ PII và quy trình xác thực Human-in-the-loop.
                </p>
              </div>

              {/* PII MASKING */}
              <div style={{ padding: "1.2rem", borderRadius: "12px", border: "1px solid var(--border)" }}>
                <label style={{ display: "flex", alignItems: "flex-start", gap: "12px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={maskPiiByDefault}
                    onChange={(e) => setMaskPiiByDefault(e.target.checked)}
                    style={{ width: "20px", height: "20px", marginTop: "2px" }}
                  />
                  <div>
                    <b style={{ fontSize: "0.92rem", display: "block" }}>
                      Tự động che chắn (Mask) dữ liệu định danh PII trước khi gửi đến AI
                    </b>
                    <small className="muted" style={{ fontSize: "0.8rem", display: "block", marginTop: "2px" }}>
                      Các trường Email, Số điện thoại, Số CCCD, Địa chỉ sẽ được mã hóa/ẩn để tuân thủ quy chuẩn bảo vệ dữ liệu cá nhân.
                    </small>
                  </div>
                </label>
              </div>

              {/* HITL REVIEW */}
              <div style={{ padding: "1.2rem", borderRadius: "12px", border: "1px solid var(--border)" }}>
                <label style={{ display: "flex", alignItems: "flex-start", gap: "12px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={requireHitlReview}
                    onChange={(e) => setRequireHitlReview(e.target.checked)}
                    style={{ width: "20px", height: "20px", marginTop: "2px" }}
                  />
                  <div>
                    <b style={{ fontSize: "0.92rem", display: "block" }}>
                      Bắt buộc Human-in-the-loop (Analyst phê duyệt) trước khi ghi đè Metadata
                    </b>
                    <small className="muted" style={{ fontSize: "0.8rem", display: "block", marginTop: "2px" }}>
                      Agent chỉ đề xuất candidate key hoặc kiểu dữ liệu; chuyên viên bắt buộc phải xác nhận thì pipeline mới cập nhật.
                    </small>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* SECTION: GENERAL */}
          {activeSection === "general" && (
            <div
              style={{
                background: "var(--card-bg, #ffffff)",
                border: "1px solid var(--border)",
                borderRadius: "16px",
                padding: "1.5rem",
                boxShadow: "0 2px 10px rgba(0,0,0,0.04)",
                display: "flex",
                flexDirection: "column",
                gap: "1.5rem",
              }}
            >
              <div style={{ borderBottom: "1px solid var(--border)", paddingBottom: "1rem" }}>
                <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>🏢 Thông tin Workspace & Thành viên</h2>
                <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.85rem" }}>
                  Quản lý không gian làm việc hiện tại và quyền truy cập dữ liệu của các thành viên.
                </p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 14px", borderRadius: "10px", border: "1px solid var(--border)" }}>
                  <span className="muted">Workspace ID:</span>
                  <code>{workspaceId || "default-workspace"}</code>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 14px", borderRadius: "10px", border: "1px solid var(--border)" }}>
                  <span className="muted">Vai trò của bạn:</span>
                  <b>Workspace Administrator / Lead Analyst</b>
                </div>
              </div>
            </div>
          )}

          {/* SAVE BUTTON BAR */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "1.2rem 1.5rem",
              background: "var(--card-bg, #ffffff)",
              border: "1px solid var(--border)",
              borderRadius: "14px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
            }}
          >
            <span className="muted" style={{ fontSize: "0.85rem" }}>
              Phiên bản cấu hình sẽ tự động tăng sau mỗi lần lưu.
            </span>

            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="button primary"
              style={{
                padding: "11px 26px",
                fontSize: "0.96rem",
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                boxShadow: "0 4px 14px rgba(14, 165, 233, 0.35)",
              }}
            >
              💾 {updateMutation.isPending ? "Đang lưu cấu hình…" : "Lưu thay đổi Cài đặt"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
