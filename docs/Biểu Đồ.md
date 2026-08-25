# Tính năng Biểu Đồ (Charts & Evidence-First Analytics)

## 1. Mục đích

Tính năng **Biểu Đồ** giúp Analyst và Business User đi từ một Profile Run đã hoàn tất đến một biểu đồ có thể giải thích, kiểm tra và đưa vào báo cáo chính thức.

Mục tiêu không chỉ là tạo ra hình ảnh đơn thuần. Mỗi biểu đồ trong hệ thống đều:
1. Trả lời một câu hỏi phân tích kinh doanh cụ thể.
2. Có nguồn dữ liệu và dấu vết (`evidence_hash`, `execution_id`) được kiểm toán rõ ràng.
3. Được tính toán bằng động cơ deterministic an toàn (DuckDB / Cloud Warehouse / Thuật toán dự báo).
4. Được bảo vệ bởi cơ chế **Zero Raw-Row & Zero PII Leakage**.
5. Đi kèm **AI Insight** đã được thẩm định qua **Evidence Validator** trước khi ghim vào Report Draft / PDF.

Luồng cốt lõi theo kiến trúc **Tri-Engine & Evidence-First**:

```text
                           AI AGENT
                              │
                         MCP CLIENT
                              │
                         MCP SERVER
                              │
             ┌────────────────┼────────────────┐
             ▼                ▼                ▼
          DuckDB           BigQuery        Vector DB
        (Local Data)     (Cloud Data)     (Business KB)
        CSV/Parquet       Warehouse            RAG
             │                │                │
             └────────────────┼────────────────┘
                              ▼
                      Profiling Engine
                              │
             ┌────────────────┴────────────────┐
             ▼                                 ▼
        Statistics                        Forecasting
    (Descriptive/Anomaly)             (Time-series/ML)
             │                                 │
             └────────────────┬────────────────┘
                              ▼
                     Business Reasoning
                (Hợp nhất Số liệu + Bối cảnh)
                              │
                              ▼
                      Evidence Validator
                 (Kiểm tra hash, chặn ảo giác)
                              │
             ┌────────────────┴────────────────┐
             ▼                                 ▼
         AI Insight                      Visualization
    (Giải thích nghiệp vụ)            (SVG / CSS / Grid Chart)
             │                                 │
             └────────────────┬────────────────┘
                              ▼
                     REPORT DRAFT / PDF
```

