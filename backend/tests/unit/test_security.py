"""API key and password helpers (app/utils/security.py)."""

import pytest

from app.utils.security import generate_api_key, hash_password, split_api_key, verify_api_key_secret, verify_password


def test_ingest_key_round_trip():
    prefix, secret_hash, full_key = generate_api_key("ingest")
    assert prefix.startswith("ok_live_")
    parsed = split_api_key(full_key)
    assert parsed is not None
    parsed_prefix, secret = parsed
    assert parsed_prefix == prefix
    assert verify_api_key_secret(secret, secret_hash)
    assert not verify_api_key_secret(secret + "x", secret_hash)


def test_read_key_uses_test_prefix():
    prefix, _, _ = generate_api_key("read")
    assert prefix.startswith("ok_test_")


def test_secret_may_contain_underscores():
    """token_urlsafe can produce underscores; only the first three separate the prefix."""
    assert split_api_key("ok_live_ab12cd34_sec_ret_") == ("ok_live_ab12cd34", "sec_ret_")


@pytest.mark.parametrize("key", ["", "ok_live", "ok_live_ab12cd34", "xx_live_ab12cd34_s", "ok_prod_ab12cd34_s", "Bearer ok_live_a_b"])
def test_malformed_keys_are_rejected(key):
    assert split_api_key(key) is None


def test_password_hash_round_trip():
    h = hash_password("correct horse")
    assert h != "correct horse"
    assert verify_password("correct horse", h)
    assert not verify_password("wrong horse", h)
