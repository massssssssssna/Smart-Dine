from uuid import UUID
from fastapi import APIRouter
from app.modules.common import ActorDep, GatewayDep, IdempotencyKey, ManagerDep, PageDep, payload
from app.modules.inventory.schemas import IngredientCreate, IngredientUpdate, InventoryRecord, StockProductCreate, StockMovement
from app.modules.inventory.service import InventoryService

router = APIRouter(prefix="/inventory", tags=["Inventory"])


@router.get('/products')
async def list_stock(gateway: GatewayDep, manager: ManagerDep, page: PageDep):
    return await InventoryService(gateway, manager.role).read('stock_products', page)


@router.post('/products', status_code=201)
async def create_stock(body: StockProductCreate, gateway: GatewayDep, manager: ManagerDep, key: IdempotencyKey):
    return await InventoryService(gateway, manager.role).execute('stock_product_create', payload(body), key)


@router.post('/products/{item_id}/receive')
async def receive_stock(item_id: UUID, body: StockMovement, gateway: GatewayDep, manager: ManagerDep, key: IdempotencyKey):
    return await InventoryService(gateway, manager.role).execute('stock_receive', payload(body, item_id), key)


@router.post('/products/{item_id}/remove')
async def remove_stock(item_id: UUID, body: StockMovement, gateway: GatewayDep, manager: ManagerDep, key: IdempotencyKey):
    return await InventoryService(gateway, manager.role).execute('stock_remove', payload(body, item_id), key)


@router.get("/ingredients")
async def list_ingredients(gateway: GatewayDep, actor: ActorDep, page: PageDep):
    return await InventoryService(gateway, actor.role).read("inventory", page)
