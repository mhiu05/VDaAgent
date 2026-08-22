"use client";

import Link from "next/link";
import { PublicNavbar } from "@/components/public-navbar";

const features = [
  { icon: "01", title: "Tự động Profiling (Deterministic)", description: "Tính toán số liệu một cách chuẩn xác: số dòng, giá trị trống, phân bố, trùng lặp và các cảnh báo PII/chất lượng mà không phụ thuộc vào dự đoán của LLM.", className: "profile" },
  { icon: "02", title: "Mỗi kết quả đều có nguồn gốc", description: "Kết quả phân tích (evidence) luôn được ghim kèm result hash và provenance. Bạn dễ dàng truy nguyên xem con số đó được tính thế nào.", className: "evidence" },
  { icon: "03", title: "Agent có giới hạn an toàn", description: "Trợ lý AI chỉ giải thích và trả lời trong phạm vi evidence đã duyệt. Tuyệt đối không đọc raw rows hay cho phép gửi SQL tự do.", className: "control" },
];

const workflow = [
  { number: "01", title: "Tải dữ liệu lên", description: "Hỗ trợ CSV, Parquet, JSON. File được tải lên trong không gian an toàn (workspace) và chạy profile deterministic." },
  { number: "02", title: "Review Metadata", description: "Kiểm duyệt đề xuất semantic type, nhận diện PII và review metadata trước khi hệ thống chạy phân tích sâu." },
  { number: "03", title: "Khám phá & Báo cáo", description: "Chạy Preview có giới hạn, ghim Official evidence và xuất Report Draft thành tài liệu PDF/JSON đóng băng bất biến." },
];

function ProductPreview() {
  return <div className="home-product-stage" aria-label="Minh họa workspace phân tích dữ liệu">
    <div className="home-stage-glow" />
    <div className="home-data-orbit orbit-a" /><div className="home-data-orbit orbit-b" />
    <div className="home-product-window">
      <div className="home-window-top"><span className="home-window-dots"><i /><i /><i /></span><span>VDaAgent / profile-run-042</span><b>● Đang hoạt động</b></div>
      <div className="home-window-body">
        <aside className="home-window-sidebar"><img src="/img/logo.png" className="home-window-logo" alt="Logo" style={{ width: 32, height: 32, objectFit: 'contain', background: 'transparent' }} /><i /><i /><i /><i /><small>v1.4</small></aside>
        <div className="home-window-content">
          <div className="home-window-heading"><div><small>HỒ SƠ DỮ LIỆU</small><h3>orders_2025.csv</h3></div><span className="home-window-status">hoàn tất</span></div>
          <div className="home-mini-metrics"><span><small>Số dòng</small><b>84,270</b><em>+12.4%</em></span><span><small>Số cột</small><b>18</b><em>ổn định</em></span><span><small>Chất lượng</small><b>92.8</b><em>tốt</em></span></div>
          <div className="home-window-chart"><div className="home-chart-label"><small>Mức độ đầy đủ theo cột</small><b>92.8%</b></div><div className="home-chart-bars"><i style={{ height: "54%" }} /><i style={{ height: "76%" }} /><i style={{ height: "62%" }} /><i style={{ height: "88%" }} /><i style={{ height: "70%" }} /><i style={{ height: "95%" }} /><i style={{ height: "82%" }} /><i style={{ height: "98%" }} /><i style={{ height: "90%" }} /></div><div className="home-chart-axis"><span>customer_id</span><span>order_date</span><span>total_value</span></div></div>
          <div className="home-window-bottom"><div><small>CHỜ KIỂM DUYỆT</small><b>3 đề xuất cần xem</b><span className="home-review-dots"><i /><i /><i /></span></div><div><small>KẾT QUẢ GẦN NHẤT</small><b>phân tích · 184 ms</b><span className="home-evidence-check">✓</span></div></div>
        </div>
      </div>
    </div>
    <div className="home-floating-card floating-quality"><span className="home-floating-icon">✓</span><div><small>Kiểm tra chất lượng</small><b>Sẵn sàng phân tích</b></div></div>
    <div className="home-floating-card floating-agent"><span className="home-floating-spark">✦</span><div><small>Trả lời từ hệ thống</small><b>Có số liệu kèm theo</b></div></div>
  </div>;
}

