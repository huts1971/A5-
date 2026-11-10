from collections import Counter
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.core.config import Settings
from app.main import create_app
from app.models import RoadEdge, Route, SpotRecommendationProfile
from app.services.road_routing import (
    clear_road_network_cache,
    find_spot_path,
)

SOURCE_PACKAGE_PATH = (
    Path(__file__).resolve().parents[2] / "Scenic Area Public Information Package"
)
DERIVED_KNOWLEDGE_PATH = Path(__file__).resolve().parents[2] / "knowledge"


def create_test_client(tmp_path):
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            derived_knowledge_path=str(DERIVED_KNOWLEDGE_PATH),
        )
    )
    return TestClient(app)


def test_get_spots_returns_22_scenic_spots_and_two_map_entries(tmp_path):
    with create_test_client(tmp_path) as client:
        response = client.get("/api/spots")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 24
    assert sum(item["id"].endswith("_entrance") for item in body["items"]) == 2
    buddha = next(
        item
        for item in body["items"]
        if item["id"] == "spot_ling_shan_buddha"
    )
    assert buddha["name"] == "灵山大佛"
    assert {"佛教文化", "建筑艺术", "摄影打卡", "自然休闲"}.issubset(
        buddha["tags"]
    )
    assert {"礼佛", "研学", "拍照"}.issubset(buddha["crowd_types"])
    assert buddha["visit_minutes"] == 45
    assert any(
        item["id"] == "spot_nh_001" and item["name"] == "拈花广场"
        for item in body["items"]
    )
    assert any(
        item["id"] == "spot_nh_entrance" and item["name"] == "景区入口"
        for item in body["items"]
    )


def test_get_spot_summary_counts_derived_ling_shan_spot_docs(tmp_path):
    with create_test_client(tmp_path) as client:
        response = client.get("/api/spots/summary")

    assert response.status_code == 200
    assert response.json() == {
        "listed_spot_count": 24,
        "collected_spot_count": 22,
    }


def test_get_spot_detail_returns_story_and_crowd_types(tmp_path):
    with create_test_client(tmp_path) as client:
        response = client.get("/api/spots/spot_brahma_palace")

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == "spot_brahma_palace"
    assert body["name"] == "灵山梵宫"
    assert "东方卢浮宫" in body["story"]
    assert {"佛教文化", "建筑艺术", "演艺亲子", "摄影打卡", "室内体验"}.issubset(
        body["tags"]
    )
    assert body["visit_minutes"] == 45
    assert {"建筑", "研学", "室内"}.issubset(body["crowd_types"])


def test_get_spot_detail_returns_unified_not_found_error(tmp_path):
    with create_test_client(tmp_path) as client:
        response = client.get("/api/spots/missing-spot")

    assert response.status_code == 404
    assert response.json() == {
        "message": "景点不存在",
        "code": "SPOT_NOT_FOUND",
        "status": 404,
    }


