# Group Chat POC Implementation Plan

Planned against `main` at **`5c41bf9`** ("fix(frontend): align frontend improvement with current UX
contracts"). Every source claim below was re-verified against that HEAD (revision 2 re-audited the
event flow, message routing, finalization and auth dependencies). Where this plan and the earlier
feasibility audit disagree, this plan wins; the audit's `role='group'` idea is **rejected**.

**Revision 2 changes (summary):** internal agent traffic never reaches human SSE (separate
server-side group channel); human↔human messages never wake the Lead (explicit `target="lead"`);
AI requests are rejected (409) while the group team is not active; a removed member's already-open
stream stops server-side (per-event membership check); one human-session boundary in
`deps.current_user`; group access is always "current member + room-scoped resource", never a broad
owner shortcut; cross-domain membership policy fixed; prompt wording distinguishes policy from
enforcement; open decisions closed.

---

## 1. Objective

Prove, with POC quality, that admin-created human users can share a **group room** with its **own,
separately provisioned six-agent team**, while every user keeps their personal team as today:

1. Alice and Bob (`role='user'`, created by an admin) log in normally.
2. Alice creates "Sales Team"; the group's six agents are provisioned by the **existing** pipeline.
3. Alice adds Bob (an existing user). Nothing is provisioned for Bob.
4. Alice ↔ Bob chat in the room in realtime — **no agent is woken**.
5. An explicit **"Hỏi AI"** message reaches only the **Group Lead**, which may delegate to Group
   Data / Insight / Compare / Chart / Report and posts the final answer into the same room; both
   humans see it. Internal agent traffic never reaches humans.
6. Personal teams, threads, files, tasks and memory stay private; Landlock stays unchanged.

## 2. Hard Authentication Constraints

| Rule | How this plan keeps it |
|---|---|
| Business roles stay `admin` \| `user` | `USER_ROLE = ("user", "admin")` (`backend/db/tables.py:86`) **unchanged**. No `group`, `guest`, `owner`, `member` roles. |
| Only an admin creates human accounts | `POST /api/admin/users` → `accounts.create_user()` (`backend/accounts.py:72`) unchanged. |
| Only authenticated humans use the system | Every human-facing dependency derives from `deps.current_user()`, which (new) rejects any non-human principal (§8 G4). Group routes use `UserRole`. |
| Group access = authenticated human **and** current member | `groups.require_member()` + `messaging.threads.member_thread()` re-check `group_members` on every request (§15). |
| No public signup / guest / invite link / anonymous / external identity / temporary user | None added. The member picker lists only existing active humans (§10). |
| A technical owner can never log in or act as a human | `account_type` guards at login, session issue, session resolve **and** the dependency root (§8) — not only an unusable hash. |

## 3. Non-Goals

Not in this POC: owner/admin/member roles, invitations, ownership transfer, public groups, guests,
audit log, organizations, `@mentions`, Telegram groups, group report pages/dashboard, group files
beyond message attachments, notification preferences, presence, group deletion/archival,
horizontal realtime scaling, task-concurrency redesign, group agent folder viewer/reset/builder.

**POC permission model:** `authenticated human AND current row in group_members` ⇒ allowed, else
404. Any member may add/remove members and cancel the group task — **temporary POC behaviour**.

## 4. Current Source Architecture

Ownership is a single **owner account id** (`users.id`) carried everywhere.

