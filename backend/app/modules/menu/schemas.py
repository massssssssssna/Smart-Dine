from pydantic import Field
from app.modules.common import Money, RequestModel, Version


class MenuCreate(RequestModel):
    name: str = Field(min_length=1, max_length=120)
    category: str = Field(min_length=1, max_length=80)
    selling_price: Money
    packaging_cost: Money = 0
    is_active: bool = True


class MenuUpdate(MenuCreate):
    expected_version: Version
