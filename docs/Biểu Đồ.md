# Tính năng Biểu Đồ

## 1. Mục đích

Tính năng **Biểu Đồ** giúp Analyst đi từ một Profile Run đã hoàn tất đến một biểu đồ có thể giải thích, kiểm tra và đưa vào báo cáo.

Mục tiêu không chỉ là tạo ra hình ảnh. Mỗi biểu đồ phải trả lời được một câu hỏi phân tích, có nguồn dữ liệu rõ ràng, có thuật toán được kiểm soát và có insight đi kèm.

Luồng chính:

```text
Profiles
  → Agent hiểu dữ liệu
  → Chọn bài toán
  → Chọn thuật toán
  → Phân tích kết quả
  → Chọn loại biểu đồ
  → Chọn tool vẽ
  → Sinh biểu đồ
  → Agent viết insight
  → Ghim vào Report Draft / Xuất báo cáo
```

## 2. Tính năng phục vụ mục đích gì cho dự án

### 2.1. Biến profile thành kết quả dễ hiểu

Profile hiện tại cung cấp metric, phân phối, tương quan và cảnh báo dữ liệu. Biểu Đồ biến các kết quả này thành dạng trực quan để người dùng nhanh chóng nhận ra:

- nhóm nào cao hoặc thấp;
- xu hướng thay đổi theo thời gian;
- biến nào có quan hệ với nhau;
- dữ liệu có phân phối lệch hoặc có outlier hay không;
- điểm bất thường hoặc drift giữa các phiên dữ liệu.

### 2.2. Giúp Agent trả lời có bằng chứng

Agent không chỉ trả lời bằng văn bản. Agent có thể đề xuất một bài toán, xác định cách tính, tạo biểu đồ và viết insight dựa trên kết quả Official.

Insight phải liên kết với:

- Profile Run;
- semantic context;
- thuật toán hoặc `QuerySpec` đã chạy;
- kết quả chính thức;
- `result_hash` và các giới hạn diễn giải.

### 2.3. Tạo cầu nối tới báo cáo

Biểu đồ và insight có thể được ghim vào Report Draft để sắp xếp, review và xuất PDF/JSON. Người dùng không phải sao chép hình ảnh hoặc nội dung thủ công sang báo cáo.

### 2.4. Giữ an toàn dữ liệu

Biểu Đồ phải sử dụng aggregate result hoặc dữ liệu đã được kiểm soát, không đưa raw rows và PII vào prompt, chart hoặc report thông thường.

## 3. Vị trí trong sản phẩm

Biểu Đồ thuộc về **Profile Run Command Center**. Profiles vẫn là điểm bắt đầu của quy trình.

Đề xuất các tab chính:

```text
Tổng quan | Khám phá | Biểu đồ | Hỏi Agent | Báo cáo
```

Tính năng không thay thế Profiles, Explorer hoặc Report Draft:

- **Profiles** cố định nguồn dữ liệu, phiên bản và metadata.
- **Explorer** hỗ trợ tạo và kiểm tra truy vấn tổng hợp.
- **Biểu Đồ** biến một bài toán hoặc kết quả thành chart có cấu trúc.
- **Hỏi Agent** giải thích kết quả và viết insight.
- **Báo cáo** lưu chart/insight vào Report Draft và xuất bản.

## 4. Luồng người dùng

### Bước 1: Chọn Profile Run

Người dùng mở một Profile Run đã hoàn tất.

Hệ thống nạp:

- tên dataset và phiên bản profile;
- số dòng, số cột và scan mode;
- kiểu dữ liệu;
- dimension, measure và time column có thể sử dụng;
- cột PII và cột bị loại khỏi phân tích;
- cảnh báo chất lượng và giới hạn dữ liệu.

Nếu Profile Run chưa hoàn tất hoặc còn proposal cần review, hệ thống phải chặn việc tạo biểu đồ Official và hướng người dùng xử lý trạng thái đó trước.

### Bước 2: Agent hiểu dữ liệu

Agent tạo semantic context gồm:

- grain của dữ liệu;
- entity hoặc khóa chính nếu có;
- dimension có thể group;
- measure có thể aggregate;
- cột thời gian;
- cột bị bỏ qua;
- các limitation cần hiển thị cho người dùng.

Agent chỉ đề xuất context. Backend phải kiểm tra context có thuộc Profile Run và workspace hiện tại hay không.

### Bước 3: Chọn bài toán

Người dùng có thể nhập câu hỏi tự nhiên hoặc chọn template:

- So sánh các nhóm.
- Xem xu hướng theo thời gian.
- Phân tích phân phối.
- Tìm mối quan hệ giữa các biến.
- Tìm nhóm dẫn đầu hoặc thấp nhất.
- Phát hiện outlier.
- So sánh drift giữa hai Profile Run.

Agent có thể đề xuất bài toán và các cột phù hợp, nhưng người dùng phải xác nhận trước khi chạy.

### Bước 4: Chọn thuật toán

Hệ thống hiển thị các thuật toán phù hợp với kiểu dữ liệu và mục tiêu đã chọn.

