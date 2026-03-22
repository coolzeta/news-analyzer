import asyncio
from datetime import datetime
from typing import List, Optional, Dict, Any
from dataclasses import dataclass
import signal
import sys

from config import Config, ConfigLoader, SourceConfig
from adapters import NewsAdapter, RSSAdapter, NewsAPIAdapter
from processor import NewsProcessor, ProcessingResult
from logger import get_logger, setup_logging


@dataclass
class CollectionStats:
    total_articles: int = 0
    new_articles: int = 0
    duplicates: int = 0
    errors: int = 0
    sources_processed: int = 0
    duration_seconds: float = 0.0
    timestamp: str = ""


class Metrics:
    def __init__(self):
        self.total_collections = 0
        self.total_articles_processed = 0
        self.total_new_articles = 0
        self.total_duplicates = 0
        self.total_errors = 0
        self.last_collection: Optional[CollectionStats] = None
        self.collection_history: List[CollectionStats] = []

    def record(self, stats: CollectionStats):
        self.total_collections += 1
        self.total_articles_processed += stats.total_articles
        self.total_new_articles += stats.new_articles
        self.total_duplicates += stats.duplicates
        self.total_errors += stats.errors
        self.last_collection = stats
        self.collection_history.append(stats)

        if len(self.collection_history) > 100:
            self.collection_history = self.collection_history[-100:]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "total_collections": self.total_collections,
            "total_articles_processed": self.total_articles_processed,
            "total_new_articles": self.total_new_articles,
            "total_duplicates": self.total_duplicates,
            "total_errors": self.total_errors,
            "last_collection": vars(self.last_collection)
            if self.last_collection
            else None,
        }


class NewsScheduler:
    def __init__(self, config: Config):
        self.config = config
        self.log = get_logger()

        self.adapters: List[NewsAdapter] = []
        self.processor: Optional[NewsProcessor] = None
        self.metrics = Metrics()

        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._shutdown_event = asyncio.Event()

    def _create_adapter(self, source: SourceConfig) -> Optional[NewsAdapter]:
        if source.type == "rss":
            if source.url:
                return RSSAdapter(feed_url=source.url, source_name=source.name)
        elif source.type == "newsapi":
            return NewsAPIAdapter(
                api_key=source.api_key, category=source.category or "business"
            )
        return None

    def _init_adapters(self):
        self.adapters = []
        for source in self.config.sources:
            if not source.enabled:
                continue
            adapter = self._create_adapter(source)
            if adapter and adapter.is_available():
                self.adapters.append(adapter)
                self.log.info(f"Initialized adapter: {adapter.name}")
            else:
                self.log.warning(
                    f"Adapter not available: {source.type} - {source.name}"
                )

        if not self.adapters:
            self.log.warning("No adapters available, using defaults")
            defaults = ConfigLoader.get_default_sources()
            for source in defaults:
                if source.url:
                    adapter = RSSAdapter(source.url, source.name)
                    self.adapters.append(adapter)

    async def _collect_from_adapter(
        self, adapter: NewsAdapter
    ) -> List[ProcessingResult]:
        results = []
        try:
            self.log.info(f"Fetching from: {adapter.name}")
            articles = await adapter.fetch()
            self.log.info(f"Fetched {len(articles)} articles from {adapter.name}")

            if articles and self.processor:
                batch_results = await self.processor.process_batch(articles)
                results.extend(batch_results)

                for result in batch_results:
                    if result.status == "added":
                        self.log.info(
                            f"Added: {result.title}", article_id=result.article_id
                        )
                    elif result.status == "duplicate":
                        self.log.debug(
                            f"Duplicate: {result.title}",
                            similarity=f"{result.similarity:.2f}",
                        )
                    else:
                        self.log.warning(f"Error: {result.title}", error=result.error)

        except Exception as e:
            self.log.exception(f"Error collecting from {adapter.name}", error=str(e))

        return results

    async def collect_once(self) -> CollectionStats:
        if not self.adapters:
            self._init_adapters()
        if not self.processor:
            self.processor = NewsProcessor(self.config)

        start_time = datetime.utcnow()
        stats = CollectionStats(timestamp=start_time.isoformat())

        self.log.info("Starting collection cycle")

        semaphore = asyncio.Semaphore(self.config.scheduler.max_concurrent_sources)

        async def collect_with_limit(adapter: NewsAdapter) -> List[ProcessingResult]:
            async with semaphore:
                return await self._collect_from_adapter(adapter)

        tasks = [collect_with_limit(adapter) for adapter in self.adapters]
        all_results = await asyncio.gather(*tasks)

        for results in all_results:
            for result in results:
                stats.total_articles += 1
                if result.status == "added":
                    stats.new_articles += 1
                elif result.status == "duplicate":
                    stats.duplicates += 1
                else:
                    stats.errors += 1

        stats.sources_processed = len(self.adapters)
        stats.duration_seconds = (datetime.utcnow() - start_time).total_seconds()

        retried = await self.processor.retry_failed()
        if retried > 0:
            self.log.info(f"Retried {retried} failed articles")

        self.metrics.record(stats)

        self.log.info(
            "Collection complete",
            total=stats.total_articles,
            new=stats.new_articles,
            duplicates=stats.duplicates,
            errors=stats.errors,
            duration=f"{stats.duration_seconds:.2f}s",
        )

        return stats

    async def run_forever(self):
        self._running = True

        if self.config.scheduler.initial_delay_seconds > 0:
            self.log.info(
                f"Waiting {self.config.scheduler.initial_delay_seconds}s before first collection"
            )
            await asyncio.sleep(self.config.scheduler.initial_delay_seconds)

        while self._running and not self._shutdown_event.is_set():
            try:
                await self.collect_once()
            except Exception as e:
                self.log.exception("Collection cycle error", error=str(e))

            if self._running and not self._shutdown_event.is_set():
                interval = self.config.scheduler.interval_minutes * 60
                self.log.info(
                    f"Next collection in {self.config.scheduler.interval_minutes} minutes"
                )

                try:
                    await asyncio.wait_for(
                        self._shutdown_event.wait(), timeout=interval
                    )
                except asyncio.TimeoutError:
                    pass

    async def start(self):
        setup_logging(
            level=self.config.logging.level,
            format_type=self.config.logging.format_type,
            log_file=self.config.logging.log_file,
        )

        self._init_adapters()
        self.processor = NewsProcessor(self.config)

        def signal_handler(sig, frame):
            self.log.info("Shutdown signal received")
            self._shutdown_event.set()
            self._running = False

        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)

        try:
            await self.run_forever()
        finally:
            await self.processor.close()
            self.log.info("Scheduler stopped")

    def stop(self):
        self._running = False
        self._shutdown_event.set()

    def get_metrics(self) -> Dict[str, Any]:
        return self.metrics.to_dict()
