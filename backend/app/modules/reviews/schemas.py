from uuid import UUID
from pydantic import BaseModel, Field, SecretStr
from app.modules.common import RequestModel


class ReviewTokenCreate(RequestModel):
    order_id: UUID


class DishRating(BaseModel):
    menu_item_id: UUID
    rating: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=1000)


class AspectRatings(BaseModel):
    taste: int | None = Field(default=None, ge=1, le=5)
    service_speed: int | None = Field(default=None, ge=1, le=5)
    cleanliness: int | None = Field(default=None, ge=1, le=5)
    hospitality: int | None = Field(default=None, ge=1, le=5)
    value: int | None = Field(default=None, ge=1, le=5)


class ReviewSubmit(RequestModel):
    token: SecretStr = Field(min_length=32, max_length=256)
    rating: int = Field(ge=1, le=5)
    comment: str = Field(min_length=1, max_length=5000)
    menu_item_id: UUID | None = None
    aspects: AspectRatings | None = None
    dish_ratings: list[DishRating] | None = None


class OrderItemInfo(BaseModel):
    menu_item_id: UUID
    name: str
    quantity: int
    price: str | None = None


class ReviewTokenInfo(BaseModel):
    valid: bool
    reason: str | None = None
    message: str | None = None
    order_id: UUID | None = None
    order_number: str | None = None
    table_name: str | None = None
    floor_name: str | None = None
    seats: int | None = None
    waiter_name: str | None = None
    created_at: str | None = None
    items: list[OrderItemInfo] = Field(default_factory=list)
