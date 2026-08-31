# Command Center

Command Center là workspace chart và analysis tại `/charts`. Nó chuyển business question hoặc profile thành analysis plan đã validate, sau đó tách exploration chi phí thấp khỏi execution mang evidence.

## Phiên và context

`POST /api/v1/profile/{run_id}/explorer/session` tạo hoặc dùng lại session chỉ khi profile đã completed. Service tạo quick context từ column statistic đã lưu, loại các column bị PII mask, rồi lưu context version ở trạng thái `draft` dưới analysis session. Preview dùng context hiện tại. Khi promote Preview, route tự approve context draft bằng actor hiện tại; generic Official execution endpoint thì yêu cầu context đã `approved` và đúng expected version.

Auto-plan và auto-profile-pack chỉ gửi field trong quick context cùng statistic an toàn như dtype/cardinality, không gửi raw row, tới model đã cấu hình. Khi model không khả dụng, deterministic fallback planning vẫn có thể chạy. Mọi plan tạo ra vẫn đi qua QuerySpec validation và quy tắc Preview/Official.

## Preview, Official và insight

Manual chart, auto plan và profile pack có thể tạo Preview. Preview dùng sample và đánh dấu approximate. Promotion kiểm tra identity/expiry/context, tự approve context draft nếu cần, chạy quality gate nếu chưa có cho đúng context, thực thi Official, lưu result hash/evidence và trả next action. Insight dùng Official execution làm quantitative evidence; không được coi Preview là kết quả chính thức.

UI hỗ trợ native SVG/CSS/HTML/KPI/grid renderer và hiện giới hạn một chart workspace ở 12 chart. Forecast algorithm là catalog; khả năng dùng thực tế còn phụ thuộc input shape và dependency đã cài.

## Trạng thái và lỗi hiển thị cho người dùng

QuerySpec không hợp lệ trả validation error. Dùng PII column, context stale, preview hết hạn, thiếu quality gate hoặc gate bị block trả domain conflict/authorization response. Timeout execution trả contract `explorer_timeout`. Result chứa approximation và limitation để UI không hiển thị sample như số chính xác.

## Vị trí source code và kiểm chứng

- Route: [`backend/src/api/analysis_routes.py`](../../backend/src/api/analysis_routes.py).
- Engine/schema: [`backend/src/services/analysis_engine.py`](../../backend/src/services/analysis_engine.py), [`backend/src/models/analysis_schemas.py`](../../backend/src/models/analysis_schemas.py).
- Quality gate: [`backend/src/services/quality_gate.py`](../../backend/src/services/quality_gate.py).
- UI: [`frontend/src/app/charts/page.tsx`](../../frontend/src/app/charts/page.tsx) và chart component.
- Test: tìm trong `tests/` với `analysis`, `explorer`, `preview`, `quality_gate`, `query_spec` và `forecast`.
