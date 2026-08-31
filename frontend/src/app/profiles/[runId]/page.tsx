"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getProfile } from "@/lib/api";
import { profileQueryKey } from "@/lib/profile-query-keys";
import { formatNumber, formatPercent, toTitle } from "@/lib/format";
import { MarkdownContent } from "@/components/markdown";
import { EmptyState, ErrorNotice, InfoTip, LoadingBlock, Metric, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { CommandCenterShell } from "@/components/command-center/command-center-shell";
import { useAuth } from "@/components/auth-provider";
import { TopValues, Distribution, MetricChart, CorrelationPanel } from "@/components/report-components";



function provenanceScanCopy(scanMode?: string | null, approximate?: boolean) {
  if (scanMode === "sample" || approximate) return {
    label: "Lấy mẫu (Sampling)",
    detail: "Thống kê được tính trên mẫu dữ liệu; phù hợp để kiểm tra nhanh.",
  };
  if (scanMode === "full") return {
    label: "Quét toàn bộ (Full scan)",
    detail: "Thống kê được tính trên toàn bộ dữ liệu đã nạp.",
  };
  return { label: "Chưa xác định", detail: "Chưa ghi nhận cách quét dữ liệu." };
}

function ProfileOverview() {
  const { runId } = useParams<{ runId: string }>();
  const { workspaceId } = useAuth();
  const profile = useQuery({
    queryKey: profileQueryKey(workspaceId, runId), queryFn: ({ signal }) => getProfile(runId, signal), enabled: Boolean(runId && workspaceId),
  });
  if (profile.isLoading) return <LoadingBlock label="Đang tải báo cáo profile…" />;
  if (profile.isError) return <ErrorNotice error={profile.error} retry={() => profile.refetch()} />;
  if (!profile.data) return <EmptyState title="Không có dữ liệu profile" detail="Phiên chạy profile (profile run) không tồn tại hoặc API chưa trả dữ liệu." />;
  const data = profile.data;
  const columns = Object.values(data.column_stats);
  const pii = data.proposals.pii?.filter((proposal) => proposal.status !== "rejected") ?? [];
  const hasReview = data.pending_proposals > 0;
  const scanCopy = provenanceScanCopy(data.scan_mode, data.is_approximate);
  const reviewComplete = data.pending_proposals === 0;
  const runComplete = data.status === "completed";
  const tocItems = [
    { id: "summary_metrics", title: "Số liệu tổng quan" },
    { id: "risk_provenance", title: "Rủi ro & Nguồn" },
    ...(data.narrative_report ? [{ id: "narrative_report", title: "Tóm tắt agent" }] : []),
    { id: "column_profiles", title: "Hồ sơ cột" },
    { id: "metric_charts", title: "Biểu đồ cột" },
    { id: "distribution_correlation", title: "Phân phối & Tương quan" },
  ];

  return <>
    {process.env.NEXT_PUBLIC_UX_COMMAND_CENTER_ENABLED !== "true" && <div style={{ marginBottom: "1rem" }}>
      <Link href={`/datasets/${encodeURIComponent(data.dataset_id)}/runs`} className="button secondary">Quay lại</Link>
    </div>}
    <PageHeader eyebrow={`Phiên chạy (Profile run) · ${data.run_name || `Phiên bản v${data.version ?? "—"}`}`} title={data.dataset_name || "Báo cáo profile"} description="Các số liệu được lấy trực tiếp từ engine xử lý. Các đề xuất (proposal) được giữ riêng để chuyên viên phân tích review." />
    {data.error && <Notice tone="warning"><b>Pipeline báo lỗi.</b><p>{data.error}</p></Notice>}
    <section className="panel compact" style={{ marginBottom: 18 }}><div className="inline-actions"><StatusBadge status={data.status} /><span className="chip">{data.scan_mode || "—"} scan {data.is_approximate && "· sampled"}</span>{data.is_approximate && <span className="chip">≈ Có uncertainty (độ bất định)</span>}</div></section>
    
    {(hasReview || !runComplete) && <section className="panel report-actions-panel report-next-actions">
      {hasReview ? <>
        <div><p className="eyebrow">Bước cần hoàn tất</p><h2>Review đề xuất trước</h2><p className="muted">Còn {formatNumber(data.pending_proposals)} đề xuất cần được xác nhận, chỉnh sửa hoặc từ chối. Profile sẽ tiếp tục hoàn thành sau khi Review xong.</p></div>
        <div className="inline-actions"><Link href={`/profiles/${runId}/review`} className="button primary">Review {data.pending_proposals} đề xuất</Link></div>
      </> : data.status === "failed" ? <>
        <div><p className="eyebrow">Cần xử lý</p><h2>Profile chưa sẵn sàng để phân tích</h2><p className="muted">Pipeline đã gặp lỗi. Hãy kiểm tra thông báo bên trên và chạy lại một phiên profiling khi dữ liệu đã được xử lý.</p></div>
        <div className="inline-actions"><Link href={`/datasets/${data.dataset_id}/runs`} className="button secondary">Quay lại các profile run</Link></div>
      </> : <>
        <div><p className="eyebrow">Đang hoàn thiện</p><h2>Profile đang được xử lý</h2><p className="muted">Các thao tác phân tích, kiểm định và xuất báo cáo sẽ mở khi profile chuyển sang trạng thái hoàn tất.</p></div>
        <div className="inline-actions"><StatusBadge status={data.status} /></div>
      </>}
    </section>}
    <section id="summary_metrics" className="grid four"><Metric label="Số dòng" value={formatNumber(data.row_count)} approximate={data.is_approximate} detail={data.is_approximate ? "Ước lượng từ sample" : "Compute đầy đủ"} /><Metric label="Số cột" value={formatNumber(data.column_count)} detail={`${pii.length} tín hiệu PII`} /><Metric label="Đề xuất chờ review" value={formatNumber(data.pending_proposals)} detail="PII/key không tự xác nhận" /><Metric label="Quasi-identifiers" value={formatNumber(data.quasi_identifiers.length)} detail={data.quasi_identifiers.slice(0, 2).join(", ") || "Không phát hiện"} /></section>
    <div id="risk_provenance" className="grid two" style={{ marginTop: 18 }}>
      <section className="panel"><div className="panel-title"><h2>Rủi ro & privacy</h2><span className="chip pii">Đã bảo vệ PII</span></div>{data.risk_warnings.length ? <ul className="warning-list">{data.risk_warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : <p className="muted">Không có cảnh báo rủi ro từ pipeline.</p>}<div className="chip-list" style={{ marginTop: 14 }}>{pii.map((proposal) => <span className="chip pii" key={proposal.id}>{proposal.column_name || proposal.columns?.join(", ")}: {proposal.pii_type || proposal.proposed_type || "PII candidate"}</span>)}</div></section>
      <section className="panel provenance-panel">
        <div className="panel-title"><div><h2>Nguồn & cách tạo báo cáo</h2><small>Thông tin để hiểu kết quả đến từ đâu</small></div><span className={`provenance-state ${runComplete ? "complete" : "pending"}`}>{runComplete ? "Đã hoàn tất" : "Đang xử lý"}</span></div>
        <p className="provenance-intro">Báo cáo này được tạo từ dataset đã nạp vào workspace, qua compute engine deterministic. Agent chỉ diễn giải các metric và evidence đã có; không tự tạo số liệu.</p>
        <div className="provenance-summary-grid">
          <div className="provenance-summary-card"><span className="provenance-card-icon">▦</span><div><small>Nguồn dữ liệu</small><b>{data.dataset_name || "Dataset không tên"}</b><span>{data.dataset_id}</span></div></div>
          <div className="provenance-summary-card"><span className="provenance-card-icon">◌</span><div><small>Phạm vi đã tính</small><b>{formatNumber(data.row_count)} dòng · {formatNumber(data.column_count)} cột</b><span>{scanCopy.label} · {data.is_approximate ? "có uncertainty" : "đầy đủ"}</span></div></div>
          <div className="provenance-summary-card"><span className="provenance-card-icon">✓</span><div><small>Trạng thái kiểm duyệt</small><b>{reviewComplete ? "Metadata đã được xử lý" : `${formatNumber(data.pending_proposals)} proposal còn chờ`}</b><span>{reviewComplete ? "Có thể dùng kết quả để phân tích" : "Cần review trước khi hỏi Agent"}</span></div></div>
        </div>
        <div className="provenance-flow" aria-label="Các bước tạo báo cáo">
          <div className="provenance-flow-step done"><span>1</span><div><b>Nạp dữ liệu</b><small>Đọc dataset vào compute engine</small></div></div>
          <div className="provenance-flow-step done"><span>2</span><div><b>Tính metric</b><small>{scanCopy.label}</small></div></div>
          <div className={`provenance-flow-step ${reviewComplete ? "done" : "current"}`}><span>3</span><div><b>Review metadata</b><small>{reviewComplete ? "Proposal đã được xử lý" : "Đang chờ quyết định"}</small></div></div>
          <div className={`provenance-flow-step ${runComplete ? "done" : "current"}`}><span>4</span><div><b>Sẵn sàng sử dụng</b><small>{runComplete ? "Báo cáo đã hoàn tất" : "Pipeline chưa hoàn tất"}</small></div></div>
        </div>
        <div className="provenance-details"><div><span>Profile run</span><b>{data.run_name || `Phiên bản v${data.version ?? "—"}`}</b></div><div><span>Phiên bản</span><b>v{data.version ?? "—"}</b></div><div><span>Cách tính</span><b>Deterministic aggregate</b></div></div>
        {data.executed_query && <details className="provenance-technical"><summary>Xem câu lệnh SQL truy vấn nguồn dữ liệu</summary><p>{scanCopy.detail} Hệ thống đã lưu lại câu lệnh truy vấn bên dưới để đảm bảo tính minh bạch và có thể tái sử dụng để truy xuất đúng tập dữ liệu gốc này khi cần thiết.</p><code>{data.executed_query}</code></details>}
      </section>
    </div>
    {data.narrative_report && <section id="narrative_report" className="panel" style={{ marginTop: 18 }}><div className="panel-title"><h2>Tóm tắt agent</h2><small>Chỉ diễn giải metric đã kiểm chứng</small></div><MarkdownContent text={data.narrative_report} className="report report-markdown" /></section>}
    <section id="column_profiles" className="panel" style={{ marginTop: 18 }}><div className="panel-title"><div><h2>Hồ sơ cột</h2><small>Top values bị ẩn với cột PII.</small></div><span className="chip">{columns.length} cột</span></div><div className="table-wrap"><table><thead><tr><th>Cột</th><th>Kiểu</th><th>Null</th><th>Cardinality</th><th>Uniqueness</th><th>Tóm tắt số</th><th>Giá trị phổ biến</th></tr></thead><tbody>{columns.map((stat) => <tr key={stat.column_name}><td><b>{stat.column_name}</b>{stat.pii_masked && <><br /><span className="chip pii">Đã ẩn PII</span></>}</td><td>{stat.dtype || "—"}</td><td>{formatPercent(stat.null_pct)}<br /><small>{formatNumber(stat.null_count)} null</small></td><td>{formatNumber(stat.cardinality)}</td><td>{formatPercent(stat.uniqueness_ratio)}</td><td>{stat.mean !== null && stat.mean !== undefined ? <div className="metric-summary"><span>mean: <b>{formatNumber(stat.mean)}</b></span><span>min: <b>{formatNumber(stat.min_value)}</b></span><span>max: <b>{formatNumber(stat.max_value)}</b></span><span>outliers: <b>{formatNumber(stat.outlier_count)}</b></span></div> : <div className="metric-summary"><span>min length: <b>{formatNumber(stat.min_length)}</b></span><span>max length: <b>{formatNumber(stat.max_length)}</b></span></div>}</td><td><TopValues stat={stat} /></td></tr>)}</tbody></table></div></section>
    <div id="metric_charts" className="grid two" style={{ marginTop: 18 }}><MetricChart title="Tỷ lệ null theo cột" columns={columns} metric="null_pct" warning /><MetricChart title="Tỷ lệ unique theo cột" columns={columns} metric="uniqueness_ratio" ratio /></div>
    <div id="distribution_correlation" className="grid two" style={{ marginTop: 18 }}><section className="panel"><div className="panel-title"><h2>Phân phối</h2><small>Top-k non-PII · tỷ lệ trên toàn bộ dòng</small></div>{columns.filter((stat) => !stat.pii_masked).slice(0, 3).map((stat) => <div className="distribution-column" key={stat.column_name}><h3>{stat.column_name}</h3><Distribution stat={stat} totalRows={data.row_count} /></div>)}</section><section className="panel"><div className="panel-title"><h2>Tương quan</h2><small>Pearson r · các cột số</small></div><CorrelationPanel matrix={data.correlation_matrix} /></section></div>
    
    {(!hasReview && runComplete) && (
      <section className="panel report-actions-panel" style={{ marginTop: 18, background: "linear-gradient(135deg, rgba(2, 132, 199, 0.12) 0%, rgba(14, 165, 233, 0.06) 100%)", border: "1px solid rgba(56, 189, 248, 0.4)" }}>
        <div>
          <p className="eyebrow" style={{ color: "#0284c7" }}>Bước tiếp theo</p>
          <h2 style={{ color: "#0369a1" }}>Tạo biểu đồ & phân tích</h2>
          <p className="muted">Tạo biểu đồ trực quan từ dữ liệu đã profile, đặt câu hỏi cho AI Agent và đưa kết quả vào Báo cáo hoàn chỉnh.</p>
        </div>
        <div className="inline-actions">
          <Link href={`/charts?runId=${encodeURIComponent(runId)}`} className="button primary" style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "10px 20px", fontSize: "0.95rem" }}>
            📊 Tạo biểu đồ & phân tích →
          </Link>
        </div>
      </section>
    )}

    {tocItems.length > 0 && (
      <aside className="report-toc-sidebar">
        <div className="report-toc-container">
          <h3 className="report-toc-title">Nội dung</h3>
          <ul className="report-toc-list">
            {tocItems.map(item => (
              <li key={item.id}>
                <a href={`#${item.id}`} onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth" });
                }}>
                  <span>{item.title}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    )}
  </>;
}

export default function ProfilePage() {
  if (process.env.NEXT_PUBLIC_UX_COMMAND_CENTER_ENABLED === "true") {
    return <CommandCenterShell overview={<ProfileOverview />} />;
  }
  return <ProfileOverview />;
}
