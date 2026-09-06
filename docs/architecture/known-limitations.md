# Giới hạn và sai lệch kiến trúc hiện tại

> Snapshot đối chiếu ngày 2026-09-06. Đây là register để tránh mô tả behavior chưa hoàn thiện như guarantee; không phải backlog ưu tiên hay cam kết SLA.

## Mức độ đọc

- **Blocking:** làm local/CI/build/deploy không chạy theo layout hiện tại.
- **Behavior gap:** code chạy nhưng semantics chưa khớp thiết kế mong muốn.
- **Operational gap:** có primitive nhưng thiếu validation/scheduler/evidence production.

## Chuyển layout vào `src/` chưa hoàn tất — blocking

Source backend/frontend đã chuyển nguyên vẹn từ `backend/` và `frontend/` sang `src/backend/` và `src/frontend/`, nhưng các consumer đường dẫn chưa được cập nhật đồng bộ.

| Consumer | Tham chiếu cũ còn tồn tại | Ảnh hưởng |
| --- | --- | --- |
| `Makefile` | `cd backend`, `cd frontend`, `PYTHONPATH=backend` | shortcut local không tìm thấy source |
| `alembic.ini` | `script_location=backend/migrations`, `prepend_sys_path=backend` | lệnh migration từ root không tìm revision/package |
| backend config | `PROJECT_ROOT` chỉ đi lên tới `src/`/`src/backend` | không nạp `.env` và `config.yaml` ở repository root |
| Alembic env | `.env` resolve theo parent cũ | không nạp root `.env` sau relocation |
| Docker backend | `COPY backend ./backend`, app-dir `backend` | build context không chứa thư mục được copy |
| Docker/frontend workflow | build context/working directory `frontend` | frontend image và quality job không tìm project |
| CI path filter/lint | theo `backend/`/`frontend/` | thay đổi dưới `src/` có thể không trigger đúng và lệnh fail |
| test bootstrap | `ROOT / backend` | import `src.*` thất bại |
| scripts/evaluation | nhiều `ROOT / backend` | migration/security/benchmark/index job không chạy theo layout mới |
| `pyproject.toml` | Ruff include `backend/**/*.py` | source mới có thể không được lint |
| root architecture/OpenAPI text | link/mô tả đường dẫn cũ | tài liệu/generated contract ngoài `docs/` bị stale |

Vì vậy topology chức năng trong bộ tài liệu này phản ánh source đã chuyển, nhưng release hiện tại chưa được xem là buildable cho tới khi hoàn tất một logical migration gồm runtime root resolution, local command, test/script, Alembic, Docker và CI. Không tạo symlink/copy bí mật `.env` để che lỗi; nên sửa root discovery và manifest một cách nhất quán.

## Report submit bỏ qua review — behavior gap

`POST /api/v1/reports/{report_id}/submit` gọi `ReportService.submit_report`, nhưng service hiện publish trực tiếp. Repository vẫn có submit/review primitive và API vẫn có `/review`, song public path chưa tạo chuỗi submit → reviewer approve → publish.

Workspace chỉ có role `analyst`; role này đồng thời có `report.submit`, `report.review` và `report.publish`. Flag `report_separation_of_duties` được lưu nhưng lifecycle chưa enforce. Không mô tả report workflow hiện tại là separation of duties.

## Report list/get không chỉ trả published — behavior gap

Handler tên `list_published_reports` và `get_published_report` gọi repository với `published_only=False`. List loại latest version `rejected`, trong khi get/export-source không dùng filter tương đương. UI hoặc caller có permission có thể thấy draft/in-review; direct lookup có thể thấy report rejected.

## Drift không bắt buộc cùng dataset — behavior gap

Route drift chỉ kiểm tra hai Profile Run khác nhau, cùng workspace và đều `completed`; chưa bắt buộc `dataset_id` giống nhau. UI cũng có thể chọn run từ hai dataset. Kết quả cross-dataset là behavior được phép hiện tại, không phải guarantee về comparability.