def test_recommend_routes_returns_one_dynamic_route(tmp_path):
    with create_test_client(tmp_path) as client:
        response = client.post(
            "/api/routes/recommend",
            json={
                "map_id": "ling-shan",
                "visitor_type": "历史文化游",
                "duration_minutes": 180,
                "physical_level": "中",
                "interest_tags": ["佛教文化", "建筑艺术"],
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert len(body["items"]) == 1
    first_route = body["items"][0]
    assert first_route["id"].startswith("dynamic_")
    assert first_route["map_id"] == "ling-shan"
    assert first_route["generation_mode"] == "dynamic"
    assert first_route["total_minutes"] <= 180
    assert first_route["time_data_complete"] is True
    assert first_route["path_complete"] is True
    assert first_route["routing_profile"] == "fastest"
    assert first_route["time_estimation_status"] == "map_estimate"
    assert first_route["preference_match"] > 0
    assert first_route["constraint_summary"] == ""
    assert first_route["recommendation_reason"] == ""
    assert len(first_route["spots"]) >= 2
    assert first_route["spots"][0]["id"] == "spot_ls_entrance"
    assert first_route["spots"][0]["transition_minutes"] == 0


def test_recommend_routes_is_stable_and_separates_scenic_areas(tmp_path):
    payload = {
        "map_id": "nianhua-bay",
        "visitor_type": "摄影游",
        "duration_minutes": 120,
        "physical_level": "低",
        "interest_tags": ["摄影", "自然"],
    }
    with create_test_client(tmp_path) as client:
        first = client.post("/api/routes/recommend", json=payload)
        second = client.post("/api/routes/recommend", json=payload)

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json() == second.json()
    assert len(first.json()["items"]) == 1
    for route in first.json()["items"]:
        assert route["map_id"] == "nianhua-bay"
        assert route["total_minutes"] <= 120
        assert route["estimated_walk_minutes"] <= 30
        assert all(
            spot["id"].startswith("spot_nh_")
            for spot in route["spots"]
        )


def test_different_preferences_change_generated_route(tmp_path):
    with create_test_client(tmp_path) as client:
        family = client.post(
            "/api/routes/recommend",
            json={
                "map_id": "ling-shan",
                "visitor_type": "亲子游",
                "duration_minutes": 120,
                "physical_level": "低",
                "interest_tags": ["演艺亲子"],
            },
        ).json()["items"][0]
        photo = client.post(
            "/api/routes/recommend",
            json={
                "map_id": "ling-shan",
                "visitor_type": "摄影游",
                "duration_minutes": 120,
                "physical_level": "中",
                "interest_tags": ["摄影打卡", "建筑艺术"],
            },
        ).json()["items"][0]

    family_spots = {spot["id"] for spot in family["spots"][1:]}
    photo_spots = {spot["id"] for spot in photo["spots"][1:]}
    assert len(family_spots.symmetric_difference(photo_spots)) >= 2


def test_road_routing_uses_one_simple_profile_for_all_preferences(tmp_path):
    with create_test_client(tmp_path) as client:
        easy = client.post(
            "/api/routes/recommend",
            json={
                "map_id": "ling-shan",
                "visitor_type": "轻松游",
                "duration_minutes": 180,
                "physical_level": "low",
                "interest_tags": ["休闲"],
            },
        )
        accessible = client.post(
            "/api/routes/recommend",
            json={
                "map_id": "ling-shan",
                "visitor_type": "轻松游",
                "duration_minutes": 180,
                "physical_level": "low",
                "interest_tags": ["休闲"],
                "accessible_required": True,
            },
        )

    assert easy.status_code == 200
    assert accessible.status_code == 200
    assert all(
        item["routing_profile"] == "fastest"
        for item in easy.json()["items"]
    )
    assert all(
        item["routing_profile"] == "fastest"
        for item in accessible.json()["items"]
    )


def test_supported_time_budgets_return_valid_dynamic_routes(tmp_path):
    with create_test_client(tmp_path) as client:
        for duration in (60, 90, 120, 180):
            response = client.post(
                "/api/routes/recommend",
                json={
                    "map_id": "ling-shan",
                    "visitor_type": "轻松游",
                    "duration_minutes": duration,
                    "physical_level": "低",
                    "interest_tags": ["自然休闲", "佛教文化"],
                },
            )
            assert response.status_code == 200
            assert len(response.json()["items"]) == 1
            route = response.json()["items"][0]
            assert route["total_minutes"] <= duration
            if duration >= 90:
                assert route["total_minutes"] >= duration * 0.75
            formal_spot_count = len(route["spots"]) - 1
            if duration == 120:
                assert 4 <= formal_spot_count <= 6
            if duration == 180:
                assert 6 <= formal_spot_count <= 8


def test_recommended_route_limits_reused_road_edges(tmp_path):
    with create_test_client(tmp_path) as client:
        response = client.post(
            "/api/routes/recommend",
            json={
                "map_id": "nianhua-bay",
                "duration_minutes": 180,
                "physical_level": "high",
                "interest_tags": ["摄影打卡", "自然休闲"],
            },
        )
        route = response.json()["items"][0]
        with client.app.state.SessionLocal() as session:
            edge_lengths = dict(
                session.execute(
                    select(RoadEdge.id, RoadEdge.map_length_px).where(
                        RoadEdge.map_id == "nianhua-bay"
                    )
                ).all()
            )
            traversed: Counter[str] = Counter()
            total_length = 0.0
            repeated_length = 0.0
            spot_ids = [spot["id"] for spot in route["spots"]]
            for from_spot_id, to_spot_id in zip(
                spot_ids,
                spot_ids[1:],
            ):
                path, _ = find_spot_path(
                    session,
                    "nianhua-bay",
                    from_spot_id,
                    to_spot_id,
                )
                assert path is not None
                for edge_id in path.edge_ids:
                    edge_length = edge_lengths[edge_id]
                    total_length += edge_length
                    if traversed[edge_id] > 0:
                        repeated_length += edge_length
                    traversed[edge_id] += 1

    repeat_ratio = repeated_length / total_length
    repeat_minutes = route["estimated_walk_minutes"] * repeat_ratio
    assert repeat_ratio <= 0.10
    assert repeat_minutes <= 5


def test_recommendation_profiles_cover_all_22_spots(tmp_path):
    cases = [
        (
            "ling-shan",
            60,
            "low",
            ["演艺亲子"],
        ),
        (
            "ling-shan",
            180,
            "low",
            ["演艺亲子"],
        ),
        (
            "ling-shan",
            180,
            "medium",
            ["佛教文化", "建筑艺术"],
        ),
        (
            "ling-shan",
            180,
            "medium",
            ["摄影打卡", "自然休闲"],
        ),
        (
            "ling-shan",
            180,
            "medium",
            ["建筑艺术", "室内体验"],
        ),
        (
            "nianhua-bay",
            180,
            "high",
            ["摄影打卡", "自然休闲"],
        ),
    ]
    covered: set[str] = set()
    with create_test_client(tmp_path) as client:
        with client.app.state.SessionLocal() as session:
            profiles = session.scalars(
                select(SpotRecommendationProfile)
            ).all()
            assert len(profiles) == 22
        for map_id, duration, physical_level, interest_tags in cases:
            route = client.post(
                "/api/routes/recommend",
                json={
                    "map_id": map_id,
                    "duration_minutes": duration,
                    "physical_level": physical_level,
                    "interest_tags": interest_tags,
                },
            ).json()["items"][0]
            covered.update(
                spot["id"]
                for spot in route["spots"]
                if not spot["id"].endswith("_entrance")
            )

    assert len(covered) == 22
    assert {
        "spot_ling_shan_buddha",
        "spot_brahma_palace",
        "spot_five_mudra_mandala",
        "spot_nh_006",
    }.issubset(covered)


def test_bootstrap_imports_nine_versioned_route_templates(tmp_path):
    with create_test_client(tmp_path) as client:
        with client.app.state.SessionLocal() as session:
            routes = session.query(Route).all()

    assert len(routes) == 9
    assert sum(route.map_id == "ling-shan" for route in routes) == 5
    assert sum(route.map_id == "nianhua-bay" for route in routes) == 4


def test_recommend_routes_uses_template_fallback_without_walk_graph(tmp_path):
    with create_test_client(tmp_path) as client:
        with client.app.state.SessionLocal() as session:
            session.execute(delete(RoadEdge))
            session.commit()
            clear_road_network_cache(session, "ling-shan")

        response = client.post(
            "/api/routes/recommend",
            json={
                "map_id": "ling-shan",
                "visitor_type": "历史文化游",
                "duration_minutes": 180,
                "physical_level": "中",
                "interest_tags": ["佛教文化", "建筑"],
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert len(body["items"]) == 1
    assert all(
        item["generation_mode"] == "template_fallback"
        for item in body["items"]
    )
    assert all(item["time_data_complete"] is False for item in body["items"])
    assert all(
        spot["transition_minutes"] is None
        for item in body["items"]
        for spot in item["spots"][1:]
    )
