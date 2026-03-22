import feedparser
import httpx
from datetime import datetime
from typing import List, Optional
from .base import NewsAdapter, NewsArticle
from logger import get_logger


class RSSAdapter(NewsAdapter):
    def __init__(self, feed_url: str, source_name: Optional[str] = None):
        self.feed_url = feed_url
        self._source_name = source_name
        self.log = get_logger()

    @property
    def name(self) -> str:
        return f"RSS:{self._source_name or self.feed_url}"

    def is_available(self) -> bool:
        return True

    async def fetch(self) -> List[NewsArticle]:
        try:
            async with httpx.AsyncClient(
                verify=False,
                timeout=30.0,
                follow_redirects=True,
                headers={"User-Agent": "Mozilla/5.0 (compatible; NewsCollector/1.0)"},
            ) as client:
                response = await client.get(self.feed_url)
                content = response.content

            feed = feedparser.parse(content)

            if feed.bozo and feed.bozo_exception:
                self.log.warning(
                    f"RSS feed parse warning: {feed.bozo_exception}",
                    feed_url=self.feed_url,
                )

            articles = []
            source_name = self._source_name or getattr(
                feed.feed, "get", lambda k, d: d
            )("title", "Unknown")

            for entry in feed.entries:
                content_text = ""
                if hasattr(entry, "content") and entry.content:
                    content_text = entry.content[0].get("value", "")

                article = NewsArticle(
                    title=getattr(entry, "get", lambda k, d: d)("title", ""),
                    source=source_name,
                    published_date=getattr(entry, "get", lambda k, d: d)(
                        "published", datetime.utcnow().isoformat()
                    ),
                    summary=getattr(entry, "get", lambda k, d: d)("summary", ""),
                    content=content_text,
                    url=getattr(entry, "get", lambda k, d: d)("link", ""),
                )
                articles.append(article)

            return articles
        except Exception as e:
            self.log.error(f"RSS fetch error: {e}", feed_url=self.feed_url)
            return []
