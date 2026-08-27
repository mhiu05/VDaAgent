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
              Lập hồ sơ dữ liệu để phân tích dựa trên bằng chứng. Hiểu dữ liệu của bạn trước khi bắt đầu phân tích sâu.
            </p>
          </div>
          <div className="pub-footer-col">
            <h4>Sản phẩm</h4>
            <Link href="/workspaces">Không gian làm việc</Link>
            <Link href="/guide">Hướng dẫn</Link>
            <Link href="/docs">Tài liệu</Link>
          </div>
          <div className="pub-footer-col">
            <h4>Tìm hiểu</h4>
            <Link href="/about">Giới thiệu</Link>
            <Link href="/docs">Lập hồ sơ dữ liệu</Link>
          </div>
          <div className="pub-footer-col">
            <h4>Khác</h4>
            <Link href="/privacy">Chính sách bảo mật</Link>
            <Link href="/terms">Điều khoản sử dụng</Link>
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
