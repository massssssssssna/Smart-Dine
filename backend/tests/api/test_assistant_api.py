from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import UUID
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import get_actor, get_admin_gateway, get_gateway, get_public_gateway
from app.core.security import Actor
from app.main import create_app

MANAGER_ID = UUID("10000000-0000-4000-8000-000000000001")


@pytest.fixture
def client_app():
    app = create_app()
    gateway = SimpleNamespace(
        read=AsyncMock(return_value={"items": [], "total": 0, "limit": 50, "offset": 0}),
        command=AsyncMock(return_value={"id": "run-1"}),
        service=AsyncMock(return_value={"id": "run-1"}),
        close=AsyncMock(),
    )
    actor = Actor(id=MANAGER_ID, role="manager", full_name="Manager", access_token="test-token")
    app.dependency_overrides[get_actor] = lambda: actor
    app.dependency_overrides[get_gateway] = lambda: gateway
    app.dependency_overrides[get_admin_gateway] = lambda: gateway
    app.dependency_overrides[get_public_gateway] = lambda: gateway
    with TestClient(app) as client:
        yield client, gateway, actor, app


def test_assistant_route_accepts_both_slash_assistant_and_slash_questions(client_app):
    client, gateway, actor, _ = client_app

    mock_answer = {
        "run_id": "test-run-123",
        "answer": "Net revenue for this period was PKR 125,000 [E1: Sales & Margins].",
        "evidence_ids": ["E1"],
        "period": {"start_date": "2026-09-01", "end_date": "2026-09-13"},
        "evidence": [
            {
                "id": "E1",
                "tool": "sales_and_margins",
                "period": {"start_date": "2026-09-01", "end_date": "2026-09-13"},
                "data": {"net_revenue": "125000.00", "contribution_margin": "78000.00"},
                "temporal_scope": "Selected reporting period, inclusive, Asia/Karachi.",
            }
        ],
        "verified_metrics": {"net_revenue": "125000.00"},
        "notice": "Narrative is AI generated; verified_metrics and evidence contain the recorded values.",
    }

    with patch("app.modules.assistant.router.answer_question", new=AsyncMock(return_value=mock_answer)):
        # Test 1: POST /api/v1/assistant
        res1 = client.post(
            "/api/v1/assistant",
            json={"question": "Which menu items gave highest margin?", "start_date": "2026-09-01", "end_date": "2026-09-13"},
        )
        assert res1.status_code == 200
        data1 = res1.json()
        assert data1["run_id"] == "test-run-123"
        assert "E1" in data1["evidence_ids"]

        # Test 2: POST /api/v1/assistant/questions
        res2 = client.post(
            "/api/v1/assistant/questions",
            json={"question": "Which menu items gave highest margin?", "start_date": "2026-09-01", "end_date": "2026-09-13"},
        )
        assert res2.status_code == 200
        data2 = res2.json()
        assert data2["run_id"] == "test-run-123"


def test_assistant_validates_date_ordering_and_length(client_app):
    client, _, _, _ = client_app

    # Invalid: start_date > end_date
    res = client.post(
        "/api/v1/assistant",
        json={"question": "Check profit", "start_date": "2026-09-13", "end_date": "2026-09-01"},
    )
    assert res.status_code == 422

    # Invalid: question too short; ordinary two-character greetings are allowed.
    res_short = client.post(
        "/api/v1/assistant",
        json={"question": "h", "start_date": "2026-09-01", "end_date": "2026-09-13"},
    )
    assert res_short.status_code == 422


def test_staff_rejected_from_assistant(client_app):
    client, _, actor, _ = client_app
    actor.role = "staff"
    actor.staff_type = "waiter"

    res = client.post(
        "/api/v1/assistant",
        json={"question": "Give me profit data", "start_date": "2026-09-01", "end_date": "2026-09-13"},
    )
    assert res.status_code == 403

    res_runs = client.get("/api/v1/assistant/runs")
    assert res_runs.status_code == 403


def test_get_runs_reads_assistant_runs_gateway(client_app):
    client, gateway, _, _ = client_app
    gateway.read.return_value = {
        "items": [
            {
                "id": "run-001",
                "question": "Which items had highest margin?",
                "status": "completed",
                "created_at": "2026-09-13T01:00:00Z",
            }
        ],
        "total": 1,
    }

    res = client.get("/api/v1/assistant/runs?limit=10&offset=0")
    assert res.status_code == 200
    assert gateway.read.await_args.args == ("assistant_runs", {"limit": 10, "offset": 0})


def test_voice_token_route_is_manager_only_and_returns_public_connection_data(client_app):
    client, _, actor, _ = client_app
    response = {
        "token": "signed-participant-token",
        "url": "wss://voice.example.test",
        "room_name": "sd-voice-private",
        "conversation_id": "20000000-0000-4000-8000-000000000002",
        "expires_at": datetime(2026, 9, 15, 12, 10, tzinfo=timezone.utc),
    }
    with patch("app.modules.assistant.router.issue_voice_token", new=AsyncMock(return_value=response)):
        result = client.post(
            "/api/v1/assistant/voice/token",
            json={"start_date": "2026-09-01", "end_date": "2026-09-15"},
        )
    assert result.status_code == 200
    assert result.json()["url"] == "wss://voice.example.test"
    assert result.json()["token"] == "signed-participant-token"

    actor.role = "staff"
    denied = client.post(
        "/api/v1/assistant/voice/token",
        json={"start_date": "2026-09-01", "end_date": "2026-09-15"},
    )
    assert denied.status_code == 403
