from functools import lru_cache
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, env_file_encoding="utf-8", extra="ignore")

    app_name: str = "SmartDine AI"
    app_env: Literal["development", "test", "production"] = "development"
    app_timezone: str = "Asia/Karachi"
    currency: Literal["PKR"] = "PKR"
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]
    database_url: SecretStr = SecretStr("postgresql://postgres:postgres@127.0.0.1:5432/smartdine")
    jwt_secret_key: SecretStr
    groq_api_key: SecretStr = SecretStr("")
    groq_assistant_model: str = "openai/gpt-oss-120b"
    groq_assistant_fallback_models: str = "openai/gpt-oss-20b,llama-3.3-70b-versatile,qwen/qwen3.6-27b"
    groq_review_model: str = "openai/gpt-oss-20b"
    groq_timeout_seconds: float = Field(30, ge=1, le=120)
    livekit_url: str = ""
    livekit_api_key: SecretStr = SecretStr("")
    livekit_api_secret: SecretStr = SecretStr("")
    deepgram_api_key: SecretStr = SecretStr("")
    cartesia_api_key: SecretStr = SecretStr("")
    cartesia_voice_id: str = "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4"
    elevenlabs_api_key: SecretStr = SecretStr("")
    elevenlabs_voice_id: str = "EXAVITQu4vr4xnSDxMaL"
    job_poll_seconds: float = Field(2, ge=0.1, le=60)
    job_lease_seconds: int = Field(120, ge=30, le=1800)

    @field_validator("app_timezone")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        ZoneInfo(value)
        return value

    def capabilities(self) -> dict[str, bool]:
        return {
            "database": bool(self.database_url.get_secret_value()),
            "administration": bool(self.database_url.get_secret_value()),
            "groq": bool(self.groq_api_key.get_secret_value()),
            "voice": all(
                (
                    self.livekit_url,
                    self.livekit_api_key.get_secret_value(),
                    self.livekit_api_secret.get_secret_value(),
                    self.deepgram_api_key.get_secret_value(),
                    self.groq_api_key.get_secret_value(),
                )
            ),
        }

    def assistant_models(self) -> list[str]:
        """Ordered, de-duplicated Groq production models used for failover."""
        models = [self.groq_assistant_model, *self.groq_assistant_fallback_models.split(",")]
        return list(dict.fromkeys(model.strip() for model in models if model.strip()))


@lru_cache
def get_settings() -> Settings:
    return Settings()
