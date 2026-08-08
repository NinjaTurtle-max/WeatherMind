"""사용자 지역화(R11-01 §8) — users.region·PUT /progress/region·지역 배선 계약.

§8.2 계약을 DB·네트워크 없이 고정한다(unwrap + 대역 관례 — test_duel_briefing·
test_spine_aggregate·test_course_structure의 하네스 패턴):
- NULL=서울: weather_api.user_region이 폴백의 단일 소유자 (courses의 NULL=weather
  선례 — 기존 유저·게스트 무변경). 화이트리스트 밖 저장값도 서울로 방어.
- PUT /progress/region: KMA_GRID 12도시 화이트리스트, 그 외 422
  {detail: str, code: "VALIDATION_ERROR"} (daily-goal 선례 D10-4).
- GET /progress/me: region 저장값 원본 노출(additive — null=미설정).
- 배선: 세션 실황 슬롯·RAG 피드백 날씨가 유저 region을 타고, 캐시 키가
  weather:{date}:{region}으로 갈린다. **리그·대결(duel)은 서울 고정 유지**
  — §8 계약 정정(PM 판정): 대결 정산(celery settle_daily_duel)이 서울 실측
  고정이라, 판단 재료(브리핑·base_forecast·캐스터 base)를 유저 지역화하면
  "부산 예보 보고 예측 → 서울 실측 채점"의 정합성 붕괴가 생긴다. 대결·리그는
  같은 채점 축("서울 기준 전국 대결") — 경로 분리를 여기서 못박는다.
- 게스트 전환(POST /auth/guest/convert)은 같은 행 갱신이라 region이 보존된다.
- 마이그레이션 0010: revision 체인·downgrade·단일 head (0009 관례).
"""
import asyncio
import importlib.util
import inspect
import re
import uuid
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.models.user import User
from app.routers import duel as duel_router
from app.routers import league as league_router
from app.routers import progress as progress_router
from app.services import answer_service, session_service, weather_api
from app.services.weather_api import (
    DEFAULT_REGION,
    KMA_GRID,
    user_region,
    weather_cache_key,
)

VERSIONS_DIR = Path(__file__).resolve().parents[1] / "alembic" / "versions"


def make_user(region=None, **overrides) -> User:
    """실 User 인스턴스 — region 컬럼 기본값(None)·모델 계약을 함께 검증."""
    user = User(
        id=uuid.uuid4(),
        email=f"u-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="x",
        nickname="테스터",
        level_group="middle_high",
        xp=0,
        streak_count=0,
        streak_freeze_count=0,
        daily_goal_items=None,
    )
    user.region = region
    for key, value in overrides.items():
        setattr(user, key, value)
    return user


# ═══════════════════════════════════════════════════════════════
# NULL=서울 폴백 — user_region (§8.2 하위 호환의 단일 소유자)
# ═══════════════════════════════════════════════════════════════


class TestUserRegionFallback:
    def test_NULL이면_서울(self):
        assert user_region(make_user(region=None)) == "서울" == DEFAULT_REGION

    def test_설정값은_그대로(self):
        for city in KMA_GRID:
            assert user_region(make_user(region=city)) == city

    def test_화이트리스트_밖_저장값도_서울로_방어(self):
        """과거 데이터·수동 조작이 unknown region ValueError(날씨 {})로 새지 않게."""
        assert user_region(make_user(region="뉴욕")) == "서울"
        assert user_region(make_user(region="")) == "서울"

    def test_region_속성이_없는_대역도_서울(self):
        """SimpleNamespace 스텁(기존 테스트 대역)이 깨지지 않는다 — getattr 방어."""
        assert user_region(SimpleNamespace(id=uuid.uuid4())) == "서울"

    def test_신규_User_행의_기본값은_None(self):
        """게스트·기존 가입 경로가 region을 만지지 않아도 NULL(=서울)이다."""
        assert make_user().region is None


# ═══════════════════════════════════════════════════════════════
# PUT /progress/region — 화이트리스트 422 (daily-goal 의미론)
# ═══════════════════════════════════════════════════════════════


class FakeUserDB:
    """set_region이 쓰는 표면만 — get(User, pk)·flush."""

    def __init__(self, user: User):
        self.user = user
        self.flushes = 0

    async def get(self, model, pk):
        assert model is User and pk == self.user.id
        return self.user

    async def flush(self):
        self.flushes += 1


