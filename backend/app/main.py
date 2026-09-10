import logging
import sys
from contextlib import asynccontextmanager

if sys.platform == "win32":
    import asyncio
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import router
from app.core.config import get_settings
from app.core.exceptions import AppError
from app.core.logging import configure_logging
from app.core.middleware import RequestGuards
from app.integrations.supabase_client import close_pool, get_pool, make_gateway


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    await get_pool()
    yield
    await close_pool()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan,
                  description="Single-restaurant operations, financial reporting and evidence-linked intelligence.")
    app.add_middleware(RequestGuards)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
                       allow_methods=["GET", "POST", "PUT", "PATCH", "OPTIONS"],
                       allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
                       expose_headers=["X-Request-ID", "Retry-After"])

    @app.exception_handler(AppError)
    async def app_error(request: Request, exc: AppError):
        return JSONResponse({"code": exc.code, "message": exc.message,
                             "request_id": getattr(request.state, "request_id", "")}, status_code=exc.status_code)
