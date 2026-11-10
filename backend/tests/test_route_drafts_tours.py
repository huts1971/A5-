from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.core.config import Settings
from app.main import create_app
from app.models import RoadEdge, RouteDraftSpot, TourSession
from app.services.road_routing import clear_road_network_cache

SOURCE_PACKAGE_PATH = (
    Path(__file__).resolve().parents[2] / "Scenic Area Public Information Package"
)


def create_test_client(tmp_path):
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
        )
    )
    return TestClient(app)


def create_draft(client, *, budget=180):
    response = client.post(
        "/api/route-drafts",
        json={
            "source_route_id": "route_classic",
            "name": "我的礼佛路线",
            "theme": "历史文化游",
            "duration_budget": budget,
            "spots": [
                {
                    "spot_id": "spot_nine_dragons",
                    "stay_minutes": 25,
                    "reason": "从九龙灌浴开始。",
                },
                {
                    "spot_id": "spot_ling_shan_buddha",
                    "stay_minutes": 45,
                    "reason": "前往灵山大佛。",
                },
            ],
        },
    )
    assert response.status_code == 201
    return response.json()


def create_three_spot_draft(client):
    response = client.post(
        "/api/route-drafts",
        json={
            "name": "三站回顾测试路线",
            "theme": "文化",
            "duration_budget": 300,
            "spots": [
                {
                    "spot_id": "spot_nine_dragons",
                    "stay_minutes": 20,
                },
                {
                    "spot_id": "spot_ling_shan_buddha",
                    "stay_minutes": 30,
                },
                {
                    "spot_id": "spot_brahma_palace",
                    "stay_minutes": 40,
                },
            ],
        },
    )
    assert response.status_code == 201
    return response.json()


def test_route_draft_supports_add_reorder_delete_and_undo(tmp_path):
    with create_test_client(tmp_path) as client:
        draft = create_draft(client, budget=300)
        draft_id = draft["id"]
        assert [spot["spot_id"] for spot in draft["spots"]] == [
            "spot_nine_dragons",
            "spot_ling_shan_buddha",
        ]
        assert draft["revision_count"] == 0

        added = client.post(
            f"/api/route-drafts/{draft_id}/spots",
            json={
                "spot_id": "spot_brahma_palace",
                "position": 1,
                "stay_minutes": 30,
                "reason": "手动加入梵宫。",
            },
        )
        assert added.status_code == 200
        assert [spot["spot_id"] for spot in added.json()["spots"]] == [
            "spot_nine_dragons",
            "spot_brahma_palace",
            "spot_ling_shan_buddha",
        ]
        assert added.json()["revision_count"] == 1

        reordered = client.post(
            f"/api/route-drafts/{draft_id}/spots/reorder",
            json={
                "spot_ids": [
                    "spot_ling_shan_buddha",
                    "spot_brahma_palace",
                    "spot_nine_dragons",
                ]
            },
        )
        assert reordered.status_code == 200
        assert reordered.json()["spots"][0]["sequence"] == 0
        assert reordered.json()["spots"][0]["spot_id"] == "spot_ling_shan_buddha"
        assert reordered.json()["revision_count"] == 2

        deleted = client.delete(
            f"/api/route-drafts/{draft_id}/spots/spot_brahma_palace"
        )
        assert deleted.status_code == 200
        assert [spot["spot_id"] for spot in deleted.json()["spots"]] == [
            "spot_ling_shan_buddha",
            "spot_nine_dragons",
        ]

        undone = client.post(f"/api/route-drafts/{draft_id}/undo")
        assert undone.status_code == 200
        assert [spot["spot_id"] for spot in undone.json()["spots"]] == [
            "spot_ling_shan_buddha",
            "spot_brahma_palace",
            "spot_nine_dragons",
        ]
        assert undone.json()["revision_count"] == 2


