"""Pydantic schemas."""

import base64
import binascii
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class SpotListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    tags: list[str]
    crowd_types: list[str] = []
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
    planned_stay_minutes: int = 0
    transition_minutes: int | None = None


class TourRecapMovement(BaseModel):
    estimated_walking_minutes: int | None
    planned_scenic_minutes: int | None
    estimated_distance_meters: int | None
    estimated_steps: int | None
    estimated_calories_kcal: int | None
    coverage_ratio: float
    confidence: Literal["medium", "low", "unavailable"]
    formula_version: str = "demo-v1"


class TourRecapResponse(BaseModel):
    id: str
    name: str
    map_id: str
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
    movement: TourRecapMovement


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


class AmapConfigResponse(BaseModel):
    enabled: bool
    key: str = ""
    security_code: str = ""


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


ALLOWED_CHAT_IMAGE_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_CHAT_IMAGE_BYTES = 4 * 1024 * 1024


class ChatImageAttachment(BaseModel):
    mime_type: str
    size_bytes: int = Field(ge=1, le=MAX_CHAT_IMAGE_BYTES)
    data_url: str = Field(min_length=24, max_length=6_000_000)

    @model_validator(mode="after")
    def validate_image_payload(self):
        if self.mime_type not in ALLOWED_CHAT_IMAGE_MIME_TYPES:
            raise ValueError("unsupported image mime type")
        prefix = f"data:{self.mime_type};base64,"
        if not self.data_url.startswith(prefix):
            raise ValueError("image must be a base64 data URL")
        encoded = self.data_url[len(prefix) :]
        try:
            decoded = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("invalid image base64 payload") from exc
        if len(decoded) > MAX_CHAT_IMAGE_BYTES:
            raise ValueError("image payload is too large")
        return self


class ChatRequest(BaseModel):
    question: str
    spot_id: str | None = None
    profile: dict = {}
    session_id: str | None = None
    image: ChatImageAttachment | None = None


DigitalHumanIdentity = Literal[
    "ancient_scholar",
    "republican_reporter",
    "future_explorer",
    "scenic_resident",
    "professional_guide",
    "local_friend",
    "culture_interpreter",
    "food_expert",
    "photography_guide",
    "travel_butler",
    "unspecified",
]
DigitalHumanAgeMode = Literal["group", "exact"]
DigitalHumanAgeGroup = Literal["teen", "young", "middle", "senior", "unspecified"]
DigitalHumanGender = Literal["male", "female", "neutral", "unspecified"]
DigitalHumanPersonality = Literal[
    "gentle",
    "cheerful",
    "professional",
    "humorous",
    "talkative",
    "considerate",
    "curious",
    "calm",
]
DigitalHumanExpressionStyle = Literal[
    "direct",
    "detailed",
    "storytelling",
    "casual",
    "formal",
    "poetic",
    "interactive",
    "unspecified",
]


class DigitalHumanPersonaConfig(BaseModel):
    identity: DigitalHumanIdentity = "professional_guide"
    age_mode: DigitalHumanAgeMode = "group"
    age_group: DigitalHumanAgeGroup = "young"
    exact_age: int | None = Field(default=None, ge=1, le=120)
    gender: DigitalHumanGender = "unspecified"
    personalities: list[DigitalHumanPersonality] = ["gentle"]
    expression_style: DigitalHumanExpressionStyle = "unspecified"
    creative_prompt: str = Field(default="", max_length=1000)

    @model_validator(mode="after")
    def validate_persona(self):
        self.personalities = list(dict.fromkeys(self.personalities))
        if not 1 <= len(self.personalities) <= 3:
            raise ValueError("personalities must contain between 1 and 3 unique values")
        if self.age_mode == "exact":
            if self.exact_age is None:
                raise ValueError("exact_age is required when age_mode is exact")
            self.age_group = _digital_human_age_group(self.exact_age)
        else:
            self.exact_age = None
        self.creative_prompt = self.creative_prompt.strip()
        return self


