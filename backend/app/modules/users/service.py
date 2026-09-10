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
