from uuid import UUID
from fastapi import APIRouter
from app.modules.common import GatewayDep, IdempotencyKey, ManagerDep, PageDep, ReasonedVersion, Versioned, payload
from app.modules.recommendations.schemas import GenerateRecommendations, RecommendationCreate
from app.modules.recommendations.service import RecommendationService

router = APIRouter(prefix="/recommendations", tags=["Recommendations"])


@router.get("")
async def list_recommendations(gateway: GatewayDep, manager: ManagerDep, page: PageDep):
    return await RecommendationService(gateway).read(page)


@router.get("/{recommendation_id}")
async def get_recommendation(recommendation_id: UUID, gateway: GatewayDep, manager: ManagerDep):
    return await RecommendationService(gateway).read({"id": str(recommendation_id)})


@router.post("", status_code=201)
async def create_recommendation(body: RecommendationCreate, gateway: GatewayDep, manager: ManagerDep, key: IdempotencyKey):
    return await RecommendationService(gateway).execute("recommendation_create", payload(body), key)


@router.post("/generate", status_code=201)
async def generate_recommendations(body: GenerateRecommendations, gateway: GatewayDep, manager: ManagerDep, key: IdempotencyKey):
    return await RecommendationService(gateway).execute("recommendation_generate", payload(body), key)


@router.post("/{recommendation_id}/approve")
async def approve_recommendation(recommendation_id: UUID, body: Versioned, gateway: GatewayDep, manager: ManagerDep, key: IdempotencyKey):
    return await RecommendationService(gateway).execute("recommendation_approve", payload(body, recommendation_id), key)


@router.post("/{recommendation_id}/apply")
async def apply_recommendation(recommendation_id: UUID, body: Versioned, gateway: GatewayDep, manager: ManagerDep, key: IdempotencyKey):
    return await RecommendationService(gateway).execute("recommendation_apply", payload(body, recommendation_id), key)


@router.post("/{recommendation_id}/reject")
async def reject_recommendation(recommendation_id: UUID, body: ReasonedVersion, gateway: GatewayDep, manager: ManagerDep, key: IdempotencyKey):
    return await RecommendationService(gateway).execute("recommendation_reject", payload(body, recommendation_id), key)
