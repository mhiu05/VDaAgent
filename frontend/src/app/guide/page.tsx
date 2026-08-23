import Link from "next/link";
import Image from "next/image";
import { PublicNavbar } from "@/components/public-navbar";
import { PublicFooter } from "@/components/public-footer";

export const metadata = { title: "Hướng dẫn - VDaAgent" };

const steps = [
  {
    id: "step-1",
    title: "1. Tải dữ liệu (Upload)",
    desc: "Khởi tạo Profile Run bằng cách tải tệp tin của bạn.",
    content: "Bắt đầu bằng cách kéo thả tệp dữ liệu (CSV, Parquet, JSON) vào Workspace. Ngay khi tải lên, hệ thống sẽ tự động khởi chạy tiến trình Profiling deterministic để quét toàn bộ cấu trúc và chất lượng dữ liệu của bạn trong vài giây.",
    callout: { type: "tip", text: "Nếu file quá lớn, hệ thống sẽ tự động tối ưu hóa tài nguyên để đảm bảo không bị gián đoạn quá trình. Đợi khoảng 2-3 phút để hoàn thành quá trình." },
    mockup: { type: "upload" }
  },
  {
    id: "step-2",
    title: "2. Review Đề xuất & Metadata",
    desc: "Kiểm tra chất lượng và duyệt các thông tin nhạy cảm.",
    content: "Dữ liệu hiếm khi hoàn hảo. Hệ thống sẽ tự động đề xuất (suggestions) các vấn đề phát hiện được như: giá trị bị khuyết (missing values), dữ liệu trùng lặp (duplicates), hoặc lỗi định dạng. Đặc biệt, bạn cần review và che mờ (redact) các cột chứa dữ liệu PII (nhạy cảm) trước khi đi sâu vào phân tích.",
    mockup: { type: "review" }
  },
  {
    id: "step-3",
    title: "3. Phân tích & Trực quan hóa",
    desc: "Vẽ biểu đồ và đặt câu hỏi chuyên sâu.",
    content: "Sử dụng tính năng Preview để lên bản nháp cho các biểu đồ Histogram, Bar chart, hay Scatter plot. Khi đã chắc chắn, bạn 'Promote' chúng thành Official Evidence (Bằng chứng chính thức). Những biểu đồ này có mã Hash riêng biệt để đảm bảo tính xác thực.",
    mockup: { type: "visualize" }
  },
  {
    id: "step-4",
    title: "4. So sánh dữ liệu (Compare)",
    desc: "Đối chiếu các tập dữ liệu hoặc các biến số.",
    content: "Sử dụng chức năng so sánh để đối chiếu sự khác biệt giữa các Profile Run (ví dụ: dữ liệu tháng này vs tháng trước) hoặc so sánh tương quan chéo giữa hai cột bất kỳ trong cùng một dataset để tìm ra quy luật ngầm.",
    callout: { type: "info", text: "Mọi so sánh đều được tính toán bằng thuật toán Deterministic." }
  },
  {
    id: "step-5",
    title: "5. Báo cáo & Export PDF",
    desc: "Đóng băng kết quả và xuất bản báo cáo.",
    content: "Tất cả các biểu đồ và phân tích từ Agent sẽ được lưu vào một Report Draft. Khi bạn hoàn tất, chỉ cần Snapshot (đóng băng) bản nháp này để đảm bảo không ai có thể thay đổi số liệu trong tương lai. Sau đó, bạn có thể Export báo cáo ra định dạng PDF hoặc JSON để chia sẻ.",
    mockup: { type: "export" }
  }
];

