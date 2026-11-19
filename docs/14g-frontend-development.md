# 14g · Frontend development

**Depends on:** [14](14-frontend.md), [14a](14a-frontend-architecture.md), [14c](14c-frontend-adapters.md), [16](16-configuration-and-deployment.md)

**Status:** Implemented (mock)

Commands below run from the `frontend` directory with `npm`. Examples use a POSIX shell (macOS/Linux); PowerShell equivalents are shown where environment variables are set.

> Windows PowerShell tip: if the execution policy blocks the `npm.ps1` shim, use `npm.cmd` in place of `npm`.

## Install and run locally

[`package.json`](../frontend/package.json) declares Node.js `>=24.0.0` and package manager `npm@11.6.2`. CI and `infra/docker/frontend.Dockerfile` use Node 24 too ([16](16-configuration-and-deployment.md)). Install dependencies from the frontend lockfile:

```sh
cd frontend
npm ci
npm run dev
```

Open the URL Vite prints; the default is usually `http://127.0.0.1:5173`. To pin the port and fail if it is busy:

```sh
npm run dev -- --port 5173 --strictPort
```

The mock frontend runs without a backend. If `VITE_SERVICE_MODE` is `api` or `hybrid` and no factory is registered, the app reports a configuration error. Run the mock explicitly:

```sh
VITE_SERVICE_MODE=mock npm run dev
```

```powershell
$env:VITE_SERVICE_MODE = 'mock'; npm run dev
```

## Running against the API

**Status:** Implemented (API) for every port except chat, which stays mock until its adapter (S12b).

- `VITE_SERVICE_MODE=hybrid` selects the API adapters in [`src/adapters/api/`](../frontend/src/adapters/api/) for auth, preferences, notifications, reports, dashboard, admin users, agent chat, the agent builder and the admin console; services without an adapter keep their mock.
- `npm run dev` proxies `/api` to `VITE_API_PROXY` (default `http://127.0.0.1:8010`, the local `make up` port). `VITE_API_BASE` prefixes every request when the API is on another origin.
- The compose `frontend` image is built with `VITE_SERVICE_MODE` (default `hybrid`) and reached through the Caddy proxy (started by `make up`, port 8080), so the SPA and `/api` share one origin and the `contoso_session` cookie.
- Log in with a real username (set `DEMO_PASSWORD` in `.env` and `make up` creates `alice` and `bob`); the login form asks for a username, and mock accounts type their email there.

## Demo accounts

| Role | Email | Sample password |
| --- | --- | --- |
| `USER` | `user@vdaagent.test` | `DemoUser!2026` |
| `ADMIN` | quick access button | No password in the frontend bundle |

The user credential is fixed in [`mocks/auth/fixtures.ts`](../frontend/src/mocks/auth/fixtures.ts). The mock admin quick access simulates the server-side demo entry; it has no privileged password. The mock session lasts eight hours and is stored in sessionStorage. For the real API, set `DEMO_MODE=true` and `DEMO_ADMIN_PASSWORD` in the private backend environment, then run `make seed-demo`. The admin demo button creates a normal cookie session for the separate `admin-demo` account.

## Build and preview

```sh
npm run build
npm run preview -- --port 4173 --strictPort
```

Build runs the TypeScript check then Vite and produces `frontend/dist`. Preview serves the built bundle at `http://127.0.0.1:4173` to check the production bundle. SPA hosting needs a history fallback to `index.html` so refresh/deep links such as `/reports/R010` work.

## Check scripts

| Command | Current scope |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | ESLint, no warnings allowed. |
| `npm test` | Vitest TS/TSX in `src` and `tests`, jsdom environment. |
| `npm run test:watch` | Vitest watch. |
| `npm run test:domain` | Feature-owned legacy `.test.mjs` suites only; the TS/TSX tests run through `npm test`. |
| `npm run test:browser` | `tests/**/*.spec.ts` files via Playwright. |
| `npm run build` | Typecheck and production build. |

[`vite.config.ts`](../frontend/vite.config.ts) holds the main Vitest config; [`vitest.legacy.config.ts`](../frontend/vitest.legacy.config.ts) adds the `.test.mjs` glob. `.test.ts` files in `tests` are Vitest; `.spec.ts` files are Playwright. Do not infer that a test group ran from its folder name alone.

Run the group matching your change, for example:

```sh
npm test -- src/features/chat/tests/riverside-fleet.test.ts
npm test -- src/features/reports/tests/schema.test.ts
npm run test:browser -- tests/riverside.spec.ts tests/reports-viewer.spec.ts
```

These commands are instructions, not a record that every suite passes in the current environment.

## Browser and server for Playwright

[`playwright.config.ts`](../frontend/playwright.config.ts) runs serially with one worker. Its default Chrome path is Windows-specific: `C:/Program Files/Google/Chrome/Application/chrome.exe`. On macOS/Linux, or if Chrome is elsewhere, set `CHROME_PATH` to the real executable:

```sh
# macOS
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:browser
# Linux
CHROME_PATH=/usr/bin/google-chrome npm run test:browser
```

```powershell
$env:CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'; npm run test:browser
```

Without `WORKSPACE_BASE_URL`, Playwright starts its own Vite server on port 5179 with `--strictPort`; it does not reuse an existing server. With the URL set, tests use that server and do not start one:

```sh
WORKSPACE_BASE_URL=http://127.0.0.1:4173 npm run test:browser -- tests/report-schema.spec.ts
```

```powershell
$env:WORKSPACE_BASE_URL = 'http://127.0.0.1:4173'; npm run test:browser -- tests/report-schema.spec.ts
```

The preview server must already run in another terminal. Failure screenshots and the HTML reporter follow the Playwright config; review test artifacts before adding them to Git.

## Mock scenarios

[`mocks/core/scenarios.ts`](../frontend/src/mocks/core/scenarios.ts) is the list bootstrap accepts. The scenario is read when mock services are created; changing it needs a full navigation/reload. Invalid values fall back to `success`. Each feature applies scenarios in its own way; not every page reacts the same.

| Group | Values |
| --- | --- |
| Basic | `success`, `loading`, `empty`, `error`, `offline`, `expired-session`, `storage-unavailable`. |
| Chat delivery | `demo-replay`, `duplicate-delivery`, `out-of-order`, `interrupted`, `unknown-ack`, `unsupported-capability`. |
| Long data/stress | `long-conversation`, `performance`. |
| Report parts | `report-no-chart`, `report-no-kpi`, `report-multiple-charts`, `report-partial`. |
| Report schema and fallback | `report-showcase`, `report-unknown-chart`, `report-invalid-chart`, `report-unknown-schema`, `report-unknown-type`, `report-empty-schema`, `report-large-table`. |

Example URLs after signing in:

```text
/chat?scenario=demo-replay
/reports?scenario=report-no-chart&report=R001&version=R001-v2
/reports?scenario=report-showcase&report=R019&version=R019-v2
/reports?scenario=report-large-table&report=R019&version=R019-v2&view=detail
/chat?conversation=riverside-r010-group
/reports?report=R010&version=R010-v2&view=dashboard
```

Riverside is available in the default `success` scenario; there is no URL scenario named `riverside`. Codes `S01`, `S08`, `S18` in `mocks/reports/scenarios.ts` are test fixture factories, not valid `scenario` query values.

Chat is stored per principal in IndexedDB and is not separated by `scenario` query. For a clean demo, use reset in `/setting` or a fresh test browser context. See [14a](14a-frontend-architecture.md) for the exact reset/storage scope.

## Extra evidence and profiling

The repo also has scripts run directly with Node, outside `test:browser`:

| Script | Default server | Output |
| --- | --- | --- |
| `scripts/dashboard-evidence.mjs` | `http://127.0.0.1:5186` | Screenshots and `measurements.json` in `docs/plan/evidence/compact-dashboard/<stage>`. |
| `scripts/dashboard-profile.mjs` | `http://127.0.0.1:4186` | `performance.json` and traces when recorded, in the same per-stage folder. |
| `src/features/reports/tests/browser-workspace.mjs` | `http://127.0.0.1:5173` | Evidence in `docs/implementation/frontend/workspace-artifacts`. |
| `src/features/reports/tests/browser-profile.mjs` | `http://127.0.0.1:4173` | `production-profile.json` in the workspace-artifacts folder. |

These scripts need a running server; `WORKSPACE_BASE_URL` overrides the default URL. The two `browser-*.mjs` scripts require `CHROME_PATH`. The two dashboard scripts take a stage argument, default `after`.

Example with preview running on port 4173, from `frontend`:

```sh
WORKSPACE_BASE_URL=http://127.0.0.1:4173 \
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
node scripts/dashboard-profile.mjs after
```

```powershell
$env:WORKSPACE_BASE_URL = 'http://127.0.0.1:4173'
$env:CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
node scripts/dashboard-profile.mjs after
```

Output folders may be created at run time; they are not reference docs expected to exist. Record environment, command, output and measurement limits when reporting results. Do not use numbers from an old run to claim performance after a new change.

## Common problems

| Symptom | Check |
| --- | --- |
| Service startup error | `VITE_SERVICE_MODE` and the factories passed in `main.tsx`. |
| Scenario does not change | Reload after changing the query; check the value in `scenarios.ts` and stored chat data. |
| Browser tests cannot open Chrome | `CHROME_PATH` must point to an existing executable (the default is a Windows path). |
| Port 5173 busy | Use the server already running or set `WORKSPACE_BASE_URL` to another server. |
| Preview shows no app | Build first; preview does not compile edited source. |
| Deep route reload returns 404 when hosted | Configure SPA history fallback on the host. |
| Storage degraded, draft needs re-attachment | Check storage permission; attachment bytes are not persisted. |
