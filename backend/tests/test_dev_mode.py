"""R7-03 개발자 모드 — DEV_MODE 계약 + /api/v1/dev 라우터 단위 테스트.

- 계약: Settings.DEV_MODE 기본값 false 고정(PLACEMENT_SIZE 드리프트 감시 전례)
  + main.py의 조건 include(소스 검사 — test_error_code_contract 관례). 운영에
  실수로 켜진 채 배포되는 것을 막는 핵심 가드.
- 단위: 순수 함수(build_state·unknown_concept_tags·last_login_from·crown_values)와
  엔드포인트 핵심 로직(입력 검증·상한·422)을 DB 없이 검증한다. DB 조작부는
  _FakeDB(실행 statement 수집 대역 — test_answer_service.FakeDB 관례)로 어느
  테이블에 어떤 종류의 statement가 나갔는지 확인한다.
"""
import asyncio
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import Delete, Select, Update
from sqlalchemy.dialects.postgresql import Insert

from app.core.config import Settings
from app.routers import dev
from app.schemas.dev import (
    DevCloudsRequest,
    DevCurriculumRequest,
    DevPlacementRequest,
    DevStreakRequest,
    DevThetaRequest,
)
from app.services.weather_api import KST

BACKEND_APP = Path(__file__).resolve().parents[1] / "app"
REPO_ROOT = Path(__file__).resolve().parents[2]


# ═══════════════════════════════════════════════════════════════
# 계약 — 기본 false + 조건 include (운영 노출 방지 가드)
# ═══════════════════════════════════════════════════════════════


class TestDevModeContract:
    def test_DEV_MODE_기본값은_false(self):
        """계약: 기본 false — env로만 켠다. 기본값 변경 = 운영 노출 사고."""
        assert Settings.model_fields["DEV_MODE"].default is False

    def test_main은_조건부로만_include한다(self):
        """`if settings.DEV_MODE:` 블록 안에서만 dev.router가 등록된다 (소스 검사)."""
        src = (BACKEND_APP / "main.py").read_text(encoding="utf-8")
        assert re.search(
            r"if settings\.DEV_MODE:\n\s+app\.include_router\(dev\.router\)", src
        ), "main.py에 조건 include(`if settings.DEV_MODE:`)가 없음"

    def test_무조건_include는_없다(self):
        src = (BACKEND_APP / "main.py").read_text(encoding="utf-8")
        assert src.count("app.include_router(dev.router)") == 1

    def test_env_example에_기본_false로_문서화(self):
        text = (REPO_ROOT / ".env.example").read_text(encoding="utf-8")
        assert "DEV_MODE=false" in text

    def test_라우터_prefix와_엔드포인트_7종(self):
        assert dev.router.prefix == "/api/v1/dev"
        assert {r.path for r in dev.router.routes} == {
            "/api/v1/dev/state",
            "/api/v1/dev/reset-me",
            "/api/v1/dev/theta",
            "/api/v1/dev/placement",
            "/api/v1/dev/clouds",
            "/api/v1/dev/curriculum",
            "/api/v1/dev/streak",
        }

    def test_전_엔드포인트_JWT_인증과_RLS_세션(self):
        """엔드포인트 수(7)만큼 get_current_user·get_db_with_rls 의존이 선언된다."""
        src = (BACKEND_APP / "routers" / "dev.py").read_text(encoding="utf-8")
        n = len(dev.router.routes)
        assert src.count("Depends(get_current_user)") == n
        assert src.count("Depends(get_db_with_rls)") == n

    def test_에러_코드는_기존_재사용만(self):
        """신규 에러 코드 금지 — 기존 코드(VALIDATION_ERROR·UNIT_NOT_FOUND)만."""
        src = (BACKEND_APP / "routers" / "dev.py").read_text(encoding="utf-8")
        codes = set(re.findall(r'"code":\s*"([A-Z_]+)"', src))
        assert codes <= {"VALIDATION_ERROR", "UNIT_NOT_FOUND"}


