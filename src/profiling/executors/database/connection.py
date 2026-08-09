"""Database connection factory for SQL Server and PostgreSQL executors."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote_plus

from src.models.schemas import DatabaseConnectionConfig
from src.profiling.executors.database.auth import build_auth_strategy
from src.profiling.query_builders.postgresql import PostgreSQLQueryBuilder
from src.profiling.query_builders.sql_server import SQLServerQueryBuilder


@dataclass(frozen=True)
class ConnectionDetails:
    url: str
    connect_args: dict[str, Any] = field(default_factory=dict)


def build_connection_details(config: DatabaseConnectionConfig) -> ConnectionDetails:
    auth_result = build_auth_strategy(config.auth_type).build(config)
    if config.type == "postgresql":
        host = quote_plus(config.host)
        user = quote_plus(auth_result.username or "")
        password = quote_plus(auth_result.password or "")
        database = quote_plus(config.database)
        url = f"postgresql+psycopg2://{user}:{password}@{host}:{config.port}/{database}"
        return ConnectionDetails(url=url, connect_args=auth_result.connect_args)

    encrypt = "yes" if config.encrypt else "no"
    trust_server_certificate = "yes" if config.trust_server_certificate else "no"
    credential_fragment = auth_result.odbc_auth_fragment
    if auth_result.username:
        credential_fragment += ";UID=" + auth_result.username
    if auth_result.password:
        credential_fragment += ";PWD=" + auth_result.password
    odbc = quote_plus(
        "DRIVER={"
        + (config.driver or "ODBC Driver 18 for SQL Server")
        + "};SERVER="
        + config.host
        + f",{config.port};DATABASE="
        + config.database
        + credential_fragment
        + f";Encrypt={encrypt};TrustServerCertificate={trust_server_certificate};Connection Timeout=30;"
    )
    return ConnectionDetails(url=f"mssql+pyodbc:///?odbc_connect={odbc}", connect_args=auth_result.connect_args)


def build_query_builder(database_type: str) -> PostgreSQLQueryBuilder | SQLServerQueryBuilder:
    if database_type == "postgresql":
        return PostgreSQLQueryBuilder()
    return SQLServerQueryBuilder()
