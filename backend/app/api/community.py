from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_db, require_admin, require_visitor
from app.core.errors import ApiError
from app.models import (
    AppUser,
    CommunityPost,
    CommunityPostLike,
    ScenicSpot,
    TravelJournal,
    utc_now,
)
from app.schemas import CommunityPostCreate, CommunityPostModerate
from app.services.auth import AuthUser


router = APIRouter(prefix="/api/community", tags=["community"])


@router.get("/posts")
def list_community_posts(
    scope: Literal["all", "mine"] = Query(default="all"),
    sort: Literal["latest", "popular"] = Query(default="latest"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=12, ge=1, le=30),
    visitor: AuthUser = Depends(require_visitor),
    db: Session = Depends(get_db),
) -> dict:
    return _list_posts(
        db,
        viewer_id=visitor.id,
        scope=scope,
        sort=sort,
        page=page,
        page_size=page_size,
    )


@router.post("/posts")
def create_community_post(
    payload: CommunityPostCreate,
    visitor: AuthUser = Depends(require_visitor),
    db: Session = Depends(get_db),
) -> dict:
    content = payload.content.strip()
    if not content:
        raise ApiError("留言内容不能为空", "COMMUNITY_CONTENT_EMPTY", 400)

    author = db.get(AppUser, visitor.id)
    if not author or not author.is_active:
        raise ApiError("游客账号不可用", "VISITOR_ACCOUNT_INACTIVE", 403)

    spot = None
    if payload.spot_id:
        spot = db.get(ScenicSpot, payload.spot_id)
        if not spot:
            raise ApiError("关联景点不存在", "COMMUNITY_SPOT_NOT_FOUND", 404)

    post = CommunityPost(
        author_id=author.id,
        author_name=author.username,
        content=content,
        post_type="comment",
        spot_id=spot.id if spot else None,
        status="published",
    )
    db.add(post)
    db.commit()
    db.refresh(post)
    return _serialize_post(
        post,
        like_count=0,
        liked_by_me=False,
        viewer_id=visitor.id,
    )


@router.delete("/posts/{post_id}")
def delete_community_post(
    post_id: int,
    visitor: AuthUser = Depends(require_visitor),
    db: Session = Depends(get_db),
) -> dict:
    post = db.get(CommunityPost, post_id)
    if not post or post.status == "deleted":
        raise ApiError("留言不存在", "COMMUNITY_POST_NOT_FOUND", 404)
    if post.author_id != visitor.id:
        raise ApiError("只能删除自己的留言", "COMMUNITY_DELETE_FORBIDDEN", 403)

    if post.post_type == "travel_journal" and post.travel_journal_id:
        journal = db.get(TravelJournal, post.travel_journal_id)
        if journal and journal.visitor_id == visitor.id:
            journal.status = "draft"
            journal.updated_at = utc_now()
        post.travel_journal_id = None
    post.status = "deleted"
    post.updated_at = utc_now()
    db.commit()
    return {"status": "deleted", "id": post.id}


@router.post("/posts/{post_id}/like")
def like_community_post(
    post_id: int,
    visitor: AuthUser = Depends(require_visitor),
    db: Session = Depends(get_db),
) -> dict:
    post = db.get(CommunityPost, post_id)
    if not post or post.status != "published":
        raise ApiError("留言不存在或暂不可点赞", "COMMUNITY_POST_NOT_AVAILABLE", 404)

    existing = db.scalar(
        select(CommunityPostLike).where(
            CommunityPostLike.post_id == post_id,
            CommunityPostLike.user_id == visitor.id,
        )
    )
    if not existing:
        db.add(CommunityPostLike(post_id=post_id, user_id=visitor.id))
        db.commit()

    return {
        "post_id": post_id,
        "liked": True,
        "like_count": _post_like_count(db, post_id),
    }


@router.delete("/posts/{post_id}/like")
def unlike_community_post(
    post_id: int,
    visitor: AuthUser = Depends(require_visitor),
    db: Session = Depends(get_db),
) -> dict:
    post = db.get(CommunityPost, post_id)
    if not post or post.status != "published":
        raise ApiError("留言不存在或暂不可操作", "COMMUNITY_POST_NOT_AVAILABLE", 404)

    db.execute(
        delete(CommunityPostLike).where(
            CommunityPostLike.post_id == post_id,
            CommunityPostLike.user_id == visitor.id,
        )
    )
    db.commit()
    return {
        "post_id": post_id,
        "liked": False,
        "like_count": _post_like_count(db, post_id),
    }


