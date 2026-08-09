"""Factory for database auth strategies."""

from __future__ import annotations

from src.profiling.executors.database.auth.aws_iam import AWSIAMAuth
from src.profiling.executors.database.auth.azure_ad import AzureADTokenAuth
from src.profiling.executors.database.auth.client_certificate import ClientCertificateAuth
from src.profiling.executors.database.auth.gcp_service_account import GCPServiceAccountAuth
from src.profiling.executors.database.auth.username_password import UsernamePasswordAuth


def build_auth_strategy(auth_type: str):
    strategies = {
        "username_password": UsernamePasswordAuth,
        "azure_ad_token": AzureADTokenAuth,
        "aws_iam": AWSIAMAuth,
        "gcp_service_account": GCPServiceAccountAuth,
        "client_certificate": ClientCertificateAuth,
    }
    try:
        return strategies[auth_type]()
    except KeyError as exc:
        raise ValueError(f"Unsupported auth_type: {auth_type}") from exc

