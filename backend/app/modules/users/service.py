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
