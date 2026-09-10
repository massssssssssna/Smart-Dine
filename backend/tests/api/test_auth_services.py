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
async def test_account_creation_rechecks_manager_before_reserving():
    actor, gateway = gateways()
    gateway.read.return_value = {"id": USER_ID, "role": "staff", "is_active": True}
    body = UserCreate(email="staff@example.com", full_name="Staff", password="Initial-password-12")
    with pytest.raises(AppError) as exc:
        await UserService(gateway, gateway).create(actor, body, "provision-0001")
    assert exc.value.status_code == 403
    gateway.service.assert_not_awaited()
