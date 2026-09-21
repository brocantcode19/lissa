from fastapi import APIRouter, HTTPException, Response, Depends
from app.models.user import UserLogin, UserCreate, UserPublic, UserInDB, TokenPayload
from app.services.auth_service import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
    require_admin,
)
from app.database import get_db
from datetime import datetime

router = APIRouter()


@router.post("/login")
async def login(credentials: UserLogin, response: Response):
    db = get_db()
    user = await db.users.find_one({"email_address": credentials.email_address})

    if not user or not verify_password(credentials.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="Account is deactivated")

    token = create_access_token(user["user_id"], user["role_id"])

    response.set_cookie(
        key="lissa_token",
        value=token,
        httponly=True,
        samesite="strict",
        max_age=60 * 60 * 24,  # 24 hours
        secure=False,          # Set to True in production (HTTPS)
    )

    return {
        "message": "Login successful",
        "role": user["role_id"],
        "full_name": user["full_name"],
    }


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("lissa_token")
    return {"message": "Logged out successfully"}


@router.get("/me")
async def get_me(current_user: TokenPayload = Depends(get_current_user)):
    db = get_db()
    user = await db.users.find_one(
        {"user_id": current_user.user_id},
        {"_id": 0, "password_hash": 0},  # Exclude sensitive fields
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.post("/register")
async def register(data: UserCreate):
    """
    Student self-registration.
    Admins can only be created via the seed script or by another admin.
    """
    db = get_db()

    # Check duplicate email
    existing = await db.users.find_one({"email_address": data.email_address})
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    # Students can only register as students
    user = UserInDB(
        full_name=data.full_name,
        email_address=data.email_address,
        password_hash=hash_password(data.password),
        role_id="student",
    )

    await db.users.insert_one(user.model_dump())
    return {"message": "Account created successfully", "user_id": user.user_id}


@router.get("/users", response_model=list[UserPublic])
async def list_users(current_user: TokenPayload = Depends(get_current_user)):
    """Admin-only: list all registered users."""
    require_admin(current_user)
    db = get_db()
    cursor = db.users.find({}, {"_id": 0, "password_hash": 0})
    return await cursor.to_list(length=100)
