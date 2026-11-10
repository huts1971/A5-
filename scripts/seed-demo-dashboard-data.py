from __future__ import annotations

import argparse
import json
import math
import os
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
import random
import sys


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
DEMO_PREFIX = "demo_dashboard_"
DEMO_FEEDBACK_PAGE_PREFIX = "/guide?demo=dashboard"


@dataclass(frozen=True)
class Scenario:
    question: str
    answer: str
    spot_name: str
    intent: str
    weight: int = 1


@dataclass(frozen=True)
class PreferenceProfile:
    visitor_type: str
    interest_tags: tuple[str, ...]
    physical_level: str
    duration_minutes: int


SCENARIOS: tuple[Scenario, ...] = (
    Scenario(
        "灵山大佛有哪些看点？",
        "灵山大佛是灵山胜境的核心地标，适合结合佛教文化、登高视野和广场礼佛动线一起讲解。",
        "灵山大佛",
        "spot_explanation",
        12,
    ),
    Scenario(
        "灵山梵宫适合拍照吗？",
        "梵宫内部艺术装饰很丰富，适合拍摄建筑细节；游览时请以现场拍摄提示为准。",
        "灵山梵宫",
        "spot_explanation",
        10,
    ),
    Scenario(
        "九龙灌浴表演几点开始？",
        "九龙灌浴是游客关注度很高的动态景观，建议入园后先查看当日场次并提前到达。",
        "九龙灌浴",
        "spot_explanation",
        8,
    ),
    Scenario(
        "五印坛城有什么历史文化？",
        "五印坛城适合从藏传佛教建筑意象、坛城空间和文化展示三个角度进行导览。",
        "五印坛城",
        "spot_explanation",
        6,
    ),
    Scenario(
        "拈花湾夜游路线怎么安排？",
        "夜游可以优先串联香月花街、核心演艺区域和水景灯光节点，动线不宜安排过满。",
        "拈花湾",
        "route_planning",
        7,
    ),
    Scenario(
        "带老人两小时怎么规划路线？",
        "建议选择低强度路线，优先覆盖景区入口、佛足坛、九龙灌浴和灵山大佛等核心点位。",
        "佛足坛",
        "route_planning",
        9,
    ),
    Scenario(
        "亲子游可以怎么安排半日路线？",
        "亲子半日路线建议控制步行强度，把互动景观、休息点和餐饮补给穿插安排。",
        "鹿鸣谷",
        "route_planning",
        6,
    ),
    Scenario(
        "门票多少钱，开放时间到几点？",
        "门票和开放时间会随日期调整，建议以景区当天公告和售票入口为准。",
        "通用资料",
        "ticket_opening",
        6,
    ),
    Scenario(
        "停车场在哪里，怎么到景区入口？",
        "到达后可按景区停车指引前往入口，旺季建议预留排队和步行时间。",
        "景区入口",
        "location_traffic",
        5,
    ),
    Scenario(
        "卫生间和服务中心在哪里？",
        "游客中心、主要广场和餐饮集中区附近通常配有服务设施，可结合当前位置查询。",
        "景区入口",
        "facilities",
        4,
    ),
    Scenario(
        "停车场太远了，入口找不到，我要投诉。",
        "已记录该类体验问题，建议现场加强停车到入口的指引和高峰期志愿服务。",
        "景区入口",
        "complaint_risk",
        2,
    ),
    Scenario(
        "排队太久，人太多了。",
        "高峰时段建议通过分流提示、错峰游览和等候区说明降低游客焦虑。",
        "九龙灌浴",
        "complaint_risk",
        2,
    ),
    Scenario(
        "这条路线很满意，灵山大佛太震撼了。",
        "很高兴这条路线适合你，后续可以继续补充梵宫和九龙灌浴的深度讲解。",
        "灵山大佛",
        "praise",
        4,
    ),
    Scenario(
        "灵诗音讲解很清楚，谢谢。",
        "谢谢你的反馈，灵诗音会继续为游客提供更清晰的景区讲解。",
        "通用资料",
        "praise",
        4,
    ),
)