def test_route_draft_rejects_duplicates_minimum_and_invalid_reorder(tmp_path):
    with create_test_client(tmp_path) as client:
        draft = create_draft(client)
        draft_id = draft["id"]

        duplicate = client.post(
            f"/api/route-drafts/{draft_id}/spots",
            json={"spot_id": "spot_nine_dragons"},
        )
        assert duplicate.status_code == 409
        assert duplicate.json()["code"] == "DRAFT_DUPLICATE_SPOT"

        invalid_reorder = client.post(
            f"/api/route-drafts/{draft_id}/spots/reorder",
            json={"spot_ids": ["spot_nine_dragons"]},
        )
        assert invalid_reorder.status_code == 422
        assert invalid_reorder.json()["code"] == "DRAFT_REORDER_INVALID"

        first_delete = client.delete(
            f"/api/route-drafts/{draft_id}/spots/spot_ling_shan_buddha"
        )
        assert first_delete.status_code == 200
        minimum = client.delete(
            f"/api/route-drafts/{draft_id}/spots/spot_nine_dragons"
        )
        assert minimum.status_code == 409
        assert minimum.json()["code"] == "DRAFT_MINIMUM_SPOTS"


def test_route_draft_rejects_missing_source_route(tmp_path):
    with create_test_client(tmp_path) as client:
        response = client.post(
            "/api/route-drafts",
            json={
                "source_route_id": "missing-route",
                "name": "无效来源路线",
                "duration_budget": 120,
                "spots": [{"spot_id": "spot_nine_dragons"}],
            },
        )

    assert response.status_code == 404
    assert response.json()["code"] == "ROUTE_NOT_FOUND"


def test_route_draft_budget_requires_explicit_confirmation(tmp_path):
    with create_test_client(tmp_path) as client:
        response = client.post(
            "/api/route-drafts",
            json={
                "name": "短时路线",
                "duration_budget": 30,
                "spots": [
                    {
                        "spot_id": "spot_nine_dragons",
                        "stay_minutes": 10,
                    },
                    {
                        "spot_id": "spot_five_mudra_mandala",
                        "stay_minutes": 10,
                    },
                ],
            },
        )
        assert response.status_code == 201
        draft_id = response.json()["id"]
        assert response.json()["total_minutes"] == (
            response.json()["stay_minutes"]
            + response.json()["estimated_walk_minutes"]
        )
        assert response.json()["time_estimation_status"] == "map_estimate"

        rejected = client.post(
            f"/api/route-drafts/{draft_id}/spots",
            json={
                "spot_id": "spot_brahma_palace",
                "stay_minutes": 30,
            },
        )
        assert rejected.status_code == 409
        assert rejected.json()["code"] == "DRAFT_BUDGET_EXCEEDED"

        accepted = client.post(
            f"/api/route-drafts/{draft_id}/spots",
            json={
                "spot_id": "spot_brahma_palace",
                "stay_minutes": 30,
                "allow_budget_exceeded": True,
            },
        )
        assert accepted.status_code == 200
        assert accepted.json()["budget_exceeded"] is True
        assert len(accepted.json()["spots"]) == 3


def test_route_draft_marks_incomplete_walk_time_without_fake_total(tmp_path):
    with create_test_client(tmp_path) as client:
        with client.app.state.SessionLocal() as session:
            session.execute(delete(RoadEdge))
            session.commit()
            clear_road_network_cache(session, "ling-shan")

        draft = create_draft(client)

    assert draft["time_data_complete"] is False
    assert draft["estimated_walk_minutes"] == 0
    assert draft["total_minutes"] == draft["stay_minutes"]
    assert draft["budget_exceeded"] is False
    assert all(
        spot["transition_minutes"] is None
        for spot in draft["spots"][1:]
    )


def test_route_draft_replaces_other_scenic_area_atomically(tmp_path):
    with create_test_client(tmp_path) as client:
        draft = create_draft(client, budget=300)
        rejected = client.post(
            f"/api/route-drafts/{draft['id']}/spots",
            json={"spot_id": "spot_nh_001"},
        )
        assert rejected.status_code == 409
        assert rejected.json()["code"] == "DRAFT_SCENIC_AREA_MISMATCH"

        replaced = client.post(
            f"/api/route-drafts/{draft['id']}/spots",
            json={
                "spot_id": "spot_nh_001",
                "replace_other_area": True,
                "allow_budget_exceeded": True,
            },
        )

    assert replaced.status_code == 200
    body = replaced.json()
    assert body["name"] == "拈花湾自定义路线"
    assert [spot["spot_id"] for spot in body["spots"]] == ["spot_nh_001"]


