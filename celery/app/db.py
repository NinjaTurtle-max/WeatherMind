"""동기 SQLAlchemy 엔진 — celery 배치 전용 접속 채널.

.env의 URL은 backend(FastAPI)용 postgresql+asyncpg:// 형식이므로
Celery(동기 태스크)에서는 psycopg2 드라이버로 치환해 사용한다.

── 접속 롤 계약 (R13 4일차 — CO-Q-1 / CO-J-2 합동 판정) ──────────────────────
읽는 변수는 `config.CELERY_DATABASE_URL`이다(`DATABASE_URL`이 **아니다**).
해석 순서와 그 이유는 celery/app/config.py에 있다. 요약: backend 런타임은
RLS가 강제되는 **비특권 앱 롤**이어야 하고, 배치는 전 유저 횡단 집계라
**소유자/BYPASSRLS 롤**이어야 한다 — 방향이 정반대라 변수를 갈랐다.

이 파일이 추가로 하는 일은 **그 계약을 실행 시점에 강제**하는 것이다.
Q-1의 피해가 컸던 이유는 롤이 틀렸다는 사실이 아니라 **틀렸는데 조용했다**는
것이다. 라이브 실측 기준 앱 롤로 붙은 배치의 증상:

  · retrain_weatherbrain — quiz_logs 0행 → 영구히 "표본 부족 스킵".
    8/11~18에 로그를 아무리 쌓아도 8/18 IRT b 재보정이 실행되지 않는다.
  · settle_daily_duel   — duels 0행 → "정산 대상 없음" + settled:0으로 **성공 반환**.
  · settle_weekly_league — UPDATE 0행인데 `len(scored)`로 "정산 완료: N명" 성공 로그.
    게다가 user_badges INSERT는 0행이 아니라 user_isolation **위반 예외**라
    engine.begin() 전체를 롤백시킨다(첫 정산은 항상 승급 판정 → 사실상 매번).

세 경우 모두 로그·반환값 어디에도 실패가 남지 않는다. 그래서 접속마다
롤 속성을 확인하고, 배치가 볼 수 없는 롤이면 **예외로 죽인다.** 조용한 0행보다
시끄러운 실패가 낫다 — 실패는 재시도·알림·로그로 이어지지만 0행은 아무 데도
이어지지 않는다.

검사를 `connect` 이벤트에 다는 이유: 호출부(app/tasks/*.py 3곳)를 한 글자도
바꾸지 않고 모든 접속을 덮는다. 엔진 생성 자체는 여전히 I/O가 없어서
DB 없는 단위 테스트가 `get_engine()`을 부를 수 있다.
"""
from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine

from app import config

_engine: Engine | None = None


class BatchRoleError(RuntimeError):
    """배치 접속 롤이 전 유저 횡단 조회를 할 수 없다(RLS 적용 대상)."""


# 접속 롤이 RLS를 우회하는가. 소유자 롤이 아닌 비특권 롤이면 false가 되고,
# 그 순간 배치의 모든 집계가 0행이 된다.
#
# `rolsuper OR rolbypassrls`로 판정하는 근거: postgres 공식 이미지의
# POSTGRES_USER는 superuser로 만들어지고 전 테이블의 소유자이기도 하다.
# 마이그레이션이 FORCE ROW LEVEL SECURITY를 걸지 않으므로(전수 확인 — 리포에
# 해당 구문 0건) 소유자는 자기 테이블의 RLS를 우회한다.
# ⚠️ 한계 2가지, 둘 다 안전한 방향으로 틀린다:
#   · 소유자가 superuser가 아닌 배포에서는 실제로는 동작하는데 여기서 거부한다
#     (거짓 양성 — 배치가 멈추고 사람이 본다).
#   · 나중에 FORCE RLS를 켜면 이 검사는 통과하는데 배치는 0행이 된다.
#     FORCE를 켜는 변경은 이 상수도 함께 고쳐야 한다.
_ROLE_CHECK_SQL = (
    "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user"
)


def _assert_batch_role(dbapi_connection, _connection_record) -> None:
    """새 DBAPI 커넥션마다 롤 특권을 확인한다 (SQLAlchemy `connect` 이벤트)."""
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute(_ROLE_CHECK_SQL)
        row = cursor.fetchone()
    finally:
        cursor.close()

    if row and row[0]:
        return

    raise BatchRoleError(
        "celery 배치가 RLS 적용 대상 롤로 접속했습니다 — 전 유저 횡단 집계가 "
        "예외 없이 0행이 되어 재보정·정산이 조용히 실패합니다. "
        "CELERY_DATABASE_URL(없으면 MIGRATION_DATABASE_URL)을 소유자 롤로 "
        "지정하세요. 근거: docs/team/CARRYOVER_R13.md §Q-1, database/init.sql "
        "'celery 배치는 소유자 롤 유지'."
    )


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        url = config.CELERY_DATABASE_URL.replace("+asyncpg", "+psycopg2")
        _engine = create_engine(url, pool_pre_ping=True, pool_size=5)
        event.listen(_engine, "connect", _assert_batch_role)
    return _engine
