"""Azure AD access-token authentication.

For Azure SQL, pyodbc receives the token through SQL_COPT_SS_ACCESS_TOKEN.
For Azure Database for PostgreSQL, the token is used as the password.
"""

from __future__ import annotations

import os
import struct

from src.models.schemas import DatabaseConnectionConfig
from src.profiling.executors.database.auth.base import AuthResult, require_username

SQL_COPT_SS_ACCESS_TOKEN = 1256


class AzureADTokenAuth:
    def build(self, config: DatabaseConnectionConfig) -> AuthResult:
        token = config.access_token or os.getenv("AZURE_DB_ACCESS_TOKEN") or os.getenv("AZURE_SQL_ACCESS_TOKEN")
        if not token:
            raise ValueError(
                "Azure AD token auth requires `access_token`, AZURE_DB_ACCESS_TOKEN, "
                "or AZURE_SQL_ACCESS_TOKEN."
            )

        if config.type == "sql_server":
            token_bytes = token.encode("utf-16-le")
            token_struct = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)
            return AuthResult(connect_args={"attrs_before": {SQL_COPT_SS_ACCESS_TOKEN: token_struct}})

        return AuthResult(username=require_username(config), password=token)

