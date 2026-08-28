"use client";

import { PublicNavbar } from "@/components/public-navbar";
import { useDialog } from "@/components/ui";
import { useState } from "react";

export default function ContactPage() {
  const dialog = useDialog();
  const [isHovered, setIsHovered] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      void dialog.alert("Cảm ơn bạn đã liên hệ! Chúng tôi sẽ phản hồi sớm nhất.", { title: "Đã gửi liên hệ", tone: "info" });
    }, 1500);
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--pub-bg)", color: "var(--pub-ink)", fontFamily: "var(--font-sans, system-ui, sans-serif)", overflowX: "clip" }}>
      <PublicNavbar />
      
      <main style={{ position: "relative", padding: "80px 20px", display: "flex", justifyContent: "center", alignItems: "center" }}>
        
        {/* Animated Background Elements */}
        <div style={{ position: "absolute", top: "-10%", left: "-5%", width: "400px", height: "400px", background: "radial-gradient(circle, rgba(49, 94, 251, 0.15) 0%, transparent 70%)", borderRadius: "50%", filter: "blur(60px)", zIndex: 0, animation: "float 6s ease-in-out infinite" }} />
        <div style={{ position: "absolute", bottom: "-5%", right: "-5%", width: "500px", height: "500px", background: "radial-gradient(circle, rgba(139, 92, 246, 0.15) 0%, transparent 70%)", borderRadius: "50%", filter: "blur(60px)", zIndex: 0, animation: "float 8s ease-in-out infinite reverse" }} />

        <div style={{ position: "relative", zIndex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "60px", maxWidth: "1100px", width: "100%", alignItems: "center" }}>
          
          {/* Left Column: Text & Info */}
          <div style={{ paddingRight: "20px" }}>
            <div style={{ display: "inline-block", padding: "6px 16px", borderRadius: "20px", background: "rgba(49, 94, 251, 0.1)", color: "#315efb", fontSize: "0.85rem", fontWeight: 700, marginBottom: "20px", letterSpacing: "0.5px", textTransform: "uppercase" }}>
              Liên Hệ Với Chúng Tôi
            </div>
            <h1 style={{ fontSize: "3.5rem", fontWeight: 800, color: "var(--pub-ink)", lineHeight: 1.1, marginBottom: "24px", letterSpacing: "-1px" }}>
              Cùng kiến tạo <br />
              <span style={{ background: "linear-gradient(135deg, #315efb 0%, #8b5cf6 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Giá trị Dữ liệu</span>
            </h1>
            <p style={{ fontSize: "1.1rem", color: "var(--pub-muted)", lineHeight: 1.6, marginBottom: "40px", maxWidth: "450px" }}>
              Bạn có câu hỏi, góp ý hay muốn tìm hiểu sâu hơn về giải pháp phân tích dữ liệu của VDaAgent? Đội ngũ của chúng tôi luôn sẵn sàng hỗ trợ bạn.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "16px", padding: "16px", background: "var(--pub-surface)", borderRadius: "16px", boxShadow: "0 4px 20px rgba(0,0,0,0.03)", transition: "transform 0.3s ease", cursor: "default" }} onMouseEnter={(e) => e.currentTarget.style.transform = "translateY(-4px)"} onMouseLeave={(e) => e.currentTarget.style.transform = "translateY(0)"}>
                <div style={{ width: "48px", height: "48px", borderRadius: "12px", background: "linear-gradient(135deg, rgba(49, 94, 251, 0.1), rgba(139, 92, 246, 0.1))", display: "flex", justifyContent: "center", alignItems: "center", color: "#315efb" }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--pub-muted)", fontWeight: 600, textTransform: "uppercase" }}>Điện thoại</p>
                  <p style={{ margin: "4px 0 0", fontSize: "1.1rem", color: "var(--pub-ink)", fontWeight: 700 }}>0375049906</p>
                </div>
              </div>
              
              <div style={{ display: "flex", alignItems: "center", gap: "16px", padding: "16px", background: "var(--pub-surface)", borderRadius: "16px", boxShadow: "0 4px 20px rgba(0,0,0,0.03)", transition: "transform 0.3s ease", cursor: "default" }} onMouseEnter={(e) => e.currentTarget.style.transform = "translateY(-4px)"} onMouseLeave={(e) => e.currentTarget.style.transform = "translateY(0)"}>
                <div style={{ width: "48px", height: "48px", borderRadius: "12px", background: "linear-gradient(135deg, rgba(49, 94, 251, 0.1), rgba(139, 92, 246, 0.1))", display: "flex", justifyContent: "center", alignItems: "center", color: "#8b5cf6" }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--pub-muted)", fontWeight: 600, textTransform: "uppercase" }}>Email</p>
                  <p style={{ margin: "4px 0 0", fontSize: "1.1rem", color: "var(--pub-ink)", fontWeight: 700 }}>minhhieuhh2k5@gmail.com</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Glassmorphism Form */}
          <div style={{ 
            background: "var(--pub-surface)",
            backdropFilter: "blur(20px)", 
            WebkitBackdropFilter: "blur(20px)", 
            borderRadius: "24px", 
            padding: "48px 40px", 
            boxShadow: "0 20px 40px rgba(0,0,0,0.08)",
            border: "1px solid var(--pub-border)"
          }}>
            <h3 style={{ margin: "0 0 32px", fontSize: "1.8rem", color: "var(--pub-ink)", fontWeight: 800 }}>Gửi tin nhắn cho chúng tôi</h3>
            
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--pub-ink)" }}>Họ và tên</label>
                <input 
                  type="text" 
                  placeholder="Nguyễn Văn A" 
                  required
                  style={{ 
                    padding: "16px 20px", 
                    borderRadius: "12px", 
                    border: "2px solid transparent", 
                    background: "var(--pub-code-bg)",
                    fontSize: "1rem", 
                    color: "var(--pub-ink)",
                    outline: "none",
                    transition: "all 0.2s ease",
                    boxShadow: "inset 0 2px 4px rgba(0,0,0,0.02)"
                  }} 
                  onFocus={(e) => { e.currentTarget.style.border = "2px solid var(--pub-brand)"; e.currentTarget.style.background = "var(--pub-surface)"; }}
                  onBlur={(e) => { e.currentTarget.style.border = "2px solid transparent"; e.currentTarget.style.background = "var(--pub-code-bg)"; }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--pub-ink)" }}>Địa chỉ Email</label>
                <input 
                  type="email" 
                  placeholder="name@example.com" 
                  required
                  style={{ 
                    padding: "16px 20px", 
                    borderRadius: "12px", 
                    border: "2px solid transparent", 
                    background: "var(--pub-code-bg)",
                    fontSize: "1rem", 
                    color: "var(--pub-ink)",
                    outline: "none",
                    transition: "all 0.2s ease",
                    boxShadow: "inset 0 2px 4px rgba(0,0,0,0.02)"
                  }} 
                  onFocus={(e) => { e.currentTarget.style.border = "2px solid var(--pub-brand)"; e.currentTarget.style.background = "var(--pub-surface)"; }}
                  onBlur={(e) => { e.currentTarget.style.border = "2px solid transparent"; e.currentTarget.style.background = "var(--pub-code-bg)"; }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--pub-ink)" }}>Nội dung tin nhắn</label>
                <textarea 
                  rows={4} 
                  placeholder="Hãy chia sẻ suy nghĩ hoặc yêu cầu của bạn..." 
                  required
                  style={{ 
                    padding: "16px 20px", 
                    borderRadius: "12px", 
                    border: "2px solid transparent", 
                    background: "var(--pub-code-bg)",
                    fontSize: "1rem", 
                    color: "var(--pub-ink)",
                    outline: "none",
                    transition: "all 0.2s ease",
                    boxShadow: "inset 0 2px 4px rgba(0,0,0,0.02)",
                    resize: "vertical",
                    minHeight: "120px"
                  }} 
                  onFocus={(e) => { e.currentTarget.style.border = "2px solid var(--pub-brand)"; e.currentTarget.style.background = "var(--pub-surface)"; }}
                  onBlur={(e) => { e.currentTarget.style.border = "2px solid transparent"; e.currentTarget.style.background = "var(--pub-code-bg)"; }}
                />
              </div>

              <button 
                type="submit" 
                disabled={isSubmitting}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                style={{ 
                  marginTop: "8px",
                  padding: "18px 32px", 
                  borderRadius: "12px", 
                  background: isSubmitting ? "#94a3b8" : (isHovered ? "linear-gradient(135deg, #254ee0 0%, #7c3aed 100%)" : "linear-gradient(135deg, #315efb 0%, #8b5cf6 100%)"), 
                  color: "#ffffff", 
                  fontSize: "1.1rem", 
                  fontWeight: 700, 
                  border: "none", 
                  cursor: isSubmitting ? "not-allowed" : "pointer",
                  transition: "all 0.3s ease",
                  boxShadow: isHovered && !isSubmitting ? "0 10px 25px rgba(49, 94, 251, 0.4)" : "0 4px 14px rgba(49, 94, 251, 0.2)",
                  transform: isHovered && !isSubmitting ? "translateY(-2px)" : "translateY(0)",
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  gap: "10px"
                }}
              >
                {isSubmitting ? "Đang gửi..." : "Gửi liên hệ ngay"}
                {!isSubmitting && (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isHovered ? "translateX(4px)" : "translateX(0)", transition: "transform 0.3s ease" }}><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                )}
              </button>
            </form>
          </div>
        </div>
      </main>

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes float {
          0% { transform: translateY(0px); }
          50% { transform: translateY(-20px); }
          100% { transform: translateY(0px); }
        }
        @media (max-width: 900px) {
          main > div {
            grid-template-columns: 1fr !important;
            gap: 40px !important;
          }
          main { padding: 40px 20px !important; }
        }
      `}} />
    </div>
  );
}
