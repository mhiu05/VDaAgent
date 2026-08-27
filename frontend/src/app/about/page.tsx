import { PublicNavbar } from "@/components/public-navbar";
import { PublicFooter } from "@/components/public-footer";
import Link from "next/link";

export const metadata = { title: "Giới thiệu - VDaAgent" };

export default function AboutPage() {
  return (
    <div className="public-page">
      <PublicNavbar />
      <main style={{ flex: 1 }}>
        <section className="pub-section">
          <div className="pub-container pub-hero" style={{ paddingTop: 0 }}>
            <div className="pub-hero-copy">
              <span className="pub-eyebrow">GIỚI THIỆU CHUYÊN SÂU</span>
              <h1>VDaAgent —<br /><span>Lập hồ sơ dữ liệu dựa trên bằng chứng</span></h1>
              <p>Hệ sinh thái phân tích dữ liệu giúp giải quyết triệt để vấn đề "hộp đen" của AI, biến mọi kết luận thành các bằng chứng có thể đo lường và truy nguyên.</p>
              <p style={{ marginTop: "16px", color: "var(--pub-ink)", fontWeight: 500 }}>
                Dự án không chỉ là một công cụ lập hồ sơ dữ liệu, mà là một chuẩn mực mới cho quy trình làm việc giữa chuyên viên phân tích và trợ lý AI.
              </p>
            </div>

            <div className="pub-mockup">
              <div className="pub-mockup-header">
                <h3>Vấn đề (Painpoints) hiện tại</h3>
              </div>
              <p style={{ color: "rgba(255,255,255,0.7)", lineHeight: 1.6, fontSize: "15px", marginBottom: "16px" }}>
                Các công cụ phân tích dữ liệu và chatbot AI truyền thống thường gặp những vấn đề nghiêm trọng:
              </p>
              <ul style={{ color: "rgba(255,255,255,0.8)", fontSize: "14px", lineHeight: 1.8, paddingLeft: "20px" }}>
                <li><b>AI hộp đen:</b> Sinh ra kết quả (ảo giác) mà không có nguồn gốc hay công thức tính toán rõ ràng.</li>
                <li><b>Bảo mật kém:</b> Vô tình gửi dữ liệu thô (raw rows) hoặc thông tin định danh (PII) lên LLM.</li>
                <li><b>Thiếu kiểm soát:</b> Cho phép thực thi SQL tự do trên Browser gây nguy hiểm cho hệ thống database.</li>
                <li><b>Rời rạc:</b> Chuyên viên phân tích phải nhảy qua lại giữa công cụ làm sạch, công cụ vẽ biểu đồ và công cụ viết báo cáo.</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="pub-section bg-surface">
          <div className="pub-container">
            <div className="pub-section-header">
              <span className="pub-eyebrow">GIẢI PHÁP & LỢI ÍCH</span>
              <h2>Xây dựng niềm tin từ dữ liệu gốc</h2>
              <p>VDaAgent định nghĩa lại cách chuyên viên phân tích dữ liệu làm việc bằng một không gian làm việc có kiểm soát và minh bạch 100%.</p>
            </div>

            <div className="pub-feature-grid">
              <div className="pub-feature-card">
                <h3>Minh bạch (Clarity)</h3>
                <p>Mọi chỉ số đều được hiển thị minh bạch. AI chỉ giải thích dựa trên các số liệu và biểu đồ đã được kiểm duyệt bằng thuật toán chuẩn xác.</p>
              </div>
              <div className="pub-feature-card">
                <h3>Truy nguyên (Traceability)</h3>
                <p>Báo cáo cuối cùng luôn đính kèm bối cảnh và nguồn gốc (hash) của dữ liệu nguồn. Biết chính xác kết luận nào được lấy từ biểu đồ nào.</p>
              </div>
              <div className="pub-feature-card">
                <h3>Bảo mật (Security)</h3>
                <p>Tự động phát hiện và che mờ (redact) dữ liệu PII. Ngăn chặn tuyệt đối việc gửi dữ liệu thô ra khỏi hệ thống nội bộ.</p>
              </div>
              <div className="pub-feature-card">
                <h3>Tự động hóa (Automation)</h3>
                <p>Quét toàn bộ cấu trúc và chất lượng dataset chỉ bằng một cú click, tiết kiệm hàng giờ viết code thủ công kiểm tra dữ liệu.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="pub-section">
          <div className="pub-container">
            <div className="pub-section-header">
              <span className="pub-eyebrow">CHỨC NĂNG & QUY TRÌNH</span>
              <h2>Hệ sinh thái tính năng & Userflow</h2>
            </div>

            <div className="pub-principle" style={{ alignItems: "flex-start" }}>
              <div>
                <ul style={{ listStyle: "none", padding: 0 }}>
                  <li style={{ display: "flex", alignItems: "flex-start", gap: "16px", marginBottom: "32px" }}>
                    <div className="pub-workflow-icon" style={{ margin: 0, width: "40px", height: "40px", fontSize: "16px", flexShrink: 0 }}>1</div>
                    <div>
                      <h4 style={{ fontSize: "18px", color: "var(--pub-ink)", marginBottom: "8px" }}>Tự động lập hồ sơ dữ liệu</h4>
                      <p style={{ color: "var(--pub-muted)", lineHeight: 1.6 }}>Nhận diện Schema, tính toán Completeness, Missing rate, Unique, Cardinality và phân phối dữ liệu cho từng cột độc lập.</p>
                    </div>
                  </li>
                  <li style={{ display: "flex", alignItems: "flex-start", gap: "16px", marginBottom: "32px" }}>
                    <div className="pub-workflow-icon" style={{ margin: 0, width: "40px", height: "40px", fontSize: "16px", flexShrink: 0 }}>2</div>
                    <div>
                      <h4 style={{ fontSize: "18px", color: "var(--pub-ink)", marginBottom: "8px" }}>Bản xem trước & bằng chứng chính thức</h4>
                      <p style={{ color: "var(--pub-muted)", lineHeight: 1.6 }}>Công cụ trực quan hóa dữ liệu. Biểu đồ sau khi được chuyên viên phân tích duyệt sẽ trở thành "bằng chứng chính thức" lưu trữ qua mã băm.</p>
                    </div>
                  </li>
                  <li style={{ display: "flex", alignItems: "flex-start", gap: "16px", marginBottom: "32px" }}>
                    <div className="pub-workflow-icon" style={{ margin: 0, width: "40px", height: "40px", fontSize: "16px", flexShrink: 0 }}>3</div>
                    <div>
                      <h4 style={{ fontSize: "18px", color: "var(--pub-ink)", marginBottom: "8px" }}>Trợ lý AI ràng buộc bằng chứng</h4>
                      <p style={{ color: "var(--pub-muted)", lineHeight: 1.6 }}>Trợ lý AI trả lời câu hỏi phân tích nhưng bị giới hạn nghiêm ngặt: chỉ được phép đọc các bằng chứng chính thức đã duyệt, không bịa đặt dữ liệu.</p>
                    </div>
                  </li>
                  <li style={{ display: "flex", alignItems: "flex-start", gap: "16px" }}>
                    <div className="pub-workflow-icon" style={{ margin: 0, width: "40px", height: "40px", fontSize: "16px", flexShrink: 0 }}>4</div>
                    <div>
                      <h4 style={{ fontSize: "18px", color: "var(--pub-ink)", marginBottom: "8px" }}>Báo cáo truy nguyên & Snapshot</h4>
                      <p style={{ color: "var(--pub-muted)", lineHeight: 1.6 }}>Xuất báo cáo PDF/JSON. Báo cáo khi xuất bản sẽ được "đóng băng" (Snapshot) để số liệu không bao giờ bị thay đổi ngầm sau này.</p>
                    </div>
                  </li>
                </ul>
              </div>

              <div style={{ background: "var(--pub-surface)", padding: "40px", borderRadius: "16px", border: "1px solid var(--pub-border)" }}>
                <h3 style={{ fontSize: "20px", marginBottom: "24px", color: "var(--pub-ink)" }}>Userflow hệ thống</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      <div style={{ background: "var(--pub-bg)", padding: "16px", borderRadius: "8px", border: "1px solid var(--pub-border)", fontWeight: 500 }}>1. Tải tập dữ liệu (CSV/JSON/Parquet)</div>
                  <div style={{ paddingLeft: "16px", color: "var(--pub-brand)", fontSize: "20px" }}>↓</div>
                      <div style={{ background: "var(--pub-bg)", padding: "16px", borderRadius: "8px", border: "1px solid var(--pub-border)", fontWeight: 500 }}>2. Lập hồ sơ xác định & xem xét siêu dữ liệu/PII</div>
                  <div style={{ paddingLeft: "16px", color: "var(--pub-brand)", fontSize: "20px" }}>↓</div>
                      <div style={{ background: "var(--pub-bg)", padding: "16px", borderRadius: "8px", border: "1px solid var(--pub-border)", fontWeight: 500 }}>3. Tạo biểu đồ (Bản xem trước → Bằng chứng chính thức)</div>
                  <div style={{ paddingLeft: "16px", color: "var(--pub-brand)", fontSize: "20px" }}>↓</div>
                      <div style={{ background: "var(--pub-bg)", padding: "16px", borderRadius: "8px", border: "1px solid var(--pub-border)", fontWeight: 500 }}>4. Đặt câu hỏi cho trợ lý AI (Dựa trên bằng chứng)</div>
                  <div style={{ paddingLeft: "16px", color: "var(--pub-brand)", fontSize: "20px" }}>↓</div>
                  <div style={{ background: "var(--pub-brand-tint)", color: "var(--pub-brand)", padding: "16px", borderRadius: "8px", border: "1px solid var(--pub-brand)", fontWeight: 600 }}>5. Báo cáo hoàn chỉnh (Snapshot PDF/JSON)</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="pub-section bg-surface">
          <div className="pub-container pub-principle">
            <div>
              <span className="pub-eyebrow">CÁC NGUYÊN TẮC</span>
              <h2>Bảo mật & Kiểm soát chặt chẽ</h2>
              <p className="lead">
                Dự án được xây dựng dựa trên các nguyên tắc thiết kế khắt khe nhằm đảm bảo độ tin cậy và bảo mật tối đa cho dữ liệu doanh nghiệp.
              </p>
              <ul style={{ listStyle: "none", padding: 0 }}>
                <li style={{ display: "flex", alignItems: "flex-start", gap: "12px", marginBottom: "16px" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginTop: "4px", color: "var(--pub-mint)", flexShrink: 0 }}><path d="M20 6L9 17l-5-5" /></svg>
                  <span style={{ fontSize: "15px", lineHeight: 1.6 }}><b>Tính xác định:</b> Số liệu tạo bằng compute deterministic; LLM chỉ lập kế hoạch, diễn giải và hỏi đáp trong phạm vi evidence được cấp.</span>
                </li>
                <li style={{ display: "flex", alignItems: "flex-start", gap: "12px", marginBottom: "16px" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginTop: "4px", color: "var(--pub-mint)", flexShrink: 0 }}><path d="M20 6L9 17l-5-5" /></svg>
                  <span style={{ fontSize: "15px", lineHeight: 1.6 }}><b>Không rò rỉ dữ liệu thô:</b> UI, Agent và report không cung cấp raw row hoặc giá trị PII thô.</span>
                </li>
                <li style={{ display: "flex", alignItems: "flex-start", gap: "12px", marginBottom: "16px" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginTop: "4px", color: "var(--pub-mint)", flexShrink: 0 }}><path d="M20 6L9 17l-5-5" /></svg>
                  <span style={{ fontSize: "15px", lineHeight: 1.6 }}><b>Kiểm soát truy vấn:</b> Browser không gửi SQL hay mã thực thi tự do. Mọi aggregate dùng QuerySpec có allow-list, ngân sách thời gian và giới hạn kết quả.</span>
                </li>
                <li style={{ display: "flex", alignItems: "flex-start", gap: "12px", marginBottom: "16px" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginTop: "4px", color: "var(--pub-mint)", flexShrink: 0 }}><path d="M20 6L9 17l-5-5" /></svg>
                  <span style={{ fontSize: "15px", lineHeight: 1.6 }}><b>Bảo mật từ gốc:</b> Backend luôn xác thực workspace, role và capability trước khi đọc hoặc ghi một resource.</span>
                </li>
              </ul>
            </div>

            <div className="pub-principle-visual">
              <div className="pub-insight-line">
                <span>Dữ liệu thô</span>
                <b style={{ color: "#c8415a" }}>Bị chặn (Redacted)</b>
              </div>
              <div className="pub-insight-line">
                <span>SQL Injection</span>
                <b style={{ color: "#c8415a" }}>Ngăn chặn bởi QuerySpec</b>
              </div>
              <div className="pub-insight-line">
                <span>Quyền truy cập</span>
                <b>Xác thực không gian làm việc & vai trò</b>
              </div>
              <div className="pub-insight-line">
                <span>Chỉ số phân tích</span>
                <b style={{ color: "var(--pub-mint)" }}>Compute Deterministic</b>
              </div>
            </div>
          </div>
        </section>

        <section className="pub-section" style={{ textAlign: "center", paddingBottom: "120px" }}>
          <div className="pub-container">
            <span className="pub-eyebrow">NGƯỜI DÙNG MỤC TIÊU</span>
            <h2 style={{ fontSize: "32px", fontWeight: 700, margin: "16px 0 24px", color: "var(--pub-ink)" }}>Ai nên sử dụng VDaAgent?</h2>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "32px", maxWidth: "800px", margin: "0 auto 48px", textAlign: "left" }}>
              <div style={{ background: "var(--pub-surface)", padding: "32px", borderRadius: "16px", border: "1px solid var(--pub-border)" }}>
                <h3 style={{ color: "var(--pub-brand)", marginBottom: "12px", fontSize: "20px" }}>Đối tượng chính</h3>
                <p style={{ color: "var(--pub-ink)", lineHeight: 1.6 }}>Chuyên viên phân tích dữ liệu và phân tích nghiệp vụ cần khám phá, kiểm tra và trình bày nhận định từ một tập dữ liệu một cách có căn cứ.</p>
              </div>
              <div style={{ background: "var(--pub-surface)", padding: "32px", borderRadius: "16px", border: "1px solid var(--pub-border)" }}>
                <h3 style={{ color: "var(--pub-muted)", marginBottom: "12px", fontSize: "20px" }}>Đối tượng phụ</h3>
                <p style={{ color: "var(--pub-ink)", lineHeight: 1.6 }}>Data/AI team, quản trị workspace và reviewer cần kiểm tra provenance, quyền truy cập, audit và chất lượng đầu ra AI.</p>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "center", gap: "24px" }}>
              <Link href="/workspaces" className="pub-btn pub-btn-primary">Mở không gian làm việc <span aria-hidden="true" style={{ marginLeft: 8 }}>→</span></Link>
              <Link href="/contact" className="pub-btn pub-btn-secondary">Liên hệ hợp tác</Link>
            </div>
          </div>
        </section>

      </main>
      <PublicFooter />
    </div>
  );
}
