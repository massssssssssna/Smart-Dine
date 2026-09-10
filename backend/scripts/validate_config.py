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

        if settings.capabilities()["groq"]:
            try:
                from app.integrations.groq_client import make_groq_client
                async with make_groq_client() as client:
                    models = {model.id for model in (await client.models.list()).data}
                    result["live"]["groq_models"] = {
                        settings.groq_assistant_model: settings.groq_assistant_model in models,
                        settings.groq_review_model: settings.groq_review_model in models,
                    }
            except Exception as exc:
                result["live"]["groq_models"] = {"status": "failed", "error_type": type(exc).__name__}

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true", help="Read-only connection and model-availability checks")
    asyncio.run(inspect(parser.parse_args().live))
