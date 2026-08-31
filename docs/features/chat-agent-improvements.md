# Đề xuất cải tiến Chat Agent

> Phạm vi: trải nghiệm hỏi đáp trên trang Chat và chat widget, với thứ tự ưu tiên **UI/UX → latency → mức độ chi tiết → độ chính xác**. Tài liệu phản ánh trạng thái repository tại ngày 31/08/2026; các con số staging cũ chỉ được dùng làm baseline tham khảo, không phải kết quả của phiên bản hiện tại.

## 1. Mục tiêu

Chat Agent cần giúp người dùng:

1. biết Agent đang làm gì, đang dùng dataset/profile nào và còn phải chờ bao lâu;
2. nhận được giá trị hữu ích sớm, kể cả khi câu trả lời đầy đủ cần nhiều thời gian;
3. đọc nhanh phần kết luận nhưng vẫn mở rộng được phân tích chuyên sâu;
4. phân biệt rõ dữ kiện đã kiểm chứng, dữ kiện xấp xỉ và nội dung chưa đủ evidence;
5. dễ tiếp tục phân tích, sửa câu hỏi hoặc khôi phục khi có lỗi.

## 2. Hiện trạng và khoảng trống

### Điểm đã có

- Trang Chat và chat widget đều cho chọn dataset/Profile Run, lưu hội thoại ở trình duyệt và gửi lịch sử gần nhất.
- Backend phát SSE theo các event `status`, `meta`, `token`, `source`, `done` và `error`.
- QA dùng evidence validator fail-closed; câu trả lời định lượng không đủ căn cứ phải abstain thay vì suy đoán.
- Hệ thống đã đo latency theo router, retrieval, tool, evidence, model, validation, TTFT và số lần gọi model/tool.
- Một số intent rõ ràng như candidate key và data quality đã có deterministic fast path; retrieval profile và external knowledge có thể chạy song song.

### Khoảng trống chính

| Nhóm | Hiện trạng quan sát được | Ảnh hưởng tới người dùng |
| --- | --- | --- |
| UI/UX | Trang Chat lưu `statusDetail` nhưng vẫn hiển thị cố định “Đang tìm evidence”; widget hiển thị stage tốt hơn. Hai bề mặt có hành vi chưa đồng nhất. | Người dùng không biết Agent đang routing, truy xuất nguồn, chạy tool hay kiểm chứng. |
| UI/UX | Chưa có hành động dừng, thử lại, tạo lại câu trả lời, sao chép, phản hồi hữu ích/không hữu ích hoặc chỉnh câu hỏi đã gửi. | Khó kiểm soát phiên làm việc và khó phục hồi khi câu trả lời chưa phù hợp. |
| UI/UX | Nguồn nằm trong khối thu gọn và chủ yếu hiển thị tên loại nguồn/tool; chưa nối trực tiếp từng kết luận với evidence tương ứng. | Khó kiểm tra nhanh vì sao Agent đưa ra kết luận. |
| Latency | Backend hoàn thành graph, evidence validation và guardrail trước khi phát nội dung. “Streaming token” hiện là phát lại câu trả lời đã hoàn tất theo câu, không phải model streaming thực. | Có SSE nhưng thời gian tới nội dung hữu ích đầu tiên vẫn gần với tổng thời gian xử lý. |
| Latency | Scorecard staging gần nhất ghi p95 khoảng 86 giây, vượt ngưỡng 30 giây. Baseline online tham khảo ghi p95 khoảng 64,6 giây, trong khi ngân sách ban đầu là 25 giây. | Thời gian chờ quá dài đối với một tương tác chat; cần đo lại trên commit hiện tại trước khi kết luận mức cải thiện. |
| Chi tiết | Chưa có lựa chọn độ dài; mọi câu hỏi đi qua cùng `response_mode=default` trừ chart insight. | Câu đơn giản có thể dài quá mức, còn câu phân tích có thể thiếu chiều sâu. |
| Chi tiết | Câu trả lời là chuỗi Markdown tự do; frontend dùng parser riêng và heuristic để dựng bảng/khối chi tiết. | Cấu trúc trình bày không ổn định, khó bảo đảm “kết luận trước, chi tiết sau”. |
| Chính xác | Backend gửi `evidence_status`, `is_approximate`, `agent_run_id` và `trace_summary` trong response/event `done`, nhưng hai UI chat chưa lưu hoặc hiển thị đầy đủ metadata này. | Hệ thống có tín hiệu tin cậy nhưng người dùng không nhìn thấy. |
| Chính xác | Scorecard staging gần nhất còn fail các gate evidence binding, evidence status, numeric grounding, insufficient evidence và planner allow-list. Tài liệu bàn giao ghi rõ scorecard này cũ hơn một số bản sửa. | Chưa có bằng chứng staging mới để xác nhận chất lượng release hiện tại. |
| Hội thoại | Trang Chat gửi tối đa 12 message gần nhất, widget chỉ gửi 6; lịch sử lưu ở local/session storage. | Cùng một hội thoại có thể cho kết quả khác nhau giữa hai UI; mất ngữ cảnh khi đổi trình duyệt/thiết bị. |

