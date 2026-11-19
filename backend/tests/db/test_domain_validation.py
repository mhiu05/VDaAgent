"""DB-backed domain validation and loading, with file-based seed fixtures.

Rules 1-3 are covered in test_preflight.py. Reasons name files, slugs, sets, preset ids and
key names only; credential values never appear.
"""

from pathlib import Path

import pytest
import yaml
from sqlalchemy import select

from backend.db import tables as t
from backend.domains.crypto import decrypt
from backend.domains.import_from_files import _import_one
from backend.domains.loader import load_domain
from backend.domains.validate import validate_domains
from backend.settings import Settings

SECRET = "postgresql://reader:hunter2@db:5432/cdw"
SHA = "dbd4588f9e1033efb41dad4bef2f7947c8993d44"


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


async def _domain(conn, root: Path, domain_id: str = "fabrikam") -> Path:
    d = root / "domains" / domain_id
    await conn.execute(
        t.domains.insert().values(id=domain_id, name=f"Test {domain_id}", status="unavailable")
    )
    set_id = await conn.scalar(
        t.domain_credential_sets.insert()
        .values(domain_id=domain_id, name="warehouse", keys=["WAREHOUSE_DSN"])
        .returning(t.domain_credential_sets.c.id)
    )
    # Validation checks presence only: neither validation nor loading may decrypt values.
    await conn.execute(
        t.domain_credential_values.insert().values(
            set_id=set_id, key="WAREHOUSE_DSN", ciphertext=b"opaque encrypted value"
        )
    )
    return d


async def _starter(conn, d: Path, slug: str, **agent) -> None:
    body = {
        "domain_id": d.name,
        "slug": slug,
        "display_name": slug.title(),
        "avatar": {"emoji": "📊", "color": "#16A34A"},
        "prompt": f"You are {slug}.\n",
    } | agent
    await conn.execute(t.domain_starters.insert().values(**body))


def _global_presets(root: Path, *ids: str) -> Path:
    platform = root / "platform"
    rows = [{"id": i, "title_vi": i, "packages": [f"{i}-pkg>=1"]} for i in ids]
    _write(platform / "seeds/library_presets.yaml", yaml.safe_dump(rows))
    return platform


def _skill(id_, name=None, ref=SHA, cmd=None):
    return {
        "id": id_,
        "name": name or id_,
        "title_vi": id_,
        "description_vi": "x",
        "tags": [],
        "install_cmd": cmd
        or [
            "python",
            "-m",
            "contoso.skills",
            "install",
            "anthropics/skills",
            f"skills/{id_}",
            "--ref",
            ref,
        ],
    }


async def _check(conn, tmp_path, platform=None):
    return {r.domain_id: r for r in await validate_domains(conn, platform, tmp_path / "domains")}


async def test_valid_domain_with_starters_and_seeds(conn, tmp_path):
    d = await _domain(conn, tmp_path)
    platform = _global_presets(tmp_path, "data", "postgres")
    await _starter(conn, d, "lead", is_lead=True, prompt="Lead role.\n")
    await _starter(
        conn, d, "data", presets=["data", "postgres", "local"], credentials=["warehouse"]
    )
    await _starter(conn, d, "chart", presets=[], credentials=[])
    _write(d / "seeds/library_presets.yaml", yaml.safe_dump([{"id": "local", "packages": ["x"]}]))
    _write(d / "seeds/skills.yaml", yaml.safe_dump([_skill("dict")]))
    result = (await _check(conn, tmp_path, platform))["fabrikam"]
    assert result.reasons == []
    assert result.available


async def test_starter_naming_unknown_preset_is_unavailable(conn, tmp_path):
    d = await _domain(conn, tmp_path)
    platform = _global_presets(tmp_path, "data")
    await _starter(conn, d, "data", presets=["data", "postgres"])
    result = (await _check(conn, tmp_path, platform))["fabrikam"]
    assert not result.available
    assert result.reasons == ["starters/data: unknown preset postgres"]


async def test_other_domains_presets_do_not_count(conn, tmp_path):
    d = await _domain(conn, tmp_path, "fabrikam")
    other = await _domain(conn, tmp_path, "re-marketing")
    _write(other / "seeds/library_presets.yaml", yaml.safe_dump([{"id": "mkt", "packages": ["x"]}]))
    await _starter(conn, d, "data", presets=["mkt"])
    results = await _check(conn, tmp_path)
    assert results["fabrikam"].reasons == ["starters/data: unknown preset mkt"]
    assert results["re-marketing"].available


