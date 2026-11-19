"""Git snapshot after every exec (doc 04 "Git snapshots", doc 17 execd tests)."""

from __future__ import annotations

import pytest
from conftest import git


def test_changed_files_make_a_commit_with_the_author(run, folder):
    old = git(folder, "rev-parse", "HEAD")
    out = run(
        "open('notes.md','w').write('x')\nopen('prompt.md','a').write('more')\n",
        author="agent:data",
    )
    assert out["snapshot_error"] is None
    assert out["head"] != old
    assert out["head"] == git(folder, "rev-parse", "HEAD")
    assert sorted(out["changed"], key=lambda c: c["path"]) == [
        {"path": "notes.md", "status": "A"},
        {"path": "prompt.md", "status": "M"},
    ]
    assert git(folder, "log", "-1", "--format=%an") == "agent:data"


def test_commit_message_names_the_exec(client, folder):
    r = client.post(
        "/exec",
        json={
            "folder": str(folder),
            "exec_id": "x_01ABC",
            "code": "open('a','w').write('1')",
            "timeout_s": 30,
            "author": "user:alice",
        },
    )
    assert r.status_code == 200
    assert git(folder, "log", "-1", "--format=%an|%ae|%s") == (
        "user:alice|user:alice@contoso.local|exec x_01ABC"
    )


def test_delete_and_rename_statuses(run, folder):
    run("open('big.txt','w').write('line\\n' * 200)")
    out = run("import os; os.remove('prompt.md'); os.rename('big.txt', 'moved.txt')")
    assert sorted(out["changed"], key=lambda c: c["path"]) == [
        {"path": "moved.txt", "status": "R"},
        {"path": "prompt.md", "status": "D"},
    ]


def test_unchanged_keeps_head_and_reports_nothing(run, folder):
    old = git(folder, "rev-parse", "HEAD")
    out = run("print('read only')")
    assert out["head"] == old
    assert out["changed"] == []
    assert out["snapshot_error"] is None


def test_ignored_paths_only_report_nothing(run, folder):
    old = git(folder, "rev-parse", "HEAD")
    out = run("import os; os.makedirs('outputs', exist_ok=True); open('outputs/x','w').write('1')")
    assert out["head"] == old
    assert out["changed"] == []


def test_stale_index_lock_gives_snapshot_error_but_returns_the_result(run, folder):
    (folder / ".git" / "index.lock").write_text("")
    out = run("open('n.md','w').write('x'); print('done')")
    assert out["exit_code"] == 0
    assert out["stdout"].strip() == "done"
    assert out["head"] is None
    assert out["changed"] is None
    assert out["snapshot_error"]
    # the next successful snapshot picks up the missed change
    (folder / ".git" / "index.lock").unlink()
    out = run("print('again')")
    assert out["changed"] == [{"path": "n.md", "status": "A"}]


def test_snapshot_runs_after_a_timeout_too(run, folder):
    out = run("open('partial.md','w').write('x')\nimport time; time.sleep(100)", timeout_s=1)
    assert out["timed_out"] is True
    assert out["changed"] == [{"path": "partial.md", "status": "A"}]


def test_snapshot_does_not_run_repository_hooks(run, folder):
    hook = folder / ".git" / "hooks" / "post-commit"
    hook.write_text("#!/bin/sh\ntouch hook-ran\n")
    hook.chmod(0o755)
    out = run("open('notes.md', 'w').write('hello')")
    assert out["snapshot_error"] is None
    assert not (folder / "hook-ran").exists()


def test_snapshot_filters_cannot_write_outside_the_agent_folder(run, folder):
    from execd.run import isolation

    if isolation() != "landlock":
        pytest.skip("requires Landlock")
    outside = folder.parent / "snapshot-filter-marker"
    git(folder, "config", "filter.marker.clean", f"touch '{outside}'; cat")
    (folder / ".gitattributes").write_text("notes.md filter=marker\n")
    run("open('notes.md', 'w').write('hello')")
    assert not outside.exists()
