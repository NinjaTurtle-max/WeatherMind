"""GET /duel/briefing 계약 테스트 — 스프린트 R9-01 §3.1 ② (S1).

순수 함수(briefing_hourly·split_daily_observations)와 라우터 폴백 경로를
DB·네트워크 없이 고정한다 (test_review_fix_regressions.py의 unwrap 관례):
- hourly: 제출일+대상일 슬롯만, KMA 카테고리 소문자 키, 비숫자 값은 None
- recent_days: 오늘 이전 행만, 날짜 오름차순, ≤7건(계약 상한)
- today_observed: 오늘 행이 없으면 None (ASOS 일자료는 보통 D+1 공표)
- 라우터: 날씨 {}·과거관측 KMAApiError여도 200 형태 유지(필드만 null/빈 배열)
"""
import asyncio
import inspect
import uuid
from datetime import date, timedelta
from types import SimpleNamespace

from app.routers import duel as duel_router
from app.services.duel_service import (
    BRIEFING_RECENT_DAYS_MAX,
    briefing_hourly,
    split_daily_observations,
)
from app.services.weather_api import KMAApiError

TODAY = date(2026, 7, 29)
TARGET = date(2026, 7, 30)


class TestBriefingHourly:
    WEATHER = {
        "region": "서울",
        "forecasts": [
            {"datetime": "202607281500", "TMP": 30.0, "POP": 20.0},  # 범위 밖(그제)
            {
                "datetime": "202607290900",
                "TMP": 27.0, "POP": 30.0, "PCP": 0.0, "REH": 70.0,
                "WSD": 2.5, "SKY": 3.0, "PTY": 0.0,
            },
            {"datetime": "202607301200", "TMP": 29.0, "POP": 60.0, "PCP": "1mm 미만"},
        ],
    }

    def test_제출일_대상일_슬롯만_소문자_키로(self):
        hours = briefing_hourly(self.WEATHER, (TODAY, TARGET))
        assert [h["datetime"] for h in hours] == ["202607290900", "202607301200"]
        first = hours[0]
        assert first["tmp"] == 27.0
        assert first["pop"] == 30.0
        assert first["reh"] == 70.0
        assert first["wsd"] == 2.5
        assert first["sky"] == 3.0
        assert first["pty"] == 0.0

    def test_비숫자_값은_None(self):
        """PCP '1mm 미만' 같은 비숫자 문자열(parse_kma_value 원본 유지분)은 null."""
        hours = briefing_hourly(self.WEATHER, (TODAY, TARGET))
        assert hours[1]["pcp"] is None

    def test_카테고리_결측은_None(self):
        hours = briefing_hourly(self.WEATHER, (TODAY, TARGET))
        assert hours[1]["reh"] is None

    def test_빈_날씨는_빈_리스트(self):
        assert briefing_hourly({}, (TODAY, TARGET)) == []
        assert briefing_hourly({"forecasts": []}, (TODAY, TARGET)) == []


class TestSplitDailyObservations:
    def _rows(self, days: int) -> list[dict]:
        return [
            {
                "tm": (TODAY - timedelta(days=i)).isoformat(),
                "avgTa": 26.0,
                "maxTa": 30.0 + i,
                "minTa": 22.0,
                "sumRn": 0.0 if i % 2 else 5.5,
            }
            for i in range(days, 0, -1)
        ]

    def test_recent_days_오름차순_필드_추출(self):
        today_observed, recent = split_daily_observations(self._rows(3), TODAY)
        assert today_observed is None  # 오늘 행 없음(D+1 공표)
        assert [r["date"] for r in recent] == [
            (TODAY - timedelta(days=i)).isoformat() for i in (3, 2, 1)
        ]
        assert recent[-1] == {"date": "2026-07-28", "max_ta": 31.0, "sum_rn": 0.0}

    def test_recent_days_7건_상한(self):
        _, recent = split_daily_observations(self._rows(10), TODAY)
        assert len(recent) == BRIEFING_RECENT_DAYS_MAX == 7
        # 최근 7일이 남는다 (가장 오래된 3일이 잘림)
        assert recent[0]["date"] == (TODAY - timedelta(days=7)).isoformat()

    def test_오늘_행이_있으면_today_observed(self):
        rows = self._rows(2) + [
            {"tm": TODAY.isoformat(), "maxTa": 33.0, "minTa": 24.0, "sumRn": "결측"}
        ]
        today_observed, recent = split_daily_observations(rows, TODAY)
        assert today_observed == {"max_ta": 33.0, "min_ta": 24.0, "sum_rn": None}
        assert len(recent) == 2  # 오늘 행은 recent에 중복 편입되지 않음

    def test_빈_입력(self):
        assert split_daily_observations([], TODAY) == (None, [])


class TestBriefingRoute:
    """라우터 폴백 — 날씨·과거관측이 모두 실패해도 200 형태(빈/None) 유지."""

    def _call(self, monkeypatch, weather, rows):
        async def fake_weather(*args, **kwargs):
            return weather

        async def fake_obs(*args, **kwargs):
            if isinstance(rows, Exception):
                raise rows
            return rows

        monkeypatch.setattr(duel_router, "get_today_weather", fake_weather)
        monkeypatch.setattr(duel_router, "get_past_observation", fake_obs)
        endpoint = inspect.unwrap(duel_router.get_duel_briefing)
        return asyncio.run(
            endpoint(request=SimpleNamespace(), user=SimpleNamespace(id=uuid.uuid4()))
        )

    def test_전부_실패해도_형태_유지(self, monkeypatch):
        res = self._call(monkeypatch, {}, KMAApiError("키 부재"))
        assert res.region == "서울"
        assert res.target_date == duel_router._duel_target_date()
        assert res.hourly == []
        assert res.today_observed is None
        assert res.recent_days == []

    def test_정상_경로_대상일_슬롯_포함(self, monkeypatch):
        target = duel_router._duel_target_date()
        weather = {
            "region": "서울",
            "forecasts": [
                {"datetime": target.strftime("%Y%m%d") + "0900", "TMP": 28.0, "POP": 40.0}
            ],
        }
        yesterday = target - timedelta(days=2)
        rows = [{"tm": yesterday.isoformat(), "maxTa": 31.5, "minTa": 23.0, "sumRn": 12.0}]
        res = self._call(monkeypatch, weather, rows)
        assert res.hourly[0].tmp == 28.0
        assert res.hourly[0].pop == 40.0
        assert res.recent_days[0].max_ta == 31.5
        assert res.recent_days[0].sum_rn == 12.0
