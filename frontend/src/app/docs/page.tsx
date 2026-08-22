import { PublicNavbar } from "@/components/public-navbar";

export const metadata = { title: "Tài liệu - VDaAgent" };

export default function DocsPage() {
  return (
    <div className="public-page">
      <PublicNavbar />
      <main className="main-content" style={{ maxWidth: 900 }}>
        <h1 className="page-title">Tài liệu tham khảo & Thuật ngữ</h1>
        <p className="page-description">
          Từ điển thuật ngữ dành cho Data Analyst, bao gồm các khái niệm phân tích dữ liệu chuyên sâu và các thuật ngữ đặc thù trong hệ thống VDaAgent.
        </p>

        <div className="panel" style={{ marginTop: 32 }}>
          <h2>1. Data Quality & Profiling (Chất lượng Dữ liệu)</h2>
          <p style={{ color: 'var(--muted)', marginBottom: 20 }}>Các chỉ số đánh giá sức khỏe và độ tin cậy của dữ liệu trước khi phân tích.</p>
          <div className="grid two" style={{ gap: '20px' }}>
            <div style={{ padding: '16px', background: 'var(--canvas)', borderRadius: '8px' }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem' }}>Missing (Dữ liệu khuyết thiếu)</h3>
              <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.6 }}>Tỷ lệ hoặc số lượng các giá trị bị rỗng (null, NaN, khoảng trắng) trong một cột. Missing rate cao ảnh hưởng đến độ tin cậy của thuật toán.</p>
            </div>
            <div style={{ padding: '16px', background: 'var(--canvas)', borderRadius: '8px' }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem' }}>Unique (Tính duy nhất)</h3>
              <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.6 }}>Số lượng các giá trị khác biệt nhau hoàn toàn trong một cột. Ví dụ: Cột ID phải có tỷ lệ Unique là 100%.</p>
            </div>
            <div style={{ padding: '16px', background: 'var(--canvas)', borderRadius: '8px' }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem' }}>Cardinality (Lực lượng)</h3>
              <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.6 }}>Mức độ đa dạng của các giá trị. High-cardinality (như ID, Tên) rất đa dạng. Low-cardinality (như Giới tính, Trạng thái) có rất ít giá trị khác nhau.</p>
            </div>
            <div style={{ padding: '16px', background: 'var(--canvas)', borderRadius: '8px' }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem' }}>Outlier (Ngoại lệ)</h3>
              <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.6 }}>Các giá trị bất thường, nằm quá xa so với phân bố chung của dữ liệu (thường dùng quy tắc IQR hoặc Z-score để phát hiện).</p>
            </div>
            <div style={{ padding: '16px', background: 'var(--canvas)', borderRadius: '8px' }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem' }}>Completeness (Độ hoàn thiện)</h3>
              <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.6 }}>Phần trăm dữ liệu hợp lệ so với tổng số dòng. Bằng 100% trừ đi tỷ lệ Missing và Invalid.</p>
            </div>
            <div style={{ padding: '16px', background: 'var(--canvas)', borderRadius: '8px' }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem' }}>Skewness (Độ lệch phân bố)</h3>
              <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.6 }}>Sự mất đối xứng trong phân bố dữ liệu số. Dữ liệu có thể lệch trái (negative skew) hoặc lệch phải (positive skew).</p>
            </div>
          </div>

          <h2 style={{ marginTop: 40 }}>2. Statistical Metrics (Chỉ số Thống kê)</h2>
          <p style={{ color: 'var(--muted)', marginBottom: 20 }}>Các đại lượng thống kê mô tả đặc điểm của một biến số.</p>
          <div className="grid two" style={{ gap: '20px' }}>
            <div style={{ padding: '16px', background: 'var(--canvas)', borderRadius: '8px' }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem' }}>Mean & Median</h3>
              <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.6 }}><strong>Mean:</strong> Trung bình cộng. <strong>Median:</strong> Trung vị (giá trị nằm giữa). Nếu Mean và Median chênh lệch lớn, dữ liệu đang có Outlier.</p>
            </div>
            <div style={{ padding: '16px', background: 'var(--canvas)', borderRadius: '8px' }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem' }}>Standard Deviation (Độ lệch chuẩn)</h3>
              <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.6 }}>Đo lường mức độ phân tán của dữ liệu xung quanh giá trị trung bình. Độ lệch chuẩn càng lớn, dữ liệu càng biến động.</p>
            </div>
            <div style={{ padding: '16px', background: 'var(--canvas)', borderRadius: '8px' }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem' }}>Correlation (Tương quan)</h3>
              <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.6 }}>Mối liên hệ tuyến tính giữa hai cột dữ liệu số (thường dùng hệ số Pearson). Nằm trong khoảng [-1, 1].</p>
            </div>
            <div style={{ padding: '16px', background: 'var(--canvas)', borderRadius: '8px' }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem' }}>Quantiles (Phân vị)</h3>
              <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.6 }}>Các điểm cắt chia dữ liệu thành các phần bằng nhau (ví dụ: Q1 = 25%, Q2 = 50%, Q3 = 75%). Dùng để vẽ boxplot.</p>
            </div>
          </div>

          <h2 style={{ marginTop: 40 }}>3. Semantic Data Types (Kiểu dữ liệu ngữ nghĩa)</h2>
          <p style={{ color: 'var(--muted)', marginBottom: 20 }}>Cách hệ thống nhận diện ý nghĩa của dữ liệu để áp dụng phương pháp phân tích thích hợp.</p>
          <div className="grid two" style={{ gap: '20px' }}>
            <div style={{ padding: '16px', background: 'var(--canvas)', borderRadius: '8px' }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem' }}>Numeric (Số học)</h3>
              <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.6 }}>Các con số có ý nghĩa về mặt lượng (Doanh thu, Tuổi). Hỗ trợ tính trung bình, phân phối histogram.</p>
            </div>
            <div style={{ padding: '16px', background: 'var(--canvas)', borderRadius: '8px' }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem' }}>Categorical (Phân loại)</h3>
              <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.6 }}>Dữ liệu dạng danh mục (Giới tính, Khu vực). Thường được phân tích bằng biểu đồ tần suất (Bar chart, Pie chart).</p>
            </div>
            <div style={{ padding: '16px', background: 'var(--canvas)', borderRadius: '8px' }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem' }}>DateTime (Thời gian)</h3>
              <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.6 }}>Ngày tháng năm. Cần thiết cho việc phân tích chuỗi thời gian (Time-series analysis) và nhận diện xu hướng.</p>
            </div>
            <div style={{ padding: '16px', background: 'var(--canvas)', borderRadius: '8px' }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem' }}>PII (Thông tin định danh)</h3>
              <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.6 }}>Personally Identifiable Information. (Email, SĐT, Số CCCD). VDaAgent sẽ tự động đánh dấu để che mờ (redact) nhằm bảo mật.</p>
            </div>
          </div>

          <h2 style={{ marginTop: 40 }}>4. VDaAgent Concepts (Khái niệm trong Hệ thống)</h2>
          <p style={{ color: 'var(--muted)', marginBottom: 20 }}>Các thuật ngữ đặc thù trong kiến trúc và quy trình của VDaAgent.</p>
          <div className="grid two" style={{ gap: '20px' }}>
            <div style={{ padding: '16px', background: 'var(--canvas)', borderRadius: '8px', gridColumn: '1 / -1' }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem' }}>Profile Run</h3>
              <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.6 }}>Đơn vị làm việc trung tâm. Một phiên chạy phân tích trên một dataset cụ thể. Mọi biểu đồ, báo cáo, và bối cảnh hỏi đáp đều được đóng gói trong một Profile Run.</p>
            </div>
            <div style={{ padding: '16px', background: 'var(--canvas)', borderRadius: '8px' }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem' }}>Official Evidence</h3>
              <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.6 }}>Các biểu đồ và số liệu đã được hệ thống xác thực bằng Compute Deterministic, có lưu lại result_hash và provenance để truy xuất nguồn gốc rõ ràng.</p>
            </div>
            <div style={{ padding: '16px', background: 'var(--canvas)', borderRadius: '8px' }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem' }}>Report Draft & Snapshot</h3>
              <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.6 }}><strong>Draft:</strong> Bản nháp đang thiết kế của báo cáo. <strong>Snapshot:</strong> Trạng thái "đóng băng" bất biến của báo cáo để đảm bảo số liệu không bị thay đổi ngầm sau khi chốt.</p>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
