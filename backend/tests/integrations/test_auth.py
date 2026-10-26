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
