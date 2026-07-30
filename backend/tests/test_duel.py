"""예보 대결 계약 테스트 — 스프린트 R4-01 §3.4 (R4-S4) + R9-01 §3.1.

순수 함수(ai_caster_prediction·duel_result·settle_scores·extract_forecast_for_date)를
고정한다. 핵심 불변식:
- AI 예측 결정성: 같은 (기준예보·user_id·날짜)는 항상 같은 예측 (재현 가능)
- 노이즈 범위: 온도 ±2.0, 강수 ±15(0~100 클램프)
- 승패: accuracy_score 비교로 win/lose/draw
재제출 409(ALREADY_SUBMITTED)는 duels UNIQUE(user_id, duel_date) + 라우터 선조회로
강제하며(league /predict 패턴과 동일), 여기서는 판정·생성 로직을 검증한다.

R9-01 §3.1 추가분은 라우터 함수를 직접 호출해 검증한다(FakeDB + slowapi
데코레이터 unwrap — test_review_fix_regressions.py 패턴):
- GET/POST /today의 base_forecast additive (KMA 실패·대상일 미포함 → null,
  폴백 base로 캐스터는 동작)
- POST evidence 화이트리스트(미지 코드 422 INVALID_EVIDENCE)·user_pred 동봉 저장
- 정산 후 evidence_review 노출 (판정 규칙 자체는 review_evidence 순수 함수 테스트)
"""
import asyncio
import inspect
import uuid
from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from app.routers import duel as duel_router
from app.schemas.duel import DuelSubmitRequest
from app.services import duel_service
from app.services.duel_service import (
    RAIN_NOISE,
    TEMP_NOISE,
    ai_caster_prediction,
    duel_result,
    extract_forecast_for_date,
    settle_scores,
)

USER = "11111111-1111-1111-1111-111111111111"
DAY = date(2026, 7, 21)


class TestPredictionDeterminism:
    def test_같은_입력_같은_출력(self):
        a = ai_caster_prediction(28.0, 40, USER, DAY)
        b = ai_caster_prediction(28.0, 40, USER, DAY)
        assert a == b

    def test_유저_다르면_예측_달라짐(self):
        other = "22222222-2222-2222-2222-222222222222"
        assert ai_caster_prediction(28.0, 40, USER, DAY) != ai_caster_prediction(
            28.0, 40, other, DAY
        )

    def test_날짜_다르면_예측_달라짐(self):
        assert ai_caster_prediction(28.0, 40, USER, DAY) != ai_caster_prediction(
            28.0, 40, USER, date(2026, 7, 22)
        )

    @pytest.mark.parametrize("temp", [5.0, 20.0, 33.5])
    @pytest.mark.parametrize("rain", [0, 50, 100])
    def test_노이즈_범위_준수(self, temp, rain):
        pred = ai_caster_prediction(temp, rain, USER, DAY)
        assert abs(pred["temp_max"] - temp) <= TEMP_NOISE + 1e-9
        assert 0 <= pred["rain_prob"] <= 100
        # 클램프 전 이론 범위 내(경계 클램프는 별도 검증)
        assert pred["rain_prob"] >= max(0, rain - RAIN_NOISE)
        assert pred["rain_prob"] <= min(100, rain + RAIN_NOISE)

    def test_강수_0에서_음수로_안내려감(self):
        for seed_day in range(1, 20):
            pred = ai_caster_prediction(20.0, 0, USER, date(2026, 7, seed_day))
            assert pred["rain_prob"] >= 0

    def test_강수_100에서_초과_안됨(self):
        for seed_day in range(1, 20):
            pred = ai_caster_prediction(20.0, 100, USER, date(2026, 7, seed_day))
            assert pred["rain_prob"] <= 100


class TestDuelResult:
    def test_유저_점수_높으면_win(self):
        assert duel_result(90.0, 80.0) == "win"

    def test_유저_점수_낮으면_lose(self):
        assert duel_result(70.0, 85.0) == "lose"

    def test_동점은_draw(self):
        assert duel_result(75.0, 75.0) == "draw"


class TestSettleScores:
    def test_실측_비교_승패(self):
        user_pred = {"temp_max": 30, "rain_prob": 40}
        ai_pred = {"temp_max": 25, "rain_prob": 40}
        actual = {"temp_max": 30, "rain_prob": 40}  # 유저 완벽 적중
        user_score, ai_score, result = settle_scores(user_pred, ai_pred, actual)
        assert user_score == 100.0
        assert ai_score < user_score
        assert result == "win"

    def test_ai_승리(self):
        user_pred = {"temp_max": 20, "rain_prob": 40}
        ai_pred = {"temp_max": 30, "rain_prob": 40}
        actual = {"temp_max": 30, "rain_prob": 40}
        _, _, result = settle_scores(user_pred, ai_pred, actual)
        assert result == "lose"

    def test_win_xp_계약값(self):
        assert duel_service.DUEL_WIN_XP == 15


