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
import asyncio

from sqlalchemy import text
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


# ── 런타임 접속 롤 판정 (R13 4일차 — CO-J-2) ────────────────────────────────
# 위 독스트링은 이 엔진이 **비특권 앱 롤**로 붙는다고 선언하지만, 2026-08-07까지
# 그 선언을 확인하는 것이 아무 데도 없었다. 실제로는 `.env.example:9`가 소유자
# 롤을 싣고 `DEPLOY.md`가 `DATABASE_URL`을 앱 롤로 바꾸라는 말을 하지 않아서,
# **런북대로 배포하면 런타임이 rolbypassrls로 붙고 RLS가 통째로 무력화된다.**
# 더 나쁜 건 그래도 서비스가 정상으로 보인다는 것이다 — 앱 계층 user_id 필터가
# 남아 있어 화면은 멀쩡하고, 사라지는 것은 DB 층 방어선뿐이다.
#
# 그래서 판정을 코드로 만든다. celery 쪽(`celery/app/db.py`)은 **정확히 반대**
# 방향의 단정을 건다(특권이 아니면 예외) — 두 채널이 서로 반대편을 지키므로
# 어느 쪽으로 잘못 배선해도 소리가 난다. 두 결함(CO-J-2·CO-Q-1)의 공통점이
# "조용하다"였고, 이 대칭이 그 침묵을 없앤다.
#
# 여기는 **판정만** 한다. dev 경고 / 비-dev 기동 거부 분기는 main.py lifespan이
# 담당한다 — `insecure_secret_defaults`가 세운 교차 계약 ③과 같은 형태다.
_ROLE_CHECK_SQL = (
    "SELECT current_user, rolsuper OR rolbypassrls "
    "FROM pg_roles WHERE rolname = current_user"
)

# DB 미기동 중 기동해도 backend는 떠야 한다. CO-J-16 수리 뒤에도 그대로다 —
# **postgres에 healthcheck가 없어** backend→postgres는 계속 `service_started`이고
# (healthcheck 없는 서비스에 service_healthy를 걸면 기동이 영영 안 된다), 그래서
# backend가 postgres보다 먼저 뜨는 것이 여전히 정상 경로다. 그래서 짧게 끊는다.
ROLE_CHECK_TIMEOUT_SEC = 3.0


async def runtime_role_privilege() -> tuple[str, bool] | None:
    """(접속 롤 이름, RLS를 우회하는가). DB에 닿지 못하면 None(=판정 불가).

    None과 (role, False)를 구분하는 것이 중요하다 — 전자는 "아직 모른다"이고
    후자는 "확인했고 올바르다"다. 호출부가 둘을 같게 다루면 판정이 다시 조용해진다.
    """
    try:
        async with asyncio.timeout(ROLE_CHECK_TIMEOUT_SEC):
            async with engine.connect() as conn:
                row = (await conn.execute(text(_ROLE_CHECK_SQL))).first()
    except Exception:  # noqa: BLE001 — DNS·접속거부·타임아웃 전부 "판정 불가"
        return None
    if row is None:
        return None
    return str(row[0]), bool(row[1])
