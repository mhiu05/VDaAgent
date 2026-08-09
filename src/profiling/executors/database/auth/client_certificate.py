"""Client-certificate authentication for PostgreSQL/on-prem deployments."""

from __future__ import annotations

from src.models.schemas import DatabaseConnectionConfig
from src.profiling.executors.database.auth.base import AuthResult, require_username


class ClientCertificateAuth:
    def build(self, config: DatabaseConnectionConfig) -> AuthResult:
        if config.type != "postgresql":
            raise ValueError(
                "Client certificate auth is currently implemented for PostgreSQL. "
                "SQL Server client-certificate auth depends on deployment-specific gateways."
            )
        if not config.ssl_cert_path or not config.ssl_key_path:
            raise ValueError("Client certificate auth requires `ssl_cert_path` and `ssl_key_path`.")

        connect_args = {
            "sslmode": config.ssl_mode or "verify-full",
            "sslcert": config.ssl_cert_path,
            "sslkey": config.ssl_key_path,
        }
        if config.ssl_root_cert_path:
            connect_args["sslrootcert"] = config.ssl_root_cert_path
        return AuthResult(username=require_username(config), password=config.password, connect_args=connect_args)

