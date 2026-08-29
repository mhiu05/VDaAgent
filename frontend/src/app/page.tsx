"use client";

import Link from "next/link";
import Image from "next/image";
import { PublicNavbar } from "@/components/public-navbar";
import { PublicFooter } from "@/components/public-footer";

const features = [
  { icon: "01", tag: "STRUCTURE", title: "Khám phá cấu trúc", description: "Tự động phân tích kiểu dữ liệu, mức độ đa dạng (cardinality) và nhận diện ý nghĩa của từng cột." },
  { icon: "02", tag: "QUALITY", title: "Kiểm tra chất lượng", description: "Quét toàn bộ dataset để phát hiện các giá trị khuyết thiếu (missing), dữ liệu trùng lặp hoặc định dạng sai." },
  { icon: "03", tag: "SIGNALS", title: "Phân phối thống kê", description: "Tính toán tự động các giá trị trung bình, trung vị, độ lệch chuẩn và phân phối tần suất của dữ liệu." },
  { icon: "04", tag: "VISUALS", title: "Trực quan hóa", description: "Gợi ý và tạo các biểu đồ Histogram, Bar chart trực quan dựa trên đặc tính ngữ nghĩa của biến số." },
];

export default function Home() {
  return (
    <div className="public-page">
      <PublicNavbar />
      
      <main className="pub-home-main">
        <section className="pub-section pub-hero-section">
          <div className="pub-container pub-hero">
            <div className="pub-hero-copy">
              <div className="pub-hero-kicker">
                <span className="pub-kicker-mark" aria-hidden="true">✦</span>
                <span>DATA PROFILING / VDaAgent</span>
                <span className="pub-kicker-code">ARC 01</span>
              </div>
              <h1>Đọc vị dữ liệu.<br /><span>Ra quyết định sáng.</span></h1>
              <p className="pub-hero-lead">VDaAgent giúp nhà phân tích nhìn thấy cấu trúc, chất lượng và những tín hiệu ẩn trong dataset trước khi bước vào phần phân tích sâu.</p>
              <div className="pub-hero-actions">
                <Link href="/workspaces" className="pub-btn pub-btn-primary">Bắt đầu ngay <span aria-hidden="true" style={{ marginLeft: 8 }}>→</span></Link>
                <Link href="/guide" className="pub-btn pub-btn-ghost">Xem quy trình <span aria-hidden="true" style={{ marginLeft: 4 }}>↗</span></Link>
              </div>
              <div className="pub-hero-proof">
                <span className="pub-proof-dot" aria-hidden="true" />
                <span>evidence-first workflow</span>
                <span className="pub-proof-divider" aria-hidden="true" />
                <span>human review ready</span>
              </div>
            </div>

            <div className="pub-hero-visual">
              <span className="pub-hero-orbit pub-hero-orbit-one" aria-hidden="true" />
              <span className="pub-hero-orbit pub-hero-orbit-two" aria-hidden="true" />
              <div className="pub-hero-panel">
                <div className="pub-hero-panel-bar">
                  <span className="pub-panel-dot" aria-hidden="true" />
                  <span>PROFILE RUN / 001</span>
                  <span className="pub-panel-status">LIVE SCAN</span>
                </div>
                <Image className="pub-hero-dashboard-image" src="/img/home/home1.png" alt="VDaAgent Preview" width={800} height={600} priority />
              </div>
              <div className="pub-hero-sticker pub-hero-sticker-top">
                <span>SCAN</span>
                <strong>COMPLETE</strong>
                <small>confidence ↑ 98%</small>
              </div>
              <div className="pub-hero-sticker pub-hero-sticker-bottom">
                <span className="pub-sticker-spark" aria-hidden="true">✦</span>
                <span>find the signal<br /><b>before the story</b></span>
              </div>
              <div className="pub-hero-mascot" aria-hidden="true">
                <div className="pub-mascot-crop"><Image src="/img/logo.png" alt="" width={110} height={110} unoptimized /></div>
              </div>
            </div>
          </div>
        </section>

        <section className="pub-section pub-features-section bg-surface">
          <div className="pub-container">
            <div className="pub-section-header">
              <div className="pub-section-index"><span>02</span><span>WHY PROFILE?</span></div>
              <h2>Đừng đoán mò.<br /><em>Hãy để dữ liệu lên tiếng.</em></h2>
              <p>Mỗi báo cáo phân tích chỉ có giá trị khi dữ liệu đầu vào đã được kiểm chứng, giải thích được và sẵn sàng để review.</p>
            </div>
            
            <div className="pub-feature-grid">
              {features.map((f) => (
                <div key={f.icon} className="pub-feature-card">
                  <div className="pub-feature-card-top">
                    <span className="pub-feature-number">{f.icon}</span>
                    <span className="pub-feature-tag">{f.tag}</span>
                  </div>
                  <h3>{f.title}</h3>
                  <p>{f.description}</p>
                  <span className="pub-feature-arrow" aria-hidden="true">↗</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="pub-section pub-cta-section">
          <div className="pub-container">
            <div className="pub-cta-panel">
              <span className="pub-cta-sun" aria-hidden="true">✦</span>
              <span className="pub-eyebrow">03 / NEXT ARC</span>
              <h2>Sẵn sàng mở khóa<br /><em>dataset của bạn?</em></h2>
              <p>
              Bắt đầu từ một dataset và để VDaAgent giúp bạn nhìn thấy cấu trúc và các vấn đề cần chú ý trước khi đưa ra quyết định.
              </p>
              <div className="pub-cta-actions">
                <Link href="/workspaces" className="pub-btn pub-btn-primary">Mở Workspace <span aria-hidden="true" style={{ marginLeft: 8 }}>→</span></Link>
                <Link href="/guide" className="pub-btn pub-btn-secondary">Xem hướng dẫn</Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
