import json
import uuid

import bcrypt

from app.core.exceptions import AppError
from app.integrations.supabase_client import get_pool


class UserService:
    def __init__(self, gateway, admin_gateway=None):
        self.gateway, self.admin = gateway, admin_gateway

    async def read(self, params):
        return await self.gateway.read("users", params)

    async def update(self, data, key):
        return await self.gateway.command("user_update", data, key)

    async def delete(self, user_id):
        return await self.gateway._rpc("public.sd_delete_staff", str(user_id))

    async def _recheck_manager(self, actor):
        if self.gateway:
            profile = await self.gateway.read("me")
            if str(profile.get("id")) != str(actor.id) or profile.get("role") != "manager" or not profile.get("is_active"):
                raise AppError("manager_required", "Active manager access is required.", 403)

    async def create(self, actor, body, key):
        await self._recheck_manager(actor)
        reservation = await self.admin.service("reserve_user", {
            "actor_id": str(actor.id), "email": str(body.email).casefold(),
            "full_name": body.full_name, "role": body.role, "request_key": key,
            "staff_type": body.staff_type,
        })
        provision_id = reservation["id"]
        if reservation.get("status") == "active":
            return await self.gateway.read("users", {"id": reservation["user_id"]})

        pool = await get_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                "SELECT id, raw_app_meta_data FROM auth.users WHERE lower(email) = lower(%s)",
                (str(body.email),),
            )
            existing = await cur.fetchone()

        if existing:
            meta = existing[1] or {}
            if meta.get("managed_account") is True and meta.get("provision_id") == str(provision_id):
                user_id = str(existing[0])
            else:
                raise AppError("account_exists", "An account already exists for this email.", 409)
        else:
            await self._recheck_manager(actor)
            user_id = str(uuid.uuid4())
            pw_hash = bcrypt.hashpw(body.password.get_secret_value().encode("utf-8"), bcrypt.gensalt(12)).decode("utf-8")
            async with pool.connection() as conn:
                await conn.execute(
                    "INSERT INTO auth.users (id, email, encrypted_password, raw_app_meta_data, raw_user_meta_data) "
                    "VALUES (%s, lower(%s), %s, %s::jsonb, %s::jsonb)",
                    (
                        user_id,
                        str(body.email),
                        pw_hash,
                        json.dumps({"managed_account": True, "provision_id": str(provision_id)}),
                        json.dumps({"full_name": body.full_name}),
                    ),
                )

        return await self.admin.service("activate_user", {
            "actor_id": str(actor.id), "provision_id": str(provision_id), "user_id": str(user_id),
        })

    async def credentials(self, actor, user_id, body):
        await self._recheck_manager(actor)
        target = await self.gateway.read("users", {"id": str(user_id)})
        if target["role"] != "staff":
            raise AppError("staff_only", "Only branch staff accounts can be managed here.", 403)

        if body.email is None and body.password is None:
            raise AppError("empty_change", "Enter an email or password.", 422)

        pool = await get_pool()
        async with pool.connection() as conn:
            async with conn.transaction():
                cur = await conn.execute(
                    "SELECT t.id FROM private.profiles t JOIN private.profiles a ON a.branch_id=t.branch_id "
                    "WHERE a.id=%s AND a.role='manager' AND a.is_active AND t.id=%s AND t.role='staff' "
                    "FOR UPDATE OF a,t", (str(actor.id), str(user_id)),
                )
                if not await cur.fetchone():
                    raise AppError("staff_only", "Only your branch staff can be managed.", 403)
                await conn.execute("SELECT set_config('app.branch_id', (SELECT branch_id::text FROM private.profiles WHERE id=%s), true)", (str(actor.id),))
                if body.email is not None:
                    cur = await conn.execute(
                        "SELECT 1 FROM auth.users WHERE lower(email) = lower(%s) AND id <> %s",
                        (str(body.email), str(user_id)),
                    )
                    if await cur.fetchone():
                        raise AppError("account_update_failed", "Account update failed; check email availability and password requirements.", 400)
                    await conn.execute("UPDATE auth.users SET email = lower(%s) WHERE id = %s", (str(body.email), str(user_id)))
                    await conn.execute("UPDATE private.profiles SET email = lower(%s) WHERE id = %s", (str(body.email), str(user_id)))

                if body.password is not None:
                    pw_hash = bcrypt.hashpw(body.password.get_secret_value().encode("utf-8"), bcrypt.gensalt(12)).decode("utf-8")
                    await conn.execute("UPDATE auth.users SET encrypted_password = %s WHERE id = %s", (pw_hash, str(user_id)))

                await conn.execute("DELETE FROM auth.sessions WHERE user_id = %s", (str(user_id),))

        return {"status": "updated", "sign_in_required": True}

    async def staff_ledger(self, actor):
        await self._recheck_manager(actor)
        pool = await get_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                "SELECT branch_id FROM private.profiles WHERE id = %s", (str(actor.id),)
            )
            b_row = await cur.fetchone()
            if not b_row or not b_row[0]:
                return {"items": [], "total": 0}
            branch_id = str(b_row[0])

            cur = await conn.execute(
                """
                SELECT id::text, full_name, email, role, staff_type, is_active, created_at
                FROM private.profiles
                WHERE branch_id = %s AND role = 'staff'
                ORDER BY created_at ASC
                """,
                (branch_id,),
            )
            active_profiles = await cur.fetchall()

            cur = await conn.execute(
                """
                SELECT 
                    id::text, created_by::text, coalesce(created_by_name, ''), coalesce(created_by_email, ''),
                    prepared_by::text, coalesce(prepared_by_name, ''), coalesce(prepared_by_email, ''),
                    paid_by::text, coalesce(paid_by_name, ''), coalesce(paid_by_email, ''),
                    ((select coalesce(sum(quantity * price_snapshot), 0) from private.order_items oi where oi.order_id = orders.id) - orders.discount + orders.tax) as total,
                    created_at, completed_at
                FROM private.orders
                WHERE branch_id = %s
                ORDER BY created_at ASC
                """,
                (branch_id,),
            )
            orders = await cur.fetchall()

        ledger: dict[str, dict] = {}

        # 1. Seed with known active profiles
        for p in active_profiles:
            email_key = p[2].casefold()
            ledger[email_key] = {
                "id": p[0],
                "full_name": p[1],
                "email": p[2],
                "staff_type": p[4] or "waiter",
                "is_active": bool(p[5]),
                "first_action_at": p[6],
                "last_action_at": p[6],
                "orders_count": 0,
                "orders_created": 0,
                "orders_prepared": 0,
                "orders_paid": 0,
                "total_sales_cents": 0,
            }

        # 2. Iterate orders and attribute metrics to waiters, chefs, and cashiers
        for o in orders:
            order_total_cents = int(round(float(o[10] or 0) * 100))
            order_time = o[11]

            # Waiter attribution
            w_email = (o[3] or "").strip()
            w_name = (o[2] or "").strip()
            if w_email:
                w_key = w_email.casefold()
                if w_key not in ledger:
                    ledger[w_key] = {
                        "id": o[1] or w_key,
                        "full_name": w_name or w_email,
                        "email": w_email,
                        "staff_type": "waiter",
                        "is_active": False,
                        "first_action_at": order_time,
                        "last_action_at": order_time,
                        "orders_count": 0,
                        "orders_created": 0,
                        "orders_prepared": 0,
                        "orders_paid": 0,
                        "total_sales_cents": 0,
                    }
                rec = ledger[w_key]
                rec["orders_created"] += 1
                rec["orders_count"] += 1
                rec["total_sales_cents"] += order_total_cents
                if order_time < rec["first_action_at"]:
                    rec["first_action_at"] = order_time
                if order_time > rec["last_action_at"]:
                    rec["last_action_at"] = order_time

            # Chef attribution
            c_email = (o[6] or "").strip()
            c_name = (o[5] or "").strip()
            if c_email:
                c_key = c_email.casefold()
                if c_key not in ledger:
                    ledger[c_key] = {
                        "id": o[4] or c_key,
                        "full_name": c_name or c_email,
                        "email": c_email,
                        "staff_type": "kitchen",
                        "is_active": False,
                        "first_action_at": order_time,
                        "last_action_at": order_time,
                        "orders_count": 0,
                        "orders_created": 0,
                        "orders_prepared": 0,
                        "orders_paid": 0,
                        "total_sales_cents": 0,
                    }
                rec = ledger[c_key]
                rec["orders_prepared"] += 1
                rec["orders_count"] += 1
                if order_time < rec["first_action_at"]:
                    rec["first_action_at"] = order_time
                if order_time > rec["last_action_at"]:
                    rec["last_action_at"] = order_time

            # Cashier attribution
            k_email = (o[9] or "").strip()
            k_name = (o[8] or "").strip()
            if k_email:
                k_key = k_email.casefold()
                if k_key not in ledger:
                    ledger[k_key] = {
                        "id": o[7] or k_key,
                        "full_name": k_name or k_email,
                        "email": k_email,
                        "staff_type": "cashier",
                        "is_active": False,
                        "first_action_at": order_time,
                        "last_action_at": order_time,
                        "orders_count": 0,
                        "orders_created": 0,
                        "orders_prepared": 0,
                        "orders_paid": 0,
                        "total_sales_cents": 0,
                    }
                rec = ledger[k_key]
                rec["orders_paid"] += 1
                rec["orders_count"] += 1
                rec["total_sales_cents"] += order_total_cents
                if order_time < rec["first_action_at"]:
                    rec["first_action_at"] = order_time
                if order_time > rec["last_action_at"]:
                    rec["last_action_at"] = order_time

        # Format items for UI output
        items = []
        for rec in ledger.values():
            first_dt = rec["first_action_at"]
            last_dt = rec["last_action_at"]
            days = max(1, (last_dt - first_dt).days)
            months = max(1, int(round(days / 30.0)))
            f_str = first_dt.strftime("%b %Y")
            l_str = last_dt.strftime("%b %Y")
            
            if rec["is_active"]:
                tenure_label = f"Active {months} mo (since {f_str})" if months > 1 else f"Active (joined {f_str})"
            else:
                tenure_label = f"{months} mo ({f_str} – {l_str})" if f_str != l_str else f"1 mo ({f_str})"

            items.append({
                "id": str(rec["id"]),
                "full_name": rec["full_name"],
                "email": rec["email"],
                "staff_type": rec["staff_type"],
                "is_active": rec["is_active"],
                "first_action_at": first_dt.isoformat(),
                "last_action_at": last_dt.isoformat(),
                "tenure_months": months,
                "tenure_label": tenure_label,
                "orders_count": rec["orders_count"],
                "orders_created": rec["orders_created"],
                "orders_prepared": rec["orders_prepared"],
                "orders_paid": rec["orders_paid"],
                "total_sales": f"{rec['total_sales_cents'] / 100:.2f}",
            })

        items.sort(key=lambda x: (not x["is_active"], -x["orders_count"], x["full_name"]))
        return {"items": items, "total": len(items)}