# ═══════════════════════════════════════════════════════════════
# 대역 — 실행 statement 수집 (test_answer_service.FakeDB 관례)
# ═══════════════════════════════════════════════════════════════


class _FakeResult:
    def __init__(self, value=None, rowcount=1):
        self._value = value
        self.rowcount = rowcount

    def scalar_one_or_none(self):
        return self._value

    def scalars(self):
        value = self._value if self._value is not None else []
        return SimpleNamespace(all=lambda: list(value))


class _FakeDB:
    """select 결과는 큐(select_results)에서 순서대로 공급, 나머지는 수집만."""

    def __init__(self, select_results=None):
        self.executed = []
        self.select_results = list(select_results or [])

    async def execute(self, stmt):
        self.executed.append(stmt)
        if isinstance(stmt, Select) and self.select_results:
            return _FakeResult(self.select_results.pop(0))
        return _FakeResult()

    async def flush(self):
        pass

    def stmts_on(self, table_name, kind):
        return [
            s
            for s in self.executed
            if isinstance(s, kind)
            and getattr(getattr(s, "table", None), "name", None) == table_name
        ]


def _user(**overrides):
    base = dict(
        id=uuid.uuid4(),
        level_group="middle_high",
        streak_count=3,
        placement_completed_at=None,
        clouds=5,
        clouds_updated_at=datetime.now(timezone.utc),
        xp=120,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def _unit(concept_tag, order, slug=None, section="하늘 읽기", crown_target=1):
    return SimpleNamespace(
        id=uuid.uuid4(),
        slug=slug or f"unit-{order}",
        section=section,
        unit_order=order,
        concept_tag=concept_tag,
        crown_target=crown_target,
    )


# ═══════════════════════════════════════════════════════════════
# 순수 함수
# ═══════════════════════════════════════════════════════════════


class TestPureHelpers:
    def test_unknown_concept_tags는_정본_외_태그만(self):
        assert dev.unknown_concept_tags(["typhoon", "air_mass"]) == []
        assert dev.unknown_concept_tags(["typhoon", "nope", "nope"]) == ["nope"]

    def test_last_login_from_역산(self):
        today = date(2026, 7, 29)
        assert dev.last_login_from(0, today) == today
        assert dev.last_login_from(3, today) == date(2026, 7, 26)

    def test_crown_values_cleared_파생(self):
        now = datetime.now(timezone.utc)
        assert dev.crown_values(2, 2, now) == {"crowns": 2, "cleared_at": now}
        assert dev.crown_values(1, 2, now) == {"crowns": 1, "cleared_at": None}
        assert dev.crown_values(0, 1, now)["cleared_at"] is None


class TestBuildState:
    def _abilities(self):
        return [
            {"concept_tag": "air_mass", "theta": 1.0, "se": 0.2, "n": 4},
            {"concept_tag": "typhoon", "theta": -1.0, "se": 0.4, "n": 0},
        ]

    def test_원값_노출과_overall_target(self):
        state = dev.build_state(_user(), self._abilities(), [], 4, 5)
        assert state.dev_mode is True
        by_tag = {ab.concept_tag: ab for ab in state.abilities}
        assert by_tag["air_mass"].theta_se == 0.2
        assert by_tag["typhoon"].num_responses == 0
        # overall = n 가중 평균(air_mass만 n>0) = 1.0 → adult
        assert state.overall_theta == 1.0
        assert state.target_level_group == "adult"
        assert state.clouds == 4
        assert state.max_clouds == 5
        assert state.streak_count == 3
        assert state.placement_done is False

    def test_weak_tags는_θ_파생_임계_적용(self):
        """R8-01 §3.5 — n>0 AND θ<학령 임계(middle_high ≈ 0.405)만 약점."""
        abilities = [
            {"concept_tag": "air_mass", "theta": 1.0, "se": 0.2, "n": 4},   # θ 충분
            {"concept_tag": "typhoon", "theta": -1.0, "se": 0.4, "n": 2},   # 약점
        ]
        state = dev.build_state(_user(), abilities, [], 4, 5)
        assert state.weak_tags == ["typhoon"]

    def test_weak_tags_n_0_사전값은_약점_아님(self):
        # _abilities의 typhoon: θ=-1.0이지만 n=0(placement 사전값뿐) → 제외
        state = dev.build_state(_user(), self._abilities(), [], 4, 5)
        assert state.weak_tags == []

    def test_콜드스타트는_가입_그룹_폴백(self):
        state = dev.build_state(_user(level_group="elementary"), [], [], 5, 5)
        assert state.overall_theta is None
        assert state.target_level_group == "elementary"
        assert state.unlock_floor == 0
        assert state.abilities == []
        assert state.weak_tags == []

    def test_unlock_floor는_placement_unlock_floor_재사용(self):
        # 선두 유닛(air_mass): θ=1.0·n=4 → 해제, 다음(typhoon): θ<0.5 → 중단
        units = [_unit("air_mass", 1), _unit("typhoon", 2)]
        state = dev.build_state(_user(), self._abilities(), units, 5, 5)
        assert state.unlock_floor == 1

    def test_placement_done은_완료시각_기준(self):
        user = _user(placement_completed_at=datetime.now(timezone.utc))
        assert dev.build_state(user, [], [], 5, 5).placement_done is True


# ═══════════════════════════════════════════════════════════════
# 엔드포인트 — 입력 검증·상한·statement 대상 테이블
# ═══════════════════════════════════════════════════════════════


class TestStateEndpoint:
    def test_진단_조립(self, monkeypatch):
        user = _user()
        abilities = [{"concept_tag": "typhoon", "theta": 0.7, "se": 0.3, "n": 2}]

        async def fake_load_abilities(db, u):
            return abilities

        async def fake_load_units(db):
            return [_unit("typhoon", 1)]

        async def fake_energy(db, u):
            return {"clouds": 2, "max": 5, "next_regen_sec": 10, "updated_at": None}

        monkeypatch.setattr(
            dev.weatherbrain_service, "load_abilities", fake_load_abilities
        )
        monkeypatch.setattr(dev.curriculum_service, "load_units", fake_load_units)
        monkeypatch.setattr(dev.energy_service, "get_state", fake_energy)

        db = _FakeDB()
        state = asyncio.run(dev.get_dev_state(user, db))
        assert state.dev_mode is True
        assert state.clouds == 2
        assert state.max_clouds == 5  # energy_service.get_state의 max 그대로
        assert state.overall_theta == 0.7
        assert state.target_level_group == "adult"
        assert state.unlock_floor == 1
        # θ 파생(R8-01 §3.5): θ=0.7 ≥ middle_high 임계 0.405 → 약점 아님.
        # weak_tags 테이블 조회도 없다 (abilities에서 산출).
        assert state.weak_tags == []
        assert db.stmts_on("weak_tags", Select) == []


class TestThetaEndpoint:
    def test_미존재_concept_tag는_422(self):
        body = DevThetaRequest(
            abilities=[{"concept_tag": "ghost_tag", "theta": 0.0}]
        )
        with pytest.raises(HTTPException) as exc:
            asyncio.run(dev.set_theta(body, _user(), _FakeDB()))
        assert exc.value.status_code == 422
        assert exc.value.detail["code"] == "VALIDATION_ERROR"

    def test_upsert_abilities_재사용_se_기본_0_3(self, monkeypatch):
        captured = {}

        async def fake_upsert(db, user, abilities):
            captured["abilities"] = abilities

        monkeypatch.setattr(
            dev.weatherbrain_service, "_upsert_abilities", fake_upsert
        )
        body = DevThetaRequest(
            abilities=[
                {"concept_tag": "typhoon", "theta": 1.2},
                {"concept_tag": "air_mass", "theta": -0.8, "num_responses": 7},
            ]
        )
        result = asyncio.run(dev.set_theta(body, _user(), _FakeDB()))
        assert result.updated == 2
        assert captured["abilities"] == [
            {"concept_tag": "typhoon", "theta": 1.2, "se": 0.3, "n": 1},
            {"concept_tag": "air_mass", "theta": -0.8, "se": 0.3, "n": 7},
        ]

    def test_빈_abilities는_스키마가_거부(self):
        with pytest.raises(ValidationError):
            DevThetaRequest(abilities=[])

    def test_미정의_필드_주입은_스키마가_거부(self):
        with pytest.raises(ValidationError):
            DevThetaRequest(
                abilities=[
                    {"concept_tag": "typhoon", "theta": 0.0, "theta_se": 0.01}
                ]
            )


class TestCloudsEndpoint:
    def test_상한_초과는_422(self):
        body = DevCloudsRequest(clouds=dev.energy_service.CLOUD_MAX + 1)
        with pytest.raises(HTTPException) as exc:
            asyncio.run(dev.set_clouds(body, _user(), _FakeDB()))
        assert exc.value.status_code == 422
        assert exc.value.detail["code"] == "VALIDATION_ERROR"

    def test_음수는_스키마가_거부(self):
        with pytest.raises(ValidationError):
            DevCloudsRequest(clouds=-1)

    def test_설정은_users_UPDATE_1건(self):
        db = _FakeDB()
        result = asyncio.run(dev.set_clouds(DevCloudsRequest(clouds=0), _user(), db))
        assert result.clouds == 0
        assert result.max == dev.energy_service.CLOUD_MAX
        assert len(db.stmts_on("users", Update)) == 1


class TestStreakEndpoint:
    def test_스트릭과_last_login_설정(self):
        db = _FakeDB()
        body = DevStreakRequest(streak_count=30, last_login_days_ago=2)
        result = asyncio.run(dev.set_streak(body, _user(), db))
        assert result.streak_count == 30
        assert result.last_login_date == datetime.now(KST).date() - timedelta(days=2)
        assert len(db.stmts_on("users", Update)) == 1

    def test_days_ago_기본은_오늘(self):
        result = asyncio.run(
            dev.set_streak(DevStreakRequest(streak_count=1), _user(), _FakeDB())
        )
        assert result.last_login_date == datetime.now(KST).date()

    def test_음수_스트릭은_스키마가_거부(self):
        with pytest.raises(ValidationError):
            DevStreakRequest(streak_count=-1)


class TestPlacementEndpoint:
    def test_complete는_완료시각_설정만(self):
        db = _FakeDB()
        result = asyncio.run(
            dev.set_placement(DevPlacementRequest(action="complete"), _user(), db)
        )
        assert result.placement_done is True
        assert len(db.stmts_on("users", Update)) == 1
        assert not [s for s in db.executed if isinstance(s, Delete)]

    def test_reset은_당일_세션_없으면_완료해제만(self):
        db = _FakeDB(select_results=[None])
        result = asyncio.run(
            dev.set_placement(DevPlacementRequest(action="reset"), _user(), db)
        )
        assert result.placement_done is False
        assert len(db.stmts_on("users", Update)) == 1
        assert not [s for s in db.executed if isinstance(s, Delete)]

    def test_reset은_당일_placement_세션과_로그_삭제(self):
        session = SimpleNamespace(id=uuid.uuid4())
        db = _FakeDB(select_results=[session])
        result = asyncio.run(
            dev.set_placement(DevPlacementRequest(action="reset"), _user(), db)
        )
        assert result.placement_done is False
        assert len(db.stmts_on("quiz_logs", Delete)) == 1
        assert len(db.stmts_on("sessions", Delete)) == 1

    def test_미정의_action은_스키마가_거부(self):
        with pytest.raises(ValidationError):
            DevPlacementRequest(action="destroy")


class TestCurriculumEndpoint:
    def test_crown은_unit_slug와_crowns_필수(self):
        with pytest.raises(HTTPException) as exc:
            asyncio.run(
                dev.set_curriculum(
                    DevCurriculumRequest(action="crown"), _user(), _FakeDB()
                )
            )
        assert exc.value.status_code == 422
        assert exc.value.detail["code"] == "VALIDATION_ERROR"

    def test_미존재_유닛은_404_UNIT_NOT_FOUND(self):
        db = _FakeDB(select_results=[None])
        body = DevCurriculumRequest(action="crown", unit_slug="ghost", crowns=1)
        with pytest.raises(HTTPException) as exc:
            asyncio.run(dev.set_curriculum(body, _user(), db))
        assert exc.value.status_code == 404
        assert exc.value.detail["code"] == "UNIT_NOT_FOUND"

    def test_crown은_진도_upsert_1건(self):
        db = _FakeDB(select_results=[_unit("typhoon", 1, slug="typhoon-1")])
        body = DevCurriculumRequest(action="crown", unit_slug="typhoon-1", crowns=1)
        result = asyncio.run(dev.set_curriculum(body, _user(), db))
        assert result.action == "crown"
        assert result.affected == 1
        assert len(db.stmts_on("user_unit_progress", Insert)) == 1

    def test_unlock_all은_전_유닛_upsert(self, monkeypatch):
        units = [_unit("typhoon", 1), _unit("air_mass", 2)]

        async def fake_load_units(db):
            return units

        monkeypatch.setattr(dev.curriculum_service, "load_units", fake_load_units)
        db = _FakeDB()
        result = asyncio.run(
            dev.set_curriculum(
                DevCurriculumRequest(action="unlock_all"), _user(), db
            )
        )
        assert result.affected == 2
        assert len(db.stmts_on("user_unit_progress", Insert)) == 2

    def test_reset은_진도_전삭제(self):
        db = _FakeDB()
        result = asyncio.run(
            dev.set_curriculum(DevCurriculumRequest(action="reset"), _user(), db)
        )
        assert result.action == "reset"
        assert len(db.stmts_on("user_unit_progress", Delete)) == 1


class TestResetMeEndpoint:
    EXPECTED_TABLES = {
        "quiz_logs",
        "sessions",
        "user_concept_ability",
        "weak_tags",
        "attendance",
        "league_results",
        "user_badges",
        "user_quest_progress",
        "user_unit_progress",
        "duels",
    }

    def _run(self, monkeypatch):
        seeded = {}

        async def fake_seed(db, user):
            seeded["user_id"] = user.id
            return []

        monkeypatch.setattr(dev.weatherbrain_service, "seed_placement", fake_seed)
        db = _FakeDB()
        user = _user()
        result = asyncio.run(dev.reset_me(user, db))
        return result, db, user, seeded

    def test_종속_10종_전삭제(self, monkeypatch):
        result, db, _, _ = self._run(monkeypatch)
        assert result.reset is True
        deleted = {
            s.table.name for s in db.executed if isinstance(s, Delete)
        }
        assert deleted == self.EXPECTED_TABLES

    def test_quiz_logs가_sessions보다_먼저(self, monkeypatch):
        """FK(quiz_logs.session_id → sessions.id) — 삭제 순서 계약."""
        _, db, _, _ = self._run(monkeypatch)
        order = [s.table.name for s in db.executed if isinstance(s, Delete)]
        assert order.index("quiz_logs") < order.index("sessions")

    def test_users_가변_필드_리셋(self, monkeypatch):
        _, db, _, _ = self._run(monkeypatch)
        updates = db.stmts_on("users", Update)
        assert len(updates) == 1
        params = updates[0].compile().params
        assert params["xp"] == 0
        assert params["streak_count"] == 0
        assert params["streak_freeze_count"] == 0
        assert params["clouds"] == dev.settings.CLOUD_MAX
        assert params["placement_completed_at"] is None
        assert params["last_login_date"] is None

    def test_placement_재시드_호출(self, monkeypatch):
        _, _, user, seeded = self._run(monkeypatch)
        assert seeded["user_id"] == user.id
