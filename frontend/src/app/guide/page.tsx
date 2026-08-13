import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { PublicNavbar } from "@/components/public-navbar";

type Step = { title: string; description: string };

const guestSteps: Step[] = [
  { title: "Chọn vai trò trên thanh điều hướng", description: "Từ Trang chủ hoặc Hướng dẫn, chọn Viewer, Analyst hoặc Admin. Đây là phiên dùng thử, không cần tạo tài khoản Supabase." },
  { title: "Mở workspace dùng thử", description: "Ứng dụng tạo một guest workspace riêng cho tab trình duyệt hiện tại và áp dụng đúng bộ quyền của vai trò bạn chọn." },
  { title: "Dùng các tính năng được cấp quyền", description: "Viewer xem report đã publish; Analyst upload, profiling, review và phân tích; Admin có thêm quản lý report, thành viên và cài đặt." },
  { title: "Kết thúc hoặc đổi vai trò", description: "Có thể quay lại Trang chủ để xem tổng quan hoặc chọn role khác. Dữ liệu trial chỉ phục vụ demo và không nên dùng cho dữ liệu cần lưu lâu dài." },
];

const signedInSteps: Step[] = [
  { title: "Đăng nhập hoặc Đăng ký", description: "Đăng nhập bằng tài khoản đã có. Nếu đăng ký mới, chọn role theo policy của workspace; sau khi xác nhận email, hệ thống tạo hoặc kích hoạt workspace cá nhân." },
  { title: "Chọn workspace", description: "Nếu tài khoản có nhiều workspace, chọn workspace cần làm việc. Role và permission được đọc từ membership, không lấy từ lựa chọn trên giao diện." },
  { title: "Làm việc với dữ liệu thật", description: "Analyst và Admin có thể upload, tạo profile và phân tích. Dataset, metadata, audit và quyền được gắn với workspace; file gốc dùng storage đã cấu hình." },
  { title: "Lưu kết quả và đăng xuất", description: "Kết quả thuộc workspace đã chọn và có thể tiếp tục dùng ở các phiên sau. Khi hoàn tất, chọn Đăng xuất để kết thúc session." },
];

const analystFlow: Step[] = [
  { title: "Tải dataset lên", description: "Mở Bộ dữ liệu → Bộ dữ liệu mới hoặc Chat Agent → chọn file CSV, TSV, Parquet hoặc JSON. Với workspace đăng nhập, Admin cần kết nối Google Drive trước nếu policy yêu cầu." },
  { title: "Chọn cách profiling", description: "Sampling chạy nhanh và có uncertainty; Full scan tính trên toàn bộ file, có thể lâu hơn và cần nhiều RAM. Đặt tên dataset trước khi bắt đầu." },
  { title: "Đọc báo cáo profile", description: "Compute engine tạo row count, column stats, null, cardinality, uniqueness, outlier và top values. Số liệu đến từ compute engine, không phải LLM tự suy đoán." },
  { title: "Review proposals", description: "Mở Xem xét đề xuất để xử lý semantic type, candidate key và PII. Với từng proposal, chọn Xác nhận, Từ chối hoặc Chỉnh sửa; không thể tiếp tục Q&A khi còn proposal pending." },
  { title: "Hỏi Agent trên evidence", description: "Sau khi review xong, quay lại Chat Agent để hỏi về chất lượng, thống kê hoặc rủi ro. Câu trả lời chỉ dùng metric và evidence của profile đã được xác nhận." },
  { title: "Tạo phân tích có mục tiêu", description: "Từ profile chọn Tạo phiên phân tích hoặc mở Phân tích → Bắt đầu phân tích. Nhập Profile run ID, business goal và chọn Quick Answer hoặc Deep Analysis." },
  { title: "Hoàn tất context và quality gate", description: "Khai báo row grain, dimensions và measures. Duyệt context để chạy quality gate; nếu bị blocked, sửa context hoặc phạm vi trước khi tính aggregate." },
  { title: "Chạy aggregate và xuất kết quả", description: "Chọn count, count distinct, sum, mean hoặc median; chọn cột measure và group by nếu cần. Kết quả có evidence/hash, sau đó có thể kiểm định, so sánh drift hoặc xuất PDF/JSON." },
];

const roleDetails = [
  { role: "Viewer", title: "Theo dõi kết quả", description: "Phù hợp với người chỉ cần đọc kết quả đã được công bố.", items: ["Xem report đã publish", "Hỏi đáp trên report đã publish", "Xuất report"] },
  { role: "Analyst", title: "Tạo và kiểm tra evidence", description: "Phù hợp với người chuẩn bị dữ liệu và chạy phân tích.", items: ["Toàn bộ quyền Viewer", "Upload, profiling, test, drift và Q&A theo profile", "Tạo và submit report draft"] },
  { role: "Admin", title: "Quản trị workspace", description: "Phù hợp với người chịu trách nhiệm vận hành và phê duyệt.", items: ["Toàn bộ quyền Analyst", "Quản lý thành viên và cài đặt workspace", "Review, publish, archive report và xem audit"] },
];

function StepList({ steps }: { steps: Step[] }) {
  return <ol className="guide-step-list">{steps.map((step, index) => <li key={step.title}><span>{index + 1}</span><div><strong>{step.title}</strong><p>{step.description}</p></div></li>)}</ol>;
}

