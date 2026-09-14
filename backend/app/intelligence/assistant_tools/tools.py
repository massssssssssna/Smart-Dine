"""A finite capability list; arguments cannot select SQL, roles or arbitrary tables."""

import copy
import json

from app.core.exceptions import AppError
from app.modules.assistant.schemas import AssistantAnswer

RESOURCE_MAP = {
    "sales_and_margins": "analytics", "inventory_status": "inventory",
    "customer_reviews": "reviews", "demand_forecasts": "forecasts",
    "operating_expenses": "expenses",
    "menu_catalog": "menu", "recent_orders": "orders",
    "manager_recommendations": "recommendations",
    "staff_roster": "users",
}
TOOL_DESCRIPTIONS = {
    "sales_and_margins": "Sales, revenue, costs, and margin figures for the selected period.",
    "inventory_status": (
        "Current ingredient stock levels with pre-computed stock status. "
        "Each item includes is_low_stock (true/false) and stock_status "
        "(OUT_OF_STOCK, LOW_STOCK, HEALTHY) computed from the manager's "
        "configured reorder threshold. ONLY report items where "
        "is_low_stock is true as needing attention."
    ),
    "customer_reviews": "Verified customer ratings and comments for the selected period.",
    "demand_forecasts": "Recorded demand forecasts and their training cutoffs.",
    "operating_expenses": "Recorded operating expenses for the selected period.",
    "menu_catalog": "Current and recently added dishes, prices, categories, and availability.",
    "recent_orders": "Most recent restaurant orders, items, tables, staff attribution, and status.",
    "manager_recommendations": "Current recorded manager recommendations and their status.",
    "staff_roster": (
        "Overview of restaurant employees: full names, roles "
        "(cashier, kitchen, waiter, manager), active status, and join dates."
    ),
}
TOOL_DEFINITIONS = [{"type": "function", "function": {
    "name": name,
    "description": TOOL_DESCRIPTIONS[name],
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


def _enrich_inventory(result: dict) -> dict:
    """Add pre-computed stock status so the LLM never needs to compare numbers itself."""
    if not isinstance(result, dict):
        return result
    items = result.get("items", [])
    if not isinstance(items, list):
        return result
    enriched = []
    summary = {"out_of_stock": 0, "low_stock": 0, "healthy": 0, "total_active": 0}
    for item in items:
        if not isinstance(item, dict):
            enriched.append(item)
            continue
        if item.get("is_active") is False:
            continue
        qty = float(item.get("stock_quantity", 0))
        reorder = float(item.get("reorder_level", 0))
        if qty == 0:
            status, is_low = "OUT_OF_STOCK", True
        elif reorder > 0 and qty <= reorder:
            status, is_low = "LOW_STOCK", True
        else:
            status, is_low = "HEALTHY", False
        item["stock_status"] = status
        item["is_low_stock"] = is_low
        if is_low and reorder > 0:
            item["units_below_reorder"] = max(0, reorder - qty)
        enriched.append(item)
        summary["total_active"] += 1
        if status == "OUT_OF_STOCK":
            summary["out_of_stock"] += 1
        elif status == "LOW_STOCK":
            summary["low_stock"] += 1
        else:
            summary["healthy"] += 1
    result["items"] = enriched
    result["total"] = len(enriched)
    result["stock_summary"] = summary
    result["threshold_note"] = (
        "Each item has a manager-configured reorder_level. "
        "is_low_stock=true means stock_quantity <= reorder_level. "
        "Only report items where is_low_stock is true as needing attention. "
        "Items where is_low_stock is false are HEALTHY and must NOT be reported as low stock."
    )
    return result


def _enrich_staff_roster(result: dict) -> dict:
    """Project safe managerial fields and add a team summary."""
    if not isinstance(result, dict):
        return result
    items = result.get("items", [])
    if not isinstance(items, list):
        return result
    safe_items = []
    role_counts: dict[str, int] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        safe = {
            "full_name": item.get("full_name"),
            "email": item.get("email"),
            "role": item.get("role"),
            "staff_type": item.get("staff_type"),
            "is_active": item.get("is_active"),
            "joined": item.get("created_at"),
        }
        safe_items.append(safe)
        if safe.get("is_active"):
            label = safe.get("staff_type", "unknown") if safe.get("role") == "staff" else "manager"
            role_counts[label] = role_counts.get(label, 0) + 1
    result["items"] = safe_items
    result["total"] = len(safe_items)
    result["team_summary"] = {
        "total_active": sum(1 for i in safe_items if i.get("is_active")),
        "total_inactive": sum(1 for i in safe_items if not i.get("is_active")),
        "by_role": role_counts,
    }
    return result


async def execute_read_tool(name: str, arguments: dict, gateway, period: dict) -> dict:
    if name not in RESOURCE_MAP or arguments != {}:
        raise AppError("invalid_ai_tool", "Assistant requested an unsupported tool or arguments", 502)
    params = {"limit": 100, "offset": 0}
    if name in {"sales_and_margins", "customer_reviews", "operating_expenses"}:
        params.update(period)
    result = bounded_result(await gateway.read(RESOURCE_MAP[name], params))
    if name == "inventory_status":
        result = _enrich_inventory(result)
    elif name == "staff_roster":
        result = _enrich_staff_roster(result)
    temporal_scope = (
        "Current inventory snapshot; historical stock levels cannot be inferred."
        if name == "inventory_status" else
        "Recorded forecast runs; each record has its own training cutoff and target month."
        if name == "demand_forecasts" else
        "Current database snapshot; new and updated records are visible on the next question."
        if name in {"menu_catalog", "recent_orders", "manager_recommendations", "staff_roster"} else
        "Selected reporting period, inclusive, Asia/Karachi."
    )
    return {"tool": name, "period": period, "data": result, "temporal_scope": temporal_scope,
            "scope_note": "List tools include at most 100 records; inspect total before drawing population-wide conclusions."}


def validate_citations(content: str, evidence: list[dict]) -> AssistantAnswer:
    answer = AssistantAnswer.model_validate_json(content)
    allowed = {entry["id"] for entry in evidence}
    normalized = []
    for value in answer.evidence_ids:
        match = __import__("re").search(r"E\d+", value)
        if not match:
            raise ValueError("Assistant returned an invalid evidence reference")
        normalized.append(match.group(0))
    answer.evidence_ids = normalized
    if not set(answer.evidence_ids).issubset(allowed):
        raise ValueError("Assistant cited evidence that was not produced by its tools")
    return answer
