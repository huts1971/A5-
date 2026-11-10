from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import statistics
import sys
from time import perf_counter
from typing import Any
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select


BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import Settings
from app.main import create_app
from app.models import KnowledgeChunk, KnowledgeChunkEmbedding


DEFAULT_EVALUATION_SET = BACKEND_ROOT / "evaluations" / "guide_rag_100_cases.json"
DEFAULT_SOURCE_PACKAGE_PATH = BACKEND_ROOT.parent / "Scenic Area Public Information Package"
DEFAULT_DERIVED_KNOWLEDGE_PATH = BACKEND_ROOT.parent / "knowledge"
FAKE_EMBEDDING_MODEL = "eval-text-embedding-v4"


class FakeEvaluationWebSearchProvider:
    def search(self, query: str, timeout_seconds: float) -> list[dict]:
        if any(term in query for term in ("天气", "下雨", "气温")):
            return [
                {
                    "title": "天气服务提示",
                    "snippet": "天气、气温和降雨以实时天气平台为准，出行前建议查看最新预报。",
                    "url": "https://weather.example.com/wuxi",
                    "source_level": "official",
                }
            ]
        if any(term in query for term in ("开放", "闭园", "票", "门票", "价格")):
            return [
                {
                    "title": "景区官方公告",
                    "snippet": "开放时间、票价和现场服务可能随活动调整，请以景区官方公告或现场服务台为准。",
                    "url": "https://www.lingshan.com/notice",
                    "source_level": "official",
                }
            ]
        return [
            {
                "title": "景区服务提醒",
                "snippet": "实时现场信息建议以景区官方渠道和现场工作人员说明为准。",
                "url": "https://www.lingshan.com/",
                "source_level": "official",
            }
        ]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run the 100-question AI guide RAG/persona/route-boundary evaluation."
    )
    parser.add_argument(
        "--evaluation-set",
        default=str(DEFAULT_EVALUATION_SET),
        help="Path to the 100-case evaluation JSON.",
    )
    parser.add_argument(
        "--database-url",
        default=None,
        help="Optional SQLAlchemy database URL. Defaults to a temporary SQLite DB.",
    )
    parser.add_argument(
        "--output",
        default="",
        help="Optional path to write the JSON report.",
    )
    parser.add_argument(
        "--max-cases",
        type=int,
        default=0,
        help="Optional smoke-test limit.",
    )
    parser.add_argument(
        "--case-ids",
        default="",
        help="Optional comma-separated case ids to run, preserving evaluation-set order.",
    )
    parser.add_argument(
        "--real-llm",
        action="store_true",
        help="Use the configured MiMo/OpenAI-compatible LLM instead of the deterministic fake guide writer.",
    )
    parser.add_argument(
        "--real-embedding",
        action="store_true",
        help="Use the configured embedding service instead of deterministic fake embeddings.",
    )
    parser.add_argument(
        "--summary-only",
        action="store_true",
        help="Print only the summary to stdout. Use with --output to keep the full report.",
    )
    args = parser.parse_args()

    report = run_guide_rag_evaluation(
        evaluation_set_path=args.evaluation_set,
        database_url=args.database_url,
        max_cases=args.max_cases,
        case_ids=[case_id.strip() for case_id in args.case_ids.split(",") if case_id.strip()],
        real_llm=args.real_llm,
        real_embedding=args.real_embedding,
    )
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(text, encoding="utf-8")
    if args.summary_only:
        print(json.dumps({"ok": report["ok"], "summary": report["summary"]}, ensure_ascii=False, indent=2))
    else:
        print(text)
    return 0 if report["ok"] else 1


