"use client";

import Link from "next/link";
import { PublicNavbar } from "@/components/public-navbar";
import { PublicFooter } from "@/components/public-footer";

const features = [
  { icon: "01", title: "Khám phá cấu trúc", description: "Tự động phân tích kiểu dữ liệu, mức độ đa dạng (cardinality) và nhận diện ý nghĩa của từng cột." },
  { icon: "02", title: "Kiểm tra chất lượng", description: "Quét toàn bộ dataset để phát hiện các giá trị khuyết thiếu (missing), dữ liệu trùng lặp hoặc định dạng sai." },
  { icon: "03", title: "Phân phối thống kê", description: "Tính toán tự động các giá trị trung bình, trung vị, độ lệch chuẩn và phân phối tần suất của dữ liệu." },
  { icon: "04", title: "Trực quan hóa", description: "Gợi ý và tạo các biểu đồ Histogram, Bar chart trực quan dựa trên đặc tính ngữ nghĩa của biến số." },
];

function ProductPreview() {
  return (
    <div className="pub-mockup">
      <div className="pub-mockup-header">
        <h3>VDaAgent / profile-run-042</h3>
        <span className="pub-mockup-badge">Hoàn tất</span>
      </div>
      
      <div className="pub-mockup-stats">
        <div className="pub-mockup-stat-card">
          <small>Số dòng</small>
          <b>84,270</b>
        </div>
        <div className="pub-mockup-stat-card">
          <small>Số cột</small>
          <b>18</b>
        </div>
        <div className="pub-mockup-stat-card">
          <small>Chất lượng</small>
          <b style={{ color: "var(--pub-mint)" }}>92.8%</b>
        </div>
      </div>
      
      <p style={{ fontSize: "14px", fontWeight: 600, margin: "0 0 16px 0", color: "#fff" }}>Mức độ đầy đủ theo cột</p>
      
      <div className="pub-mockup-chart">
        <div className="pub-mockup-bar" style={{ height: "100%" }}></div>
        <div className="pub-mockup-bar" style={{ height: "60%" }}></div>
        <div className="pub-mockup-bar" style={{ height: "95%" }}></div>
        <div className="pub-mockup-bar" style={{ height: "82%" }}></div>
        <div className="pub-mockup-bar mint" style={{ height: "92%" }}></div>
        <div className="pub-mockup-bar" style={{ height: "40%" }}></div>
        <div className="pub-mockup-bar" style={{ height: "88%" }}></div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "12px", color: "rgba(255,255,255,0.6)", fontSize: "12px" }}>
        <span>customer_id</span>
        <span>order_date</span>
        <span>total_value</span>
      </div>

      <div className="pub-floating-tag tag-1">
        <span className="pub-icon-check">✓</span>
        <div>Kiểm tra chất lượng<br /><span style={{ color: "var(--pub-muted)", fontSize: "12px" }}>Sẵn sàng phân tích</span></div>
      </div>
      
      <div className="pub-floating-tag tag-2">
        <span className="pub-icon-spark">✦</span>
        <div>Trả lời từ hệ thống<br /><span style={{ color: "var(--pub-muted)", fontSize: "12px" }}>Có số liệu kèm theo</span></div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="public-page">
      <PublicNavbar />
      
      <main style={{ flex: 1 }}>
        <section className="pub-section">
          <div className="pub-container pub-hero" style={{ paddingTop: 0 }}>
            <div className="pub-hero-copy">
              <span className="pub-eyebrow">DATA PROFILING · VDaAgent</span>
              <h1>Biến một tệp dữ liệu thành<br /><span>hồ sơ có thể kiểm tra.</span></h1>
              <p>VDaAgent giúp nhà phân tích thấu hiểu cấu trúc, chất lượng và các vấn đề tiềm ẩn của tập dữ liệu trước khi đi sâu vào phân tích.</p>
              <div className="pub-hero-actions">
                <Link href="/dashboard" className="pub-btn pub-btn-primary">Bắt đầu ngay <span aria-hidden="true" style={{ marginLeft: 8 }}>→</span></Link>
                <Link href="/guide" className="pub-btn pub-btn-ghost">Xem quy trình <span aria-hidden="true" style={{ marginLeft: 4 }}>↗</span></Link>
              </div>
              <div style={{ marginTop: "40px", fontSize: "14px", color: "var(--pub-muted)", display: "flex", gap: "24px", fontWeight: 500 }}>
                <span>Profiling</span>
                <span>Data Quality</span>
                <span>Statistics</span>
                <span>Visualization</span>
              </div>
            </div>
            
            <div style={{ position: "relative" }}>
              <ProductPreview />
            </div>
          </div>
        </section>

        <section className="pub-section bg-surface">
          <div className="pub-container">
            <div className="pub-section-header">
              <span className="pub-eyebrow">TẠI SAO DATA PROFILING?</span>
              <h2>Hiểu dữ liệu trước khi tin vào dữ liệu.</h2>
              <p>Mỗi báo cáo phân tích chỉ có giá trị khi dữ liệu đầu vào đã được kiểm chứng và làm sạch.</p>
            </div>
            
            <div className="pub-feature-grid">
              {features.map(f => (
                <div key={f.icon} className="pub-feature-card">
                  <span className="pub-feature-number">{f.icon}</span>
                  <h3>{f.title}</h3>
                  <p>{f.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>



        <section className="pub-section" style={{ textAlign: "center", paddingBottom: "120px" }}>
          <div className="pub-container">
            <span className="pub-eyebrow">HÀNH ĐỘNG</span>
            <h2 style={{ fontSize: "40px", fontWeight: 700, margin: "16px 0 24px", color: "var(--pub-ink)" }}>Sẵn sàng hiểu dữ liệu của bạn?</h2>
            <p style={{ fontSize: "18px", color: "var(--pub-muted)", maxWidth: "600px", margin: "0 auto 48px" }}>
              Bắt đầu từ một dataset và để VDaAgent giúp bạn nhìn thấy cấu trúc và các vấn đề cần chú ý trước khi đưa ra quyết định.
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: "24px" }}>
              <Link href="/dashboard" className="pub-btn pub-btn-primary">Mở Workspace <span aria-hidden="true" style={{ marginLeft: 8 }}>→</span></Link>
              <Link href="/guide" className="pub-btn pub-btn-secondary">Xem hướng dẫn</Link>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
