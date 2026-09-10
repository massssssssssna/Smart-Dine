from uuid import UUID
from pydantic import Field, SecretStr
from app.modules.common import RequestModel


class ReviewTokenCreate(RequestModel):
    order_id: UUID


class ReviewSubmit(RequestModel):
    token: SecretStr = Field(min_length=32, max_length=256)
    rating: int = Field(ge=1, le=5)
    comment: str = Field(min_length=1, max_length=5000)
    menu_item_id: UUID | None = None