def test_scope_and_tour_remove_legacy_mixed_scenic_area(tmp_path):
    with create_test_client(tmp_path) as client:
        draft = create_draft(client, budget=300)
        with client.app.state.SessionLocal() as session:
            session.add(
                RouteDraftSpot(
                    draft_id=draft["id"],
                    spot_id="spot_nh_001",
                    sequence=2,
                    stay_minutes=20,
                    reason="旧版本混入的拈花湾景点。",
                )
            )
            session.commit()

        scoped = client.post(
            f"/api/route-drafts/{draft['id']}/scope",
            json={"map_id": "nianhua-bay"},
        )
        assert scoped.status_code == 200
        assert [spot["spot_id"] for spot in scoped.json()["spots"]] == [
            "spot_nh_001"
        ]

        started = client.post(
            "/api/tours",
            json={
                "route_draft_id": draft["id"],
                "map_id": "nianhua-bay",
            },
        )

    assert started.status_code == 201
    assert started.json()["name"] == "拈花湾自定义路线"
    assert [spot["spot_id"] for spot in started.json()["spots"]] == [
        "spot_nh_001"
    ]


def test_tour_session_progresses_and_builds_recap(tmp_path):
    with create_test_client(tmp_path) as client:
        draft = create_draft(client)
        started = client.post(
            "/api/tours",
            json={"route_draft_id": draft["id"]},
        )
        assert started.status_code == 201
        tour = started.json()
        tour_id = tour["id"]
        assert tour["status"] == "active"
        assert tour["spots"][0]["status"] == "current"
        with client.app.state.SessionLocal() as session:
            stored_tour = session.get(TourSession, tour_id)
            assert stored_tour is not None
            assert stored_tour.route_snapshot["map_id"] == "ling-shan"
            assert (
                stored_tour.route_snapshot["recap_formula_version"]
                == "demo-v1"
            )

        arrived = client.post(
            f"/api/tours/{tour_id}/events",
            json={
                "event_type": "spot_arrived",
                "spot_id": "spot_nine_dragons",
            },
        )
        assert arrived.status_code == 200
        assert arrived.json()["spots"][0]["arrived_at"]

        completed = client.post(
            f"/api/tours/{tour_id}/events",
            json={
                "event_type": "spot_completed",
                "spot_id": "spot_nine_dragons",
            },
        )
        assert completed.status_code == 200
        assert completed.json()["current_index"] == 1
        assert completed.json()["spots"][0]["status"] == "completed"
        assert completed.json()["spots"][1]["status"] == "current"

        skipped = client.post(
            f"/api/tours/{tour_id}/events",
            json={
                "event_type": "spot_skipped",
                "spot_id": "spot_ling_shan_buddha",
            },
        )
        assert skipped.status_code == 200
        assert skipped.json()["status"] == "finished"
        assert skipped.json()["finished_at"]

        recap = client.get(f"/api/tours/{tour_id}/recap")
        assert recap.status_code == 200
        recap_body = recap.json()
        assert recap_body["map_id"] == "ling-shan"
        assert recap_body["completed_count"] == 1
        assert recap_body["skipped_count"] == 1
        assert [item["result"] for item in recap_body["actual_order"]] == [
            "completed",
            "skipped",
        ]
        assert recap_body["actual_order"][0]["planned_stay_minutes"] == 25
        assert "transition_minutes" in recap_body["actual_order"][0]
        assert recap_body["movement"]["confidence"] == "medium"
        assert recap_body["movement"]["formula_version"] == "demo-v1"
        assert recap_body["movement"]["planned_scenic_minutes"] == 25


