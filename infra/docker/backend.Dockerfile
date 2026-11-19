# syntax=docker/dockerfile:1
# api service (`backend` in compose): backend.main:app on :8000 (docs 02, 16).
# Build context: repo root.
FROM python:3.12-slim AS runtime

COPY --from=ghcr.io/astral-sh/uv:0.9.30 /uv /uvx /usr/local/bin/

RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system safe.directory '*' \
 && useradd --uid 1000 --create-home --shell /bin/bash contoso \
 && mkdir -p /data/folders /data/attachments /data/reports \
 && chown -R contoso:contoso /data

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH=/app

WORKDIR /app

# Dependencies first (layer cache): workspace manifests + lock.
COPY pyproject.toml uv.lock ./
COPY agents/pyproject.toml agents/
COPY backend/pyproject.toml backend/
COPY eval/pyproject.toml eval/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --all-packages --no-dev

COPY agents/ agents/
COPY backend/ backend/
COPY eval/ eval/
COPY workspace/execd/__init__.py workspace/execd/landlock.py workspace/execd/git_sandbox.py workspace/execd/

USER contoso
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
    CMD curl -fs http://localhost:8000/api/health || exit 1
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]

# Test image (compose.test.yaml): adds the dev group (pytest, ruff) and repo files tests read.
FROM runtime AS test
USER root
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --all-packages
COPY .env.example ./
COPY platform/ platform/
COPY workspace/contoso/ workspace/contoso/
COPY domains/ domains/
COPY Makefile ./
USER contoso
ENV PYTEST_ADDOPTS="-p no:cacheprovider"

# The default build target is the runtime image.
FROM runtime
