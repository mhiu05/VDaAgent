import Link from "next/link";
import { PublicFooter } from "@/components/public-footer";
import { PublicNavbar } from "@/components/public-navbar";

export const metadata = { title: "Documentation · VDaAgent" };

const glossary = [
  ["Column & dtype", "Column là trường trong dataset; dtype là kiểu được engine suy ra (ví dụ số, chuỗi, datetime). Kiểu suy ra giúp chọn phép tính phù hợp, không tự sửa dữ liệu."],
  ["Row count / column count", "Số dòng và số cột trong phạm vi scan. Với sample scan, số liệu được đánh dấu approximate và có thể có margin of error."],
  ["Null count / null %", "Null count là số giá trị thiếu; null % = null count trên tổng số dòng, hiển thị theo phần trăm. Missingness cao có thể ảnh hưởng đến phép tính và cần tìm nguyên nhân."],
  ["Cardinality", "Số giá trị khác nhau (bỏ qua null) của một cột. Cardinality cao thường gặp ở identifier; cardinality thấp phù hợp cho nhóm/phân loại, nhưng không tự nói lên chất lượng."],
  ["Uniqueness ratio", "Cardinality chia cho số giá trị non-null. Gần 1 có nghĩa phần lớn giá trị là duy nhất; đây là tín hiệu cho candidate key, không phải xác nhận key tự động."],
  ["Top values", "Các giá trị xuất hiện nhiều nhất và số lần xuất hiện, tối đa theo cấu hình profiling. Giá trị của cột được đánh dấu PII không được đưa vào top values."],
  ["Duplicate rows", "Số dòng trùng hoàn toàn sau khi so sánh các cột; duplicate rate là tỷ lệ trên tổng số dòng. Trùng có thể là lỗi hoặc có chủ đích, nên cần hiểu grain trước khi loại bỏ."],
  ["Mean, median, std, quantiles", "Với cột số, engine có thể hiển thị min, max, mean, median, std, q1 (25%) và q3 (75%). Đây là thống kê mô tả, không phải kiểm định nguyên nhân."],
  ["Outlier", "outlier_count là số điểm được đánh dấu theo phương pháp cấu hình (mặc định IQR; hệ thống cũng hỗ trợ z-score/both). Outlier là tín hiệu cần xem xét, không mặc định là lỗi."],
  ["Correlation", "Ma trận tương quan Pearson giữa các cột số, trong khoảng -1 đến 1. Dấu cho biết hướng và trị tuyệt đối cho biết mức liên hệ tuyến tính; correlation không hàm ý causation."],
  ["PII / risk proposal", "PII là thông tin có thể nhận diện cá nhân. Pipeline tạo proposal và cảnh báo/quasi-identifier để Analyst review; PII không được đưa vào top values và output bị giới hạn theo policy."],
];

const concepts = [
  ["Preview", "Kết quả exploratory, bounded và có thể approximate/hết hạn. Dùng để kiểm tra câu hỏi, biểu đồ và limitations trước khi lưu."],
  ["Official Evidence", "Kết quả được Promote sau khi engine revalidate và chạy lại; có result hash, context và provenance để dùng cho Agent và Report Draft."],
  ["Provenance", "Thông tin về nguồn và ngữ cảnh tạo kết quả: Dataset, Profile Run, QuerySpec/context và phạm vi tính. Nó giúp truy lại vì sao một con số xuất hiện."],
  ["Profile Run", "Phiên profiling của một Dataset; là analytical context trung tâm cho profile statistics, chart, Agent, Compare và report."],
  ["Aggregation / grouping / filter", "Aggregation tóm tắt metric (như count hoặc mean); grouping chia kết quả theo dimension; filter giới hạn dòng theo điều kiện được hỗ trợ."],
  ["Distribution / trend / comparison / relationship", "Các câu hỏi trực quan hóa: phân bố giá trị, thay đổi theo thời gian, đối chiếu nhóm hoặc mối liên hệ giữa biến. Chọn chart dựa trên câu hỏi và kiểu dữ liệu."],
];

