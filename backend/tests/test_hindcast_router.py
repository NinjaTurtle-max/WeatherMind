"""과거 예보 API 계약 — /api/v1/hindcast (MT-30).

여기서 지키는 것:
  ① **회차 목록에 정답이 없다** — actual·sum_rn·user_score·ai_score·result·
     explanation·sources가 JSON 어디에도(중첩 포함) 나타나지 않는다.
     문자열 단정이 아니라 **재귀 키 워크**로 본다(test_detective_router 관례) —
     필드를 하나 늘리다 실측을 딸려 보내는 회귀는 눈으로 못 잡는다.
  ② **회차당 1회** — 재제출 409 ALREADY_SUBMITTED. 정답이 고정된 회차라 이 계약이
     없으면 반복 제출로 100점을 만들 수 있다. SELECT 경로와 **UNIQUE 경합 경로**
     둘 다 문다.
  ③ **유저 격리** — 남이 만든 시도가 내 이력·내 already_played에 새지 않는다.
  ④ **채점이 duel 공식 그대로** — 점수를 테스트가 `league_service.accuracy_score`로
     독립 재계산해 대조한다(라우터가 자기 공식을 새로 만들지 않았음을 증명).
  ⑤ **KMA 키·네트워크 무관** — 서비스·라우터가 weather_api를 임포트하지 않는다.
     이 성질이 깨지면 키 없는 심사 환경에서 화면이 빈다.
  ⑥ **픽스처 무결성** — 값마다 출처가 있고, 관측일이 과거이며, case_id가 유일하다.
     「데모용 고정 날짜」라는 고지가 응답에 실제로 담긴다.

DB 왕복이 없는 이유: 백엔드 테스트에 라이브 DB·sqlite 하네스가 없다
(test_board_clear_scope·test_auth_guest의 FakeDB 관례를 따른다). 격리는 실행된
문장의 **바인드 파라미터**로 대역이 필터해 재현한다 — RLS 자체는 실DB 스모크
(`scripts/smoke_r10.sh`)와 `test_rls_role_contract`가 따로 문다.

실행: backend 디렉토리에서 `python -m pytest tests/test_hindcast_router.py -q`.
"""
import asyncio
import uuid
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.dependencies import get_current_user, get_db_with_rls
from app.main import app
from app.models.hindcast_attempt import HindcastAttempt
from app.models.user import User
from app.services import hindcast_service, league_service

APP_DIR = Path(__file__).resolve().parents[1] / "app"

CASES_URL = "/api/v1/hindcast/cases"
ATTEMPTS_URL = "/api/v1/hindcast/attempts"

# 회차 목록에 절대 있으면 안 되는 키 (중첩 포함)
SECRET_KEYS = {
    "actual",
    "sum_rn",
    "user_score",
    "ai_score",
    "result",
    "explanation",
    "sources",
}


def walk_keys(node):
    """중첩 JSON의 모든 키를 훑는다 — 얕은 단정으로는 회귀를 못 잡는다."""
    if isinstance(node, dict):
        for key, value in node.items():
            yield key
            yield from walk_keys(value)
    elif isinstance(node, list):
        for value in node:
            yield from walk_keys(value)


# ═══════════════════════════════════════════════════════════════
# 대역 — FakeDB (바인드 파라미터로 유저·회차를 갈라 격리를 재현한다)
# ═══════════════════════════════════════════════════════════════


class FakeResult:
    def __init__(self, rows):
        self._rows = list(rows)

    def scalars(self):
        return self

    def all(self):
        return list(self._rows)

    def scalar_one_or_none(self):
        return self._rows[0] if self._rows else None


