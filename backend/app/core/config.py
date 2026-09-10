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
    groq_review_model: str = "openai/gpt-oss-20b"
    groq_timeout_seconds: float = Field(30, ge=1, le=120)
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
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()
