import os
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


def init_products(db):
    products = [
        {
            "code": "7709.HK",
            "name": "CSOP SK Hynix Daily (2x) Lvrgd ProdSwap",
            "asset_class": "Equity",
            "domicile": "Hong Kong",
            "sector": "Technology",
        },
        {
            "code": "7747.HK",
            "name": "CSOP Samsung Electronics Daily (2x) Lvrgd ProdSwap",
            "asset_class": "Equity",
            "domicile": "Hong Kong",
            "sector": "Technology",
        },
        {
            "code": "7347.HK",
            "name": "CSOP Samsung Electronics Daily (-2x) Inverse ProdSwap",
            "asset_class": "Equity",
            "domicile": "Hong Kong",
            "sector": "Technology",
        },
        {
            "code": "2828.HK",
            "name": "iShares MSCI China A ETF",
            "asset_class": "Equity",
            "domicile": "Hong Kong",
            "sector": "China A-Share",
        },
        {
            "code": "83168.HK",
            "name": "CSOP Hang Seng Index ETF",
            "asset_class": "Equity",
            "domicile": "Hong Kong",
            "sector": "Hong Kong Equity",
        },
        {
            "code": "3010.HK",
            "name": "CSOP SSE 50 ETF",
            "asset_class": "Equity",
            "domicile": "Hong Kong",
            "sector": "China A-Share",
        },
        {
            "code": "3033.HK",
            "name": "CSOP CSI 500 ETF",
            "asset_class": "Equity",
            "domicile": "Hong Kong",
            "sector": "China A-Share",
        },
        {
            "code": "3115.HK",
            "name": "CSOP Nikkei 225 ETF",
            "asset_class": "Equity",
            "domicile": "Hong Kong",
            "sector": "Japan Equity",
        },
    ]
    for p in products:
        existing = db.query(Product).filter(Product.code == p["code"]).first()
        if not existing:
            db.add(Product(**p))
    db.commit()
