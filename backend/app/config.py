from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # JWT
    JWT_SECRET: str = "dev-secret-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 1440

    # MongoDB
    MONGODB_URL: str = "mongodb://mongodb:27017/lissa"

    # Qdrant
    QDRANT_URL: str = "http://qdrant:6333"
    QDRANT_API_KEY:    str = ""
    QDRANT_COLLECTION: str = "lissa-kb"

    # App
    FRONTEND_URL: str = "http://localhost:3000"
    ENVIRONMENT: str = "development"

    # ── Groq API ──────────────────────────────────────────────────────────────
    # Get your free key at: https://console.groq.com
    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "openai/gpt-oss-120b"

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
