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
