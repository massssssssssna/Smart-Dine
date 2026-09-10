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


async def execute_read_tool(name: str, arguments: dict, gateway, period: dict) -> dict:
    if name not in RESOURCE_MAP or arguments != {}:
        raise AppError("invalid_ai_tool", "Assistant requested an unsupported tool or arguments", 502)
    result = bounded_result(await gateway.read(RESOURCE_MAP[name], {**period, "limit": 100, "offset": 0}))
    temporal_scope = (
        "Current inventory snapshot; historical stock levels cannot be inferred."
        if name == "inventory_status" else
        "Recorded forecast runs; each record has its own training cutoff and target month."
        if name == "demand_forecasts" else
        "Selected reporting period, inclusive, Asia/Karachi."
    )
    return {"tool": name, "period": period, "data": result, "temporal_scope": temporal_scope,
            "scope_note": "List tools include at most 100 records; inspect total before drawing population-wide conclusions."}


def validate_citations(content: str, evidence: list[dict]) -> AssistantAnswer:
    answer = AssistantAnswer.model_validate_json(content)
    allowed = {entry["id"] for entry in evidence}
    if not set(answer.evidence_ids).issubset(allowed):
        raise ValueError("Assistant cited evidence that was not produced by its tools")
    return answer
