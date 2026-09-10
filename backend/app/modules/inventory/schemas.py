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


class IngredientUpdate(IngredientCreate):
    expected_version: Version


class InventoryRecord(RequestModel):
    ingredient_id: UUID
    kind: Literal["purchase", "wastage", "adjustment"]
    quantity: Annotated[Decimal, Field(max_digits=18, decimal_places=6)]
    unit_cost: UnitCost | None = None
    reason: str = Field(min_length=3, max_length=1000)

    @model_validator(mode="after")
    def valid_transaction(self):
        if self.quantity == 0:
            raise ValueError("Quantity cannot be zero.")
        if self.kind in {"purchase", "wastage"} and self.quantity < 0:
            raise ValueError("Purchase/wastage quantity is positive; the ledger chooses its sign.")
        if self.kind == "purchase" and self.unit_cost is None:
            raise ValueError("Purchase requires unit_cost.")
        if self.kind != "purchase" and self.unit_cost is not None:
            raise ValueError("Only purchases accept unit_cost; adjustments use current weighted cost.")
        return self
