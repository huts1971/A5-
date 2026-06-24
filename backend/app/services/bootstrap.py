from __future__ import annotations

import hashlib
import json
from math import hypot
from pathlib import Path
import zipfile
import xml.etree.ElementTree as ET

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import (
    ApprovedWebSource,
    ApprovedWebFact,
    EntityAlias,
    KnowledgeChunk,
    KnowledgeDoc,
    MapAsset,
    MapPoint,
    ManualPathSegment,
    RoadEdge,
    RoadNetworkVersion,
    RoadNode,
    Route,
    RouteSpot,
    RouteTimeAnchor,
    ScenicSpot,
    SourceRef,
    SpotRecommendationProfile,
    SpotRoadAccess,
    SpotAdjacency,
    SpotFact,
    TagAlias,
)


LING_SHAN_SPOTS = [
    {
        "id": "spot_ling_shan_buddha",
        "name": "灵山大佛",
        "summary": "灵山胜境的核心地标，适合礼佛、文化讲解和远景拍摄。",
        "story": "灵山大佛是景区最具代表性的景点，适合围绕佛教文化、造像艺术和祈福体验展开讲解。",
        "tags": ["佛教文化", "地标", "摄影"],
        "visit_minutes": 40,
        "crowd_types": ["历史文化游", "摄影游", "轻松游"],
        "image_url": "",
        "sort_order": 10,
    },
    {
        "id": "spot_nine_dragons",
        "name": "九龙灌浴",
        "summary": "以动态演艺呈现佛教故事，是亲子游客容易理解的互动景点。",
        "story": "九龙灌浴适合用故事化方式介绍佛教传说和景区仪式感。",
        "tags": ["演艺", "亲子", "佛教文化"],
        "visit_minutes": 25,
        "crowd_types": ["亲子游", "历史文化游"],
        "image_url": "",
        "sort_order": 20,
    },
    {
        "id": "spot_brahma_palace",
        "name": "梵宫",
        "summary": "融合建筑、艺术和文化展示的室内核心景点。",
        "story": "梵宫适合讲解建筑空间、艺术装饰和佛教文化展示。",
        "tags": ["建筑", "艺术", "室内"],
        "visit_minutes": 45,
        "crowd_types": ["历史文化游", "摄影游", "轻松游"],
        "image_url": "",
        "sort_order": 30,
    },
    {
        "id": "spot_five_mudra_mandala",
        "name": "五印坛城",
        "summary": "适合深度文化游览的藏传佛教文化展示空间。",
        "story": "五印坛城可用于介绍坛城意象、文化符号和沉浸式参观体验。",
        "tags": ["藏传佛教", "文化", "室内"],
        "visit_minutes": 35,
        "crowd_types": ["历史文化游", "轻松游"],
        "image_url": "",
        "sort_order": 40,
    },
    {
        "id": "spot_xiangfu_temple",
        "name": "祥符禅寺",
        "summary": "景区中的禅寺空间，适合安静游览和文化讲解。",
        "story": "祥符禅寺适合讲解禅意空间、礼佛动线和静态游览体验。",
        "tags": ["禅寺", "礼佛", "安静"],
        "visit_minutes": 30,
        "crowd_types": ["历史文化游", "轻松游"],
        "image_url": "",
        "sort_order": 50,
    },
]

LING_SHAN_ROUTES = [
    {
        "id": "route_classic",
        "name": "灵山经典礼佛路线",
        "theme": "历史文化游",
        "duration_minutes": 150,
        "suitable_crowd": ["历史文化游", "轻松游"],
        "description": "覆盖灵山大佛、九龙灌浴和梵宫，适合第一次到访的游客。",
        "spots": [
            ("spot_nine_dragons", 25, "先用动态演艺进入灵山文化语境。"),
            ("spot_ling_shan_buddha", 45, "核心地标，适合礼佛和拍照。"),
            ("spot_brahma_palace", 45, "室内参观，补充建筑与艺术体验。"),
        ],
    },
    {
        "id": "route_culture_deep",
        "name": "灵山文化深度路线",
        "theme": "深度文化游",
        "duration_minutes": 180,
        "suitable_crowd": ["历史文化游", "摄影游"],
        "description": "串联核心文化空间，适合想深入了解佛教文化和建筑艺术的游客。",
        "spots": [
            ("spot_ling_shan_buddha", 45, "从核心地标理解景区主题。"),
            ("spot_brahma_palace", 50, "重点看建筑空间与艺术装饰。"),
            ("spot_five_mudra_mandala", 40, "补充坛城文化和沉浸式体验。"),
            ("spot_xiangfu_temple", 30, "以安静禅寺空间收束路线。"),
        ],
    },
]

