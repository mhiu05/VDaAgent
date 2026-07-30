# Architecture Decision Records (ADRs)

Tài liệu ghi nhận các quyết định kiến trúc quan trọng của dự án **AI Agent Data Profiling**. Mỗi ADR mô tả bối cảnh, các lựa chọn đã cân nhắc, quyết định cuối cùng và hệ quả đi kèm.

**Tham chiếu:** [project_context.md](./project_context.md)

---

# ADR-001: Chọn LangGraph làm Agent Orchestration Framework

**Ngày:** 2026-07-30
**Trạng thái:** Accepted

## Bối cảnh (Context)

Hệ thống cần orchestrate một pipeline profiling nhiều bước tuần tự: `ingest → compute_stats → propose_metadata → HITL → deep_analysis → summarize → QA`. Pipeline có đặc điểm:
- Cần **dừng giữa chừng** (interrupt) tại bước HITL để chờ Analyst xác nhận — có thể kéo dài hàng giờ hoặc vài ngày.
- Có **vòng lặp** (loop) giữa HITL và deep_analysis: Analyst có thể yêu cầu kiểm định bổ sung nhiều lần.
- Cần **routing có điều kiện**: QA tách 2 nhánh (structured lookup vs vector search) dựa trên loại câu hỏi.
- State cần được quản lý rõ ràng xuyên suốt pipeline (stats JSON, proposals, kết quả kiểm định…).

## Các lựa chọn (Alternatives)

### Lựa chọn 1: LangGraph
- Ưu điểm: State machine với typed state, hỗ trợ native interrupt/resume cho HITL, conditional edges cho routing, checkpointing hỗ trợ persistence state qua restart, tích hợp chặt với LangChain ecosystem (tool calling, LLM abstraction).
- Nhược điểm: Tương đối mới, tài liệu chưa phong phú bằng các framework lâu đời, learning curve cho team chưa quen graph-based orchestration.

### Lựa chọn 2: CrewAI
- Ưu điểm: Multi-agent framework dễ cấu hình với role-based agents, cú pháp declarative đơn giản, phù hợp khi mỗi bước là một "agent" độc lập.
- Nhược điểm: Thiếu cơ chế interrupt/resume native cho HITL — phải tự build; ít kiểm soát flow chi tiết (conditional branching, loop), khó xử lý vòng lặp HITL ↔ deep_analysis phức tạp.

### Lựa chọn 3: Custom Python orchestration (asyncio + queue)
- Ưu điểm: Toàn quyền kiểm soát, không phụ thuộc framework bên ngoài, lightweight.
- Nhược điểm: Phải tự xây dựng: state management, interrupt/resume, checkpointing, retry logic — tốn effort đáng kể và dễ phát sinh bug; không có sẵn tool calling abstraction, phải tự tích hợp với LLM provider.

## Quyết định (Decision)

Chọn **Lựa chọn 1: LangGraph**.

## Lý do (Rationale)

1. LangGraph hỗ trợ **interrupt native** — chính xác là cơ chế cần cho HITL (mục 2.1 project_context): dừng graph tại node, serialize state, resume khi Analyst phản hồi qua UI.
2. **Conditional edges** cho phép routing linh hoạt: phân luồng QA (structured lookup vs vector search), phân nhánh HITL (auto-confirm vs sync confirm).
3. **State machine model** khớp với pipeline profiling có state phức tạp (stats JSON, proposals, kết quả kiểm định) chạy xuyên suốt nhiều node.
4. **Checkpointer** có thể gắn vào PostgreSQL (cùng instance với Metadata DB) để giữ state qua server restart — quan trọng vì HITL có thể kéo dài vài ngày.
5. Tích hợp tốt với LangChain ecosystem: tool calling cho QA structured lookup, LLM abstraction cho summarize/propose.

## Hệ quả (Consequences)

