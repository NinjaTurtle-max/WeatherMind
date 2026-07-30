"""예보 대결 계약 테스트 — 스프린트 R4-01 §3.4 (R4-S4) + R9-01 §3.2 (R9-S2).

순수 함수(ai_caster_prediction·duel_result·settle_scores·extract_forecast_for_date)를
고정한다. 핵심 불변식:
- AI 예측 결정성: 같은 (기준예보·user_id·날짜)는 항상 같은 예측 (재현 가능)
- 노이즈 범위: 온도 ±2.0, 강수 ±15(0~100 클램프)
- 승패: accuracy_score 비교로 win/lose/draw
재제출 409(ALREADY_SUBMITTED)는 duels UNIQUE(user_id, duel_date) + 라우터 선조회로
강제하며(league /predict 패턴과 동일), 여기서는 판정·생성 로직을 검증한다.

적응형 캐스터(R9-01 §3.2): caster_noise_scale 티어 5계단 계약 수치,
noise_scale은 시드 불변·진폭에만 적용(기본값 1.0 하위 호환)을 고정한다.
승률 밸런스 시뮬은 test_duel_balance.py 별도.
"""
import random
from datetime import date

import pytest

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