## 3. Nguyên tắc thiết kế

- **Trả lời trước, giải thích sau:** phần đầu phải cho người dùng kết luận hoặc nêu rõ chưa đủ dữ kiện trong 2–4 câu.
- **Progressive disclosure:** mặc định ngắn gọn; chi tiết, phương pháp, nguồn và trace mở theo nhu cầu.
- **Không giả lập tiến trình:** stage hiển thị phải phản ánh công việc backend thực sự đang chạy; không dùng phần trăm giả cho bước không đo được.
- **Không stream nội dung chưa kiểm chứng như sự thật:** có thể phát tiến trình và evidence đã xác nhận sớm, nhưng câu trả lời định lượng chỉ được gắn nhãn “đã kiểm chứng” sau validation.
- **Evidence là thành phần của câu trả lời:** trạng thái evidence, phạm vi dữ liệu, tính xấp xỉ, đơn vị và giới hạn phải hiển thị ngay tại nơi có kết luận liên quan.
- **Một hành vi trên mọi bề mặt:** trang Chat và widget dùng chung message model, stream reducer, renderer và quy tắc lịch sử.

## 4. Backlog ưu tiên

### P0 — cần làm trước

| ID | Hạng mục | Thay đổi đề xuất | Tiêu chí hoàn thành |
| --- | --- | --- | --- |
| UX-01 | Tiến trình trung thực | Hiển thị `statusDetail` thật theo timeline: chuẩn bị → phân loại → tìm nguồn → chạy phép tính/tool → kiểm chứng → soạn câu trả lời. Thêm thời gian đã chờ và nút Dừng. | Stage đổi đúng theo SSE; không còn text cố định; hủy request dừng cập nhật UI và giữ lại câu hỏi để gửi lại. |
| UX-02 | Cấu trúc câu trả lời | Chuẩn hóa thành: **Kết luận**, **Phát hiện chính**, **Evidence**, **Giới hạn**, **Bước tiếp theo**. Mặc định chỉ mở Kết luận và Phát hiện chính. | Người dùng đọc được ý chính mà không cuộn dài; các phần thiếu dữ liệu không tạo heading rỗng. |
| UX-03 | Tín hiệu tin cậy | Hiển thị badge `Đã kiểm chứng`, `Chỉ dựa trên profile`, `Chưa đủ evidence`; hiển thị `Xấp xỉ` khi có sampling và liên kết citation cạnh claim. | Metadata từ event `done` được lưu theo từng message và còn nguyên sau khi tải lại trang. |
| LAT-01 | Baseline theo hành trình người dùng | Đo riêng time-to-status, time-to-first-useful-answer, end-to-end, error/timeout và latency theo question type/fast path/model path. | Có dashboard hoặc báo cáo p50/p95 theo route; coverage telemetry ≥ 99%; không ghi prompt, raw row hoặc PII. |
| LAT-02 | Fast path trước model | Mở rộng deterministic renderer cho câu hỏi thống kê phổ biến; cache metadata/profile projection; bỏ model/retrieval không cần thiết sau khi router đã xác định đủ evidence. | Mỗi intent có test chứng minh số lần gọi model/tool; không đổi kết quả evidence validator. |
| ACC-01 | Contract câu trả lời có cấu trúc | Thay chuỗi Markdown tự do bằng schema versioned gồm summary, findings, claim–citation mapping, limitations, follow-up actions và metadata tin cậy. Frontend render schema, Markdown chỉ là fallback. | Backend/frontend có contract test; schema cũ có fallback; claim định lượng không thể thiếu nguồn hoặc đơn vị bắt buộc. |
| ACC-02 | Chạy lại evaluation release | Rerun staging authenticated trên commit hiện tại, so sánh với baseline và chặn release nếu fail hard gate. | Evidence binding/source/status = 100%; numeric grounding ≥ 98%; privacy-safe và safety outcome = 100%; critical failure = 0. |

