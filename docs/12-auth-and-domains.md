# 12 · Auth, roles and domains

**Depends on:** [04](04-agent-folder.md), [10](10-data-model.md).

**Status:** Implemented in S2 (`backend/auth/`, `backend/api/`, `backend/accounts.py`, `backend/domains/`), except the provisioning job's work and retry (S9), stopping and starting runners (S5b) and the Langfuse login (S0 compose).

## Login (PoC grade)

- **No self-signup.** An admin creates accounts with a username and password.
- **Password hashing.** Passwords are hashed with argon2id (`argon2-cffi` defaults, which are OWASP parameters).
- **`POST /api/auth/login {username, password}`.** Login is by username. The current frontend mock still asks for an email ([14](14-frontend.md#current-implementation-vs-target)).
  - **Success:** it generates 32 random bytes (`secrets.token_bytes`), stores their SHA-256 in `auth_sessions`, and sets the cookie `contoso_session=<b64url token>` with `HttpOnly; SameSite=Lax; Path=/`, plus `Secure` when `COOKIE_SECURE=1`, and `Max-Age` of 7 days. The TTL is 7 days, and it slides: `last_seen_at` and `expires_at` are updated at most once per minute, and each time they move the cookie is sent again with a fresh `Max-Age`. The username is lower-cased and trimmed before lookup.
  - **Failure:** it returns 401 `invalid_credentials`, with the same response for an unknown user and a wrong password.
  - **Disabled users** get 403 `user_disabled`, but only with the right password; a wrong one is still 401 `invalid_credentials`.
  - **Rate limit:** 10 failures per (lower-cased) username in a sliding 15-minute window, kept in memory, then 429 `rate_limited` with `Retry-After`, even for the right password. A successful login clears the count.
- **`POST /api/auth/logout`** deletes the session row and clears the cookie; it returns 204 even without a session. **`GET /api/auth/me`** returns `{id, username, display_name, role, domain: {id, name, status} | null}`.
- **CSRF.** Every `/api` request other than GET, HEAD and OPTIONS must carry `X-Contoso-Client: web`; otherwise 403 `csrf`, checked before routing and auth. A custom header plus `SameSite=Lax` is enough for a PoC.
- **First admin.** At boot, if no admin exists, one is created from `ADMIN_USERNAME` (lower-cased) and `ADMIN_PASSWORD`. The password is never logged. An existing admin is left alone, so changing `ADMIN_PASSWORD` later doesn't change it. If the name is invalid or already a user's, the boot stops with an error naming `ADMIN_USERNAME`.

## Roles and authorization

| Role | Domain | Sees | Routes |
|---|---|---|---|
| `user` | exactly one | own agents, threads, tasks, folders | `/api/*` except `/api/admin/*` |
| `admin` | none | every domain, user, agent, thread, event and folder | `/api/admin/*` plus the folder and catalog routes; no chat routes (an admin has no team) |

([decision 0018](decisions/0018-single-global-admin-role.md))

- **Ownership.** Every user-scoped query filters by `user_id = current_user.id`. Asking for another user's resource returns **404 `not_found`**, so its existence is never confirmed.
- **Admin routes** return **403 `forbidden`** to users, and the user-only routes (chat, team, builder) return 403 `forbidden` to admins. No session is 401 `unauthenticated` everywhere.
- **Internal routes** (`:8001/internal/v1/*`) accept only exec tokens ([11](11-sandbox.md#exec-token)). Port 8001 isn't published by compose.

## Domains

A domain is a directory in the repo checkout, mounted read-only at `/domains` in both `api` and `workspace`:

```text
domains/<id>/
  domain.yaml                         {id, name}
  credentials/<set>.env.example       committed; first line "# description: …", then KEY= lines
  credentials/<set>.env               real values, git-ignored, written by the operator
  starters/lead/prompt.md             optional: role text for the built-in lead
  starters/<slug>/agent.yaml          {display_name, avatar: {emoji, color}, description, presets: [...], credentials: [...]}
  starters/<slug>/prompt.md
  seeds/skills.yaml                   optional domain catalog rows
  seeds/library_presets.yaml          optional domain presets
```

```yaml
# domains/fabrikam/domain.yaml
id: fabrikam
name: Fabrikam Sales Ops
```

([decision 0009](decisions/0009-domain-credentials-as-files.md), [decision 0010](decisions/0010-per-user-agent-teams.md))

### Validation at boot

`domains/validate.py` checks each domain and upserts `domains` with `available` or `unavailable` and the reasons:

1. `domain.yaml` parses, and `id` equals the directory name.
2. Every `credentials/<set>.env.example` has a matching `<set>.env`, and every key in the example is present and non-empty in the real file.
3. **No key name appears in two of the domain's credential sets.** That way the load order of `.env.d/` never matters.
4. Every starter has `prompt.md`, and every `agent.yaml` parses, has a `display_name`, and lists `presets` and `credentials` as lists of names. Its `presets` exist (global in `platform/seeds/library_presets.yaml`, or in this domain's seeds), its `credentials` name existing sets, and its slug is a valid slug ([04](04-agent-folder.md)) that isn't `lead`. `starters/lead/` holds only `prompt.md`.
5. Seed files parse as lists and pass catalog validation ([05](05-agent-builder.md#catalog)). A domain's skill and preset ids must also differ from the global ones and from every other domain's (they are primary keys).

`status_reason` holds the reasons one per line. A `domains` row whose directory is gone becomes `unavailable` (`domains/<id>: missing directory`); rows are never deleted. When a domain goes from available to unavailable, each of its users gets a `system` notification ([19](19-reports-dashboard-notifications.md#user-notifications)).

**Reasons are logged by key or file name only, never by value.** An unavailable domain's users can log in and see a banner ("Miền dữ liệu đang lỗi cấu hình, liên hệ quản trị viên"). Their runners don't start, and `POST` to their threads returns 503 `domain_unavailable`. Other domains are unaffected. `make check` runs the same checks from the command line.

### Credentials flow

1. The operator copies each `credentials/<set>.env.example` to `<set>.env` and fills it in.
2. Compose mounts `./domains` read-only. `api` reads only `.env.example` files and key names, and never parses values. The one exception is validation, which checks values only for being non-empty.
3. An agent gets a credential set when a starter's `agent.yaml` or the builder attaches it: a symlink `.env.d/<set>.env` in its folder.
4. `execd` loads those files into each exec's environment ([11](11-sandbox.md#post-exec)). Agent code uses `os.environ["WAREHOUSE_DSN"]`.
5. **Rotation** is one file edit. It takes effect on the next exec for every agent, with no restart.

## Provisioning a user

`POST /api/admin/users {username, password, domain_id, display_name?}` inserts `users(status='provisioning')` and queues one provisioning job (`jobs.kind='user_provision'`, `request={domain_id}`). The username is lower-cased and must match `^[a-z0-9._-]{3,32}$`; a taken one is 409 `username_taken`, an unknown domain 400 `invalid_request`. The job:

1. Create the lead ([04](04-agent-folder.md#creating-an-agent)).
2. Create every starter of the domain, in alphabetical slug order.
3. Set `status='active'`.

If any step fails, it sets `status='failed'` with `status_detail` naming the step. `POST /api/admin/users/{id}/retry` skips the agents that already exist and continues (only for a `failed` user: 409 `invalid_state` otherwise, 409 `job_running` while one is queued or running). The lead is created as `Điều phối` with the avatar 🧭.

## User management (admin page "Người dùng")

| Action | Effect |
|---|---|
| Create | as above |
| Disable | `status='disabled'`; delete every session of the user; stop their runners. Their tasks stay as they were |
| Enable | `status='active'` (only from `disabled`); start their runners. A user disabled before provisioning made the lead becomes `failed` ("provisioning did not finish; use retry") instead |
| Reset password | new argon2id hash; delete every session of the user |
| Reset agent | [04](04-agent-folder.md#reset-khôi-phục-bản-gốc) |
| Change domain | **not supported in the PoC** (409 `domain_change_unsupported`) |

Account events (create, password reset, disable) also create a user notification for the affected user, shown in their inbox at `/notifications` ([19](19-reports-dashboard-notifications.md)): `account-created` for a new account (always sent), `system` for a password reset or a disable (skipped when the user turned the `system` group off). Repeating a disable or enable changes nothing and notifies no one. Admin accounts aren't managed on this page: the admin user routes list and change `user` accounts only.

## Langfuse login

Langfuse has its own login, separate from ours. Headless init creates its first user from `LANGFUSE_INIT_USER_EMAIL` (default `admin@contoso.local`) and `LANGFUSE_INIT_USER_PASSWORD`. Compose sets that password to `${ADMIN_PASSWORD}`, so the admin uses the same password in both places. SSO between the two is future work.
