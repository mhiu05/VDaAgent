.DEFAULT_GOAL := help

# VDaAgent development shortcuts.
# These commands are written for the repository's Windows/PowerShell setup.

SHELL := cmd.exe
SHELLFLAGS := /C

BACKEND_PORT ?= 8000
FRONTEND_PORT ?= 3000
BACKEND_HOST ?= 0.0.0.0
ROOT_PYTHON ?= .\.venv\Scripts\python.exe
BACKEND_PYTHON ?= ..\.venv\Scripts\python.exe

.PHONY: help backend frontend dev install install-backend install-frontend health frontend-build frontend-check

help:
	@echo "VDaAgent commands:"
	@echo "  make backend          Start FastAPI backend on port $(BACKEND_PORT)"
	@echo "  make frontend         Start Next.js frontend on port $(FRONTEND_PORT)"
	@echo "  make dev              Open backend and frontend in separate terminals"
	@echo "  make install          Install backend and frontend dependencies"
	@echo "  make health           Check backend health"
	@echo "  make frontend-build   Create a production frontend build"
	@echo "  make frontend-check   Run frontend typecheck and lint"

backend:
	cd backend && $(BACKEND_PYTHON) -m uvicorn src.main:app --reload --host $(BACKEND_HOST) --port $(BACKEND_PORT)

frontend:
	cd frontend && pnpm.cmd dev --port $(FRONTEND_PORT)

# Windows helper: starts each long-running process in its own terminal window.
# Run this target only when no VDaAgent backend/frontend process is already running.
dev:
	cmd.exe /d /c start "VDaAgent backend" cmd.exe /k "cd /d $(CURDIR)\backend && $(BACKEND_PYTHON) -m uvicorn src.main:app --reload --host $(BACKEND_HOST) --port $(BACKEND_PORT)"
	cmd.exe /d /c start "VDaAgent frontend" cmd.exe /k "cd /d $(CURDIR)\frontend && pnpm.cmd dev --port $(FRONTEND_PORT)"

install: install-backend install-frontend

install-backend:
	$(ROOT_PYTHON) -m pip install -r requirements.txt

install-frontend:
	cd frontend && pnpm.cmd install

health:
	powershell -NoProfile -Command "Invoke-RestMethod http://localhost:$(BACKEND_PORT)/health"

frontend-build:
	cd frontend && pnpm.cmd build

frontend-check:
	cd frontend && pnpm.cmd typecheck && pnpm.cmd lint
