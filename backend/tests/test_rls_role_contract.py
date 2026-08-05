"""RLS 롤 분리 계약 (R11-01 §7 — 마일스톤 5 최우선).

## 무엇을 지키는가

RLS 런타임 무효(앱 접속 롤이 superuser·bypassrls·소유자라 user_isolation이 한 번도
적용되지 않던 것 — ROADMAP §2.1)의 해소는 4개 산출물의 **합**으로 성립한다:

1. database/init.sql — 신규 볼륨: 비특권 롤 + GRANT + ALTER DEFAULT PRIVILEGES
2. backend/app/scripts/rls_app_role.sql — 기존 볼륨(멱등, 단일 적용 지점):
   위 + 앱 롤 예외 정책 2건(users 인증 카탈로그 · league_results 리더보드 읽기)
3. backend/alembic/env.py — 마이그레이션만 소유자 롤(MIGRATION_DATABASE_URL 직독)
4. app.core.dependencies.get_db_with_rls — 요청마다 GUC(app.current_user_id)를
   SET LOCAL(트랜잭션 스코프)로 주입 (이미 존재 — 여기서 실측으로 고정)

어느 하나가 드리프트하면 앱 롤 전환 순간 전 쿼리 0행(인증 전면 마비)이거나,
반대로 격리가 조용히 무효로 돌아간다. pytest는 실DB가 없으므로 (1)(2)는 소스 텍스트
계약(test_ci_workflow_contract 관례), (3)(4)는 코드 경로 실측으로 감시한다.
실DB 격리 실증은 PM 게이트(rls_app_role.sql 동봉 검증 쿼리 V1~V8) 몫.

실행: backend에서 `python -m pytest tests -q`. DB·네트워크 불필요.
"""
import asyncio
import re
import uuid
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND.parent

INIT_SQL = (REPO_ROOT / "database" / "init.sql").read_text(encoding="utf-8")
APP_ROLE_SQL = (BACKEND / "app" / "scripts" / "rls_app_role.sql").read_text(
    encoding="utf-8"
)
ENV_PY = (BACKEND / "alembic" / "env.py").read_text(encoding="utf-8")

# 실DB pg_policies 실측(2026-08-05) — user_isolation이 걸린 11개 테이블.
# 마이그레이션이 RLS 테이블을 추가하면 이 목록과 아래 예외 계약을 함께 갱신한다.
RLS_TABLES = {
    "attendance",
    "duels",
    "league_results",
    "quiz_logs",
    "sessions",
    "user_badges",
    "user_concept_ability",
    "user_quest_progress",
    "user_unit_progress",
    "users",
    "weak_tags",
}
# 앱 롤 예외 — 이 2개 밖으로 늘어나면 격리 축소이므로 테스트가 막는다.
EXEMPT_TABLES = {"users", "league_results"}
ENFORCED_TABLES = RLS_TABLES - EXEMPT_TABLES  # 9개 — 이번 항목의 실체


# ═══════════════════════════════════════════════════════════════
# 1. 롤 정의 — init.sql·rls_app_role.sql 공통 계약
# ═══════════════════════════════════════════════════════════════


class TestApp롤정의:
    def test_두_스크립트_모두_비특권_로그인_롤(self):
        """NOSUPERUSER·NOBYPASSRLS·LOGIN — RLS가 실제 강제되는 속성 셋."""
        for src in (INIT_SQL, APP_ROLE_SQL):
            m = re.search(
                r"CREATE ROLE weathermind_app\b(.*?);", src, flags=re.DOTALL
            )
            assert m, "weathermind_app CREATE ROLE 구문이 없다"
            body = m.group(0)
            for attr in ("LOGIN", "NOSUPERUSER", "NOCREATEDB", "NOCREATEROLE",
                         "NOBYPASSRLS"):
                assert attr in body, f"롤 속성 누락: {attr}"

    def test_롤_생성은_멱등(self):
        """pg_roles 존재 검사로 감싼다 — 재실행이 에러가 아니어야 한다."""
        for src in (INIT_SQL, APP_ROLE_SQL):
            assert re.search(
                r"IF NOT EXISTS \(SELECT FROM pg_roles WHERE rolname = "
                r"'weathermind_app'\)",
                src,
            )

    def test_DB이름_하드코딩_금지(self):
        """GRANT CONNECT은 current_database() 동적 — POSTGRES_DB 가변 대응."""
        for src in (INIT_SQL, APP_ROLE_SQL):
            assert "GRANT CONNECT ON DATABASE %I" in src
            assert "current_database()" in src


