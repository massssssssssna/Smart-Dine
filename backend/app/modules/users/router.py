from typing import Annotated
from uuid import UUID
from fastapi import APIRouter, Depends
from app.api.dependencies import get_admin_gateway
from app.integrations.supabase_client import Gateway
from app.modules.common import GatewayDep, IdempotencyKey, ManagerDep, PageDep, payload
from app.modules.users.schemas import CredentialsUpdate, UserCreate, UserUpdate
from app.modules.users.service import UserService

router = APIRouter(prefix="/users", tags=["Users"])


@router.get("")
async def list_users(gateway: GatewayDep, manager: ManagerDep, page: PageDep):
    return await UserService(gateway).read(page)


@router.get("/ledger/history")
async def get_staff_ledger(gateway: GatewayDep, manager: ManagerDep):
    return await UserService(gateway).staff_ledger(manager)


@router.get("/{user_id}")
async def get_user(user_id: UUID, gateway: GatewayDep, manager: ManagerDep):
    return await UserService(gateway).read({"id": str(user_id)})


@router.post("", status_code=201)
async def create_user(body: UserCreate, gateway: GatewayDep, manager: ManagerDep, key: IdempotencyKey, admin: Annotated[Gateway, Depends(get_admin_gateway)]):
    return await UserService(gateway, admin).create(manager, body, key)


@router.put("/{user_id}")
async def update_user(user_id: UUID, body: UserUpdate, gateway: GatewayDep, manager: ManagerDep, key: IdempotencyKey):
    return await UserService(gateway).update(payload(body, user_id), key)


@router.patch("/{user_id}/credentials")
async def update_credentials(user_id: UUID, body: CredentialsUpdate, gateway: GatewayDep, manager: ManagerDep, admin: Annotated[Gateway, Depends(get_admin_gateway)]):
    return await UserService(gateway, admin).credentials(manager, user_id, body)


@router.delete("/{user_id}")
async def delete_staff(user_id: UUID, gateway: GatewayDep, manager: ManagerDep):
    return await UserService(gateway).delete(user_id)
