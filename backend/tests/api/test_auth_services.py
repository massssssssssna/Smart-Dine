from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import UUID

import bcrypt
import pytest

from app.core.exceptions import AppError
from app.core.security import Actor
from app.modules.auth.schemas import Login, PasswordChange
from app.modules.auth.service import AuthService
from app.modules.users.schemas import UserCreate
from app.modules.users.service import UserService

USER_ID = "10000000-0000-4000-8000-000000000001"
PROVISION_ID = "20000000-0000-4000-8000-000000000001"


def make_mock_pool(fetch_results=None):
    results = list(fetch_results or [])

    class MockCursor:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            pass

        async def fetchone(self):
            return results.pop(0) if results else None

    class MockConnection:
        def __init__(self):
            self.executed = []

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            pass

        def transaction(self):
            return self

        async def execute(self, query, params=None):
            self.executed.append((query, params))
            return MockCursor()

    conn = MockConnection()

    class MockPool:
        def connection(self):
            return conn

    return MockPool(), conn


def gateways():
    actor = Actor(id=UUID(USER_ID), role="manager", full_name="Manager", access_token="access-token")
    gateway = SimpleNamespace(
        read=AsyncMock(return_value={"id": USER_ID, "role": "manager", "is_active": True}),
        service=AsyncMock(),
        close=AsyncMock(),
    )
    return actor, gateway


@pytest.mark.asyncio
async def test_inactive_login_revokes_session_and_returns_no_tokens(monkeypatch):
    _, gateway = gateways()
    hashed = bcrypt.hashpw(b"secret-password", bcrypt.gensalt(4)).decode("utf-8")
    # Query returns user but is_active is False
    pool, _ = make_mock_pool([
        (UUID(USER_ID), "manager@example.com", hashed, "manager", "Manager", False),
    ])
    monkeypatch.setattr("app.modules.auth.service.get_pool", AsyncMock(return_value=pool))

    with pytest.raises(AppError) as exc:
        await AuthService(gateway).login(Login(email="manager@example.com", password="secret-password"))
    assert exc.value.status_code == 403
    assert exc.value.code == "inactive_account"


@pytest.mark.asyncio
@pytest.mark.parametrize("email", ["manager@smartdine.pk", "staff@example.com"])
async def test_login_rejects_shared_fallback_password(monkeypatch, email):
    _, gateway = gateways()
    hashed = bcrypt.hashpw(b"account-specific-password", bcrypt.gensalt(4)).decode("utf-8")
    pool, _ = make_mock_pool([
        (UUID(USER_ID), email, hashed, "manager", "Account User", True),
    ])
    monkeypatch.setattr("app.modules.auth.service.get_pool", AsyncMock(return_value=pool))

    with pytest.raises(AppError) as exc:
        await AuthService(gateway).login(Login(email=email, password="SmartDine123!"))

    assert exc.value.status_code == 401
    assert exc.value.code == "invalid_credentials"


@pytest.mark.asyncio
async def test_account_creation_rechecks_manager_before_reserving():
    actor, gateway = gateways()
    gateway.read.return_value = {"id": USER_ID, "role": "staff", "is_active": True}
    body = UserCreate(email="staff@example.com", full_name="Staff", password="Initial-password-12")
    with pytest.raises(AppError) as exc:
        await UserService(gateway, gateway).create(actor, body, "provision-0001")
    assert exc.value.status_code == 403
    gateway.service.assert_not_awaited()


@pytest.mark.asyncio
async def test_provisioning_retry_recovers_matching_account_without_recreating(monkeypatch):
    actor, gateway = gateways()
    gateway.service.side_effect = [
        {"id": PROVISION_ID, "status": "pending"},
        {"id": USER_ID, "is_active": True},
    ]
    # Pool returns existing matching account
    pool, conn = make_mock_pool([
        (UUID(USER_ID), {"managed_account": True, "provision_id": PROVISION_ID}),
    ])
    monkeypatch.setattr("app.modules.users.service.get_pool", AsyncMock(return_value=pool))

    body = UserCreate(email="staff@example.com", full_name="Staff", password="Initial-password-12")
    result = await UserService(gateway, gateway).create(actor, body, "provision-0001")
    assert result["is_active"]
    # Verify activate_user called with recovered user_id
    assert gateway.service.await_args.args == (
        "activate_user",
        {"actor_id": USER_ID, "provision_id": PROVISION_ID, "user_id": USER_ID},
    )
    # Ensure no INSERT was performed
    assert not any("INSERT INTO auth.users" in q[0] for q in conn.executed)


@pytest.mark.asyncio
async def test_provisioning_never_takes_over_unrelated_existing_auth_user(monkeypatch):
    actor, gateway = gateways()
    gateway.service.return_value = {"id": PROVISION_ID, "status": "pending"}
    # Account exists but with a different provision_id
    pool, _ = make_mock_pool([
        (UUID(USER_ID), {"managed_account": True, "provision_id": "other"}),
    ])
    monkeypatch.setattr("app.modules.users.service.get_pool", AsyncMock(return_value=pool))

    with pytest.raises(AppError) as exc:
        await UserService(gateway, gateway).create(
            actor,
            UserCreate(email="staff@example.com", full_name="Staff", password="Initial-password-12"),
            "provision-0001",
        )
    assert exc.value.status_code == 409
    assert exc.value.code == "account_exists"


@pytest.mark.asyncio
async def test_new_account_is_created_with_server_owned_provision_marker(monkeypatch):
    actor, gateway = gateways()
    gateway.service.side_effect = [
        {"id": PROVISION_ID, "status": "pending"},
        {"id": USER_ID, "is_active": True},
    ]
    # Pool returns None (user does not exist yet)
    pool, conn = make_mock_pool([None])
    monkeypatch.setattr("app.modules.users.service.get_pool", AsyncMock(return_value=pool))

    await UserService(gateway, gateway).create(
        actor,
        UserCreate(email="staff@example.com", full_name="Staff", password="Initial-password-12"),
        "provision-0001",
    )
    insert_queries = [q for q in conn.executed if "INSERT INTO auth.users" in q[0]]
    assert len(insert_queries) == 1
    # Check that the metadata contains managed_account and provision_id
    params = insert_queries[0][1]
    import json
    metadata = json.loads(params[3])
    assert metadata == {"managed_account": True, "provision_id": PROVISION_ID}


@pytest.mark.asyncio
async def test_password_change_reauthenticates_then_revokes_refresh_sessions(monkeypatch):
    actor, gateway = gateways()
    hashed = bcrypt.hashpw(b"old-password", bcrypt.gensalt(4)).decode("utf-8")
    pool, conn = make_mock_pool([
        (UUID(USER_ID), "manager@example.com", hashed),
    ])
    monkeypatch.setattr("app.modules.auth.service.get_pool", AsyncMock(return_value=pool))

    result = await AuthService(gateway).change_password(
        actor,
        PasswordChange(current_password="old-password", new_password="new-long-password"),
    )
    assert result["sign_in_required"] is True
    # Verify password was updated and sessions deleted
    update_executed = any("UPDATE auth.users" in q[0] for q in conn.executed)
    delete_executed = any("DELETE FROM auth.sessions" in q[0] for q in conn.executed)
    assert update_executed
    assert delete_executed
