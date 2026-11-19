import re
import string

from backend import init_env

EXAMPLE = """# header comment
OPENROUTER_API_KEY=
ADMIN_USERNAME=
POSTGRES_PASSWORD=
SESSION_SECRET=
EXECD_TOKEN=
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_NEXTAUTH_SECRET=
LANGFUSE_SALT=
LANGFUSE_ENCRYPTION_KEY=
CLICKHOUSE_PASSWORD=
REDIS_AUTH=
MINIO_ROOT_PASSWORD=
APP_PORT=8000
"""

URLSAFE = set(string.ascii_letters + string.digits + "-_")
UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"


def _parse(path):
    out = {}
    for line in path.read_text().splitlines():
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            out[k] = v
    return out


def test_copies_example_and_fills_generated_keys(tmp_path, capsys):
    (tmp_path / ".env.example").write_text(EXAMPLE)
    filled = init_env.init_env(tmp_path / ".env", tmp_path / ".env.example")

    env = _parse(tmp_path / ".env")
    assert sorted(filled) == sorted(init_env.GENERATED_KEYS)
    for key in (
        "POSTGRES_PASSWORD",
        "SESSION_SECRET",
        "EXECD_TOKEN",
        "LANGFUSE_NEXTAUTH_SECRET",
        "LANGFUSE_SALT",
        "CLICKHOUSE_PASSWORD",
        "REDIS_AUTH",
        "MINIO_ROOT_PASSWORD",
    ):
        assert len(env[key]) == 43 and set(env[key]) <= URLSAFE, key
    assert re.fullmatch(r"[0-9a-f]{64}", env["LANGFUSE_ENCRYPTION_KEY"])
    assert re.fullmatch("pk-lf-" + UUID, env["LANGFUSE_PUBLIC_KEY"])
    assert re.fullmatch("sk-lf-" + UUID, env["LANGFUSE_SECRET_KEY"])
    # operator keys stay blank, other values and comments are kept
    assert env["OPENROUTER_API_KEY"] == ""
    assert env["ADMIN_USERNAME"] == ""
    assert env["APP_PORT"] == "8000"
    assert "# header comment" in (tmp_path / ".env").read_text()


def test_never_overwrites_and_appends_missing(tmp_path):
    (tmp_path / ".env.example").write_text(EXAMPLE)
    (tmp_path / ".env").write_text("SESSION_SECRET=keep-me\nOTHER=1\nREDIS_AUTH=\n")
    filled = init_env.init_env(tmp_path / ".env", tmp_path / ".env.example")

    env = _parse(tmp_path / ".env")
    assert env["SESSION_SECRET"] == "keep-me"
    assert env["OTHER"] == "1"
    assert "SESSION_SECRET" not in filled
    assert "REDIS_AUTH" in filled and env["REDIS_AUTH"]
    assert env["EXECD_TOKEN"]  # absent from .env → appended
    # an existing .env is not replaced by the example
    assert "OPENROUTER_API_KEY" not in env


def test_idempotent(tmp_path):
    (tmp_path / ".env.example").write_text(EXAMPLE)
    init_env.init_env(tmp_path / ".env", tmp_path / ".env.example")
    before = (tmp_path / ".env").read_text()
    assert init_env.init_env(tmp_path / ".env", tmp_path / ".env.example") == []
    assert (tmp_path / ".env").read_text() == before


def test_file_mode_is_private(tmp_path):
    (tmp_path / ".env.example").write_text(EXAMPLE)
    init_env.init_env(tmp_path / ".env", tmp_path / ".env.example")
    assert (tmp_path / ".env").stat().st_mode & 0o777 == 0o600


def _domain(tmp_path, domain_id, name, template):
    creds = tmp_path / "domains" / domain_id / "credentials"
    creds.mkdir(parents=True, exist_ok=True)
    (creds / f"{name}.env.example").write_text(template)
    return creds / f"{name}.env"


