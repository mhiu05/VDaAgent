import { PublicNavbar } from "@/components/public-navbar";
import { PublicFooter } from "@/components/public-footer";
import { DocsTableOfContents } from "@/components/docs-table-of-contents";

export const metadata = { title: "Tài liệu - VDaAgent" };

export default function DocsPage() {
  return (
    <div className="public-page">
      <PublicNavbar />
      <main style={{ flex: 1 }}>
        <section className="pub-section bg-surface" style={{ padding: "64px 0" }}>
          <div className="pub-container">
            <span className="pub-eyebrow">TÀI LIỆU VDAAGENT</span>
            <h1 style={{ fontSize: "40px", fontWeight: 700, margin: "16px 0 24px", color: "var(--pub-ink)" }}>Khái niệm, workflow và cách đọc kết quả.</h1>
            <p style={{ fontSize: "18px", color: "var(--pub-muted)", maxWidth: "800px" }}>
              Từ điển thuật ngữ dành cho Data Analyst, bao gồm các khái niệm phân tích dữ liệu chuyên sâu và các thuật ngữ đặc thù trong hệ thống VDaAgent.
            </p>
          </div>
        </section>

        <section className="pub-container pub-docs-layout" style={{ marginTop: "0" }}>
          <DocsTableOfContents />
          
          <div className="pub-docs-article">
            <h2 id="data-quality">1. Data Quality & Profiling (Chất lượng Dữ liệu)</h2>
            <p>Các chỉ số đánh giá sức khỏe và độ tin cậy của dữ liệu trước khi phân tích.</p>
            
            <h3>Missing (Dữ liệu khuyết thiếu)</h3>
            <p>Tỷ lệ hoặc số lượng các giá trị bị rỗng (null, NaN, khoảng trắng) trong một cột. Missing rate cao ảnh hưởng đến độ tin cậy của thuật toán.</p>
            <div className="pub-callout">
              <strong>Công thức</strong>
              <p><code>null_count / total_rows</code></p>
            </div>
            
            <h3>Unique & Cardinality (Tính duy nhất và Lực lượng)</h3>
            <p><strong>Unique:</strong> Số lượng các giá trị khác biệt nhau hoàn toàn trong một cột. Ví dụ: Cột ID phải có tỷ lệ Unique là 100%.</p>
            <p><strong>Cardinality:</strong> Mức độ đa dạng của các giá trị. High-cardinality (như ID, Tên) rất đa dạng. Low-cardinality (như Giới tính, Trạng thái) có rất ít giá trị khác nhau.</p>
            
            <h3>Outlier (Ngoại lệ)</h3>
            <p>Các giá trị bất thường, nằm quá xa so với phân bố chung của dữ liệu (thường dùng quy tắc IQR hoặc Z-score để phát hiện).</p>

            <h2 id="statistical">2. Statistical Metrics (Chỉ số Thống kê)</h2>
            <p>Các đại lượng thống kê mô tả đặc điểm của một biến số.</p>
            
            <h3>Mean & Median</h3>
            <p><strong>Mean:</strong> Trung bình cộng. <strong>Median:</strong> Trung vị (giá trị nằm giữa). Nếu Mean và Median chênh lệch lớn, dữ liệu đang có Outlier hoặc bị lệch (skewed).</p>
            
            <h3>Standard Deviation (Độ lệch chuẩn)</h3>
            <p>Đo lường mức độ phân tán của dữ liệu xung quanh giá trị trung bình. Độ lệch chuẩn càng lớn, dữ liệu càng biến động.</p>
            
            <h3>Correlation (Tương quan)</h3>
            <p>Mối liên hệ tuyến tính giữa hai cột dữ liệu số (thường dùng hệ số Pearson). Nằm trong khoảng [-1, 1]. VDaAgent tự động tính toán correlation matrix cho các cột số để tìm ra các biến có ảnh hưởng lẫn nhau.</p>

            <h2 id="semantic">3. Semantic Data Types (Kiểu dữ liệu ngữ nghĩa)</h2>
            <p>Cách hệ thống nhận diện ý nghĩa của dữ liệu để áp dụng phương pháp phân tích thích hợp thay vì chỉ nhìn vào kiểu dữ liệu kỹ thuật (string, int).</p>
            
            <h3>Numeric (Số học)</h3>
            <p>Các con số có ý nghĩa về mặt lượng (Doanh thu, Tuổi). Hỗ trợ tính trung bình, phân phối histogram.</p>
            
            <h3>Categorical (Phân loại)</h3>
            <p>Dữ liệu dạng danh mục (Giới tính, Khu vực). Thường được phân tích bằng biểu đồ tần suất (Bar chart, Pie chart).</p>
            
            <h3>DateTime (Thời gian)</h3>
            <p>Ngày tháng năm. Cần thiết cho việc phân tích chuỗi thời gian (Time-series analysis) và nhận diện xu hướng.</p>
            
            <div className="pub-callout pub-callout-warning">
              <strong>PII (Thông tin định danh)</strong>
              <p>Personally Identifiable Information. (Email, SĐT, Số CCCD). VDaAgent sẽ tự động đánh dấu để che mờ (redact) nhằm bảo mật.</p>
            </div>

            <h2 id="system">4. VDaAgent Concepts (Khái niệm trong Hệ thống)</h2>
            <p>Các thuật ngữ đặc thù trong kiến trúc và quy trình của VDaAgent.</p>
            
            <h3>Profile Run</h3>
            <p>Đơn vị làm việc trung tâm. Một phiên chạy phân tích trên một dataset cụ thể. Mọi biểu đồ, báo cáo, và bối cảnh hỏi đáp đều được đóng gói trong một Profile Run thuộc một Workspace.</p>
            
            <h3>Official Evidence</h3>
            <p>Các biểu đồ và số liệu đã được hệ thống xác thực bằng Compute Deterministic, có lưu lại result_hash và provenance để truy xuất nguồn gốc rõ ràng. LLM chỉ được cấp quyền đọc thông tin từ Official Evidence, không được đọc file thô.</p>
            
            <h3>Report Draft & Snapshot</h3>
            <p><strong>Draft:</strong> Bản nháp đang thiết kế của báo cáo.<br/><strong>Snapshot:</strong> Trạng thái "đóng băng" bất biến của báo cáo để đảm bảo số liệu không bị thay đổi ngầm sau khi chốt, là bản được dùng để xuất PDF/JSON chia sẻ.</p>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
