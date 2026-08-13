import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { PublicNavbar } from "@/components/public-navbar";

type Step = { title: string; description: string; action?: string };

const guestSteps: Step[] = [
  { title: "Bật guest mode và chọn vai trò", description: "Từ Trang chủ hoặc Hướng dẫn, chọn Viewer, Analyst hoặc Admin trên navbar. Nếu không thấy lựa chọn này, guest mode chưa được bật ở backend/frontend; hãy đăng nhập.", action: "Trang chủ → chọn role" },
  { title: "Mở guest workspace", description: "Ứng dụng tạo một token và workspace tạm cho browser session hiện tại. Bạn không cần email, mật khẩu hay tài khoản Supabase.", action: "Workspace dùng thử" },
  { title: "Thử đúng tính năng của role", description: "Viewer đọc report; Analyst upload và chạy profiling/analysis; Admin thử member, report workflow và settings. Backend vẫn kiểm tra permission như luồng đăng nhập.", action: "Dashboard" },
  { title: "Kết thúc phiên thử", description: "Đổi role hoặc dọn guest session khi không cần nữa. Guest data có retention giới hạn, có thể bị cleanup và không phù hợp với dữ liệu production.", action: "Đổi role / Đăng nhập" },
];

const signedInSteps: Step[] = [
  { title: "Đăng nhập hoặc tạo tài khoản", description: "Chọn Đăng nhập nếu đã có tài khoản. Chọn Đăng ký nếu workspace cho phép self-signup; có thể cần xác nhận email trước khi sử dụng.", action: "Đăng nhập / Đăng ký" },
  { title: "Chọn workspace và kiểm tra role", description: "Nếu bạn thuộc nhiều workspace, chọn đúng workspace trước khi upload hoặc đọc report. Role đến từ membership của workspace, không phải nút role trên navbar.", action: "Dashboard → workspace controls" },
  { title: "Làm việc với dữ liệu thật", description: "Dataset, profile run, proposal, report draft, audit và lịch sử được gắn với workspace đã chọn để có thể quay lại và cộng tác.", action: "Bộ dữ liệu" },
  { title: "Đăng xuất khi dùng xong", description: "Đăng xuất để kết thúc Supabase session trên thiết bị hiện tại. Dữ liệu workspace không bị xóa khi đăng xuất.", action: "Đăng xuất" },
];

const analystFlow: Step[] = [
  { title: "1. Tải dataset lên", description: "Vào Bộ dữ liệu → Bộ dữ liệu mới. Chọn CSV, TSV, Parquet hoặc JSON. Với file lớn, kiểm tra giới hạn provider trước khi upload.", action: "Bộ dữ liệu → Bộ dữ liệu mới" },
  { title: "2. Chọn scan mode", description: "Sample chạy nhanh và phù hợp khám phá; Full scan đọc toàn bộ source và có thể lâu hơn. Sample result được đánh dấu approximate, không mặc định là số liệu exact.", action: "Sample / Full" },
  { title: "3. Đọc profile report", description: "Xem row count, schema, dtype, missingness, cardinality, uniqueness, outlier, top values, correlation và risk warnings. Các con số do compute engine tạo ra.", action: "Mở báo cáo" },
  { title: "4. Review metadata proposal", description: "Vào Xem xét proposals và xử lý semantic type, candidate key, PII. Với mỗi proposal, chọn Xác nhận, Từ chối hoặc Chỉnh sửa. PII pending vẫn được coi là nhạy cảm.", action: "Xem xét proposals" },
  { title: "5. Hỏi Agent trên evidence", description: "Sau khi review, mở Chat Agent và chọn profile phù hợp. Hỏi về metric, chất lượng hoặc rủi ro; Agent phải dựa trên evidence của profile, không tự tạo số liệu.", action: "Chat Agent" },
  { title: "6. Chạy kiểm định hoặc drift", description: "Trong Kiểm định & Drift, chọn test và cột cần kiểm định hoặc chọn baseline cùng dataset để so sánh drift. Kết quả được lưu lại theo profile run.", action: "Kiểm định & Drift" },
  { title: "7. Tạo Analysis Session", description: "Từ profile chọn Tạo phiên phân tích. Nhập business goal, audience, output và chọn Quick Answer hoặc Deep Analysis. Mỗi session gắn với một profile run.", action: "Tạo phiên phân tích" },
  { title: "8. Khai báo semantic context", description: "Row grain mô tả một dòng đại diện cho gì; dimensions là cột để chia nhóm; measures là cột để tính sum/mean/median. Nhập đúng tên cột và phân tách bằng dấu phẩy.", action: "Context" },
  { title: "9. Duyệt quality gate", description: "Nút Duyệt context & chạy quality gate sẽ approve version hiện tại và kiểm tra profile, proposal, row grain, missingness, timezone và độ sẵn sàng của metric. Nếu blocked, sửa context hoặc source rồi chạy lại.", action: "Quality gate" },
  { title: "10. Khám phá theo nhóm", description: "Chọn So sánh nhóm, Tìm nhóm dẫn đầu hoặc Tìm nhóm thấp nhất. Chọn dimension, metric, sort và filter để tìm khác biệt giữa các phân khúc; đây là bước khác với profiling report tổng quát.", action: "Trả lời câu hỏi" },
];

