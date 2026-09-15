.DEFAULT_GOAL := help

# VDaAgent development shortcuts.
# These commands are written for the repository's Windows/PowerShell setup.

SHELL := cmd.exe
SHELLFLAGS := /C

BACKEND_PORT ?= 8000
FRONTEND_PORT ?= 3000
BACKEND_HOST ?= 0.0.0.0
BACKEND_DIR := src\backend
FRONTEND_DIR := src\frontend
ROOT_PYTHON ?= $(CURDIR)\.venv\Scripts\python.exe
BACKEND_PYTHON ?= $(ROOT_PYTHON)

.PHONY: help backend worker frontend dev install install-backend install-frontend health frontend-build frontend-check

help:
	@echo "VDaAgent commands:"
	@echo "  make backend          Start FastAPI backend on port $(BACKEND_PORT)"
	@echo "  make worker           Start the durable profiling worker"
	@echo "  make frontend         Start Next.js frontend on port $(FRONTEND_PORT)"
	@echo "  make dev              Open backend, worker and frontend in separate terminals"
	@echo "  make install          Install backend and frontend dependencies"
	@echo "  make health           Check backend health"
	@echo "  make frontend-build   Create a production frontend build"
	@echo "  make frontend-check   Run frontend typecheck and lint"

backend:
	cd /d "$(CURDIR)\$(BACKEND_DIR)" && "$(BACKEND_PYTHON)" -m uvicorn src.main:app --reload --host $(BACKEND_HOST) --port $(BACKEND_PORT)

frontend:
	cd /d "$(CURDIR)\$(FRONTEND_DIR)" && pnpm.cmd dev --port $(FRONTEND_PORT)

worker:
	cd /d "$(CURDIR)" && set "PYTHONPATH=$(CURDIR)\$(BACKEND_DIR)" && "$(ROOT_PYTHON)" -m src.workers.profiling_worker

# Windows helper: starts each long-running process in its own terminal window.
# Run this target only when no VDaAgent backend or frontend process is already running.
dev:
	cmd.exe /d /c start "VDaAgent backend" /D "$(CURDIR)\$(BACKEND_DIR)" cmd.exe /k ""$(BACKEND_PYTHON)" -m uvicorn src.main:app --reload --host $(BACKEND_HOST) --port $(BACKEND_PORT)"
	cmd.exe /d /c start "VDaAgent worker" /D "$(CURDIR)" cmd.exe /k "set ""PYTHONPATH=$(CURDIR)\$(BACKEND_DIR)"" && ""$(ROOT_PYTHON)"" -m src.workers.profiling_worker"
	cmd.exe /d /c start "VDaAgent frontend" /D "$(CURDIR)\$(FRONTEND_DIR)" cmd.exe /k "pnpm.cmd dev --port $(FRONTEND_PORT)"

install: install-backend install-frontend

install-backend:
	"$(ROOT_PYTHON)" -m pip install -r requirements.txt

install-frontend:
	cd /d "$(CURDIR)\$(FRONTEND_DIR)" && pnpm.cmd install

health:
	powershell -NoProfile -Command "Invoke-RestMethod http://localhost:$(BACKEND_PORT)/health"

frontend-build:
	cd /d "$(CURDIR)\$(FRONTEND_DIR)" && pnpm.cmd build

frontend-check:
	cd /d "$(CURDIR)\$(FRONTEND_DIR)" && pnpm.cmd typecheck && pnpm.cmd lint
