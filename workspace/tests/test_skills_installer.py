"""`python -m contoso.skills install` (doc 05 "Installer `contoso.skills`", doc 17)."""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tarfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

SHA = "0123456789abcdef0123456789abcdef01234567"
SKILL_MD = "---\nname: xlsx\ndescription: Work with spreadsheets\n---\n# xlsx\n"


def make_tarball(members: dict[str, str | bytes | tuple], repo: str = "skills") -> bytes:
    """members: name -> content, or ("symlink", target), or ("dir",)."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, content in members.items():
            info = tarfile.TarInfo(name)
            if isinstance(content, tuple) and content[0] == "symlink":
                info.type = tarfile.SYMTYPE
                info.linkname = content[1]
                tar.addfile(info)
            elif isinstance(content, tuple) and content[0] == "dir":
                info.type = tarfile.DIRTYPE
                tar.addfile(info)
            else:
                data = content.encode() if isinstance(content, str) else content
                info.size = len(data)
                if name.endswith(".bin"):
                    info.mode = 0o755
                tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


class Codeload:
    def __init__(self) -> None:
        self.tarballs: dict[str, bytes] = {}
        self.auth: list[str | None] = []
        srv = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                srv.auth.append(self.headers.get("Authorization"))
                data = srv.tarballs.get(self.path)
                if data is None:
                    self.send_response(404)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *a):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def add(self, owner_repo: str, sha: str, members: dict) -> None:
        repo = owner_repo.split("/")[1]
        prefixed = {f"{repo}-{sha}/{k}": v for k, v in members.items()}
        self.tarballs[f"/{owner_repo}/tar.gz/{sha}"] = make_tarball(prefixed)


@pytest.fixture
def codeload():
    c = Codeload()
    yield c
    c.server.shutdown()


def install(folder: Path, codeload: Codeload, *args: str, env: dict | None = None):
    e = {
        "PATH": os.environ["PATH"],
        "PYTHONPATH": "/opt",
        "HOME": str(folder),
        "CONTOSO_SKILLS_CODELOAD_URL": codeload.url,
        **(env or {}),
    }
    return subprocess.run(
        [sys.executable, "-m", "contoso.skills", "install", *args],
        cwd=folder,
        env=e,
        capture_output=True,
        text=True,
        timeout=60,
    )


def test_installs_only_the_path(folder, codeload):
    codeload.add(
        "anthropics/skills",
        SHA,
        {
            "README.md": "repo readme",
            "document-skills/xlsx/SKILL.md": SKILL_MD,
            "document-skills/xlsx/scripts/recalc.py": "print(1)",
            "document-skills/xlsx/ref/notes.md": "notes",
            "document-skills/docx/SKILL.md": SKILL_MD.replace("xlsx", "docx"),
        },
    )
    r = install(folder, codeload, "anthropics/skills", "document-skills/xlsx", "--ref", SHA)
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout) == {"installed": "skills/xlsx", "files": 3, "has_code": True}
    skills = folder / "skills"
    files = sorted(str(p.relative_to(folder)) for p in skills.rglob("*") if p.is_file())
    assert files == [
        "skills/xlsx/SKILL.md",
        "skills/xlsx/ref/notes.md",
        "skills/xlsx/scripts/recalc.py",
    ]
    assert codeload.auth == [None]


def test_name_option_and_has_code_false(folder, codeload):
    codeload.add("o/r", SHA, {"s/SKILL.md": SKILL_MD, "s/a.md": "a"})
    r = install(folder, codeload, "o/r", "s", "--ref", SHA, "--name", "spreadsheet")
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout) == {
        "installed": "skills/spreadsheet",
        "files": 2,
        "has_code": False,
    }


def test_executable_counts_as_code(folder, codeload):
    codeload.add("o/r", SHA, {"s/SKILL.md": SKILL_MD, "s/tool.bin": b"\x7fELF"})
    r = install(folder, codeload, "o/r", "s", "--ref", SHA)
    assert json.loads(r.stdout)["has_code"] is True


def test_sends_the_github_token_when_set(folder, codeload):
    codeload.add("o/r", SHA, {"s/SKILL.md": SKILL_MD})
    r = install(folder, codeload, "o/r", "s", "--ref", SHA, env={"GITHUB_TOKEN": "ghp_x"})
    assert r.returncode == 0, r.stderr
    assert codeload.auth == ["Bearer ghp_x"]


@pytest.mark.parametrize(
    "bad",
    [
        {"s/../../escape.md": "x"},
        {"s/link": ("symlink", "/etc/passwd")},
        {"s/link": ("symlink", "../../../outside")},
    ],
)
def test_refuses_escapes(folder, codeload, bad):
    codeload.add("o/r", SHA, {"s/SKILL.md": SKILL_MD, **bad})
    r = install(folder, codeload, "o/r", "s", "--ref", SHA)
    assert r.returncode != 0
    assert not (folder / "skills" / "xlsx").exists()
    assert not (folder.parent / "escape.md").exists()


def test_refuses_absolute_member_paths(folder, codeload):
    data = make_tarball({f"r-{SHA}/s/SKILL.md": SKILL_MD, "/tmp/abs-escape.md": "x"})
    codeload.tarballs[f"/o/r/tar.gz/{SHA}"] = data
    r = install(folder, codeload, "o/r", "s", "--ref", SHA)
    assert r.returncode != 0
    assert not Path("/tmp/abs-escape.md").exists()


def test_a_symlink_inside_the_skill_is_allowed(folder, codeload):
    codeload.add("o/r", SHA, {"s/SKILL.md": SKILL_MD, "s/a.md": "a", "s/b.md": ("symlink", "a.md")})
    r = install(folder, codeload, "o/r", "s", "--ref", SHA)
    assert r.returncode == 0, r.stderr


@pytest.mark.parametrize(
    "skill_md",
    [
        None,
        "# no frontmatter\n",
        "---\nname: xlsx\n---\nmissing description\n",
        "---\ndescription: d\n---\nmissing name\n",
    ],
)
def test_requires_skill_md_frontmatter(folder, codeload, skill_md):
    members = {"s/other.md": "x"}
    if skill_md is not None:
        members["s/SKILL.md"] = skill_md
    codeload.add("o/r", SHA, members)
    r = install(folder, codeload, "o/r", "s", "--ref", SHA)
    assert r.returncode != 0
    assert "SKILL.md" in r.stderr
    assert not (folder / "skills").exists() or not any((folder / "skills").iterdir())


def test_unsafe_names_are_refused(folder, codeload):
    codeload.add("o/r", SHA, {"s/SKILL.md": "---\nname: ../evil\ndescription: d\n---\n"})
    r = install(folder, codeload, "o/r", "s", "--ref", SHA)
    assert r.returncode != 0


def test_replaces_an_existing_directory_atomically(folder, codeload):
    old = folder / "skills" / "xlsx"
    old.mkdir(parents=True)
    (old / "stale.md").write_text("old")
    codeload.add("o/r", SHA, {"s/SKILL.md": SKILL_MD})
    r = install(folder, codeload, "o/r", "s", "--ref", SHA)
    assert r.returncode == 0, r.stderr
    assert sorted(p.name for p in old.iterdir()) == ["SKILL.md"]
    assert [p.name for p in (folder / "skills").iterdir()] == ["xlsx"]  # no .tmp- left


def test_failed_install_keeps_the_existing_directory(folder, codeload):
    old = folder / "skills" / "xlsx"
    old.mkdir(parents=True)
    (old / "SKILL.md").write_text(SKILL_MD)
    codeload.add("o/r", SHA, {"s/README.md": "no skill md"})
    r = install(folder, codeload, "o/r", "s", "--ref", SHA, "--name", "xlsx")
    assert r.returncode != 0
    assert (old / "SKILL.md").read_text() == SKILL_MD
    assert [p.name for p in (folder / "skills").iterdir()] == ["xlsx"]


def test_missing_path_or_download_failure(folder, codeload):
    codeload.add("o/r", SHA, {"other/SKILL.md": SKILL_MD})
    assert install(folder, codeload, "o/r", "s", "--ref", SHA).returncode != 0
    assert install(folder, codeload, "o/missing", "s", "--ref", SHA).returncode != 0


def test_download_is_capped(folder, codeload, monkeypatch):
    codeload.add("o/r", SHA, {"s/SKILL.md": SKILL_MD, "s/big.md": os.urandom(4096).hex()})
    r = install(
        folder,
        codeload,
        "o/r",
        "s",
        "--ref",
        SHA,
        env={"CONTOSO_SKILLS_MAX_DOWNLOAD_BYTES": "1000"},
    )
    assert r.returncode != 0
    assert "50 MB" in r.stderr or "too large" in r.stderr