def _main(tmp_path):
    return init_env.main(
        [
            "--env",
            str(tmp_path / ".env"),
            "--example",
            str(tmp_path / ".env.example"),
            "--domains",
            str(tmp_path / "domains"),
        ]
    )


def test_main_prints_names_only(tmp_path, capsys):
    (tmp_path / ".env.example").write_text(EXAMPLE)
    assert _main(tmp_path) == 0
    out = capsys.readouterr().out
    env = _parse(tmp_path / ".env")
    assert "SESSION_SECRET" in out
    for key in init_env.GENERATED_KEYS:
        assert env[key] not in out


def test_copies_missing_credential_templates_privately(tmp_path):
    new = _domain(tmp_path, "fabrikam", "warehouse", "# description: x\nWAREHOUSE_DSN=\n")
    kept = _domain(tmp_path, "re-marketing", "warehouse", "WAREHOUSE_DSN=\n")
    kept.write_text("WAREHOUSE_DSN=postgres://keep\n")

    created = init_env.copy_credential_templates(tmp_path / "domains")

    assert created == [new]
    assert new.read_text() == "# description: x\nWAREHOUSE_DSN=\n"
    assert new.stat().st_mode & 0o777 == 0o600
    assert kept.read_text() == "WAREHOUSE_DSN=postgres://keep\n"
    assert init_env.copy_credential_templates(tmp_path / "domains") == []


def test_report_lists_empty_keys_by_file_without_values(tmp_path, capsys):
    (tmp_path / ".env.example").write_text(EXAMPLE)
    (tmp_path / ".env").write_text("OPENROUTER_API_KEY=sk-or-secret\nADMIN_USERNAME=\n")
    _domain(tmp_path, "fabrikam", "warehouse", "WAREHOUSE_DSN=\nWAREHOUSE_SNAPSHOT_ID=\n")
    filled_cred = _domain(tmp_path, "fabrikam", "web-search", "TAVILY_API_KEY=\n")
    filled_cred.write_text("TAVILY_API_KEY=tvly-secret\n")

    assert _main(tmp_path) == 0
    out = capsys.readouterr().out

    env_prefix = f"  {tmp_path / '.env'}:"
    env_line = next(line for line in out.splitlines() if line.startswith(env_prefix))
    assert "ADMIN_USERNAME" in env_line and "ADMIN_PASSWORD" in env_line
    assert "OPENROUTER_API_KEY" not in env_line
    assert "DEMO_PASSWORD" in out  # optional, still reported
    assert "WAREHOUSE_DSN, WAREHOUSE_SNAPSHOT_ID" in out
    assert "TAVILY_API_KEY" not in out
    assert "sk-or-secret" not in out and "tvly-secret" not in out
    assert "make check" in out


def test_report_says_nothing_to_fill_when_required_keys_are_set(tmp_path, capsys):
    (tmp_path / ".env.example").write_text(EXAMPLE)
    (tmp_path / ".env").write_text("OPENROUTER_API_KEY=a\nADMIN_USERNAME=b\nADMIN_PASSWORD=c\n")
    cred = _domain(tmp_path, "fabrikam", "warehouse", "WAREHOUSE_DSN=\n")
    cred.write_text("WAREHOUSE_DSN=d\n")

    assert _main(tmp_path) == 0
    out = capsys.readouterr().out
    assert "nothing to fill" in out and "make up" in out
    assert "make check" not in out


def test_repo_env_example_lists_every_key():
    from pathlib import Path

    from backend.settings import Settings

    example = Path(__file__).resolve().parents[3] / ".env.example"
    env = _parse(example)
    documented = set(Settings.model_fields) - set(init_env.INTERNAL_KEYS)
    assert documented <= set(env), sorted(documented - set(env))
    for key in (*init_env.OPERATOR_KEYS, *init_env.OPTIONAL_OPERATOR_KEYS):
        assert env[key] == "", key
    for key in init_env.GENERATED_KEYS:
        assert env[key] == "", key
