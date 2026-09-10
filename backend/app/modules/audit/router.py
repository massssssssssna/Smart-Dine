from typing import Annotated
from fastapi import APIRouter, Path
from app.modules.common import GatewayDep, ManagerDep, PageDep
from app.modules.audit.service import AuditService

router = APIRouter(prefix="/audit", tags=["Audit"])


@router.get("")
async def list_audit_events(gateway: GatewayDep, manager: ManagerDep, page: PageDep):
    return await AuditService(gateway).read(page)


@router.get("/{event_id}")
async def get_audit_event(event_id: Annotated[int, Path(ge=1)], gateway: GatewayDep, manager: ManagerDep):
    return await AuditService(gateway).read({"event_id": event_id})
