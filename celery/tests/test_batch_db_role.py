"""celery 배치 DB 접속 채널 회귀 테스트 (R13 4일차 — CO-Q-1 / CO-J-2 / CO-J-11).

**이 파일이 존재한다는 것 자체가 산출물의 절반이다.** 2026-08-07까지 `celery/`에는
테스트 디렉토리가 아예 없었고(pyflakes만 돌았다), 그것이 CO-Q-1이 라이브 DB를
직접 들여다보기 전까지 아무에게도 안 잡힌 직접적인 이유다.

Q-1 요약: `celery/app/config.py`가 `DATABASE_URL` 하나만 읽었다. 그 변수는
backend 런타임의 것이고 RLS 강제를 위해 **비특권 앱 롤**이어야 하는데(CO-J-2),
celery 배치는 전 유저 횡단 집계라 **소유자 롤**이어야 한다. 변수가 하나뿐인
동안은 둘 다 만족시키는 값이 없었다 — J-2를 고치면 Q-1이 발현했다.

라이브 실측(앱 롤): quiz_logs 0 / duels 0 / user_badges 0 ↔ 소유자 롤 119.
그 결과 retrain은 영구 "표본 부족 스킵", 듀얼 정산은 `settled:0`으로 **성공 반환**,
리그 정산은 UPDATE 0행인데 "정산 완료: N명" 로그 + user_badges INSERT가
user_isolation 위반 예외로 트랜잭션 전체를 롤백. **전부 조용했다.**
"""
import importlib

import pytest

from app import config as config_module
from app import db as db_module

OWNER = "postgresql+asyncpg://weathermind:pw@postgres:5432/weathermind"
APP_ROLE = "postgresql+asyncpg://weathermind_app:pw@postgres:5432/weathermind"
BATCH = "postgresql+asyncpg://batch:pw@postgres:5432/weathermind"

DB_ENV_KEYS = ("DATABASE_URL", "MIGRATION_DATABASE_URL", "CELERY_DATABASE_URL")


@pytest.fixture
def reload_config(monkeypatch):
    """env를 세팅하고 config를 재적재한다 — 모듈 상수라 import 시점에 굳는다."""

    def _load(**env):
        for key in DB_ENV_KEYS:
            monkeypatch.delenv(key, raising=False)
        for key, value in env.items():
            monkeypatch.setenv(key, value)
        return importlib.reload(config_module)

    yield _load
    # 다른 테스트가 실제 env 기준 모듈을 보도록 되돌린다(monkeypatch가 env를
    # 복원한 뒤 한 번 더 reload — 순서가 중요하다).
    monkeypatch.undo()
    importlib.reload(config_module)


class TestBatchDsnResolution:
    """해석 순서: CELERY_DATABASE_URL → MIGRATION_DATABASE_URL → DATABASE_URL."""

    def test_전용_변수가_최우선(self, reload_config):
        cfg = reload_config(
            DATABASE_URL=APP_ROLE, MIGRATION_DATABASE_URL=OWNER, CELERY_DATABASE_URL=BATCH
        )
        assert cfg.CELERY_DATABASE_URL == BATCH
        assert cfg.CELERY_DATABASE_URL_SOURCE == "CELERY_DATABASE_URL"

    def test_전용_변수가_없으면_마이그레이션_채널을_탄다(self, reload_config):
        """**이 한 건이 설계의 핵심이다.**

        롤 분리를 제대로 한 배포는 MIGRATION_DATABASE_URL이 반드시 있으므로,
        CO-J-2를 고치는 것(DATABASE_URL을 앱 롤로 전환)만으로 배치가 자동으로
        올바른 롤을 탄다 — 운영자가 새 변수의 존재를 알 필요조차 없다.
        이 폴백이 사라지면 J-2 수리가 그대로 Q-1 재발이 된다.
        """
        cfg = reload_config(DATABASE_URL=APP_ROLE, MIGRATION_DATABASE_URL=OWNER)
        assert cfg.CELERY_DATABASE_URL == OWNER
        assert cfg.CELERY_DATABASE_URL_SOURCE == "MIGRATION_DATABASE_URL"

    def test_둘_다_없으면_종전_동작(self, reload_config):
        """하위 호환 — 롤을 아직 안 가른 배포(=오늘의 dev·CI)는 한 글자도 안 바뀐다."""
        cfg = reload_config(DATABASE_URL=OWNER)
        assert cfg.CELERY_DATABASE_URL == OWNER
        assert cfg.CELERY_DATABASE_URL_SOURCE == "DATABASE_URL"

    def test_빈_문자열은_미설정으로_친다(self, reload_config):
        """`CELERY_DATABASE_URL=`만 적고 값을 안 준 .env가 폴백을 먹지 않게."""
        cfg = reload_config(
            DATABASE_URL=OWNER, MIGRATION_DATABASE_URL=OWNER, CELERY_DATABASE_URL=""
        )
        assert cfg.CELERY_DATABASE_URL_SOURCE == "MIGRATION_DATABASE_URL"


