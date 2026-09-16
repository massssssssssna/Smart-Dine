from datetime import date, datetime

from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Question(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=2, max_length=2000)
    start_date: date
    end_date: date
    conversation_id: UUID | None = None

    @model_validator(mode="after")
    def check_range(self):
        if not 0 <= (self.end_date - self.start_date).days <= 366:
            raise ValueError("Reporting range must be ordered and at most 367 days")
        return self


class AssistantAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    answer: str = Field(min_length=1, max_length=8000)
    evidence_ids: list[str] = Field(max_length=12)


class ConversationRename(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=100)


class VoiceTokenRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start_date: date
    end_date: date
    conversation_id: UUID | None = None

    @model_validator(mode="after")
    def check_range(self):
        if not 0 <= (self.end_date - self.start_date).days <= 366:
            raise ValueError("Reporting range must be ordered and at most 367 days")
        return self


class VoiceTokenResponse(BaseModel):
    token: str
    url: str
    room_name: str
    conversation_id: UUID
    expires_at: datetime
