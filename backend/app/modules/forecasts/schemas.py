from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ForecastRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    menu_item_ids: list[UUID] | None = Field(default=None, max_length=100)
    menu_item_id: UUID | None = None
    as_of: date | None = None

    @model_validator(mode="after")
    def resolve_items(self):
        if not self.menu_item_ids and not self.menu_item_id:
            raise ValueError("Provide menu_item_ids or menu_item_id")
        if not self.menu_item_ids and self.menu_item_id:
            self.menu_item_ids = [self.menu_item_id]
        if self.menu_item_ids and len(self.menu_item_ids) == 0:
            raise ValueError("Choose 1 to 100 menu items")
        return self


class HistoryImport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    csv_text: str = Field(min_length=1, max_length=2_000_000)
    source_name: str = Field(min_length=1, max_length=120)


class DayClose(BaseModel):
    model_config = ConfigDict(extra="forbid")
    day: date
    status: Literal["complete", "closed"] = "complete"
    note: str = Field(min_length=1, max_length=500)
