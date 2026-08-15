# Năng lực hiện tại của Agent

Tài liệu này mô tả các phần Agent đang hỗ trợ trong hệ thống, dữ liệu Agent được phép dùng, và giới hạn để tránh bịa thông tin.

## 1. Các luồng Agent chính

Hệ thống hiện có các luồng Agent sau:

- Chat với report đã lưu.
- Tool-calling Q&A trên saved report.
- Tool-calling profiling plan builder.
- Tool-calling database table recommender.
- Knowledge document search cho requirement/policy.
- HITL review support.
- Agent trace và observability.

## 2. Saved Report Q&A

Khi người dùng chọn một saved report trong khung chat, Agent không đọc lại file CSV gốc. Agent đọc dữ liệu đã được lưu trong profile report.

Report có thể chứa:

- Số dòng và số cột.
- Schema và kiểu dữ liệu.
- Null count, null ratio.
- Distinct count, distinct ratio.
- Top values của cột categorical.
- Findings.
- PII detections.
- Correlations nếu profiling đã sinh ra.
- HITL/governance signals.

Agent phải trả lời dựa trên evidence trong report. Nếu report không có dữ liệu cần thiết, Agent phải nói rõ là không có bằng chứng trong saved report.

## 3. Saved Report Tools

Saved report chat hiện dùng tool-calling thật. LLM phải chọn tool cụ thể trước khi trả lời.

Các tool chính:

- `get_report_overview`: lấy tổng quan rows, columns, warning, critical.
- `get_schema`: lấy schema và metric theo cột.
- `get_nulls`: lấy thống kê null/missing.
- `get_categorical_columns`: lấy danh sách cột categorical.
- `get_distribution`: lấy top-value distribution.
- `get_findings`: lấy data quality findings.
- `get_pii`: lấy PII detections.
- `get_correlations`: lấy correlation evidence.
- `get_cardinality`: lấy distinct/cardinality.
- `get_full_report`: lấy summary rộng của report.

Nếu LLM lỗi hoặc không gọi tool, backend fallback sang deterministic lookup để chat không bị hỏng. Fallback vẫn chỉ đọc saved report, không bịa thêm.

## 4. Profiling Plan Builder

Phần Agent-assisted profiling plan hiện đã có tool-calling layer.

Khi gọi `POST /api/v1/profiling/plans`, backend dùng `ProfilingPlanToolCallingAgent`. Agent có thể gọi:

- `search_requirement_documents`: tìm evidence trong tài liệu requirement/policy đã upload.
- `create_profiling_plan`: tạo và lưu profiling plan có cấu trúc.

Plan có thể gồm:

- Schema inspection.
- Column metrics.
- Data quality findings.
- Quality summary.
- Correlations.
- PII detection/masking candidates.
- Missingness/null checks.
- Outlier/range checks.
- Statistical test recommendations.
- Clarification questions trước khi chạy.

Nếu LLM không sẵn sàng, backend fallback sang deterministic planner trong `planning.py`.

## 5. Database Plan Builder

Khi người dùng kết nối database và muốn Agent chọn bảng phù hợp, endpoint `POST /api/v1/profiling/database-plan` dùng tool-calling agent.

Agent có thể gọi:

- `search_requirement_documents`: đọc requirement/policy docs.
- `create_database_plan`: chọn bảng từ danh sách bảng có sẵn.

Agent chỉ được recommend bảng nằm trong danh sách backend cung cấp. Nếu requirement mơ hồ, Agent tạo câu hỏi xác nhận thay vì tự chọn bừa.

## 6. Knowledge Documents

Người dùng có thể upload tài liệu requirement hoặc policy.

Các định dạng hỗ trợ:

- `.txt`
- `.md`
- `.json`
- `.csv`
- `.docx`
- `.pdf`

Text sau khi extract được lưu thành knowledge document và có thể được Agent search bằng tool. Nếu PDF/DOCX không extract được text, hệ thống chỉ lưu metadata.

## 7. HITL Review

HITL là các quyết định cần con người xác nhận, ví dụ:

- Cột có thể chứa PII.
- Cột có thể là primary key.
- Identifier bị duplicate.
- Relationship candidate giữa bảng/file.
- Business range hoặc rule chưa chắc chắn.

Agent không được tự approve HITL. Người dùng phải approve/reject.

## 8. Những phần vẫn nên deterministic

Không phải phần nào cũng nên dùng LLM. Các phần sau nên giữ rule-based để an toàn và dễ audit:

- PII masking.
- Metric extraction.
- SQL query safety.
- Numeric profiling rules.
- Basic finding generation từ metric.
- Relationship inference không có DB constraint.
- HITL classification cơ bản.

Các rule này là evidence producer. Agent dùng evidence đó để giải thích hoặc lập plan, không thay thế bằng suy đoán tự do.

## 9. Nguyên tắc chống bịa

Agent không được:

- Bịa metric backend chưa hỗ trợ.
- Bịa dữ liệu không có trong saved report.
- Tự coi candidate là chắc chắn khi chưa có HITL approval.
- Tự approve HITL.
- Tự suy ra business rule nếu user chưa cung cấp.

Nếu thiếu thông tin, Agent phải hỏi lại hoặc nói rõ không có evidence.