_KNOWLEDGE_CHUNK_CACHE: dict[tuple[str, str], list[str]] = {}


def bootstrap_ling_shan_data(
    session: Session,
    source_package_path: str,
    derived_knowledge_path: str | None = None,
) -> None:
    derived_path = Path(derived_knowledge_path) if derived_knowledge_path else None
    has_curated_spots = bool(
        _read_json_list(derived_path / "curated" / "spots.json")
        if derived_path
        else []
    )
    has_route_templates = bool(
        list((derived_path / "routes").glob("*templates*.json"))
        if derived_path and (derived_path / "routes").exists()
        else []
    )
    existing_spot = session.scalar(select(ScenicSpot.id).limit(1))
    if existing_spot is None and not has_curated_spots:
        for spot_data in LING_SHAN_SPOTS:
            session.add(ScenicSpot(**spot_data))

    existing_route = session.scalar(select(Route.id).limit(1))
    if existing_route is None and not has_route_templates:
        for route_data in LING_SHAN_ROUTES:
            spots = route_data["spots"]
            route_fields = {
                key: value
                for key, value in route_data.items()
                if key != "spots"
            }
            session.add(Route(**route_fields))
            for sequence, (spot_id, stay_minutes, reason) in enumerate(spots, start=1):
                session.add(
                    RouteSpot(
                        route_id=route_fields["id"],
                        spot_id=spot_id,
                        sequence=sequence,
                        stay_minutes=stay_minutes,
                        reason=reason,
                    )
                )

    _import_knowledge_docs(session, Path(source_package_path))
    if derived_path:
        _import_curated_structured_data(session, derived_path)
        _import_derived_markdown_docs(session, derived_path)
        _import_scenic_maps(session, derived_path)
        session.flush()
        _import_spot_recommendation_profiles(session, derived_path)
        _import_route_templates(session, derived_path)
        _import_spot_adjacencies(session, derived_path)
        imported_road_maps = _import_road_networks(session, derived_path)
        _import_route_time_anchors(session, derived_path)
        session.flush()
        if imported_road_maps:
            from app.services.road_routing import recalibrate_network

            for map_id in imported_road_maps:
                recalibrate_network(session, map_id)
    session.commit()


def _import_knowledge_docs(session: Session, source_package_path: Path) -> None:
    if not source_package_path.exists():
        return

    source_files = [
        file_path
        for file_path in sorted(source_package_path.iterdir())
        if file_path.is_file()
        and file_path.suffix.lower() == ".docx"
        and not file_path.name.startswith("~$")
    ]
    imported_doc_ids = {f"doc_{index:03d}" for index in range(1, len(source_files) + 1)}

    for index, file_path in enumerate(source_files, start=1):
        doc_id = f"doc_{index:03d}"
        title = file_path.stem
        content_hash = _file_hash(file_path)
        doc = session.get(KnowledgeDoc, doc_id)
        if doc is None:
            doc = KnowledgeDoc(
                id=doc_id,
                title=title,
                source_type=file_path.suffix.removeprefix(".").lower(),
                path=str(file_path),
                content_hash=content_hash,
            )
            session.add(doc)
            should_refresh = True
        else:
            should_refresh = (
                doc.content_hash != content_hash
                or doc.path != str(file_path)
                or _raw_doc_needs_refresh(session, doc_id)
            )
            doc.title = title
            doc.source_type = file_path.suffix.removeprefix(".").lower()
            doc.path = str(file_path)
            doc.content_hash = content_hash

        if not should_refresh:
            continue

        session.execute(delete(KnowledgeChunk).where(KnowledgeChunk.doc_id == doc_id))
        for chunk_index, chunk_text in enumerate(_knowledge_chunks(file_path)):
            session.add(
                KnowledgeChunk(
                    doc_id=doc_id,
                    chunk_text=chunk_text,
                    chunk_index=chunk_index,
                    spot_id=None,
                    vector_id=None,
                )
            )

    stale_docs = select(KnowledgeDoc.id).where(
        KnowledgeDoc.id.like("doc_%"),
        KnowledgeDoc.id.not_in(imported_doc_ids),
    )
    session.execute(delete(KnowledgeChunk).where(KnowledgeChunk.doc_id.in_(stale_docs)))
    session.execute(
        delete(KnowledgeDoc).where(
            KnowledgeDoc.id.like("doc_%"),
            KnowledgeDoc.id.not_in(imported_doc_ids),
        )
    )


