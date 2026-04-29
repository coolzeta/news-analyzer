from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


class ProductBase(BaseModel):
    code: str
    name: str
    asset_class: Optional[str] = None
    domicile: Optional[str] = None
    sector: Optional[str] = None
    theme: Optional[str] = None
    background: Optional[str] = None


class ProductCreate(BaseModel):
    code: str
    name: str
    asset_class: Optional[str] = None
    domicile: Optional[str] = None
    sector: Optional[str] = None
    theme: Optional[str] = None
    background: Optional[str] = None


class ProductUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    asset_class: Optional[str] = None
    domicile: Optional[str] = None
    sector: Optional[str] = None
    theme: Optional[str] = None
    background: Optional[str] = None


class ProductResponse(ProductBase):
    id: int

    class Config:
        from_attributes = True


class NewsBase(BaseModel):
    title: str
    source: str
    published_date: str
    summary: Optional[str] = None
    content: Optional[str] = None
    url: str


class NewsCreate(NewsBase):
    pass


class NewsResponse(NewsBase):
    id: int
    created_at: str
    analysis_status: str = "pending"
    analysis_retry_count: int = 0

    class Config:
        from_attributes = True


class AnalysisBase(BaseModel):
    news_id: int
    product_code: str
    relevance_score: int
    sentiment: str
    impact_summary: str


class AnalysisCreate(AnalysisBase):
    pass


class AnalysisResponse(AnalysisBase):
    id: int
    created_at: str
    status: str = "completed"
    retry_count: int = 0

    class Config:
        from_attributes = True


class ProductShort(BaseModel):
    code: str
    name: str
    sector: Optional[str] = None


class AnalysisRequest(BaseModel):
    article_id: int
    title: str
    content: Optional[str] = None
    summary: Optional[str] = None
    products: List[ProductShort]


class AnalysisResult(BaseModel):
    product_code: str
    relevance_score: int
    sentiment: str
    impact_summary: str


class AnalysisResponseFromAgent(BaseModel):
    results: List[AnalysisResult]


class NewsWithAnalysis(NewsResponse):
    analyses: List[AnalysisResponse] = Field(default_factory=list)


class FinancialContextResponse(BaseModel):
    id: int
    topic_key: str
    context_type: str
    context_data: str
    product_code: Optional[str] = None

    class Config:
        from_attributes = True


class FinancialContextCreate(BaseModel):
    topic_key: str
    context_type: str
    context_data: str
    product_code: Optional[str] = None


class FinancialContextUpdate(BaseModel):
    topic_key: Optional[str] = None
    context_type: Optional[str] = None
    context_data: Optional[str] = None
    product_code: Optional[str] = None
