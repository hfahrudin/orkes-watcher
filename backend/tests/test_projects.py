from httpx import AsyncClient


async def test_admin_creates_project(admin_client: AsyncClient):
    r = await admin_client.post("/projects", json={"name": "support-triage", "env": "production"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == "support-triage"
    assert body["env"] == "production"
    assert body["retentionDays"] == 30
    assert body["samplingPct"] == 100


async def test_creator_is_auto_added_as_member(admin_client: AsyncClient):
    project = (await admin_client.post("/projects", json={"name": "p", "env": "local"})).json()
    r = await admin_client.get(f"/projects/{project['id']}/members")
    assert r.status_code == 200
    emails = [m["email"] for m in r.json()]
    assert "admin@test.local" in emails


async def test_creating_project_also_creates_a_default_ingest_key(admin_client: AsyncClient):
    project = (await admin_client.post("/projects", json={"name": "p", "env": "local"})).json()
    r = await admin_client.get(f"/projects/{project['id']}/keys")
    keys = r.json()
    assert len(keys) == 1
    assert keys[0]["scope"] == "ingest"


async def test_non_admin_cannot_create_project(login_as):
    developer = await login_as("dev@test.local", "developer")
    r = await developer.post("/projects", json={"name": "nope", "env": "local"})
    assert r.status_code == 403


async def test_non_member_cannot_read_project(admin_client: AsyncClient, login_as):
    project = (await admin_client.post("/projects", json={"name": "p", "env": "local"})).json()
    outsider = await login_as("outsider@test.local", "developer")
    r = await outsider.get(f"/projects/{project['id']}")
    assert r.status_code == 403


async def test_admin_sees_all_projects_others_see_only_their_own(admin_client: AsyncClient, login_as):
    await admin_client.post("/projects", json={"name": "p1", "env": "local"})
    await admin_client.post("/projects", json={"name": "p2", "env": "local"})

    outsider = await login_as("outsider@test.local", "developer")
    assert len((await outsider.get("/projects")).json()) == 0
    assert len((await admin_client.get("/projects")).json()) == 2


async def test_developer_can_update_settings_viewer_cannot(admin_client: AsyncClient, login_as):
    project = (await admin_client.post("/projects", json={"name": "p", "env": "local"})).json()

    developer = await login_as("dev@test.local", "developer")
    await admin_client.post(f"/projects/{project['id']}/members", json={"email": "dev@test.local", "role": "developer"})
    r = await developer.patch(f"/projects/{project['id']}", json={"retentionDays": 7})
    assert r.status_code == 200
    assert r.json()["retentionDays"] == 7

    viewer = await login_as("viewer@test.local", "viewer")
    await admin_client.post(f"/projects/{project['id']}/members", json={"email": "viewer@test.local", "role": "viewer"})
    r = await viewer.patch(f"/projects/{project['id']}", json={"retentionDays": 90})
    assert r.status_code == 403


async def test_only_admin_can_delete_project(admin_client: AsyncClient, login_as):
    project = (await admin_client.post("/projects", json={"name": "p", "env": "local"})).json()

    developer = await login_as("dev@test.local", "developer")
    await admin_client.post(f"/projects/{project['id']}/members", json={"email": "dev@test.local", "role": "developer"})
    assert (await developer.delete(f"/projects/{project['id']}")).status_code == 403

    assert (await admin_client.delete(f"/projects/{project['id']}")).status_code == 200
    assert (await admin_client.get(f"/projects/{project['id']}")).status_code == 404