def _raw_doc_needs_refresh(session: Session, doc_id: str) -> bool:
    chunk_count = session.scalar(
        select(func.count(KnowledgeChunk.id)).where(KnowledgeChunk.doc_id == doc_id)
    )
    if not chunk_count:
        return True
    first_chunk = session.scalar(
        select(KnowledgeChunk.chunk_text)
        .where(KnowledgeChunk.doc_id == doc_id)
        .order_by(KnowledgeChunk.chunk_index)
        .limit(1)
    )
    return bool(first_chunk and first_chunk.startswith("资料文件："))


def _knowledge_chunks(file_path: Path) -> list[str]:
    cache_key = (str(file_path), _file_hash(file_path))
    if cache_key in _KNOWLEDGE_CHUNK_CACHE:
        return _KNOWLEDGE_CHUNK_CACHE[cache_key]
    text = _extract_knowledge_text(file_path)
    chunks = _chunk_text(text, limit=1200) or [f"资料文件：{file_path.name}"]
    _KNOWLEDGE_CHUNK_CACHE[cache_key] = chunks
    return chunks


def _extract_knowledge_text(file_path: Path) -> str:
    suffix = file_path.suffix.lower()
    if suffix == ".md":
        return file_path.read_text(encoding="utf-8")
    if suffix == ".docx":
        return _extract_docx_text(file_path)
    return f"资料文件：{file_path.name}"


def _chunk_text(text: str, limit: int = 1200) -> list[str]:
    paragraphs = [paragraph.strip() for paragraph in text.splitlines() if paragraph.strip()]
    chunks: list[str] = []
    current = ""
    for paragraph in paragraphs:
        if not current:
            current = paragraph
            continue
        if len(current) + len(paragraph) + 1 <= limit:
            current = f"{current}\n{paragraph}"
            continue
        chunks.append(current)
        current = paragraph
    if current:
        chunks.append(current)
    return chunks


def _import_derived_markdown_docs(session: Session, derived_knowledge_path: Path) -> None:
    docs_path = derived_knowledge_path / "docs"
    if not docs_path.exists():
        return

    doc_files = sorted(docs_path.glob("*.md"))
    imported_doc_ids = {f"derived_doc_{index:03d}" for index in range(1, len(doc_files) + 1)}

    for index, file_path in enumerate(doc_files, start=1):
        doc_id = f"derived_doc_{index:03d}"
        content_hash = _file_hash(file_path)
        doc = session.get(KnowledgeDoc, doc_id)
        if doc is None:
            doc = KnowledgeDoc(
                id=doc_id,
                title=file_path.stem,
                source_type="md",
                path=str(file_path),
                content_hash=content_hash,
            )
            session.add(doc)
            should_refresh = True
        else:
            should_refresh = doc.content_hash != content_hash or doc.path != str(file_path)
            doc.title = file_path.stem
            doc.source_type = "md"
            doc.path = str(file_path)
            doc.content_hash = content_hash

        if not should_refresh:
            continue

        session.execute(delete(KnowledgeChunk).where(KnowledgeChunk.doc_id == doc_id))
        for chunk_index, chunk_text in enumerate(_knowledge_chunks(file_path)):
            session.add(
                KnowledgeChunk(
                    doc_id=doc_id,
                    chunk_text=chunk_text,
                    chunk_index=chunk_index,
                    spot_id=None,
                    vector_id=None,
                )
            )

    stale_docs = select(KnowledgeDoc.id).where(
        KnowledgeDoc.id.like("derived_doc_%"),
        KnowledgeDoc.id.not_in(imported_doc_ids),
    )
    session.execute(delete(KnowledgeChunk).where(KnowledgeChunk.doc_id.in_(stale_docs)))
    session.execute(
        delete(KnowledgeDoc).where(
            KnowledgeDoc.id.like("derived_doc_%"),
            KnowledgeDoc.id.not_in(imported_doc_ids),
        )
    )