def put_region(user: User, region: str):
    db = FakeUserDB(user)
    payload = progress_router.RegionUpdate(region=region)
    result = asyncio.run(progress_router.set_region(payload=payload, user=user, db=db))
    return result, db


class TestSetRegionAPI:
    def test_12도시_전부_수용_및_저장(self):
        for city in KMA_GRID:
            user = make_user()
            result, db = put_region(user, city)
            assert result.region == city
            assert user.region == city  # DB 행 갱신
            assert db.flushes == 1

    def test_화이트리스트_밖은_422_VALIDATION_ERROR(self):
        user = make_user(region="서울")
        for bad in ("뉴욕", "seoul", "", " 서울"):
            with pytest.raises(HTTPException) as exc_info:
                put_region(user, bad)
            exc = exc_info.value
            assert exc.status_code == 422
            assert exc.detail["code"] == "VALIDATION_ERROR"  # daily-goal 의미론
            assert isinstance(exc.detail["detail"], str)
        assert user.region == "서울"  # 거부 시 저장값 불변

    def test_재설정_덮어쓰기(self):
        user = make_user(region="부산")
        result, _ = put_region(user, "제주")
        assert result.region == "제주" and user.region == "제주"


# ═══════════════════════════════════════════════════════════════
# GET /progress/me — region 노출 (additive, 저장값 원본)
# ═══════════════════════════════════════════════════════════════


class _CountResult:
    def scalar_one(self):
        return 0


class FakeMeDB:
    async def execute(self, stmt):
        return _CountResult()


@pytest.fixture()
def me_deps(monkeypatch):
    async def fake_tier(db, user_id):
        return "stratus"

    async def fake_energy(db, user):
        return {"clouds": 5, "max": 5, "next_regen_sec": 0, "updated_at": None}

    async def fake_spine(db, user):
        return {
            "units_total": 0, "units_cleared": 0,
            "crowns_earned": 0, "crowns_total": 0, "current_unit": None,
        }

    monkeypatch.setattr(progress_router.league_service, "get_current_tier", fake_tier)
    monkeypatch.setattr(progress_router.energy_service, "get_state", fake_energy)
    monkeypatch.setattr(progress_router.curriculum_service, "get_spine", fake_spine)


class TestMeExposesRegion:
    def test_미설정은_null(self, me_deps):
        me = asyncio.run(progress_router.get_me(user=make_user(), db=FakeMeDB()))
        assert me.region is None  # 원본 노출 — 프론트가 미설정(픽커 유도)을 구분

    def test_설정값_노출(self, me_deps):
        me = asyncio.run(
            progress_router.get_me(user=make_user(region="대구"), db=FakeMeDB())
        )
        assert me.region == "대구"


# ═══════════════════════════════════════════════════════════════
# 배선 — 세션 실황·RAG 피드백·브리핑이 유저 region을 탄다
# ═══════════════════════════════════════════════════════════════


class FakeRedis:
    def __init__(self, store=None):
        self.store = dict(store or {})
        self.got: list[str] = []

    async def get(self, key):
        self.got.append(key)
        return self.store.get(key)

    async def setex(self, key, ttl, value):
        self.store[key] = value


class TestRegionCacheKey:
    def test_get_today_weather가_region_키_캐시를_탄다(self, monkeypatch):
        """weather:{date}:{region} — 부산 유저의 실황은 부산 캐시에서 온다(§8.2)."""
        today = datetime.now(weather_api.KST).strftime("%Y%m%d")
        cached = '{"region": "부산", "forecasts": []}'
        redis = FakeRedis({weather_cache_key(today, "부산"): cached})
        monkeypatch.setattr(weather_api, "get_redis", lambda: redis)

        result = asyncio.run(weather_api.get_today_weather("부산"))
        assert result == {"region": "부산", "forecasts": []}
        assert redis.got == [weather_cache_key(today, "부산")]  # 서울 키 미접근


class _RecordingWeather:
    """get_today_weather 대역 — 호출된 region 인자를 기록한다."""

    def __init__(self, weather=None):
        self.regions: list = []
        self.weather = weather or {}

    async def __call__(self, region=DEFAULT_REGION):
        self.regions.append(region)
        return self.weather