class FakeDB:
    """hindcast 라우터가 쓰는 AsyncSession 표면만 흉내 낸다.

    격리를 재현하려면 실행된 문장을 **구분해서** 답해야 한다. 그래서 컴파일된
    문장의 바인드 값에서 uuid(=user_id)와 문자열(=case_id)을 꺼내 저장된 행을
    필터한다 — 라우터가 `where(user_id == ...)`를 빼면 이 대역에서도 남의 행이
    새어 그 회귀가 드러난다.
    """

    def __init__(self, rows=None, fail_commit=False):
        self.rows: list[HindcastAttempt] = list(rows or [])
        self.added: list = []
        self.commits = 0
        self.rollbacks = 0
        self.fail_commit = fail_commit
        self.executed: list[str] = []

    async def execute(self, stmt, params=None):
        sql = str(stmt)
        self.executed.append(sql)
        bound = stmt.compile().params
        uuids = {v for v in bound.values() if isinstance(v, uuid.UUID)}
        strs = {v for v in bound.values() if isinstance(v, str)}

        # 리그 정산 이력 조회(적응형 캐스터) — 이력 없음 → elo None → stratus
        if "league_results" in sql:
            return FakeResult([])

        if "hindcast_attempts" not in sql:
            return FakeResult([])

        # ⚠️ **바인드된 user_id가 있을 때만** 좁힌다. 무조건 필터하면
        # 라우터가 `where(user_id == ...)`를 빼도 uuids가 비어 결과가 빈 배열이 되고,
        # 격리 테스트가 **공허하게 통과**한다(그 회귀를 못 잡는다). 실DB라면
        # 필터 없는 질의는 전 행을 준다 — 대역도 그렇게 답해야 한다.
        rows = self.rows
        if uuids:
            rows = [r for r in rows if r.user_id in uuids]
        # WHERE에 case_id가 걸린 문장(중복 검사)만 회차로 좁힌다
        if "hindcast_attempts.case_id = " in sql and strs:
            rows = [r for r in rows if r.case_id in strs]

        select_clause = sql.split("FROM")[0]
        if "hindcast_attempts.id" in select_clause:
            return FakeResult(rows)  # 엔티티 전체
        return FakeResult([r.case_id for r in rows])  # case_id 컬럼만

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        if self.fail_commit:
            raise IntegrityError("uq_hindcast_attempts_user_case", {}, Exception())
        self.commits += 1
        self.rows.extend(self.added)
        self.added.clear()

    async def rollback(self):
        self.rollbacks += 1
        self.added.clear()

    async def refresh(self, obj):
        if getattr(obj, "id", None) is None:
            obj.id = uuid.uuid4()  # server_default(gen_random_uuid) 대역
        if getattr(obj, "created_at", None) is None:
            obj.created_at = datetime(2026, 8, 18, tzinfo=timezone.utc)


def make_user() -> User:
    return User(
        id=uuid.uuid4(), email=f"hc-{uuid.uuid4().hex[:8]}@test.invalid",
        level_group="middle_high",
    )


@pytest.fixture()
def user():
    return make_user()


@pytest.fixture()
def db():
    return FakeDB()


@pytest.fixture()
def client(user, db):
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db_with_rls] = lambda: db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_db_with_rls, None)


FIRST_CASE = hindcast_service.HINDCAST_CASES[0]["case_id"]


def predict_url(case_id: str) -> str:
    return f"{CASES_URL}/{case_id}/predict"


# ═══════════════════════════════════════════════════════════════
# 1. 픽스처 무결성 — 값마다 출처가 있는가
# ═══════════════════════════════════════════════════════════════


