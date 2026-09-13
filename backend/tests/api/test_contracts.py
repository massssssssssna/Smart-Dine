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
                              query=AsyncMock(return_value=[]),
                              query_one=AsyncMock(return_value=None),
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
    ("GET", "/api/v1/expenses"), ("POST", "/api/v1/expenses"), ("POST", f"/api/v1/expenses/{ORDER_ID}/void"),
    ("GET", "/api/v1/analytics/summary?start_date=2026-01-01&end_date=2026-01-31"),
    ("GET", "/api/v1/reviews"), ("GET", "/api/v1/reviews/analysis"),
    ("GET", "/api/v1/recommendations"), ("POST", "/api/v1/recommendations"),
    ("POST", f"/api/v1/recommendations/{ORDER_ID}/approve"),
    ("POST", f"/api/v1/recommendations/{ORDER_ID}/apply"),
    ("GET", "/api/v1/audit"),
    ("POST", "/api/v1/floors"), ("PUT", f"/api/v1/floors/{ORDER_ID}"), ("DELETE", f"/api/v1/floors/{ORDER_ID}"),
    ("POST", "/api/v1/tables"), ("PUT", f"/api/v1/tables/{ORDER_ID}"), ("DELETE", f"/api/v1/tables/{ORDER_ID}"),
    ("GET", "/api/v1/forecasts"), ("POST", "/api/v1/forecasts/runs"), ("GET", "/api/v1/forecasts/jobs"),
    ("POST", "/api/v1/forecasts/history/import"),
    ("POST", "/api/v1/assistant"), ("POST", "/api/v1/assistant/questions"), ("GET", "/api/v1/assistant/runs"),
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


def test_kitchen_cannot_create_or_edit_orders(api):
    client, gateway, actor, _ = api
    actor.role = 'staff'
    actor.staff_type = 'kitchen'
    response = client.post('/api/v1/orders', headers=HEADERS, json={'items': [{'menu_item_id': ITEM_ID, 'quantity': 1}]})
    assert response.status_code == 403
    response = client.put(f'/api/v1/orders/{ORDER_ID}', headers=HEADERS, json={'expected_version': 1, 'items': [{'menu_item_id': ITEM_ID, 'quantity': 1}]})
    assert response.status_code == 403
    gateway.command.assert_not_awaited()


def test_waiter_cannot_transition_to_preparing_or_ready(api):
    client, gateway, actor, _ = api
    actor.role = 'staff'
    actor.staff_type = 'waiter'
    response = client.post(f'/api/v1/orders/{ORDER_ID}/status', headers=HEADERS, json={'expected_version': 1, 'status': 'preparing'})
    assert response.status_code == 403
    response = client.post(f'/api/v1/orders/{ORDER_ID}/status', headers=HEADERS, json={'expected_version': 1, 'status': 'ready'})
    assert response.status_code == 403
    gateway.command.assert_not_awaited()


def test_kitchen_can_transition_to_preparing_and_ready(api):
    client, gateway, actor, _ = api
    actor.role = 'staff'
    actor.staff_type = 'kitchen'
    response = client.post(f'/api/v1/orders/{ORDER_ID}/status', headers=HEADERS, json={'expected_version': 1, 'status': 'preparing'})
    assert response.status_code == 200
    operation, body, _ = gateway.command.await_args.args
    assert operation == 'order_transition' and body['status'] == 'preparing'


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


def test_order_forwards_decimal_without_float_rounding(api):
    client, gateway, _, _ = api
    response = client.post("/api/v1/orders", headers=HEADERS, json={
        "items": [{"menu_item_id": ITEM_ID, "quantity": 2}], "discount": "0.01", "platform_fee": "10.23"})
    assert response.status_code == 201
    operation, data, key = gateway.command.await_args.args
    assert operation == "order_create" and key == HEADERS["Idempotency-Key"]
    assert data["discount"] == "0.01" and data["platform_fee"] == "10.23"


def test_staff_cannot_receive_costs_on_mutation(api):
    client, gateway, actor, _ = api
    actor.role = "staff"
    actor.staff_type = "kitchen"
    gateway.command.return_value = {"id": ORDER_ID, "status": "preparing", "ingredient_cost": "3.21",
                                    "items": [{"menu_item_id": ITEM_ID, "price_snapshot": "20.00",
                                               "ingredient_cost_snapshot": "3.21", "packaging_cost_snapshot": "1.00"}]}
    response = client.post(f"/api/v1/orders/{ORDER_ID}/status", headers=HEADERS,
                           json={"expected_version": 1, "status": "preparing"})
    assert response.status_code == 200
    assert "ingredient_cost" not in response.json()
    assert response.json()["items"] == [{"menu_item_id": ITEM_ID, "price_snapshot": "20.00"}]