class TestGrant계약:
    def test_스키마_사용과_일괄_DML(self):
        for src in (INIT_SQL, APP_ROLE_SQL):
            assert "GRANT USAGE ON SCHEMA public TO weathermind_app" in src
            assert (
                "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "
                "public TO weathermind_app" in src
            )
            assert (
                "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public "
                "TO weathermind_app" in src
            )

    def test_기본권한_테이블과_시퀀스_모두(self):
        """ALTER DEFAULT PRIVILEGES 누락 = 다음 마이그레이션마다 앱이 깨진다."""
        for src in (INIT_SQL, APP_ROLE_SQL):
            assert re.search(
                r"ALTER DEFAULT PRIVILEGES IN SCHEMA public\s+"
                r"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES "
                r"TO weathermind_app",
                src,
            )
            assert re.search(
                r"ALTER DEFAULT PRIVILEGES IN SCHEMA public\s+"
                r"GRANT USAGE, SELECT ON SEQUENCES TO weathermind_app",
                src,
            )

    def test_소유권_이전_금지(self):
        """앱 롤은 테이블 비소유가 전제 — OWNER 변경 구문이 있으면 안 된다."""
        for src in (INIT_SQL, APP_ROLE_SQL):
            assert "OWNER TO weathermind_app" not in src


# ═══════════════════════════════════════════════════════════════
# 2. 앱 롤 예외 정책 — rls_app_role.sql 단독(테이블 생성 후에만 가능)
# ═══════════════════════════════════════════════════════════════


class Test예외정책범위:
    def test_예외는_정확히_2건(self):
        """users(FOR ALL — 인증 카탈로그)·league_results(FOR SELECT — 리더보드)."""
        policies = re.findall(
            r"CREATE POLICY (\w+) ON (\w+)\s*(FOR \w+)?\s*TO weathermind_app",
            APP_ROLE_SQL,
        )
        by_table = {t: (name, for_clause) for name, t, for_clause in policies}
        assert set(by_table) == EXEMPT_TABLES
        assert by_table["users"][0] == "app_auth_users"
        # league_results는 SELECT 한정 — 쓰기 격리(user_isolation WITH CHECK) 유지
        assert by_table["league_results"] == ("app_leaderboard_read", "FOR SELECT")

    def test_예외정책도_멱등(self):
        for name in ("app_auth_users", "app_leaderboard_read"):
            assert re.search(
                rf"IF NOT EXISTS \(SELECT FROM pg_policies\s+.*?"
                rf"policyname = '{name}'",
                APP_ROLE_SQL,
                flags=re.DOTALL,
            )

    def test_강제_9개_테이블에는_예외_없음(self):
        """USING (true)가 강제 대상 테이블에 붙으면 격리 무효 — 금지."""
        policies = re.findall(r"CREATE POLICY \w+ ON (\w+)", APP_ROLE_SQL)
        assert not (set(policies) & ENFORCED_TABLES)

    def test_기존_user_isolation_무접촉(self):
        """정책 재설계는 범위 밖(§7.0) — DROP/ALTER user_isolation 금지.
        (롤백 주석 포함 전문에서 검사한다.)"""
        assert "DROP POLICY IF EXISTS user_isolation" not in APP_ROLE_SQL
        assert not re.search(r"ALTER POLICY user_isolation", APP_ROLE_SQL)

    def test_강제_대상이_문서화되어_드리프트를_드러낸다(self):
        """새 RLS 테이블이 생기면 이 파일·SQL 주석 둘 다 갱신하게 강제한다."""
        for table in ENFORCED_TABLES:
            assert table in APP_ROLE_SQL, f"rls_app_role.sql 주석에 {table} 누락"

    def test_검증쿼리와_롤백_동봉(self):
        for marker in ("[V1]", "[V5]", "[V6]", "[V7]", "[V8]", "롤백"):
            assert marker in APP_ROLE_SQL


