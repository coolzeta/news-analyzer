from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from email.utils import parsedate_to_datetime
from typing import List, Optional


def normalize_date(date_str: str) -> str:
    if not date_str:
        return datetime.utcnow().isoformat() + "Z"

    if "T" in date_str and (date_str.endswith("Z") or "+" in date_str[-6:]):
        return date_str

    try:
        dt = parsedate_to_datetime(date_str)
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    except:
        pass

    for fmt in [
        "%a, %d %b %Y %H:%M:%S %z",
        "%a, %d %b %Y %H:%M:%S GMT",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
    ]:
        try:
            dt = datetime.strptime(date_str, fmt)
            return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        except:
            continue

    return date_str


@dataclass
class NewsArticle:
    title: str
    source: str
    published_date: str
    summary: str
    content: str
    url: str

    def to_dict(self) -> dict:
        return {
            "title": self.title,
            "source": self.source,
            "published_date": normalize_date(self.published_date),
            "summary": self.summary,
            "content": self.content,
            "url": self.url,
        }


class NewsAdapter(ABC):
    @property
    @abstractmethod
    def name(self) -> str:
        pass

    @abstractmethod
    async def fetch(self) -> List[NewsArticle]:
        pass

    @abstractmethod
    def is_available(self) -> bool:
        pass