def test_tour_rejects_out_of_order_and_post_finish_events(tmp_path):
    with create_test_client(tmp_path) as client:
        draft = create_draft(client)
        tour = client.post(
            "/api/tours",
            json={"route_draft_id": draft["id"]},
        ).json()

        out_of_order = client.post(
            f"/api/tours/{tour['id']}/events",
            json={
                "event_type": "spot_completed",
                "spot_id": "spot_ling_shan_buddha",
            },
        )
        assert out_of_order.status_code == 409
        assert out_of_order.json()["code"] == "TOUR_SPOT_OUT_OF_ORDER"

        finished = client.post(
            f"/api/tours/{tour['id']}/events",
            json={"event_type": "tour_finished"},
        )
        assert finished.status_code == 200

        after_finish = client.post(
            f"/api/tours/{tour['id']}/events",
            json={"event_type": "spot_arrived"},
        )
        assert after_finish.status_code == 409
        assert after_finish.json()["code"] == "TOUR_ALREADY_FINISHED"


def test_tour_recap_includes_draft_adjustments_and_ai_topics(tmp_path):
    with create_test_client(tmp_path) as client:
        draft = create_draft(client, budget=300)
        adjusted = client.post(
            f"/api/route-drafts/{draft['id']}/spots",
            json={
                "spot_id": "spot_brahma_palace",
                "stay_minutes": 30,
            },
        )
        assert adjusted.status_code == 200
        assert adjusted.json()["revision_count"] == 1

        tour = client.post(
            "/api/tours",
            json={"route_draft_id": draft["id"]},
        ).json()
        consulted = client.post(
            f"/api/tours/{tour['id']}/events",
            json={
                "event_type": "ai_consulted",
                "topic": "九龙灌浴典故",
            },
        )
        assert consulted.status_code == 200
        assert consulted.json()["current_index"] == 0

        recap = client.get(f"/api/tours/{tour['id']}/recap")
        assert recap.status_code == 200
        assert recap.json()["adjustment_count"] == 1
        assert recap.json()["ai_topics"] == ["九龙灌浴典故"]


def test_tour_recap_excludes_entrance_from_visible_results(tmp_path):
    with create_test_client(tmp_path) as client:
        draft_response = client.post(
            "/api/route-drafts",
            json={
                "name": "入口回顾测试路线",
                "duration_budget": 180,
                "spots": [
                    {
                        "spot_id": "spot_ls_entrance",
                        "stay_minutes": 5,
                    },
                    {
                        "spot_id": "spot_nine_dragons",
                        "stay_minutes": 25,
                    },
                ],
            },
        )
        assert draft_response.status_code == 201
        tour = client.post(
            "/api/tours",
            json={"route_draft_id": draft_response.json()["id"]},
        ).json()
        with client.app.state.SessionLocal() as session:
            stored_tour = session.get(TourSession, tour["id"])
            assert stored_tour is not None
            snapshot = dict(stored_tour.route_snapshot)
            spots = [dict(spot) for spot in snapshot["spots"]]
            spots[0]["transition_minutes"] = 0
            spots[1]["transition_minutes"] = 12
            snapshot["spots"] = spots
            stored_tour.route_snapshot = snapshot
            session.commit()

        for spot_id in ("spot_ls_entrance", "spot_nine_dragons"):
            progressed = client.post(
                f"/api/tours/{tour['id']}/events",
                json={
                    "event_type": "spot_completed",
                    "spot_id": spot_id,
                },
            )
            assert progressed.status_code == 200

        recap = client.get(f"/api/tours/{tour['id']}/recap").json()

    assert recap["completed_count"] == 1
    assert recap["skipped_count"] == 0
    assert recap["recommended_order"] == ["九龙灌浴"]
    assert [spot["spot_id"] for spot in recap["actual_order"]] == [
        "spot_nine_dragons"
    ]
    assert recap["movement"] == {
        "estimated_walking_minutes": 12,
        "planned_scenic_minutes": 25,
        "estimated_distance_meters": 840,
        "estimated_steps": 1200,
        "estimated_calories_kcal": 40,
        "coverage_ratio": 1.0,
        "confidence": "medium",
        "formula_version": "demo-v1",
    }


