from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class Actor(BaseModel):
    id: UUID
    role: Literal["manager", "staff"]
    staff_type: Literal["waiter", "kitchen", "cashier"] = "waiter"
    full_name: str = ""
    access_token: str = Field(exclude=True, repr=False)
