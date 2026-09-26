from fastapi import APIRouter, HTTPException, Response, Depends, Request
from app.main import limiter
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


async def record_failed_login(ip: str, db) -> int:
    """Record a failed login and return failures from the last 15 minutes."""
    from datetime import timedelta, timezone

    now = datetime.now(timezone.utc)
    await db.failed_logins.insert_one({
        "ip": ip,
        "timestamp": now,
    })
    fifteen_min_ago = now - timedelta(minutes=15)
    return await db.failed_logins.count_documents({
        "ip": ip,
        "timestamp": {"$gte": fifteen_min_ago},
    })


@router.post("/login")
@limiter.limit("5/minute")
@limiter.limit("20/day")
async def login(request: Request, credentials: UserLogin, response: Response):
    db = get_db()
    user = await db.users.find_one({"email_address": credentials.email_address})

    if not user or not verify_password(credentials.password, user["password_hash"]):
        request_ip = request.client.host if request.client else "unknown"
        failures = await record_failed_login(request_ip, db)
        if failures >= 10:
            raise HTTPException(
                status_code=429,
                detail=(
                    "Too many failed login attempts. "
                    "Please wait 15 minutes before trying again."
                ),
            )
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
@limiter.limit("3/minute")
@limiter.limit("10/day")
async def register(request: Request, data: UserCreate):
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
