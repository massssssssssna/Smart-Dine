from datetime import date
from typing import Annotated, Literal
from uuid import UUID
from fastapi import APIRouter, Depends, Query, Response
from app.api.dependencies import require_cashier, require_waiter_or_manager, require_kitchen_or_manager
from app.core.exceptions import AppError
from app.core.security import Actor
from app.modules.common import ActorDep, GatewayDep, IdempotencyKey, PageDep, payload
from app.modules.orders.export_service import build_excel_export, build_pdf_export, fetch_orders_for_export
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


@router.get('/export')
async def export_orders(
    gateway: GatewayDep,
    actor: ActorDep,
    format: Literal['pdf', 'excel'] = Query(default='excel'),
    start_date: date = Query(...),
    end_date: date = Query(...),
    status: Literal['pending', 'preparing', 'ready', 'completed', 'cancelled', 'all'] | None = Query(default=None),
    q: str = Query(default='', max_length=100),
    scope: Literal['manager', 'cashier', 'waiter', 'kitchen'] | None = Query(default=None),
):
    # Enforce role boundaries on scope
    effective_scope: Literal['manager', 'cashier', 'waiter', 'kitchen']
    if actor.role == 'manager':
        effective_scope = scope or 'manager'
    elif actor.staff_type == 'cashier':
        effective_scope = 'cashier'
    elif actor.staff_type == 'waiter':
        effective_scope = 'waiter'
    elif actor.staff_type == 'kitchen':
        effective_scope = 'kitchen'
    else:
        effective_scope = 'waiter'

    records, meta = await fetch_orders_for_export(
        gateway=gateway,
        actor=actor,
        start_date=start_date,
        end_date=end_date,
        status=status,
        q=q,
        scope=effective_scope,
    )

    clean_start = start_date.strftime('%Y%m%d')
    clean_end = end_date.strftime('%Y%m%d')
    scope_tag = effective_scope.capitalize()

    if format == 'pdf':
        buf = build_pdf_export(
            records=records,
            scope=effective_scope,
            start_date=start_date,
            end_date=end_date,
            actor=actor,
            meta=meta,
        )
        media_type = 'application/pdf'
        filename = f'SmartDine_{scope_tag}_History_{clean_start}_{clean_end}.pdf'
    else:
        buf = build_excel_export(
            records=records,
            scope=effective_scope,
            start_date=start_date,
            end_date=end_date,
            actor=actor,
            meta=meta,
        )
        media_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        filename = f'SmartDine_{scope_tag}_History_{clean_start}_{clean_end}.xlsx'

    return Response(
        content=buf.getvalue(),
        media_type=media_type,
        headers={
            'Content-Disposition': f'attachment; filename="{filename}"',
            'Cache-Control': 'no-store',
        },
    )


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
