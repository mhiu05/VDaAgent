import { PublicFooter } from "@/components/public-footer";
import { PublicNavbar } from "@/components/public-navbar";

export const metadata = { title: "Điều khoản sử dụng - VDaAgent" };

export default function TermsPage() {
  return (
    <div className="public-page">
      <PublicNavbar />
      <main className="pub-section" style={{ flex: 1 }}>
        <div className="pub-container" style={{ maxWidth: "900px" }}>
          <span className="pub-eyebrow">ĐIỀU KHOẢN SỬ DỤNG</span>
          <h1>Điều khoản sử dụng</h1>
          <p className="lead">Ngày hiệu lực: 25 tháng 8 năm 2026</p>
          <div style={{ display: "grid", gap: "28px", marginTop: "36px", lineHeight: 1.7 }}>
            <section><h2>1. Chấp thuận</h2><p>Bằng việc truy cập hoặc sử dụng VDaAgent, bạn xác nhận đã đọc và chấp nhận các điều khoản này. Nếu sử dụng dịch vụ cho một tổ chức, bạn xác nhận mình có thẩm quyền đại diện cho tổ chức đó.</p></section>
            <section><h2>2. Sử dụng được phép</h2><p>Bạn chỉ được sử dụng VDaAgent cho các mục đích hợp pháp và với dữ liệu mà bạn được phép xử lý. Bạn phải bảo vệ thông tin đăng nhập và không được vượt qua các cơ chế xác thực, phân quyền, giới hạn truy vấn hoặc kiểm soát bảo mật.</p></section>
            <section><h2>3. Phân tích dữ liệu và đầu ra của trợ lý AI</h2><p>Kết quả lập hồ sơ và phản hồi của trợ lý AI được cung cấp để hỗ trợ phân tích, không thay thế việc xem xét chuyên môn hoặc quyết định kinh doanh. Bạn chịu trách nhiệm kiểm tra bằng chứng, phạm vi dữ liệu và mức độ phù hợp của mọi kết quả trước khi sử dụng.</p></section>
            <section><h2>5. Quyền sở hữu</h2><p>Bạn giữ quyền đối với dữ liệu mình cung cấp. VDaAgent và các thành phần của nền tảng thuộc về chủ sở hữu hoặc bên cấp phép tương ứng. Bạn cấp cho VDaAgent quyền giới hạn cần thiết để lưu trữ và xử lý dữ liệu nhằm cung cấp các tính năng được yêu cầu.</p></section>
            <section><h2>6. Tính khả dụng và trách nhiệm</h2><p>Dịch vụ có thể được thay đổi, bảo trì hoặc tạm thời không khả dụng vì lý do kỹ thuật, bảo mật hoặc pháp lý. Trong phạm vi pháp luật cho phép, VDaAgent không chịu trách nhiệm cho tổn thất phát sinh do dựa vào đầu ra chưa được xác minh hoặc tài khoản và dịch vụ bên thứ ba do bạn kiểm soát.</p></section>
            <section><h2>7. Thay đổi</h2><p>Chúng tôi có thể cập nhật các điều khoản này để phản ánh thay đổi về sản phẩm hoặc pháp lý. Phiên bản mới nhất sẽ được công bố trên trang này cùng ngày hiệu lực. Việc tiếp tục sử dụng sau ngày đó đồng nghĩa với việc bạn chấp nhận các điều khoản cập nhật.</p></section>
            <section><h2>8. Liên hệ</h2><p>Để được hỗ trợ, hãy dùng trang <a href="/contact">Liên hệ</a> hoặc thông tin liên hệ do tổ chức triển khai VDaAgent công bố.</p></section>
          </div>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