def run_guide_rag_evaluation(
    evaluation_set_path: str | Path = DEFAULT_EVALUATION_SET,
    database_url: str | None = None,
    max_cases: int = 0,
    case_ids: list[str] | None = None,
    real_llm: bool = False,
    real_embedding: bool = False,
) -> dict[str, Any]:
    evaluation_set = json.loads(Path(evaluation_set_path).read_text(encoding="utf-8"))
    cases = list(evaluation_set["cases"])
    if case_ids:
        allowed = set(case_ids)
        cases = [case for case in cases if case["id"] in allowed]
    if max_cases:
        cases = cases[:max_cases]

    temp_path = BACKEND_ROOT / ".eval-temp" / f"guide-rag-eval-{uuid4().hex}"
    temp_path.mkdir(parents=True, exist_ok=True)
    db_url = database_url or f"sqlite:///{temp_path / 'guide_rag_eval.db'}"
    settings = _settings(db_url, temp_path, real_llm, real_embedding)
    app = create_app(settings)

    patches = _patch_external_services(real_llm=real_llm, real_embedding=real_embedding)
    try:
        with TestClient(app) as client:
            if not real_embedding:
                _seed_fake_embeddings(client)
            session_ids: dict[str, str] = {}
            results = [
                _run_case(
                    client,
                    case,
                    defaults=evaluation_set.get("defaults_by_category", {}),
                    global_forbidden_terms=evaluation_set.get("mechanical_forbidden_terms", []),
                    session_ids=session_ids,
                )
                for case in cases
            ]
    finally:
        _restore_external_services(patches)

    summary = _summary(results)
    return {
        "ok": summary["failed"] == 0,
        "name": evaluation_set["name"],
        "description": evaluation_set.get("description", ""),
        "mode": {
            "llm": "real" if real_llm else "fake",
            "embedding": "real" if real_embedding else "fake",
        },
        "summary": summary,
        "failures": [result for result in results if not result["passed"]],
        "results": results,
    }


def _settings(db_url: str, temp_path: Path, real_llm: bool, real_embedding: bool) -> Settings:
    if real_embedding:
        rag_vector_mode = "openai_compatible"
        embedding_model = Settings().rag_embedding_model
        embedding_key = Settings().rag_embedding_api_key
    else:
        rag_vector_mode = "openai_compatible"
        embedding_model = FAKE_EMBEDDING_MODEL
        embedding_key = "eval-embedding-key"

    if real_llm:
        base = Settings()
        llm_mode = base.llm_mode
        llm_provider = base.llm_provider
        llm_base_url = base.llm_base_url
        llm_api_key = base.llm_api_key
        llm_model = base.llm_model
    else:
        llm_mode = "openai_compatible"
        llm_provider = "fake"
        llm_base_url = "https://example.invalid/v1"
        llm_api_key = "eval-llm-key"
        llm_model = "eval-guide-writer"

    return Settings(
        database_url=db_url,
        source_package_path=str(DEFAULT_SOURCE_PACKAGE_PATH),
        derived_knowledge_path=str(DEFAULT_DERIVED_KNOWLEDGE_PATH),
        llm_mode=llm_mode,
        llm_provider=llm_provider,
        llm_base_url=llm_base_url,
        llm_api_key=llm_api_key,
        llm_model=llm_model,
        rag_retrieval_mode="hybrid",
        rag_vector_mode=rag_vector_mode,
        rag_embedding_api_key=embedding_key,
        rag_embedding_model=embedding_model,
        rag_embedding_timeout_seconds=0.6,
        web_search_mode="provider",
        web_search_timeout_seconds=0.5,
        web_search_max_results=2,
        tts_mode="disabled",
        tts_output_dir=str(temp_path / "tts"),
        admin_default_password="123456",
    )


def _patch_external_services(real_llm: bool, real_embedding: bool) -> dict[str, Any]:
    import app.services.chat as chat_service
    import app.services.embeddings as embedding_service
    import app.services.rag as rag_service
    from app.services.mimo import MimoClient

    patches: dict[str, Any] = {
        "web_provider": chat_service.get_web_search_provider,
        "mimo_chat": MimoClient.chat_completion,
        "mimo_stream": MimoClient.chat_completion_stream,
        "embedding_embed": embedding_service.EmbeddingClient.embed_texts,
        "rag_embedding_embed": rag_service.EmbeddingClient.embed_texts,
    }
    chat_service.get_web_search_provider = lambda settings: FakeEvaluationWebSearchProvider()

    if not real_llm:
        MimoClient.chat_completion = _fake_mimo_chat_completion

        def _fake_stream(self, model: str, system_prompt: str, user_prompt: str):
            text = _fake_mimo_chat_completion(self, model, system_prompt, user_prompt)
            for index in range(0, len(text), 12):
                yield text[index : index + 12]

        MimoClient.chat_completion_stream = _fake_stream

    if not real_embedding:
        embedding_service.EmbeddingClient.embed_texts = _fake_embed_texts
        rag_service.EmbeddingClient.embed_texts = _fake_embed_texts

    return patches


