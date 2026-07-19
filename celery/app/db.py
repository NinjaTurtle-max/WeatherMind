"""동기 SQLAlchemy 엔진.

.env의 DATABASE_URL은 backend(FastAPI)용 postgresql+asyncpg:// 형식이므로
Celery(동기 태스크)에서는 psycopg2 드라이버로 치환해 사용한다.
"""
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

from app import config

_engine: Engine | None = None


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        url = config.DATABASE_URL.replace("+asyncpg", "+psycopg2")
        _engine = create_engine(url, pool_pre_ping=True, pool_size=5)
    return _engine
