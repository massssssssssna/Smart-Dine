from uuid import UUID
from pydantic import Field, model_validator
from app.modules.common import Quantity, RequestModel, Versioned


class RecipeIngredient(RequestModel):
    ingredient_id: UUID
    quantity: Quantity


class RecipeSet(Versioned):
    ingredients: list[RecipeIngredient] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def distinct_ingredients(self):
        if len({i.ingredient_id for i in self.ingredients}) != len(self.ingredients):
            raise ValueError("Each ingredient may appear only once.")
        return self
