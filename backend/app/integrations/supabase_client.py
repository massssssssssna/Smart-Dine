"""Backward-compatibility alias for the native database gateway."""
from app.integrations.db import Gateway, close_pool, get_pool, make_gateway

__all__ = ["Gateway", "make_gateway", "get_pool", "close_pool"]