def test_tour_recap_movement_low_and_unavailable_coverage(tmp_path):
    with create_test_client(tmp_path) as client:
        low_draft = create_three_spot_draft(client)
        low_tour = client.post(
            "/api/tours",
            json={"route_draft_id": low_draft["id"]},
        ).json()
        with client.app.state.SessionLocal() as session:
            stored_tour = session.get(TourSession, low_tour["id"])
            assert stored_tour is not None
            snapshot = dict(stored_tour.route_snapshot)
            spots = [dict(spot) for spot in snapshot["spots"]]
            transitions = [0, 10, None]
            for spot, transition in zip(spots, transitions, strict=True):
                spot["transition_minutes"] = transition
            snapshot["spots"] = spots
            stored_tour.route_snapshot = snapshot
            session.commit()
        for spot in low_tour["spots"]:
            progressed = client.post(
                f"/api/tours/{low_tour['id']}/events",
                json={
                    "event_type": "spot_completed",
                    "spot_id": spot["spot_id"],
                },
            )
            assert progressed.status_code == 200

        low_movement = client.get(
            f"/api/tours/{low_tour['id']}/recap"
        ).json()["movement"]
        assert low_movement == {
            "estimated_walking_minutes": 10,
            "planned_scenic_minutes": 90,
            "estimated_distance_meters": 700,
            "estimated_steps": 1000,
            "estimated_calories_kcal": 35,
            "coverage_ratio": 0.67,
            "confidence": "low",
            "formula_version": "demo-v1",
        }

        unavailable_draft = create_draft(client)
        unavailable_tour = client.post(
            "/api/tours",
            json={"route_draft_id": unavailable_draft["id"]},
        ).json()
        with client.app.state.SessionLocal() as session:
            stored_tour = session.get(TourSession, unavailable_tour["id"])
            assert stored_tour is not None
            snapshot = dict(stored_tour.route_snapshot)
            spots = [dict(spot) for spot in snapshot["spots"]]
            spots[0]["transition_minutes"] = 0
            spots[1]["transition_minutes"] = None
            snapshot["spots"] = spots
            stored_tour.route_snapshot = snapshot
            session.commit()
        for spot in unavailable_tour["spots"]:
            progressed = client.post(
                f"/api/tours/{unavailable_tour['id']}/events",
                json={
                    "event_type": "spot_completed",
                    "spot_id": spot["spot_id"],
                },
            )
            assert progressed.status_code == 200

        unavailable_movement = client.get(
            f"/api/tours/{unavailable_tour['id']}/recap"
        ).json()["movement"]

    assert unavailable_movement["coverage_ratio"] == 0.5
    assert unavailable_movement["confidence"] == "unavailable"
    assert unavailable_movement["estimated_walking_minutes"] is None
    assert unavailable_movement["planned_scenic_minutes"] is None
    assert unavailable_movement["estimated_distance_meters"] is None
    assert unavailable_movement["estimated_steps"] is None
    assert unavailable_movement["estimated_calories_kcal"] is None


def test_old_tour_recap_infers_map_and_formula_version(tmp_path):
    with create_test_client(tmp_path) as client:
        draft_response = client.post(
            "/api/route-drafts",
            json={
                "name": "旧拈花湾路线",
                "duration_budget": 120,
                "spots": [
                    {
                        "spot_id": "spot_nh_001",
                        "stay_minutes": 20,
                    }
                ],
            },
        )
        assert draft_response.status_code == 201
        tour = client.post(
            "/api/tours",
            json={"route_draft_id": draft_response.json()["id"]},
        ).json()
        with client.app.state.SessionLocal() as session:
            stored_tour = session.get(TourSession, tour["id"])
            assert stored_tour is not None
            snapshot = dict(stored_tour.route_snapshot)
            snapshot.pop("map_id", None)
            snapshot.pop("recap_formula_version", None)
            stored_tour.route_snapshot = snapshot
            session.commit()

        recap = client.get(f"/api/tours/{tour['id']}/recap")

    assert recap.status_code == 200
    assert recap.json()["map_id"] == "nianhua-bay"
    assert recap.json()["movement"]["formula_version"] == "demo-v1"