def _restore_external_services(patches: dict[str, Any]) -> None:
    import app.services.chat as chat_service
    import app.services.embeddings as embedding_service
    import app.services.rag as rag_service
    from app.services.mimo import MimoClient

    chat_service.get_web_search_provider = patches["web_provider"]
    MimoClient.chat_completion = patches["mimo_chat"]
    MimoClient.chat_completion_stream = patches["mimo_stream"]
    embedding_service.EmbeddingClient.embed_texts = patches["embedding_embed"]
    rag_service.EmbeddingClient.embed_texts = patches["rag_embedding_embed"]


def _seed_fake_embeddings(client: TestClient) -> None:
    session_factory = client.app.state.SessionLocal
    with session_factory() as session:
        chunks = session.scalars(select(KnowledgeChunk)).all()
        existing = {
            (embedding.chunk_id, embedding.model)
            for embedding in session.scalars(select(KnowledgeChunkEmbedding)).all()
        }
        for chunk in chunks:
            key = (chunk.id, FAKE_EMBEDDING_MODEL)
            if key in existing:
                continue
            session.add(
                KnowledgeChunkEmbedding(
                    chunk_id=chunk.id,
                    model=FAKE_EMBEDDING_MODEL,
                    content_hash=_content_hash(chunk.chunk_text),
                    embedding_json=_semantic_embedding(chunk.chunk_text),
                )
            )
        session.commit()


def _run_case(
    client: TestClient,
    case: dict[str, Any],
    defaults: dict[str, Any],
    global_forbidden_terms: list[str],
    session_ids: dict[str, str],
) -> dict[str, Any]:
    expected = _merged_expected(case, defaults)
    body = {
        "question": case["question"],
        "profile": case.get("profile", {}),
    }
    session_key = case.get("session_key")
    if session_key and session_key in session_ids:
        body["session_id"] = session_ids[session_key]

    started = perf_counter()
    response = client.post("/api/chat", json=body)
    elapsed_ms = round((perf_counter() - started) * 1000, 2)
    if response.status_code != 200:
        result_body: dict[str, Any] = {"error": response.text}
    else:
        result_body = response.json()
        if session_key:
            session_ids[session_key] = result_body.get("session_id", body.get("session_id", ""))

    checks = _checks(result_body, expected, global_forbidden_terms)
    metrics = result_body.get("metrics", {})
    classification = metrics.get("classification", {})
    guide_action = result_body.get("guide_action")
    sources = result_body.get("sources", [])
    source_types = [source.get("source_type", "") for source in sources]
    sections = [source.get("section", "") for source in sources]
    route = (guide_action or {}).get("route") or {}
    return {
        "id": case["id"],
        "category": case["category"],
        "question": case["question"],
        "passed": response.status_code == 200 and all(check["passed"] for check in checks),
        "checks": checks,
        "status_code": response.status_code,
        "intent": classification.get("intent", ""),
        "mode": result_body.get("mode", ""),
        "guide_action_type": (guide_action or {}).get("type", ""),
        "route_map_id": route.get("map_id", ""),
        "source_count": len(sources),
        "source_types": source_types,
        "sections": sections,
        "vector_status": metrics.get("vector_status", ""),
        "retrieval_mode": metrics.get("retrieval_mode", ""),
        "web_supplement_required": metrics.get("web_supplement_required", False),
        "web_supplement_status": metrics.get("web_supplement_status", "not_required"),
        "api_elapsed_ms": elapsed_ms,
        "reported_total_ms": metrics.get("total_ms", 0),
        "answer_excerpt": (result_body.get("answer", "") or "")[:180],
    }


def _merged_expected(case: dict[str, Any], defaults: dict[str, Any]) -> dict[str, Any]:
    merged = dict(defaults.get(case["category"], {}))
    merged.update(case.get("expected", {}))
    return merged


