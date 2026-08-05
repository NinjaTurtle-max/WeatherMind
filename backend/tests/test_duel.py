"""예보 대결 계약 테스트 — 스프린트 R4-01 §3.4 (R4-S4) + R9-01 §3.1 (R9-S1)·§3.2 (R9-S2).

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

적응형 캐스터(R9-01 §3.2): caster_noise_scale 티어 5계단 계약 수치,
noise_scale은 시드 불변·진폭에만 적용(기본값 1.0 하위 호환), POST 배선
(ELO 조달→scale→ai_pred JSONB 스냅샷→caster_grade 노출)을 고정한다.
승률 밸런스 시뮬은 test_duel_balance.py 별도.
"""
import asyncio
import inspect
import random
import uuid
from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.models.duel import Duel
from app.routers import duel as duel_router
from app.schemas.duel import DuelHistoryItem, DuelSubmitRequest
from app.services import duel_service, league_service
from app.services.duel_service import (
    CASTER_NOISE_SCALES,
    RAIN_NOISE,
    TEMP_NOISE,
    ai_caster_prediction,
    caster_grade,
    caster_noise_scale,
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

    def scalars(self):
        return self

    def all(self):
        return [self._value] if self._value is not None else []


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


# ═══════════════════════════════════════════════════════════════
# 적응형 캐스터 — R9-01 §3.2 (R9-S2)
# ═══════════════════════════════════════════════════════════════


class TestCasterNoiseScale:
    """caster_noise_scale/caster_grade — 티어 5계단 계약 수치 고정."""

    @pytest.mark.parametrize(
        "elo, expected_tier, expected_scale",
        [
            (None, "stratus", 1.00),   # 첫 참가(정산 이력 없음)
            (0, "stratus", 1.00),
            (1099, "stratus", 1.00),   # 경계 직전
            (1100, "cumulus", 0.85),   # 하한 포함(≥)
            (1249, "cumulus", 0.85),
            (1250, "nimbostratus", 0.70),
            (1399, "nimbostratus", 0.70),
            (1400, "cumulonimbus", 0.55),
            (1549, "cumulonimbus", 0.55),
            (1550, "typhoon_eye", 0.40),
            (2000, "typhoon_eye", 0.40),
        ],
    )
    def test_티어_5계단_계약수치(self, elo, expected_tier, expected_scale):
        assert caster_grade(elo) == expected_tier
        assert caster_noise_scale(elo) == expected_scale

    def test_배율표_키는_리그_티어와_일치(self):
        """티어 추가·개명 시 드리프트 감지 — TIER_THRESHOLDS 단일 소유(§3.2)."""
        assert set(CASTER_NOISE_SCALES) == set(league_service.TIER_ORDER)

    def test_배율은_티어_서열대로_단조_감소(self):
        scales = [CASTER_NOISE_SCALES[t] for t in league_service.TIER_ORDER]
        assert scales == sorted(scales, reverse=True)
        assert len(set(scales)) == len(scales)  # 계단마다 실제로 달라야 한다


class TestNoiseScaleDeterminism:
    """noise_scale — 시드 (user,date) 불변, 배율은 진폭에만 적용 (§3.2)."""

    def test_기본값_1은_기존_결과와_동일(self):
        """하위 호환 — noise_scale 미지정·1.0 명시가 같은 결과(기존 테스트 불변)."""
        assert ai_caster_prediction(28.0, 40, USER, DAY) == ai_caster_prediction(
            28.0, 40, USER, DAY, noise_scale=1.0
        )

    def test_같은_scale_같은_출력(self):
        a = ai_caster_prediction(28.0, 40, USER, DAY, noise_scale=0.55)
        b = ai_caster_prediction(28.0, 40, USER, DAY, noise_scale=0.55)
        assert a == b

    @pytest.mark.parametrize("scale", [0.85, 0.70, 0.55, 0.40])
    def test_배율은_같은_난수의_진폭에만_곱한다(self, scale):
        """시드 불변 화이트박스 — scale이 달라도 원시 난수 추출은 동일해야 한다."""
        rng = random.Random(duel_service._seed(USER, DAY))
        noise_t = rng.uniform(-TEMP_NOISE, TEMP_NOISE)
        noise_r = rng.uniform(-RAIN_NOISE, RAIN_NOISE)
        expected = {
            "temp_max": round(28.0 + noise_t * scale, 1),
            "rain_prob": max(0, min(100, round(40 + noise_r * scale))),
        }
        assert ai_caster_prediction(28.0, 40, USER, DAY, noise_scale=scale) == expected

    @pytest.mark.parametrize("scale", [1.0, 0.85, 0.70, 0.55, 0.40])
    def test_scale별_오차_범위(self, scale):
        """노이즈 범위가 ±TEMP_NOISE×scale / ±RAIN_NOISE×scale로 줄어든다."""
        for seed_day in range(1, 28):
            pred = ai_caster_prediction(
                25.0, 50, USER, date(2026, 8, seed_day), noise_scale=scale
            )
            assert abs(pred["temp_max"] - 25.0) <= TEMP_NOISE * scale + 0.05  # 반올림 여유
            assert abs(pred["rain_prob"] - 50) <= RAIN_NOISE * scale + 0.5

    def test_scale_0은_기준_예보_그대로(self):
        pred = ai_caster_prediction(28.3, 40, USER, DAY, noise_scale=0.0)
        assert pred == {"temp_max": 28.3, "rain_prob": 40}


# ═══════════════════════════════════════════════════════════════
# POST /duel/today 배선 — ELO 조달→scale→스냅샷→caster_grade (R9-01 §3.2)
# — limiter는 inspect.unwrap으로 우회 (test_crown_award 관례)
# ═══════════════════════════════════════════════════════════════


class _Result:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class DuelFakeDB:
    """submit_today_duel 배선 테스트용 — 기존 대결 없음, add/flush noop."""

    def __init__(self):
        self.added = []

    async def execute(self, stmt):
        return _Result(None)

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        pass


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


class TestEvidenceWhitelist:
    """R9-01 §3.1 ③ — 근거 코드 화이트리스트·저장·노출."""

    def test_계약_코드_5종_고정(self):
        assert duel_service.EVIDENCE_CODES == (
            "pop_trend", "humidity_high", "temp_drop", "sky_overcast", "recent_rain"
        )

    def test_미지_코드_422_INVALID_EVIDENCE(self, monkeypatch):
        with pytest.raises(HTTPException) as exc:
            _call_post_today(FakeDB(), monkeypatch, {}, evidence=["recent_rain", "bogus"])
        assert exc.value.status_code == 422
        assert exc.value.detail["code"] == "INVALID_EVIDENCE"

    def test_유효_근거_user_pred_동봉_저장_및_응답_노출(self, monkeypatch):
        db = FakeDB()
        res = _call_post_today(
            db, monkeypatch, {}, evidence=["pop_trend", "recent_rain"]
        )
        assert res.evidence == ["pop_trend", "recent_rain"]
        assert res.evidence_review is None  # 미정산 — 해설은 정산 후에만
        stored = db.added[0].user_pred
        assert stored["evidence"] == ["pop_trend", "recent_rain"]
        assert stored["temp_max"] == 29.0  # 기존 채점 키는 그대로 (celery 정산 호환)

    def test_중복은_순서_보존_제거(self, monkeypatch):
        res = _call_post_today(
            FakeDB(), monkeypatch, {}, evidence=["recent_rain", "recent_rain", "pop_trend"]
        )
        assert res.evidence == ["recent_rain", "pop_trend"]

    def test_빈_리스트는_미선택으로_정규화(self, monkeypatch):
        db = FakeDB()
        res = _call_post_today(db, monkeypatch, {}, evidence=[])
        assert res.evidence is None
        assert "evidence" not in db.added[0].user_pred

    def test_temp_drop_기준기온_스냅샷_저장(self, monkeypatch):
        today = duel_router._duel_target_date() - timedelta(days=1)
        weather = {
            "region": "서울",
            "forecasts": [
                {"datetime": today.strftime("%Y%m%d") + "1200", "TMX": 30.0, "POP": 10}
            ],
        }
        db = FakeDB()
        _call_post_today(db, monkeypatch, weather, evidence=["temp_drop"])
        assert db.added[0].user_pred["evidence_ctx"] == {"today_temp_max": 30.0}

    def test_temp_drop_KMA_실패시_기준_None_스냅샷(self, monkeypatch):
        db = FakeDB()
        _call_post_today(db, monkeypatch, {}, evidence=["temp_drop"])
        assert db.added[0].user_pred["evidence_ctx"] == {"today_temp_max": None}


def _settled_duel(evidence, actual, ctx=None):
    user_pred = {"temp_max": 28.0, "rain_prob": 70, "evidence": evidence}
    if ctx is not None:
        user_pred["evidence_ctx"] = ctx
    return Duel(
        id=uuid.uuid4(),  # 실DB에선 server_default — 이력 스키마 검증용으로 채움
        user_id=uuid.uuid4(),
        duel_date=duel_router._duel_target_date(),
        user_pred=user_pred,
        ai_pred={"temp_max": 27.5, "rain_prob": 55},
        actual=actual,
        user_score=90.0,
        ai_score=80.0,
        result="win",
    )


class TestEvidenceReviewExposure:
    """R9-01 §3.1 ④ — 정산 후 GET/today·history에 evidence_review 노출."""

    RAINED = {"temp_max": 27.0, "rain_prob": 100.0}

    def test_GET_정산후_적중_해설(self, monkeypatch):
        duel = _settled_duel(["recent_rain"], self.RAINED)
        res = _call_get_today(FakeDB(duel=duel), monkeypatch, {})
        assert res.evidence == ["recent_rain"]
        (review,) = res.evidence_review
        assert review.code == "recent_rain"
        assert review.hit is True
        assert review.note

    def test_history_노출(self, monkeypatch):
        duel = _settled_duel(["sky_overcast"], {"temp_max": 27.0, "rain_prob": 0.0})
        endpoint = inspect.unwrap(duel_router.get_duel_history)
        (item,) = asyncio.run(
            endpoint(user=SimpleNamespace(id=duel.user_id), db=FakeDB(duel=duel))
        )
        assert item.evidence == ["sky_overcast"]
        assert item.evidence_review[0].hit is False

    def test_근거_없는_이력은_null(self, monkeypatch):
        duel = _settled_duel(None, self.RAINED)
        duel.user_pred = {"temp_max": 28.0, "rain_prob": 70}
        res = _call_get_today(FakeDB(duel=duel), monkeypatch, {})
        assert res.evidence is None
        assert res.evidence_review is None


class TestReviewEvidenceRules:
    """review_evidence 판정 규칙 — 전 코드별, 결정적 순수 함수 (R9-01 §3.1 ④)."""

    RAINED = {"temp_max": 27.0, "rain_prob": 100.0}
    DRY = {"temp_max": 27.0, "rain_prob": 0.0}

    @pytest.mark.parametrize(
        "code", ["pop_trend", "humidity_high", "sky_overcast", "recent_rain"]
    )
    def test_강수신호_실측_강수시_적중(self, code):
        pred = {"temp_max": 28.0, "rain_prob": 70, "evidence": [code]}
        (review,) = duel_service.review_evidence(pred, self.RAINED)
        assert review == {"code": code, "hit": True, "note": review["note"]}
        assert review["note"]

    @pytest.mark.parametrize(
        "code", ["pop_trend", "humidity_high", "sky_overcast", "recent_rain"]
    )
    def test_강수신호_무강수시_미적중(self, code):
        pred = {"temp_max": 28.0, "rain_prob": 70, "evidence": [code]}
        (review,) = duel_service.review_evidence(pred, self.DRY)
        assert review["hit"] is False

    def test_temp_drop_기준보다_낮으면_적중(self):
        pred = {
            "temp_max": 28.0, "rain_prob": 0,
            "evidence": ["temp_drop"],
            "evidence_ctx": {"today_temp_max": 30.0},
        }
        (review,) = duel_service.review_evidence(pred, {"temp_max": 27.0, "rain_prob": 0.0})
        assert review["hit"] is True
        assert "30.0" in review["note"] and "27.0" in review["note"]

    @pytest.mark.parametrize("actual_temp", [30.0, 31.5])  # 같거나 높음 — 엄격 미만만 적중
    def test_temp_drop_같거나_높으면_미적중(self, actual_temp):
        pred = {
            "temp_max": 28.0, "rain_prob": 0,
            "evidence": ["temp_drop"],
            "evidence_ctx": {"today_temp_max": 30.0},
        }
        (review,) = duel_service.review_evidence(
            pred, {"temp_max": actual_temp, "rain_prob": 0.0}
        )
        assert review["hit"] is False

    def test_temp_drop_기준_없으면_미적중_사유_명시(self):
        pred = {"temp_max": 28.0, "rain_prob": 0, "evidence": ["temp_drop"]}
        (review,) = duel_service.review_evidence(pred, self.DRY)
        assert review["hit"] is False
        assert "기준 기온" in review["note"]

    def test_temp_drop_기준_None_스냅샷도_미적중(self):
        pred = {
            "temp_max": 28.0, "rain_prob": 0,
            "evidence": ["temp_drop"],
            "evidence_ctx": {"today_temp_max": None},
        }
        (review,) = duel_service.review_evidence(pred, self.DRY)
        assert review["hit"] is False

    def test_미정산이면_None(self):
        pred = {"temp_max": 28.0, "rain_prob": 70, "evidence": ["recent_rain"]}
        assert duel_service.review_evidence(pred, None) is None

    def test_근거_미선택이면_None(self):
        assert duel_service.review_evidence({"temp_max": 28.0, "rain_prob": 70}, self.RAINED) is None
        assert duel_service.review_evidence(None, self.RAINED) is None

    def test_선택_순서_보존(self):
        pred = {
            "temp_max": 28.0, "rain_prob": 70,
            "evidence": ["recent_rain", "pop_trend", "humidity_high"],
        }
        reviews = duel_service.review_evidence(pred, self.RAINED)
        assert [r["code"] for r in reviews] == ["recent_rain", "pop_trend", "humidity_high"]

    def test_결정성_같은_입력_같은_출력(self):
        pred = {
            "temp_max": 28.0, "rain_prob": 70,
            "evidence": list(duel_service.EVIDENCE_CODES),
            "evidence_ctx": {"today_temp_max": 30.0},
        }
        assert duel_service.review_evidence(pred, self.RAINED) == duel_service.review_evidence(
            pred, self.RAINED
        )

    def test_미지_저장_코드_방어(self):
        """저장 경로가 화이트리스트를 막지만, 과거 데이터 방어 — hit=False."""
        pred = {"temp_max": 28.0, "rain_prob": 70, "evidence": ["legacy_code"]}
        (review,) = duel_service.review_evidence(pred, self.RAINED)
        assert review["hit"] is False


def run_submit(monkeypatch, *, elo):
    """submit_today_duel을 배선 검증용으로 실행 — KMA 폴백 base 고정."""
    fake_user = SimpleNamespace(id=uuid.UUID(USER))

    async def fake_weather(*args, **kwargs):  # region 인자 수용 (R11-01 §8 지역화)
        return {}  # 예보 없음 → _FALLBACK_BASE 사용 (결정적)

    async def fake_rating(db, user_id):
        return elo

    monkeypatch.setattr(duel_router, "get_today_weather", fake_weather)
    monkeypatch.setattr(
        duel_router.league_service, "get_current_rating", fake_rating
    )
    endpoint = inspect.unwrap(duel_router.submit_today_duel)
    db = DuelFakeDB()
    response = asyncio.run(
        endpoint(
            None,  # request — limiter 우회로 미사용
            DuelSubmitRequest(temp_max=27.0, rain_prob=40),
            fake_user,
            db,
        )
    )
    return response, db


class TestSubmitAdaptiveCasterWiring:
    def test_ELO로_scale_적용_및_스냅샷_동봉(self, monkeypatch):
        response, db = run_submit(monkeypatch, elo=1600)  # typhoon_eye
        duel = db.added[0]
        base = duel_router._FALLBACK_BASE
        expected = ai_caster_prediction(
            base["temp_max"], base["rain_prob"], USER, duel.duel_date, noise_scale=0.40
        )
        assert duel.ai_pred["temp_max"] == expected["temp_max"]
        assert duel.ai_pred["rain_prob"] == expected["rain_prob"]
        assert duel.ai_pred["noise_scale"] == 0.40   # JSONB 감사 스냅샷
        assert duel.ai_pred["caster_grade"] == "typhoon_eye"
        assert response.caster_grade == "typhoon_eye"
        assert response.ai_pred.noise_scale == 0.40

    def test_첫_참가는_기본_노이즈_1점0_stratus(self, monkeypatch):
        """정산 이력 없음(None) → scale 1.0 — 기존 예측과 동일(하위 호환)."""
        response, db = run_submit(monkeypatch, elo=None)
        duel = db.added[0]
        base = duel_router._FALLBACK_BASE
        legacy = ai_caster_prediction(
            base["temp_max"], base["rain_prob"], USER, duel.duel_date
        )
        assert duel.ai_pred["temp_max"] == legacy["temp_max"]
        assert duel.ai_pred["rain_prob"] == legacy["rain_prob"]
        assert duel.ai_pred["noise_scale"] == 1.0
        assert response.caster_grade == "stratus"


class TestCasterGradeSchema:
    def test_history는_스냅샷에서_caster_grade_파생(self):
        row = SimpleNamespace(
            id=uuid.uuid4(),
            duel_date=DAY,
            user_pred={"temp_max": 27.0, "rain_prob": 40},
            ai_pred={
                "temp_max": 26.5,
                "rain_prob": 35,
                "noise_scale": 0.85,
                "caster_grade": "cumulus",
            },
            actual=None,
            user_score=None,
            ai_score=None,
            result=None,
        )
        item = DuelHistoryItem.model_validate(row)
        assert item.caster_grade == "cumulus"
        assert item.model_dump()["caster_grade"] == "cumulus"  # 직렬화에도 노출

    def test_R9_이전_행은_caster_grade_null(self):
        """스냅샷 없는 과거 행 — additive 필드는 null (하위 호환)."""
        row = SimpleNamespace(
            id=uuid.uuid4(),
            duel_date=DAY,
            user_pred={"temp_max": 27.0, "rain_prob": 40},
            ai_pred={"temp_max": 26.5, "rain_prob": 35},
            actual=None,
            user_score=None,
            ai_score=None,
            result=None,
        )
        item = DuelHistoryItem.model_validate(row)
        assert item.caster_grade is None

    def test_today_응답도_과거_행이면_null(self):
        duel = SimpleNamespace(
            duel_date=DAY,
            user_pred={"temp_max": 27.0, "rain_prob": 40},
            ai_pred={"temp_max": 26.5, "rain_prob": 35},
            actual=None,
            user_score=None,
            ai_score=None,
            result=None,
        )
        got = duel_router._to_today_response(duel, DAY)
        assert got.caster_grade is None
        assert got.ai_pred.noise_scale is None


