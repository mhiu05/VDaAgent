# syntax=docker/dockerfile:1
# workspace: execd + agent folders + uv cache (doc 11 "Image"). Build context: repo root.
FROM python:3.12-slim-bookworm AS runtime

COPY --from=ghcr.io/astral-sh/uv:0.9.30 /uv /uvx /usr/local/bin/

RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl tini fonts-noto-core libpq5 \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system safe.directory '*' \
 && useradd --uid 1000 --create-home --shell /bin/bash agent \
 && mkdir -p /data/folders/.uv-cache \
 && chown -R agent:agent /data/folders

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/opt \
    UV_CACHE_DIR=/data/folders/.uv-cache \
    UV_LINK_MODE=hardlink \
    UV_PYTHON_DOWNLOADS=never \
    EXECD_VENV=/opt/execd/.venv

# execd's own venv (FastAPI + uvicorn), separate from every agent venv.
COPY workspace/execd/requirements.txt /opt/execd/requirements.txt
RUN --mount=type=cache,target=/root/.cache/uv \
    UV_CACHE_DIR=/root/.cache/uv uv venv --python /usr/local/bin/python3 $EXECD_VENV \
 && UV_CACHE_DIR=/root/.cache/uv uv pip install --python $EXECD_VENV -r /opt/execd/requirements.txt

# The shared uv cache (/data/folders/.uv-cache, on the `folders` volume) starts empty: the image
# installs no preset packages, so `make up` stays light. Provisioning fills the cache with what
# each agent needs; `make warm-cache` (prewarm.py, doc 11) optionally fills it ahead of time.
COPY workspace/prewarm.py /opt/warm/prewarm.py

COPY workspace/contoso/ /opt/contoso/
COPY workspace/execd/ /opt/execd/

USER agent
WORKDIR /data/folders
EXPOSE 7000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
    CMD curl -fs http://localhost:7000/health || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/opt/execd/.venv/bin/uvicorn", "execd.app:app", "--host", "0.0.0.0", "--port", "7000"]

# Test image (compose.test.yaml): adds pytest to execd's venv and the tests
# (`run --rm workspace pytest /opt/execd/tests`).
FROM runtime AS test
USER root
COPY workspace/execd/requirements-test.txt /opt/execd/requirements-test.txt
RUN --mount=type=cache,target=/root/.cache/uv \
    UV_CACHE_DIR=/root/.cache/uv uv pip install --python $EXECD_VENV -r /opt/execd/requirements-test.txt
COPY workspace/tests/ /opt/execd/tests/
RUN mkdir -p /domains
USER agent
ENV PATH=/opt/execd/.venv/bin:$PATH \
    PYTEST_ADDOPTS="-p no:cacheprovider"
# CMD stays execd: the backend tests start this image as a dependency.

# The default build target is the runtime image.
FROM runtime
