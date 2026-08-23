"""Security regressions for application-level error responses."""

from __future__ import annotations

import asyncio
import json
import logging

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from src.main import global_exception_handler, validation_exception_handler


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