def _import_curated_structured_data(session: Session, derived_knowledge_path: Path) -> None:
    curated_path = derived_knowledge_path / "curated"
    if not curated_path.exists():
        return

    for item in _read_json_list(curated_path / "source_refs.json"):
        if session.get(SourceRef, item["id"]):
            continue
        session.add(
            SourceRef(
                id=item["id"],
                title=item["title"],
                source_type=item["source_type"],
                path=item.get("path", ""),
            )
        )

    _import_curated_spots(session, curated_path)

    for item in _read_json_list(curated_path / "aliases.json"):
        for alias in item.get("aliases", []):
            existing = session.scalar(
                select(EntityAlias.id).where(
                    EntityAlias.entity_type == item["entity_type"],
                    EntityAlias.entity_id == item["entity_id"],
                    EntityAlias.alias == alias,
                )
            )
            if existing is not None:
                continue
            session.add(
                EntityAlias(
                    entity_type=item["entity_type"],
                    entity_id=item["entity_id"],
                    alias=alias,
                )
            )

    for item in _read_json_list(curated_path / "tags.json"):
        for alias in item.get("aliases", []):
            existing = session.scalar(
                select(TagAlias.id).where(
                    TagAlias.tag == item["tag"],
                    TagAlias.alias == alias,
                )
            )
            if existing is not None:
                continue
            session.add(
                TagAlias(
                    tag=item["tag"],
                    category=item.get("category", ""),
                    alias=alias,
                )
            )

    for item in _read_json_list(curated_path / "facts.json"):
        existing = session.scalar(
            select(SpotFact.id).where(
                SpotFact.spot_id == item["spot_id"],
                SpotFact.fact_key == item["fact_key"],
                SpotFact.source_ref == item.get("source_ref", ""),
                SpotFact.source_url == item.get("source_url", ""),
            )
        )
        if existing is not None:
            continue
        session.add(
            SpotFact(
                spot_id=item["spot_id"],
                fact_key=item["fact_key"],
                fact_label=item["fact_label"],
                fact_value=str(item["fact_value"]),
                fact_unit=item.get("fact_unit", ""),
                confidence=float(item.get("confidence", 1.0)),
                source_type=item.get("source_type", "database"),
                source_ref=item.get("source_ref", ""),
                source_url=item.get("source_url", ""),
            )
        )

    for item in _read_json_list(curated_path / "approved_web_sources.json"):
        existing = session.scalar(
            select(ApprovedWebSource).where(
                ApprovedWebSource.domain == item["domain"],
            )
        )
        if existing is not None:
            existing.title = item.get("title", "")
            existing.source_level = item.get("source_level", "")
            existing.allowed = bool(item.get("allowed", True))
            continue
        session.add(
            ApprovedWebSource(
                domain=item["domain"],
                title=item.get("title", ""),
                source_level=item.get("source_level", ""),
                allowed=bool(item.get("allowed", True)),
            )
        )

    for item in _read_json_list(curated_path / "approved_web_facts.json"):
        existing = session.scalar(
            select(ApprovedWebFact).where(
                ApprovedWebFact.entity_id == item.get("entity_id", ""),
                ApprovedWebFact.fact_key == item["fact_key"],
            )
        )
        if existing is not None:
            existing.entity_type = item.get("entity_type", "spot")
            existing.fact_label = item.get("fact_label", "")
            existing.fact_value = str(item["fact_value"])
            existing.fact_unit = item.get("fact_unit", "")
            existing.source_url = item["source_url"]
            existing.source_level = item.get("source_level", "")
            existing.confidence = float(item.get("confidence", 0.8))
            continue
        session.add(
            ApprovedWebFact(
                entity_type=item.get("entity_type", "spot"),
                entity_id=item.get("entity_id", ""),
                fact_key=item["fact_key"],
                fact_label=item.get("fact_label", ""),
                fact_value=str(item["fact_value"]),
                fact_unit=item.get("fact_unit", ""),
                source_url=item["source_url"],
                source_level=item.get("source_level", ""),
                confidence=float(item.get("confidence", 0.8)),
            )
        )