export default function GuidePage() {
  return (
    <div className="public-page">
      <PublicNavbar />

      <main style={{ flex: 1, position: "relative" }}>

        {/* Banner Global AI Chat */}
        <div style={{ background: "var(--pub-brand)", color: "#fff", padding: "16px", textAlign: "center", position: "sticky", top: 0, zIndex: 10 }}>
          <p style={{ margin: 0, fontSize: "15px", fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            Lưu ý: Chat Agent (Trợ lý AI) luôn túc trực và bạn có thể hỏi đáp xuyên suốt mọi bước trong quá trình phân tích!
          </p>
        </div>

        <section className="pub-section">
          <div className="pub-container">
            <div className="pub-section-header" style={{ textAlign: "left", maxWidth: "600px", margin: "0 0 64px 0" }}>
              <span className="pub-eyebrow">HƯỚNG DẪN SỬ DỤNG</span>
              <h1 style={{ fontSize: "48px", fontWeight: 700, margin: "16px 0", color: "var(--pub-ink)", lineHeight: 1.1 }}>
                Quy trình phân tích từ A đến Z
              </h1>
              <p className="lead">
                Làm chủ VDaAgent thông qua 5 bước tiêu chuẩn trong Workspace. Từ lúc tải file cho đến khi xuất báo cáo hoàn chỉnh.
              </p>
            </div>

            <div className="pub-guide-layout">
              <aside className="pub-guide-sidebar">
                <nav>
                  {steps.map(step => (
                    <a key={step.id} href={`#${step.id}`} className="pub-guide-link">
                      <b style={{ display: "block", marginBottom: "4px", color: "var(--pub-ink)" }}>{step.title}</b>
                      <span style={{ fontSize: "14px", color: "var(--pub-muted)", lineHeight: 1.4 }}>{step.desc}</span>
                    </a>
                  ))}
                </nav>
              </aside>

              <div className="pub-guide-content">
                {steps.map((step, index) => (
                  <div key={step.id} id={step.id} className="pub-guide-step">
                    <h2 style={{ fontSize: "28px", fontWeight: 700, marginBottom: "16px", color: "var(--pub-ink)" }}>{step.title}</h2>
                    <p style={{ fontSize: "16px", color: "var(--pub-ink)", lineHeight: 1.7, marginBottom: "24px" }}>
                      {step.content}
                    </p>


                    {step.mockup && (
                      <div className="pub-mockup" style={{ marginBottom: "32px" }}>
                        <div className="pub-mockup-header">
                          <h3>VDaAgent / step-0{index + 1}</h3>
                        </div>
                        {step.mockup.type === "upload" && (
                          <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "16px", background: "rgba(255,255,255,0.02)" }}>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                              <Image src="/img/guilde/upload_data1.png" alt="Upload Step 1" width={400} height={200} style={{ width: '100%', height: 'auto', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }} />
                              <Image src="/img/guilde/upload_data2.png" alt="Upload Step 2" width={400} height={200} style={{ width: '100%', height: 'auto', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }} />
                            </div>
                            <Image src="/img/guilde/upload_data3.png" alt="Upload Step 3" width={800} height={400} style={{ width: '100%', height: 'auto', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }} />
                          </div>
                        )}
                        {step.mockup.type === "review" && (
                          <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "12px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", background: "rgba(255,255,255,0.05)", padding: "12px", borderRadius: "8px" }}>
                              <span>Dữ liệu cột <b>Phone Number</b> (Nhạy cảm)</span>
                              <span style={{ color: "#c8415a", fontWeight: 500 }}>Đề xuất che mờ (Redact)</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", background: "rgba(255,255,255,0.05)", padding: "12px", borderRadius: "8px" }}>
                              <span>Cột <b>Age</b></span>
                              <span style={{ color: "var(--pub-mint)", fontWeight: 500 }}>Phát hiện 12 Missing Values</span>
                            </div>
                          </div>
                        )}
                        {step.mockup.type === "visualize" && (
                          <div style={{ padding: "12px" }}>
                            <div style={{ background: "rgba(255,255,255,0.05)", height: "120px", borderRadius: "8px", display: "flex", alignItems: "flex-end", justifyContent: "space-around", padding: "16px" }}>
                              <div style={{ width: "20%", height: "40%", background: "var(--pub-brand)", borderRadius: "4px 4px 0 0" }}></div>
                              <div style={{ width: "20%", height: "80%", background: "var(--pub-brand)", borderRadius: "4px 4px 0 0" }}></div>
                              <div style={{ width: "20%", height: "60%", background: "var(--pub-brand)", borderRadius: "4px 4px 0 0" }}></div>
                              <div style={{ width: "20%", height: "100%", background: "var(--pub-brand)", borderRadius: "4px 4px 0 0" }}></div>
                            </div>
                            <p style={{ fontSize: "12px", color: "var(--pub-muted)", marginTop: "12px", textAlign: "center" }}>Biểu đồ phân phối thu nhập — Đã xác thực thành Official Evidence</p>
                          </div>
                        )}
                        {step.mockup.type === "export" && (
                          <div style={{ padding: "24px", textAlign: "center" }}>
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--pub-brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: "12px" }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
                            <h4 style={{ color: "#fff", marginBottom: "8px" }}>Báo cáo đã đóng băng</h4>
                            <div style={{ display: "flex", justifyContent: "center", gap: "12px", marginTop: "16px" }}>
                              <span style={{ padding: "6px 12px", background: "var(--pub-brand)", color: "#fff", borderRadius: "4px", fontSize: "13px", fontWeight: 500 }}>Xuất PDF</span>
                              <span style={{ padding: "6px 12px", background: "rgba(255,255,255,0.1)", color: "#fff", borderRadius: "4px", fontSize: "13px", fontWeight: 500 }}>Xuất JSON</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {step.callout && (
                      <div style={{ background: step.callout.type === "tip" ? "rgba(49, 88, 231, 0.05)" : "rgba(200, 65, 90, 0.05)", padding: "16px", borderRadius: "8px", borderLeft: `4px solid ${step.callout.type === "tip" ? "var(--pub-brand)" : "var(--pub-danger)"}`, marginBottom: "32px", fontSize: "15px", color: "var(--pub-ink)" }}>
                        <strong style={{ color: step.callout.type === "tip" ? "var(--pub-brand)" : "var(--pub-danger)" }}>
                          {step.callout.type === "tip" ? "Mẹo nhỏ: " : "Lưu ý: "}
                        </strong>
                        {step.callout.text}
                      </div>
                    )}

                    {index < steps.length - 1 && <hr style={{ border: 0, borderBottom: "1px solid var(--pub-border)", margin: "48px 0" }} />}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="pub-section bg-surface" style={{ textAlign: "center", paddingBottom: "120px" }}>
          <div className="pub-container">
            <h2 style={{ fontSize: "32px", fontWeight: 700, margin: "0 0 24px", color: "var(--pub-ink)" }}>Sẵn sàng thực hành?</h2>
            <p style={{ fontSize: "18px", color: "var(--pub-muted)", maxWidth: "600px", margin: "0 auto 32px" }}>
              Tải lên tập dữ liệu đầu tiên của bạn và trải nghiệm sự khác biệt của Workspace Evidence-first.
            </p>
            <Link href="/dashboard" className="pub-btn pub-btn-primary" style={{ padding: "16px 32px", fontSize: "16px" }}>Vào Workspace</Link>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
