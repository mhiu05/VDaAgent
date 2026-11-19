"""The read-only folder viewer (doc 04 "Folder viewer")."""

from __future__ import annotations

import io
import os
import shutil
import zipfile

import pytest

from backend.agents import viewer
from backend.agents.viewer import ViewerError
from backend.tests.agents.conftest import REPO, git

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


@pytest.fixture
def folder(tmp_path, dirs):
    f = tmp_path / "folders" / "u" / "data"
    shutil.copytree(REPO / "platform" / "agent-skeleton", f)
    (f / "prompts" / "system.md").write_text("v1\n")
    git(f, "init", "-q", "-b", "main")
    git(f, "add", "-A")
    git(
        f,
        "-c",
        "user.name=contoso-harness",
        "-c",
        "user.email=h@contoso.local",
        "commit",
        "-qm",
        "create data",
    )
    (f / "prompts" / "system.md").write_text("v2\n")
    (f / "files" / "chart.png").write_bytes(PNG)
    (f / "files" / "data.csv").write_text("a,b\n1,2\n")
    (f / "files" / "blob.bin").write_bytes(b"\x00\xff" * 10)
    git(f, "add", "-A")
    git(
        f,
        "-c",
        "user.name=agent:data",
        "-c",
        "user.email=a@contoso.local",
        "commit",
        "-qm",
        "exec x_01ABC",
    )
    env_d = f / ".env.d"
    env_d.mkdir()
    os.symlink(dirs["domains"] / "fabrikam/credentials/warehouse.env", env_d / "warehouse.env")
    (f / ".venv" / "lib").mkdir(parents=True)
    (f / ".venv" / "lib" / "x.py").write_text("x")
    (f / ".contoso" / "outputs").mkdir(parents=True)
    (f / ".contoso" / "outputs" / "x_01ABC.txt").write_text("full output")
    (f / "files" / "inner-link.csv").symlink_to("data.csv")
    (f / "files" / "escape").symlink_to("/etc/passwd")
    return f


# --- path safety ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "path", ["../x", "files/../../etc", "/etc/passwd", "files/escape", "files/\x00"]
)
def test_unsafe_paths_are_refused(folder, path):
    with pytest.raises(ViewerError) as e:
        viewer.read_file(folder, path)
    assert (e.value.status, e.value.code) == (400, "invalid_path")


def test_escaping_symlinked_directory_is_refused(folder, tmp_path):
    (folder / "files" / "outdir").symlink_to(tmp_path)
    with pytest.raises(ViewerError):
        viewer.list_tree(folder, "files/outdir")
    with pytest.raises(ViewerError):
        viewer.read_file(folder, "files/outdir/x")


def test_missing_path_is_404(folder):
    with pytest.raises(ViewerError) as e:
        viewer.read_file(folder, "files/nope.txt")
    assert e.value.status == 404


# --- tree -----------------------------------------------------------------------------------


def test_tree_lists_one_level(folder):
    entries = {e["name"]: e for e in viewer.list_tree(folder, "")}
    assert {"prompts", "files", "memory", ".env.d", ".venv", ".contoso", ".gitignore"} <= set(
        entries
    )
    assert ".git" not in entries
    assert entries["prompts"]["type"] == "dir" and entries["prompts"]["items"] == 2
    assert entries["prompts"]["size"] == sum(
        p.stat().st_size for p in (folder / "prompts").iterdir()
    )
    assert entries[".gitignore"]["type"] == "file" and entries[".gitignore"]["items"] is None
    assert entries[".venv"]["type"] == "dir" and entries[".venv"]["items"] is None  # collapsed
    files = {e["name"]: e for e in viewer.list_tree(folder, "files")}
    assert files["escape"]["type"] == "symlink"
    assert files["escape"]["symlink_target"] == "/etc/passwd"
    assert files["inner-link.csv"]["type"] == "symlink"
    assert isinstance(files["data.csv"]["mtime"], str)


def test_venv_cannot_be_expanded(folder):
    with pytest.raises(ViewerError) as e:
        viewer.list_tree(folder, ".venv")
    assert e.value.code == "not_expandable"


def test_contoso_outputs_can_be_browsed(folder):
    assert [e["name"] for e in viewer.list_tree(folder, ".contoso/outputs")] == ["x_01ABC.txt"]
    assert viewer.read_file(folder, ".contoso/outputs/x_01ABC.txt").body == b"full output"


