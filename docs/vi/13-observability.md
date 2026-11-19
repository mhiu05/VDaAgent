# 13 · Quan sát hệ thống

Chỉ dành cho admin. Phần quan sát hệ thống có hai chế độ xem, mỗi chế độ có nguồn dữ liệu riêng, nên không chế độ nào phụ thuộc chế độ kia đang chạy ([quyết định 0013](decisions/0013-langfuse-in-compose-plus-own-trace-view.md)). **Phụ thuộc:** [03](03-agent-loop.md), [07](07-routing-and-queue.md), [10](10-data-model.md).

| Chế độ xem | Nguồn dữ liệu | Mục đích |
|---|---|---|
| **Langfuse** | Langfuse v4, chạy trong stack compose của chúng ta | Chi phí, token, độ trễ, generation, tìm kiếm, session. Giao cho một công cụ đã có sẵn |
| **Trace dạng chat** | Postgres của chúng ta (`events`, `messages`, `deliveries`, `jev_decisions`) | Cuộc đời của một agent hiện như một cuộc chat: mọi hành động, và trigger đã gây ra nó |

## Langfuse trong stack compose

- **Các service.** Thêm `langfuse-web` và `langfuse-worker` (tag image `4`), `clickhouse` (25.x), `redis` (7) và `minio`, theo `docker-compose.yml` chính thức của Langfuse. Langfuse dùng server `postgres` của chúng ta, với database riêng `langfuse`, tạo bởi `deploy/postgres/init/10-langfuse.sql`.
- **Truy cập.** UI được publish ở `127.0.0.1:3100`, với `NEXTAUTH_URL=${LANGFUSE_PUBLIC_URL}` (mặc định `http://localhost:3100`).
- **Headless init** tạo org, project, API key và người dùng đầu tiên từ các biến sau, nên không phải bấm tay bước nào: `LANGFUSE_INIT_ORG_ID=contoso`, `LANGFUSE_INIT_PROJECT_ID=contoso-poc`, `LANGFUSE_INIT_PROJECT_PUBLIC_KEY=${LANGFUSE_PUBLIC_KEY}`, `LANGFUSE_INIT_PROJECT_SECRET_KEY=${LANGFUSE_SECRET_KEY}`, `LANGFUSE_INIT_USER_EMAIL`, `LANGFUSE_INIT_USER_PASSWORD=${ADMIN_PASSWORD}`. Giá trị trong compose viết không có dấu nháy, như tài liệu Langfuse yêu cầu.
- **`api`** gửi trace tới `http://langfuse-web:3000` với cùng public/secret key, dùng Python SDK v5 (`langfuse>=5`, cần server Langfuse ≥ 4.59).
- **Nếu Langfuse không chạy hoặc thiếu key, tracing tắt và không gì khác bị hỏng.** SDK export trong một thread nền và tự bắt lỗi của nó. Harness không bao giờ chờ nó, và trong compose `api` không phụ thuộc vào health của Langfuse.

## Ánh xạ runtime sang Langfuse

| Của chúng ta | Langfuse |
|---|---|
| Một activation | Một **trace**. Observation gốc là một `span` tên `activation:<slug>`, tạo với `trace_context={"trace_id": <trace_id của chúng ta>}`, nên id giống nhau ở cả hai hệ thống |
| id người dùng, miền, agent | `propagate_attributes(user_id=<username>, session_id=…, tags=[miền, slug, activation_kind, "lead"?], metadata={agent_id, epoch})` |
| Task toàn cục đang chạy | `session_id = "task:T<id>"`, nên công việc của mọi agent cho một task hiện thành một session Langfuse. Ngoài task, `session_id = "agent:<agent_id>"` |
| Lần gọi model | `generation` tên `model`, với `model`, `model_parameters`, `input` = các event được nối từ lần gọi model trước (**phần chênh lệch**), `output` = text và lời gọi tool của assistant, `usage_details={input, output, cache_read}`, `cost_details={total: usage.cost}` |
| Exec Python | observation `tool` tên `python`. `input` = code, `output` = text kết quả tool; `metadata={exit_code, duration_ms, timed_out, head, changed, offload_path}` |
| `send_to_user`, `send_to_agent`, `end_task`, `queue_task` | observation `event` mang id tin nhắn, hội thoại và người nhận |
| Lần gọi jev | một `generation` tên `jev` trong trace của bên đăng tin: activation của agent gửi, hoặc một trace ngắn `user_message` với input của người dùng (`session_id` như trên, tag `user_message`); `usage_details={input, output}` từ `usage.input_tokens`/`usage.output_tokens` của Decisions API (không có `cache_read`); `cost_details={total: usage.cost}`; `metadata={label, confidence, fallback, latency_ms}` |
| Thứ đã kích hoạt activation | `metadata.trigger_trace_ids`: `trace_id` của tin nhắn của mỗi delivery đã tiêu thụ. Langfuse không liên kết các trace với nhau; chế độ xem trace dạng chat của chúng ta phân giải các id này |

