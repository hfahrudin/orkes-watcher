from httpx import AsyncClient


async def test_login_success(client: AsyncClient):
    r = await client.post("/auth/login", json={"email": "admin@test.local", "password": "test-password"})
    assert r.status_code == 200
    body = r.json()
    assert body["email"] == "admin@test.local"
    assert body["role"] == "admin"
    assert "session" in client.cookies or len(client.cookies) > 0


async def test_login_wrong_password(client: AsyncClient):
    r = await client.post("/auth/login", json={"email": "admin@test.local", "password": "nope"})
    assert r.status_code == 401


async def test_login_unknown_email(client: AsyncClient):
    r = await client.post("/auth/login", json={"email": "nobody@test.local", "password": "x"})
    assert r.status_code == 401


async def test_me_requires_session(client: AsyncClient):
    r = await client.get("/me")
    assert r.status_code == 401


async def test_me_with_session(admin_client: AsyncClient):
    r = await admin_client.get("/me")
    assert r.status_code == 200
    assert r.json()["email"] == "admin@test.local"


async def test_logout_clears_session(admin_client: AsyncClient):
    r = await admin_client.post("/auth/logout")
    assert r.status_code == 200
    r = await admin_client.get("/me")
    assert r.status_code == 401


async def test_update_profile(admin_client: AsyncClient):
    r = await admin_client.patch("/me", json={"name": "New Name"})
    assert r.status_code == 200
    assert r.json()["name"] == "New Name"


async def test_change_password_wrong_current(admin_client: AsyncClient):
    r = await admin_client.post("/me/change-password", json={"currentPassword": "nope", "newPassword": "newpassword123"})
    assert r.status_code == 400


async def test_change_password_success(admin_client: AsyncClient):
    r = await admin_client.post("/me/change-password", json={"currentPassword": "test-password", "newPassword": "newpassword123"})
    assert r.status_code == 200

    r = await admin_client.post("/auth/login", json={"email": "admin@test.local", "password": "newpassword123"})
    assert r.status_code == 200


async def _invite(admin_client: AsyncClient) -> tuple[str, str]:
    project_id = (await admin_client.post("/projects", json={"name": "p", "env": "local"})).json()["id"]
    invite = (await admin_client.post(f"/projects/{project_id}/members", json={"email": "invitee@test.local", "role": "viewer"})).json()
    return invite["member"]["userId"], invite["activationToken"]


async def test_activate_account(admin_client: AsyncClient, client: AsyncClient):
    _, token = await _invite(admin_client)

    r = await client.post("/auth/activate", json={"token": token, "password": "password123", "name": "Invitee"})
    assert r.status_code == 200
    body = r.json()
    assert body["email"] == "invitee@test.local"
    assert body["status"] == "active"
    assert body["name"] == "Invitee"

    r = await client.get("/me")
    assert r.status_code == 200
    assert r.json()["email"] == "invitee@test.local"

    r = await client.post("/auth/login", json={"email": "invitee@test.local", "password": "password123"})
    assert r.status_code == 200


async def test_activate_account_bad_token(client: AsyncClient):
    r = await client.post("/auth/activate", json={"token": "not-a-real-token", "password": "password123"})
    assert r.status_code == 400


async def test_activate_account_twice_fails(admin_client: AsyncClient, client: AsyncClient):
    _, token = await _invite(admin_client)
    r = await client.post("/auth/activate", json={"token": token, "password": "password123"})
    assert r.status_code == 200

    r = await client.post("/auth/activate", json={"token": token, "password": "password456"})
    assert r.status_code == 400


async def test_change_password_signs_out_other_sessions(admin_client: AsyncClient, client: AsyncClient):
    """QA regression: other sessions stayed valid after a password change."""
    from httpx import ASGITransport
    from app.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as other:
        assert (await other.post("/auth/login", json={"email": "admin@test.local", "password": "test-password"})).status_code == 200
        r = await admin_client.post("/me/change-password", json={"currentPassword": "test-password", "newPassword": "newpassword123"})
        assert r.status_code == 200
        assert (await other.get("/me")).status_code == 401
    assert (await admin_client.get("/me")).status_code == 200  # the session that changed it stays


# --- server-side session lifetime ----------------------------------------------------


async def _age_session(token: str, age) -> None:
    import app.config.db as db_module
    from datetime import datetime, timezone
    from sqlalchemy import update

    from app.models.identity import Session

    async with db_module.SessionLocal() as db:
        await db.execute(update(Session).where(Session.id == token).values(created_at=datetime.now(timezone.utc) - age))
        await db.commit()


async def _session_exists(token: str) -> bool:
    import app.config.db as db_module
    from app.models.identity import Session

    async with db_module.SessionLocal() as db:
        return await db.get(Session, token) is not None


async def test_session_older_than_lifetime_is_rejected_and_deleted(admin_client: AsyncClient):
    from datetime import timedelta

    token = admin_client.cookies["orkes_session"]
    await _age_session(token, timedelta(days=29, hours=23))
    assert (await admin_client.get("/me")).status_code == 200  # still inside the default 30 days

    await _age_session(token, timedelta(days=30, minutes=1))
    r = await admin_client.get("/me")
    assert r.status_code == 401
    assert not await _session_exists(token)  # can't be used again


async def test_session_lifetime_follows_the_setting(admin_client: AsyncClient, monkeypatch):
    from datetime import timedelta

    from app.config.settings import settings

    monkeypatch.setattr(settings, "session_lifetime_days", 1)
    token = admin_client.cookies["orkes_session"]
    await _age_session(token, timedelta(hours=12))
    assert (await admin_client.get("/me")).status_code == 200
    await _age_session(token, timedelta(days=2))
    assert (await admin_client.get("/me")).status_code == 401


async def test_cookie_lifetime_matches_the_setting(client: AsyncClient, monkeypatch):
    from app.config.settings import settings

    monkeypatch.setattr(settings, "session_lifetime_days", 7)
    r = await client.post("/auth/login", json={"email": "admin@test.local", "password": "test-password"})
    assert f"Max-Age={7 * 86400}" in r.headers["set-cookie"]


async def test_expired_sessions_are_purged_and_hidden(admin_client: AsyncClient):
    from datetime import timedelta

    from httpx import ASGITransport
    from app.main import app
    from app.services.maintenance_service import purge_expired_sessions

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as old:
        await old.post("/auth/login", json={"email": "admin@test.local", "password": "test-password"})
        old_token = old.cookies["orkes_session"]
    await _age_session(old_token, timedelta(days=31))

    sessions = (await admin_client.get("/sessions")).json()
    assert old_token not in [s["id"] for s in sessions]  # not listed on the Account page
    assert await purge_expired_sessions() == 1
    assert not await _session_exists(old_token)
    assert (await admin_client.get("/me")).status_code == 200  # the current one is untouched
