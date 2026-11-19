# 14c · Frontend services and adapters

**Depends on:** [14](14-frontend.md), [14a](14a-frontend-architecture.md), [15](15-api.md)

The frontend calls feature-owned service interfaces. The implementation is chosen once at bootstrap; React pages never handle backend DTOs or SSE/WebSocket frames directly.

## Runtime selection

**Status:** Implemented (mock)

[`readServiceMode`](../frontend/src/app/services/create-services.ts) reads `VITE_SERVICE_MODE`:

| Value | Behaviour |
| --- | --- |
| Unset, empty string or `mock` | Creates the full mock services. |
| `api` | Requires an `api` factory returning the full `Services`. |
| `hybrid` | Requires a `hybrid` factory returning at least one override; the rest stays mock. |
| Anything else | Throws `ServiceConfigurationError`. |

Today [`main.tsx`](../frontend/src/main.tsx) calls `createServices(mode)` without `api`/`hybrid` factories. Switching the env var to either mode only shows a configuration error. API mode never falls back to mock. Restart Vite after changing env vars.

The factory checks required dependencies, the clock and the methods of core/workspace services. This checks interface shape only, not permissions, data correctness or backend connectivity.

## Dependency contract

[`Services`](../frontend/src/app/services/services.ts) contains:

| Dependency | Port or purpose |
| --- | --- |
| `context.clock` | `now()`, `sleep(ms, signal?)`. |
| `auth` | `restore`, `login`, `logout`. |
| `preferences` | `load`, `save`. |
| `chat` | Catalog, load/create, draft, send/cancel, inspector, reset/release. |
| `notifications` | `list`, `snapshot`, `subscribe`, `markRead`, `reset`. |
| `reportTargets` | `hasReport(id)` to check a user notification's presentation target. |
| `workspace.reports` | `catalog`, `list`, `detail`, `download`, `summarize`, `recent`, `onChanged`. |
| `workspace.dashboard` | `catalog`, `overview`, `breakdown`. |
| `workspace['admin-users']` | `list`, `detail`, `changeStatus`, `reset`. |
| `workspace['agent-chat']` | The target chat: agents, threads, messages, send, read marks, groups, tasks, presence, events. |
| `workspace['agent-builder']` | The builder and folder viewer: agents, jobs, prompt, skills, packages, routines, credentials, starters, tree/file/log/diff/archive. |
| `workspace['admin-console']` | The admin console: overview, users, provisioning, agent reset, trace and thread views, jev marks, config. |

The source interfaces are in [`features`](../frontend/src/features): `auth/services/auth-service.ts`, `settings/services/preferences-service.ts`, `chat/services/chat-service.ts`, `notifications/services/notifications-service.ts`, `reports/services/reports-service.ts`, `dashboard/services/dashboard-service.ts`, `admin-users/services/admin-users-service.ts`, `chat/services/agent-chat-service.ts`, `agents/services/builder-service.ts` and `admin/services/admin-service.ts`.

Workspace is typed `Record<string, unknown>` at the app layer; pages get ports through `useWorkspaceService<T>(key)`. When registering a new port, update composition and the matching startup check, not just a cast in the page.

## Registering real adapters