class TestFixtureIntegrity:
    def test_회차가_하나_이상_있다(self):
        """0건이면 「없음」과 같다 — 이 임무의 최소 착지가 무너진다."""
        assert len(hindcast_service.list_cases()) >= 1

    def test_case_id가_유일하다(self):
        ids = [c["case_id"] for c in hindcast_service.HINDCAST_CASES]
        assert len(ids) == len(set(ids))

    def test_필수_키가_전건_있다(self):
        required = {
            "case_id", "observed_date", "region", "station", "title", "intro",
            "actual", "sources", "caster_base", "explanation",
        }
        for case in hindcast_service.HINDCAST_CASES:
            assert required <= set(case), case["case_id"]

    def test_관측일이_과거다(self):
        """미래 날짜는 「과거 예보」가 아니다 — 실측이 존재할 수 없다."""
        for case in hindcast_service.HINDCAST_CASES:
            assert case["observed_date"] < date.today(), case["case_id"]

    def test_채점_두_축에_각각_출처가_있다(self):
        """출처 없는 값은 「가짜 이력」과 구별되지 않는다 — 이게 이 항목의 핵심 계약."""
        for case in hindcast_service.HINDCAST_CASES:
            assert set(case["sources"]) >= {"temp_max", "sum_rn"}, case["case_id"]
            for axis, note in case["sources"].items():
                assert len(note) > 20, (case["case_id"], axis)

    def test_실측값이_물리적으로_말이_된다(self):
        for case in hindcast_service.HINDCAST_CASES:
            actual = case["actual"]
            assert -60.0 <= actual["temp_max"] <= 60.0, case["case_id"]
            assert actual["sum_rn"] >= 0.0, case["case_id"]

    def test_평년값이_예측_범위_안이다(self):
        """캐스터 기준값이 범위를 벗어나면 캐스터 예측이 클램프로 뭉개진다."""
        for case in hindcast_service.HINDCAST_CASES:
            base = case["caster_base"]
            assert hindcast_service.validate_prediction(
                base["temp_max"], base["rain_prob"]
            ), case["case_id"]

    def test_관측소가_weather_api_지점_목록에_있다(self):
        """픽스처의 station이 이 저장소가 아는 ASOS 지점이어야 나중에 실조회로
        갈아탈 수 있다(키가 생기면 이 픽스처는 그 경로로 대체된다)."""
        from app.services.weather_api import KMA_STATION

        for case in hindcast_service.HINDCAST_CASES:
            assert KMA_STATION.get(case["region"]) == case["station"], case["case_id"]


# ═══════════════════════════════════════════════════════════════
# 2. 채점 — duel 공식 재사용인가 (새 축을 만들지 않았는가)
# ═══════════════════════════════════════════════════════════════


class TestScoring:
    def test_강수_이진화가_celery_정산_규칙과_같다(self):
        """단일 일자에는 강수 '확률'이 없다 — sumRn>0 → 100, 아니면 0
        (celery settle_daily_duel._duel_actual_for_day와 같은 규칙)."""
        for case in hindcast_service.HINDCAST_CASES:
            scoring = hindcast_service.scoring_actual(case)
            expected = 100.0 if case["actual"]["sum_rn"] > 0 else 0.0
            assert scoring["rain_prob"] == expected, case["case_id"]
            assert scoring["temp_max"] == case["actual"]["temp_max"]

    def test_점수가_league_service_공식과_일치한다(self):
        """라우터·서비스가 자기 채점식을 새로 만들지 않았음을 독립 재계산으로 증명."""
        case = hindcast_service.HINDCAST_CASES[0]
        user_pred = {"temp_max": 39.0, "rain_prob": 10}
        ai_pred = {"temp_max": 30.0, "rain_prob": 60}
        user_score, ai_score, result = hindcast_service.grade(case, user_pred, ai_pred)

        actual = hindcast_service.scoring_actual(case)
        assert user_score == league_service.accuracy_score(user_pred, actual)
        assert ai_score == league_service.accuracy_score(ai_pred, actual)
        assert result == "win"  # 39.0이 30.0보다 39.6에 가깝다

    def test_캐스터가_결정적이다(self):
        """같은 (유저·회차)는 항상 같은 예측 — duel의 재현성 계약을 그대로 물려받는다."""
        case = hindcast_service.HINDCAST_CASES[0]
        uid = uuid.uuid4()
        first = hindcast_service.caster_prediction(case, uid, None)
        second = hindcast_service.caster_prediction(case, uid, None)
        assert first == second

    def test_유저가_다르면_캐스터_예측도_갈린다(self):
        case = hindcast_service.HINDCAST_CASES[0]
        a = hindcast_service.caster_prediction(case, uuid.uuid4(), None)
        b = hindcast_service.caster_prediction(case, uuid.uuid4(), None)
        assert a != b

    def test_티어가_높으면_노이즈_배율이_작다(self):
        """적응형 캐스터(R9-01 §3.2)를 duel과 같은 함수로 탄다."""
        case = hindcast_service.HINDCAST_CASES[0]
        uid = uuid.uuid4()
        stratus = hindcast_service.caster_prediction(case, uid, None)
        typhoon = hindcast_service.caster_prediction(case, uid, 1600)
        assert typhoon["noise_scale"] < stratus["noise_scale"]

    def test_평년값만_낸_캐스터는_기록적인_날에_크게_틀린다(self):
        """이 회차가 학습 소재가 되는 근거 — 평년값으로는 극값을 못 맞힌다."""
        case = hindcast_service.HINDCAST_CASES[0]
        actual = hindcast_service.scoring_actual(case)
        base_score = league_service.accuracy_score(case["caster_base"], actual)
        assert base_score < 50.0