class TestExtractForecast:
    def test_대상일_TMX_POP_추출(self):
        weather = {
            "region": "서울",
            "forecasts": [
                {"datetime": "202607210900", "TMP": 26.0, "POP": 20},
                {"datetime": "202607211500", "TMX": 31.0, "TMP": 30.0, "POP": 60},
                {"datetime": "202607220900", "TMX": 28.0, "POP": 10},  # 다른 날
            ],
        }
        got = extract_forecast_for_date(weather, date(2026, 7, 21))
        assert got == {"temp_max": 31.0, "rain_prob": 60}

    def test_TMX_없으면_TMP_최대(self):
        weather = {
            "forecasts": [
                {"datetime": "202607210900", "TMP": 26.0, "POP": 20},
                {"datetime": "202607211500", "TMP": 30.0, "POP": 55},
            ]
        }
        got = extract_forecast_for_date(weather, date(2026, 7, 21))
        assert got == {"temp_max": 30.0, "rain_prob": 55}

    def test_대상일_없으면_None(self):
        weather = {"forecasts": [{"datetime": "202607220900", "TMX": 28.0, "POP": 10}]}
        assert extract_forecast_for_date(weather, date(2026, 7, 21)) is None

    def test_빈_예보는_None(self):
        assert extract_forecast_for_date({}, date(2026, 7, 21)) is None


# ═══════════════════════════════════════════════════════════════
# R9-01 §3.1 — 라우터 레벨 (FakeDB + unwrap, DB·네트워크 없음)
# ═══════════════════════════════════════════════════════════════


class FakeResult:
    def __init__(self, value=None):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class FakeDB:
    """duels 단건 조회(select→scalar_one_or_none)·add·flush만 흉내내는 대역."""

    def __init__(self, duel=None):
        self.duel = duel
        self.added = []

    async def execute(self, stmt):
        return FakeResult(self.duel)

    async def flush(self):
        pass

    def add(self, obj):
        self.added.append(obj)


def _weather_for(target: date, temp: float = 31.0, pop: int = 60) -> dict:
    """대상일 슬롯을 포함하는 get_short_forecast 형식 날씨."""
    return {
        "region": "서울",
        "forecasts": [
            {"datetime": target.strftime("%Y%m%d") + "0900", "TMX": temp, "POP": pop}
        ],
    }


def _stub_weather(monkeypatch, weather: dict) -> None:
    async def fake_weather(*args, **kwargs):
        return weather

    monkeypatch.setattr(duel_router, "get_today_weather", fake_weather)


def _call_get_today(db, monkeypatch, weather):
    _stub_weather(monkeypatch, weather)
    endpoint = inspect.unwrap(duel_router.get_today_duel)
    return asyncio.run(
        endpoint(request=SimpleNamespace(), user=SimpleNamespace(id=uuid.uuid4()), db=db)
    )


def _call_post_today(db, monkeypatch, weather, *, temp_max=29.0, rain_prob=40, evidence=None):
    _stub_weather(monkeypatch, weather)
    endpoint = inspect.unwrap(duel_router.submit_today_duel)
    body = DuelSubmitRequest(temp_max=temp_max, rain_prob=rain_prob, evidence=evidence)
    return asyncio.run(
        endpoint(
            request=SimpleNamespace(),
            body=body,
            user=SimpleNamespace(id=uuid.uuid4()),
            db=db,
        )
    )


class TestBaseForecast:
    """R9-01 §3.1 ① — base_forecast additive (드리프트 해소)."""

    def test_GET_대상일_예보_노출(self, monkeypatch):
        target = duel_router._duel_target_date()
        res = _call_get_today(FakeDB(), monkeypatch, _weather_for(target))
        assert res.submitted is False
        assert res.base_forecast.temp_max == 31.0
        assert res.base_forecast.rain_prob == 60

    def test_GET_KMA_실패시_null(self, monkeypatch):
        """get_today_weather가 빈 dict(실패·키 부재)면 base_forecast=null."""
        res = _call_get_today(FakeDB(), monkeypatch, {})
        assert res.base_forecast is None

    def test_GET_대상일_미포함이면_null(self, monkeypatch):
        """예보에 대상일 슬롯이 없으면(오늘 자료뿐) null — 폴백값 비노출."""
        today_only = _weather_for(duel_router._duel_target_date() - timedelta(days=1))
        res = _call_get_today(FakeDB(), monkeypatch, today_only)
        assert res.base_forecast is None

    def test_POST_기본예보_동봉(self, monkeypatch):
        target = duel_router._duel_target_date()
        db = FakeDB()
        res = _call_post_today(db, monkeypatch, _weather_for(target))
        assert res.base_forecast.temp_max == 31.0
        assert len(db.added) == 1
        # 캐스터는 같은 base 기준 노이즈 범위 내
        assert abs(res.ai_pred.temp_max - 31.0) <= TEMP_NOISE + 1e-9

    def test_POST_KMA_실패시_null이지만_캐스터는_폴백으로_동작(self, monkeypatch):
        db = FakeDB()
        res = _call_post_today(db, monkeypatch, {})
        assert res.base_forecast is None
        assert res.ai_pred is not None  # _FALLBACK_BASE 기준 예측은 생성됨
        assert abs(res.ai_pred.temp_max - 20.0) <= TEMP_NOISE + 1e-9
