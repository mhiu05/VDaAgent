# 06 · Context and compaction

How a long-running session keeps its context useful without bloating. **Depends on:** [01](01-glossary.md), [03](03-agent-loop.md), [04](04-agent-folder.md), [09](09-routines.md).

## Layout

The context grows from left to right, and compaction resets it:

```text
[system prompt] [current_state + new input]
[system prompt] [history ...] [current_state + new input]
[system prompt] [history ............] [current_state + new input]
                     ↓ compaction (new epoch)
[system prompt (re-rendered)] [summary] [current_state + new input]
```

An agent's context is fully defined by:

> `agent_epochs[latest].system_prompt` + `agent_epochs[latest].summary` + `events` where `seq > agent_epochs[latest].start_seq`, in `seq` order.

## System prompt

The system prompt is rendered **once per epoch** and stored in `agent_epochs.system_prompt`. It is never re-rendered during an epoch.

```text
<platform_rules>        platform/rules.md (+ the "Lead duties" section if is_lead)
<role>                  prompts/system.md
<context>               prompts/context.md
<memory_index>          memory/index.md
<skills>                one line per skills/*/SKILL.md: "- <name>: <description>  (skills/<dir>/SKILL.md)"
<environment>           folder path, Python version, credential key names per attached set, installed packages
```

