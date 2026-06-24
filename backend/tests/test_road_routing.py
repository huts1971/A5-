from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.services.road_routing import (
    RoadArc,
    RoadNetworkGraph,
    RoadNetworkMeta,
    _find_path,
)


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


def test_bootstrap_imports_two_independent_road_networks_without_access_bindings(tmp_path):
    with create_test_client(tmp_path) as client:
        with client.app.state.engine.connect() as connection:
            networks = connection.exec_driver_sql(
                """
                select map_id, data_version, time_minutes_per_pixel
                from road_network_version
                where is_active = 1
                order by map_id
                """
            ).fetchall()
            access_count = connection.exec_driver_sql(
                "select count(*) from spot_road_access"
            ).scalar_one()

    assert [row[0] for row in networks] == ["ling-shan", "nianhua-bay"]
    assert all(row[2] and row[2] > 0 for row in networks)
    assert access_count == 0


def test_time_anchors_calibrate_each_map_independently(tmp_path):
    with create_test_client(tmp_path) as client:
        ling_shan = client.post(
            "/api/maps/ling-shan/route-path",
            json={
                "spot_ids": ["spot_ls_003", "spot_ling_shan_buddha"],
                "routing_profile": "fastest",
            },
        )
        nianhua = client.post(
            "/api/maps/nianhua-bay/route-path",
            json={
                "spot_ids": ["spot_nh_001", "spot_nh_002"],
                "routing_profile": "fastest",
            },
        )

    assert ling_shan.status_code == 200
    assert nianhua.status_code == 200
    assert ling_shan.json()["segments"][0]["walk_minutes"] == 25
    assert nianhua.json()["segments"][0]["walk_minutes"] == 10
    assert ling_shan.json()["network_version"] == "ling-shan-road-network-v1"
    assert nianhua.json()["network_version"] == "nianhua-bay-road-network-v1"
    assert ling_shan.json()["time_estimation_status"] == "map_estimate"
    assert nianhua.json()["time_estimation_status"] == "map_estimate"


def test_road_route_never_promotes_passed_road_nodes_to_route_spots(tmp_path):
    with create_test_client(tmp_path) as client:
        response = client.post(
            "/api/maps/ling-shan/route-path",
            json={
                "spot_ids": ["spot_ls_003", "spot_ling_shan_buddha"],
            },
        )

    body = response.json()
    assert response.status_code == 200
    assert body["path_complete"] is True
    assert body["segments"][0]["via_spot_ids"] == []
    assert len(body["segments"][0]["road_edge_ids"]) > 1


def test_all_spot_points_snap_to_reachable_roads_inside_their_own_map(tmp_path):
    map_spots = {
        "ling-shan": [
            "spot_ls_entrance",
            "spot_ls_001",
            "spot_ls_002",
            "spot_ls_003",
            "spot_ls_004",
            "spot_ls_005",
            "spot_nine_dragons",
            "spot_ls_007",
            "spot_ls_008",
            "spot_ls_009",
            "spot_xiangfu_temple",
            "spot_ling_shan_buddha",
            "spot_ls_012",
            "spot_brahma_palace",
            "spot_five_mudra_mandala",
            "spot_ls_015",
            "spot_ls_016",
        ],
        "nianhua-bay": [
            "spot_nh_entrance",
            "spot_nh_001",
            "spot_nh_002",
            "spot_nh_003",
            "spot_nh_004",
            "spot_nh_005",
            "spot_nh_006",
        ],
    }
    with create_test_client(tmp_path) as client:
        for map_id, spot_ids in map_spots.items():
            for target in spot_ids[1:]:
                response = client.post(
                    f"/api/maps/{map_id}/route-path",
                    json={"spot_ids": [spot_ids[0], target]},
                )
                assert response.status_code == 200
                assert response.json()["path_complete"] is True


def test_legacy_profiles_share_the_same_simple_shortest_path():
    direct = RoadArc(
        edge_id="direct-high",
        from_node_id="a",
        to_node_id="b",
        points=(
            {"x_ratio": 0.0, "y_ratio": 0.0},
            {"x_ratio": 1.0, "y_ratio": 0.0},
        ),
        map_length_px=5,
    )
    easy_a = RoadArc(
        edge_id="easy-a",
        from_node_id="a",
        to_node_id="c",
        points=(
            {"x_ratio": 0.0, "y_ratio": 0.0},
            {"x_ratio": 0.5, "y_ratio": 0.5},
        ),
        map_length_px=4,
    )
    easy_b = RoadArc(
        edge_id="easy-b",
        from_node_id="c",
        to_node_id="b",
        points=(
            {"x_ratio": 0.5, "y_ratio": 0.5},
            {"x_ratio": 1.0, "y_ratio": 0.0},
        ),
        map_length_px=4,
    )
    graph = RoadNetworkGraph(
        network=RoadNetworkMeta(
            id="test-network",
            map_id="test",
            data_version="test-v1",
            time_minutes_per_pixel=1.0,
            calibration_confidence=1.0,
        ),
        graph={
            "a": [direct, easy_a],
            "c": [easy_b],
        },
        spot_nodes={
            "spot_a": ("a",),
            "spot_b": ("b",),
        },
    )

    fastest = _find_path(graph, "spot_a", "spot_b", "fastest", 1.0)
    easy = _find_path(graph, "spot_a", "spot_b", "easy", 1.0)
    accessible = _find_path(graph, "spot_a", "spot_b", "accessible", 1.0)

    assert [edge.edge_id for edge in fastest or []] == ["direct-high"]
    assert [edge.edge_id for edge in easy or []] == ["direct-high"]
    assert [edge.edge_id for edge in accessible or []] == ["direct-high"]