Chuỗi giá trị phân tích:
```text
Data Profiling chính xác
  → Tool/MCP truy xuất được evidence
  → Business Knowledge (RAG) giải thích ý nghĩa
  → Agent reasoning
  → Validator kiểm chứng (Anti-Hallucination Gate)
  → Visualization / Insight
  → Report Draft / PDF Lineage
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

## 3. Vị trí & Luồng điều hướng trong sản phẩm

Tính năng **Biểu Đồ** được tổ chức thành một không gian phân tích trực quan chuyên sâu (`/charts`) kết hợp chặt chẽ với **Profile Run Command Center** (`/profiles/[runId]`):

- **Sidebar Điều hướng chính**: Có mục riêng **`/charts` (Biểu đồ)** để truy cập nhanh không gian phân tích từ bất kỳ đâu trong workspace.
- **Lối tắt từ Profile Run**: Đầu trang Báo cáo Profile có thẻ kêu gọi hành động nổi bật: **`📊 Tạo biểu đồ & phân tích →`** chuyển hướng trực tiếp sang không gian Biểu đồ.
- **Thanh Tab trong Command Center**: Tối ưu gọn gàng với 2 tab trọng tâm:
  ```text
  Tổng quan | Báo cáo
  ```
- **Trợ lý AI Copilot Nổi (Draggable Floating Widget)**: Cho phép vừa tương tác với biểu đồ/dữ liệu vừa trò chuyện hỏi đáp, xem trích dẫn bằng chứng (Evidence Citations) và xem lịch sử đoạn chat từ mọi trang.
- **Báo cáo Hoàn chỉnh (Report Draft / PDF Export)**: Tự động gom các biểu đồ đã ghim cùng hồ sơ Full Scan lúc đầu, Mục lục tự động, và AI Insight vào bản xuất bản chính thức.

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

Người dùng chỉ cần nhập câu hỏi kinh doanh bằng ngôn ngữ tự nhiên, ví dụ “Doanh số thay đổi thế nào trong 12 tháng?”. Agent tự phân loại câu hỏi vào một bài toán được hỗ trợ:

- So sánh các nhóm.
- Xem xu hướng theo thời gian.
- Phân tích phân phối.
- Tìm mối quan hệ giữa các biến.
- Tìm nhóm dẫn đầu hoặc thấp nhất.
- Phát hiện outlier.
- So sánh drift giữa hai Profile Run.

Agent tự chọn bài toán và cột phù hợp từ semantic context. Người dùng không phải biết dimension, measure hoặc thuật toán. Quyết định kỹ thuật được hiển thị để kiểm tra và có thể sửa trong **Tùy chỉnh nâng cao**.

### Bước 4: Chọn thuật toán

Agent chọn thuật toán phù hợp với kiểu dữ liệu và mục tiêu đã nhận diện. Backend kiểm tra lại toàn bộ lựa chọn bằng allow-list trước khi tạo `QuerySpec`; LLM không thể gửi SQL, Python hoặc tên cột ngoài semantic context.

| Bài toán | Thuật toán hoặc phép tính |
| --- | --- |
| So sánh nhóm | `count`, `sum`, `mean`, `median` theo dimension |
| Xu hướng | Aggregate theo time column, moving average nếu được cho phép |
| Phân phối | Histogram bounded binning, box summary năm số |
| Mối quan hệ | Scatter density theo ô tổng hợp, heatmap hai dimension |
| Tương quan | Pearson hoặc Spearman từ evidence đã lưu |
| Kiểm định | Shapiro-Wilk, t-test hoặc test được backend cho phép |
| Outlier | IQR hoặc z-score |
| Drift | So sánh metric giữa hai Profile Run |

Danh mục thuật toán phải là allow-list. LLM không được tự ý chạy một thuật toán hoặc truy vấn ngoài contract. Nếu LLM planner không khả dụng, bộ lập kế hoạch deterministic dựa trên kiểu cột và từ khóa sẽ tạo phương án dự phòng an toàn.

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

#### Bộ 12 biểu đồ profiling cốt lõi

Production core hỗ trợ đúng nhóm biểu đồ cần cho AI Data Profiling, không mở một catalog renderer không có mục đích:

| Biểu đồ | Evidence/thuật toán | Guardrail |
| --- | --- | --- |
| Histogram | Bounded bin count của một measure | 5–30 bins, không trả raw values |
| Box Plot | Min, Q1, median, Q3, max theo tối đa một nhóm | Chỉ measure đã duyệt |
| Bar Chart | Aggregate theo dimension | Tối đa số nhóm trong `limit` |
| Missing Value Bar | `null_pct` và `null_count` đã lưu trong Profile | Không quét source lại, không trả raw rows |
| Missing Value Heatmap | Tỷ lệ hai cột cùng NULL theo từng cặp | Tối đa 12 cột; không hiển thị pattern từng dòng |
| Correlation Heatmap | Pearson matrix đã lưu trong Profile | Tối đa 10 measure mặc định; ghi rõ không suy ra nhân quả |
| Scatter Plot | Binned density hai measure | Mỗi điểm là một ô mật độ tổng hợp |
| Line Chart | Aggregate theo time grain hoặc forecast | Luôn sắp theo thời gian; forecast có interval |
| Cardinality Chart | Distinct count đã lưu trong Profile | Tối đa 12 cột mặc định |
| Violin Plot | Histogram theo nhóm được phản chiếu thành mật độ | Tối đa 8 nhóm, không gửi raw points |
| Pie/Donut | Aggregate tỷ trọng theo một dimension | Chỉ bật khi cardinality từ 1–12 nhóm |
| Outlier Chart | `outlier_count / row_count` theo cột số | Dùng outlier evidence đã lưu, không hiển thị bản ghi ngoại lệ |

Agent nhận câu hỏi tự nhiên và tự chọn chart tương ứng. Ví dụ: “cột nào thiếu nhiều nhất?” chọn Missing Value Bar; “pattern thiếu giữa các cột?” chọn Missing Value Heatmap; “tương quan các biến số?” chọn Correlation Heatmap; “tỷ trọng doanh số theo khu vực?” chọn Donut nếu khu vực có không quá 12 nhóm. Người dùng vẫn có phần tùy chỉnh nâng cao, nhưng không bắt buộc phải biết thuật toán hay renderer.

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
  "renderer": "native-svg",
  "analysis_kind": "aggregate",
  "x_column": "region",
  "y_column": "revenue",
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

#### MCP adapter

P-170 có MCP adapter tại `backend/src/mcp_server.py`. Adapter dùng SDK MCP chính thức và chạy qua `stdio` trong mô hình trusted local process.

Các tool ban đầu gồm:

- `get_profile_overview`;
- `list_profile_columns`;
- `get_column_profile`;
- `get_distribution`;
- `get_correlation`;
- `get_profile_readiness`;
- `build_chart_spec`;
- `build_chart_plan` cho một yêu cầu gồm nhiều biểu đồ.
- `preview_chart_plan` để chạy Preview cho từng biểu đồ trong bundle;
- `promote_chart_plan` để promote các Preview được chọn thành Official.

MCP adapter gọi lại `STRUCTURED_TOOLS` và `run_tool` hiện có, vì vậy không tạo thêm một đường truy cập dữ liệu khác. Mọi tool đều yêu cầu `profile_run_id`, bị giới hạn theo allow-list và không trả raw rows hoặc giá trị PII.

`build_chart_spec` chỉ tạo một bản nháp ChartSpec. `build_chart_plan` tạo một bundle tối đa 12 ChartSpec cho cùng một Profile Run, ví dụ line chart doanh số theo tháng, bar chart theo khu vực và table tổng hợp theo nhóm sản phẩm. Với dữ liệu ngày, chart line có thể đặt `time_grain: "month"`, `date_from` và `date_to` để giới hạn đúng khoảng phân tích. Các chart trong bundle có thể được validate hoặc thực thi độc lập; một chart lỗi không làm mất các chart hợp lệ khác.

`preview_chart_plan` và `promote_chart_plan` gọi trực tiếp bounded analysis engine, nhưng vẫn yêu cầu `workspace_id`, `actor_user_id`, membership Analyst và `analysis.run`. Preview của từng chart được lưu vào analysis session; `promote_chart_plan` kiểm tra context, expiry và quality gate trước khi lưu Official. Chỉ Official result mới đủ điều kiện ghim vào Report Draft.

MCP không tự động promote mọi chart. Agent hoặc người dùng phải chọn các `preview_execution_ids` hợp lệ; một chart bị lỗi hoặc bị quality gate block không làm mất các chart khác trong bundle. Tối đa 12 chart cho mỗi lần gọi để giữ fan-out, thời gian chạy và kích thước evidence bounded.

Chỉ nên mở Streamable HTTP sau khi MCP có request context cho workspace, authentication, permission và audit tương ứng. Không dùng MCP local stdio như một endpoint production công khai.

## 6. Vai trò của các repository tham khảo

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

Phần được chọn cho MVP hiện tại chỉ là: mô hình ChartSpec khai báo, danh sách nhiều chart trong một ChartPlan và cách tổ chức UX thành một canvas nhiều biểu đồ. P-170 không lấy Data Thread, notebook, catalog, cơ chế lưu trữ riêng hoặc bộ renderer phụ thuộc của repo này.

Không sao chép mã nguồn hay kéo dependency runtime từ Data Formulator vào P-170. Các ý tưởng được viết lại theo domain model, permission, Preview/Official và Report Draft sẵn có của dự án.

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

Trong MVP hiện tại, P-170 chưa nhúng PandasAI. Chỉ giữ lại ý tưởng Agent tạo kế hoạch nhiều biểu đồ và viết insight từ Official aggregate; phần tính toán vẫn do bounded analysis engine thực hiện. PandasAI chỉ nên được xem xét ở giai đoạn sandbox cho những phép biến đổi mà engine allow-list chưa hỗ trợ.

Không sao chép code execution, SmartDataframe hoặc renderer của PandasAI vào luồng production hiện tại. Cách này giữ engine deterministic, dễ audit và không mở quyền thực thi Python tự do.

### 6.3. OpenMetadata

[OpenMetadata](https://github.com/open-metadata/OpenMetadata) không phải là công cụ vẽ biểu đồ. Repo này phù hợp để tham khảo lớp **metadata context và governance** cho Agent.

OpenMetadata kết nối technical metadata, business semantics, data quality, lineage, ownership, policies, glossaries, metrics và memory của tổ chức trong một metadata graph. Đây là nguồn tham khảo hữu ích để Agent hiểu dữ liệu trước khi đề xuất bài toán hoặc biểu đồ.

Trong tính năng Biểu Đồ, OpenMetadata có thể hỗ trợ:

- tìm dataset và metric theo ngữ nghĩa thay vì chỉ tìm theo tên cột;
- xác định owner, domain và business glossary của dataset;
- hiểu lineage: dữ liệu đến từ đâu và biểu đồ/report nào đang phụ thuộc vào nó;
- kiểm tra freshness, quality, certification và trust signal;
- nhận diện classification hoặc cột nhạy cảm trước khi đưa vào chart;
- cung cấp data contract, policy và access context cho Agent;
- lưu lại assumptions, decisions và memory của các lần phân tích;
- cung cấp metadata cho Agent thông qua API, SDK, semantic search hoặc MCP.

Ví dụ với yêu cầu “phân tích doanh số 12 tháng”, OpenMetadata có thể giúp Agent hiểu rằng:

```text
sales_amount → Doanh thu thuần (business metric)
order_date   → Ngày ghi nhận đơn hàng
region       → Khu vực kinh doanh
owner        → Nhóm phụ trách dữ liệu bán hàng
quality      → Dataset đã kiểm tra null, freshness và uniqueness
lineage      → Nguồn bảng và các báo cáo phụ thuộc
```

P-170 vẫn giữ quyền quyết định cuối cùng về permission, PII, query allow-list, Preview/Official và Report Draft. Không nên thay thế Profile Run bằng OpenMetadata ngay từ đầu; có thể tích hợp dần bằng cách đồng bộ metadata sau khi Profile Run hoàn tất.

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

### Giai đoạn 1: Chart production core

- **Đã triển khai:** tab Biểu Đồ trong Profile Run.
- **Đã triển khai:** tái sử dụng semantic context, QuerySpec và bounded Preview/Official hiện có.
- **Đã triển khai:** nhiều chart trong một workspace, gồm line, bar, table, KPI, histogram, scatter density, box plot và heatmap; line hỗ trợ nhóm theo tháng/quý/năm.
- **Đã triển khai:** hiển thị hash, limitation, trạng thái Preview/Official và ghim nhiều Official result vào Report Draft.
- **Đã triển khai:** lưu ChartSpec allow-list cùng execution khi ghim; backend đối chiếu ChartSpec với Official QuerySpec trước khi chấp nhận.
- **Đã triển khai:** renderer React/CSS/SVG dùng chung giữa Chart workspace và Report Draft.
- **Đã triển khai:** MCP adapter có ChartPlan nhiều biểu đồ và công cụ Preview/Official bounded.
- **Đã triển khai:** người dùng chỉ nhập câu hỏi kinh doanh; Agent tự chọn bài toán, thuật toán, cột, chart type và renderer, sau đó tự chạy Preview → quality gate → Official → sinh chart → viết insight. Các lựa chọn thủ công nằm trong **Tùy chỉnh nâng cao**.
- **Đã triển khai:** bộ lọc ngày bắt đầu/kết thúc cho bài toán xu hướng; engine loại ngày không parse được và luôn sắp line chart theo thời gian thay vì theo metric.
- **Đã triển khai:** renderer xử lý kết quả rỗng, số âm, giá trị không hữu hạn và thông báo khi chart bị rút gọn số nhóm hiển thị.
- **Đã triển khai:** histogram dùng tối đa 5–30 bin và chỉ trả tần suất tổng hợp; scatter dùng các ô mật độ hai chiều và không trả raw point; box plot trả min/Q1/median/Q3/max; heatmap yêu cầu đúng hai dimension và trả aggregate cells.
- **Đã triển khai:** PDF vẽ trực tiếp line, bar, KPI, histogram, scatter density, box plot và heatmap từ ChartSpec trong snapshot, đồng thời giữ bảng số liệu và evidence hash để đối chiếu.

### Giai đoạn 2: Insight và Report Draft

- **Đã triển khai:** Agent đọc metadata của Profile trước khi mở bước chọn bài toán.
- **Đã triển khai:** Agent viết insight từ Official execution đã bind cho từng chart.
- **Đã triển khai:** chỉ insight có `evidence_status=verified` mới được ghim cùng chart vào Report Draft.

### Forecasting: dự báo chuỗi thời gian

Người dùng có thể hỏi trực tiếp, ví dụ: “Dự báo doanh số 12 tháng tới”. Agent xác định time column, measure, grain, horizon, season length và model; người dùng không phải biết ARIMA hay Holt-Winters.

Forecast chạy trên chuỗi đã tổng hợp theo thời gian, không đưa raw rows cho LLM. Kết quả gồm lịch sử, giá trị dự báo, cận dưới/cận trên và model warning. Biểu đồ line phân biệt đường thực tế, đường dự báo và prediction interval; PDF dùng màu riêng cho đoạn dự báo.

Catalog hiện có:

- **Baseline:** Naive, Seasonal Naive, Drift, Moving Average, Weighted Moving Average.
- **Exponential Smoothing:** SES, Holt Linear, Holt-Winters, ETS.
- **ARIMA:** ARIMA, SARIMA, Auto-ARIMA; SARIMAX/ARIMAX có trong registry nhưng chỉ bật khi có contract cho biến ngoại sinh tương lai.
- **State Space:** Structural Time Series, Local Level, Local Linear Trend, Kalman Filter, Dynamic Linear Model, Unobserved Components.
- **Decomposable:** Prophet và NeuralProphet dưới dạng dependency tùy chọn.
- **Machine Learning:** Linear/Ridge/Lasso, Random Forest, Extra Trees; XGBoost, LightGBM và CatBoost dưới dạng dependency tùy chọn.

Mỗi model có capability metadata gồm dependency, số kỳ lịch sử tối thiểu, yêu cầu mùa vụ và trạng thái khả dụng. Agent và MCP chỉ được chọn model `available=true`; model thiếu package, thiếu lịch sử hoặc cần dữ liệu ngoại sinh sẽ fail closed. Horizon giới hạn 1–60 kỳ, season length 2–365 và lịch sử đầu vào tối đa 2.000 kỳ.

Image mặc định cài nhóm core bằng `requirements.txt`. Deployment cần toàn bộ XGBoost/LightGBM/CatBoost/Prophet/NeuralProphet dùng:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-forecast-full.txt
```

