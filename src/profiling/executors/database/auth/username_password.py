"""Username/password authentication for cloud and on-prem databases."""

from __future__ import annotations

from src.models.schemas import DatabaseConnectionConfig
from src.profiling.executors.database.auth.base import AuthResult, require_password, require_username


class UsernamePasswordAuth:
    def build(self, config: DatabaseConnectionConfig) -> AuthResult:
        return AuthResult(username=require_username(config), password=require_password(config))

