"""리더보드 기본 주 — R13 4일차 CO-R-1 회귀 테스트.

**결함**: 조회 기본 주가 `_current_week_start()`(**이번 주**)인데 정산 대상은
`_last_week_start()`(**지난주**)라 **겹치는 시점이 없었다.** `?week=`를 넘기는
호출자도 저장소 전체 0건. 결과적으로 리더보드 전 행이 accuracy·elo·tier 전부
NULL이 되고, 정렬의 `nulls_last` 3단이 무의미해져 §2.8이 **동점자 결정성 장치로**
넣어 둔 최종 타이브레이크(user_id)가 **유일한 정렬 키로 승격** — 화면의 🥇🥈🥉가
UUID 사전순으로 갔다.

**수리 범위**: 기본 주 **한 곳**만 고친다. 정렬 자체(`nulls_last` 3단 + user_id
최종 키)는 §2.8 분반 결정성 계약이라 건드리지 않는다.

**기본 주 = 정산이 실제로 존재하는 가장 최근 주**(`MAX(week_start)` where
accuracy_score IS NOT NULL). "이번 주 − 7일" 고정 오프셋을 쓰지 않은 이유는
_default_ranked_week 독스트링에 있다(정산 유실 주·배포 첫 주·심사 데모).

실행: backend 디렉토리에서 `python -m pytest tests/test_league_leaderboard_week.py -q`.
"""
import asyncio
import inspect
import uuid
from datetime import date
from types import SimpleNamespace

import pytest

from app.routers import league as league_router
from app.routers.league import _default_ranked_week, _latest_settled_week

SETTLED_WEEK = date(2026, 7, 27)   # 정산이 끝난 주
UNSETTLED_WEEK = date(2026, 8, 3)  # 제출만 쌓인 이번 주


def _row(nickname, accuracy, elo, tier, user_id=None):
    """_ranked_leaderboard가 읽는 5튜플 (user_id, nickname, accuracy, elo, tier)."""
    return (user_id or uuid.uuid4(), nickname, accuracy, elo, tier)


class _Result:
    def __init__(self, rows=(), scalar=None):
        self._rows = list(rows)
        self._scalar = scalar

    def all(self):
        return self._rows

    def scalar_one_or_none(self):
        return self._scalar


class _FakeDB:
    """주별 리그 행을 담은 최소 AsyncSession 대역.

    `MAX(...)` 집계면 정산된 최근 주를, 그 외에는 바인딩된 주의 행을 돌려준다.
    (백엔드 테스트에 라이브 DB 하네스가 없어 라우터를 이 대역으로 돈다.)
    """

    def __init__(self, rows_by_week: dict[date, list[tuple]]):
        self.rows_by_week = rows_by_week
        self.queried_weeks: list[date] = []

    def _latest(self) -> date | None:
        settled = [
            week
            for week, rows in self.rows_by_week.items()
            if any(r[2] is not None for r in rows)
        ]
        return max(settled) if settled else None

    async def execute(self, stmt):
        compiled = stmt.compile()
        if "max(" in str(compiled).lower():
            return _Result(scalar=self._latest())
        week = next(
            (v for v in compiled.params.values() if isinstance(v, date)), None
        )
        self.queried_weeks.append(week)
        return _Result(rows=self.rows_by_week.get(week, []))


def _db_two_weeks() -> _FakeDB:
    """지난주는 정산 완료, 이번 주는 제출만(전건 NULL) — 실제 운영 형상."""
    return _FakeDB(
        {
            SETTLED_WEEK: [
                _row("나중이", 61.0, 1188, "cumulus"),
                _row("먼저맞힌이", 93.5, 1214, "cumulus"),
            ],
            UNSETTLED_WEEK: [
                _row("가나다", None, None, None),
                _row("하파타", None, None, None),
            ],
        }
    )


def _leaderboard(db, week=None):
    endpoint = inspect.unwrap(league_router.get_leaderboard)
    return asyncio.run(
        endpoint(
            request=SimpleNamespace(),
            week=week,
            user=SimpleNamespace(id=uuid.uuid4()),
            db=db,
        )
    )


class TestLatestSettledWeek:
    def test_정산된_최근_주를_고른다(self):
        db = _db_two_weeks()
        assert asyncio.run(_latest_settled_week(db)) == SETTLED_WEEK

    def test_정산_이력이_없으면_None(self):
        db = _FakeDB({UNSETTLED_WEEK: [_row("가나다", None, None, None)]})
        assert asyncio.run(_latest_settled_week(db)) is None


