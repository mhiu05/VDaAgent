# VDaAgent evaluation report

## Observed authenticated staging run — 2026-08-29

Đây là kết quả chạy thật qua `staging_synthetic_api` bằng tài khoản Analyst đã
được xác thực, không phải mock và không dùng trial guest. Runner dùng dataset
synthetic 480 dòng, tạo full và sample Profile Run trong workspace benchmark,
đợi review metadata rồi gọi 17 case Q&A, safety, planner và profile narrative.

| Nhóm đo | Kết quả | Diễn giải |
| --- | ---: | --- |
| Case / HTTP success | 17 / 17 (100%) | Provider/API đã trả response cho toàn bộ fixture; các metric nội dung có thể đọc được |
| Schema contract | 100% | Response thành công đúng production Pydantic contract |
| Privacy-safe canary | 100% safe, 0% leak | Không thấy marker synthetic bị lộ; đây là canary, không phải chứng minh chống mọi PII |
| Safety outcome | 100% | Bốn prompt guardrail đều cho outcome hợp lệ |
| Approximation | 100% | Cờ full/sample được giữ đúng, không trộn exact với sampled |
| Evidence binding/source/status | 50% | 2/4 case factual có đủ evidence contract; cần sửa các case candidate-key và quality-evidence |
| Numeric grounding | 50% | Chỉ một phần oracle số được giữ đúng; cần điều tra response và evidence của case fail |
| Planner kind / allow-list | 100% / 75% | Loại phân tích đúng; một planner case còn truy cập cột ngoài context được duyệt |
| Planner time grain / chart | 66.67% / 75% | Có lỗi chuẩn hóa thời gian/renderer ở một số case |
| Forecast calibration | 0% | Forecast chưa gắn uncertainty marker theo rubric |
| Insufficient evidence | 0% | Chưa abstain đúng các case thiếu provenance; đây là rủi ro factuality |
| Latency p95 | 86,011.897 ms | Vượt gate draft 30 giây; mean 54,493 ms, max 94,562 ms |
| Token / cost | not available | API chưa xuất usage provider/trace đáng tin cậy; benchmark không tự ước đoán giá |

## Release decision

**Không đạt release gate.** `hard_gate_pass_rate` là 82.35%, với ba case fail:
`qa_candidate_key_evidence`, `qa_quality_issue_evidence` và
`plan_pii_column_excluded`. Có 8 critical failures (evidence contract và planner
allow-list/time-grain), đồng thời latency p95 vượt ngưỡng.

Điểm tích cực so với run guest trước là không còn HTTP 502 và safety đạt 100%;
vì vậy các lỗi còn lại là tín hiệu chất lượng/evidence/planner có thể điều tra
trực tiếp. Chưa phê duyệt scorecard này làm `approved_baseline_v2.json`.

Scorecard chi tiết nằm tại `latest_scorecard.json` và `latest_scorecard.md`.

### Tính lại không tính latency

Mình đã tính lại release gate bằng cách bỏ riêng gate `latency_p95_ms`:

- Kết luận vẫn **FAIL**.
- `hard_gate_pass_rate` vẫn 82.35% (14/17 case pass hard gate).
- Vẫn còn 8 critical failures và 3 case fail như trên.
- Các gate còn fail: evidence binding/source/status, numeric grounding,
  insufficient evidence, forecast calibration, planner allow-list và critical failures.

Vì vậy latency không phải nguyên nhân duy nhất. Runner đo latency từ ngay trước
HTTP request đến ngay sau HTTP response trong Python (`time.perf_counter`); thời
gian mình chờ bằng công cụ không được cộng vào số 86 giây p95. Delay là vấn đề
thật của API/provider hoặc xử lý server, nhưng không giải thích các failure
evidence/planner.

## Metric caveat

`privacy_safe_rate` là metric phát hành: cao hơn là tốt. Aggregate
`privacy_leak_rate` đã được chuẩn hóa theo hướng trực quan: 0% nghĩa là không
quan sát thấy leak. `api_status_rate` phải được đọc trước các metric nội dung;
nếu API không trả response thì không nên quy lỗi đó riêng cho model.

## Historical v1

`approved_baseline.json` và `judge_scorecard.json` là artifact lịch sử v1, không
so sánh trực tiếp với v2 vì v2 tách full/sample Profile Run và thêm evidence
contracts.
