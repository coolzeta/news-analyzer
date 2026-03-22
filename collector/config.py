import os
import json
from typing import List, Optional
from dataclasses import dataclass, field
from dotenv import load_dotenv

load_dotenv()


class ConfigError(Exception):
    pass


@dataclass
class SourceConfig:
    type: str
    url: Optional[str] = None
    name: Optional[str] = None
    api_key: Optional[str] = None
    category: Optional[str] = None
    enabled: bool = True


@dataclass
class SchedulerConfig:
    interval_minutes: int = 1
    initial_delay_seconds: int = 0
    max_concurrent_sources: int = 5


@dataclass
class ProcessorConfig:
    similarity_threshold: float = 0.85
    batch_size: int = 10
    max_retries: int = 3
    retry_delay_seconds: float = 1.0
    request_timeout_seconds: float = 30.0


@dataclass
class EmbeddingConfig:
    provider: str = "openrouter"
    model: str = "nvidia/llama-nemotron-embed-vl-1b-v2:free"
    api_key: Optional[str] = None
    base_url: str = "https://openrouter.ai/api/v1"


@dataclass
class StorageConfig:
    chroma_persist_dir: str = "./chroma_data"
    failed_articles_file: str = "./failed_articles.json"


@dataclass
class LoggingConfig:
    level: str = "INFO"
    format_type: str = "text"
    log_file: Optional[str] = None


@dataclass
class Config:
    main_service_url: str
    sources: List[SourceConfig] = field(default_factory=list)
    scheduler: SchedulerConfig = field(default_factory=SchedulerConfig)
    processor: ProcessorConfig = field(default_factory=ProcessorConfig)
    embedding: EmbeddingConfig = field(default_factory=EmbeddingConfig)
    storage: StorageConfig = field(default_factory=StorageConfig)
    logging: LoggingConfig = field(default_factory=LoggingConfig)


class ConfigLoader:
    @staticmethod
    def from_env() -> Config:
        return Config(
            main_service_url=os.getenv("MAIN_SERVICE_URL", "http://localhost:8000"),
            embedding=EmbeddingConfig(
                provider=os.getenv("EMBEDDING_PROVIDER", "openrouter"),
                model=os.getenv(
                    "EMBEDDING_MODEL", "nvidia/llama-nemotron-embed-vl-1b-v2:free"
                ),
                api_key=os.getenv("LLM_API_KEY"),
                base_url=os.getenv(
                    "EMBEDDING_BASE_URL", "https://openrouter.ai/api/v1"
                ),
            ),
            storage=StorageConfig(
                chroma_persist_dir=os.getenv("CHROMA_PERSIST_DIR", "./chroma_data"),
                failed_articles_file=os.getenv(
                    "FAILED_ARTICLES_FILE", "./failed_articles.json"
                ),
            ),
            processor=ProcessorConfig(
                similarity_threshold=float(os.getenv("SIMILARITY_THRESHOLD", "0.85")),
                batch_size=int(os.getenv("BATCH_SIZE", "10")),
                max_retries=int(os.getenv("MAX_RETRIES", "3")),
                retry_delay_seconds=float(os.getenv("RETRY_DELAY_SECONDS", "1.0")),
                request_timeout_seconds=float(
                    os.getenv("REQUEST_TIMEOUT_SECONDS", "30.0")
                ),
            ),
            scheduler=SchedulerConfig(
                interval_minutes=int(os.getenv("COLLECT_INTERVAL_MINUTES", "1")),
                initial_delay_seconds=int(os.getenv("INITIAL_DELAY_SECONDS", "0")),
                max_concurrent_sources=int(os.getenv("MAX_CONCURRENT_SOURCES", "5")),
            ),
            logging=LoggingConfig(
                level=os.getenv("LOG_LEVEL", "INFO"),
                format_type=os.getenv("LOG_FORMAT", "text"),
                log_file=os.getenv("LOG_FILE"),
            ),
        )

    @staticmethod
    def from_file(filepath: str) -> dict:
        try:
            with open(filepath, "r") as f:
                return json.load(f)
        except json.JSONDecodeError as e:
            raise ConfigError(f"Invalid JSON in {filepath}: {e}")
        except FileNotFoundError:
            raise ConfigError(f"Config file not found: {filepath}")

    @staticmethod
    def validate_source(src: dict, index: int) -> None:
        if "type" not in src:
            raise ConfigError(f"Source at index {index} missing required field: type")
        if src["type"] == "rss" and "url" not in src:
            raise ConfigError(
                f"RSS source at index {index} missing required field: url"
            )
        if (
            src["type"] == "newsapi"
            and "api_key" not in src
            and not os.getenv("NEWSAPI_API_KEY")
        ):
            raise ConfigError(
                f"NewsAPI source at index {index} missing required field: api_key (or NEWSAPI_API_KEY env)"
            )

    @staticmethod
    def merge_sources(config: Config, sources_file: str) -> Config:
        if not os.path.exists(sources_file):
            return config

        data = ConfigLoader.from_file(sources_file)
        sources = []

        for i, src in enumerate(data.get("sources", [])):
            ConfigLoader.validate_source(src, i)
            if src.get("type") == "rss":
                sources.append(
                    SourceConfig(
                        type="rss",
                        url=src.get("url"),
                        name=src.get("name"),
                        enabled=src.get("enabled", True),
                    )
                )
            elif src.get("type") == "newsapi":
                sources.append(
                    SourceConfig(
                        type="newsapi",
                        name=src.get("name"),
                        api_key=src.get("api_key") or os.getenv("NEWSAPI_API_KEY"),
                        category=src.get("category", "business"),
                        enabled=src.get("enabled", True),
                    )
                )

        config.sources = sources

        if "scheduler" in data:
            config.scheduler.interval_minutes = data["scheduler"].get(
                "interval_minutes", config.scheduler.interval_minutes
            )

        return config

    @staticmethod
    def get_default_sources() -> List[SourceConfig]:
        return [
            SourceConfig(
                type="rss",
                name="Reuters Business",
                url="https://feeds.reuters.com/reuters/businessNews",
            ),
            SourceConfig(
                type="rss",
                name="Reuters Technology",
                url="https://feeds.reuters.com/reuters/technologyNews",
            ),
            SourceConfig(
                type="rss",
                name="Reuters Markets",
                url="https://feeds.reuters.com/reuters/marketsNews",
            ),
        ]
