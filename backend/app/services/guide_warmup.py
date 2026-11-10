from __future__ import annotations

import json
from pathlib import Path
from threading import Event, Thread
from typing import Callable

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.services.chat import warm_answer_cache
from app.services.question_classifier import classify_question
from app.services.rag import retrieve_context_with_metrics
from app.services.rag_index import ensure_chunk_embeddings, rebuild_knowledge_fts_index


DEFAULT_WARMUP_QUESTIONS = [
    "灵山大佛有什么看点？",
    "梵宫有什么看点？",
    "哪里比较出片？",
    "我想看建筑感强一点的地方",
    "带老人来需要注意什么？",
    "拈花湾有什么景点？",
    "拈花湾哪里适合发朋友圈？",
    "第一次来怎么理解灵山文化？",
    "我想看自然风光，哪里比较舒服？",
    "孩子对文化不感兴趣怎么办？",
]

WARMUP_CATEGORIES = {
    "database_fact",
    "scenic_explanation",
    "vague_semantic",
    "service_advice",
}


class GuideWarmupService:
    def __init__(
        self,
        settings: Settings,
        session_factory: Callable[[], Session],
    ) -> None:
        self.settings = settings
        self.session_factory = session_factory
        self._stop_event = Event()
        self._thread: Thread | None = None
        self.status = "idle"

    def start(self) -> None:
        if not _truthy(self.settings.guide_warmup_on_startup):
            self.status = "disabled"
            return
        if self._thread and self._thread.is_alive():
            return
        self.status = "starting"
        self._thread = Thread(target=self._run, name="guide-warmup", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()

    def _run(self) -> None:
        try:
            with self.session_factory() as session:
                rebuild_knowledge_fts_index(session)
                ensure_chunk_embeddings(session, self.settings)
                session.commit()
                questions = _warmup_questions(self.settings)
                for question in questions:
                    if self._stop_event.is_set():
                        self.status = "stopped"
                        return
                    classification = classify_question(session, question, self.settings)
                    retrieve_context_with_metrics(
                        session,
                        question,
                        classification=classification,
                        settings=self.settings,
                    )
                    if _truthy(self.settings.guide_warmup_build_answer_cache):
                        warm_answer_cache(session, self.settings, question)
            self.status = "ready"
        except Exception:
            self.status = "failed"


def _warmup_questions(settings: Settings) -> list[str]:
    questions: list[str] = []
    eval_path = Path(__file__).resolve().parents[2] / "evaluations" / "guide_rag_100_cases.json"
    if eval_path.exists():
        try:
            payload = json.loads(eval_path.read_text(encoding="utf-8"))
            for item in payload.get("cases", []):
                if item.get("category") in WARMUP_CATEGORIES and item.get("question"):
                    questions.append(str(item["question"]))
        except Exception:
            pass
    questions.extend(DEFAULT_WARMUP_QUESTIONS)
    unique: list[str] = []
    seen: set[str] = set()
    for question in questions:
        normalized = " ".join(question.split())
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        unique.append(question)
        if len(unique) >= max(1, settings.guide_warmup_max_questions):
            break
    return unique


def _truthy(value: str) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "on"}
