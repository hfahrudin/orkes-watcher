"""Watcher release version and the orkes trace contract versions this release accepts.

See docs/contracts/contract-1.0.md §2.8 for the versioning rules.
"""

import tomllib
from pathlib import Path

# Contract majors this release accepts on POST /ingest/events. Rule: current major and the
# previous one (N and N-1) once a 2.0 exists.
SUPPORTED_CONTRACT_MAJORS: tuple[int, ...] = (1,)
LATEST_CONTRACT = "1.0"


def _read_watcher_version() -> str:
    pyproject = Path(__file__).resolve().parents[2] / "pyproject.toml"
    try:
        return tomllib.loads(pyproject.read_text())["project"]["version"]
    except (OSError, KeyError, tomllib.TOMLDecodeError):
        return "0.0.0-unknown"


WATCHER_VERSION = _read_watcher_version()


def contract_major(version: str) -> int | None:
    """"1.0" -> 1. Returns None for anything that isn't "MAJOR.MINOR"."""
    major, sep, minor = version.partition(".")
    if not sep or not major.isdigit() or not minor.isdigit():
        return None
    return int(major)