PREFERENCE_PROFILES: tuple[PreferenceProfile, ...] = (
    PreferenceProfile("family", ("演艺亲子", "自然休闲"), "low", 120),
    PreferenceProfile("culture", ("佛教文化", "建筑艺术"), "medium", 150),
    PreferenceProfile("photo", ("摄影打卡", "自然休闲"), "medium", 180),
    PreferenceProfile("leisure", ("自然休闲", "室内体验"), "low", 90),
    PreferenceProfile("history", ("佛教文化", "室内体验"), "medium", 120),
)

FEEDBACK_TEMPLATES: tuple[tuple[int, str], ...] = (
    (5, "数字人讲解很清楚，路线推荐对第一次来灵山的游客很有帮助。"),
    (4, "整体体验不错，希望热门景点能继续补充更多排队和演出提示。"),
    (5, "灵诗音的语气很自然，景点故事讲得比较有代入感。"),
    (3, "路线功能可以用，但高峰期停车和入口指引还可以再明显一点。"),
    (4, "反馈入口很方便，导览内容和景点资料基本能满足现场咨询。"),
)

SPOT_ALIASES: dict[str, str] = {
    "灵山梵宫": "梵宫",
    "拈花湾": "拈花湾",
    "通用资料": "灵山胜境资料",
}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Seed idempotent demo data for admin dashboard charts.",
    )
    parser.add_argument("--days", type=int, default=30, help="days to seed, including today")
    parser.add_argument("--database-url", default="", help="override backend DATABASE_URL")
    parser.add_argument("--dry-run", action="store_true", help="show what would be inserted")
    parser.add_argument(
        "--reset-demo",
        action="store_true",
        help="delete existing demo_ dashboard data before inserting",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="confirm --reset-demo without an interactive prompt",
    )
    parser.add_argument("--seed", type=int, default=20260708, help="deterministic random seed")
    args = parser.parse_args()

    if args.days < 1 or args.days > 90:
        parser.error("--days must be between 1 and 90")
    if args.reset_demo and not args.yes:
        parser.error("--reset-demo requires --yes")

    os.chdir(BACKEND_ROOT)
    sys.path.insert(0, str(BACKEND_ROOT))

    from sqlalchemy import delete, func, select

    from app.core.config import settings
    from app.db.session import (
        create_database_engine,
        create_session_factory,
        initialize_database,
    )
    from app.models import ChatMessage, ChatSession, RoutePreferenceLog, UserFeedback

    database_url = args.database_url or settings.database_url
    engine = create_database_engine(database_url)
    initialize_database(engine)
    session_factory = create_session_factory(engine)

    with session_factory() as db:
        existing = _existing_demo_counts(
            db,
            ChatMessage,
            ChatSession,
            RoutePreferenceLog,
            UserFeedback,
            func,
            select,
        )
        if args.reset_demo:
            if args.dry_run:
                _print_counts("Would delete existing demo data", existing)
            else:
                _delete_demo_data(
                    db,
                    ChatMessage,
                    ChatSession,
                    RoutePreferenceLog,
                    UserFeedback,
                    delete,
                    select,
                )
        elif any(existing.values()):
            _print_counts("Existing demo data found; skip seeding to avoid duplicates", existing)
            print("Use --reset-demo --yes to rebuild the demo data window.")
            return 0

        seed_payload = _build_seed_payload(
            ChatMessage=ChatMessage,
            ChatSession=ChatSession,
            RoutePreferenceLog=RoutePreferenceLog,
            UserFeedback=UserFeedback,
            days=args.days,
            seed=args.seed,
        )
        planned = {key: len(value) for key, value in seed_payload.items()}
        if args.dry_run:
            _print_counts("Would insert demo data", planned)
            print(f"Database URL: {database_url}")
            return 0

        for objects in seed_payload.values():
            db.add_all(objects)
        try:
            db.commit()
        except Exception:
            db.rollback()
            raise
        if args.reset_demo:
            _print_counts("Deleted existing demo data", existing)
        _print_counts("Inserted demo data", planned)
        print(f"Database URL: {database_url}")
        print("Done. Refresh the admin dashboard and select 7d or 30d.")
    return 0


