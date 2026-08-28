import Link from "next/link";
import Image from "next/image";

export function PublicFooter() {
  return (
    <footer className="pub-footer">
      <div className="pub-container">
        <div className="pub-footer-grid">
          <div>
            <Link href="/" className="pub-footer-brand">
              <Image src="/img/logo.png" alt="VDaAgent" width={32} height={32} unoptimized style={{ objectFit: "contain" }} />
              <span>VDaAgent</span>
            </Link>
            <p className="pub-footer-desc">
              Data profiling for evidence-driven analysis. Hiểu dữ liệu của bạn trước khi bắt đầu phân tích sâu.
            </p>
          </div>
          <div className="pub-footer-col">
            <h4>Sản phẩm</h4>
            <Link href="/workspaces">Workspace</Link>
            <Link href="/guide">Hướng dẫn</Link>
            <Link href="/docs">Tài liệu</Link>
          </div>
          <div className="pub-footer-col">
            <h4>Tìm hiểu</h4>
            <Link href="/about">Giới thiệu</Link>
            <Link href="/docs">Data Profiling</Link>
          </div>
          <div className="pub-footer-col">
            <h4>Khác</h4>
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms of Service</Link>
            <Link href="/contact">Liên hệ</Link>
          </div>
        </div>
        <div className="pub-footer-bottom">
          <span>© {new Date().getFullYear()} VDaAgent.</span>
        </div>
      </div>
    </footer>
  );
}
