"""
Seed 6 Months of Realistic Customer Reviews & AI Feedback Intelligence for SmartDine AI.
Targets the active manager branch (manager@smartdine.pk).
Generates ~250 realistic customer reviews spanning 180 days (March to September 2026),
matching existing completed orders and receipts with dish-by-dish ratings,
operational aspects (Taste, Speed, Cleanliness, Hospitality, Value),
and structured AI sentiment extractions in private.review_analyses.
"""
import json
import random
import uuid
from datetime import timedelta
import psycopg

DB_URL = "postgresql://postgres:postgres@127.0.0.1:5432/smartdine"

# Dynamic authentic culinary comments by rating and dish
DISH_PRAISE = {
    "Chicken kharahi": [
        "Chicken kharahi was exceptionally tender with rich authentic gravy and fresh ginger. Loved every bite!",
        "Best kharahi in town! Fresh spices, well-balanced heat, and tender chicken cooked to perfection.",
        "Aromatic chicken kharahi with piping hot tandoori roti, truly authentic Pakistani dining.",
        "The desi ghee kharahi aroma was mouth-watering. Great portion size for our family table.",
    ],
    "Chicken Biryani": [
        "The biryani was fragrant, long-grain basmati with succulent chicken piece. Best in town!",
        "Perfect spice balance and delightful aroma. The raita and fresh salad paired wonderfully.",
        "Traditional Karachi style chicken biryani with flavorful potato and tender meat.",
        "Generous portion, fluffy rice grains that did not stick, and excellent taste.",
    ],
    "Beef Plaoo": [
        "Beef Plaoo had that authentic yakhni depth and melt-in-mouth beef boti. Reminded me of home.",
        "Rich meat broth flavor absorbed into every rice grain. Delicious and comforting.",
        "Traditional Bannu beef pulao flavor with tender beef cuts. Highly recommend this!",
    ],
    "Chicken Saji": [
        "Chicken Saji roasted to golden perfection, crispy skin on the outside and juicy inside.",
        "Authentic Balochi saji spices, served hot with seasoned rice. A culinary masterpiece.",
        "Tender roast chicken with subtle aromatic spices, not overly oily at all.",
    ],
    "CocaCola 1.5liter": [
        "Chilled drinks served right at the start as requested.",
        "Refreshing cold beverages to complement the spicy food.",
    ],
    "Pepsi 500ml": [
        "Ice cold drinks served promptly by the waiter.",
    ],
    "Fanta 1.5L": [
        "Chilled soft drinks served with fresh glasses.",
    ],
}

FOUR_STAR_COMMENTS = [
    "Delicious food and warm atmosphere. Chicken kharahi was flavorful, though we waited a few minutes for bread refills.",
    "Very good biryani and fresh salad. The dining hall was quite busy but staff managed well.",
    "Great family dinner! The beef pulao was rich and savory. Overall a pleasant evening.",
    "Loved the saji and prompt drink service. Portions are generous and well-priced.",
    "Authentic flavors and courteous staff. Just a bit loud near the front entrance during rush hour.",
]

THREE_STAR_COMMENTS = [
    "Food quality was decent, but dinner rush caused a 25-minute wait for the main course.",
    "The kharahi was tasty though slightly oilier than usual. Naan was hot and crisp.",
    "Biryani flavor was good, but portion size felt slightly smaller than last month.",
    "Average experience today; service was a bit slow due to full weekend tables.",
]

TWO_STAR_COMMENTS = [
    "Food took over 30 minutes to arrive and naans were lukewarm when served.",
    "Service was uncoordinated during peak lunch rush. Had to ask twice for water and cutlery.",
    "Chicken was a bit dry today in the kharahi. Expected better based on previous visits.",
]

ONE_STAR_COMMENTS = [
    "Disappointing visit today. The dish was far too salty and we had to send it back.",
    "Long delay in taking order and bill was incorrect initially. Needs manager attention.",
]

GENERAL_SERVICE_PRAISES = [
    "Server was courteous and attentive throughout our meal.",
    "Clean dining hall, tables were wiped and sanitized promptly.",
    "Great hospitality from the team, felt very welcomed.",
    "Quick table turnaround and billing was smooth.",
]


