"""league_results 주 1회 제약 — CO-R-4 (마이그레이션 0013, 2026-08-09).

`POST /league/predict`가 **SELECT → 없으면 INSERT**로 주 1회를 지켜 왔다. 그 사이에
DB 제약이 없어서 같은 유저의 두 요청이 겹치면 둘 다 "없음"을 보고 둘 다 INSERT한다.

중복 행은 단순 오염이 아니다 — `_ranked_leaderboard`가 주간 순위를 이 표의 행으로
세우므로 **한 유저가 순위표에 두 번 뜨고**, 분반(`LEAGUE_DIVISION_SIZE` 슬라이싱)이
밀려 다른 사람들의 소속까지 바뀐다. 그래서 모델·마이그레이션·라우터 세 곳을 함께 문다:
제약이 있어도 라우터가 500을 내면 사용자는 자기 예측이 들어갔는지 알 수 없다.
"""
import re
from pathlib import Path

from sqlalchemy import UniqueConstraint

from app.models.league_result import LeagueResult

VERSIONS_DIR = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MIGRATION = VERSIONS_DIR / "20260809_0013_league_result_unique.py"
LEAGUE_ROUTER = (
    Path(__file__).resolve().parents[1] / "app" / "routers" / "league.py"
).read_text(encoding="utf-8")
CONSTRAINT = "uq_league_results_user_week"


class TestModelDeclaresConstraint:
    def test_모델에_UNIQUE가_선언돼_있다(self):
        uniques = [
            c
            for c in LeagueResult.__table__.constraints
            if isinstance(c, UniqueConstraint)
        ]
        assert any(
            {col.name for col in c.columns} == {"user_id", "week_start"}
            for c in uniques
        ), "모델이 (user_id, week_start) UNIQUE를 선언하지 않는다"

    def test_제약_이름이_마이그레이션과_같다(self):
        """이름이 갈리면 downgrade가 존재하지 않는 제약을 드롭하려 든다."""
        names = {
            c.name
            for c in LeagueResult.__table__.constraints
            if isinstance(c, UniqueConstraint)
        }
        assert CONSTRAINT in names
        assert CONSTRAINT in MIGRATION.read_text(encoding="utf-8")


class TestMigrationIsReversible:
    def test_upgrade와_downgrade가_짝을_이룬다(self):
        src = MIGRATION.read_text(encoding="utf-8")
        assert re.search(r"def upgrade\(\).*create_unique_constraint", src, re.S)
        assert re.search(r"def downgrade\(\).*drop_constraint", src, re.S)

    def test_0012_위에_얹힌다(self):
        src = MIGRATION.read_text(encoding="utf-8")
        assert 'down_revision: Union[str, None] = "0012_two_axis_levels"' in src


class TestRouterTranslatesRaceToSameAnswer:
    """경합에서 진 쪽도 **409 ALREADY_SUBMITTED**를 받아야 한다.

    제약만 걸고 라우터를 안 고치면 IntegrityError가 500으로 새어 나간다. 그러면
    사용자는 "이미 제출됨"과 "서버 오류"를 구분하지 못하는데, 실제 상태는 전자다.
    """

    def test_IntegrityError를_409로_번역한다(self):
        assert "IntegrityError" in LEAGUE_ROUTER
        block = re.search(
            r"try:\s*\n\s*await db\.flush\(\)\s*\n\s*except IntegrityError:(.*?)\n\n",
            LEAGUE_ROUTER,
            re.S,
        )
        assert block, "predict의 flush가 IntegrityError를 잡지 않는다"
        assert "ALREADY_SUBMITTED" in block.group(1)
        assert "HTTP_409_CONFLICT" in block.group(1)

    def test_rollback을_먼저_한다(self):
        """롤백 없이 예외를 던지면 세션이 오염된 채 의존성 정리로 넘어간다."""
        block = re.search(
            r"except IntegrityError:(.*?)raise HTTPException", LEAGUE_ROUTER, re.S
        )
        assert block and "rollback" in block.group(1)