# ═══════════════════════════════════════════════════════════════
# 3. 무키 동작 — 외부 호출이 0인가
# ═══════════════════════════════════════════════════════════════


class TestNoExternalDependency:
    MODULES = ("services/hindcast_service.py", "routers/hindcast.py")

    @staticmethod
    def _imported_names(path: Path) -> set[str]:
        """실제 import 문만 본다 — 주석·독스트링의 언급은 세지 않는다.

        (서비스 독스트링은 왜 픽스처인지 설명하며 `get_past_observation`을
        **인용**한다. 문자열 검색으로 막으면 그 설명을 지워야 하고, 설명이
        사라지면 다음 사람이 같은 조사를 처음부터 다시 한다.)
        """
        import ast

        tree = ast.parse(path.read_text(encoding="utf-8"))
        names: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names.update(a.name for a in node.names)
            elif isinstance(node, ast.ImportFrom):
                names.add(node.module or "")
                names.update(a.name for a in node.names)
        return names

    def test_서비스와_라우터가_weather_api를_임포트하지_않는다(self):
        """KMA 키가 없는 심사 환경에서도 같은 화면이 나와야 한다. 이 성질이
        깨지면(과거관측 실조회를 섞으면) 키 없는 환경에서 회차가 빈다."""
        for name in self.MODULES:
            names = self._imported_names(APP_DIR / name)
            assert "app.services.weather_api" not in names, name
            assert "get_past_observation" not in names, name

    def test_LLM_경로가_없다(self):
        for name in self.MODULES:
            names = self._imported_names(APP_DIR / name)
            assert not any("ai_client" in n for n in names), name


# ═══════════════════════════════════════════════════════════════
# 4. GET /cases — 정답 비공개 + 고지
# ═══════════════════════════════════════════════════════════════


