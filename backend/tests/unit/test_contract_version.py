"""Contract version parsing and the values /version reports (docs/contracts/contract-1.0.md §2.8)."""

import re

import pytest

from app.config.version import LATEST_CONTRACT, SUPPORTED_CONTRACT_MAJORS, WATCHER_VERSION, contract_major


@pytest.mark.parametrize(("version", "major"), [("1.0", 1), ("1.7", 1), ("2.0", 2), ("10.12", 10)])
def test_contract_major_parses_major_minor(version, major):
    assert contract_major(version) == major


@pytest.mark.parametrize("version", ["", "1", "1.", ".1", "v1.0", "1.0.0", "one.zero", "1.x", "-1.0"])
def test_contract_major_rejects_anything_else(version):
    assert contract_major(version) is None


def test_latest_contract_is_supported():
    assert contract_major(LATEST_CONTRACT) in SUPPORTED_CONTRACT_MAJORS


def test_watcher_version_is_read_from_pyproject():
    assert re.fullmatch(r"\d+\.\d+\.\d+", WATCHER_VERSION)
