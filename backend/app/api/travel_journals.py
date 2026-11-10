from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import quote
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Header, Query, Request, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_db, require_visitor
from app.core.errors import ApiError
from app.models import (
    AppUser,
    CommunityPost,
    TravelJournal,
    TravelJournalImage,
    utc_now,
)
from app.schemas import (
    TravelJournalCreate,
    TravelJournalGenerate,
    TravelJournalImageOrder,
    TravelJournalImageUpdate,
    TravelJournalUpdate,
)
from app.services.auth import AuthUser
from app.services.travel_journal_pdf import build_travel_journal_pdf
from app.services.travel_journals import (
    KimiJournalClient,
    MAX_IMAGE_BYTES,
    MAX_IMAGE_COUNT,
    clone_journal_files,
    delete_image_files,
    delete_journal_files,
    get_owned_journal,
    process_image,
    serialize_journal,
    validate_generated_result,
)


router = APIRouter(prefix="/api/travel-journals", tags=["travel-journals"])


@router.post("")
def create_travel_journal(
    payload: TravelJournalCreate,
    visitor: AuthUser = Depends(require_visitor),
    db: Session = Depends(get_db),
) -> dict:
    journal = TravelJournal(
        id=uuid4().hex,
        visitor_id=visitor.id,
        status="draft",
        description=payload.description.strip(),
        target_words=payload.target_words,
        title="",
        opening="",
        text_sections=[],
        conclusion="",
    )
    db.add(journal)
    db.commit()
    db.refresh(journal)
    journal.images = []
    return serialize_journal(journal)