def _checks(
    body: dict[str, Any],
    expected: dict[str, Any],
    global_forbidden_terms: list[str],
) -> list[dict[str, Any]]:
    answer = body.get("answer", "") or ""
    sources = body.get("sources", []) or []
    metrics = body.get("metrics", {}) or {}
    classification = metrics.get("classification", {}) or {}
    guide_action = body.get("guide_action")
    source_types = {source.get("source_type", "") for source in sources}
    sections = {source.get("section", "") for source in sources}
    route = (guide_action or {}).get("route") or {}

    checks = [
        _check("status_body", "answer" in body and "metrics" in body),
        _intent_check(classification, expected),
        _check(
            "expected_mode",
            "expected_mode" not in expected or body.get("mode") == expected["expected_mode"],
            {"actual": body.get("mode"), "expected": expected.get("expected_mode")},
        ),
        _check(
            "required_source_types",
            set(expected.get("required_source_types", [])).issubset(source_types),
            {"actual": sorted(source_types), "expected": expected.get("required_source_types", [])},
        ),
        _check(
            "forbidden_source_types",
            source_types.isdisjoint(set(expected.get("forbidden_source_types", []))),
            {"actual": sorted(source_types), "forbidden": expected.get("forbidden_source_types", [])},
        ),
        _check(
            "required_sections",
            set(expected.get("required_sections", [])).issubset(sections),
            {"actual": sorted(sections), "expected": expected.get("required_sections", [])},
        ),
        _check(
            "max_source_count",
            "max_source_count" not in expected or len(sources) <= int(expected["max_source_count"]),
            {"actual": len(sources), "max": expected.get("max_source_count")},
        ),
        _check(
            "min_source_count",
            "min_source_count" not in expected or len(sources) >= int(expected["min_source_count"]),
            {"actual": len(sources), "min": expected.get("min_source_count")},
        ),
        _check(
            "expect_route_action",
            not expected.get("expect_route_action") or (guide_action or {}).get("type") == "route_recommendation",
            {"actual": (guide_action or {}).get("type")},
        ),
        _check(
            "forbid_route_action",
            not expected.get("forbid_route_action") or guide_action is None,
            {"actual": (guide_action or {}).get("type") if guide_action else None},
        ),
        _check(
            "expected_map_id",
            "expected_map_id" not in expected or route.get("map_id") == expected["expected_map_id"],
            {"actual": route.get("map_id"), "expected": expected.get("expected_map_id")},
        ),
        _check(
            "expected_vector_status",
            "expected_vector_status" not in expected
            or metrics.get("vector_status") in _as_list(expected["expected_vector_status"]),
            {"actual": metrics.get("vector_status"), "expected": expected.get("expected_vector_status")},
        ),
        _check(
            "web_supplement_required",
            "web_supplement_required" not in expected
            or metrics.get("web_supplement_required") == expected["web_supplement_required"],
            {
                "actual": metrics.get("web_supplement_required"),
                "expected": expected.get("web_supplement_required"),
            },
        ),
        _check(
            "web_supplement_status",
            "web_supplement_status" not in expected
            or metrics.get("web_supplement_status") == expected["web_supplement_status"],
            {
                "actual": metrics.get("web_supplement_status"),
                "expected": expected.get("web_supplement_status"),
            },
        ),
        _check(
            "required_answer_terms",
            all(term in answer for term in expected.get("required_answer_terms", [])),
            {"missing": [term for term in expected.get("required_answer_terms", []) if term not in answer]},
        ),
        _check(
            "required_answer_terms_any",
            not expected.get("required_answer_terms_any")
            or any(term in answer for term in expected.get("required_answer_terms_any", [])),
            {"expected_any": expected.get("required_answer_terms_any", [])},
        ),
    ]
    forbidden_terms = list(global_forbidden_terms) + list(expected.get("forbidden_answer_terms", []))
    checks.append(
        _check(
            "forbidden_answer_terms",
            not any(term and term in answer for term in forbidden_terms),
            {"hit": [term for term in forbidden_terms if term and term in answer]},
        )
    )
    return checks


def _intent_check(classification: dict[str, Any], expected: dict[str, Any]) -> dict[str, Any]:
    actual = classification.get("intent", "")
    if "expected_intent" in expected:
        return _check(
            "expected_intent",
            actual == expected["expected_intent"],
            {"actual": actual, "expected": expected["expected_intent"]},
        )
    if "intent" in expected:
        return _check(
            "intent",
            actual == expected["intent"],
            {"actual": actual, "expected": expected["intent"]},
        )
    if "allowed_intents" in expected:
        return _check(
            "allowed_intents",
            actual in expected["allowed_intents"],
            {"actual": actual, "allowed": expected["allowed_intents"]},
        )
    return _check("intent_unspecified", True, {"actual": actual})


