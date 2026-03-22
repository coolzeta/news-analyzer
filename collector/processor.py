import asyncio
import httpx
import chromadb
from datetime import datetime
import uuid
from typing import Optional, List, Callable, Any, Tuple
from dataclasses import dataclass, field
import json
import os

from config import Config, ProcessorConfig, EmbeddingConfig
from adapters.base import NewsArticle
from logger import get_logger


@dataclass
class ProcessingResult:
    status: str
    title: str
    similarity: float = 0.0
    error: Optional[str] = None
    article_id: Optional[str] = None


@dataclass
class FailedArticle:
    article: dict
    error: str
    timestamp: str
    retries: int = 0


class RetryHandler:
    def __init__(
        self, max_retries: int = 3, base_delay: float = 1.0, max_delay: float = 60.0
    ):
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.max_delay = max_delay

    async def execute_with_retry(
        self, func: Callable[..., Any], *args, **kwargs
    ) -> Any:
        last_exception: Optional[Exception] = None

        for attempt in range(self.max_retries + 1):
            try:
                return await func(*args, **kwargs)
            except Exception as e:
                last_exception = e
                if attempt < self.max_retries:
                    delay = min(self.base_delay * (2**attempt), self.max_delay)
                    get_logger().warning(
                        f"Retry {attempt + 1}/{self.max_retries} after {delay}s",
                        error=str(e),
                    )
                    await asyncio.sleep(delay)

        if last_exception:
            raise last_exception
        raise RuntimeError("Retry failed without exception")


class EmbeddingClient:
    def __init__(self, config: EmbeddingConfig, timeout: float = 30.0):
        self.config = config
        self.timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None

    async def get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=self.timeout)
        return self._client

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    async def get_embedding(self, text: str) -> Optional[List[float]]:
        if not self.config.api_key:
            raise ValueError("Embedding API key is required")

        client = await self.get_client()

        try:
            response = await client.post(
                f"{self.config.base_url}/embeddings",
                headers={
                    "Authorization": f"Bearer {self.config.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.config.model,
                    "input": text,
                },
            )
            response.raise_for_status()
            data = response.json()
            return data["data"][0]["embedding"]
        except httpx.HTTPStatusError as e:
            get_logger().error(
                "Embedding API HTTP error",
                status_code=e.response.status_code,
                error=str(e),
            )
            return None
        except Exception as e:
            get_logger().error("Embedding API error", error=str(e))
            return None


class VectorStore:
    def __init__(self, persist_dir: str):
        self.client = chromadb.PersistentClient(path=persist_dir)
        self.collection = self.client.get_or_create_collection(
            name="news_dedup", metadata={"hnsw:space": "cosine"}
        )

    def count(self) -> int:
        return self.collection.count()

    async def check_duplicate(
        self, embedding: List[float], threshold: float
    ) -> Tuple[bool, float]:
        result = self.collection.query(
            query_embeddings=[embedding], n_results=1, include=["distances"]
        )

        if not result["ids"][0]:
            return False, 0.0

        distance = result["distances"][0][0]
        similarity = 1 - distance

        return similarity >= threshold, similarity

    async def add(
        self, embedding: List[float], title: str, content: str, url: str
    ) -> str:
        doc_id = str(uuid.uuid4())
        text = f"{title} {content}".strip()

        self.collection.add(
            ids=[doc_id],
            embeddings=[embedding],
            documents=[text],
            metadatas=[
                {"url": url, "title": title, "added_at": datetime.utcnow().isoformat()}
            ],
        )

        return doc_id


class FailedArticleQueue:
    def __init__(self, filepath: str):
        self.filepath = filepath
        self._queue: List[FailedArticle] = []

    def load(self):
        if os.path.exists(self.filepath):
            try:
                with open(self.filepath, "r") as f:
                    data = json.load(f)
                    self._queue = [FailedArticle(**item) for item in data]
            except Exception:
                self._queue = []

    def save(self):
        with open(self.filepath, "w") as f:
            json.dump([vars(item) for item in self._queue], f, indent=2)

    def add(self, article: dict, error: str):
        self._queue.append(
            FailedArticle(
                article=article,
                error=error,
                timestamp=datetime.utcnow().isoformat(),
                retries=0,
            )
        )
        self.save()

    def pop(self) -> Optional[FailedArticle]:
        if self._queue:
            return self._queue.pop(0)
        return None

    def __len__(self):
        return len(self._queue)


