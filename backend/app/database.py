from motor.motor_asyncio import AsyncIOMotorClient
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams
from app.config import settings

# ── MongoDB ────────────────────────────────────────────────────────────────────
mongo_client: AsyncIOMotorClient = None


def get_mongo_client() -> AsyncIOMotorClient:
    return mongo_client


def get_db():
    return mongo_client[settings.MONGODB_URL.split("/")[-1]]  # extracts "lissa"


async def connect_mongodb():
    global mongo_client
    mongo_client = AsyncIOMotorClient(settings.MONGODB_URL)
    # Ping to verify connection
    await mongo_client.admin.command("ping")
    print("✅ MongoDB connected")


async def disconnect_mongodb():
    global mongo_client
    if mongo_client:
        mongo_client.close()
        print("MongoDB disconnected")


# ── Qdrant ─────────────────────────────────────────────────────────────────────
qdrant_client: QdrantClient = None


def get_qdrant() -> QdrantClient:
    return qdrant_client


async def connect_qdrant():
    global qdrant_client
    qdrant_client = QdrantClient(url=settings.QDRANT_URL)

    # Create the knowledge base collection if it doesn't exist yet
    existing = [c.name for c in qdrant_client.get_collections().collections]
    if settings.QDRANT_COLLECTION not in existing:
        qdrant_client.create_collection(
            collection_name=settings.QDRANT_COLLECTION,
            vectors_config=VectorParams(
                size=384,           # all-MiniLM-L6-v2 output dimension
                distance=Distance.COSINE,
            ),
        )
        print(f"✅ Qdrant collection '{settings.QDRANT_COLLECTION}' created")
    else:
        print(f"✅ Qdrant collection '{settings.QDRANT_COLLECTION}' ready")
