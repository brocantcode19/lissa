from pydantic import BaseModel, EmailStr, Field
from typing import Optional, Literal
from datetime import datetime
import uuid


# ── Database document shape ────────────────────────────────────────────────────
class UserInDB(BaseModel):
    user_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    full_name: str
    email_address: str
    password_hash: str
    role_id: Literal["student", "admin"] = "student"
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: Optional[datetime] = None


# ── Request bodies ─────────────────────────────────────────────────────────────
class UserCreate(BaseModel):
    full_name: str
    email_address: EmailStr
    password: str
    role_id: Literal["student", "admin"] = "student"


class UserLogin(BaseModel):
    email_address: EmailStr
    password: str


# ── Response bodies ────────────────────────────────────────────────────────────
class UserPublic(BaseModel):
    user_id: str
    full_name: str
    email_address: str
    role_id: str
    is_active: bool
    created_at: datetime


class TokenPayload(BaseModel):
    user_id: str
    role: str
