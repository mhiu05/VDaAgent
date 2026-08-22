# Báo cáo Đánh giá AI

## Bộ dữ liệu

| Trường | Giá trị |
| --- | --- |
| Phiên bản | p170-ai-eval-v1 |
| Phân loại | chỉ dữ liệu tổng hợp |
| Số case | 16 |
| Split | dev, test, security, regression |

## Baseline deterministic

| Gate | Kết quả |
| --- | --- |
| Kiểm tra fixture | Pass |
| Scorecard hard gate offline | Pass |
| Unit test evaluator | Pass |

Target offline chỉ xác nhận contract evaluation, không phải kết quả chất lượng Gemini. Trước release, chạy live suite trên Profile Run staging synthetic và lưu model/provider, prompt hash, git SHA, runtime/policy version, retrieval index version, repetition, latency, token budget và infra error.

## Checklist release

- [x] Fixture tổng hợp và security canary
- [x] Hard gate deterministic
- [x] Offline suite pass
- [ ] Analyst duyệt baseline staging synthetic
- [ ] Bật nightly regression job
- [ ] Review baseline từ phản hồi người dùng/annotation