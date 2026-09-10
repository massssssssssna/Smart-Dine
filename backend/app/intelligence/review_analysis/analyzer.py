"""Tool-free review classification with exact evidence validation."""

import json
from typing import Literal

from groq import AsyncGroq
from pydantic import BaseModel, ConfigDict, Field

PROMPT_VERSION = "review-aspects-v1"


class Aspect(BaseModel):
    model_config = ConfigDict(extra="forbid")
    aspect: Literal["taste", "price_value", "service_speed", "cleanliness"]
    sentiment: Literal["positive", "neutral", "negative", "mixed"]
    evidence: str = Field(min_length=1, max_length=2000)


class Analysis(BaseModel):
    model_config = ConfigDict(extra="forbid")
    aspects: list[Aspect] = Field(max_length=16)


def validate_analysis(content: str, original: str) -> dict:
    parsed = Analysis.model_validate_json(content)
    spans = []
    for aspect in parsed.aspects:
        start = original.find(aspect.evidence)
        if start < 0:
            raise ValueError("Review evidence must be an exact substring of the original review")
        spans.append({**aspect.model_dump(), "start": start, "end": start + len(aspect.evidence)})
    return {"aspects": spans, "prompt_version": PROMPT_VERSION}