- Team cần invest thời gian học LangGraph API và graph-based thinking.
- Phụ thuộc vào LangGraph release cycle — nếu API thay đổi, cần cập nhật.
- Cần cấu hình checkpointer persistent (PostgreSQL) trước khi lên production — nếu chỉ dùng in-memory checkpointer, sẽ mất state khi restart (đã ghi nhận ở Known Limitation L2).

---

# ADR-002: Tách QA thành 2 nhánh — Structured Lookup và Vector Search Hybrid

**Ngày:** 2026-07-30
**Trạng thái:** Accepted

## Bối cảnh (Context)

Lời hứa cốt lõi của hệ thống: trả lời câu hỏi NL về dataset **không hallucinate**. Thiết kế ban đầu (v1) đẩy mọi câu hỏi QA qua ChromaDB vector search. Tuy nhiên:
- **Câu hỏi định lượng** (vd: "null % cột X là bao nhiêu?") cần **con số chính xác** — vector similarity không đảm bảo tìm đúng số, và kể cả retrieve đúng context thì LLM vẫn phải "đọc" và gõ lại số → có thể lệch.
- **Câu hỏi định tính/lịch sử** (vd: "dataset này đổi gì so với tháng trước?") cần ngữ cảnh rộng, phù hợp hơn với retrieval-augmented generation.

Đây là 1 trong 3 điểm **ưu tiên MVP** từ bản review.

## Các lựa chọn (Alternatives)

### Lựa chọn 1: Tách 2 nhánh (QA Router → Structured Lookup + Vector Search Hybrid)
- Ưu điểm: Câu hỏi định lượng lấy số trực tiếp từ DB (tool-calling / text-to-SQL), **grounding đảm bảo bằng kiến trúc** — LLM chỉ diễn đạt, không generate số. Câu hỏi định tính dùng hybrid retrieval (FAISS + BM25 + cross-encoder rerank) cho chất lượng retrieval tốt hơn vector thuần.
- Nhược điểm: Cần implement QA router để phân loại câu hỏi (thêm complexity), cần maintain 2 pipeline QA song song.

### Lựa chọn 2: Chỉ dùng Vector Search (ChromaDB) cho tất cả câu hỏi
- Ưu điểm: Kiến trúc đơn giản, 1 pipeline duy nhất, dễ implement và maintain.
- Nhược điểm: Vector similarity không đảm bảo tìm đúng con số chính xác; LLM phải tự "đọc" và gõ lại số từ context → vẫn có thể lệch dù không bịa; chống hallucination chỉ dựa vào validate hậu kiểm (fragile).

### Lựa chọn 3: Chỉ dùng Text-to-SQL cho tất cả câu hỏi
- Ưu điểm: Mọi câu trả lời đều grounded trên dữ liệu thực.
- Nhược điểm: Không xử lý được câu hỏi định tính/lịch sử/so sánh mở ("nhận xét gì về chất lượng dataset này?"), text-to-SQL khó sinh query cho câu hỏi mơ hồ hoặc multi-hop.

## Quyết định (Decision)

Chọn **Lựa chọn 1: Tách 2 nhánh**.

## Lý do (Rationale)

1. **Grounding cho câu hỏi định lượng được đảm bảo bằng kiến trúc**: số được chèn trực tiếp từ DB vào câu trả lời, LLM chỉ format ngôn ngữ — kỳ vọng 100% accuracy (mục 8 project_context).
2. Hybrid retrieval (FAISS + BM25 + cross-encoder rerank) cho câu hỏi định tính vượt trội so với chỉ dùng ChromaDB dense search thuần — cải thiện recall cho keyword-heavy queries.
3. QA router đơn giản (phân loại "câu hỏi về số liệu cụ thể" vs "câu hỏi mở/so sánh") — có thể dùng LLM classifier hoặc rule-based, complexity chấp nhận được.
4. Đây là biện pháp chống hallucination **proactive** (kiến trúc ngăn từ gốc) thay vì **reactive** (validate sau) — phù hợp với ràng buộc mục 2.3.

