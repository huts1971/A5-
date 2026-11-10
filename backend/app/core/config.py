from dataclasses import dataclass, field
import os
from pathlib import Path
import sys

from dotenv import load_dotenv


BACKEND_ROOT = Path(__file__).resolve().parents[2]

load_dotenv(BACKEND_ROOT / ".env")


DEFAULT_SOURCE_PACKAGE_PATH = (
    BACKEND_ROOT.parent / "Scenic Area Public Information Package"
)
DEFAULT_DERIVED_KNOWLEDGE_PATH = BACKEND_ROOT.parent / "knowledge"


def resolve_backend_relative_path(value: str) -> str:
    if not value:
        return value
    path = Path(value)
    if path.is_absolute():
        return str(path)
    return str((BACKEND_ROOT / path).resolve())


def env_value(name: str, default: str = ""):
    return field(default_factory=lambda: os.getenv(name, default))


def env_value_with_alias(name: str, alias: str, default: str = ""):
    return field(default_factory=lambda: os.getenv(name) or os.getenv(alias) or default)


def env_value_with_aliases(name: str, aliases: tuple[str, ...], default: str = ""):
    return field(
        default_factory=lambda: os.getenv(name)
        or next((os.getenv(alias) for alias in aliases if os.getenv(alias)), None)
        or default
    )


def is_pytest_runtime() -> bool:
    return bool(os.getenv("PYTEST_CURRENT_TEST")) or any(
        "pytest" in Path(arg).name.lower() for arg in sys.argv
    )


def default_embedding_index_on_startup() -> str:
    if is_pytest_runtime():
        return "false"
    return os.getenv("RAG_EMBEDDING_INDEX_ON_STARTUP", "true")


def default_guide_warmup_on_startup() -> str:
    if is_pytest_runtime():
        return "false"
    return os.getenv("GUIDE_WARMUP_ON_STARTUP", "true")
    return "false" if is_pytest else "true"