def test_tree_at_a_commit(folder):
    first = git(folder, "rev-list", "--max-parents=0", "HEAD")
    names = {e["name"] for e in viewer.list_tree(folder, "files", at=first)}
    assert names == {".keep"}
    root = {e["name"]: e for e in viewer.list_tree(folder, "", at=first)}
    assert ".contoso" not in root and ".env.d" not in root
    assert root["prompts"]["type"] == "dir" and root["prompts"]["items"] == 2


# --- file -----------------------------------------------------------------------------------


def test_text_image_and_binary(folder):
    text = viewer.read_file(folder, "files/data.csv")
    assert text.media_type == "text/plain; charset=utf-8" and text.body == b"a,b\n1,2\n"
    img = viewer.read_file(folder, "files/chart.png")
    assert img.media_type == "image/png" and img.body == PNG and img.attachment is False
    binary = viewer.read_file(folder, "files/blob.bin")
    assert binary.attachment is True and binary.media_type == "application/octet-stream"


def test_large_text_is_an_attachment(folder):
    (folder / "files" / "big.txt").write_text("x" * (1024 * 1024 + 1))
    assert viewer.read_file(folder, "files/big.txt").attachment is True


def test_symlink_inside_the_folder_is_followed(folder):
    assert viewer.read_file(folder, "files/inner-link.csv").body == b"a,b\n1,2\n"


def test_env_d_shows_key_names_only(folder):
    f = viewer.read_file(folder, ".env.d/warehouse.env")
    assert f.body.decode() == "WAREHOUSE_DSN=••••\nWAREHOUSE_SNAPSHOT_ID=••••\n"
    assert f.media_type == "text/plain; charset=utf-8"


def test_file_at_a_commit(folder):
    first = git(folder, "rev-list", "--max-parents=0", "HEAD")
    assert viewer.read_file(folder, "prompts/system.md", at=first).body == b"v1\n"
    assert viewer.read_file(folder, "prompts/system.md").body == b"v2\n"
    with pytest.raises(ViewerError) as e:
        viewer.read_file(folder, "files/chart.png", at=first)
    assert e.value.status == 404


@pytest.mark.parametrize("at", ["HEAD; rm -rf /", "--all", "main~1", "zz"])
def test_at_must_be_a_commit_hash(folder, at):
    with pytest.raises(ViewerError) as e:
        viewer.read_file(folder, "prompts/system.md", at=at)
    assert e.value.status == 400


# --- archive --------------------------------------------------------------------------------


def _zip_names(data: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return {n: z.read(n) for n in z.namelist()}


def test_archive_excludes_venv_and_redacts_env_d(folder):
    files = _zip_names(viewer.archive(folder, ""))
    assert not any(n.startswith(".venv/") for n in files)
    assert ".git/HEAD" not in files
    assert files["files/data.csv"] == b"a,b\n1,2\n"
    assert files[".env.d/warehouse.env"].decode() == (
        "WAREHOUSE_DSN=••••\nWAREHOUSE_SNAPSHOT_ID=••••\n"
    )
    assert b"secret" not in b"".join(files.values())
    assert "files/escape" not in files  # escaping links are left out
    assert files[".contoso/outputs/x_01ABC.txt"] == b"full output"


def test_archive_of_a_subdirectory_and_at_a_commit(folder):
    assert set(_zip_names(viewer.archive(folder, "prompts"))) == {
        "prompts/system.md",
        "prompts/context.md",
    }
    first = git(folder, "rev-list", "--max-parents=0", "HEAD")
    old = _zip_names(viewer.archive(folder, "", at=first))
    assert old["prompts/system.md"] == b"v1\n"
    assert "files/chart.png" not in old


# --- log and diff ---------------------------------------------------------------------------


def test_log_for_a_path(folder):
    log = viewer.log(folder, "prompts/system.md", limit=10)
    assert [(e["author"], e["message"], e["exec_id"]) for e in log] == [
        ("agent:data", "exec x_01ABC", "x_01ABC"),
        ("contoso-harness", "create data", None),
    ]
    assert len(log[0]["commit"]) == 40 and log[0]["at"]
    assert len(viewer.log(folder, "", limit=1)) == 1


def test_diff_of_one_commit(folder):
    head = git(folder, "rev-parse", "HEAD")
    diff = viewer.diff(folder, head)
    assert "-v1" in diff and "+v2" in diff
    assert "Binary files" in diff and "blob.bin" in diff
    assert "\x00" not in diff
