import json
from unittest.mock import AsyncMock

import pytest

from app.core.exceptions import AppError
from app.intelligence.assistant_tools.tools import bounded_result, execute_read_tool, validate_citations


@pytest.mark.asyncio
async def test_no_arbitrary_queries_or_arguments():
    gateway = AsyncMock()
    for name, args in [("execute_sql", {}), ("sales_and_margins", {"sql": "select * from auth.users"}), ("inventory_status", [])]:
        with pytest.raises(AppError):
            await execute_read_tool(name, args, gateway, {})
    gateway.read.assert_not_called()


@pytest.mark.asyncio
async def test_server_controls_period_and_limits_and_labels_snapshot():
    gateway = AsyncMock()
    gateway.read.return_value = {"items": [], "total": 0}
    period = {"start_date": "2026-08-01", "end_date": "2026-08-31"}
    data = await execute_read_tool("inventory_status", {}, gateway, period)
    gateway.read.assert_awaited_once_with("inventory", {**period, "limit": 100, "offset": 0})
    assert "Current inventory snapshot" in data["temporal_scope"]


def test_unknown_evidence_rejected():
    with pytest.raises(ValueError):
        validate_citations(json.dumps({"answer": "Costs increased", "evidence_ids": ["E999"]}), [{"id": "E1"}])
    result = validate_citations(json.dumps({"answer": "There are no completed sales", "evidence_ids": ["E1"]}), [{"id": "E1"}])
    assert result.evidence_ids == ["E1"]


def test_large_evidence_is_bounded_with_honest_coverage_without_mutating_source():
    source = {"items": [{"comment": "x" * 1000} for _ in range(100)], "total": 500}
    result = bounded_result(source, 5000)
    assert result["truncated_for_context"] is True
    assert result["total"] == 500
    assert result["included_records"] < 5
    assert len(source["items"]) == 100
