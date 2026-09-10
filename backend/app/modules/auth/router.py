from typing import Annotated
from fastapi import APIRouter, Depends, Response
from app.api.dependencies import get_public_gateway
from app.integrations.supabase_client import Gateway
from app.modules.common import ActorDep, GatewayDep
from app.modules.auth.schemas import Login, Refresh, PasswordChange
from app.modules.auth.service import AuthService

router = APIRouter(prefix="/auth", tags=["Authentication"])
PublicGateway = Annotated[Gateway, Depends(get_public_gateway)]


@router.post("/login")
async def login(body: Login, gateway: PublicGateway, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return await AuthService(gateway).login(body)


@router.post("/refresh")
async def refresh(body: Refresh, gateway: PublicGateway, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return await AuthService(gateway).refresh(body)


@router.get("/me")
async def me(gateway: GatewayDep, actor: ActorDep):
    return await gateway.read("me")


@router.post("/logout", status_code=204)
async def logout(gateway: GatewayDep, actor: ActorDep):
    await AuthService(gateway).logout(actor)
    return Response(status_code=204)


@router.post("/password")
async def change_password(body: PasswordChange, gateway: PublicGateway, actor: ActorDep):
    return await AuthService(gateway).change_password(actor, body)
