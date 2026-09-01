import secrets

import bcrypt


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def new_activation_token() -> str:
    return secrets.token_urlsafe(32)


def generate_api_key(scope: str) -> tuple[str, str, str]:
    """Returns (prefix, secret_hash, full_key). `full_key` is shown once, never stored."""
    kind = "live" if scope == "ingest" else "test"
    prefix = f"ok_{kind}_{secrets.token_hex(4)}"
    secret = secrets.token_urlsafe(32)
    full_key = f"{prefix}_{secret}"
    secret_hash = bcrypt.hashpw(secret.encode(), bcrypt.gensalt()).decode()
    return prefix, secret_hash, full_key


def split_api_key(full_key: str) -> tuple[str, str] | None:
    """`ok_live_<8 hex>_<secret>` -> (prefix, secret), or None if malformed."""
    parts = full_key.split("_", 3)
    if len(parts) != 4 or parts[0] != "ok" or parts[1] not in ("live", "test"):
        return None
    prefix = "_".join(parts[:3])
    return prefix, parts[3]


def verify_api_key_secret(secret: str, secret_hash: str) -> bool:
    return bcrypt.checkpw(secret.encode(), secret_hash.encode())
