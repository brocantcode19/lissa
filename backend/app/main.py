from contextlib import asynccontextmanager
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.database import connect_mongodb, disconnect_mongodb, connect_qdrant
from app.services.rag_service import load_models
from app.routers import auth, documents, query


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ───────────────────────────────────────────────────────────────
    print("🚀 LISSA API starting up...")
    # Optional: allow skipping external service startup for local testing
    if os.getenv("SKIP_STARTUP", "false").lower() in ("1", "true", "yes"):
        print("⚠ SKIP_STARTUP set — skipping MongoDB, Qdrant and ML model startup (dev mode)")
    else:
        await connect_mongodb()
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
