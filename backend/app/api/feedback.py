from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin
from app.models import UserFeedback
from app.schemas import UserFeedbackCreate

router = APIRouter(prefix="/api/feedback", tags=["feedback"])


@router.post("")
def create_feedback(payload: UserFeedbackCreate, db: Session = Depends(get_db)) -> dict:
    feedback = UserFeedback(
        rating=payload.rating,
        content=payload.content.strip(),
        page_path=payload.page_path.strip(),
    )
    db.add(feedback)
    db.commit()
    db.refresh(feedback)
    return {
        "id": feedback.id,
        "rating": feedback.rating,
        "content": feedback.content,
        "created_at": feedback.created_at.isoformat(),
    }


@router.get("", dependencies=[Depends(require_admin)])
def list_feedback(db: Session = Depends(get_db)) -> dict:
    items = db.scalars(
        select(UserFeedback).order_by(UserFeedback.created_at.desc(), UserFeedback.id.desc()),
    ).all()
    return {
        "items": [
            {
                "id": item.id,
                "rating": item.rating,
                "content": item.content,
                "created_at": item.created_at.isoformat(),
            }
            for item in items
        ],
        "total": len(items),
    }
