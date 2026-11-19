# 17 · Testing

**Depends on:** every other doc. Tests check the invariants and behaviour described in [03](03-agent-loop.md)–[15](15-api.md).

## Current state

| Where | Runs today |
|---|---|
| `make test` (compose, see below) | backend `pytest` (unit tests for settings, preflight, `setup` (`backend.init_env`), `/api/health` and the boot order; schema and invariant tests in `backend/tests/db` against the real `postgres`; integration checks against the real `postgres` and `workspace`), the `execd` tests, and the frontend Vitest + legacy domain suites |
| CI, Python job (`.github/workflows/ci-cd.yml`) | `uv run pytest -v` with `MODEL_BACKEND=fake` and `DATABASE_URL` pointing at a `postgres:17` service (`contoso_test`), then the `execd` tests in their own uv environment. No OpenAI key |
| CI, frontend job | `npm ci`, `npm run lint`, `npm run build`, `npm test`, `npm run test:domain` on Node 24 |
| Local, `frontend/` | `npm test` (Vitest, `src/**/*.test.{ts,tsx}` and `tests/**/*.test.{ts,tsx}`, jsdom); `npm run test:domain` (only the legacy `src/**/*.test.mjs` suite); `npm run test:browser` (Playwright journeys in `frontend/tests/*.spec.ts`, using its own Vite server on port 5179). See [14g](14g-frontend-development.md). |

## Where tests run

**Status:** Implemented (all rows). Everything runs inside compose, so the tests see the same Postgres, network and filesystem as production:

| Command | Runs |
|---|---|
| `docker compose -f docker-compose.yml -f compose.test.yaml run --rm backend pytest` | backend unit + integration (fresh `contoso_test` DB, `MODEL_BACKEND=fake`, Langfuse keys unset) |
| `docker compose ... run --rm workspace pytest /opt/execd/tests` | `execd` and `contoso` tests |
| `docker compose ... run --rm frontend-test` | Vitest (node image, `frontend/`) |
| `make e2e` | Playwright against a fresh fake-mode stack |
| `make test-live` (`pytest -m live`, opt-in) | live OpenRouter contract tests; need `OPENROUTER_API_KEY` |

`make test` removes any leftover test project, runs the first three, then removes it again (a fresh `folders` volume starts with an empty uv cache; nothing is pre-warmed). `compose.test.yaml` sets the project name `contoso-test`, so tests never touch the dev stack's containers or volumes. It builds the `test` stages of the backend and workspace images (dev dependencies and tests), gives `postgres` a tmpfs data directory with the `contoso_test` DB (`deploy/postgres/test-init/`), and adds `frontend-test` (the frontend image's `source` stage, profile `test`). A `fixtures` HTTP server (local tarballs standing in for GitHub) comes with S9.

**Database fixtures** (`backend/tests/conftest.py`, S1). Once per run, `migrated_url` drops and recreates the database `DATABASE_URL` names (it refuses a name without `_test`) and runs `alembic upgrade head`. `engine` is shared by the run; `conn` gives each test a connection inside a transaction that is rolled back afterwards, so tests don't see each other's rows. Tests that expect a violation run the statement in a savepoint (`backend/tests/dbutil.py`) and check the constraint name. `backend/tests/db/test_schema.py` checks that the migration and `tables.py` agree: autogenerate finds no diff, and the migrated catalog (columns, constraints, indexes, triggers, functions) equals a `metadata.create_all` in a scratch database.

## FakeModel

With `MODEL_BACKEND=fake`, `harness/model.py` uses an `httpx.MockTransport` that answers chat-completion requests from a **scenario** file:

```yaml
# backend/tests/scenarios/golden.yaml
agents:
  lead:
    - match: {input_contains: "<begin_task"}
      reply: {tool: "from contoso import send_to_agent\nsend_to_agent(['data'], 'Lấy số liệu căn MAS-U03832 và 20 căn cùng phân khu')"}
    - reply: {text: "Đã giao việc."}                       # Done
    - match: {input_contains: "from=\"agent:data\""}
      reply: {tool: "from contoso import send_to_user, end_task\nsend_to_user('Kết quả…', files=['files/chart.png'], final=True)\nend_task('đã trả lời')"}
  data:
    - reply: {tool: "open('files/units.csv','w').write('unit,price\\nMAS-U03832,52\\n')\nprint('ok')"}
    - reply: {tool: "from contoso import send_to_agent\nsend_to_agent(['lead'], 'Xong: files/units.csv')"}
    - reply: {text: "done"}
jev:
  - match: {message_contains: "Vì sao"}
    label: task
  - label: side_question
usage: {prompt_tokens: 1000, completion_tokens: 50, cached_tokens: 900, cost: 0.0001}
```

