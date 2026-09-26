from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # JWT
    JWT_SECRET: str = "dev-secret-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 1440

    # MongoDB
    MONGODB_URL: str = "mongodb://mongodb:27017/lissa"

    # Qdrant
    QDRANT_URL: str = "http://qdrant:6333"
    QDRANT_API_KEY: str = ""
    QDRANT_COLLECTION: str = "lissa-kb"

    # App
    FRONTEND_URL: str = "http://localhost:3000"
    ENVIRONMENT: str = "development"

    # Groq API
    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "openai/gpt-oss-120b"

    # Rate limiting
    RATE_LIMIT_QUERIES_PER_MINUTE: int = 10
    RATE_LIMIT_QUERIES_PER_DAY: int = 100
    RATE_LIMIT_AUTH_PER_MINUTE: int = 5
    RATE_LIMIT_UPLOAD_PER_DAY: int = 20

    # Modern Pydantic V2 settings configuration
    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
        case_sensitive=True
    )

    @property
    def clean_frontend_url(self) -> str:
        """Returns FRONTEND_URL without any trailing slashes for CORS matching."""
        return self.FRONTEND_URL.rstrip("/")


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()