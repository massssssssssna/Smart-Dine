from typing import Annotated, AsyncIterator

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.exceptions import AppError
from app.core.security import Actor
from app.integrations.supabase_client import Gateway, make_gateway

bearer = HTTPBearer(auto_error=False)


async def get_public_gateway() -> AsyncIterator[Gateway]:
    gateway = await make_gateway()
    try:
        yield gateway
    finally:
        await gateway.close()


async def get_actor(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]) -> Actor:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise AppError("authentication_required", "A bearer access token is required.", 401)
    gateway = await make_gateway(credentials.credentials)
    try:
        profile = await gateway.read("profile")
        if not profile or not profile.get("is_active"):
            raise AppError("inactive_account", "Account is inactive.", 403)
        return Actor(
            id=profile["id"],
            role=profile["role"],
            staff_type=profile.get("staff_type", "waiter"),
            full_name=profile.get("full_name", ""),
            access_token=credentials.credentials,
        )
    finally:
        await gateway.close()
