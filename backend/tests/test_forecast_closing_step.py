"""예보 마감 단계 계약 테스트 — R13 A-1 (BE-1).

예보 대결(`duel.py` + `POST /api/v1/duel/today`)을 **일일 세션의 마감 단계**로
붙이는 개정의 기계 검증이다. 이 개정의 전제는 하나다:

> **예보는 즉시 채점이 불가능하다.** 정답은 내일의 관측이 정한다.

그래서 15문항과 같은 파이프라인(채점기·XP·구름 에너지·만회 큐)에 넣지 않는다.
문항이 아니라 **단계**이고, 배합(SESSION_RECIPE)은 15문항 그대로다.

계약 6건:
1. 오늘 미제출 + 판단 재료 있음 → 마감 단계 **노출**(대상일=내일, 제출 경로=기존)
2. 오늘 **이미 제출**했으면 미노출(재노출하면 프론트가 409로 끝나는 단계를 그린다)
3. **KMA 없음(degraded) → 단계 생략** + 세션은 15문항으로 정상 완료
   ("키 없이도 전 기능 동작"이 프로젝트 계약이다)
4. 배합은 15문항 **불변** — 마감 단계가 SESSION_RECIPE에 들어가지 않는다
5. daily 세션에서만 노출 — unit·placement 세션은 항상 null
6. 구름 에너지·XP·스트릭에 **닿지 않는다**(보상은 기존 리그·정산 경로 소유)

실행: backend 디렉토리에서 `python -m pytest tests/test_forecast_closing_step.py -q`.
"""
import asyncio
import inspect
import uuid
from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from app.core.config import settings
from app.routers import session as session_router
from app.services import duel_service
from app.services import session_service as ss

TODAY = date(2026, 8, 7)
TOMORROW = TODAY + timedelta(days=1)


# ═══════════════════════════════════════════════════════════════
# 대역
# ═══════════════════════════════════════════════════════════════


def weather_with_tomorrow(temp_max=29.0, pop=60) -> dict:
    """대상일(내일) 예보가 들어 있는 KMA 단기예보 형식 응답."""
    stamp = TOMORROW.strftime("%Y%m%d")
    return {
        "region": "서울",
        "forecasts": [
            {"datetime": f"{stamp}0600", "TMP": 21.0, "POP": 20},
            {"datetime": f"{stamp}1500", "TMX": temp_max, "TMP": temp_max, "POP": pop},
        ],
    }


class DuelDB:
    """duels 조회 1건만 대역 — submitted면 행이 있는 것처럼 응답한다."""

    def __init__(self, submitted: bool = False):
        self.submitted = submitted
        self.stmts: list = []

    async def execute(self, stmt):
        self.stmts.append(stmt)
        found = uuid.uuid4() if self.submitted else None
        return SimpleNamespace(scalar_one_or_none=lambda: found)


def make_user():
    return SimpleNamespace(id=uuid.uuid4(), level_group="middle_high", region=None)


def run_step(monkeypatch, *, submitted=False, weather=None):
    monkeypatch.setattr(
        ss, "get_today_weather", _weather_stub(weather_with_tomorrow() if weather is None else weather)
    )
    return asyncio.run(ss.forecast_closing_step(DuelDB(submitted), make_user(), TODAY))


def _weather_stub(payload):
    async def _stub(*args, **kwargs):
        return payload

    return _stub


# ═══════════════════════════════════════════════════════════════
# 계약 1·2 · 노출 조건
# ═══════════════════════════════════════════════════════════════


class TestClosingStepVisibility:
    def test_계약1_미제출이면_마감_단계_노출(self, monkeypatch):
        step = run_step(monkeypatch)
        assert step is not None
        assert step["duel_date"] == TOMORROW, "예보 대상일은 내일(KST)이다"
        assert step["base_forecast"] == {"temp_max": 29.0, "rain_prob": 60}

    def test_계약1_제출은_기존_예보_대결_엔드포인트다(self, monkeypatch):
        """새 엔드포인트를 만들지 않는다 — 정산·리그 경로가 이미 그것에 붙어 있다."""
        step = run_step(monkeypatch)
        assert step["submit_path"] == ss.DUEL_SUBMIT_PATH == "/api/v1/duel/today"
        # 실제로 그 경로에 제출 라우트가 있는가(문자열만 맞는 사인보드 방지)
        from app.routers.duel import router as duel_router

        posts = {
            r.path for r in duel_router.routes if "POST" in getattr(r, "methods", ())
        }
        assert ss.DUEL_SUBMIT_PATH in posts

    def test_계약2_이미_제출한_날은_미노출(self, monkeypatch):
        assert run_step(monkeypatch, submitted=True) is None

    def test_제출_판정은_대결_대상일과_같은_날짜를_본다(self, monkeypatch):
        """`duel_target_date` 단일 소유 — 사본을 두면 KST 경계에서 하루 밀린다."""
        step = run_step(monkeypatch)
        assert step["duel_date"] == duel_service.duel_target_date(TODAY)
        # 라우터도 같은 함수를 본다
        from app.routers import duel as duel_router_mod

        assert "duel_service.duel_target_date" in inspect.getsource(
            duel_router_mod._duel_target_date
        )


