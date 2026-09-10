from typing import Literal
from pydantic import EmailStr, Field, SecretStr
from app.modules.common import RequestModel, Versioned


class UserCreate(RequestModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=120)
    role: Literal["staff"] = "staff"
    staff_type: Literal["waiter", "kitchen", "cashier"] = "waiter"
    password: SecretStr = Field(min_length=8, max_length=256)


class UserUpdate(Versioned):
    full_name: str = Field(min_length=1, max_length=120)
    role: Literal["staff"] = "staff"
    is_active: bool
    staff_type: Literal["waiter", "kitchen", "cashier"] = "waiter"


class CredentialsUpdate(RequestModel):
    email: EmailStr | None = None
    password: SecretStr | None = Field(default=None, min_length=8, max_length=256)
