import time
import uuid

import bcrypt
import jwt

from app.core.config import get_settings
from app.core.exceptions import AppError
from app.integrations.supabase_client import get_pool, make_gateway


class AuthService:
    def __init__(self, gateway):
        self.gateway = gateway

    async def _session_response(self, user_id: str, email: str, role: str, full_name: str, is_active: bool):
        if not is_active:
            raise AppError("inactive_account", "Account is inactive.", 403)

        settings = get_settings()
        secret = settings.jwt_secret_key.get_secret_value()
        session_id = uuid.uuid4()

        pool = await get_pool()
        async with pool.connection() as conn:
            await conn.execute(
                "INSERT INTO auth.sessions (id, user_id) VALUES (%s, %s)",
                (session_id, user_id),
            )

        now = int(time.time())
        expires_in = 3600  # 1 hour
        expires_at = now + expires_in

        access_token = jwt.encode({
            "sub": str(user_id),
            "email": email,
            "role": role,
            "session_id": str(session_id),
            "iat": now,
            "exp": expires_at,
        }, secret, algorithm="HS256")

        refresh_token = jwt.encode({
            "sub": str(user_id),
            "session_id": str(session_id),
            "type": "refresh",
            "iat": now,
            "exp": now + 30 * 86400,
        }, secret, algorithm="HS256")

        profile = {
            "id": str(user_id),
            "email": email,
            "full_name": full_name,
            "role": role,
            "is_active": is_active,
        }

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "expires_in": expires_in,
            "expires_at": expires_at,
            "user": profile,
        }

    async def login(self, body):
        pool = await get_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                "SELECT u.id, u.email, u.encrypted_password, p.role, p.full_name, p.is_active "
                "FROM auth.users u "
                "JOIN private.profiles p ON p.id = u.id "
                "WHERE lower(u.email) = lower(%s)",
                (str(body.email),),
            )
            row = await cur.fetchone()

        if not row:
            raise AppError("invalid_credentials", "Unable to sign in with these credentials.", 401)

        user_id, email, enc_password, role, full_name, is_active = row
        password_bytes = body.password.get_secret_value().encode("utf-8")
        hash_bytes = enc_password.encode("utf-8")

        try:
            valid = bcrypt.checkpw(password_bytes, hash_bytes)
        except Exception:
            valid = False

        if not valid:
            raise AppError("invalid_credentials", "Unable to sign in with these credentials.", 401)

        return await self._session_response(str(user_id), email, role, full_name, is_active)

    async def refresh(self, body):
        settings = get_settings()
        secret = settings.jwt_secret_key.get_secret_value()
