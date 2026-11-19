# 13 · Observability

Admin only. Observability has two views, each with its own data source, so neither depends on the other being up ([decision 0013](decisions/0013-langfuse-in-compose-plus-own-trace-view.md)). **Depends on:** [03](03-agent-loop.md), [07](07-routing-and-queue.md), [10](10-data-model.md).

| View | Data source | Purpose |
|---|---|---|
| **Langfuse** | Langfuse v4, running in our compose stack | Cost, tokens, latency, generations, search, sessions. Offloaded to an established tool |
| **Chat trace** | our Postgres (`events`, `messages`, `deliveries`, `jev_decisions`) | One agent's life shown as a chat: every action, and the trigger that caused it |

## Langfuse in the compose stack

- **Services.** We add `langfuse-web` and `langfuse-worker` (image tag `4`), `clickhouse` (25.x), `redis` (7) and `minio`, following Langfuse's own `docker-compose.yml`. Langfuse uses our `postgres` server, with its own database `langfuse`, created by `deploy/postgres/init/10-langfuse.sql`.
- **Access.** The UI is published on `127.0.0.1:3100`, with `NEXTAUTH_URL=${LANGFUSE_PUBLIC_URL}` (default `http://localhost:3100`).
- **Headless init** creates the org, project, API keys and first user from these variables, so there is nothing to click through: `LANGFUSE_INIT_ORG_ID=contoso`, `LANGFUSE_INIT_PROJECT_ID=contoso-poc`, `LANGFUSE_INIT_PROJECT_PUBLIC_KEY=${LANGFUSE_PUBLIC_KEY}`, `LANGFUSE_INIT_PROJECT_SECRET_KEY=${LANGFUSE_SECRET_KEY}`, `LANGFUSE_INIT_USER_EMAIL`, `LANGFUSE_INIT_USER_PASSWORD=${ADMIN_PASSWORD}`. Values are written without quotes in compose, as Langfuse's docs require.
- **`api`** sends traces to `http://langfuse-web:3000` with the same public and secret key, using the Python SDK v5 (`langfuse>=5`, which needs Langfuse server ≥ 4.59).
- **If Langfuse is down or the keys are missing, tracing is off and nothing else breaks.** The SDK exports in a background thread and catches its own errors. The harness never waits on it, and `api` doesn't depend on Langfuse's health in compose.

## Mapping our runtime onto Langfuse

| Ours | Langfuse |
|---|---|
| One activation | One **trace**. The root observation is a `span` named `activation:<slug>`, created with `trace_context={"trace_id": <our trace_id>}`, so the id is the same in both systems |
| user id, domain, agent | `propagate_attributes(user_id=<username>, session_id=…, tags=[domain, slug, activation_kind, "lead"?], metadata={agent_id, epoch})` |
| Running global task | `session_id = "task:T<id>"`, so every agent's work on one task appears as one Langfuse session. Outside a task, `session_id = "agent:<agent_id>"` |
| Model call | `generation` named `model`, with `model`, `model_parameters`, `input` = the events appended since the previous model call (a **delta**), `output` = the assistant text and tool calls, `usage_details={input, output, cache_read}`, `cost_details={total: usage.cost}` |
| Python exec | `tool` observation named `python`. `input` = code, `output` = the tool result text; `metadata={exit_code, duration_ms, timed_out, head, changed, offload_path}` |
| `send_to_user`, `send_to_agent`, `end_task`, `queue_task` | `event` observations carrying the message id, thread and receivers |
| jev call | a `generation` named `jev` in the trace of whoever posted the message: the sender agent's activation, or a short trace `user_message` for user input (`session_id` as above, tag `user_message`); `usage_details={input, output}` from the Decisions API's `usage.input_tokens`/`usage.output_tokens` (no `cache_read`); `cost_details={total: usage.cost}`; `metadata={label, confidence, fallback, latency_ms}` |
| What triggered an activation | `metadata.trigger_trace_ids`: the `trace_id` of each consumed delivery's message. Langfuse doesn't link traces to each other; our chat-trace view resolves these ids |

