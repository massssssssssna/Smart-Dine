from pydantic import EmailStr, Field, SecretStr
from app.modules.common import RequestModel


class Login(RequestModel):
    email: EmailStr
    password: SecretStr = Field(min_length=1, max_length=256)


class Refresh(RequestModel):
    refresh_token: SecretStr = Field(min_length=16, max_length=4096)


class PasswordChange(RequestModel):
    current_password: SecretStr = Field(min_length=1, max_length=256)
    new_password: SecretStr = Field(min_length=8, max_length=256)
