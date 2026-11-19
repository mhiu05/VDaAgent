# VDaAgent PoC (doc 16 "Makefile", GUIDE.md). Every tool runs in Docker; nothing is installed on
# the host. Getting started: make setup → fill .env and credentials, make check → make up.
.PHONY: help setup check up down restart ps health logs seed-demo psql warm-cache \
        warm-cache-status demo-ready demo-bootstrap import-domains dashboard-sync wait-ui wait-demo \
        smoke-ready reset-dev test \
        test-backend test-workspace test-frontend test-live test-clean e2e lint format lock eval

.DEFAULT_GOAL := help

UID_GID      := $(shell id -u):$(shell id -g)
COMPOSE      := docker compose
TEST_COMPOSE := docker compose -f docker-compose.yml -f compose.test.yaml
E2E_COMPOSE  := docker compose -f docker-compose.yml -f compose.e2e.yaml
PY_IMAGE     := python:3.12-slim
UV_IMAGE     := ghcr.io/astral-sh/uv:0.9.30-python3.12-bookworm
# uv with the repo mounted; the venv and cache live in the `contoso-uv-cache` volume.
UV_RUN       := docker run --rm --user $(UID_GID) -e UV_CACHE_DIR=/cache/uv \
                -e UV_PROJECT_ENVIRONMENT=/cache/venv -v contoso-uv-cache:/cache \
                -v "$(CURDIR)":/w -w /w $(UV_IMAGE)
PY_PATHS     := agents backend eval workspace
# `$$($(call env_get,KEY,DEFAULT))` in a recipe: KEY's value in .env (last line wins, quotes
# dropped), or DEFAULT when it is unset or empty.
env_get       = v=$$(sed -n 's/^$(1)=//p' .env | tail -n 1 | tr -d "\"'"); echo "$${v:-$(2)}"
# The demo users' password: `make up DEMO_PASSWORD=...` (or the shell's), else .env, else this.
DEMO_PASSWORD_DEFAULT := demo123!
demo_password = $${DEMO_PASSWORD:-$$($(call env_get,DEMO_PASSWORD,$(DEMO_PASSWORD_DEFAULT)))}
# `make logs SERVICES=frontend`; `make logs SERVICES=` follows every service.
# prewarm.py in a one-off workspace container: same `folders` volume and uv settings as agents.
WARM_RUN     := $(COMPOSE) run --rm --no-deps -v "$(CURDIR)/platform/seeds:/opt/warm/seeds:ro" \
                workspace python3 /opt/warm/prewarm.py
SERVICES     ?= backend workspace

help: ## List the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "} {printf "  make %-15s %s\n", $$1, $$2}'

setup: ## 1. Check Docker; create .env + credential files; list what to fill in
	@docker info >/dev/null 2>&1 || { echo "setup: Docker isn't running or isn't installed (GUIDE.md, Prerequisites)"; exit 1; }
	@docker compose version >/dev/null 2>&1 || { echo "setup: 'docker compose' is missing (GUIDE.md, Prerequisites)"; exit 1; }
	@docker buildx version >/dev/null 2>&1 || { echo "setup: 'docker buildx' is missing (GUIDE.md, Prerequisites)"; exit 1; }
	@docker run --rm --user $(UID_GID) -v "$(CURDIR)":/w -w /w $(PY_IMAGE) python -m backend.init_env

check: ## 2. Missing keys and unavailable domains, by name only
	@test -f .env || { echo "check: no .env yet; run make setup first"; exit 1; }
	$(COMPOSE) run --rm --no-deps --build backend python -m backend.preflight