Việc cài package không tự mở SARIMAX/ARIMAX: hai model này chỉ được bật sau khi API nhận được giá trị biến ngoại sinh cho toàn bộ forecast horizon, nhằm tránh tự bịa dữ liệu tương lai.
- **Đã triển khai:** mở trực tiếp Report Draft để snapshot và xuất báo cáo.
- **Đã triển khai:** chỉnh sửa insight tại chỗ và bắt buộc Analyst đánh dấu đã đối chiếu trước khi ghim.
- **Đã triển khai:** chart, Official execution, Agent run và insight đã duyệt được lưu trong cùng một report item/idempotent request; backend từ chối Agent run bind sang execution khác.
- **Đã triển khai:** chỉnh tiêu đề/ghi chú trong Report Draft, xử lý lỗi export và render insight đã duyệt ngay dưới chart.
- **Còn lại tùy chọn:** insight tổng hợp cho toàn bộ ChartPlan; đây không phải điều kiện để từng chart trở thành Official evidence.

### Giai đoạn 3: Thuật toán nâng cao

- **Đã triển khai:** correlation heatmap từ Pearson evidence đã lưu; kiểm định thống kê suy diễn vẫn là phần mở rộng sau.
- **Đã triển khai:** bộ 12 chart profiling cốt lõi, gồm missingness, cardinality, violin, donut và outlier.
- Drift và anomaly detection.
- Đề xuất chart/algorithm theo business goal.
- Data Thread cho phép rẽ nhánh từ một kết quả.