class TestSessionLiveSlotWiring:
    def _run(self, monkeypatch, user: User):
        recorder = _RecordingWeather()

        async def fake_weak_rows(db, u):
            return []

        async def fake_refresh(db, u):
            return []

        async def fake_route(db, u, rows, abilities=None):
            return {"route": "general"}

        def bank_item():
            return SimpleNamespace(
                id=uuid.uuid4(),  # 개별 id — plan_bank_picks 중복 제거 회피
                template_json={"question_text": "q", "correct_answer": "a"},
                concept_tag="pressure_front",
                question_type="multiple_choice",
            )

        async def fake_pools(db, u, weak, theta=None):
            # live 풀은 슬롯 없는 템플릿 — 빈 날씨({})여도 치환 성공, 폴백 0.
            # new 풀은 배합 파생(new+review 대체분) — 수를 하드코딩하면 배합 개정
            # (R11-01 §9.2 10문항) 때 생성 폴백이 새어 실 네트워크를 친다.
            recipe = session_service.DEFAULT_RECIPE
            # new + (review 대체분) + (진도 블록 대체분 — 이 대역엔 유닛이 없다)
            new_count = recipe["new"] + recipe["review"] + recipe.get("unit", 0)
            return [bank_item() for _ in range(new_count)], [], [bank_item()]

        async def fake_quiz_ids(db, uid, today_str, count):
            return [f"q-{i}" for i in range(count)]

        monkeypatch.setattr(session_service, "get_today_weather", recorder)
        monkeypatch.setattr(session_service, "_load_weak_tag_rows", fake_weak_rows)
        monkeypatch.setattr(
            session_service.weatherbrain_service, "refresh_abilities", fake_refresh
        )
        monkeypatch.setattr(session_service, "decide_route", fake_route)
        monkeypatch.setattr(
            session_service.weatherbrain_service, "weak_concepts", lambda a, lg: []
        )
        monkeypatch.setattr(
            session_service.weatherbrain_service, "overall_theta", lambda a, t=None: None
        )
        monkeypatch.setattr(session_service, "_fetch_pools", fake_pools)
        monkeypatch.setattr(session_service, "allocate_quiz_ids", fake_quiz_ids)

        class _EmptyResult:
            def scalars(self):
                return self

            def all(self):
                return []

        class _DB:
            def add(self, obj):
                pass

            async def flush(self):
                pass

            async def execute(self, stmt):
                # 진도 블록(R13-01 §2.10)이 유닛 트리를 조회한다 — 빈 DB면
                # 열린 유닛 0 → 진도 블록 0(부족분은 new 대체). 여기 관심사는
                # 실황 지역 배선이라 유닛은 비워 둔다.
                return _EmptyResult()

        asyncio.run(session_service.create_daily_session(_DB(), user))
        return recorder.regions

    def test_부산_유저의_세션_실황은_부산(self, monkeypatch):
        assert self._run(monkeypatch, make_user(region="부산")) == ["부산"]

    def test_region_NULL_유저는_서울_변이가드(self, monkeypatch):
        """NULL=서울 폴백을 무력화하면(예: region을 그대로 넘기면 None) 여기서 문다."""
        assert self._run(monkeypatch, make_user(region=None)) == ["서울"]


class TestRagFeedbackWiring:
    def _run(self, monkeypatch, user: User):
        recorder = _RecordingWeather()
        captured = {}

        async def fake_load(db, u):
            return []

        async def fake_update_weak(db, uid, tag, ok):
            pass

        async def fake_add_xp(db, uid, xp):
            pass

        async def fake_rag(**kwargs):
            captured.update(kwargs)
            return "피드백"

        monkeypatch.setattr(answer_service, "get_today_weather", recorder)
        monkeypatch.setattr(
            answer_service.weatherbrain_service, "load_abilities", fake_load
        )
        monkeypatch.setattr(
            answer_service.weatherbrain_service, "weak_concepts", lambda a, lg: []
        )
        monkeypatch.setattr(answer_service.xp_service, "update_weak_tag", fake_update_weak)
        monkeypatch.setattr(answer_service.xp_service, "add_xp", fake_add_xp)
        monkeypatch.setattr(answer_service.ai_client, "rag_feedback", fake_rag)

        class _DB:
            async def flush(self):
                pass

            async def execute(self, stmt):  # 뱅크 통계·세션 XP — 이 경로엔 없음
                raise AssertionError("content_item_id·session_id 없는 로그가 DB를 만짐")

        log = SimpleNamespace(
            quiz_id="20260805-001",
            user_answer=None,
            is_correct=None,
            question_json={
                "question_type": "multiple_choice",
                "question_text": "q",
                "correct_answer": "1",
            },
            concept_tag="pressure_front",
            content_item_id=None,
            session_id=None,
            elapsed_sec=None,
            answered_at=None,
        )
        asyncio.run(
            answer_service.submit_answer_for_log(_DB(), user, log, "1", None)
        )
        return recorder.regions

    def test_RAG_피드백_날씨가_유저_region을_탄다(self, monkeypatch):
        assert self._run(monkeypatch, make_user(region="제주")) == ["제주"]

    def test_NULL이면_서울_변이가드(self, monkeypatch):
        assert self._run(monkeypatch, make_user(region=None)) == ["서울"]


