"""Supabase access-token verification at the FastAPI trust boundary.

Only asymmetric Supabase JWTs are accepted.  Roles and workspace membership
are intentionally *not* copied from the token: the database is checked for
every request so a suspension or role change takes effect immediately.
"""

from __future__ import annotations

import secrets
import threading
import uuid
from dataclasses import dataclass
from typing import Any

import httpx
from fastapi import HTTPException, status
from src.config import Settings, get_settings


class JWTVerificationError(ValueError):
    """A token was absent, malformed, expired, or failed a required claim."""


@dataclass(frozen=True, slots=True)
class AuthContext:
    user_id: str
    email: str | None
    session_id: str | None
    aal: str | None
    raw_claims: dict[str, Any]
    authentication_method: str = "supabase"

    @property
    def is_legacy(self) -> bool:
        return self.authentication_method == "legacy_api_token"

    @property
    def is_guest(self) -> bool:
        return self.authentication_method == "guest"


def _unauthorized(detail: str = "Thông tin xác thực không hợp lệ.") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


class SupabaseJWTVerifier:
    """Small PyJWT wrapper with a bounded JWKS cache and rotation retry."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._client: Any | None = None
        self._lock = threading.Lock()

    @property
    def jwks_url(self) -> str:
        return f"{self.settings.auth_issuer.rstrip('/')}/.well-known/jwks.json"

    def _jwks_client(self, *, refresh: bool = False) -> Any:
        try:
            import jwt
        except ImportError as exc:  # pragma: no cover - deployment configuration
            raise RuntimeError("Thiếu PyJWT[crypto]; không thể xác thực Supabase JWT.") from exc

        with self._lock:
            if self._client is None or refresh:
                self._client = jwt.PyJWKClient(
                    self.jwks_url,
                    cache_keys=True,
                    cache_jwk_set=True,
                    lifespan=self.settings.auth_jwks_cache_ttl_seconds,
                    timeout=self.settings.auth_jwks_timeout_seconds,
                )
            return self._client

    def _email_is_confirmed(self, access_token: str) -> bool:
        """Read email confirmation from Supabase Auth's authoritative user record.

        ``email_confirmed_at`` is present on Supabase's User object, but it is
        not guaranteed to be included in every access-token JWT, especially
        with asymmetric signing keys. Do not treat an omitted claim as proof
        that the email is unconfirmed.
        """
        if not self.settings.supabase_url:
            raise JWTVerificationError("Thiếu SUPABASE_URL để kiểm tra email xác nhận.")
        api_key = self.settings.supabase_publishable_key or self.settings.supabase_backend_key
        if not api_key:
            raise JWTVerificationError("Thiếu Supabase API key để kiểm tra email xác nhận.")
        try:
            response = httpx.get(
                f"{self.settings.supabase_url.rstrip('/')}/auth/v1/user",
                headers={
                    "apikey": api_key,
                    "Authorization": f"Bearer {access_token}",
                },
                timeout=self.settings.auth_jwks_timeout_seconds,
            )
        except httpx.RequestError as exc:
            raise JWTVerificationError("Không thể kiểm tra trạng thái xác nhận email.") from exc
        if response.status_code != 200:
            raise JWTVerificationError("JWT không hợp lệ hoặc email của tài khoản chưa được xác nhận.")
        try:
            user = response.json()
        except ValueError as exc:
            raise JWTVerificationError("Supabase trả về dữ liệu user không hợp lệ.") from exc
        return bool(isinstance(user, dict) and user.get("email_confirmed_at"))

    def verify(self, token: str) -> AuthContext:
        try:
            import jwt
            from jwt import InvalidTokenError
        except ImportError as exc:  # pragma: no cover - deployment configuration
            raise RuntimeError("Thiếu PyJWT[crypto]; không thể xác thực Supabase JWT.") from exc

        try:
            header = jwt.get_unverified_header(token)
        except Exception as exc:
            raise JWTVerificationError("JWT không đúng định dạng.") from exc

        algorithm = header.get("alg")
        kid = header.get("kid")
        if algorithm not in self.settings.auth_jwt_algorithms or not isinstance(kid, str) or not kid:
            raise JWTVerificationError("JWT dùng algorithm hoặc key id không được hỗ trợ.")

        try:
            signing_key = self._jwks_client().get_signing_key_from_jwt(token).key
        except Exception:
            # A just-rotated key may not exist in the cached JWKS.  Refresh
            # once only; repeated failures remain fail-closed.
            try:
                signing_key = self._jwks_client(refresh=True).get_signing_key_from_jwt(token).key
            except Exception as exc:
                raise JWTVerificationError("Không tìm thấy khóa ký JWT hợp lệ.") from exc

        try:
            claims = jwt.decode(
                token,
                signing_key,
                algorithms=list(self.settings.auth_jwt_algorithms),
                audience=self.settings.auth_audience,
                issuer=self.settings.auth_issuer,
                options={"require": ["exp", "sub", "role"]},
            )
        except InvalidTokenError as exc:
            raise JWTVerificationError("JWT không hợp lệ hoặc đã hết hạn.") from exc

        if claims.get("role") != "authenticated":
            raise JWTVerificationError("JWT không phải phiên authenticated.")
        if self.settings.auth_require_email_confirmed:
            # Older/local JWTs may carry this claim directly. Newer Supabase
            # asymmetric tokens can omit it, so consult the Auth user endpoint
            # instead of rejecting an already-confirmed callback session.
            if not claims.get("email_confirmed_at") and not self._email_is_confirmed(token):
                raise JWTVerificationError("Email của phiên đăng nhập chưa được xác nhận.")
        subject = claims.get("sub")
        try:
            user_id = str(uuid.UUID(str(subject)))
        except (ValueError, TypeError, AttributeError) as exc:
            raise JWTVerificationError("JWT subject không phải UUID hợp lệ.") from exc

        email = claims.get("email")
        return AuthContext(
            user_id=user_id,
            email=email if isinstance(email, str) else None,
            session_id=claims.get("session_id") if isinstance(claims.get("session_id"), str) else None,
            aal=claims.get("aal") if isinstance(claims.get("aal"), str) else None,
            raw_claims=dict(claims),
        )


_verifier: SupabaseJWTVerifier | None = None
_verifier_lock = threading.Lock()


def get_jwt_verifier(settings: Settings | None = None) -> SupabaseJWTVerifier:
    global _verifier
    current = settings or get_settings()
    with _verifier_lock:
        if _verifier is None or _verifier.settings.auth_issuer != current.auth_issuer:
            _verifier = SupabaseJWTVerifier(current)
        return _verifier


def reset_jwt_verifier() -> None:
    """Test hook: discard the process-local JWKS cache."""
    global _verifier
    with _verifier_lock:
        _verifier = None


def authenticate_bearer(authorization: str | None, settings: Settings | None = None) -> AuthContext:
    """Authenticate a request without ever logging its bearer value."""
    current = settings or get_settings()
    prefix = "bearer "
    token = ""
    if authorization and authorization.lower().startswith(prefix):
        token = authorization[len(prefix) :].strip()

    if current.auth_allow_guest and token.startswith("guest."):
        parts = token.split(".")
        if len(parts) == 3 and parts[1] and parts[2] in {"viewer", "analyst", "admin"}:
            try:
                guest_session_id = str(uuid.UUID(parts[1]))
            except ValueError:
                guest_session_id = ""
            if guest_session_id:
                guest_user_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"p170:guest:{guest_session_id}"))
                return AuthContext(
                    user_id=guest_user_id,
                    email=None,
                    session_id=guest_session_id,
                    aal=None,
                    raw_claims={"guest_session_id": guest_session_id, "role": parts[2]},
                    authentication_method="guest",
                )

    if current.auth_mode == "dual" and token and current.api_token and secrets.compare_digest(token, current.api_token):
        return AuthContext(
            user_id=current.auth_bootstrap_user_id,
            email=None,
            session_id=None,
            aal=None,
            raw_claims={},
            authentication_method="legacy_api_token",
        )

    if token:
        try:
            return get_jwt_verifier(current).verify(token)
        except JWTVerificationError as exc:
            raise _unauthorized(str(exc)) from exc

    # The dual bridge is intentionally convenient only in local/test.  A
    # production instance must present either a verified JWT or its temporary
    # explicit API token.
    if current.auth_mode == "dual" and current.app_env in {"development", "test"} and not current.security_require_api_token:
        return AuthContext(
            user_id=current.auth_bootstrap_user_id,
            email=None,
            session_id=None,
            aal=None,
            raw_claims={},
            authentication_method="legacy_api_token",
        )
    raise _unauthorized("Thiếu Bearer access token.")


__all__ = [
    "AuthContext",
    "JWTVerificationError",
    "SupabaseJWTVerifier",
    "authenticate_bearer",
    "get_jwt_verifier",
    "reset_jwt_verifier",
]