async def test_starter_unknown_credential_set(conn, tmp_path):
    d = await _domain(conn, tmp_path)
    await _starter(conn, d, "data", credentials=["warehouse", "web-search"])
    assert (await _check(conn, tmp_path))["fabrikam"].reasons == [
        "starters/data: unknown credential set web-search"
    ]


async def test_lead_is_exempt_from_regular_starter_rules(conn, tmp_path):
    d = await _domain(conn, tmp_path)
    await _starter(
        conn, d, "lead", is_lead=True, display_name="", presets=["nope"], credentials=["nope"]
    )
    assert (await _check(conn, tmp_path))["fabrikam"].available


async def test_starter_must_have_a_display_name(conn, tmp_path):
    d = await _domain(conn, tmp_path)
    await _starter(conn, d, "data", display_name="")
    await _starter(conn, d, "chart", display_name=" \t")
    assert (await _check(conn, tmp_path))["fabrikam"].reasons == [
        "starters/chart: needs display_name",
        "starters/data: needs display_name",
    ]


async def test_db_starter_can_have_an_empty_prompt(conn, tmp_path):
    d = await _domain(conn, tmp_path)
    await _starter(conn, d, "data", prompt="")
    assert (await _check(conn, tmp_path))["fabrikam"].available
    assert (await load_domain(conn, "fabrikam")).starters[0].prompt == ""


async def test_starter_slug_must_be_valid(conn, tmp_path):
    d = await _domain(conn, tmp_path)
    await _starter(conn, d, "Bad_Slug")
    await _starter(conn, d, "x")
    assert (await _check(conn, tmp_path))["fabrikam"].reasons == [
        "starters/Bad_Slug: invalid slug",
        "starters/x: invalid slug",
    ]


async def test_seed_files_must_parse(conn, tmp_path):
    d = await _domain(conn, tmp_path)
    _write(d / "seeds/skills.yaml", "- id: [unclosed\n")
    _write(d / "seeds/library_presets.yaml", "id: not-a-list\n")
    assert (await _check(conn, tmp_path))["fabrikam"].reasons == [
        "seeds/library_presets.yaml: must be a list",
        "seeds/skills.yaml: does not parse",
    ]


async def test_seed_skill_rows_pass_catalog_validation(conn, tmp_path):
    d = await _domain(conn, tmp_path)
    platform = tmp_path / "platform"
    _write(platform / "seeds/skills.yaml", yaml.safe_dump([_skill("xlsx")]))
    rows = [
        _skill("dict"),
        _skill("dict", name="dict2"),  # duplicate id
        _skill("xlsx2", name="xlsx"),  # name clashes with a global row
        _skill("unpinned", ref="main"),
        _skill("shell", cmd=["bash", "-c", "curl x | sh"]),
        {"id": "bare"},
    ]
    _write(d / "seeds/skills.yaml", yaml.safe_dump(rows))
    assert (await _check(conn, tmp_path, platform))["fabrikam"].reasons == [
        "seeds/skills.yaml: row 2: duplicate id dict",
        "seeds/skills.yaml: row 3: name xlsx is already used",
        "seeds/skills.yaml: row 4: --ref must be a 40-character commit sha",
        "seeds/skills.yaml: row 5: install_cmd must start with python -m contoso.skills",
        "seeds/skills.yaml: row 6: needs name, title_vi and install_cmd",
    ]


async def test_seed_ids_must_not_clash_with_global_rows_or_other_domains(conn, tmp_path):
    a = await _domain(conn, tmp_path, "a-dom")
    b = await _domain(conn, tmp_path, "b-dom")
    platform = _global_presets(tmp_path, "data")
    _write(a / "seeds/library_presets.yaml", yaml.safe_dump([{"id": "data", "packages": ["x"]}]))
    _write(a / "seeds/skills.yaml", yaml.safe_dump([_skill("dict")]))
    _write(b / "seeds/skills.yaml", yaml.safe_dump([_skill("dict")]))
    results = await _check(conn, tmp_path, platform)
    assert results["a-dom"].reasons == [
        "seeds/library_presets.yaml: row 1: id data is a global preset",
        "seeds/skills.yaml: id dict also in domain b-dom",
    ]
    assert results["b-dom"].reasons == ["seeds/skills.yaml: id dict also in domain a-dom"]