**Status:** Implemented (API) in hybrid mode: [`main.tsx`](../frontend/src/main.tsx) registers `hybrid: createApiHybridServices(...)` from [`src/adapters/api/`](../frontend/src/adapters/api/). The adapters share one HTTP client (credentials, `X-Contoso-Client: web` on writes, errors mapped to the `normalizeServiceError` codes and never the server's text), one session store (preferences are fetched at login/restore because `PreferencesService.load` is synchronous) and one SSE connection. `reportTargets.hasReport` answers only for report ids the reports API returned this session. The dashboard adapter fetches `/api/dashboard/dataset` (cached 30 s) and runs `createDashboardRepository` on it. Admin users get `revision: 1`, no audit and client-side paging (`queryUsers`); `reset` is `unsupported`. Contract changes: `DownloadDescriptor.content` is `string | Blob`, `Artifact.mediaType` also allows PDF/DOCX/XLSX, `DashboardOverview.sourceMode` and the admin `sourceMode` allow `api`, and the login field is a username.

The original plan follows.

Once implementations exist for the agreed contracts, pass factories to `createServices` at bootstrap:

```ts
// The factories below are implementations to be added at the integration point.
const services = createServices(mode, {
  api: createApiServices,
  hybrid: () => ({
    workspace: {
      reports: reportsAdapter,
      dashboard: dashboardUsingReportsAdapter,
    },
    reportTargets: reportTargetCatalog,
  }),
});
```

Hybrid replaces core services per object and merges `workspace` by feature key; it does not merge individual methods inside a service. The mock dashboard holds its reports dependency from construction. So a `workspace.reports` override must come with `workspace.dashboard` and `reportTargets`; a reports-only override is rejected. Adapter authors must still make the three use the same source.

`hasReport` is a synchronous hint for user-notification navigation. Adapters must provide a catalog consistent with the real source; never infer permission or existence from ID patterns such as `R010`. The authorized detail read still decides whether the user may see the report.

## Mapping to the API

**Status:** Implemented (API)

Endpoints are defined in [15](15-api.md) (core) and [15 § Workspace extensions](15-api.md#workspace-extensions).

| Port | Endpoint group | Status |
| --- | --- | --- |
| `auth` | `/api/auth/*` | Implemented (API) |
| `preferences` | `/api/me/preferences` | Implemented (API) |
| `chat` | `/api/threads*` + SSE `/api/stream` | Implemented (API) as `workspace['agent-chat']`; the scripted `chat` port stays mock |
| `notifications` | `/api/notifications*` | Implemented (API) |
| `workspace.reports` | `/api/reports*` | Implemented (API) |
| `workspace.dashboard` | `/api/dashboard/dataset` + FE-side computation with `features/dashboard/model` | Implemented (API) |
| `workspace['admin-users']` | `/api/admin/users*` | Implemented (API); the API admin console page replaces it on `/admin/users` when configured |
| `workspace['agent-chat']` | `/api/threads*`, `/api/tasks*`, `/api/presence`, `/api/attachments/*` + SSE | Implemented (API) |
| `workspace['agent-builder']` | `/api/agents*`, `/api/jobs/*`, `/api/catalog/*` | Implemented (API) |
| `workspace['admin-console']` | `/api/admin/*` + SSE `/api/admin/agents/{id}/stream` | Implemented (API) |

Contract differences adapters must map:

- Roles: FE uses `USER` / `ADMIN`; the API uses `user` / `admin`.
- Identity: FE `Principal.email` vs API `username` (target login is by username).
- Display name: FE `Principal.displayName` is required; API `display_name` may be `''`, which means "show the username".
- Session: FE `Session.expiresAt` has no API field. `Me` doesn't return an expiry (it slides, [12](12-auth-and-domains.md#login-poc-grade)); the adapter treats a 401 as the end of the session.
- Domain: `Me.domain` (`{id, name, status}` or `null` for admins) maps onto `Session.domain` (`SessionDomain`); the unavailable-domain banner and the composer's disabled state read it. The mock session carries `domain: null`.
- Admin users: FE `ManagedUser` (`name`, `email`, `role: 'USER'`, `status: active | disabled`, `revision`, `lastActiveAt`), paging and sorting, `changeStatus` with `expectedRevision`/`operationId`, and audit events have no API counterpart. The API's `User` has `username`, `display_name`, `domain`, `status` (also `provisioning`, `failed`), `status_detail` and `created_at`; disable/enable is `PATCH /api/admin/users/{id} {disabled}` with no revision check, and listing is unpaged ([15](15-api.md#admin-api-apiadmin)).

## Data mapping and validation

Agree endpoints, authentication, DTOs, authorization, pagination, business timezone, version identity, request cancellation and event ordering before building a transport. Endpoints are defined in [15](15-api.md) (core) and [15 § Workspace extensions](15-api.md#workspace-extensions).

Adapters perform these steps:

1. Call the transport and enforce permissions for the current session.
2. Map DTOs to the feature's domain model; keep `null`, zero and missing fields distinct.
3. Check identity, types and invariants before returning to the page.
4. Return `ServiceResult<T>` with stable application errors; keep abort as control flow.

[`decodeReportVersion`](../frontend/src/features/reports/adapters/decode-version.ts) validates a payload **already mapped to the domain**; it is not a decoder for a hypothetical backend DTO. It checks report/version identity, sequence, legacy blocks, finite-or-null numbers, table/chart sizes, evidence references and that source times are not newer than the saved version. Timestamps are normalized to ISO UTC; business dates and scope timezone have their own rules.

Schema v1 goes through `decodeReportSchema`; unsupported schema versions are recorded by `decodeReportVersion` as `schemaIssue`, keeping legacy parts if present. Unknown legacy blocks are rejected; unknown schema blocks become displayable diagnostics. Details in [14f](14f-report-schema.md).

[`normalizeServiceError`](../frontend/src/shared/contracts/normalize-service-error.ts) maps application codes or HTTP statuses to `ServiceError` and never passes raw server messages to the UI. It handles 401, 403, 404, 409, 422, 408, 501; any other status becomes `unavailable`. A `DOMException` named `AbortError` is rethrown. Mock repositories normalize errors separately through the workspace integration.

Gap: statuses used by spec [15](15-api.md) such as 413 (payload too large), 429 (rate limited) and 503 (unavailable) all collapse to `unavailable` today. **Status:** Planned.

## Chat transport

[`ChatTransport`](../frontend/src/features/chat/services/chat-service.ts) has `send` and `cancel`. `send` takes principal ID, conversation ID, body, attachment metadata, a stable request ID, an AbortSignal and a callback emitting `ChatBundle` snapshots.

A streaming adapter must handle acknowledgement, de-duplication, ordering, reconnect and interrupted state before emitting snapshots. `applyMessage` in the model keeps the update with the newer sequence for the same message ID; it does not replace the transport's reconciliation logic.

Abort ends the current subscription. `cancel` is a separate request to stop remote work, depending on capability. Never resend a question while it is unknown whether the server received it. `delivery` (`replay`, `stream`, `complete`), `connection` and agent capabilities are published by the adapter.

Public content placed in `Message.blocks` never contains internal traces or private instructions. Mock attachments have no upload transport; a real adapter must define byte storage, access, lifecycle and upload state before claiming support. Target chat (whole messages over SSE, `report_refs`, attachments) differs; see [14](14-frontend.md#current-implementation-vs-target).

## Target chat port

**Status:** Implemented (API). [`AgentChatService`](../frontend/src/features/chat/services/agent-chat-service.ts) is registered as `workspace['agent-chat']` by `createApiHybridServices`; [`ChatRoute`](../frontend/src/features/chat/pages/ChatRoute.tsx) renders the target chat when that key exists and the mock chat otherwise. The shell hides the "Dữ liệu minh họa" badge in that case, and user-notification chat targets open `/chat/:threadId` after checking the id against `GET /api/threads`.

| Method | Endpoint |
| --- | --- |
| `agents`, `threads`, `tasks` | `GET /api/agents`, `GET /api/threads`, `GET /api/tasks?status=queued,running` |
| `messages(threadId, before?)` | `GET /api/threads/{id}/messages?before=&limit=50` |
| `send(threadId, {text, files, choiceId?, replyTo?})` | multipart `POST /api/threads/{id}/messages`; more than 10 files or one over 20 MB is rejected before upload |
| `markRead`, `createGroup`, `updateGroup` | `POST /api/threads/{id}/read`, `POST /api/threads`, `PATCH /api/threads/{id}` |
| `cancelTask`, `presence` | `POST /api/tasks/{id}/cancel`, `POST /api/presence` |
| `subscribe` | SSE `message.created`, `agent.status`, `task.updated`, `thread.updated`, plus `reconnect` |

DTOs are mapped to camelCase (`display_name` → `name`, `report_refs` → `reportRefs`, attachments get a `url`). Server codes map to `readOnly` (`thread_read_only`), `tooLarge` (`file_too_large`, 413), `domainUnavailable` and `taskEnded`; the page shows its own text for each. `createRealtime` always listens for `open` and passes the number of opens so far, so the adapter emits `reconnect` only from the second one. Messages are de-duplicated by id, so the `send` response and the SSE copy of the same message render once.

## Artifacts and mutations

`ReportsService.download` returns a `DownloadDescriptor` for the exact report/version/artifact: text content, HTML/CSV media type, filename, size and `sourceMode`. The UI creates a Blob and revokes the object URL. Adding PDF/DOCX needs a contract extension and a binary transport; relabelling a button is not enough.

Admin `changeStatus` takes `userId`, `targetStatus`, `expectedRevision`, `operationId`. The controller keeps the operation ID when retrying an unknown result and re-reads detail/audit to reconcile. On conflict the user must review the new data and confirm a new action. Audit/mutation types still record `sourceMode: 'mock'`; backend admin integration must update this contract deliberately.

## Checks when replacing adapters

Existing tests: [`create-services.test.ts`](../frontend/src/app/services/create-services.test.ts), [`adapter-contracts.test.ts`](../frontend/src/features/reports/tests/adapter-contracts.test.ts), [`lifecycle.test.tsx`](../frontend/src/features/chat/tests/lifecycle.test.tsx) and [`status-controller.test.mjs`](../frontend/src/features/admin-users/tests/status-controller.test.mjs).

When adding a real transport, verify separately: revoked permission, request failure, late responses, version mismatch, download with wrong identity and unknown mutation results. The current mock tests prove nothing about backend guarantees that are not integrated yet.