| Bài toán | Thuật toán hoặc phép tính |
| --- | --- |
| So sánh nhóm | `count`, `sum`, `mean`, `median` theo dimension |
| Xu hướng | Aggregate theo time column, moving average nếu được cho phép |
| Phân phối | Histogram, quantile, percentile |
| Tương quan | Pearson hoặc Spearman |
| Kiểm định | Shapiro-Wilk, t-test hoặc test được backend cho phép |
| Outlier | IQR hoặc z-score |
| Drift | So sánh metric giữa hai Profile Run |

Danh mục thuật toán phải là allow-list. LLM không được tự ý chạy một thuật toán hoặc truy vấn ngoài contract.

### Bước 5: Phân tích kết quả

Kết quả được chạy theo hai chế độ:

1. **Preview**: chạy nhanh, có thể dùng sample hoặc giới hạn nhóm để người dùng kiểm tra hướng phân tích.
2. **Official**: chạy lại bằng context hợp lệ và lưu làm evidence chính thức.

Kết quả Official cần lưu:

- `profile_run_id`;
- `context_version_id`;
- `query_spec` hoặc algorithm spec;
- danh sách cột được sử dụng;
- aggregate result;
- limitation;
- `result_hash`;
- thời gian và trạng thái thực thi.

### Bước 6: Chọn loại biểu đồ

Hệ thống đề xuất loại biểu đồ dựa trên bài toán:

| Tình huống | Loại biểu đồ đề xuất |
| --- | --- |
| So sánh nhóm | Bar chart |
| Xu hướng theo thời gian | Line chart |
| Quan hệ giữa hai biến | Scatter plot |
| Phân phối | Histogram |
| Phân tán và outlier | Box plot |
| Tương quan nhiều biến | Heatmap |
| Cơ cấu theo nhóm | Stacked bar |

Người dùng có thể đổi loại biểu đồ, nhưng hệ thống phải cảnh báo nếu chart type không phù hợp với dữ liệu.

### Bước 7: Chọn tool vẽ

Mỗi chart cần lưu tool/renderer đã sử dụng, ví dụ:

- renderer khai báo ở frontend;
- renderer theo chart specification;
- renderer Python ở backend cho chart nâng cao.

Chart nên được lưu dưới dạng specification thay vì chỉ lưu PNG. Specification giúp chỉnh sửa, tái tạo, kiểm tra và xuất lại biểu đồ.

Ví dụ `ChartSpec`:

```json
{
  "chart_type": "bar",
  "renderer": "declarative",
  "x": "region",
  "y": "revenue",
  "aggregation": "sum",
  "title": "Doanh thu theo khu vực",
  "result_hash": "...",
  "profile_run_id": "..."
}
```

### Bước 8: Sinh biểu đồ

Renderer nhận aggregate result và `ChartSpec` để tạo biểu đồ.

Biểu đồ cần hiển thị:

- tiêu đề và đơn vị;
- tên dimension/measure;
- trạng thái Preview hoặc Official;
- nguồn Profile Run;
- cảnh báo approximate hoặc sampling nếu có;
- limitation khi cần.

Không render các cột PII và không hiển thị raw row trong tooltip hoặc bảng dữ liệu kèm theo nếu chưa được policy cho phép.

### Bước 9: Agent viết insight

Agent nhận chart result, chart spec và metadata evidence để viết:

- insight chính;
- nhóm hoặc điểm nổi bật;
- xu hướng đáng chú ý;
- giới hạn diễn giải;
- câu hỏi phân tích tiếp theo.

Agent không được tự tạo số liệu. Mọi con số trong insight phải truy nguyên được về kết quả Official.

### Bước 10: Review và đưa vào báo cáo

Người dùng có thể:

- chỉnh tiêu đề biểu đồ;
- chỉnh loại biểu đồ;
- xem lại algorithm và evidence;
- chỉnh hoặc yêu cầu Agent viết lại insight;
- ghim chart vào Report Draft;
- ghim insight vào Report Draft;
- sắp xếp thứ tự;
- xuất PDF hoặc JSON.

## 5. Kiến trúc đề xuất

```text
Profile Run
  ↓
Chart Session
  ├── Business goal
  ├── Semantic context
  ├── Algorithm plan
  ├── Preview execution
  ├── Official execution
  ├── ChartSpec
  ├── Rendered chart
  └── Agent insight
        ↓
Report Draft / Export
```

### Các thành phần chính

#### Frontend

Tạo một tab hoặc workspace **Biểu Đồ** trong `Profile Run Command Center`.

Các khu vực nên có:

1. Data context.
2. Business question.
3. Algorithm selection.
4. Result preview.
5. Chart type và renderer.
6. Chart preview.
7. Agent insight.
8. Action ghim vào báo cáo.

#### Backend

Backend quản lý:

- chart session;
- context và algorithm plan;
- query validation;
- Preview/Official execution;
- chart specification;
- insight generation;
- provenance và audit log.

Có thể tái sử dụng các boundary hiện có của P-170:

- `Profile Run` làm source;
- `Analysis Session` làm context và execution;
- `QuerySpec` làm contract truy vấn;
- Report Draft làm nơi lưu chart và insight;
- export hiện có làm đầu ra cuối.

## 6. Vai trò của hai repository tham khảo

### 6.1. Microsoft Data Formulator

[Data Formulator](https://github.com/microsoft/data-formulator) phù hợp để tham khảo:

- UX khám phá dữ liệu bằng ngôn ngữ tự nhiên;
- Data Thread để lưu các nhánh câu hỏi và kết quả;
- cách Agent đề xuất phép biến đổi và biểu đồ;
- chart recommendation;
- chart specification khai báo;
- chỉnh sửa và tinh chỉnh biểu đồ;
- cách gom kết quả thành report.

Không nên đưa toàn bộ Data Formulator vào P-170 ngay từ đầu vì P-170 đã có Profile Run, workspace authorization, Preview/Official execution và Report Draft riêng.

### 6.2. PandasAI

[PandasAI](https://github.com/sinaptik-ai/pandas-ai) phù hợp để tham khảo hoặc tích hợp có kiểm soát cho:

- hỏi dữ liệu bằng ngôn ngữ tự nhiên;
- lập kế hoạch phân tích trên DataFrame;
- tính toán trên CSV, Parquet hoặc database;
- tạo chart từ kết quả phân tích;
- hỗ trợ nhiều DataFrame;
- chạy code trong sandbox riêng.

PandasAI không được phép trở thành lớp thực thi tự do trong production. Nếu dùng khả năng sinh code, code phải:

- chạy trong sandbox;
- bị giới hạn CPU, memory và thời gian;
- không có quyền đọc filesystem hoặc network ngoài phạm vi;
- bị kiểm tra trước khi chạy;
- không nhận raw PII nếu không có policy rõ ràng;
- lưu execution trace và kết quả để audit.

## 7. Nguyên tắc bảo mật và độ tin cậy

1. LLM chỉ đề xuất plan; backend mới là nơi quyết định plan có hợp lệ hay không.
2. Chỉ cho phép cột đã được Profile Run và semantic context phê duyệt.
3. Không đưa raw rows và PII vào prompt, chart hoặc report mặc định.
4. Tách Preview khỏi Official evidence.
5. Chart phải gắn với `profile_run_id`, `context_version_id` và `result_hash`.
6. Chart renderer chỉ nhận dữ liệu đã aggregate hoặc đã mask.
7. Mọi chart và insight phải có limitation.
8. Kết quả phải tenant-scoped theo workspace và permission hiện tại.
9. Không cho phép người dùng nhập raw SQL hoặc Python tùy ý vào luồng chuẩn.
10. Report chỉ được export từ kết quả đã qua policy kiểm tra.

## 8. Lộ trình triển khai

### Giai đoạn 1: Chart MVP

- Thêm tab Biểu Đồ trong Profile Run.
- Tái sử dụng semantic context và QuerySpec hiện có.
- Hỗ trợ bar, line, histogram và scatter.
- Có Preview/Official.
- Lưu ChartSpec và result hash.

### Giai đoạn 2: Insight và Report Draft

- Agent viết insight từ Official result.
- Cho người dùng review insight.
- Ghim chart và insight vào Report Draft.
- Hỗ trợ export PDF/JSON.

### Giai đoạn 3: Thuật toán nâng cao

- Tương quan và kiểm định.
- Drift và anomaly detection.
- Đề xuất chart/algorithm theo business goal.
- Data Thread cho phép rẽ nhánh từ một kết quả.

### Giai đoạn 4: Tích hợp PandasAI có sandbox

- Đưa PandasAI vào backend worker riêng.
- Chỉ bật cho các thuật toán đã được allow-list.
- Kiểm tra code, resource limit và execution trace.
- So sánh kết quả PandasAI với deterministic engine trước khi cho dùng làm Official evidence.

## 9. Tiêu chí hoàn thành

Tính năng được xem là đạt MVP khi người dùng có thể:

- mở một Profile Run hoàn tất;
- nhập hoặc chọn một business question;
- chọn algorithm hợp lệ;
- xem Preview và xác nhận Official result;
- chọn chart type;
- sinh biểu đồ từ aggregate result;
- xem nguồn, hash và limitation;
- nhận insight từ Agent;
- chỉnh sửa hoặc review insight;
- ghim chart và insight vào Report Draft;
- xuất báo cáo mà không làm lộ raw row hoặc PII.

## 10. Kết luận

Biểu Đồ là lớp kết nối giữa **Profile**, **phân tích có kiểm soát**, **Agent** và **báo cáo**.

Data Formulator nên cung cấp định hướng cho trải nghiệm tương tác và chart specification. PandasAI có thể hỗ trợ conversational analysis và các phép tính/chart nâng cao ở backend. P-170 vẫn phải giữ vai trò kiểm soát chính về workspace, Profiles, permission, PII, provenance, Preview/Official và Report Draft.