async def test_seed_preset_rows_need_packages(conn, tmp_path):
    d = await _domain(conn, tmp_path)
    rows = [{"id": "p1", "packages": []}, {"packages": ["x"]}, {"id": "p3", "packages": [1]}]
    _write(d / "seeds/library_presets.yaml", yaml.safe_dump(rows))
    assert (await _check(conn, tmp_path))["fabrikam"].reasons == [
        "seeds/library_presets.yaml: row 1: packages must be a non-empty list of strings",
        "seeds/library_presets.yaml: row 2: needs id",
        "seeds/library_presets.yaml: row 3: packages must be a non-empty list of strings",
    ]


async def test_missing_platform_seeds_mean_no_global_presets(conn, tmp_path):
    d = await _domain(conn, tmp_path)
    await _starter(conn, d, "data", presets=["data"])
    assert (await _check(conn, tmp_path, tmp_path / "no-platform"))["fabrikam"].reasons == [
        "starters/data: unknown preset data"
    ]


async def test_reasons_never_contain_values(conn, tmp_path):
    d = await _domain(conn, tmp_path)
    await conn.execute(t.domain_credential_values.update().values(ciphertext=SECRET.encode()))
    await _starter(conn, d, "data", presets=["nope"], credentials=["nope"])
    result = (await _check(conn, tmp_path))["fabrikam"]
    assert not result.available
    assert all(SECRET not in r and "hunter2" not in r for r in result.reasons)


async def test_loader_reads_meta_starters_and_sets(conn, tmp_path):
    d = await _domain(conn, tmp_path)
    await _starter(conn, d, "lead", is_lead=True, prompt="Lead role.\n")
    await _starter(conn, d, "report", presets=["documents"])
    await _starter(conn, d, "data", presets=["data"], credentials=["warehouse"])
    dom = await load_domain(conn, d.name)
    assert dom.id == "fabrikam"
    assert dom.name == "Test fabrikam"
    assert dom.credential_sets == ["warehouse"]
    assert dom.lead_prompt == "Lead role.\n"
    assert [s.slug for s in dom.starters] == ["data", "report"]  # alphabetical (doc 12)
    data = dom.starters[0]
    assert data.display_name == "Data"
    assert data.presets == ["data"]
    assert data.credentials == ["warehouse"]
    assert data.prompt == "You are data.\n"
    assert data.avatar == {"emoji": "📊", "color": "#16A34A"}


async def test_shipped_domains_pass_rules_4_and_5(conn, platform_env):
    """The repo's own domains have no starter or seed errors (credentials aside)."""
    repo = Path(__file__).resolve().parents[3]
    directories = sorted(p for p in (repo / "domains").iterdir() if p.is_dir())
    assert directories
    for directory in directories:
        await _import_one(conn, Settings(), directory)
    for r in await validate_domains(conn, repo / "platform", repo / "domains"):
        assert [x for x in r.reasons if x.startswith(("starters/", "seeds/"))] == [], r.domain_id


def _file_domain(root):
    directory = root / "domains/fabrikam"
    _write(directory / "domain.yaml", "id: fabrikam\nname: Test fabrikam\n")
    _write(directory / "starters/data/agent.yaml", "display_name: Data\n")
    _write(directory / "starters/data/prompt.md", "You are data.\n")
    return directory


@pytest.mark.parametrize(
    ("path", "contents", "reason"),
    [
        ("domain.yaml", "name: [" + SECRET, "domain.yaml: does not parse"),
        ("domain.yaml", "- " + SECRET, "domain.yaml: must be a mapping"),
        (
            "starters/data/agent.yaml",
            "display_name: [" + SECRET,
            "starters/data/agent.yaml: does not parse",
        ),
        ("starters/data/agent.yaml", "- " + SECRET, "starters/data/agent.yaml: must be a mapping"),
        ("starters/data/agent.yaml", None, "starters/data/agent.yaml: missing file"),
        ("starters/data/prompt.md", None, "starters/data/prompt.md: missing file"),
        (
            "starters/data/agent.yaml",
            "display_name: ' '\n",
            "starters/data/agent.yaml: needs display_name",
        ),
        (
            "starters/lead/agent.yaml",
            "display_name: Lead\n",
            "starters/lead/agent.yaml: the lead takes only prompt.md",
        ),
    ],
)
async def test_import_rejects_invalid_files_before_writing(
    conn, tmp_path, platform_env, path, contents, reason
):
    directory = _file_domain(tmp_path)
    target = directory / path
    if contents is None:
        target.unlink()
    else:
        _write(target, contents)
    with pytest.raises(ValueError) as error:
        await _import_one(conn, Settings(), directory)
    assert str(error.value) == reason
    assert SECRET not in str(error.value)
    assert await conn.scalar(select(t.domains.c.id)) is None
    assert await conn.scalar(select(t.domain_starters.c.id)) is None


