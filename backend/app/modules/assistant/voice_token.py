"""Issue least-privilege LiveKit room tokens for authenticated managers."""

import json
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from livekit import api

from app.core.config import get_settings
from app.core.exceptions import AppError
from .service import _ensure_conversation

TOKEN_TTL = timedelta(minutes=10)


async def issue_voice_token(body, actor, admin) -> dict:
    settings = get_settings()
    if not settings.capabilities()["voice"]:
        raise AppError("voice_unavailable", "Configure the LiveKit voice providers before starting a call.", 503)

    conversation = await _ensure_conversation(
        str(body.conversation_id) if body.conversation_id else None,
        "Voice conversation",
        actor,
        admin,
    )
    room_name = f"sd-voice-{str(actor.id)[:8]}-{uuid4().hex[:16]}"
    metadata = json.dumps(
        {
            "version": 1,
            "actor_id": str(actor.id),
            "conversation_id": conversation["id"],
            "start_date": body.start_date.isoformat(),
            "end_date": body.end_date.isoformat(),
        },
        separators=(",", ":"),
    )
    grants = api.VideoGrants(
        room_join=True,
        room=room_name,
        can_publish=True,
        can_publish_data=False,
        can_subscribe=True,
        can_update_own_metadata=False,
    )
    token = (
        api.AccessToken(
            settings.livekit_api_key.get_secret_value(),
            settings.livekit_api_secret.get_secret_value(),
        )
        .with_identity(f"manager-{actor.id}-{uuid4().hex[:8]}")
        .with_name(actor.full_name or "Restaurant Manager")
        .with_metadata(metadata)
        .with_ttl(TOKEN_TTL)
        .with_grants(grants)
        .to_jwt()
    )
    return {
        "token": token,
        "url": settings.livekit_url,
        "room_name": room_name,
        "conversation_id": conversation["id"],
        "expires_at": datetime.now(timezone.utc) + TOKEN_TTL,
    }
