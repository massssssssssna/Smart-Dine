from fastapi import APIRouter, Depends, Query

from app.api.dependencies import get_admin_gateway, get_gateway, require_manager
from uuid import UUID
from .schemas import ConversationRename, Question, VoiceTokenRequest, VoiceTokenResponse
from .service import answer_question, delete_conversation, get_conversation, list_conversations, rename_conversation
from .voice_token import issue_voice_token

router = APIRouter(prefix="/assistant", tags=["AI Assistant"], dependencies=[Depends(require_manager)])


@router.post("")
@router.post("/questions")
async def ask(body: Question, actor=Depends(require_manager), gateway=Depends(get_gateway), admin=Depends(get_admin_gateway)):
    return await answer_question(body, actor, gateway, admin)


@router.get("/runs")
async def runs(limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0), gateway=Depends(get_gateway)):
    return await gateway.read("assistant_runs", {"limit": limit, "offset": offset})


@router.get("/conversations")
async def conversations(actor=Depends(require_manager), admin=Depends(get_admin_gateway)):
    return await list_conversations(actor, admin)


@router.get("/conversations/{conversation_id}")
async def conversation(conversation_id: UUID, actor=Depends(require_manager), admin=Depends(get_admin_gateway)):
    return await get_conversation(str(conversation_id), actor, admin)


@router.patch("/conversations/{conversation_id}")
async def rename(conversation_id: UUID, body: ConversationRename, actor=Depends(require_manager), admin=Depends(get_admin_gateway)):
    return await rename_conversation(str(conversation_id), body.title, actor, admin)


@router.delete("/conversations/{conversation_id}", status_code=204)
async def delete(conversation_id: UUID, actor=Depends(require_manager), admin=Depends(get_admin_gateway)):
    await delete_conversation(str(conversation_id), actor, admin)


@router.post("/voice/token", response_model=VoiceTokenResponse)
async def voice_token(
    body: VoiceTokenRequest,
    actor=Depends(require_manager),
    admin=Depends(get_admin_gateway),
):
    return await issue_voice_token(body, actor, admin)
