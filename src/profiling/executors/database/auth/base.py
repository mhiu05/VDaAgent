"""Authentication contracts for database connectors.

Auth strategies return URL credentials plus optional DBAPI connect args. This
keeps cloud/on-prem authentication separate from profiling query execution.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from src.models.schemas import DatabaseConnectionConfig


@dataclass(frozen=True)
class AuthResult:
    username: str | None = None
    password: str | None = None
    odbc_auth_fragment: str = ""
    connect_args: dict[str, Any] = field(default_factory=dict)


class DatabaseAuthStrategy(Protocol):
    def build(self, config: DatabaseConnectionConfig) -> AuthResult:
        raise NotImplementedError


def require_username(config: DatabaseConnectionConfig) -> str:
    if not config.username:
        raise ValueError(f"`username` is required for auth_type={config.auth_type}.")
    return config.username


def require_password(config: DatabaseConnectionConfig) -> str:
    if not config.password:
        raise ValueError(f"`password` is required for auth_type={config.auth_type}.")
    return config.password

