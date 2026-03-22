import logging
import os
import json
import asyncio
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi import (
    FastAPI,
    Depends,
    HTTPException,
    Query,
    Request,
    BackgroundTasks,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import httpx

TZ_SHANGHAI = ZoneInfo("Asia/Shanghai")

load_dotenv()

from database import init_db, get_db, init_products, News, Product, Analysis
from sqlalchemy.orm import joinedload
from schemas import (
    NewsCreate,
    NewsResponse,
    ProductResponse,
    AnalysisCreate,
    AnalysisResponse,
    NewsWithAnalysis,
    AnalysisRequest,
    AnalysisResult,
)

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

AGENT_SERVICE_URL = os.getenv("AGENT_SERVICE_URL", "http://localhost:8001")
AGENT_TIMEOUT = int(os.getenv("AGENT_TIMEOUT", "120"))
AUTO_ANALYZE = os.getenv("AUTO_ANALYZE", "true").lower() == "true"
MAX_RETRY_COUNT = 3
MAX_CONCURRENT_ANALYSES = 5
MIN_RELEVANCE_THRESHOLD = 3  # Minimum relevance score to save analysis

active_analyses = 0
pending_queue: List[int] = []

logger.info(f"Agent Service URL: {AGENT_SERVICE_URL}")
logger.info(f"Agent Timeout: {AGENT_TIMEOUT}s")
logger.info(f"Auto Analyze: {AUTO_ANALYZE}")


class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(
            f"WebSocket connected. Total connections: {len(self.active_connections)}"
        )

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logger.info(
            f"WebSocket disconnected. Total connections: {len(self.active_connections)}"
        )

    async def broadcast(self, message: dict):
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.append(connection)
        for conn in disconnected:
            self.disconnect(conn)

    async def send_news_update(self, news: News, status: str):
        await self.broadcast(
            {
                "type": "news_update",
                "data": {
                    "id": news.id,
                    "title": news.title,
                    "source": news.source,
                    "published_date": news.published_date,
                    "summary": news.summary,
                    "content": news.content,
                    "url": news.url,
                    "created_at": news.created_at,
                    "analysis_status": status,
                },
            }
        )

    async def send_analysis_update(
        self, news_id: int, analyses: List[dict], status: str
    ):
        await self.broadcast(
            {
                "type": "analysis_update",
                "data": {
                    "news_id": news_id,
                    "status": status,
                    "analyses": analyses,
                },
            }
        )


manager = ConnectionManager()


async def process_pending_queue():
    while True:
        await asyncio.sleep(5)

        if not pending_queue:
            continue

        if active_analyses >= MAX_CONCURRENT_ANALYSES:
            continue

        db = next(get_db())
        try:
            news_id = pending_queue.pop(0)
            news = db.query(News).filter(News.id == news_id).first()
            if news and news.analysis_status == "pending":
                logger.info(f"Processing pending news: {news_id}")
                await run_analysis_with_status(
                    news.id, news.title, news.content, news.summary
                )
        except Exception as e:
            logger.error(f"Error processing pending queue: {e}")
        finally:
            db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing database...")
    init_db()
    db = next(get_db())
    try:
        init_products(db)
        logger.info("Products initialized")

        pending_news = (
            db.query(News)
            .filter(News.analysis_status == "pending")
            .order_by(News.id.desc())
            .all()
        )
        for news in pending_news:
            pending_queue.append(news.id)
        logger.info(
            f"Loaded {len(pending_queue)} pending news into queue (newest first)"
        )

        if AUTO_ANALYZE:
            asyncio.create_task(process_pending_queue())
            logger.info("Started pending queue processor")
    finally:
        db.close()
        logger.info("Startup complete")
    yield
    logger.info("Shutting down...")


app = FastAPI(title="Market News Intelligence API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception(f"Unhandled exception: {exc}")
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error", "detail": str(exc)},
    )


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
                if message.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        manager.disconnect(websocket)


@app.get("/api/products", response_model=List[ProductResponse])
def get_products(db: Session = Depends(get_db)):
    logger.debug("Fetching all products")
    return db.query(Product).all()


@app.get("/api/products/{code}", response_model=ProductResponse)
def get_product(code: str, db: Session = Depends(get_db)):
    logger.debug(f"Fetching product: {code}")
    product = db.query(Product).filter(Product.code == code).first()
    if not product:
        logger.warning(f"Product not found: {code}")
        raise HTTPException(status_code=404, detail="Product not found")
    return product


@app.get("/api/news", response_model=List[NewsWithAnalysis])
def get_news(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    sentiment: Optional[str] = Query(None),
    product_code: Optional[str] = Query(None),
    min_relevance: Optional[float] = Query(None, ge=0, le=10),
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    logger.debug(
        f"Fetching news: skip={skip}, limit={limit}, search={search}, sentiment={sentiment}, product={product_code}, status={status}"
    )
    query = (
        db.query(News)
        .options(joinedload(News.analyses))
        .order_by(News.published_date.desc())
    )

    if search:
        query = query.filter(News.title.ilike(f"%{search}%"))

    if start_date:
        query = query.filter(News.published_date >= start_date.isoformat())
    if end_date:
        query = query.filter(News.published_date <= end_date.isoformat())

    if status:
        query = query.filter(News.analysis_status == status)

    has_analysis_filters = sentiment or product_code or min_relevance is not None
    if has_analysis_filters:
        matching_news_ids = _get_news_ids_matching_analysis_filters(
            db, sentiment, product_code, min_relevance
        )
        if not matching_news_ids:
            return []
        query = query.filter(News.id.in_(matching_news_ids))

    return query.offset(skip).limit(limit).all()


def _get_news_ids_matching_analysis_filters(
    db: Session,
    sentiment: Optional[str],
    product_code: Optional[str],
    min_relevance: Optional[float],
) -> List[int]:
    base_relevance = min_relevance if min_relevance is not None else 0
    analysis_query = db.query(Analysis.news_id).filter(
        Analysis.relevance_score >= base_relevance
    )
    if sentiment:
        analysis_query = analysis_query.filter(Analysis.sentiment == sentiment)
    if product_code:
        analysis_query = analysis_query.filter(Analysis.product_code == product_code)

    return [row[0] for row in analysis_query.distinct().all()]


@app.get("/api/news/{news_id}", response_model=NewsWithAnalysis)
def get_news_detail(news_id: int, db: Session = Depends(get_db)):
    logger.debug(f"Fetching news detail: {news_id}")
    news = (
        db.query(News)
        .options(joinedload(News.analyses))
        .filter(News.id == news_id)
        .first()
    )
    if not news:
        logger.warning(f"News not found: {news_id}")
        raise HTTPException(status_code=404, detail="News not found")
    return news


@app.post("/api/news", response_model=NewsResponse)
async def create_news(
    news: NewsCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)
):
    logger.info(f"Creating news: {news.title[:50]}...")
    existing = db.query(News).filter(News.url == news.url).first()
    if existing:
        logger.debug(f"News already exists: {news.url}")
        return existing

    db_news = News(
        **news.model_dump(),
        created_at=datetime.utcnow().isoformat(),
        analysis_status="pending",
        analysis_retry_count=0,
    )
    db.add(db_news)
    db.commit()
    db.refresh(db_news)
    logger.info(f"News created: id={db_news.id}")

    await manager.send_news_update(db_news, "pending")

    if AUTO_ANALYZE:
        background_tasks.add_task(
            run_analysis_with_status,
            db_news.id,
            db_news.title,
            db_news.content,
            db_news.summary,
        )
        logger.info(f"Scheduled auto-analysis for news id={db_news.id}")

    return db_news


async def run_analysis_with_status(
    news_id: int, title: str, content: Optional[str], summary: Optional[str]
):
    global active_analyses, pending_queue

    if active_analyses >= MAX_CONCURRENT_ANALYSES:
        logger.info(f"Max concurrent analyses reached, queuing news: {news_id}")
        if news_id not in pending_queue:
            pending_queue.append(news_id)
        return

    active_analyses += 1
    logger.info(
        f"Running auto-analysis for news: {news_id} (active: {active_analyses})"
    )

    db = next(get_db())
    try:
        news = db.query(News).filter(News.id == news_id).first()
        if not news:
            logger.error(f"News {news_id} not found")
            return

        news.analysis_status = "analyzing"
        db.commit()
        await manager.send_news_update(news, "analyzing")

        products = db.query(Product).all()

        request = AnalysisRequest(
            article_id=news_id,
            title=title,
            content=content,
            summary=summary,
            products=[
                {"code": p.code, "name": p.name, "sector": p.sector} for p in products
            ],
        )

        try:
            async with httpx.AsyncClient() as client:
                logger.debug(f"Calling agent service: {AGENT_SERVICE_URL}/analyze")
                response = await client.post(
                    f"{AGENT_SERVICE_URL}/analyze",
                    json=request.model_dump(),
                    timeout=AGENT_TIMEOUT,
                )
                response.raise_for_status()
                result = response.json()
                logger.info(f"Agent returned {len(result.get('results', []))} analyses")

            saved_count = 0
            for item in result.get("results", []):
                if item["relevance_score"] < MIN_RELEVANCE_THRESHOLD:
                    continue
                analysis = Analysis(
                    news_id=news_id,
                    product_code=item["product_code"],
                    relevance_score=item["relevance_score"],
                    sentiment=item["sentiment"],
                    impact_summary=item["impact_summary"],
                    created_at=datetime.utcnow().isoformat(),
                    status="completed",
                    retry_count=0,
                )
                db.add(analysis)
                saved_count += 1

            news.analysis_status = "completed"
            news.analysis_retry_count = 0
            db.commit()

            analyses = db.query(Analysis).filter(Analysis.news_id == news_id).all()
            await manager.send_analysis_update(
                news_id,
                [
                    {
                        "product_code": a.product_code,
                        "sentiment": a.sentiment,
                        "relevance_score": a.relevance_score,
                    }
                    for a in analyses
                ],
                "completed",
            )
            await manager.send_news_update(news, "completed")

            logger.info(
                f"Auto-analysis complete: {saved_count} results saved (filtered from {len(result.get('results', []))})"
            )

        except Exception as e:
            logger.error(f"Auto-analysis failed for news {news_id}: {e}")

            news.analysis_retry_count = (news.analysis_retry_count or 0) + 1
            if news.analysis_retry_count >= MAX_RETRY_COUNT:
                news.analysis_status = "failed"
                await manager.send_news_update(news, "failed")
            else:
                news.analysis_status = "pending"
                await manager.send_news_update(news, "pending")

            db.commit()

    except Exception as e:
        logger.exception(f"Error in run_analysis_with_status: {e}")
    finally:
        active_analyses -= 1
        db.close()


@app.post("/api/news/{news_id}/analyze")
async def analyze_news(news_id: int, db: Session = Depends(get_db)):
    logger.info(f"Analyzing news: {news_id}")
    news = db.query(News).filter(News.id == news_id).first()
    if not news:
        logger.warning(f"News not found for analysis: {news_id}")
        raise HTTPException(status_code=404, detail="News not found")

    db.query(Analysis).filter(Analysis.news_id == news_id).delete()
    news.analysis_status = "analyzing"
    news.analysis_retry_count = 0
    db.commit()

    await manager.send_news_update(news, "analyzing")

    products = db.query(Product).all()

    request = AnalysisRequest(
        article_id=news_id,
        title=news.title,
        content=news.content,
        summary=news.summary,
        products=[
            {"code": p.code, "name": p.name, "sector": p.sector} for p in products
        ],
    )

    result = None
    try:
        async with httpx.AsyncClient() as client:
            logger.debug(f"Calling agent service: {AGENT_SERVICE_URL}/analyze/stream")
            async with client.stream(
                "POST",
                f"{AGENT_SERVICE_URL}/analyze/stream",
                json=request.model_dump(),
                timeout=AGENT_TIMEOUT,
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        try:
                            event = json.loads(line[6:])
                            event_type = event.get("type")

                            if event_type == "tool_start":
                                await manager.broadcast(
                                    {
                                        "type": "tool_start",
                                        "news_id": news_id,
                                        "tool": event.get("tool"),
                                        "timestamp": event.get("timestamp"),
                                    }
                                )
                                logger.debug(f"Tool started: {event.get('tool')}")

                            elif event_type == "tool_end":
                                await manager.broadcast(
                                    {
                                        "type": "tool_end",
                                        "news_id": news_id,
                                        "tool": event.get("tool"),
                                        "timestamp": event.get("timestamp"),
                                    }
                                )
                                logger.debug(f"Tool ended: {event.get('tool')}")

                            elif event_type == "analysis_complete":
                                result = {"results": event.get("results", [])}
                                logger.info(
                                    f"Analysis complete with {len(result['results'])} results"
                                )

                            elif event_type == "analysis_error":
                                raise Exception(event.get("error", "Unknown error"))

                        except json.JSONDecodeError:
                            logger.warning(f"Failed to parse SSE event: {line}")

    except httpx.TimeoutException:
        logger.error(f"Agent service timeout after {AGENT_TIMEOUT}s")
        news.analysis_status = "failed"
        news.analysis_retry_count = (news.analysis_retry_count or 0) + 1
        db.commit()
        await manager.send_news_update(news, "failed")
        raise HTTPException(
            status_code=503,
            detail=f"Agent service timeout after {AGENT_TIMEOUT}s",
        )
    except httpx.HTTPStatusError as e:
        logger.error(f"Agent service error: {e.response.status_code}")
        news.analysis_status = "failed"
        news.analysis_retry_count = (news.analysis_retry_count or 0) + 1
        db.commit()
        await manager.send_news_update(news, "failed")
        raise HTTPException(
            status_code=502,
            detail=f"Agent service error: {e.response.status_code}",
        )
    except httpx.RequestError as e:
        logger.error(f"Agent service unreachable: {str(e)}")
        news.analysis_status = "failed"
        news.analysis_retry_count = (news.analysis_retry_count or 0) + 1
        db.commit()
        await manager.send_news_update(news, "failed")
        raise HTTPException(
            status_code=503,
            detail=f"Agent service unreachable: {str(e)}",
        )
    except Exception as e:
        logger.error(f"Analysis error: {str(e)}")
        news.analysis_status = "failed"
        news.analysis_retry_count = (news.analysis_retry_count or 0) + 1
        db.commit()
        await manager.send_news_update(news, "failed")
        raise HTTPException(
            status_code=500,
            detail=f"Analysis error: {str(e)}",
        )

    if not result:
        result = {"results": []}

    saved_count = 0
    for item in result.get("results", []):
        if item["relevance_score"] < MIN_RELEVANCE_THRESHOLD:
            continue
        analysis = Analysis(
            news_id=news_id,
            product_code=item["product_code"],
            relevance_score=item["relevance_score"],
            sentiment=item["sentiment"],
            impact_summary=item["impact_summary"],
            created_at=datetime.utcnow().isoformat(),
            status="completed",
            retry_count=0,
        )
        db.add(analysis)
        saved_count += 1

    news.analysis_status = "completed"
    news.analysis_retry_count = 0
    db.commit()

    analyses = db.query(Analysis).filter(Analysis.news_id == news_id).all()
    await manager.send_analysis_update(
        news_id,
        [
            {
                "product_code": a.product_code,
                "sentiment": a.sentiment,
                "relevance_score": a.relevance_score,
            }
            for a in analyses
        ],
        "completed",
    )
    await manager.send_news_update(news, "completed")

    logger.info(
        f"Analysis complete: {saved_count} results saved (filtered from {len(result.get('results', []))})"
    )

    return {"status": "success", "analyses_count": saved_count}


@app.post("/api/news/{news_id}/retry")
async def retry_analysis(
    news_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)
):
    logger.info(f"Retrying analysis for news: {news_id}")
    news = db.query(News).filter(News.id == news_id).first()
    if not news:
        raise HTTPException(status_code=404, detail="News not found")

    if news.analysis_retry_count >= MAX_RETRY_COUNT:
        news.analysis_retry_count = 0

    news.analysis_status = "pending"
    db.commit()

    background_tasks.add_task(
        run_analysis_with_status, news_id, news.title, news.content, news.summary
    )

    return {"status": "retrying", "news_id": news_id}


@app.get("/api/products/{code}/impacts", response_model=List[NewsWithAnalysis])
def get_product_impacts(
    code: str, min_relevance: int = Query(0, ge=0, le=10), db: Session = Depends(get_db)
):
    logger.debug(f"Fetching impacts for product: {code}, min_relevance={min_relevance}")
    analyses = (
        db.query(Analysis)
        .options(joinedload(Analysis.news))
        .filter(
            Analysis.product_code == code, Analysis.relevance_score >= min_relevance
        )
        .order_by(Analysis.relevance_score.desc())
        .all()
    )

    news_map = {}
    for a in analyses:
        if a.news_id not in news_map:
            news_map[a.news_id] = a.news
            news_map[a.news_id].analyses = [a]
        else:
            news_map[a.news_id].analyses.append(a)

    return list(news_map.values())


@app.get("/api/analyses")
def get_analyses(
    sentiment: Optional[str] = None,
    product_code: Optional[str] = None,
    min_relevance: int = Query(0, ge=0, le=10),
    db: Session = Depends(get_db),
):
    logger.debug(
        f"Fetching analyses: sentiment={sentiment}, product={product_code}, min_relevance={min_relevance}"
    )
    query = db.query(Analysis)
    if sentiment:
        query = query.filter(Analysis.sentiment == sentiment)
    if product_code:
        query = query.filter(Analysis.product_code == product_code)
    query = query.filter(Analysis.relevance_score >= min_relevance)
    return query.order_by(Analysis.created_at.desc()).all()


@app.get("/api/analytics/heatmap")
def get_sentiment_heatmap(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    days: int = Query(7, ge=1, le=30),
    db: Session = Depends(get_db),
):
    logger.debug(
        f"Fetching sentiment heatmap: start={start_date}, end={end_date}, days={days}"
    )

    if end_date:
        end_dt = datetime.fromisoformat(end_date.replace("Z", "")).replace(
            tzinfo=TZ_SHANGHAI
        )
    else:
        end_dt = datetime.now(TZ_SHANGHAI)

    if start_date:
        start_dt = datetime.fromisoformat(start_date.replace("Z", "")).replace(
            tzinfo=TZ_SHANGHAI
        )
    else:
        start_dt = end_dt - timedelta(days=days - 1)

    start_str = start_dt.strftime("%Y-%m-%d")
    end_str = end_dt.strftime("%Y-%m-%d")

    products = db.query(Product).all()
    product_codes = [p.code for p in products]

    def get_local_date(created_at_str: str) -> str:
        if not created_at_str:
            return start_str
        try:
            dt = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
            local_dt = dt.astimezone(TZ_SHANGHAI)
            return local_dt.strftime("%Y-%m-%d")
        except:
            return created_at_str[:10] if len(created_at_str) >= 10 else start_str

    all_analyses = db.query(Analysis).all()

    date_product_sentiment: dict = {}
    for a in all_analyses:
        date_key = get_local_date(a.created_at)
        if date_key < start_str or date_key > end_str:
            continue
        if date_key not in date_product_sentiment:
            date_product_sentiment[date_key] = {}
        if a.product_code not in date_product_sentiment[date_key]:
            date_product_sentiment[date_key][a.product_code] = {
                "Positive": 0,
                "Negative": 0,
                "Neutral": 0,
                "total": 0,
                "avg_relevance": 0,
                "relevance_sum": 0,
            }
        if a.sentiment in date_product_sentiment[date_key][a.product_code]:
            date_product_sentiment[date_key][a.product_code][a.sentiment] += 1
        date_product_sentiment[date_key][a.product_code]["total"] += 1
        date_product_sentiment[date_key][a.product_code]["relevance_sum"] += (
            a.relevance_score
        )

    for date_key in date_product_sentiment:
        for pcode in date_product_sentiment[date_key]:
            total = date_product_sentiment[date_key][pcode]["total"]
            if total > 0:
                date_product_sentiment[date_key][pcode]["avg_relevance"] = round(
                    date_product_sentiment[date_key][pcode]["relevance_sum"] / total, 1
                )

    dates = []
    current = start_dt
    while current <= end_dt:
        dates.append(current.strftime("%Y-%m-%d"))
        current += timedelta(days=1)

    heatmap_data = []
    for d in dates:
        day_data = {"date": d, "products": {}}
        for pcode in product_codes:
            if d in date_product_sentiment and pcode in date_product_sentiment[d]:
                day_data["products"][pcode] = date_product_sentiment[d][pcode]
            else:
                day_data["products"][pcode] = {
                    "Positive": 0,
                    "Negative": 0,
                    "Neutral": 0,
                    "total": 0,
                    "avg_relevance": 0,
                }
        heatmap_data.append(day_data)

    product_info = {p.code: {"name": p.name, "sector": p.sector} for p in products}

    return {
        "start_date": start_str,
        "end_date": end_str,
        "products": product_info,
        "data": heatmap_data,
    }


@app.get("/api/analytics/trends")
def get_sentiment_trends(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    days: int = Query(30, ge=7, le=90),
    granularity: str = Query("day", regex="^(day|week)$"),
    db: Session = Depends(get_db),
):
    logger.debug(
        f"Fetching sentiment trends: start={start_date}, end={end_date}, days={days}, granularity={granularity}"
    )

    if end_date:
        end_dt = datetime.fromisoformat(end_date.replace("Z", "")).replace(
            tzinfo=TZ_SHANGHAI
        )
    else:
        end_dt = datetime.now(TZ_SHANGHAI)

    if start_date:
        start_dt = datetime.fromisoformat(start_date.replace("Z", "")).replace(
            tzinfo=TZ_SHANGHAI
        )
    else:
        start_dt = end_dt - timedelta(days=days - 1)

    start_str = start_dt.strftime("%Y-%m-%d")
    end_str = end_dt.strftime("%Y-%m-%d")

    def get_local_date(created_at_str: str) -> str:
        if not created_at_str:
            return start_str
        try:
            dt = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
            local_dt = dt.astimezone(TZ_SHANGHAI)
            return local_dt.strftime("%Y-%m-%d")
        except:
            return created_at_str[:10] if len(created_at_str) >= 10 else start_str

    all_analyses = db.query(Analysis).all()

    def get_period_key(created_at_str: str, gran: str) -> str:
        local_date = get_local_date(created_at_str)
        if gran == "week":
            d = datetime.strptime(local_date, "%Y-%m-%d")
            week_start = d - timedelta(days=d.weekday())
            return week_start.strftime("%Y-%m-%d")
        return local_date

    period_data: dict = {}
    for a in all_analyses:
        if not a.created_at:
            continue
        period_key = get_period_key(a.created_at, granularity)
        if period_key < start_str or period_key > end_str:
            continue
        if period_key not in period_data:
            period_data[period_key] = {
                "Positive": 0,
                "Negative": 0,
                "Neutral": 0,
                "total": 0,
                "avg_relevance": 0,
                "relevance_sum": 0,
                "by_product": {},
            }
        period_data[period_key][a.sentiment] = (
            period_data[period_key].get(a.sentiment, 0) + 1
        )
        period_data[period_key]["total"] += 1
        period_data[period_key]["relevance_sum"] += a.relevance_score

        if a.product_code:
            if a.product_code not in period_data[period_key]["by_product"]:
                period_data[period_key]["by_product"][a.product_code] = {
                    "Positive": 0,
                    "Negative": 0,
                    "Neutral": 0,
                    "total": 0,
                }
            period_data[period_key]["by_product"][a.product_code][a.sentiment] = (
                period_data[period_key]["by_product"][a.product_code].get(
                    a.sentiment, 0
                )
                + 1
            )
            period_data[period_key]["by_product"][a.product_code]["total"] += 1

    for period in period_data:
        total = period_data[period]["total"]
        if total > 0:
            period_data[period]["avg_relevance"] = round(
                period_data[period]["relevance_sum"] / total, 1
            )

    periods = sorted(period_data.keys())
    trends = []
    for p in periods:
        data = period_data[p]
        total = data["total"]
        sentiment_score = 0
        if total > 0:
            sentiment_score = round((data["Positive"] - data["Negative"]) / total, 2)
        trends.append(
            {
                "period": p,
                "granularity": granularity,
                "Positive": data["Positive"],
                "Negative": data["Negative"],
                "Neutral": data["Neutral"],
                "total": total,
                "avg_relevance": data["avg_relevance"],
                "sentiment_score": sentiment_score,
                "by_product": data["by_product"],
            }
        )

    return {
        "start_date": start_str,
        "end_date": end_str,
        "granularity": granularity,
        "trends": trends,
    }


@app.get("/health")
def health_check():
    return {"status": "healthy", "service": "main-service"}


@app.post("/api/admin/cleanup-low-relevance")
def cleanup_low_relevance_analyses(db: Session = Depends(get_db)):
    deleted = (
        db.query(Analysis)
        .filter(Analysis.relevance_score < MIN_RELEVANCE_THRESHOLD)
        .delete()
    )
    db.commit()
    logger.info(f"Cleaned up {deleted} low-relevance analyses")
    return {"deleted_count": deleted, "threshold": MIN_RELEVANCE_THRESHOLD}


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