up: check ## 3. Start everything and prepare the demo; prints READY only once the browser URL works
	@echo "==> up 1/8: build and start the stack, proxy included (waits until services are healthy)"
	$(COMPOSE) --profile proxy up -d --build --wait
	@echo "==> up 2/8: browser endpoint and API (db + execd) through the proxy"
	@$(MAKE) --no-print-directory wait-ui
	@$(MAKE) --no-print-directory demo-bootstrap
	@echo "==> up 8/8: final checks (schema, domain, demo users, dashboards, browser endpoint)"
	@$(MAKE) --no-print-directory smoke-ready
	@proxy=$$($(call env_get,PROXY_PORT,8080)); api=$$($(call env_get,APP_PORT,8000)); \
	langfuse=$$($(call env_get,LANGFUSE_PUBLIC_URL,http://localhost:3100)); \
	lf_user=$$($(call env_get,LANGFUSE_INIT_USER_EMAIL,admin@contoso.local)); \
	logins="$$($(call env_get,ADMIN_USERNAME,)), alice, bob"; \
	echo; echo "VDaAgent is ready"; \
	echo "  app       http://localhost:$$proxy   (login: $$logins)"; \
	echo "  api       http://127.0.0.1:$$api/api/health"; \
	echo "  langfuse  $$langfuse   ($$lf_user / ADMIN_PASSWORD)"; \
	echo "  stop: make down    logs: make logs"

down: ## Stop the stack (volumes are kept)
	$(COMPOSE) --profile '*' down --remove-orphans

restart: ## Recreate backend + workspace so they re-read .env (`docker compose restart` does not)
	$(COMPOSE) up -d --force-recreate --wait backend workspace

ps: ## Service status and health
	$(COMPOSE) --profile proxy ps

health: ## Probe the API (db + execd) directly and through the proxy
	@api=$$($(call env_get,APP_PORT,8000)); proxy=$$($(call env_get,PROXY_PORT,8080)); status=0; \
	printf 'api    http://127.0.0.1:%s/api/health  ' "$$api"; \
	curl -fsS "http://127.0.0.1:$$api/api/health" || status=1; echo; \
	printf 'proxy  http://127.0.0.1:%s/api/health  ' "$$proxy"; \
	curl -fsS "http://127.0.0.1:$$proxy/api/health" || status=1; echo; \
	printf 'app    http://127.0.0.1:%s/  ' "$$proxy"; \
	curl -fsS -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:$$proxy/" || { status=1; echo; }; \
	exit $$status

logs: ## Follow logs (default backend workspace; SERVICES=frontend, or SERVICES= for all)
	$(COMPOSE) --profile proxy logs -f --tail=200 $(SERVICES)

seed-demo: ## Create demo users alice, bob and vre-demo (DEMO_PASSWORD=..., else .env, else the default; make up runs it)
	@DEMO_PASSWORD="$(demo_password)" $(COMPOSE) exec -T -e DEMO_PASSWORD backend python -m backend.seed_demo

import-domains: ## Import domains/<id>/ files into Postgres (idempotent upsert; make up runs it)
	$(COMPOSE) exec -T backend python -m backend.domains.import_from_files

# Runs contoso.dashboard.build() in each person's `data` agent (its own warehouse credentials,
# read-only), then stores the result as their dashboard dataset; unchanged data is not re-stored.
# People still provisioning are skipped: run it again once their team is ready.
dashboard-sync: ## Refresh each person's dashboard dataset from their warehouse (make up runs it)
	$(COMPOSE) exec -T backend python -m backend.dashboard_sync

# The proxy and frontend have no compose healthcheck, so `up --wait` cannot vouch for the browser
# URL: poll it from the host (bounded) until the UI and the API (db + execd) both answer 200.
UI_WAIT_TRIES ?= 60
wait-ui: ## Wait (bounded) until http://localhost:PROXY_PORT serves the UI and /api/health
	@proxy=$$($(call env_get,PROXY_PORT,8080)); \
	for i in $$(seq 1 $(UI_WAIT_TRIES)); do \
	  ui=$$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$$proxy/"); \
	  api=$$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$$proxy/api/health"); \
	  [ "$$ui" = 200 ] && [ "$$api" = 200 ] && { echo "wait-ui: http://localhost:$$proxy serves the UI and the API"; exit 0; }; \
	  sleep 1; \
	done; \
	echo "wait-ui: http://localhost:$$proxy not ready (UI $$ui, /api/health $$api); see: make ps, make logs SERVICES='proxy frontend backend'"; \
	exit 1

# Demo users provision asynchronously (the api's job worker): wait for their teams, bounded.
DEMO_WAIT_S ?= 900
wait-demo: ## Wait (bounded) until the demo users' teams are provisioned; fails on failure/timeout
	$(COMPOSE) exec -T backend python -m backend.readiness wait-demo $(DEMO_WAIT_S)

smoke-ready: ## Check schema head, domain, demo users, dashboards, group routes and the browser URL
	$(COMPOSE) exec -T backend python -m backend.readiness check
	@proxy=$$($(call env_get,PROXY_PORT,8080)); \
	code=$$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$$proxy/api/groups"); \
	[ "$$code" = 401 ] || { echo "smoke-ready: /api/groups answered $$code, expected 401 (route present, login required)"; exit 1; }; \
	echo "check: group chat API mounted (/api/groups requires a login)"
	@$(MAKE) --no-print-directory wait-ui UI_WAIT_TRIES=5

psql: ## psql shell on the application database (contoso)
	$(COMPOSE) exec postgres psql -U contoso -d contoso

warm-cache: ## Optional: pre-fill the shared uv cache with every preset (faster first provisioning)
	$(WARM_RUN) warm

warm-cache-status: ## Shared uv cache size, and whether every preset package is cached
	$(WARM_RUN) status

# What `make up` runs once the stack is healthy. Order matters: the cache is warmed before alice
# and bob are seeded (their provisioning would otherwise download the same packages at the same
# time); domains are imported before seeding (seed-demo skips a user whose domain is missing);
# the dashboards sync once the demo teams exist (it runs in each person's data agent). Every step
# fails `make up` and is safe to re-run: the cache is reused, the import upserts, existing users
# are kept, an unchanged dataset is not stored again. People without a warehouse are skipped.
demo-bootstrap: ## Warm cache, import domains, seed + wait for alice/bob, sync dashboards (run by make up)
	@echo "==> up 3/8: warm the shared uv cache (downloads each preset once; re-runs reuse it)"
	@$(MAKE) --no-print-directory warm-cache
	@echo "==> up 4/8: import domains into Postgres"
	@$(MAKE) --no-print-directory import-domains
	@echo "==> up 5/8: seed demo users alice and bob"
	@$(MAKE) --no-print-directory seed-demo
	@echo "==> up 6/8: wait for the demo users' agent teams"
	@$(MAKE) --no-print-directory wait-demo
	@echo "==> up 7/8: refresh dashboard datasets from the warehouse"
	@$(MAKE) --no-print-directory dashboard-sync

# Before a demo: make up (which already warms, imports and seeds), then the cache report + health.
# Keeps every volume, user and the DB.
demo-ready: ## make up, then the uv cache report and health (before a demo / onboarding)
	@test -f .env || { echo "demo-ready: no .env yet; run make setup first"; exit 1; }
	@$(MAKE) --no-print-directory up
	@echo "==> demo-ready: check the cache"
	@$(MAKE) --no-print-directory warm-cache-status
	@echo "==> demo-ready: health"
	@$(MAKE) --no-print-directory health
	@echo "demo-ready: done; new users now provision from the warm cache"

# Like `docker compose down -v`, reset-dev deletes every named volume: the database, agent
# folders, the shared uv cache (the next users download every package again), attachments,
# reports and Langfuse. To restart and keep everything: make down, then make up.
reset-dev: ## DESTRUCTIVE: stop the stack and DELETE its volumes (database, agent folders, uv cache, Langfuse)
	@printf 'reset-dev deletes every volume of the contoso stack: users, chats, agent folders, the shared uv cache,\nattachments, reports, Langfuse. (To restart and keep them: make down, then make up.)\nType "delete" to continue: '; \
	read answer; [ "$$answer" = delete ] || { echo "reset-dev: aborted"; exit 1; }
	$(COMPOSE) --profile '*' down -v --remove-orphans

test: ## Backend, workspace and frontend tests in compose (doc 17)
	@status=0; \
	$(MAKE) --no-print-directory test-clean; \
	$(MAKE) --no-print-directory test-backend || status=1; \
	$(MAKE) --no-print-directory test-workspace || status=1; \
	$(MAKE) --no-print-directory test-frontend || status=1; \
	$(MAKE) --no-print-directory test-clean; \
	exit $$status

test-backend: ## Backend pytest (contoso_test DB, MODEL_BACKEND=fake)
	$(TEST_COMPOSE) run --rm --build backend pytest

test-workspace: ## execd and contoso tests
	$(TEST_COMPOSE) run --rm --no-deps --build workspace pytest /opt/execd/tests

test-frontend: ## Vitest + legacy domain suite
	$(TEST_COMPOSE) run --rm --build frontend-test

test-live: ## Live OpenRouter contract tests (pytest -m live; needs OPENROUTER_API_KEY)
	$(TEST_COMPOSE) run --rm --no-deps --build backend pytest -m live

test-clean: ## Remove the test project's containers and volumes
	$(TEST_COMPOSE) --profile '*' down -v --remove-orphans

e2e: ## Playwright end-to-end against a fresh fake-mode stack (doc 17)
	@status=0; \
	$(E2E_COMPOSE) --profile '*' down -v --remove-orphans; \
	$(E2E_COMPOSE) up -d --build --wait backend frontend proxy fixtures || status=1; \
	$(E2E_COMPOSE) run --rm --no-deps fixtures-seed || status=1; \
	$(E2E_COMPOSE) run --rm --no-deps --build e2e || status=1; \
	$(E2E_COMPOSE) --profile '*' down -v --remove-orphans; \
	exit $$status

lint: ## ruff check + format --check; frontend eslint
	$(UV_RUN) uv run --frozen --only-group dev ruff check $(PY_PATHS)
	$(UV_RUN) uv run --frozen --only-group dev ruff format --check $(PY_PATHS)
	$(TEST_COMPOSE) run --rm --no-deps --build frontend-test npm run lint

format: ## ruff check --fix + ruff format
	$(UV_RUN) uv run --frozen --only-group dev ruff check --fix $(PY_PATHS)
	$(UV_RUN) uv run --frozen --only-group dev ruff format $(PY_PATHS)

lock: ## Refresh uv.lock and execd's pinned requirements
	$(UV_RUN) uv lock
	$(UV_RUN) sh -c 'cd workspace/execd && uv pip compile -q --python-version 3.12 requirements.in -o requirements.txt && uv pip compile -q --python-version 3.12 requirements-test.in -o requirements-test.txt'

eval: ## Agent evaluation (eval/ is not implemented yet)
	$(COMPOSE) run --rm --no-deps backend python -m eval.runners.run_smoke_eval