# ═══════════════════════════════════════════════════════════════
# 경로 분리 — 리그·대결은 서울 고정 (§8 계약 정정, 채점 축 일치)
# ═══════════════════════════════════════════════════════════════


class _NoDuelDB:
    """_get_duel용 — 오늘 대결 미제출."""

    async def execute(self, stmt):
        return SimpleNamespace(scalar_one_or_none=lambda: None)


class TestDuelAndLeagueStaySeoul:
    """이번 정정이 되돌아가지 않게: 부산 유저의 브리핑·base_forecast·정산이
    전부 서울 축임을 고정한다(리그 포함)."""

    def test_부산_유저여도_리그는_서울(self):
        """/league/current — 유저 region과 무관하게 응답 region이 서울(정산 축과 일치).

        ⚠️ R13 CO-Q-6 이후 이 엔드포인트는 **KMA를 아예 부르지 않는다** —
        `mid_forecast`가 빈 dict 고정이라 예전의 "중기예보를 서울로 부른다"
        단정은 성립하지 않는다. 대신 **부르지 않는다는 사실 자체**를 고정한다:
        되돌아가면 리그 진입마다 KMA 2콜이 화면 산출물 0으로 다시 새어 나간다.
        """
        assert not hasattr(league_router, "get_mid_forecast"), (
            "CO-Q-6 회귀: /league/current가 중기예보를 다시 부르고 있다"
        )
        res = asyncio.run(league_router.get_current(user=make_user(region="부산")))
        assert res.region == "서울"
        assert res.mid_forecast == {}

    def test_부산_유저여도_브리핑은_서울(self, monkeypatch):
        """/duel/briefing — 실황·과거관측·응답 region 전부 서울 축(정산과 일치)."""
        recorder = _RecordingWeather()
        obs_regions = []

        async def fake_obs(start, end, region=DEFAULT_REGION):
            obs_regions.append(region)
            return []

        monkeypatch.setattr(duel_router, "get_today_weather", recorder)
        monkeypatch.setattr(duel_router, "get_past_observation", fake_obs)
        endpoint = inspect.unwrap(duel_router.get_duel_briefing)
        res = asyncio.run(
            endpoint(request=SimpleNamespace(), user=make_user(region="부산"))
        )
        assert res.region == "서울"
        assert recorder.regions == ["서울"]  # 기본 인자 = DEFAULT_REGION 경로
        assert obs_regions == ["서울"]

    def test_부산_유저여도_base_forecast는_서울(self, monkeypatch):
        """/duel/today GET — 유저·캐스터가 보는 기준 예보도 서울 축."""
        recorder = _RecordingWeather()
        monkeypatch.setattr(duel_router, "get_today_weather", recorder)
        endpoint = inspect.unwrap(duel_router.get_today_duel)
        asyncio.run(
            endpoint(
                request=SimpleNamespace(),
                user=make_user(region="부산"),
                db=_NoDuelDB(),
            )
        )
        assert recorder.regions == ["서울"]

    def test_소스_경계_league와_duel은_user_region_미사용(self):
        """두 라우터가 user_region을 import조차 하지 않는다 — 경로 분리 소스 계약."""
        for module in (league_router, duel_router):
            src = Path(module.__file__).read_text(encoding="utf-8")
            assert "user_region" not in src, module.__name__
            assert "DEFAULT_REGION" in src, module.__name__  # 서울 고정 경로 유지

    def test_정산도_서울_축_소스_계약(self):
        """celery settle 태스크가 서울 지점 실측으로 정산한다 — 교차 컨텍스트 계약.

        브리핑·base_forecast를 서울로 고정하는 근거가 이 정산 축이다. celery가
        지역 정산으로 바뀌면(듀얼 지역화 R12 후속) 이 테스트가 함께 재검토를 문다.
        """
        celery_src = (
            Path(__file__).resolve().parents[2]
            / "celery" / "app" / "tasks" / "league.py"
        ).read_text(encoding="utf-8")
        assert celery_src.count("KMA_STATION[config.DEFAULT_REGION]") >= 2  # 리그+듀얼
        assert "user_region" not in celery_src


