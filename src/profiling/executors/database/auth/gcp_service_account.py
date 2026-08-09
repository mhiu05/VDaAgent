"""GCP service-account authentication for PostgreSQL connectors.

Cloud SQL PostgreSQL IAM auth can use an OAuth access token as the database
password when IAM database authentication is enabled.
"""

from __future__ import annotations

from src.models.schemas import DatabaseConnectionConfig
from src.profiling.executors.database.auth.base import AuthResult, require_username


class GCPServiceAccountAuth:
    def build(self, config: DatabaseConnectionConfig) -> AuthResult:
        if config.type != "postgresql":
            raise ValueError("GCP service account auth is only supported for PostgreSQL connectors.")

        token = config.access_token
        if not token:
            try:
                import google.auth
                from google.auth.transport.requests import Request
                from google.oauth2 import service_account
            except ImportError as exc:
                raise RuntimeError(
                    "GCP service account auth requires `pip install google-auth` "
                    "or a pre-generated `access_token`."
                ) from exc

            scopes = ["https://www.googleapis.com/auth/sqlservice.login"]
            if config.gcp_service_account_file:
                credentials = service_account.Credentials.from_service_account_file(
                    config.gcp_service_account_file,
                    scopes=scopes,
                )
            else:
                credentials, _ = google.auth.default(scopes=scopes)
            credentials.refresh(Request())
            token = credentials.token

        return AuthResult(
            username=require_username(config),
            password=token,
            connect_args={"sslmode": config.ssl_mode or "require"},
        )