def _import_scenic_maps(session: Session, derived_knowledge_path: Path) -> None:
    maps_path = derived_knowledge_path / "maps"
    if not maps_path.exists():
        return

    for file_path in sorted(maps_path.glob("*.json")):
        payload = json.loads(file_path.read_text(encoding="utf-8"))
        map_data = payload["map"]
        map_asset = session.get(MapAsset, map_data["id"])
        if map_asset is None:
            map_asset = MapAsset(id=map_data["id"])
            session.add(map_asset)

        for field in (
            "name",
            "image_url",
            "version",
            "width",
            "height",
            "center_lat",
            "center_lng",
            "authorization_status",
            "source_note",
            "is_active",
        ):
            setattr(map_asset, field, map_data[field])

        imported_spot_ids = {
            point_data["spot_id"]
            for point_data in payload.get("points", [])
        }
        session.execute(
            delete(MapPoint).where(
                MapPoint.map_id == map_asset.id,
                MapPoint.spot_id.not_in(imported_spot_ids),
            )
        )

        for point_data in payload.get("points", []):
            point = session.scalar(
                select(MapPoint).where(
                    MapPoint.map_id == map_asset.id,
                    MapPoint.spot_id == point_data["spot_id"],
                )
            )
            if point is None:
                point = MapPoint(
                    map_id=map_asset.id,
                    spot_id=point_data["spot_id"],
                )
                session.add(point)
            point.x_ratio = float(point_data["x_ratio"])
            point.y_ratio = float(point_data["y_ratio"])
            point.point_type = point_data.get("point_type", "spot")
            point.calibration_status = point_data.get(
                "calibration_status",
                "pending_review",
            )


def _import_spot_adjacencies(
    session: Session,
    derived_knowledge_path: Path,
) -> None:
    routes_path = derived_knowledge_path / "routes"
    if not routes_path.exists():
        return

    for file_path in sorted(routes_path.glob("*.json")):
        payload = json.loads(file_path.read_text(encoding="utf-8"))
        if "edges" not in payload:
            continue
        if payload.get("edges") and "from_spot_id" not in payload["edges"][0]:
            continue
        data_version = payload["data_version"]
        for edge in payload.get("edges", []):
            directions = [
                (edge["from_spot_id"], edge["to_spot_id"]),
            ]
            if edge.get("bidirectional", False):
                directions.append(
                    (edge["to_spot_id"], edge["from_spot_id"]),
                )

            for from_spot_id, to_spot_id in directions:
                adjacency = session.scalar(
                    select(SpotAdjacency).where(
                        SpotAdjacency.from_spot_id == from_spot_id,
                        SpotAdjacency.to_spot_id == to_spot_id,
                    )
                )
                if adjacency is None:
                    adjacency = SpotAdjacency(
                        from_spot_id=from_spot_id,
                        to_spot_id=to_spot_id,
                        data_version=data_version,
                    )
                    session.add(adjacency)
                adjacency.walk_minutes = int(edge["walk_minutes"])
                adjacency.accessible = bool(edge.get("accessible", True))
                adjacency.note = edge.get("note", "")
                adjacency.data_version = data_version

                map_id = edge.get("map_id")
                points = edge.get("points", [])
                if not map_id or len(points) < 2:
                    continue
                segment = session.scalar(
                    select(ManualPathSegment).where(
                        ManualPathSegment.map_id == map_id,
                        ManualPathSegment.from_spot_id == from_spot_id,
                        ManualPathSegment.to_spot_id == to_spot_id,
                    )
                )
                if segment is None:
                    segment = ManualPathSegment(
                        map_id=map_id,
                        from_spot_id=from_spot_id,
                        to_spot_id=to_spot_id,
                        data_version=data_version,
                    )
                    session.add(segment)
                segment.points = (
                    list(reversed(points))
                    if from_spot_id != edge["from_spot_id"]
                    else points
                )
                segment.difficulty = edge.get("difficulty", "medium")
                segment.accessible = bool(edge.get("accessible", True))
                segment.data_version = data_version
                segment.calibration_status = edge.get(
                    "calibration_status",
                    "pending_review",
                )