@pytest.mark.parametrize("body", [
    {"ingredient_id": ITEM_ID, "kind": "purchase", "quantity": "2", "reason": "Receipt"},
    {"ingredient_id": ITEM_ID, "kind": "wastage", "quantity": "-1", "reason": "Spoiled"},
    {"ingredient_id": ITEM_ID, "kind": "adjustment", "quantity": "0", "reason": "Count"},
    {"ingredient_id": ITEM_ID, "kind": "consumption", "quantity": "2", "reason": "Bypass order"},
    {"ingredient_id": ITEM_ID, "kind": "adjustment", "quantity": "1", "unit_cost": "999", "reason": "Count"},
])
def test_invalid_inventory_requests_never_reach_database(api, body):
    client, gateway, _, _ = api
    response = client.post("/api/v1/inventory/transactions", headers=HEADERS, json=body)
    assert response.status_code == 422
    gateway.command.assert_not_awaited()


def test_cancellation_requires_reason_and_version(api):
    client, gateway, _, _ = api
    response = client.post(f"/api/v1/orders/{ORDER_ID}/status", headers=HEADERS,
                           json={"expected_version": 1, "status": "cancelled"})
    assert response.status_code == 422
    gateway.command.assert_not_awaited()


@pytest.mark.parametrize("dates", ["start_date=2026-02-01&end_date=2026-01-01", "start_date=2020-01-01&end_date=2026-01-01"])
def test_invalid_reporting_period_rejected(api, dates):
    client, gateway, _, _ = api
    assert client.get(f"/api/v1/analytics/summary?{dates}").status_code == 422
    gateway.read.assert_not_awaited()


def test_database_conflict_is_readable_and_keeps_request_id(api):
    client, gateway, _, _ = api
    gateway.command.side_effect = AppError("40001", "The record has changed; reload it.", 409)
    response = client.post(f"/api/v1/orders/{ORDER_ID}/status", headers=HEADERS,
                           json={"expected_version": 1, "status": "preparing"})
    assert response.status_code == 409
    assert response.json()["code"] == "40001"
    assert response.json()["request_id"]


def test_public_review_receipt_excludes_private_order_information(api):
    client, gateway, _, _ = api
    token = "z" * 64
    gateway.query_one.return_value = {
        "token_id": ITEM_ID,
        "order_id": ORDER_ID,
        "expires_at": None,
        "used_at": None,
        "order_number": "SD-1042",
        "table_name_snapshot": "Table 4",
        "floor_name_snapshot": "Main Floor",
        "seats_snapshot": 4,
        "created_by_name": "Server",
        "order_created_at": "2026-09-14T12:00:00+00:00",
    }
    gateway.service.return_value = {"id": ORDER_ID, "order_id": ITEM_ID, "secret": "do-not-return"}
    response = client.post("/api/v1/reviews/submit", json={"token": token, "rating": 4, "comment": "Tasty food"})
    assert response.status_code == 201
    assert response.json() == {"id": ORDER_ID, "status": "received"}
    assert gateway.service.await_args.args[1]["token"] == token


def test_validation_never_echoes_secrets(api):
    client, _, _, _ = api
    secret = "SuperPrivateSecret_123"
    response = client.post("/api/v1/auth/login", json={"email": "invalid", "password": secret})
    assert response.status_code == 422
    assert secret not in response.text


def test_public_signup_route_does_not_exist(api):
    client, _, _, _ = api
    assert client.post("/api/v1/auth/signup", json={}).status_code == 404


def test_recipe_cannot_repeat_ingredient(api):
    client, gateway, _, _ = api
    response = client.put(f"/api/v1/recipes/{ITEM_ID}", headers=HEADERS, json={
        "expected_version": 1, "ingredients": [{"ingredient_id": ORDER_ID, "quantity": "1"},
                                                {"ingredient_id": ORDER_ID, "quantity": "2"}]})
    assert response.status_code == 422
    gateway.command.assert_not_awaited()


def test_recommendation_requires_typed_change_and_record_version(api):
    client, gateway, _, _ = api
    response = client.post("/api/v1/recommendations", headers=HEADERS, json={
        "action_type": "price_update", "target_id": ITEM_ID,
        "title": "Change price", "description": "Reasoned price test",
        "evidence": [{"source": "analytics", "reference": "period-1", "summary": "Low margin"}],
        "proposed_change": {"sql": "update menu_items set selling_price=0"},
    })
    assert response.status_code == 422
    gateway.command.assert_not_awaited()


def test_list_expenses_passes_date_range_to_gateway(api):
    client, gateway, _, _ = api
    response = client.get("/api/v1/expenses?start_date=2026-09-01&end_date=2026-09-30&limit=50&offset=0")
    assert response.status_code == 200
    gateway.read.assert_awaited_once_with("expenses", {
        "limit": 50,
        "offset": 0,
        "start_date": "2026-09-01",
        "end_date": "2026-09-30",
    })