@router.get("")
def list_travel_journals(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=12, ge=1, le=30),
    visitor: AuthUser = Depends(require_visitor),
    db: Session = Depends(get_db),
) -> dict:
    filters = [TravelJournal.visitor_id == visitor.id]
    total = db.scalar(select(func.count(TravelJournal.id)).where(*filters)) or 0
    journals = db.scalars(
        select(TravelJournal)
        .options(selectinload(TravelJournal.images))
        .where(*filters)
        .order_by(TravelJournal.updated_at.desc(), TravelJournal.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return {
        "items": [serialize_journal(item) for item in journals],
        "total": int(total),
        "page": page,
        "page_size": page_size,
    }


@router.get("/{journal_id}")
def get_travel_journal(
    journal_id: str,
    visitor: AuthUser = Depends(require_visitor),
    db: Session = Depends(get_db),
) -> dict:
    return serialize_journal(get_owned_journal(db, journal_id, visitor.id))


@router.patch("/{journal_id}")
def update_travel_journal(
    journal_id: str,
    payload: TravelJournalUpdate,
    visitor: AuthUser = Depends(require_visitor),
    db: Session = Depends(get_db),
) -> dict:
    journal = get_owned_journal(
        db,
        journal_id,
        visitor.id,
        require_draft=True,
    )
    updates = payload.model_dump(exclude_unset=True)
    image_updates = updates.pop("images", None)
    if "text_sections" in updates:
        updates["text_sections"] = [
            section.model_dump()
            for section in payload.text_sections or []
        ]
    for field, value in updates.items():
        setattr(journal, field, value)
    if image_updates is not None:
        current_ids = {image.id for image in journal.images}
        requested_ids = [item["id"] for item in image_updates]
        if len(requested_ids) != len(set(requested_ids)) or set(requested_ids) != current_ids:
            raise ApiError(
                "图片编辑内容必须与当前图片一致",
                "TRAVEL_JOURNAL_IMAGE_CONTENT_INVALID",
                400,
            )
        by_id = {image.id: image for image in journal.images}
        for item in image_updates:
            by_id[item["id"]].section_title = item["title"]
            by_id[item["id"]].section_body = item["body"]
    journal.updated_at = utc_now()
    db.commit()
    db.refresh(journal)
    return serialize_journal(journal)


@router.post("/{journal_id}/images")
async def upload_travel_journal_images(
    request: Request,
    journal_id: str,
    files: list[UploadFile] = File(...),
    visitor: AuthUser = Depends(require_visitor),
    db: Session = Depends(get_db),
) -> dict:
    journal = get_owned_journal(
        db,
        journal_id,
        visitor.id,
        require_draft=True,
    )
    available = MAX_IMAGE_COUNT - len(journal.images)
    if available <= 0:
        raise ApiError(
            "每篇手账最多上传 9 张图片",
            "TRAVEL_JOURNAL_IMAGE_LIMIT",
            400,
        )

    errors = []
    created = []
    for upload in files:
        if len(created) >= available:
            errors.append(
                {
                    "filename": upload.filename or "未命名图片",
                    "message": "每篇手账最多上传 9 张图片",
                    "code": "TRAVEL_JOURNAL_IMAGE_LIMIT",
                }
            )
            continue
        raw = await upload.read(MAX_IMAGE_BYTES + 1)
        try:
            display_path, model_path = process_image(
                raw,
                filename=upload.filename or "",
                content_type=upload.content_type or "",
                journal_id=journal.id,
                asset_root=request.app.state.settings.travel_journal_asset_dir,
            )
            image = TravelJournalImage(
                id=Path(display_path).stem,
                journal_id=journal.id,
                display_path=display_path,
                model_path=model_path,
                content_type="image/jpeg",
                sort_order=len(journal.images) + len(created),
                section_title="",
                section_body="",
            )
            db.add(image)
            created.append(image)
        except ApiError as exc:
            errors.append(
                {
                    "filename": upload.filename or "未命名图片",
                    "message": exc.message,
                    "code": exc.code,
                }
            )

    if created:
        journal.updated_at = utc_now()
        db.commit()
    journal = get_owned_journal(db, journal.id, visitor.id)
    return {
        "journal": serialize_journal(journal),
        "errors": errors,
    }


@router.patch("/{journal_id}/images/{image_id}")
def update_travel_journal_image(
    journal_id: str,
    image_id: str,
    payload: TravelJournalImageUpdate,
    visitor: AuthUser = Depends(require_visitor),
    db: Session = Depends(get_db),
) -> dict:
    journal = get_owned_journal(
        db,
        journal_id,
        visitor.id,
        require_draft=True,
    )
    image = next((item for item in journal.images if item.id == image_id), None)
    if not image:
        raise ApiError("图片不存在", "TRAVEL_JOURNAL_IMAGE_NOT_FOUND", 404)
    image.section_title = payload.title
    image.section_body = payload.body
    journal.updated_at = utc_now()
    db.commit()
    return serialize_journal(get_owned_journal(db, journal.id, visitor.id))


@router.put("/{journal_id}/images/order")
def reorder_travel_journal_images(
    journal_id: str,
    payload: TravelJournalImageOrder,
    visitor: AuthUser = Depends(require_visitor),
    db: Session = Depends(get_db),
) -> dict:
    journal = get_owned_journal(
        db,
        journal_id,
        visitor.id,
        require_draft=True,
    )
    current_ids = {image.id for image in journal.images}
    if len(payload.image_ids) != len(set(payload.image_ids)) or set(payload.image_ids) != current_ids:
        raise ApiError(
            "图片顺序必须包含当前全部图片且不能重复",
            "TRAVEL_JOURNAL_IMAGE_ORDER_INVALID",
            400,
        )
    by_id = {image.id: image for image in journal.images}
    for order, image_id in enumerate(payload.image_ids):
        by_id[image_id].sort_order = order
    journal.updated_at = utc_now()
    db.commit()
    return serialize_journal(get_owned_journal(db, journal.id, visitor.id))


@router.delete("/{journal_id}/images/{image_id}")
def delete_travel_journal_image(
    journal_id: str,
    image_id: str,
    visitor: AuthUser = Depends(require_visitor),
    db: Session = Depends(get_db),
) -> dict:
    journal = get_owned_journal(
        db,
        journal_id,
        visitor.id,
        require_draft=True,
    )
    image = next((item for item in journal.images if item.id == image_id), None)
    if not image:
        raise ApiError("图片不存在", "TRAVEL_JOURNAL_IMAGE_NOT_FOUND", 404)
    delete_image_files(image)
    db.delete(image)
    remaining = [item for item in journal.images if item.id != image_id]
    for order, item in enumerate(sorted(remaining, key=lambda value: value.sort_order)):
        item.sort_order = order
    journal.updated_at = utc_now()
    db.commit()
    return serialize_journal(get_owned_journal(db, journal.id, visitor.id))


@router.get("/{journal_id}/images/{image_id}/display")
def get_travel_journal_image(
    journal_id: str,
    image_id: str,
    visitor: AuthUser = Depends(require_visitor),
    db: Session = Depends(get_db),
) -> FileResponse:
    journal = db.scalar(
        select(TravelJournal)
        .options(
            selectinload(TravelJournal.images),
            selectinload(TravelJournal.community_post),
        )
        .where(TravelJournal.id == journal_id)
    )
    if not journal:
        raise ApiError("图片不存在", "TRAVEL_JOURNAL_IMAGE_NOT_FOUND", 404)
    can_read = journal.visitor_id == visitor.id or (
        journal.status == "published"
        and journal.community_post is not None
        and journal.community_post.status == "published"
    )
    if not can_read:
        raise ApiError("无权查看该图片", "TRAVEL_JOURNAL_IMAGE_FORBIDDEN", 403)
    image = next((item for item in journal.images if item.id == image_id), None)
    if not image or not Path(image.display_path).is_file():
        raise ApiError("图片不存在", "TRAVEL_JOURNAL_IMAGE_NOT_FOUND", 404)
    return FileResponse(
        image.display_path,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.post("/{journal_id}/generate")
def generate_travel_journal(
    request: Request,
    journal_id: str,
    payload: TravelJournalGenerate,
    visitor: AuthUser = Depends(require_visitor),
    db: Session = Depends(get_db),
) -> dict:
    journal = get_owned_journal(
        db,
        journal_id,
        visitor.id,
        require_draft=True,
    )
    description = payload.description.strip()
    if not description and not journal.images:
        raise ApiError(
            "请至少填写旅途描述或上传一张图片",
            "TRAVEL_JOURNAL_MATERIAL_REQUIRED",
            400,
        )

    journal.description = description
    journal.target_words = payload.target_words
    journal.updated_at = utc_now()
    db.commit()

    settings = request.app.state.settings
    result = KimiJournalClient(
        base_url=settings.kimi_base_url,
        api_key=settings.kimi_api_key,
        model=settings.kimi_model,
        timeout_seconds=settings.kimi_timeout_seconds,
    ).generate(
        description=description,
        target_words=payload.target_words,
        images=journal.images,
    )
    result = validate_generated_result(
        result,
        image_ids=[
            image.id
            for image in sorted(journal.images, key=lambda item: item.sort_order)
        ],
        target_words=payload.target_words,
    )
    journal.title = result["title"].strip()
    journal.opening = result["opening"].strip()
    journal.text_sections = result["text_sections"]
    journal.conclusion = result["conclusion"].strip()
    image_results = {
        item["image_id"]: item
        for item in result["image_sections"]
    }
    for image in journal.images:
        section = image_results[image.id]
        image.section_title = section["title"].strip()
        image.section_body = section["body"].strip()
    journal.updated_at = utc_now()
    db.commit()
    return serialize_journal(get_owned_journal(db, journal.id, visitor.id))


@router.post("/{journal_id}/copy")
def copy_travel_journal(
    request: Request,
    journal_id: str,
    idempotency_key: str | None = Header(
        default=None,
        alias="Idempotency-Key",
        max_length=128,
    ),
    visitor: AuthUser = Depends(require_visitor),
    db: Session = Depends(get_db),
) -> dict:
    source = get_owned_journal(db, journal_id, visitor.id)
    copy_key = f"{source.id}:{idempotency_key}" if idempotency_key else None
    if copy_key:
        existing = db.scalar(
            select(TravelJournal).where(
                TravelJournal.visitor_id == visitor.id,
                TravelJournal.copy_key == copy_key,
            )
        )
        if existing:
            return serialize_journal(
                get_owned_journal(db, existing.id, visitor.id)
            )
    clone = TravelJournal(
        id=uuid4().hex,
        copy_key=copy_key,
        visitor_id=visitor.id,
        status="draft",
        description=source.description,
        target_words=source.target_words,
        title=source.title,
        opening=source.opening,
        text_sections=list(source.text_sections or []),
        conclusion=source.conclusion,
    )
    db.add(clone)
    for image in clone_journal_files(
        source,
        clone,
        request.app.state.settings.travel_journal_asset_dir,
    ):
        db.add(image)
    db.commit()
    return serialize_journal(get_owned_journal(db, clone.id, visitor.id))


@router.post("/{journal_id}/publish")
def publish_travel_journal(
    journal_id: str,
    visitor: AuthUser = Depends(require_visitor),
    db: Session = Depends(get_db),
) -> dict:
    journal = get_owned_journal(db, journal_id, visitor.id)
    existing = db.scalar(
        select(CommunityPost).where(
            CommunityPost.travel_journal_id == journal.id,
            CommunityPost.status != "deleted",
        )
    )
    if existing:
        return {"journal": serialize_journal(journal), "post_id": existing.id}
    if journal.status != "draft":
        raise ApiError(
            "已发布的手账不可直接修改",
            "TRAVEL_JOURNAL_READ_ONLY",
            409,
        )
    if not journal.title.strip() or not _journal_has_body(journal):
        raise ApiError(
            "请先完成手账内容再发布",
            "TRAVEL_JOURNAL_CONTENT_INCOMPLETE",
            400,
        )

    author = db.get(AppUser, visitor.id)
    if not author or not author.is_active:
        raise ApiError("游客账号不可用", "VISITOR_ACCOUNT_INACTIVE", 403)
    post = CommunityPost(
        author_id=author.id,
        author_name=author.username,
        content=_journal_summary(journal),
        post_type="travel_journal",
        travel_journal_id=journal.id,
        spot_id=None,
        status="published",
    )
    db.add(post)
    journal.status = "published"
    journal.updated_at = utc_now()
    db.commit()
    db.refresh(post)
    return {
        "journal": serialize_journal(get_owned_journal(db, journal.id, visitor.id)),
        "post_id": post.id,
    }


@router.get("/{journal_id}/export.pdf")
def export_travel_journal_pdf(
    journal_id: str,
    visitor: AuthUser = Depends(require_visitor),
    db: Session = Depends(get_db),
) -> Response:
    journal = get_owned_journal(db, journal_id, visitor.id)
    author = db.get(AppUser, visitor.id)
    pdf = build_travel_journal_pdf(journal, author.username if author else "游客")
    date = journal.created_at.astimezone().strftime("%Y%m%d")
    safe_title = re.sub(r'[\\/:*?"<>|\\r\\n]+', "", journal.title).strip()[:60] or "旅行手账"
    filename = f"{safe_title}-{date}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f"attachment; filename=travel-journal-{date}.pdf; "
                f"filename*=UTF-8''{quote(filename)}"
            ),
            "Cache-Control": "no-store",
        },
    )


