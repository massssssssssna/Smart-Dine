import json
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import UUID

import jwt
import pytest
from pydantic import SecretStr, ValidationError

from app.core.security import Actor
from app.modules.assistant.schemas import VoiceTokenRequest
from app.modules.assistant.voice_agent import (
    VoiceSessionMetadata,
    _build_read_tools,
    _build_speech_engines,
    _voice_instructions,
)
from app.modules.assistant.voice_token import issue_voice_token

MANAGER_ID = UUID("10000000-0000-4000-8000-000000000001")
CONVERSATION_ID = "20000000-0000-4000-8000-000000000002"


@pytest.mark.asyncio
async def test_voice_token_is_short_lived_scoped_and_contains_signed_context():
    settings = SimpleNamespace(
        capabilities=lambda: {"voice": True},
        livekit_url="wss://smartdine.example.test",
        livekit_api_key=SecretStr("api-key"),
        livekit_api_secret=SecretStr("a-test-secret-that-is-long-enough-for-hs256"),
    )
    actor = Actor(id=MANAGER_ID, role="manager", full_name="Manager", access_token="session")
    admin = SimpleNamespace(query=AsyncMock(return_value=[{
        "id": CONVERSATION_ID,
        "title": "Voice conversation",
        "created_at": "2026-09-15T12:00:00Z",
        "updated_at": "2026-09-15T12:00:00Z",
    }]))
    body = VoiceTokenRequest(start_date=date(2026, 9, 1), end_date=date(2026, 9, 15))

    with patch("app.modules.assistant.voice_token.get_settings", return_value=settings):
        result = await issue_voice_token(body, actor, admin)

    claims = jwt.decode(
        result["token"],
        settings.livekit_api_secret.get_secret_value(),
        algorithms=["HS256"],
        options={"verify_aud": False},
    )
    context = json.loads(claims["metadata"])
    assert claims["iss"] == "api-key"
    assert claims["video"]["room"] == result["room_name"]
    assert claims["video"]["roomJoin"] is True
    assert claims["video"].get("roomAdmin") is not True
    assert claims["exp"] - claims["nbf"] <= 600
    assert context["actor_id"] == str(MANAGER_ID)
    assert context["conversation_id"] == CONVERSATION_ID


def test_voice_metadata_rejects_unknown_or_oversized_scope():
    valid = {
        "version": 1,
        "actor_id": str(MANAGER_ID),
        "conversation_id": CONVERSATION_ID,
        "start_date": "2026-09-01",
        "end_date": "2026-09-15",
    }
    assert VoiceSessionMetadata.model_validate(valid).actor_id == MANAGER_ID
    with pytest.raises(ValidationError):
        VoiceSessionMetadata.model_validate({**valid, "unexpected": "value"})
    with pytest.raises(ValidationError):
        VoiceSessionMetadata.model_validate({**valid, "start_date": "2025-01-01"})


@pytest.mark.asyncio
async def test_voice_tools_are_bounded_argument_free_reads():
    gateway = SimpleNamespace(read=AsyncMock(return_value={"items": [], "total": 0}))
    period = {"start_date": "2026-09-01", "end_date": "2026-09-15"}
    tools = _build_read_tools(gateway, period)
    sales = next(tool for tool in tools if tool.info.name == "sales_and_margins")
    payload = json.loads(await sales())
    assert payload["tool"] == "sales_and_margins"
    gateway.read.assert_awaited_once_with(
        "analytics",
        {"limit": 100, "offset": 0, "start_date": "2026-09-01", "end_date": "2026-09-15"},
    )


def test_voice_prompt_is_spoken_read_only_and_does_not_contain_secrets():
    prompt = _voice_instructions({"start_date": "2026-09-01", "end_date": "2026-09-15"})
    assert "natural English" in prompt
    assert "read-only" in prompt
    assert "Never reveal" in prompt


def test_speech_engines_orders_cartesia_primary_and_deepgram_fallback():
    settings = SimpleNamespace(
        cartesia_api_key=SecretStr("cartesia-secret-key"),
        cartesia_voice_id="custom-voice-id",
        elevenlabs_api_key=SecretStr(""),
        elevenlabs_voice_id="",
        deepgram_api_key=SecretStr("deepgram-secret-key"),
    )
    engines = _build_speech_engines(settings)
    assert len(engines) == 2
    # Cartesia must be primary (index 0)
    assert engines[0].__class__.__module__.startswith("livekit.plugins.cartesia")
    assert engines[0]._opts.model == "sonic-3"
    assert engines[0]._opts.voice == "custom-voice-id"
    # Deepgram must be fallback (index 1)
    assert engines[1].__class__.__module__.startswith("livekit.plugins.deepgram")
    assert engines[1]._opts.model == "aura-2-andromeda-en"


def test_speech_engines_falls_back_to_deepgram_when_cartesia_key_missing():
    settings = SimpleNamespace(
        cartesia_api_key=SecretStr(""),
        cartesia_voice_id="",
        elevenlabs_api_key=SecretStr(""),
        elevenlabs_voice_id="",
        deepgram_api_key=SecretStr("deepgram-secret-key"),
    )
    engines = _build_speech_engines(settings)
    assert len(engines) == 1
    assert engines[0].__class__.__module__.startswith("livekit.plugins.deepgram")