class TestDefaultWeekResolution:
    def test_기본은_정산된_주이지_이번_주가_아니다(self):
        db = _db_two_weeks()
        got = asyncio.run(_default_ranked_week(db, None))
        assert got == SETTLED_WEEK
        assert got != league_router._current_week_start()

    def test_명시한_주가_최우선(self):
        db = _db_two_weeks()
        assert asyncio.run(_default_ranked_week(db, UNSETTLED_WEEK)) == UNSETTLED_WEEK

    def test_정산_이력_0이면_이번_주로_떨어진다(self):
        """빈 DB·배포 첫 주 — 종전처럼 참가자 목록이라도 보여 준다."""
        db = _FakeDB({})
        assert (
            asyncio.run(_default_ranked_week(db, None))
            == league_router._current_week_start()
        )


class TestLeaderboardReturnsSettledRows:
    """CO-R-1의 핵심 단정: **기본 주 조회가 정산된 행을 실제로 반환한다.**"""

    def test_기본_조회가_정산된_주를_읽는다(self):
        db = _db_two_weeks()
        _leaderboard(db)
        assert db.queried_weeks == [SETTLED_WEEK]

    def test_기본_조회_결과에_null_순위가_없다(self):
        ranks = _leaderboard(_db_two_weeks())
        assert ranks, "정산된 주가 있는데 리더보드가 비었다"
        for r in ranks:
            assert r.accuracy_score is not None
            assert r.elo_rating is not None
            assert r.tier is not None

    def test_정렬_기준이_정확도_ELO_user_id_순이다(self):
        """수리 전에는 기본 주가 전건 NULL이라 `nulls_last` 3단이 모두 동률로
        빠지고 **user_id 사전순이 사실상의 순위**였다(메달이 UUID가 작은 셋에게 갔다).

        정렬 자체는 DB가 수행하므로(`ORDER BY accuracy desc nulls_last, elo desc
        nulls_last, user_id asc`) 가짜 DB로는 재현할 수 없다 — 여기서는
        **정렬절이 실제로 그 세 키로 걸려 있는지를 소스에서** 단정한다.
        행이 정산된 값을 담는지는 `test_기본_조회_결과에_null_순위가_없다`가 본다.
        """
        src = inspect.getsource(league_router._ranked_leaderboard)
        order = src.split(".order_by(", 1)[1].split(")\n", 1)[0]
        assert "accuracy_score.desc().nulls_last()" in order
        assert "elo_rating_after.desc().nulls_last()" in order
        assert "user_id.asc()" in order
        # 정확도가 ELO보다, ELO가 user_id보다 앞선다(동점자 처리 순서)
        assert (
            order.index("accuracy_score")
            < order.index("elo_rating_after")
            < order.index("user_id")
        )

    def test_rank가_1부터_순차_부여된다(self):
        ranks = _leaderboard(_db_two_weeks())
        assert [r.rank for r in ranks] == [1, 2]

    def test_이번_주를_명시하면_여전히_볼_수_있다(self):
        db = _db_two_weeks()
        ranks = _leaderboard(db, week=UNSETTLED_WEEK)
        assert db.queried_weeks == [UNSETTLED_WEEK]
        assert all(r.accuracy_score is None for r in ranks)


class TestDivisionSharesTheSameDefault:
    """/division과 /leaderboard가 다른 주를 보면 "내 분반 N위"가 리더보드와 어긋난다."""

    def test_분반도_정산된_주를_기본으로_본다(self):
        db = _db_two_weeks()
        endpoint = inspect.unwrap(league_router.get_division)
        res = asyncio.run(
            endpoint(
                request=SimpleNamespace(),
                week=None,
                neighbors=3,
                user=SimpleNamespace(id=uuid.uuid4()),
                db=db,
            )
        )
        assert res.week_start == SETTLED_WEEK
        assert db.queried_weeks == [SETTLED_WEEK]


class TestSortContractUntouched:
    """§2.8 결정성 계약 — 정렬 키 구성은 CO-R-1 수리 범위 밖이다(리드5 정정 2)."""

    def test_최종_타이브레이크는_여전히_user_id다(self):
        src = inspect.getsource(league_router._ranked_leaderboard)
        assert "LeagueResult.user_id.asc()" in src
        assert "nulls_last()" in src


class TestLeagueRouterRateLimited:
    """리그 라우터 레이트리밋 0(duel은 있음) — CO-Q-6 덤으로 함께 닫았다."""

    @pytest.mark.parametrize(
        "name", ["submit_prediction", "get_leaderboard", "get_division", "get_my_results"]
    )
    def test_주요_엔드포인트에_리밋이_걸려_있다(self, name):
        endpoint = getattr(league_router, name)
        assert getattr(endpoint, "__wrapped__", None) is not None, (
            f"{name}에 레이트리밋 데코레이터가 없다"
        )
