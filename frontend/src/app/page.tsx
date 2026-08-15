"use client";

import Link from "next/link";
import { PublicNavbar } from "@/components/public-navbar";

const features = [
  { icon: "01", title: "Hiểu dữ liệu trước khi dùng", description: "Tạo profile có row count, null, cardinality, uniqueness, outlier và các tín hiệu rủi ro từ compute engine.", className: "profile" },
  { icon: "02", title: "Evidence thay cho phỏng đoán", description: "Mỗi câu trả lời và kết quả aggregate đều gắn với metric, nguồn dữ liệu và provenance có thể kiểm tra.", className: "evidence" },
  { icon: "03", title: "Kiểm soát ở đúng điểm", description: "Human review cho semantic type, candidate key và PII trước khi Agent được phép tiếp tục phân tích.", className: "control" },
];

const workflow = [
  { number: "01", title: "Upload dataset", description: "CSV, TSV, Parquet hoặc JSON. Chọn Sampling để kiểm tra nhanh hoặc Full scan để có thống kê đầy đủ." },
  { number: "02", title: "Profile & review", description: "Đọc báo cáo cột, kiểm tra cảnh báo và xác nhận metadata proposals trước khi hỏi Agent." },
  { number: "03", title: "Analyze with evidence", description: "Đặt business goal, vượt quality gate, chạy aggregate bounded và xuất kết quả có thể truy nguyên." },
];

const roles = [
  { key: "analyst", role: "Analyst", title: "Khám phá và phân tích", description: "Upload, profiling, review metadata, test, drift, Q&A và tạo report draft.", icon: "⌁" },
];

function ProductPreview() {
  return <div className="home-product-stage" aria-label="Minh họa workspace phân tích dữ liệu">
    <div className="home-stage-glow" />
    <div className="home-data-orbit orbit-a" /><div className="home-data-orbit orbit-b" />
    <div className="home-product-window">
      <div className="home-window-top"><span className="home-window-dots"><i /><i /><i /></span><span>VDaAgent / profile-run-042</span><b>● Live evidence</b></div>
      <div className="home-window-body">
        <aside className="home-window-sidebar"><span className="home-window-logo">P</span><i /><i /><i /><i /><small>v1.4</small></aside>
        <div className="home-window-content">
          <div className="home-window-heading"><div><small>DATASET PROFILE</small><h3>orders_2025.csv</h3></div><span className="home-window-status">completed</span></div>
          <div className="home-mini-metrics"><span><small>Rows</small><b>84,270</b><em>+12.4%</em></span><span><small>Columns</small><b>18</b><em>stable</em></span><span><small>Quality</small><b>92.8</b><em>good</em></span></div>
          <div className="home-window-chart"><div className="home-chart-label"><small>Completeness by column</small><b>92.8%</b></div><div className="home-chart-bars"><i style={{ height: "54%" }} /><i style={{ height: "76%" }} /><i style={{ height: "62%" }} /><i style={{ height: "88%" }} /><i style={{ height: "70%" }} /><i style={{ height: "95%" }} /><i style={{ height: "82%" }} /><i style={{ height: "98%" }} /><i style={{ height: "90%" }} /></div><div className="home-chart-axis"><span>customer_id</span><span>order_date</span><span>total_value</span></div></div>
          <div className="home-window-bottom"><div><small>REVIEW QUEUE</small><b>3 proposals cần xem</b><span className="home-review-dots"><i /><i /><i /></span></div><div><small>LAST EVIDENCE</small><b>aggregate · 184 ms</b><span className="home-evidence-check">✓</span></div></div>
        </div>
      </div>
    </div>
    <div className="home-floating-card floating-quality"><span className="home-floating-icon">✓</span><div><small>Quality gate</small><b>Ready to analyze</b></div></div>
    <div className="home-floating-card floating-agent"><span className="home-floating-spark">✦</span><div><small>Agent answer</small><b>Evidence attached</b></div></div>
  </div>;
}