def _import_road_networks(
    session: Session,
    derived_knowledge_path: Path,
) -> set[str]:
    routes_path = derived_knowledge_path / "routes"
    if not routes_path.exists():
        return set()

    imported_maps: set[str] = set()
    for file_path in sorted(routes_path.glob("*-road-network-*.json")):
        payload = json.loads(file_path.read_text(encoding="utf-8"))
        map_id = payload["map_id"]
        data_version = payload["data_version"]
        network_id = payload.get("id", data_version)
        map_asset = session.get(MapAsset, map_id)
        if map_asset is None:
            continue
        from app.services.road_routing import clear_road_network_cache

        clear_road_network_cache(session, map_id)

        for existing in session.scalars(
            select(RoadNetworkVersion).where(
                RoadNetworkVersion.map_id == map_id,
                RoadNetworkVersion.id != network_id,
            )
        ).all():
            existing.is_active = False

        network = session.get(RoadNetworkVersion, network_id)
        if network is None:
            network = RoadNetworkVersion(id=network_id)
            session.add(network)
        network.map_id = map_id
        network.data_version = data_version
        network.status = payload.get("status", "provisional")
        network.source_note = payload.get("source_note", "")
        network.is_active = bool(payload.get("is_active", True))
        network.time_minutes_per_pixel = None
        network.calibration_confidence = 0.0
        session.flush()

        session.execute(
            delete(SpotRoadAccess).where(
                SpotRoadAccess.network_id == network_id
            )
        )
        session.execute(
            delete(RouteTimeAnchor).where(
                RouteTimeAnchor.network_id == network_id
            )
        )
        session.execute(
            delete(RoadEdge).where(RoadEdge.network_id == network_id)
        )
        session.execute(
            delete(RoadNode).where(RoadNode.network_id == network_id)
        )

        node_ids: set[str] = set()
        for item in payload.get("nodes", []):
            node_id = item["id"]
            node_ids.add(node_id)
            session.add(
                RoadNode(
                    id=node_id,
                    network_id=network_id,
                    map_id=map_id,
                    x_ratio=float(item["x_ratio"]),
                    y_ratio=float(item["y_ratio"]),
                    node_type=item.get("node_type", "junction"),
                    calibration_status=item.get(
                        "calibration_status",
                        "pending_review",
                    ),
                )
            )
        session.flush()

        for item in payload.get("edges", []):
            if (
                item["from_node_id"] not in node_ids
                or item["to_node_id"] not in node_ids
            ):
                continue
            points = item.get("points", [])
            if len(points) < 2:
                continue
            session.add(
                RoadEdge(
                    id=item["id"],
                    network_id=network_id,
                    map_id=map_id,
                    from_node_id=item["from_node_id"],
                    to_node_id=item["to_node_id"],
                    points=points,
                    map_length_px=float(
                        item.get("map_length_px")
                        or _polyline_map_length(
                            points,
                            map_asset.width,
                            map_asset.height,
                        )
                    ),
                    difficulty="low",
                    accessible_status="accessible",
                    bidirectional=True,
                    path_type="walkway",
                    calibration_status="verified",
                )
            )
        session.flush()

        imported_maps.add(map_id)
    return imported_maps


