"""
Run this ONCE after docker compose up to create the initial admin account.

Usage (from project root):
  docker compose exec backend python scripts/seed_db.py
"""
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from datetime import datetime
import uuid

MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017/lissa")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


async def seed():
    print(f"Connecting to MongoDB at: {MONGODB_URL}")
    client = AsyncIOMotorClient(MONGODB_URL)
    db = client["lissa"]

    # ── Admin account ──────────────────────────────────────────────────────────
    admin_email = "admin@liceo.edu.ph"
    existing = await db.users.find_one({"email_address": admin_email})

    if existing:
        print(f"⚠️  Admin already exists: {admin_email}")
    else:
        admin = {
            "user_id": str(uuid.uuid4()),
            "full_name": "LISSA Administrator",
            "email_address": admin_email,
            "password_hash": pwd_context.hash("Admin@1234"),
            "role_id": "admin",
            "is_active": True,
            "created_at": datetime.utcnow(),
            "updated_at": None,
        }
        await db.users.insert_one(admin)
        print("✅ Admin account created:")
        print(f"   Email    : {admin_email}")
        print(f"   Password : Admin@1234")
        print("   ⚠️  Change this password after first login!")

    # ── Demo student account ───────────────────────────────────────────────────
    student_email = "student@liceo.edu.ph"
    existing_s = await db.users.find_one({"email_address": student_email})

    if existing_s:
        print(f"⚠️  Demo student already exists: {student_email}")
    else:
        student = {
            "user_id": str(uuid.uuid4()),
            "full_name": "Demo Student",
            "email_address": student_email,
            "password_hash": pwd_context.hash("Student@1234"),
            "role_id": "student",
            "is_active": True,
            "created_at": datetime.utcnow(),
            "updated_at": None,
        }
        await db.users.insert_one(student)
        print("✅ Demo student account created:")
        print(f"   Email    : {student_email}")
        print(f"   Password : Student@1234")

    # ── MongoDB indexes ────────────────────────────────────────────────────────
    await db.users.create_index("email_address", unique=True)
    await db.users.create_index("user_id", unique=True)
    print("✅ Database indexes created")

    client.close()
    print("\n🎉 Seed complete! You can now log in to LISSA.")


if __name__ == "__main__":
    asyncio.run(seed())