### Giai đoạn 4: Tích hợp PandasAI có sandbox

- Đưa PandasAI vào backend worker riêng.
- Chỉ bật cho các thuật toán đã được allow-list.
- Kiểm tra code, resource limit và execution trace.
- So sánh kết quả PandasAI với deterministic engine trước khi cho dùng làm Official evidence.

## 9. Tiêu chí hoàn thành production core

Tính năng được xem là đạt production core khi người dùng có thể:

- mở một Profile Run hoàn tất;
- mở một Profile Run mà không cần nhập business question;
- để Agent tự tạo Analysis Pack và tự chọn bài toán, algorithm, cột, chart type và renderer hợp lệ;
- để hệ thống tự chạy bounded Preview và tạo Official result sau quality gate;
- nhận biểu đồ sinh từ aggregate result;
- xem nguồn, hash và limitation;
- nhận insight từ Agent;
- chỉnh sửa hoặc review insight;
- ghim chart và insight vào Report Draft;
- xuất báo cáo mà không làm lộ raw row hoặc PII.

Ngoài luồng chức năng, release phải thỏa các điều kiện vận hành:

- chạy migration đến `20260820_0013` trước khi bật traffic;
- cài dependency backend từ `requirements.txt`, gồm MCP SDK v1;
- cấu hình LLM production để hai bước Agent hiểu dữ liệu và viết insight hoạt động;
- đặt `UX_COMMAND_CENTER_ENABLED=true` cho backend và `NEXT_PUBLIC_UX_COMMAND_CENTER_ENABLED=true` ở thời điểm build frontend;
- production không dùng local dataset storage; phải cấu hình Supabase Storage hoặc Google Drive theo policy hiện có;
- giữ `backend/src/mcp_server.py` ở `stdio` sau một trusted launcher; không public trực tiếp như HTTP endpoint;
- cấu hình `PDF_FONT_PATH` nếu image runtime không chạy từ `frontend/` hoặc không đóng gói `public/fonts/arial.ttf`;
- chạy `pytest`, Ruff, Vitest, TypeScript typecheck và `next build` trong CI;
- smoke test tối thiểu một dataset thật: Preview → Official → insight LLM verified → review → pin → snapshot → PDF.

