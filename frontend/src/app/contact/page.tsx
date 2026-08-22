"use client";

import { PublicNavbar } from "@/components/public-navbar";



export default function ContactPage() {
  return (
    <div className="public-page">
      <PublicNavbar />
      <main className="main-content" style={{ maxWidth: 600 }}>
        <h1 className="page-title">Liên hệ với chúng tôi</h1>
        <p className="page-description">Bạn có câu hỏi, góp ý hay muốn tìm hiểu thêm về VDaAgent? Vui lòng điền thông tin bên dưới.</p>

        <div className="panel" style={{ marginTop: 32 }}>
          <form className="auth-form" onSubmit={(e) => e.preventDefault()}>
            <label>
              Tên của bạn
              <input type="text" placeholder="Nguyễn Văn A" />
            </label>
            <label>
              Email
              <input type="email" placeholder="name@example.com" />
            </label>
            <label>
              Nội dung tin nhắn
              <textarea rows={4} style={{ padding: '10px 12px', border: '1px solid #cbd7e8', borderRadius: '9px', width: '100%', font: 'inherit', resize: 'vertical' }} placeholder="Góp ý của bạn..." />
            </label>
            <button type="submit" className="button primary" style={{ marginTop: 8 }}>Gửi liên hệ</button>
          </form>

          <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid var(--line)', color: 'var(--muted)', fontSize: '0.85rem' }}>
            <p><strong>Email:</strong> minhhieuhh2k5@gmail.com</p>
            <p><strong>Nhóm phát triển:</strong> VDuAgents</p>
          </div>
        </div>
      </main>
    </div>
  );
}
