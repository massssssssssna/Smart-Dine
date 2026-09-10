from typing import Annotated, Literal
from datetime import date
from uuid import UUID
from pydantic import Field, model_validator
from app.modules.common import Money, PositiveMoney, RequestModel, Version
from app.modules.recipes.schemas import RecipeIngredient


class EvidenceReference(RequestModel):
    source: str = Field(min_length=1, max_length=100)
    reference: str = Field(min_length=1, max_length=500)
    summary: str = Field(min_length=1, max_length=2000)


class GenerateRecommendations(RequestModel):
    start_date: date
    end_date: date

    @model_validator(mode="after")
    def ordered_period(self):
        if not 0 <= (self.end_date - self.start_date).days <= 366:
            raise ValueError("Choose an ordered reporting period of at most 367 days.")
        return self


class RecommendationBase(RequestModel):
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=3, max_length=5000)
    evidence: list[EvidenceReference] = Field(min_length=1, max_length=30)


class PriceChange(RequestModel):
    selling_price: PositiveMoney


class RecipeChange(RequestModel):
    ingredients: list[RecipeIngredient] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def distinct_ingredients(self):
        if len({i.ingredient_id for i in self.ingredients}) != len(self.ingredients):
            raise ValueError("Each ingredient may appear only once.")
        return self


class MenuChange(RequestModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    category: str | None = Field(default=None, min_length=1, max_length=80)
    is_active: bool | None = None
    packaging_cost: Money | None = None

    @model_validator(mode="after")
    def has_change(self):
        if not self.model_dump(exclude_none=True):
            raise ValueError("At least one menu change is required.")
        return self


class TaskChange(RequestModel):
    instructions: str = Field(min_length=3, max_length=5000)


class PriceRecommendation(RecommendationBase):
    action_type: Literal["price_update"]
    target_id: UUID
    expected_target_version: Version
    proposed_change: PriceChange


class RecipeRecommendation(RecommendationBase):
    action_type: Literal["recipe_update"]
    target_id: UUID
    expected_target_version: Version
    proposed_change: RecipeChange


class MenuRecommendation(RecommendationBase):
    action_type: Literal["menu_update"]
    target_id: UUID
    expected_target_version: Version
    proposed_change: MenuChange


class TaskRecommendation(RecommendationBase):
    action_type: Literal["marketing", "reorder"]
    proposed_change: TaskChange


RecommendationCreate = Annotated[
    PriceRecommendation | RecipeRecommendation | MenuRecommendation | TaskRecommendation,
    Field(discriminator="action_type"),
]