@router.delete("/{journal_id}")
def delete_travel_journal(
    request: Request,
    journal_id: str,
    visitor: AuthUser = Depends(require_visitor),
    db: Session = Depends(get_db),
) -> dict:
    journal = get_owned_journal(db, journal_id, visitor.id)
    post = db.scalar(
        select(CommunityPost).where(
            CommunityPost.travel_journal_id == journal.id,
        )
    )
    if post:
        post.status = "deleted"
        post.travel_journal_id = None
        post.updated_at = utc_now()
    delete_journal_files(
        journal,
        request.app.state.settings.travel_journal_asset_dir,
    )
    db.delete(journal)
    db.commit()
    return {"status": "deleted", "id": journal_id}


def _journal_has_body(journal: TravelJournal) -> bool:
    return bool(
        journal.opening.strip()
        or journal.conclusion.strip()
        or any((section.get("body") or "").strip() for section in journal.text_sections or [])
        or any(image.section_body.strip() for image in journal.images)
    )


def _journal_summary(journal: TravelJournal) -> str:
    values = [
        journal.opening,
        *[
            str(section.get("body") or "")
            for section in journal.text_sections or []
        ],
        *[image.section_body for image in sorted(journal.images, key=lambda item: item.sort_order)],
        journal.conclusion,
    ]
    text = " ".join(value.strip() for value in values if value and value.strip())
    return text[:200] + ("…" if len(text) > 200 else "")