function RouteCard({ number, label, title, description, steps, note }: { number: string; label: string; title: string; description: string; steps: Step[]; note: string }) {
  return <section className="panel guide-route-card">
    <div className="guide-section-heading"><span className="guide-section-number">{number}</span><div><p className="eyebrow">{label}</p><h2>{title}</h2><p>{description}</p></div></div>
    <StepList steps={steps} />
    <div className="guide-note"><span aria-hidden="true">i</span><p>{note}</p></div>
  </section>;
}

export default function GuidePage() {
  return <div className="public-page guide-public-page"><PublicNavbar /><main className="guide-page">
    <PageHeader
      eyebrow="Trung tâm hướng dẫn"
      title="Hướng dẫn sử dụng P-170"
      description="Chọn đúng luồng truy cập, hiểu phạm vi quyền và đi từ dataset đến kết quả phân tích có evidence. Trang này tách riêng trải nghiệm dùng thử không đăng nhập và workspace đã đăng nhập."
      action={<div className="inline-actions"><Link className="button primary" href="/chat">Mở Chat Agent</Link><Link className="button secondary" href="/login">Đăng nhập</Link></div>}
    />

    <div className="guide-overview"><span aria-hidden="true">✦</span><p><strong>Luồng cốt lõi:</strong> chọn workspace → upload dataset → profiling → review metadata → hỏi Agent hoặc tạo analysis → quality gate → aggregate và xuất kết quả.</p></div>

    <section className="guide-intro-panel panel">
      <div><p className="eyebrow">Bắt đầu từ đâu?</p><h2>Hai cách sử dụng, cùng một quy trình dữ liệu</h2><p>Guest và user đăng nhập đều đi qua API và workspace context. Khác biệt chính là thời gian lưu trữ, danh tính và nguồn dữ liệu cá nhân.</p></div>
      <div className="guide-quick-links"><Link href="/">Xem tổng quan role</Link><Link href="/signup">Tạo tài khoản</Link><Link href="/dashboard">Mở workspace</Link></div>
    </section>

    <div className="guide-route-grid">
      <RouteCard number="01" label="Chưa đăng nhập · Guest trial" title="Dùng thử không cần tài khoản" description="Dành cho người muốn kiểm tra user flow nhanh. Guest mode phải được bật ở cả backend và frontend; nếu không thấy nút role, hãy đăng nhập." steps={guestSteps} note="Guest token và chat history chỉ nằm trong session của tab. Workspace/file trial có thể được dọn khi đổi role hoặc hết phiên; không dùng luồng này cho dữ liệu production hoặc dữ liệu cần giữ lâu dài." />
      <RouteCard number="02" label="Đã đăng nhập · Workspace thật" title="Làm việc với dữ liệu cần lưu lại" description="Dành cho công việc thực tế, cộng tác và kết quả cần truy cập lại. Supabase quản lý Auth, workspace, permission và metadata; storage file tuân theo cấu hình của workspace." steps={signedInSteps} note="Admin là người kết nối hoặc ngắt Google Drive ở cấp workspace. Sau khi kết nối, Analyst dùng connection đó để upload; Viewer không cần quyền upload." />
    </div>

    <section className="panel guide-section guide-analyst-flow">
      <div className="guide-section-heading"><span className="guide-section-number">03</span><div><p className="eyebrow">Luồng Analyst · Admin</p><h2>Từ dataset đến báo cáo phân tích</h2><p>Đây là chuỗi thao tác chính khi bạn muốn tạo evidence và trả lời một câu hỏi kinh doanh cụ thể.</p></div></div>
      <StepList steps={analystFlow} />
    </section>

    <section className="guide-role-section">
      <div className="guide-section-heading guide-section-heading-plain"><div><p className="eyebrow">Quyền theo vai trò</p><h2>Vai trò quyết định bạn nhìn thấy thao tác nào</h2><p>Frontend chỉ ẩn thao tác để dễ dùng; backend vẫn kiểm tra permission ở mọi request.</p></div></div>
      <div className="guide-role-grid">{roleDetails.map((item) => <article className="panel guide-role-card" key={item.role}><span className="guide-role-badge">{item.role}</span><h3>{item.title}</h3><p>{item.description}</p><ul>{item.items.map((permission) => <li key={permission}><span aria-hidden="true">✓</span>{permission}</li>)}</ul></article>)}</div>
    </section>

    <section className="panel guide-when-section"><div><p className="eyebrow">Chọn luồng phù hợp</p><h2>Khi nào nên đăng nhập?</h2></div><div className="guide-when-grid"><div><b>Chọn Guest</b><p>Muốn xem nhanh giao diện, thử permission hoặc chạy demo với dữ liệu không quan trọng.</p></div><div><b>Chọn đăng nhập</b><p>Cần lưu dataset, giữ lịch sử, cộng tác trong workspace, kết nối Drive hoặc publish report.</p></div><div><b>Nếu bị từ chối quyền</b><p>Kiểm tra role hiện tại và workspace đang chọn. 401 là session không hợp lệ; 403 là role chưa có capability; 404 thường là resource không thuộc workspace.</p></div></div></section>

    <section className="panel guide-privacy"><div><p className="eyebrow">Nguyên tắc an toàn</p><h2>Dữ liệu được kiểm soát ở từng bước</h2></div><div className="guide-privacy-points"><span><b>PII</b><small>Luôn chờ human review</small></span><span><b>Evidence</b><small>Kết quả có nguồn kiểm chứng</small></span><span><b>Raw rows</b><small>Không render trong giao diện</small></span></div></section>
  </main></div>;
}
