"""Run with python -m app.jobs.worker; all ownership decisions live in PostgreSQL."""

import asyncio
import contextlib
import logging
import signal

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.integrations.supabase_client import close_pool, make_gateway
from .handlers import handle_job

logger = logging.getLogger(__name__)


async def process_job(job: dict, gateway, lease_seconds: int, handler=handle_job):
    ownership = {"job_id": job["id"], "owner_token": job["owner_token"]}
    lost = asyncio.Event()

    async def heartbeat():
        while True:
            await asyncio.sleep(max(1, lease_seconds / 3))
            try:
                result = await gateway.service("job_heartbeat", {**ownership, "lease_seconds": lease_seconds})
                if not result["renewed"]:
                    lost.set()
                    return
            except Exception:
                # Uncertain ownership never permits a result write from this worker.
                lost.set()
                return

    pulse = asyncio.create_task(heartbeat())
    try:
        result = await handler(job, gateway)
        if not lost.is_set():
            await gateway.service("job_complete", {**ownership, "result": result})
    except Exception as exc:
        logger.warning("Job failed", extra={"job_id": job["id"], "error_type": type(exc).__name__})
        if not lost.is_set():
            with contextlib.suppress(Exception):
                await gateway.service("job_fail", {**ownership, "error_code": type(exc).__name__})
    finally:
        pulse.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await pulse


async def run_worker(stop: asyncio.Event | None = None):
    settings = get_settings()
    stop = stop or asyncio.Event()
    gateway = await make_gateway(admin=True)
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(sig, stop.set)
    try:
        while not stop.is_set():
            try:
                job = await gateway.service("job_claim", {"lease_seconds": settings.job_lease_seconds})
                if job:
                    await process_job(job, gateway, settings.job_lease_seconds)
                    continue
            except Exception as exc:
                logger.warning("Worker polling failed", extra={"error_type": type(exc).__name__})
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(stop.wait(), timeout=settings.job_poll_seconds)
    finally:
        await gateway.close()
        await close_pool()


if __name__ == "__main__":
    configure_logging()
    asyncio.run(run_worker())
