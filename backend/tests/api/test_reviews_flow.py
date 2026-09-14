from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import get_actor, get_admin_gateway, get_gateway, get_public_gateway
from app.core.security import Actor
from app.core.exceptions import AppError
from app.main import create_app

MANAGER_ID = UUID("10000000-0000-4000-8000-000000000001")
ORDER_ID = UUID("30000000-0000-4000-8000-000000000001")
ITEM_ID = UUID("20000000-0000-4000-8000-000000000001")


@pytest.fixture
def api_client():
    app = create_app()
    gateway = SimpleNamespace(
        read=AsyncMock(return_value={"items": [], "total": 0, "limit": 50, "offset": 0}),
        command=AsyncMock(return_value={"order_id": str(ORDER_ID), "token": "a" * 64, "expires_at": "2026-09-20T00:00:00Z"}),
        service=AsyncMock(return_value={"id": str(UUID("50000000-0000-4000-8000-000000000001")), "status": "received"}),
        query=AsyncMock(return_value=[]),
        query_one=AsyncMock(return_value=None),
        close=AsyncMock(),
    )
    actor = Actor(id=MANAGER_ID, role="manager", full_name="Manager", access_token="test-token")
    app.dependency_overrides[get_actor] = lambda: actor
    app.dependency_overrides[get_gateway] = lambda: gateway
    app.dependency_overrides[get_admin_gateway] = lambda: gateway
    app.dependency_overrides[get_public_gateway] = lambda: gateway
    with TestClient(app) as client:
        yield client, gateway, actor, app


def test_public_token_info_returns_order_details(api_client):
    client, gateway, _, _ = api_client

    # Mock token lookup in gateway.query_one and gateway.query
    gateway.query_one.return_value = {
        "token_id": "tok-1",
        "order_id": ORDER_ID,
        "expires_at": None,
        "used_at": None,
        "order_number": "SD-1042",
        "table_name_snapshot": "Table 4",
        "floor_name_snapshot": "Ground Floor",
        "seats_snapshot": 4,
        "created_by_name": "Ahmed Waiter",
        "order_created_at": "2026-09-13T14:00:00Z",
    }
    gateway.query.return_value = [
        {"menu_item_id": ITEM_ID, "name": "Chicken Biryani", "quantity": 2, "price": "850.00"}
    ]

    res = client.get(f"/api/v1/reviews/token-info?token={'b' * 32}")
    assert res.status_code == 200
    data = res.json()
    assert data["valid"] is True
    assert data["order_number"] == "SD-1042"
    assert data["table_name"] == "Table 4"
    assert data["waiter_name"] == "Ahmed Waiter"
    assert len(data["items"]) == 1
    assert data["items"][0]["name"] == "Chicken Biryani"


def test_public_submit_with_dish_ratings_and_aspects(api_client):
    client, gateway, _, _ = api_client

    gateway.query_one.return_value = {
        "token_id": "tok-1",
        "order_id": ORDER_ID,
        "expires_at": None,
        "used_at": None,
        "order_number": "SD-1042",
        "table_name_snapshot": "Table 4",
        "floor_name_snapshot": "Ground Floor",
        "seats_snapshot": 4,
        "created_by_name": "Ahmed Waiter",
        "order_created_at": "2026-09-13T14:00:00Z",
    }
    gateway.query.return_value = [
        {"menu_item_id": ITEM_ID, "name": "Chicken Biryani", "quantity": 2, "price": "850.00"}
    ]

    token_str = "c" * 64
    payload = {
        "token": token_str,
        "rating": 5,
        "comment": "Food was delicious and service was fast!",
        "aspects": {
            "taste": 5,
            "service_speed": 5,
            "cleanliness": 4,
            "hospitality": 5,
            "value": 4
        },
        "dish_ratings": [
            {
                "menu_item_id": str(ITEM_ID),
                "rating": 5,
                "comment": "Very flavorful!"
            }
        ]
    }

    res = client.post("/api/v1/reviews/submit", json=payload)
    assert res.status_code == 201
    data = res.json()
    assert data["status"] == "received"
    assert gateway.service.await_args.args[0] == "review_submit"
    submitted_payload = gateway.service.await_args.args[1]
    assert submitted_payload["rating"] == 5
    assert "[Aspects: Taste: 5★" in submitted_payload["comment"]
    assert f"[Dish Ratings: Dish {ITEM_ID}: 5★ (Very flavorful!)]" in submitted_payload["comment"]


def test_public_submit_rejects_dish_not_on_receipt(api_client):
    client, gateway, _, _ = api_client
    gateway.query_one.return_value = {
        "token_id": "tok-1",
        "order_id": ORDER_ID,
        "expires_at": None,
        "used_at": None,
        "order_number": "SD-1042",
        "table_name_snapshot": "Table 4",
        "floor_name_snapshot": "Ground Floor",
        "seats_snapshot": 4,
        "created_by_name": "Ahmed Waiter",
        "order_created_at": "2026-09-13T14:00:00Z",
    }
    gateway.query.return_value = [
        {"menu_item_id": ITEM_ID, "name": "Chicken Biryani", "quantity": 2, "price": "850.00"}
    ]
    other_item = UUID("20000000-0000-4000-8000-000000000099")

    res = client.post("/api/v1/reviews/submit", json={
        "token": "d" * 64,
        "rating": 4,
        "comment": "Good meal",
        "dish_ratings": [{"menu_item_id": str(other_item), "rating": 5}],
    })

    assert res.status_code == 422
    assert res.json()["code"] == "dish_not_purchased"
    gateway.service.assert_not_awaited()


def test_cashier_token_creation_endpoint(api_client):
    client, gateway, actor, _ = api_client
    actor.role = "staff"
    actor.staff_type = "cashier"

    res = client.post("/api/v1/reviews/tokens", json={"order_id": str(ORDER_ID)})
    assert res.status_code == 201
    data = res.json()
    assert data["order_id"] == str(ORDER_ID)
    assert "token" in data


def test_cashier_reopens_old_receipt_with_rotated_unused_token(api_client):
    client, gateway, actor, _ = api_client
    actor.role = "staff"
    actor.staff_type = "cashier"
    gateway.command.side_effect = AppError("40001", "Review token already issued; retry the original idempotency key", 409)
    gateway.query_one.side_effect = [None, {"order_id": ORDER_ID, "expires_at": "2026-09-21T00:00:00Z"}]

    res = client.post("/api/v1/reviews/tokens", json={"order_id": str(ORDER_ID)})

    assert res.status_code == 201
    assert res.json()["order_id"] == str(ORDER_ID)
    assert len(res.json()["token"]) == 64
    assert "o.branch_id = p.branch_id" in gateway.query_one.await_args_list[1].args[0]


def test_cashier_reprint_explains_when_review_is_already_received(api_client):
    client, gateway, actor, _ = api_client
    actor.role = "staff"
    actor.staff_type = "cashier"
    gateway.command.side_effect = AppError("40001", "Review token already issued", 409)
    gateway.query_one.side_effect = [None, None, {"?column?": 1}]

    res = client.post("/api/v1/reviews/tokens", json={"order_id": str(ORDER_ID)})

    assert res.status_code == 409
    assert res.json()["message"] == "Review already received for this receipt."


def test_manager_reviews_list_requires_manager(api_client):
    client, _, actor, _ = api_client
    actor.role = "staff"
    actor.staff_type = "waiter"

    res = client.get("/api/v1/reviews")
    assert res.status_code == 403

    actor.role = "manager"
    res_mgr = client.get("/api/v1/reviews")
    assert res_mgr.status_code == 200