## Hệ quả (Consequences)

- Cần implement QA router — có thể dùng LLM function calling hoặc intent classification đơn giản.
- Cần maintain 2 pipeline QA: structured lookup (tool-calling / text-to-SQL) và vector search hybrid.
- Vector store chuyển từ ChromaDB sang FAISS + BM25 — cần cập nhật deployment architecture.
- Metric đánh giá QA chia 2: accuracy (định lượng) và relevance/faithfulness (định tính).

---

# ADR-003: Nâng PII Detection từ Boolean Flag thành Proposal có HITL

**Ngày:** 2026-07-30
**Trạng thái:** Accepted

## Bối cảnh (Context)

Thiết kế v1 lưu `is_pii` như một boolean phẳng trên `ColumnStat` — không có `status`, `evidence`, `confirmed_by` như `CandidateKeyProposal` hay `SemanticTypeProposal`. Điều này mâu thuẫn với:
- Mục 9 (v1) viết "nên cho user tự đánh dấu thêm cột PII" — nhưng schema không hỗ trợ workflow này.
- PII detection (heuristic + regex) không hoàn hảo — có thể miss PII "ẩn" trong free-text, hoặc gắn nhầm cờ (false positive).
- PII là quyết định **ảnh hưởng lớn** (governance, compliance) — ngang tầm candidate key — cần được review, không nên auto-commit.

Đây là 1 trong 3 điểm **ưu tiên MVP** từ bản review.

## Các lựa chọn (Alternatives)

### Lựa chọn 1: Nâng thành PiiProposal entity riêng, đi qua HITL
- Ưu điểm: Nhất quán với `CandidateKeyProposal` và `SemanticTypeProposal` — cùng luồng propose → HITL confirm/reject → ghi metadata. Có `detection_method`, `confidence_score`, `evidence`, `status`, `confirmed_by` — trace được rõ ràng. Analyst có thể override (thêm/bỏ PII flag) — lớp bảo vệ bổ sung.
- Nhược điểm: Thêm 1 entity vào schema, thêm proposals cần review ở bước HITL (tuy nhiên phân tầng HITL giảm thiểu friction).

### Lựa chọn 2: Giữ boolean `is_pii` trên ColumnStat, thêm endpoint manual override
- Ưu điểm: Schema đơn giản, ít thay đổi, nhanh implement.
- Nhược điểm: Không trace được ai set/unset PII flag, không có evidence, không đi qua luồng review — rủi ro governance cao. Hai luồng logic song song (auto detect + manual override) dễ conflict.

### Lựa chọn 3: Giữ boolean, thêm audit log riêng
- Ưu điểm: Ít thay đổi schema chính, vẫn có traceability qua audit log.
- Nhược điểm: Audit log tách rời khỏi entity → khó query, khó hiển thị trên UI HITL, thiết kế không nhất quán với 2 loại proposal kia.

## Quyết định (Decision)

Chọn **Lựa chọn 1: PiiProposal entity riêng, đi qua HITL**.

## Lý do (Rationale)

1. **Nhất quán về mặt thiết kế**: cả 3 loại suy luận (candidate key, semantic type, PII) đều là proposal → cùng 1 luồng HITL, cùng schema pattern, dễ hiểu và dễ maintain.
2. **Traceability**: biết PII detection bằng phương pháp nào (`heuristic` / `regex` / `NER` / `LLM` / `manual`), confidence bao nhiêu, ai confirm — quan trọng cho audit compliance.
3. **Analyst override**: user có thể đánh dấu thêm cột PII mà heuristic miss (tạo PiiProposal với `detection_method = manual`) → đúng ý định ở mục 9 v1.
4. **HITL phân tầng** (ADR-004) giảm friction: PII proposal confidence cao (vd: cột tên `email`, 98% values match regex) có thể auto-confirm.

## Hệ quả (Consequences)