def _import_route_time_anchors(
    session: Session,
    derived_knowledge_path: Path,
) -> None:
    routes_path = derived_knowledge_path / "routes"
    file_path = routes_path / "road-time-anchors-v1.json"
    if not file_path.exists():
        return

    payload = json.loads(file_path.read_text(encoding="utf-8"))
    for item in payload.get("anchors", []):
        network = session.scalar(
            select(RoadNetworkVersion).where(
                RoadNetworkVersion.map_id == item["map_id"],
                RoadNetworkVersion.is_active.is_(True),
            )
        )
        if network is None:
            continue
        session.add(
            RouteTimeAnchor(
                id=item["id"],
                network_id=network.id,
                map_id=item["map_id"],
                from_spot_id=item["from_spot_id"],
                to_spot_id=item["to_spot_id"],
                observed_minutes=float(item["observed_minutes"]),
                road_edge_ids=item.get("road_edge_ids", []),
                measurement_type=item.get(
                    "measurement_type",
                    "continuous_walk",
                ),
                confidence=float(item.get("confidence", 0.65)),
                source_note=item.get("source_note", ""),
            )
        )


def _polyline_map_length(
    points: list[dict],
    width: int,
    height: int,
) -> float:
    return sum(
        hypot(
            (current["x_ratio"] - previous["x_ratio"]) * width,
            (current["y_ratio"] - previous["y_ratio"]) * height,
        )
        for previous, current in zip(points, points[1:])
    )


def _import_route_templates(
    session: Session,
    derived_knowledge_path: Path,
) -> None:
    routes_path = derived_knowledge_path / "routes"
    if not routes_path.exists():
        return

    for file_path in sorted(routes_path.glob("*templates*.json")):
        payload = json.loads(file_path.read_text(encoding="utf-8"))
        for item in payload.get("routes", []):
            route = session.get(Route, item["id"])
            if route is None:
                route = Route(id=item["id"])
                session.add(route)
            route.map_id = item.get("map_id", "ling-shan")
            route.name = item["name"]
            route.theme = item.get("theme", "")
            route.duration_minutes = int(item.get("duration_minutes", 120))
            route.suitable_crowd = item.get("suitable_crowd", [])
            route.description = item.get("description", "")
            session.flush()

            session.execute(
                delete(RouteSpot).where(RouteSpot.route_id == route.id)
            )
            for sequence, spot in enumerate(item.get("spots", []), start=1):
                session.add(
                    RouteSpot(
                        route_id=route.id,
                        spot_id=spot["spot_id"],
                        sequence=sequence,
                        stay_minutes=int(spot.get("stay_minutes", 20)),
                        reason=spot.get("reason", ""),
                    )
                )


def _import_spot_recommendation_profiles(
    session: Session,
    derived_knowledge_path: Path,
) -> None:
    routes_path = derived_knowledge_path / "routes"
    file_path = routes_path / "spot-recommendation-profiles-v1.json"
    if not file_path.exists():
        return

    payload = json.loads(file_path.read_text(encoding="utf-8"))
    data_version = payload["data_version"]
    imported_spot_ids: set[str] = set()
    for item in payload.get("profiles", []):
        spot_id = item["spot_id"]
        if session.get(ScenicSpot, spot_id) is None:
            continue
        imported_spot_ids.add(spot_id)
        profile = session.get(SpotRecommendationProfile, spot_id)
        if profile is None:
            profile = SpotRecommendationProfile(
                spot_id=spot_id,
                data_version=data_version,
            )
            session.add(profile)
        profile.theme_scores = {
            str(theme): max(0, min(3, int(score)))
            for theme, score in item.get("theme_scores", {}).items()
        }
        profile.base_priority = max(
            1,
            min(3, int(item.get("base_priority", 1))),
        )
        profile.min_stay_minutes = max(
            5,
            int(item.get("min_stay_minutes", 10)),
        )
        profile.ideal_stay_minutes = max(
            profile.min_stay_minutes,
            int(
                item.get(
                    "ideal_stay_minutes",
                    profile.min_stay_minutes,
                )
            ),
        )
        profile.data_version = data_version

    if imported_spot_ids:
        session.execute(
            delete(SpotRecommendationProfile).where(
                SpotRecommendationProfile.spot_id.not_in(
                    imported_spot_ids
                )
            )
        )


