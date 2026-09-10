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


@router.get("/ingredients/{ingredient_id}")
async def get_ingredient(ingredient_id: UUID, gateway: GatewayDep, actor: ActorDep):
    return await InventoryService(gateway, actor.role).read("inventory", {"id": str(ingredient_id)})


@router.post("/ingredients", status_code=201)
async def create_ingredient(body: IngredientCreate, gateway: GatewayDep, manager: ManagerDep, key: IdempotencyKey):
    return await InventoryService(gateway, manager.role).execute("ingredient_create", payload(body), key)


@router.put("/ingredients/{ingredient_id}")
async def update_ingredient(ingredient_id: UUID, body: IngredientUpdate, gateway: GatewayDep, manager: ManagerDep, key: IdempotencyKey):
    return await InventoryService(gateway, manager.role).execute("ingredient_update", payload(body, ingredient_id), key)


@router.get("/transactions")
async def list_transactions(gateway: GatewayDep, actor: ActorDep, page: PageDep, ingredient_id: UUID | None = None):
    params = {**page, **({"ingredient_id": str(ingredient_id)} if ingredient_id else {})}
    return await InventoryService(gateway, actor.role).read("inventory_transactions", params)


@router.post("/transactions", status_code=201)
async def record_transaction(body: InventoryRecord, gateway: GatewayDep, actor: ActorDep, key: IdempotencyKey):
    return await InventoryService(gateway, actor.role).execute("inventory_record", payload(body), key)
