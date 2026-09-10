"""Shared request contracts, without bypassing database authorization."""
from datetime import date
from decimal import Decimal
from typing import Annotated, Any
from uuid import UUID

from fastapi import Depends, Header, Query
from pydantic import BaseModel, ConfigDict, Field

from app.api.dependencies import get_actor, get_gateway, require_manager
from app.core.exceptions import AppError
from app.integrations.supabase_client import Gateway


class RequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, validate_default=True)


Money = Annotated[Decimal, Field(ge=0, max_digits=14, decimal_places=2)]
PositiveMoney = Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=2)]
Quantity = Annotated[Decimal, Field(gt=0, max_digits=18, decimal_places=6)]
UnitCost = Annotated[Decimal, Field(ge=0, max_digits=18, decimal_places=8)]
Version = Annotated[int, Field(ge=1)]
GatewayDep = Annotated[Gateway, Depends(get_gateway)]
ActorDep = Annotated[Any, Depends(get_actor)]
ManagerDep = Annotated[Any, Depends(require_manager)]
IdempotencyKey = Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")]


class Versioned(RequestModel):
    expected_version: Version


class ReasonedVersion(Versioned):
    reason: str = Field(min_length=3, max_length=1000)


def pagination(
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0, le=100000)] = 0,
) -> dict:
    return {"limit": limit, "offset": offset}


PageDep = Annotated[dict, Depends(pagination)]


def date_range(
    start_date: date,
    end_date: date,
) -> dict:
    if end_date < start_date:
        raise AppError("invalid_date_range", "End date must be on or after start date.", 422)
    if (end_date - start_date).days > 366:
        raise AppError("invalid_date_range", "Select a reporting period of at most 367 days.", 422)
    return {"start_date": start_date.isoformat(), "end_date": end_date.isoformat()}


DateRangeDep = Annotated[dict, Depends(date_range)]


def payload(model: BaseModel, entity_id: UUID | None = None) -> dict:
    result = model.model_dump(mode="json", exclude_none=True)
    if entity_id is not None:
        result["id"] = str(entity_id)
    return result


_FINANCIAL_KEYS = frozenset({
    "average_cost", "unit_cost", "cost", "cost_snapshot", "ingredient_cost_snapshot",
    "packaging_cost", "packaging_cost_snapshot", "discount_allocated", "fee_allocated",
    "ingredient_cost", "ingredient_cost_total", "direct_cost", "direct_costs",
    "contribution", "contribution_margin", "contribution_percentage", "margin",
    "margin_percentage", "operating_profit", "consumption_snapshots", "cost_breakdown",
    "loss_amount", "loss_value", "total_cost", "inventory_value",
})


def operational_response(value: Any, role: str) -> Any:
    """Defence in depth; SQL must independently return authorized projections."""
    if role == "manager":
        return value
    if isinstance(value, dict):
        return {key: operational_response(item, role) for key, item in value.items() if key not in _FINANCIAL_KEYS}
    if isinstance(value, list):
        return [operational_response(item, role) for item in value]
    return value
