"""예보 대결 계약 테스트 — 스프린트 R4-01 §3.4 (R4-S4).

순수 함수(ai_caster_prediction·duel_result·settle_scores·extract_forecast_for_date)를
고정한다. 핵심 불변식:
- AI 예측 결정성: 같은 (기준예보·user_id·날짜)는 항상 같은 예측 (재현 가능)
- 노이즈 범위: 온도 ±2.0, 강수 ±15(0~100 클램프)
- 승패: accuracy_score 비교로 win/lose/draw
재제출 409(ALREADY_SUBMITTED)는 duels UNIQUE(user_id, duel_date) + 라우터 선조회로
강제하며(league /predict 패턴과 동일), 여기서는 판정·생성 로직을 검증한다.
"""
from datetime import date

import pytest

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
