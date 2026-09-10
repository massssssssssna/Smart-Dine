"""A finite capability list; arguments cannot select SQL, roles or arbitrary tables."""

import copy
import json

from app.core.exceptions import AppError
from app.modules.assistant.schemas import AssistantAnswer

RESOURCE_MAP = {
    "sales_and_margins": "analytics", "inventory_status": "inventory",
    "customer_reviews": "reviews", "demand_forecasts": "forecasts",
    "operating_expenses": "expenses",
}
TOOL_DEFINITIONS = [{"type": "function", "function": {
    "name": name,
    "description": f"Read restaurant {name.replace('_', ' ')} for the server-selected reporting period.",
    "parameters": {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
}} for name in RESOURCE_MAP]


def bounded_result(result: dict, max_chars: int = 24000) -> dict:
    """Bound the exact audited snapshot before it is sent to the model."""
    data = copy.deepcopy(result)
    if isinstance(data, dict) and isinstance(data.get("items"), list):
        original_count = len(data["items"])
        while data["items"] and len(json.dumps(data, default=str, ensure_ascii=False)) > max_chars:
            data["items"].pop()
        if len(data["items"]) != original_count:
            data["truncated_for_context"] = True
            data["included_records"] = len(data["items"])
            data["omitted_records"] = original_count - len(data["items"])
    if len(json.dumps(data, default=str, ensure_ascii=False)) > max_chars:
        raise AppError("evidence_too_large", "Evidence exceeds the assistant context budget", 502)
    return data
