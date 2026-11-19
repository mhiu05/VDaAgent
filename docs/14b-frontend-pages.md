# 14b · Frontend pages

**Depends on:** [14](14-frontend.md), [14a](14a-frontend-architecture.md), [19](19-reports-dashboard-notifications.md)

Routes come from [`App.tsx`](../frontend/src/app/App.tsx), [`feature-registry.ts`](../frontend/src/app/feature-registry.ts) and the `features/*/entry.ts` files. This page describes the implemented UI plus the target routes from the spec; mock data limits are in [14g](14g-frontend-development.md). Where the mock diverges from target UX, see [14](14-frontend.md#current-implementation-vs-target).

## Routes and access

| Route | Access | Content | Status |
| --- | --- | --- | --- |
| `/login` | Signed out | Intro desktop and login window. | Implemented (mock) |
| `/` | `USER` | Business dashboard. | Implemented (mock) |
| `/reports` | `USER` | Reports library and query-driven viewer. | Implemented (mock) |
| `/reports/:id` | `USER` | Compatibility deep link; opens the viewer over the library. | Implemented (mock) |
| `/chat` | `USER` | Agent Fleet and conversations (`?conversation=`). | Implemented (mock) |
| `/chat/:threadId?` | user | Target chat route (spec 14). | Implemented (API) |
| `/agents` | user | Agent team list. | Implemented (API) |
| `/agents/new` | user | Agent builder, new agent. | Implemented (API) |
| `/agents/:id/:tab` | user | Agent builder / folder viewer tabs. | Implemented (API) |
| `/notifications` | `USER` | User notification inbox. | Implemented (mock) |
| `/setting` | `USER` | Personal preferences and demo data. | Implemented (mock) |
| `/admin/users` | `ADMIN` | User list, detail and status. | Implemented (API); mock page in mock mode |
| `/admin` | admin | Admin overview (spec 13). | Implemented (API) |
| `/admin/trace/:agentId` | admin | Agent trace view. | Implemented (API) |
| `/admin/threads/:threadId` | admin | Thread inspection. | Implemented (API) |

The settings path is `/setting`. A signed-out user opening a protected route is redirected to `/login`. A signed-in user opening `/login` is redirected to the role home. Opening another role's route shows a not-authorized state in the current shell. Unregistered paths show a not-found screen.

Landing: on the API, user → `/chat` (lead's direct thread) and admin → `/admin`; mock mode keeps `USER` → `/`, `ADMIN` → `/admin/users`. `/` stays the business dashboard in the nav.

A session being restored, or failing to restore, shows a waiting/error screen before any page mounts. These checks do not replace access control in services/backend.

## Shared shell

**Status:** Implemented (mock)

The shell shows role-based navigation, account, sign-out and the unread user-notification count. The desktop rail expands on interaction; narrow screens use a drawer. Normal pages use a frame with a scroll area; chat declares a `viewport` frame so the timeline and side areas manage their own scrolling.

The UI supports Vietnamese/English, light/dark/system theme, timezone, comfortable/compact density and reduced motion. Control labels and formatting follow preferences; report/message content keeps its stored language. Overlays use Radix primitives with per-type focus and Escape handling.

## Desktop and login — `/login`

**Status:** Implemented (mock). Backend per [19](19-reports-dashboard-notifications.md#pre-auth-desktop).

[`PreAuthDesktop`](../frontend/src/features/auth/desktop/PreAuthDesktop.tsx) renders a wallpaper, system bar, shortcuts, dock and seven windows: `login`, `workspace`, `reports`, `data`, `skills`, `automations`, `about`. Windows can be opened, closed, minimized, raised, moved, and the layout reset. Window position and order live in a reducer, not in persisted account state.

At widths of 1200px and up, login, workspace and reports open initially. Compact mode prioritizes login; other previews open on demand, and opening a new preview minimizes the previous one. When viewport width changes, the layout resets for the new size.

Workspace/report previews use public data from the Riverside fixture; they grant no access to the reports library. The capability previews describe the product's simulated capabilities. Users can change locale/theme before login and open the login window from the dock or login buttons.

[`LoginForm`](../frontend/src/features/auth/desktop/LoginForm.tsx) takes email/password, supports demo accounts and shows login errors. The auth service normalizes email with trim/lowercase and creates an eight-hour demo session. Successful login sends `USER` to `/` and `ADMIN` to `/admin/users`. Target: the login window asks for **username** + password via `POST /api/auth/login` with a cookie session, and landing follows the target table above.

## Business dashboard — `/`

**Status:** Implemented (mock). Backend per [19](19-reports-dashboard-notifications.md#business-dashboard); API [15](15-api.md#business-dashboard).

[`DashboardPage`](../frontend/src/features/dashboard/pages/DashboardPage.tsx) reads the catalog, then loads the overview for the date range, market and project. Content: inventory, slow-moving share and transaction KPIs; inventory-age and transaction-trend charts; attention points, project priorities, recent reports and task statistics.

KPIs carry value, baseline/delta when available, definition, source, cutoff, policy and quality. Missing data shows a matching state. Data blocks can report their own errors or completeness instead of implying every source is complete.

Detail actions open an inspect area on the same page for inventory, slow-moving, transactions, a project or tasks. It has pagination and heading focus. Recent-report links carry the chosen version; library links carry the business scope.

| Query | Meaning |
| --- | --- |
| `from`, `to`, `timezone` | Business date range `[from, to)`; the dashboard requires both bounds, max 366 days. |
| `market`, `project` | Scope from the catalog; project must match market if given. |
| `inspect` | `inventory`, `slow`, `transactions`, `project`, `tasks`. |
| `target` | Object inside inspect, by type. |
| `taskState` | `active`, `failed`, `all` for tasks. |
| `inspectPage` | Inspect data page. |

Invalid date queries fall back to the default scope with a warning; market/project are checked against the catalog.

## Reports library and viewer — `/reports`, `/reports/:id`

**Status:** Implemented (mock). Backend per [19](19-reports-dashboard-notifications.md#reports-library); API [15](15-api.md#reports).

[`ReportsPage`](../frontend/src/features/reports/pages/ReportsPage.tsx) shows a card grid, search, filters, sort and pagination. Mock search strips diacritics and normalizes case; it searches code, title, project and author. Filters on the same field match any value; filter groups are combined.

| Query | Value or purpose |
| --- | --- |
| `q` | Keyword, max 500 characters after input normalization. |
| `type`, `status`, `market`, `project`, `author`, `agent` | Keys may repeat to filter by several values. |
| `status` | `completed`, `generating`, `failed`, `draft`, `unsupported`. |
| `dateField` | `createdAt` or `completedAt`. |
| `from`, `to`, `timezone` | Date range `[from, to)` in business timezone. |
| `sort`, `direction` | Sort by `createdAt`, `completedAt`, `title`, `status`; `asc`/`desc`. |
| `page`, `pageSize` | Page from 1; size 25, 50 or 100. |
| `report`, `version`, `view` | Open a report, pin a version, choose `dashboard` (report overview) or `detail`. |

A card opens the report overview of the version matching the completion-date filter, or the latest matching version. Cards are real links, so they open in a new tab. The viewer is a dialog over the list with analytical overview, document, version picker, evidence and artifact download. `/reports/:id` opens the document by default; query links open the report overview by default.

Record state and latest generation are kept apart: a saved version stays viewable while a newer generation runs or fails. Without a saved version no fake document is produced. History, focus, error and download rules are in [14e](14e-report-viewer.md). Target downloads include DOCX/PDF/XLSX binaries via the API (see [14](14-frontend.md#current-implementation-vs-target)).

## Agent Fleet (mock chat) — `/chat`

**Status:** Implemented (mock). Diverges from target chat UX (spec [14](14-frontend.md), [12](12-auth-and-domains.md), [13](13-observability.md)); see [14](14-frontend.md#current-implementation-vs-target).

[`ChatPage`](../frontend/src/features/chat/pages/ChatPage.tsx) has a six-agent catalog, groups/history, timeline, composer and inspector. Picking an agent opens its own conversation; a demo group needs at least two members. Query `conversation` selects the thread; an invalid ID shows a notice and falls back to an available conversation.

The timeline renders Markdown, evidence, tables, charts and report references. It supports loading older messages, jumping to latest, pending/interrupted answers and send-result notices. The inspector shows the agent's description, skills, tools, MCP and public capabilities.

The composer supports Enter to send, Shift+Enter for newline, mentions and capability-based attachment metadata. Mentions in the mock only insert text. Files: max five, 10 MiB each, CSV/XLSX/PDF/PNG/JPEG; there is no upload or file analysis.

The Riverside group and six direct threads are authored content from `R010-v2`. `/report` points to an existing report reference or opens the saved version; it never starts a new generation. Details and limits in [14d](14d-frontend-chat-mock.md).

Target differences (summary): route `/chat/:threadId?`; lead + domain starters + user-created agents (max 12); whole messages via SSE with a status line instead of streaming; 10 files × 20 MB any type, no mentions or slash commands; info pane instead of inspector; one pane at a time below 768 px.

## User notifications — `/notifications`

**Status:** Implemented (mock). Backend per [19](19-reports-dashboard-notifications.md#user-notifications); API [15](15-api.md#user-notifications).

[`NotificationsPage`](../frontend/src/features/notifications/pages/NotificationsPage.tsx) has all/unread tabs and type filters: account, system, report ready, task failed, action needed. Today/yesterday/earlier grouping uses the clock and the selected timezone. Filters and the detail panel are page state, not serialized to the URL.

Opening a detail marks the user notification read and moves focus to the content. Update failures give feedback; optimistic read state is handled by the provider/service. Mark-all applies to every unread item, including ones outside the current filter.

Opening related content checks `access`, role, conversation ID or report target before navigating. Missing or restricted targets show an unavailable state. On closing the detail, focus returns to the trigger if it still exists, or to the filters if the trigger left the unread list.

## Settings — `/setting`

**Status:** Implemented (mock). Backend per [19](19-reports-dashboard-notifications.md#preferences); API [15](15-api.md#preferences).

[`SettingsPage`](../frontend/src/features/settings/pages/SettingsPage.tsx) edits display name, theme, density, locale, IANA timezone, user-notification groups and motion. Email/role are read-only. Name must be 1–100 characters; timezone is validated with `Intl.DateTimeFormat`.

Changes preview live in the app. Save writes preferences through the service; cancel restores the saved values. Navigation is blocked while dirty and `beforeunload` warns when leaving the tab. Save errors keep the draft.

Demo reset has a confirmation dialog and only resets chat/drafts and user-notification read state for the current account. Preferences and other accounts' data are kept.

## User management — `/admin/users`

**Status:** Implemented (API) on the `admin-console` port (spec [12](12-auth-and-domains.md)); the mock page below is shown only in mock mode.

[`AdminUsersPage`](../frontend/src/features/admin-users/pages/AdminUsersPage.tsx) shows only `USER` accounts, with search by name/email, active/disabled filter, sort, pagination and detail/audit. Query: `q`, repeatable `status`, `sort` (`name`, `createdAt`, `lastActiveAt`), `direction`, `page`, `pageSize`, `user` to open a detail.

A status change needs confirmation and sends `expectedRevision` plus `operationId`. While pending, the controller blocks duplicate submits. If the response is lost, the controller re-reads the audit to reconcile; retry keeps the same operation ID. A conflict requires reviewing the new state and confirming again. Mutation and audit are simulated; no real backend accounts are managed.

The API admin page adds create/provision/retry/reset password/reset agent, `/admin`, trace and threads; the mock page keeps its own status/audit behaviour in mock mode.

## Sources and checks

Journey tests live in [`frontend/tests`](../frontend/tests), notably `preauth-desktop.spec.ts`, `workspace-ux.spec.ts`, `shell-settings.spec.ts`, `reports-viewer.spec.ts`, `agent-fleet.spec.ts` and `riverside.spec.ts`. See [14g](14g-frontend-development.md) for running the right test groups and browser configuration.