# ═══════════════════════════════════════════════════════════════
# 계약 3 · KMA 없음 → 단계 생략 + 15문항 정상 완료
# ═══════════════════════════════════════════════════════════════


class TestDegradedWithoutKma:
    @pytest.mark.parametrize(
        "weather",
        [
            {},  # get_today_weather 실패 폴백(키 부재·장애·타임아웃)
            {"region": "서울", "forecasts": []},  # NODATA
            # 오늘 예보만 있고 대상일(내일)이 빠진 응답
            {"region": "서울", "forecasts": [{"datetime": f"{TODAY:%Y%m%d}1500", "TMX": 30.0}]},
        ],
    )
    def test_계약3_KMA_없으면_단계_생략(self, monkeypatch, weather):
        assert run_step(monkeypatch, weather=weather) is None

    def test_계약3_KMA_없어도_15문항_세션이_정상_완료된다(self, monkeypatch):
        """단계 생략이 세션 완주를 막지 않는다 — 프로젝트 계약("키 없이 전 기능").

        complete 경로 전체를 돌려 15문항 결산이 그대로 나오는지 본다.
        """
        from test_crown_award import FakeDB, make_log, make_session

        monkeypatch.setattr(ss, "get_today_weather", _weather_stub({}))
        session = make_session()
        logs = [make_log("air_mass") for _ in range(ss.SESSION_SIZE)]

        # forecast_closing_step 대역을 걷어내고 **실코드**를 태운다 —
        # run_complete가 넘기는 FakeDB에 duels 조회만 붙여 준다.
        async def fake_load(db, user, session_id):
            return session

        async def fake_logs(db, s):
            return logs

        async def noop(*args, **kwargs):
            return None

        monkeypatch.setattr(session_router, "_load_session_or_404", fake_load)
        monkeypatch.setattr(session_router, "_session_logs", fake_logs)
        monkeypatch.setattr(
            session_router.curriculum_service, "award_crown_for_activity", noop
        )
        monkeypatch.setattr(session_router.badge_service, "award_badge", noop)
        monkeypatch.setattr(session_router.quest_service, "recalculate_quests", noop)

        db = DuelDB()
        db.get = FakeDB().get
        db.flush = FakeDB().flush
        result = asyncio.run(
            session_router.complete_session(
                session.id,
                SimpleNamespace(id=session.user_id, level_group="elementary", streak_count=3),
                db,
            )
        )
        assert result.total == ss.SESSION_SIZE == 15
        assert result.correct_count == ss.SESSION_SIZE
        assert result.closing_step is None, "KMA 없으면 마감 단계도 없다"


# ═══════════════════════════════════════════════════════════════
# 계약 4 · 배합 불변 · 계약 6 · 보상 경로 무영향
# ═══════════════════════════════════════════════════════════════


class TestRecipeAndRewardsUntouched:
    def test_계약4_배합은_15문항_그대로(self):
        """마감 단계는 **문항이 아니다** — SESSION_RECIPE에 kind가 늘지 않는다."""
        assert settings.SESSION_RECIPE == {
            "new": 5, "review": 4, "live": 1, "unit": 5
        }
        assert ss.SESSION_SIZE == 15
        assert set(settings.SESSION_RECIPE) == {"new", "review", "live", "unit"}
        # 배합 validator 허용 집합에도 예보 kind가 없다(env로도 못 넣는다)
        from app.core.config import Settings

        with pytest.raises(ValueError):
            Settings(SESSION_RECIPE={"new": 1, "forecast": 1})

    def test_계약6_에너지_XP_스트릭에_닿지_않는다(self):
        """소스 계약 — 마감 단계 판정이 보상 경로를 부르면 여기서 문다."""
        src = inspect.getsource(ss.forecast_closing_step)
        for forbidden in ("energy_service", "xp_service", "streak", "clouds"):
            assert forbidden not in src, forbidden

    def test_계약6_마감_단계는_문항_배합_경로를_건드리지_않는다(self):
        """create_daily_session의 entries에 예보가 섞이면 채점 파이프라인에 들어간다."""
        src = inspect.getsource(ss.create_daily_session)
        assert "forecast_closing_step" not in src
        assert "closing_step" not in src


