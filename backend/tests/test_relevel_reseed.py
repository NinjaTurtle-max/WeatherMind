"""학령 **재신고**가 θ 사전값을 갈아타고 천장이 실제로 움직인다 — `PATCH /auth/me`.

**왜 이 계약이 있나**: 보드 잠금 천장의 유일한 입력은 θ 파생 하나다
(`routers/board.learner_tier` → `weatherbrain_service.overall_knowledge_level`).
그런데 θ에 학령이 들어가는 통로는 `seed_placement`(가입·게스트 발급) **한 번뿐**
이었고, `update_me`는 `level_group`·`level_group_declared_at`만 갱신하고 커밋했다.
⇒ **학령을 다시 신고해도 천장이 한 칸도 안 움직였다.** 잠금 배너 CTA
「학습 수준 바꾸기」(→ `/me`)가 못 지키는 약속이었던 뿌리가 그것이다.

이 파일이 고정하는 계약 4종:
  1. 재신고는 **미측정 개념(n=0)의 θ만** 새 밴드 사전값으로 갈아탄다
  2. **측정된 행(n>0)은 손대지 않는다** — 사전값은 정보가 없을 때의 추정이고
     실제 응답이 이긴다(`decide_route`의 *"n=0은 약점이 아니라 정보 없음"*과 같은 원칙)
  3. 재신고 → `overall_knowledge_level` → `learner_tier` → `locked_tiers`가
     **끝에서 끝까지** 움직인다(잠긴 층이 실제로 줄어든다)
  4. ai-worker 장애에도 `PATCH /auth/me`는 200이고 학령은 저장된다
     (`seed_placement`가 가입을 실패시키지 않는 것과 같은 복원력 관례)

⚠️ **판정 A와 부딪히지 않는다.** 밴드는 여기서 **천장의 규칙**이 아니라 **θ의
입력**이다 — 천장 계산(`learner_tier`)은 여전히 `level_group`을 읽지 않고,
`test_board_progression`의 `test_천장_계산이_학령_밴드를_읽지_않는다`가 무는 자리는
이 작업이 건드리지 않았다. 바뀌는 것은 θ 자신이다.

🔴 **값(2·9 같은 천장 숫자)을 박지 않는다** — `learner_tier` 독스트링이 *"계약은
값을 박지 않는다. 그것은 `seed_placement` 사전값의 파생이라 사전값이 바뀌면
헛운다"*고 적어 둔 그대로다. 기대값은 전부 소유자
(`band_prior_theta` → `theta_to_knowledge_level`)에서 **파생**하거나, 아니면
**상대 이동**(천장이 커진다 · 잠긴 층이 진부분집합이 된다)으로만 문다.

하네스: `_UpsertSim`이 `user_concept_ability` 행을 들고 **컴파일된 문장**에서 값과
`DO UPDATE ... WHERE` 가드를 읽어 postgres upsert 의미론을 재현한다. 소스 텍스트를
읽지 않는 이유는 **주석에 낱말이 있으면 오판하기 때문**이다 — 무는 것은 문장의
동작이지 문자열이 아니다. 가드를 걷어내면 이 파일의 「측정된 행 불변」이 운다.
"""
import asyncio
import re
import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.dialects import postgresql
from sqlalchemy.sql.dml import Insert

from app.core.dependencies import get_current_user, get_db
from app.main import app
from app.models.user import User
from app.routers import auth
from app.routers import board as board_router
from app.services import ai_client
from app.services import weatherbrain_service as wb

TABLE = "user_concept_ability"


# ═══════════════════════════════════════════════════════════════
# 대역 — postgres ON CONFLICT DO UPDATE 의미론 재현
# ═══════════════════════════════════════════════════════════════


