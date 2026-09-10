from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query

from app.api.dependencies import get_gateway, require_manager
from .schemas import DayClose, ForecastRequest, HistoryImport
from .service import import_history

router = APIRouter(prefix="/forecasts", tags=["Forecasts"], dependencies=[Depends(require_manager)])
Key = Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=128)]


@router.get("")
async def list_forecasts(menu_item_id: UUID | None = None, limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0), gateway=Depends(get_gateway)):
    return await gateway.read("forecasts", {"menu_item_id": menu_item_id, "limit": limit, "offset": offset})


@router.post("/runs", status_code=202)
async def enqueue(body: ForecastRequest, idempotency_key: Key, gateway=Depends(get_gateway)):
    return await gateway.command("forecast_enqueue", body.model_dump(mode="json"), idempotency_key)


@router.get("/jobs")
async def jobs(limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0), gateway=Depends(get_gateway)):
    return await gateway.read("jobs", {"limit": limit, "offset": offset})


@router.post("/jobs/{job_id}/retry", status_code=202)
async def retry(job_id: UUID, idempotency_key: Key, gateway=Depends(get_gateway)):
    return await gateway.command("job_retry", {"job_id": str(job_id)}, idempotency_key)


@router.post("/history/import")
async def history(body: HistoryImport, idempotency_key: Key, gateway=Depends(get_gateway)):
    return await import_history(gateway, body, idempotency_key)


@router.post("/day-close")
async def close_day(body: DayClose, idempotency_key: Key, gateway=Depends(get_gateway)):
    return await gateway.command("day_close", body.model_dump(mode="json"), idempotency_key)