- **Picking a reply.** Each agent's replies are consumed in order. When a reply has a `match`, it waits until the last user or tool message satisfies it; until then (and once the script is exhausted) the agent gets an empty turn with no tool call, which ends its activation. The agent is named by the `X-Contoso-Agent` header ([03](03-agent-loop.md#model-calls)). The scenario file is `MODEL_SCENARIO` (default `backend/tests/scenarios/golden.yaml`).
- **jev and usage.** jev calls hit a separate Decisions-API-shaped route (`X-Contoso-Purpose: jev`), matched by `match` against the rendered `state` instead of a chat message; an optional per-rule `confidence:` (default `1.0`) exercises `JEV_CONFIDENCE_FLOOR`. Chat completions carry the configured `usage`; the Decisions route maps the same `prompt_tokens`/`completion_tokens`/`cost` onto `input_tokens`/`output_tokens`/`cost`.
- **Recording.** The transport records every request, so tests can check the rendered `messages`, including byte-stability of the prefix.

## Unit tests (`backend/tests/unit`)

| Area | Behaviour checked |
|---|---|
| Rendering | events → messages mapping; an earlier prefix is byte-identical after appends; the `tool` → `user` sequence; Anthropic cache breakpoints only for `anthropic/*` |
| `current_state` | lead vs non-lead lines; `task: none`; pending counts |
| Offload | threshold boundary (8,000 vs 8,001 chars); head and tail sizes; file written; batch offload skips the newest result and marks `batch_offloaded_at` |
| Context limits | soft → compaction pending; hard → batch offload; overflow → `error` + task `failed` + user system message |
| jev | typed `choice` response; confidence floor forces `side_question`; timeout / malformed response / model error → `side_question` + `fallback`; `task` inserts a queued task titled from the message text; context uses message events only (no tool output) and respects `JEV_K` |
| Queue | at most one running per user (the unique index raises); FIFO; cancel and timeout notices go to the lead and every involved agent |
| Safe point | compaction refused while involved in a running task; allowed after `end_task` |
| Routines | cron parse; next-fire in `Asia/Ho_Chi_Minh`; repeated fires collapse into one; missed fires at boot → one pending |
| Exec token | wrong agent, wrong exec, expired, after the 5 s grace → 401 |
| Final flag | `final=True` + exit 0 → idle without a model call; `final=True` + exception → loop continues |
| Folder viewer | `..`, absolute paths and escaping symlinks → 400; `.env.d` values redacted in file, tree and archive |
| Domain validation | missing `.env`, empty key, duplicate key across sets, a starter naming an unknown preset → `unavailable` with names only |
| Auth | argon2 verify; sliding expiry; other user's resource → 404; user on admin route → 403; missing `X-Contoso-Client` → 403 |
| Catalog | seed validation (unpinned ref, non-`contoso.skills` argv) disables the marketplace |

## Harness integration tests (`backend/tests/integration`)

These use a real Postgres, a real `execd` (the `workspace` service) and FakeModel scenarios:

1. **Golden flow:** user → lead (jev `task`) → `begin_task` → `send_to_agent(data)` → Data writes a file and replies → lead `send_to_user(..., files, final=True)` → `end_task`. Checks: messages, deliveries, involvement, attachment copy and sha256, task `done`, trace ids on every row.
2. **Group thread:** a user message in a group with lead, data and chart reaches all three (the lead's copy via jev); an agent reply in the group reaches the other agents and the user.
3. **Routine during a task:** a non-involved agent runs its routine while the user's task runs; an involved agent's routine waits until its current block of work ends.
4. **Compaction at a safe point:** soft limit crossed mid-task → pending; runs only after `end_task`; new epoch with `start_seq` after the compaction events; the system prompt re-reads `memory/index.md`.
5. **Restart mid-activation:** kill the runner during an exec; on boot, the `tool_result` says `lost`, a notice is delivered, and the running task stays running.
6. **Deadlock guard:** while T1 runs, Data asks the lead for help; jev's scenario says `side_question`; nothing is queued.
7. **Builder:** apply a preset (`uv add`, downloading into the shared uv cache), install a skill from the fixtures server, edit the prompt. Each makes a `user:<name>` commit and a notice; prompt edit → compaction pending.
8. **Provisioning:** creating a `fabrikam` user makes the lead plus five starters, each with `.env.d` links, a `baseline_commit` and a direct thread.

## `execd` tests (`workspace/tests`)

- Timeout kills the whole process group (a child that `sleep`s in the background is gone).
- `RLIMIT_AS` makes a large allocation fail; output over 10 MB is truncated with the marker.
- The environment contains `.env.d` keys and `env_extra`, and doesn't inherit the parent's environment.
- Snapshot: changed → a new commit with the author; unchanged → same head and `changed: []`; ignored paths only → `[]`; a stale `index.lock` → `snapshot_error`, and the exec result is still returned.
- Installer `contoso.skills`: extracts only the path, refuses `..`/absolute/symlink escapes, requires `SKILL.md` frontmatter, replaces the directory atomically.

## Live contract tests (`-m live`)

**Status:** Implemented (`make test-live`, deselected from `make test`; `backend/tests/live/`). Using the real OpenRouter key:
- One activation with `openai/gpt-4o-mini` and one with `anthropic/claude-haiku-4.5`, each ending with a `final` tool message followed by a new user message. The provider accepts the shape.
- `usage.cost` and `usage.prompt_tokens_details.cached_tokens` are present.
- jev with `JEV_MODEL` returns a schema-valid Decisions API answer: `choice in {"task", "side_question"}`, `confidence` in `[0, 1]`.

## End-to-end (Playwright, fake mode)

**Status:** Implemented (`make e2e`: a fresh fake-mode stack per run, the `fixtures` server seeded with the catalog skills' tarball, Playwright headless in `e2e/`; failures keep their screenshot, video and trace in `e2e-results/`).

1. Login as an admin → create user `alice` (fabrikam) → provisioning finishes.
2. Login as `alice` → the lead is pinned → send the golden question → the reply with its `units.csv` attachment appears (the golden scenario's file, rendered as a CSV preview); the task banner shows running, then disappears.
3. Create the group "Nhóm báo cáo Q3" with data and report → send a message → both agents' statuses change.
4. Builder: apply the "Phân tích dữ liệu" preset → toast done → the package table lists `pandas`; install the `xlsx` skill from the fixtures server → "Đã cài".
5. Folder viewer: `.env.d/warehouse.env` shows key names only (values `••••`); switching "Phiên bản" to a version from before the preset shows the old `pyproject.toml` (and the history diff).
6. Login as the admin → the trace view for alice's lead shows the Python calls and the "Mở trong Langfuse" link; the data agent's trace shows its changed `files/units.csv` with the inline diff (the harness commits inbox copies itself, so the lead's own execs change no files); mark a jev decision as mislabelled.
7. Theme toggle switches between the light and dark tokens.

## Manual live acceptance

On the real `fabrikam` warehouse with a real key: the golden question *"Vì sao căn MAS-U03832 bán chậm? So sánh với các căn tương đồng, vẽ biểu đồ và xuất báo cáo."* produces a reply with at least one chart and a report file. The trace appears in Langfuse with cost. The lead's task ends `done`.

## Frontend tests (Vitest)

**Status:** Implemented (mock) for the existing suites. The current component and integration tests (Vitest, TS/TSX, jsdom), the legacy `.test.mjs` domain suite and the Playwright journeys are kept as the API adapter lands ([14g](14g-frontend-development.md)).

**Status:** Planned. Target pure-logic tests added with the API adapter: SSE event → cache update reducers, unread counting, the schedule picker → cron conversion, the choice-lock rule, theme resolution (`system` → `prefers-color-scheme`).
