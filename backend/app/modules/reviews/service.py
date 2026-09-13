import hashlib
from datetime import datetime, timezone
from app.modules.common import payload
from app.core.exceptions import AppError


class ReviewService:
    def __init__(self, gateway):
        self.gateway = gateway

    async def read(self, params: dict):
        page = await self.gateway.read("reviews", params)
        items = page.get("items", []) if isinstance(page, dict) else []
        if not items or not hasattr(self.gateway, "query"):
            return page

        # Review IDs come from the branch-scoped RPC above. Direct enrichment is
        # restricted to those exact IDs so another branch can never leak into the feed.
        review_ids = [item["id"] for item in items]
        rows = await self.gateway.query(
            """
            SELECT r.id AS review_id, o.order_number, o.table_name_snapshot, o.floor_name_snapshot,
                   o.created_by_name AS waiter_name, o.created_at AS order_time,
                   coalesce(oi.menu_item_id, oi.id) AS menu_item_id, oi.name_snapshot AS item_name, oi.quantity,
                   oi.price_snapshot AS item_price, ra.result AS analysis_result
            FROM private.reviews r
            JOIN private.orders o ON o.id = r.order_id
            LEFT JOIN private.order_items oi ON oi.order_id = o.id
            LEFT JOIN private.review_analyses ra ON ra.review_id = r.id
            WHERE r.id = ANY(%s::uuid[])
            ORDER BY r.created_at DESC, oi.id ASC
            """,
            (review_ids,),
        )
        by_id = {str(item["id"]): item for item in items}
        for item in items:
            item["order_items"] = []

        for row in rows:
            review = by_id.get(str(row["review_id"]))
            if not review:
                continue
            review.update({
                "order_number": row.get("order_number"),
                "table_name_snapshot": row.get("table_name_snapshot"),
                "floor_name_snapshot": row.get("floor_name_snapshot"),
                "waiter_name": row.get("waiter_name"),
                "order_time": row.get("order_time"),
                "analysis_result": row.get("analysis_result"),
            })
            if row.get("menu_item_id"):
                review["order_items"].append({
                    "menu_item_id": row["menu_item_id"],
                    "name": row["item_name"],
                    "quantity": row["quantity"],
                    "price": row.get("item_price"),
                })
        return page

    async def issue_token(self, data: dict, key: str):
        order_id = str(data.get("order_id"))
        if hasattr(self.gateway, "query_one"):
            try:
                # Check if idempotency record exists for this order
                row = await self.gateway.query_one(
                    """
                    SELECT result FROM private.idempotency_records
                    WHERE operation = 'review_token_create' AND (result->>'order_id') = %s
                    ORDER BY created_at DESC LIMIT 1
                    """,
                    (order_id,)
                )
                if row and row.get("result"):
                    return row["result"]
            except Exception:
                pass
        return await self.gateway.command("review_token_create", data, key)

    async def get_token_info(self, token: str) -> dict:
        token_clean = token.strip()
        if len(token_clean) < 32:
            return {"valid": False, "reason": "invalid_format", "message": "Invalid review token."}

        token_hash = hashlib.sha256(token_clean.encode("utf-8")).hexdigest()

        if hasattr(self.gateway, "query_one"):
            row = await self.gateway.query_one(
                """
                SELECT rt.id as token_id, rt.order_id, rt.expires_at, rt.used_at,
                       o.order_number, o.table_name_snapshot, o.floor_name_snapshot,
                       o.seats_snapshot, o.created_by_name, o.created_at as order_created_at
                FROM private.review_tokens rt
                JOIN private.orders o ON o.id = rt.order_id
                WHERE rt.token_hash = %s
                """,
                (token_hash,)
            )

            if not row:
                return {"valid": False, "reason": "not_found", "message": "Review link not found or invalid."}

            if row.get("used_at") is not None:
                return {"valid": False, "reason": "already_used", "message": "This review has already been submitted. Thank you for your feedback!"}

            exp = row.get("expires_at")
            if exp and exp <= datetime.now(timezone.utc):
                return {"valid": False, "reason": "expired", "message": "This review link has expired."}

            # Fetch dishes for this order
            order_items = await self.gateway.query(
                """
                SELECT coalesce(menu_item_id, id) AS menu_item_id,
                       name_snapshot as name, quantity, price_snapshot as price
                FROM private.order_items
                WHERE order_id = %s
                ORDER BY id ASC
                """,
                (row["order_id"],)
            )

            order_date_str = row["order_created_at"].isoformat() if hasattr(row["order_created_at"], "isoformat") else str(row["order_created_at"])

            return {
                "valid": True,
                "order_id": row["order_id"],
                "order_number": row.get("order_number") or f"SD-{str(row['order_id'])[:8]}",
                "table_name": row.get("table_name_snapshot") or "Dining Table",
                "floor_name": row.get("floor_name_snapshot") or "Dining Room",
                "seats": row.get("seats_snapshot") or 2,
                "waiter_name": row.get("created_by_name") or "Service Team",
                "created_at": order_date_str,
                "items": [
                    {
                        "menu_item_id": item["menu_item_id"],
                        "name": item["name"],
                        "quantity": item["quantity"],
                        "price": str(item.get("price") or "0.00")
                    }
                    for item in order_items
                ]
            }

        return {"valid": False, "reason": "service_unavailable", "message": "Unable to verify review token at this time."}

    async def submit(self, body):
        data = payload(body)
        raw_token = body.token.get_secret_value()
        data["token"] = raw_token

        token_info = await self.get_token_info(raw_token)
        if not token_info.get("valid"):
            raise AppError("invalid_review_token", token_info.get("message", "Invalid review token."), 422)

        purchased_ids = {str(item["menu_item_id"]) for item in token_info.get("items", [])}
        submitted_ids = [str(item.menu_item_id) for item in (body.dish_ratings or [])]
        if len(submitted_ids) != len(set(submitted_ids)):
            raise AppError("duplicate_dish_rating", "Each purchased dish can only be rated once.", 422)
        if any(item_id not in purchased_ids for item_id in submitted_ids):
            raise AppError("dish_not_purchased", "A dish rating does not belong to this receipt.", 422)

        # The database has a single immutable review record per completed order.
        # Structured ratings are embedded in the stored comment for compatibility
        # with existing installations and are rendered separately by the manager UI.
        full_comment = body.comment
        if getattr(body, "aspects", None):
            aspect_dict = body.aspects.model_dump(exclude_none=True)
            if aspect_dict:
                aspects_str = ", ".join(f"{k.replace('_', ' ').title()}: {v}★" for k, v in aspect_dict.items())
                full_comment += f"\n[Aspects: {aspects_str}]"

        if getattr(body, "dish_ratings", None):
            dish_parts = []
            for d in body.dish_ratings:
                part = f"Dish {d.menu_item_id}: {d.rating}★"
                if d.comment:
                    part += f" ({d.comment})"
                dish_parts.append(part)
            if dish_parts:
                full_comment += f"\n[Dish Ratings: {'; '.join(dish_parts)}]"

        data["comment"] = full_comment

        result = await self.gateway.service("review_submit", data)
        return {"id": result["id"], "status": "received"}