def _parse_upsert(stmt) -> tuple[dict, dict, tuple[str, int] | None]:
    """컴파일된 upsert에서 (INSERT 값, DO UPDATE SET 값, 가드)를 뽑는다.

    가드는 `(컬럼명, 비교값)` 또는 None이다. `DO UPDATE`에 이 파일이 모르는 형태의
    WHERE가 붙으면 **조용히 통과시키지 않고** 터뜨린다 — 못 읽은 가드를
    "가드 없음"으로 읽으면 정반대 결론이 난다.
    """
    compiled = stmt.compile(dialect=postgresql.dialect())
    params = compiled.params
    sql = str(compiled).split(" RETURNING ")[0]

    _, _, upsert = sql.partition("DO UPDATE SET ")
    assert upsert, f"DO UPDATE가 없는 문장이다 — 대역이 모르는 형태: {sql}"
    set_sql, _, where_sql = upsert.partition(" WHERE ")

    def _value(expr: str):
        match = re.fullmatch(r"%\((?P<name>\w+)\)s", expr.strip())
        return params[match.group("name")] if match else None

    updates = {}
    for assign in set_sql.split(", "):
        col, _, expr = assign.partition(" = ")
        value = _value(expr)
        if value is not None:  # now() 같은 SQL 함수는 대역이 흉내내지 않는다
            updates[col.strip()] = value

    guard = None
    if where_sql:
        match = re.fullmatch(
            rf"{TABLE}\.(?P<col>\w+) = %\((?P<name>\w+)\)s", where_sql.strip()
        )
        assert match, f"대역이 모르는 DO UPDATE 가드다: {where_sql!r}"
        guard = (match.group("col"), params[match.group("name")])

    return params, updates, guard


class _Result:
    """스칼라 질의 대역 — 닉네임 중복 검사·집계 질의가 여기로 떨어진다."""

    def __init__(self, value=None):
        self._value = value

    def scalar_one_or_none(self):
        return self._value

    def scalar_one(self):
        return self._value


class _UpsertSim:
    """`user_concept_ability` 행을 들고 upsert를 **실제로 적용하는** DB 대역.

    `rows`는 `{concept_tag: {"theta", "theta_se", "num_responses"}}`.
    INSERT가 아닌 문장(set_config·SELECT)은 빈 결과로 흘려보낸다.
    """

    def __init__(self, user: User, rows: dict | None = None):
        self.user = user
        self.rows: dict[str, dict] = {k: dict(v) for k, v in (rows or {}).items()}
        self.commits = 0
        self.upserts = 0
        self.guards: list = []

    async def execute(self, stmt, params=None):
        if not isinstance(stmt, Insert):
            return _Result()
        values, updates, guard = _parse_upsert(stmt)
        self.upserts += 1
        self.guards.append(guard)
        tag = values["concept_tag"]
        existing = self.rows.get(tag)
        if existing is None:
            self.rows[tag] = {
                "theta": values["theta"],
                "theta_se": values["theta_se"],
                "num_responses": values["num_responses"],
            }
            return _Result()
        if guard is not None and existing[guard[0]] != guard[1]:
            return _Result()  # DO UPDATE ... WHERE 불성립 → 행 그대로
        existing.update(updates)
        return _Result()

    async def commit(self):
        self.commits += 1

    async def get(self, model, pk):
        return self.user if pk == self.user.id else None

    def abilities(self) -> list[dict]:
        """`refresh_abilities` 반환 형식 — `overall_theta`가 먹는 모양."""
        return [
            {
                "concept_tag": tag,
                "theta": float(row["theta"]),
                "se": float(row["theta_se"]),
                "n": int(row["num_responses"]),
            }
            for tag, row in sorted(self.rows.items())
        ]


def _user(level_group: str = "elementary", email: str | None = None) -> User:
    user = User(
        email=email or f"u-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="$2b$12$" + "x" * 53,
        nickname=f"n-{uuid.uuid4().hex[:6]}",
        level_group=level_group,
    )
    user.id = uuid.uuid4()
    return user


def _prior_rows(level_group: str, n: int = 0) -> dict:
    """`seed_placement` 직후의 행 — 전 개념이 그 밴드 사전값·n=0."""
    prior = wb.band_prior_theta(level_group)
    return {
        tag: {"theta": prior, "theta_se": 1.0, "num_responses": n}
        for tag in wb.CONCEPT_TAGS
    }


