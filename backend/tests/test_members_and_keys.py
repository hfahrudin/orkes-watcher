from httpx import AsyncClient


async def _make_project(admin_client: AsyncClient) -> str:
    return (await admin_client.post("/projects", json={"name": "p", "env": "local"})).json()["id"]


async def test_invite_member(admin_client: AsyncClient):
    project_id = await _make_project(admin_client)
    r = await admin_client.post(f"/projects/{project_id}/members", json={"email": "new@test.local", "role": "viewer"})
    assert r.status_code == 200
    assert r.json()["role"] == "viewer"


async def test_invite_existing_member_conflicts(admin_client: AsyncClient):
    project_id = await _make_project(admin_client)
    await admin_client.post(f"/projects/{project_id}/members", json={"email": "new@test.local", "role": "viewer"})
    r = await admin_client.post(f"/projects/{project_id}/members", json={"email": "new@test.local", "role": "viewer"})
    assert r.status_code == 409


async def test_non_admin_cannot_invite(admin_client: AsyncClient, login_as):
    project_id = await _make_project(admin_client)
    developer = await login_as("dev@test.local", "developer")
    await admin_client.post(f"/projects/{project_id}/members", json={"email": "dev@test.local", "role": "developer"})
    r = await developer.post(f"/projects/{project_id}/members", json={"email": "another@test.local", "role": "viewer"})
    assert r.status_code == 403


async def test_change_role_and_remove_member(admin_client: AsyncClient):
    project_id = await _make_project(admin_client)
    member = (await admin_client.post(f"/projects/{project_id}/members", json={"email": "new@test.local", "role": "viewer"})).json()

    r = await admin_client.patch(f"/projects/{project_id}/members/{member['userId']}", json={"role": "developer"})
    assert r.status_code == 200
    assert r.json()["role"] == "developer"

    r = await admin_client.delete(f"/projects/{project_id}/members/{member['userId']}")
    assert r.status_code == 200
    emails = [m["email"] for m in (await admin_client.get(f"/projects/{project_id}/members")).json()]
    assert "new@test.local" not in emails


async def test_developer_can_create_ingest_key_viewer_cannot(admin_client: AsyncClient, login_as):
    project_id = await _make_project(admin_client)

    developer = await login_as("dev@test.local", "developer")
    await admin_client.post(f"/projects/{project_id}/members", json={"email": "dev@test.local", "role": "developer"})
    r = await developer.post(f"/projects/{project_id}/keys", json={"label": "ci", "scope": "ingest"})
    assert r.status_code == 200
    assert r.json()["secret"].startswith("ok_live_")

    viewer = await login_as("viewer@test.local", "viewer")
    await admin_client.post(f"/projects/{project_id}/members", json={"email": "viewer@test.local", "role": "viewer"})
    r = await viewer.post(f"/projects/{project_id}/keys", json={"label": "nope", "scope": "ingest"})
    assert r.status_code == 403


async def test_revoke_key(admin_client: AsyncClient):
    project_id = await _make_project(admin_client)
    key = (await admin_client.post(f"/projects/{project_id}/keys", json={"label": "k", "scope": "ingest"})).json()["key"]

    r = await admin_client.delete(f"/projects/{project_id}/keys/{key['id']}")
    assert r.status_code == 200
    keys = (await admin_client.get(f"/projects/{project_id}/keys")).json()
    revoked = next(k for k in keys if k["id"] == key["id"])
    assert revoked["scope"] == "revoked"