export default function Home() {
  return <div className="public-page home-redesign"><PublicNavbar /><main className="home-page">
    <section className="home-new-hero">
      <div className="home-new-hero-copy">
        <div className="home-kicker"><span className="home-kicker-pulse" /> DATA INTELLIGENCE WORKSPACE <span>·</span> VDaAgent</div>
        <h1>Biến dữ liệu<br /><span>thô thành rõ ràng.</span></h1>
        <p className="home-new-hero-description">VDaAgent giúp đội ngũ đi từ dataset chưa rõ chất lượng đến quyết định có thể kiểm chứng — bằng profiling deterministic, human review và phân tích luôn có evidence.</p>
        <div className="home-new-actions"><Link className="button primary home-main-cta" href="/dashboard">Bắt đầu khám phá <span aria-hidden="true">→</span></Link><Link className="home-text-cta" href="/guide">Xem cách hoạt động <span aria-hidden="true">↗</span></Link></div>
        <div className="home-hero-assurance"><span><b>✓</b> Không cần đăng nhập để thử</span><span><b>✓</b> Không render raw rows</span><span><b>✓</b> Evidence trong từng bước</span></div>
      </div>
      <ProductPreview />
    </section>

    <section className="home-proof-strip" aria-label="Điểm mạnh của VDaAgent"><span><b>01</b> deterministic metrics</span><i /><span><b>02</b> human-in-the-loop</span><i /><span><b>03</b> workspace permissions</span><i /><span><b>04</b> exportable evidence</span></section>

    <section className="home-new-section home-value-section"><div className="home-section-intro"><p className="home-kicker-simple">WHY VDaAgent</p><h2>Không chỉ nhìn thấy số.<br /><span>Hiểu chúng đến từ đâu.</span></h2><p>Một workflow liền mạch cho data quality, metadata và business analysis — đủ trực quan cho người dùng, đủ chặt chẽ cho dữ liệu production.</p></div><div className="home-feature-grid">{features.map((feature) => <article className={`home-feature-card ${feature.className}`} key={feature.title}><span className="home-feature-number">{feature.icon}</span><div className={`home-feature-illustration ${feature.className}`} aria-hidden="true">{feature.className === "profile" ? <><i /><i /><i /><i /><b>▦</b></> : feature.className === "evidence" ? <><span>✓</span><i /><i /><i /></> : <><i /><b>PII</b><span>✓</span></>}</div><h3>{feature.title}</h3><p>{feature.description}</p><Link href="/guide">Tìm hiểu thêm <span>→</span></Link></article>)}</div></section>

    <section className="home-new-section home-workflow-section"><div className="home-section-intro home-workflow-intro"><p className="home-kicker-simple">THE WORKFLOW</p><h2>Một đường đi rõ ràng<br />từ file đến insight.</h2><p>Không nhảy cóc qua những bước quan trọng. Mỗi checkpoint giúp kết quả cuối cùng đáng tin hơn.</p><Link className="button secondary" href="/guide">Xem hướng dẫn đầy đủ <span>→</span></Link></div><div className="home-workflow-list">{workflow.map((step, index) => <div className="home-workflow-item" key={step.number}><span className="home-workflow-number">{step.number}</span><div className="home-workflow-line"><i /></div><div><h3>{step.title}</h3><p>{step.description}</p><span className="home-workflow-tag">{index === 0 ? "INGEST" : index === 1 ? "REVIEW" : "EVIDENCE"}</span></div></div>)}</div></section>

    <section className="home-role-section"><div className="home-role-heading"><div><p className="home-kicker-simple">ONE WORKSPACE ROLE</p><h2>Một workspace.<br /><span>Một luồng phân tích.</span></h2></div><p>Analyst có đầy đủ quyền để đi từ upload dữ liệu đến profiling, phân tích và xuất báo cáo.</p></div><div className="home-new-role-grid">{roles.map((role) => <article className={`home-new-role-card ${role.key}`} key={role.role}><div className="home-role-icon-new">{role.icon}</div><span className="home-role-label">{role.role}</span><h3>{role.title}</h3><p>{role.description}</p><Link href="/guide">Xem hướng dẫn <span>→</span></Link></article>)}</div></section>

    <section className="home-new-section home-insight-section"><div className="home-insight-visual" aria-hidden="true"><div className="home-insight-card insight-main"><div className="insight-card-top"><span>REPORT SNAPSHOT</span><b>Published</b></div><h3>Revenue by region</h3><div className="insight-chart"><i style={{ height: "38%" }} /><i style={{ height: "60%" }} /><i style={{ height: "48%" }} /><i style={{ height: "82%" }} /><i style={{ height: "68%" }} /><i style={{ height: "94%" }} /></div><div className="insight-legend"><span>North <b>42.8k</b></span><span>Central <b>31.4k</b></span><span>South <b>26.9k</b></span></div></div><div className="home-insight-card insight-mini"><span className="insight-mini-icon">↗</span><div><small>Evidence confidence</small><b>High · 98.4%</b></div></div><svg className="home-insight-scribble" viewBox="0 0 240 160" fill="none"><path d="M12 122C52 124 61 86 97 91c30 4 43 43 68 28 19-11 13-49 60-74" stroke="currentColor" strokeWidth="2" strokeDasharray="5 6" /><path d="m214 39 12 5-4 12" stroke="currentColor" strokeWidth="2" /></svg></div><div className="home-insight-copy"><p className="home-kicker-simple">BUILT FOR TRUST</p><h2>Kết quả đẹp hơn khi<br /><span>có thể kiểm tra lại.</span></h2><p>Report không chỉ là một con số. VDaAgent lưu context, quality gate, execution hash và nguồn evidence để người khác có thể đọc, review và tin vào kết quả.</p><div className="home-check-list"><span><b>✓</b> Source và version được ghim</span><span><b>✓</b> Raw rows và PII được bảo vệ</span><span><b>✓</b> PDF/JSON sẵn sàng chia sẻ</span></div><Link className="home-text-cta" href="/login">Làm việc với workspace thật <span>↗</span></Link></div></section>

    <section className="home-final-cta"><div className="home-cta-orb orb-left" /><div className="home-cta-orb orb-right" /><p className="home-kicker-simple">READY WHEN YOU ARE</p><h2>Bắt đầu với một<br /><span>dataset bất kỳ.</span></h2><p>Thử nhanh không cần đăng nhập, hoặc tạo workspace để giữ lại hành trình phân tích của bạn.</p><div className="home-new-actions"><Link className="button primary home-main-cta" href="/dashboard">Mở workspace <span aria-hidden="true">→</span></Link><Link className="button light-secondary" href="/signup">Tạo tài khoản</Link></div></section>
  </main></div>;
}
