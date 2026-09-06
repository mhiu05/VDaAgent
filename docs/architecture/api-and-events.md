# API và event contract

> Đối chiếu với FastAPI router, Pydantic schema và frontend transport ngày 2026-09-06. OpenAPI sinh từ app là contract field-level; trang này mô tả pattern tích hợp và ownership.

## Quy ước chung

- Base path nghiệp vụ: `/api/v1`.
- Health backend: `GET /health`; root metadata: `GET /`.
- Content mặc định: JSON UTF-8; upload dùng multipart, upload session hoặc direct object upload.
- Authentication: `Authorization: Bearer <token>`.
- Tenant selection: `X-Workspace-Id: <workspace-id>` khi user có nhiều workspace hoặc client chọn rõ.
- Correlation: client có thể gửi `X-Correlation-Id` hợp lệ; server luôn trả header này.
- Retry-safe mutation: dùng `Idempotency-Key` theo contract của endpoint.
- OpenAPI `/docs` và `/redoc` chỉ bật ngoài production.

Không dùng workspace ID trong payload để thay thế header/context đã xác thực. API có thể trả 404 thay vì tiết lộ resource thuộc tenant khác.

## Route group

| Nhóm | Endpoint chính | Auth/capability điển hình |
| --- | --- | --- |
| Session/workspace | `/session`, `/workspace-bootstrap`, `/me`, `/workspaces/*`, `/onboarding/provision` | active user/system hoặc workspace lifecycle capability |
| Dataset/ingestion | `/datasets`, `/datasets/upload`, `/datasets/upload-sessions/*`, `/datasets/datasource/*` | dataset read/upload/delete |
| Connector | `/connectors/*`, `/google-drive/*` | workspace storage connect + dataset upload/read |
| Profiling | `/profile`, `/datasets/{id}/profile`, `/datasets/profile`, `/profiling-jobs/{id}` | profile run/read/review |
| Profile result | `/profile/{run_id}`, `/summary`, `/export`, `/test`, `/drift`, `/report` | profile/stats/drift/report capability |
| Analysis | `/analysis-sessions/*`, `/profile/{run_id}/explorer/*`, `/charts/*` | analysis run |
| QA/chat | `/qa`, `/qa/stream`, `/conversations/*`, `/profile/{run_id}/chat-suggestions`, `/qa/feedback` | QA profile/published capability |
| Agent evidence | `/agent-runs/{id}/*`, `/agent-skills/*` | agent run/trace/profile read |
| Report | `/reports/*`, `/profile/{run_id}/report-draft` | report read/write/lifecycle capability |
| Admin | `/admin/users/*` | system admin context, không dùng workspace context |
| Diagnostics | `/status`, `/audit` | authenticated scoped capability |

## Pattern đồng bộ

CRUD/query ngắn trả status + response model ngay trong request. Router validate Pydantic trước, dependency resolve auth/workspace/capability, service chạy use case, repository/provider trả result. Input/compute `ValueError` thường thành 400; schema validation thành 422.

Các thao tác CPU/I/O dài không được giữ request thông thường nếu đã có durable workflow. Profiling luôn theo pattern submit 202 → worker → status/SSE.

## Profiling submit và event stream

### Submit

Các endpoint tạo job:

- `POST /api/v1/profile`;
- `POST /api/v1/datasets/{dataset_id}/profile`;
- `POST /api/v1/datasets/profile` cho batch.

`Idempotency-Key` dài 8–255 ký tự là bắt buộc. Server hash payload và scope key theo workspace/actor; cùng key+cùng request trả resource cũ, cùng key+payload khác trả 409.

Response HTTP 202 trả job/Profile Run identity. Client không giả định profile đã sẵn sàng.

### SSE

`GET /api/v1/profiling-jobs/{job_id}/events` trả `text/event-stream`:

```text
id: <hash của projection>
event: profiling|review_required|ready|failed|...
data: <ProfileSummary JSON>
```

Event hợp lệ: `queued`, `profiling`, `resuming`, `review_required`, `ready`, `failed`. Server emit lại khi projection đổi, gửi keepalive comment độc lập và dừng query khi client disconnect. `ready`/`failed` là terminal; `review_required` yêu cầu UI chuyển sang HITL dù worker job có thể đã `succeeded`.

Frontend có thể reconnect/poll fallback nhưng phải tiếp tục cùng job. Không submit lại với idempotency key mới chỉ vì stream bị ngắt.

