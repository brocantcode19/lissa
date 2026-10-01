"""
Ingestion Service — the pipeline that turns a PDF into searchable vectors.

Flow:
  PDF file → extract text → split into chunks → embed → upsert to Qdrant
"""
import asyncio
import uuid
import pdfplumber
from app.services.rag_service import embed_texts
from app.database import get_qdrant, get_db
from app.config import settings
from qdrant_client.models import PointStruct
from datetime import datetime

# ── Chunking config (matches thesis: 1000 chars, 200 overlap) ─────────────────
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 200


# ── Step 1: Extract text from PDF ─────────────────────────────────────────────
def extract_text(file_path: str) -> str:
    """Extract all text from a PDF file using pdfplumber."""
    full_text = ""
    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                full_text += page_text + "\n"
    return full_text.strip()


# ── Step 2: Split text into overlapping chunks ─────────────────────────────────
def chunk_text(text: str) -> list[str]:
    """
    Split text into overlapping chunks of CHUNK_SIZE characters.
    Overlap prevents answers from being cut off at chunk boundaries.
    """
    chunks = []
    start = 0
    text_len = len(text)

    while start < text_len:
        end = min(start + CHUNK_SIZE, text_len)
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        # Move forward by (CHUNK_SIZE - CHUNK_OVERLAP) to create the overlap
        start += CHUNK_SIZE - CHUNK_OVERLAP

    return chunks


# ── Step 3: Synchronous CPU/vector pipeline ────────────────────────────────────
def index_document_sync(doc_id: str, file_path: str, filename: str) -> int:
    """Extract, embed, and index one document without touching async services."""
    text = extract_text(file_path)

    # Clean PDF artifacts before chunking so Qdrant stores clean text.
    import re
    text = re.sub(r'\(cid:\d+\)', '', text)
    text = re.sub(r'\s{2,}', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)

    if not text:
        raise ValueError("No text could be extracted from the PDF.")

    chunks = chunk_text(text)
    if not chunks:
        raise ValueError("Document produced no chunks after splitting.")

    vectors = embed_texts(chunks)
    points = [
        PointStruct(
            id=str(uuid.uuid4()),
            vector=vector,
            payload={
                "doc_id": doc_id,
                "filename": filename,
                "chunk_index": i,
                "text": chunk,
            },
        )
        for i, (chunk, vector) in enumerate(zip(chunks, vectors))
    ]

    get_qdrant().upsert(
        collection_name=settings.QDRANT_COLLECTION,
        points=points,
    )
    return len(chunks)


# ── Step 4: Async pipeline wrapper ────────────────────────────────────────────
async def ingest_document(doc_id: str, file_path: str, filename: str) -> int:
    """Run indexing off the event loop and persist its final document status."""
    db = get_db()
    await db.documents.update_one(
        {"doc_id": doc_id},
        {"$set": {"status": "processing", "updated_at": datetime.utcnow()}},
    )

    try:
        chunk_count = await asyncio.to_thread(
            index_document_sync, doc_id, file_path, filename
        )
        await db.documents.update_one(
            {"doc_id": doc_id},
            {
                "$set": {
                    "status": "indexed",
                    "chunk_count": chunk_count,
                    "updated_at": datetime.utcnow(),
                }
            },
        )
        print(f"✅ Indexed '{filename}' → {chunk_count} chunks")
        return chunk_count
    except Exception as e:
        await db.documents.update_one(
            {"doc_id": doc_id},
            {"$set": {"status": "failed", "error": str(e), "updated_at": datetime.utcnow()}},
        )
        raise


# ── Delete a document from Qdrant ─────────────────────────────────────────────
async def delete_document_vectors(doc_id: str):
    """Remove all Qdrant vectors that belong to a document."""
    from qdrant_client.models import Filter, FieldCondition, MatchValue

    qdrant = get_qdrant()
    qdrant.delete(
        collection_name=settings.QDRANT_COLLECTION,
        points_selector=Filter(
            must=[FieldCondition(key="doc_id", match=MatchValue(value=doc_id))]
        ),
    )
