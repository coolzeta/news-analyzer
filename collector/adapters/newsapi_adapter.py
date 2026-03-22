import httpx
from datetime import datetime
from typing import List, Optional
import os
from .base import NewsAdapter, NewsArticle
from logger import get_logger


class NewsAPIAdapter(NewsAdapter):
    BASE_URL = "https://newsapi.org/v2"

    def __init__(self, api_key: Optional[str] = None, category: str = "business"):
        self.api_key = api_key or os.getenv("NEWSAPI_API_KEY")
        self.category = category
        self.log = get_logger()

    @property
    def name(self) -> str:
        return f"NewsAPI:{self.category}"

    def is_available(self) -> bool:
        return bool(self.api_key)

    async def fetch(self) -> List[NewsArticle]:
        if not self.api_key:
            return []

        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(
                    f"{self.BASE_URL}/top-headlines",
                    params={
                        "apiKey": self.api_key,
                        "category": self.category,
                        "language": "en",
                        "pageSize": 50,
                    },
                    timeout=30.0,
                )
                response.raise_for_status()
                data = response.json()

                articles = []
                for item in data.get("articles", []):
                    article = NewsArticle(
                        title=item.get("title", ""),
                        source=item.get("source", {}).get("name", "Unknown"),
                        published_date=item.get(
                            "publishedAt", datetime.utcnow().isoformat()
                        ),
                        summary=item.get("description", "") or "",
                        content=item.get("content", "") or "",
                        url=item.get("url", ""),
                    )
                    articles.append(article)

                return articles
            except Exception as e:
                self.log.error(f"NewsAPI fetch error: {e}")
                return []
