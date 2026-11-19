# 14 · Frontend

The browser app: chat with the agent team, the builder, the workspace pages (business dashboard, reports, user notifications, settings) and the admin pages. **Depends on:** [08](08-communication.md), [05](05-agent-builder.md), [13](13-observability.md), [15](15-api.md), [19](19-reports-dashboard-notifications.md).

The **look** (tokens, components, typography, icons, motion, charts) comes from the frontend already built in [`frontend/`](../frontend). The **behaviour** (routes, flows, chat layout, builder, admin, realtime) follows this spec ([decision 0022](decisions/0022-ui-from-refactor-ux-from-spec.md)). Where the built frontend still behaves differently, [Current implementation vs target](#current-implementation-vs-target) lists the gap.

**Status labels.** Every feature is one of:

| Label | Meaning |
|---|---|
| Implemented (mock) | Built and tested in the browser against in-memory mock services. |
| Implemented (API) | Built and wired to the real API through an adapter ([14c](14c-frontend-adapters.md)). |
| Planned | Specified here; not built yet. |

## Sub-documents

| Doc | Covers |
|---|---|
| [14a-frontend-architecture.md](14a-frontend-architecture.md) | Source layout, feature registration, providers, state ownership, storage, visual system and motion |
| [14b-frontend-pages.md](14b-frontend-pages.md) | Every route as built today: access rules, behaviour, query parameters |
| [14c-frontend-adapters.md](14c-frontend-adapters.md) | Service ports, runtime modes (`mock`/`api`/`hybrid`), data mapping, how adapters map onto the API |
| [14d-frontend-chat-mock.md](14d-frontend-chat-mock.md) | The current mock chat ("Agent Fleet") and the Riverside scenario |
| [14e-report-viewer.md](14e-report-viewer.md) | Reports library and viewer: versions, history, focus, downloads |
| [14f-report-schema.md](14f-report-schema.md) | Report schema v1, decoders, blocks, chart registry |
| [14g-frontend-development.md](14g-frontend-development.md) | Install, run, demo accounts, mock scenarios, test commands |

## Stack

**Status:** Implemented (mock).

- React 19 + TypeScript + Vite; React Router; i18next for Vietnamese and English. Exact versions are locked in [`frontend/package.json`](../frontend/package.json) and `frontend/package-lock.json`.
- Plain CSS with design tokens ([`shared/styles/tokens.css`](../frontend/src/shared/styles/tokens.css)); Radix primitives for overlays; shared components in [`shared/ui`](../frontend/src/shared/ui).
- Charts are drawn by the app's own SVG renderer ([`shared/charts`](../frontend/src/shared/charts), [14f](14f-report-schema.md)); motion uses GSAP through `useAnalyticalMotion`.
- No query-cache library. Pages read through feature service ports with `useServiceRead`, which cancels stale requests ([14a](14a-frontend-architecture.md)).
- **Planned:** Markdown rendering of agent messages and Markdown files with GFM tables and syntax-highlighted code; virtualised timelines for long threads. Libraries are chosen when the chat is wired to the API.
- **Serving.** The frontend is its own container: `infra/docker/frontend.Dockerfile` builds `dist/` and serves it with nginx, falling back to `index.html` for client routes. A reverse proxy sends `/api` to `api` on port 8000 ([16](16-configuration-and-deployment.md)). **Planned:** in development, Vite proxies `/api` to `http://localhost:8000`.

## Visual design

**Status:** Implemented (mock).

- **Tokens.** `tokens.css` defines colour, typography, spacing, radius, elevation and motion; `globals.css` applies theme, density and focus rules. Themes are `light`, `dark` and `system` (follows `prefers-color-scheme`).
- **Type and icons.** Be Vietnam Pro (bundled through `@fontsource`), Lucide icons, brand assets in `frontend/public/icon`.
- **Density and motion.** `comfortable`/`compact` density; reduced motion follows the OS or the app preference and skips every reveal.
- **Agent avatars** are an emoji on the agent's `avatar.color` ([10](10-data-model.md#agents)); the lead's avatar is ★. **Planned:** the default avatar palette is defined as tokens so it works in both themes.

Details: [14a](14a-frontend-architecture.md#ui-and-motion).

## Routes

| Route | Role | Screen | Status |
|---|---|---|---|
| `/login` | anonymous | pre-auth desktop with the login window ([19](19-reports-dashboard-notifications.md#pre-auth-desktop)) | Implemented (mock) |
| `/chat/:threadId?` | user | chat app ([layout](#chat-app-layout-three-panes)) | Planned (mock at `/chat?conversation=`) |
| `/` | user | business dashboard | Implemented (mock) |
| `/reports` | user | reports library and viewer ([14e](14e-report-viewer.md)) | Implemented (mock) |
| `/reports/:id` | user | compatible deep link into the viewer | Implemented (mock) |
| `/notifications` | user | user notification inbox | Implemented (mock) |
| `/setting` | user | personal preferences | Implemented (mock) |
| `/agents` | user | agent list with status and "Tạo agent mới" | Implemented (API) |
| `/agents/new` | user | creation dialog ([05](05-agent-builder.md)) | Implemented (API) |
| `/agents/:id/:tab` | user | builder: `info`, `role`, `skills`, `libraries`, `routines`, `data`, `folder` | Implemented (API) |
| `/admin` | admin | admin overview ([13](13-observability.md#chat-trace-view)) | Implemented (API) |
| `/admin/users` | admin | user management ([12](12-auth-and-domains.md#user-management-admin-page-người-dùng)) | Implemented (API); mock page in mock mode |
| `/admin/trace/:agentId` | admin | chat-trace timeline | Implemented (API) |
| `/admin/threads/:threadId` | admin | thread mode | Implemented (API) |

- **Landing.** After login, a user lands on `/chat` (the lead's direct thread) and an admin on `/admin`; the mock runtime keeps its documented demo landing (`/` and `/admin/users`). An anonymous visitor to a protected route goes to `/login`; a signed-in visitor to `/login` goes to their landing route.
- **Role mismatch.** User routes are hidden from admins, and admin routes from users. Opening one shows the "no access" state inside the shell. Route guards only shape the UI; `api` checks every request ([12](12-auth-and-domains.md#roles-and-authorization)).
- **Unknown paths** show a not-found screen.

## Shell

**Status:** Implemented (mock) for navigation and layout; Implemented (API) for the header theme toggle and the domain banner.

- **Navigation by role.** User: Chat, Dashboard (`/`), Reports, Notifications (with the unread count), Agents, Settings. Admin: Overview, Users. A rail on wide screens, a drawer on narrow ones.
- **Header.** The account menu (display name, logout) and a quick **theme toggle** (light → dark → system), which saves the same `theme` preference as `/setting` ([19](19-reports-dashboard-notifications.md#preferences)).
- **Domain banner.** When the user's domain is `unavailable`, every user page shows "Miền dữ liệu đang lỗi cấu hình, liên hệ quản trị viên" and the composer is disabled ([12](12-auth-and-domains.md#validation-at-boot)).
- **Frames.** Ordinary pages scroll inside a page frame; the chat uses a `viewport` frame so its panes scroll on their own.

## Chat app layout: three panes

**Status:** Implemented (API) in `hybrid`/`api` mode: [`AgentChatPage`](../frontend/src/features/chat/pages/AgentChatPage.tsx) on the `agent-chat` port ([14c](14c-frontend-adapters.md#target-chat-port)), routed at `/chat` and `/chat/:threadId`. Mock mode keeps the scripted chat of [14d](14d-frontend-chat-mock.md) ([gap table](#current-implementation-vs-target)). The composer's domain-unavailable state comes from `Me.domain` (`Session.domain`), and the info pane's **Lịch** shortcut links to `/agents/:id/routines` with the next fire times below it. The read mark is sent when the thread is open in a visible tab and a newer message has loaded.

```text
┌──────────────┬───────────────────────────────────┬──────────────┐
│ 🔍 Tìm kiếm  │ ★ Điều phối  [Trưởng nhóm]   ⓘ  │   ★          │
│ ★ Điều phối📌│                                   │ Điều phối    │
│ D Data       │        [user bubble, right]       │ ● đang làm   │
│ I Insight    │ [agent bubble, left]              │ 📋 T42        │
│ C Chart      │ [report card R7-v1]               │ 📁 Thư mục    │
│ 👥 Nhóm Q3   │ [choices: PDF | Excel]            │ ⚙️ Tùy chỉnh  │
│ + Nhóm mới   │ [ Nhập tin nhắn…          📎 ➤ ]  │ ⏰ Lịch (2)   │
└──────────────┴───────────────────────────────────┴──────────────┘
```

### Left pane: chat list
- **Contact search** filters the list by name. It doesn't search message text.
- **The lead** is pinned first. Then come direct and group threads ordered by `last_message_at`. Each row has an avatar, name, the last message preview (sender prefix in groups), a time, and an unread badge (messages after `last_read_message_id`).
- **Deleted agents' threads** are dimmed and read-only.
- **"Nhóm mới"** opens a dialog: a group name, then pick at least two agents (the lead is optional). This calls `POST /api/threads`.

### Centre pane: conversation
- **Header:** avatar, name, a "Trưởng nhóm" tag for the lead, and the agent's **status** from `agent.status`: "đang làm việc…", "đang chạy lịch <name>", "đang sắp xếp trí nhớ…" (compacting) or nothing when idle. Agents are silent by default, so the status is all the user sees of their work; there is no token streaming. A group header shows member avatars and each member's status on hover.
- **Task banner** (lead direct thread only): the running task's description and elapsed time, the queued count, and a **Hủy** button (`POST /api/tasks/{id}/cancel`, with confirmation).
- **Messages:** user messages on the right, agent messages on the left, using the bubble styles of the current chat components. Group messages show the sender's avatar and name. System messages (e.g. context overflow) are centred and muted. Day separators appear between dates.
  - Text is rendered as Markdown (GFM tables, code).
  - Attachments: images inline (click to open full size); CSV as a 50-row preview table with a download button; other files as a card (icon, name, size, download).
  - **Report references** (`report_refs`, [19](19-reports-dashboard-notifications.md#in-chat)) render as the existing report reference card, which reads the report's status and opens the saved version in the viewer. Closing the viewer returns to the message ([14e](14e-report-viewer.md)).
  - Choices are chips under the bubble. Clicking one posts a reply with `choice_id`; once the message has a reply, its chips are locked and the chosen one is highlighted.
- **Composer:** a multiline textarea (Enter sends, Shift+Enter makes a new line), an attach button (up to 10 files of 20 MB each, any type) and a send button. Disabled when the thread is read-only or the domain is unavailable. No mentions and no slash commands: in a group, every member receives every message ([08](08-communication.md#threads)).
- **Reading and history:** `POST /api/threads/{id}/read` is called when the newest message is visible. Older messages are loaded as the user scrolls up (`before=`).

### Right pane: info (can be hidden)
- **Agent thread:** a large avatar, name, description and status; the current task (if involved); shortcuts to **Thư mục** (`/agents/:id/folder`), **Tùy chỉnh** (`/agents/:id/role`) and **Lịch** (next fire times).
- **Group:** the member list, with add/remove (`PATCH /api/threads/{id}`) and rename.

### Narrow screens
Below 768 px, one pane is shown at a time (list, then conversation, then info), with back buttons.

## Builder screens

**Status:** Implemented (API) on the `agent-builder` port ([14c](14c-frontend-adapters.md)); not built in mock mode (the feature registers only when the port exists).

`/agents/:id/:tab` uses the same left pane, with the agent list instead of threads. The main pane has tabs across the top ([05](05-agent-builder.md#tabs)).
- **Kỹ năng:** a grid of catalog cards (title, description, tags, "Đã cài"), with tag filters and search. Clicking a card opens a preview with the rendered `SKILL.md`, the file list, a code warning and an install button. Below the grid: "Cài từ GitHub" (URL field) and "Kỹ năng hiện có" (every `skills/*` entry, with remove).
- **Thư viện:** preset cards with an "Áp dụng" button, then the installed package table with remove buttons, and a field to add one package.
- **Lịch:** a list of routines (name, schedule in words, next fire, on/off), and an editor dialog with the prompt, the schedule picker and "Nâng cao" raw cron.
- **Dữ liệu:** the domain's credential sets as toggle rows, showing the description and key names.
- **Thư mục:** the tree on the left, the file or directory view on the right, a breadcrumb, a "Phiên bản" selector (commit log) for `at=`, and a download button for the archive ([04](04-agent-folder.md#folder-viewer)).
- **Job progress:** while a builder job runs, a progress toast follows its `builder.job` events. When it fails, the toast shows the error output.

## Workspace pages

These pages extend the PoC. Their UI and behaviour are the built ones ([14b](14b-frontend-pages.md)); their backend is [19](19-reports-dashboard-notifications.md).

| Page | Status | Behaviour | Backend |
|---|---|---|---|
| Business dashboard `/` | Implemented (mock) | KPIs for inventory, slow-inventory share and transactions; age and trend charts; attention items; project priorities; recent reports; task counts; inspect panels ([14b](14b-frontend-pages.md#business-dashboard--)) | dataset published by the `data` agent, computed in the browser ([19](19-reports-dashboard-notifications.md#business-dashboard)) |
| Reports `/reports` | Implemented (mock) | Card library with search, filters, sort, pagination; viewer dialog with report overview, document, versions, evidence and downloads ([14e](14e-report-viewer.md)) | reports published by agents ([19](19-reports-dashboard-notifications.md#reports-library)) |
| User notifications `/notifications` | Implemented (mock) | All/unread tabs, kind filters, day groups, detail panel, mark read, open target ([14b](14b-frontend-pages.md)) | [19](19-reports-dashboard-notifications.md#user-notifications) |
| Settings `/setting` | Implemented (mock) | Display name, theme, density, locale, timezone, notification groups, motion; preview, save, cancel, unsaved-change guard ([14b](14b-frontend-pages.md)) | [19](19-reports-dashboard-notifications.md#preferences) |

## Admin screens

**Status:** Implemented (API) on the `admin-console` port ([14c](14c-frontend-adapters.md)); `/admin/users` keeps the mock page when no admin console is configured.

- `/admin`, `/admin/trace/:agentId` and `/admin/threads/:threadId` are specified in [13](13-observability.md#chat-trace-view).
- `/admin/users` follows [12](12-auth-and-domains.md#user-management-admin-page-người-dùng): create (username, password, domain, optional display name), provisioning status with retry, disable/enable, reset password, reset agent. The built page keeps its list, filters, detail panel and confirmation dialogs ([14b](14b-frontend-pages.md)).

## Realtime

**Status:** Implemented (API) for `message.created`, `agent.status`, `task.updated`, `thread.updated`, `notification.*`, `builder.job`, `report.updated` and presence; the admin trace stream is opened per watched agent on `/admin/trace/:agentId`. On reconnect the chat re-reads agents, threads, tasks and the open thread's newest page.

- **One SSE connection per browser tab:** `GET /api/stream`, scoped to the logged-in user.

| Event | Payload | Client action |
|---|---|---|
| `message.created` | message with attachments and `report_refs` | append to the thread; bump the chat list; unread badge |
| `agent.status` | `{agent_id, status, status_detail}` | header and list status |
| `task.updated` | task row | task banner |
| `thread.updated` | thread row | chat list |
| `builder.job` | `{job_id, agent_id, kind, status, output_tail}` | progress toast; re-read the agent's builder data when done (the admin users page polls while a user is provisioning, since provisioning jobs publish on the new user's channel) |
| `report.updated` | `{report_id, status, version_id?}` | re-read the reports list and any open card or viewer for that report |
| `notification.created` | user notification | prepend to the inbox; unread count |
| `notification.read` | `{ids}` or `{all: true}` | update read state |

- **Reconnect** uses `EventSource`'s automatic retry, with no event replay. On reconnect, every mounted service read is issued again, so the screen reflects the server.
- **Presence:** on `window` `focus` and on load, the client calls `POST /api/presence`; the server debounces it ([07](07-routing-and-queue.md#user-opened-the-app)).
- **Admin trace:** the trace view opens `GET /api/admin/agents/{id}/stream` for `event.appended` and `agent.status`.

## Language

**Status:** Implemented (mock).

The UI is in Vietnamese (default) and English ([decision 0021](decisions/0021-bilingual-ui.md)). Locale changes control labels and number, date and time formats. Agent messages, saved reports and Riverside content keep the language they were written in. API errors carry a Vietnamese `message`, but the frontend shows its own text per error code and never displays the raw server message ([14c](14c-frontend-adapters.md)).

## Current implementation vs target

What the built frontend does today and what the target above requires. In `hybrid`/`api` mode the chat rows (route, agents, chat list, message content, composer, right pane, narrow chat), the builder, folder viewer, admin and trace rows, SSE and presence follow the target; the Current column describes mock mode.

| Area | Current (mock) | Target |
|---|---|---|
| Login | Email + password; 8-hour mock session in `sessionStorage` | Username + password through `POST /api/auth/login`; `contoso_session` cookie ([12](12-auth-and-domains.md)). The desktop and its login window stay. |
| Landing | User → `/`; admin → `/admin/users` | User → `/chat`; admin → `/admin` |
| Roles | `USER` / `ADMIN` in the frontend contract | API sends `user` / `admin`; the adapter maps them |
| Chat route | `/chat?conversation=<id>` | `/chat/:threadId?` |
| Agents | Six fixed agents (`orchestrator`, `data`, `compare`, `chart`, `insight`, `report`) with a capability model | Built-in `lead` ("Điều phối") + domain starters + user-created agents (max 12) |
| Chat list | Agent catalog, demo groups, history | Lead pinned, threads by `last_message_at`, unread badges, dimmed read-only threads |
| Message content | Structured blocks (KPI, chart, report reference, details, action); `pending`/`responding`/`interrupted` states | Markdown, attachments, choice chips, report reference cards; messages arrive whole; agent status line and task banner |
| Composer | 5 files × 10 MiB of CSV/XLSX/PDF/PNG/JPEG, metadata only; `@` mentions; `/report` command | 10 files × 20 MB of any type, uploaded; no mentions or commands |
| Right pane | Inspector: skills, tools, MCP, public principles, capabilities | Info pane: status, current task, Thư mục / Tùy chỉnh / Lịch shortcuts; group members |
| Narrow chat | Side areas become drawers | One pane at a time with back buttons |
| Theme toggle | Settings page and pre-auth desktop | Also in the app header |
| Admin users | Lists `USER` accounts; disable/enable with `expectedRevision` + `operationId` | Create with domain, provisioning and retry, reset password, reset agent ([12](12-auth-and-domains.md)) |
| Report downloads | HTML and CSV as text | HTML, CSV, DOCX, PDF and XLSX as binary files |
| Notification targets | Chat targets point at `?conversation=` | Chat targets point at `/chat/:threadId` |
| Builder, folder viewer, admin overview and trace, SSE, presence | Not built | As specified above |

## Mock walkthrough

With the mock runtime ([14g](14g-frontend-development.md)):

1. Open `/login` and sign in with the demo `USER` account.
2. Open `/` for the business dashboard by date range, market and project.
3. Open `/chat?conversation=riverside-r010-group` for the Riverside group with its finished analysis ([14d](14d-frontend-chat-mock.md)).
4. From the report card in chat, open the saved version `/reports?report=R010&version=R010-v2&view=dashboard`.
5. Switch to the document, pick a version, or download an artifact of the version shown.

The desktop at `/login` previews only public fixture content. The Riverside conversation is pre-written; new questions in it don't call a model, and replies in other demo threads are fixed text. Attachments aren't uploaded or analysed.

## Not in the PoC

Voice input, push notifications, editing or deleting messages, message search, editing files in the folder viewer. See [99](99-risks-and-future-work.md).

## Sources to check

When editing these docs, read [`package.json`](../frontend/package.json), [`App.tsx`](../frontend/src/app/App.tsx), [`feature-registry.ts`](../frontend/src/app/feature-registry.ts), the `features/*/services` interfaces and the tests next to each feature. Link only to source that exists, keep mock scenarios (URL) apart from test-only fixtures, and keep the business dashboard apart from the overview of one saved report.
