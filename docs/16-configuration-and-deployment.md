# 16 · Configuration and deployment

The project is one docker compose stack. **Depends on:** [02](02-architecture.md), [11](11-sandbox.md), [12](12-auth-and-domains.md), [13](13-observability.md).

## Repository layout

```text
pyproject.toml          uv workspace root; members agents/, backend/, eval/
backend/                the api service: backend.main:app, alembic/, tests/, pyproject.toml
agents/                 agent-side Python package (uv member), pyproject.toml
eval/                   agent evaluation (make eval → eval.runners.run_smoke_eval), pyproject.toml
frontend/               React app, own nginx image
infra/docker/           backend.Dockerfile, frontend.Dockerfile
infra/Caddyfile         reverse proxy: /api → backend:8000, rest → frontend:80 (CI copies it)
workspace/              Dockerfile, execd/ (+ requirements*.txt), contoso/, tests/
domains/
  fabrikam/                    domain.yaml, credentials/*.env.example (12, 18)
deploy/
  langfuse.compose.yaml  Langfuse services, vendored from langfuse/langfuse docker-compose.yml (tag v4.63.0, images :4), postgres removed
  postgres/init/10-langfuse.sql
  postgres/test-init/20-contoso-test.sql   contoso_test database for compose.test.yaml
.github/workflows/      ci-cd.yml
scripts/                (empty)
docs/                   this documentation (+ vi/)
docker-compose.yml  compose.test.yaml  .env.example  .dockerignore  Makefile  uv.lock

Planned (not in the repo yet):
platform/
  agent-skeleton/       folder every agent starts from (04)
  lead/prompt.md        generic lead role
  rules.md              platform rules rendered into every system prompt (06)
  compaction.md         compaction prompt (06)
  jev_criteria.yaml     jev classification criteria, Decisions API (07)
  seeds/skills.yaml, seeds/library_presets.yaml
domains/<id>/starters/, domains/<id>/seeds/    (12, 18)
```

The uv workspace members are virtual (`[tool.uv] package = false`): they hold dependencies only, and the code is imported from the repo root (`PYTHONPATH=/app` in the image), so `backend.main:app` and `python -m eval.runners…` work without installing the members as distributions.

## Current state

**Status:** Implemented (S0 scaffolding).

