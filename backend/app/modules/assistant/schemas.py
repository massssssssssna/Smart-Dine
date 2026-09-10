from datetime import date

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Question(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=3, max_length=2000)
    start_date: date
    end_date: date

    @model_validator(mode="after")
    def check_range(self):
        if not 0 <= (self.end_date - self.start_date).days <= 366:
            raise ValueError("Reporting range must be ordered and at most 367 days")
        return self


class AssistantAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    answer: str = Field(min_length=1, max_length=8000)
    evidence_ids: list[str] = Field(min_length=1, max_length=12)
