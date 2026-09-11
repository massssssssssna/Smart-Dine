from typing import Annotated, Literal
from uuid import UUID
from fastapi import APIRouter, Depends, Query
from app.api.dependencies import require_cashier, require_waiter_or_manager, require_kitchen_or_manager
from app.core.exceptions import AppError
from app.core.security import Actor
from app.modules.common import ActorDep, GatewayDep, IdempotencyKey, PageDep, payload
from app.modules.orders.schemas import OrderCreate, OrderUpdate, OrderTransition, OrderPayment
from app.modules.orders.service import OrderService

router = APIRouter(prefix="/orders", tags=["Orders"])
CashierDep = Annotated[Actor, Depends(require_cashier)]
WaiterDep = Annotated[Actor, Depends(require_waiter_or_manager)]
KitchenDep = Annotated[Actor, Depends(require_kitchen_or_manager)]


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
async def list_orders(gateway: GatewayDep, actor: ActorDep, page: PageDep, status: Literal["pending", "preparing", "ready", "completed", "cancelled"] | None = None, q: str = Query(default='', max_length=100)):
    return await OrderService(gateway, actor.role).read({**page, 'q':q, **({"status": status} if status else {})})


@router.get("/{order_id}")
async def get_order(order_id: UUID, gateway: GatewayDep, actor: ActorDep):
    return await OrderService(gateway, actor.role).read({"id": str(order_id)})


@router.post("", status_code=201)
async def create_order(body: OrderCreate, gateway: GatewayDep, waiter: WaiterDep, key: IdempotencyKey):
    return await OrderService(gateway, waiter.role).execute("order_create", payload(body), key)


@router.put("/{order_id}")
async def update_order(order_id: UUID, body: OrderUpdate, gateway: GatewayDep, waiter: WaiterDep, key: IdempotencyKey):
    return await OrderService(gateway, waiter.role).execute("order_update", payload(body, order_id), key)


@router.post("/{order_id}/status")
async def transition_order(order_id: UUID, body: OrderTransition, gateway: GatewayDep, actor: ActorDep, key: IdempotencyKey):
    if body.status in ("preparing", "ready") and actor.role != "manager" and actor.staff_type != "kitchen":
        raise AppError("kitchen_required", "Kitchen or manager access is required to prepare or plate orders.", 403)
    if body.status == "completed" and actor.role != "manager" and actor.staff_type != "cashier":
        raise AppError("cashier_required", "Use cashier payment to complete and pay for orders.", 403)
    return await OrderService(gateway, actor.role).execute("order_transition", payload(body, order_id), key)
