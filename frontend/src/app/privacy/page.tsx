import { PublicFooter } from "@/components/public-footer";
import { PublicNavbar } from "@/components/public-navbar";

export const metadata = { title: "Chính sách bảo mật - VDaAgent" };

export default function PrivacyPage() {
  return (
    <div className="public-page">
      <PublicNavbar />
      <main className="pub-section" style={{ flex: 1 }}>
        <div className="pub-container" style={{ maxWidth: "900px" }}>
          <span className="pub-eyebrow">CHÍNH SÁCH BẢO MẬT</span>
          <h1>Chính sách bảo mật</h1>
          <p className="lead">Ngày hiệu lực: 25 tháng 8 năm 2026</p>
          <div style={{ display: "grid", gap: "28px", marginTop: "36px", lineHeight: 1.7 }}>
            <section><h2>1. Phạm vi</h2><p>Chính sách này mô tả cách VDaAgent thu thập, sử dụng và bảo vệ thông tin khi bạn sử dụng nền tảng lập hồ sơ và phân tích dữ liệu.</p></section>
            <section><h2>2. Thông tin chúng tôi xử lý</h2><p>Chúng tôi có thể xử lý thông tin tài khoản và không gian làm việc, siêu dữ liệu bộ dữ liệu, kết quả lập hồ sơ, lịch sử hoạt động và các cuộc trò chuyện với trợ lý AI khi cần cung cấp dịch vụ. VDaAgent được thiết kế để hạn chế việc lộ các dòng dữ liệu thô và dữ liệu cá nhân không cần thiết.</p></section>
            <section><h2>4. Sử dụng và lưu trữ</h2><p>Thông tin được sử dụng để vận hành, bảo mật, hỗ trợ và cải thiện dịch vụ. Dữ liệu được lưu giữ trong thời gian cần thiết cho không gian làm việc hoặc theo cấu hình của tổ chức triển khai, sau đó được xóa hoặc ẩn danh khi phù hợp.</p></section>
            <section><h2>5. Bảo mật và bên thứ ba</h2><p>Chúng tôi sử dụng xác thực, phân quyền theo không gian làm việc và các biện pháp mã hóa phù hợp. Một số tính năng sử dụng nhà cung cấp hạ tầng hoặc API Google; các nhà cung cấp đó xử lý thông tin theo chính sách riêng của họ.</p></section>
            <section><h2>6. Liên hệ</h2><p>Đối với câu hỏi về quyền riêng tư hoặc yêu cầu dữ liệu, hãy dùng trang <a href="/contact">Liên hệ</a> hoặc thông tin liên hệ do tổ chức triển khai VDaAgent công bố.</p></section>
          </div>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
