from fastapi import APIRouter, Depends, Query

from app.api.dependencies import get_admin_gateway, get_gateway, require_manager
from .schemas import Question
from .service import answer_question

router = APIRouter(prefix="/assistant", tags=["AI Assistant"], dependencies=[Depends(require_manager)])


@router.post("")
@router.post("/questions")
async def ask(body: Question, actor=Depends(require_manager), gateway=Depends(get_gateway), admin=Depends(get_admin_gateway)):
    return await answer_question(body, actor, gateway, admin)


@router.get("/runs")
async def runs(limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0), gateway=Depends(get_gateway)):
    return await gateway.read("assistant_runs", {"limit": limit, "offset": offset})