def _build_seed_payload(
    *,
    ChatMessage,
    ChatSession,
    RoutePreferenceLog,
    UserFeedback,
    days: int,
    seed: int,
) -> dict[str, list]:
    rng = random.Random(seed)
    today = datetime.now(UTC).date()
    start_day = today - timedelta(days=days - 1)
    sessions = []
    messages = []
    route_logs = []
    feedback_items = []

    scenario_pool = [
        scenario
        for scenario in SCENARIOS
        for _ in range(max(1, scenario.weight))
    ]
    for offset in range(days):
        current_day = start_day + timedelta(days=offset)
        daily_count = _daily_message_count(current_day, today, offset, rng)
        session_count = max(3, math.ceil(daily_count / 3))
        daily_profiles = [
            PREFERENCE_PROFILES[(offset + index) % len(PREFERENCE_PROFILES)]
            for index in range(session_count)
        ]
        for session_index, profile in enumerate(daily_profiles):
            session_id = f"{DEMO_PREFIX}{current_day:%Y%m%d}_{session_index:02d}"
            sessions.append(
                ChatSession(
                    id=session_id,
                    visitor_type=profile.visitor_type,
                    preference=json.dumps(
                        {"interest_tags": list(profile.interest_tags)},
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ),
                    started_at=_at_day_time(
                        current_day,
                        hour=9 + (session_index * 2) % 8,
                        minute=(session_index * 13) % 60,
                    ),
                )
            )

        for message_index in range(daily_count):
            scenario = scenario_pool[(offset * 11 + message_index * 7) % len(scenario_pool)]
            session_id = f"{DEMO_PREFIX}{current_day:%Y%m%d}_{message_index % session_count:02d}"
            created_at = _at_day_time(
                current_day,
                hour=rng.choice((9, 10, 11, 13, 14, 15, 16, 19)),
                minute=(message_index * 17 + offset * 3) % 60,
                second=(message_index * 11) % 60,
            )
            messages.append(
                ChatMessage(
                    session_id=session_id,
                    question=scenario.question,
                    answer=scenario.answer,
                    sources_json=_sources_for_scenario(scenario),
                    metrics_json=_metrics_for_scenario(scenario, rng),
                    created_at=created_at,
                )
            )

        for log_index, profile in enumerate(daily_profiles[: max(2, session_count // 2)]):
            route_logs.append(
                RoutePreferenceLog(
                    map_id="nianhua-bay" if "演艺亲子" in profile.interest_tags else "ling-shan",
                    visitor_type=f"{DEMO_PREFIX}{profile.visitor_type}",
                    duration_minutes=profile.duration_minutes,
                    physical_level=profile.physical_level,
                    interest_tags=list(profile.interest_tags),
                    route_count=2 + (offset + log_index) % 3,
                    created_at=_at_day_time(
                        current_day,
                        hour=10 + (log_index * 3) % 7,
                        minute=(offset * 5 + log_index * 9) % 60,
                    ),
                )
            )

        if offset % 2 == 0 or current_day >= today - timedelta(days=6):
            rating, content = FEEDBACK_TEMPLATES[offset % len(FEEDBACK_TEMPLATES)]
            feedback_items.append(
                UserFeedback(
                    rating=rating,
                    content=content,
                    page_path=f"{DEMO_FEEDBACK_PAGE_PREFIX}&day={current_day:%Y%m%d}",
                    created_at=_at_day_time(
                        current_day,
                        hour=15 + offset % 5,
                        minute=(offset * 7) % 60,
                    ),
                )
            )

    return {
        "chat_sessions": sessions,
        "chat_messages": messages,
        "route_preference_logs": route_logs,
        "user_feedback": feedback_items,
    }


def _daily_message_count(current_day: date, today: date, offset: int, rng: random.Random) -> int:
    if current_day == today:
        return 6
    base = 8 + (offset * 5) % 8
    if current_day.weekday() in {5, 6}:
        base += 5
    if current_day >= today - timedelta(days=6):
        base += 3
    return base + rng.randint(0, 3)


def _at_day_time(day: date, *, hour: int, minute: int, second: int = 0) -> datetime:
    return datetime.combine(day, time(hour=hour, minute=minute, second=second), tzinfo=UTC)


def _sources_for_scenario(scenario: Scenario) -> list[dict]:
    if scenario.spot_name in {"通用资料", "灵山胜境资料"}:
        return [
            {
                "title": "灵山胜境资料",
                "spot_name": "灵山胜境资料",
                "source_type": "curated_knowledge",
            }
        ]
    return [
        {
            "title": SPOT_ALIASES.get(scenario.spot_name, scenario.spot_name),
            "spot_name": scenario.spot_name,
            "source_type": "scenic_spot",
        }
    ]


def _metrics_for_scenario(scenario: Scenario, rng: random.Random) -> dict:
    degraded = rng.random() < 0.035
    return {
        "classification": {
            "intent": scenario.intent,
            "confidence": 0.82 + round(rng.random() * 0.14, 2),
        },
        "degraded": degraded,
        "total_ms": rng.randint(520, 1380),
        "demo": True,
    }


def _existing_demo_counts(
    db,
    ChatMessage,
    ChatSession,
    RoutePreferenceLog,
    UserFeedback,
    func,
    select,
) -> dict[str, int]:
    demo_sessions = ChatSession.id.like(f"{DEMO_PREFIX}%")
    demo_route_logs = RoutePreferenceLog.visitor_type.like(f"{DEMO_PREFIX}%")
    demo_feedback = UserFeedback.page_path.like(f"{DEMO_FEEDBACK_PAGE_PREFIX}%")
    return {
        "chat_sessions": db.scalar(
            select(func.count()).select_from(ChatSession).where(demo_sessions)
        )
        or 0,
        "chat_messages": db.scalar(
            select(func.count())
            .select_from(ChatMessage)
            .join(ChatSession, ChatMessage.session_id == ChatSession.id)
            .where(demo_sessions)
        )
        or 0,
        "route_preference_logs": db.scalar(
            select(func.count()).select_from(RoutePreferenceLog).where(demo_route_logs)
        )
        or 0,
        "user_feedback": db.scalar(
            select(func.count()).select_from(UserFeedback).where(demo_feedback)
        )
        or 0,
    }


def _delete_demo_data(
    db,
    ChatMessage,
    ChatSession,
    RoutePreferenceLog,
    UserFeedback,
    delete,
    select,
) -> None:
    demo_session_ids = list(
        db.scalars(select(ChatSession.id).where(ChatSession.id.like(f"{DEMO_PREFIX}%")))
    )
    if demo_session_ids:
        db.execute(delete(ChatMessage).where(ChatMessage.session_id.in_(demo_session_ids)))
        db.execute(delete(ChatSession).where(ChatSession.id.in_(demo_session_ids)))
    db.execute(
        delete(RoutePreferenceLog).where(
            RoutePreferenceLog.visitor_type.like(f"{DEMO_PREFIX}%")
        )
    )
    db.execute(
        delete(UserFeedback).where(
            UserFeedback.page_path.like(f"{DEMO_FEEDBACK_PAGE_PREFIX}%")
        )
    )


def _print_counts(title: str, counts: dict[str, int]) -> None:
    print(title + ":")
    for key, value in counts.items():
        print(f"  {key}: {value}")


if __name__ == "__main__":
    raise SystemExit(main())
