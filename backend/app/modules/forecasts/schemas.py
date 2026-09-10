from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ForecastRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    menu_item_ids: list[UUID] = Field(min_length=1, max_length=100)


class HistoryImport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    csv_text: str = Field(min_length=1, max_length=2_000_000)
    source_name: str = Field(min_length=1, max_length=120)


class DayClose(BaseModel):
    model_config = ConfigDict(extra="forbid")
    day: date
    status: Literal["complete", "closed"] = "complete"
    note: str = Field(min_length=1, max_length=500)