def _placement_stub(level_group_seen: list, se: float = 1.0):
    """ai-worker placement(사전만) 대역 — 신고 밴드의 사전값을 전 개념에 돌려준다."""

    async def _stub(level_group, concept_tags, placement_responses=None):
        level_group_seen.append(level_group)
        prior = wb.band_prior_theta(level_group)
        return {
            "abilities": [
                {"concept_tag": tag, "theta": prior, "se": se, "n": 0}
                for tag in concept_tags
            ]
        }

    return _stub


# ═══════════════════════════════════════════════════════════════
# 1·2 — 미측정만 갈아탄다 / 측정된 행은 이긴다
# ═══════════════════════════════════════════════════════════════


class TestReseedTouchesOnlyUnmeasured:
    """🔴 **이 파일의 존재 이유.** 순진하게 `seed_placement`를 다시 부르면
    `_upsert_abilities`가 `theta`·`theta_se`·`num_responses`를 **조건 없이**
    덮어써 이미 푼 문항의 결과가 사라진다. 그 회귀를 여기서 문다.

    측정된 행 보호를 확인하는 자리는 `_UpsertSim.execute`의 가드 분기다 —
    `DO UPDATE ... WHERE num_responses = 0`이 성립하지 않으면 행을 그대로 둔다.
    가드를 걷으면 대역이 실제로 덮어쓰고 아래 단정이 운다.
    """

    MEASURED = "typhoon"

    def _run(self, new_band: str, old_band: str = "elementary"):
        user = _user(level_group=old_band)
        rows = _prior_rows(old_band)
        rows[self.MEASURED] = {
            "theta": 1.75,  # 실제로 풀어서 얻은 값 — 어느 밴드 사전값도 아니다
            "theta_se": 0.4,
            "num_responses": 12,
        }
        db = _UpsertSim(user, rows)
        user.level_group = new_band
        seen: list = []
        asyncio.run(
            _reseed_with_stub(db, user, _placement_stub(seen))
        )
        return db, seen

    def test_미측정_개념은_새_밴드_사전값으로_갈아탄다(self):
        db, seen = self._run("expert")
        assert seen == ["expert"], "재신고 밴드가 placement에 전달되지 않았다"
        expected = wb.band_prior_theta("expert")
        for tag, row in db.rows.items():
            if tag == self.MEASURED:
                continue
            assert row["theta"] == pytest.approx(expected), (
                f"{tag}: 미측정 개념인데 사전값이 안 바뀌었다 — 재신고가 θ에 "
                f"닿지 않으면 천장도 안 움직인다"
            )

    def test_측정된_행은_한_필드도_안_바뀐다(self):
        db, _ = self._run("expert")
        assert db.rows[self.MEASURED] == {
            "theta": 1.75,
            "theta_se": 0.4,
            "num_responses": 12,
        }, (
            "측정된 θ가 사전값으로 되돌아갔다 — 실제로 푼 문항의 결과가 사라진다. "
            "`_upsert_abilities(only_unmeasured=True)`의 DO UPDATE 가드가 그것을 막는다"
        )

    def test_아래로_재신고해도_측정된_행은_그대로다(self):
        """방향이 반대여도 같다 — 데이터가 이기는 것이지 큰 값이 이기는 게 아니다."""
        db, _ = self._run("elementary", old_band="expert")
        assert db.rows[self.MEASURED]["num_responses"] == 12
        assert db.rows[self.MEASURED]["theta"] == pytest.approx(1.75)

    def test_모든_upsert가_가드를_달고_간다(self):
        db, _ = self._run("adult")
        assert db.upserts == len(wb.CONCEPT_TAGS), "개념 전건에 닿지 않았다"
        assert all(g == ("num_responses", 0) for g in db.guards), (
            f"가드 없는 upsert가 섞였다: {db.guards}"
        )

    def test_행이_없던_개념은_새로_생긴다(self):
        """재신고 시점에 행이 없는 개념(개념 추가 뒤 첫 재신고)은 **생성**된다 —
        가드는 `DO UPDATE`에만 걸리므로 INSERT 자체를 막지 않는다."""
        user = _user(level_group="elementary")
        db = _UpsertSim(user, {})
        user.level_group = "adult"
        asyncio.run(_reseed_with_stub(db, user, _placement_stub([])))
        assert set(db.rows) == set(wb.CONCEPT_TAGS)