def _check(name: str, passed: bool, detail: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "name": name,
        "passed": bool(passed),
        "detail": detail or {},
    }


def _summary(results: list[dict[str, Any]]) -> dict[str, Any]:
    failed_results = [result for result in results if not result["passed"]]
    by_category: dict[str, dict[str, int]] = {}
    for result in results:
        bucket = by_category.setdefault(result["category"], {"total": 0, "passed": 0, "failed": 0})
        bucket["total"] += 1
        if result["passed"]:
            bucket["passed"] += 1
        else:
            bucket["failed"] += 1
    check_failures: dict[str, int] = {}
    for result in failed_results:
        for check in result["checks"]:
            if not check["passed"]:
                check_failures[check["name"]] = check_failures.get(check["name"], 0) + 1
    total_times = [float(result.get("reported_total_ms") or 0) for result in results]
    source_counts = [int(result.get("source_count") or 0) for result in results]
    return {
        "total": len(results),
        "passed": len(results) - len(failed_results),
        "failed": len(failed_results),
        "pass_rate": round((len(results) - len(failed_results)) / max(1, len(results)), 4),
        "by_category": by_category,
        "failed_ids": [result["id"] for result in failed_results],
        "check_failures": dict(sorted(check_failures.items())),
        "route_action_count": sum(1 for result in results if result.get("guide_action_type")),
        "route_false_positive_count": sum(
            1
            for result in results
            if result["category"] not in {"route_recommendation", "route_followup"}
            and result.get("guide_action_type")
        ),
        "mechanical_issue_count": sum(
            1
            for result in results
            for check in result["checks"]
            if check["name"] == "forbidden_answer_terms" and not check["passed"]
        ),
        "vector_status_counts": _counts(result.get("vector_status", "") for result in results),
        "intent_counts": _counts(result.get("intent", "") for result in results),
        "mode_counts": _counts(result.get("mode", "") for result in results),
        "source_type_counts": _counts(
            source_type
            for result in results
            for source_type in result.get("source_types", [])
        ),
        "average_total_ms": round(statistics.mean(total_times), 2) if total_times else 0,
        "average_source_count": round(statistics.mean(source_counts), 2) if source_counts else 0,
    }


def _counts(values) -> dict[str, int]:
    counts: dict[str, int] = {}
    for value in values:
        key = str(value or "")
        counts[key] = counts.get(key, 0) + 1
    return dict(sorted(counts.items(), key=lambda item: (-item[1], item[0])))


def _as_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    return [value]


