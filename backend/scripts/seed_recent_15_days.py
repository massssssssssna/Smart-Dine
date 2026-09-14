"""Add deterministic, clearly-labelled demo operations for the previous 15 days."""
import math
import random
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import psycopg

DB_URL = "postgresql://postgres:postgres@127.0.0.1:5432/smartdine"


def run():
    rng = random.Random(15092026)
    with psycopg.connect(DB_URL) as conn, conn.cursor() as cur:
        cur.execute("select branch_id from private.profiles where email='manager@smartdine.pk' and role='manager'")
        branch_id = cur.fetchone()[0]
        cur.execute("select id,full_name,email,staff_type from private.profiles where branch_id=%s and role='staff' and is_active", (branch_id,))
        staff = {row[3]: row[:3] for row in cur.fetchall()}
        waiter, chef, cashier = staff['waiter'], staff['kitchen'], staff['cashier']
        cur.execute("select t.id,t.name,t.seats,f.name from private.dining_tables t join private.floors f on f.id=t.floor_id where t.branch_id=%s", (branch_id,))
        tables = cur.fetchall()
        cur.execute("select id,name,category,selling_price,coalesce(packaging_cost,0) from private.menu_items where branch_id=%s and deleted_at is null and is_active", (branch_id,))
        menu = cur.fetchall()
        inserted = 0
        cur.execute("select count(distinct (completed_at at time zone 'Asia/Karachi')::date) from private.orders where branch_id=%s and order_number like 'DEMO-RECENT-%%'", (branch_id,))
        if cur.fetchone()[0] > 15:
            cur.execute(
                """
                UPDATE private.orders
                SET created_at = (to_date(split_part(order_number, '-', 3), 'YYYYMMDD') + created_at::time) AT TIME ZONE 'Asia/Karachi',
                    prepared_at = (to_date(split_part(order_number, '-', 3), 'YYYYMMDD') + created_at::time) AT TIME ZONE 'Asia/Karachi' + (prepared_at - created_at),
                    completed_at = (to_date(split_part(order_number, '-', 3), 'YYYYMMDD') + created_at::time) AT TIME ZONE 'Asia/Karachi' + (completed_at - created_at),
                    updated_at = (to_date(split_part(order_number, '-', 3), 'YYYYMMDD') + created_at::time) AT TIME ZONE 'Asia/Karachi' + (completed_at - created_at)
                WHERE branch_id = %s AND order_number LIKE 'DEMO-RECENT-%%'
                """,
                (branch_id,),
            )

        for ago in range(15, 0, -1):
            day = datetime.now(timezone.utc) - timedelta(days=ago)
            day_key = day.strftime('%Y%m%d')
            orders_for_day = rng.randint(3, 5) if day.weekday() in (4, 5, 6) else rng.randint(2, 3)
            for sequence in range(1, orders_for_day + 1):
                order_number = f"DEMO-RECENT-{day_key}-{sequence:02d}"
                cur.execute("select 1 from private.orders where branch_id=%s and order_number=%s", (branch_id, order_number))
                if cur.fetchone():
                    continue
                hour = rng.choice([13, 14, 19, 20, 21, 22])
                local_day = day.astimezone(ZoneInfo('Asia/Karachi'))
                created = local_day.replace(hour=hour, minute=rng.randint(0, 59), second=rng.randint(0, 59), microsecond=0).astimezone(timezone.utc)
                prepared = created + timedelta(minutes=rng.randint(14, 24))
                completed = prepared + timedelta(minutes=rng.randint(32, 55))
                table = rng.choice(tables)
                chosen = rng.sample(menu, k=rng.randint(2, min(4, len(menu))))
                order_id = uuid.uuid4()
                subtotal = Decimal('0')
                item_rows = []
                for item_id, name, category, price, packaging in chosen:
                    quantity = rng.randint(1, 3) if category == 'Drinks' else rng.randint(1, 2)
                    price = Decimal(str(price)); subtotal += price * quantity
                    item_rows.append((uuid.uuid4(), branch_id, order_id, item_id, name, quantity, price, round(price * Decimal('0.28'), 2), packaging))
                tax = round(subtotal * Decimal('0.15'), 2)
                discount = round(subtotal * Decimal('0.05'), 2) if rng.random() < .12 else Decimal('0')
                total = subtotal - discount + tax
                cash = Decimal(math.ceil(float(total) / 500) * 500)
                cur.execute(
                    """insert into private.orders(id,branch_id,status,discount,discount_percent,discount_reason,tax,tax_rate_snapshot,notes,
                    created_by,created_by_name,created_by_email,prepared_by,prepared_by_name,prepared_by_email,paid_by,paid_by_name,paid_by_email,
                    table_id,floor_name_snapshot,table_name_snapshot,seats_snapshot,cash_received,change_given,order_number,created_at,prepared_at,completed_at,updated_at,version)
                    values(%s,%s,'completed',%s,%s,%s,%s,15,'Demo service record',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,3)""",
                    (order_id,branch_id,discount,5 if discount else None,'Demo weekday offer' if discount else None,tax,
                     waiter[0],waiter[1],waiter[2],chef[0],chef[1],chef[2],cashier[0],cashier[1],cashier[2],
                     table[0],table[3],table[1],table[2],cash,cash-total,order_number,created,prepared,completed,completed),
                )
                cur.executemany("""insert into private.order_items(id,branch_id,order_id,menu_item_id,name_snapshot,quantity,price_snapshot,ingredient_cost_snapshot,packaging_cost_snapshot)
                                  values(%s,%s,%s,%s,%s,%s,%s,%s,%s)""", item_rows)
                inserted += 1
        conn.commit()
        cur.execute("""select count(*),count(distinct (completed_at at time zone 'Asia/Karachi')::date),round(sum((select coalesce(sum(quantity*price_snapshot),0) from private.order_items oi where oi.order_id=o.id)-discount+tax),2),
                              min((completed_at at time zone 'Asia/Karachi')::date),max((completed_at at time zone 'Asia/Karachi')::date),
                              count(*) filter(where created_by is null or prepared_by is null or paid_by is null)
                       from private.orders o where branch_id=%s and order_number like 'DEMO-RECENT-%%'""", (branch_id,))
        total, days, sales, first_day, last_day, incomplete = cur.fetchone()
        print(f"RECENT_DEMO_OK inserted={inserted} total={total} days={days} range={first_day}..{last_day} sales={sales} incomplete_flow={incomplete}")


if __name__ == '__main__':
    run()
