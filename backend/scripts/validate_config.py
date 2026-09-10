"""Report configuration and optional live checks without exposing secrets."""
import argparse
import asyncio
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from app.core.config import get_settings
from app.integrations.supabase_client import close_pool, make_gateway


async def inspect(live: bool):
    settings = get_settings()
    result = {
        "configuration": settings.capabilities(),
        "timezone": settings.app_timezone,
        "currency": settings.currency,
        "live": {},
    }
    if live:
        if settings.capabilities()["database"]:
            gateway = await make_gateway(admin=True)
            try:
                result["live"]["database"] = await gateway.service("health")
            except Exception as exc:
                result["live"]["database"] = {"status": "failed", "error_type": type(exc).__name__, "error": str(exc)}
            finally:
                await gateway.close()
                await close_pool()
