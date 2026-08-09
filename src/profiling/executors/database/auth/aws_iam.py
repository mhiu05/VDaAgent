"""AWS IAM database authentication.

AWS IAM database auth is supported here for PostgreSQL-compatible engines such
as Amazon RDS PostgreSQL and Aurora PostgreSQL.
"""

from __future__ import annotations

from src.models.schemas import DatabaseConnectionConfig
from src.profiling.executors.database.auth.base import AuthResult, require_username


class AWSIAMAuth:
    def build(self, config: DatabaseConnectionConfig) -> AuthResult:
        if config.type != "postgresql":
            raise ValueError("AWS IAM auth is only supported for PostgreSQL connectors.")
        if not config.aws_region:
            raise ValueError("AWS IAM auth requires `aws_region`.")

        try:
            import boto3
        except ImportError as exc:
            raise RuntimeError("AWS IAM auth requires `pip install boto3`.") from exc

        username = require_username(config)
        client = boto3.client("rds", region_name=config.aws_region)
        token = client.generate_db_auth_token(
            DBHostname=config.host,
            Port=config.port,
            DBUsername=username,
            Region=config.aws_region,
        )
        return AuthResult(username=username, password=token, connect_args={"sslmode": config.ssl_mode or "require"})

