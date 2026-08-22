import { PublicNavbar } from "@/components/public-navbar";

export const metadata = { title: "Giới thiệu - VDaAgent" };

export default function AboutPage() {
  return (
    <div className="public-page">
      <PublicNavbar />
      <main className="main-content" style={{ maxWidth: 800 }}>
        <h1 className="page-title">VDaAgent — Data Profiling</h1>
        <p className="page-description" style={{ lineHeight: 1.8 }}>VDaAgent giúp Analyst biến một tệp dữ liệu thành hồ sơ có thể kiểm tra, biểu đồ có bằng chứng và báo cáo có thể truy nguyên. Profile Run là đơn vị làm việc trung tâm: mọi phân tích, biểu đồ, câu trả lời của Agent và report đều thuộc về một Profile Run trong một workspace cụ thể.</p>

        <div className="panel" style={{ marginTop: 32 }}>
          <h2>Luồng làm việc</h2>
          <pre style={{ background: 'var(--canvas)', padding: '16px', borderRadius: '8px', overflowX: 'auto', fontSize: '0.85rem', lineHeight: '1.6', marginTop: '16px', color: 'var(--ink)' }}>
{`Tải dataset → Profile deterministic → Review metadata
       → Profile Run hoàn tất
       ├─ Biểu đồ: plan → Preview → Official evidence → insight
       ├─ Hỏi Agent: trả lời theo evidence đã được phép đọc
       └─ Report Draft → snapshot bất biến → PDF/JSON`}
          </pre>

          <h2 style={{ marginTop: 32 }}>Các nguyên tắc của dự án</h2>
          <ul style={{ lineHeight: 1.8, marginTop: '16px' }}>
            <li>Số liệu được tạo bằng <strong>compute deterministic</strong>; LLM chỉ hỗ trợ lập kế hoạch, diễn giải và hỏi đáp trong phạm vi evidence được cấp.</li>
            <li>UI, Agent và report không cung cấp raw row hoặc giá trị PII thô.</li>
            <li>Browser không gửi SQL hay mã thực thi tự do. Mọi aggregate dùng QuerySpec có allow-list, ngân sách thời gian và giới hạn kết quả.</li>
            <li>Backend luôn xác thực workspace, role và capability trước khi đọc hoặc ghi một resource.</li>
          </ul>

          <h2 style={{ marginTop: 32 }}>Vấn đề</h2>
          <p style={{ lineHeight: 1.8, marginTop: '16px' }}>
            Analyst thường mất nhiều thời gian để kiểm tra chất lượng dữ liệu, chọn biểu đồ phù hợp và giải thích kết quả theo cách có thể kiểm chứng. Các công cụ chatbot hoặc notebook tự do dễ tạo ra câu trả lời không có provenance, truy vấn vượt phạm vi dữ liệu được phép hoặc vô tình đưa raw row/PII vào kết quả chia sẻ.
          </p>
          <p style={{ lineHeight: 1.8, marginTop: '8px' }}>
            VDaAgent giải quyết khoảng trống này bằng một workflow có kiểm soát: số liệu do compute deterministic tạo ra; AI chỉ lập kế hoạch, diễn giải và trả lời trong phạm vi evidence đã được backend cấp quyền.
          </p>

          <h2 style={{ marginTop: 32 }}>Giải pháp</h2>
          <p style={{ lineHeight: 1.8, marginTop: '16px', marginBottom: '16px' }}>VDaAgent là workspace evidence-first cho quy trình từ dataset đến báo cáo:</p>
          <ul style={{ lineHeight: 1.8 }}>
            <li>Profile dữ liệu có cấu trúc và review metadata/PII trước khi dùng làm ngữ cảnh phân tích.</li>
            <li>Tạo chart qua Preview có giới hạn, sau đó promote thành Official evidence có provenance và result_hash.</li>
            <li>Hỏi Agent trong phạm vi evidence của Profile Run; trace được redact để quan sát runtime mà không lưu raw prompt, raw row, secret hoặc chain-of-thought.</li>
            <li>Lưu chart/evidence/insight vào Report Draft, đóng băng snapshot rồi xuất PDF/JSON có thể truy nguyên.</li>
          </ul>

          <h2 style={{ marginTop: 32 }}>Người dùng mục tiêu</h2>
          <ul style={{ lineHeight: 1.8, marginTop: '16px' }}>
            <li><strong>Chính:</strong> Data Analyst và Business Analyst cần khám phá, kiểm tra và trình bày insight từ một dataset một cách có căn cứ.</li>
            <li><strong>Phụ:</strong> Data/AI team, quản trị workspace và reviewer cần kiểm tra provenance, quyền truy cập, audit và chất lượng đầu ra AI.</li>
          </ul>
        </div>
      </main>
    </div>
  );
}