# ═══════════════════════════════════════════════════════════════
# 계약 5 · 응답 노출 (3일차 FE 인계 계약)
# ═══════════════════════════════════════════════════════════════


class TestResponseExposure:
    def _session(self, mode):
        return SimpleNamespace(
            id=uuid.uuid4(),
            session_date=TODAY,
            mode=mode,
            recipe_json={},
            unit_id=None,
        )

    def _respond(self, monkeypatch, mode, *, submitted=False, db=None):
        async def fake_logs(_db, s):
            return []

        monkeypatch.setattr(session_router, "_session_logs", fake_logs)
        monkeypatch.setattr(ss, "get_today_weather", _weather_stub(weather_with_tomorrow()))
        monkeypatch.setattr(
            duel_service, "duel_target_date", lambda today=None: TOMORROW
        )
        return asyncio.run(
            session_router.session_today_response(
                db or DuelDB(submitted), self._session(mode), make_user()
            )
        )

    def test_계약5_daily_응답에_closing_step이_실린다(self, monkeypatch):
        body = self._respond(monkeypatch, ss.MODE_DAILY)
        assert body.closing_step is not None
        assert body.closing_step.kind == "forecast_duel"
        assert body.closing_step.duel_date == TOMORROW
        assert body.closing_step.submit_path == ss.DUEL_SUBMIT_PATH
        assert body.closing_step.base_forecast.temp_max == 29.0
        assert body.closing_step.base_forecast.rain_prob == 60

    def test_계약5_이미_제출했으면_응답도_null(self, monkeypatch):
        assert self._respond(monkeypatch, ss.MODE_DAILY, submitted=True).closing_step is None

    @pytest.mark.parametrize("mode", ["unit", "placement"])
    def test_계약5_유닛_배치_세션은_항상_null(self, monkeypatch, mode):
        """진도 연습·진단은 하루 1회 예보와 무관하다(조회도 하지 않는다)."""
        db = DuelDB()
        body = self._respond(monkeypatch, mode, db=db)
        assert body.closing_step is None
        assert db.stmts == [], "daily가 아닌 세션에서 duels를 조회하면 안 된다"

    def test_daily는_실제로_duels를_조회한다(self, monkeypatch):
        """위 테스트가 공허하지 않다는 증명 — daily에서는 조회가 실제로 돈다."""
        db = DuelDB()
        self._respond(monkeypatch, ss.MODE_DAILY, db=db)
        assert len(db.stmts) == 1


@pytest.fixture(scope="module")
def mock_src() -> str:
    from pathlib import Path

    path = (
        Path(__file__).resolve().parents[2] / "frontend" / "mock" / "apiMockPlugin.js"
    )
    return path.read_text(encoding="utf-8")


class TestMockParity:
    """프론트 목이 같은 필드를 같은 조건으로 내보내는가 (R10-07 §2.3 관례).

    목이 조용히 어긋나면 스모크는 초록인데 실서버 경로가 끊긴다 — R10에서 3번
    반복된 실패 양식이다.
    """

    def test_목_제출_경로가_서버_상수와_같다(self, mock_src):
        assert f"const DUEL_SUBMIT_PATH = '{ss.DUEL_SUBMIT_PATH}'" in mock_src

    def test_목_세션_응답이_closing_step을_싣는다(self, mock_src):
        assert "closing_step: closingStepPayload(s.mode)" in mock_src

    def test_목도_같은_2조건에서_단계를_생략한다(self, mock_src):
        block = mock_src.split("function closingStepPayload(")[1].split("\n}")[0]
        assert "state.duel.submitted" in block, "이미 제출한 날 미노출 조건이 없다"
        assert "BRIEFING_DEGRADED" in block, "KMA degraded 생략 조건이 없다"
        assert "mode !== 'daily'" in block, "daily 게이트가 없다"
