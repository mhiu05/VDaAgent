.DEFAULT_GOAL := help

# VDaAgent shortcuts for the pnpm workspace.
PNPM ?= pnpm

.PHONY: help install i dev d dev-web dw dev-worker dworker build b typecheck tc lint l format f format-check fc test t test-e2e e2e check test-db db-test db-start db-reset scheduler-tick contracts-export check-docs check-security mock-data-validate-source mock-data-import mock-data-validate

help:
	@echo "VDaAgent commands:"
	@echo "  make install (i)                  Install dependencies"
	@echo "  make dev (d)                      Start frontend and worker"
	@echo "  make dev-web (dw)                 Start the frontend only"
	@echo "  make dev-worker (dworker)         Start the worker only"
	@echo "  make build (b)                    Build all packages"
	@echo "  make typecheck (tc)               Run TypeScript checks"
	@echo "  make lint (l)                     Run ESLint"
	@echo "  make format (f)                   Format files"
	@echo "  make format-check (fc)            Check formatting"
	@echo "  make test (t)                     Run unit/integration tests"
	@echo "  make test-e2e (e2e)               Run Playwright end-to-end tests"
	@echo "  make check                        Run format, lint, typecheck and tests"
	@echo "  make db-start                     Start local Supabase"
	@echo "  make db-reset                     Reset local database"
	@echo "  make db-test                      Run database tests"
	@echo "  make mock-data-validate-source    Validate mock source data"
	@echo "  make mock-data-import             Import mock data"
	@echo "  make mock-data-validate           Validate imported mock data"

install i:
	$(PNPM) install --frozen-lockfile

dev d:
	$(PNPM) dev

dev-web dw:
	$(PNPM) dev:web

dev-worker dworker:
	$(PNPM) dev:worker

build b:
	$(PNPM) build

typecheck tc:
	$(PNPM) typecheck

lint l:
	$(PNPM) lint

format f:
	$(PNPM) format

format-check fc:
	$(PNPM) format:check

test t:
	$(PNPM) test

test-e2e e2e:
	$(PNPM) test:e2e

check: format-check lint typecheck test

test-db db-test:
	$(PNPM) test:db

db-start:
	$(PNPM) db:start

db-reset:
	$(PNPM) db:reset

scheduler-tick:
	$(PNPM) scheduler:tick

contracts-export:
	$(PNPM) contracts:export

check-docs:
	$(PNPM) check:docs

check-security:
	$(PNPM) check:security

mock-data-validate-source:
	$(PNPM) mock-data:validate-source

mock-data-import:
	$(PNPM) mock-data:import

mock-data-validate:
	$(PNPM) mock-data:validate-import
