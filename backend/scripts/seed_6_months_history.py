"""
Seed 6 Months of Realistic Restaurant Operations & Immutable Staff/Menu History for SmartDine AI.
Targets the active manager branch (manager@smartdine.pk).
Generates ~360 orders spanning 180 days with multi-staff timelines (active and deleted staff),
authentic Pakistani menu items, floor tables, table taxes, and cashier settlements.
"""
import random
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import psycopg

DB_URL = "postgresql://postgres:postgres@127.0.0.1:5432/smartdine"

NOTES_POOL = [
    "Family table, please serve dishes together.",
    "Extra spicy karahi, less oil.",
    "Mild spice for children.",
    "Window side table preferred.",
    "No ice in drinks.",
    "Extra mint chutney with biryani.",
    "Special guest celebration.",
    "Serve drinks first.",
    "Crisp naans requested.",
    "Quick service required.",
    "",
    "",
]

DISCOUNT_REASONS = [
    "Loyalty Member",
    "Chef's Family Discount",
    "Weekend Special",
    "Manager Courtesy",
]


def run():
    print("Connecting to SmartDine database...")
    conn = psycopg.connect(DB_URL, autocommit=True)

    with conn.cursor() as cur:
        # 1. Locate Manager and Branch
        cur.execute(
            """
            SELECT p.branch_id, b.name, p.id
            FROM private.profiles p
            JOIN private.branches b ON b.id = p.branch_id
            WHERE p.email = 'manager@smartdine.pk' AND p.role = 'manager'
            """
        )
        row = cur.fetchone()
        if not row:
            print("Error: Manager manager@smartdine.pk not found!")
            return

        branch_id, branch_name, manager_id = row
        print(f"Target Branch: {branch_name} ({branch_id})")

        # 2. Fetch Active Staff in Branch
        cur.execute(
            """
            SELECT id, full_name, email, staff_type
            FROM private.profiles
            WHERE branch_id = %s AND role = 'staff'
            """,
            (branch_id,),
        )
        staff_rows = cur.fetchall()
        staff_by_type = {}
        for s in staff_rows:
            staff_by_type[s[3]] = {"id": s[0], "name": s[1], "email": s[2]}

        raza = staff_by_type.get("waiter", {"id": None, "name": "Raza", "email": "wa@gmail.com"})
        ali = staff_by_type.get("kitchen", {"id": None, "name": "Ali", "email": "ki@gmail.com"})
        moon = staff_by_type.get("cashier", {"id": None, "name": "MOOn", "email": "ca@gmail.com"})

        # Former/Deleted Staff profiles (simulating deleted accounts)
        usman = {"id": None, "name": "Usman Khan", "email": "usman.waiter@smartdine.pk"}
        bilal = {"id": None, "name": "Chef Bilal", "email": "bilal.chef@smartdine.pk"}
        zainab = {"id": None, "name": "Zainab Bibi", "email": "zainab.cashier@smartdine.pk"}

        # 3. Fetch Tables in Branch
        cur.execute(
            """
            SELECT t.id, t.name, t.seats, f.name
            FROM private.dining_tables t
            JOIN private.floors f ON f.id = t.floor_id
            WHERE t.branch_id = %s
            """,
            (branch_id,),
        )
        tables = cur.fetchall()
        if not tables:
            print("Error: No tables found in branch!")
            return
        print(f"Loaded {len(tables)} dining tables.")

        # 4. Fetch Menu Items in Branch
        cur.execute(
            """
            SELECT id, name, category, selling_price, packaging_cost
            FROM private.menu_items
            WHERE branch_id = %s AND deleted_at IS NULL
            """,
            (branch_id,),
        )
        menu_items = cur.fetchall()
        if not menu_items:
            print("Error: No menu items found in branch!")
            return
        print(f"Loaded {len(menu_items)} menu items.")

        # Check existing seeded history
        cur.execute("SELECT count(*) FROM private.orders WHERE branch_id = %s AND order_number LIKE %s", (branch_id, "ORD-HIST-%"))
        existing_hist = cur.fetchone()[0]
        if existing_hist > 0:
            print(f"Notice: {existing_hist} historical seed orders already exist. Cleaning up previous seed batch...")
            cur.execute(
                """
                DELETE FROM private.order_items
                WHERE order_id IN (SELECT id FROM private.orders WHERE branch_id = %s AND order_number LIKE %s)
                """,
                (branch_id, "ORD-HIST-%"),
            )
            cur.execute("DELETE FROM private.orders WHERE branch_id = %s AND order_number LIKE %s", (branch_id, "ORD-HIST-%"))
            print("Cleaned up previous seed orders.")

        # 5. Generate 180 Days of Historical Orders (October 2025 to Present)
        now = datetime.now(timezone.utc)
        start_date = now - timedelta(days=180)
        total_orders_to_seed = 360
        order_idx = 1
        orders_batch = []
        items_batch = []

        print(f"Generating {total_orders_to_seed} orders across 180 days (from {start_date.strftime('%Y-%m-%d')} to {now.strftime('%Y-%m-%d')})...")

        random.seed(42)  # Deterministic seed for reproducible quality

        for day_offset in range(180):
            current_day = start_date + timedelta(days=day_offset)
            weekday = current_day.weekday()  # 4=Fri, 5=Sat, 6=Sun
            is_weekend = weekday in (4, 5, 6)

            # Weekend rush vs weekday traffic
            daily_orders_count = random.randint(2, 4) if is_weekend else random.randint(1, 2)

            for _ in range(daily_orders_count):
                if order_idx > total_orders_to_seed:
                    break

                # Shift distribution (Lunch 12:30-15:30 or Dinner 19:30-23:00)
                is_dinner = random.random() > 0.4
                if is_dinner:
                    hour = random.randint(19, 22)
                    minute = random.randint(0, 59)
                else:
                    hour = random.randint(12, 15)
                    minute = random.randint(0, 59)

                created_at = current_day.replace(hour=hour, minute=minute, second=random.randint(0, 59))
                prep_minutes = random.randint(14, 25)
                prepared_at = created_at + timedelta(minutes=prep_minutes)
                dining_minutes = random.randint(30, 55)
                completed_at = prepared_at + timedelta(minutes=dining_minutes)

                # Staff Assignment according to timeline:
                # Waiter: Usman Khan (day 0-110), Raza (day 60-180)
                if day_offset < 60:
                    waiter = usman
                elif day_offset <= 110:
                    waiter = usman if random.random() > 0.45 else raza
                else:
                    waiter = raza

                # Chef: Chef Bilal (day 0-135), Ali (day 70-180)
                if day_offset < 70:
                    chef = bilal
                elif day_offset <= 135:
                    chef = bilal if random.random() > 0.50 else ali
                else:
                    chef = ali

                # Cashier: Zainab Bibi (day 0-85), MOOn (day 50-180)
                if day_offset < 50:
                    cashier = zainab
                elif day_offset <= 85:
                    cashier = zainab if random.random() > 0.50 else moon
                else:
                    cashier = moon

                # Table selection
                tbl = random.choice(tables)
                tbl_id, tbl_name, tbl_seats, flr_name = tbl

                # Select 2 to 4 distinct menu items
                order_dishes = random.sample(menu_items, k=random.randint(2, min(4, len(menu_items))))
                order_id = uuid.uuid4()
                order_num = f"ORD-HIST-{order_idx:04d}"

                subtotal = Decimal("0.00")
                for dish in order_dishes:
                    d_id, d_name, d_cat, d_price, d_pack = dish
                    # Rice/Handi 1-2, drinks 1-4
                    qty = random.randint(1, 3) if "Drink" in d_cat or "Pepsi" in d_name or "Cola" in d_name else random.randint(1, 2)
                    price = Decimal(str(d_price))
                    subtotal += price * qty

                    # Estimated ingredient cost (25-35% of selling price)
                    ing_cost = round(price * Decimal("0.28"), 2)
                    pack_cost = Decimal(str(d_pack or 0))

                    items_batch.append((
                        uuid.uuid4(),
                        branch_id,
                        order_id,
                        d_id,
                        d_name,
                        qty,
                        price,
                        ing_cost,
                        pack_cost,
                    ))

                # Financial calculations
                tax_rate = Decimal("15.00")
                tax = round(subtotal * (tax_rate / Decimal("100.0")), 2)

                # 12% probability of cashier promotional discount
                give_discount = random.random() < 0.12
                if give_discount:
                    disc_pct = Decimal(random.choice([5, 10]))
                    discount = round(subtotal * (disc_pct / Decimal("100.0")), 2)
                    disc_reason = random.choice(DISCOUNT_REASONS)
                else:
                    disc_pct = None
                    discount = Decimal("0.00")
                    disc_reason = None

                total = subtotal - discount + tax

                # Cash received (rounded up to nearest 500 PKR)
                import math
                total_float = float(total)
                cash_step = 500
                cash_received = Decimal(str(math.ceil(total_float / cash_step) * cash_step))
                if cash_received == total:
                    cash_received += Decimal("500.00")
                change_given = cash_received - total

                note = random.choice(NOTES_POOL)

                orders_batch.append((
                    order_id,
                    branch_id,
                    "completed",
                    discount,
                    disc_pct,
                    disc_reason,
                    tax,
                    tax_rate,
                    note,
                    waiter["id"],
                    waiter["name"],
                    waiter["email"],
                    chef["id"],
                    chef["name"],
                    chef["email"],
                    cashier["id"],
                    cashier["name"],
                    cashier["email"],
                    tbl_id,
                    flr_name,
                    tbl_name,
                    tbl_seats,
                    cash_received,
                    change_given,
                    order_num,
                    created_at,
                    prepared_at,
                    completed_at,
                ))

                order_idx += 1

        print(f"Prepared {len(orders_batch)} orders and {len(items_batch)} order items.")

        # 6. Bulk Insert Orders
        print("Inserting orders into private.orders...")
        cur.executemany(
            """
            INSERT INTO private.orders (
                id, branch_id, status, discount, discount_percent, discount_reason,
                tax, tax_rate_snapshot, notes, created_by, created_by_name, created_by_email,
                prepared_by, prepared_by_name, prepared_by_email,
                paid_by, paid_by_name, paid_by_email, table_id, floor_name_snapshot,
                table_name_snapshot, seats_snapshot, cash_received, change_given,
                order_number, created_at, prepared_at, completed_at, updated_at, version
            ) VALUES (
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s, %s, %s, 3
            )
            """,
            [(
                o[0], o[1], o[2], o[3], o[4], o[5],
                o[6], o[7], o[8], o[9], o[10], o[11],
                o[12], o[13], o[14],
                o[15], o[16], o[17], o[18], o[19],
                o[20], o[21], o[22], o[23],
                o[24], o[25], o[26], o[27], o[27]  # updated_at = completed_at
            ) for o in orders_batch],
        )

        # 7. Bulk Insert Order Items
        print("Inserting items into private.order_items...")
        cur.executemany(
            """
            INSERT INTO private.order_items (
                id, branch_id, order_id, menu_item_id, name_snapshot, quantity,
                price_snapshot, ingredient_cost_snapshot, packaging_cost_snapshot
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s
            )
            """,
            items_batch,
        )

        print("\nSuccessfully seeded 6 months of historical orders!")

        # 8. Verify Staff Ledger Statistics
        cur.execute(
            """
            SELECT 
                created_by_name, created_by_email,
                count(*) as orders,
                min(created_at) as first_order,
                max(created_at) as last_order,
                round(sum((select coalesce(sum(quantity * price_snapshot), 0) from private.order_items oi where oi.order_id = o.id) - o.discount + o.tax), 2) as total_sales
            FROM private.orders o
            WHERE branch_id = %s
            GROUP BY created_by_name, created_by_email
            ORDER BY count(*) DESC
            """,
            (branch_id,),
        )
        print("\n--- Waiter Attribution & Tenure Ledger ---")
        for r in cur.fetchall():
            days = max(1, (r[4] - r[3]).days)
            months = max(1, round(days / 30.0))
            print(f"Waiter: {r[0]} ({r[1]}) | Orders: {r[2]} | Sales: PKR {r[5]:,.2f} | Tenure: {months} months ({r[3].strftime('%b %Y')} - {r[4].strftime('%b %Y')})")

        cur.execute(
            """
            SELECT 
                prepared_by_name, prepared_by_email,
                count(*) as orders,
                min(prepared_at) as first_prep,
                max(prepared_at) as last_prep
            FROM private.orders
            WHERE branch_id = %s AND prepared_by_name IS NOT NULL
            GROUP BY prepared_by_name, prepared_by_email
            ORDER BY count(*) DESC
            """,
            (branch_id,),
        )
        print("\n--- Kitchen Chef Attribution & Tenure Ledger ---")
        for r in cur.fetchall():
            days = max(1, (r[4] - r[3]).days)
            months = max(1, round(days / 30.0))
            print(f"Chef: {r[0]} ({r[1]}) | Tickets: {r[2]} | Tenure: {months} months ({r[3].strftime('%b %Y')} - {r[4].strftime('%b %Y')})")

        cur.execute(
            """
            SELECT 
                paid_by_name, paid_by_email,
                count(*) as orders,
                min(completed_at) as first_paid,
                max(completed_at) as last_paid,
                round(sum((select coalesce(sum(quantity * price_snapshot), 0) from private.order_items oi where oi.order_id = o.id) - o.discount + o.tax), 2) as total_sales
            FROM private.orders o
            WHERE branch_id = %s AND paid_by_name IS NOT NULL
            GROUP BY paid_by_name, paid_by_email
            ORDER BY count(*) DESC
            """,
            (branch_id,),
        )
        print("\n--- Cashier Attribution & Tenure Ledger ---")
        for r in cur.fetchall():
            days = max(1, (r[4] - r[3]).days)
            months = max(1, round(days / 30.0))
            print(f"Cashier: {r[0]} ({r[1]}) | Bills: {r[2]} | Settled: PKR {r[5]:,.2f} | Tenure: {months} months ({r[3].strftime('%b %Y')} - {r[4].strftime('%b %Y')})")

        print("\nDone! 6-Month historical operations are live in PostgreSQL.")


if __name__ == "__main__":
    run()