const roleDetails = [
  { role: "Viewer", title: "Đọc kết quả đã công bố", description: "Dành cho người cần theo dõi và chia sẻ kết quả an toàn.", items: ["Xem report đã publish trong workspace", "Hỏi đáp trên report được phép đọc", "Export report theo capability"] },
  { role: "Analyst", title: "Tạo và kiểm tra evidence", description: "Dành cho người chuẩn bị dữ liệu, profiling và phân tích.", items: ["Toàn bộ quyền Viewer", "Upload, profile, review, test, drift và Q&A theo profile", "Tạo Analysis và report draft/submit"] },
  { role: "Admin", title: "Quản trị workspace", description: "Dành cho người vận hành và phê duyệt kết quả.", items: ["Toàn bộ quyền Analyst", "Quản lý member và workspace settings", "Review/publish/archive report, audit và kết nối storage"] },
];

const troubleshooting = [
  ["Không thấy role guest", "Kiểm tra AUTH_ALLOW_GUEST và NEXT_PUBLIC_AUTH_ALLOW_GUEST ở backend/frontend, sau đó restart cả hai server."],
  ["Không upload được file", "Kiểm tra role có quyền upload, bucket/provider, DATABASE_URL và giới hạn file của Supabase/Google Drive. Supabase Free có thể giới hạn 50 MB dù app cho phép lớn hơn."],
  ["Quality gate bị blocked", "Đọc từng issue trong Quality gate. Thường cần review proposal còn pending, khai báo row grain, chọn đúng dimensions/measures hoặc xử lý missingness/timezone."],
  ["Không chạy được exploration", "Context phải approved, quality gate không được blocked, dimension/measure phải là cột đã khai báo và không phải PII."],
  ["Failed to fetch", "Mở http://localhost:8000/health, kiểm tra NEXT_PUBLIC_API_URL, CORS và backend log. Nếu HTTP trả 401/403/409, xử lý auth, role hoặc workspace thay vì chỉ reload frontend."],
];

function StepList({ steps }: { steps: Step[] }) {
  return <ol className="guide-step-list">{steps.map((step, index) => <li key={step.title}><span>{index + 1}</span><div><strong>{step.title}</strong>{step.action && <small className="guide-step-action">{step.action}</small>}<p>{step.description}</p></div></li>)}</ol>;
}

function RouteCard({ number, label, title, description, steps, note }: { number: string; label: string; title: string; description: string; steps: Step[]; note: string }) {
  return <section className="panel guide-route-card"><div className="guide-section-heading"><span className="guide-section-number">{number}</span><div><p className="eyebrow">{label}</p><h2>{title}</h2><p>{description}</p></div></div><StepList steps={steps} /><div className="guide-note"><span aria-hidden="true">i</span><p>{note}</p></div></section>;
}

