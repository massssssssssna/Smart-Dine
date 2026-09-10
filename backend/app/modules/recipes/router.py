from uuid import UUID
from fastapi import APIRouter
from app.modules.common import GatewayDep, IdempotencyKey, ManagerDep, payload
from app.modules.recipes.schemas import RecipeSet
from app.modules.recipes.service import RecipeService

router = APIRouter(prefix="/recipes", tags=["Recipes"])


@router.get("/{menu_item_id}")
async def get_recipe(menu_item_id: UUID, gateway: GatewayDep, manager: ManagerDep):
    return await RecipeService(gateway).get(menu_item_id)


@router.put("/{menu_item_id}")
async def replace_recipe(menu_item_id: UUID, body: RecipeSet, gateway: GatewayDep, manager: ManagerDep, key: IdempotencyKey):
    return await RecipeService(gateway).replace(payload(body, menu_item_id), key)