def _reseed_with_stub(db, user, stub):
    """`ai_client.weatherbrain_placement`만 대역으로 갈아끼우고 실함수를 부른다."""
    original = ai_client.weatherbrain_placement
    ai_client.weatherbrain_placement = stub
    wb.ai_client.weatherbrain_placement = stub
    try:
        return asyncio.get_event_loop_policy().new_event_loop().run_until_complete(
            wb.reseed_unmeasured_priors(db, user)
        )
    finally:
        ai_client.weatherbrain_placement = original
        wb.ai_client.weatherbrain_placement = original


# ═══════════════════════════════════════════════════════════════
# 3 — 끝에서 끝까지: 재신고 → θ → 천장 → 잠긴 층
# ═══════════════════════════════════════════════════════════════


def _ceiling(db: _UpsertSim, user: User) -> int | None:
    """실경로 그대로 — 저장된 행 → 집계 θ → `overall_knowledge_level` → `learner_tier`.

    집계는 파이썬으로 다시 짜지 않고 **의미의 소유자**(`overall_theta`)에게 묻는다.
    SQL 판과의 정합은 `test_knowledge_level_exposure`가 따로 문다.
    """
    theta = wb.overall_theta(db.abilities())

    class _AggDB:
        async def execute(self, stmt, params=None):
            return _Result(theta)

    return asyncio.run(board_router.learner_tier(_AggDB(), user))


class TestCeilingActuallyMoves:
    """🔴 **약속이 참이 되는 자리.** 「학습 수준 바꾸기」를 눌러 학령을 올리면
    잠긴 층이 실제로 줄어야 한다. 여기가 안 울면 배너 CTA는 문구일 뿐이다."""

    def _reseed(self, db, user, new_band):
        user.level_group = new_band
        asyncio.run(_reseed_with_stub(db, user, _placement_stub([])))

    def test_재신고하면_천장이_올라가고_잠긴_층이_줄어든다(self):
        user = _user("elementary")
        db = _UpsertSim(user, _prior_rows("elementary"))

        before = _ceiling(db, user)
        locked_before = board_router.locked_tiers(before)

        self._reseed(db, user, "expert")

        after = _ceiling(db, user)
        locked_after = board_router.locked_tiers(after)

        assert before is not None and after is not None
        assert after > before, (
            f"학령을 올렸는데 천장이 그대로다({before} → {after}) — "
            "재신고가 θ에 닿지 않으면 이렇게 된다"
        )
        assert locked_after < locked_before, (
            "잠긴 층이 줄지 않았다 — 화면에서는 아무것도 안 열린 것과 같다"
        )

    def test_내려서_재신고하면_천장이_내려간다(self):
        """한 방향만 참인 배선(예: max로만 갱신)을 걸러낸다."""
        user = _user("expert")
        db = _UpsertSim(user, _prior_rows("expert"))
        before = _ceiling(db, user)
        self._reseed(db, user, "elementary")
        after = _ceiling(db, user)
        assert after < before, f"내려 신고했는데 천장이 안 내려갔다({before} → {after})"

    @pytest.mark.parametrize("band", wb.LEVEL_GROUP_BANDS)
    def test_재신고_뒤_천장은_그_밴드_사전값의_파생이다(self, band):
        """값을 박지 않는다 — 기대값을 소유자에서 파생한다."""
        user = _user("middle_high")
        db = _UpsertSim(user, _prior_rows("middle_high"))
        self._reseed(db, user, band)
        expected = wb.theta_to_knowledge_level(wb.band_prior_theta(band))
        assert _ceiling(db, user) == expected

    def test_측정된_θ가_있으면_천장은_데이터를_따른다(self):
        """🔴 판정 A의 반대편 — 재신고가 **측정을 덮어쓰는** 배선이면 여기가 운다.

        n 가중 평균이라 측정된 행(n>0)이 천장을 지배한다. 높은 θ를 측정해 둔
        학습자가 초등으로 재신고해도 천장이 무너지지 않아야 한다.
        """
        user = _user("expert")
        rows = _prior_rows("expert")
        for tag in wb.PLACEMENT_QUIZ_TAGS:
            rows[tag] = {"theta": 2.2, "theta_se": 0.3, "num_responses": 10}
        db = _UpsertSim(user, rows)

        before = _ceiling(db, user)
        self._reseed(db, user, "elementary")
        after = _ceiling(db, user)

        assert after == before, (
            f"측정된 θ가 재신고로 무너졌다({before} → {after}) — 사전값이 데이터를 "
            "이기면 실제로 푼 문항의 결과가 사라진 것이다"
        )


