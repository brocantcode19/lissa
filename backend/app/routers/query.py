import json
import uuid as uuid_lib
import asyncio
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import StreamingResponse
from app.main import limiter
from app.models.query import QueryRequest, QueryResponse, InquiryInDB
from app.models.user import TokenPayload
from app.services.auth_service import get_current_user, require_admin
from app.services.rag_service import (
    embed_query, generate_answer, stream_answer_async,
    rerank_chunks, is_in_scope, FALLBACK_PHRASES, sanitize_question
)
from app.database import get_qdrant, get_db
from app.config import settings
from qdrant_client.models import Filter, FieldCondition, MatchAny
from pydantic import BaseModel

router = APIRouter()
logger = logging.getLogger("lissa.usage")

CONFIDENCE_THRESHOLD = 0.50

OUT_OF_SCOPE_MESSAGE = (
    "I'm LISSA, and I'm only able to answer questions related to "
    "Liceo de Cagayan University — such as enrollment, scholarships, "
    "academic schedules, and registrar procedures. "
    "For other topics, please consult the appropriate resources."
)


def confidence_label(score: float) -> str:
    if score >= 0.80: return "high"
    if score >= 0.50: return "medium"
    return "low"


def serialize_datetime(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


async def check_user_daily_limit(
    user_id: str, db, limit: int = 100
) -> bool:
    """
    Returns True if the user is within their daily question limit.
    Out-of-scope rejections are excluded from the count.
    """
    today_start = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    count = await db.inquiries.count_documents({
        "user_id": user_id,
        "created_at": {"$gte": today_start},
        "out_of_scope": {"$ne": True},
    })
    return count < limit


async def check_abnormal_usage(user_id: str, db) -> None:
    """
    Logs a warning if usage looks like a bot or abuse.
    This check is fire-and-forget and does not block the response.
    """
    from datetime import timedelta

    now = datetime.now(timezone.utc)

    ten_min_ago = now - timedelta(minutes=10)
    burst = await db.inquiries.count_documents({
        "user_id": user_id,
        "created_at": {"$gte": ten_min_ago},
    })
    if burst > 20:
        logger.warning(
            f"BURST ALERT: user {user_id} sent "
            f"{burst} questions in 10 minutes. "
            f"Possible bot or abuse."
        )

    today_start = now.replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    daily = await db.inquiries.count_documents({
        "user_id": user_id,
        "created_at": {"$gte": today_start},
    })
    if daily > 80:
        logger.warning(
            f"NEAR-CAP ALERT: user {user_id} has "
            f"{daily} questions today. Approaching "
            f"daily limit of {settings.RATE_LIMIT_QUERIES_PER_DAY}."
        )


async def _retrieve_chunks(question: str, db, qdrant):
    """Shared retrieval logic used by both stream and non-stream endpoints."""
    try:
        query_vector = embed_query(question)
    except Exception as error:
        # Fail closed because retrieval cannot safely provide grounded context.
        print(f"_retrieve_chunks: embedding failed: {error}")
        raise HTTPException(
            status_code=503,
            detail="LISSA is temporarily unavailable. Please try again in a moment.",
        )

    active_docs  = await db.documents.distinct(
        "doc_id", {"is_active": True, "status": "indexed"}
    )
    if not active_docs:
        return None, None, None, None

    try:
        search_results = qdrant.search(
            collection_name=settings.QDRANT_COLLECTION,
            query_vector=query_vector,
            limit=7,
            query_filter=Filter(
                must=[FieldCondition(
                    key="doc_id",
                    match=MatchAny(any=active_docs),
                )]
            ),
        ),
    except Exception as error:
        # Fail closed because an unavailable knowledge base cannot ground an answer.
        print(f"_retrieve_chunks: Qdrant search failed: {error}")
        raise HTTPException(
            status_code=503,
            detail=(
                "The knowledge base is temporarily unavailable. "
                "Please try again in a moment."
            ),
        )

    if not search_results:
        raise HTTPException(
            status_code=404,
            detail=(
                "No relevant information found for your question. "
                "Please try rephrasing or contact the university office directly."
            ),
        )

    chunks          = rerank_chunks(question, [h.payload["text"] for h in search_results])
    source_filename = search_results[0].payload.get("filename")
    return chunks, source_filename, active_docs, search_results


# ── Standard (non-streaming) endpoint ─────────────────────────────────────────
@router.post("/", response_model=QueryResponse)
@limiter.limit("10/minute")
@limiter.limit("100/day")
async def ask(
    request: Request,
    body: QueryRequest,
    current_user: TokenPayload = Depends(get_current_user),
):
    clean_question = sanitize_question(body.question)
    db     = get_db()
    qdrant = get_qdrant()

    in_scope, _ = is_in_scope(clean_question)
    if not in_scope:
        inquiry = InquiryInDB(
            session_id=body.session_id,
            user_id=current_user.user_id,
            question=body.question,
            answer=OUT_OF_SCOPE_MESSAGE,
            confidence=0.0, source_filename=None, escalated=False,
        )
        try:
            await db.inquiries.insert_one({**inquiry.model_dump(), "out_of_scope": True})
        except Exception as error:
            print(f"ask: failed to log out-of-scope inquiry: {error}")
        else:
            asyncio.create_task(
                check_abnormal_usage(current_user.user_id, db)
            )
        return QueryResponse(
            inquiry_id=inquiry.inquiry_id, question=body.question,
            answer=OUT_OF_SCOPE_MESSAGE, confidence=0.0,
            confidence_label="out_of_scope", source_filename=None,
            context=None, escalated=False, session_id=body.session_id,
        )

    within_limit = await check_user_daily_limit(
        current_user.user_id, db,
        limit=settings.RATE_LIMIT_QUERIES_PER_DAY,
    )
    if not within_limit:
        raise HTTPException(
            status_code=429,
            detail=(
                f"You have reached your daily limit of "
                f"{settings.RATE_LIMIT_QUERIES_PER_DAY} "
                f"questions. Your limit resets at midnight. "
                f"Please try again tomorrow."
            ),
        )

    chunks, source_filename, _, search_results = await _retrieve_chunks(clean_question, db, qdrant)
    if not chunks:
        raise HTTPException(status_code=503, detail="Knowledge base is empty.")

    if search_results:
        top_score = search_results[0].score
        retrieval_confidence = min(float(top_score), 1.0)
        base_confidence = round(
            (retrieval_confidence * 0.7) + (0.85 * 0.3), 4
        )
    else:
        base_confidence = 0.0

    result     = await generate_answer(clean_question, chunks)
    answer     = result["answer"]
    is_fallback = any(p in answer.lower() for p in FALLBACK_PHRASES)
    confidence  = 0.0 if is_fallback else base_confidence
    escalated   = confidence < CONFIDENCE_THRESHOLD

    inquiry = InquiryInDB(
        session_id=body.session_id,
        user_id=current_user.user_id,
        question=body.question,
        answer=answer,
        confidence=confidence,
        source_filename=source_filename,
        escalated=escalated,
    )
    try:
        await db.inquiries.insert_one(inquiry.model_dump())
    except Exception as error:
        # Continue because logging failure must not withhold the answer.
        print(f"ask: failed to log inquiry: {error}")
    else:
        asyncio.create_task(
            check_abnormal_usage(current_user.user_id, db)
        )

    return QueryResponse(
        inquiry_id=inquiry.inquiry_id, question=body.question,
        answer=answer, confidence=confidence,
        confidence_label=confidence_label(confidence),
        source_filename=source_filename, context=None,
        escalated=escalated, session_id=body.session_id,
    )


# ── Streaming endpoint ─────────────────────────────────────────────────────────
@router.post("/stream")
@limiter.limit("10/minute")
@limiter.limit("100/day")
async def ask_stream(
    request: Request,
    body: QueryRequest,
    current_user: TokenPayload = Depends(get_current_user),
):
    """
    Streaming version — returns Server-Sent Events (SSE).
    Frontend reads tokens as they arrive and appends them to the message bubble.

    SSE format:
      data: {"token": "The"}
      data: {"token": " late"}
      data: {"token": " enrollment..."}
      data: {"done": true, "inquiry_id": "...", "confidence": 0.85, ...}
    """
    clean_question = sanitize_question(body.question)
    db     = get_db()
    qdrant = get_qdrant()

    in_scope, _ = is_in_scope(clean_question)

    if not in_scope:
        # Stream the out-of-scope message then done
        inquiry = InquiryInDB(
            session_id=body.session_id,
            user_id=current_user.user_id,
            question=body.question,
            answer=OUT_OF_SCOPE_MESSAGE,
            confidence=0.0, source_filename=None, escalated=False,
        )
        try:
            await db.inquiries.insert_one({**inquiry.model_dump(), "out_of_scope": True})
        except Exception as error:
            print(f"ask_stream: failed to log out-of-scope inquiry: {error}")
        else:
            asyncio.create_task(
                check_abnormal_usage(current_user.user_id, db)
            )

        async def scope_stream():
            yield f"data: {json.dumps({'token': OUT_OF_SCOPE_MESSAGE})}\n\n"
            yield f"data: {json.dumps({'done': True, 'inquiry_id': inquiry.inquiry_id, 'confidence': 0.0, 'confidence_label': 'out_of_scope', 'source_filename': None, 'escalated': False, 'session_id': body.session_id})}\n\n"

        return StreamingResponse(
            scope_stream(), media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    within_limit = await check_user_daily_limit(
        current_user.user_id, db,
        limit=settings.RATE_LIMIT_QUERIES_PER_DAY,
    )
    if not within_limit:
        raise HTTPException(
            status_code=429,
            detail=(
                f"You have reached your daily limit of "
                f"{settings.RATE_LIMIT_QUERIES_PER_DAY} "
                f"questions. Your limit resets at midnight. "
                f"Please try again tomorrow."
            ),
        )

    chunks, source_filename, _, search_results = await _retrieve_chunks(clean_question, db, qdrant)
    if not chunks:
        raise HTTPException(status_code=503, detail="Knowledge base is empty.")

    if search_results:
        top_score = search_results[0].score
        retrieval_confidence = min(float(top_score), 1.0)
        base_confidence = round(
            (retrieval_confidence * 0.7) + (0.85 * 0.3), 4
        )
    else:
        base_confidence = 0.0

    # Pre-assign inquiry ID so we can reference it in the done event
    inquiry_id = str(uuid_lib.uuid4())

    async def generate():
        full_answer = ""

        # Stream tokens from Groq
        async for token in stream_answer_async(clean_question, chunks):
            full_answer += token
            # Escape the token for JSON safety
            yield f"data: {json.dumps({'token': token})}\n\n"

        # Determine final metadata
        is_fallback = any(p in full_answer.lower() for p in FALLBACK_PHRASES)
        confidence  = 0.0 if is_fallback else base_confidence
        escalated   = confidence < CONFIDENCE_THRESHOLD

        # Log the complete answer to MongoDB
        inquiry = InquiryInDB(
            inquiry_id=inquiry_id,
            session_id=body.session_id,
            user_id=current_user.user_id,
            question=body.question,
            answer=full_answer,
            confidence=confidence,
            source_filename=source_filename,
            escalated=escalated,
        )
        try:
            await db.inquiries.insert_one(inquiry.model_dump())
        except Exception as error:
            # Continue streaming completion because logging is non-critical.
            print(f"ask_stream: failed to log inquiry: {error}")
        else:
            asyncio.create_task(
                check_abnormal_usage(current_user.user_id, db)
            )

        # Send completion event with all metadata the frontend needs
        yield f"data: {json.dumps({'done': True, 'inquiry_id': inquiry_id, 'confidence': confidence, 'confidence_label': confidence_label(confidence), 'source_filename': source_filename, 'escalated': escalated, 'session_id': body.session_id})}\n\n"

    return StreamingResponse(
        generate(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Sessions history ───────────────────────────────────────────────────────────
@router.get("/my-sessions")
async def my_sessions(current_user: TokenPayload = Depends(get_current_user)):
    """
    Returns the current user's inquiries grouped by session_id.
    Each session shows: title (first question), count, latest timestamp.
    The frontend uses this to build the chat history sidebar.
    """
    db = get_db()

    pipeline = [
        {"$match": {"user_id": current_user.user_id}},
        {"$sort":  {"created_at": 1}},
        {"$group": {
            "_id":        "$session_id",
            "title":      {"$first": "$question"},
            "count":      {"$sum": 1},
            "created_at": {"$last": "$created_at"},
            "inquiries":  {"$push": {
                "inquiry_id":    "$inquiry_id",
                "question":      "$question",
                "answer":        "$answer",
                "confidence":    "$confidence",
                "source_filename":"$source_filename",
                "escalated":     "$escalated",
                "feedback":      "$feedback",
                "created_at":    "$created_at",
            }},
        }},
        {"$sort":  {"created_at": -1}},
        {"$limit": 30},
    ]

    sessions = await db.inquiries.aggregate(pipeline).to_list(length=30)

    # Serialize datetime fields
    for s in sessions:
        if s.get("created_at"):
            s["created_at"] = serialize_datetime(s["created_at"])
        for inq in s.get("inquiries", []):
            if inq.get("created_at"):
                inq["created_at"] = serialize_datetime(inq["created_at"])
        s["session_id"] = s.pop("_id")

    return sessions


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Student can delete all inquiries belonging to an owned session."""
    db = get_db()
    result = await db.inquiries.delete_many({
        "session_id": session_id,
        "user_id": current_user.user_id,
    })
    if result.deleted_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Session not found or already deleted.",
        )
    return {
        "message": f"Session deleted. {result.deleted_count} inquiries removed."
    }


# ── Student own history (flat list — kept for evaluate.py) ────────────────────
@router.get("/my-history")
async def my_inquiry_history(current_user: TokenPayload = Depends(get_current_user)):
    db = get_db()
    cursor = db.inquiries.find(
        {"user_id": current_user.user_id}, {"_id": 0}
    ).sort("created_at", -1).limit(50)
    return await cursor.to_list(length=50)


# ── Admin: full history ────────────────────────────────────────────────────────
@router.get("/history")
async def inquiry_history(current_user: TokenPayload = Depends(get_current_user)):
    require_admin(current_user)
    db = get_db()

    pipeline = [
        {"$sort": {"created_at": 1}},
        {"$lookup": {
            "from": "users",
            "localField": "user_id",
            "foreignField": "user_id",
            "as": "student",
        }},
        {"$set": {
            "full_name": {"$arrayElemAt": ["$student.full_name", 0]},
            "email_address": {"$arrayElemAt": ["$student.email_address", 0]},
        }},
        {"$group": {
            "_id": "$session_id",
            "session_title": {"$first": "$question"},
            "session_size": {"$sum": 1},
            "inquiries": {"$push": {
                "inquiry_id": "$inquiry_id",
                "session_id": "$session_id",
                "user_id": "$user_id",
                "question": "$question",
                "answer": "$answer",
                "confidence": "$confidence",
                "source_filename": "$source_filename",
                "escalated": "$escalated",
                "feedback": "$feedback",
                "created_at": "$created_at",
                "full_name": "$full_name",
                "email_address": "$email_address",
            }},
        }},
        {"$unwind": {"path": "$inquiries", "includeArrayIndex": "session_position"}},
        {"$replaceWith": {"$mergeObjects": [
            "$inquiries",
            {
                "session_title": "$session_title",
                "session_size": "$session_size",
                "session_position": "$session_position",
                "is_session_start": {"$eq": ["$session_position", 0]},
            },
        ]}},
        {"$sort": {"created_at": -1}},
        {"$limit": 200},
        {"$project": {"_id": 0}},
    ]

    inquiries = await db.inquiries.aggregate(pipeline).to_list(length=200)
    for inquiry in inquiries:
        if inquiry.get("created_at"):
            inquiry["created_at"] = serialize_datetime(inquiry["created_at"])
    return inquiries


# ── Admin: clear all ───────────────────────────────────────────────────────────
@router.delete("/clear")
async def clear_all_inquiries(current_user: TokenPayload = Depends(get_current_user)):
    require_admin(current_user)
    db     = get_db()
    result = await db.inquiries.delete_many({})
    return {"message": f"Deleted {result.deleted_count} inquiries."}


# ── Admin: delete one inquiry ────────────────────────────────────────────────
@router.delete("/{inquiry_id}")
async def delete_single_inquiry(
    inquiry_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """
    Admin-only: permanently delete a single inquiry by ID.
    Does not affect other inquiries in the same session.
    """
    from app.services.auth_service import require_admin
    require_admin(current_user)

    db = get_db()

    result = await db.inquiries.delete_one(
        {"inquiry_id": inquiry_id}
    )

    if result.deleted_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Inquiry not found."
        )

    return {
        "message": "Inquiry deleted successfully.",
        "inquiry_id": inquiry_id
    }


# ── Feedback ───────────────────────────────────────────────────────────────────
class FeedbackBody(BaseModel):
    vote: int

@router.post("/{inquiry_id}/feedback")
async def submit_feedback(
    inquiry_id: str,
    body: FeedbackBody,
    current_user: TokenPayload = Depends(get_current_user),
):
    if body.vote not in (1, -1):
        raise HTTPException(status_code=400, detail="Vote must be 1 or -1.")
    db     = get_db()
    result = await db.inquiries.update_one(
        {"inquiry_id": inquiry_id, "user_id": current_user.user_id},
        {"$set": {"feedback": body.vote}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Inquiry not found.")
    return {"message": "Feedback recorded."}


# ── Admin: usage statistics ───────────────────────────────────────────────────
@router.get("/usage-stats")
async def usage_stats(
    current_user: TokenPayload = Depends(get_current_user),
):
    """Admin only: today's usage summary."""
    require_admin(current_user)
    db = get_db()
    today = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )

    total = await db.inquiries.count_documents({
        "created_at": {"$gte": today},
    })
    scoped = await db.inquiries.count_documents({
        "created_at": {"$gte": today},
        "out_of_scope": True,
    })
    users = len(await db.inquiries.distinct(
        "user_id", {"created_at": {"$gte": today}}
    ))
    llm_calls = total - scoped

    return {
        "date": today.date().isoformat(),
        "total_queries_today": total,
        "out_of_scope_today": scoped,
        "unique_users_today": users,
        "llm_calls_today": llm_calls,
        "estimated_tokens": llm_calls * 585,
        "estimated_cost_usd": round(llm_calls * 0.00038, 4),
        "daily_limit_per_user": settings.RATE_LIMIT_QUERIES_PER_DAY,
    }
