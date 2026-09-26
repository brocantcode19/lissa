from contextlib import asynccontextmanager
import os
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from app.config import settings
from app.database import connect_mongodb, disconnect_mongodb, connect_qdrant, get_db
from app.services.rag_service import load_models


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ───────────────────────────────────────────────────────────────
    print("🚀 LISSA API starting up...")
    # Optional: allow skipping external service startup for local testing
    if os.getenv("SKIP_STARTUP", "false").lower() in ("1", "true", "yes"):
        print("⚠ SKIP_STARTUP set — skipping MongoDB, Qdrant and ML model startup (dev mode)")
    else:
        await connect_mongodb()
        await get_db().failed_logins.create_index(
            "timestamp", expireAfterSeconds=900
        )
        await connect_qdrant()
        load_models()          # loads all-MiniLM-L6-v2 + roberta-base-squad2
    print("✅ All systems ready. LISSA is online.")
    yield
    # ── Shutdown ──────────────────────────────────────────────────────────────
    await disconnect_mongodb()
    print("LISSA API shut down.")


app = FastAPI(
    title="LISSA API",
    description="Liceo Information Student Support Assistant — Backend API",
    version="2.0.0",
    lifespan=lifespan,
)

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter


async def rate_limit_exceeded_handler(
    request: Request, exc: RateLimitExceeded
):
    retry_after = request.headers.get("Retry-After")
    detail = "Rate limit exceeded."
    if retry_after:
        detail = f"Rate limit exceeded. Try again in {retry_after} seconds."
    return JSONResponse(status_code=429, content={"detail": detail})


app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

from app.routers import auth, documents, query

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ────────────────────────────────────────────────────────────────────
app.include_router(auth.router,      prefix="/api/auth",      tags=["Authentication"])
app.include_router(documents.router, prefix="/api/documents", tags=["Documents"])
app.include_router(query.router,     prefix="/api/query",     tags=["Query"])


@app.get("/health", tags=["Health"])
async def health():
    return {
        "status": "ok",
        "service": "LISSA API",
        "version": "2.0.0",
        "environment": settings.ENVIRONMENT,
    }
