from __future__ import annotations

from html import escape
from io import BytesIO
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import (
    Image,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
)

from app.models import TravelJournal


PRODUCT_FOOTER = "灵诗音AI导游"
PDF_FONT = "STSong-Light"


def build_travel_journal_pdf(journal: TravelJournal, author_name: str) -> bytes:
    pdfmetrics.registerFont(UnicodeCIDFont(PDF_FONT))
    buffer = BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=24 * mm,
        rightMargin=24 * mm,
        topMargin=22 * mm,
        bottomMargin=20 * mm,
        title=journal.title or "旅行手账",
        author=author_name,
    )
    styles = _styles()
    story = [
        Paragraph(escape(journal.title or "未命名旅行手账"), styles["journal_title"]),
        Paragraph(
            escape(
                f"{author_name} · {journal.created_at.astimezone().strftime('%Y年%m月%d日')}"
            ),
            styles["meta"],
        ),
        Spacer(1, 8 * mm),
    ]
    if journal.opening:
        story.extend(
            [
                Paragraph(_paragraph_text(journal.opening), styles["body"]),
                Spacer(1, 5 * mm),
            ]
        )

    for section in journal.text_sections or []:
        story.extend(
            [
                Paragraph(escape(section.get("title") or ""), styles["section_title"]),
                Paragraph(_paragraph_text(section.get("body") or ""), styles["body"]),
                Spacer(1, 5 * mm),
            ]
        )

    for image in sorted(journal.images, key=lambda item: item.sort_order):
        image_block = []
        if image.section_title:
            image_block.append(
                Paragraph(escape(image.section_title), styles["section_title"])
            )
        if Path(image.display_path).is_file():
            flowable = Image(image.display_path)
            flowable._restrictSize(160 * mm, 105 * mm)
            image_block.extend([flowable, Spacer(1, 3 * mm)])
        if image_block:
            story.append(KeepTogether(image_block))
        if image.section_body:
            story.append(
                Paragraph(_paragraph_text(image.section_body), styles["body"])
            )
        story.append(Spacer(1, 5 * mm))

    if journal.conclusion:
        story.extend(
            [
                Paragraph("写在最后", styles["section_title"]),
                Paragraph(_paragraph_text(journal.conclusion), styles["body"]),
            ]
        )

    document.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buffer.getvalue()


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "journal_title": ParagraphStyle(
            "JournalTitle",
            parent=base["Title"],
            fontName=PDF_FONT,
            fontSize=23,
            leading=32,
            textColor=colors.HexColor("#24231f"),
            alignment=TA_CENTER,
            spaceAfter=8,
        ),
        "meta": ParagraphStyle(
            "Meta",
            parent=base["Normal"],
            fontName=PDF_FONT,
            fontSize=9,
            leading=14,
            textColor=colors.HexColor("#77746d"),
            alignment=TA_CENTER,
        ),
        "section_title": ParagraphStyle(
            "SectionTitle",
            parent=base["Heading2"],
            fontName=PDF_FONT,
            fontSize=15,
            leading=22,
            textColor=colors.HexColor("#684c3e"),
            spaceBefore=5,
            spaceAfter=6,
        ),
        "body": ParagraphStyle(
            "Body",
            parent=base["BodyText"],
            fontName=PDF_FONT,
            fontSize=11,
            leading=20,
            textColor=colors.HexColor("#34312c"),
            firstLineIndent=22,
            spaceAfter=4,
        ),
    }


def _paragraph_text(value: str) -> str:
    return "<br/>".join(escape(line) for line in value.splitlines())


def _footer(canvas, document) -> None:
    canvas.saveState()
    canvas.setFont(PDF_FONT, 8)
    canvas.setFillColor(colors.HexColor("#aaa49a"))
    canvas.drawCentredString(A4[0] / 2, 10 * mm, PRODUCT_FOOTER)
    canvas.restoreState()
