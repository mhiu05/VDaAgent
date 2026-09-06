# Command Center và phân tích tương tác

> Đã đối chiếu với analysis routes, bounded engine và frontend Command Center ngày 2026-09-03.

Command Center là giao diện phân tích một profiling run đã có dữ liệu. Tính năng này kết hợp phiên phân tích có trạng thái, planner an toàn, preview giới hạn, kết quả Official và các biểu đồ tái lập được.

## Luồng sử dụng

1. Bắt đầu hoặc mở một profiling run trong `/profiles/{runId}/review`; sau khi run hoàn tất, hệ thống chuyển sang `/profiles/{runId}/preview`. Preview hiển thị tóm tắt Agent và dẫn tới `/charts?runId={runId}`.
2. Frontend tạo hoặc lấy explorer session bằng `POST /api/v1/profile/{run_id}/explorer/session`.
3. Người dùng chọn cột, bộ lọc và phép phân tích hoặc yêu cầu hệ thống lập kế hoạch biểu đồ.
4. Backend tạo một context version bất biến cho lần phân tích.
5. Preview chạy trên mẫu giới hạn; chỉ execution Official mới được dùng làm insight định lượng hoặc đưa vào báo cáo.
6. Quality gate và provenance được lưu cùng session/execution để phục vụ kiểm tra sau này.

Từ header Command Center, Analyst có thể quay lại Preview, mở Report Draft của run hiện tại hoặc chuyển thẳng sang Compare. Các liên kết này chỉ thay đổi navigation; authorization và scope vẫn do backend kiểm tra.

## API chính

| Nhóm | Endpoint |
| --- | --- |
| Phiên | `GET/POST /api/v1/analysis-sessions`, `GET /api/v1/analysis-sessions/{id}` |
| Context | `POST .../{id}/context-versions`, `POST .../{id}/context-versions/{context_id}/approve` |
| Quality | `POST .../{id}/quality-gate`, `POST .../{id}/quality-issues/{issue_id}/acknowledge` |
| Execution | `POST/GET .../{id}/executions` |
| Planner | `POST /api/v1/profile/{run_id}/charts/auto-plan` |
| Gói biểu đồ | `POST /api/v1/profile/{run_id}/charts/auto-profile-pack` |
| Thuật toán | `GET /api/v1/profile/{run_id}/charts/algorithms` |
| Preview | `POST /api/v1/profile/{run_id}/explorer/previews` |
| Promote | `POST /api/v1/profile/{run_id}/explorer/previews/{preview_id}/promote` |

Mọi endpoint đều kiểm tra workspace và quyền ở backend. ID phía client không thay thế kiểm tra quyền sở hữu tài nguyên.

## Planner an toàn

Planner có hai nhánh:

- fast path xác định cho các ý định đơn giản và rõ ràng;
- model có structured output cho yêu cầu cần suy luận thêm.

Trước khi gọi model, backend loại PII và chỉ truyền context đã làm sạch. Kết quả từ cả hai nhánh đều phải qua allow-list của `QuerySpec`; nếu người dùng nhắc một cột bị hạn chế, planner không cho cột đó ảnh hưởng tới model và trả một kế hoạch an toàn hơn. Log latency tách các stage router, planner, retrieval, tools, evidence, final LLM, validation và TTFT.

## Preview và Official

| Thuộc tính | Preview | Official |
| --- | --- | --- |
| Mục đích | phản hồi nhanh khi khám phá | kết quả có thể trích dẫn/tái sử dụng |
| Giới hạn dòng đầu vào | 50.000 | theo execution policy |
| Giới hạn dòng kết quả | 50 | 500 |
| Thời hạn | hết hạn sau 1 giờ | được lưu bền vững |
| Dùng làm evidence | không | có |
| Dùng trong báo cáo | phải promote trước | có |

Promotion tạo execution Official và đóng băng context liên quan. Luồng generic yêu cầu context đã được approve; luồng promote preview hiện tự approve context draft, vì vậy đây chưa phải một bước phê duyệt độc lập.

## Giao diện

Frontend giới hạn tối đa 12 biểu đồ trong một plan. Trạng thái URL/session được dùng để giữ ngữ cảnh khi chuyển giữa profiling, QA, chart và report. Lỗi validation phải được hiển thị như lỗi hợp đồng, không tự động nới giới hạn hay đổi sang truy vấn tự do.

Insight Official có fallback deterministic sáu phần khi model không sẵn sàng, nên chart vẫn có thể được review/pin nếu execution đã qua quality gate.

## Nguồn triển khai

- `frontend/src/app/profiles/[runId]/review/page.tsx`
- `frontend/src/components/command-center/`
- `backend/src/api/analysis_routes.py`
- `backend/src/services/analysis_engine.py`
- `backend/src/services/analysis_repository.py`
- `backend/src/services/chart_planner.py`
- `backend/src/models/analysis_schemas.py`
