import Image from "next/image";
import Link from "next/link";

export function PublicFooter() {
  return <footer className="pub-footer"><div className="pub-container"><div className="pub-footer-grid"><div><Link href="/" className="pub-footer-brand"><span className="pub-brand-mascot pub-brand-mascot-footer" aria-hidden="true"><Image src="/img/logo.png" alt="" width={110} height={110} unoptimized /></span><span>VDaAgent</span></Link><p className="pub-footer-desc">Data profiling cho phân tích dựa trên evidence. Hiểu dữ liệu trước khi đi sâu vào kết luận.</p></div><div className="pub-footer-col"><h4>Sản phẩm</h4><Link href="/workspaces">Workspace</Link><Link href="/guide">Hướng dẫn</Link><Link href="/docs">Tài liệu</Link></div><div className="pub-footer-col"><h4>Tìm hiểu</h4><Link href="/about">Giới thiệu</Link><Link href="/docs">Data Profiling</Link></div><div className="pub-footer-col"><h4>Khác</h4><Link href="/privacy">Privacy Policy</Link><Link href="/terms">Terms of Service</Link><Link href="/contact">Liên hệ</Link></div></div><div className="pub-footer-bottom"><span>© {new Date().getFullYear()} VDaAgent.</span></div></div></footer>;
}
