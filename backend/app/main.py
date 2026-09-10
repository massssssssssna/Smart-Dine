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

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        # Never echo rejected input: it may contain passwords or tokens.
        fields = [{"location": list(e["loc"]), "message": e["msg"], "type": e["type"]} for e in exc.errors()]
        return JSONResponse({"code": "validation_error", "message": "Check the request fields.",
                             "fields": fields, "request_id": getattr(request.state, "request_id", "")}, status_code=422)

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception):
        rid = getattr(request.state, "request_id", "")
        logging.getLogger(__name__).error("Unhandled %s request_id=%s", type(exc).__name__, rid)
        return JSONResponse({"code": "internal_error", "message": "The request could not be completed.",
                             "request_id": rid}, status_code=500)

    @app.get("/health/live", tags=["health"])
    async def live():
        return {"status": "ok", "service": "SmartDine AI", "version": "0.1.0"}

    @app.get("/health/ready", tags=["health"])
    async def ready():
        capabilities = get_settings().capabilities()
        if not capabilities["database"] or not capabilities["administration"]:
            return JSONResponse({"status": "configuration_required", "capabilities": capabilities}, status_code=503)
        gateway = await make_gateway(admin=True)
        try:
            database = await gateway.service("health")
        finally:
            await gateway.close()
        return {"status": "ready", "database": database, "capabilities": capabilities}

    app.include_router(router)
    return app


app = create_app()
