from datetime import date
from uuid import UUID
from fastapi import APIRouter
from app.modules.common import GatewayDep, IdempotencyKey, ManagerDep, PageDep, ReasonedVersion, payload
from app.modules.expenses.schemas import ExpenseCreate
from app.modules.expenses.service import ExpenseService

router = APIRouter(prefix="/expenses", tags=["Expenses"])


@router.get("")
async def list_expenses(
    gateway: GatewayDep,
    manager: ManagerDep,
    page: PageDep,
    start_date: date | None = None,
    end_date: date | None = None,
):
    params = {**page}
    if start_date:
        params["start_date"] = start_date.isoformat()
    if end_date:
        params["end_date"] = end_date.isoformat()
    return await ExpenseService(gateway).read(params)



@router.get("/{expense_id}")
async def get_expense(expense_id: UUID, gateway: GatewayDep, manager: ManagerDep):
    return await ExpenseService(gateway).read({"id": str(expense_id)})


@router.post("", status_code=201)
async def create_expense(body: ExpenseCreate, gateway: GatewayDep, manager: ManagerDep, key: IdempotencyKey):
    return await ExpenseService(gateway).create(payload(body), key)


@router.post("/{expense_id}/void")
async def void_expense(expense_id: UUID, body: ReasonedVersion, gateway: GatewayDep, manager: ManagerDep, key: IdempotencyKey):
    return await ExpenseService(gateway).void(payload(body, expense_id), key)