- Xóa field `is_pii` khỏi `ColumnStat`, thay bằng entity `PiiProposal` mới trong ER diagram.
- HITL UI cần hiển thị thêm PII proposals bên cạnh candidate key và semantic type proposals.
- Cần cập nhật summarize node: query `PiiProposal` (thay vì đọc boolean) để mask giá trị PII trong báo cáo.
- `PiiProposal` bổ sung field `detection_method` không có ở 2 proposal kia — schema hơi khác biệt nhưng chấp nhận được.

---

# ADR-004: HITL phân tầng (Tiered Review)

**Ngày:** 2026-07-30
**Trạng thái:** Accepted

## Bối cảnh (Context)

Ràng buộc HITL (mục 2.1) yêu cầu "mọi candidate key / semantic type / PII đều cần Analyst confirm". Điều này ổn với demo 1–2 bảng, nhưng warehouse thực (vài chục bảng × vài chục cột mỗi bảng) sẽ tạo ra hàng trăm proposals, khiến HITL từ chỗ bảo vệ chất lượng biến thành **bottleneck**.

## Các lựa chọn (Alternatives)

### Lựa chọn 1: HITL phân tầng (tiered review)
- Ưu điểm: Proposal confidence cao (≥ 95%) + rủi ro thấp (vd: semantic type cho `email_address`) auto-confirm kèm audit log, Analyst review sau (async). Chỉ giữ sync confirm bắt buộc cho suy luận ảnh hưởng lớn (candidate key, PII, confidence thấp). Giảm friction, scale được.
- Nhược điểm: Cần define rõ threshold và điều kiện "rủi ro thấp" — nếu sai có thể auto-confirm nhầm. Complexity tăng (2 luồng review thay vì 1).

### Lựa chọn 2: Confirm tất cả (giữ nguyên v1)
- Ưu điểm: An toàn tuyệt đối, mọi quyết định đều qua Analyst.
- Nhược điểm: Không scale — warehouse lớn gây review fatigue, Analyst click "confirm" máy móc mà không đọc → ngược lại mục đích ban đầu.

### Lựa chọn 3: Batch confirm theo bảng
- Ưu điểm: Analyst review 1 lần cho cả bảng, giảm số lần click.
- Nhược điểm: Vẫn synchronous — pipeline bị block. Dễ miss detail khi review cả đống proposal cùng lúc.

## Quyết định (Decision)

Chọn **Lựa chọn 1: HITL phân tầng**.

## Lý do (Rationale)

1. Giữ **sync confirm cho quyết định ảnh hưởng lớn** (candidate key — đặc biệt composite key dùng để join, PII) — đúng tinh thần HITL.
2. **Auto-confirm cho low-risk + high-confidence** giảm bottleneck khi scale — Analyst không phải review từng semantic type hiển nhiên.
3. **Audit log** cho auto-confirm đảm bảo traceability — Analyst có thể review async và revert nếu phát hiện sai.
4. Threshold (≥ 95% confidence + rủi ro thấp) là configurable — team có thể điều chỉnh theo risk tolerance cụ thể.

## Hệ quả (Consequences)

- Cần implement logic phân loại "high-confidence + low-risk" tại HITL node — define rõ rule trong config.
- HITL UI cần 2 view: "pending review" (sync) và "auto-confirmed" (async review).
- Audit log cần ghi đủ: proposal nào auto-confirmed, tại sao (confidence + rule matched), timestamp.
- Nếu threshold sai → auto-confirm proposal không chính xác → cần mechanism để Analyst revert auto-confirm.

---

# ADR-005: DuckDB làm Compute Engine chính cho thống kê

**Ngày:** 2026-07-30
**Trạng thái:** Accepted

## Bối cảnh (Context)