def _fake_mimo_chat_completion(self, model: str, system_prompt: str, user_prompt: str) -> str:
    if "路线顺序" in user_prompt:
        route_line = _line_value(user_prompt, "路线顺序")
        total_line = _line_value(user_prompt, "总时长")
        walk_line = _line_value(user_prompt, "预计步行")
        area = _line_value(user_prompt, "景区") or "景区"
        return (
            f"好呀，我给你排了一条{area}路线，节奏会尽量贴合这次偏好。"
            f"这条线大约{total_line or '一段时间'}，步行约{walk_line or '以地图估算为准'}，顺序是{route_line or '从入口出发去核心点位'}。"
            "你可以先点“查看地图”确认动线；如果现场觉得累，再进“编辑路线”删掉一两个支线点位就好。"
        )
    question = _extract_user_question(user_prompt)
    if any(
        term in question
        for term in (
            "你好",
            "您好",
            "嗨",
            "哈喽",
            "在吗",
            "谢谢",
            "你是谁",
            "叫什么",
            "名字",
            "会干什么",
            "能做什么",
            "像真人导游",
            "陪我逛",
            "介绍一下",
            "第一次来",
        )
    ):
        return "你好呀，我是灵诗音，灵山胜境 AI 导游。你可以问我景点故事、拍照点、老人孩子怎么逛；如果你明确说要规划路线，我也能帮你生成一条可编辑的游览路线。"
    evidence = _extract_evidence_terms(user_prompt)
    preferred_subject = _preferred_subject(question, evidence)
    if "88" in evidence and any(term in question for term in ("多高", "多少米", "高度", "几米")):
        return f"灵山大佛高 88 米，是灵山胜境最有标志性的核心景观。你到中轴线后段往上看，会更容易感到它和山势、台阶一起形成的气势。"
    if not evidence:
        return "这个我现在不能替你确认，先不乱说。你可以换个更具体的问题，比如问某个景点的看点、适合人群，或者让我按时间和兴趣帮你规划路线。"
    if any(term in question for term in ("老人", "孩子", "注意", "休息", "累")):
        return (
            f"这个问题我会建议你把节奏放慢一点，先抓住{preferred_subject}这样的重点。"
            "带老人或孩子时，别把支线排太满，中间留出休息和补水时间会舒服很多。"
            "如果现场人多，就优先保留最想看的点位，少走回头路。"
        )
    if any(term in question for term in ("出片", "拍照", "摄影", "打卡")):
        return (
            f"想拍照的话，可以优先看{preferred_subject}，画面层次会更明显。"
            "我会建议你别只拍近景，稍微退后一点，把建筑、道路或水面一起收进画面，会更有现场感。"
        )
    if any(term in question for term in ("建筑", "空间", "艺术")):
        return (
            f"如果你想看建筑感，{preferred_subject}会更值得停下来慢慢看。"
            "它的看点不只是单个建筑，而是空间层次、装饰细节和行进视角叠在一起的感觉。"
        )
    return (
        f"{preferred_subject}最适合慢慢看，不用急着一眼扫过去。"
        "你可以先抓住它的核心看点，再结合现场导览标识停留一会儿；这样比单纯打卡更容易记住。"
    )


def _line_value(text: str, label: str) -> str:
    marker = f"{label}："
    for line in text.splitlines():
        if marker in line:
            return line.split(marker, 1)[1].strip()
    return ""


def _extract_user_question(prompt: str) -> str:
    for marker in ("【游客问题】", "游客刚刚说："):
        if marker in prompt:
            tail = prompt.split(marker, 1)[1]
            return tail.splitlines()[0].strip()
    return prompt[:120]


def _extract_evidence_terms(prompt: str) -> list[str]:
    candidates = []
    known_terms = [
        "灵山大佛",
        "灵山梵宫",
        "梵宫",
        "九龙灌浴",
        "五印坛城",
        "祥符禅寺",
        "拈花广场",
        "梵天花海",
        "香月花街",
        "拈花堂",
        "五灯湖",
        "鹿鸣谷",
        "拈花湾",
        "灵山",
        "88",
    ]
    for term in known_terms:
        if term in prompt and term not in candidates:
            candidates.append(term)
    return candidates


def _preferred_subject(question: str, evidence: list[str]) -> str:
    for term in evidence:
        if term and term in question:
            return term
    return evidence[0] if evidence else "这个点位"


def _fake_embed_texts(self, model: str, texts: list[str]) -> list[list[float]]:
    return [_semantic_embedding(text) for text in texts]


def _semantic_embedding(text: str) -> list[float]:
    dimensions = [
        ("佛教", "文化", "大佛", "禅", "祥符", "坛城"),
        ("建筑", "艺术", "空间", "梵宫", "坛城", "建筑感"),
        ("拍照", "摄影", "出片", "打卡", "取景", "花海"),
        ("自然", "休闲", "风光", "花海", "湖", "鹿鸣谷", "慢慢"),
        ("亲子", "孩子", "演艺", "九龙", "灌浴", "表演"),
        ("室内", "避雨", "博览", "梵宫"),
        ("老人", "轻松", "少走", "休息", "慢"),
        ("路线", "规划", "生成", "安排", "怎么逛"),
    ]
    vector = []
    for terms in dimensions:
        vector.append(float(sum(1 for term in terms if term in text)))
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    vector.extend((byte / 255.0) * 0.05 for byte in digest[:8])
    if not any(value > 0 for value in vector):
        vector[0] = 0.01
    return vector


def _content_hash(text_value: str) -> str:
    return hashlib.sha256(text_value.encode("utf-8")).hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
