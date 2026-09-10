from uuid import UUID
from fastapi import APIRouter
from app.modules.common import ActorDep, GatewayDep, IdempotencyKey, ManagerDep, PageDep, Versioned, payload
from app.modules.menu.schemas import MenuCreate, MenuUpdate
from app.modules.menu.service import MenuService

router = APIRouter(prefix="/menu", tags=["Menu"])


@router.get("")
async def list_menu(gateway: GatewayDep, actor: ActorDep, page: PageDep):
    return await MenuService(gateway).read(page, actor.role)


@router.get("/{item_id}")
async def get_menu_item(item_id: UUID, gateway: GatewayDep, actor: ActorDep):
    return await MenuService(gateway).read({"id": str(item_id)}, actor.role)


@router.post("", status_code=201)
async def create_menu_item(body: MenuCreate, gateway: GatewayDep, manager: ManagerDep, key: IdempotencyKey):
    return await MenuService(gateway).save("menu_create", payload(body), key)


@router.put("/{item_id}")
async def update_menu_item(item_id: UUID, body: MenuUpdate, gateway: GatewayDep, manager: ManagerDep, key: IdempotencyKey):
    return await MenuService(gateway).save("menu_update", payload(body, item_id), key)


@router.delete("/{item_id}")
async def delete_menu_item(item_id: UUID, body: Versioned, gateway: GatewayDep, manager: ManagerDep, key: IdempotencyKey):
    return await MenuService(gateway).save("menu_delete", payload(body, item_id), key)
