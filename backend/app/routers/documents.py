import os
import uuid
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, BackgroundTasks, Request
from app.main import limiter
from app.models.document import DocumentInDB, DocumentPublic
from app.models.user import TokenPayload
from app.services.auth_service import get_current_user, require_admin
from app.services.ingestion_service import ingest_document, delete_document_vectors
from app.database import get_db
from datetime import datetime

router = APIRouter()

UPLOAD_DIR = "/app/uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)


@router.post("/", response_model=DocumentPublic)
@limiter.limit("5/hour")
@limiter.limit("20/day")
async def upload_document(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    current_user: TokenPayload = Depends(get_current_user),
):
    """
    Admin-only: upload a PDF to the knowledge base.
    The file is saved and ingestion runs in the background
    so the response returns immediately.
    """
    require_admin(current_user)

    # Validate file type
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    # Save file to disk
    doc_id = str(uuid.uuid4())
    safe_name = file.filename.replace(" ", "_")
    file_path = os.path.join(UPLOAD_DIR, f"{doc_id}_{safe_name}")

    contents = await file.read()
    with open(file_path, "wb") as f:
        f.write(contents)

    # Create MongoDB record
    doc = DocumentInDB(
        doc_id=doc_id,
        filename=file.filename,
        file_path=file_path,
        uploaded_by=current_user.user_id,
        status="pending",
    )
    db = get_db()
    await db.documents.insert_one(doc.model_dump())

    # Run ingestion in the background (non-blocking)
    background_tasks.add_task(ingest_document, doc_id, file_path, file.filename)

    return DocumentPublic(**doc.model_dump())


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
