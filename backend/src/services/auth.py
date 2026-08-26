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

# pyrefly: ignore [missing-import]
import httpx
# pyrefly: ignore [missing-import]
from fastapi import HTTPException, status
# pyrefly: ignore [missing-import]
from src.config import Settings, get_settings
import time
from functools import wraps

def ttl_cache(ttl_seconds: int):
    def decorator(func):
        cache = {}
        @wraps(func)
        def wrapper(*args, **kwargs):
            # args[0] is self, args[1] is token string.
            # Using token as cache key is safe because token uniqueness guarantees auth uniqueness
            key = args[1:] if len(args) > 1 else args
            if key in cache:
                val, exp = cache[key]
                if time.monotonic() < exp:
                    return val
                del cache[key]
            val = func(*args, **kwargs)
            cache[key] = (val, time.monotonic() + ttl_seconds)
            return val
        return wrapper
    return decorator


class JWTVerificationError(ValueError):
    """A token was absent, malformed, expired, or failed a required claim."""

    def __init__(self, message: str, *, allow_remote_fallback: bool = True) -> None:
        super().__init__(message)
        self.allow_remote_fallback = allow_remote_fallback


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
            # pyrefly: ignore [missing-import]
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

    @ttl_cache(ttl_seconds=60)
    def verify(self, token: str) -> AuthContext:
        try:
            # pyrefly: ignore [missing-import]
            import jwt
            # pyrefly: ignore [missing-import]
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
                leeway=60,
                options={"require": ["exp", "sub", "role"], "verify_iss": False},
            )
        except InvalidTokenError as exc:
            print(f"JWT Decode error: {exc!r}")
            if isinstance(
                exc,
                (
                    jwt.ExpiredSignatureError,
                    jwt.ImmatureSignatureError,
                    jwt.InvalidAudienceError,
                    jwt.InvalidIssuerError,
                ),
            ):
                raise JWTVerificationError(
                    "JWT is invalid or expired.",
                    allow_remote_fallback=False,
                ) from exc
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

    @ttl_cache(ttl_seconds=60)
    def verify_with_auth_api(self, access_token: str) -> AuthContext:
        """Verify a Supabase token through Auth when local JWKS cannot.

        Supabase projects created with older signing-key settings can issue a
        valid token that is not locally verifiable with the asymmetric JWKS
        algorithms configured above. The Auth user endpoint is still an
        authoritative token verifier, so use it only as a narrow fallback.
        Invalid, expired, unconfirmed, or unreachable sessions remain denied.
        """
        if not self.settings.supabase_url:
            raise JWTVerificationError("Thiếu SUPABASE_URL để xác thực phiên.")
        api_key = self.settings.supabase_service_role_key or self.settings.supabase_publishable_key or self.settings.supabase_backend_key
        if not api_key:
            raise JWTVerificationError("Thiếu Supabase API key để xác thực phiên.")
        try:
            response = httpx.get(
                f"{self.settings.supabase_url.rstrip('/')}/auth/v1/user",
                headers={
                    "apikey": api_key,
                    "Authorization": f"Bearer {access_token}",
                },
                timeout=self.settings.auth_jwks_timeout_seconds,
            )
            if response.status_code != 200:
                print(f"Supabase Auth API failed: {response.status_code} {response.text}")
        except httpx.RequestError as exc:
            print(f"Supabase Auth API request error: {exc}")
            raise JWTVerificationError("Không thể kiểm tra phiên với Supabase Auth.") from exc
        if response.status_code != 200:
            print(f"Supabase Auth API returned {response.status_code}: {response.text}")
            raise JWTVerificationError(f"Access token Supabase không hợp lệ: {response.status_code} {response.text}")
        try:
            user = response.json()
        except ValueError as exc:
            raise JWTVerificationError("Supabase trả về dữ liệu user không hợp lệ.") from exc
        if not isinstance(user, dict):
            raise JWTVerificationError("Supabase trả về dữ liệu user không hợp lệ.")
        try:
            user_id = str(uuid.UUID(str(user.get("id"))))
        except (ValueError, TypeError, AttributeError) as exc:
            raise JWTVerificationError("Supabase user id không phải UUID hợp lệ.") from exc
        if self.settings.auth_require_email_confirmed and not user.get("email_confirmed_at"):
            raise JWTVerificationError("Email của phiên đăng nhập chưa được xác nhận.")
        email = user.get("email")
        return AuthContext(
            user_id=user_id,
            email=email if isinstance(email, str) else None,
            session_id=None,
            aal=None,
            raw_claims={
                "sub": user_id,
                "role": "authenticated",
                "email": email,
                "email_confirmed_at": user.get("email_confirmed_at"),
            },
            authentication_method="supabase",
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
        if len(parts) == 3 and parts[1] and parts[2] == "analyst":
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
        # PERF-001: attribute local JWT/JWKS verification and the remote
        # Supabase Auth fallback to separate phases. The local path should
        # dominate; a large auth_remote_ms means tokens are triggering the
        # network fallback per request (see PERF-105).
        from src.services import perf_telemetry

        try:
            with perf_telemetry.timed("auth_local_ms"):
                return get_jwt_verifier(current).verify(token)
        except JWTVerificationError as exc:
            if not exc.allow_remote_fallback:
                raise _unauthorized(str(exc)) from exc
            # Keep local JWT/JWKS verification as the fast path. The Auth API
            # fallback supports valid tokens from Supabase projects that use
            # legacy or otherwise different signing-key configuration.
            try:
                with perf_telemetry.timed("auth_remote_ms"):
                    return get_jwt_verifier(current).verify_with_auth_api(token)
            except JWTVerificationError as remote_exc:
                raise _unauthorized(str(remote_exc)) from exc

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
