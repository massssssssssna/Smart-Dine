from fastapi import APIRouter

from app.modules.auth.router import router as auth
from app.modules.users.router import router as users
from app.modules.menu.router import router as menu
from app.modules.recipes.router import router as recipes
from app.modules.orders.router import router as orders
from app.modules.inventory.router import router as inventory
from app.modules.expenses.router import router as expenses
from app.modules.reviews.router import router as reviews
from app.modules.analytics.router import router as analytics
from app.modules.forecasts.router import router as forecasts
from app.modules.assistant.router import router as assistant
from app.modules.recommendations.router import router as recommendations
from app.modules.audit.router import router as audit

router = APIRouter(prefix="/api/v1")
for module in (auth, users, menu, recipes, orders, inventory, expenses, reviews, analytics,
               forecasts, assistant, recommendations, audit):
    router.include_router(module)
