import Link from "next/link";

export default function NotFound() {
  return <section className="empty-state"><span aria-hidden="true">?</span><h1>Không tìm thấy trang này</h1><p>Liên kết có thể đã thay đổi hoặc profile không còn khả dụng.</p><Link href="/datasets" className="button primary">Về danh sách bộ dữ liệu</Link></section>;
}