class DigitalHumanPersonaResponse(DigitalHumanPersonaConfig):
    is_customized: bool
    created_at: datetime | None = None
    updated_at: datetime | None = None


class DigitalHumanPersonaTextResponse(BaseModel):
    text: str


def _digital_human_age_group(age: int) -> DigitalHumanAgeGroup:
    if age <= 17:
        return "teen"
    if age <= 35:
        return "young"
    if age <= 59:
        return "middle"
    return "senior"


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
    retrieval_mode: str = "keyword"
    context_count: int = 0
    fts_ms: float = 0
    embedding_ms: float = 0
    rerank_ms: float = 0
    vector_status: str = "disabled"
    guide_intent: str = ""
    evidence_profile: str = ""
    route_triggered: bool = False
    answer_style: str = ""
    llm_model: str = ""
    embedding_model: str = ""
    first_delta_ms: float = 0
    retrieval_cache_hit: bool = False
    answer_cache_hit: bool = False
    embedding_cache_hit: bool = False
    warmup_status: str = ""


class GuideRoutePreference(BaseModel):
    map_id: str = "ling-shan"
    duration_minutes: int = Field(default=120, ge=30, le=1440)
    physical_level: str = "medium"
    interest_tags: list[str] = []
    accessible_required: bool = False


class GuideAction(BaseModel):
    type: str
    title: str = ""
    route: RecommendedRoute | None = None
    preference: GuideRoutePreference | None = None


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
    guide_action: GuideAction | None = None
    emotion_cue: str = "idle"


class ChatLogDeleteRequest(BaseModel):
    ids: list[int] = Field(default_factory=list)
    delete_all: bool = False


class UserFeedbackCreate(BaseModel):
    rating: int = Field(ge=1, le=5)
    content: str = Field(min_length=1, max_length=500)
    page_path: str = Field(default="", max_length=300)


class CommunityPostCreate(BaseModel):
    content: str = Field(min_length=1, max_length=500)
    spot_id: str | None = Field(default=None, max_length=64)


class CommunityPostModerate(BaseModel):
    status: Literal["published", "hidden"]


class TravelJournalSectionInput(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    title: str = Field(default="", max_length=200)
    body: str = Field(default="", max_length=10000)


class TravelJournalCreate(BaseModel):
    description: str = Field(default="", max_length=2000)
    target_words: int = Field(default=600, ge=200, le=3000)


class TravelJournalUpdate(BaseModel):
    description: str | None = Field(default=None, max_length=2000)
    target_words: int | None = Field(default=None, ge=200, le=3000)
    title: str | None = Field(default=None, max_length=200)
    opening: str | None = Field(default=None, max_length=10000)
    text_sections: list[TravelJournalSectionInput] | None = Field(
        default=None,
        max_length=5,
    )
    images: list[TravelJournalSectionInput] | None = Field(
        default=None,
        max_length=9,
    )
    conclusion: str | None = Field(default=None, max_length=10000)

    @model_validator(mode="after")
    def validate_unique_section_ids(self):
        for sections in (self.text_sections, self.images):
            if sections is None:
                continue
            ids = [section.id for section in sections]
            if len(ids) != len(set(ids)):
                raise ValueError("section ids must be unique")
        return self


class TravelJournalImageUpdate(BaseModel):
    title: str = Field(default="", max_length=200)
    body: str = Field(default="", max_length=10000)


class TravelJournalImageOrder(BaseModel):
    image_ids: list[str] = Field(min_length=1, max_length=9)


class TravelJournalGenerate(BaseModel):
    description: str = Field(default="", max_length=2000)
    target_words: int = Field(default=600, ge=200, le=3000)


class PhotoWorkshopPolishRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=2000)


class PhotoWorkshopPolishResponse(BaseModel):
    prompt: str


class PhotoWorkshopGenerateResponse(BaseModel):
    image_base64: str
    mime_type: str
    width: int
    height: int


class TtsJobResponse(BaseModel):
    id: str
    status: str
    audio_url: str | None = None
