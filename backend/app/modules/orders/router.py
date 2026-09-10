from typing import Annotated, Literal
from uuid import UUID
from fastapi import APIRouter, Depends
from app.api.dependencies import require_cashier
from app.core.security import Actor
from app.modules.common import ActorDep, GatewayDep, IdempotencyKey, PageDep, payload
from app.modules.orders.schemas import OrderCreate, OrderUpdate, OrderTransition, OrderPayment
from app.modules.orders.service import OrderService

router = APIRouter(prefix="/orders", tags=["Orders"])
CashierDep = Annotated[Actor, Depends(require_cashier)]


@router.get('/bills')
async def list_bills(gateway: GatewayDep, cashier: CashierDep, page: PageDep, payment_status: Literal['unpaid','paid','all']='unpaid'):
    return await gateway.read('bills', {**page, 'payment_status': payment_status})


@router.get('/{order_id}/receipt')
async def receipt(order_id: UUID, gateway: GatewayDep, cashier: CashierDep):
    return await gateway.read('receipt', {'id': str(order_id)})


@router.post('/{order_id}/pay')
async def pay_order(order_id: UUID, body: OrderPayment, gateway: GatewayDep, cashier: CashierDep, key: IdempotencyKey):
    return await OrderService(gateway, cashier.role).execute('order_pay', payload(body, order_id), key)


@router.get("")
async def list_orders(gateway: GatewayDep, actor: ActorDep, page: PageDep, status: Literal["pending", "preparing", "ready", "completed", "cancelled"] | None = None):
    return await OrderService(gateway, actor.role).read({**page, **({"status": status} if status else {})})


@router.get("/{order_id}")
async def get_order(order_id: UUID, gateway: GatewayDep, actor: ActorDep):
    return await OrderService(gateway, actor.role).read({"id": str(order_id)})


@router.post("", status_code=201)
async def create_order(body: OrderCreate, gateway: GatewayDep, actor: ActorDep, key: IdempotencyKey):
    return await OrderService(gateway, actor.role).execute("order_create", payload(body), key)


@router.put("/{order_id}")
async def update_order(order_id: UUID, body: OrderUpdate, gateway: GatewayDep, actor: ActorDep, key: IdempotencyKey):
    return await OrderService(gateway, actor.role).execute("order_update", payload(body, order_id), key)


@router.post("/{order_id}/status")
async def transition_order(order_id: UUID, body: OrderTransition, gateway: GatewayDep, actor: ActorDep, key: IdempotencyKey):
    return await OrderService(gateway, actor.role).execute("order_transition", payload(body, order_id), key)
