from datetime import date
from typing import Literal
from pydantic import Field
from app.modules.common import PositiveMoney, RequestModel


class ExpenseCreate(RequestModel):
    category: Literal["rent", "salaries", "utilities", "marketing", "maintenance", "supplies", "other"]
    amount: PositiveMoney
    incurred_on: date
    description: str = Field(min_length=3, max_length=2000)