export default function Home() {
  return <div className="public-page home-redesign"><PublicNavbar /><main className="home-page">
    <section className="home-new-hero">
      <div className="home-new-hero-copy">
        <div className="home-kicker"><span className="home-kicker-pulse" /> DATA PROFILING · VDaAgent</div>
        <h1>Biến một tệp dữ liệu thành<br /><span>hồ sơ có thể kiểm tra.</span></h1>
        <p className="home-new-hero-description">VDaAgent giúp Analyst đi từ một bộ dữ liệu thô đến những biểu đồ có bằng chứng và báo cáo có thể truy nguyên.</p>
        <div className="home-new-actions"><Link className="button primary home-main-cta" href="/dashboard">Bắt đầu ngay <span aria-hidden="true">→</span></Link><Link className="home-text-cta" href="/guide">Xem quy trình <span aria-hidden="true">↗</span></Link></div>
        <div className="home-hero-assurance"><span><b>✓</b> Không lộ giá trị PII thô</span><span><b>✓</b> Compute deterministic an toàn</span><span><b>✓</b> Trợ lý AI có giới hạn (Evidence-based)</span></div>
      </div>
      <ProductPreview />
    </section>

    <section className="home-proof-strip" aria-label="Điểm mạnh của VDaAgent"><span><b>01</b> Profile Deterministic</span><i /><span><b>02</b> Evidence-first Workflow</span><i /><span><b>03</b> AI Giới hạn an toàn</span><i /><span><b>04</b> Xuất PDF/JSON truy nguyên</span></section>

    <section className="home-new-section home-value-section"><div className="home-section-intro"><p className="home-kicker-simple">TẠI SAO CHỌN VDaAgent</p><h2>Giải quyết rủi ro<br /><span>hallucination dữ liệu.</span></h2><p>Các công cụ chatbot tự do dễ tạo ra câu trả lời không có provenance, vô tình làm lộ PII. VDaAgent chỉ cho phép AI trả lời dựa trên bằng chứng đã duyệt.</p></div><div className="home-feature-grid">{features.map((feature) => <article className={`home-feature-card ${feature.className}`} key={feature.title}><span className="home-feature-number">{feature.icon}</span><div className={`home-feature-illustration ${feature.className}`} aria-hidden="true">{feature.className === "profile" ? <><i /><i /><i /><i /><b>▦</b></> : feature.className === "evidence" ? <><span>✓</span><i /><i /><i /></> : <><i /><b>PII</b><span>✓</span></>}</div><h3>{feature.title}</h3><p>{feature.description}</p><Link href="/guide">Tìm hiểu thêm <span>→</span></Link></article>)}</div></section>

    <section className="home-new-section home-workflow-section"><div className="home-section-intro home-workflow-intro"><p className="home-kicker-simple">QUY TRÌNH LÀM VIỆC</p><h2>Ba bước từ file thô<br />đến báo cáo đáng tin.</h2><p>Không bỏ qua những bước quan trọng. Mỗi checkpoint giúp kết quả cuối cùng chính xác và đáng tin hơn.</p><Link className="button secondary" href="/guide">Xem hướng dẫn đầy đủ <span>→</span></Link></div><div className="home-workflow-list">{workflow.map((step, index) => <div className="home-workflow-item" key={step.number}><span className="home-workflow-number">{step.number}</span><div className="home-workflow-line"><i /></div><div><h3>{step.title}</h3><p>{step.description}</p><span className="home-workflow-tag">{index === 0 ? "NHẬP DỮ LIỆU" : index === 1 ? "KIỂM DUYỆT" : "PHÂN TÍCH"}</span></div></div>)}</div></section>

    <section className="home-new-section home-insight-section"><div className="home-insight-visual" aria-hidden="true"><div className="home-insight-card insight-main"><div className="insight-card-top"><span>BÁO CÁO</span><b>Đã xuất bản</b></div><h3>Doanh thu theo khu vực</h3><div className="insight-chart"><i style={{ height: "38%" }} /><i style={{ height: "60%" }} /><i style={{ height: "48%" }} /><i style={{ height: "82%" }} /><i style={{ height: "68%" }} /><i style={{ height: "94%" }} /></div><div className="insight-legend"><span>Miền Bắc <b>42.8k</b></span><span>Miền Trung <b>31.4k</b></span><span>Miền Nam <b>26.9k</b></span></div></div><div className="home-insight-card insight-mini"><span className="insight-mini-icon">↗</span><div><small>Độ tin cậy</small><b>Cao · 98.4%</b></div></div><svg className="home-insight-scribble" viewBox="0 0 240 160" fill="none"><path d="M12 122C52 124 61 86 97 91c30 4 43 43 68 28 19-11 13-49 60-74" stroke="currentColor" strokeWidth="2" strokeDasharray="5 6" /><path d="m214 39 12 5-4 12" stroke="currentColor" strokeWidth="2" /></svg></div><div className="home-insight-copy"><p className="home-kicker-simple">ĐỂ NGƯỜI KHÁC TIN VÀO KẾT QUẢ</p><h2>Mỗi con số đều<br /><span>có nguồn gốc.</span></h2><p>Báo cáo không chỉ là bảng số. VDaAgent lưu lại bối cảnh, điều kiện kiểm tra, phiên bản dữ liệu và cách tính toán — để người đọc có thể kiểm chứng thay vì chỉ tin lời.</p><div className="home-check-list"><span><b>✓</b> Phiên bản dữ liệu nguồn được ghi lại</span><span><b>✓</b> Dữ liệu thô và thông tin nhạy cảm được bảo vệ</span><span><b>✓</b> Xuất PDF hoặc JSON để chia sẻ</span></div><Link className="home-text-cta" href="/login">Đăng nhập để làm việc <span>↗</span></Link></div></section>

    <section className="home-final-cta"><div className="home-cta-orb orb-left" /><div className="home-cta-orb orb-right" /><p className="home-kicker-simple">SẴN SÀNG KHI BẠN CẦN</p><h2>Bắt đầu với bộ dữ liệu<br /><span>của bạn.</span></h2><p>Dùng thử ngay không cần đăng nhập, hoặc tạo tài khoản để lưu lại toàn bộ quá trình làm việc.</p><div className="home-new-actions"><Link className="button primary home-main-cta" href="/dashboard">Mở workspace <span aria-hidden="true">→</span></Link><Link className="button light-secondary" href="/signup">Tạo tài khoản</Link></div></section>

    <footer className="home-footer">
      <div className="home-footer-inner">
        <div className="home-footer-brand">
          <img src="/img/logo.png" alt="VDaAgent" style={{ width: 30, height: 30, objectFit: 'contain' }} />
          <span>VDaAgent</span>
        </div>
        <nav className="home-footer-links" aria-label="Footer navigation">
          <Link href="/guide">Hướng dẫn</Link>
          <Link href="/login">Đăng nhập</Link>
          <Link href="/signup">Đăng ký</Link>
        </nav>
        <p className="home-footer-copy">© {new Date().getFullYear()} VDaAgent. Không gian làm việc với dữ liệu.</p>
      </div>
    </footer>
  </main></div>;
}