- **Input là phần chênh lệch, không phải toàn bộ context.** Ghi toàn bộ context ở mỗi bước sẽ đưa tới ~100k token × 50 bước cho mỗi activation vào ClickHouse. Toàn bộ context luôn dựng lại được từ `events`, và chế độ xem trace làm đúng việc đó.
- **Chi phí lấy từ `usage.cost` của OpenRouter.** Langfuse không tự định giá được id model của OpenRouter.
- **Instrumentation viết tay**, trong một module `backend/observability/tracing.py`, dùng `get_client().start_as_current_observation(as_type=…)`. Không dùng drop-in `langfuse.openai`, vì nó ghi toàn bộ input và tính chi phí theo bảng model riêng. Cụ thể (SDK 5.0.2): activation là `start_as_current_observation(trace_context={trace_id}, as_type="span")` cộng `propagate_attributes(...)`; generation và tool là con của span đó; lời gọi helper là `create_event(trace_context=…)`; jev là `start_observation(trace_context={trace_id của người gửi}, as_type="generation")`. Mọi lời gọi đều được bọc để lỗi Langfuse chỉ được ghi log rồi bỏ qua. Tracing chỉ bật khi có cả `LANGFUSE_PUBLIC_KEY` và `LANGFUSE_SECRET_KEY`.
- **Liên kết ra ngoài.** Mỗi activation trong các chế độ xem của chúng ta có nút "Mở trong Langfuse" mở `${LANGFUSE_PUBLIC_URL}/project/${LANGFUSE_INIT_PROJECT_ID}/traces/<trace_id>` trong tab mới. Mỗi task liên kết tới `/project/<id>/sessions/task:T<id>`.

## Chế độ xem trace dạng chat

Route: `/admin/trace/:agentId` (dòng thời gian của agent) và `/admin/threads/:threadId` (chế độ hội thoại). Dữ liệu: `GET /api/admin/agents/{id}/events?after_seq=&limit=200` cộng `GET /api/admin/agents/{id}/stream` (SSE `event.appended`, `agent.status`).

**Thanh bên:** miền → người dùng → các agent của người đó (có chấm trạng thái) và các hội thoại, kể cả hội thoại `agent`.

**Dòng thời gian**, render từ `events` theo thứ tự `seq`, gồm các phần tử sau:

| Phần tử | Nguồn | Cách hiển thị |
|---|---|---|
| Vạch chia activation | event đầu tiên của mỗi `trace_id` | loại, giờ bắt đầu, thời lượng, token, chi phí (tổng usage của các `assistant`), "Mở trong Langfuse" |
| Bong bóng đến | mỗi mục của một event `input` | ghi nguồn gốc: "Người dùng · Nhóm báo cáo Q3", "Agent Data · agent:data+lead", "Lịch bao-cao-sang", "Mở ứng dụng", "Builder", "Khởi động lại". Bấm bong bóng tin nhắn sẽ nhảy tới dòng thời gian của người gửi tại tin đó (người gửi là agent) hoặc tới hội thoại (người gửi là người dùng) |
| Nhãn jev | `jev_decisions` cho các delivery tới lead | `task` / `side_question` (đánh dấu nếu là fallback). Thao tác "Gắn nhãn sai" gọi `POST /api/admin/jev/{message_id}/observed` |
| Chip `current_state` | text của `input` | thu gọn; mở ra thành khối thô |
| Suy luận | `assistant.text` | màu nhạt, mặc định thu gọn |
| Lời gọi Python | `assistant.tool_calls[i]` + `tool_result` tương ứng | khối code, rồi output (có link tới file đã offload), mã thoát, thời lượng; danh sách "file thay đổi" với diff ngay tại chỗ (`GET /api/agents/{id}/diff?commit=head`); "Xem thư mục tại bước này" mở trình xem thư mục với `at=head` |
| Gửi người dùng | event `send_to_user` và tin nhắn của nó | bong bóng bên phải ghi "người dùng thấy", tệp đính kèm và lựa chọn hiện đúng như người dùng thấy |
| Gửi agent | `send_to_agent` | bong bóng bên phải kèm danh sách người nhận |
| Mốc task | input `begin_task`, `end_task` | "Bắt đầu T42 …" / "Kết thúc T42 · done · outcome" |
| Vạch chia epoch | `agent_epochs` | "Nén ngữ cảnh (epoch 3)", mở ra xem tóm tắt và system prompt |
| Lỗi | các event `error` | dòng đỏ với mã lỗi và text |

**Chế độ hội thoại** hiện bất kỳ hội thoại nào dưới dạng chat nhóm. Mỗi tin liên kết tới activation đã gửi nó (`messages.trace_id`).

**Trang tổng quan** (`/admin`): mỗi agent một dòng, gồm người dùng, miền, slug, trạng thái, task hiện tại, độ dài hàng đợi (với lead), số delivery đang chờ, `compaction_failed`, thời điểm lỗi gần nhất, và chi phí hôm nay (tổng `usage.cost` của các `assistant` từ nửa đêm giờ địa phương). Trang cũng hiện trạng thái các miền và link tới Langfuse.

## Log

`structlog` ghi các dòng JSON ra stdout. Mỗi dòng mang `trace_id`, `user_id`, `agent_id` và `exec_id` khi biết. Giá trị trong file `.env.d/`, cookie, mật khẩu và key OpenRouter không bao giờ được ghi log. `docker compose logs` là nơi lưu log duy nhất trong PoC.
