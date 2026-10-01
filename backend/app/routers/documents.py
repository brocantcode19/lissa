import os
import shutil
import uuid
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, BackgroundTasks
from app.models.document import DocumentInDB, DocumentPublic
from app.models.user import TokenPayload
from app.services.auth_service import get_current_user, require_admin
from app.services.ingestion_service import ingest_document, delete_document_vectors
from app.database import get_db
from datetime import datetime

router = APIRouter()

UPLOAD_DIR = "/app/uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)


def process_document_background(doc_id: str, file_path: str, filename: str):
    try:
        ingest_document(doc_id, file_path, filename)
    except Exception:
        db = get_db()
        db.documents.update_one(
            {"doc_id": doc_id},
            {"$set": {"status": "failed", "updated_at": datetime.utcnow()}},
        )
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)


@router.post("", response_model=dict)
@router.post("/", response_model=dict)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    current_user: TokenPayload = Depends(get_current_user),
):
    """
    Accept a document immediately and process it in the background so the API
    responds in under a second and avoids proxy timeouts.
    """
    require_admin(current_user)

    allowed_ext = (".pdf", ".txt", ".md")
    if not file.filename or not file.filename.lower().endswith(allowed_ext):
        raise HTTPException(status_code=400, detail="Unsupported file format.")

    doc_id = str(uuid.uuid4())
    safe_name = file.filename.replace(" ", "_")
    file_path = os.path.join(UPLOAD_DIR, f"{doc_id}_{safe_name}")

    with open(file_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    doc = DocumentInDB(
        doc_id=doc_id,
        filename=file.filename,
        file_path=file_path,
        uploaded_by=current_user.user_id,
        status="processing",
    )
    db = get_db()
    await db.documents.insert_one(doc.model_dump())

    background_tasks.add_task(process_document_background, doc_id, file_path, file.filename)

    return {
        "message": "Document uploaded successfully. Indexing is running in the background.",
        "document_id": doc_id,
        "filename": file.filename,
        "status": "processing",
    }


@router.get("/", response_model=list[DocumentPublic])
async def list_documents(current_user: TokenPayload = Depends(get_current_user)):
    """List all documents in the knowledge base. Accessible to all logged-in users."""
    db = get_db()
    cursor = db.documents.find({}, {"_id": 0})
    docs = await cursor.to_list(length=200)
    return docs


@router.delete("/{doc_id}")
async def delete_document(
    doc_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Admin-only: remove a document and all its vectors from Qdrant."""
    require_admin(current_user)

    db = get_db()
    doc = await db.documents.find_one({"doc_id": doc_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    # Remove vectors from Qdrant
    await delete_document_vectors(doc_id)

    # Remove file from disk
    if os.path.exists(doc["file_path"]):
        os.remove(doc["file_path"])

    # Remove MongoDB record
    await db.documents.delete_one({"doc_id": doc_id})

    return {"message": f"Document '{doc['filename']}' deleted successfully."}


@router.patch("/{doc_id}/toggle")
async def toggle_document(
    doc_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Admin-only: activate or deactivate a document (excluded from search when inactive)."""
    require_admin(current_user)

    db = get_db()
    doc = await db.documents.find_one({"doc_id": doc_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    new_state = not doc.get("is_active", True)
    await db.documents.update_one(
        {"doc_id": doc_id},
        {"$set": {"is_active": new_state, "updated_at": datetime.utcnow()}},
    )

    return {"doc_id": doc_id, "is_active": new_state}
