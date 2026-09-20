from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import io
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

from fastapi.testclient import TestClient
import openpyxl
import pytest

from app.api.dependencies import get_actor, get_admin_gateway, get_gateway, get_public_gateway
from app.core.exceptions import AppError
from app.core.security import Actor
from app.main import create_app
from app.modules.orders.export_service import (
    karachi_date_range_to_utc,
    sanitize_excel_cell,
)

MANAGER_ID = UUID("10000000-0000-4000-8000-000000000001")
WAITER_ID = UUID("10000000-0000-4000-8000-000000000002")
KITCHEN_ID = UUID("10000000-0000-4000-8000-000000000003")
CASHIER_ID = UUID("10000000-0000-4000-8000-000000000004")
BRANCH_ID = UUID("303cf3c5-aad2-4743-8b2c-f979e29304ad")
ORDER_1 = UUID("30000000-0000-4000-8000-000000000001")
ORDER_2 = UUID("30000000-0000-4000-8000-000000000002")


def dummy_orders():
    now = datetime(2026, 9, 15, 14, 0, 0, tzinfo=timezone.utc)
    return [
        {
            "id": ORDER_1,
            "order_number": "ORD-101",
            "branch_id": BRANCH_ID,
            "status": "completed",
            "created_at": now,
            "updated_at": now + timedelta(minutes=45),
            "prepared_at": now + timedelta(minutes=20),
            "completed_at": now + timedelta(minutes=45),
            "cancelled_at": None,
            "cancellation_reason": None,
            "floor_name_snapshot": "Ground",
            "table_name_snapshot": "Table 4",
            "seats_snapshot": 4,
            "created_by": WAITER_ID,
            "created_by_name": "Usman Waiter",
            "created_by_email": "usman@smartdine.pk",
            "prepared_by": KITCHEN_ID,
            "prepared_by_name": "Chef Tariq",
            "prepared_by_email": "tariq@smartdine.pk",
            "paid_by": CASHIER_ID,
            "paid_by_name": "Zainab Cashier",
            "paid_by_email": "zainab@smartdine.pk",
            "notes": "=SUM(1+1) Dangerous Formula Note",
            "tax": Decimal("300.00"),
            "tax_rate_snapshot": Decimal("15.00"),
            "discount": Decimal("100.00"),
            "discount_percent": Decimal("5.00"),
            "discount_reason": "VIP Guest",
            "cash_received": Decimal("2500.00"),
            "change_given": Decimal("300.00"),
        },
        {
            "id": ORDER_2,
            "order_number": "ORD-102",
            "branch_id": BRANCH_ID,
            "status": "cancelled",
            "created_at": now - timedelta(hours=2),
            "updated_at": now - timedelta(hours=1),
            "prepared_at": None,
            "completed_at": None,
            "cancelled_at": now - timedelta(hours=1),
            "cancellation_reason": "Customer left",
            "floor_name_snapshot": "1",
            "table_name_snapshot": "Table 12",
            "seats_snapshot": 2,
            "created_by": UUID("99999999-0000-4000-8000-000000000001"),
            "created_by_name": "Other Waiter",
            "created_by_email": "other@smartdine.pk",
            "prepared_by": None,
            "prepared_by_name": None,
            "prepared_by_email": None,
            "paid_by": None,
            "paid_by_name": None,
            "paid_by_email": None,
            "notes": "Cancelled table",
            "tax": Decimal("0.00"),
            "tax_rate_snapshot": Decimal("15.00"),
            "discount": Decimal("0.00"),
            "discount_percent": None,
            "discount_reason": None,
            "cash_received": None,
            "change_given": None,
        },
    ]


def dummy_items():
    return [
        {
            "order_id": ORDER_1,
            "menu_item_id": UUID("20000000-0000-4000-8000-000000000001"),
            "name_snapshot": "Mutton Karahi",
            "quantity": 1,
            "price_snapshot": Decimal("2000.00"),
        },
        {
            "order_id": ORDER_1,
            "menu_item_id": UUID("20000000-0000-4000-8000-000000000002"),
            "name_snapshot": "Roghni Naan",
            "quantity": 4,
            "price_snapshot": Decimal("75.00"),
        },
    ]


@pytest.fixture
def make_client():
    def _create(actor: Actor):
        app = create_app()
        gateway = SimpleNamespace(
            read=AsyncMock(return_value={"items": [], "total": 0, "limit": 50, "offset": 0}),
            command=AsyncMock(return_value={"ok": True}),
            service=AsyncMock(return_value={"ok": True}),
            query=AsyncMock(side_effect=lambda sql, params=(): dummy_items() if "order_items" in sql else dummy_orders()),
            query_one=AsyncMock(return_value={"branch_id": BRANCH_ID, "branch_name": "SmartDine Gulberg", "full_name": actor.full_name}),
            close=AsyncMock(),
        )
        app.dependency_overrides[get_actor] = lambda: actor
        app.dependency_overrides[get_gateway] = lambda: gateway
        app.dependency_overrides[get_admin_gateway] = lambda: gateway
        app.dependency_overrides[get_public_gateway] = lambda: gateway
        return TestClient(app), gateway
    return _create