# ═══════════════════════════════════════════════════════════════
# 4 — 라우터 배선과 복원력
# ═══════════════════════════════════════════════════════════════


@pytest.fixture()
def patch_me():
    """`PATCH /auth/me` 왕복 — get_db·get_current_user만 대역(네트워크 차단)."""
    user = _user("elementary")
    db = _UpsertSim(user, _prior_rows("elementary"))
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        yield TestClient(app), db, user
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


class TestPatchMeWiring:
    def test_학령을_바꾸면_θ_행이_실제로_바뀐다(self, patch_me, monkeypatch):
        """배선 계약 — `update_me`가 재파종을 부르지 않으면 여기가 운다."""
        client, db, _ = patch_me
        monkeypatch.setattr(
            ai_client, "weatherbrain_placement", _placement_stub([])
        )
        monkeypatch.setattr(
            wb.ai_client, "weatherbrain_placement", _placement_stub([])
        )
        before = wb.overall_theta(db.abilities())

        resp = client.patch("/api/v1/auth/me", json={"level_group": "expert"})

        assert resp.status_code == 200, resp.text
        assert resp.json()["level_group"] == "expert"
        assert wb.overall_theta(db.abilities()) == pytest.approx(
            wb.band_prior_theta("expert")
        ), f"재신고가 θ에 안 닿았다(그대로 {before})"

    def test_학령과_θ가_같은_커밋에_착지한다(self, patch_me, monkeypatch):
        """커밋이 하나여야 학령만 저장되고 θ는 안 바뀐 중간 상태가 안 생긴다."""
        client, db, _ = patch_me
        monkeypatch.setattr(
            ai_client, "weatherbrain_placement", _placement_stub([])
        )
        monkeypatch.setattr(
            wb.ai_client, "weatherbrain_placement", _placement_stub([])
        )
        client.patch("/api/v1/auth/me", json={"level_group": "adult"})
        assert db.commits == 1, f"커밋이 {db.commits}회 — 학령과 θ가 갈라진다"

    def test_ai_worker가_죽어도_재신고는_200이고_학령은_저장된다(
        self, patch_me, monkeypatch
    ):
        """AC4 — `seed_placement`가 가입을 실패시키지 않는 것과 같은 복원력 관례."""
        client, db, user = patch_me

        async def _down(level_group, concept_tags, placement_responses=None):
            raise ai_client.AIWorkerError("ai-worker down")

        monkeypatch.setattr(ai_client, "weatherbrain_placement", _down)
        monkeypatch.setattr(wb.ai_client, "weatherbrain_placement", _down)
        before = {tag: dict(row) for tag, row in db.rows.items()}

        resp = client.patch("/api/v1/auth/me", json={"level_group": "adult"})

        assert resp.status_code == 200, resp.text
        assert resp.json()["level_group"] == "adult"
        assert user.level_group == "adult"
        assert db.rows == before, "장애 경로에서 θ 행이 건드려졌다"

    def test_RLS_컨텍스트를_주입하고_쓴다(self, patch_me, monkeypatch):
        """user_concept_ability는 RLS 대상이고 get_db는 무RLS 컨텍스트다 —
        register가 seed_placement 앞에서 하는 주입을 재신고 경로도 해야 한다.
        빠지면 실DB에서 WITH CHECK 위반으로 죽는다(대역에서는 안 보인다)."""
        client, db, user = patch_me
        seen: list = []
        original = _UpsertSim.execute

        async def _spy(self, stmt, params=None):
            seen.append((str(stmt), params))
            return await original(self, stmt, params)

        monkeypatch.setattr(_UpsertSim, "execute", _spy)
        monkeypatch.setattr(
            ai_client, "weatherbrain_placement", _placement_stub([])
        )
        monkeypatch.setattr(
            wb.ai_client, "weatherbrain_placement", _placement_stub([])
        )
        client.patch("/api/v1/auth/me", json={"level_group": "adult"})

        set_config_at = [
            i for i, (sql, _) in enumerate(seen) if "set_config" in sql
        ]
        insert_at = [
            i for i, (sql, _) in enumerate(seen) if sql.lstrip().startswith("INSERT")
        ]
        assert set_config_at, "app.current_user_id 주입이 없다 — 실DB RLS에서 죽는다"
        assert insert_at, "θ upsert가 한 건도 없다"
        assert set_config_at[0] < insert_at[0], "주입이 쓰기보다 뒤에 있다"
        assert seen[set_config_at[0]][1] == {"uid": str(user.id)}


