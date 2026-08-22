import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { PublicNavbar } from "@/components/public-navbar";

const simpleSteps = [
  {
    title: "Đăng nhập & Workspace",
    description: "Bạn có thể Dùng thử ngay không cần đăng nhập hoặc tạo tài khoản để lưu trữ dài hạn. Mọi dữ liệu và hành động đều được đóng gói an toàn trong một Workspace được cấp quyền.",
    link: "/login"
  },
  {
    title: "Tải Dataset & Profiling",
    description: "Upload file (CSV, Parquet, JSON). Hệ thống sẽ tự động quét và tính toán số liệu bằng các thuật toán compute deterministic (chính xác tuyệt đối, không dùng LLM để đoán).",
    link: "/dashboard"
  },
  {
    title: "Review Metadata & PII",
    description: "Kiểm tra và quyết định các đề xuất kiểu dữ liệu, xác định khoá chính và đánh dấu PII (dữ liệu định danh cá nhân) để hệ thống ẩn đi trước khi phân tích.",
    link: null
  },
  {
    title: "Khám phá & Hỏi Agent",
    description: "Sử dụng Preview để tổng hợp dữ liệu. Khi ghim (pin) thành Official Evidence, bạn có thể hỏi Agent. AI chỉ trả lời trong phạm vi bằng chứng này, chặn đứng ảo giác (hallucination).",
    link: null
  },
  {
    title: "Báo cáo & Xuất file",
    description: "Sắp xếp lại Report Draft, chốt thành Snapshot (đóng băng trạng thái dữ liệu hiện tại) và xuất file PDF/JSON để chia sẻ minh bạch với mọi người.",
    link: null
  }
];

export default function GuidePage() {
  return (
    <div className="public-page guide-public-page">
      <PublicNavbar />
      <main className="guide-page">
        <PageHeader
          eyebrow="Trung tâm hướng dẫn"
          title="Quy trình Data Profiling chuẩn xác"
          description="Từ dataset thô đến báo cáo truy nguyên được. Mỗi bước đều được thiết kế để đảm bảo an toàn, bảo mật PII và nói không với ảo giác (hallucination) của AI."
          action={
            <div className="inline-actions">
              <Link className="button primary" href="/">Bắt đầu Dùng thử</Link>
            </div>
          }
        />

        <section className="guide-overview panel" style={{ maxWidth: 800, margin: '40px auto', padding: '40px' }}>
          <h2 style={{ textAlign: 'center', marginBottom: 40, fontSize: '1.8rem' }}>Luồng làm việc Evidence-first</h2>
          <div className="simple-workflow-list" style={{ display: 'flex', flexDirection: 'column' }}>
            {simpleSteps.map((step, index) => (
              <div key={index} style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 4 }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--brand)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', fontWeight: 700, zIndex: 2 }}>
                    {index + 1}
                  </div>
                  {index !== simpleSteps.length - 1 && (
                    <div style={{ width: 2, height: 100, background: 'var(--line)', marginTop: 8, marginBottom: 8 }} />
                  )}
                </div>
                <div style={{ flex: 1, paddingBottom: index !== simpleSteps.length - 1 ? 40 : 0 }}>
                  <h3 style={{ margin: '0 0 8px 0', fontSize: '1.25rem', color: 'var(--ink)' }}>{step.title}</h3>
                  <p style={{ margin: 0, lineHeight: 1.6, color: 'var(--muted)', fontSize: '0.95rem' }}>{step.description}</p>
                  {step.link && (
                    <Link href={step.link} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 12, color: 'var(--brand)', fontWeight: 600, textDecoration: 'none', fontSize: '0.9rem' }}>
                      Đi tới tính năng <span aria-hidden="true">→</span>
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel guide-privacy" style={{ maxWidth: 800, margin: '40px auto' }}>
          <div>
            <p className="eyebrow">NGUYÊN TẮC AN TOÀN</p>
            <h2>Mỗi kết quả đều có giới hạn</h2>
          </div>
          <div className="guide-privacy-points">
            <span><b>PII</b><small>Review thủ công; không đưa vào query</small></span>
            <span><b>Evidence</b><small>Gắn với result hash để dễ truy nguyên</small></span>
            <span><b>Raw rows</b><small>Chặn truy cập trực tiếp từ LLM</small></span>
          </div>
        </section>

      </main>
    </div>
  );
}
