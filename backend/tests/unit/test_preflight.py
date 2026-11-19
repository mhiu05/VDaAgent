from sqlalchemy import insert

from backend import preflight
from backend.db import tables as t
from backend.domains.crypto import encrypt
from backend.settings import Settings

SECRET = "super-secret-dsn-value"


async def _domain(conn, domain_id: str, sets: dict[str, tuple[list[str], dict[str, str] | None]]):
    await conn.execute(
        insert(t.domains).values(id=domain_id, name=f"Test {domain_id}", status="available")
    )
    for name, (keys, values) in sets.items():
        set_id = await conn.scalar(
            insert(t.domain_credential_sets)
            .values(
                domain_id=domain_id,
                name=name,
                keys=keys,
            )
            .returning(t.domain_credential_sets.c.id)
        )
        for key, value in (values or {}).items():
            if value:
                await conn.execute(
                    insert(t.domain_credential_values).values(
                        set_id=set_id,
                        key=key,
                        ciphertext=encrypt(Settings(), value),
                    )
                )


async def test_without_connection_reports_domains_unchecked(platform_env):
    report = await preflight.run(Settings())
    assert report.domains_checked is False
    assert report.ok
    assert "domains: database unreachable, skipped (run again after `make up`)" in report.lines()


def test_platform_ok(platform_env):
    assert preflight.missing_platform_keys(Settings()) == []


def test_missing_platform_keys_by_name(platform_env, clean_env):
    clean_env.delenv("OPENROUTER_API_KEY")
    clean_env.setenv("EXECD_TOKEN", "")
    assert preflight.missing_platform_keys(Settings()) == ["EXECD_TOKEN", "OPENROUTER_API_KEY"]


def test_fake_backend_needs_no_openrouter_key(platform_env, clean_env):
    clean_env.delenv("OPENROUTER_API_KEY")
    clean_env.setenv("MODEL_BACKEND", "fake")
    assert preflight.missing_platform_keys(Settings()) == []


async def test_langfuse_keys_are_optional_warnings(platform_env):
    report = await preflight.run(Settings())
    assert "LANGFUSE_PUBLIC_KEY" in report.optional_missing
    assert report.ok


async def test_model_line_shows_the_effective_models(platform_env, clean_env):
    clean_env.setenv("AGENT_MODEL", "deepseek/deepseek-v4.1-flash")
    lines = (await preflight.run(Settings(), environ={})).lines()
    model = next(line for line in lines if line.startswith("model: "))
    assert "agent=deepseek/deepseek-v4.1-flash compaction=deepseek/deepseek-v4.1-flash" in model
    assert "base_url=https://openrouter.ai/api/v1" in model
    assert all(v not in model for k, v in platform_env.items() if k != "ADMIN_USERNAME")


async def test_ignored_keys_are_named_without_values(platform_env):
    environ = {"OPENAI_API_KEY": "sk-should-not-print", "OPENAI_BASE_URL": "", "PATH": "/bin"}
    report = await preflight.run(Settings(), environ=environ)
    assert report.ignored == ["OPENAI_API_KEY"] and report.ok
    out = "\n".join(report.lines())
    assert "OPENAI_API_KEY is set but not used; use OPENROUTER_API_KEY" in out
    assert "sk-should-not-print" not in out


async def test_domain_available(conn, platform_env):
    await _domain(conn, "fabrikam", {"warehouse": (["WAREHOUSE_DSN"], {"WAREHOUSE_DSN": SECRET})})
    [result] = await preflight.check_domains(conn)
    assert result.domain_id == "fabrikam"
    assert result.available
    assert result.reasons == []


async def test_domain_missing_stored_credentials(conn, platform_env):
    await _domain(conn, "re-marketing", {"warehouse": (["WAREHOUSE_DSN"], None)})
    [result] = await preflight.check_domains(conn)
    assert not result.available
    assert result.reasons == ["credentials/warehouse: missing key WAREHOUSE_DSN"]


async def test_domain_empty_and_missing_keys(conn, platform_env):
    await _domain(conn, "d1", {"warehouse": (["A", "B", "C"], {"A": SECRET, "B": ""})})
    [result] = await preflight.check_domains(conn)
    assert not result.available
    assert result.reasons == [
        "credentials/warehouse: missing key B",
        "credentials/warehouse: missing key C",
    ]


async def test_domain_duplicate_key_across_sets(conn, platform_env):
    await _domain(
        conn,
        "d1",
        {
            "a": (["TOKEN"], {"TOKEN": SECRET}),
            "b": (["TOKEN"], {"TOKEN": SECRET}),
        },
    )
    [result] = await preflight.check_domains(conn)
    assert not result.available
    assert result.reasons == ["key TOKEN appears in credential sets a, b"]


async def test_domain_database_identity_is_authoritative(conn, platform_env, tmp_path):
    await _domain(conn, "d1", {})
    directory = tmp_path / "d1"
    directory.mkdir()
    (directory / "domain.yaml").write_text("id: other\nname: X\n")
    [result] = await preflight.check_domains(conn, domains_dir=tmp_path)
    assert result.domain_id == "d1"
    assert result.name == "Test d1"
    assert result.available


async def test_database_domains_need_no_valid_metadata_files(conn, platform_env, tmp_path):
    await _domain(conn, "d1", {})
    await _domain(conn, "d2", {})
    (tmp_path / "d1").mkdir()
    directory = tmp_path / "d2"
    directory.mkdir()
    (directory / "domain.yaml").write_text("id: [unclosed\n")
    results = await preflight.check_domains(conn, domains_dir=tmp_path)
    assert [result.domain_id for result in results] == ["d1", "d2"]
    assert all(result.available for result in results)


async def test_run_checks_database_domains_without_disclosing_values(conn, platform_env):
    await _domain(conn, "good", {"warehouse": (["WAREHOUSE_DSN"], {"WAREHOUSE_DSN": SECRET})})
    await _domain(conn, "bad", {"warehouse": (["WAREHOUSE_DSN"], None)})
    report = await preflight.run(Settings(), conn, environ={})
    assert report.ok  # unavailable domains do not fail platform preflight
    assert report.domains_checked
    out = "\n".join(report.lines())
    assert "domain good: available" in out
    assert "domain bad: unavailable" in out
    assert "missing key WAREHOUSE_DSN" in out
    assert "domains: database unreachable" not in out
    for value in [*platform_env.values(), SECRET]:
        if value != "admin":
            assert value not in out


def test_main_exit_codes_and_no_values_printed(platform_env, clean_env, capsys):
    # The fixture's unreachable database is expected before first stack startup.
    assert preflight.main([]) == 0
    assert "domains: database unreachable, skipped" in capsys.readouterr().out
    clean_env.delenv("ADMIN_PASSWORD")
    assert preflight.main([]) == 1
    out = capsys.readouterr().out
    assert "ADMIN_PASSWORD" in out
    for value in [*platform_env.values(), SECRET]:
        if value != "admin":
            assert value not in out


def test_main_without_database_url_still_checks_platform(platform_env, clean_env, capsys):
    clean_env.delenv("DATABASE_URL")
    assert preflight.main([]) == 0
    assert "domains: database unreachable, skipped" in capsys.readouterr().out
