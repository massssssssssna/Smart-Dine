from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID
from pydantic import Field, model_validator
from app.modules.common import RequestModel, UnitCost, Version


class StockProductCreate(RequestModel):
    name: str = Field(min_length=1, max_length=120)
    selling_price: Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=2)]
    quantity: int = Field(default=0, ge=0, le=1000000)
    reorder_level: int = Field(default=5, ge=0, le=1000000)
    unit_cost: UnitCost | None = None


class StockMovement(RequestModel):
    quantity: int = Field(gt=0, le=1000000)
    unit_cost: UnitCost | None = None
    reason: str = Field(default='', max_length=1000)


class IngredientCreate(RequestModel):
    name: str = Field(min_length=1, max_length=120)
    unit: Literal["g", "ml", "piece"]
    reorder_level: Annotated[Decimal, Field(ge=0, max_digits=18, decimal_places=6)] = Decimal("0")
