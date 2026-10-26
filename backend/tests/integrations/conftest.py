import pytest


@pytest.fixture(autouse=True)
def _fresh_db(reset_db):
    """Every integration test starts from an empty schema (reset_db lives in tests/conftest.py)."""
