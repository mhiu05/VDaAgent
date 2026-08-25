from types import SimpleNamespace

from src.services.google_drive import GoogleDriveOAuth


def test_authorization_url_allows_the_user_to_choose_a_google_account() -> None:
    class FakeFlow:
        authorization_kwargs: dict[str, object] = {}

        @classmethod
        def from_client_config(cls, *_args: object, **_kwargs: object) -> "FakeFlow":
            return cls()

        def authorization_url(self, **kwargs: object) -> tuple[str, None]:
            type(self).authorization_kwargs = kwargs
            return "https://accounts.google.com/o/oauth2/auth", None

    oauth = object.__new__(GoogleDriveOAuth)
    oauth.settings = SimpleNamespace(
        google_drive_client_id="client-id",
        google_drive_client_secret="client-secret",
        google_drive_redirect_uri="http://localhost:8000/api/v1/google-drive/callback",
    )
    oauth._flow_cls = FakeFlow

    assert oauth.authorization_url("state-123") == "https://accounts.google.com/o/oauth2/auth"
    assert FakeFlow.authorization_kwargs == {
        "access_type": "offline",
        "include_granted_scopes": "true",
        "prompt": "select_account consent",
        "state": "state-123",
    }
