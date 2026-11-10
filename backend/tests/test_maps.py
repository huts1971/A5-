from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

SOURCE_PACKAGE_PATH = (
    Path(__file__).resolve().parents[2] / "Scenic Area Public Information Package"
)
KNOWLEDGE_PATH = Path(__file__).resolve().parents[2] / "knowledge"


def create_test_client(tmp_path):
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            derived_knowledge_path=str(KNOWLEDGE_PATH),
        )
    )
    return TestClient(app)


def test_get_ling_shan_map_returns_versioned_normalized_points(tmp_path):
    with create_test_client(tmp_path) as client:
        response = client.get("/api/maps/ling-shan")

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == "ling-shan"
    assert body["version"] == "ling-shan-overview-v1"
    assert body["image_url"] == "/scenic/maps/ling-shan-overview-v1.webp"
    assert body["width"] == 941
    assert body["height"] == 1672
    assert len(body["points"]) == 17
    assert {point["spot_id"] for point in body["points"]}.issuperset(
        {
            "spot_ls_entrance",
            "spot_ls_001",
            "spot_nine_dragons",
            "spot_five_mudra_mandala",
            "spot_brahma_palace",
            "spot_xiangfu_temple",
            "spot_ling_shan_buddha",
        }
    )
    assert all(0 <= point["x_ratio"] <= 1 for point in body["points"])
    assert all(0 <= point["y_ratio"] <= 1 for point in body["points"])
    assert all(
        point["calibration_status"] == "verified"
        for point in body["points"]
    )
    entrance = next(
        point for point in body["points"]
        if point["spot_id"] == "spot_ls_entrance"
    )
    assert entrance["point_type"] == "entrance"


def test_get_nianhua_bay_map_returns_second_versioned_asset(tmp_path):
    with create_test_client(tmp_path) as client:
        response = client.get("/api/maps/nianhua-bay")

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == "nianhua-bay"
    assert body["name"] == "拈花湾禅意小镇建筑参照图"
    assert body["version"] == "nianhua-bay-overview-v1"
    assert body["image_url"] == "/scenic/maps/nianhua-bay-overview-v1.png"
    assert body["width"] == 941
    assert body["height"] == 1672
    assert len(body["points"]) == 7
    assert {point["spot_id"] for point in body["points"]} == {
        "spot_nh_entrance",
        "spot_nh_001",
        "spot_nh_002",
        "spot_nh_003",
        "spot_nh_004",
        "spot_nh_005",
        "spot_nh_006",
    }
    assert all(0 <= point["x_ratio"] <= 1 for point in body["points"])
    assert all(0 <= point["y_ratio"] <= 1 for point in body["points"])
    assert all(
        point["calibration_status"] == "verified"
        for point in body["points"]
    )


def test_get_unknown_map_returns_not_found(tmp_path):
    with create_test_client(tmp_path) as client:
        response = client.get("/api/maps/not-configured")

    assert response.status_code == 404
    assert response.json()["code"] == "SCENIC_MAP_NOT_FOUND"


def test_route_path_combines_manual_segments_without_straight_fallback(tmp_path):
    with create_test_client(tmp_path) as client:
        response = client.post(
            "/api/maps/ling-shan/route-path",
            json={
                "spot_ids": [
                    "spot_ls_001",
                    "spot_nine_dragons",
                    "spot_ling_shan_buddha",
                ]
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["map_id"] == "ling-shan"
    assert body["path_complete"] is True
    assert body["network_version"] == "ling-shan-road-network-v1"
    assert body["routing_profile"] == "fastest"
    assert body["time_estimation_status"] == "map_estimate"
    assert body["calibration_confidence"] > 0
    assert len(body["segments"]) == 2
    assert len(body["segments"][0]["points"]) > 4
    assert body["segments"][0]["via_spot_ids"] == []
    assert body["segments"][0]["road_edge_ids"]
    assert body["segments"][0]["walk_minutes"] > 0
    assert body["missing_transitions"] == []


def test_route_path_rejects_cross_scenic_area_spot(tmp_path):
    with create_test_client(tmp_path) as client:
        response = client.post(
            "/api/maps/ling-shan/route-path",
            json={"spot_ids": ["spot_ls_001", "spot_nh_001"]},
        )

    assert response.status_code == 422
    assert response.json()["code"] == "ROUTE_PATH_SCENIC_AREA_MISMATCH"