def run():
    print("Connecting to SmartDine database...")
    conn = psycopg.connect(DB_URL, autocommit=True)

    with conn.cursor() as cur:
        # 1. Locate Manager and Branch
        cur.execute(
            """
            SELECT p.branch_id, b.name
            FROM private.profiles p
            JOIN private.branches b ON b.id = p.branch_id
            WHERE p.email = 'manager@smartdine.pk' AND p.role = 'manager'
            """
        )
        row = cur.fetchone()
        if not row:
            print("Error: Manager manager@smartdine.pk not found!")
            return

        branch_id, branch_name = row
        print(f"Target Branch: {branch_name} ({branch_id})")

        # 2. Clear old reviews in this branch for a clean, deterministic seed
        print("Cleaning previous review records in branch...")
        cur.execute("DELETE FROM private.review_analyses WHERE branch_id = %s", (branch_id,))
        cur.execute("DELETE FROM private.processing_jobs WHERE branch_id = %s AND kind = 'review_analysis'", (branch_id,))
        cur.execute("DELETE FROM private.reviews WHERE branch_id = %s", (branch_id,))
        cur.execute("DELETE FROM private.review_tokens WHERE branch_id = %s", (branch_id,))

        # 3. Fetch Completed Orders
        cur.execute(
            """
            SELECT o.id, o.order_number, o.created_at, o.completed_at, o.created_by_name,
                   o.table_name_snapshot, o.floor_name_snapshot
            FROM private.orders o
            WHERE o.branch_id = %s AND o.status = 'completed' AND o.completed_at IS NOT NULL
            ORDER BY o.completed_at ASC
            """,
            (branch_id,)
        )
        orders = cur.fetchall()
        print(f"Loaded {len(orders)} completed orders from 6-month history.")

        # 4. Fetch Order Items map
        cur.execute(
            """
            SELECT oi.order_id, oi.menu_item_id, oi.name_snapshot, oi.quantity, oi.price_snapshot
            FROM private.order_items oi
            JOIN private.orders o ON o.id = oi.order_id
            WHERE o.branch_id = %s
            ORDER BY oi.id ASC
            """,
            (branch_id,)
        )
        items_by_order = {}
        for oi in cur.fetchall():
            ord_id = str(oi[0])
            items_by_order.setdefault(ord_id, []).append({
                "menu_item_id": oi[1],
                "name": oi[2],
                "quantity": oi[3],
                "price": oi[4]
            })

        # 5. Generate Reviews for ~70% of orders across the 6-month span
        random.seed(42)  # Deterministic realistic seed
        seeded_count = 0

        for ord_row in orders:
            order_id = ord_row[0]
            order_num = ord_row[1]
            completed_at = ord_row[3]
            waiter_name = ord_row[4] or "Service Team"
            table_name = ord_row[5] or "Dining Table"

            # ~70% conversion rate of customers leaving a review
            if random.random() > 0.72:
                continue

            items = items_by_order.get(str(order_id), [])
            if not items:
                continue

            # Review submitted 12 to 55 minutes after meal settlement
            review_time = completed_at + timedelta(minutes=random.randint(12, 55))

            # Realistic rating distribution:
            # 62% 5-star, 24% 4-star, 9% 3-star, 3% 2-star, 2% 1-star
            roll = random.random()
            if roll < 0.62:
                rating = 5
            elif roll < 0.86:
                rating = 4
            elif roll < 0.95:
                rating = 3
            elif roll < 0.98:
                rating = 2
            else:
                rating = 1

            # Determine food dish for specific comments
            food_dishes = [it for it in items if "cola" not in it["name"].lower() and "pepsi" not in it["name"].lower() and "fanta" not in it["name"].lower()]
            main_dish = food_dishes[0] if food_dishes else items[0]

            # Generate natural comment text based on rating
            if rating == 5:
                dish_quotes = DISH_PRAISE.get(main_dish["name"], [f"{main_dish['name']} was exquisite and freshly prepared."])
                main_comment = random.choice(dish_quotes) + " " + random.choice(GENERAL_SERVICE_PRAISES)
                aspect_taste = 5
                aspect_speed = random.choice([4, 5, 5])
                aspect_clean = random.choice([4, 5, 5])
                aspect_hosp = 5
                aspect_val = random.choice([4, 5])
                taste_sentiment = "positive"
                speed_sentiment = "positive"
            elif rating == 4:
                main_comment = random.choice(FOUR_STAR_COMMENTS)
                aspect_taste = random.choice([4, 5])
                aspect_speed = random.choice([3, 4, 4])
                aspect_clean = random.choice([4, 5])
                aspect_hosp = random.choice([4, 5])
                aspect_val = 4
                taste_sentiment = "positive"
                speed_sentiment = "neutral" if aspect_speed == 3 else "positive"
            elif rating == 3:
                main_comment = random.choice(THREE_STAR_COMMENTS)
                aspect_taste = random.choice([3, 4])
                aspect_speed = random.choice([2, 3])
                aspect_clean = random.choice([3, 4])
                aspect_hosp = random.choice([3, 4])
                aspect_val = 3
                taste_sentiment = "neutral"
                speed_sentiment = "negative" if aspect_speed == 2 else "neutral"
            elif rating == 2:
                main_comment = random.choice(TWO_STAR_COMMENTS)
                aspect_taste = random.choice([2, 3])
                aspect_speed = random.choice([1, 2])
                aspect_clean = random.choice([3, 4])
                aspect_hosp = 2
                aspect_val = 2
                taste_sentiment = "negative"
                speed_sentiment = "negative"
            else:
                main_comment = random.choice(ONE_STAR_COMMENTS)
                aspect_taste = 1
                aspect_speed = 1
                aspect_clean = 2
                aspect_hosp = 2
                aspect_val = 1
                taste_sentiment = "negative"
                speed_sentiment = "negative"

            # Dish-by-dish ratings
            dish_parts = []
            for it in items:
                d_rating = rating if rating == 5 else min(5, max(1, rating + random.choice([-1, 0, 1])))
                dish_parts.append(f"Dish {it['menu_item_id']}: {d_rating}★ ({it['name']})")

            aspects_part = f"[Aspects: Taste: {aspect_taste}★, Service Speed: {aspect_speed}★, Cleanliness: {aspect_clean}★, Hospitality: {aspect_hosp}★, Value: {aspect_val}★]"
            dishes_part = f"[Dish Ratings: {'; '.join(dish_parts)}]"
            full_comment = f"{main_comment}\n{aspects_part}\n{dishes_part}"

            review_id = uuid.uuid4()
            job_id = uuid.uuid4()
            token_id = uuid.uuid4()
            token_hash = uuid.uuid4().hex + uuid.uuid4().hex  # simulated SHA-256

            # 1. Insert review token (marked used)
            cur.execute(
                """
                INSERT INTO private.review_tokens (id, branch_id, order_id, token_hash, expires_at, used_at, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    token_id,
                    branch_id,
                    order_id,
                    token_hash,
                    completed_at + timedelta(days=7),
                    review_time,
                    completed_at,
                )
            )

            # 2. Insert customer review
            cur.execute(
                """
                INSERT INTO private.reviews (id, branch_id, order_id, menu_item_id, rating, comment, analysis_status, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    review_id,
                    branch_id,
                    order_id,
                    main_dish.get("menu_item_id"),
                    rating,
                    full_comment,
                    "completed",
                    review_time,
                )
            )

            # 3. Insert processing job for review analysis
            cur.execute(
                """
                INSERT INTO private.processing_jobs (
                    id, branch_id, kind, deduplication_key, payload, status,
                    attempts, max_attempts, created_at, completed_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    job_id,
                    branch_id,
                    "review_analysis",
                    f"review-analysis-{review_id}",
                    json.dumps({"review_id": str(review_id)}),
                    "completed",
                    1,
                    3,
                    review_time,
                    review_time,
                )
            )

            # 4. Insert structured AI analysis result
            ai_aspects = [
                {
                    "aspect": "taste",
                    "sentiment": taste_sentiment,
                    "evidence": main_dish["name"] + (" was rich and flavorful" if rating >= 4 else " flavor needed adjustment")
                },
                {
                    "aspect": "service_speed",
                    "sentiment": speed_sentiment,
                    "evidence": "Service was prompt" if aspect_speed >= 4 else "Delay observed during service"
                },
                {
                    "aspect": "cleanliness",
                    "sentiment": "positive" if aspect_clean >= 4 else "neutral",
                    "evidence": "Dining table and setting were clean"
                },
                {
                    "aspect": "price_value",
                    "sentiment": "positive" if aspect_val >= 4 else "neutral",
                    "evidence": "Fair portion and pricing"
                }
            ]

            analysis_result = {
                "aspects": ai_aspects,
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
                    review_time,
                )
            )

            seeded_count += 1

        print(f"\n[SUCCESS] Successfully seeded {seeded_count} realistic 6-month customer reviews!")
        print("-> Reviews span: March 15, 2026 to September 11, 2026")
        print("-> Ratings, dish feedback, aspects, and AI analysis records populated.")


if __name__ == "__main__":
    run()
