# Hướng dẫn chọn Dataset cho dự án AI Agent Data Profiling

**Tham chiếu:** [project_context.md](../project_context.md) · [survey.md](./survey.md) · [ADR_v1.md](../ADR/ADR_v1.md)

---

## Mục lục

1. [Phần 1 — Tiêu chí chọn dataset theo từng mục đích](#phần-1--tiêu-chí-chọn-dataset-theo-từng-mục-đích)
   - [1.1 Demo pipeline profiling (MVP)](#11-demo-pipeline-profiling-mvp)
   - [1.2 Test sampling & uncertainty annotation](#12-test-sampling--uncertainty-annotation)
   - [1.3 Test PII detection & masking](#13-test-pii-detection--masking)
   - [1.4 Eval — đo precision/recall](#14-eval--đo-precisionrecall)
   - [1.5 Test QA (hỏi đáp ngôn ngữ tự nhiên)](#15-test-qa-hỏi-đáp-ngôn-ngữ-tự-nhiên)
   - [1.6 Bảng tổng hợp tiêu chí](#16-bảng-tổng-hợp-tiêu-chí)
2. [Phần 2 — Nguồn tìm dataset](#phần-2--nguồn-tìm-dataset)
   - [2.1 Nền tảng dataset công khai](#21-nền-tảng-dataset-công-khai)
   - [2.2 BigQuery Public Datasets](#22-bigquery-public-datasets)
   - [2.3 GitHub repos chuyên "dirty data"](#23-github-repos-chuyên-dirty-data)
   - [2.4 Tự sinh dataset (Faker / SDV)](#24-tự-sinh-dataset-faker--sdv)
3. [Phần 3 — 2 dataset được chọn cho demo MVP](#phần-3--2-dataset-được-chọn-cho-demo-mvp)
   - [3.1 Dataset 1: Brazilian E-Commerce (Olist)](#31-dataset-1-brazilian-e-commerce-olist)
   - [3.2 Dataset 2: Online Retail II (UCI)](#32-dataset-2-online-retail-ii-uci)
   - [3.3 Bảng so sánh tổng hợp](#33-bảng-so-sánh-tổng-hợp)
   - [3.4 Hai dataset bổ sung cho nhau như thế nào](#34-hai-dataset-bổ-sung-cho-nhau-như-thế-nào)
   - [3.5 Hạn chế chung & cách khắc phục](#35-hạn-chế-chung--cách-khắc-phục)
4. [Phần 4 — Survey bổ sung theo Định dạng Dữ liệu & Bộ Data Lỗi (Dirty Data)](#phần-4--survey-bổ-sung-theo-định-dạng-dữ-liệu--bộ-data-lỗi-dirty-data)
   - [4.1 Tiêu chí chọn định dạng dữ liệu & data lỗi](#41-tiêu-chí-chọn-định-dạng-dữ-liệu--data-lỗi)
   - [4.2 Danh sách Dataset mở rộng theo Định dạng & Data Lỗi](#42-danh-sách-dataset-mở-rộng-theo-định-dạng--data-lỗi)
   - [4.3 Bảng Ma trận Tổng hợp mở rộng](#43-bảng-ma-trận-tổng-hợp-mở-rộng)

---

## Phần 1 — Tiêu chí chọn dataset theo từng mục đích

### 1.1 Demo pipeline profiling (MVP)

Mục đích: chạy trọn luồng `ingest → compute_stats → propose_metadata → HITL → summarize → QA` (mục 6, project_context) trước người xem (ban giám khảo / Demo Day).

| # | Tiêu chí | Tại sao cần (trích nguồn) |
|---|---|---|
| D1 | **Đa dtype**: phải có cả numeric, categorical, datetime, free-text trong cùng 1 dataset | `compute_stats` cần tính stats khác nhau cho từng dtype: mean/std cho numeric, cardinality cho categorical, range cho datetime, length distribution cho text (project_context mục 6, node `compute_stats`) |
| D2 | **Có null ở nhiều mức**: ít nhất 1 cột ~0%, 1 cột vài %, 1 cột >15% | Demo missing value detection + cảnh báo rủi ro "cột X thiếu dữ liệu nghiêm trọng" (project_context mục 5.1: "báo cáo: thống kê từng cột + biểu đồ missing value") |
| D3 | **Có ít nhất 1 cột candidate key** (unique + non-null) | Demo `propose_metadata` → sinh CandidateKeyProposal kèm confidence + evidence (project_context mục 6, node `propose_metadata`; mục 7: CandidateKeyProposal schema) |
| D4 | **Có outlier rõ ràng** (giá trị bất thường về thống kê) | Demo outlier detection bằng IQR/z-score ở `compute_stats` (project_context mục 6: "outlier IQR/z-score") |
| D5 | **Có correlation giữa các cột** | Demo correlation matrix — ydata-profiling tự sinh (project_context mục 5.1: "correlation matrix"; mục 6 `compute_stats`: "correlation") |
| D6 | **Kích thước 5K–100K rows** | Đủ lớn để profiling có ý nghĩa thống kê, đủ nhỏ để chạy full scan nhanh khi demo trực tiếp (project_context mục 2.4: "dữ liệu nhỏ → full scan") |
| D7 | **Có schema / data dictionary có sẵn** | Biết trước đâu là PK, FK, dtype → dùng làm ground truth kiểm chứng kết quả agent (project_context mục 8: "đo trên dataset đã gán nhãn") |
| D8 | **Thuộc domain Retail hoặc Kế toán** | 2 domain khớp MVP nhất theo khảo sát survey (survey.md mục 7e: "Kế toán và Retail/E-commerce là 2 domain phù hợp nhất để làm MVP pilot") |

### 1.2 Test sampling & uncertainty annotation

Mục đích: chứng minh hệ thống xử lý được dữ liệu lớn mà không quét toàn bộ, hiển thị ký hiệu `≈` + `margin_of_error` cho số liệu ước lượng.

| # | Tiêu chí | Tại sao cần (trích nguồn) |
|---|---|---|
| S1 | **Lớn: >500K rows**, lý tưởng >1M | So sánh full scan vs sampling có sự khác biệt rõ về thời gian chạy. Với dataset nhỏ (<100K), sampling không cần thiết và demo không thuyết phục (project_context mục 2.4: "bảng lớn → không quét toàn bộ") |
| S2 | **Có cột high-cardinality** (>5K giá trị unique) | Cardinality là chỉ số nhạy nhất với cỡ mẫu — demo annotation `≈` sẽ nổi bật khi `APPROX_COUNT_DISTINCT` trả về giá trị khác full `COUNT(DISTINCT)` (project_context mục 2.3: "cardinality ≈ 15.234"; ADR-006) |
| S3 | **Có outlier hiếm** (< 1% rows) | Rủi ro sampling bias bỏ sót outlier khi mẫu nhỏ → demo cảnh báo "kết quả outlier detection có thể không đầy đủ ở chế độ sampling" (project_context mục 9: "sampling bias") |
| S4 | **Định dạng CSV hoặc Parquet** | DuckDB đọc trực tiếp, không cần setup BigQuery cho demo (ADR-005: DuckDB là compute engine chính) |
| S5 | **Null tự nhiên** | Để demo `is_approximate = true` trên ColumnStat khi chạy sampling — null% tính từ sample có thể khác full scan (ADR-006: "chú thích uncertainty") |

### 1.3 Test PII detection & masking

Mục đích: chứng minh hệ thống nhận diện cột PII (email, SĐT, tên, CCCD, địa chỉ) → sinh PiiProposal → HITL confirm → mask giá trị mẫu trong báo cáo.

| # | Tiêu chí | Tại sao cần (trích nguồn) |
|---|---|---|
| P1 | **Chứa cột có giá trị PII realistic** (dù synthetic): tên người, email, số điện thoại, địa chỉ | Demo PII detection pipeline: heuristic tên cột + regex giá trị + NER nếu cần (project_context mục 2.2: "kết hợp heuristic theo tên cột + regex theo pattern giá trị") |
| P2 | **PII ở nhiều loại khác nhau** (ít nhất 2-3 loại) | Cho thấy hệ thống phát hiện được nhiều loại PII, không chỉ 1 — tăng tính thuyết phục khi demo (project_context mục 2.2: "email, SĐT, CCCD, địa chỉ, tên riêng") |
| P3 | **Tên cột gợi ý PII** (vd: `email`, `phone`, `name`) | Heuristic đầu tiên của PII detection dựa trên tên cột — cần có tên cột phù hợp (project_context mục 2.2: "heuristic theo tên cột") |
| P4 | **Có cột KHÔNG phải PII nhưng tên gây nhầm lẫn** (vd: `product_name`, `company_name`) | Test false positive — hệ thống phải phân biệt được PII thật và cột tên sản phẩm/công ty (ADR-003: PiiProposal cần confidence + evidence) |

> **Thực tế:** Không dataset công khai nào chứa PII thật (vi phạm privacy laws + terms of service nền tảng). Giải pháp: **inject PII synthetic bằng thư viện Faker** vào dataset có sẵn, hoặc tìm dataset synthetic đã có sẵn PII giả.

### 1.4 Eval — đo precision/recall

Mục đích: đo chất lượng suy luận của agent (candidate key detection, semantic type inference) trên dataset có ground truth.

| # | Tiêu chí | Tại sao cần (trích nguồn) |
|---|---|---|
| E1 | **Schema gán nhãn sẵn**: biết trước primary key, foreign key, data type | Ground truth cho candidate key detection eval: precision = bao nhiêu % key agent đề xuất là đúng, recall = bao nhiêu % key thật được tìm ra (project_context mục 8: "precision/recall của candidate key detection") |
| E2 | **Đa bảng có quan hệ FK** (ít nhất 2-3 bảng) | Test candidate key detection liên bảng + test FK inference (project_context mục 6: `propose_metadata` đề xuất candidate key) |
| E3 | **Đa kiểu ngữ nghĩa**: cột ID, categorical, ordinal, continuous, datetime, free-text | Ground truth cho semantic type inference: agent phải phân biệt được `order_id` (ID) vs `quantity` (continuous) vs `status` (categorical) (project_context mục 7: SemanticTypeProposal — "ID / categorical / ordinal / continuous / datetime / free-text") |
| E4 | **Từ nguồn uy tín** (Kaggle, UCI, dbt, TPC benchmark) | Đảm bảo schema documentation đáng tin cậy, không phải tự gán nhãn (project_context mục 8: "lấy từ Kaggle/UCI có sẵn schema") |

### 1.5 Test QA (hỏi đáp ngôn ngữ tự nhiên)

Mục đích: test cả 2 nhánh QA — structured lookup (câu hỏi định lượng) và vector search hybrid (câu hỏi định tính).

| # | Tiêu chí | Tại sao cần (trích nguồn) |
|---|---|---|
| Q1 | **Có stats đa dạng** (null%, cardinality, outlier count) trong DB sau profiling | Để đặt được câu hỏi định lượng: "null% cột X?", "cardinality cột Y?" → test structured lookup pipeline trả số chính xác từ DB (project_context mục 6: "QA — Structured Lookup: số chèn trực tiếp từ DB") |
| Q2 | **Có lịch sử profiling** (chạy profiling ≥ 2 lần, hoặc 2 dataset cùng domain) | Để đặt câu hỏi định tính/so sánh: "dataset này đổi gì so meo với lần trước?" → test vector search hybrid pipeline (project_context mục 6: "QA — Vector Search Hybrid: FAISS+BM25 + rerank") |
| Q3 | **Có cột/đặc điểm dễ hỏi bằng ngôn ngữ tự nhiên** | Demo QA phải tự nhiên, không gượng — dataset retail/ecommerce dễ hỏi hơn dataset kỹ thuật thuần (vd: "cột nào có outlier?", "bảng nào thiếu dữ liệu nhiều nhất?") |

### 1.6 Bảng tổng hợp tiêu chí

| Tiêu chí | Demo (1.1) | Sampling (1.2) | PII (1.3) | Eval (1.4) | QA (1.5) |
|---|:---:|:---:|:---:|:---:|:---:|
| Đa dtype | ✅ | | | ✅ | |
| Null nhiều mức | ✅ | ✅ | | | ✅ |
| Candidate key rõ | ✅ | | | ✅ | |
| Outlier rõ | ✅ | ✅ | | | ✅ |
| Chứa PII | | | ✅ | | |
| Correlation | ✅ | | | | |
| Kích thước 5K–100K | ✅ | | | | |
| Kích thước >500K | | ✅ | | | |
| High cardinality | | ✅ | | | |
| Schema/dictionary sẵn | ✅ | | | ✅ | |
| Đa bảng + FK | | | | ✅ | |
| Domain Retail/Kế toán | ✅ | | | | ✅ |
| CSV/Parquet | ✅ | ✅ | | | |
| License mở | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## Phần 2 — Nguồn tìm dataset

### 2.1 Nền tảng dataset công khai

Đây là các "ao câu cá" — nền tảng lớn chứa hàng nghìn dataset, vào tìm bằng keyword + filter.

| Nền tảng | Link | Đặc điểm | Phù hợp mục đích |
|---|---|---|---|
| **Kaggle** | [kaggle.com/datasets](https://www.kaggle.com/datasets) | Lớn nhất, nhiều dataset retail/ecommerce, có preview data + notebook mẫu, cộng đồng review | Demo, Sampling, Eval |
| **UCI ML Repository** | [archive.ics.uci.edu](https://archive.ics.uci.edu/) | Dataset kinh điển từ giới học thuật, có data dictionary mô tả kỹ từng cột, nhiều dataset có null + mixed types | Demo, Eval |
| **Google Dataset Search** | [datasetsearch.research.google.com](https://datasetsearch.research.google.com/) | Meta-search engine — tìm dataset từ nhiều nguồn (gov, academic, Kaggle...), filter theo format CSV/Table, license, topic | Tìm dataset chuyên biệt (kế toán, HR...) |
| **Hugging Face Datasets** | [huggingface.co/datasets](https://huggingface.co/datasets) | Filter `Modalities: Tabular` + `Format: csv`, hỗ trợ streaming (không cần download hết), filter theo số rows | Sampling (dataset lớn) |
| **Registry of Open Data on AWS** | [registry.opendata.aws](https://registry.opendata.aws/) | Dataset rất lớn lưu trên S3, miễn phí download, thường ở dạng Parquet | Sampling |
| **Data.gov** | [data.gov](https://data.gov/) | Dữ liệu chính phủ Mỹ, "dirty" tự nhiên (null, format lỗi, inconsistent) | Demo (test data quality) |
| **Harvard Dataverse** | [dataverse.harvard.edu](https://dataverse.harvard.edu/) | Dataset nghiên cứu học thuật, metadata/schema chi tiết, uy tín cao | Eval |
| **NYC Open Data** | [opendata.cityofnewyork.us](https://opendata.cityofnewyork.us/) | Dataset lớn (taxi trips hàng triệu rows), Parquet, free | Sampling |

### 2.2 BigQuery Public Datasets

Phù hợp đặc biệt vì project context hỗ trợ BigQuery là data source (mục 2.4, 4.1). Miễn phí 1TB query/tháng. Có thể test luôn `TABLESAMPLE`, `APPROX_COUNT_DISTINCT` trên warehouse thật.

| Dataset | Project.Dataset | Kích thước | Phù hợp |
|---|---|---|---|
| Google Analytics (GA4) Sample | `bigquery-public-data.ga4_obfuscated_sample_ecommerce` | Vài trăm K events | Demo |
| Stack Overflow | `bigquery-public-data.stackoverflow` | Hàng chục triệu rows | Sampling |
| Chicago Taxi Trips | `bigquery-public-data.chicago_taxi_trips` | ~200M rows | Sampling |
| GitHub Repos | `bigquery-public-data.github_repos` | Rất lớn | Sampling |

### 2.3 GitHub repos chuyên "dirty data"

Dataset được thiết kế sẵn với null, outlier, format lỗi — tốt cho test data quality pipeline.

| Repo | Link | Đặc điểm |
|---|---|---|
| eyowhite/Messy-dataset | [github.com/eyowhite/Messy-dataset](https://github.com/eyowhite/Messy-dataset) | Dataset bẩn có chủ đích: null, format lỗi, duplicate |
| Jcharis/Data-Cleaning-Practical-Examples | [github.com/Jcharis/Data-Cleaning-Practical-Examples](https://github.com/Jcharis/Data-Cleaning-Practical-Examples) | Chứa `unclean_data.csv` với header lệch, thiếu comma, duplicate `title_year` |
| OxfordIHTM/messy-data | [github.com/OxfordIHTM/messy-data](https://github.com/OxfordIHTM/messy-data) | Vi phạm tidy data principles, dữ liệu rải nhiều sheet/file |
| jbrownlee/Datasets | [github.com/jbrownlee/Datasets](https://github.com/jbrownlee/Datasets) | Collection ML datasets, nhiều file dùng `?` thay null |
| dbt-labs/jaffle-shop-data | [github.com/dbt-labs/jaffle-shop-data](https://github.com/dbt-labs/jaffle-shop-data) | CSV sẵn (customers, orders, payments), schema rõ, FK quan hệ — nhỏ gọn, tốt cho test nhanh pipeline |

### 2.4 Tự sinh dataset (Faker / SDV)

Là cách duy nhất để có dataset chứa PII realistic, và kiểm soát hoàn toàn null/outlier/ground truth.

| Công cụ | Cài đặt | Dùng cho |
|---|---|---|
| **Faker** (Python) | `pip install faker` | Sinh PII giả: name, email, phone, address, SSN — realistic theo locale (vi_VN, en_US, pt_BR...) |
| **NumPy** | `pip install numpy` | Sinh dữ liệu numeric theo distribution cụ thể, inject outlier ở tỷ lệ kiểm soát được |
| **SDV** (Synthetic Data Vault) | `pip install sdv` | Sinh đa bảng có FK, giữ referential integrity + phân phối thống kê giống dữ liệu gốc |

> **Khuyến nghị mạnh:** Dùng Faker inject PII vào dataset có sẵn (Olist, Online Retail), không cần sinh từ đầu — giữ được dữ liệu thật cho demo + có PII cho test.

---

## Phần 3 — 2 dataset được chọn cho demo MVP

### 3.1 Dataset 1: Brazilian E-Commerce (Olist)

#### Thông tin chung

| Mục | Chi tiết |
|---|---|
| **Tên đầy đủ** | Brazilian E-Commerce Public Dataset by Olist |
| **Link download** | [kaggle.com/datasets/olistbr/brazilian-ecommerce](https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce) |
| **Tác giả** | Olist — marketplace lớn nhất Brazil (công ty thật, không phải cá nhân) |
| **Dữ liệu thật/giả** | **Dữ liệu thương mại thật**, đã ẩn danh. Tên công ty trong review thay bằng tên gia tộc Game of Thrones |
| **Thời gian** | 2016–2018 (~2 năm) |
| **Kích thước** | ~100K orders · 8 file CSV · tổng ~45MB |
| **Số lượt download** | 591K+ downloads · 2.3M+ views · 4.4K+ likes |
| **License** | CC BY-NC-SA 4.0 (cho phép sử dụng giáo dục, phi thương mại) |
| **Domain** | Retail/E-commerce |

#### Lý do chọn

1. **Đa bảng có quan hệ FK** — hiếm dataset nào có 8 bảng relational với ER diagram chính thức → demo được candidate key detection + FK inference liên bảng, đây là điểm khác biệt lớn nhất so với dataset 1 bảng phẳng
2. **Dữ liệu thương mại thật** — thuyết phục hơn synthetic data khi demo trước ban giám khảo
3. **Domain Retail** — khớp trực tiếp với khuyến nghị survey mục 7e
4. **Đa dtype tự nhiên** — price (float), category (categorical), timestamp (datetime), review comment (free-text) → không cần ép kiểu
5. **Null tự nhiên** — review comment null vì khách không viết, delivered_at null vì chưa giao → null có lý do nghiệp vụ, demo tự nhiên
6. **Cộng đồng lớn** — 591K downloads → nhiều notebook phân tích tham khảo, dễ validate kết quả agent

#### 8 bảng — mô tả chi tiết

**Bảng 1: `olist_customers_dataset.csv`** — Thông tin khách hàng

| Cột | Dtype | Mô tả | Đặc điểm profiling |
|---|---|---|---|
| `customer_id` | string | ID khách hàng (duy nhất theo đơn hàng) | **Candidate key** — unique, non-null |
| `customer_unique_id` | string | ID khách hàng (duy nhất theo người) | Candidate key — 1 người có thể có nhiều `customer_id` |
| `customer_zip_code_prefix` | int | 5 chữ số đầu zip code | Categorical (~14K values) — **quasi-identifier** |
| `customer_city` | string | Thành phố | Categorical (~4.1K values) |
| `customer_state` | string | Bang (2 ký tự) | Categorical (27 giá trị) |

**Bảng 2: `olist_orders_dataset.csv`** — Đơn hàng (bảng trung tâm)

| Cột | Dtype | Mô tả | Đặc điểm profiling |
|---|---|---|---|
| `order_id` | string | ID đơn hàng | **Primary key** — unique, non-null |
| `customer_id` | string | FK → customers | Non-null |
| `order_status` | string | Trạng thái: delivered/shipped/canceled/... | Categorical (8 giá trị) |
| `order_purchase_timestamp` | datetime | Thời điểm đặt hàng | Non-null |
| `order_approved_at` | datetime | Thời điểm thanh toán được duyệt | **Có null** (đơn chưa duyệt) |
| `order_delivered_carrier_date` | datetime | Ngày giao cho vận chuyển | **Có null** (đơn chưa ship) |
| `order_delivered_customer_date` | datetime | Ngày giao đến khách | **Có null nhiều** (đơn chưa giao / huỷ) |
| `order_estimated_delivery_date` | datetime | Ngày giao dự kiến | Non-null |

**Bảng 3: `olist_order_items_dataset.csv`** — Chi tiết sản phẩm trong đơn

| Cột | Dtype | Mô tả | Đặc điểm profiling |
|---|---|---|---|
| `order_id` | string | FK → orders | Non-null |
| `order_item_id` | int | Thứ tự sản phẩm trong đơn (1, 2, 3...) | Composite key: `order_id` + `order_item_id` |
| `product_id` | string | FK → products | Non-null |
| `seller_id` | string | FK → sellers | Non-null |
| `shipping_limit_date` | datetime | Hạn chót gửi hàng | Non-null |
| `price` | float | Giá sản phẩm (BRL) | **Outlier**: range rộng (vài Real → hàng nghìn Real) |
| `freight_value` | float | Phí vận chuyển | **Correlation mạnh** với `price` và `product_weight` |

**Bảng 4: `olist_order_payments_dataset.csv`** — Thanh toán

| Cột | Dtype | Mô tả | Đặc điểm profiling |
|---|---|---|---|
| `order_id` | string | FK → orders | 1 đơn có thể nhiều phương thức thanh toán |
| `payment_sequential` | int | Thứ tự thanh toán | Composite key: `order_id` + `payment_sequential` |
| `payment_type` | string | credit_card / boleto / voucher / debit_card | Categorical (4-5 giá trị) |
| `payment_installments` | int | Số kỳ trả góp | Range 1–24, **outlier** ở các giá trị cao |
| `payment_value` | float | Số tiền thanh toán | Numeric, correlation với `price` |

**Bảng 5: `olist_order_reviews_dataset.csv`** — Đánh giá

| Cột | Dtype | Mô tả | Đặc điểm profiling |
|---|---|---|---|
| `review_id` | string | ID đánh giá | Candidate key |
| `order_id` | string | FK → orders | Non-null |
| `review_score` | int | Điểm 1–5 | Ordinal — test semantic type detection |
| `review_comment_title` | string | Tiêu đề comment | **Null nhiều** |
| `review_comment_message` | string | Nội dung comment (tiếng BĐN) | **Null rất nhiều** (đa số khách không viết) — free-text |
| `review_creation_date` | datetime | Ngày tạo review | Non-null |
| `review_answer_timestamp` | datetime | Ngày phản hồi | Non-null |

**Bảng 6: `olist_products_dataset.csv`** — Sản phẩm

| Cột | Dtype | Mô tả | Đặc điểm profiling |
|---|---|---|---|
| `product_id` | string | ID sản phẩm | **Candidate key** |
| `product_category_name` | string | Tên danh mục (tiếng BĐN) | Categorical (~73 giá trị), **có null** |
| `product_name_lenght` | int | Độ dài tên sản phẩm | Numeric — có thể có null |
| `product_description_lenght` | int | Độ dài mô tả | Numeric — có thể có null |
| `product_photos_qty` | int | Số ảnh sản phẩm | Numeric — có thể có null |
| `product_weight_g` | float | Cân nặng (gram) | **Correlation** với freight_value |
| `product_length_cm` | float | Chiều dài | Numeric |
| `product_height_cm` | float | Chiều cao | Numeric |
| `product_width_cm` | float | Chiều rộng | Numeric |

**Bảng 7: `olist_sellers_dataset.csv`** — Người bán

| Cột | Dtype | Mô tả | Đặc điểm profiling |
|---|---|---|---|
| `seller_id` | string | ID người bán | **Candidate key** |
| `seller_zip_code_prefix` | int | Zip code | Quasi-identifier |
| `seller_city` | string | Thành phố | Categorical |
| `seller_state` | string | Bang (2 ký tự) | Categorical (27 giá trị) |

**Bảng 8: `olist_geolocation_dataset.csv`** — Toạ độ

| Cột | Dtype | Mô tả | Đặc điểm profiling |
|---|---|---|---|
| `geolocation_zip_code_prefix` | int | Zip code | FK lookup, **KHÔNG unique** (1 zip → nhiều toạ độ) |
| `geolocation_lat` | float | Vĩ độ | Numeric, range Brazil |
| `geolocation_lng` | float | Kinh độ | Numeric, range Brazil |
| `geolocation_city` | string | Thành phố | Categorical |
| `geolocation_state` | string | Bang | Categorical |

#### Sơ đồ quan hệ FK

```
olist_customers ──(customer_id)──→ olist_orders ──(order_id)──→ olist_order_items
                                       │                              │
                                       │                        (product_id)→ olist_products
                                       │                        (seller_id) → olist_sellers
                                       │
                                       ├──(order_id)──→ olist_order_payments
                                       └──(order_id)──→ olist_order_reviews

olist_geolocation ← (zip_code_prefix) ← olist_customers / olist_sellers
```

#### Đánh giá theo tiêu chí

| # | Tiêu chí | Kết quả | Bằng chứng |
|---|---|:---:|---|
| D1 | Đa dtype | ✅ | float (`price`), categorical (`payment_type`), datetime (5 cột timestamp), free-text (`review_comment_message`) |
| D2 | Null nhiều mức | ✅ | `review_comment_message` >50% null · `order_delivered_customer_date` ~10% null · `product_category_name` vài % null · `order_id` 0% null |
| D3 | Candidate key | ✅✅ | Mỗi bảng đều có PK rõ: `order_id`, `customer_id`, `product_id`, `seller_id`, `review_id`. Composite key: `order_id` + `order_item_id` |
| D4 | Outlier | ✅ | `price` range rất rộng · `freight_value` bất thường · `payment_installments` max 24 |
| D5 | Correlation | ✅ | `price` ↔ `freight_value` · `product_weight_g` ↔ `freight_value` · `review_score` ↔ delivery delay |
| D6 | Kích thước | ✅ | ~100K orders · ~113K order_items — full scan < 10 giây |
| D7 | Schema sẵn | ✅✅ | ER diagram chính thức trên Kaggle, mô tả chi tiết từng bảng |
| D8 | Domain Retail | ✅ | E-commerce marketplace |
| PII | ⚠️ | Không có — đã ẩn danh hoàn toàn. Cần inject Faker |

---

### 3.2 Dataset 2: Online Retail II (UCI)

#### Thông tin chung

| Mục | Chi tiết |
|---|---|
| **Tên đầy đủ** | Online Retail II |
| **Link download (Kaggle)** | [kaggle.com/datasets/mashlyn/online-retail-ii-uci](https://www.kaggle.com/datasets/mashlyn/online-retail-ii-uci) |
| **Link gốc (UCI)** | [archive.ics.uci.edu/dataset/502/online+retail+ii](https://archive.ics.uci.edu/dataset/502/online+retail+ii) |
| **Tác giả** | Dr. Daqing Chen, London South Bank University |
| **Dữ liệu thật/giả** | **Giao dịch thật** từ một UK online retailer chuyên bán quà lưu niệm |
| **Thời gian** | 01/12/2009 – 09/12/2011 (~2 năm) |
| **Kích thước** | **~1.07 triệu rows** · 8 cột · ~45MB |
| **License** | CC BY 4.0 (cho phép mọi mục đích kể cả thương mại) |
| **Domain** | Retail/E-commerce |

#### Lý do chọn

1. **1.07M rows** — đủ lớn để demo có sự khác biệt rõ rệt giữa full scan và sampling, chứng minh tính năng uncertainty annotation (ADR-006)
2. **22% null ở Customer ID** — con số ấn tượng, báo cáo tự động sẽ cảnh báo "cột này thiếu dữ liệu nghiêm trọng" → demo rất trực quan
3. **Quantity âm** (đơn trả hàng) — outlier tự nhiên, IQR/z-score bắt được ngay mà không cần inject
4. **Composite candidate key** (`Invoice` + `StockCode`) — thử thách cho `propose_metadata`: phải nhận ra đây là composite key, không phải single-column
5. **Dữ liệu giao dịch thật** — từ UK retailer, uy tín học thuật (UCI Repository, được trích dẫn trong nhiều bài nghiên cứu)
6. **License CC BY 4.0** — mở nhất trong các dataset cân nhắc

#### Cấu trúc dữ liệu — 1 bảng, 8 cột

| Cột | Dtype | Mô tả | Null% | Đặc điểm profiling |
|---|---|---|---:|---|
| `Invoice` | string | Mã hoá đơn 6 chữ số. Prefix "C" = đơn huỷ | 0% | Gần-unique (1 invoice = nhiều items). Prefix "C" → **semantic type detection thú vị**: cùng 1 cột vừa là ID vừa encode trạng thái |
| `StockCode` | string | Mã sản phẩm 5 chữ số | 0% | **High cardinality** (~4K unique) — tốt cho test `APPROX_COUNT_DISTINCT` khi sampling |
| `Description` | string | Tên sản phẩm (tiếng Anh) | **~0.4%** | Free-text, null ít — test PII false positive (tên sản phẩm ≠ tên người) |
| `Quantity` | int | Số lượng sản phẩm | 0% | **Có giá trị âm** (đơn trả hàng) → outlier tự nhiên rất rõ. Range: -80,995 đến 80,995 |
| `InvoiceDate` | datetime | Ngày giờ giao dịch | 0% | Range 2 năm → time-based analysis |
| `Price` | float | Đơn giá (£) | 0% | Có giá trị **0** (free items) và **rất cao** → outlier 2 chiều |
| `Customer ID` | float | Mã khách hàng | **~22%** | **Null nổi bật nhất** — ~235K rows không có customer. Gần-unique khi non-null (~4.4K unique). Dtype float (vì null) thay vì int → thử thách cho dtype inference |
| `Country` | string | Quốc gia | 0% | Categorical, ~40 nước. Dominant value: United Kingdom (~91%) → **class imbalance** |

#### Đặc điểm data quality nổi bật

| Đặc điểm | Chi tiết | Demo được gì |
|---|---|---|
| **22% null ở Customer ID** | ~235K/1.07M rows thiếu mã khách | Missing value detection → cảnh báo rủi ro "cột Customer ID thiếu 22% — ảnh hưởng phân tích customer-centric" |
| **Quantity âm** | Đơn trả hàng (return/refund) có quantity < 0 | IQR/z-score outlier detection → gắn cờ "có giá trị âm bất thường" |
| **Price = 0** | Sản phẩm tặng kèm (free items) | Outlier detection + cảnh báo "giá = 0 — kiểm tra dữ liệu" |
| **Invoice prefix "C"** | ~10K đơn huỷ có mã bắt đầu bằng "C" | Semantic type detection: "cột này vừa chứa ID vừa encode thông tin trạng thái" |
| **Customer ID dtype float** | Pandas đọc cột int có null thành float | Dtype inference challenge: agent nên nhận ra đây là int bị cast float do null |
| **Country class imbalance** | UK chiếm ~91% | Distribution analysis → nhận xét "phân phối lệch mạnh, 91% giá trị là UK" |
| **Duplicates có thể có** | Một số version có record trùng giữa 2 năm | Duplicate detection (nếu implement) |

#### Đánh giá theo tiêu chí

| # | Tiêu chí | Kết quả | Bằng chứng |
|---|---|:---:|---|
| D1 | Đa dtype | ✅ | int (`Quantity`), float (`Price`, `Customer ID`), string (`StockCode`, `Country`), datetime (`InvoiceDate`), text (`Description`) |
| D2 | Null nhiều mức | ✅✅ | `Customer ID` ~22% · `Description` ~0.4% · 6 cột khác ~0% → 3 mức null rõ ràng |
| D3 | Candidate key | ✅ | Composite: `Invoice` + `StockCode`. `Customer ID` gần-unique nhưng có null → challenge |
| D4 | Outlier | ✅✅ | Quantity âm (-80,995) · Price = 0 · Price rất cao · Quantity bulk orders (>10K) |
| D5 | Correlation | ✅ | `Quantity` × `Price` = revenue · `Country` ↔ purchasing patterns · Seasonal trends theo `InvoiceDate` |
| S1 | Kích thước >500K | ✅✅ | **1.07M rows** |
| S2 | High cardinality | ✅ | `StockCode` ~4K unique · `Customer ID` ~4.4K unique · `Invoice` ~25K unique |
| D7 | Schema sẵn | ✅ | UCI data dictionary chính thức |
| D8 | Domain Retail | ✅ | UK online retailer |
| PII | ⚠️ | Không có — chỉ `Customer ID` (số). Cần inject Faker |

---

### 3.3 Bảng so sánh tổng hợp

| Tiêu chí | Olist (Dataset 1) | Online Retail II (Dataset 2) |
|---|:---:|:---:|
| **Dữ liệu** | Thật (Brazil marketplace) | Thật (UK retailer) |
| **Kích thước** | ~100K orders | ~1.07M rows |
| **Số bảng** | **8 bảng + FK** | 1 bảng phẳng |
| **Đa dtype** | ✅ (float, categorical, datetime, free-text) | ✅ (int, float, string, datetime, text) |
| **Null nổi bật** | review_comment >50%, delivery dates ~10% | **Customer ID ~22%** |
| **Candidate key** | ✅✅ Nhiều PK + FK liên bảng | ✅ Composite key (Invoice + StockCode) |
| **Outlier** | Price/freight range rộng | **Quantity âm** + Price = 0 |
| **Correlation** | price ↔ freight ↔ weight | Quantity × Price = revenue |
| **High cardinality** | customer_unique_id ~96K | StockCode ~4K, Invoice ~25K |
| **PII** | ⚠️ Cần inject | ⚠️ Cần inject |
| **Schema sẵn** | ✅✅ ER diagram | ✅ Data dictionary |
| **License** | CC BY-NC-SA 4.0 | CC BY 4.0 |
| **Link** | [Kaggle](https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce) | [Kaggle](https://www.kaggle.com/datasets/mashlyn/online-retail-ii-uci) · [UCI](https://archive.ics.uci.edu/dataset/502/online+retail+ii) |

### 3.4 Hai dataset bổ sung cho nhau như thế nào

| Tính năng demo | Olist | Online Retail II | Ai đảm nhiệm chính? |
|---|:---:|:---:|---|
| Pipeline end-to-end (ingest → stats → propose → HITL → summarize) | ⭐ | ✅ | **Olist** — đa bảng, đa dtype, nhiều chiều phân tích |
| Candidate key detection — single column | ⭐ | ✅ | **Olist** — 5+ PK rõ ràng (order_id, product_id...) |
| Candidate key detection — composite | ✅ | ⭐ | **Online Retail** — Invoice + StockCode |
| FK cross-table detection | ⭐ | ❌ | **Chỉ Olist** — 8 bảng có FK |
| Missing value detection + cảnh báo rủi ro | ✅ | ⭐ | **Online Retail** — 22% null Customer ID rất ấn tượng |
| Outlier detection (IQR/z-score) | ✅ | ⭐ | **Online Retail** — Quantity âm, Price = 0 nổi bật |
| Sampling vs full scan | ❌ | ⭐ | **Chỉ Online Retail** — 1.07M rows |
| Uncertainty annotation (≈, margin_of_error) | ❌ | ⭐ | **Chỉ Online Retail** — đủ lớn để sampling có ý nghĩa |
| Correlation matrix | ⭐ | ✅ | **Olist** — price ↔ freight ↔ weight (3 cặp) |
| Semantic type detection | ⭐ | ✅ | **Olist** — ordinal (review_score), datetime, categorical, free-text |
| QA chat — nhiều chiều hỏi | ⭐ | ✅ | **Olist** — đa bảng nên có nhiều câu hỏi thú vị hơn |
| PII detection & masking | ⚠️ | ⚠️ | Cả 2 cần inject Faker |

**Kết luận**: 2 dataset **không trùng vai trò** — Olist mạnh về multi-table/FK/diversity, Online Retail mạnh về size/null/outlier/sampling. Kết hợp cả 2 cover được toàn bộ tính năng MVP.

### 3.5 Hạn chế chung & cách khắc phục

| Hạn chế | Ảnh hưởng | Cách khắc phục |
|---|---|---|
| **Không có PII** — cả 2 dataset đều đã ẩn danh | Không demo được PII detection → PiiProposal → HITL → mask (tính năng MVP bắt buộc, project_context mục 2.2, 5.1) | **Inject bằng Faker**: thêm 3 cột (`customer_name`, `customer_email`, `customer_phone`) vào bảng customers (Olist) hoặc thêm trực tiếp vào bảng chính (Online Retail). ~15 dòng Python. Tạo thêm 1-2 cột non-PII có tên gây nhầm (`product_name` → test false positive) |
| **Olist: review tiếng Bồ Đào Nha** | NER/PII detection trên text tiếng BĐN có thể kém hơn tiếng Anh | Không ảnh hưởng profiling thống kê. PII inject bằng Faker có thể dùng locale `pt_BR` cho nhất quán, hoặc `en_US` nếu đơn giản hơn |
| **Online Retail: 1 bảng phẳng** | Không demo được FK cross-table | Dùng kết hợp Olist cho demo multi-table. Hoặc tự tách 1 bảng phẳng thành 2+ bảng (customers + transactions) để test thêm |
| **Cả 2 đều thiếu cột boolean / ordinal rõ ràng** | Semantic type detection ít có ground truth cho boolean | `review_score` (1–5) của Olist là ordinal tốt. Có thể thêm cột `is_cancelled` (boolean derived từ Invoice prefix "C") cho Online Retail |

---

## Phần 4 — Survey bổ sung theo Định dạng Dữ liệu & Bộ Data Lỗi (Dirty Data)

### 4.1 Tiêu chí chọn định dạng dữ liệu & data lỗi

#### a) Định dạng dữ liệu (Data Formats)
Agent Profiling cần hỗ trợ đa dạng định dạng nguồn để đáp ứng môi trường thực tế (SQL Warehouse, Data Lake, File Export):

| Định dạng | Đặc điểm kỹ thuật | Thử thách cho Agent Profiling |
|---|---|---|
| **CSV / TSV** | Plaintext, delimited (dấu phẩy, tab, dấu chấm phẩy) | Phải tự parse header, tự suy luận type (string -> numeric/date), xử lý mảng delimiter |
| **Parquet / Feather** | Columnar, compressed, schema-enforced | Zero-copy load với DuckDB, read metadata footer để lấy exact row count/min/max trước khi scan |
| **JSON / JSONL** | Semi-structured, nested objects/arrays, line-delimited | Phải flatten nested structure, xử lý missing key (key không tồn tại khác value `null`), schema drift giữa các record |
| **Excel (.xlsx)** | Multi-sheet, formatted cells, formulas | Phải chọn sheet, bỏ qua row header/footnote dư thừa, ép kiểu từ formatting cell |
| **SQLite (.db / .sqlite)** | Relational database (embedded SQL) | Quét nhiều table, trích xuất DDL / FK constraint sẵn có, text-to-SQL |
| **BigQuery Table** | Distributed Cloud Data Warehouse | Execute remote query (`TABLESAMPLE`, `APPROX_COUNT_DISTINCT`), giới hạn bytes scanned |

#### b) Phân loại Data Lỗi (Dirty Data Categories) để test độ bền Agent

| Mã lỗi | Loại lỗi dữ liệu | Chi tiết hiện tượng | Thử thách & Kỳ vọng với Agent |
|---|---|---|---|
| **ERR1** | **Lỗi kiểu dữ liệu (Invalid & Mixed Types)** | Số bị dính chữ (vd: `$1,200`, `100kg`), ngày tháng sai format (vd: `31/02/2024`, `9999-99-99`, `2024-13-40`), null đại diện bởi string (`"N/A"`, `"null"`, `"?"`, `"-"`) | Agent `compute_stats` không bị crash, nhận diện được dirty type, gắn cờ cảnh báo "cột X có 15% giá trị sai định dạng" |
| **ERR2** | **Lỗi logic & tính toán (Semantic & Logic Errors)** | `Quantity * Price != Total`, giá tiền âm (`Price = -50`), tuổi âm/vượt chuẩn (`Age = -5` hoặc `Age = 250`), duplicate Primary Key | Agent phát hiện được bất thường logic, cảnh báo rủi ro chất lượng ở bước `summarize` |
| **ERR3** | **Lỗi cấu trúc & Encoding (Format & Encoding Errors)** | Lỗi bảng mã (UTF-8 dính BOM, ISO-8859-1), dòng chứa số lượng cột không đều (missing delimiter), dính quote chưa unescape | Ingest node bắt exception mềm dẻo, tự động fallback encoding hoặc cảnh báo corrupt rows |
| **ERR4** | **Lỗi Schema Drift & Missing Keys (JSON/JSONL)** | Record 1 có 5 key, Record 2 có 3 key, Record 3 key `age` là int nhưng Record 4 key `age` lại là string | Profiler tổng hợp được union schema, tính % missing key chính xác |

---

### 4.2 Danh sách Dataset mở rộng theo Định dạng & Data Lỗi (Kèm Link & Phân tích)

#### 1. Định dạng SQLite Relational Database (`.sqlite` / `.db`): **Chinook Database**
* **Nguồn & Link download trực tiếp**: GitHub Releases — [github.com/lerocha/chinook-database/releases](https://github.com/lerocha/chinook-database/releases) (File direct: `Chinook_Sqlite.sqlite`).
* **Định dạng & Cấu trúc**: Database SQLite gồm 11 bảng relational liên kết chặt chẽ (`artists`, `albums`, `tracks`, `invoice_items`, `invoices`, `customers`, `employees`, `genres`, `media_types`, `playlists`, `playlist_track`).
* **Đặc điểm nổi bật**:
  - DDL với Primary Key, Foreign Key và Auto-Increment constraints đầy đủ.
  - Đại diện cho SQL Warehouse thực tế với mối quan hệ 1-N và N-N.
* **Lý do chọn & Tiêu chí khớp**:
  - Khớp tiêu chí **FMT (SQLite), E1, E2, E4**: Làm ground truth hoàn hảo cho bài đánh giá Eval (Precision/Recall) của `propose_metadata` khi nhận diện khóa chính/khóa ngoại trên môi trường SQL thật.

#### 2. Định dạng Semi-Structured JSON & JSONL Siêu nhẹ: **DummyJSON Products Dataset**
* **Nguồn & Link download trực tiếp**: DummyJSON API — [dummyjson.com/products](https://dummyjson.com/products?limit=100) (Size siêu nhẹ: **~148 KB**, 100 sản phẩm E-Commerce).
* **Định dạng & Cấu trúc**: File `.json` chuẩn hoặc `.jsonl` (line-delimited JSON).
* **Đặc điểm nổi bật**:
  - Khớp trực tiếp domain Retail / E-Commerce của MVP.
  - Dữ liệu lồng ghép đa cấp thực tế: `dimensions` (object: `width`, `height`, `depth`), `meta` (object: timestamps, barcode, qrCode), `tags` (array strings), `reviews` (array objects: `rating`, `comment`, `date`, `reviewerName`, `reviewerEmail`).
* **Lý do chọn & Tiêu chí khớp**:
  - Khớp tiêu chí **FMT (JSON/JSONL), D1, D8, ERR4**: Thay thế cho bộ Yelp nặng hàng Gigabytes. Kích thước siêu nhẹ ~148 KB giúp profiling chạy tức thì, test khả năng flatten nested JSON đa cấp và trích xuất PII trong nested arrays (`reviewerEmail`).

#### 3. Định dạng Excel Multi-sheet (`.xlsx`): **Sample - Superstore Sales**
* **Nguồn & Link download trực tiếp**: Kaggle — [kaggle.com/datasets/jr2ngb/superstore-data](https://www.kaggle.com/datasets/jr2ngb/superstore-data) (hoặc nguồn GitHub chính thức của Tableau Samples: [github.com/tableau/tableau-public-samples](https://github.com/tableau/tableau-public-samples))
* **Định dạng & Cấu trúc**: File Excel `.xlsx` gồm 3 Sheets (`Orders`, `People`, `Returns`).
* **Đặc điểm nổi bật**:
  - `Orders`: ~10,000 dòng thông tin bán lẻ chi tiết.
  - `Returns`: Mã đơn bị trả lại (`Returned = Yes`).
  - `People`: Quản lý phụ trách vùng (`Region`, `Person`).
* **Lý do chọn & Tiêu chí khớp**:
  - Khớp tiêu chí **FMT (Excel), D1, D3, D8**: Test khả năng đọc file multi-sheet Excel của Ingest node, tự động chọn sheet để profiling và join sheet `Orders` ↔ `Returns`.

#### 4. Định dạng Parquet Columnar (`.parquet`): **NYC Yellow Taxi Trip Data**
* **Nguồn & Link download trực tiếp**: NYC TLC Official — [nyc.gov/site/tlc/about/tlc-trip-record-data.page](https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page)
* **Định dạng & Cấu trúc**: Apache Parquet (`.parquet`), 3M–9M dòng / file tháng.
* **Đặc điểm nổi bật**:
  - Chuẩn định dạng Columnar nén cao cấp của Data Lake.
  - Chứa cột `passenger_count`, `trip_distance`, `fare_amount`, `VendorID`, `tpep_pickup_datetime`.
  - Có outlier cự ly/tiền taxi âm hoặc cực lớn (`fare_amount = -100` hoặc `$50,000`).
* **Lý do chọn & Tiêu chí khớp**:
  - Khớp tiêu chí **S1, S2, S4, FMT (Parquet)**: Đánh giá tốc độ DuckDB query trực tiếp file `.parquet` lớn >3M dòng, test sampling thích ứng & ước lượng HyperLogLog.

---

#### ⚠️ 3 Bộ Data Lỗi (Dirty / Error Datasets) để Test Độ Bền Agent

#### 5. Bộ Data Lỗi 1 (Format CSV): **Cafe Sales — Dirty Data for Cleaning Training**
* **Nguồn & Link download trực tiếp**: Kaggle — [kaggle.com/datasets/ahmedmohamed2003/cafe-sales-dirty-data-for-cleaning-training](https://www.kaggle.com/datasets/ahmedmohamed2003/cafe-sales-dirty-data-for-cleaning-training)
* **Định dạng**: File CSV (`dirty_cafe_sales.csv`), 10,000 rows, 8 cột.
* **Các lỗi đặc trưng**:
  - *Lỗi Logic/Toán học*: `Total Spent != Quantity * Price Per Unit` ở nhiều dòng (ERR2).
  - *Lỗi Ngày tháng*: Cột `Transaction Date` bị lẫn lộn giữa `YYYY-MM-DD`, `DD/MM/YYYY`, `MM-DD-YYYY` và chuỗi không hợp lệ (ERR1).
  - *Lỗi Primary Key*: Cột `Transaction ID` bị trùng lặp (duplicate IDs) (ERR2).
  - *Lỗi Chuỗi/Null*: Cột `Item` dính typo và chứa chuỗi `"UNKNOWN"`, `"ERROR"`, `""` lộn xộn (ERR1).
* **Lý do chọn & Tiêu chí khớp**:
  - Khớp tiêu chí **ERR1, ERR2, D2, D4**: Test khả năng phát hiện lỗi tính toán toán học & ngày tháng hỗn hợp ở `compute_stats`.

#### 6. Bộ Data Lỗi 2 (Format CSV): **Eyowhite Messy Dataset Collection**
* **Nguồn & Link download trực tiếp**: GitHub — [github.com/eyowhite/Messy-dataset](https://github.com/eyowhite/Messy-dataset)
* **Định dạng**: Repository các file CSV bẩn thực tế chuyên cho test data cleaning.
* **Các lỗi đặc trưng**:
  - *Lỗi Format Header*: Tên cột chứa khoảng trắng, xuống dòng, ký tự đặc biệt không chuẩn hóa.
  - *Lỗi Dirty Numeric*: Cột giá tiền `Price` bị dính ký tự tiền tệ (`$1,200.50`, `EUR 45`), khiến pandas/DuckDB nhận diện nhầm thành kiểu `string/object` (ERR1).
  - *Lỗi Cấu trúc*: Dòng trống hoàn toàn (empty rows) và các dòng dính thiếu/thừa dấu phẩy phân cách (ERR3).
* **Lý do chọn & Tiêu chí khớp**:
  - Khớp tiêu chí **ERR1, ERR3**: Test bước `ingest` & `propose_metadata` khi gặp schema bẩn và dính ký tự tiền tệ.

#### 7. Bộ Data Lỗi 3 (Format CSV): **Jcharis Messy Dataset**
* **Nguồn & Link download trực tiếp**: GitHub — [github.com/Jcharis/Data-Cleaning-Practical-Examples](https://github.com/Jcharis/Data-Cleaning-Practical-Examples) (File direct: `unclean_data.csv`).
* **Định dạng**: File CSV thực tế chứa nhiều lỗi hỗn hợp.
* **Các lỗi đặc trưng**:
  - *Lỗi Format Header*: Tên cột lộn xộn hoa thường (`DIRECTOR_facebook_likes` vs `actor_3_facebook_likes`), dính duplicate header (`title_year`).
  - *Lỗi Null & Khuyết*: Dòng dính phẩy kép `,,`, thông tin thiếu bị bỏ trống hoặc đại diện bằng `?` (ERR1).
  - *Lỗi Dirty Strings*: Tên phim dính dấu chấm hỏi bất thường (`Avatar?`).
* **Lý do chọn & Tiêu chí khớp**:
  - Khớp tiêu chí **ERR1, ERR3, D2**: Test khả năng tự dọn dẹp header trùng lặp, xử lý null dạng comma kép và chuỗi ký tự lỗi.

---

### 4.3 Bảng Ma trận Tổng hợp mở rộng (Format × Data Quality × Target)

| Dataset | Định dạng File | Quy mô / Rows | Domain | Lỗi dữ liệu tiêu biểu | Link Download / Nguồn | Mục đích Test chính |
|---|---|---|---|---|---|---|
| **Brazilian E-Commerce (Olist)** | CSV (8 files) | ~100K | Retail | Missing reviews (>50%), delivery null | [Kaggle](https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce) | **Demo MVP Pipeline (Multi-table FK)** |
| **Online Retail II (UCI)** | CSV | ~1.07M | Retail | CustomerID null 22%, Quantity âm | [Kaggle](https://www.kaggle.com/datasets/mashlyn/online-retail-ii-uci) | **Demo Sampling + Uncertainty (≈)** |
| **Chinook Database** | SQLite (`.db`) | 11 tables | Media | Ground truth sạch chuẩn DDL SQL | [GitHub](https://github.com/lerocha/chinook-database/releases) | **Eval Suite (PK/FK Precision-Recall)** |
| **DummyJSON Products** | JSON / JSONL | 100 rows (~148 KB) | Retail | Nested objects (dimensions), nested arrays (reviews) | [DummyJSON](https://dummyjson.com/products) | **Test Lightweight Nested JSON / JSONL Profiling** |
| **Superstore Sales** | Excel (`.xlsx`) | 3 sheets | Retail | Multi-sheet relation, formatted headers | [Kaggle](https://www.kaggle.com/datasets/jr2ngb/superstore-data) | **Test Ingest Multi-sheet Excel** |
| **NYC Taxi Trips** | Parquet (`.parquet`) | ~3M+ / file | Transport | Outlier tiền fare âm, cự ly 0 | [NYC TLC](https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page) | **Test Large Scale Parquet Query (DuckDB)** |
| **Cafe Sales Dirty Data** | CSV | 10K | FnB | Typo, Total != Qty*Price, date format hỗn hợp | [Kaggle](https://www.kaggle.com/datasets/ahmedmohamed2003/cafe-sales-dirty-data-for-cleaning-training) | **Test Robustness & Error Handling (ERR1, ERR2)** |
| **Eyowhite Messy Dataset** | CSV | ~5K | E-Commerce | Unformatted header, dính ký tự `$`, empty rows | [GitHub](https://github.com/eyowhite/Messy-dataset) | **Test Data Ingestion & Sanitization (ERR1, ERR3)** |
| **Jcharis Messy Dataset** | CSV | ~5K | Entertainment | Duplicate header `title_year`, dirty strings `Avatar?`, empty commas | [GitHub](https://github.com/Jcharis/Data-Cleaning-Practical-Examples) | **Test Unclean Strings & Header Duplicates (ERR1, ERR3)** |

---

*Tài liệu này được cập nhật bổ sung Phần 4 ngày 2026-08-05 cho dự án AI Agent Data Profiling.*
