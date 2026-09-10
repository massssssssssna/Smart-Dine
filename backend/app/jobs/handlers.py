import asyncio
from datetime import date

from app.core.config import get_settings
from app.intelligence.forecasting import forecast_item
from app.intelligence.review_analysis import analyze_review


async def handle_job(job: dict, gateway) -> dict:
    settings = get_settings()
    if job["kind"] == "review_analysis":
        review = await gateway.service("review_analysis_input", {"review_id": job["payload"]["review_id"]})
        return await analyze_review(
            review["comment"], api_key=settings.groq_api_key.get_secret_value(), model=settings.groq_review_model,
            timeout=settings.groq_timeout_seconds,
        )
    if job["kind"] == "forecast":
        item_id = job["payload"]["menu_item_id"]
        inputs = await gateway.service("forecast_input", {"menu_item_id": item_id, "as_of": job["payload"]["as_of"]})
        # CPU-bound fits must not block the worker heartbeat event loop.
        return await asyncio.to_thread(forecast_item, item_id, inputs["rows"], date.fromisoformat(job["payload"]["as_of"]))
    raise ValueError("Unsupported job kind")