### P1 — cải thiện mạnh sau khi P0 ổn định

| ID | Hạng mục | Thay đổi đề xuất | Tiêu chí hoàn thành |
| --- | --- | --- | --- |
| UX-04 | Bộ thao tác trên message | Thêm Sao chép, Thử lại, Tạo lại, phản hồi 👍/👎 và “Hỏi sâu hơn”. | Thao tác dùng được bằng bàn phím, có accessible name, không tạo message trùng khi double-click. |
| UX-05 | Context rõ ràng | Ghim chip Dataset, Profile Run, scan mode, số dòng, thời điểm profile và trạng thái proposal ở đầu hội thoại; cảnh báo trước khi đổi context. | Mỗi câu trả lời lưu context bất biến đã dùng; đổi run không khiến câu cũ trông như thuộc run mới. |
| UX-06 | Empty/error/recovery state | Phân loại lỗi mạng, timeout, permission, profile chưa sẵn sàng, thiếu evidence; đưa đúng hành động khắc phục. | Mỗi lỗi có CTA phù hợp; retry không gửi lại nhiều lần; partial answer được đánh dấu rõ. |
| LAT-03 | Song song hóa có kiểm soát | Chạy các retrieval độc lập song song, prefetch tool bắt buộc theo intent và giới hạn concurrency/timeout theo dependency. | Trace chứng minh giảm critical path; không vượt tool budget và không tăng tỷ lệ timeout. |
| LAT-04 | Ngân sách theo loại câu hỏi | Đặt budget riêng cho deterministic, quantitative-tool và qualitative-LLM; timeout phải trả kết quả an toàn hoặc hướng dẫn thu hẹp câu hỏi. | Không có request chờ vô hạn; timeout rate và fallback rate được theo dõi theo question type. |
| DET-01 | Chọn độ chi tiết | Thêm ba mức `Nhanh`, `Tiêu chuẩn`, `Chuyên sâu`; lưu lựa chọn theo hội thoại và cho phép “Mở rộng câu trả lời này”. | Mức Nhanh không bỏ cảnh báo/evidence; mức Chuyên sâu không tự tạo thêm số liệu ngoài nguồn. |
| ACC-03 | Làm rõ thay vì đoán | Khi thiếu cột, thời gian, metric, cohort hoặc phép tổng hợp, Agent hỏi một câu làm rõ có lựa chọn gợi ý. | Evaluation có bộ ambiguous queries; intent match và clarification precision đạt ngưỡng đã duyệt. |
| ACC-04 | Kiểm tra số liệu sâu hơn | Validator kiểm tra thêm đơn vị, phần trăm/tỷ lệ, mẫu số, cửa sổ thời gian, sample/full scan và phép làm tròn. | Mọi số trong answer map được tới artifact + field + context; sai đơn vị hoặc sai phạm vi bị fail closed. |

### P2 — tối ưu dài hạn

