"""Interactively provision the first manager. Never prints or saves passwords."""
import asyncio
from getpass import getpass
import json
from pathlib import Path
import sys
import uuid

import bcrypt

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from app.core.exceptions import AppError
from app.integrations.supabase_client import close_pool, get_pool, make_gateway


async def bootstrap(email: str, full_name: str, password: str):
    gateway = await make_gateway(admin=True)
    pool = await get_pool()
    try:
        async with pool.connection() as conn:
            cur = await conn.execute(
                "SELECT id, raw_app_meta_data FROM auth.users WHERE lower(email) = lower(%s)",
                (email,),
            )
            existing = await cur.fetchone()

        if existing:
            meta = existing[1] or {}
            if not meta.get("managed_account"):
                raise AppError("unmanaged_account", "This email belongs to an unmanaged account; use a new email.", 409)
            user_id = str(existing[0])
        else:
            user_id = str(uuid.uuid4())
            pw_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(12)).decode("utf-8")
            async with pool.connection() as conn:
                await conn.execute(
                    "INSERT INTO auth.users (id, email, encrypted_password, raw_app_meta_data, raw_user_meta_data) "
                    "VALUES (%s, lower(%s), %s, %s::jsonb, %s::jsonb)",
                    (
                        user_id,
                        email,
                        pw_hash,
                        json.dumps({"managed_account": True}),
                        json.dumps({"full_name": full_name}),
                    ),
                )

        result = await gateway.service("bootstrap_manager", {"user_id": user_id, "full_name": full_name})
        print(f"Manager activated: {result['email']}")
    finally:
        await gateway.close()
        await close_pool()


def main():
    email = input("First manager email: ").strip().lower()
    name = input("Full name: ").strip()
    password = getpass("Password (minimum 12 characters; never saved): ")
    confirm = getpass("Confirm password: ")
    if "@" not in email or not name or len(password) < 12 or password != confirm:
        raise SystemExit("Check the email, name and matching passwords (12+ characters).")
    try:
        asyncio.run(bootstrap(email, name, password))
    except AppError as exc:
        raise SystemExit(f"{exc.code}: {exc.message}") from None
    except Exception as exc:
        raise SystemExit(f"Bootstrap failed ({type(exc).__name__}): {exc}. Check configuration; retry safely.") from None


if __name__ == "__main__":
    main()
