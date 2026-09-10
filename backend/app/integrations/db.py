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
