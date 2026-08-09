"""예보 대결 정산 백필 — CO-Q-7 (2026-08-09).

종전 `settle_daily_duel`은 `today - 1` **하루만** 봤다. 재시도 2회(1시간 간격)가 다
실패하면 그날치는 `actual IS NULL`로 **영구히** 남는다 — KMA 지연·배치 실패·컨테이너
사망 중 무엇이든 하루를 놓치면 그 대결들은 사용자에게 "정산 안 됨"으로 굳는다.
8/11~18 실운영 로그가 이 결함으로 오염되면 8/18 재보정의 입력까지 흔들린다.

여기서 무는 것은 셋이다:
1. 미정산 대상일을 **오래된 순으로 전부** 훑는가
2. **어제분 실패만** 재시도하는가 — 오래된 날짜의 결손을 재시도로 붙들면 그 사이
   어제 정산까지 막힌다
3. 창(`DUEL_BACKFILL_DAYS`) 밖은 안 건드리는가
"""
from datetime import date, timedelta

import pytest

from app.tasks import league as league_task


class FakeConn:
    """`SELECT DISTINCT duel_date` 한 건만 답하는 최소 대역.

    하루 처리(`_settle_one_day`)는 별도로 대역해 갈아끼우므로, 여기서는 백필이
    **어떤 날짜 목록을 만들어 내는가**만 관측한다.
    """

    def __init__(self, pending):
        self._pending = pending
        self.params = None

    def execute(self, _stmt, params=None):
        self.params = params
        return self

    def fetchall(self):
        return [(d,) for d in self._pending]


class FakeEngine:
    def __init__(self, pending):
        self.conn = FakeConn(pending)

    def begin(self):
        engine_conn = self.conn

        class _Ctx:
            def __enter__(self):
                return engine_conn

            def __exit__(self, *_exc):
                return False

        return _Ctx()


class RetrySignal(Exception):
    """`self.retry()`가 호출됐다는 관측 신호.

    `bind=True` 태스크는 self를 celery가 주입하므로 대역 self를 넘길 수 없다.
    대신 태스크 객체의 `retry`를 갈아끼워 호출 자체를 예외로 드러낸다.
    """


@pytest.fixture
def today():
    return date(2026, 8, 9)


@pytest.fixture
def wired(monkeypatch, today):
    """엔진·날짜·하루처리를 대역으로 갈아끼우고 호출 기록을 돌려준다."""
    calls: list[date] = []

    def _install(pending, settle):
        # 엔진은 **한 개**를 고정한다 — 매 호출 새로 만들면 테스트가 관측하는 엔진과
        # 태스크가 쓴 엔진이 달라져 조회 파라미터를 볼 수 없다.
        engine = FakeEngine(pending)
        monkeypatch.setattr(league_task, "get_engine", lambda: engine)

        class _FakeDatetime:
            @staticmethod
            def now(_tz):
                class _D:
                    @staticmethod
                    def date():
                        return today

                return _D()

        monkeypatch.setattr(league_task, "datetime", _FakeDatetime)

        def _settle(_engine, day):
            calls.append(day)
            return settle(day)

        monkeypatch.setattr(league_task, "_settle_one_day", _settle)

        def _retry(countdown=None):
            raise RetrySignal(countdown)

        monkeypatch.setattr(league_task.settle_daily_duel, "retry", _retry)
        return calls, engine

    return _install


def _ok(day):
    return {"duel_date": str(day), "settled": 1, "wins": 1}


class TestBackfillScansEveryPendingDay:
    def test_어제만이_아니라_미정산_전건을_훑는다(self, wired, today):
        pending = [today - timedelta(days=n) for n in (3, 2, 1)]
        calls, _ = wired(pending, _ok)
        result = league_task.settle_daily_duel()
        assert calls == pending, "미정산 대상일을 오래된 순으로 전부 처리해야 한다"
        assert result["settled"] == 3

    def test_대상이_없으면_조용히_끝난다(self, wired, today):
        wired([], _ok)
        result = league_task.settle_daily_duel()
        assert result["settled"] == 0

    def test_조회_창이_DUEL_BACKFILL_DAYS다(self, wired, today):
        """창 밖의 아주 오래된 결손을 매일 다시 긁지 않는다."""
        _, engine = wired([], _ok)
        league_task.settle_daily_duel()
        params = engine.conn.params
        assert params["yesterday"] == today - timedelta(days=1)
        assert params["floor"] == today - timedelta(
            days=league_task.DUEL_BACKFILL_DAYS
        )


class TestRetryIsScopedToYesterday:
    def test_어제분_실패는_재시도한다(self, wired, today):
        yesterday = today - timedelta(days=1)
        wired([yesterday], lambda day: None)
        with pytest.raises(RetrySignal):
            league_task.settle_daily_duel()

    def test_오래된_날짜_결손은_재시도하지_않고_넘어간다(self, wired, today):
        """결손을 재시도로 붙들면 그 사이 어제 정산까지 막힌다."""
        old = today - timedelta(days=4)
        yesterday = today - timedelta(days=1)
        wired([old, yesterday], lambda day: None if day == old else _ok(day))
        result = league_task.settle_daily_duel()
        assert result["settled"] == 1, "오래된 결손을 건너뛰고 어제분은 정산해야 한다"
