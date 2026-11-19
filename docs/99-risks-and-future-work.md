# 99 · Risks, open questions and future work

## Risks

| Risk | Effect | Mitigation in the PoC |
|---|---|---|
| **Routine starvation** | A routine never runs if its owner is never idle; the lead is the most likely case | The overview shows `routine_state.next_fire_at` in the past; routines should be short |
| **Long routines delay tasks** | A routine running when a sub-task arrives holds up the owner's part until its current block of work ends | `platform/rules.md` asks for short routines; `EXEC_TIMEOUT_S` bounds each step |
| **jev mislabels help as a task** | The request is queued behind the task that needs it: deadlock | low-confidence choices are forced to `side_question` (`JEV_CONFIDENCE_FLOOR`); the lead can `end_task` or handle it; admins mark mislabels |
| **Task size limit** | A task still over the hard limit after batch offload fails | soft-limit compaction between tasks; outputs offloaded early |
| **Message volume at the lead** | Every message to the lead costs a jev call and grows its context | `JEV_K` bounds jev input; a group without the lead avoids jev |
| **Agent chatter in groups** | Agents reply to each other's group messages and loop | silent-by-default rules; `MAX_STEPS_PER_ACTIVATION`; cost shown per agent on the overview |
| **Secrets in output** | Code that prints a credential puts it into `events` and Langfuse | only the prompt rule; `.env.d` values are redacted in the viewer and never logged by the platform |
| **Shared uid in `workspace`** | Agent code can read any folder, including other users' | network separation from the DB; the PoC is single-tenant in trust |
| **Third-party skill code** | An installed skill can contain scripts the agent runs | pinned refs, install preview with a code warning, a curated catalog |
| **Shared OpenRouter key** | One user's heavy use spends everyone's budget; 429 under bursts | retry with backoff; per-agent cost on the overview |
| **Missed snapshot** | A failed snapshot attributes changes to a later exec | `snapshot_error` shown in the trace view |
| **Single `api` process** | A crash stops every agent; no horizontal scale | all state in Postgres and folders; restart handling ([03](03-agent-loop.md#restart)) |
| **Langfuse resource use** | ClickHouse and MinIO need several GB of RAM and disk | delta inputs instead of full contexts; optional `LANGFUSE_INIT_PROJECT_RETENTION` |
| **Dashboard dataset in the browser** | The whole dataset is sent to the browser and computed there ([19](19-reports-dashboard-notifications.md#computation)); a large domain makes the dashboard slow | 20 MB cap on a dataset; the publishing agent can include only the scope the dashboard needs |
| **Two copies of the report schema rules** | `api` validation and the frontend decoder can drift, so a stored version may fail to render | the viewer shows a diagnostic instead of failing; both sides are tested against the same fixtures. `list` decodes every row at once, so a rejected version degrades to `schemaIssue` alone rather than blanking the library ([19](19-reports-dashboard-notifications.md#implementation-notes)); a rejected identity still surfaces as an error |
| **Stale dashboard** | The dataset changes only when an agent publishes it; without a refresh request or a routine the user set up, the numbers age silently | every KPI shows its `dataThrough` and source |

## Open questions

Questions from the original architecture note and where they stand:

| Question | Status |
|---|---|
| How the lead is chosen, and what happens if it fails | **Resolved:** every user has a built-in lead ([0011](decisions/0011-built-in-lead-and-user-created-agents.md)); failure is handled by restart ([03](03-agent-loop.md#restart)) |
| Are `SendToUser` and `SendToAgent` tool calls or Python functions? | **Resolved:** Python helpers in `contoso` ([11](11-sandbox.md#helper-library-contoso)) |
| Which agents receive "user opened the app"? | **Resolved:** the lead only, debounced to 30 min ([07](07-routing-and-queue.md#user-opened-the-app)) |
| Limits on the agent folder (storage, …) | **Open.** No quota in the PoC |
| How the user's and the agent's edits to the same folder interact | **Resolved for the PoC:** one job lock, every write committed with its author, last write wins |
| How long offloaded output files are kept, and who cleans them up | **Open.** Kept forever in the PoC |
| How multiple domains map onto agents and folders | **Resolved:** domain = credential sets + starters; every user has their own team ([0010](decisions/0010-per-user-agent-teams.md)) |
| How jev's accuracy is measured | **Resolved for the PoC:** `jev_decisions` + admin "mislabelled" marks; comparing policies is future work |
| Should agents be able to install skills themselves from the catalog? | **Open.** Agents can write skills but can't query the catalog |
| Should reports be shared across users of one domain? | **Open.** Reports are owned by one user in the PoC ([19](19-reports-dashboard-notifications.md#principles)) |
| Should `api` compute the dashboard instead of the browser? | **Open.** Browser-side for now, so the rules stay in one tested place |

## PoC shortcuts and future work

| Area | PoC | Future |
|---|---|---|
| Exec isolation | one container, one uid, `cwd` only | bubblewrap or a container per call, a uid per user, read-only bind of only that folder |
| `.env` protection | prompt rule; read-only mount stops edits | inject secrets through a broker or proxy so agent code never sees raw values; redact outputs |
| Egress | open | per-domain allow-list (warehouse host, GitHub, PyPI) |
| LLM spend | shared key, no cap | per-user budgets, an `MAX_CONCURRENT_LLM` cap, alerts |
| BYOK | none | per-user provider keys (OpenAI, Anthropic, OpenRouter) with a jev fallback |
| Scale | one `api` process | split `harness` workers from `api` (Postgres `LISTEN/NOTIFY`, session leases) |
| Template upgrades | starters copied once | three-way merge of starter changes into existing folders using `baseline_commit` |
| Folder history | one commit per changed exec | squash at compaction; size quota |
| Offloaded outputs | kept forever | delete outputs older than the previous epoch |
| Auth | username + password, cookie sessions | SSO (OIDC) shared with Langfuse, per-domain admins, audit log |
| Domain change for a user | refused | rebuild the team with a migration of memory |
| Observability | `docker compose logs` | log aggregation; Langfuse scores from jev mislabels; dashboards |
| UI | Vietnamese and English; no voice, push or search | message search, push notifications, voice, editing files in the viewer |
| Mock-only frontend | every page runs on mock services; the chat differs from the target UX ([14](14-frontend.md#current-implementation-vs-target)) | API adapters for every port, then the target chat, builder and admin screens |
| Delivery surfaces | web only | email, Zalo OA, Slack through the same `send_to_user` |