class TestJudgementAUntouched:
    """판정 A — 밴드는 **θ의 입력**이지 **천장의 규칙**이 아니다.

    이 파일의 변경이 그 자리를 건드리지 않았음을 여기서도 한 번 더 못박는다
    (원 계약의 소유자는 `test_board_progression`이고 그쪽은 건드리지 않았다).
    """

    def test_천장은_밴드가_아니라_θ만_읽는다(self):
        """같은 밴드라도 θ가 다르면 천장이 다르고, θ가 같으면 밴드가 달라도 같다."""
        low = _user("expert")
        high = _user("expert")
        db_low = _UpsertSim(low, _prior_rows("elementary"))
        db_high = _UpsertSim(high, _prior_rows("expert"))
        assert _ceiling(db_low, low) < _ceiling(db_high, high), (
            "밴드가 같은데 천장이 같다 — 천장이 θ가 아니라 밴드를 읽고 있다"
        )

        same_theta = _UpsertSim(_user("elementary"), _prior_rows("expert"))
        assert _ceiling(same_theta, same_theta.user) == _ceiling(db_high, high), (
            "θ가 같은데 천장이 다르다 — 밴드가 천장 규칙으로 새어 들어왔다"
        )


def test_대역이_실제로_가드를_읽는다():
    """🔴 계측기 자체 검사 — 가드 없는 문장을 대역이 「가드 없음」으로 읽는가.

    이게 없으면 `_parse_upsert`가 가드를 **못 읽었을 뿐인데** 위 단정들이
    통과할 수 있다(가드가 걷혔는지 검사하는 계측기가 항상 '가드 있음'을 반환하는
    경우가 그 반대편이다). 두 방향 모두를 여기서 확인한다.
    """
    from sqlalchemy import text as sa_text
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    from app.models.user_concept_ability import UserConceptAbility

    def _build(guarded: bool):
        extra = (
            {"where": UserConceptAbility.num_responses == 0} if guarded else {}
        )
        return pg_insert(UserConceptAbility).values(
            user_id=uuid.uuid4(),
            concept_tag="typhoon",
            theta=0.0,
            theta_se=1.0,
            num_responses=0,
        ).on_conflict_do_update(
            constraint="uq_user_concept_ability_user_concept",
            set_={
                "theta": 0.0,
                "theta_se": 1.0,
                "num_responses": 0,
                "updated_at": sa_text("now()"),
            },
            **extra,
        )

    assert _parse_upsert(_build(True))[2] == ("num_responses", 0)
    assert _parse_upsert(_build(False))[2] is None


def test_재파종은_seed_placement와_다른_함수다():
    """같은 함수를 재사용하면 가드가 가입 경로까지 번져 배치고사 결과가 안 써진다."""
    assert wb.reseed_unmeasured_priors is not wb.seed_placement
    assert isinstance(
        SimpleNamespace(f=wb.reseed_unmeasured_priors).f.__doc__, str
    )
