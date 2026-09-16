"""Opt-in smoke test for LiveKit dispatch, agent audio, and DB transcript persistence."""

# ruff: noqa: E402 -- the project root must be added before importing the application.

import asyncio
import sys
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import httpx
from livekit import rtc

from app.core.config import get_settings
from app.core.security import Actor
from app.integrations.db import Gateway, close_pool
from app.modules.assistant.schemas import VoiceTokenRequest
from app.modules.assistant.voice_token import issue_voice_token


async def main() -> None:
    settings = get_settings()
    admin = Gateway(claims={"role": "service_role"}, is_admin=True)
    rows = await admin.query(
        "select id,full_name from private.profiles where role='manager' and is_active order by created_at limit 1"
    )
    if not rows:
        raise RuntimeError("No active manager is available for the voice smoke test")

    actor = Actor(
        id=rows[0]["id"],
        role="manager",
        full_name=rows[0]["full_name"],
        access_token="local-smoke-test",
    )
    today = datetime.now(ZoneInfo(settings.app_timezone)).date()
    credentials = await issue_voice_token(
        VoiceTokenRequest(start_date=today - timedelta(days=30), end_date=today),
        actor,
        admin,
    )
    room = rtc.Room()
    joined = asyncio.Event()
    audio_received = asyncio.Event()
    audio_tasks: set[asyncio.Task] = set()

    @room.on("participant_connected")
    def on_participant_connected(_participant) -> None:
        joined.set()

    @room.on("track_subscribed")
    def on_track_subscribed(track, _publication, _participant) -> None:
        if track.kind != rtc.TrackKind.KIND_AUDIO:
            return

        async def receive_first_frame() -> None:
            async for _event in rtc.AudioStream(track):
                audio_received.set()
                break

        task = asyncio.create_task(receive_first_frame())
        audio_tasks.add(task)
        task.add_done_callback(audio_tasks.discard)

    await room.connect(credentials["url"], credentials["token"])
    transcript_count = 0
    try:
        await asyncio.wait_for(joined.wait(), timeout=30)
        await asyncio.wait_for(audio_received.wait(), timeout=30)
        for _ in range(15):
            messages = await admin.query(
                "select count(*)::int as count from private.assistant_messages where conversation_id=%s::uuid",
                (credentials["conversation_id"],),
            )
            transcript_count = messages[0]["count"]
            if transcript_count:
                break
            await asyncio.sleep(1)

        async with httpx.AsyncClient(timeout=30) as client:
            speech = await client.post(
                "https://api.deepgram.com/v1/speak",
                params={
                    "model": "aura-2-andromeda-en",
                    "encoding": "linear16",
                    "sample_rate": 16000,
                    "container": "none",
                },
                headers={
                    "Authorization": f"Token {settings.deepgram_api_key.get_secret_value()}",
                    "Content-Type": "application/json",
                },
                json={"text": "How many menu items are currently available?"},
            )
            speech.raise_for_status()

        source = rtc.AudioSource(16000, 1)
        microphone = rtc.LocalAudioTrack.create_audio_track("smoke-microphone", source)
        await room.local_participant.publish_track(
            microphone,
            rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE),
        )
        frame_bytes = 320 * 2
        # Let the remote microphone subscription become ready before speaking.
        # A real browser keeps sending audio while the user waits for the greeting.
        for _ in range(150):
            await source.capture_frame(rtc.AudioFrame(b"\0" * frame_bytes, 16000, 1, 320))
        for offset in range(0, len(speech.content), frame_bytes):
            chunk = speech.content[offset:offset + frame_bytes]
            if len(chunk) < frame_bytes:
                chunk += b"\0" * (frame_bytes - len(chunk))
            await source.capture_frame(rtc.AudioFrame(chunk, 16000, 1, 320))
        # Keep the microphone open with enough trailing silence for Deepgram's
        # streaming endpoint detector to close the utterance reliably.
        for _ in range(150):
            await source.capture_frame(rtc.AudioFrame(b"\0" * frame_bytes, 16000, 1, 320))
        await source.wait_for_playout()

        for _ in range(60):
            messages = await admin.query(
                "select count(*)::int as count from private.assistant_messages where conversation_id=%s::uuid",
                (credentials["conversation_id"],),
            )
            transcript_count = messages[0]["count"]
            if transcript_count >= 3:
                break
            await asyncio.sleep(1)
    finally:
        await room.disconnect()
        if audio_tasks:
            await asyncio.gather(*audio_tasks, return_exceptions=True)

    if transcript_count < 3:
        raise RuntimeError("Voice agent did not persist the spoken question and answer")
    print(
        "voice_agent_joined=true audio_received=true "
        f"agentic_turn_saved=true transcript_messages={transcript_count}"
    )
    await admin.close()
    await close_pool()


if __name__ == "__main__":
    asyncio.run(main())