- **Inputs are deltas, not full contexts.** Logging the full context on every step would store up to ~100k tokens × 50 steps per activation in ClickHouse. The full context can always be rebuilt from `events`, and the chat-trace view does exactly that.
- **Cost comes from OpenRouter's `usage.cost`.** Langfuse can't price OpenRouter model ids itself.
- **Instrumentation is manual**, in one module `backend/observability/tracing.py` (SDK 5.0.2): the activation is `start_as_current_observation(trace_context={trace_id}, as_type="span")` plus `propagate_attributes(...)`; generations and tools are children of that span (`span.start_observation(...)`); helper calls are `create_event(trace_context=…)`; jev is `start_observation(trace_context={poster's trace_id}, as_type="generation")`. Every call is wrapped so a Langfuse error is logged and dropped. Tracing is on only when `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are set. We don't use the `langfuse.openai` drop-in, because it would record full inputs and compute cost from its own model table.
- **Links out.** Every activation in our views has an "Mở trong Langfuse" button that opens `${LANGFUSE_PUBLIC_URL}/project/${LANGFUSE_INIT_PROJECT_ID}/traces/<trace_id>` in a new tab. Every task links to `/project/<id>/sessions/task:T<id>`.

## Chat-trace view

Routes: `/admin/trace/:agentId` (agent timeline) and `/admin/threads/:threadId` (thread mode). Data: `GET /api/admin/agents/{id}/events?after_seq=&limit=200` plus `GET /api/admin/agents/{id}/stream` (SSE `event.appended`, `agent.status`).

**Sidebar:** domain → user → that user's agents (with status dots) and threads, `agent` threads included.

**Timeline**, rendered from `events` in `seq` order, with these elements:

| Element | Source | Rendering |
|---|---|---|
| Activation divider | first event of each `trace_id` | kind, start time, duration, tokens, cost (sum of its `assistant` usages), "Mở trong Langfuse" |
| Incoming bubble | each item of an `input` event | labelled with its origin: "Người dùng · Nhóm báo cáo Q3", "Agent Data · agent:data+lead", "Lịch bao-cao-sang", "Mở ứng dụng", "Builder", "Khởi động lại". Clicking a message bubble jumps to the sender's timeline at that message (agent senders) or to the thread (user senders) |
| jev badge | `jev_decisions` for deliveries to the lead | `task` / `side_question` (fallback marked). A "Gắn nhãn sai" action calls `POST /api/admin/jev/{message_id}/observed` |
| `current_state` chip | the `input` text | collapsed; expands to the raw block |
| Reasoning | `assistant.text` | muted, collapsed by default |
| Python call | `assistant.tool_calls[i]` + matching `tool_result` | code block, then the output (with a link to the offloaded file), exit code, duration; "files changed" list with an inline diff (`GET /api/agents/{id}/diff?commit=head`); "Xem thư mục tại bước này" opens the folder viewer with `at=head` |
| Outgoing to the user | `send_to_user` event and its message | right-aligned bubble marked "người dùng thấy", attachments and choices shown as the user sees them |
| Outgoing to agents | `send_to_agent` | right-aligned bubble with the receivers |
| Task markers | `begin_task` input, `end_task` | "Bắt đầu T42 …" / "Kết thúc T42 · done · outcome" |
| Epoch divider | `agent_epochs` | "Nén ngữ cảnh (epoch 3)", expandable summary and system prompt |
| Error | `error` events | red row with the code and text |

**Thread mode** shows any thread as a group chat. Each message links to the activation that sent it (`messages.trace_id`).

**Overview page** (`/admin`): one row per agent, with user, domain, slug, status, current task, queue length (leads), pending deliveries, `compaction_failed`, last error time, and today's cost (sum of `assistant` `usage.cost` since local midnight). The page also shows the domain statuses and a link to Langfuse.

## Logs

`structlog` writes JSON lines to stdout. Every line carries `trace_id`, `user_id`, `agent_id` and `exec_id` when known. Values from `.env.d/` files, cookies, passwords and the OpenRouter key are never logged. `docker compose logs` is the only log store in the PoC.