class TestListCases:
    def test_목록이_활성_회차만_준다(self, client):
        """**활성분만**이다(2026-08-19 PM 판정으로 seoul-2022-08-08 보류).
        보류된 회차가 목록에 뜨면 제외한 의미가 없다."""
        res = client.get(CASES_URL)
        assert res.status_code == 200
        body = res.json()
        assert len(body["cases"]) == len(hindcast_service.list_cases())

    def test_보류_회차는_응답에_없다(self, client):
        """id도 실측 기온도 본문에 나오지 않는다."""
        raw = client.get(CASES_URL).text
        for case in hindcast_service.HINDCAST_CASES:
            if hindcast_service.is_enabled(case):
                continue
            assert case["case_id"] not in raw, case["case_id"]
            assert str(case["actual"]["temp_max"]) not in raw, case["case_id"]

    def test_보류_회차_제출은_404(self, client):
        """화면에서 감추는 것만으로는 URL을 직접 치는 경로가 남는다 —
        채점 권위가 서버이므로 서버가 막아야 한다."""
        disabled = [
            c for c in hindcast_service.HINDCAST_CASES
            if not hindcast_service.is_enabled(c)
        ]
        for case in disabled:
            res = client.post(
                predict_url(case["case_id"]), json={"temp_max": 27.0, "rain_prob": 90}
            )
            assert res.status_code == 404, case["case_id"]
            assert res.json()["code"] == "CASE_NOT_FOUND"

    def test_실측도_해설도_출처도_없다(self, client):
        """★핵심 — 재귀 키 워크로 본다."""
        body = client.get(CASES_URL).json()
        leaked = SECRET_KEYS & set(walk_keys(body))
        assert not leaked, f"회차 목록에 정답이 샜다: {leaked}"

    def test_실측_숫자가_본문에_문자열로도_안_나온다(self, client):
        """필드명을 피해 값만 흘리는 회귀까지 막는다."""
        raw = client.get(CASES_URL).text
        for case in hindcast_service.HINDCAST_CASES:
            assert str(case["actual"]["temp_max"]) not in raw, case["case_id"]

    def test_데모용_고정_날짜임을_응답이_밝힌다(self, client):
        """화면만 고지하면 API를 직접 보는 심사자에게 그 사실이 닿지 않는다."""
        body = client.get(CASES_URL).json()
        assert body["disclosure"] == hindcast_service.DISCLOSURE
        for case in body["cases"]:
            assert case["is_demo_fixture"] is True
            assert case["disclosure"] == hindcast_service.DISCLOSURE

    def test_평년값은_공개한다(self, client):
        """실측이 아니라 판단 재료다 — duel의 base_forecast와 같은 위치."""
        body = client.get(CASES_URL).json()
        assert body["cases"][0]["climatology"]["temp_max"] > 0

    def test_미제출_회차는_already_played_false(self, client):
        body = client.get(CASES_URL).json()
        assert all(c["already_played"] is False for c in body["cases"])

    def test_제출한_회차만_already_played_true(self, client, user, db):
        db.rows.append(
            HindcastAttempt(
                id=uuid.uuid4(), user_id=user.id, case_id=FIRST_CASE,
                user_pred={}, ai_pred={}, actual={}, user_score=1, ai_score=1,
                result="win",
            )
        )
        body = client.get(CASES_URL).json()
        played = {c["case_id"]: c["already_played"] for c in body["cases"]}
        assert played[FIRST_CASE] is True
        assert all(v is False for k, v in played.items() if k != FIRST_CASE)


# ═══════════════════════════════════════════════════════════════
# 5. POST predict — 경계·중복·판정
# ═══════════════════════════════════════════════════════════════


