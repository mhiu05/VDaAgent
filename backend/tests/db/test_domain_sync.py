"""Boot step 3: upsert `domains` with status and reasons (doc 12 "Validation at boot")."""

from __future__ import annotations

from sqlalchemy import select

from backend.db import tables as t
from backend.domains.import_from_files import run as import_domains
from backend.domains.validate import DomainResult, sync_domains, validate_domains
from backend.settings import Settings


async def _domains(conn):
    rows = (await conn.execute(select(t.domains).order_by(t.domains.c.id))).all()
    return {r.id: r for r in rows}


async def _notifications(conn, user_id):
    q = select(t.user_notifications).where(t.user_notifications.c.user_id == user_id)
    return (await conn.execute(q)).all()


async def test_inserts_available_and_unavailable_with_reasons(conn):
    await sync_domains(
        conn,
        [
            DomainResult("fabrikam", name="Fabrikam Sales Ops"),
            DomainResult(
                "re-marketing",
                name="Real-estate marketing",
                reasons=["credentials/warehouse.env: missing file", "key A appears in sets a, b"],
            ),
        ],
    )
    got = await _domains(conn)
    assert got["fabrikam"].status == "available"
    assert got["fabrikam"].status_reason is None
    assert got["fabrikam"].name == "Fabrikam Sales Ops"
    assert got["re-marketing"].status == "unavailable"
    assert got["re-marketing"].status_reason == (
        "credentials/warehouse.env: missing file\nkey A appears in sets a, b"
    )


async def test_upsert_updates_status_name_and_synced_at(conn, rows):
    await sync_domains(conn, [DomainResult("fabrikam", name="Old", reasons=["x: missing file"])])
    before = (await _domains(conn))["fabrikam"].synced_at
    await conn.exec_driver_sql("SELECT pg_sleep(0.01)")
    await sync_domains(conn, [DomainResult("fabrikam", name="New")])
    row = (await _domains(conn))["fabrikam"]
    assert (row.status, row.status_reason, row.name) == ("available", None, "New")
    assert row.synced_at >= before


async def test_name_falls_back_to_directory(conn):
    await sync_domains(conn, [DomainResult("broken", reasons=["domain.yaml: does not parse"])])
    assert (await _domains(conn))["broken"].name == "broken"


async def test_db_domain_stays_available_without_a_directory(conn, rows, tmp_path):
    await rows.domain("old-domain")
    await rows.user(domain_id="old-domain")  # users keep the FK, so the row stays
    await sync_domains(conn, await validate_domains(conn, domains_dir=tmp_path / "missing"))
    row = (await _domains(conn))["old-domain"]
    assert row.status == "available"
    assert row.status_reason is None
    assert await _notifications(conn, await conn.scalar(select(t.users.c.id))) == []


async def test_import_marks_cross_domain_seed_id_conflicts_unavailable(
    conn, tmp_path, platform_env
):
    for domain_id in ("a-dom", "b-dom"):
        seeds = tmp_path / domain_id / "seeds"
        seeds.mkdir(parents=True)
        (seeds / "library_presets.yaml").write_text("- id: local\n  packages: [example]\n")
    imported = await import_domains(tmp_path, Settings(), conn)
    assert imported == ["a-dom", "b-dom"]
    domains = await _domains(conn)
    assert domains["a-dom"].status == "unavailable"
    assert domains["a-dom"].status_reason == (
        "seeds/library_presets.yaml: id local also in domain b-dom"
    )
    assert domains["b-dom"].status == "unavailable"
    assert domains["b-dom"].status_reason == (
        "seeds/library_presets.yaml: id local also in domain a-dom"
    )


async def test_becoming_unavailable_notifies_the_domains_users(conn, rows):
    await sync_domains(conn, [DomainResult("fabrikam", name="V")])
    alice = await rows.user(domain_id="fabrikam")
    bob = await rows.user(domain_id="fabrikam")
    await rows.insert(
        t.user_preferences,
        user_id=bob,
        value={"notifications": {"reports": True, "tasks": True, "system": False}},
    )
    broken = [DomainResult("fabrikam", name="V", reasons=["credentials/w.env: missing file"])]
    await sync_domains(conn, broken)
    [n] = await _notifications(conn, alice)
    assert n.kind == "system"
    assert n.title["vi"] and n.title["en"]
    assert "w.env" not in n.summary["vi"]  # fixed template, no reasons
    assert n.target == {"kind": "system-detail", "notificationId": str(n.id)}
    assert await _notifications(conn, bob) == []  # system group turned off

    await sync_domains(conn, broken)  # still unavailable: no second notification
    assert len(await _notifications(conn, alice)) == 1


async def test_domain_outage_notifies_humans_not_service_accounts(conn, rows):
    # A group's technical owner (account_type='service') is not a person to notify.
    await sync_domains(conn, [DomainResult("fabrikam", name="V")])
    alice = await rows.user(domain_id="fabrikam")
    service = await rows.user(
        username="svc.0123456789abcdef", domain_id="fabrikam", account_type="service"
    )
    await sync_domains(conn, [DomainResult("fabrikam", name="V", reasons=["down"])])
    assert len(await _notifications(conn, alice)) == 1
    assert await _notifications(conn, service) == []
