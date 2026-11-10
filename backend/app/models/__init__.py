"""SQLAlchemy models."""

from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


def utc_now() -> datetime:
    return datetime.now(UTC)


class ScenicSpot(Base):
    __tablename__ = "scenic_spot"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    summary: Mapped[str] = mapped_column(Text, default="")
    story: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    visit_minutes: Mapped[int] = mapped_column(Integer, default=30)
    crowd_types: Mapped[list[str]] = mapped_column(JSON, default=list)
    image_url: Mapped[str] = mapped_column(String(500), default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    route_spots: Mapped[list["RouteSpot"]] = relationship(back_populates="spot")


class SpotRecommendationProfile(Base):
    __tablename__ = "spot_recommendation_profile"

    spot_id: Mapped[str] = mapped_column(
        ForeignKey("scenic_spot.id"),
        primary_key=True,
    )
    theme_scores: Mapped[dict[str, int]] = mapped_column(JSON, default=dict)
    base_priority: Mapped[int] = mapped_column(Integer, default=1)
    min_stay_minutes: Mapped[int] = mapped_column(Integer, default=10)
    ideal_stay_minutes: Mapped[int] = mapped_column(Integer, default=20)
    data_version: Mapped[str] = mapped_column(String(80), nullable=False)

    spot: Mapped[ScenicSpot] = relationship()


class Route(Base):
    __tablename__ = "route"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    map_id: Mapped[str] = mapped_column(String(64), default="ling-shan")
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    theme: Mapped[str] = mapped_column(String(80), default="")
    duration_minutes: Mapped[int] = mapped_column(Integer, default=120)
    suitable_crowd: Mapped[list[str]] = mapped_column(JSON, default=list)
    description: Mapped[str] = mapped_column(Text, default="")

    spots: Mapped[list["RouteSpot"]] = relationship(back_populates="route")


class RouteSpot(Base):
    __tablename__ = "route_spot"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    route_id: Mapped[str] = mapped_column(ForeignKey("route.id"), nullable=False)
    spot_id: Mapped[str] = mapped_column(ForeignKey("scenic_spot.id"), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    stay_minutes: Mapped[int] = mapped_column(Integer, default=20)
    reason: Mapped[str] = mapped_column(Text, default="")

    route: Mapped[Route] = relationship(back_populates="spots")
    spot: Mapped[ScenicSpot] = relationship(back_populates="route_spots")


class MapAsset(Base):
    __tablename__ = "map_asset"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    image_url: Mapped[str] = mapped_column(String(500), nullable=False)
    version: Mapped[str] = mapped_column(String(80), nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    center_lat: Mapped[float] = mapped_column(Float, nullable=False)
    center_lng: Mapped[float] = mapped_column(Float, nullable=False)
    authorization_status: Mapped[str] = mapped_column(
        String(40),
        default="pending_confirmation",
    )
    source_note: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    points: Mapped[list["MapPoint"]] = relationship(
        back_populates="map_asset",
        cascade="all, delete-orphan",
    )


class MapPoint(Base):
    __tablename__ = "map_point"
    __table_args__ = (
        UniqueConstraint("map_id", "spot_id", name="uq_map_point_map_spot"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    map_id: Mapped[str] = mapped_column(ForeignKey("map_asset.id"), nullable=False)
    spot_id: Mapped[str] = mapped_column(ForeignKey("scenic_spot.id"), nullable=False)
    x_ratio: Mapped[float] = mapped_column(Float, nullable=False)
    y_ratio: Mapped[float] = mapped_column(Float, nullable=False)
    point_type: Mapped[str] = mapped_column(String(40), default="spot")
    calibration_status: Mapped[str] = mapped_column(
        String(40),
        default="pending_review",
    )

    map_asset: Mapped[MapAsset] = relationship(back_populates="points")
    spot: Mapped[ScenicSpot] = relationship()


class SpotAdjacency(Base):
    __tablename__ = "spot_adjacency"
    __table_args__ = (
        UniqueConstraint(
            "from_spot_id",
            "to_spot_id",
            name="uq_spot_adjacency_direction",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    from_spot_id: Mapped[str] = mapped_column(
        ForeignKey("scenic_spot.id"),
        nullable=False,
    )
    to_spot_id: Mapped[str] = mapped_column(
        ForeignKey("scenic_spot.id"),
        nullable=False,
    )
    walk_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    accessible: Mapped[bool] = mapped_column(Boolean, default=True)
    note: Mapped[str] = mapped_column(Text, default="")
    data_version: Mapped[str] = mapped_column(String(80), nullable=False)


class ManualPathSegment(Base):
    __tablename__ = "manual_path_segment"
    __table_args__ = (
        UniqueConstraint(
            "map_id",
            "from_spot_id",
            "to_spot_id",
            name="uq_manual_path_segment_direction",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    map_id: Mapped[str] = mapped_column(
        ForeignKey("map_asset.id"),
        nullable=False,
    )
    from_spot_id: Mapped[str] = mapped_column(
        ForeignKey("scenic_spot.id"),
        nullable=False,
    )
    to_spot_id: Mapped[str] = mapped_column(
        ForeignKey("scenic_spot.id"),
        nullable=False,
    )
    points: Mapped[list[dict]] = mapped_column(JSON, default=list)
    difficulty: Mapped[str] = mapped_column(String(20), default="medium")
    accessible: Mapped[bool] = mapped_column(Boolean, default=True)
    data_version: Mapped[str] = mapped_column(String(80), nullable=False)
    calibration_status: Mapped[str] = mapped_column(
        String(40),
        default="pending_review",
    )


class RoadNetworkVersion(Base):
    __tablename__ = "road_network_version"
    __table_args__ = (
        UniqueConstraint(
            "map_id",
            "data_version",
            name="uq_road_network_map_version",
        ),
    )

    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    map_id: Mapped[str] = mapped_column(
        ForeignKey("map_asset.id"),
        nullable=False,
    )
    data_version: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="provisional")
    source_note: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    time_minutes_per_pixel: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )
    calibration_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class RoadNode(Base):
    __tablename__ = "road_node"
    __table_args__ = (
        UniqueConstraint(
            "network_id",
            "id",
            name="uq_road_node_network_id",
        ),
    )

    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    network_id: Mapped[str] = mapped_column(
        ForeignKey("road_network_version.id"),
        nullable=False,
    )
    map_id: Mapped[str] = mapped_column(
        ForeignKey("map_asset.id"),
        nullable=False,
    )
    x_ratio: Mapped[float] = mapped_column(Float, nullable=False)
    y_ratio: Mapped[float] = mapped_column(Float, nullable=False)
    node_type: Mapped[str] = mapped_column(String(40), default="junction")
    calibration_status: Mapped[str] = mapped_column(
        String(40),
        default="pending_review",
    )


class RoadEdge(Base):
    __tablename__ = "road_edge"

    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    network_id: Mapped[str] = mapped_column(
        ForeignKey("road_network_version.id"),
        nullable=False,
    )
    map_id: Mapped[str] = mapped_column(
        ForeignKey("map_asset.id"),
        nullable=False,
    )
    from_node_id: Mapped[str] = mapped_column(
        ForeignKey("road_node.id"),
        nullable=False,
    )
    to_node_id: Mapped[str] = mapped_column(
        ForeignKey("road_node.id"),
        nullable=False,
    )
    points: Mapped[list[dict]] = mapped_column(JSON, default=list)
    map_length_px: Mapped[float] = mapped_column(Float, default=0.0)
    difficulty: Mapped[str] = mapped_column(String(20), default="medium")
    accessible_status: Mapped[str] = mapped_column(
        String(24),
        default="unknown",
    )
    bidirectional: Mapped[bool] = mapped_column(Boolean, default=True)
    path_type: Mapped[str] = mapped_column(String(24), default="walkway")
    calibration_status: Mapped[str] = mapped_column(
        String(40),
        default="pending_review",
    )


class SpotRoadAccess(Base):
    __tablename__ = "spot_road_access"
    __table_args__ = (
        UniqueConstraint(
            "network_id",
            "spot_id",
            "node_id",
            name="uq_spot_road_access",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    network_id: Mapped[str] = mapped_column(
        ForeignKey("road_network_version.id"),
        nullable=False,
    )
    map_id: Mapped[str] = mapped_column(
        ForeignKey("map_asset.id"),
        nullable=False,
    )
    spot_id: Mapped[str] = mapped_column(
        ForeignKey("scenic_spot.id"),
        nullable=False,
    )
    node_id: Mapped[str] = mapped_column(
        ForeignKey("road_node.id"),
        nullable=False,
    )
    access_type: Mapped[str] = mapped_column(String(40), default="main")
    is_primary: Mapped[bool] = mapped_column(Boolean, default=True)


class RouteTimeAnchor(Base):
    __tablename__ = "route_time_anchor"
    __table_args__ = (
        UniqueConstraint(
            "network_id",
            "from_spot_id",
            "to_spot_id",
            name="uq_route_time_anchor_pair",
        ),
    )

    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    network_id: Mapped[str] = mapped_column(
        ForeignKey("road_network_version.id"),
        nullable=False,
    )
    map_id: Mapped[str] = mapped_column(
        ForeignKey("map_asset.id"),
        nullable=False,
    )
    from_spot_id: Mapped[str] = mapped_column(
        ForeignKey("scenic_spot.id"),
        nullable=False,
    )
    to_spot_id: Mapped[str] = mapped_column(
        ForeignKey("scenic_spot.id"),
        nullable=False,
    )
    observed_minutes: Mapped[float] = mapped_column(Float, nullable=False)
    road_edge_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    measurement_type: Mapped[str] = mapped_column(
        String(40),
        default="continuous_walk",
    )
    confidence: Mapped[float] = mapped_column(Float, default=0.6)
    source_note: Mapped[str] = mapped_column(Text, default="")


class RouteDraft(Base):
    __tablename__ = "route_draft"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    source_route_id: Mapped[str | None] = mapped_column(
        ForeignKey("route.id"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    theme: Mapped[str] = mapped_column(String(80), default="")
    duration_budget: Mapped[int] = mapped_column(Integer, default=120)
    preference_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=utc_now,
        onupdate=utc_now,
    )

    spots: Mapped[list["RouteDraftSpot"]] = relationship(
        back_populates="draft",
        cascade="all, delete-orphan",
    )
    revisions: Mapped[list["RouteRevision"]] = relationship(
        back_populates="draft",
        cascade="all, delete-orphan",
    )


class RouteDraftSpot(Base):
    __tablename__ = "route_draft_spot"
    __table_args__ = (
        UniqueConstraint(
            "draft_id",
            "spot_id",
            name="uq_route_draft_spot",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    draft_id: Mapped[str] = mapped_column(
        ForeignKey("route_draft.id"),
        nullable=False,
    )
    spot_id: Mapped[str] = mapped_column(
        ForeignKey("scenic_spot.id"),
        nullable=False,
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    stay_minutes: Mapped[int] = mapped_column(Integer, default=20)
    reason: Mapped[str] = mapped_column(Text, default="")

    draft: Mapped[RouteDraft] = relationship(back_populates="spots")
    spot: Mapped[ScenicSpot] = relationship()


class RouteRevision(Base):
    __tablename__ = "route_revision"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    draft_id: Mapped[str] = mapped_column(
        ForeignKey("route_draft.id"),
        nullable=False,
    )
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    snapshot_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    draft: Mapped[RouteDraft] = relationship(back_populates="revisions")


class RoutePreferenceLog(Base):
    __tablename__ = "route_preference_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    map_id: Mapped[str] = mapped_column(String(64), default="ling-shan")
    visitor_type: Mapped[str] = mapped_column(String(80), default="")
    duration_minutes: Mapped[int] = mapped_column(Integer, default=120)
    physical_level: Mapped[str] = mapped_column(String(40), default="medium")
    interest_tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    route_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class TourSession(Base):
    __tablename__ = "tour_session"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    route_draft_id: Mapped[str] = mapped_column(
        ForeignKey("route_draft.id"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="active")
    current_index: Mapped[int] = mapped_column(Integer, default=0)
    route_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=utc_now,
        onupdate=utc_now,
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    events: Mapped[list["TourEvent"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
    )


class TourEvent(Base):
    __tablename__ = "tour_event"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(
        ForeignKey("tour_session.id"),
        nullable=False,
    )
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    spot_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    event_data: Mapped[dict] = mapped_column(JSON, default=dict)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    session: Mapped[TourSession] = relationship(back_populates="events")


class KnowledgeDoc(Base):
    __tablename__ = "knowledge_doc"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    source_type: Mapped[str] = mapped_column(String(40), nullable=False)
    path: Mapped[str] = mapped_column(String(600), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    indexed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    chunks: Mapped[list["KnowledgeChunk"]] = relationship(back_populates="doc")


class KnowledgeDocTombstone(Base):
    __tablename__ = "knowledge_doc_tombstone"

    doc_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    title: Mapped[str] = mapped_column(String(200), default="")
    path: Mapped[str] = mapped_column(String(600), default="")
    deleted_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class KnowledgeChunk(Base):
    __tablename__ = "knowledge_chunk"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    doc_id: Mapped[str] = mapped_column(ForeignKey("knowledge_doc.id"), nullable=False)
    chunk_text: Mapped[str] = mapped_column(Text, nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    spot_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    vector_id: Mapped[str | None] = mapped_column(String(120), nullable=True)

    doc: Mapped[KnowledgeDoc] = relationship(back_populates="chunks")


class KnowledgeChunkEmbedding(Base):
    __tablename__ = "knowledge_chunk_embedding"
    __table_args__ = (
        UniqueConstraint(
            "chunk_id",
            "model",
            name="uq_knowledge_chunk_embedding_model",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    chunk_id: Mapped[int] = mapped_column(
        ForeignKey("knowledge_chunk.id"),
        nullable=False,
    )
    model: Mapped[str] = mapped_column(String(120), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    embedding_json: Mapped[list[float]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    chunk: Mapped[KnowledgeChunk] = relationship()


class SpotFact(Base):
    __tablename__ = "spot_fact"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    spot_id: Mapped[str] = mapped_column(ForeignKey("scenic_spot.id"), nullable=False)
    fact_key: Mapped[str] = mapped_column(String(120), nullable=False)
    fact_label: Mapped[str] = mapped_column(String(120), nullable=False)
    fact_value: Mapped[str] = mapped_column(Text, nullable=False)
    fact_unit: Mapped[str] = mapped_column(String(40), default="")
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    source_type: Mapped[str] = mapped_column(String(40), default="database")
    source_ref: Mapped[str] = mapped_column(String(120), default="")
    source_url: Mapped[str] = mapped_column(String(600), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class EntityAlias(Base):
    __tablename__ = "entity_alias"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(120), nullable=False)
    alias: Mapped[str] = mapped_column(String(160), nullable=False)


class TagAlias(Base):
    __tablename__ = "tag_alias"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tag: Mapped[str] = mapped_column(String(120), nullable=False)
    category: Mapped[str] = mapped_column(String(80), default="")
    alias: Mapped[str] = mapped_column(String(160), nullable=False)


class SourceRef(Base):
    __tablename__ = "source_ref"

    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    source_type: Mapped[str] = mapped_column(String(40), nullable=False)
    path: Mapped[str] = mapped_column(String(600), default="")


class ApprovedWebSource(Base):
    __tablename__ = "approved_web_source"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    domain: Mapped[str] = mapped_column(String(240), nullable=False)
    title: Mapped[str] = mapped_column(String(240), default="")
    source_level: Mapped[str] = mapped_column(String(40), default="")
    allowed: Mapped[bool] = mapped_column(Boolean, default=True)


class ApprovedWebFact(Base):
    __tablename__ = "approved_web_fact"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity_type: Mapped[str] = mapped_column(String(40), default="spot")
    entity_id: Mapped[str] = mapped_column(String(120), default="")
    fact_key: Mapped[str] = mapped_column(String(120), nullable=False)
    fact_label: Mapped[str] = mapped_column(String(120), default="")
    fact_value: Mapped[str] = mapped_column(Text, nullable=False)
    fact_unit: Mapped[str] = mapped_column(String(40), default="")
    source_url: Mapped[str] = mapped_column(String(600), nullable=False)
    source_level: Mapped[str] = mapped_column(String(40), default="")
    confidence: Mapped[float] = mapped_column(Float, default=0.8)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class WebFactCandidate(Base):
    __tablename__ = "web_fact_candidate"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity_type: Mapped[str] = mapped_column(String(40), default="spot")
    entity_id: Mapped[str] = mapped_column(String(120), default="")
    entity_name: Mapped[str] = mapped_column(String(160), default="")
    fact_key: Mapped[str] = mapped_column(String(120), default="")
    fact_value: Mapped[str] = mapped_column(Text, default="")
    source_url: Mapped[str] = mapped_column(String(600), default="")
    source_level: Mapped[str] = mapped_column(String(40), default="")
    question: Mapped[str] = mapped_column(Text, default="")
    answer_excerpt: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(40), default="pending_review")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class AppUser(Base):
    __tablename__ = "app_user"
    __table_args__ = (
        UniqueConstraint("username", "role", name="uq_app_user_username_role"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    username: Mapped[str] = mapped_column(String(32), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(300), nullable=False)
    role: Mapped[str] = mapped_column(String(40), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class DigitalHumanPersona(Base):
    __tablename__ = "digital_human_persona"

    visitor_id: Mapped[str] = mapped_column(
        ForeignKey("app_user.id"),
        primary_key=True,
    )
    identity: Mapped[str] = mapped_column(String(48), nullable=False)
    age_mode: Mapped[str] = mapped_column(String(16), nullable=False)
    age_group: Mapped[str] = mapped_column(String(24), nullable=False)
    exact_age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    gender: Mapped[str] = mapped_column(String(24), nullable=False)
    personalities: Mapped[list[str]] = mapped_column(JSON, default=list)
    expression_style: Mapped[str] = mapped_column(String(32), nullable=False)
    creative_prompt: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=utc_now,
        onupdate=utc_now,
    )


class ChatSession(Base):
    __tablename__ = "chat_session"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    visitor_type: Mapped[str] = mapped_column(String(80), default="")
    preference: Mapped[str] = mapped_column(String(200), default="")
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    messages: Mapped[list["ChatMessage"]] = relationship(back_populates="session")


class ChatMessage(Base):
    __tablename__ = "chat_message"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(
        ForeignKey("chat_session.id"),
        nullable=False,
    )
    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    sources_json: Mapped[list[dict]] = mapped_column(JSON, default=list)
    metrics_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    session: Mapped[ChatSession] = relationship(back_populates="messages")


class UserFeedback(Base):
    __tablename__ = "user_feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    page_path: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class TravelJournal(Base):
    __tablename__ = "travel_journal"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    copy_key: Mapped[str | None] = mapped_column(
        String(200),
        nullable=True,
        unique=True,
        index=True,
    )
    visitor_id: Mapped[str] = mapped_column(
        ForeignKey("app_user.id"),
        nullable=False,
        index=True,
    )
    status: Mapped[str] = mapped_column(String(24), default="draft", index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    target_words: Mapped[int] = mapped_column(Integer, default=600)
    title: Mapped[str] = mapped_column(String(200), default="")
    opening: Mapped[str] = mapped_column(Text, default="")
    text_sections: Mapped[list[dict]] = mapped_column(JSON, default=list)
    conclusion: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=utc_now,
        onupdate=utc_now,
    )

    visitor: Mapped[AppUser] = relationship()
    images: Mapped[list["TravelJournalImage"]] = relationship(
        back_populates="journal",
        cascade="all, delete-orphan",
        order_by="TravelJournalImage.sort_order",
    )
    community_post: Mapped["CommunityPost | None"] = relationship(
        back_populates="travel_journal",
        uselist=False,
    )


class TravelJournalImage(Base):
    __tablename__ = "travel_journal_image"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    journal_id: Mapped[str] = mapped_column(
        ForeignKey("travel_journal.id"),
        nullable=False,
        index=True,
    )
    display_path: Mapped[str] = mapped_column(String(700), nullable=False)
    model_path: Mapped[str] = mapped_column(String(700), nullable=False)
    content_type: Mapped[str] = mapped_column(String(40), default="image/jpeg")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    section_title: Mapped[str] = mapped_column(String(200), default="")
    section_body: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    journal: Mapped[TravelJournal] = relationship(back_populates="images")


class CommunityPost(Base):
    __tablename__ = "community_post"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    author_id: Mapped[str] = mapped_column(
        ForeignKey("app_user.id"),
        nullable=False,
        index=True,
    )
    author_name: Mapped[str] = mapped_column(String(120), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    post_type: Mapped[str] = mapped_column(
        String(32),
        default="comment",
        index=True,
    )
    travel_journal_id: Mapped[str | None] = mapped_column(
        ForeignKey("travel_journal.id"),
        nullable=True,
        unique=True,
        index=True,
    )
    spot_id: Mapped[str | None] = mapped_column(
        ForeignKey("scenic_spot.id"),
        nullable=True,
        index=True,
    )
    status: Mapped[str] = mapped_column(
        String(24),
        default="published",
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=utc_now,
        onupdate=utc_now,
    )

    author: Mapped[AppUser] = relationship()
    spot: Mapped[ScenicSpot | None] = relationship()
    travel_journal: Mapped[TravelJournal | None] = relationship(
        back_populates="community_post",
    )
    likes: Mapped[list["CommunityPostLike"]] = relationship(
        back_populates="post",
        cascade="all, delete-orphan",
    )


class CommunityPostLike(Base):
    __tablename__ = "community_post_like"
    __table_args__ = (
        UniqueConstraint(
            "post_id",
            "user_id",
            name="uq_community_post_like_post_user",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    post_id: Mapped[int] = mapped_column(
        ForeignKey("community_post.id"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("app_user.id"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    post: Mapped[CommunityPost] = relationship(back_populates="likes")
    user: Mapped[AppUser] = relationship()


class DigitalHumanAvatar(Base):
    __tablename__ = "digital_human_avatar"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    note: Mapped[str] = mapped_column(Text, default="")
    source_filename: Mapped[str] = mapped_column(String(255), default="")
    resource_size: Mapped[int] = mapped_column(Integer, default=0)
    resource_path: Mapped[str] = mapped_column(String(500), default="")
    manifest_json: Mapped[dict] = mapped_column(JSON, default=dict)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    uploaded_by: Mapped[str] = mapped_column(String(80), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=utc_now,
        onupdate=utc_now,
    )
    activated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