| ID | Hạng mục | Thay đổi đề xuất |
| --- | --- | --- |
| UX-07 | Hội thoại bền vững | Lưu conversation/message phía server theo workspace, đồng bộ nhiều thiết bị, có retention và quyền xóa rõ ràng. |
| UX-08 | Gợi ý theo ngữ cảnh | Sinh câu hỏi tiếp theo từ loại cột, quality issue và câu vừa trả lời; không dùng danh sách starter cố định cho mọi dataset. |
| LAT-05 | Semantic cache an toàn | Cache theo workspace, Profile Run, context version, normalized intent và phiên bản prompt/tool; vô hiệu hóa khi evidence thay đổi. |
| ACC-05 | Feedback thành evaluation | Liên kết 👍/👎 với `agent_run_id`, reason code và dataset synthetic tương ứng; không lưu nội dung nhạy cảm ngoài policy. |
| ACC-06 | Verifier độc lập có điều kiện | Chỉ chạy verifier thứ hai cho câu trả lời rủi ro cao hoặc có nhiều claim, tránh nhân đôi latency cho mọi request. |

## 5. Thiết kế trải nghiệm đề xuất

### 5.1. Trong lúc chờ

Ví dụ timeline hiển thị:

```text
✓ Đã xác định câu hỏi về chất lượng dữ liệu
✓ Đã đọc profile “Doanh thu — Tháng 8”
● Đang kiểm tra 3 phát hiện với evidence…  6,2 giây
○ Đang soạn câu trả lời
```

Chỉ hiển thị bước mà backend có event thật. Khi vượt ngưỡng latency dự kiến, đổi microcopy thành “Phân tích này cần thêm thời gian vì phải chạy 3 phép kiểm tra” và vẫn cho phép Dừng.

### 5.2. Khi có câu trả lời

```text
[Đã kiểm chứng] [Full scan] [3 nguồn]

Kết luận
Hai cột cần ưu tiên xử lý vì tỷ lệ thiếu cao và ảnh hưởng tới báo cáo doanh thu.

Phát hiện chính
1. customer_segment thiếu 18,4% [S1]
2. revenue có 27 outlier theo quy tắc đã lưu [S2]

▸ Xem evidence và phương pháp
▸ Giới hạn của kết quả

[Hỏi sâu hơn] [Tạo biểu đồ] [Sao chép] [Thử lại]
```

Với `no_evidence`, không dùng badge màu xanh hoặc ngôn ngữ chắc chắn. Thay vào đó cần nêu:

- dữ kiện nào đang thiếu;
- vì sao không thể kết luận an toàn;
- hành động cụ thể để tạo evidence, ví dụ chạy full profile, chọn Official execution hoặc làm rõ metric.

### 5.3. Mức độ chi tiết

| Mức | Kỳ vọng | Giới hạn gợi ý |
| --- | --- | --- |
| Nhanh | Một kết luận, tối đa 3 phát hiện, citation bắt buộc | Khoảng 80–150 từ |
| Tiêu chuẩn | Kết luận, phát hiện, giải thích ngắn, giới hạn và bước tiếp theo | Khoảng 200–400 từ |
| Chuyên sâu | Phương pháp, bảng so sánh, giả định, giới hạn và phân tích bổ sung | Theo nội dung, nhưng có khối thu gọn và budget token |

Độ dài là mục tiêu trình bày, không phải lý do cắt bỏ cảnh báo an toàn, tính xấp xỉ hoặc nguồn.

## 6. Mục tiêu latency và chất lượng

Các ngưỡng dưới đây là mục tiêu đề xuất; cần xác nhận lại sau khi có baseline staging mới.

| Chỉ số | Mục tiêu ban đầu | Mục tiêu sau tối ưu |
| --- | ---: | ---: |
| Status đầu tiên p95 | ≤ 500 ms | ≤ 300 ms |
| Câu trả lời deterministic p95 | ≤ 5 giây | ≤ 3 giây |
| Time-to-first-useful-answer p95 | ≤ 12 giây | ≤ 8 giây |
| End-to-end QA p95 | ≤ 25 giây | ≤ 15 giây |
| Tỷ lệ lỗi/timeout | < 2% | < 1% |
| Evidence binding/source/status | 100% | 100% |
| Numeric grounding | ≥ 98% | ≥ 99% |
| Privacy-safe và safety outcome | 100% | 100% |
| Critical failures | 0 | 0 |

Không gộp câu hỏi deterministic và câu hỏi cần model vào một percentile duy nhất khi chẩn đoán. Dashboard tổng vẫn cần p95 chung cho release gate, nhưng phải drill down được theo route, intent, model, số tool call và tình trạng cache.