class TestSubmit:
    def test_없는_회차는_404(self, client):
        res = client.post(predict_url("no-such-case"), json={"temp_max": 30, "rain_prob": 50})
        assert res.status_code == 404
        assert res.json()["code"] == "CASE_NOT_FOUND"

    @pytest.mark.parametrize(
        "payload",
        [
            {"temp_max": 999.0, "rain_prob": 50},
            {"temp_max": -999.0, "rain_prob": 50},
            {"temp_max": 30.0, "rain_prob": 101},
            {"temp_max": 30.0, "rain_prob": -1},
        ],
    )
    def test_범위_밖은_422_INVALID_PREDICTION(self, client, payload):
        res = client.post(predict_url(FIRST_CASE), json=payload)
        assert res.status_code == 422
        assert res.json()["code"] == "INVALID_PREDICTION"

    def test_제출하면_실측과_점수와_출처가_공개된다(self, client):
        res = client.post(predict_url(FIRST_CASE), json={"temp_max": 39.0, "rain_prob": 10})
        assert res.status_code == 200
        body = res.json()
        assert body["result"] in {"win", "lose", "draw"}
        assert body["actual"]["temp_max"] == FIRST_CASE_TEMP
        assert body["sources"]["temp_max"]
        assert body["explanation"]
        assert body["ai_pred"]["noise_scale"] is not None

    def test_점수가_서버_공식과_일치한다(self, client):
        """클라이언트가 점수를 못 넣는다 — 요청에 그 필드가 없고, 응답 점수는
        서버 공식의 재계산과 정확히 같다."""
        user_pred = {"temp_max": 39.0, "rain_prob": 10}
        body = client.post(predict_url(FIRST_CASE), json=user_pred).json()
        case = hindcast_service.get_case(FIRST_CASE)
        expected = league_service.accuracy_score(
            user_pred, hindcast_service.scoring_actual(case)
        )
        assert body["user_score"] == expected

    def test_점수_주입_시도가_무시된다(self, client):
        """본문에 점수·실측을 끼워 넣어도 스키마가 버린다(채점 권위 서버)."""
        body = client.post(
            predict_url(FIRST_CASE),
            json={
                "temp_max": 39.0, "rain_prob": 10,
                "user_score": 100.0, "ai_score": 0.0, "result": "win",
                "actual": {"temp_max": 39.0, "rain_prob": 10},
            },
        ).json()
        case = hindcast_service.get_case(FIRST_CASE)
        expected = league_service.accuracy_score(
            {"temp_max": 39.0, "rain_prob": 10},
            hindcast_service.scoring_actual(case),
        )
        assert body["user_score"] == expected != 100.0

    def test_행이_저장된다(self, client, db, user):
        client.post(predict_url(FIRST_CASE), json={"temp_max": 39.0, "rain_prob": 10})
        assert db.commits == 1
        assert len(db.rows) == 1
        assert db.rows[0].user_id == user.id
        assert db.rows[0].case_id == FIRST_CASE

    def test_재제출은_409(self, client):
        first = client.post(predict_url(FIRST_CASE), json={"temp_max": 39.0, "rain_prob": 10})
        assert first.status_code == 200
        second = client.post(predict_url(FIRST_CASE), json={"temp_max": 20.0, "rain_prob": 90})
        assert second.status_code == 409
        assert second.json()["code"] == "ALREADY_SUBMITTED"

    def test_경합_UNIQUE_위반도_409(self, user):
        """SELECT-then-INSERT가 놓치는 동시 제출 경로 — IntegrityError → 409."""
        db = FakeDB(fail_commit=True)
        app.dependency_overrides[get_current_user] = lambda: user
        app.dependency_overrides[get_db_with_rls] = lambda: db
        try:
            res = TestClient(app).post(
                predict_url(FIRST_CASE), json={"temp_max": 39.0, "rain_prob": 10}
            )
        finally:
            app.dependency_overrides.pop(get_current_user, None)
            app.dependency_overrides.pop(get_db_with_rls, None)
        assert res.status_code == 409
        assert res.json()["code"] == "ALREADY_SUBMITTED"
        assert db.rollbacks == 1


# ═══════════════════════════════════════════════════════════════
# 6. GET /attempts — 빈 이력 · 격리
# ═══════════════════════════════════════════════════════════════