@router.get("/admin/posts", dependencies=[Depends(require_admin)])
def list_community_posts_for_admin(
    status: Literal["all", "published", "hidden", "deleted"] = Query(default="all"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> dict:
    like_counts = _like_count_subquery()
    filters = []
    if status != "all":
        filters.append(CommunityPost.status == status)

    total = db.scalar(
        select(func.count(CommunityPost.id)).where(*filters)
    ) or 0
    stmt = (
        select(
            CommunityPost,
            func.coalesce(like_counts.c.like_count, 0).label("like_count"),
        )
        .options(
            selectinload(CommunityPost.spot),
            selectinload(CommunityPost.travel_journal).selectinload(
                TravelJournal.images
            ),
        )
        .outerjoin(like_counts, like_counts.c.post_id == CommunityPost.id)
        .where(*filters)
        .order_by(CommunityPost.created_at.desc(), CommunityPost.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = db.execute(stmt).all()
    return {
        "items": [
            _serialize_post(
                post,
                like_count=int(like_count),
                liked_by_me=False,
                viewer_id=None,
            )
            for post, like_count in rows
        ],
        "total": int(total),
        "page": page,
        "page_size": page_size,
    }


@router.patch("/admin/posts/{post_id}", dependencies=[Depends(require_admin)])
def moderate_community_post(
    post_id: int,
    payload: CommunityPostModerate,
    db: Session = Depends(get_db),
) -> dict:
    post = db.get(CommunityPost, post_id)
    if not post or post.status == "deleted":
        raise ApiError("留言不存在", "COMMUNITY_POST_NOT_FOUND", 404)

    post.status = payload.status
    post.updated_at = utc_now()
    db.commit()
    db.refresh(post)
    return {"id": post.id, "status": post.status}


def _list_posts(
    db: Session,
    *,
    viewer_id: str,
    scope: str,
    sort: str,
    page: int,
    page_size: int,
) -> dict:
    like_counts = _like_count_subquery()
    filters = [CommunityPost.status == "published"]
    if scope == "mine":
        filters = [
            CommunityPost.author_id == viewer_id,
            CommunityPost.status != "deleted",
        ]

    total = db.scalar(
        select(func.count(CommunityPost.id)).where(*filters)
    ) or 0
    like_count_value = func.coalesce(like_counts.c.like_count, 0)
    stmt = (
        select(CommunityPost, like_count_value.label("like_count"))
        .options(
            selectinload(CommunityPost.spot),
            selectinload(CommunityPost.travel_journal).selectinload(
                TravelJournal.images
            ),
        )
        .outerjoin(like_counts, like_counts.c.post_id == CommunityPost.id)
        .where(*filters)
    )
    if sort == "popular" and scope != "mine":
        stmt = stmt.order_by(
            like_count_value.desc(),
            CommunityPost.created_at.desc(),
            CommunityPost.id.desc(),
        )
    else:
        stmt = stmt.order_by(
            CommunityPost.created_at.desc(),
            CommunityPost.id.desc(),
        )
    rows = db.execute(
        stmt.offset((page - 1) * page_size).limit(page_size)
    ).all()

    post_ids = [post.id for post, _ in rows]
    liked_post_ids = set()
    if post_ids:
        liked_post_ids = set(
            db.scalars(
                select(CommunityPostLike.post_id).where(
                    CommunityPostLike.user_id == viewer_id,
                    CommunityPostLike.post_id.in_(post_ids),
                )
            ).all()
        )

    return {
        "items": [
            _serialize_post(
                post,
                like_count=int(like_count),
                liked_by_me=post.id in liked_post_ids,
                viewer_id=viewer_id,
            )
            for post, like_count in rows
        ],
        "total": int(total),
        "page": page,
        "page_size": page_size,
    }


def _like_count_subquery():
    return (
        select(
            CommunityPostLike.post_id.label("post_id"),
            func.count(CommunityPostLike.id).label("like_count"),
        )
        .group_by(CommunityPostLike.post_id)
        .subquery()
    )


def _post_like_count(db: Session, post_id: int) -> int:
    return int(
        db.scalar(
            select(func.count(CommunityPostLike.id)).where(
                CommunityPostLike.post_id == post_id,
            )
        )
        or 0
    )


def _serialize_post(
    post: CommunityPost,
    *,
    like_count: int,
    liked_by_me: bool,
    viewer_id: str | None,
) -> dict:
    return {
        "id": post.id,
        "author_id": post.author_id,
        "author_name": post.author_name,
        "content": post.content,
        "post_type": post.post_type or "comment",
        "travel_journal": _serialize_community_journal(post.travel_journal),
        "spot": (
            {"id": post.spot.id, "name": post.spot.name}
            if post.spot
            else None
        ),
        "status": post.status,
        "like_count": like_count,
        "liked_by_me": liked_by_me,
        "is_mine": viewer_id == post.author_id if viewer_id else False,
        "created_at": post.created_at.isoformat(),
        "updated_at": post.updated_at.isoformat(),
    }


def _serialize_community_journal(journal: TravelJournal | None) -> dict | None:
    if not journal:
        return None
    return {
        "id": journal.id,
        "title": journal.title,
        "opening": journal.opening,
        "text_sections": journal.text_sections or [],
        "conclusion": journal.conclusion,
        "images": [
            {
                "id": image.id,
                "display_url": (
                    f"/api/travel-journals/{journal.id}/images/{image.id}/display"
                ),
                "title": image.section_title,
                "body": image.section_body,
                "sort_order": image.sort_order,
            }
            for image in sorted(journal.images, key=lambda item: item.sort_order)
        ],
    }