const statuses = [
  ["Job: queued / running / succeeded / failed", "Trạng thái của profiling job trong worker. Job có thể succeeded nhưng Profile Run còn chờ quyết định proposal."],
  ["Profile Run: created / pending_review / resuming / completed / failed", "created là vừa tạo; pending_review cần quyết định proposal; resuming đang tiếp tục sau review; completed sẵn sàng cho phân tích; failed không sẵn sàng."],
  ["Proposal: pending / confirmed / rejected / edited / auto_confirmed", "pending cần Analyst; confirmed chấp nhận; rejected loại bỏ; edited dùng giá trị chính thức khác; auto_confirmed do pipeline xác nhận theo rule."],
  ["Report: empty / draft / stale / snapshot", "Draft còn chỉnh sửa; stale có lý do cần xem lại; snapshot là phiên bản bất biến dùng ưu tiên cho chia sẻ/export."],
  ["Approximate / uncertainty", "Nhãn cho sample scan hoặc kết quả có ước lượng. Đọc cùng margin of error/limitations thay vì coi là số liệu đầy đủ."],
];

const fundamentals = [
  ["Profiling trước khi phân tích", "Biết grain, kiểu dữ liệu, missingness và duplicate giúp tránh đặt câu hỏi sai hoặc diễn giải sai denominator."],
  ["Data quality checklist", "Kiểm tra null, duplicate, cardinality, outlier, range và PII; ghi lại quyết định review thay vì âm thầm thay đổi dữ liệu."],
  ["Drift", "Compare cho biết signal thay đổi giữa Baseline và Current Profile Run. Drift là dấu hiệu cần điều tra nguồn, thời gian hoặc quy trình; không tự chứng minh nguyên nhân."],
  ["Diễn giải thận trọng", "Phân biệt mô tả với nhân quả, correlation với causation, sample với full scan và Preview với Official Evidence. Luôn đọc limitations."],
];

export default function DocsPage() {
  return <div className="public-page"><PublicNavbar /><main className="pub-content"><section className="pub-section pub-page-hero"><div className="pub-container"><span className="pub-eyebrow">DOCUMENTATION / REFERENCE</span><h1>Tra cứu để đọc<br /><em>đúng một kết quả.</em></h1><p className="pub-lead">Documentation giải thích metric, concept và status trong VDaAgent. Để thực hiện workflow, hãy mở <Link href="/guide">Guide</Link>.</p><nav className="pub-toc pub-toc-compact" aria-label="Mục lục Documentation"><a href="#metrics">Metrics</a><a href="#evidence">Evidence & visualization</a><a href="#statuses">Statuses</a><a href="#fundamentals">Analyst fundamentals</a></nav></div></section>
    <section className="pub-section bg-surface" id="metrics"><div className="pub-container"><div className="pub-section-header"><span className="pub-eyebrow">01 / METRICS GLOSSARY</span><h2>Các con số trong<br /><em>Profile Run.</em></h2><p>Metric được ghi theo contract profiling hiện tại; số liệu sample luôn có nhãn approximate.</p></div><div className="pub-glossary-grid">{glossary.map(([term, body]) => <article key={term}><h3>{term}</h3><p>{body}</p></article>)}</div></div></section>
    <section className="pub-section" id="evidence"><div className="pub-container"><div className="pub-section-header"><span className="pub-eyebrow">02 / EVIDENCE & VISUALIZATION</span><h2>Biết kết quả<br /><em>đến từ đâu.</em></h2></div><div className="pub-glossary-grid">{concepts.map(([term, body]) => <article key={term}><h3>{term}</h3><p>{body}</p></article>)}</div><div className="pub-callout"><b>Quy tắc thực hành</b><p>Preview giúp khám phá. Chỉ Official Evidence đã được revalidate và lưu provenance mới là kết quả bền vững cho Agent hoặc Report Draft.</p></div></div></section>
    <section className="pub-section bg-surface" id="statuses"><div className="pub-container"><div className="pub-section-header"><span className="pub-eyebrow">03 / STATUS GLOSSARY</span><h2>Trạng thái là<br /><em>bước tiếp theo.</em></h2></div><div className="pub-status-list">{statuses.map(([term, body]) => <article key={term}><h3>{term}</h3><p>{body}</p></article>)}</div></div></section>
    <section className="pub-section" id="fundamentals"><div className="pub-container"><div className="pub-section-header"><span className="pub-eyebrow">04 / DATA ANALYST FUNDAMENTALS</span><h2>Một checklist<br /><em>đủ dùng.</em></h2><p>Ghi nhớ ngắn gọn khi đọc một Profile Run hoặc insight.</p></div><div className="pub-principles-grid">{fundamentals.map(([term, body]) => <article key={term}><b>{term}</b><p>{body}</p></article>)}</div><div className="pub-crosslink"><span>Cần thao tác từng bước?</span><Link href="/guide">Quay lại Guide end-to-end →</Link></div></div></section>
  </main><PublicFooter /></div>;
}