class TestAttempts:
    def test_대역이_필터_없는_질의에는_전_행을_준다(self):
        """**격리 테스트의 비공허성을 지키는 자리.**

        FakeDB가 user_id를 무조건 필터하면, 라우터에서 `where(user_id == ...)`를
        빼도 바인드 값이 없어 결과가 빈 배열이 되고 아래 격리 테스트가 **공허하게
        통과**한다(회귀를 못 잡는다). 실DB라면 필터 없는 질의는 전 행을 주므로
        대역도 그렇게 답해야 한다 — 그 성질을 여기서 못박는다.
        """
        row = HindcastAttempt(
            id=uuid.uuid4(), user_id=uuid.uuid4(), case_id=FIRST_CASE,
            user_pred={}, ai_pred={}, actual={}, user_score=1, ai_score=1,
            result="win",
        )
        db = FakeDB(rows=[row])
        unfiltered = select(HindcastAttempt).order_by(
            HindcastAttempt.created_at.desc()
        )
        result = asyncio.run(db.execute(unfiltered))
        assert result.scalars().all() == [row]

    def test_빈_이력은_빈_배열(self, client):
        res = client.get(ATTEMPTS_URL)
        assert res.status_code == 200
        assert res.json()["attempts"] == []

    def test_내_시도가_이력에_보인다(self, client):
        client.post(predict_url(FIRST_CASE), json={"temp_max": 39.0, "rain_prob": 10})
        body = client.get(ATTEMPTS_URL).json()
        assert [a["case_id"] for a in body["attempts"]] == [FIRST_CASE]
        assert body["attempts"][0]["sources"]["temp_max"]

    def test_남의_기록은_내_이력에_안_보인다(self, user, db):
        """★핵심 격리 — 라우터가 user_id 필터를 빼면 이 단정이 깨진다."""
        stranger = make_user()
        db.rows.append(
            HindcastAttempt(
                id=uuid.uuid4(), user_id=stranger.id, case_id=FIRST_CASE,
                user_pred={"temp_max": 1, "rain_prob": 1},
                ai_pred={"temp_max": 1, "rain_prob": 1},
                actual={"temp_max": 1, "rain_prob": 1}, user_score=100,
                ai_score=0, result="win",
                created_at=datetime(2026, 8, 17, tzinfo=timezone.utc),
            )
        )
        app.dependency_overrides[get_current_user] = lambda: user
        app.dependency_overrides[get_db_with_rls] = lambda: db
        try:
            client = TestClient(app)
            assert client.get(ATTEMPTS_URL).json()["attempts"] == []
            # 남의 시도가 내 already_played를 켜지도 않는다
            cases = client.get(CASES_URL).json()["cases"]
            assert all(c["already_played"] is False for c in cases)
        finally:
            app.dependency_overrides.pop(get_current_user, None)
            app.dependency_overrides.pop(get_db_with_rls, None)

    def test_남의_회차를_지목해_제출해도_내_행이_된다(self, client, db, user):
        """case_id는 픽스처 id이고 유저 스코프가 아니다 — 남의 행을 건드릴 통로가
        요청에 없다는 것을 확인한다."""
        client.post(predict_url(FIRST_CASE), json={"temp_max": 39.0, "rain_prob": 10})
        assert all(r.user_id == user.id for r in db.rows)


# ═══════════════════════════════════════════════════════════════
# 7. 인증 — 오버라이드 없이는 열리지 않는다
# ═══════════════════════════════════════════════════════════════


class TestAuthRequired:
    @pytest.mark.parametrize("url", [CASES_URL, ATTEMPTS_URL])
    def test_GET은_토큰_없으면_401(self, url):
        app.dependency_overrides.clear()
        assert TestClient(app).get(url).status_code == 401

    def test_POST은_토큰_없으면_401(self):
        app.dependency_overrides.clear()
        res = TestClient(app).post(
            predict_url(FIRST_CASE), json={"temp_max": 30.0, "rain_prob": 50}
        )
        assert res.status_code == 401

    def test_전_엔드포인트가_인증과_RLS_세션을_요구한다(self):
        """엔드포인트 수만큼 두 의존이 선언된다(test_dev_mode 관례)."""
        from app.routers import hindcast as hindcast_router

        src = (APP_DIR / "routers" / "hindcast.py").read_text(encoding="utf-8")
        n = len(hindcast_router.router.routes)
        assert src.count("Depends(get_current_user)") == n
        assert src.count("Depends(get_db_with_rls)") == n


FIRST_CASE_TEMP = hindcast_service.HINDCAST_CASES[0]["actual"]["temp_max"]
