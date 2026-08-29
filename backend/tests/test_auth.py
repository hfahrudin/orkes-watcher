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