class TestEngineUsesBatchChannel:
    def test_엔진이_DATABASE_URL이_아니라_배치_채널을_쓴다(self, reload_config, monkeypatch):
        """Q-1의 근원 회귀. 엔진이 DATABASE_URL로 되돌아가면 여기서 죽는다."""
        reload_config(DATABASE_URL=APP_ROLE, MIGRATION_DATABASE_URL=OWNER)
        monkeypatch.setattr(db_module, "_engine", None)
        engine = db_module.get_engine()
        assert engine.url.username == "weathermind"  # 소유자 롤
        assert engine.url.username != "weathermind_app"

    def test_asyncpg를_psycopg2로_치환한다(self, reload_config, monkeypatch):
        """celery 태스크는 동기다 — .env는 backend용 asyncpg 형식으로 적혀 있다."""
        reload_config(DATABASE_URL=OWNER)
        monkeypatch.setattr(db_module, "_engine", None)
        assert db_module.get_engine().url.drivername == "postgresql+psycopg2"

    def test_엔진_생성에_DB_왕복이_없다(self, reload_config, monkeypatch):
        """롤 단정을 connect 이벤트에 단 이유 — 엔진 생성은 I/O 0이어야 한다.

        (그래야 DB 없는 이 테스트가 돌고, 호출부 3곳을 한 글자도 안 고친다.)
        """
        reload_config(DATABASE_URL=OWNER)
        monkeypatch.setattr(db_module, "_engine", None)
        db_module.get_engine()  # 접속 불가 호스트인데 예외가 나면 안 된다


class _FakeCursor:
    def __init__(self, row):
        self._row = row
        self.closed = False

    def execute(self, _sql):
        pass

    def fetchone(self):
        return self._row

    def close(self):
        self.closed = True


class _FakeConn:
    def __init__(self, row):
        self.cursor_obj = _FakeCursor(row)

    def cursor(self):
        return self.cursor_obj


class TestBatchRoleAssertion:
    """롤이 틀렸을 때 **조용히 0행이 아니라 시끄럽게 실패**하는가."""

    def test_비특권_롤이면_예외(self):
        conn = _FakeConn(("weathermind_app", False))
        with pytest.raises(db_module.BatchRoleError) as exc:
            db_module._assert_batch_role(conn, None)
        # 오류 문구가 조치를 담아야 한다 — 새벽 3시에 로그만 보고 고쳐야 한다.
        assert "CELERY_DATABASE_URL" in str(exc.value)
        assert "weathermind_app" in str(exc.value)

    def test_특권_롤이면_통과(self):
        db_module._assert_batch_role(_FakeConn(("weathermind", True)), None)

    def test_롤_조회가_비면_예외(self):
        """pg_roles에 current_user가 없는 이상 상태 — 통과시키지 않는다."""
        with pytest.raises(db_module.BatchRoleError):
            db_module._assert_batch_role(_FakeConn(None), None)

    def test_커서를_항상_닫는다(self):
        conn = _FakeConn(("weathermind_app", False))
        with pytest.raises(db_module.BatchRoleError):
            db_module._assert_batch_role(conn, None)
        assert conn.cursor_obj.closed  # 실패 경로에서도 커넥션을 새게 두지 않는다

    def test_성공_로그에_비밀번호가_없다(self, caplog):
        """CO-Q-3(httpx가 serviceKey를 URL째 INFO로 남긴 건)과 같은 계열의 사고 방지."""
        with caplog.at_level("INFO", logger=db_module.__name__):
            db_module._assert_batch_role(_FakeConn(("weathermind", True)), None)
        text = caplog.text
        assert "weathermind" in text  # 롤 이름은 남는다
        assert "@" not in text and "postgresql" not in text  # DSN은 안 남는다

    def test_엔진에_connect_리스너가_붙어_있다(self, reload_config, monkeypatch):
        """리스너 등록이 빠지면 위 단정이 전부 죽은 코드가 된다."""
        from sqlalchemy import event

        reload_config(DATABASE_URL=OWNER)
        monkeypatch.setattr(db_module, "_engine", None)
        engine = db_module.get_engine()
        assert event.contains(engine, "connect", db_module._assert_batch_role)
