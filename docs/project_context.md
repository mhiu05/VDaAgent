# Project Context — P-170 AI Data Profiling Agent

## 1. Tổng quan dự án

P-170 là một **AI Data Profiling Agent** hỗ trợ Data Analyst và Data Engineer rút ngắn thời gian làm quen với một bộ dữ liệu mới. Hệ thống cho phép người dùng upload hoặc trỏ tới dataset, tự động tính toán hồ sơ dữ liệu, phát hiện rủi ro chất lượng dữ liệu, đề xuất metadata quan trọng và sinh báo cáo diễn giải bằng ngôn ngữ tự nhiên.

Điểm thiết kế cốt lõi của dự án là tách rõ hai vai trò:

- **Compute Engine** chịu trách nhiệm tính toán toàn bộ chỉ số định lượng như null count, min/max, mean, median, cardinality, outlier, correlation và các kiểm định thống kê. Đây là nguồn sự thật cho mọi con số.
- **LLM** chỉ chịu trách nhiệm diễn giải, suy luận ngữ nghĩa, đề xuất metadata và hỗ trợ hỏi đáp. LLM không được tự bịa hoặc tự tính lại số liệu.

Nhờ cách tiếp cận này, sản phẩm tận dụng được khả năng diễn giải của AI nhưng vẫn giữ nguyên tắc **zero-hallucination metrics**: số liệu hiển thị phải đến từ engine xác định, có thể kiểm chứng và tái lập.

## 2. Vấn đề cần giải quyết

Khi tiếp cận dataset mới, Data Analyst thường phải viết nhiều script thủ công để hiểu schema, phân phối dữ liệu, missing values, outlier, candidate key và các cột nhạy cảm. Công việc này lặp lại, tốn thời gian và dễ thiếu nhất quán giữa các lần phân tích.

Nếu chỉ giao toàn bộ việc phân tích cho LLM, hệ thống lại gặp rủi ro hallucination: LLM có thể trình bày các kết luận hoặc con số sai lệch với vẻ chắc chắn. Với dữ liệu doanh nghiệp, đặc biệt khi có PII hoặc dữ liệu phục vụ huấn luyện model, rủi ro này không thể chấp nhận.

P-170 giải quyết khoảng trống này bằng một luồng làm việc kết hợp:

1. Máy tính toán số liệu một cách deterministic.
2. LLM diễn giải số liệu và đề xuất metadata có evidence.
3. Analyst kiểm duyệt trước khi metadata được ghi nhận chính thức.
4. Hệ thống lưu lại kết quả để truy vấn, so sánh drift và audit về sau.

## 3. Người dùng mục tiêu

| Persona | Vai trò | Nhu cầu chính |
| --- | --- | --- |
| Data Analyst | Người dùng chính, review kết quả profiling và xác nhận metadata | Hiểu nhanh dataset mới, giảm thời gian viết script, tin tưởng được các đề xuất AI |
| Data Engineer | Thiết lập nguồn dữ liệu, vận hành pipeline và tích hợp hệ thống | Có pipeline profiling ổn định, dễ cấu hình, có thể mở rộng sang nhiều nguồn dữ liệu |
| Data Owner / Stakeholder | Người nhận báo cáo và ra quyết định nghiệp vụ | Nắm được chất lượng dữ liệu, rủi ro PII và thay đổi bất thường qua báo cáo dễ đọc |

## 4. Mục tiêu sản phẩm

- Rút ngắn thời gian từ lúc nhận dataset đến lúc có báo cáo profiling đầu tiên từ hàng giờ xuống còn vài phút.
- Đảm bảo 100% số liệu thống kê trong báo cáo được tính bởi compute engine, không phải do LLM tự suy diễn.
- Giúp Analyst xác nhận hoặc chỉnh sửa các đề xuất metadata như candidate key, semantic type và PII trước khi lưu chính thức.
- Phát hiện sớm rủi ro dữ liệu như missing value cao, outlier, PII, schema drift hoặc thay đổi phân phối.
- Cung cấp giao diện hỏi đáp để người dùng truy vấn dataset đã được profile bằng ngôn ngữ tự nhiên.

## 5. Phạm vi MVP

MVP tập trung vào một workflow khép kín cho data profiling:

- Upload hoặc đọc dataset từ `dataset_ref` với các định dạng phổ biến như CSV, TSV, Parquet và JSON.
- Tính thống kê mô tả theo cột bằng DuckDB, pandas, NumPy và SciPy.
- Phát hiện PII bằng rule/regex và heuristic, đồng thời mask dữ liệu nhạy cảm trong API/export.
- Đề xuất metadata gồm:
  - Candidate key.
  - Semantic type.
  - PII flag.
- Cung cấp cơ chế **Human-in-the-Loop** để Analyst confirm, reject hoặc edit proposal.
- Sinh narrative report dựa trên thống kê và quyết định đã được review.
- Hỗ trợ QA về dataset với hai hướng:
  - Structured lookup cho câu hỏi định lượng.
  - Retrieval/BM25 cho câu hỏi định tính hoặc câu hỏi cần ngữ cảnh.
- Hỗ trợ kiểm định thống kê theo yêu cầu và so sánh drift giữa hai profile run.
- Cung cấp Web UI tĩnh tại `/ui/` để demo luồng upload, profiling, review và chat QA.

## 6. Kiến trúc tổng quan

Hệ thống được tổ chức theo ba tầng:

| Tầng | Công nghệ | Trách nhiệm |
| --- | --- | --- |
| Frontend/Web UI | HTML/JS tĩnh hiện tại, có thể mở rộng React/Next.js | Upload dataset, xem profile, review HITL, chat QA |
| Backend API | FastAPI, Pydantic v2, Uvicorn | Validate request, expose REST/SSE API, điều phối graph, bảo mật và audit |
| Agent/Compute | LangGraph, DuckDB, pandas, NumPy, SciPy, LLM provider | Orchestrate profiling, tính toán thống kê, đề xuất metadata, summarize và QA |

LangGraph đóng vai trò state machine cho pipeline profiling. Luồng chính gồm:

1. **Ingest**: đọc dataset và chuẩn hóa metadata đầu vào.
2. **Compute Stats**: tính thống kê, phân phối, outlier, correlation và các chỉ số chất lượng.
3. **Propose Metadata**: tạo proposal cho candidate key, semantic type và PII, kèm confidence/evidence.
4. **HITL Review**: dừng để Analyst xác nhận, từ chối hoặc chỉnh sửa proposal.
5. **Deep Analysis**: chạy kiểm định thống kê bổ sung nếu Analyst yêu cầu.
6. **Summarize**: sinh báo cáo diễn giải sau khi đã có thống kê và quyết định review.
7. **QA**: định tuyến câu hỏi sang structured lookup hoặc retrieval.

## 7. Nguyên tắc thiết kế

- **Zero-hallucination metrics**: LLM không được tự tính toán hoặc tự sinh số liệu. Mọi số định lượng phải đến từ compute engine.
- **Human-in-the-Loop mặc định**: Candidate key và PII cần Analyst xác nhận trước khi áp dụng. Các semantic type ít rủi ro có thể auto-confirm nếu confidence đủ cao và có audit log.
- **Evidence-first metadata**: Mỗi đề xuất metadata phải có lý do và bằng chứng từ thống kê, ví dụ uniqueness ratio, null rate, pattern match hoặc distribution.
- **Privacy by design**: Không gửi raw data nguyên bản cho LLM. Prompt chỉ nên chứa schema, thống kê, mẫu đã mask hoặc metadata cần thiết.
- **Fail-closed security**: Mặc định không export raw data và không trả sample value của cột PII trong câu trả lời.
- **Reproducibility**: Sampling cần có `random_seed`; kết quả approximate phải được ghi chú rõ để người dùng không nhầm với full scan.
- **Extensible provider**: LLM provider được cấu hình qua `.env` và `config.yaml`, không khóa chặt vào một nhà cung cấp.

## 8. Dữ liệu và lưu trữ

Trong môi trường phát triển, hệ thống dùng SQLite để giảm chi phí setup:

- `data/app.db`: lưu metadata, profile run, proposal và kết quả review.
- `data/checkpoints.sqlite`: lưu checkpoint cho LangGraph nếu chưa cấu hình checkpointer riêng.
- `data/uploads/`: lưu file upload.
- `data/audit.jsonl`: ghi lại các hành động nhạy cảm như confirm/reject/edit metadata.

Khi triển khai production, `DATABASE_URL` có thể trỏ sang PostgreSQL. Secret như API key, database password và token bảo mật phải đặt trong `.env`, không đặt trong `config.yaml`.

## 9. Tiêu chí thành công

- Thời gian tạo profile report đầu tiên cho dataset nhỏ/trung bình đủ nhanh để phục vụ demo và workflow hằng ngày.
- Các chỉ số thống kê khớp với thư viện chuẩn như pandas/DuckDB trong test.
- Analyst có thể hoàn thành vòng review metadata mà không cần chỉnh file hoặc chạy script thủ công.
- Các cột PII được phát hiện sớm và được mask trong response/export mặc định.
- QA trả lời câu hỏi định lượng bằng dữ liệu đã lưu, không bằng suy đoán của LLM.
- Có audit trail cho quyết định HITL và hành động có rủi ro.

## 10. Phạm vi mở rộng

Sau MVP, dự án có thể mở rộng theo các hướng:

- **Trend & Drift Analysis nâng cao**: so sánh nhiều profile run theo thời gian để phát hiện schema drift, data volume change và distribution shift.
- **External Research có citation**: dùng web search để bổ sung ngữ cảnh ngành/quy định, nhưng chỉ làm nguồn tham khảo, không thay thế compute engine.
- **MCP Calendar/Notification**: lên lịch profiling định kỳ, nhắc review run đang chờ duyệt, hoặc tạo cảnh báo khi có rủi ro nghiêm trọng.
- **Data Quality Scoring & Rule Engine**: chấm điểm chất lượng dữ liệu theo completeness, uniqueness, validity, consistency và lưu validation rule đã được Analyst duyệt.
- **Multi-source connectors**: hỗ trợ PostgreSQL, MySQL, S3, GCS hoặc BigQuery ngoài upload file.

## 11. Out of Scope

- Không thay thế Data Catalog hoặc Data Governance Platform đầy đủ như Collibra/Alation.
- Không thay thế BI/Visualization Platform như Tableau hoặc Power BI.
- Không tự động sửa, clean hoặc transform dữ liệu production.
- Không thay thế pipeline ETL/ELT hiện có.
- Không tự động áp dụng metadata rủi ro cao nếu chưa có quyết định review rõ ràng.