def _import_curated_spots(session: Session, curated_path: Path) -> None:
    for sort_order, item in enumerate(_read_json_list(curated_path / "spots.json"), start=10):
        spot_id = item.get("entity_id") or _spot_id_from_raw_id(item.get("raw_id", ""))
        if not spot_id:
            continue
        spot = session.get(ScenicSpot, spot_id)
        if spot is None:
            spot = ScenicSpot(id=spot_id)
            session.add(spot)
        spot.name = item["name"]
        spot.summary = item.get("summary", "")
        spot.story = item.get("story", item.get("summary", ""))
        spot.tags = _normalize_recommendation_tags(
            item.get("tags", ["佛教文化"]),
            item.get("crowd_types", []),
            item.get("name", ""),
        )
        spot.visit_minutes = int(item.get("visit_minutes", 20))
        spot.crowd_types = item.get("crowd_types", ["历史文化游", "轻松游"])
        spot.image_url = item.get("image_url", "")
        spot.sort_order = sort_order * 10


def _normalize_recommendation_tags(
    tags: list[str],
    crowd_types: list[str],
    name: str,
) -> list[str]:
    canonical: list[str] = []

    def add(value: str) -> None:
        if value not in canonical:
            canonical.append(value)

    aliases = {
        "拍照": "摄影",
        "摄影": "摄影",
        "休息": "休闲",
        "安静": "休闲",
        "休闲": "休闲",
        "亲子": "亲子",
        "演艺": "演艺",
        "室内": "室内",
        "建筑": "建筑",
        "艺术": "建筑",
        "历史": "历史",
        "佛教文化": "佛教文化",
        "藏传佛教": "佛教文化",
        "禅寺": "佛教文化",
        "礼佛": "佛教文化",
        "文化": "佛教文化",
        "自然": "自然",
    }
    for tag in tags:
        normalized = aliases.get(tag)
        if normalized:
            add(normalized)
    if "历史文化游" in crowd_types:
        add("历史")
    if "轻松游" in crowd_types:
        add("休闲")
    if "摄影游" in crowd_types:
        add("摄影")
    if "亲子游" in crowd_types:
        add("亲子")
    if any(
        keyword in name
        for keyword in ("花海", "鹿鸣谷", "菩提大道", "五灯湖")
    ):
        add("自然")
    if any(
        keyword in name
        for keyword in (
            "照壁",
            "桥",
            "门",
            "寺",
            "塔",
            "宫",
            "坛城",
            "堂",
            "博览馆",
        )
    ):
        add("建筑")
    return canonical or ["佛教文化"]


def _spot_id_from_raw_id(raw_id: str) -> str:
    if not raw_id:
        return ""
    return f"spot_{raw_id.lower().replace('-', '_')}"


def _read_json_list(file_path: Path) -> list[dict]:
    if not file_path.exists():
        return []
    return json.loads(file_path.read_text(encoding="utf-8"))


def _file_hash(file_path: Path) -> str:
    return hashlib.sha256(file_path.read_bytes()).hexdigest()


def _knowledge_preview(file_path: Path) -> str:
    if file_path.suffix.lower() == ".md":
        return file_path.read_text(encoding="utf-8")[:800]

    if file_path.suffix.lower() == ".docx":
        text = _extract_docx_text(file_path)
        if text:
            return text[:800]

    return f"资料文件：{file_path.name}"


def _extract_docx_text(file_path: Path) -> str:
    namespace = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    try:
        with zipfile.ZipFile(file_path) as docx:
            root = ET.fromstring(docx.read("word/document.xml"))
    except (KeyError, OSError, ET.ParseError, zipfile.BadZipFile):
        return ""

    paragraphs: list[str] = []
    for paragraph in root.iter(namespace + "p"):
        text = "".join(
            node.text or ""
            for node in paragraph.iter(namespace + "t")
        ).strip()
        if text:
            paragraphs.append(text)
    return "\n".join(paragraphs)