| Concern | Current implementation (HEAD `5c41bf9`) |
|---|---|
| Users | `users` (`tables.py:131`): `username` unique (`^[a-z0-9._-]{3,32}$`), `password_hash` NOT NULL, `role ∈ USER_ROLE`, `status ∈ USER_STATUS` (provisioning/active/failed/disabled), `domain_id`, CHECK `admin_has_no_domain`. |
| Login | `backend/api/auth.py: login()` → `user_query()` by username → `passwords.verify_password()` (False on invalid hash) → rejects `disabled` → `sessions.create_session()`. |
| Session | `backend/auth/sessions.py: create_session()` (`:64`), `resolve_session()` (rejects missing/`disabled`, `:100`). |
| Dependencies | `backend/api/deps.py`: `current_user()` → `AnyUser`; `require_user()` checks **only** `role == "user"` → `UserRole`; `require_domain_available()` → `AvailableUser` (caller's own `domain_status`); `require_admin()` → `Admin`. **All four derive from `current_user`.** Internal exec routes use a different principal: `backend/api/internal.py: exec_caller()` → `Caller = ExecContext` (`:25,41`) — the runtime never uses `current_user`. |
| Principal | `backend/auth/principal.py: user_query()`, `CurrentUser.from_row()` (only constructor), `me()`. |
| Accounts | `backend/accounts.py`: `create_user()`, `get_user()`/`list_users()` (filter `role == "user"`), `set_disabled()`. |
| Jobs | `backend/agents/jobs.py`: `enqueue()` (`:58`), serial `JobWorker`, `_lock_for()` (`:197`), `fail_stale()` (`:116`). |
| Provisioning | `backend/agents/provisioning.py: user_provision()` (lead + starters via `folders.create_agent()`, then `status='active'`), `progress()`. Retry: `api/admin_users.py: retry_provisioning()`. |
| Agents | `agents` (`tables.py:162`): `user_id` FK, `UNIQUE(user_id, slug)`, `uq_agents_one_lead_per_user`. `folders.create_agent()` creates folder, git, `uv`, row, `open_epoch()`, and a **direct thread whose user member is the owner**. `folder_path()` = `FOLDERS_DIR/<user_id>/<slug>`. |
| Runtime | `supervisor.eligible()` (`:32`, owner `status='active'` + domain available); `runner` builds `ExecContext(user_id=agent.user_id)`. |
| Message routing | `messages.post_message()` (`:69`): `receivers` = **every agent member of the thread** except an agent sender (`:101-105`); lead ⇒ `route="jev"`, others ⇒ `pending` + wake; publishes `message.created` to `thread.user_id` (`:128`). |
| Visibility / finalization | `items.pending_deliveries_work()` (`:180`): a `user` sender sets `default_thread`, `user_visible=True`; `response_required` only for `kind == "direct"` (`:251-254`). `queue.task_source()` task work: `default_thread` = source message's thread, `user_visible=response_required=requires_tools=True` (`queue.py:84-107`). `runner` (`:413-437`): visible response already sent ⇒ done; else plain text ⇒ `_finalize_text()` into `default_thread`; else `response_required` ⇒ terminal failure + `PROTOCOL_FAILURE_TEXT` system message (`:542-548`). |
| Agent → user | `internal.send_to_user` (`:116`) → `_thread_with_caller()` (`:86`): `resolve_thread(caller.user_id, ref)` **and caller must be an agent member of the thread**; rejects `kind == "agent"`. |
| Agent → agent | `internal.send_to_agent`: receivers `agents.user_id == caller.user_id`; `agent_thread(conn, caller.user_id, …)` (`threads.py:146`). |
| Threads | `threads(user_id owner, kind ∈ direct/group/agent)`, `thread_members(member_type user|agent)`, `messages(sender_type, sender_id)`. |
| Thread auth | `threads.user_thread()` (`:86`) = owner == caller **and** caller is a user member; used by `list_messages`, `post_user_message`, `mark_read` **and** `patch_group`. `list_threads()` same predicate. `create_group()`/`patch_group()` manage personal agent groups via `users_agents(conn, user.id, …)`. |
| Attachments | `api/threads.get_attachment()` (`:218`): admin or `threads.user_id == user.id`. |
| Realtime | `backend/harness/bus.py: EventBus` — `_users[key]` sets of queues; `publish(key, type, data)` puts `{"type","data"}`. `backend/api/stream.py: sse_events(bus, key, …)` subscribes **one** key; `frame()` serialises only `type` and `data`; `stream()` passes `user.id`. Single in-process bus. |
| Tasks API | `api/tasks.py`: `list_tasks` (`:28`) / `cancel` (`:40`) gate `user_id == user.id`. `global_tasks` has `user_id` + `source_message_id` (no thread column). |
| Workspace | `workspace/execd/landlock.py: rules()`: an exec reaches only its own agent folder (rw), uv cache, `/tmp`, `/dev/shm`, `/dev`, read-only system trees. Not the folders root, not `/domains`. |
| Frontend | `AgentChatMessages.tsx:113` `const user = message.sender.type === "user"` (every human = "mine"); `agent-chat-state.ts:87 taskBanner(tasks)` unscoped; `Composer.tsx` `onSend(body, files)`; `OutgoingMessage {text, files, choiceId?, replyTo?}` (`agent-chat-service.ts:80`); `realtime.ts` `restart()` + stale-source suppression (`source === opened`). |

### 4.1 Event audience audit (current source)

| Event | Publisher (file:line) | Bus key | Personal human today | Group human (if subscribed to service key) | Internal agent content? | Should group human receive? |
|---|---|---|---|---|---|---|
| `message.created` (room, kind group) | `messages.py:128`, `system.py:32` | `thread.user_id` | own threads | yes | no | **YES** |
| `message.created` (kind agent, Lead↔worker) | `messages.py:128` | `thread.user_id` = service | own agent threads (doc 08 shows them to admins only; user UI ignores) | **would leak** | **yes** | **NO** |
| `message.created` (service-owned direct threads of group agents) | `messages.py:128`, `system.py:32` | service | — | **would leak** | yes (protocol failures, routine output) | **NO** |
| `agent.status` | `runtime.py:131` | `agent.user_id` | own agents | yes | `{agent_id, slug, status, status_detail}`; `status_detail` = routine name or null (`routines.py:214`) | **YES** (group UI shows the 6 agents' busy/idle) |
| `task.updated` | `queue.py:53` | `task.user_id` | own tasks | yes | description/outcome of a group task | **YES** (with `group_id`) |
| `thread.updated` | `api/threads.py:52` | caller `user.id` (personal create/patch only) | own | not emitted for rooms | no | n/a (rooms are never patched) |
| `builder.job` | `jobs.py:195` | `job.user_id` = service during provisioning | own | **would leak** | job internals | **NO** (provisioning shown via polling) |
| `report.updated` | `reports/service.py:133` | report owner | own | **would leak** | report internals | **NO** (group reports deferred) |
| `notification.created` / `.read` | `notifications.py:175`, `api/inbox.py:89` | user | own | **would leak** (e.g. `task_failed` for service) | yes | **NO** |
| `event.appended`, admin `agent.status` | `runtime.py:113,132` `publish_agent` | agent id | admin trace only | no | yes | **NO** (unchanged) |
| `groups.changed` (new) | `groups.py` | affected human's own key | — | — | no | **YES** (own key) |

Conclusion: subscribing humans to the **service owner key** (revision 1) would leak 5 kinds of
internal events. Revision 2 never subscribes humans to it (§16).

## 5. Human User vs Technical Group Owner

| | HUMAN USER | ADMIN | GROUP TECHNICAL OWNER |
|---|---|---|---|
| Created by | admin (`POST /api/admin/users`) | boot (`accounts.ensure_admin`) | `groups.create_group()` only |
| `users.role` | `user` | `admin` | `user` *(storage necessity, see below)* |
| `users.account_type` (**new**) | `human` | `human` | `service` |
| Login / session / any human dependency | yes | yes | **never** (G1–G4, §8) |
| In admin user list / member picker / domain notifications | yes | no | **never** (`account_type='human'` filters) |
| Owns | personal team, threads, tasks, reports | — | exactly the group's 6 agents, room, internal threads, tasks, jobs, folders |
| In `group_members` | can be | no | **never** (`add_member` accepts only humans; test B-9) |

**Chosen design: `users.account_type ∈ {human, service}`** (kept from revision 1).

- `role='group'` — forbidden; overloads business authorization.
- A `login_enabled` boolean — would still list the row as a human everywhere `role == "user"` is
  the filter (`accounts.list_users`, `domains/validate.py:288`); a named discriminator is safer.
- A separate principals table — impossible without rewriting every `user_id` FK
  (`agents`, `threads`, `global_tasks`, `jobs`, `reports`, `datasets`, `auth_sessions`,
  `user_preferences` → `users.id`).

**Why `role='user'` on the service row:** `role` is NOT NULL and CHECK-constrained to
`admin|user`; `CHECK (role='admin') = (domain_id IS NULL)` requires a non-admin for a row with a
domain. The value is storage only: a service row can never be a request principal (G1–G4).

Service row values: `username = "svc." + secrets.token_hex(8)` (matches `USERNAME_RE`, 20 chars),
`password_hash = "!service-account-no-login"`, `display_name = <group name>`,
`domain_id = <creator's domain>`, `status = provisioning|active|failed`.

## 6. Proposed POC Architecture

```
ALICE/BOB (human session)
  │ POST /api/threads/{room}/messages   target="group" (default)  → stored, 0 deliveries
  │ POST /api/threads/{room}/messages   target="lead"             → stored, exactly 1 Lead delivery
  ▼
GROUP ROOM  threads(kind='group', user_id=<svc owner>)   members: humans + Group Lead
  │ post_message(deliver_to=set() | {lead})
  ▼
GROUP LEAD (agents.user_id=<svc>) ── JEV → task (global_tasks.user_id=<svc>) | side question
  │ send_to_agent → receivers WHERE agents.user_id = caller.user_id   (group workers only)
  ▼
GROUP WORKERS ── kind='agent' threads (owner svc, no human member) ── back to Lead
  ▼
GROUP LEAD ── send_to_user / _finalize_text → default_thread = "group:<room>"
  ▼
EventBus:  owner key <svc>         → nobody human subscribed (internal stays internal)
           group channel <svc>     → room message.created / agent.status / task.updated
                                     → each subscribed human stream, membership re-checked per event
```

## 7. Database Changes

**Migration:** `backend/alembic/versions/0006_group_chat.py`, `revision = "0006"`,
`down_revision = "0005"` (head is `0005_telegram_links.py`). Additive only.

```python
def upgrade() -> None:
    op.add_column("users", sa.Column("account_type", sa.Text(), nullable=False,
                                     server_default=sa.text("'human'")))
    op.create_check_constraint(op.f("ck_users_account_type"), "users",
                               "account_type IN ('human', 'service')")
    op.create_check_constraint(op.f("ck_users_service_is_not_admin"), "users",
                               "account_type = 'human' OR role = 'user'")
    op.create_table(
        "groups",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("technical_owner_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("created_by_user_id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["technical_owner_id"], ["users.id"], name=op.f("fk_groups_technical_owner_id")),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], name=op.f("fk_groups_created_by_user_id")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_groups")),
        sa.UniqueConstraint("technical_owner_id", name=op.f("uq_groups_technical_owner_id")),
        sa.CheckConstraint("char_length(name) BETWEEN 1 AND 100", name=op.f("ck_groups_name")),
    )
    op.create_table(
        "group_members",
        sa.Column("group_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["group_id"], ["groups.id"], ondelete="CASCADE", name=op.f("fk_group_members_group_id")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE", name=op.f("fk_group_members_user_id")),
        sa.PrimaryKeyConstraint("group_id", "user_id", name=op.f("pk_group_members")),
    )
    op.create_index(op.f("ix_group_members_user_id"), "group_members", ["user_id"])

def downgrade() -> None:
    op.drop_index(op.f("ix_group_members_user_id"), table_name="group_members")
    op.drop_table("group_members")
    op.drop_table("groups")
    op.drop_constraint(op.f("ck_users_service_is_not_admin"), "users", type_="check")
    op.drop_constraint(op.f("ck_users_account_type"), "users", type_="check")
    op.drop_column("users", "account_type")
```

- No member role column, no `groups.status` (group status = service row `users.status`, already used
  by `eligible()`, `fail_stale()`, `progress()`, retry), no `groups.domain_id` (service row's
  `domain_id`). No column on `messages` — the AI target is stored in `messages.content` JSON (§12).
- Human-only `group_members` is enforced in `groups.add_member()` (DB trigger is V1).
- Mirror in `backend/db/tables.py` (`USER_ACCOUNT_TYPE`, column, checks, both tables) so
  `backend/tests/db/test_schema.py` (metadata vs migrations) stays green.
- Downgrade drops group data; service `users` rows and their agents remain as ordinary rows
  (`make reset-dev` for a clean slate).

## 8. Authentication and Session Safety

**Invariant:** *any principal that reaches a human-facing route has `account_type == "human"`.*
Stored `role='user'` is never sufficient.

| # | Where | Guard |
|---|---|---|
| G1 | `backend/api/auth.py: login()` (after the `user_query()` lookup, before `verify_password`) | `account_type != "human"` ⇒ `limiter.fail(username)`; `401 invalid_credentials` (same as a wrong password). |
| G2 | `backend/auth/sessions.py: create_session()` | Load `account_type`; non-human ⇒ `ValueError` (issuance impossible from any future path). |
| G3 | `backend/auth/sessions.py: resolve_session()` (`:100`) | Extend `user_row is None or status == "disabled"` with `or account_type != "human"` ⇒ `None`. |
| **G4** | `backend/api/deps.py: current_user()` — **the human-session boundary** | After resolving: `if not resolved.user.is_human: raise ApiError(401, "unauthenticated")`. Every human dependency (`AnyUser`, `UserRole`, `AvailableUser`, `Admin`) derives from `current_user`, so a future route cannot be satisfied by a service row even if it uses `UserRole` alone. `require_user()` additionally asserts `user.is_human` (belt and braces). **Safe for the runtime:** internal exec routes use `api/internal.py: exec_caller()` / `ExecContext`, never `current_user`. |
| L1 | `backend/auth/principal.py` | `user_query()` selects `account_type`; `CurrentUser.account_type` + `is_human` property. `me()` unchanged. |
| L2 | `backend/accounts.py: get_user()`, `list_users()` | `+ account_type == "human"` ⇒ admin list/patch/retry/disable never see service rows. |
| L3 | `backend/domains/validate.py:287` | `+ account_type == "human"` for domain-down notifications. |
| L4 | `api/admin_users.py: CreateUser._username` + `accounts.create_user()` | Reject the reserved `svc.` prefix. |

`password_hash="!service-account-no-login"` is a passive extra layer only.

## 9. Group Lifecycle

New service module **`backend/groups.py`** (style of `backend/accounts.py`).

### `create_group(h, conn, creator: CurrentUser, name: str) -> tuple[Any, uuid.UUID]`

One transaction (the request `Conn`):

1. Validate name (strip, 1..100). Domain = `creator.domain_id` (D-1).
2. Insert the service account (§5 values, `status="provisioning"`).
3. Insert `groups(technical_owner_id=svc, name, created_by_user_id=creator.id)`.
4. Insert `group_members(group, creator)`.
5. Insert the room `threads(user_id=svc, kind="group", name=name)` +
   `thread_members(room, "user", creator)`. The Lead joins after provisioning (§11).
6. `jobs.enqueue(h, conn, user_id=svc, kind="user_provision", request={"domain_id": domain})`
   (existing job; `enqueue` kicks the worker on commit).
7. `on_commit`: `bus.publish(creator.id, "groups.changed", {"group_id"})`.

### Group state during provisioning (D-3, Option A)

- `provisioning`: the room exists; humans may chat (`target="group"`). **AI requests are refused
  server-side** (`409 group_ai_unavailable`, §12) — never stored-then-ignored. UI disables
  "Hỏi AI" and shows "Đội AI của nhóm đang được khởi tạo (2/6)".
- `failed`: humans may chat; AI refused (`409 group_ai_unavailable`); UI shows failure + "Thử lại".
- `active` (and Lead attached): AI enabled.

### Failure / retry / idempotency

- Job failure → existing `user_provision` except-block sets service `status='failed'` +
  `status_detail`; restart → `jobs.fail_stale()` same.
- `POST /api/groups/{id}/provisioning/retry` (member): extract the body of
  `admin_users.retry_provisioning()` into `accounts.requeue_provisioning(conn, account_id,
  domain_id)` (same 409 `job_running` / `invalid_state` rules) and call it for the service row.
  `user_provision` skips existing agents, so retry is idempotent.
- Room created once in the create transaction; Lead attach is `ON CONFLICT DO NOTHING`.

### Read

- `list_groups(conn, user_id)`; `group_detail(conn, group)` → §19 `Group`.

## 10. Group Membership

### Add — `add_member(h, conn, group, user_id)`

1. Target must be `account_type='human' AND role='user' AND status='active'`, else
   `404 user_not_found`; existing member ⇒ `409 already_member`.
2. `INSERT group_members` + `INSERT thread_members(room, 'user', user_id)`. Nothing else
   (no provisioning, no agent, no change to Bob's account or Alice's resources).
3. `on_commit`: `groups.changed` to the new member and existing members (own keys).

### Remove — `remove_member(h, conn, group, user_id)`

`DELETE group_members` + `DELETE thread_members(room, 'user', user_id)`; last member ⇒
`409 last_member`; `groups.changed` to the removed user and remaining members.

Effect is **immediate and server-side**: every group route, room route, task route and attachment
route re-checks membership per request (§15), and every open SSE stream re-checks membership per
group event (§16). `groups.changed → realtime.restart()` is UX only.

### Cross-domain membership (D-1 policy)

Any active human may join regardless of their personal domain. **Group agents always run with the
group's domain only**: credentials `.env.d` links are created by `folders.create_agent()` from the
service row's domain; prompt context comes from `epochs._user_context(conn, <svc>)`;
`supervisor.eligible()` checks the service row's domain. Bob's personal domain, credentials and
`semanticExplanation` are never read for group agents (they are keyed by Bob's `users.id`, which no
group agent's `ExecContext` carries). What Bob types in the room is, by design, visible to the
group team. Test DOMAIN-1.

### Member candidates — `GET /api/groups/member-candidates?q=`

`users WHERE account_type='human' AND role='user' AND status='active' AND (username ILIKE 'q%' OR
display_name ILIKE '%q%') LIMIT 20` → `[{id, username, display_name}]`; any authenticated human
(D-4).

## 11. Provisioning Reuse

| Step | Reused as-is | New |
|---|---|---|
| Trigger | `jobs.enqueue(kind="user_provision")`, `JobWorker`, `_lock_for` | called with the service id |
| Lead + 5 starters | `user_provision()` → `_create()` → `folders.create_agent()` (folder, skeleton, prompt, `.env.d`, git, `uv`, row, `open_epoch`, direct thread, routines, `start_agent`) | — |
| Status / stale | service `users.status`; `fail_stale()` | — |
| Retry | `admin_users.retry_provisioning()` logic | extracted `accounts.requeue_provisioning()` + group route |
| Progress | `progress(conn, domains_dir, users)` | additive `agents: [{slug, name, state}]` |
| Room ↔ Lead | — | post-step `groups.attach_lead_to_room(conn, job.user_id)` in the final `active` transaction: if the owner is a group's technical owner, `INSERT thread_members(room, 'agent', lead) ON CONFLICT DO NOTHING`; **no-op for humans** |

Note: the service owner's per-agent **direct threads** (created by `create_agent`) have the service
row as their only user member, so they never appear to humans (`list_threads` requires the caller
as a member) and their events stay on the owner key (§16).

Serial queue caveat: cold-cache group provisioning waits behind other jobs → `make warm-cache` /
`make demo-ready` before demos.

**Reuse:** provisioning logic ≈ **90%**; workspace creation 100%; retry/error ≈ 85%; frontend
provisioning visuals ≈ 60%.

## 12. Group Room and Human Messaging

### Room

`threads(kind='group', user_id=<svc>, name=<group name>)`; members = group humans + Group Lead.
**Workers are never members.** A room is a group thread whose owner is a service account;
`thread_view()` adds `"group": {"id", "name", "status"} | null`.

### Explicit AI targeting (D-2, Option A: `target` field on the existing route)

`POST /api/threads/{thread_id}/messages` (multipart, existing) gains one form field:

```
target: "group" | "lead"     # rooms only; default "group"
```

| Thread | `target` | Behaviour |
|---|---|---|
| personal (owner == caller) | absent | **unchanged** (all agent members receive, as today) |
| personal | present | `400 invalid_request` |
| room | `group` / absent | message stored; `post_message(..., deliver_to=set())` ⇒ **0 deliveries**, no JEV, no wake, no attachment copy |
| room | `lead` | requires service `status='active'` **and** Lead attached, else `409 group_ai_unavailable`; requires group domain available, else `503 domain_unavailable`; stored with `content["target"]="lead"`; `post_message(..., deliver_to={lead.id})` ⇒ **exactly 1** delivery (`route="jev"`) |

Changes:

- `backend/messaging/messages.py: post_message(..., deliver_to: set[uuid.UUID] | None = None)` —
  `None` = current behaviour; a set restricts `receivers` to those agent ids (intersection with
  thread agents). Attachments are copied only to the restricted receivers (`before_deliveries`).
- `backend/api/threads.py: post_user_message()` — dependency `AvailableUser` → `UserRole`, then:
  personal thread ⇒ `check_domain_available(user)` (same check as before, now after the thread
  lookup); room ⇒ rules above (the caller's personal domain is irrelevant in a group).
- `message_view()` adds `"target": content.get("target")` so history shows the AI request as a
  normal room message with a small "Hỏi AI" marker. No second/hidden conversation.
- Agent senders: Lead's final message in the room has `receivers` = thread agents minus sender = ∅
  ⇒ 0 deliveries (unchanged code path).

### Authorization split

`user_thread()` also guards `patch_group()`, which adds agents via `users_agents(conn, user.id, …)`;
relaxing it would let a member put *personal* agents into the shared room. Therefore:

- new `threads.member_thread(conn, thread_id, user_id)`: kind ∈ {direct, group}; caller is a `user`
  member; and (owner == caller **or** (kind == group **and** owner is the technical owner of a group
  where the caller is in `group_members`)). Used by `list_messages`, `post_user_message`,
  `mark_read`, `get_attachment`.
- `user_thread()` unchanged (owner-only) → `patch_group()`, which also refuses rooms
  (`409 group_room_managed`).
- `list_threads()` predicate: existing personal predicate **OR** (kind == group AND owner ∈
  `member_group_owners(user)` AND caller is a user member). Internal `kind='agent'` threads and
  service-owned direct threads have no human member ⇒ never listed.

### Frontend "mine"

`AgentChatMessages.tsx: MessageItem`: `mine = sender.type === "user" && sender.id ===
currentUserId` (`currentUserId` = `useAuth().snapshot.principal.id`, passed from `AgentChatPage`);
other humans render left with name + initial avatar.

### Message visibility matrix

| Sender | Destination | Stored where | Agent delivery | Human visible | Human SSE |
|---|---|---|---|---|---|
| Human (group) | room, `target=group` | room (`kind=group`, owner svc) | **0** | all current members | group channel → members |
| Human (group) | room, `target=lead` | room | **1** (Lead, `jev`) | all current members | group channel → members |
| Group Lead | room (`send_to_user` / `_finalize_text`) | room | 0 | all current members | group channel → members |
| Group Lead | worker (`send_to_agent`) | `kind=agent` thread, owner svc | worker | **never** (no human member; `list_threads`/`member_thread` refuse) | **never** (owner key only, no human subscriber) |
| Worker | Lead | `kind=agent` thread, owner svc | Lead | **never** | **never** |
| Worker | room | — | — | **impossible**: `_thread_with_caller` requires the caller to be an agent member of the room | — |
| Harness system msg (protocol failure / task notice) | room | room | 0 | members | group channel |
| Personal human | personal agent thread | personal thread (owner human) | as today | owner | owner key (unchanged) |

## 13. Agent Orchestration

| Step | Function |
|---|---|
| AI request | `post_user_message(target="lead")` → `post_message(deliver_to={lead})` → `deliveries(route="jev")` |
| Classification | `jev.Jev._classify()` → task (`global_tasks.user_id=<svc>`, one running per group) or side question → pending delivery |
| Lead activation | delivery: `items.pending_deliveries_work()` (sender `user:alice`, `default_thread="group:<room>"`); task: `queue.task_source()` (`default_thread` = source message's thread = room) |
| Delegation | `send_to_agent` receivers `agents.user_id == caller.user_id` ⇒ group workers only; Alice's personal Data has `user_id=alice` ⇒ unreachable |
| Return | worker `send_to_agent(["lead"])` → Lead delivery → next activation |
| Final | Lead `send_to_user` or plain text → `_finalize_text()` → `resolve_thread(conn, <svc>, "group:<room>")` → room |

### Finalization invariants

| Work | `user_visible` | `response_required` | `requires_tools` | Ends |
|---|---|---|---|---|
| Room `target=group` | — no Work is created (0 deliveries) | | | |
| Room `target=lead`, side question | True | **True (changed)** | False | visible message in room, else protocol-failure system message in room |
| Room `target=lead`, task | True | True (existing `task_source`) | True | `end_task` + visible conclusion in room |
| Worker activation from Lead | False (agent sender) | False | False | replies to Lead only |
| Personal direct | unchanged | unchanged (`kind == "direct"`) | | |
| Personal agent group (kind group, owner human) | unchanged | unchanged (False) | | |

The one runtime change: `backend/harness/items.py:254` becomes
`response_required = response_required or thread_row.kind == "direct" or content.get("target") == "lead"`
— only explicit AI requests carry `target`, so personal behaviour is byte-identical.

**Task concurrency (accepted):** one running group task; a second AI request while running becomes
`queued` or a side question (existing JEV behaviour). Task failure `notify_task_failed()` notifies
the service owner (invisible to humans); members see the failed state via `task.updated`.

## 14. Multi-Human Prompt Semantics

Injection point: `epochs.open_epoch()` → `render_system_prompt()`. Extend
`epochs._user_context(conn, user_id)` to return `account_type`; when `service`, pass
`group_room=True` to `render.render_system_prompt(..., group_room: bool = False)`, which appends
`_section("group_context", _read(platform_dir / "group.md"))`. `platform/rules.md` is not edited.

New **`platform/group.md`** (policy text only):

```
You work for a shared group, not for one person. Several people write in the group room; each
message's sender label (user:<username>) tells you who wrote it — never assume two messages come
from the same person, and address people by name when it matters.
You receive a room message only when someone asks the AI team directly; answer that request in the
room.
Work only with this group's conversation, files and data. Do not ask people to paste material from
their personal assistants or private chats into the group.
```

**Policy vs enforcement:** the prompt states expected behaviour; it is not a security control.
Isolation is enforced by: owner scoping (`ExecContext.user_id` = service owner; `send_to_agent`,
`resolve_thread`, `_report_refs`, internal APIs filter by it), Landlock (§17), API membership
checks (§15) and SSE audience separation (§16). The prompt therefore makes no "you have no access"
claim.

## 15. Basic Membership Security

**Rule:** group access = current human member **and** the resource belongs to that group.
There is no generic "accessible owners" shortcut: `member_group_owners(conn, user_id)` returns only
the service ids of groups the caller is **currently** in, and is used only in the predicates below,
always combined with a room/group-specific condition.

| Route / function | Personal rule (unchanged) | Group rule (new) |
|---|---|---|
| `groups.require_member()` — all `/api/groups/{id}/*` | — | row in `group_members`, else 404 |
| `threads.member_thread()` — messages, post, read | owner == caller + member | room of a current group + caller in `thread_members` |
| `api/threads.list_threads` | as today | rooms of current groups where caller is a member |
| `api/threads.get_attachment` | admin or owner == caller | attachment's thread passes `member_thread` (so attachments of internal `kind=agent` threads are refused) |
| `api/tasks.list_tasks` | `user_id == user.id` | `user_id ∈ member_group_owners(user)` |
| `api/tasks.cancel` | `user_id == user.id` | same as list (any current member — POC) |
| `GET /api/groups/{id}/agents` | — | `require_member`; read-only `agent_view()` of the service owner's agents |

Removed member ⇒ next request fails (404) on all of the above, including the running group task
(TASK-1).

**Intentionally personal-only (unchanged):** `api/agents.py` (folders, reset, builder),
`api/builder.py`, `api/reports.py`, `api/dashboard.py`, `api/catalog.py`, `api/tasks.presence`,
`api/telegram.py`, `api/inbox.py`.

Known POC limit: a Group Report agent's `report_refs` card renders in the room, but report pages
are owner-scoped (`api/reports.py` uses `user.id`), so opening it returns 404 for members. The demo
relies on the Lead's text answer; group report viewing is V1.

## 16. Realtime / SSE

### Chosen design — Option D: a separate **group channel** on the bus + per-event membership check

Evaluated: A (filter at stream time by thread lookup) needs a DB query per event of every kind and
re-derives visibility; B (separate audience keys) is close to D; C (audience in the envelope)
requires touching every publisher's payload. D is B with the smallest publisher change:

1. **Bus** (`backend/harness/bus.py`): add a second key space `_groups[owner_id]`:
   `subscribe_group(owner_id, q)`, `unsubscribe_group(owner_id, q)`,
   `publish_group(owner_id, type, data)` → puts `{"type", "data", "group_owner": str(owner_id)}`.
   The existing owner key space (`publish`/`subscribe`) is unchanged.
2. **Public publishers** (only these three call `publish_group`; the owner-key publish stays):
   - `messages.post_message()` and `system.post_system_message()`: if `thread.kind == "group"` ⇒
     also `publish_group(thread.user_id, "message.created", view)`. `kind='agent'` and `direct`
     messages are **never** published to a group channel.
   - `runtime.publish_status()`: also `publish_group(agent.user_id, "agent.status", data)`.
   - `queue.publish_task()`: also `publish_group(row.user_id, "task.updated", view)` (view carries
     `group_id`).
   For personal owners these group channels have no subscribers (humans subscribe only to service
   owners' channels), so personal traffic is unchanged.
3. **Never public:** `builder.job`, `report.updated`, `notification.*`, `thread.updated`,
   `event.appended`, and every `message.created` of `kind='agent'`/`direct` threads stay on the
   owner key. **No human stream subscribes to a service owner key.**
4. **Stream** (`backend/api/stream.py`): `stream()` loads `member_group_owners(conn, user.id)`;
   `sse_events(bus, key, request, *, group_owners=(), still_member=None, …)` subscribes the one
   queue to `user.id` (unchanged) and to each group channel.
5. **Server-side revocation:** before yielding an event carrying `group_owner`, `sse_events` awaits
   `still_member(group_owner)` — one indexed lookup (`groups.technical_owner_id` unique +
   `group_members` PK) in a short transaction (`harness.db()`). False ⇒ drop the event and
   `unsubscribe_group` that channel for this stream. Membership is read from committed state at
   delivery time, so there is no race with a concurrent removal or a stream opened just before it.
   The `group_owner` field is never serialised (`frame()` writes only `type` and `data`).
6. **Membership UX:** `groups.changed` on the user's own key → frontend
   `create-api-services.ts`: `realtime.on("groups.changed", () => realtime.restart())` → new stream
   picks up added groups; `AgentChatPage` reconnect → `loadAll()`. Not a security boundary.

Preserved: personal realtime (owner key path unchanged), `realtime.restart()`, stale-source
suppression (`source === opened`), `mergeMessages` dedup. No duplicates: a human receives personal
events via their own key only and group events via the group channel only.

Required outcomes:

| Event | Alice SSE | Bob SSE | Carol / removed Bob |
|---|---|---|---|
| Lead → Data internal message | **no payload** | **no payload** | no |
| Data → Lead internal message | **no payload** | **no payload** | no |
| Room message (human or Lead final) | yes | yes | **no** |
| Group agent status / group task | yes | yes | no |

## 17. Workspace / Landlock

- Group folders `FOLDERS_DIR/<svc>/{lead,data,insight,compare,chart,report}`; personal
  `FOLDERS_DIR/<alice>/…`. No layout change.
- `workspace/execd/landlock.py: rules()` confines every exec to its own agent folder (+ uv cache,
  `/tmp`, `/dev/shm`, `/dev`, read-only system trees); the folders root and `/domains` are
  unreachable. Path-agnostic ⇒ **no Landlock change**.
- Human uploads reach group agents only through `copy_to_inboxes()` for the restricted receivers
  (the Lead, AI requests only).
- Tests B-17/B-18 run a real exec under a group agent.

## 18. Frontend UX

```
Chat (/chat)
├── Cá nhân   ← threads with group == null
└── Nhóm      ← rooms: "Sales Team" …
Nhóm (/groups)        list + "Tạo nhóm";  /groups/:id detail (members, 6 agents, provisioning)
Room composer         [ Gửi ]   [ Hỏi AI ]   (Hỏi AI disabled + hint unless group.status == active)
```

| Piece | File | Change |
|---|---|---|
| DTOs | `src/adapters/api/agent-chat.ts` | `ThreadDto.group {id,name,status} \| null`, `TaskDto.group_id`, `MessageDto.target`; `send()` appends `target` to the form when set |
| Types | `src/features/chat/services/agent-chat-service.ts` | `ChatThread.group`, `ChatTask.groupId`, `ChatMessage.target`, `OutgoingMessage.target?: "group" \| "lead"` |
| Sections | `components/AgentChatList.tsx: ThreadList` | `Cá nhân` / `Nhóm` by `thread.group` |
| Composer | `components/Composer.tsx` | rooms only: second action "Hỏi AI" (`onSend(body, files, "lead")`); disabled with "Đội AI của nhóm đang được khởi tạo" when status ≠ active; normal send = `target "group"` |
| Mine/other | `components/AgentChatMessages.tsx: MessageItem` | `currentUserId`; other humans' names; "Hỏi AI" marker when `target === "lead"` |
| Task scope | `model/agent-chat-state.ts: taskBanner(tasks, groupId)` | only tasks with `groupId === (thread.group?.id ?? null)` — a group task never shows/stops in a personal chat and vice versa |
| Room page | `pages/AgentChatPage.tsx` | room header (group name, members); load `GET /api/groups/{id}/agents` into `state.agents`; pass `currentUserId`, `group` to composer; handle `409 group_ai_unavailable` with a toast |
| Groups module (new) | `src/features/groups/{entry.ts,messages.ts,pages/GroupsPage.tsx,pages/GroupDetailPage.tsx,components/GroupProvisioning.tsx,components/MemberPicker.tsx,services/groups-service.ts}` | list/create, detail, members add/remove, provisioning card (poll 4 s, per-agent states, retry) |
| Adapter (new) | `src/adapters/api/groups.ts` + `create-api-services.ts` (`GROUPS_KEY`, `groups.changed → restart()`) | REST via shared `ApiClient` |
| Registration | `src/app/feature-registry.ts` | groups registration (`role: "USER"`, nav "Nhóm") |

Reused unchanged: `AgentFace`, Thinking/Interrupted, one-click Stop, document preview,
`realtime.ts`, `AuthProvider`, `ChatRoute` provisioning gate.

## 19. API Contracts

New router `backend/api/groups.py` (`APIRouter(prefix="/groups")`, mounted in
`backend/main.py` `api.include_router(...)` block, lines 306–318). All routes: `UserRole` (human
session, G4). Errors: existing `{"error": code, "message": text}`.

```http
POST   /api/groups                                   {"name": "Sales Team"}
       → 202 {"group": Group, "job_id": "uuid"}
GET    /api/groups                                   → 200 [Group]
GET    /api/groups/{group_id}                        → 200 Group                 (404 non-member)
GET    /api/groups/{group_id}/provisioning
       → 200 {"status": "provisioning|active|failed", "status_detail": null|"text",
              "job_status": "queued|running"|null, "done": 2, "total": 6,
              "agents": [{"slug": "lead", "name": "Điều phối", "state": "ready|installing|pending"}]}
POST   /api/groups/{group_id}/provisioning/retry     → 202 {"job_id": "uuid"}  (409 job_running | invalid_state)
GET    /api/groups/{group_id}/agents                 → 200 [Agent]  (api/agents.py agent_view shape)
GET    /api/groups/member-candidates?q=bo            → 200 [{"id","username","display_name"}]  (≤20, humans)
POST   /api/groups/{group_id}/members                {"user_id": "uuid"}
       → 201 {"members": [Member]}                   (404 user_not_found | 409 already_member)
DELETE /api/groups/{group_id}/members/{user_id}      → 204   (409 last_member | 404)
```

```ts
Group  = { id, name, status: "provisioning"|"active"|"failed", status_detail: string|null,
           ai_available: boolean,            // status == active && Lead attached
           room_thread_id, created_by, created_at, members: Member[] }
Member = { id, username, display_name }
```

Existing routes, additive changes:

```http
POST /api/threads/{thread_id}/messages   multipart: text, files[], reply_to, choice_id, target
     target: "group" (default in rooms) | "lead"  — rooms only; 400 on personal threads
     → 201 Message (+ "target": "lead"|null)
     409 group_ai_unavailable  (target=lead while provisioning/failed or Lead not attached)
     503 domain_unavailable    (target=lead and group domain unavailable)
GET  /api/threads        Thread + "group": {id,name,status}|null   (rooms of current groups)
GET  /api/tasks          Task + "group_id": uuid|null
SSE  groups.changed      {"group_id"}  (own key)
```

## 20. Exact Source Change Map

### DATABASE

FILE: `backend/alembic/versions/0006_group_chat.py` (new) · RESPONSIBILITY: — · CHANGE: §7 ·
WHY: discriminator + tables · RISK: low · TEST: `test_schema.py`, boot migrate.

FILE: `backend/db/tables.py` · RESPONSIBILITY: metadata · CHANGE: `USER_ACCOUNT_TYPE`, column +
checks, `groups`, `group_members` · WHY: match migrations · RISK: low · TEST: `test_schema.py`.

### AUTH

FILE: `backend/auth/principal.py` · RESPONSIBILITY: `user_query`, `CurrentUser` · CHANGE:
`account_type`, `is_human` · WHY: guards · RISK: low · TEST: `/api/auth/me` unchanged.

FILE: `backend/api/auth.py: login()` · CHANGE: G1 · RISK: low · TEST: B-3.

FILE: `backend/auth/sessions.py: create_session(), resolve_session()` · CHANGE: G2, G3 · RISK: low ·
TEST: B-4.

FILE: `backend/api/deps.py: current_user(), require_user()` · RESPONSIBILITY: human dependency
root · CHANGE: G4 (`is_human` required) · WHY: service row can never satisfy any human route ·
RISK: low (runtime uses `exec_caller`) · TEST: SEC-4, full API suite.

### ACCOUNTS

FILE: `backend/accounts.py` · CHANGE: L2 filters, `svc.` reserved, `requeue_provisioning()` ·
RISK: low–medium · TEST: admin list excludes service rows; admin retry tests unchanged.

FILE: `backend/api/admin_users.py` · CHANGE: `_username` rejects `svc.`; retry uses helper ·
RISK: low · TEST: B-20, `test_admin_users.py`.

FILE: `backend/domains/validate.py` (`:287`) · CHANGE: L3 · RISK: low · TEST: domain tests.

### PROVISIONING

FILE: `backend/agents/provisioning.py` · CHANGE: `attach_lead_to_room` post-step; `progress()`
`agents` list · RISK: low (no-op for humans) · TEST: B-6, B-7, personal suite.

### GROUP API

FILE: `backend/groups.py` (new) · CHANGE: `create_group`, `list_groups`, `group_detail`,
`require_member`, `add_member`, `remove_member`, `member_candidates`, `member_group_owners`,
`is_current_member`, `attach_lead_to_room`, `room_of`, `retry_provisioning` · RISK: medium ·
TEST: `test_groups.py`.

FILE: `backend/api/groups.py` (new), `backend/main.py` (`include_router`) · CHANGE: §19 · RISK:
low · TEST: `test_groups.py`.

### MESSAGING

FILE: `backend/messaging/messages.py: post_message(), message_view()` · RESPONSIBILITY: store
message + deliveries + publish · CHANGE: `deliver_to` param; `publish_group` for `kind == "group"`;
`target` in view · WHY: explicit AI routing; public channel · RISK: **high** (core path) —
default `None` keeps behaviour · TEST: MSG-1..MSG-3, full messaging suite.

FILE: `backend/messaging/system.py: post_system_message()` · CHANGE: `publish_group` for rooms ·
RISK: low · TEST: R-5.

FILE: `backend/messaging/threads.py` · CHANGE: `member_thread()`; `thread_view()` `group`;
`user_thread()` unchanged · RISK: **high** (IDOR) · TEST: B-11, B-21..B-24.

FILE: `backend/api/threads.py` · CHANGE: `list_threads` group predicate; `list_messages`,
`mark_read`, `get_attachment` → `member_thread`; `post_user_message` → `UserRole` + per-thread
domain check + `target` handling; `patch_group` refuses rooms · RISK: high · TEST: MSG-1..MSG-6,
B-21..B-24, existing `test_threads_api.py`.

### TASKS

FILE: `backend/api/tasks.py`, `backend/harness/queue.py` · CHANGE: `list_tasks`/`cancel` group
predicate (current membership); `task_view` + `group_id`; `publish_task` → `publish_group` ·
RISK: medium · TEST: B-16, TASK-1, personal task tests.

### RUNTIME

FILE: `backend/harness/items.py` (`:254`) · CHANGE: `response_required` also when
`content.target == "lead"` · RISK: low · TEST: MSG-5, flow test.

FILE: `backend/harness/runtime.py: publish_status()` · CHANGE: also `publish_group` · RISK: low ·
TEST: R-1.

FILE: `backend/harness/epochs.py`, `backend/harness/render.py`, `platform/group.md` (new) ·
CHANGE: §14 · RISK: low · TEST: `test_system_prompt.py`.

No change: `harness/runner.py`, `harness/jev.py`, `messaging/internal.py`, `harness/supervisor.py`.

### REALTIME

FILE: `backend/harness/bus.py` · CHANGE: group key space (`subscribe_group`, `unsubscribe_group`,
`publish_group`) · RISK: medium · TEST: R-1..R-6, SEC-1..SEC-3.

FILE: `backend/api/stream.py: sse_events(), stream()` · CHANGE: group channels + per-event
`still_member` check · RISK: medium · TEST: SEC-3, R-3, R-4.

### WORKSPACE

No change (`workspace/execd/landlock.py`, `run.py`). Tests B-17/B-18.

### FRONTEND

FILES: §18 (≈ 9 changed + ≈ 8 new). Highest risks: `taskBanner` scoping, composer target, "mine".
TEST: F-1..F-12.

### TESTS (new/extended)

`backend/tests/api/test_groups.py`, `test_group_messages.py`, `test_group_stream.py`,
`backend/tests/harness/test_group_flow.py`; extend `test_auth.py`, `test_schema.py`,
`test_system_prompt.py`; frontend `src/features/groups/tests/*.test.tsx`,
`src/features/chat/tests/group-room.test.tsx`, `tests/adapters/groups.test.ts`.

**Expected changed files:** ≈ 22 backend (3 new) + 1 platform + ≈ 17 frontend (≈ 8 new) + ≈ 10
test files ≈ **50 files**.

## 21. Implementation Phases

Order minimises security exposure: identity safety first, server-side visibility before any UI.

### PHASE 1 — Identity, service-account safety, schema
FILES: `0006_group_chat.py`, `db/tables.py`, `auth/principal.py`, `api/auth.py`,
`auth/sessions.py`, `api/deps.py`, `accounts.py`, `api/admin_users.py`, `domains/validate.py`.
TASKS: migration + metadata; `account_type` / `is_human`; G1–G4; L2–L4.
TESTS: B-1..B-4, SEC-4, B-20, schema round trip, full auth/admin suites.
EXPECTED: humans unchanged; a hand-inserted service row cannot log in, hold a session, pass any
human dependency or appear in admin lists.
STOP: any existing auth/admin test changes; downgrade fails.

### PHASE 2 — Group lifecycle + membership
FILES: `backend/groups.py`, `backend/api/groups.py`, `backend/main.py`.
TASKS: create (no provisioning wait), list/detail, `require_member`, add/remove, candidates,
`groups.changed`.
TESTS: B-5, B-9, B-10, B-11 (group routes), B-19, DOMAIN-1 (membership part).
EXPECTED: group + member + room; adding Bob inserts exactly 2 rows.
STOP: a non-member can read any group field.

### PHASE 3 — Provisioning reuse
FILES: `agents/provisioning.py`, `groups.py`, `accounts.py`, `api/admin_users.py`.
TASKS: enqueue; Lead attach post-step; progress `agents`; retry.
TESTS: B-6, B-7, fail → retry → active; personal provisioning suite.
EXPECTED: 6 agents under the service owner; Lead (only) in the room; `ai_available` true.
STOP: any personal provisioning test changes.

### PHASE 4 — Room access + explicit human/AI targeting
FILES: `messaging/threads.py`, `messaging/messages.py`, `api/threads.py`.
TASKS: `member_thread`, `list_threads` predicate, `patch_group` refusal, `deliver_to`, `target`
handling + 409/503, `message_view.target`, attachment rule.
TESTS: MSG-1..MSG-4, MSG-6 (history part), B-21..B-24, existing thread tests.
EXPECTED: human messages create 0 deliveries; AI request exactly 1; AI refused while provisioning.
STOP: any personal IDOR test fails; any personal delivery count changes.

### PHASE 5 — Group orchestration
FILES: `harness/items.py`, `api/tasks.py`, `harness/queue.py`, `harness/epochs.py`,
`harness/render.py`, `platform/group.md`.
TASKS: `response_required` for AI requests; task `group_id` + membership predicates; prompt section.
TESTS: `test_group_flow.py` (FakeModel: Alice AI request → Lead → `send_to_agent(['data'])` →
Data → Lead → room), B-12..B-16, MSG-5 (storage), TASK-1, B-17, B-18, DOMAIN-1 (runtime part).
EXPECTED: full orchestration at API/DB level; internal threads never listed.
STOP: the Group Lead reaches a personal agent; a group exec reads a personal folder.

### PHASE 6 — Realtime: audience separation + active revocation
FILES: `harness/bus.py`, `api/stream.py`, `messaging/messages.py`, `messaging/system.py`,
`harness/runtime.py`, `harness/queue.py`.
TASKS: group channel; three public publishers; stream subscribes channels; per-event membership
check.
TESTS: SEC-1..SEC-3, R-1..R-6, MSG-5 (delivery), existing `test_stream.py`.
EXPECTED: members get room/status/task events; nobody human gets internal events; removed member's
open stream goes silent without reconnecting.
STOP: any internal payload on a human stream; duplicates; personal stream regression.

### PHASE 7 — Frontend
FILES: §18.
TASKS: adapter/types; sections; composer "Hỏi AI"; mine/other; taskBanner scope; room header +
agents; groups module; provisioning card; member picker; `groups.changed → restart()`.
TESTS: F-1..F-12; existing chat/provisioning/realtime suites.
EXPECTED: demo flow clickable.
STOP: personal chat tests regress.

### PHASE 8 — Integration / demo
TASKS: §24 on a fresh `contoso` stack (warm cache, domain credentials present); full backend,
workspace and frontend suites.
EXPECTED: §25 all checked.
ROLLBACK: additive — unmount `groups_api.router` and hide the registration; `target` absent ⇒ old
behaviour.

## 22. Parallel Work Plan

**Freeze first (½ day, both):** §19 contracts (incl. `target`, `ai_available`, `ThreadDto.group`,
`TaskDto.group_id`, `MessageDto.target`, `groups.changed`) and error codes (`user_not_found`,
`already_member`, `last_member`, `job_running`, `invalid_state`, `group_room_managed`,
`group_ai_unavailable`, `domain_unavailable`).

- **DEV A (backend):** Phases 1–6 + backend tests.
- **DEV B (frontend):** Phase 7 against an in-memory mock service, then the real adapter; Phase 8
  with DEV A.

## 23. Test Plan

### Security

- [ ] **SEC-1** Lead → Data internal message (`send_to_agent`): Alice's open stream receives no event of any type carrying that message/thread
- [ ] **SEC-2** Data → Lead internal reply: Bob's open stream receives nothing for it
- [ ] **SEC-3** Bob opens stream as member → Alice removes Bob → **no reconnect** → new room message: Bob's stream receives nothing; Alice's does
- [ ] **SEC-4** a `CurrentUser.from_row(<service row>)` fails `require_user` / `current_user` path; forged session cookie for the service id ⇒ 401 on `/api/threads`, `/api/groups`, `/api/stream`

### Messaging

- [ ] **MSG-1** Alice "Chào Bob" (`target` absent): 1 message, **0** `deliveries`, JEV not scheduled
- [ ] **MSG-2** Bob reply: 0 deliveries
- [ ] **MSG-3** Alice `target=lead` "Phân tích căn A12-08.": exactly **1** delivery, `agent_id = Group Lead`, `route = jev`; message `target="lead"`
- [ ] **MSG-4** `target=lead` while service `status='provisioning'` (and `failed`) ⇒ `409 group_ai_unavailable`, **no message row** stored
- [ ] **MSG-5** Lead final text lands in the same room (`thread_id = room`) and both Alice's and Bob's streams receive its `message.created`
- [ ] **MSG-6** `GET /api/threads/{room}/messages` never contains `kind=agent` messages; `GET /api/threads` lists no internal thread; `GET /api/threads/{internal}/messages` ⇒ 404 for members
- [ ] MSG-7 `target` on a personal thread ⇒ 400; personal posts without `target` keep current delivery counts

### Tasks / domain

- [ ] **TASK-1** removed Bob: `GET /api/tasks` no longer includes the running group task; `POST /api/tasks/{id}/cancel` ⇒ 404
- [ ] **DOMAIN-1** Bob (domain B) joins a domain-A group; his AI request runs the group Lead with the group's domain (`ExecContext.user_id = svc`; group agents' `.env.d` link to domain A only); Bob's personal agents receive no deliveries
- [ ] B-16 group task `user_id = svc`, `group_id` in view; second AI request queued; any member cancels; non-member ⇒ 404

### Backend (auth, lifecycle, isolation)

- [ ] B-1 `USER_ROLE` unchanged; existing rows `account_type='human'`
- [ ] B-2 human login unchanged
- [ ] B-3 service username + any password ⇒ 401 `invalid_credentials`
- [ ] B-4 `create_session(svc)` raises; forged session ⇒ 401
- [ ] B-5 `POST /api/groups` ⇒ one service owner (`account_type='service'`, `role='user'`), group, creator membership, room
- [ ] B-6 after `jobs.run_pending()`: exactly 6 agents `user_id = svc`, folders under `FOLDERS_DIR/<svc>/`
- [ ] B-7 room members = humans + Lead; no worker
- [ ] B-8 personal provisioning suite unchanged
- [ ] B-9 add human ⇒ +1 `group_members`, +1 `thread_members`, agents unchanged; adding a service id ⇒ 404
- [ ] B-10 remove; last member ⇒ 409
- [ ] B-11 non-member ⇒ 404 on every group route and the room's messages/post/read
- [ ] B-12 Lead input contains `user:alice` / `user:bob`
- [ ] B-13 Group Lead `send_to_agent(['data'])` reaches the group Data; Alice's personal Data gets nothing
- [ ] B-14 a worker `send_to_user(thread="group:<room>")` ⇒ 400 `invalid_thread` (not a room member)
- [ ] B-15 patch_group on a room ⇒ 409; members cannot add personal agents to the room
- [ ] B-17 group exec cannot read/list `FOLDERS_DIR/<alice>` (real execd, Landlock)
- [ ] B-18 group exec cannot read another group's folder
- [ ] B-19 candidates: only active humans, only `id/username/display_name`
- [ ] B-20 `svc.` username rejected by admin creation
- [ ] B-21 Bob ⇒ 404 on Alice's personal thread/messages/attachment
- [ ] B-22 Bob ⇒ 404 on Alice's personal agent/report/task
- [ ] B-23 attachment of an internal `kind=agent` message ⇒ 404 for members
- [ ] B-24 Alice's personal thread list unchanged; room listed for Alice and Bob

### Realtime

- [ ] R-1 members receive group `agent.status` and `task.updated`
- [ ] R-2 Bob never receives Alice's personal `message.created`/`agent.status`/`task.updated`
- [ ] R-3 add member publishes `groups.changed`; a reopened stream includes the new channel
- [ ] R-4 each event delivered once per stream (no duplicate through two keys)
- [ ] R-5 harness system message in a room reaches members; system message in a service direct thread does not
- [ ] R-6 `builder.job`, `report.updated`, `notification.created` of the service owner never reach member streams

### Frontend

- [ ] F-1 personal chat suites green
- [ ] F-2 `Nhóm` / `Cá nhân` sections
- [ ] F-3 create group → provisioning card
- [ ] F-4 provisioning 0/6 → 6/6; failed → retry
- [ ] F-5 add Bob via picker (no free text)
- [ ] F-6 own messages right; Bob's left with name
- [ ] F-7 "mine" by `sender.id`
- [ ] F-8 group agents with `AgentFace` + live status
- [ ] F-9 group task never in personal chat; personal task never in room
- [ ] F-10 `groups.changed` ⇒ restart ⇒ threads reload; non-member room URL ⇒ not-found state
- [ ] F-11 normal send posts without `target`/`target=group`; "Hỏi AI" posts `target=lead`; history shows the marker
- [ ] F-12 "Hỏi AI" disabled with hint while provisioning; a 409 shows a toast, no phantom Thinking

## 24. Demo Script

PRECONDITION: fresh `contoso` stack (`make demo-ready` / warm cache); admin created **alice**,
**bob**, **carol** (role user), personal teams active; group domain credentials present.

| # | Action | Evidence |
|---|---|---|
| 1 | Alice logs in | `/api/auth/me` `role=user` |
| 2 | Nhóm → Tạo nhóm "Sales Team" | `202`; one new `users` row `account_type='service'` |
| 3 | Provisioning card | `0/6`, Lead installing; "Hỏi AI" disabled with hint |
| 4 | Alice tries "Hỏi AI" via API during provisioning | `409 group_ai_unavailable`; no message row |
| 5 | Card reaches 6/6 | status `active`, `ai_available=true`; room members gain the Lead |
| 6 | Alice adds Bob | `group_members`=2; agent count unchanged |
| 7 | Bob logs in (2nd browser) | personal chat unchanged; Sales Team under "Nhóm" |
| 8 | Alice: "Chào Bob" (Gửi) | Bob sees it live, left with "Alice"; DB: **0 deliveries** for the message |
| 9 | Bob: "Chào Alice" (Gửi) | Alice sees it live; DB: **0 deliveries** |
| 10 | Alice: "Hỏi AI" → "Phân tích căn A12-08." | message with "Hỏi AI" marker in room; DB: **exactly 1** delivery (Group Lead, `jev`) |
| 11 | Lead sees Alice | Lead `input` event has `user:alice` |
| 12 | Lead delegates | `kind='agent'` thread (owner svc) Lead→group Data/Compare; Alice's personal agents: 0 deliveries |
| 13 | Internal traffic stays internal | Alice's and Bob's SSE logs (devtools) contain no event for the agent thread; `GET /api/threads` shows no agent thread |
| 14 | Lead posts final answer | agent message in the room |
| 15 | Alice and Bob see it live | both streams `message.created` for the same id |
| 16 | Alice's personal chat | no group messages, no group Thinking banner |
| 17 | Bob → Alice's personal thread id | `404` |
| 18 | Alice removes Bob; Bob's tab left open | Alice posts "test": Bob's open stream receives nothing; Bob's next API call to the room ⇒ 404 |
| 19 | Carol (non-member) | no room in list; room URL / `GET /api/groups/{id}` ⇒ 404 |

## 25. Definition of Done

- [ ] business roles remain `admin|user`
- [ ] service account cannot login or hold a session
- [ ] human-only routes reject service identities (G4, SEC-4)
- [ ] personal provisioning unchanged
- [ ] group gets exactly six separate agents
- [ ] normal human-human message creates zero agent work
- [ ] explicit AI request wakes exactly the Group Lead
- [ ] workers never join the room
- [ ] internal agent messages never reach human SSE
- [ ] internal agent messages never appear in room history
- [ ] removed member immediately loses group API access
- [ ] removed member's existing SSE stops group delivery server-side
- [ ] Group Lead cannot resolve personal agents
- [ ] group agents cannot access personal workspace (Landlock unchanged)
- [ ] personal task never appears in group
- [ ] group task never appears in personal chat
- [ ] group AI unavailable state is explicit during provisioning (UI + 409)
- [ ] Alice/Bob realtime human chat works
- [ ] Alice/Bob both receive the Lead final answer
- [ ] Carol (non-member) sees nothing
- [ ] personal chat regression suites (backend, workspace, frontend) green

## 26. Risks

| P | Risk | Cause | Mitigation | Test |
|---|---|---|---|---|
| P0 | Internal agent traffic on human streams | owner-keyed bus; service key shared by runtime and room | humans never subscribe to the service key; only room messages / status / tasks published to the group channel | SEC-1, SEC-2, R-6 |
| P0 | Removed member keeps receiving | stream keys fixed at open | per-event `still_member` check + unsubscribe | SEC-3 |
| P0 | Service row acts as a human | stored `role='user'`; `require_user` checks only role | G1–G4 at login, session, resolve and dependency root | B-3, B-4, SEC-4 |
| P0 | Personal/group IDOR | relaxing `user_thread()` also relaxes `patch_group()`; broad owner checks | `member_thread` vs owner-only `user_thread`; room-scoped predicates; `patch_group` refuses rooms | B-11, B-21..B-24, MSG-6 |
| P0 | Group task shown/stopped in personal chat | unscoped `taskBanner` | `group_id` + scoped banner; membership-gated cancel | F-9, B-16, TASK-1 |
| P1 | Human chat wakes the Lead / AI request silently lost | `post_message` delivers to every agent member; Lead not yet attached | `deliver_to`; explicit `target=lead`; 409 when AI unavailable | MSG-1..MSG-4 |
| P1 | `post_message` regression | core path change | `deliver_to=None` default = current behaviour; full messaging suite | MSG-7 |
| P1 | Service owner listed as a human | `role='user'` | `account_type='human'` filters | B-19, admin list test |
| P1 | "Mine" bug | `sender.type === "user"` | compare `sender.id` | F-6, F-7 |
| P2 | Group report links 404 for members | owner-scoped `api/reports` | documented POC limit; demo uses text answer | demo step 14 |
| P2 | Per-event membership query cost | one query per group event per stream | indexed PK lookup; small POC scale | R-1 timing sanity |
| P2 | Serial provisioning queue | single `JobWorker` | warm cache before demos | demo precondition |

## 27. Time Estimate

POC quality, one engineer familiar with the repo, AI assistant, aggressive reuse. Revision 1 total
was 66 h realistic; revision 2 adds explicit AI routing, server-side audience separation and
active-stream revocation.

| Area | Best | Realistic | Worst |
|---|---:|---:|---:|
| DB + technical owner | 3 h | 5 h | 8 h |
| Auth guards + human boundary (G1–G4) | 2 h | 4 h | 6 h |
| Group CRUD/membership | 4 h | 6 h | 10 h |
| Provisioning reuse | 3 h | 5 h | 8 h |
| Room access split + tasks scope | 4 h | 6 h | 10 h |
| **Explicit AI-target routing** (backend `deliver_to`/`target`/409 + `items` + composer) | 3 h | 5 h | 8 h |
| Agent orchestration (prompt, flow test) | 3 h | 5 h | 9 h |
| **SSE audience separation** (group channel + 3 publishers + stream) | 3 h | 5 h | 8 h |
| **Active-stream membership revocation** | 2 h | 3 h | 6 h |
| Frontend (groups module, room UX, scoping) | 12 h | 18 h | 28 h |
| Tests/debug (incl. SEC/MSG/TASK/DOMAIN) | 9 h | 14 h | 24 h |
| Integration/demo hardening (Phase 8) | 4 h | 6 h | 10 h |
| **Total** | **52 h** | **82 h** | **135 h** |

Increment vs revision 1 (realistic): AI routing +5 h, SSE audience +5 h, revocation +3 h, human
boundary +1 h, extra tests/demo +2 h ≈ **+16 h**.

**ONE ENGINEER + AI** (≈ 8 focused h/day)
- CODE COMPLETE: **8–10 working days**
- DEMO STABLE: **10–12 working days**

**TWO ENGINEERS + AI** (backend critical path ≈ 50 h; frontend parallel after contract freeze)
- CODE COMPLETE: **5–6 working days**
- DEMO STABLE: **6–8 working days**

## 28. Deferred V1/V2 Work

V1: owner/admin/member roles (who may add/remove/retry/cancel), group archive/delete
(`set_disabled` + `supervisor.stop_user` on the service owner), group report pages and dataset
access for members, per-member unread in `thread.updated`, DB trigger for human-only
`group_members`, per-owner `JobWorker` concurrency, group settings (`semanticExplanation`), domain
picker, cached membership in the stream (instead of a per-event query), group folder viewer.
V2: `@mentions` / addressing individual group agents, multiple team templates, organizations,
invitations, Telegram groups, multi-process event bus.

## 29. Final Recommendation

Build the POC additively in the phase order above. The service-owner design keeps business roles
`admin|user`, reuses ~90% of provisioning and the agent runtime, and needs no Landlock change.
Revision 2 closes the three architectural gaps of revision 1 **server-side**: internal agent events
never reach human streams (separate group channel; humans never subscribe to the service key),
human chat never wakes the Lead (explicit `target="lead"` → exactly one delivery, refused while the
team is not active), and membership removal takes effect immediately for APIs and already-open
streams. Start with **Phase 1** (migration `0006_group_chat.py` + G1–G4 + tests); stop if any
existing auth/admin test changes behaviour.

### Decisions (all closed for the POC)

**D-1 Group domain**
DECISION: group domain = creator's domain; members from any domain may join; group agents use only the group domain.
POC DEFAULT: as decided.
WHY: service row needs one domain; group runtime is keyed by the service owner, so a member's personal domain is never read (DOMAIN-1).
BLOCKS CODING? NO

**D-2 Lead activation (replaces "Lead stays silent")**
DECISION: human-human messages do **not** activate the Lead; AI activation is explicit via `target="lead"` on `POST /api/threads/{room}/messages` ("Hỏi AI" in the UI).
POC DEFAULT: `target` absent = `group`.
WHY: zero model cost and clear semantics for normal chat; no fragile text heuristics.
BLOCKS CODING? NO

**D-3 Provisioning state**
DECISION: room usable for human chat immediately; AI refused with `409 group_ai_unavailable` until the team is active and the Lead attached.
POC DEFAULT: as decided.
WHY: no silently lost AI requests; users can coordinate while provisioning.
BLOCKS CODING? NO

**D-4 Membership permissions / picker**
DECISION: any current member may add/remove members and cancel the group task; the picker lists active humans (id, username, display name) to any authenticated human.
POC DEFAULT: as decided (temporary; roles are V1).
WHY: the only POC distinction is member vs non-member.
BLOCKS CODING? NO

**D-5 Service row role**
DECISION: service rows store `role='user'` and are distinguished only by `account_type='service'`; no principal with `account_type != 'human'` passes `current_user`.
POC DEFAULT: as decided.
WHY: required by the `admin_has_no_domain` CHECK; G1–G4 make the stored role irrelevant.
BLOCKS CODING? NO

**OPEN DECISIONS: NONE.**
