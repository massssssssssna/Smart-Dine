import json
import logging
import sys
from typing import Any

if sys.platform == "win32":
    import asyncio
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import jwt
from psycopg import Error as PsycopgError, OperationalError
from psycopg_pool import AsyncConnectionPool
from pydantic_core import to_jsonable_python

from app.core.config import get_settings
from app.core.exceptions import AppError

logger = logging.getLogger(__name__)

_pool: AsyncConnectionPool | None = None


async def get_pool() -> AsyncConnectionPool:
    global _pool
    if _pool is None:
        settings = get_settings()
        dsn = settings.database_url.get_secret_value()
        if not dsn:
            raise AppError("configuration_required", "Configure DATABASE_URL before using this endpoint.", 503)
        _pool = AsyncConnectionPool(conninfo=dsn, min_size=2, max_size=20, open=False)
        await _pool.open()
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


class Gateway:
    def __init__(self, claims: dict | None = None, is_admin: bool = False, access_token: str | None = None):
        self.claims = claims
        self.is_admin = is_admin
        self.access_token = access_token

    async def _rpc(self, function_name: str, *args) -> Any:
        pool = await get_pool()
        try:
            async with pool.connection() as conn:
                async with conn.transaction():
                    if self.claims:
                        await conn.execute(
                            "SELECT set_config('request.jwt.claims', %s, true)",
                            (json.dumps(self.claims),),
                        )
                    elif self.is_admin:
                        await conn.execute(
                            "SELECT set_config('request.jwt.claims', %s, true)",
                            (json.dumps({"role": "service_role"}),),
                        )

                    if len(args) == 1:
                        cur = await conn.execute(f"SELECT {function_name}(%s)", (args[0],))
                    elif len(args) == 2:
                        cur = await conn.execute(
                            f"SELECT {function_name}(%s, %s::jsonb)",
                            (args[0], json.dumps(args[1])),
                        )
                    elif len(args) == 3:
                        cur = await conn.execute(
                            f"SELECT {function_name}(%s, %s::jsonb, %s)",
                            (args[0], json.dumps(args[1]), args[2]),
                        )
                    else:
                        cur = await conn.execute(f"SELECT {function_name}()")

                    row = await cur.fetchone()
                    return row[0] if row else None

        except PsycopgError as exc:
            code = str(exc.sqlstate) if exc.sqlstate else "500"
            status = {
                "42501": 403, "P0002": 404, "23505": 409, "40001": 409,
                "22023": 422, "23514": 422, "23503": 422, "23502": 422,
                "22003": 422, "22P02": 422, "PGRST301": 401, "PGRST302": 401,
            }.get(code, 502)
            messages = {
                403: "This operation is not permitted.",
                404: "Record not found.",
                409: "Conflict: refresh the record or check the idempotency key.",
                422: "Request violates a business rule.",
                401: "Invalid or expired session.",
                502: "Database operation could not be completed.",
            }
            diag_msg = exc.diag.message_primary if hasattr(exc, "diag") and exc.diag and exc.diag.message_primary else str(exc)
            if code == "42501" and "session" in diag_msg.lower():
                status = 401
            safe_message = diag_msg if code in {"22023", "P0002", "40001"} else messages[status]
            raise AppError(code, safe_message, status) from None

        except (OperationalError, OSError):
            raise AppError("database_unavailable", "Database is temporarily unavailable.", 503) from None

    async def read(self, resource: str, params: dict | None = None) -> Any:
        return await self._rpc("public.sd_read", resource, to_jsonable_python(params or {}))

    async def command(self, operation: str, payload: dict, idempotency_key: str) -> Any:
        return await self._rpc("public.sd_command", operation, to_jsonable_python(payload), idempotency_key)

    async def service(self, operation: str, payload: dict | None = None) -> Any:
        return await self._rpc("public.sd_service", operation, to_jsonable_python(payload or {}))

    async def close(self) -> None:
        pass


async def make_gateway(access_token: str | None = None, admin: bool = False) -> Gateway:
    settings = get_settings()
    if not settings.database_url.get_secret_value():
        raise AppError("configuration_required", "Configure DATABASE_URL before using this endpoint.", 503)

    if admin:
        return Gateway(claims={"role": "service_role"}, is_admin=True)

    if access_token:
        try:
            secret = settings.jwt_secret_key.get_secret_value()
            claims = jwt.decode(access_token, secret, algorithms=["HS256"])
            user_claims = {
                "sub": claims.get("sub"),
                "role": claims.get("role"),
                "session_id": claims.get("session_id"),
            }
            return Gateway(claims=user_claims, is_admin=False, access_token=access_token)
        except jwt.PyJWTError:
            raise AppError("invalid_session", "Invalid or expired session.", 401) from None

    return Gateway()