export default function GuidePage() {
  return <div className="public-page guide-public-page"><PublicNavbar /><main className="guide-page">
    <PageHeader eyebrow="Trung tâm hướng dẫn" title="Dùng VDaAgent đúng theo từng luồng" description="VDaAgent có hai cách sử dụng: guest trial để thử nhanh không cần tài khoản và workspace đăng nhập để lưu dữ liệu, cộng tác và vận hành lâu dài. Hãy chọn luồng phù hợp trước khi bắt đầu." action={<div className="inline-actions"><Link className="button primary" href="/dashboard">Mở workspace</Link><Link className="button secondary" href="/login">Đăng nhập</Link></div>} />

    <div className="guide-overview"><span aria-hidden="true">✦</span><p><strong>Luồng chuẩn của Analyst:</strong> Upload → Profiling → Review proposal → Report/Q&A/Test/Drift → Analysis context → Quality gate → Exploration → Export evidence.</p></div>

    <section className="guide-intro-panel panel"><div><p className="eyebrow">BẮT ĐẦU TỪ ĐÂU?</p><h2>Chọn chế độ trước, chọn role sau</h2><p>Trang chủ và Hướng dẫn chỉ mang tính tổng quan. Role/workspace thực sự được áp dụng khi bạn bước vào workspace; backend luôn kiểm tra quyền ở mỗi request.</p></div><div className="guide-quick-links"><Link href="/">Trang chủ</Link><Link href="/signup">Đăng ký</Link><Link href="/datasets">Bộ dữ liệu</Link><Link href="/chat">Chat Agent</Link></div></section>

    <div className="guide-route-grid"><RouteCard number="01" label="Chưa đăng nhập · Guest trial" title="Thử sản phẩm không cần tài khoản" description="Dùng khi muốn xem giao diện, thử permission hoặc chạy demo với dữ liệu không quan trọng." steps={guestSteps} note="Guest không dùng SQLite và không đại diện cho tài khoản cá nhân. Metadata vẫn đi qua backend/PostgreSQL; file dùng provider guest được cấu hình. Workspace và file trial có thể bị cleanup, vì vậy không dùng cho dữ liệu production." /><RouteCard number="02" label="Đã đăng nhập · Workspace thật" title="Làm việc và lưu kết quả lâu dài" description="Dùng khi cần giữ dataset, lịch sử, report, membership, Google Drive connection hoặc cộng tác trong workspace." steps={signedInSteps} note="Supabase quản lý Auth; backend resolve membership và permission. Nếu có nhiều workspace, luôn kiểm tra workspace đang chọn trước khi đọc hoặc upload dữ liệu." /></div>

    <section className="panel guide-section guide-analyst-flow"><div className="guide-section-heading"><span className="guide-section-number">03</span><div><p className="eyebrow">Luồng Analyst · Admin</p><h2>Từ dataset đến insight có thể kiểm tra</h2><p>Đi theo thứ tự này để tránh lỗi proposal pending, quality gate blocked hoặc kết quả không đủ context.</p></div></div><StepList steps={analystFlow} /></section>

    <section className="guide-role-section"><div className="guide-section-heading guide-section-heading-plain"><div><p className="eyebrow">QUYỀN THEO VAI TRÒ</p><h2>Role quyết định thao tác được phép</h2><p>Frontend chỉ ẩn/hiện button để dễ dùng; quyền cuối cùng luôn do FastAPI kiểm tra.</p></div></div><div className="guide-role-grid">{roleDetails.map((item) => <article className="panel guide-role-card" key={item.role}><span className="guide-role-badge">{item.role}</span><h3>{item.title}</h3><p>{item.description}</p><ul>{item.items.map((permission) => <li key={permission}><span aria-hidden="true">✓</span>{permission}</li>)}</ul></article>)}</div></section>

    <section className="panel guide-export-section"><div className="guide-section-heading guide-section-heading-plain"><div><p className="eyebrow">REPORT VÀ EXPORT</p><h2>Chọn nội dung trước khi xuất</h2><p>Trong Kiểm định & Drift, phần Xuất báo cáo cho phép chọn từng nhóm nội dung thay vì luôn xuất toàn bộ.</p></div></div><div className="guide-export-grid"><div><b>PDF</b><p>Dễ đọc và chia sẻ; heading được đánh số theo cấp như 1, 6.1, 7.1.1.</p></div><div><b>JSON</b><p>Dùng cho tích hợp máy-máy, lưu provenance và kiểm thử tự động.</p></div><div><b>Checklist</b><p>Có Chọn tất cả, Bỏ chọn tất cả và chọn riêng report, test, drift, Agent hoặc Analysis.</p></div></div><p className="guide-note-text">Cả hai định dạng không chứa raw row hoặc giá trị PII chưa được phép export.</p></section>

    <section className="panel guide-when-section"><div><p className="eyebrow">XỬ LÝ SỰ CỐ</p><h2>Nếu workflow dừng ở một bước</h2></div><div className="guide-troubleshooting">{troubleshooting.map(([title, detail]) => <details key={title}><summary>{title}</summary><p>{detail}</p></details>)}</div></section>

    <section className="panel guide-privacy"><div><p className="eyebrow">NGUYÊN TẮC AN TOÀN</p><h2>Mỗi kết quả đều có boundary</h2></div><div className="guide-privacy-points"><span><b>PII</b><small>Review thủ công trước khi dùng</small></span><span><b>Evidence</b><small>Gắn profile/context/execution</small></span><span><b>Raw rows</b><small>Không trả trong report/API</small></span></div></section>
  </main></div>;
}
