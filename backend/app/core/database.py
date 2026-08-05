"""SQLAlchemy async engine + async_session 싱글턴.

접속 롤 계약 (R11-01 §7 — RLS 롤 분리):
- 이 엔진(`settings.DATABASE_URL`)은 **비특권 앱 롤**(weathermind_app —
  NOSUPERUSER·NOBYPASSRLS·테이블 비소유)로 접속한다. 그래야 마이그레이션이 만든
  user_isolation RLS 정책이 실제로 강제된다. 롤·GRANT는 database/init.sql(신규
  볼륨)·backend/app/scripts/rls_app_role.sql(기존 볼륨, 멱등)이 만든다.
- RLS가 참조하는 GUC(app.current_user_id) 주입은 여기가 아니라
  `app.core.dependencies.get_db_with_rls`가 요청마다 수행한다 —
  set_config(..., is_local := true) = SET LOCAL(트랜잭션 스코프)이며, 해당 세션은
  요청 전체가 session.begin() 단일 트랜잭션이라(서비스 계층은 flush만 사용)
  GUC가 요청 끝까지 유지되고 커넥션 풀 오염이 없다.
- 마이그레이션(alembic)은 소유자 롤 별도 채널(`MIGRATION_DATABASE_URL` —
  backend/alembic/env.py 직독)을 쓴다. 이 엔진과 무관.
"""
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
)

async_session = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)