`platform/rules.md` covers:
- **The tool and its helpers:** the single Python tool, and the `contoso` helpers with their signatures.
- **Messaging:** silent by default; when to message the user; `final=True`; notifications and blocks of work.
- **Folder conventions:** where to keep preferences, procedures, helpers and durable facts ([04](04-agent-folder.md#self-improvement)).
- **Hard rules:** never edit or print `.env.d/` files, or any value read from them; never write outside the folder; keep routines short.
- **Lead duties** (lead only): own the queue; handle `<begin_task>` work yourself or with `send_to_agent`; reply to the user; call `end_task`. Treat a request that helps with the current task as a side question.

## Rendering

`harness/render.py` turns the context into an OpenAI-format `messages` list:

| Source | Message |
|---|---|
| `system_prompt` | `{"role": "system", "content": system_prompt}` |
| `summary` (if not empty) | `{"role": "user", "content": "<summary>\n…\n</summary>"}` |
| `input` event | `{"role": "user", "content": payload.text}` |
| `assistant` event | `{"role": "assistant", "content": payload.text or null, "tool_calls": [...]}` |
| `tool_result` event | `{"role": "tool", "tool_call_id": …, "content": payload.text}` |
| `error` event | `{"role": "user", "content": "<error code=…>…</error>"}` |

- **The stored `payload.text` is exactly what was sent.** Rendering never reformats earlier events, so the prefix is byte-stable.
- **A context may end with a `tool` message** followed by a new `user` message (after `final=True`). That's valid in the OpenAI format, and OpenRouter converts it for Anthropic models. The live contract test ([17](17-testing.md)) checks it.
- **Cache breakpoints.** For `anthropic/*` models, the renderer adds `cache_control: {"type": "ephemeral"}` to the system message and to the last message. Other providers cache prefixes automatically.

## `current_state`

Rendered by the harness and placed at the start of every `input` event:

```text
<current_state>
time: 2026-10-17T10:02:11+07:00
you: data ("Data")
lead: lead ("Điều phối")
team: lead, data, insight, compare, chart, report
task: T42 "Vì sao căn MAS-U03832 bán chậm…" (running since 10:01)
status: busy
pending: 2 notifications; routines: bao-cao-sang
</current_state>
```

- For the lead, the line `lead: you`, and a `queue: 2 queued` line follows `task:`.
- `task: none` when the user has no running task. The task description is cut to 60 characters (ending in `…`); `pending: none` when nothing waits. Times are in `Asia/Ho_Chi_Minh`.

## Input items

The rest of an `input` event is one element per item, oldest first:

```text
<notification id="d_981" from="user:alice" thread="direct:data" message="m_5521" at="10:02:05">
Lấy giúp bảng giá dự án 100.
attachments: files/inbox/m_5521/bang-gia.xlsx
</notification>
<notification id="d_982" from="agent:lead" thread="agent:lead+data" message="m_5522" at="10:02:09">
…
</notification>
<notice id="d_990" kind="builder" at="10:05:00">Kỹ năng mới: xlsx — đọc skills/xlsx/SKILL.md</notice>
<routine name="bao-cao-sang" fired_at="08:00:00">…prompt…</routine>
<begin_task id="T42" source_message="m_5520" thread="direct:lead">
Phân tích vì sao căn MAS-U03832 bán chậm, so sánh căn tương đồng, vẽ biểu đồ, xuất báo cáo.
--- original message ---
Vì sao căn MAS-U03832 bán chậm? So sánh với các căn tương đồng, vẽ biểu đồ và xuất báo cáo.
</begin_task>
```

`thread` uses readable ids: `direct:<slug>`, `group:<thread_id>` (plus a `name="…"` attribute), `agent:<slug>+<slug>…`. The helpers accept the same ids.

## Append-only during a task

Nothing already in the context changes while a task runs. New inputs are appended at the end, and older `current_state` blocks stay where they are. This keeps the provider's prefix cache valid. A `current_state` inside the system prompt would invalidate the whole cache on every turn. There is one exception: the fallback batch offload below, which costs one cache miss and is recorded as such ([decision 0005](decisions/0005-append-only-context-during-a-task.md)).

## Offloading large outputs

1. **When an output arrives.** If `stdout` + `stderr` is longer than `OFFLOAD_CHARS` (default 8,000), `api` writes the full output to `.contoso/outputs/<exec_id>.txt`. The tool result then contains only the first 2,000 and last 2,000 characters of the output (stdout, then stderr), plus the path ([03](03-agent-loop.md#tool-result-format)). The agent reads the file again when it needs more, which costs one more exec.
2. **Fallback.** If the estimate passes the hard limit ([03](03-agent-loop.md#context-limits-during-a-step)), every `tool_result` in the current epoch that isn't offloaded yet, except the newest, is offloaded in a single batch. That rewrites their `payload.text` to the offloaded form, sets `payload.batch_offloaded_at`, and appends an `error` event (`batch_offload`, with the count) so the cache reset shows in traces.
3. **Failure.** If the context is still over the hard limit, the `context_overflow` rule in [03](03-agent-loop.md#context-limits-during-a-step) applies.

Offloaded files are kept for the life of the folder (see [99](99-risks-and-future-work.md)).

## Compaction

Compaction moves information out of the history so the context doesn't bloat:

- durable facts go into the folder (memory, `prompts/context.md`, skills), so they come back in the next epoch's system prompt;
- everything else needed to continue goes into a new summary, which replaces the old one.

**When it runs** ([decision 0004](decisions/0004-no-compaction-during-a-task.md)):
- Compaction becomes **pending** in four cases: the estimate passes `SOFT_CONTEXT_RATIO`, a builder prompt edit, a `context_overflow`, or an admin's "compact now".
- It runs **only at a safe point**: the agent is idle and not in `task_involvement` for a running task. Compacting during a task the agent is involved in is a hard bug, and a test guards against it.
- It is a built-in routine, so routine rules apply: at most one is pending, and it comes after pending deliveries and routines ([03](03-agent-loop.md#activation)).
- The lead compacts between tasks: after `end_task`, and before `begin_task` for the next task.

**Procedure** (`harness/compaction.py`):
1. Append an `input` event with `current_state` and `<compaction>` + `platform/compaction.md`. That prompt tells the agent to:
   - update `memory/*.md` and `memory/index.md`, `prompts/context.md`, and skills, with what it learned;
   - then call `contoso.write_summary(text)`, containing what it needs to continue: open commitments, recent decisions, unresolved questions, and the last few exchanges per thread;
   - send no messages.
2. Run the normal step loop with `COMPACTION_MODEL`. `send_to_user` and `send_to_agent` return an error during compaction.
3. Compaction **succeeds** when `write_summary` was called with non-empty text and the activation ends.
   - `api` renders a new system prompt from the folder.
   - It inserts `agent_epochs(epoch+1, start_seq=<last seq>, system_prompt, summary, reason='compaction')`. Since `start_seq` is the last seq, the compaction's own events are left out of the new context.
   - It makes a harness commit `epoch <n>` if files changed.
4. Compaction **fails** if `write_summary` was never called, or on a model error or step limit. The epoch is unchanged and compaction stays pending, retried at the next safe point after a backoff of 1, 5, then 30 minutes (kept in memory, so a restart retries at once). `write_summary` outside a compaction is 409 `not_compacting`. After 3 failures, the agent shows `compaction_failed` on the admin overview.
5. If the compaction context itself would pass the hard limit, it is batch-offloaded first. If it is still too large, the harness opens a new epoch with `summary = previous summary + "\n[Ngữ cảnh trước đó bị lược bỏ do vượt giới hạn]"` and appends an `error` event (`compaction_truncated`).

## Cache resets

The prefix cache resets only when a new epoch opens (at compaction or reset) and when a fallback batch offload runs. Both are rare and both are recorded.

## Settings

| Key | Default | Meaning |
|---|---|---|
| `SOFT_CONTEXT_RATIO` | 0.6 | Share of the window at which compaction becomes pending |
| `HARD_CONTEXT_RATIO` | 0.9 | Share of the window at which batch offload runs |
| `OFFLOAD_CHARS` | 8000 | Output size above which outputs are offloaded |
| `OFFLOAD_HEAD_CHARS` / `OFFLOAD_TAIL_CHARS` | 2000 / 2000 | What stays in context |
| `COMPACTION_MODEL` | same as `AGENT_MODEL` | Model used for compaction |
