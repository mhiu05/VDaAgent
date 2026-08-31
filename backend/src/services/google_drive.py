"""Google Drive OAuth and workspace-scoped source storage.

Supabase remains the identity/metadata system.  Drive stores only the binary
dataset source; the refresh token is encrypted before it is written to the
metadata database.
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from src.config import Settings, get_settings
from src.services.repository import get_repository

DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file"


class GoogleDriveError(RuntimeError):
    """Base error for expected Google Drive integration failures."""


class GoogleDriveNotConfiguredError(GoogleDriveError):
    pass


class GoogleDriveConnectionRequiredError(GoogleDriveError):
    pass


class GoogleDriveOAuthError(GoogleDriveError):
    pass


def is_google_drive_ref(value: str) -> bool:
    return value.lower().startswith("gdrive://")


def parse_google_drive_ref(value: str) -> tuple[str, str, str]:
    prefix, separator, remainder = value.partition("://")
    if prefix.lower() != "gdrive" or not separator:
        raise GoogleDriveError("dataset_ref Google Drive không hợp lệ.")
    workspace_id, separator, remainder = remainder.partition("/")
    file_id, separator, filename = remainder.partition("/")
    if not workspace_id or not separator or not file_id or not filename or "/" in filename:
        raise GoogleDriveError("dataset_ref Google Drive không hợp lệ.")
    return workspace_id, file_id, filename


class GoogleDriveOAuth:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        if not self.settings.google_drive_configured:
            raise GoogleDriveNotConfiguredError(
                "Thiếu cấu hình GOOGLE_DRIVE_CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, "
                "FOLDER_ID hoặc TOKEN_ENCRYPTION_KEY."
            )
        try:
            from google_auth_oauthlib.flow import Flow
        except ImportError as exc:  # pragma: no cover - deployment dependency
            raise GoogleDriveNotConfiguredError(
                "Thiếu Google Drive dependency. Cài requirements.txt."
            ) from exc
        self._flow_cls = Flow

    def _client_config(self) -> dict[str, Any]:
        return {
            "web": {
                "client_id": self.settings.google_drive_client_id,
                "client_secret": self.settings.google_drive_client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        }

    def authorization_url(self, state: str) -> str:
        flow = self._flow_cls.from_client_config(
            self._client_config(),
            scopes=[DRIVE_SCOPE],
            redirect_uri=self.settings.google_drive_redirect_uri,
            # The OAuth state is persisted server-side, but the flow object is
            # recreated in the callback. Disable auto-generated PKCE here so
            # the callback does not lose an in-memory code_verifier.
            autogenerate_code_verifier=False,
        )
        url, _ = flow.authorization_url(
            access_type="offline",
            include_granted_scopes="true",
            prompt="consent",
            state=state,
        )
        return url

    def exchange_code(self, code: str) -> str:
        flow = self._flow_cls.from_client_config(
            self._client_config(),
            scopes=[DRIVE_SCOPE],
            redirect_uri=self.settings.google_drive_redirect_uri,
            autogenerate_code_verifier=False,
        )
        try:
            flow.fetch_token(code=code)
        except Exception as exc:
            raise GoogleDriveOAuthError("Google OAuth không đổi được authorization code.") from exc
        refresh_token = getattr(flow.credentials, "refresh_token", None)
        if not refresh_token:
            raise GoogleDriveOAuthError(
                "Google không trả refresh token. Hãy thu hồi quyền ứng dụng rồi kết nối lại."
            )
        return refresh_token

    def encrypt_refresh_token(self, refresh_token: str) -> str:
        try:
            return Fernet(self.settings.google_drive_token_encryption_key.encode()).encrypt(
                refresh_token.encode()
            ).decode()
        except Exception as exc:
            raise GoogleDriveNotConfiguredError(
                "GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY không phải Fernet key hợp lệ."
            ) from exc

    def decrypt_refresh_token(self, encrypted: str) -> str:
        try:
            return Fernet(self.settings.google_drive_token_encryption_key.encode()).decrypt(
                encrypted.encode()
            ).decode()
        except (InvalidToken, ValueError) as exc:
            raise GoogleDriveOAuthError("Không giải mã được refresh token Google Drive.") from exc


class GoogleDriveStorage:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self.oauth = GoogleDriveOAuth(self.settings)

    def _service(self, workspace_id: str):
        repository = get_repository(self.settings)
        connection = repository.get_google_drive_connection(workspace_id)
        if not connection:
            raise GoogleDriveConnectionRequiredError(
                "Workspace chưa kết nối Google Drive. Hãy kết nối Google Drive trước."
            )
        try:
            from google.oauth2.credentials import Credentials
            from googleapiclient.discovery import build
        except ImportError as exc:  # pragma: no cover - deployment dependency
            raise GoogleDriveNotConfiguredError(
                "Thiếu Google Drive dependency. Cài requirements.txt."
            ) from exc
        credentials = Credentials(
            token=None,
            refresh_token=self.oauth.decrypt_refresh_token(connection["encrypted_refresh_token"]),
            token_uri="https://oauth2.googleapis.com/token",
            client_id=self.settings.google_drive_client_id,
            client_secret=self.settings.google_drive_client_secret,
            scopes=[DRIVE_SCOPE],
        )
        service = build("drive", "v3", credentials=credentials, cache_discovery=False)

        # The configured folder may belong to a different Google account. The
        # OAuth token must be able to access the actual upload parent, so fall
        # back to a private app-created folder owned by the connected account.
        try:
            service.files().get(
                fileId=connection["folder_id"],
                fields="id,mimeType",
                supportsAllDrives=True,
            ).execute()
        except Exception as exc:
            response = getattr(exc, "resp", None)
            response_status = getattr(response, "status", None)
            if response_status not in {403, 404}:
                raise
            folder = service.files().create(
                body={
                    "name": f"P170 workspace {workspace_id}",
                    "mimeType": "application/vnd.google-apps.folder",
                },
                fields="id",
                supportsAllDrives=True,
            ).execute()
            folder_id = str(folder.get("id") or "")
            if not folder_id:
                raise GoogleDriveError("Google Drive khÃ´ng tráº£ folder ID.")
            repository.save_google_drive_connection(
                workspace_id,
                folder_id,
                connection["encrypted_refresh_token"],
                connection["connected_by_user_id"],
            )
            connection = {**connection, "folder_id": folder_id}
        return service, connection

    def upload(self, workspace_id: str, local_path: Path, filename: str, content_type: str | None) -> str:
        try:
            from googleapiclient.http import MediaFileUpload
        except ImportError as exc:  # pragma: no cover
            raise GoogleDriveNotConfiguredError("Thiếu google-api-python-client.") from exc
        service, connection = self._service(workspace_id)
        media = MediaFileUpload(
            str(local_path),
            mimetype=content_type or "application/octet-stream",
            resumable=True,
            chunksize=self.settings.google_drive_chunk_mb * 1024 * 1024,
        )
        request = service.files().create(
            body={
                "name": filename,
                "parents": [connection["folder_id"]],
                "appProperties": {"p170_workspace_id": workspace_id},
            },
            media_body=media,
            fields="id,name,size,md5Checksum,mimeType",
            supportsAllDrives=True,
        )
        response = None
        try:
            while response is None:
                _, response = request.next_chunk()
        except Exception as exc:
            raise GoogleDriveError("Google Drive từ chối upload file.") from exc
        file_id = str(response.get("id") or "")
        if not file_id:
            raise GoogleDriveError("Google Drive không trả file ID sau upload.")
        return file_id

    def download(
        self,
        workspace_id: str,
        file_id: str,
        target: Path,
        *,
        max_bytes: int | None = None,
    ) -> None:
        try:
            from googleapiclient.http import MediaIoBaseDownload
        except ImportError as exc:  # pragma: no cover
            raise GoogleDriveNotConfiguredError("Thiếu google-api-python-client.") from exc
        service, _ = self._service(workspace_id)
        request = service.files().get_media(fileId=file_id, supportsAllDrives=True)

        class _LimitedWriter:
            def __init__(self, handle: Any, limit: int | None) -> None:
                self.handle = handle
                self.limit = limit
                self.written = 0

            def write(self, chunk: bytes) -> int:
                next_size = self.written + len(chunk)
                if self.limit is not None and next_size > self.limit:
                    raise GoogleDriveError("Dataset vượt giới hạn dung lượng cho profiling.")
                self.written = next_size
                return self.handle.write(chunk)

        with target.open("wb") as raw_handle:
            handle = _LimitedWriter(raw_handle, max_bytes)
            downloader = MediaIoBaseDownload(
                handle,
                request,
                chunksize=self.settings.google_drive_chunk_mb * 1024 * 1024,
            )
            done = False
            while not done:
                _, done = downloader.next_chunk()

    def remove(self, workspace_id: str, file_id: str) -> None:
        service, _ = self._service(workspace_id)
        try:
            service.files().delete(fileId=file_id, supportsAllDrives=True).execute()
        except Exception as exc:
            raise GoogleDriveError("Không thể xóa file Google Drive.") from exc


def new_oauth_state_id() -> str:
    return secrets.token_urlsafe(32)


def oauth_state_expiry(settings: Settings | None = None) -> datetime:
    current = settings or get_settings()
    return datetime.now(UTC) + timedelta(seconds=current.google_drive_oauth_state_ttl_seconds)


__all__ = [
    "DRIVE_SCOPE",
    "GoogleDriveConnectionRequiredError",
    "GoogleDriveError",
    "GoogleDriveNotConfiguredError",
    "GoogleDriveOAuth",
    "GoogleDriveOAuthError",
    "GoogleDriveStorage",
    "is_google_drive_ref",
    "new_oauth_state_id",
    "oauth_state_expiry",
    "parse_google_drive_ref",
]
