from fastapi import APIRouter
from app.modules.common import DateRangeDep, GatewayDep, ManagerDep
from app.modules.analytics.schemas import ReportName
from app.modules.analytics.service import AnalyticsService

router = APIRouter(prefix="/analytics", tags=["Analytics"])


@router.get("/{report}")
async def get_report(report: ReportName, dates: DateRangeDep, gateway: GatewayDep, manager: ManagerDep):
    return await AnalyticsService(gateway).report(report, dates)
