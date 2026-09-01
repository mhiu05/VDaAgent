# Chat Agent P2 implementation report

Date: 2026-09-01

P2 adds durable continuity and constrained learning signals to the existing
evidence-first P0/P1 chat contract. It does not change the authority of the
numeric/evidence validator, expand tool permissions, or expose data directly
through Supabase's browser-facing Data API.

## Product behavior

### UX-07 — Durable conversation history

Status: DONE

- The Chat page has a server-backed recent-conversation sidebar with New chat,
  archive, and delete actions. Conversation titles begin as `New chat` and are
  deterministically replaced by the first user question unless a user has
  explicitly renamed the conversation through the API.
- `POST/GET /conversations`, `GET/PATCH/DELETE /conversations/{id}`, and
  `POST /conversations/{id}/archive` are permission-protected and always take
  the workspace from the authenticated request context. Pagination is bounded
  to 100 messages/conversations per call.
- Each new turn stores only the new user/agent messages, their public answer
  envelope, linkage (`parent_message_id`, retry/regeneration), and the
  request-time context snapshot. A completed agent message cannot be modified
  later, so old answers never inherit a new Profile Run selection.
- Legacy browser history remains local. It becomes a server conversation only
  when the analyst actively sends a new turn; historical local messages are
  never bulk-uploaded. The floating widget remains lightweight and follows
  this same active-turn migration rule.
- Delete is a soft delete. `Repository.purge_expired_deleted_conversations`
  is a bounded backend-maintenance primitive for records already deleted for
  `qa_conversation_retention_days` (30 days by default). It is not called from
  a browser request.

### UX-08 — Contextual suggested questions

Status: DONE

- `GET /profile/{profile_run_id}/chat-suggestions` returns 2–4 deterministic
  Profile Run suggestions when safe signals exist. The Chat page and widget
  display them only after a completed, review-ready run is selected.
- Suggestions are derived from aggregate column metadata only: high missingness,
  numeric distribution/outliers, and candidate-key proposals. Confirmed PII
  columns, unknown columns, pending profiles, and pending review states are
  rejected. Suggestions are typed `ask_question` actions; no model-generated
  markup or autonomous action is accepted.

### ACC-05 — Feedback and evaluation candidates

Status: DONE

- Helpful/not-helpful feedback is idempotent per workspace, actor, and message.
  The UI offers optional bounded reason codes; the API validates the same
  allow-list.
- Feedback persists the agent-run binding and safe analytics dimensions
  (intent, execution path, evidence status, detail, model, latency bucket),
  not raw prompt, answer, rows, traces, or PII. `GET /qa/feedback/analytics`
  returns workspace-scoped aggregate counts.
- A not-helpful record creates one `evaluation_candidates` row with a
  structured, review-only case specification. It is a human-curated candidate,
  never an automatic production-data training label.

## Persistence and security

Migration `20260831_0024_chat_agent_p2.py` adds:

- `conversations` and `conversation_messages` for tenant-scoped durable
  history;
- `conversation_feedback` and `evaluation_candidates` for bounded learning
  signals; and
- `qa_answer_cache` for verified deterministic cache payloads.

All five tables have workspace indexes where appropriate and Row Level
Security enabled with no browser policies. They are added to the established
Data API boundary inventory, so `anon` and `authenticated` retain no direct
table grants. The backend remains the sole database access path.

The stored conversation projection contains the user-visible question/answer
text, but intentionally excludes raw rows, system/developer prompts, provider
traces, credentials, and hidden evidence objects. Context snapshots hold
public-safe Dataset/Profile Run identity, scope, timestamp, review state, and
version bindings. `answer_envelope` retains the already user-visible
evidence/provenance projection only.

## LAT-05 — Freshness-safe semantic cache

Status: DONE

The cache is a finite intent-equivalence cache, not an embedding-similarity
cache. Only completed Profile Runs and deterministic `dataset_overview`,
`row_count`, `column_count`, and `duplicate_rows` requests are eligible. It
does not cache a request with chat history, analysis execution, non-deterministic
tool/model routing, pending review, or unverified evidence.

Its key includes the workspace, Profile Run identity/version/source hash,
scan mode/row count, context version, intent, detail level, fast-path version,
and evidence-validator version. Entries expire after 900 seconds by default
and are capped at 200 per workspace. A hit re-executes the bounded aggregate
tool and runs current evidence validation before return; an answer mismatch,
version/dimension mismatch, stale entry, failed validation, or unavailable
source is a cache miss. Therefore a cache hit cannot bypass freshness or
evidence gates.

Cache telemetry uses `exact_hit`, `semantic_hit`, `miss`, `rejected_hit`, and
store/lookup-failure statuses. Local unit coverage proves distinct tenant
dimensions and a semantic wording hit, but production hit rate and p95 impact
remain a staging release measurement rather than a claimed result here.

## ACC-06 — Conditional independent verification

Status: DONE (shadow rollout)

High-risk public projections receive a separate deterministic pass when their
risk score reaches `qa_verifier_risk_threshold` (default 3). The score covers
quantitative claims, mixed/external evidence, sample scope, model synthesis,
deep presentation, and clarification context. The verifier checks
workspace/Profile Run source bindings and requires public citation linkage for
numeric output. Its check is bounded local metadata/string validation and
records an observed budget breach as `timed_out` rather than a pass.

Default `agent_verifier_mode=shadow` records only hash-bound verifier results
in `verification_runs`; it does not rewrite a separately validated answer.
`enforce` remains configuration-blocked until a reviewed fail-closed product
experience is released. This makes the current failure behavior explicit:
failures are observable and retain the original validator's safe evidence
boundary, rather than silently inventing a replacement answer.

## Architecture

```text
Chat page / widget
  -> active turn + immutable public-safe context
  -> server conversation (workspace predicate on every read/write)
  -> P1 idempotent agent run
       -> eligible deterministic request -> revalidated semantic cache
       -> otherwise graph/tool path -> existing evidence validator
  -> conditional P2 verifier (shadow ledger)
  -> immutable answer envelope + durable assistant message
  -> deterministic suggestions and optional feedback candidate
```

`chat_stream.v1` remains the stream contract. Additive `message_id`,
`verification`, and `suggestions` fields are carried in `meta`, `suggestions`,
and `done` frames, including completed idempotent replays. Existing clients
can continue to use `answer`, sources, and prior stream events.

## Local verification

The following focused checks passed on this working tree:

- `python -m ruff check` for the changed P2 backend/migration modules.
- `python -m py_compile` for the changed P2 backend modules.
- P2 persistence/cache/verifier/suggestion tests, Data API inventory tests,
  P1 stream-contract/answer/validation/fast-path regressions: **29 passed**.
- `python scripts/migration_smoke.py`: passed against an isolated PostgreSQL
  database for both a fresh install and the pre-P2 upgrade route. This includes
  the direct-browser-grant/RLS security assertion and `alembic check`.

The remaining release evidence is intentionally not fabricated: measure cache
hit rate/TTFVA/p95 in an authorized staging workload and run a curated
synthetic evaluation with feedback candidates reviewed by humans.