# ═══════════════════════════════════════════════════════════════
# 3. alembic env.py — 마이그레이션 소유자 롤 채널
# ═══════════════════════════════════════════════════════════════


class TestMigrationUrl:
    def test_env_직독_우선_settings_폴백(self):
        assert '_env_url = os.environ.get("MIGRATION_DATABASE_URL")' in ENV_PY
        assert "_env_url or settings.DATABASE_URL" in ENV_PY

    def test_configparser_보간_이스케이프(self):
        """비밀번호에 %-인코딩 문자가 와도 set_main_option이 깨지지 않는다."""
        assert 'replace("%", "%%")' in ENV_PY

    def test_placeholder_경고_env_직독_채널_한정(self):
        """env 직독 URL의 changeme는 BE-1 fail-fast 사각 — 경고 1줄로 메운다.
        경고는 env가 명시 설정된 경우만(dev 폴백 기본값에 소음 금지)."""
        assert re.search(
            r'if _env_url and "changeme" in _env_url:', ENV_PY
        )
        assert 'warning(' in ENV_PY

    def test_config_py_무접촉(self):
        """Settings(BE-1 소유)에 MIGRATION_DATABASE_URL 필드를 만들지 않는다."""
        config_src = (BACKEND / "app" / "core" / "config.py").read_text(
            encoding="utf-8"
        )
        assert "MIGRATION_DATABASE_URL" not in config_src


# ═══════════════════════════════════════════════════════════════
# 4. 런타임 GUC 주입 — get_db_with_rls 코드 경로 실측 (FakeDB 관례)
# ═══════════════════════════════════════════════════════════════


class _FakeTx:
    def __init__(self, session):
        self._s = session

    async def __aenter__(self):
        self._s.tx_open = True
        return self._s

    async def __aexit__(self, *exc):
        self._s.tx_open = False
        return False


class _FakeSession:
    """실행된 statement와 그 시점의 트랜잭션 상태를 수집한다."""

    def __init__(self):
        self.statements: list[tuple[str, dict | None, bool]] = []
        self.tx_open = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def begin(self):
        return _FakeTx(self)

    async def execute(self, stmt, params=None):
        self.statements.append((str(stmt), params, self.tx_open))


class TestGUC주입:
    def _run(self):
        from app.core import dependencies

        fake = _FakeSession()
        original = dependencies.async_session
        dependencies.async_session = lambda: fake
        try:
            user = type("U", (), {"id": uuid.uuid4()})()

            async def drive():
                agen = dependencies.get_db_with_rls(user=user)
                session = await agen.__anext__()  # GUC 주입 후 yield
                await agen.aclose()
                return session

            session = asyncio.run(drive())
        finally:
            dependencies.async_session = original
        return user, fake, session

    def test_요청마다_set_config_트랜잭션_스코프(self):
        """yield 이전에 set_config(app.current_user_id, uid, is_local=true)가
        열린 트랜잭션 안(SET LOCAL 의미)에서 실행된다 — 앱 롤 전환의 전제."""
        user, fake, session = self._run()
        assert session is fake
        assert len(fake.statements) == 1
        sql, params, tx_open = fake.statements[0]
        assert "set_config('app.current_user_id', :uid, true)" in sql
        assert params == {"uid": str(user.id)}
        assert tx_open, "트랜잭션 밖 SET은 세션 스코프 — 커넥션 풀 오염"
