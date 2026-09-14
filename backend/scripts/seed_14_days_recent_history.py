"""
Seed 14 Days of Recent Restaurant Operations (2026-09-14 through 2026-09-27)
Includes orders, order items, customer reviews, AI sentiment analysis, daily coverage, and expenses.
Target Branch: manager@smartdine.pk
"""
import json
import math
import random
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import psycopg

DB_URL = "postgresql://postgres:postgres@127.0.0.1:5432/smartdine"

NOTES_POOL = [
    "Family table, please serve dishes together.",
    "Extra spicy kharahi, less oil.",
    "Mild spice for children.",
    "Window side table preferred.",
    "Chilled drinks with ice.",
    "Extra raita and salad.",
    "Quick service required for lunch.",
    "Demo service record",
    "Special guest celebration.",
    "Serve drinks first.",
]

DISCOUNT_REASONS = [
    "Loyalty Member",
    "Weekend Special",
    "Weekday Promotion",
    "Manager Courtesy",
]

DISH_PRAISE = {
    "Chicken kharahi": [
        "Chicken kharahi was exceptionally tender with rich authentic gravy and fresh ginger. Loved every bite!",
        "Best kharahi in town! Fresh spices, well-balanced heat, and tender chicken cooked to perfection.",
        "Aromatic chicken kharahi with piping hot tandoori roti, truly authentic Pakistani dining.",
    ],
    "Chicken Biryani": [
        "The biryani was fragrant, long-grain basmati with succulent chicken piece. Best in town!",
        "Perfect spice balance and delightful aroma. The raita and fresh salad paired wonderfully.",
        "Traditional Karachi style chicken biryani with flavorful potato and tender meat.",
    ],
    "Beef Plaoo": [
        "Beef Plaoo had that authentic yakhni depth and melt-in-mouth beef boti. Reminded me of home.",
        "Rich meat broth flavor absorbed into every rice grain. Delicious and comforting.",
    ],
    "Chicken Saji": [
        "Chicken Saji roasted to golden perfection, crispy skin on the outside and juicy inside.",
        "Authentic Balochi saji spices, served hot with seasoned rice. A culinary masterpiece.",
    ],
    "CocaCola 1.5liter": ["Chilled drinks served right at the start."],
    "Pepsi 500ml": ["Ice cold drinks served promptly by the waiter."],
    "Fanta 1.5L": ["Chilled soft drinks served with fresh glasses."],
}

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

        # 2. Fetch Active Staff
        cur.execute(
            """
            SELECT id, full_name, email, staff_type
            FROM private.profiles
            WHERE branch_id = %s AND role = 'staff'
            """,
            (branch_id,),
        )
        staff_by_type = {s[3]: {"id": s[0], "name": s[1], "email": s[2]} for s in cur.fetchall()}
        raza = staff_by_type.get("waiter", {"id": None, "name": "raza", "email": "wa@gmail.com"})
        ali = staff_by_type.get("kitchen", {"id": None, "name": "ali", "email": "ki@gmail.com"})
        moon = staff_by_type.get("cashier", {"id": None, "name": "MOOn", "email": "ca@gmail.com"})

        # 3. Fetch Dining Tables
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
            print("Error: No tables found!")
            return

        # 4. Fetch Active Menu Items (deleted_at IS NULL)
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
            print("Error: No active menu items found!")
            return
        print(f"Loaded {len(menu_items)} active menu items.")

        # Clean existing 14 days demo records if any
        cur.execute(
            """
            SELECT count(*) FROM private.orders
            WHERE branch_id = %s AND order_number LIKE %s
            """,
            (branch_id, "DEMO-RECENT-202609%"),
        )
        cnt = cur.fetchone()[0]
        if cnt > 0:
            print(f"Removing existing {cnt} demo orders for Sep 2026 to ensure clean idempotency...")
            cur.execute(
                """
                DELETE FROM private.review_analyses
                WHERE branch_id = %s AND review_id IN (
                    SELECT r.id FROM private.reviews r
                    JOIN private.orders o ON o.id = r.order_id
                    WHERE o.branch_id = %s AND (o.order_number LIKE %s OR o.order_number LIKE %s)
                )
                """,
                (branch_id, branch_id, "DEMO-RECENT-2026091%", "DEMO-RECENT-2026092%"),
            )
            cur.execute(
                """
                DELETE FROM private.reviews
                WHERE branch_id = %s AND order_id IN (
                    SELECT id FROM private.orders
                    WHERE branch_id = %s AND (order_number LIKE %s OR order_number LIKE %s)
                )
                """,
                (branch_id, branch_id, "DEMO-RECENT-2026091%", "DEMO-RECENT-2026092%"),
            )
            cur.execute(
                """
                DELETE FROM private.review_tokens
                WHERE branch_id = %s AND order_id IN (
                    SELECT id FROM private.orders
                    WHERE branch_id = %s AND (order_number LIKE %s OR order_number LIKE %s)
                )
                """,
                (branch_id, branch_id, "DEMO-RECENT-2026091%", "DEMO-RECENT-2026092%"),
            )
            cur.execute(
                """
                DELETE FROM private.order_items
                WHERE order_id IN (
                    SELECT id FROM private.orders
                    WHERE branch_id = %s AND (order_number LIKE %s OR order_number LIKE %s)
                )
                """,
                (branch_id, "DEMO-RECENT-2026091%", "DEMO-RECENT-2026092%"),
            )
            cur.execute(
                """
                DELETE FROM private.orders
                WHERE branch_id = %s AND (order_number LIKE %s OR order_number LIKE %s)
                """,
                (branch_id, "DEMO-RECENT-2026091%", "DEMO-RECENT-2026092%"),
            )
            print("Existing recent demo orders cleaned up.")

        # 5. Generate 14 days of realistic orders (2026-09-14 to 2026-09-27)
        random.seed(1427)
        orders_batch = []
        items_batch = []
        reviews_data = []

        start_dt = date(2026, 9, 14)
        end_dt = date(2026, 9, 27)
        total_days = (end_dt - start_dt).days + 1  # 14 days

        karachi_tz = timezone(timedelta(hours=5))

        for day_idx in range(total_days):
            current_date = start_dt + timedelta(days=day_idx)
            weekday = current_date.weekday() # 4=Fri, 5=Sat, 6=Sun
            is_weekend = weekday in (4, 5, 6)
            is_today = (current_date == end_dt)

            if is_today:
                # Today up to 17:00
                num_orders = 4
                time_slots = [(12, 35), (13, 15), (14, 45), (16, 10)]
            else:
                num_orders = random.randint(4, 6) if is_weekend else random.randint(3, 4)
                lunch_hours = [12, 13, 14]
                dinner_hours = [19, 20, 21, 22]
                time_slots = []
                for _ in range(num_orders):
                    if random.random() > 0.4:
                        h = random.choice(dinner_hours)
                    else:
                        h = random.choice(lunch_hours)
                    m = random.randint(5, 55)
                    time_slots.append((h, m))
                time_slots.sort()

            for seq, (h, m) in enumerate(time_slots, 1):
                order_id = uuid.uuid4()
                order_num = f"DEMO-RECENT-{current_date.strftime('%Y%m%d')}-{seq:02d}"

                created_at = datetime(current_date.year, current_date.month, current_date.day,
                                      h, m, random.randint(0, 59), tzinfo=karachi_tz)
                prep_min = random.randint(12, 22)
                prepared_at = created_at + timedelta(minutes=prep_min)
                dining_min = random.randint(25, 45)
                completed_at = prepared_at + timedelta(minutes=dining_min)

                tbl = random.choice(tables)
                tbl_id, tbl_name, tbl_seats, flr_name = tbl

                # Pick 2 to 4 dishes
                dishes = random.sample(menu_items, k=random.randint(2, min(4, len(menu_items))))
                subtotal = Decimal("0.00")
                order_items_list = []

                for dish in dishes:
                    d_id, d_name, d_cat, d_price, d_pack = dish
                    qty = random.randint(1, 3) if "Drink" in d_cat or "500ml" in d_name or "1.5" in d_name else random.randint(1, 2)
                    price = Decimal(str(d_price))
                    subtotal += price * qty
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
                    order_items_list.append({"id": d_id, "name": d_name, "price": price, "qty": qty})

                tax_rate = Decimal("15.00")
                tax = round(subtotal * (tax_rate / Decimal("100.0")), 2)

                give_discount = random.random() < 0.15
                if give_discount:
                    disc_pct = Decimal(random.choice([5, 10]))
                    discount = round(subtotal * (disc_pct / Decimal("100.0")), 2)
                    disc_reason = random.choice(DISCOUNT_REASONS)
                else:
                    disc_pct = None
                    discount = Decimal("0.00")
                    disc_reason = None

                total = subtotal - discount + tax
                cash_step = 500
                cash_received = Decimal(str(math.ceil(float(total) / cash_step) * cash_step))
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
                    raza["id"],
                    raza["name"],
                    raza["email"],
                    ali["id"],
                    ali["name"],
                    ali["email"],
                    moon["id"],
                    moon["name"],
                    moon["email"],
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

                # Generate review for ~50% of orders
                if random.random() < 0.50:
                    reviews_data.append({
                        "order_id": order_id,
                        "created_at": completed_at + timedelta(minutes=random.randint(15, 90)),
                        "items": order_items_list,
                        "waiter": raza["name"],
                        "table": tbl_name,
                    })

        print(f"Prepared {len(orders_batch)} orders and {len(items_batch)} order items.")

        # 6. Bulk Insert Orders
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
                o[24], o[25], o[26], o[27], o[27]
            ) for o in orders_batch],
        )
        print("Inserted orders.")

        # 7. Bulk Insert Order Items
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
        print("Inserted order items.")

        # 8. Daily Coverage for all 14 days
        for day_idx in range(total_days):
            coverage_day = start_dt + timedelta(days=day_idx)
            cur.execute(
                """
                INSERT INTO private.daily_coverage(branch_id, day, source, status, note, closed_by)
                VALUES (%s, %s, 'live', 'complete', 'Verified 14-day demo operations ledger', %s)
                ON CONFLICT (branch_id, day) DO UPDATE
                SET status = 'complete', source = 'live', note = 'Verified 14-day demo operations ledger'
                """,
                (branch_id, coverage_day, manager_id),
            )
        print("Updated private.daily_coverage for all 14 days.")

        # 9. Insert Reviews & AI Sentiment Analysis
        review_ratings = [5, 5, 5, 4, 4, 4, 3, 5]
        for rev in reviews_data:
            review_id = uuid.uuid4()
            token_id = uuid.uuid4()
            job_id = uuid.uuid4()
            token_hash = uuid.uuid4().hex + uuid.uuid4().hex
            rating = random.choice(review_ratings)
            main_item = rev["items"][0]
            dish_name = main_item["name"]
            
            praise_list = DISH_PRAISE.get(dish_name, ["Excellent dish, flavorful and freshly made."])
            comment = random.choice(praise_list)

            # review_tokens
            cur.execute(
                """
                INSERT INTO private.review_tokens (id, branch_id, order_id, token_hash, expires_at, used_at, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (token_id, branch_id, rev["order_id"], token_hash, rev["created_at"] + timedelta(days=7), rev["created_at"], rev["created_at"]),
            )

            # reviews
            cur.execute(
                """
                INSERT INTO private.reviews (id, branch_id, order_id, menu_item_id, rating, comment, analysis_status, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, 'completed', %s)
                """,
                (review_id, branch_id, rev["order_id"], main_item["id"], rating, comment, rev["created_at"]),
            )

            # processing_jobs
            cur.execute(
                """
                INSERT INTO private.processing_jobs (
                    id, branch_id, kind, deduplication_key, payload, status,
                    attempts, max_attempts, created_at, completed_at
                )
                VALUES (%s, %s, 'review_analysis', %s, %s, 'completed', 1, 3, %s, %s)
                """,
                (job_id, branch_id, f"review-analysis-{review_id}", json.dumps({"review_id": str(review_id)}), rev["created_at"], rev["created_at"]),
            )

            # review_analyses
            aspects = [
                {"aspect": "taste", "sentiment": "positive" if rating >= 4 else "neutral", "evidence": f"{dish_name} was well seasoned and delicious."},
                {"aspect": "service_speed", "sentiment": "positive", "evidence": "Order was prepared and served quickly."},
                {"aspect": "cleanliness", "sentiment": "positive", "evidence": "Dining environment was clean and pleasant."},
                {"aspect": "price_value", "sentiment": "positive", "evidence": "Fair portion and pricing."},
            ]
            analysis_result = {
                "aspects": aspects,
                "model": "openai/gpt-oss-20b",
                "prompt_version": "v1.0"
            }
            cur.execute(
                """
                INSERT INTO private.review_analyses (
                    review_id, branch_id, job_id, result, model, prompt_version, created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    review_id,
                    branch_id,
                    job_id,
                    json.dumps(analysis_result),
                    "openai/gpt-oss-20b",
                    "v1.0",
                    rev["created_at"],
                ),
            )
        print(f"Inserted {len(reviews_data)} customer reviews with AI sentiment analyses.")

        # 10. Insert 14-day Operational Expenses
        expenses_to_seed = [
            ("raw_ingredients", Decimal("18500.00"), date(2026, 9, 15), "Weekly poultry and basmati rice procurement"),
            ("utilities", Decimal("6200.00"), date(2026, 9, 17), "Kitchen gas cylinder refill (commercial)"),
            ("maintenance", Decimal("3500.00"), date(2026, 9, 19), "Deep fryer burner maintenance and kitchen hood cleaning"),
            ("packaging", Decimal("4800.00"), date(2026, 9, 21), "Eco-friendly takeaway containers and food wrapping bags"),
            ("raw_ingredients", Decimal("22000.00"), date(2026, 9, 23), "Fresh meat, dairy, and seasonal spices shipment"),
            ("staff_welfare", Decimal("3000.00"), date(2026, 9, 25), "Kitchen brigade staff tea and refreshments"),
            ("raw_ingredients", Decimal("15000.00"), date(2026, 9, 27), "Weekend replenishment of fresh poultry and produce"),
        ]
        for cat, amt, exp_date, desc in expenses_to_seed:
            cur.execute(
                """
                INSERT INTO private.expenses (
                    id, branch_id, category, amount, incurred_on, description, created_by, created_at, version
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, 1
                )
                """,
                (uuid.uuid4(), branch_id, cat, amt, exp_date, desc, manager_id,
                 datetime(exp_date.year, exp_date.month, exp_date.day, 10, 0, 0, tzinfo=karachi_tz)),
            )
        print(f"Inserted {len(expenses_to_seed)} operational expenses across the 14-day window.")

        # 11. Print Verification Stats
        cur.execute(
            """
            SELECT count(*), min(created_at), max(created_at), sum(subtotal)
            FROM (
                SELECT o.id, o.created_at, sum(oi.quantity * oi.price_snapshot) as subtotal
                FROM private.orders o
                JOIN private.order_items oi ON oi.order_id = o.id
                WHERE o.branch_id = %s AND o.created_at >= '2026-09-14 00:00:00+05'
                GROUP BY o.id, o.created_at
            ) sub
            """,
            (branch_id,),
        )
        stats = cur.fetchone()
        print("\n--- 14-Day Seeding Complete ---")
        print(f"Total Orders in 14-day window: {stats[0]}")
        print(f"From: {stats[1]} To: {stats[2]}")
        print(f"Gross Revenue: PKR {stats[3]:,.2f}")

if __name__ == "__main__":
    run()
