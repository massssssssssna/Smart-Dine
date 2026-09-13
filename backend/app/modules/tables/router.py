from uuid import UUID
from fastapi import APIRouter
from app.modules.common import GatewayDep, ActorDep, ManagerDep, IdempotencyKey, PageDep, Versioned, payload
from app.modules.tables.schemas import FloorCreate, FloorUpdate, FloorTaxUpdate, TableCreate, TableUpdate
from app.modules.tables.service import TablesService

router = APIRouter(tags=['Floors & tables'])

@router.get('/floors')
async def floors(gateway: GatewayDep, actor: ActorDep, page: PageDep):
    return await TablesService(gateway).read('floors', page)

@router.post('/floors', status_code=201)
async def add_floor(body: FloorCreate, gateway: GatewayDep, manager: ManagerDep, key: IdempotencyKey):
    return await TablesService(gateway).save('floor_create', payload(body), key)

@router.put('/floors/{id}')
async def edit_floor(id: UUID, body: FloorUpdate, gateway: GatewayDep, manager: ManagerDep, key: IdempotencyKey):
    return await TablesService(gateway).save('floor_update', payload(body,id), key)

@router.delete('/floors/{id}')
async def delete_floor(id: UUID, body: Versioned, gateway: GatewayDep, manager: ManagerDep, key: IdempotencyKey):
    return await TablesService(gateway).save('floor_delete', payload(body,id), key)

@router.patch('/floors/{id}/tax')
async def set_floor_tax(id: UUID, body: FloorTaxUpdate, gateway: GatewayDep, manager: ManagerDep, key: IdempotencyKey):
    return await TablesService(gateway).save('floor_set_tax', {'floor_id': str(id), 'tax_rate': body.tax_rate}, key)

@router.get('/tables')
async def tables(floor_id: UUID, gateway: GatewayDep, actor: ActorDep, page: PageDep):
    return await TablesService(gateway).read('tables', {**page, 'floor_id':str(floor_id)})

@router.post('/tables', status_code=201)
async def add_table(body: TableCreate, gateway: GatewayDep, manager: ManagerDep, key: IdempotencyKey):
    return await TablesService(gateway).save('table_create', payload(body), key)

@router.put('/tables/{id}')
async def edit_table(id: UUID, body: TableUpdate, gateway: GatewayDep, manager: ManagerDep, key: IdempotencyKey):
    return await TablesService(gateway).save('table_update', payload(body,id), key)

@router.delete('/tables/{id}')
async def delete_table(id: UUID, body: Versioned, gateway: GatewayDep, manager: ManagerDep, key: IdempotencyKey):
    return await TablesService(gateway).save('table_delete', payload(body,id), key)
