from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime, timezone
import uuid


class QueryRequest(BaseModel):
    question: str = Field(
        ...,
        min_length=5,
        max_length=500,
        description="Student question — 5 to 500 characters",
    )
    session_id: Optional[str] = None  # groups questions into one conversation


class QueryResponse(BaseModel):
    inquiry_id: str
    question: str
    answer: str
    confidence: float
    confidence_label: str
    source_filename: Optional[str]
    context: Optional[str]
    escalated: bool
    session_id: Optional[str] = None


class InquiryInDB(BaseModel):
    inquiry_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    session_id: Optional[str] = None   # groups Q&As into one session
    user_id: str
    question: str
    answer: str
    confidence: float
    source_filename: Optional[str] = None
    escalated: bool = False
    feedback: Optional[int] = None     # 1 = thumbs up, -1 = thumbs down
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
