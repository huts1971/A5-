"""Pydantic schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class SpotListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    tags: list[str]
    summary: str
    visit_minutes: int
    image_url: str


class SpotListResponse(BaseModel):
    items: list[SpotListItem]
    total: int


class SpotSummaryResponse(BaseModel):
    listed_spot_count: int
    collected_spot_count: int


class SpotDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    summary: str
    story: str
    tags: list[str]
    visit_minutes: int
    crowd_types: list[str]
    image_url: str


class SpotUpsert(BaseModel):
    id: str
    name: str
    summary: str = ""
    story: str = ""
    tags: list[str] = []
    visit_minutes: int = 30
    crowd_types: list[str] = []
    image_url: str = ""
    sort_order: int = 0


class RouteRecommendRequest(BaseModel):
    map_id: str = "ling-shan"
    visitor_type: str = ""
    duration_minutes: int = Field(ge=30, le=1440)
    physical_level: str
    interest_tags: list[str] = []
    accessible_required: bool = False


class RecommendedRouteSpot(BaseModel):
    id: str
    name: str
    stay_minutes: int
    reason: str
    transition_minutes: int | None = None
    transition_note: str = ""


class RecommendedRoute(BaseModel):
    id: str
    map_id: str = "ling-shan"
    name: str
    theme: str
    stay_minutes: int = 0
    estimated_walk_minutes: int = 0
    total_minutes: int
    time_data_complete: bool = False
    generation_mode: str = "dynamic"
    preference_match: int = 0
    constraint_summary: str = ""
    path_complete: bool = False
    routing_profile: str = "fastest"
    time_estimation_status: str = "map_estimate"
    spots: list[RecommendedRouteSpot]
    recommendation_reason: str


class RouteRecommendResponse(BaseModel):
    items: list[RecommendedRoute]


class RouteDraftSpotInput(BaseModel):
    spot_id: str
    stay_minutes: int = Field(default=20, ge=1, le=480)
    reason: str = ""


class RouteDraftCreate(BaseModel):
    source_route_id: str | None = None
    name: str
    theme: str = ""
    duration_budget: int = Field(default=120, ge=30, le=1440)
    preference_profile: dict = {}
    spots: list[RouteDraftSpotInput] = Field(min_length=1)


class RouteDraftAddSpotRequest(BaseModel):
    spot_id: str
    position: int | None = Field(default=None, ge=0)
    stay_minutes: int | None = Field(default=None, ge=1, le=480)
    reason: str = ""
    allow_budget_exceeded: bool = False
    replace_other_area: bool = False


class RouteDraftReorderRequest(BaseModel):
    spot_ids: list[str] = Field(min_length=1)
    allow_budget_exceeded: bool = False


class RouteDraftScopeRequest(BaseModel):
    map_id: str


class RouteDraftSpotResponse(BaseModel):
    spot_id: str
    name: str
    sequence: int
    stay_minutes: int
    reason: str
    transition_minutes: int | None = None
    transition_note: str = ""


class RouteDraftResponse(BaseModel):
    id: str
    source_route_id: str | None
    name: str
    theme: str
    duration_budget: int
    preference_profile: dict = {}
    stay_minutes: int
    estimated_walk_minutes: int
    total_minutes: int
    time_data_complete: bool
    routing_profile: str = "fastest"
    time_estimation_status: str = "unavailable"
    budget_exceeded: bool
    revision_count: int
    spots: list[RouteDraftSpotResponse]
    created_at: datetime
    updated_at: datetime


class TourCreateRequest(BaseModel):
    route_draft_id: str
    map_id: str | None = None


class TourEventCreate(BaseModel):
    event_type: str
    spot_id: str | None = None
    note: str = ""
    topic: str = ""


class TourSpotResponse(BaseModel):
    spot_id: str
    name: str
    sequence: int
    stay_minutes: int
    reason: str
    transition_minutes: int | None = None
    transition_note: str = ""
    status: str
    arrived_at: datetime | None = None
    completed_at: datetime | None = None


class TourSessionResponse(BaseModel):
    id: str
    route_draft_id: str
    name: str
    status: str
    current_index: int
    started_at: datetime
    updated_at: datetime
    finished_at: datetime | None
    event_count: int
    routing_profile: str = "fastest"
    time_estimation_status: str = "unavailable"
    spots: list[TourSpotResponse]


class TourRecapSpot(BaseModel):
    spot_id: str
    name: str
    result: str
    occurred_at: datetime


class TourRecapResponse(BaseModel):
    id: str
    name: str
    status: str
    started_at: datetime
    finished_at: datetime | None
    elapsed_minutes: int
    completed_count: int
    skipped_count: int
    adjustment_count: int
    deviation_count: int = 0
    recommended_order: list[str] = []
    preference_profile: dict = {}
    actual_order: list[TourRecapSpot]
    ai_topics: list[str]


class MapPointResponse(BaseModel):
    spot_id: str
    name: str
    x_ratio: float
    y_ratio: float
    point_type: str
    calibration_status: str


class ScenicMapResponse(BaseModel):
    id: str
    name: str
    image_url: str
    version: str
    width: int
    height: int
    center_lat: float
    center_lng: float
    authorization_status: str
    source_note: str
    points: list[MapPointResponse]


class RoutePathRequest(BaseModel):
    spot_ids: list[str] = Field(min_length=1)
    routing_profile: str = "fastest"


class RoutePathPoint(BaseModel):
    x_ratio: float
    y_ratio: float


class RoutePathSegmentResponse(BaseModel):
    from_spot_id: str
    to_spot_id: str
    via_spot_ids: list[str] = []
    road_edge_ids: list[str] = []
    points: list[RoutePathPoint] = []
    walk_minutes: int | None = None
    difficulty: str = "medium"
    accessible: bool = True
    map_length_px: float = 0.0


class MissingPathTransition(BaseModel):
    from_spot_id: str
    to_spot_id: str


class RoutePathResponse(BaseModel):
    map_id: str
    path_complete: bool
    network_version: str | None = None
    routing_profile: str = "fastest"
    time_estimation_status: str = "unavailable"
    calibration_confidence: float = 0.0
    map_length_px: float = 0.0
    segments: list[RoutePathSegmentResponse]
    missing_transitions: list[MissingPathTransition]


class RouteSpotUpsert(BaseModel):
    spot_id: str
    sequence: int
    stay_minutes: int = 20
    reason: str = ""


class RouteUpsert(BaseModel):
    id: str
    map_id: str = "ling-shan"
    name: str
    theme: str = ""
    duration_minutes: int = 120
    suitable_crowd: list[str] = []
    description: str = ""
    spots: list[RouteSpotUpsert] = []


class ChatRequest(BaseModel):
    question: str
    spot_id: str | None = None
    profile: dict = {}
    session_id: str | None = None


class KnowledgeSource(BaseModel):
    title: str
    spot_name: str | None = None
    section: str
    snippet: str
    score: float
    source_type: str = "document"
    source_url: str = ""
    source_level: str = ""


class ChatMetrics(BaseModel):
    retrieval_ms: float
    llm_ms: float
    tts_ms: float
    total_ms: float
    cache_hit: bool
    degraded: bool
    classification: dict = {}
    web_supplement_required: bool = False
    web_supplement_status: str = "not_required"


class ChatResponse(BaseModel):
    answer: str
    sources: list[KnowledgeSource]
    session_id: str
    audio_url: str | None
    tts_job_id: str | None = None
    tts_status: str
    mode: str
    degraded: bool
    metrics: ChatMetrics


class ChatLogDeleteRequest(BaseModel):
    ids: list[int] = Field(default_factory=list)
    delete_all: bool = False


class TtsJobResponse(BaseModel):
    id: str
    status: str
    audio_url: str | None = None