Ràng buộc mục 2.3: mọi số liệu thống kê phải **tính toán bằng compute engine** — LLM không tự tính hay đoán số. Cần chọn engine xử lý dữ liệu: tính null%, cardinality, distribution, outlier (IQR/z-score), correlation matrix, và các kiểm định thống kê (Shapiro-Wilk, Chi-square, T-test…). Dữ liệu đầu vào: CSV upload hoặc sample từ BigQuery (đã kéo về local).

## Các lựa chọn (Alternatives)

### Lựa chọn 1: DuckDB (kết hợp ydata-profiling cho profiling tự động)
- Ưu điểm: In-process OLAP database, không cần server riêng, xử lý file CSV/Parquet nhanh, SQL interface quen thuộc, hỗ trợ approximate aggregates, zero-copy với pandas. ydata-profiling bổ sung: auto-generate profile report, phát hiện correlation/missing pattern sẵn.
- Nhược điểm: Xử lý tại server — nếu dataset rất lớn (sau sampling vẫn lớn) có thể tốn RAM. ydata-profiling chạy full profiling có thể chậm với dataset lớn (cần tuning).

### Lựa chọn 2: Pandas / NumPy thuần
- Ưu điểm: Linh hoạt tối đa, quen thuộc với mọi data engineer, thư viện scipy/statsmodels cho kiểm định thống kê.
- Nhược điểm: Không tối ưu cho query lớn (single-threaded, memory-heavy), phải tự viết toàn bộ logic aggregation thay vì dùng SQL, không có query optimizer.

### Lựa chọn 3: Spark / Polars
- Ưu điểm: Distributed processing (Spark) hoặc multi-threaded (Polars), scale tốt.
- Nhược điểm: Spark overkill cho MVP (cần cluster), Polars API khác pandas — learning curve. Cả hai đều cần thêm infrastructure.

## Quyết định (Decision)

Chọn **Lựa chọn 1: DuckDB + ydata-profiling**.

## Lý do (Rationale)

1. **In-process, zero-dependency**: không cần deploy database server riêng — DuckDB chạy embedded trong Python process, phù hợp Docker single-container deployment.
2. **SQL interface** cho phép viết logic thống kê dễ đọc, dễ debug — và có thể chuyển sang text-to-SQL cho QA structured lookup.
3. **ydata-profiling** giúp bootstrap nhanh: auto-generate correlation matrix, missing value pattern, distribution detection — giảm custom code ở `compute_stats` node.
4. DuckDB hỗ trợ **approximate aggregates** (`APPROX_COUNT_DISTINCT`, `APPROX_QUANTILES`) — khớp với chiến lược sampling ở mục 2.4.
5. Nếu cần scale lên sau MVP, có thể chuyển heavy computation sang BigQuery (push-down query) mà giữ DuckDB cho local CSV.

## Hệ quả (Consequences)

- Compute chạy tại backend server — cần đủ RAM cho sample dataframe (sau sampling, thường < 1GB → chấp nhận được).
- ydata-profiling sinh output cần parse/map sang schema `ColumnStat` — cần adapter layer.
- Kiểm định thống kê nâng cao (Shapiro-Wilk, ANOVA…) không có sẵn trong DuckDB — dùng scipy/statsmodels bổ sung tại `deep_analysis` node.
- DuckDB không phải database persistent — chỉ dùng cho compute, kết quả ghi vào PostgreSQL.

---

# ADR-006: Chú thích Uncertainty cho số liệu Sampling

**Ngày:** 2026-07-30
**Trạng thái:** Accepted

## Bối cảnh (Context)

Mục 2.3 ghi "mọi con số phải deterministic", nhưng mục 2.4 khuyến khích dùng `APPROX_COUNT_DISTINCT` (HyperLogLog) và `TABLESAMPLE` để tiết kiệm chi phí BigQuery. Hai ràng buộc này mâu thuẫn ngầm: bản thân số liệu từ sampling/approximate functions là **ước lượng**, không phải giá trị thật của toàn bảng. Nếu báo cáo in "cardinality = 15.234" mà không kèm chú thích, Analyst dễ tin nhầm là số chính xác tuyệt đối.

