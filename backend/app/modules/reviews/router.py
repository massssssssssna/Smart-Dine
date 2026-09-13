from typing import Annotated
from uuid import UUID
from fastapi import APIRouter, Depends, Header, Query
from app.api.dependencies import get_admin_gateway, require_cashier
from app.core.security import Actor
from app.integrations.supabase_client import Gateway
from app.modules.common import GatewayDep, ManagerDep, PageDep, payload
from app.modules.reviews.schemas import ReviewSubmit, ReviewTokenCreate, ReviewTokenInfo
from app.modules.reviews.service import ReviewService

router = APIRouter(prefix="/reviews", tags=["Reviews"])
CashierDep = Annotated[Actor, Depends(require_cashier)]


@router.get("/token-info", response_model=ReviewTokenInfo)
async def get_review_token_info(
    token: str = Query(..., min_length=16, max_length=256),
    gateway: Annotated[Gateway, Depends(get_admin_gateway)] = None
):
    return await ReviewService(gateway).get_token_info(token)


@router.post("/submit", status_code=201)
async def submit_review(body: ReviewSubmit, gateway: Annotated[Gateway, Depends(get_admin_gateway)]):
    return await ReviewService(gateway).submit(body)


@router.post("/tokens", status_code=201)
async def issue_review_token(
    body: ReviewTokenCreate,
    gateway: GatewayDep,
    cashier: CashierDep,
    key: Annotated[str | None, Header(alias="Idempotency-Key")] = None
):
    effective_key = key or f"review-token-{body.order_id}"
    return await ReviewService(gateway).issue_token(payload(body), effective_key)


@router.post("/tokens/order/{order_id}")
async def get_or_create_order_token(order_id: UUID, gateway: GatewayDep, cashier: CashierDep):
    return await ReviewService(gateway).issue_token({"order_id": str(order_id)}, f"review-token-{order_id}")


@router.get("")
async def list_reviews(gateway: GatewayDep, manager: ManagerDep, page: PageDep):
    return await ReviewService(gateway).read(page)


@router.get("/analysis")
async def list_review_analysis(gateway: GatewayDep, manager: ManagerDep, page: PageDep, review_id: UUID | None = None):
    params = {**page, **({"review_id": str(review_id)} if review_id else {})}
    return await gateway.read("review_analyses", params)


@router.get("/{review_id}")
async def get_review(review_id: UUID, gateway: GatewayDep, manager: ManagerDep):
    return await ReviewService(gateway).read({"id": str(review_id)})
