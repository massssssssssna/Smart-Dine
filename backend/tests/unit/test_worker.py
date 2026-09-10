import asyncio
from unittest.mock import AsyncMock

import pytest

from app.jobs.worker import process_job

JOB = {"id": "job-1", "owner_token": "token-1", "kind": "forecast"}


@pytest.mark.asyncio
async def test_success_fenced_result_and_completion_are_one_call():
    gateway = AsyncMock()
    await process_job(JOB, gateway, 30, handler=AsyncMock(return_value={"monthly_quantity": 123}))
    gateway.service.assert_awaited_once_with("job_complete", {"job_id": "job-1", "owner_token": "token-1", "result": {"monthly_quantity": 123}})


@pytest.mark.asyncio
async def test_failure_records_only_error_type_not_credentials():
    gateway = AsyncMock()
    await process_job(JOB, gateway, 30, handler=AsyncMock(side_effect=ValueError("secret_api_key")))
    gateway.service.assert_awaited_once_with("job_fail", {"job_id": "job-1", "owner_token": "token-1", "error_code": "ValueError"})


@pytest.mark.asyncio
async def test_lease_loss_prevents_result_write():
    gateway = AsyncMock()
    gateway.service.return_value = {"renewed": False}

    async def slow_handler(job, db):
        await asyncio.sleep(1.1)
        return {"monthly_quantity": 1}

    await process_job(JOB, gateway, 1, handler=slow_handler)
    assert [call.args[0] for call in gateway.service.call_args_list] == ["job_heartbeat"]
