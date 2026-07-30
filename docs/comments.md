# Nhận xét: Project Context — AI Agent Data Profiling

## Đánh giá tổng quan

Tài liệu chín ở chỗ mục 2 "Ràng buộc hệ thống" được viết *trước* khi liệt kê tính năng — HITL, PII, sampling cost là thiết kế cốt lõi, không phải chêm vào sau. Bộ diagram ở mục 4 nhất quán với nhau (system overview, LangGraph flow, sequence diagram, ER schema đều khớp logic).

**Điểm mạnh nên giữ:**
- Constraints-first, tách MVP/nâng cao rõ ràng, không nhồi hết vào v1
- Mọi proposal đều có `confidence_score` + `evidence` → traceability tốt
- Mục 9, 10 tự nhận điểm mơ hồ, không tô hồng thiết kế

---

## 1. HITL (mục 2.1) — sẽ nghẽn khi scale

"Mọi candidate key / semantic type đều cần Analyst confirm" ổn với demo 1-2 bảng, nhưng warehouse thật (vài chục bảng × vài chục cột) thì lượng proposal tăng nhanh, HITL từ chỗ bảo vệ chất lượng biến thành bottleneck.

**Đề xuất:** HITL phân tầng — proposal confidence cao (>95%) + rủi ro thấp (semantic type của cột đã có tên rõ ràng như `email_address`) auto-confirm kèm audit log, review sau (async); chỉ giữ synchronous confirm bắt buộc cho suy luận ảnh hưởng lớn như candidate key (nhất là composite key, vì dùng để join).

## 2. PII / Governance (mục 2.2) — hai lỗ hổng cụ thể

**a) Quasi-identifier:** Heuristic + regex bắt tốt PII "lộ rõ" (email, SĐT, CCCD), nhưng rủi ro re-identification thực tế thường đến từ *tổ hợp* các cột trông vô hại — ngày sinh + giới tính + mã vùng là ví dụ kinh điển đủ định danh phần lớn dân số dù không cột nào riêng lẻ là PII.

**Đề xuất:** Tái dùng logic phát hiện composite candidate key để gắn cờ "rủi ro re-identification cao" cho các tổ hợp cột gần-unique, không chỉ dùng cho mục đích chọn khóa chính.

**b) Schema chưa khớp ý định ở mục 9:** Mục 9 viết "nên cho user tự đánh dấu thêm cột PII như lớp bảo vệ bổ sung", nhưng ER diagram lại để `is_pii` là boolean phẳng trên `ColumnStat`, không có `status/evidence/confirmed_by` như `CandidateKeyProposal` hay `SemanticTypeProposal`.

**Đề xuất:** Nâng `is_pii` thành một proposal riêng, đi qua đúng luồng HITL confirm/reject như hai loại proposal kia.

## 3. Độ chính xác thống kê (mục 2.3)

**a) Mâu thuẫn ngầm với 2.4:** "Deterministic" nên hiểu là "compute engine tính, LLM không đoán" — vẫn đúng dù dùng sampling, nhưng bản thân `APPROX_COUNT_DISTINCT` (HyperLogLog) hay số liệu từ `TABLESAMPLE` vốn là *ước lượng*, không phải giá trị thật của toàn bảng. Nếu báo cáo in "cardinality = 15.234" mà không kèm chú thích, Analyst dễ tin nhầm là số chính xác tuyệt đối.

**Đề xuất:** Hiển thị khoảng tin cậy (hoặc tối thiểu dấu "≈") cho các chỉ số nhạy với cỡ mẫu khi chạy sampling.

**b) Thiếu multiple-testing correction:** Ma trận tương quan nhiều cột (20 cột → 190 cặp) hoặc chạy nhiều test liên tiếp trong 1 session sẽ tăng xác suất false positive.

**Đề xuất:** Trả cả p-value gốc lẫn p-value đã hiệu chỉnh (Benjamini-Hochberg/FDR — hợp tính chất khám phá của tool hơn Bonferroni). Ngoài ra, Shapiro-Wilk với sample lớn rất dễ "reject" normality dù độ lệch không đáng kể trong thực tế — nên cảnh báo điều này ở bước diễn giải kết quả.

## 4. QA node & chống hallucination (mục 6, 9) — quan trọng nhất

Đây là chỗ then chốt vì đây chính là lời hứa cốt lõi ("không hallucinate"). Thiết kế hiện đẩy mọi thứ qua ChromaDB (vector search), nhưng vector similarity không đảm bảo tìm đúng con số chính xác, và kể cả retrieve đúng context thì LLM vẫn phải "đọc" và gõ lại số đó — vẫn có thể lệch dù không hẳn là bịa.

**Đề xuất:** Tách QA thành 2 luồng thay vì gộp chung:
- **Câu hỏi định lượng** ("null % cột X") → structured lookup (tool-calling gọi thẳng `get_stat(column, metric)` hoặc text-to-SQL vào `ColumnStat`), số được chèn trực tiếp từ DB, không qua bước LLM generate token số.
- **Câu hỏi định tính/lịch sử** ("dataset này đổi gì so với tháng trước") → đây mới là chỗ vector store hợp lý; nên dùng hybrid retrieval (FAISS+BM25 + cross-encoder rerank) thay vì chỉ ChromaDB thuần.

Tách như vậy thì "grounded" được đảm bảo bằng kiến trúc, chứ không chỉ nhờ validate hậu kiểm như mục 9 đang mô tả.

## 5. Sampling & chi phí (mục 2.4) — hai điểm nhỏ

- Cost hiện chỉ track bytes scanned trên BigQuery; nên track song song cả chi phí LLM call — đặc biệt nếu propose semantic type theo từng cột riêng lẻ, gộp thành 1 call/bảng vừa rẻ hơn vừa giúp LLM thấy ngữ cảnh liên-cột (vd `user_id` + `order_id` cùng xuất hiện gợi ý đây là fact table).
- `ProfileRun` nên lưu thêm random seed / câu query sample thực thi, không chỉ `sampling_strategy` + `sample_size` — nếu không, sau này không tái tạo lại đúng kết quả cũ để audit hay debug.

## 6. Vận hành production (chưa được đề cập)

- LangGraph interrupt cần checkpointer để giữ state qua lúc chờ Analyst — nếu server restart giữa lúc chờ HITL (có thể kéo dài vài ngày) mà checkpoint chỉ ở in-memory thì mất session. Nên gắn checkpointer vào cùng Postgres instance đang dùng cho metadata.
- Vòng lặp `deep_analysis ↔ HITL` ở sequence diagram 4.3 chưa có giới hạn số lần lặp — nên cap số test/session để tránh cost bị kéo lên vô hạn.

---

## Ưu tiên nếu chỉ làm cho MVP

3 điều đáng làm trước:
1. Tách kiến trúc QA (structured lookup vs vector search)
2. Thêm chú thích uncertainty cho số liệu sampling
3. Nâng `is_pii` thành proposal có HITL

Phần còn lại (multiple-testing correction, checkpointer persistence, cost tracking cho LLM, reproducibility seed) hoàn toàn có thể note là "known limitation" trong tài liệu — miễn cho thấy đã nghĩ tới, không nhất thiết code hết ở v1.