# ═══════════════════════════════════════════════════════════════
# 게스트 전환 — 같은 행 갱신이라 region 보존 (§8 과제 4)
# ═══════════════════════════════════════════════════════════════


class TestGuestConvertPreservesRegion:
    def test_전환_후_region_보존(self, monkeypatch):
        from app.routers import auth
        from app.schemas.auth import ConvertRequest

        guest = make_user(
            region="울산", email=f"guest-{uuid.uuid4()}@{auth.GUEST_EMAIL_DOMAIN}"
        )

        class _AuthDB:
            async def execute(self, stmt):  # 이메일 중복 검사 — 없음
                return SimpleNamespace(scalar_one_or_none=lambda: None)

            async def get(self, model, pk):
                assert pk == guest.id
                return guest

            async def commit(self):
                pass

        async def fake_store(uid, token):
            pass

        monkeypatch.setattr(auth, "hash_password", lambda pw: f"$fake${pw}")
        monkeypatch.setattr(auth, "_store_session", fake_store)
        monkeypatch.setattr(auth, "create_access_token", lambda *a, **k: "at")
        monkeypatch.setattr(auth, "create_refresh_token", lambda *a, **k: "rt")

        endpoint = inspect.unwrap(auth.convert_guest)
        original_id = guest.id
        asyncio.run(
            endpoint(
                request=SimpleNamespace(),
                body=ConvertRequest(
                    email="real@example.com", password="pw12345678", nickname=None
                ),
                user=guest,
                db=_AuthDB(),
            )
        )
        assert guest.id == original_id  # 같은 행 갱신(전환 계약)
        assert guest.region == "울산"  # region 무접촉 — 보존
        assert guest.email == "real@example.com"


# ═══════════════════════════════════════════════════════════════
# 마이그레이션 0010 — revision 체인·downgrade·단일 head (0009 관례)
# ═══════════════════════════════════════════════════════════════


def _load_migration(path: Path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestMigration0010:
    MIGRATION = VERSIONS_DIR / "20260805_0010_user_region.py"

    def test_revision_체인(self):
        module = _load_migration(self.MIGRATION)
        assert module.revision == "0010_user_region"
        assert module.down_revision == "0009_courses"

    def test_downgrade_왕복_정의(self):
        """downgrade 필수(0009 관례) — 실DB 왕복은 PM 게이트."""
        module = _load_migration(self.MIGRATION)
        assert callable(module.upgrade) and callable(module.downgrade)
        source = self.MIGRATION.read_text(encoding="utf-8")
        assert 'op.add_column("users", sa.Column("region"' in source
        assert 'op.drop_column("users", "region")' in source

    def test_단일_head(self):
        """alembic heads가 **하나** — 병렬 번호 충돌 감시(§2).

        체인 끝은 최신 리비전이다(R13-01에서 0011_retry_round가 0010 위로 올라갔다).
        감시 대상은 "head가 갈라지지 않는다"이지 특정 번호가 아니다.
        """
        revisions: dict[str, str | None] = {}
        pattern = re.compile(
            r'^(revision|down_revision)(?::\s*[^=]+)?\s*=\s*(?:"([^"]+)"|None)',
            re.MULTILINE,
        )
        for path in VERSIONS_DIR.glob("*.py"):
            found = dict(
                (kind, value or None)
                for kind, value in pattern.findall(path.read_text(encoding="utf-8"))
            )
            revisions[found["revision"]] = found.get("down_revision")
        referenced = {down for down in revisions.values() if down}
        heads = set(revisions) - referenced
        assert heads == {"0012_two_axis_levels"}
        assert revisions["0011_retry_round"] == "0010_user_region"

    def test_모델_컬럼_계약(self):
        """users.region — nullable String(20), 서버 기본값 없음(NULL=서울는 코드 폴백)."""
        column = User.__table__.columns["region"]
        assert column.nullable is True
        assert column.server_default is None
        assert column.type.length == 20