Smoke test production có thể chạy bằng `scripts/chart_production_smoke.py`. Script yêu cầu rõ `profile_run_id`, `workspace_id`, `actor_user_id`; kiểm tra membership; không upload hoặc in raw rows; và chỉ báo execution ID/result hash. Ngày 21/08/2026, script đã chạy đạt trên `olist_products_dataset` gồm đủ histogram, scatter, box và heatmap, gọi thành công LLM OpenAI đã cấu hình và ghim chart/insight vào Report Draft.

Lệnh kiểm tra release tại repository root:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe scripts\chart_production_smoke.py --profile-run-id <RUN_ID> --workspace-id <WORKSPACE_ID> --actor-user-id <USER_ID>
Set-Location backend
..\.venv\Scripts\ruff.exe check --ignore B008,RUF100 src/api/authz_routes.py src/api/routes.py src/models/analysis_schemas.py src/models/auth_schemas.py src/services/analysis_engine.py src/services/report_draft_repository.py src/mcp_server.py ..\tests\test_services\test_analysis_engine.py
Set-Location ..\frontend
pnpm test
pnpm typecheck
pnpm build
```

Toàn bộ `pytest` cần `P170_TEST_DATABASE_URL` trỏ tới PostgreSQL test riêng. Nếu database đó không đăng nhập được, test tích hợp sẽ dừng ở bước tạo repository trước khi chạy nghiệp vụ Biểu Đồ.

## 10. Luồng mặc định domain-agnostic

Luồng mặc định của tính năng Biểu Đồ không yêu cầu người dùng nhập câu hỏi kinh doanh. Câu hỏi chỉ là tùy chọn để thu hẹp hoặc ưu tiên một mục tiêu profiling.

```text
Dataset
  → Profile Run
  → Agent đọc Profile Context
  → Tự tạo mục tiêu profiling
  → Tạo Analysis Pack
  → Bounded Preview
  → Official results
  → ChartSpec + renderer
  → Nhiều biểu đồ
  → Insight theo Official evidence
  → Review
  → Report Draft / PDF
  → Lineage + Audit