def test_sanitize_excel_cell_neutralizes_formulas():
    assert sanitize_excel_cell("=1+1") == "'=1+1"
    assert sanitize_excel_cell("+cmd|' /C calc'!A0") == "'+cmd|' /C calc'!A0"
    assert sanitize_excel_cell("-123") == "'-123"
    assert sanitize_excel_cell("@SUM(A1:A5)") == "'@SUM(A1:A5)"
    assert sanitize_excel_cell("\tTab") == "'\tTab"
    assert sanitize_excel_cell("Regular text") == "Regular text"
    assert sanitize_excel_cell(12345) == 12345


def test_karachi_date_range_to_utc():
    start = date(2026, 9, 1)
    end = date(2026, 9, 21)
    start_utc, end_utc = karachi_date_range_to_utc(start, end)
    # Karachi is UTC+5, so 2026-09-01 00:00:00+05:00 is 2026-08-31 19:00:00 UTC
    assert start_utc.year == 2026 and start_utc.month == 8 and start_utc.day == 31 and start_utc.hour == 19
    # Inclusive end: 2026-09-22 00:00:00+05:00 is 2026-09-21 19:00:00 UTC
    assert end_utc.year == 2026 and end_utc.month == 9 and end_utc.day == 21 and end_utc.hour == 19

    # Rejection of invalid date range
    with pytest.raises(AppError):
        karachi_date_range_to_utc(date(2026, 9, 25), date(2026, 9, 20))


def test_manager_export_excel(make_client):
    actor = Actor(id=MANAGER_ID, role="manager", staff_type="waiter", full_name="Manager Admin", access_token="token-mgr")
    client, _ = make_client(actor)

    res = client.get("/api/v1/orders/export?format=excel&start_date=2026-09-01&end_date=2026-09-21&scope=manager")
    assert res.status_code == 200
    assert "spreadsheetml" in res.headers["content-type"]
    assert "SmartDine_Manager_History_20260901_20260921.xlsx" in res.headers["content-disposition"]

    # Verify openpyxl can read the workbook
    wb = openpyxl.load_workbook(io.BytesIO(res.content))
    assert "Summary" in wb.sheetnames
    assert "History" in wb.sheetnames
    assert "Items" in wb.sheetnames

    # Check Summary Sheet contents
    ws_summary = wb["Summary"]
    assert "SmartDine AI — Operational History Report" in str(ws_summary["A1"].value)

    # Check History Sheet formula protection
    ws_history = wb["History"]
    rows = list(ws_history.iter_rows(values_only=True))
    header = rows[0]
    assert "Order #" in header
    assert "Total (PKR)" in header

    # Row 1 notes had '=SUM(1+1)...' which should be neutralized
    notes_col_idx = header.index("Special Notes")
    assert rows[1][notes_col_idx].startswith("'=")


def test_manager_export_pdf(make_client):
    actor = Actor(id=MANAGER_ID, role="manager", staff_type="waiter", full_name="Manager Admin", access_token="token-mgr")
    client, _ = make_client(actor)

    res = client.get("/api/v1/orders/export?format=pdf&start_date=2026-09-01&end_date=2026-09-21&scope=manager")
    assert res.status_code == 200
    assert "application/pdf" in res.headers["content-type"]
    assert "SmartDine_Manager_History_20260901_20260921.pdf" in res.headers["content-disposition"]
    assert res.content.startswith(b"%PDF-")


def test_kitchen_export_no_financial_columns(make_client):
    actor = Actor(id=KITCHEN_ID, role="staff", staff_type="kitchen", full_name="Head Chef", access_token="token-kitchen")
    client, _ = make_client(actor)

    res = client.get("/api/v1/orders/export?format=excel&start_date=2026-09-01&end_date=2026-09-21")
    assert res.status_code == 200
    assert "SmartDine_Kitchen_History" in res.headers["content-disposition"]

    wb = openpyxl.load_workbook(io.BytesIO(res.content))
    ws_hist = wb["History"]
    header = [cell for cell in next(ws_hist.iter_rows(values_only=True))]
    header_str = " ".join(header).lower()

    # Kitchen must NOT have any price or money columns
    assert "subtotal" not in header_str
    assert "total" not in header_str
    assert "tax" not in header_str
    assert "discount" not in header_str
    assert "cash" not in header_str

    # Must have kitchen operational columns
    assert "prep duration" in header_str
    assert "dishes & quantities" in header_str


def test_cashier_export_billing_columns(make_client):
    actor = Actor(id=CASHIER_ID, role="staff", staff_type="cashier", full_name="Zainab Cashier", access_token="token-cashier")
    client, _ = make_client(actor)

    res = client.get("/api/v1/orders/export?format=excel&start_date=2026-09-01&end_date=2026-09-21")
    assert res.status_code == 200
    assert "SmartDine_Cashier_History" in res.headers["content-disposition"]

    wb = openpyxl.load_workbook(io.BytesIO(res.content))
    ws_hist = wb["History"]
    header = [cell for cell in next(ws_hist.iter_rows(values_only=True))]
    assert "Receipt #" in header
    assert "Cash Received" in header
    assert "Change Given" in header
    assert "Total (PKR)" in header


def test_waiter_export_forced_scope(make_client):
    actor = Actor(id=WAITER_ID, role="staff", staff_type="waiter", full_name="Usman Waiter", access_token="token-waiter")
    client, gateway = make_client(actor)

    # Waiter tries to request manager scope, but should be forced to waiter scope
    res = client.get("/api/v1/orders/export?format=excel&start_date=2026-09-01&end_date=2026-09-21&scope=manager")
    assert res.status_code == 200
    assert "SmartDine_Waiter_History" in res.headers["content-disposition"]
