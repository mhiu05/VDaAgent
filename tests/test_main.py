"""Security regressions for application-level error responses."""

from __future__ import annotations

import asyncio
import json
import logging

from jwt.exceptions import PyJWKClientConnectionError
from fastapi import Request
from fastapi.exceptions import RequestValidationError
import pytest
from src.main import (
    _preflight_supabase_jwks,
    _route_template,
    global_exception_handler,
    validation_exception_handler,
)
from src.services import perf_telemetry


def _request(path: str = "/api/v1/test", **headers: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": path,
            "raw_path": path.encode(),
            "query_string": b"",
            "headers": [
                (name.lower().encode(), value.encode())
                for name, value in headers.items()
            ],
            "scheme": "http",
            "server": ("testserver", 80),
            "client": ("127.0.0.1", 1234),
        }
    )


def test_unhandled_error_response_does_not_expose_exception_details(caplog) -> None:
    secret = "database password=production-secret"
    caplog.set_level(logging.ERROR, logger="src.main")
    response = asyncio.run(
        global_exception_handler(
            _request(), RuntimeError(secret)
        )
    )
    payload = json.loads(response.body)

    assert response.status_code == 500
    assert payload["detail"] == "Internal server error."
    assert "production-secret" not in response.body.decode()
    assert secret not in caplog.text
    assert payload["request_id"] == response.headers["x-correlation-id"]


def test_supabase_jwks_preflight_allows_transient_connection_failure(
    monkeypatch, caplog
) -> None:
    class Client:
        def get_signing_keys(self):
            raise PyJWKClientConnectionError("temporary timeout")

    class Verifier:
        def _jwks_client(self):
            return Client()

    monkeypatch.setattr(
        "src.services.auth.get_jwt_verifier",
        lambda _settings: Verifier(),
    )
    caplog.set_level(logging.WARNING, logger="p170")

    assert _preflight_supabase_jwks(object()) is False
    assert "degraded" in caplog.text


def test_supabase_jwks_preflight_rejects_an_empty_key_set(monkeypatch) -> None:
    class Client:
        def get_signing_keys(self):
            return []

    class Verifier:
        def _jwks_client(self):
            return Client()

    monkeypatch.setattr(
        "src.services.auth.get_jwt_verifier",
        lambda _settings: Verifier(),
    )

    with pytest.raises(RuntimeError, match="JWKS không có signing key"):
        _preflight_supabase_jwks(object())


def test_validation_error_response_does_not_echo_request_values() -> None:
    secret = "user-password-must-not-be-returned"
    error = RequestValidationError(
        [
            {
                "type": "string_too_short",
                "loc": ("body", "password"),
                "msg": "String should have at least 12 characters",
                "input": secret,
                "ctx": {"min_length": 12},
            }
        ],
        body={"password": secret},
    )
    response = asyncio.run(validation_exception_handler(_request(), error))
    payload = json.loads(response.body)

    assert response.status_code == 422
    assert "body" not in payload
    assert "input" not in payload["detail"][0]
    assert "ctx" not in payload["detail"][0]
    assert secret not in response.body.decode()


# --- PERF-001: request phase / SQL / payload telemetry --------------------- #


def test_route_template_collapses_concrete_ids() -> None:
    """Concrete workspace/resource IDs must never reach the telemetry label."""
    run = "b1946ac92492d2347c6235b4d2611184"
    assert _route_template(f"/api/v1/profile/{run}") == "/profile/{id}"
    assert _route_template(f"/api/v1/profiling-jobs/{run}") == "/profiling-jobs/{id}"
    assert (
        _route_template(f"/api/v1/datasets/{run}/runs") == "/datasets/{id}/runs"
    )
    assert (
        _route_template(f"/api/v1/profile/{run}/explorer/session")
        == "/profile/{id}/explorer"
    )
    assert _route_template("/api/v1/workspace-bootstrap") == "/workspace-bootstrap"
    # Unknown/non-workspace paths opt out of phase telemetry entirely.
    assert _route_template("/health") is None
    assert _route_template("/api/v1/unknown-endpoint") is None


def test_perf_fingerprint_is_pii_free() -> None:
    """SQL fingerprints expose only schema identifiers, never values/params."""
    fp = perf_telemetry._fingerprint(
        "SELECT id, email FROM profile_runs WHERE workspace_id = 'secret-ws' "
        "AND email = 'user@example.com'"
    )
    assert fp == "SELECT:profile_runs"
    assert "secret-ws" not in fp
    assert "user@example.com" not in fp
    # An unparseable statement falls back to a hash, still leaking nothing.
    opaque = perf_telemetry._fingerprint("WITH x AS (VALUES ('secret')) TABLE x")
    assert opaque.startswith("sql:")
    assert "secret" not in opaque


def test_perf_context_does_not_bleed_between_requests() -> None:
    """Each begin() starts a clean counter; reset() fully clears the context."""
    token = perf_telemetry.begin("/profile/{id}", "corr-1", "GET")
    ctx = perf_telemetry.current()
    assert ctx is not None
    ctx.record_query(5.0, "SELECT 1 FROM profile_runs")
    perf_telemetry.add_phase("auth_local_ms", 3.0)
    assert ctx.query_count == 1
    perf_telemetry.reset(token)
    assert perf_telemetry.current() is None

    token2 = perf_telemetry.begin("/dashboard", "corr-2", "GET")
    fresh = perf_telemetry.current()
    assert fresh is not None
    assert fresh.query_count == 0
    assert fresh.auth_local_ms == 0.0
    assert fresh.correlation_id == "corr-2"
    perf_telemetry.reset(token2)


def test_perf_phase_helpers_are_noop_without_active_context() -> None:
    """Telemetry helpers stay silent (never raise) outside a request scope."""
    assert perf_telemetry.current() is None
    perf_telemetry.add_phase("db_ms", 10.0)
    perf_telemetry.record_serialization(1.0, 100)
    with perf_telemetry.timed("workspace_ms"):
        pass
    assert perf_telemetry.current() is None


def test_perf_emit_log_is_pii_safe(caplog) -> None:
    """The structured perf line carries only phases/fingerprints, no secrets."""
    caplog.set_level(logging.INFO, logger="p170.perf")
    token = perf_telemetry.begin("/profile/{id}", "corr-xyz", "GET")
    ctx = perf_telemetry.current()
    assert ctx is not None
    ctx.record_query(12.0, "SELECT * FROM profile_runs WHERE id = 'ws-secret'")
    ctx.auth_local_ms = 2.0
    ctx.payload_bytes = 4096
    perf_telemetry.emit_log(ctx, 200, 25.0)
    perf_telemetry.reset(token)

    text = caplog.text
    assert "route=/profile/{id}" in text
    assert "query_count=1" in text
    assert "payload_bytes=4096" in text
    assert "SELECT:profile_runs" in text
    assert "ws-secret" not in text
