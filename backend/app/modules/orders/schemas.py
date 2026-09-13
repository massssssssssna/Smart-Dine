from typing import Literal
from uuid import UUID
from pydantic import Field, model_validator
from app.modules.common import Money, RequestModel, Version, Versioned


class OrderLine(RequestModel):
    menu_item_id: UUID
    quantity: int = Field(ge=1, le=1000)


class OrderCreate(RequestModel):
    table_id: UUID | None = None
    items: list[OrderLine] = Field(min_length=1, max_length=100)
    discount: Money = 0
    platform_fee: Money = 0
    delivery_cost: Money = 0
    tax: Money = 0
    notes: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def distinct_items(self):
        if len({i.menu_item_id for i in self.items}) != len(self.items):
            raise ValueError("Combine quantities for duplicate menu items.")
        return self


class OrderUpdate(OrderCreate):
    expected_version: Version


class OrderTransition(Versioned):
    status: Literal["preparing", "ready", "completed", "cancelled"]
    reason: str | None = Field(default=None, min_length=3, max_length=1000)

    @model_validator(mode="after")
    def cancellation_reason(self):
        if self.status == "cancelled" and not self.reason:
            raise ValueError("A cancellation reason is required.")
        return self


class OrderPayment(Versioned):
    cash_received: Money
    discount: Money = 0
    discount_percent: float | None = Field(default=None, ge=0.0, le=100.0)
    discount_reason: str | None = Field(default=None, max_length=200)