## 7. Lộ trình triển khai

### Giai đoạn 0 — đo lại hiện trạng

- Rerun staging evaluation trên commit hiện tại.
- Bổ sung client timing cho status đầu tiên, nội dung hữu ích đầu tiên và hoàn tất.
- Phân nhóm latency theo deterministic/tool/LLM và xác định ba stage tốn thời gian nhất.

### Giai đoạn 1 — sửa trải nghiệm và trust signal

- Dùng chung stream reducer/message renderer giữa trang Chat và widget.
- Hiển thị stage thật, elapsed time, Dừng, Retry và Copy.
- Lưu/hiển thị `evidence_status`, `is_approximate`, context binding và `agent_run_id` theo message.
- Đưa kết luận lên đầu và chuyển evidence/giới hạn sang progressive disclosure.

### Giai đoạn 2 — giảm latency và điều khiển độ chi tiết

- Mở rộng deterministic fast path và cache projection an toàn.
- Song song hóa các dependency độc lập, áp budget/timeout theo loại câu hỏi.
- Thêm `answer_detail` vào request/response contract và ba mức chi tiết ở UI.

### Giai đoạn 3 — hardening độ chính xác

- Dùng structured answer contract và claim–citation mapping.
- Mở rộng validator cho đơn vị, mẫu số, thời gian, approximation và rounding.
- Mở rộng evaluation cho câu mơ hồ, hội thoại nhiều lượt, retry/timeout và context switch.

## 8. Phạm vi code dự kiến

- UI Chat: [`frontend/src/app/chat/page.tsx`](../../frontend/src/app/chat/page.tsx)
- Chat widget: [`frontend/src/components/draggable-chat-widget.tsx`](../../frontend/src/components/draggable-chat-widget.tsx)
- Hiển thị nguồn: [`frontend/src/components/answer-sources.tsx`](../../frontend/src/components/answer-sources.tsx)
- Lịch sử/message model: [`frontend/src/lib/chat-history.ts`](../../frontend/src/lib/chat-history.ts)
- API client/SSE parser: [`frontend/src/lib/api.ts`](../../frontend/src/lib/api.ts), [`frontend/src/lib/sse.ts`](../../frontend/src/lib/sse.ts)
- QA API và event contract: [`backend/src/api/routes.py`](../../backend/src/api/routes.py)
- Request/response schema: [`backend/src/models/schemas.py`](../../backend/src/models/schemas.py)
- QA graph/nodes: [`backend/src/agents/`](../../backend/src/agents/)
- Evidence validator: [`backend/src/services/qa_validation.py`](../../backend/src/services/qa_validation.py)
- Latency telemetry: [`backend/src/services/ai_latency.py`](../../backend/src/services/ai_latency.py)
- Evaluation: [`tests/evaluations/`](../../tests/evaluations/), [`evaluations/results/latest_scorecard.md`](../../evaluations/results/latest_scorecard.md)

## 9. Definition of Done

Một đợt cải tiến Chat Agent chỉ được xem là hoàn tất khi:

- trang Chat và widget dùng cùng event contract, metadata và lịch sử ngữ cảnh;
- người dùng nhìn thấy context, tiến trình, trạng thái evidence và approximation;
- có thể dừng, thử lại và sao chép mà không tạo request/message trùng;
- câu trả lời mặc định có kết luận trước, chi tiết mở rộng sau;
- mọi claim định lượng có citation hợp lệ, đúng đơn vị và đúng phạm vi dữ liệu;
- test frontend, backend, contract, accessibility và SSE reconnect đều pass;
- staging evaluation trên commit bàn giao đạt toàn bộ hard gate;
- latency p95 đạt ngân sách đã phê duyệt, có số liệu theo từng loại đường xử lý;
- không ghi prompt, raw row, PII hoặc secret vào telemetry/feedback ngoài policy.

## 10. Tài liệu liên quan

- [Agent system](../architecture/agent-system.md)
- [QA và evidence](./qa-and-evidence.md)
- [Command Center](./command-center.md)
- [Evaluation và release evidence](../development/evaluation.md)
- [Tóm tắt bàn giao](../summary.md)
