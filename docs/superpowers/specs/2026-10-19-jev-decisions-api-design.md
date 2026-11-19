# jev classifies via OpenRouter's Decisions API instead of a chat LLM

**Status:** Approved for implementation planning. **Depends on:** [07](../../07-routing-and-queue.md#jev), [03](../../03-agent-loop.md#model-calls), [decisions 0002](../../decisions/0002-jev-reads-the-receivers-view.md), [0008](../../decisions/0008-platform-openrouter-key-no-byok.md), [0019](../../decisions/0019-retry-instead-of-llm-concurrency-cap.md).

## Problem

The `jev` classifier (doc 07) is named after TypeSafe AI's "Jev" model — a non-generative "System One" decision model that returns typed, probability-scored answers instead of free text ([arXiv:2609.26550](https://arxiv.org/abs/2609.26550)) — but today it's implemented as a regular chat-completion call to an LLM (`JEV_MODEL`, default `anthropic/claude-haiku-4.5`) with a free-text system prompt (`platform/jev.md`) asking for `{"label", "description"}` JSON. This design replaces that call with the real Jev model, reached through OpenRouter's Decisions API (`POST https://openrouter.ai/api/alpha/decisions`) using the **same `OPENROUTER_API_KEY`** already in `.env` — no new credential, no new provider account.

## Constraint: Jev cannot write text

Jev's typed answers (`choice`, `noul`, `score`) never include generated prose. Today's `description` output becomes `global_tasks.description` — the task's display title in the admin overview and the lead's queue (`"T4 · Phân tích doanh số tháng 9"`). This can't survive unchanged.

**Decision (confirmed with the user): pure replacement.** `description` is dropped end-to-end (DB column, API field, frontend type) — nothing produces it after this change, and it was confirmed dead in the UI already (`AdminPage.tsx`'s jev badge only ever rendered `label`/`fallback`). Task titles fall back to the raw message text, truncated to 500 chars — an existing fallback path, now the only path.

## Decision: keep the "when unsure, side_question" safety property via confidence

`platform/jev.md` currently instructs: *"When unsure, choose `side_question`"* — the documented mitigation for the one named risk in [99-risks-and-future-work.md](../../99-risks-and-future-work.md): *"jev mislabels help as a task" → the request queues behind the task that needs it (deadlock)*. Dropping this silently would regress a documented safety property for zero savings (it's the same single call either way).

Jev's `choice` answers include a calibrated `confidence` (0–1) for free. New setting `JEV_CONFIDENCE_FLOOR` (default `0.6`): when the Decisions API's `confidence` is below the floor, the stored `label` is forced to `side_question` regardless of which option Jev actually preferred. This is visible in the data as a `side_question` row with a low `confidence` value — no separate flag needed.

## Request/response shape

```
POST https://openrouter.ai/api/alpha/decisions
Authorization: Bearer $OPENROUTER_API_KEY
X-Contoso-Agent: <lead slug>   X-Contoso-Purpose: jev

{
  "model": "typesafe/jev-1.13",
  "state": "<current_state>...<summary>...<recent_messages>...<message>...",
  "questions": {
    "route": {
      "type": "choice",
      "instructions": "Is this new, independent work for the lead's queue, or something else?",
      "criteria": {
        "task": "<platform/jev_criteria.yaml: task>",
        "side_question": "<platform/jev_criteria.yaml: side_question>"
      }
    }
  }
}
```

Response: `{model, answers: {route: {type: "choice", choice, probabilities, confidence}}, usage: {input_tokens, output_tokens, cost}}`.

`state` is `build_jev_context()`'s existing rendering (`<current_state>`, `<summary>`, `<recent_messages>`, the new `<message>`), sent as the `state` field directly instead of wrapped in a chat `"user"` message. `JEV_K`-bounded context, message-events-only — unchanged.

**Model id:** pin to `"typesafe/jev-1.13"` (confirmed working against the Decisions API). Verify `typesafe/jev-latest` / `-1.14` against the live stack during implementation and use whichever is current if it resolves cleanly; `-1.13` is the documented fallback either way.

## Components touched

### `backend/harness/model.py`

- New `ModelClient.decide(model, state, questions, *, agent, purpose="jev") -> DecisionResponse` (new small dataclass: `answers: dict`, `usage: dict`, `raw: dict`). Posts to the Decisions API path (derived from the OpenRouter host, not appended to `OPENROUTER_BASE_URL` — the Decisions API lives at `/api/alpha/decisions`, not under `/api/v1`).
- The Decisions API takes **no sampling parameters** (no `temperature`, `max_tokens`, `response_format` — nothing to tune; it's deterministic/typed, not sampled text).
- `complete()` is untouched — `AGENT_MODEL`/`COMPACTION_MODEL` keep using it.
- The retry/backoff loop (3 attempts, 2/4/8s + jitter, honouring `Retry-After`, [decision 0019](../../decisions/0019-retry-instead-of-llm-concurrency-cap.md)) is factored into a shared helper both `complete()` and `decide()` call, rather than duplicated.
- `build_model_client`'s FakeModel wiring (`MODEL_BACKEND=fake`) extends to route the Decisions path too (see Testing below).

### `backend/harness/jev.py`

- `build_jev_context` is unchanged (still produces the rendered context string); it's now sent as `state` instead of wrapped as a chat message.
- `_prompt()` / `parse_label()` (markdown-fence unwrapping, free-text JSON parsing) are deleted — nothing to unwrap or parse as loose JSON; the response is already typed.
- `_classify()`: call `h.model.decide(h.settings.JEV_MODEL, state, QUESTIONS, agent=lead.slug, purpose="jev")` instead of `h.model.complete(...)`. On success: `choice, confidence = answers["route"]["choice"], answers["route"]["confidence"]`; `label = choice if confidence >= h.settings.JEV_CONFIDENCE_FLOOR else "side_question"`. On `TimeoutError`/`ModelError`/malformed response (missing `answers.route`, unexpected `choice` value): `label, confidence, fallback = "side_question", None, True` — same catch-all policy as today, new failure source.
- Same dedicated jev timeout (`self.timeout_s`, currently 10s — generous against Jev's ~0.15s median latency, no change needed).
- `jev_decisions.insert()` values: `description` removed, `confidence=confidence` added.
- Task title production: `description or (message.text)[:500]` → `(message.text)[:500]` unconditionally.
- `h.tracer.jev(...)` call: `confidence=confidence` added; `usage` extraction changes from `prompt_tokens`/`completion_tokens` to `input_tokens`/`output_tokens` (Decisions API field names); `cost=usage.get("cost", 0)` unchanged (field name matches).

### `backend/db/tables.py` + new migration

`backend/alembic/versions/0003_jev_decisions_confidence.py`:
- `op.drop_column("jev_decisions", "description")`
- `op.add_column("jev_decisions", sa.Column("confidence", sa.Float(), nullable=True))`

`tables.py`: `Column("description", Text, nullable=False)` → removed; `Column("confidence", Float, nullable=True)` added. `backend/tests/db/test_schema.py`'s schema-comparison test picks this up automatically (it diffs `tables.py` metadata against the migrated schema).

### `platform/jev.md` → `platform/jev_criteria.yaml`

No longer an LLM system prompt. Two strings, still operator-editable without touching code:
```yaml
task: "New, independent work that deserves its own place in the queue: a new analysis, report, comparison or piece of work that doesn't depend on the running task."
side_question: "Help, data or results for the current task; status questions; answers to a question the lead asked; thanks, greetings, small talk; corrections or additions to the running task."
```
Read per call (consistent with how other per-call settings like `JEV_K` are read; the file is tiny, no caching layer needed).

### `backend/settings.py`

- `JEV_MODEL: str = "typesafe/jev-1.13"` (was `"anthropic/claude-haiku-4.5"`).
- `JEV_CONFIDENCE_FLOOR: float = 0.6` (new).
- No new entry in `preflight.REQUIRED_KEYS` / `OPERATOR_KEYS` — still gated by the existing `OPENROUTER_API_KEY` check (`MODEL_BACKEND == "openrouter"`).
- `.env.example`: line 14's comment (`# default anthropic/claude-haiku-4.5`, above `JEV_MODEL=`) updates to the new default; a new `JEV_CONFIDENCE_FLOOR=0.6` line joins the other inline-valued tunables (`TASK_MAX_S=3600`, `JEV_K=20`, …) rather than the comment-only style used for operator/model keys.

### API / frontend

- `backend/api/admin.py`: the `jev` list in `GET /agents/{id}/events` drops `description` from the returned dict.
- `frontend/src/features/admin/services/admin-service.ts`: `JevDecision` drops `description`.
- `frontend/src/adapters/api/admin-console.ts`: drop `description` from the decoded shape.
- `doc 15-api.md`'s `jev: [...]` field list drops `description`.
- `confidence` is **not** added to the API/UI in this change — it's DB- and Langfuse-only. A trace-view badge for it is a reasonable follow-up, not required by anything decided here (noted under Out of scope).

### `backend/observability/tracing.py`

`Tracer.jev(...)` / `LangfuseTracer.jev(...)` gain `confidence: float | None = None`, added to the `metadata` dict alongside `label`/`fallback`/`latency_ms`. `usage_details` extraction keys change to match the Decisions API's `usage.input_tokens`/`usage.output_tokens`.

## Testing

- **`backend/tests/harness/test_model.py`**: new unit tests for `ModelClient.decide()` — request shape (`state`, `questions`, model id, headers), response parsing, retry-on-429/5xx reusing the shared backoff helper, error mapping. Remove the old jev-specific chat-completion assertions (`temperature`, `max_tokens`, `response_format`) — nothing to tune anymore.
- **`backend/harness/fake_model.py` / `test_fake_model.py`**: `FakeModelTransport` gains a Decisions-path route. Scenario YAML's `jev:` section keeps its authoring shape (`match: {message_contains: ...}, label: task`, matched against `state` now instead of the chat `<message>` block) — the transport synthesizes a Decisions-API-shaped reply. Optional per-rule `confidence:` (default `1.0`) lets scenarios exercise the floor without touching every existing fixture.
- **`backend/tests/harness/test_jev.py`**: rewrite request-shape assertions for the new body (`questions.route.criteria` instead of `temperature`/`max_tokens`); add a confidence-floor test (low-confidence `task` choice → stored `label == "side_question"`, `fallback == False`); update the malformed-response and unknown-label fallback tests for the new error surface.
- **`backend/tests/harness/test_tracing.py::test_jev_is_a_generation_in_the_posters_trace`**: new usage field names; assert `confidence` lands in `metadata`.
- **`backend/tests/live/test_model_contract.py::test_jev_model_returns_schema_valid_json`**: rewritten to call `decide()` against the real Decisions API (`make test-live`, opt-in, needs `OPENROUTER_API_KEY`) — asserts `choice in {"task", "side_question"}` and `0 <= confidence <= 1`.
- **Manual verification (this implementation):** run the live test and a real end-to-end message against the already-running remote-docker-host stack; confirm `jev_decisions.confidence` is populated, routing to `task`/`side_question` still works, and the admin "Gắn nhãn sai" mark still functions against the new rows.

## Docs to update (EN + `docs/vi` mirror)

`02-architecture.md` (model table), `03-agent-loop.md` (model calls section — Decisions API alongside chat completions, no sampling params for jev), `07-routing-and-queue.md` (jev section rewritten: Choice primitive, confidence floor, no description, `platform/jev_criteria.yaml`), `10-data-model.md` (`jev_decisions` schema: drop `description`, add `confidence`), `13-observability.md` (cost/usage field names), `16-configuration-and-deployment.md` (`JEV_MODEL` default, new `JEV_CONFIDENCE_FLOOR`, repository layout entry for `platform/jev_criteria.yaml`), `17-testing.md` (FakeModel jev scripting, live contract test), `99-risks-and-future-work.md` (replace the prompt-default mitigation text with the confidence-floor mechanism), `01-glossary.md` (jev definition can name TypeSafe/Jev specifically).

New ADR: **`docs/decisions/0023-jev-classifies-via-openrouter-decisions-api.md`** (next available number after 0022) — records that jev's call mechanism changed from chat completions to the Decisions API while [0002](../../decisions/0002-jev-reads-the-receivers-view.md) (context-building policy) and [0008](../../decisions/0008-platform-openrouter-key-no-byok.md) (one OpenRouter key) both still hold unchanged.

## Out of scope (YAGNI)

- **No cascade/escalation to an LLM.** Confirmed with the user: pure replacement, not a confidence-gated escalation back to a reasoning judge. If accuracy on ambiguous cases becomes a real problem later, that's a separate, explicitly-scoped change.
- **No `confidence` in the admin API/UI.** DB + Langfuse only. A trace-view badge is a reasonable follow-up if wanted.
- **No raw `probabilities`/`choice` capture alongside the (possibly floor-overridden) `label`.** `confidence` alone is enough to tell a floor-override apart from a genuine high-confidence `side_question` in the data; capturing the full distribution is more schema than this change needs.
- **No change to `AGENT_MODEL`/`COMPACTION_MODEL`.** They keep using chat completions; only `JEV_MODEL`'s call mechanism changes.

## Risks

| Risk | Mitigation |
|---|---|
| Exact OpenRouter model id (`typesafe/jev-1.13` vs `-latest`/`-1.14`) drifts | Verified against the live stack during implementation; `-1.13` is the documented-working fallback |
| `JEV_CONFIDENCE_FLOOR=0.6` is an unvalidated guess, not empirically tuned (the underlying paper's own recommendation) | Acceptable for a PoC; a tunable setting, not hardcoded — adjustable without a code change once real traffic shows a better value |
| Existing `jev_decisions.description` history (real Vietnamese text) is lost on migration | Acceptable: it's a decision log, not an audit trail requiring forever-retention; `observed` marks (the accuracy-measurement mechanism) are untouched by the migration |