Đây là 1 trong 3 điểm **ưu tiên MVP** từ bản review.

## Các lựa chọn (Alternatives)

### Lựa chọn 1: Chú thích uncertainty rõ ràng (≈, confidence interval, schema markers)
- Ưu điểm: Analyst biết rõ số nào chính xác, số nào ước lượng. Schema lưu `is_approximate` + `margin_of_error` — truy vấn programmatic được. Báo cáo NL phản ánh tính chất ước lượng ("cardinality ước lượng khoảng 15.234 ±X").
- Nhược điểm: Thêm complexity vào UI (hiển thị ≈, tooltip confidence interval), thêm 2 fields vào ColumnStat schema, summarize prompt phức tạp hơn.

### Lựa chọn 2: Chỉ ghi chú ở đầu báo cáo "số liệu này tính từ sampling"
- Ưu điểm: Đơn giản, ít thay đổi schema/UI.
- Nhược điểm: Disclaimer ở đầu dễ bị bỏ qua; Analyst không biết số nào bị ảnh hưởng nhiều bởi sampling (vd: cardinality nhạy hơn null_pct); không phân biệt được per-metric.

### Lựa chọn 3: Không chú thích — tin tưởng Analyst hiểu sampling
- Ưu điểm: Không thay đổi gì.
- Nhược điểm: Rủi ro cao — Analyst ra quyết định sai dựa trên số ước lượng mà tưởng là chính xác; mâu thuẫn với ràng buộc "mọi nhận định phải trace được về số liệu cụ thể" (mục 2.3).

## Quyết định (Decision)

Chọn **Lựa chọn 1: Chú thích uncertainty rõ ràng**.

## Lý do (Rationale)

1. **Trung thực về dữ liệu** — nguyên tắc cốt lõi của profiling tool: nếu số là ước lượng thì phải nói rõ.
2. `is_approximate` (boolean) + `margin_of_error` (float) trên `ColumnStat` cho phép **programmatic access** — QA structured lookup có thể trả lời "cardinality cột X ≈ 15.234 ± 200" thay vì "15.234".
3. Ký hiệu "≈" trên UI đủ trực quan mà không gây rối — tooltip hiện confidence interval khi hover cho Analyst muốn biết chi tiết.
4. HyperLogLog (dùng bởi `APPROX_COUNT_DISTINCT`) có **công thức standard error đã biết** → tính margin_of_error feasible, không cần bootstrap phức tạp.

## Hệ quả (Consequences)

- `ColumnStat` schema thêm 2 fields: `is_approximate` (boolean), `margin_of_error` (float, nullable).
- `compute_stats` node cần set 2 fields này dựa trên `scan_mode` của `ProfileRun`.
- `summarize` node prompt cần handle 2 trường hợp: số chính xác vs ước lượng — viết template khác nhau.
- UI hiển thị ≈ icon/badge cạnh số ước lượng + tooltip cho confidence interval.
- Full scan → `is_approximate = false`, `margin_of_error = null` → không ảnh hưởng gì.

---

# ADR-007: FAISS + BM25 Hybrid Retrieval thay vì ChromaDB thuần cho QA

**Ngày:** 2026-07-30
**Trạng thái:** Accepted

## Bối cảnh (Context)

QA node (nhánh câu hỏi định tính/lịch sử) cần retrieval-augmented generation. Thiết kế v1 dùng ChromaDB làm vector store duy nhất. Tuy nhiên, ChromaDB chỉ hỗ trợ dense embedding search — thiếu keyword matching (BM25) khiến recall thấp cho câu hỏi chứa keyword cụ thể (tên cột, tên bảng, metric name).

## Các lựa chọn (Alternatives)