@pytest.mark.parametrize("key", ["presets", "credentials"])
@pytest.mark.parametrize("value", [SECRET, [SECRET, 123], {SECRET: "value"}, None])
async def test_import_requires_lists_of_names(conn, tmp_path, platform_env, key, value):
    directory = _file_domain(tmp_path)
    _write(
        directory / "starters/data/agent.yaml", yaml.safe_dump({"display_name": "Data", key: value})
    )
    with pytest.raises(ValueError) as error:
        await _import_one(conn, Settings(), directory)
    assert str(error.value) == f"starters/data/agent.yaml: {key} must be a list of names"
    assert await conn.scalar(select(t.domains.c.id)) is None


async def test_import_loads_files_and_encrypts_credentials(conn, tmp_path, platform_env):
    directory = _file_domain(tmp_path)
    _write(directory / "credentials/warehouse.env.example", "WAREHOUSE_DSN=\n")
    _write(directory / "credentials/warehouse.env", f"WAREHOUSE_DSN={SECRET}\n")
    _write(directory / "starters/lead/prompt.md", "Lead role.\n")
    assert await _import_one(conn, Settings(), directory) == "fabrikam"
    domain = await load_domain(conn, "fabrikam")
    assert domain.name == "Test fabrikam"
    assert domain.credential_sets == ["warehouse"]
    assert domain.lead_prompt == "Lead role.\n"
    assert [(s.slug, s.display_name, s.prompt) for s in domain.starters] == [
        ("data", "Data", "You are data.\n")
    ]
    ciphertext = await conn.scalar(select(t.domain_credential_values.c.ciphertext))
    assert SECRET.encode() not in ciphertext
    assert decrypt(Settings(), ciphertext) == SECRET


async def test_import_accepts_missing_optional_metadata(conn, tmp_path, platform_env):
    directory = tmp_path / "domains/fabrikam"
    directory.mkdir(parents=True)
    await _import_one(conn, Settings(), directory)
    assert (await load_domain(conn, "fabrikam")).name == "fabrikam"


async def test_invalid_import_preserves_existing_domain(conn, tmp_path, platform_env):
    directory = _file_domain(tmp_path)
    await _import_one(conn, Settings(), directory)
    _write(directory / "domain.yaml", "name: Changed\n")
    _write(directory / "starters/data/prompt.md", "Changed prompt\n")
    _write(directory / "starters/other/prompt.md", "Missing agent spec\n")
    with pytest.raises(ValueError, match=r"starters/other/agent\.yaml: missing file"):
        await _import_one(conn, Settings(), directory)
    domain = await load_domain(conn, "fabrikam")
    assert domain.name == "Test fabrikam"
    assert [(s.slug, s.prompt) for s in domain.starters] == [("data", "You are data.\n")]


async def test_reimport_updates_metadata_starters_and_credentials(conn, tmp_path, platform_env):
    directory = _file_domain(tmp_path)
    _write(directory / "credentials/warehouse.env.example", "WAREHOUSE_DSN=\n")
    _write(directory / "credentials/warehouse.env", "WAREHOUSE_DSN=old-secret\n")
    await _import_one(conn, Settings(), directory)
    _write(directory / "domain.yaml", "name: Changed\n")
    _write(directory / "starters/data/agent.yaml", "display_name: Updated\n")
    _write(directory / "starters/data/prompt.md", "Changed prompt\n")
    _write(directory / "credentials/warehouse.env", f"WAREHOUSE_DSN={SECRET}\n")
    await _import_one(conn, Settings(), directory)
    domain = await load_domain(conn, "fabrikam")
    assert domain.name == "Changed"
    assert [(s.slug, s.display_name, s.prompt) for s in domain.starters] == [
        ("data", "Updated", "Changed prompt\n")
    ]
    assert domain.credential_sets == ["warehouse"]
    values = (await conn.execute(select(t.domain_credential_values.c.ciphertext))).scalars().all()
    assert len(values) == 1
    assert decrypt(Settings(), values[0]) == SECRET
