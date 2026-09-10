from groq import AsyncGroq

from app.core.config import get_settings
from app.core.exceptions import AppError


def make_groq_client() -> AsyncGroq:
    settings = get_settings()
    if not settings.groq_api_key.get_secret_value():
        raise AppError("groq_not_configured", "Configure GROQ_API_KEY to enable AI processing.", 503)
    return AsyncGroq(api_key=settings.groq_api_key.get_secret_value(),
                     timeout=settings.groq_timeout_seconds, max_retries=0)