## Promotion tự approve context draft — behavior gap

Promote Preview tự approve context `draft` bằng actor rồi chạy quality gate/Official. Generic `POST /analysis-sessions/{id}/executions` lại yêu cầu context đã approved. Governance giữa hai execution path chưa đồng nhất.

## HITL low-risk chưa có allow-list typed — behavior gap

Default chỉ auto-confirm `semantic_type` confidence cao, nhưng `HITL_LOW_RISK_TYPES` nhận list string tự do. Node duyệt candidate key, semantic type và PII rồi tin cấu hình. Misconfiguration có thể nới auto-confirm ngoài policy mong muốn.

## Chat Agent chưa có release evidence hiện hành — operational gap

P0–P2 có focused test, migration smoke và offline evaluation, nhưng artifact synthetic/offline không phải production SLA. Cần chạy lại evaluation authenticated trên staging cho đúng commit/image, đo TTFVA/p95 theo execution path, cache hit và failure path trước khi tuyên bố release readiness.

## Verifier và retention chưa enforce/schedule — operational gap

`agent_verifier_mode=shadow` ghi verification result hash-bound nhưng không thay answer đã qua validator; `enforce` không phải behavior mặc định. `purge_expired_deleted_conversations` là maintenance primitive có giới hạn nhưng chưa có scheduler production. Chưa thể cam kết retention thực tế chỉ dựa trên soft-delete/purge function.

## Cấu hình có default ở nhiều lớp — operational gap

`config.yaml` và Python default khác nhau ở provider/retrieval; environment lại có ưu tiên cao nhất. LangSmith nhận mode `sanitized_content` nhưng adapter hiện vẫn gửi metadata allow-list và ẩn input/output. Luôn quan sát effective settings thay vì suy luận từ một file hay tên mode.

Sau relocation, root discovery còn sai như mục blocking ở trên, nên effective settings có thể chỉ là Python default dù root `.env`/`config.yaml` tồn tại.

## Những điều chưa được coi là guarantee

- benchmark synthetic/offline không phải SLA production;
- job delivery là at-least-once, không phải exactly-once;
- Preview approximate không phải Official evidence;
- frontend route guard không phải authorization boundary;
- LangSmith projection không phải source of truth cho audit/evidence;
- compatibility `create_all`/runtime migration không phải production schema strategy;
- report submit hiện tại không chứng minh reviewer độc lập;
- cross-dataset drift không chứng minh hai nguồn comparable;
- source nằm trong `src/` chưa đồng nghĩa Docker/CI/runtime đã dùng layout đó.

## Điều kiện đóng các gap

| Gap | Bằng chứng tối thiểu để đóng |
| --- | --- |
| Layout `src/` | local API/worker/frontend, Alembic smoke, full relevant tests, Docker build và CI path filter đều chạy từ clean checkout |
| Report lifecycle | route/service/repository thống nhất state transition, capability/SoD test và UI contract |
| Drift comparability | same-dataset invariant hoặc explicit cross-dataset mode có metadata/warning/test |
| Context approval | một governance policy thống nhất cho promote và generic execution |
| HITL policy | typed allow-list + startup validation + negative tests cho PII/key |
| Chat release | staging authenticated evaluation đúng SHA + latency/grounding/privacy evidence |
| Retention | scheduler, metric/alert, dry-run/audit và recovery policy |
| Config | root resolution đúng, effective-config test cho local/container/CI và secret boundary review |

## Checklist khi cập nhật register

1. trỏ tới code/test cụ thể, không ghi theo cảm nhận;
2. tách behavior đang có khỏi behavior mong muốn;
3. không xóa gap chỉ vì unit test xanh nếu vấn đề là integration/production;
4. cập nhật trang feature/operations liên quan cùng thay đổi;
5. ghi ngày đối chiếu và commit/image khi có release evidence.

Đọc [cấu trúc codebase](./codebase-structure.md), [deployment](../operations/deployment.md) và [evaluation](../development/evaluation.md) để xử lý các gap tích hợp.
