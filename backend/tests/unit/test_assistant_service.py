from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest

from app.core.exceptions import AppError
from app.modules.assistant.schemas import Question
from app.modules.assistant.service import answer_question


class Reply:
    def __init__(self, content="", tool_calls=None):
        self.content = content
        self.tool_calls = tool_calls


def fake_client(*replies):
    return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=AsyncMock(
        side_effect=[SimpleNamespace(choices=[SimpleNamespace(message=reply)]) for reply in replies]
    ))))


BODY = Question(question="How did we perform?", start_date=date(2026, 8, 1), end_date=date(2026, 8, 31))
ACTOR = SimpleNamespace(id=UUID("00000000-0000-4000-8000-000000000001"))


@pytest.mark.asyncio
async def test_answer_is_grounded_even_when_model_skips_tools_and_is_saved():
    gateway, admin = AsyncMock(), AsyncMock()
    gateway.read.return_value = {"net_revenue": "12500.00", "contribution_margin": "4000.00"}
    client = fake_client(Reply(), Reply('{"answer":"The period produced a positive contribution.","evidence_ids":["E1"]}'))
    result = await answer_question(BODY, ACTOR, gateway, admin, client=client)
    assert result["verified_metrics"] == gateway.read.return_value
    assert result["evidence"][0]["id"] == "E1"
    assert [call.args[0] for call in admin.service.call_args_list] == ["assistant_start", "assistant_finish"]
    assert admin.service.call_args.args[1]["status"] == "completed"


@pytest.mark.asyncio
async def test_unknown_citations_never_persist_as_success():
    gateway, admin = AsyncMock(), AsyncMock()
    gateway.read.return_value = {"net_revenue": "0.00"}
    client = fake_client(Reply(), Reply('{"answer":"Trust me", "evidence_ids":["invented"]}'))
    with pytest.raises(AppError) as error:
        await answer_question(BODY, ACTOR, gateway, admin, client=client)
    assert error.value.status_code == 503
    assert admin.service.call_args.args[1]["status"] == "failed"


@pytest.mark.asyncio
async def test_database_outage_during_failure_record_does_not_expose_raw_provider_error():
    gateway, admin = AsyncMock(), AsyncMock()
    gateway.read.side_effect = RuntimeError("gsk_secret_in_provider_details")
    admin.service.side_effect = [None, RuntimeError("second failure")]
    with pytest.raises(AppError) as error:
        await answer_question(BODY, ACTOR, gateway, admin, client=fake_client())
    assert error.value.status_code == 503
    assert "gsk_" not in str(error.value)