## Chat REST và `chat_stream.v1`

`POST /api/v1/qa` trả Answer Envelope V2 sau khi graph và validator hoàn tất. `POST /api/v1/qa/stream` trả progress qua SSE và cùng terminal contract. Mỗi frame có `schema_version=chat_stream.v1`, event ID, stage và payload tương ứng.

Stage phía client hỗ trợ routing, retrieval/tool/evidence/model progress, partial answer, complete/error/cancel tùy path. Chỉ terminal envelope đã qua evidence validation mới là câu trả lời canonical; partial token/progress không mang guarantee verified.

Request ID/idempotency của agent run cho phép reconnect/retry an toàn theo cùng scope. Nếu key đã gắn với request khác, server trả conflict thay vì nối sai conversation/run.

## Preview và Official

Command Center dùng hai mutation độc lập:

1. `POST /profile/{run_id}/explorer/previews` tạo execution approximate có expiry;
2. `POST /profile/{run_id}/explorer/previews/{preview_id}/promote` validate context/gate rồi chạy lại full-source bounded Official.

Promotion không đổi nhãn Preview/result cũ thành Official. Official persist result hash, context version, quality gate, limitation và attribution để QA/report sử dụng.

## Idempotency matrix

| Use case | Key | Scope/behavior |
| --- | --- | --- |
| Upload/import session | bắt buộc ở session/Drive path, client sinh cho upload thường | workspace + actor + request hash; retry không tạo artifact trùng |
| Datasource connector create | tùy chọn nhưng client hỗ trợ | workspace + key + request hash |
| Profiling submit/batch | bắt buộc | workspace + actor; batch derive child key deterministic |
| HITL resume | hỗ trợ | run + last resume action/key; chống apply lại decision |
| Analysis Preview/Official | header hoặc payload | analysis session + key + query hash |
| Agent/QA run | request ID/idempotency | workspace + actor + run type; payload mismatch conflict |
| Pin report item | bắt buộc | report version + key; retry trả item cũ |

Client chỉ tái sử dụng key cho cùng logical mutation. Retry với key mới có thể tạo tác dụng phụ mới.

## Error contract

| HTTP | Ý nghĩa điển hình | Client behavior |
| --- | --- | --- |
| 400 | input/compute không hợp lệ ngoài schema | sửa request, không retry mù |
| 401 | bearer thiếu/hết hạn/không hợp lệ | refresh một lần rồi đăng nhập lại |
| 403 | account/capability/policy từ chối | không retry; ẩn action và báo quyền |
| 404 | resource không tồn tại trong scope | bỏ ID stale; không suy đoán cross-tenant |
| 409 | state/version/idempotency/context conflict | reload canonical state rồi quyết định lại |
| 422 | Pydantic/QuerySpec/contract validation | sửa field theo detail |
| 429 | rate limit | backoff theo policy/header |
| 503 | database/provider tạm thời không sẵn sàng | retry bounded; DB response có `Retry-After: 3` |
| 500 | lỗi không dự đoán đã sanitize | cung cấp correlation ID, không show stack |

SSE lỗi có terminal event/payload ổn định khi stream đã mở; lỗi trước khi mở stream vẫn dùng HTTP status. Client phải xử lý cả hai.

## Versioning và compatibility

- API prefix hiện là `v1`; breaking field/semantic change cần version hoặc compatibility period.
- Answer envelope dùng `schema_version: v2`.
- Chat stream dùng `schema_version: chat_stream.v1`.
- Agent trace/plan có schema/version riêng; không gửi raw graph state cho client.
- `src/frontend/openapi.json` và `src/frontend/src/lib/schema.d.ts` phải được regenerate cùng backend revision khi contract đổi.

## Checklist tích hợp

1. gửi bearer và workspace header từ transport chung;
2. giữ correlation ID trong log client/support;
3. dùng idempotency key ổn định qua retry;
4. phân biệt job status, domain status và next action;
5. parse SSE theo event + schema version, không theo text hiển thị;
6. chỉ dùng Official/verified terminal payload làm evidence;
7. xử lý 404/409 mà không làm lộ resource ngoài workspace;
8. giới hạn retry/cancellation và không nhân đôi mutation.

Đọc tiếp [backend](./backend.md), [profiling job](./async-profiling-jobs.md) và [bounded execution](./bounded-execution.md).