class NewsProcessor:
    def __init__(self, config: Config):
        self.config = config
        self.log = get_logger()

        self.retry_handler = RetryHandler(
            max_retries=config.processor.max_retries,
            base_delay=config.processor.retry_delay_seconds,
        )

        self.embedding_client = EmbeddingClient(
            config=config.embedding, timeout=config.processor.request_timeout_seconds
        )

        self.vector_store = VectorStore(config.storage.chroma_persist_dir)

        self.failed_queue = FailedArticleQueue(config.storage.failed_articles_file)
        self.failed_queue.load()

        self._http_client: Optional[httpx.AsyncClient] = None

    async def get_http_client(self) -> httpx.AsyncClient:
        if self._http_client is None or self._http_client.is_closed:
            self._http_client = httpx.AsyncClient(
                timeout=self.config.processor.request_timeout_seconds
            )
        return self._http_client

    async def close(self):
        await self.embedding_client.close()
        if self._http_client and not self._http_client.is_closed:
            await self._http_client.aclose()

    async def send_to_main_service(self, article: dict) -> Tuple[bool, str]:
        client = await self.get_http_client()

        try:
            response = await self.retry_handler.execute_with_retry(
                client.post, f"{self.config.main_service_url}/api/news", json=article
            )
            if response.status_code == 200:
                return True, "added"
            return False, "error"
        except Exception as e:
            self.log.error("Failed to send article to main service", error=str(e))
            return False, "error"

    async def process_article(self, article: NewsArticle) -> ProcessingResult:
        content = article.content or article.summary
        text = f"{article.title} {content}".strip()

        try:
            embedding = await self.embedding_client.get_embedding(text)

            if not embedding:
                return ProcessingResult(
                    status="error",
                    title=article.title[:60],
                    error="Failed to generate embedding",
                )

            is_duplicate, similarity = await self.vector_store.check_duplicate(
                embedding, self.config.processor.similarity_threshold
            )

            if is_duplicate:
                return ProcessingResult(
                    status="duplicate", title=article.title[:50], similarity=similarity
                )

            article_dict = article.to_dict()
            success, status = await self.send_to_main_service(article_dict)

            if success:
                doc_id = await self.vector_store.add(
                    embedding, article.title, content or "", article.url
                )
                return ProcessingResult(
                    status="added", title=article.title[:60], article_id=doc_id
                )
            else:
                self.failed_queue.add(article_dict, "Failed to send to main service")
                return ProcessingResult(
                    status="error",
                    title=article.title[:60],
                    error="Failed to send to main service",
                )

        except Exception as e:
            self.log.exception("Error processing article", error=str(e))
            return ProcessingResult(
                status="error", title=article.title[:60], error=str(e)
            )

    async def process_batch(
        self, articles: List[NewsArticle]
    ) -> List[ProcessingResult]:
        semaphore = asyncio.Semaphore(self.config.processor.batch_size)

        async def process_with_semaphore(article: NewsArticle) -> ProcessingResult:
            async with semaphore:
                return await self.process_article(article)

        tasks = [process_with_semaphore(article) for article in articles]
        return await asyncio.gather(*tasks)

    async def retry_failed(self) -> int:
        retried = 0

        while len(self.failed_queue) > 0:
            failed = self.failed_queue.pop()
            if failed is None:
                continue
            if failed.retries >= 3:
                continue

            success, _ = await self.send_to_main_service(failed.article)
            if success:
                retried += 1
            else:
                failed.retries += 1
                self.failed_queue._queue.append(failed)

        self.failed_queue.save()
        return retried