| Item | State today |
|---|---|
| `docker-compose.yml` | the stack below: `backend`, `frontend`, `workspace`, `postgres`, the included Langfuse services, and an optional `proxy` (Caddy, profile `proxy`) |
| `pyproject.toml` (root, `agents/`, `backend/`, `eval/`) | uv workspace with `uv.lock`; ruff and pytest config in the root file |
| `backend/` | `main.py` (app factory, boot step 1, `GET /api/health`), `settings.py`, `preflight.py`, `init_env.py`, `domains/validate.py` (rules 1–3 of [12](12-auth-and-domains.md#validation-at-boot)), `tests/` |
| `workspace/` | image per [11](11-sandbox.md#image); `execd` serves `GET /health` and authenticated `POST /exec`, applies filesystem isolation and takes Git snapshots; `workspace/prewarm.py` fills the shared uv cache |
| `infra/docker/backend.Dockerfile` | `python:3.12-slim` + uv 0.9.30, `git`, `curl`, `uv sync --frozen`, uid 1000, healthcheck `/api/health`; a `test` stage adds the dev group |
| `infra/docker/frontend.Dockerfile` | `node:24-alpine` (`deps` → `source` → `builder`) + `nginx:alpine`, SPA fallback, port 80, context `./frontend` |
| `Makefile` | see [Makefile](#makefile) |
| CI/CD (`.github/workflows/ci-cd.yml`, "VDaAgent CI/CD") | on push/PR to `main`: Python job with a `postgres:17` service (`uv sync --frozen --all-packages`, ruff on `agents backend eval workspace`, `pytest` with `MODEL_BACKEND=fake`, then the `execd` tests); frontend job on Node 24 (`npm ci`, lint, build, `npm test`, `npm run test:domain`) |
| Deploy | on push to `main`: publishes `backend`, `frontend` and `workspace` images to GHCR and deploys the matching commit tags. Copies compose, Caddy, `deploy/`, `platform/` and domain templates; preserves an existing installation's configuration when upgrading its directory name. Requires an operator-configured `.env`, validates compose, pulls all three app images and starts with `--no-build --wait`. Deploy jobs run serially. |

Everything else in this page is the target design (**Status:** Planned) unless marked otherwise.

## Root `.env`

Run `make setup` first ([Getting started](#getting-started)). It copies `.env.example` to `.env` if there is no `.env` yet. Then it fills every **generated** key that is missing or empty with a random value: `secrets.token_urlsafe(32)`, 64 hex characters for `LANGFUSE_ENCRYPTION_KEY`, and `pk-lf-<uuid>` / `sk-lf-<uuid>` for the Langfuse keys. It creates each missing `domains/<id>/credentials/<set>.env` from its `.env.example` (mode 600). It never overwrites a value or a file that is already there. It prints only names: the keys it filled, the files it created, and, per file, the empty keys the operator still has to fill in (the operator keys of `.env`, `DEMO_PASSWORD` as optional, and every empty credential key). It is `python -m backend.init_env` (standard library only) in a `python:3.12-slim` container, so it needs no image build.

| Key | Source | Meaning |
|---|---|---|
| `OPENROUTER_API_KEY` | **operator** | the only model credential ([decision 0008](decisions/0008-platform-openrouter-key-no-byok.md)) |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | **operator** | first admin; also the Langfuse login password |
| `DEMO_PASSWORD` | **operator**, optional | when set, `make up` creates the demo users `alice` and `bob` (both fabrikam) with this password |
| `AGENT_MODEL` | default `anthropic/claude-haiku-4.5` | activations |
| `JEV_MODEL` | default `typesafe/jev-1.14` | jev, via OpenRouter's Decisions API |
| `JEV_CONFIDENCE_FLOOR` | default `0.6` | below this, jev's `confidence` forces `label` to `side_question` ([07](07-routing-and-queue.md#classification)) |
| `COMPACTION_MODEL` | default = `AGENT_MODEL` | compaction |
| `OPENROUTER_BASE_URL` | default `https://openrouter.ai/api/v1` | |
| `POSTGRES_PASSWORD`, `SESSION_SECRET`, `EXECD_TOKEN` | generated | |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | generated | project keys (headless init + SDK) |
| `LANGFUSE_NEXTAUTH_SECRET`, `LANGFUSE_SALT`, `LANGFUSE_ENCRYPTION_KEY` | generated | Langfuse internals |
| `CLICKHOUSE_PASSWORD`, `REDIS_AUTH`, `MINIO_ROOT_PASSWORD` | generated | Langfuse datastores |
| `LANGFUSE_INIT_USER_EMAIL` | default `admin@contoso.local` | Langfuse login |
| `LANGFUSE_PUBLIC_URL` | default `http://localhost:3100` | links and `NEXTAUTH_URL` |
| `APP_PORT` | default `8000` | published API port |
| `APP_URL` | default `http://localhost:${APP_PORT}` | `HTTP-Referer` for OpenRouter |
| `COOKIE_SECURE` | default `0` | set `1` behind HTTPS |
| `GITHUB_TOKEN` | optional | higher GitHub rate limit for skill installs |
| `MODEL_BACKEND` | default `openrouter` | `fake` for tests ([17](17-testing.md)) |
| `MODEL_CONTEXT_TOKENS` | optional | overrides the window that is otherwise read from OpenRouter `GET /models` (`context_length`) at boot |
| Tunables | defaults in code | `SOFT_CONTEXT_RATIO=0.6`, `HARD_CONTEXT_RATIO=0.9`, `OFFLOAD_CHARS=8000`, `OFFLOAD_HEAD_CHARS=2000`, `OFFLOAD_TAIL_CHARS=2000`, `EXEC_TIMEOUT_S=120`, `EXEC_MEM_MB=2048`, `MAX_STEPS_PER_ACTIVATION=50`, `MODEL_TIMEOUT_S=120`, `TASK_MAX_S=3600`, `JEV_K=20`, `MAX_AGENTS_PER_USER=12` |

`backend/settings.py` reads them with `pydantic-settings`. The process environment wins over `.env`, and an empty value counts as unset (so the default applies). Compose also sets `DATABASE_URL`, `EXECD_URL`, `LANGFUSE_BASE_URL`, `DOMAINS_DIR` (`/domains`) and `PLATFORM_DIR` (`/platform`) for `backend`; they aren't in `.env.example`.

**Preflight.** `make check`, which also runs first in `make up` and at the start of `api` boot, lists missing or empty required keys and invalid domains (by key or file name, never by value). It exits non-zero on a missing platform key, and `api` refuses to boot. An invalid domain only makes that domain `unavailable`. The required platform keys are `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `POSTGRES_PASSWORD`, `SESSION_SECRET`, `EXECD_TOKEN`, and `OPENROUTER_API_KEY` unless `MODEL_BACKEND=fake`. Missing Langfuse keys are reported but not fatal (tracing is off, [13](13-observability.md#langfuse-in-the-compose-stack)).

Domain credentials live in `domains/<id>/credentials/<set>.env` ([12](12-auth-and-domains.md#credentials-flow)), not in the root `.env`.

## Compose

```yaml
# docker-compose.yml (sketch; full Langfuse env in deploy/langfuse.compose.yaml)
name: contoso
include:
  - deploy/langfuse.compose.yaml
services:
  backend:              # called `api` in these docs
    build: {context: ., dockerfile: infra/docker/backend.Dockerfile}
    env_file: .env
    environment:
      DATABASE_URL: postgresql+asyncpg://contoso:${POSTGRES_PASSWORD}@postgres:5432/contoso
      EXECD_URL: http://workspace:7000
      LANGFUSE_BASE_URL: http://langfuse-web:3000
    user: "1000:1000"
    ports: ["127.0.0.1:${APP_PORT:-8000}:8000"]
    volumes:
      - folders:/data/folders
      - attachments:/data/attachments
      - reports:/data/reports
      - ./domains:/domains:ro
      - ./platform:/platform:ro
    networks: [app, exec]
    depends_on:
      postgres: {condition: service_healthy}
      workspace: {condition: service_healthy}
    healthcheck: {test: ["CMD", "curl", "-fs", "http://localhost:8000/api/health"]}
  frontend:
    build: {context: ./frontend, dockerfile: ../infra/docker/frontend.Dockerfile}
    networks: [app]     # nginx on 80, SPA fallback; reached through the reverse proxy
  workspace:
    build: {context: ., dockerfile: workspace/Dockerfile}
    environment: {EXECD_TOKEN: "${EXECD_TOKEN}"}
    volumes:
      - folders:/data/folders
      - ./domains:/domains:ro
    networks: [exec]
    pids_limit: 4096
    healthcheck: {test: ["CMD", "curl", "-fs", "http://localhost:7000/health"]}
  postgres:
    image: postgres:17
    environment: {POSTGRES_USER: contoso, POSTGRES_PASSWORD: "${POSTGRES_PASSWORD}", POSTGRES_DB: contoso}
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./deploy/postgres/init:/docker-entrypoint-initdb.d:ro
    networks: [app]
    healthcheck: {test: ["CMD-SHELL", "pg_isready -U contoso"]}
networks:
  app: {}
  exec: {}
volumes: {folders: {}, attachments: {}, reports: {}, pgdata: {}}
```

- **`deploy/langfuse.compose.yaml`** defines `langfuse-web` (`127.0.0.1:3100:3000`), `langfuse-worker`, `clickhouse`, `redis` and `minio`, all on `app`. It maps our keys onto Langfuse's names:
  - `DATABASE_URL=postgresql://contoso:${POSTGRES_PASSWORD}@postgres:5432/langfuse`
  - `SALT=${LANGFUSE_SALT}`, `ENCRYPTION_KEY=${LANGFUSE_ENCRYPTION_KEY}`, `NEXTAUTH_SECRET=${LANGFUSE_NEXTAUTH_SECRET}`, `NEXTAUTH_URL=${LANGFUSE_PUBLIC_URL}`
  - `CLICKHOUSE_PASSWORD`, `REDIS_AUTH`, `MINIO_ROOT_PASSWORD`, and the S3 secret access keys = `${MINIO_ROOT_PASSWORD}`
  - `TELEMETRY_ENABLED=false`
  - the `LANGFUSE_INIT_*` values from [13](13-observability.md#langfuse-in-the-compose-stack)
- **`deploy/postgres/init/10-langfuse.sql`:** `CREATE DATABASE langfuse OWNER contoso;`
- **One uid for both writers.** `api` runs as uid 1000, the same as the `agent` user in `workspace`, so both can write the `folders` volume. Both images run `git config --system safe.directory '*'`.
- **`api` image** (`infra/docker/backend.Dockerfile`): `python:3.12-slim` with uv, `git` and `curl`; installs the app with `uv sync --frozen`. It doesn't contain the frontend.
- **`frontend` image** (`infra/docker/frontend.Dockerfile`): a `node:24-alpine` builder runs the Vite build, and `nginx:alpine` serves `dist` on port 80 with SPA fallback.
- **Image names.** `backend`, `frontend` and `workspace` are tagged `${BACKEND_IMAGE:-contoso-backend}`, `${FRONTEND_IMAGE:-contoso-frontend}` and `${WORKSPACE_IMAGE:-contoso-workspace}`, so the deploy host can pull the GHCR images by setting these variables.
- **Reverse proxy.** `proxy` (`caddy:2.10-alpine`, `infra/Caddyfile`) is in the compose profile `proxy`, so a plain `docker compose up` (the deploy host) doesn't start it; `make up` passes `--profile proxy`. It is published on `127.0.0.1:${PROXY_PORT:-8080}`.
- **Secrets stay out of images.** `.dockerignore` excludes `.env`, `.env.*` (except `.env.example`) and `domains/*/credentials/*.env`.
- **Networks.** `workspace` isn't attached to `app`, so it can't resolve or reach `postgres` or `langfuse-*`. `exec` is a normal bridge network, so outbound internet access works.

## Boot sequence (`api` lifespan)

**Status:** Implemented for steps 1–5 (S0, S1, S2; step 4 is an empty hook until S9); the rest are planned with their sections. Steps 3–5 run in one transaction (`backend.main.run_boot_steps`).

1. Load settings and run the preflight.
2. `alembic upgrade head` (`backend.db.migrate`, in a worker thread), then create the engine. A failed migration stops the boot. From here on `/api/health`'s `db` check runs `SELECT 1` through that engine.
3. Upsert `domains` from the domain results of step 1's preflight, which runs all five rules of [12](12-auth-and-domains.md#validation-at-boot).
4. Upsert the catalogs (`skill_catalog`, `library_presets`) from the seeds.
5. Make sure the admin exists ([12](12-auth-and-domains.md#login-poc-grade)); an invalid or taken `ADMIN_USERNAME` stops the boot.
6. Fail stale `jobs`; reconcile agents: each active user has a lead, and each active agent's folder exists (otherwise `error` on the overview). Then run the restart handling ([03](03-agent-loop.md#restart)).
7. Fetch model windows from OpenRouter. `MODEL_CONTEXT_TOKENS`, when set, overrides them; a model missing from the list, or a failed fetch, falls back to 128,000.
8. Start the supervisor (runners of available domains), the scheduler, the job worker and the Langfuse client.
9. Serve `:8000` and `:8001`.

## Makefile

**Status:** Implemented. Every target runs its tools in Docker.

| Target | Does |
|---|---|
| `make setup` | phase 1 of [Getting started](#getting-started): checks that Docker, Compose and buildx work, then creates or completes `.env` and the domain credential files and lists what is left to fill in (`python -m backend.init_env` in a `python:3.12-slim` container) |
| `make check` | phase 2: preflight from the CLI (`docker compose run --rm --no-deps --build backend python -m backend.preflight`); fails when there is no `.env` |
| `make up` | phase 3: `make check`, then `docker compose --profile proxy up -d --build --wait`; then, when `DEMO_PASSWORD` is set in `.env`, `python -m backend.seed_demo` in the running `backend` (creates `alice` and `bob`, leaves existing users alone; the job worker provisions them); prints the app, API and Langfuse URLs |
| `make down` / `make logs` | `docker compose --profile '*' down --remove-orphans` (volumes are kept) / `logs -f backend workspace` |
| `make test` | backend, workspace and frontend tests in compose ([17](17-testing.md#where-tests-run)), then removes the `contoso-test` project; also `test-backend`, `test-workspace`, `test-frontend`, `test-clean` |
| `make lint` / `make format` | ruff on `agents backend eval workspace` (uv image); `lint` also runs the frontend ESLint |
| `make lock` | refresh `uv.lock` and `workspace/execd/requirements*.txt` |
| `make eval` | `python -m eval.runners.run_smoke_eval` in the `backend` image (the module doesn't exist yet) |
| `make e2e` | Playwright against a fresh stack in fake mode ([17](17-testing.md#end-to-end-playwright-fake-mode)); failures keep their artifacts in `e2e-results/` |
| `make test-live` | live OpenRouter contract tests (`pytest -m live`, opt-in; needs `OPENROUTER_API_KEY` in `.env`) |

The earlier host-tool targets (a host-side `setup`, `dev-infra` with pgvector + Redis, `dev-be`, `dev-fe`, `docker-*`) are gone: the app uses plain Postgres 17, Langfuse brings its own Redis, and nothing runs on the host. `init-env`, `check-env` and `seed-demo` were folded into `setup`, `check` and `up`.

## Getting started

**Status:** Implemented. The teammate walkthrough, with prerequisites, the key table and troubleshooting, is [`GUIDE.md`](../GUIDE.md) ([tiếng Việt](../GUIDE.vi.md)).

```bash
make setup                          # 1. .env + domains/*/credentials/*.env; lists the keys to fill in
$EDITOR .env domains/*/credentials/*.env
make check                          # 2. until no required key is missing
make up                             # 3. stack + proxy, demo users if DEMO_PASSWORD is set, prints URLs
```

The app (SPA and `/api` on one origin, through the proxy) is on `http://localhost:8080`, the API alone on `http://127.0.0.1:8000` (`/api/health` → `{"ok": true, "db": true, "execd": true}`), Langfuse on `http://localhost:3100`. If a port is taken, set `PROXY_PORT`, or `APP_PORT` and `APP_URL`, in `.env`.

**No local Docker daemon.** Don't point the local CLI at a remote host with `DOCKER_HOST=ssh://<host>`: compose resolves the relative bind mounts (`./domains`, `./platform`, `./deploy/postgres/init`) to paths on the client, which the remote daemon then creates empty on its own filesystem, so the stack boots without domains. Run the three phases in a checkout on the remote host and reach ports 8080, 8000 and 3100 through an SSH tunnel (`ssh -L 8080:127.0.0.1:8080 -L 8000:127.0.0.1:8000 -L 3100:127.0.0.1:3100 <host>`). Langfuse is published on 3100 because 3000 is often taken.
