import os
import json
import logging
from pathlib import Path
from sqlalchemy import (
    create_engine,
    Column,
    Integer,
    String,
    Text,
    DateTime,
    Float,
    ForeignKey,
    text,
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime

logger = logging.getLogger(__name__)

DB_DIR: Path
DATABASE_URL: str

env_database_url = os.getenv("DATABASE_URL")

if env_database_url:
    DATABASE_URL = env_database_url
    if DATABASE_URL.startswith("sqlite"):
        db_path_str = DATABASE_URL.replace("sqlite:///", "")
        if db_path_str.startswith("/"):
            db_path_str = "/" + db_path_str
        DB_DIR = Path(db_path_str).parent
        DB_DIR.mkdir(parents=True, exist_ok=True)
        logger.info(f"Using DATABASE_URL from environment: {DATABASE_URL}")
    else:
        DB_DIR = Path(".")
        logger.info(
            f"Using DATABASE_URL from environment: {DATABASE_URL.split('://')[0]}://..."
        )
else:
    DB_DIR = Path(__file__).parent / "data"
    DB_DIR.mkdir(parents=True, exist_ok=True)
    DATABASE_URL = f"sqlite:///{DB_DIR}/news.db"
    logger.info(f"No DATABASE_URL set, using default: {DATABASE_URL}")

if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
    )
else:
    engine = create_engine(
        DATABASE_URL,
        pool_size=20,
        max_overflow=30,
    )
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    asset_class = Column(String)
    domicile = Column(String)
    sector = Column(String)
    theme = Column(String)
    background = Column(Text)


class FinancialContext(Base):
    __tablename__ = "financial_contexts"

    id = Column(Integer, primary_key=True, index=True)
    topic_key = Column(String, unique=True, index=True, nullable=False)
    context_type = Column(String, nullable=False)
    context_data = Column(Text, nullable=False)
    product_code = Column(String, ForeignKey("products.code"), nullable=True)


class News(Base):
    __tablename__ = "news"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    source = Column(String, nullable=False)
    published_date = Column(String, nullable=False)
    summary = Column(String)
    content = Column(String)
    url = Column(String, unique=True, nullable=False)
    created_at = Column(String, nullable=False)
    analysis_status = Column(String, default="pending")
    analysis_retry_count = Column(Integer, default=0)


class Analysis(Base):
    __tablename__ = "analyses"

    id = Column(Integer, primary_key=True, index=True)
    news_id = Column(Integer, ForeignKey("news.id"), nullable=False)
    product_code = Column(String, ForeignKey("products.code"), nullable=False)
    relevance_score = Column(Integer, nullable=False)
    sentiment = Column(String, nullable=False)
    impact_summary = Column(String, nullable=False)
    created_at = Column(String, nullable=False)
    status = Column(String, default="pending")
    retry_count = Column(Integer, default=0)

    news = relationship("News", backref="analyses")
    product = relationship("Product", backref="analyses")


def init_db():
    if DATABASE_URL.startswith("sqlite"):
        DB_DIR.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _migrate_add_background(db):
    """Add background column to products table if it doesn't exist."""
    if DATABASE_URL.startswith("sqlite"):
        result = db.execute(text("PRAGMA table_info(products)")).fetchall()
        columns = [row[1] for row in result]
        if "background" not in columns:
            db.execute(text("ALTER TABLE products ADD COLUMN background TEXT"))
            db.commit()
            logger.info("Added 'background' column to products table")


def init_products(db):
    products = [
        {
            "code": "NVDA",
            "name": "NVIDIA Corporation",
            "asset_class": "Equity",
            "domicile": "United States",
            "sector": "Technology",
        },
        {
            "code": "AAPL",
            "name": "Apple Inc.",
            "asset_class": "Equity",
            "domicile": "United States",
            "sector": "Technology",
        },
        {
            "code": "TSLA",
            "name": "Tesla, Inc.",
            "asset_class": "Equity",
            "domicile": "United States",
            "sector": "Consumer Discretionary",
        },
        {
            "code": "MSFT",
            "name": "Microsoft Corporation",
            "asset_class": "Equity",
            "domicile": "United States",
            "sector": "Technology",
        },
        {
            "code": "AMZN",
            "name": "Amazon.com, Inc.",
            "asset_class": "Equity",
            "domicile": "United States",
            "sector": "Consumer Discretionary",
        },
        {
            "code": "GOOGL",
            "name": "Alphabet Inc.",
            "asset_class": "Equity",
            "domicile": "United States",
            "sector": "Communication Services",
        },
        {
            "code": "META",
            "name": "Meta Platforms, Inc.",
            "asset_class": "Equity",
            "domicile": "United States",
            "sector": "Communication Services",
        },
        {
            "code": "SPY",
            "name": "SPDR S&P 500 ETF Trust",
            "asset_class": "ETF",
            "domicile": "United States",
            "sector": "Broad Market",
        },
        {
            "code": "QQQ",
            "name": "Invesco QQQ Trust (Nasdaq-100)",
            "asset_class": "ETF",
            "domicile": "United States",
            "sector": "Technology",
        },
        {
            "code": "SMH",
            "name": "VanEck Semiconductor ETF",
            "asset_class": "ETF",
            "domicile": "United States",
            "sector": "Semiconductor",
        },
    ]
    for p in products:
        existing = db.query(Product).filter(Product.code == p["code"]).first()
        if not existing:
            db.add(Product(**p))
    db.commit()


# Mapping: JSON key -> context_type
_CONTEXT_TYPE_MAP = {
    "nvidia": "company",
    "apple": "company",
    "tesla": "company",
    "microsoft": "company",
    "amazon": "company",
    "alphabet": "company",
    "meta": "company",
    "ai & semiconductor": "sector",
    "us equity market": "market",
    "technology": "sector",
}

# Mapping: JSON key -> associated product code(s)
_CONTEXT_PRODUCT_MAP = {
    "nvidia": "NVDA",
    "apple": "AAPL",
    "tesla": "TSLA",
    "microsoft": "MSFT",
    "amazon": "AMZN",
    "alphabet": "GOOGL",
    "meta": "META",
}


def init_financial_contexts(db):
    """Seed financial_contexts table from seed_contexts.json if not already present."""
    # Look for seed file next to this script first (works in Docker)
    contexts_path = Path(__file__).parent / "seed_contexts.json"
    if not contexts_path.exists():
        # Fallback: try agent-service sibling directory (works in local dev)
        contexts_path = Path(__file__).parent.parent / "agent-service" / "src" / "financial-contexts.json"

    if not contexts_path.exists():
        logger.info("No financial-contexts.json found, skipping context seed")
        return

    try:
        with open(contexts_path, "r", encoding="utf-8") as f:
            contexts_data = json.load(f)
    except Exception as e:
        logger.warning(f"Failed to load financial contexts: {e}")
        return

    for key, value in contexts_data.items():
        existing = db.query(FinancialContext).filter(
            FinancialContext.topic_key == key
        ).first()
        if not existing:
            ctx = FinancialContext(
                topic_key=key,
                context_type=_CONTEXT_TYPE_MAP.get(key, "sector"),
                context_data=json.dumps(value, ensure_ascii=False),
                product_code=_CONTEXT_PRODUCT_MAP.get(key),
            )
            db.add(ctx)
    db.commit()
    logger.info(f"Financial contexts initialized from {contexts_path}")