def test_void_expense_validates_reason_and_version(api):
    client, gateway, _, _ = api
    # Invalid: reason too short (< 3 chars)
    res_short = client.post(f"/api/v1/expenses/{ORDER_ID}/void", headers=HEADERS, json={"expected_version": 1, "reason": "no"})
    assert res_short.status_code == 422

    # Invalid: missing expected_version
    res_no_ver = client.post(f"/api/v1/expenses/{ORDER_ID}/void", headers=HEADERS, json={"reason": "Valid reason but no version"})
    assert res_no_ver.status_code == 422

    # Valid: version + reason >= 3 chars
    res_ok = client.post(f"/api/v1/expenses/{ORDER_ID}/void", headers=HEADERS, json={"expected_version": 2, "reason": "Duplicate voucher"})
    assert res_ok.status_code == 200
    gateway.command.assert_awaited_once_with("expense_void", {
        "id": ORDER_ID,
        "expected_version": 2,
        "reason": "Duplicate voucher"
    }, HEADERS["Idempotency-Key"])


def test_list_recommendations_passes_status_filter(api):
    client, gateway, _, _ = api
    response = client.get("/api/v1/recommendations?status=proposed&limit=25&offset=0")
    assert response.status_code == 200
    gateway.read.assert_awaited_once_with("recommendations", {
        "limit": 25,
        "offset": 0,
        "status": "proposed"
    })


def test_reject_recommendation_requires_reason(api):
    client, gateway, _, _ = api
    # Invalid: reason too short (< 3 chars)
    res_short = client.post(f"/api/v1/recommendations/{ORDER_ID}/reject", headers=HEADERS, json={"expected_version": 1, "reason": "ab"})
    assert res_short.status_code == 422

    # Valid: version + reason >= 3 chars
    res_ok = client.post(f"/api/v1/recommendations/{ORDER_ID}/reject", headers=HEADERS, json={"expected_version": 1, "reason": "Price too high for local market"})
    assert res_ok.status_code == 200
    gateway.command.assert_awaited_once_with("recommendation_reject", {
        "id": ORDER_ID,
        "expected_version": 1,
        "reason": "Price too high for local market"
    }, HEADERS["Idempotency-Key"])


def test_audit_log_enriches_actor_profiles(api):
    client, gateway, _, _ = api
    ACTOR_ID = "11111111-1111-1111-1111-111111111111"
    async def mock_read(resource, params):
        if resource == "audit":
            return {
                "items": [
                    {"id": 1, "actor_id": ACTOR_ID, "action": "price_update", "entity": "menu_items", "before_data": {}, "after_data": {}, "created_at": "2026-09-13T00:00:00Z"}
                ],
                "total": 1, "limit": 50, "offset": 0
            }
        elif resource == "users":
            return {
                "items": [
                    {"id": ACTOR_ID, "full_name": "Massna Manager", "role": "manager"}
                ]
            }
        return {}

    gateway.read.side_effect = mock_read
    response = client.get("/api/v1/audit?limit=50&offset=0")
    assert response.status_code == 200
    data = response.json()
    assert len(data["items"]) == 1
    assert data["items"][0]["actor_name"] == "Massna Manager"
    assert data["items"][0]["actor_role"] == "manager"


def test_forecast_enqueue_accepts_single_or_multiple_items(api):
    client, gateway, _, _ = api
    # Single item with as_of
    res = client.post("/api/v1/forecasts/runs", headers=HEADERS, json={
        "menu_item_id": ITEM_ID,
        "as_of": "2026-09-13"
    })
    assert res.status_code == 202
    gateway.command.assert_awaited_once_with("forecast_enqueue", {
        "menu_item_ids": [ITEM_ID]
    }, HEADERS["Idempotency-Key"])


def test_history_import_validates_csv_headers(api):
    client, gateway, _, _ = api
    # Invalid headers
    res_bad = client.post("/api/v1/forecasts/history/import", headers=HEADERS, json={
        "source_name": "Test POS",
        "csv_text": "date,dish_id,units\n2026-01-01,1,10"
    })
    assert res_bad.status_code == 422

    # Valid headers
    valid_csv = f"day,menu_item_id,quantity,day_status\n2026-03-01,{ITEM_ID},25,complete"
    res_ok = client.post("/api/v1/forecasts/history/import", headers=HEADERS, json={
        "source_name": "Test POS",
        "csv_text": valid_csv
    })
    assert res_ok.status_code == 200
    gateway.command.assert_awaited_once_with("history_import", {
        "source_name": "Test POS",
        "rows": [
            {"day": "2026-03-01", "menu_item_id": ITEM_ID, "quantity": 25, "day_status": "complete"}
        ]
    }, HEADERS["Idempotency-Key"])