### Lựa chọn 1: FAISS (dense) + BM25 (keyword) + cross-encoder rerank
- Ưu điểm: Hybrid retrieval kết hợp ưu điểm cả 2 phương pháp — dense embedding bắt ngữ nghĩa, BM25 bắt keyword chính xác. Cross-encoder rerank cải thiện precision. FAISS chạy in-process, không cần server riêng.
- Nhược điểm: Cần implement hybrid pipeline (merge + rerank kết quả từ 2 nguồn), thêm dependency (FAISS, rank-bm25).

### Lựa chọn 2: ChromaDB thuần (dense embedding only)
- Ưu điểm: Đơn giản, 1 component, managed server (chạy trong Docker), tích hợp sẵn với LangChain.
- Nhược điểm: Chỉ dense search — miss khi câu hỏi chứa keyword cụ thể (tên cột `user_id`, metric `null_pct`). Không có keyword matching → recall thấp cho technical queries.

### Lựa chọn 3: Elasticsearch / OpenSearch
- Ưu điểm: Hybrid search built-in (dense + sparse), mature, scalable, full-text search mạnh.
- Nhược điểm: Heavy infrastructure — cần server riêng, overkill cho MVP, tăng complexity deployment.

## Quyết định (Decision)

Chọn **Lựa chọn 1: FAISS + BM25 + cross-encoder rerank**.

## Lý do (Rationale)

1. **Hybrid retrieval** cải thiện recall đáng kể so với dense-only: câu hỏi "cardinality cột user_id thay đổi thế nào?" cần cả keyword match (`user_id`, `cardinality`) lẫn semantic match.
2. **FAISS chạy in-process** — không cần thêm container trong Docker Compose, giảm infrastructure overhead so với Elasticsearch.
3. **Cross-encoder rerank** (vd: `cross-encoder/ms-marco-MiniLM-L-6-v2`) cải thiện precision sau khi merge kết quả từ 2 nguồn — chấp nhận latency tăng nhẹ (rerank top-k nhỏ).
4. Phù hợp quy mô MVP: lịch sử profiling không quá lớn (vài chục → vài trăm profile runs), FAISS in-memory đủ nhanh.

## Hệ quả (Consequences)

- Thay thế ChromaDB bằng FAISS + BM25 trong deployment architecture.
- Cần implement hybrid retrieval pipeline: query cả 2 source → merge scores → cross-encoder rerank → return top-k.
- FAISS index chạy in-memory — cần persistence (save/load index) để không mất khi restart.
- Nếu scale lên nhiều profile runs, có thể cần chuyển sang managed vector DB (Pinecone, Weaviate, hoặc quay lại Elasticsearch).

---

# ADR-008: FastAPI làm Backend Framework

**Ngày:** 2026-07-30
**Trạng thái:** Accepted

## Bối cảnh (Context)

Backend cần phục vụ: REST API cho frontend, điều phối LangGraph agent, xác thực request, serve kết quả profiling + QA. Cần async support vì LangGraph interrupt/resume có thể kéo dài, và agent pipeline chạy background (non-blocking).

## Các lựa chọn (Alternatives)

### Lựa chọn 1: FastAPI + Uvicorn
- Ưu điểm: Async-native (ASGI), Pydantic validation tích hợp sẵn (type-safe request/response), auto-generate OpenAPI docs, performance tốt, ecosystem Python phong phú, LangGraph SDK tương thích trực tiếp.
- Nhược điểm: Python single-process — cần multiple workers (Uvicorn) cho concurrency cao.

### Lựa chọn 2: Django + Django REST Framework
- Ưu điểm: Mature, batteries-included (ORM, admin, auth), cộng đồng lớn.
- Nhược điểm: Sync-first (async support qua ASGI mới, chưa mature), ORM có thể conflict với schema tự quản lý, heavy cho use case API-only.

### Lựa chọn 3: Flask
- Ưu điểm: Lightweight, flexible, quen thuộc.
- Nhược điểm: Sync-first, không có Pydantic validation built-in, cần nhiều extension, async support kém.

## Quyết định (Decision)

