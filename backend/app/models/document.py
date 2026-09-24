from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import datetime
import uuid


class DocumentInDB(BaseModel):
    doc_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    filename: str
    file_path: str
    uploaded_by: str
    status: Literal["pending", "processing", "indexed", "failed"] = "pending"
    chunk_count: Optional[int] = None
    error: Optional[str] = None
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: Optional[datetime] = None


class DocumentPublic(BaseModel):
    doc_id: str
    filename: str
    status: str
    chunk_count: Optional[int]
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime]