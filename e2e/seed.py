"""Seed the `fixtures` volume with the catalog skills' tarballs (doc 17: local tarballs
standing in for GitHub's codeload, at `<owner>/<repo>/tar.gz/<sha>`).

One archive per `<owner>/<repo>@<sha>` holds every skill path the catalog installs from it,
like the real codeload tarball. The pinned refs and paths are read from
`platform/seeds/skills.yaml`, so the seed cannot drift from the catalog. Runs in
`python:3.12-slim` with `/srv` (the fixtures volume) and `/platform` mounted read-only;
stdlib only.
"""
import io
import re
import tarfile
from pathlib import Path

SEEDS = Path("/platform/seeds/skills.yaml")
OUT = Path("/srv")
REF = re.compile(r"--ref,\s*([0-9a-f]{40})")
INSTALL = re.compile(r"install,\s*([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+),\s*([A-Za-z0-9_./-]+)")
NAME = re.compile(r"^\s*name:\s*(\S+)", re.MULTILINE)

FILES = {
    "SKILL.md": (
        "---\nname: {name}\ndescription: E2E fixture for {name}\n---\n\n# {name}\n\n"
        "Fixture skill served by the `fixtures` server.\n"
    ),
    "notes.md": "{name} fixture\n",
}


def main() -> None:
    archives: dict[tuple[str, str], dict[str, str]] = {}
    for block in SEEDS.read_text(encoding="utf-8").split("- id:")[1:]:
        ref, install, name = REF.search(block), INSTALL.search(block), NAME.search(block)
        if not ref or not install:
            continue
        repo, path = install.groups()
        archives.setdefault((repo, ref.group(1)), {})[path] = name.group(1) if name else path.rsplit("/", 1)[-1]

    if not archives:
        raise SystemExit(f"no skills found in {SEEDS}")
    for (repo, sha), skills in archives.items():
        root = repo.rsplit("/", 1)[-1]
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            for path, name in sorted(skills.items()):
                for filename, template in FILES.items():
                    data = template.format(name=name).encode()
                    info = tarfile.TarInfo(f"{root}-{sha}/{path}/{filename}")
                    info.size = len(data)
                    tar.addfile(info, io.BytesIO(data))
        out = OUT / repo / "tar.gz" / sha
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(buf.getvalue())
        out.chmod(0o644)
        print(f"seeded {out} with {', '.join(sorted(skills))}")


if __name__ == "__main__":
    main()
