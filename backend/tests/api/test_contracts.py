from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import get_actor, get_admin_gateway, get_gateway, get_public_gateway
from app.core.exceptions import AppError
from app.core.security import Actor
from app.main import create_app

MANAGER_ID = UUID("10000000-0000-4000-8000-000000000001")
ITEM_ID = "20000000-0000-4000-8000-000000000001"
ORDER_ID = "30000000-0000-4000-8000-000000000001"
HEADERS = {"Idempotency-Key": "test-operation-0001"}


@pytest.fixture
def api():
    app = create_app()
    gateway = SimpleNamespace(read=AsyncMock(return_value={"items": [], "total": 0, "limit": 50, "offset": 0}),
                              command=AsyncMock(return_value={"id": ORDER_ID}),
                              service=AsyncMock(return_value={"id": ORDER_ID}),
                              close=AsyncMock())
    admin_auth = SimpleNamespace(sign_out=AsyncMock(), create_user=AsyncMock(), list_users=AsyncMock(return_value=[]))
    gateway.client = SimpleNamespace(auth=SimpleNamespace(admin=admin_auth, sign_in_with_password=AsyncMock(),
                                                          refresh_session=AsyncMock(), get_user=AsyncMock(),
                                                          update_user=AsyncMock()))
    actor = Actor(id=MANAGER_ID, role="manager", full_name="Manager", access_token="test-access-token")
    app.dependency_overrides[get_actor] = lambda: actor
    app.dependency_overrides[get_gateway] = lambda: gateway
    app.dependency_overrides[get_admin_gateway] = lambda: gateway
    app.dependency_overrides[get_public_gateway] = lambda: gateway
    with TestClient(app) as client:
        yield client, gateway, actor, app


@pytest.mark.parametrize("method,path", [
    ("GET", "/api/v1/users"), ("POST", "/api/v1/users"),
    ("GET", "/api/v1/orders/bills"),
    ("GET", f"/api/v1/orders/{ORDER_ID}/receipt"),
    ("POST", f"/api/v1/orders/{ORDER_ID}/pay"),
    ("DELETE", f"/api/v1/users/{ITEM_ID}"),
    ("POST", "/api/v1/menu"), ("PUT", f"/api/v1/menu/{ITEM_ID}"),
    ("DELETE", f"/api/v1/menu/{ITEM_ID}"),
    ("GET", f"/api/v1/recipes/{ITEM_ID}"),
    ("PUT", f"/api/v1/recipes/{ITEM_ID}"),
    ("POST", "/api/v1/inventory/ingredients"),
    ("GET", "/api/v1/expenses"), ("POST", f"/api/v1/expenses/{ORDER_ID}/void"),
    ("GET", "/api/v1/analytics/summary?start_date=2026-01-01&end_date=2026-01-31"),
    ("GET", "/api/v1/reviews"), ("GET", "/api/v1/reviews/analysis"),
    ("GET", "/api/v1/recommendations"), ("POST", "/api/v1/recommendations"),
    ("POST", f"/api/v1/recommendations/{ORDER_ID}/approve"),
    ("POST", f"/api/v1/recommendations/{ORDER_ID}/apply"),
    ("GET", "/api/v1/audit"),
])
def test_staff_denied_manager_routes_before_data_access(api, method, path):
    client, gateway, actor, _ = api
    actor.role = "staff"
    response = client.request(method, path, headers=HEADERS, json={} if method != "GET" else None)
    assert response.status_code == 403
    gateway.read.assert_not_awaited()
    gateway.command.assert_not_awaited()
    gateway.service.assert_not_awaited()
    gateway.client.auth.admin.create_user.assert_not_awaited()


def test_anonymous_cannot_read_operations(api):
    client, gateway, _, app = api
    app.dependency_overrides.pop(get_actor)
    response = client.get("/api/v1/orders")
    assert response.status_code == 401
    gateway.read.assert_not_awaited()


def test_cashier_can_read_bills_and_record_payment(api):
    client, gateway, actor, _ = api
    actor.role = 'staff'
    actor.staff_type = 'cashier'
    assert client.get('/api/v1/orders/bills?payment_status=paid').status_code == 200
    assert gateway.read.await_args.args[0] == 'bills'
    assert client.get(f'/api/v1/orders/{ORDER_ID}/receipt').status_code == 200
    response=client.post(f'/api/v1/orders/{ORDER_ID}/pay',headers=HEADERS,json={'expected_version':3,'cash_received':'1000'})
    assert response.status_code == 200
    operation, body, _ = gateway.command.await_args.args
    assert operation=='order_pay' and body['cash_received']=='1000'


@pytest.mark.parametrize('method,path,body', [
    ('POST', '/api/v1/users', {'email':'staff@example.com','full_name':'Staff','password':'test-password','role':'manager'}),
    ('PUT', f'/api/v1/users/{ITEM_ID}', {'full_name':'Staff','is_active':True,'expected_version':1,'role':'manager'}),
])
def test_portal_cannot_create_or_promote_managers(api, method, path, body):
    client, gateway, _, _ = api
    assert client.request(method, path, headers=HEADERS, json=body).status_code == 422
    gateway.command.assert_not_awaited()
    gateway.service.assert_not_awaited()


def test_order_requires_idempotency_key(api):
    client, gateway, _, _ = api
    response = client.post("/api/v1/orders", json={"items": [{"menu_item_id": ITEM_ID, "quantity": 1}]})
    assert response.status_code == 422
    gateway.command.assert_not_awaited()


@pytest.mark.parametrize("extra", [{"selling_price": "1.00"}, {"ingredient_cost_snapshot": "0.00"}])
def test_order_rejects_client_price_or_cost_injection(api, extra):
    client, gateway, _, _ = api
    response = client.post("/api/v1/orders", headers=HEADERS,
                           json={"items": [{"menu_item_id": ITEM_ID, "quantity": 1, **extra}]})
    assert response.status_code == 422
    gateway.command.assert_not_awaited()
