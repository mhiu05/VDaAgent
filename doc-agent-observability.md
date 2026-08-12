# Agent Governance And Observability API

This document covers the new agent-layer APIs added on top of the existing profiling APIs.

Full profiling endpoints now enrich `ProfileResult` with:

- `agent_run`: `run_id`, `trace_id`, `status`, and run metrics.
- `agent_status`: user-safe workflow status and summary. This does not expose chain-of-thought.
- `governance`: PII columns, masked value count, HITL pending count, and a trace URL hint.

PII values in `sample_values` and `top_values` are masked before they reach the frontend, traces, or HITL records.

## `GET /api/v1/agent/tools`

Returns the deterministic tool catalog used by the profiling agent workflow.

Output:

```json
[
  {
    "name": "pii_detection",
    "description": "Detect and mask PII in column samples and top values.",
    "input_schema": {"columns": "list"},
    "output_schema": {"pii_columns": "list", "masked_value_count": "int"}
  }
]
```

## `GET /api/v1/agent/runs`

Returns recent persisted agent runs for the monitoring dashboard. Profiling
runs and chat turns are both represented as agent runs.

Query parameters: `limit` and `offset`.

Output fields:

- `run_id`
- `source_name`
- `source_type`
- `status`
- `started_at`
- `updated_at`
- `metrics`

## `GET /api/v1/agent/runs/{run_id}`

Returns one agent run.

## `GET /api/v1/agent/runs/{run_id}/trace`

Returns the trace timeline for one run.

Each event includes:

- `run_id`
- `trace_id`
- `span_id`
- `parent_span_id`
- `event_type`
- `component`
- `tool_name`
- `input_summary`
- `output_summary`
- `status`
- `started_at`
- `ended_at`
- `duration_ms`
- `error_message`
- `metadata`

Trace summaries must stay PII-safe. Do not log raw rows or raw sensitive values.

## `GET /api/v1/agent/traces`

Returns persisted trace events. Query parameters: `limit` and `offset`.

## `GET /api/v1/hitl`

Lists HITL records.

Optional filters:

- `status=pending|approved|rejected`
- `run_id=<agent-run-id>`
- `limit=<1-500>`
- `offset=<number>`

Output fields:

- `id`
- `run_id`
- `type`
- `severity`
- `source`
- `table`
- `columns`
- `evidence`
- `proposed_action`
- `status`
- `reviewer`
- `reviewed_at`
- `comment`

## `POST /api/v1/hitl/{record_id}/approve`

Approves a HITL item.

Input:

```json
{
  "reviewer": "analyst",
  "comment": "Confirmed as a governed PII column."
}
```

## `POST /api/v1/hitl/{record_id}/reject`

Rejects a HITL item.

Input:

```json
{
  "reviewer": "analyst",
  "comment": "False positive for this source."
}
```

## Persistent chat history

Chat history is rendered by the frontend but stored by the backend in SQLite.
The browser stores only a pseudonymous client identifier and the active
`conversation_id`. Common PII patterns are masked before messages are written.

### `POST /api/v1/chat`

Input:

```json
{
  "message": "Explain the current profile",
  "conversation_id": null,
  "user_id": "browser-user-id",
  "run_id": "optional-profile-run-id"
}
```

The response contains `response`, `conversation_id`, and the chat-turn
`run_id`. Every chat turn creates trace events and response-time metrics.

### `POST /api/v1/conversations`

Creates an empty conversation using `user_id` and `title`.

### `GET /api/v1/conversations`

Lists conversation summaries for `user_id`. Supports `limit` and `offset`.

### `GET /api/v1/conversations/{conversation_id}/messages`

Returns the PII-safe message history. The caller must provide the same
`user_id` that owns the conversation.

## Storage

The default database is `sqlite:///./data/app.db`, controlled by
`DATABASE_URL`. Tables are initialized automatically:

- `agent_runs`
- `trace_events`
- `hitl_records`
- `conversations`
- `chat_messages`

SQLite is appropriate for the local MVP. Before multi-instance deployment,
move this repository to PostgreSQL and replace the temporary browser user ID
with the authenticated backend user identity.
