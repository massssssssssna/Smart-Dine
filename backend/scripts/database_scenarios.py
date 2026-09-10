"""Executable transaction/concurrency checks used by test_database.py only."""
from concurrent.futures import ThreadPoolExecutor
import json
from decimal import Decimal
from threading import Barrier
from uuid import uuid4

import psycopg
from psycopg.types.json import Jsonb


def claims(conn, actor=None, role="authenticated", session=None):
    payload = {"role": role}
    if actor:
        payload["sub"] = str(actor)
    if session:
        payload["session_id"] = str(session)
    conn.execute("select set_config('request.jwt.claims',%s,false)", (json.dumps(payload),))


def command(conn, operation, payload, key=None):
    return conn.execute("select public.sd_command(%s,%s,%s)",
                        (operation, Jsonb(payload), key or uuid4().hex)).fetchone()[0]


def fixtures(conn):
    actor = uuid4()
    conn.execute("insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values(%s,%s,%s,%s)",
                 (actor, f"{actor}@example.invalid", Jsonb({"managed_account": True}), Jsonb({"full_name": "Test Manager"})))
    claims(conn, role="service_role")
    conn.execute("select public.sd_service('bootstrap_manager',%s)", (Jsonb({"user_id": str(actor)}),))
    claims(conn, actor)
    ingredient = command(conn, "ingredient_create", {"name": f"Stock {actor}", "unit": "g", "reorder_level": "5"})["id"]
    command(conn, "inventory_record", {"ingredient_id": ingredient, "kind": "purchase", "quantity": "10",
                                       "unit_cost": "2.25", "reason": "Test stock"})
    dish = command(conn, "menu_create", {"name": f"Dish {actor}", "selling_price": "50", "packaging_cost": "1"})["id"]
    command(conn, "recipe_set", {"id": dish, "expected_version": 1,
                                "ingredients": [{"ingredient_id": ingredient, "quantity": "6"}]})
    return actor, ingredient, dish


def run_scenarios(conn):
    conn.execute("begin")
    try:
        actor, ingredient, dish = fixtures(conn)
        order = command(conn, "order_create", {"items": [{"menu_item_id": dish, "quantity": 1}],
                                               "discount": "0.01", "platform_fee": "1.02", "delivery_cost": "2.03", "tax": "4"})
        assert Decimal(order["subtotal"]) == 50 and Decimal(order["total"]) == Decimal("53.99")
        for version, status in enumerate(("preparing", "ready", "completed"), start=1):
            command(conn, "order_transition", {"id": order["id"], "expected_version": version, "status": status})
        report = conn.execute("select public.sd_read('analytics','{}')").fetchone()[0]
        assert Decimal(report["contribution_margin"]) == Decimal("32.44"), report
        sales = conn.execute("select public.sd_read('analytics','{\"report\":\"sales\"}')").fetchone()[0]
        assert len(sales["items"]) == 1 and sales["items"][0]["completed_orders"] == 1
        suggestions = command(conn, "recommendation_generate", {})
        assert suggestions["total"] == 1 and suggestions["items"][0]["action_type"] == "reorder"
        assert command(conn, "recommendation_generate", {})["total"] == 0
        event = conn.execute("select max(id) from private.audit_logs").fetchone()[0]
        assert conn.execute("select public.sd_read('audit',%s)", (Jsonb({"event_id": event}),)).fetchone()[0]["id"] == event
        session = uuid4()
        conn.execute("insert into auth.sessions(id,user_id) values(%s,%s)", (session, actor))
        claims(conn, actor, session=session)
        assert conn.execute("select public.sd_read('me','{}')").fetchone()[0]["id"] == str(actor)
        conn.execute("delete from auth.sessions where id=%s", (session,))
        conn.execute("savepoint revoked")
        try:
            conn.execute("select public.sd_read('me','{}')")
            raise AssertionError("Revoked session accepted")
        except psycopg.errors.InsufficientPrivilege:
            conn.execute("rollback to savepoint revoked")
        print("PASS: financial totals, delivery costs, reports, recommendations, audit lookup, session revocation")
    finally:
        conn.execute("rollback")


def run_concurrency(options):
    with psycopg.connect(**options, autocommit=True) as setup:
        actor, ingredient, dish = fixtures(setup)
        orders = [command(setup, "order_create", {"items": [{"menu_item_id": dish, "quantity": 1}]})["id"] for _ in range(2)]
    barrier = Barrier(2)

    def prepare(order_id):
        with psycopg.connect(**options, autocommit=True) as conn:
            claims(conn, actor)
            conn.execute("set role authenticated")
            barrier.wait(timeout=10)
            try:
                command(conn, "order_transition", {"id": order_id, "expected_version": 1, "status": "preparing"})
                return "prepared"
            except psycopg.errors.SerializationFailure:
                return "insufficient_stock"

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(prepare, orders))
    assert sorted(results) == ["insufficient_stock", "prepared"], results
    with psycopg.connect(**options, autocommit=True) as conn:
        assert conn.execute("select stock_quantity from private.ingredients where id=%s", (ingredient,)).fetchone()[0] == 4
        claims(conn, actor)
        assert conn.execute("select count(*) from private.order_consumptions").fetchone()[0] == 1
    barrier = Barrier(2)

    def duplicate(_):
        with psycopg.connect(**options, autocommit=True) as conn:
            claims(conn, actor)
            conn.execute("set role authenticated")
            barrier.wait(timeout=10)
            return command(conn, "order_create", {"items": [{"menu_item_id": dish, "quantity": 1}]}, "concurrent-duplicate")["id"]

    with ThreadPoolExecutor(max_workers=2) as pool:
        ids = list(pool.map(duplicate, range(2)))
    assert ids[0] == ids[1], ids
    print("PASS: competing preparations preserve nonnegative stock; simultaneous retries create one order")