@dataclass(frozen=True)
class Settings:
    app_name: str = "A5 Scenic Area AI Guide Backend"
    guide_engine: str = env_value("GUIDE_ENGINE", "agentic")
    guide_core_config: str = env_value("GUIDE_CORE_CONFIG", "../configs/core.local.toml")
    app_env: str = env_value("APP_ENV", "dev")
    database_url: str = env_value("DATABASE_URL", "sqlite:///./data/app.db")
    source_package_path: str = field(
        default_factory=lambda: os.getenv(
            "SOURCE_PACKAGE_PATH",
            str(DEFAULT_SOURCE_PACKAGE_PATH),
        )
    )
    derived_knowledge_path: str = field(
        default_factory=lambda: os.getenv(
            "DERIVED_KNOWLEDGE_PATH",
            str(DEFAULT_DERIVED_KNOWLEDGE_PATH),
        )
    )
    llm_mode: str = env_value("LLM_MODE", "openai_compatible")
    llm_provider: str = env_value("LLM_PROVIDER", "mimo")
    llm_base_url: str = env_value("LLM_BASE_URL", "https://api.xiaomimimo.com/v1")
    llm_api_key: str = env_value_with_alias("LLM_API_KEY", "MIMO_API_KEY")
    llm_model: str = env_value("LLM_MODEL", "mimo-v2.5")
    kimi_base_url: str = env_value("KIMI_BASE_URL", "https://api.moonshot.cn/v1")
    kimi_api_key: str = env_value("MOONSHOT_API_KEY", "")
    kimi_model: str = env_value("KIMI_MODEL", "kimi-k3")
    kimi_timeout_seconds: float = field(
        default_factory=lambda: float(os.getenv("KIMI_TIMEOUT_SECONDS", "120"))
    )
    travel_journal_asset_dir: str = env_value(
        "TRAVEL_JOURNAL_ASSET_DIR",
        "./data/travel_journals",
    )
    photo_workshop_seedream_base_url: str = env_value(
        "SEEDREAM_BASE_URL",
        "https://ark.cn-beijing.volces.com/api/v3",
    )
    photo_workshop_seedream_api_key: str = env_value_with_alias(
        "SEEDREAM_API_KEY",
        "ARK_API_KEY",
    )
    photo_workshop_seedream_model: str = env_value(
        "SEEDREAM_MODEL",
        "doubao-seedream-5-0-pro-260628",
    )
    photo_workshop_seedream_timeout_seconds: float = field(
        default_factory=lambda: float(os.getenv("SEEDREAM_TIMEOUT_SECONDS", "180"))
    )
    photo_workshop_polish_model: str = env_value(
        "PHOTO_WORKSHOP_POLISH_MODEL",
        "mimo-v2.5-pro",
    )
    photo_workshop_polish_timeout_seconds: float = field(
        default_factory=lambda: float(
            os.getenv("PHOTO_WORKSHOP_POLISH_TIMEOUT_SECONDS", "60")
        )
    )
    guide_style: str = env_value("GUIDE_STYLE", "warm_real_guide")
    guide_route_trigger_strict: str = env_value("GUIDE_ROUTE_TRIGGER_STRICT", "true")
    llm_temperature_fact: float = field(
        default_factory=lambda: float(os.getenv("LLM_TEMPERATURE_FACT", "0.35"))
    )
    llm_temperature_guide: float = field(
        default_factory=lambda: float(os.getenv("LLM_TEMPERATURE_GUIDE", "0.55"))
    )
    llm_temperature_service: float = field(
        default_factory=lambda: float(os.getenv("LLM_TEMPERATURE_SERVICE", "0.65"))
    )
    llm_temperature_route: float = field(
        default_factory=lambda: float(os.getenv("LLM_TEMPERATURE_ROUTE", "0.45"))
    )
    llm_max_completion_tokens: int = field(
        default_factory=lambda: int(os.getenv("LLM_MAX_COMPLETION_TOKENS", "700"))
    )
    dashboard_insights_llm_enabled: str = env_value(
        "DASHBOARD_INSIGHTS_LLM_ENABLED",
        "true",
    )
    rag_retrieval_mode: str = env_value("RAG_RETRIEVAL_MODE", "hybrid")
    rag_vector_mode: str = env_value("RAG_VECTOR_MODE", "openai_compatible")
    rag_embedding_base_url: str = field(
        default_factory=lambda: os.getenv(
            "RAG_EMBEDDING_BASE_URL",
            "https://dashscope.aliyuncs.com/compatible-mode/v1",
        )
    )
    rag_embedding_api_key: str = env_value_with_aliases(
        "RAG_EMBEDDING_API_KEY",
        ("DASHSCOPE_API_KEY",),
    )
    rag_embedding_model: str = env_value(
        "RAG_EMBEDDING_MODEL",
        "text-embedding-v4",
    )
    rag_embedding_timeout_seconds: float = field(
        default_factory=lambda: float(os.getenv("RAG_EMBEDDING_TIMEOUT_SECONDS", "0.8"))
    )
    rag_embedding_index_timeout_seconds: float = field(
        default_factory=lambda: float(
            os.getenv("RAG_EMBEDDING_INDEX_TIMEOUT_SECONDS", "8.0")
        )
    )
    rag_embedding_index_budget_seconds: float = field(
        default_factory=lambda: float(
            os.getenv("RAG_EMBEDDING_INDEX_BUDGET_SECONDS", "30.0")
        )
    )
    rag_embedding_index_batch_size: int = field(
        default_factory=lambda: int(os.getenv("RAG_EMBEDDING_INDEX_BATCH_SIZE", "8"))
    )
    rag_embedding_index_on_startup: str = field(
        default_factory=default_embedding_index_on_startup
    )
    guide_warmup_on_startup: str = field(
        default_factory=default_guide_warmup_on_startup
    )
    guide_warmup_max_questions: int = field(
        default_factory=lambda: int(os.getenv("GUIDE_WARMUP_MAX_QUESTIONS", "40"))
    )
    guide_warmup_build_answer_cache: str = env_value(
        "GUIDE_WARMUP_BUILD_ANSWER_CACHE",
        "false",
    )
    guide_retrieval_cache_ttl_seconds: int = field(
        default_factory=lambda: int(os.getenv("GUIDE_RETRIEVAL_CACHE_TTL_SECONDS", "1800"))
    )
    guide_retrieval_cache_size: int = field(
        default_factory=lambda: int(os.getenv("GUIDE_RETRIEVAL_CACHE_SIZE", "256"))
    )
    guide_answer_cache_ttl_seconds: int = field(
        default_factory=lambda: int(os.getenv("GUIDE_ANSWER_CACHE_TTL_SECONDS", "1800"))
    )
    guide_answer_cache_size: int = field(
        default_factory=lambda: int(os.getenv("GUIDE_ANSWER_CACHE_SIZE", "128"))
    )
    web_search_mode: str = env_value("WEB_SEARCH_MODE", "mimo")
    web_search_endpoint: str = env_value("WEB_SEARCH_ENDPOINT", "")
    web_search_api_key: str = env_value("WEB_SEARCH_API_KEY", "")
    web_search_timeout_seconds: float = field(
        default_factory=lambda: float(os.getenv("WEB_SEARCH_TIMEOUT_SECONDS", "20.0"))
    )
    web_search_max_results: int = field(
        default_factory=lambda: int(os.getenv("WEB_SEARCH_MAX_RESULTS", "3"))
    )
    amap_key: str = env_value_with_aliases(
        "AMAP_KEY",
        ("VITE_AMAP_KEY",),
    )
    amap_security_code: str = env_value_with_aliases(
        "AMAP_SECURITY_CODE",
        ("VITE_AMAP_SECURITY_CODE",),
    )
    tts_mode: str = env_value("TTS_MODE", "provider")
    tts_provider: str = env_value("TTS_PROVIDER", "mimo")
    tts_base_url: str = env_value("TTS_BASE_URL", "https://api.xiaomimimo.com/v1")
    tts_api_key: str = env_value_with_alias("TTS_API_KEY", "MIMO_API_KEY")
    tts_model: str = env_value("TTS_MODEL", "mimo-v2.5-tts")
    tts_voice: str = env_value("TTS_VOICE", "mimo_default")
    tts_audio_format: str = env_value("TTS_AUDIO_FORMAT", "mp3")
    tts_output_dir: str = env_value("TTS_OUTPUT_DIR", "./data/tts")
    avatar_package_dir: str = env_value(
        "AVATAR_PACKAGE_DIR",
        "./data/avatar_packages",
    )
    avatar_upload_max_bytes: int = field(
        default_factory=lambda: int(
            os.getenv("AVATAR_UPLOAD_MAX_BYTES", str(100 * 1024 * 1024))
        )
    )
    avatar_extracted_max_bytes: int = field(
        default_factory=lambda: int(
            os.getenv("AVATAR_EXTRACTED_MAX_BYTES", str(300 * 1024 * 1024))
        )
    )
    avatar_preview_token_ttl_seconds: int = field(
        default_factory=lambda: int(
            os.getenv("AVATAR_PREVIEW_TOKEN_TTL_SECONDS", "600")
        )
    )
    avatar_runtime_token_ttl_seconds: int = field(
        default_factory=lambda: int(
            os.getenv("AVATAR_RUNTIME_TOKEN_TTL_SECONDS", "7200")
        )
    )
    cors_origins: str = env_value(
        "CORS_ORIGINS",
        "http://127.0.0.1:5173,http://localhost:5173,"
        "http://127.0.0.1:5174,http://localhost:5174,"
        "http://127.0.0.1:5175,http://localhost:5175",
    )
    admin_token: str = env_value("ADMIN_TOKEN", "")
    enable_admin_token: str = env_value("ENABLE_ADMIN_TOKEN", "false")
    admin_default_username: str = env_value("ADMIN_DEFAULT_USERNAME", "admin")
    admin_default_password: str = env_value("ADMIN_DEFAULT_PASSWORD", "")
    auth_token_secret: str = env_value("AUTH_TOKEN_SECRET", "")

    auth_token_ttl_seconds: int = field(
        default_factory=lambda: int(os.getenv("AUTH_TOKEN_TTL_SECONDS", "604800"))
    )

    def __post_init__(self) -> None:
        if self.guide_engine not in {"agentic", "legacy"}:
            raise ValueError("GUIDE_ENGINE must be agentic or legacy")
        object.__setattr__(self, "guide_core_config", resolve_backend_relative_path(self.guide_core_config))
        if self.guide_engine == "agentic":
            object.__setattr__(self, "rag_embedding_index_on_startup", "false")
            object.__setattr__(self, "guide_warmup_on_startup", "false")
        object.__setattr__(
            self,
            "source_package_path",
            resolve_backend_relative_path(self.source_package_path),
        )
        object.__setattr__(
            self,
            "derived_knowledge_path",
            resolve_backend_relative_path(self.derived_knowledge_path),
        )
        object.__setattr__(
            self,
            "travel_journal_asset_dir",
            resolve_backend_relative_path(self.travel_journal_asset_dir),
        )


settings = Settings()