```

`Analysis Pack` được tạo từ metadata đã duyệt và chỉ chứa các phép phân tích mà dataset đáp ứng được:

- Quality: missingness, missing pattern, cardinality và outlier.
- Distribution: histogram, box plot và các summary phù hợp.
- Relationship: scatter và correlation heatmap khi có đủ measure.
- Comparison: bar/donut khi có dimension và measure.
- Time series: line và forecast khi có time column cùng lịch sử đủ dài.

Mỗi chart trong pack chạy độc lập qua Preview và Official. Chart lỗi hoặc bị quality gate chặn không làm mất các chart hợp lệ khác. Insight chỉ được viết từ Official evidence đã bind với Profile Run, sau đó Analyst review trước khi ghim vào Report Draft.

Business question vẫn được giữ trong khu vực tùy chỉnh nâng cao cho các trường hợp người dùng muốn định hướng một phân tích cụ thể; nó không còn là điều kiện để bắt đầu profiling tự động.

## 11. Kết luận

Biểu Đồ là lớp kết nối giữa **Profile**, **phân tích có kiểm soát**, **Agent** và **báo cáo**.

Data Formulator nên cung cấp định hướng cho trải nghiệm tương tác và chart specification. PandasAI có thể hỗ trợ conversational analysis và các phép tính/chart nâng cao ở backend. OpenMetadata có thể cung cấp metadata context, semantics, lineage và governance cho Agent. P-170 vẫn phải giữ vai trò kiểm soát chính về workspace, Profiles, permission, PII, provenance, Preview/Official và Report Draft.
