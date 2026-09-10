from typing import Annotated
from uuid import UUID
from fastapi import APIRouter, Depends
from app.api.dependencies import get_admin_gateway
from app.integrations.supabase_client import Gateway
from app.modules.common import ActorDep, GatewayDep, IdempotencyKey, ManagerDep, PageDep, payload
from app.modules.reviews.schemas import ReviewSubmit, ReviewTokenCreate
from app.modules.reviews.service import ReviewService

router = APIRouter(prefix="/reviews", tags=["Reviews"])


@router.post("/submit", status_code=201)
async def submit_review(body: ReviewSubmit, gateway: Annotated[Gateway, Depends(get_admin_gateway)]):
    return await ReviewService(gateway).submit(body)


@router.post("/tokens", status_code=201)
async def issue_review_token(body: ReviewTokenCreate, gateway: GatewayDep, actor: ActorDep, key: IdempotencyKey):
    return await ReviewService(gateway).issue_token(payload(body), key)


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