Chọn **Lựa chọn 1: FastAPI + Uvicorn**.

## Lý do (Rationale)

1. **Async-native** — quan trọng vì LangGraph agent chạy async, HITL interrupt/resume cần non-blocking I/O.
2. **Pydantic validation** đảm bảo type safety cho request/response — giảm bug khi truyền dữ liệu giữa frontend ↔ backend ↔ agent.
3. **Auto-generated OpenAPI docs** giúp frontend team tự reference API mà không cần tài liệu riêng.
4. **Python ecosystem** — cùng ngôn ngữ với LangGraph, DuckDB, ydata-profiling, scipy — không cần bridge giữa languages.

## Hệ quả (Consequences)

- Deploy với Uvicorn + multiple workers cho production.
- Pydantic models cần sync với frontend TypeScript types — nên dùng code generation (vd: `openapi-typescript-codegen`).
- Không có built-in ORM — dùng SQLAlchemy hoặc raw SQL cho PostgreSQL queries.

---

# ADR-009: SQLite (dev) → PostgreSQL (prod) cho Metadata DB

**Ngày:** 2026-07-30
**Trạng thái:** Accepted

## Bối cảnh (Context)

Hệ thống cần lưu trữ persistent: Dataset, ProfileRun, ColumnStat, 3 loại Proposal (CandidateKey, SemanticType, PII), StatisticalTestResult, DriftReport. Cần hỗ trợ query lịch sử (drift detection so sánh 2 ProfileRun), query cho QA structured lookup (text-to-SQL truy vấn ColumnStat).

## Các lựa chọn (Alternatives)

### Lựa chọn 1: SQLite (dev) → PostgreSQL (prod)
- Ưu điểm: SQLite zero-config cho development/testing — nhanh setup, file-based. PostgreSQL cho production — robust, concurrent access, JSON support tốt, có thể dùng chung cho LangGraph checkpointer. Migration path rõ ràng (cùng SQL dialect với minor differences).
- Nhược điểm: Phải test trên cả 2 DB. SQLite không hỗ trợ concurrent write — chỉ dùng cho dev.

### Lựa chọn 2: PostgreSQL cho cả dev và prod
- Ưu điểm: Consistency — dev/prod dùng cùng DB, không có surprise khi deploy.
- Nhược điểm: Dev setup phức tạp hơn (cần Docker hoặc install PostgreSQL local), overkill cho 1 developer test nhanh.

### Lựa chọn 3: MongoDB (NoSQL)
- Ưu điểm: Schema-flexible — phù hợp nếu ColumnStat schema thay đổi thường xuyên, JSON-native.
- Nhược điểm: Không phù hợp cho QA structured lookup (text-to-SQL cần relational DB), thiếu ACID transaction, join khó — ER diagram relational model không map tốt.

## Quyết định (Decision)

Chọn **Lựa chọn 1: SQLite (dev) → PostgreSQL (prod)**.

## Lý do (Rationale)

1. **SQLite cho dev** — zero overhead, nhanh prototype, mọi developer đều có sẵn.
2. **PostgreSQL cho prod** — robust, hỗ trợ concurrent access (nhiều Analyst chạy profiling cùng lúc), JSON column type cho `top_k_values`, `drift_columns`.
3. **PostgreSQL có thể dùng chung cho LangGraph checkpointer** (Known Limitation L2) — giảm 1 component trong deployment.
4. **Relational model** khớp hoàn toàn với ER diagram mục 4.4 — và hỗ trợ text-to-SQL cho QA structured lookup.

## Hệ quả (Consequences)

- Cần ORM hoặc query builder tương thích cả SQLite và PostgreSQL (SQLAlchemy là lựa chọn tự nhiên).
- Dev cần chạy migration test trên PostgreSQL trước khi merge — CI/CD nên có PostgreSQL service.
- LangGraph checkpointer nên gắn vào cùng PostgreSQL instance (implementation ở phase sau MVP).

---
