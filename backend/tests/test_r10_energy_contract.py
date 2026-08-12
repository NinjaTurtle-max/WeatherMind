"""R10-01 §3.1 웨이브 0 — 구현 전 "빨간" 에너지 정책 계약 테스트.

새 계약: 구름은 **노력이 아니라 실수에 소모된다**. 정답·재제출(멱등 히트)·
배치고사는 0 소모, 오답(보드 미통과 포함)만 1 소모. 대신 **문항을 열기 전에**
잔량을 검사해 부족하면 429 OUT_OF_CLOUDS로 차단하고, 이미 발급된 세션의 진행 중
문항은 절대 차단하지 않는다("풀던 것을 뺏기지 않는다" 불변식 — §3.1 각주 7).

이 파일은 웨이브 0에서 **구현보다 먼저** 작성되며, 아래 신규 API가 없으므로
대부분의 테스트는 AttributeError로 실패한다(의도된 빨간 상태). 웨이브 1에서
energy_service에 다음이 추가되면 초록으로 전환된다:

- should_consume(*, is_correct, already_answered=False, is_placement=False) -> bool
- require_entry(db, user, now=None) -> dict            (진입 게이트, 무소모)
- consume_if_available(db, user, now=None) -> int      (가드 UPDATE, 0행이면 무예외)
- 기존 순수함수 4종(regen_amount·apply_regen·next_regen_sec·plan_consume) 불변

계약 번호는 스프린트 §3.1 "테스트(신규 계약 테스트)" 8항목 + PM 확정 설계
(호출 위치·라우트 실재)를 통합한 1~14번을 쓴다. 각 테스트 docstring 첫 줄에
`[계약 N]`으로 표기한다.

관례: DB·HTTP 통합 하네스를 도입하지 않는다 — 순수 함수 + FakeDB 대역 +
소스 텍스트 가드(test_placement_bulk·test_unit_pool_theta·test_error_code_contract).
신규 이름은 모듈 최상단에서 import하지 않는다(collection 에러로 파일 전체가 죽는 것
방지 — `es.<신규이름>` 접근으로 개별 테스트만 AttributeError로 실패시킨다).
"""
import asyncio
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import Update

from app.core.config import settings
from app.services import energy_service as es

BACKEND_APP = Path(__file__).resolve().parents[1] / "app"
NOW = datetime(2026, 8, 1, 12, 0, 0, tzinfo=timezone.utc)


def _ago(minutes: float) -> datetime:
    return NOW - timedelta(minutes=minutes)


# ═══════════════════════════════════════════════════════════════
# 대역 (test_placement_bulk.FakeDB 관례)
# ═══════════════════════════════════════════════════════════════


class FakeResult:
    def __init__(self, scalar=None):
        self._scalar = scalar

    def scalar_one_or_none(self):
        return self._scalar

    def scalar_one(self):
        return self._scalar

    def scalar(self):
        return self._scalar

    def scalars(self):
        return self

    def first(self):
        return self._scalar


class FakeDB:
    """실행 statement 수집 대역.

    guarded_remaining: 가드된 원자 UPDATE(`... RETURNING users.clouds`)가 돌려줄
    잔량. None이면 **0행 반환**(경합·소진) 분기를 재현한다 — §3.1 각주 7의
    "예외 없이 정상 응답" 계약을 검증하는 지점.
    refetch_clouds: 0행 분기에서 **DB 실측 재조회**(PM 판정, 웨이브 0 회신)가
    읽어갈 행의 clouds 값. 재조회는 SELECT 또는 db.refresh 어느 쪽으로 구현해도
    같은 값을 보게 한다(구현 자유, 반환값만 계약).
    """

    def __init__(
        self,
        guarded_remaining: int | None = None,
        refetch_clouds: int | None = None,
    ):
        self.executed: list = []
        self.guarded_remaining = guarded_remaining
        self.refetch_clouds = refetch_clouds
        self.refreshed: list = []

    async def execute(self, stmt):
        self.executed.append(stmt)
        if isinstance(stmt, Update):
            if "returning" in str(stmt).lower():
                return FakeResult(self.guarded_remaining)
            return FakeResult(None)
        # SELECT = 0행 분기의 실측 재조회
        return FakeResult(self.refetch_clouds)

    async def refresh(self, obj, attribute_names=None):
        self.refreshed.append(attribute_names)
        if self.refetch_clouds is not None:
            obj.clouds = self.refetch_clouds

    async def flush(self):  # pragma: no cover - 인터페이스 호환용
        pass

    def add(self, obj):  # pragma: no cover - 인터페이스 호환용
        pass

    def selects(self) -> list:
        return [stmt for stmt in self.executed if not isinstance(stmt, Update)]

    def updates_on(self, table_name: str) -> list:
        return [
            stmt
            for stmt in self.executed
            if isinstance(stmt, Update) and stmt.table.name == table_name
        ]

    def guarded_decrements(self) -> list:
        """`WHERE clouds >= COST` 가드가 붙은 clouds 감소 UPDATE만 골라낸다."""
        out = []
        for stmt in self.updates_on("users"):
            sql = str(stmt).lower()
            if "users.clouds >=" in sql and "users.clouds -" in sql:
                out.append(stmt)
        return out

    def clouds_writes(self) -> list[int]:
        """clouds에 **상수**를 쓴 UPDATE의 값 목록(회복 반영분 판별용)."""
        values = []
        for stmt in self.updates_on("users"):
            params = stmt.compile().params
            if "clouds" in params:
                values.append(params["clouds"])
        return values


def make_user(clouds: int, updated_at: datetime | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(), clouds=clouds, clouds_updated_at=updated_at
    )


def _source(rel: str) -> str:
    return (BACKEND_APP / rel).read_text(encoding="utf-8")


def _func_block(source: str, name: str) -> str:
    """`async def name(` 부터 다음 최상위 정의 직전까지의 소스 슬라이스.

    함수명 자체가 계약이므로(예: `get_puzzle_detail`), 부재는 ValueError가 아니라
    읽히는 AssertionError로 실패시킨다.
    """
    marker = f"async def {name}("
    assert marker in source, (
        f"`{marker}` 핸들러가 없다 — 함수명도 계약이다(웨이브 1은 이 이름을 쓴다). "
        "이름이 바뀌면 이 테스트가 잡는 호출 위치 가드가 전부 무력해진다"
    )
    start = source.index(f"async def {name}(")
    rest = source[start + 1 :]
    ends = [
        rest.index(marker)
        for marker in ("\nasync def ", "\ndef ", "\n@router", "\n@limiter")
        if marker in rest
    ]
    return rest[: min(ends)] if ends else rest


def _positions(block: str, needle: str) -> list[int]:
    return [m.start() for m in re.finditer(re.escape(needle), block)]


# ═══════════════════════════════════════════════════════════════
# 계약 1~5 · 소모 트리거 (순수 판정)
# ═══════════════════════════════════════════════════════════════


class TestShouldConsumeTruthTable:
    """소모 트리거는 순수 판정으로 분리한다 — 라우터 3곳이 같은 규칙을 공유."""

    def test_계약1_정답_제출은_무소모(self):
        """[계약 1] 정답 제출 시 clouds 불변 — 노력에는 과금하지 않는다."""
        assert es.should_consume(is_correct=True) is False, (
            "정답에 구름을 소모하면 §3.1 신규 계약 위반 "
            "(구 계약: 시도당 소모 → 신 계약: 오답만 소모)"
        )

    def test_계약2_오답_제출은_소모(self):
        """[계약 2] 오답 제출 시 정확히 1 소모 대상."""
        assert es.should_consume(is_correct=False) is True, (
            "오답은 유일한 소모 트리거 — False면 에너지 자원이 무의미해진다"
        )

    def test_계약3_재제출_멱등_히트는_무소모(self):
        """[계약 3] 재제출(409 멱등 히트)은 0 — 정오답 무관."""
        assert es.should_consume(is_correct=False, already_answered=True) is False, (
            "이미 채점된 로그의 재제출은 새 시도가 아니므로 소모 금지"
        )
        assert es.should_consume(is_correct=True, already_answered=True) is False

    def test_계약4_배치고사는_무소모(self):
        """[계약 4] mode='placement' 제출은 정오답 무관 0 (기존 면제 승계)."""
        assert es.should_consume(is_correct=False, is_placement=True) is False, (
            "배치고사 오답에 소모하면 신규 유저가 6문항을 못 끝내 초기 θ가 안 선다"
        )
        assert es.should_consume(is_correct=True, is_placement=True) is False

    @pytest.mark.parametrize(
        "is_correct,already_answered,is_placement,expected",
        [
            (False, False, False, True),   # 유일한 True 조합
            (True, False, False, False),
            (False, True, False, False),
            (False, False, True, False),
            (True, True, False, False),
            (True, False, True, False),
            (False, True, True, False),
            (True, True, True, False),
        ],
    )
    def test_계약1_4_진리표_8조합_전수(
        self, is_correct, already_answered, is_placement, expected
    ):
        """[계약 1·2·3·4] `not is_correct and not already and not placement`만 True."""
        assert (
            es.should_consume(
                is_correct=is_correct,
                already_answered=already_answered,
                is_placement=is_placement,
            )
            is expected
        ), (
            f"진리표 위반: is_correct={is_correct}, already={already_answered}, "
            f"placement={is_placement} → {expected} 이어야 한다"
        )

    def test_계약5_보드_통과는_0_미통과는_1(self):
        """[계약 5] 보드는 already_answered=False·is_placement=False로 호출된다.

        보드 attempt에는 멱등 가드가 없고 placement 경로도 없으므로 판정 결과
        (passed)만이 소모를 결정한다 — 통과 0 / 미통과 1.
        """
        assert (
            es.should_consume(
                is_correct=True, already_answered=False, is_placement=False
            )
            is False
        ), "보드 통과(passed=True)에 소모하면 §3.1 위반"
        assert (
            es.should_consume(
                is_correct=False, already_answered=False, is_placement=False
            )
            is True
        ), "보드 미통과(passed=False)는 소모 1"

    def test_계약1_5_키워드_전용_시그니처(self):
        """[계약 1~5] 위치인자 오사용(정오답·멱등 혼동) 방지 — keyword-only."""
        with pytest.raises(TypeError):
            es.should_consume(False)


# ═══════════════════════════════════════════════════════════════
# 계약 2·7 · consume_if_available (가드된 원자 소모)
# ═══════════════════════════════════════════════════════════════


class TestConsumeIfAvailable:
    def test_계약2_오답_소모는_clouds_1_감소_가드_UPDATE(self):
        """[계약 2] 잔량이 있으면 `WHERE clouds >= COST` 가드 UPDATE로 1 감소."""
        db = FakeDB(guarded_remaining=2)
        user = make_user(3, _ago(5))
        remaining = asyncio.run(es.consume_if_available(db, user, NOW))

        decrements = db.guarded_decrements()
        assert len(decrements) == 1, (
            "가드된 원자 감소 UPDATE가 정확히 1건이어야 한다 "
            f"(동시 요청 lost update 방지) — 실제 {len(decrements)}건"
        )
        assert es.CLOUD_COST in decrements[0].compile().params.values(), (
            f"감소량이 CLOUD_COST({es.CLOUD_COST})가 아니다 — 계약 수치 드리프트"
        )
        assert remaining == 2, f"소모 후 잔량 반환 계약 위반 (got {remaining})"
        assert user.clouds == 2, "세션 내 user 객체도 소모 결과로 동기화되어야 한다"

    def test_계약7_잔량0에서_소모는_예외없이_0반환(self):
        """[계약 7] 잔량 0 + 미회복이면 **429 없이** 0을 반환한다(음수 불가).

        진행 중 세션의 마지막 문항을 오답으로 제출한 경우 — 소모는 생략하되
        응답은 200이어야 한다(§3.1 각주 7). 기존 consume()의 OutOfCloudsError
        동작과 정반대라는 점이 이 전환의 핵심.
        """
        db = FakeDB(guarded_remaining=None)  # 가드 UPDATE 0행
        user = make_user(0, _ago(5))
        remaining = asyncio.run(es.consume_if_available(db, user, NOW))
        assert remaining == 0, (
            f"잔량 0에서 소모는 0을 반환해야 한다 (got {remaining}) — 음수 불가"
        )
        assert user.clouds == 0, "음수 잔량이 유저 객체에 남으면 안 된다"

    def test_계약7_가드_UPDATE_0행이면_DB_실측_재조회값_반환(self):
        """[계약 7] 0행이면 그 행의 clouds를 **재조회**해 반환한다 (PM 판정).

        기존 consume()은 이 분기에서 방어적으로 429를 던졌다
        (energy_service.py:204~207) — 신규 계약은 진행 중 세션을 끊지 않기 위해
        소모를 생략하고 정상 반환한다. 반환값은 in-memory 잔량이 아니라 DB 실측:
        여기서는 세션 캐시가 3으로 stale인데 실제 행은 0이므로, 3을 돌려주면
        재조회를 안 한 것이 드러난다.
        """
        db = FakeDB(guarded_remaining=None, refetch_clouds=0)
        user = make_user(3, _ago(0))  # stale 캐시(실제 행은 0)
        remaining = asyncio.run(es.consume_if_available(db, user, NOW))
        assert remaining == 0, (
            f"0행 분기가 stale in-memory 값을 반환했다 (got {remaining}, 실측 0) "
            "— 가드 실패 후에는 DB 행을 재조회해야 한다"
        )
        assert user.clouds == 0, (
            f"user.clouds가 재조회 값으로 동기화되지 않았다 (got {user.clouds})"
        )

    def test_계약7_0을_하드코딩하지_않는다_COST_2(self, monkeypatch):
        """[계약 7] COST가 env로 2 이상이면 0행 분기의 잔량도 0이 아니다 (PM 판정).

        가드는 `clouds >= CLOUD_COST` 이므로 COST=2·잔량=1이면 0행이 나오지만
        실제 잔량은 1이다. `return 0` 하드코딩은 이 케이스에서 구름을 삼킨다.

        범위 주의: 0행 분기 진입은 대역(`guarded_remaining=None`)이 강제하므로
        COST=2 설정 자체는 비-하중이다. 이 테스트의 검증 대상은 **재조회값을
        그대로 반환하는가**(0 하드코딩 여부) 하나다.
        """
        monkeypatch.setattr(es, "CLOUD_COST", 2)
        db = FakeDB(guarded_remaining=None, refetch_clouds=1)
        user = make_user(1, _ago(0))
        remaining = asyncio.run(es.consume_if_available(db, user, NOW))
        assert remaining == 1, (
            f"COST=2·잔량=1의 0행 분기에서 {remaining}을 반환했다 — 0 하드코딩 "
            "의심(실측 재조회 계약 위반)"
        )

    def test_계약7_어떤_경우도_음수_불가(self):
        """[계약 7] 반환값·user.clouds는 항상 0 이상이다."""
        for clouds, refetch in ((0, 0), (1, 0), (3, 0), (0, None)):
            db = FakeDB(guarded_remaining=None, refetch_clouds=refetch)
            user = make_user(clouds, _ago(0))
            remaining = asyncio.run(es.consume_if_available(db, user, NOW))
            assert remaining >= 0, (
                f"clouds={clouds}·refetch={refetch}에서 음수 반환 ({remaining})"
            )
            assert user.clouds >= 0, f"user.clouds 음수 ({user.clouds})"

    def test_계약7_소모는_OutOfClouds를_던지지_않는다(self):
        """[계약 7] 어떤 잔량에서도 소모 경로는 429를 유발하지 않는다."""
        for clouds in (0, 1, es.CLOUD_MAX):
            db = FakeDB(guarded_remaining=max(0, clouds - es.CLOUD_COST))
            user = make_user(clouds, _ago(0))
            try:
                asyncio.run(es.consume_if_available(db, user, NOW))
            except es.OutOfCloudsError as exc:  # pragma: no cover - 계약 위반 시만
                pytest.fail(
                    f"clouds={clouds}에서 소모가 OutOfCloudsError를 던졌다 "
                    f"({exc}) — 차단은 진입 게이트(require_entry)의 책임이다"
                )

    def test_계약10_ENERGY_비활성이면_소모는_no_op(self, monkeypatch):
        """[계약 10] ENERGY_ENABLED=False → DB 무접근·CLOUD_MAX 반환."""
        monkeypatch.setattr(es.settings, "ENERGY_ENABLED", False)
        db = FakeDB(guarded_remaining=None)
        user = make_user(0, _ago(0))
        assert asyncio.run(es.consume_if_available(db, user, NOW)) == es.CLOUD_MAX
        assert db.executed == [], (
            "무제한 모드에서 UPDATE가 나가면 안 된다 (기존 consume 전례)"
        )


# ═══════════════════════════════════════════════════════════════
# 계약 6·9·10 · require_entry (진입 게이트)
# ═══════════════════════════════════════════════════════════════


class TestRequireEntry:
    def test_계약6_잔량0이면_OutOfClouds와_next_regen_sec_양수(self):
        """[계약 6] 잔량 0 진입은 429 OUT_OF_CLOUDS + next_regen_sec>0."""
        db = FakeDB()
        user = make_user(0, _ago(5))
        with pytest.raises(es.OutOfCloudsError) as ei:
            asyncio.run(es.require_entry(db, user, NOW))
        assert ei.value.next_regen_sec > 0, (
            "next_regen_sec=0이면 프론트가 '구름 회복까지 N분'을 표기할 수 없다"
        )
        assert ei.value.next_regen_sec == 15 * 60, (
            "5분 경과 → 다음 회복까지 15분 (지연 회복 모델 불변)"
        )

    def test_계약6_회복으로_충족되면_통과(self):
        """[계약 6] 잔량 0이지만 20분 경과면 회복 1 반영 후 진입 허용."""
        db = FakeDB()
        user = make_user(0, _ago(20))
        state = asyncio.run(es.require_entry(db, user, NOW))
        assert state["clouds"] == 1, (
            f"지연 회복이 진입 판정 전에 반영되어야 한다 (got {state})"
        )

    def test_계약6_반환_형식은_get_state와_동일(self):
        """[계약 6] 프론트가 같은 스키마로 잔량을 읽는다."""
        db = FakeDB()
        user = make_user(3, _ago(5))
        state = asyncio.run(es.require_entry(db, user, NOW))
        assert set(state) == {"clouds", "max", "next_regen_sec", "updated_at"}, (
            f"require_entry 반환 키가 get_state 계약과 다르다: {sorted(state)}"
        )
        assert state["max"] == es.CLOUD_MAX

    def test_계약9_진입_게이트는_소모하지_않는다(self):
        """[계약 9] require_entry는 잔량을 감소시키지 않는다(검사 전용)."""
        db = FakeDB(guarded_remaining=2)
        user = make_user(3, _ago(5))
        state = asyncio.run(es.require_entry(db, user, NOW))
        assert state["clouds"] == 3, (
            f"진입만으로 잔량이 변했다 (3 → {state['clouds']}) — "
            "소모는 오답 채점 이후에만 일어나야 한다"
        )
        assert db.guarded_decrements() == [], (
            "require_entry가 감소 UPDATE를 발행했다 — 진입 과금은 신규 계약 위반"
        )
        assert all(v >= 3 for v in db.clouds_writes()), (
            f"clouds 쓰기값이 감소했다: {db.clouds_writes()} (회복 반영분만 허용)"
        )

    def test_계약9_회복분_반영_UPDATE는_허용(self):
        """[계약 9] 회복분(증가)만은 영속화해도 된다 — get_state와 동일 동작."""
        db = FakeDB()
        user = make_user(2, _ago(25))
        state = asyncio.run(es.require_entry(db, user, NOW))
        assert state["clouds"] == 3, "25분 경과 → 1 회복 (잉여 5분 carry)"
        assert all(v >= 2 for v in db.clouds_writes()), (
            f"회복 경로에서 감소 쓰기 발견: {db.clouds_writes()}"
        )

    def test_계약10_ENERGY_비활성이면_진입_무차단(self, monkeypatch):
        """[계약 10] ENERGY_ENABLED=False → 잔량 0이어도 만렙 dict, DB 무접근."""
        monkeypatch.setattr(es.settings, "ENERGY_ENABLED", False)
        db = FakeDB()
        user = make_user(0, _ago(0))
        state = asyncio.run(es.require_entry(db, user, NOW))
        assert state["clouds"] == es.CLOUD_MAX and state["next_regen_sec"] == 0
        assert db.executed == [], "무제한 모드에서 DB 접근이 있으면 안 된다"


# ═══════════════════════════════════════════════════════════════
# 계약 8 · 기존 회복 모델 회귀 (시그니처·경계 불변)
# ═══════════════════════════════════════════════════════════════


class TestRegenRegression:
    """[계약 8] 회복 모델은 이번 전환에서 **바뀌지 않는다**.

    바뀌는 것은 소모 트리거이지 회복 수치·순수함수 시그니처가 아니다
    (§3.1). test_cloud_energy와 중복이지만 의도적이다 — 소모 경로를 갈아끼우다
    회복 경계를 함께 건드리는 것을 이 파일에서 즉시 잡는다.
    """

    @pytest.mark.parametrize(
        "minutes,expected",
        # 100분: 5회복. 2+5=7 ≤ MAX(10)이라 clamp가 안 걸린다
        # (MT-7 만렙 상향 전에는 clamp에 잘려 3이었다).
        [(0, 0), (19, 0), (20, 1), (100, 5)],
    )
    def test_계약8_회복_경계_회귀(self, minutes, expected):
        assert es.regen_amount(2, _ago(minutes), NOW) == expected, (
            f"{minutes}분 경과 회복량 계약 위반 (기대 {expected})"
        )

    def test_계약8_MAX_clamp_회귀(self):
        """만렙을 넘겨 차오르지 않는다.

        ⚠️ 경과 시간을 **만렙에서 파생**한다. 종전에는 100분을 리터럴로 박아
        "만렙까지 찬다"를 전제했는데, MT-7로 만렙이 5 → 10이 되자 100분(5개)으로는
        모자라 이 테스트가 깨졌다 — 계약 수치를 올릴 때마다 깨질 자리였다.
        """
        full = _ago(es.CLOUD_MAX * es.CLOUD_REGEN_MINUTES + 20)  # 만렙을 채우고도 남게
        assert es.regen_amount(0, full, NOW) == es.CLOUD_MAX
        assert es.regen_amount(es.CLOUD_MAX, full, NOW) == 0
        clouds, updated = es.apply_regen(3, full, NOW)
        assert (clouds, updated) == (es.CLOUD_MAX, NOW)

    def test_계약8_잉여_carry_회귀(self):
        clouds, updated = es.apply_regen(2, _ago(25), NOW)
        assert (clouds, updated) == (3, _ago(5)), "20분만 전진(5분 잉여 carry)"

    def test_계약8_next_regen_sec_회귀(self):
        assert es.next_regen_sec(es.CLOUD_MAX, _ago(0), NOW) == 0
        assert es.next_regen_sec(0, _ago(0), NOW) == 20 * 60
        assert es.next_regen_sec(2, _ago(25), NOW) == 15 * 60

    def test_계약8_plan_consume_시그니처_동작_불변(self):
        """순수 소모 계획은 그대로 유지된다(회복 모델 무변경 증거)."""
        assert es.plan_consume(es.CLOUD_MAX, _ago(0), NOW)[0] == es.CLOUD_MAX - 1
        assert es.plan_consume(0, _ago(0), NOW, enabled=False) == (0, _ago(0))
        with pytest.raises(es.OutOfCloudsError):
            es.plan_consume(0, _ago(5), NOW)

    def test_계약8_순수함수_4종_존재(self):
        for name in ("regen_amount", "apply_regen", "next_regen_sec", "plan_consume"):
            assert callable(getattr(es, name, None)), (
                f"{name}이 사라졌다 — 회복 모델 순수함수는 시그니처 불변 계약"
            )


class TestPlanConsumeOracle:
    """[계약 8·6] 순수 모델 `plan_consume`을 DB 경로의 **오라클**로 승격 (PM 판정).

    §3.1이 `plan_consume` 시그니처 불변을 명시했으므로 삭제하지 않는다. 대신
    죽은 코드로 남기지 않기 위해, 순수 모델과 DB 경로가 **경계에서 일치**함을
    여기서 묶는다 — 중복을 코드가 아니라 테스트로 해소한다.

    불일치가 곧 버그다: plan_consume이 통과시키는 상태를 require_entry가 429로
    막으면 유저가 있는 구름을 못 쓰고, 반대면 잔량 없이 세션이 발급된다.
    """

    # (clouds, minutes_ago) — 0·19분·20분·MAX 경계 (§3.1 테스트 8항목의 경계)
    CASES = [(0, 0), (0, 19), (0, 20), (0, 100), (1, 0), (1, 19), (5, 0), (2, 25)]

    @staticmethod
    def _plan_raises(clouds: int, minutes: float):
        try:
            es.plan_consume(clouds, _ago(minutes), NOW)
        except es.OutOfCloudsError as exc:
            return exc
        return None

    @staticmethod
    def _entry_raises(clouds: int, minutes: float):
        db = FakeDB()
        user = make_user(clouds, _ago(minutes))
        try:
            state = asyncio.run(es.require_entry(db, user, NOW))
        except es.OutOfCloudsError as exc:
            return exc, None
        return None, state

    @pytest.mark.parametrize("clouds,minutes", CASES)
    def test_계약8_순수모델과_진입게이트_차단여부_일치(self, clouds, minutes):
        plan_exc = self._plan_raises(clouds, minutes)
        entry_exc, _ = self._entry_raises(clouds, minutes)
        assert (plan_exc is None) == (entry_exc is None), (
            f"clouds={clouds}·{minutes}분 경과에서 순수 모델과 진입 게이트가 "
            f"엇갈렸다 (plan_consume raise={plan_exc is not None}, "
            f"require_entry raise={entry_exc is not None})"
        )

    @pytest.mark.parametrize("clouds,minutes", CASES)
    def test_계약6_차단시_next_regen_sec도_일치(self, clouds, minutes):
        plan_exc = self._plan_raises(clouds, minutes)
        entry_exc, _ = self._entry_raises(clouds, minutes)
        if plan_exc is None or entry_exc is None:
            pytest.skip("차단되지 않는 경계 — 차단 여부 일치 테스트가 담당")
        assert entry_exc.next_regen_sec == plan_exc.next_regen_sec, (
            f"clouds={clouds}·{minutes}분: 회복 ETA 불일치 "
            f"(plan={plan_exc.next_regen_sec}, entry={entry_exc.next_regen_sec}) "
            "— 프론트가 표시하는 '구름 회복까지 N분'이 경로마다 달라진다"
        )

    @pytest.mark.parametrize("clouds,minutes", CASES)
    def test_계약9_통과시_진입게이트는_소모_전_잔량을_보고(self, clouds, minutes):
        """진입 게이트 반환 잔량 = apply_regen 결과(소모 **전**).

        plan_consume의 반환값(소모 후)과 정확히 CLOUD_COST만큼 차이나는 것이
        "게이트는 검사만 한다"의 수치적 증거다.
        """
        plan_exc = self._plan_raises(clouds, minutes)
        entry_exc, state = self._entry_raises(clouds, minutes)
        if plan_exc is not None or entry_exc is not None:
            pytest.skip("차단 경계 — 통과 케이스만 검증")
        after_consume, _ = es.plan_consume(clouds, _ago(minutes), NOW)
        expected_before, _ = es.apply_regen(clouds, _ago(minutes), NOW)
        assert state["clouds"] == expected_before, (
            f"clouds={clouds}·{minutes}분: 게이트 잔량 {state['clouds']} != "
            f"회복 반영 잔량 {expected_before} — 게이트가 소모했다는 뜻"
        )
        assert state["clouds"] - after_consume == es.CLOUD_COST, (
            "게이트 잔량과 소모 후 잔량의 차가 CLOUD_COST가 아니다"
        )

    def test_계약9_require_entry는_plan_consume을_호출하지_않는다(self, monkeypatch):
        """PM 판정: 감소값을 버리는 호출은 의도가 안 읽힌다 — apply_regen+명시 검사.

        오라클 일치는 **테스트가** 보증하므로, 구현이 plan_consume을 재사용해
        결과를 버리는 방식은 금지한다.
        """

        def must_not_call(*args, **kwargs):  # pragma: no cover - 호출 시 실패
            raise AssertionError(
                "require_entry가 plan_consume을 호출했다 — 소모 계획 함수를 "
                "검사용으로 재사용하면 '게이트는 소모하지 않는다'가 코드에서 안 읽힌다"
            )

        monkeypatch.setattr(es, "plan_consume", must_not_call)
        db = FakeDB()
        state = asyncio.run(es.require_entry(db, make_user(3, _ago(5)), NOW))
        assert state["clouds"] == 3

    def test_계약8_plan_consume은_유지된다(self):
        """[계약 8] 오라클로 쓰이므로 삭제 금지 (§3.1 시그니처 불변)."""
        assert callable(getattr(es, "plan_consume", None)), (
            "plan_consume이 사라졌다 — 순수 모델이 없으면 DB 경로를 검증할 "
            "독립 오라클이 없어진다 (PM 판정: 유지 + 오라클 승격)"
        )


# ═══════════════════════════════════════════════════════════════
# 계약 11 · 계약 수치 고정 (env 기본값 = 계약값)
# ═══════════════════════════════════════════════════════════════


class TestEnergyNumbersContract:
    """[계약 11] 수치는 불변 — 변경되는 것은 소모 트리거다 (§3.1).

    CLAUDE.md "계약 수치 변경 시 env 기본값=계약값 유지, 계약 테스트로 드리프트
    감시" 전례(SESSION_RECIPE·RAG_FEEDBACK_TIMEOUT)를 따른다.
    """

    def test_계약11_settings_기본값이_계약값(self):
        assert settings.CLOUD_MAX == 10  # MT-7 (2026-08-11 멘토링)
        assert settings.CLOUD_REGEN_MINUTES == 20
        assert settings.CLOUD_COST == 1

    def test_계약11_서비스_상수가_settings와_동일(self):
        assert es.CLOUD_MAX == settings.CLOUD_MAX
        assert es.CLOUD_REGEN_MINUTES == settings.CLOUD_REGEN_MINUTES
        assert es.CLOUD_COST == settings.CLOUD_COST
        assert es.CLOUD_REGEN_SECONDS == 20 * 60

    def test_계약11_ENERGY_ENABLED_기본_활성(self):
        assert settings.ENERGY_ENABLED is True


# ═══════════════════════════════════════════════════════════════
# 계약 12·14 · 호출 위치 (소스 텍스트 가드)
# ═══════════════════════════════════════════════════════════════


class TestConsumeCallSitePosition:
    """[계약 12] 소모는 **채점/판정 이후**로 이동한다.

    현재는 채점 전에 consume()이 있어(session.py:273 / board.py:254) 잔량 0이면
    정답조차 제출할 수 없다 — 관찰 보고서 03의 P0 결함. 소스 텍스트 위치로
    "이후"를 고정한다(HTTP 하네스 없이 test_error_code_contract 관례).
    """

    def test_계약12_session_소모는_채점_이후(self):
        block = _func_block(_source("routers/session.py"), "submit_session_answer")
        grade_at = block.index("submit_answer_for_log")
        consumes = _positions(block, "consume_if_available")
        assert consumes, (
            "session.py answer 경로에 consume_if_available 호출이 없다 — "
            "오답 소모가 사라졌다면 에너지 자원이 무의미해진다"
        )
        assert all(pos > grade_at for pos in consumes), (
            "소모 호출이 submit_answer_for_log 앞에 있다 — 정답 제출까지 "
            "차단하는 구 계약(§3.1 P0 결함)의 잔존"
        )

    def test_계약12_board_소모는_판정_이후(self):
        block = _func_block(_source("routers/board.py"), "attempt_puzzle")
        judge_at = block.index("evaluate_board_answer")
        consumes = _positions(block, "consume_if_available")
        assert consumes, "board.py attempt에 consume_if_available 호출이 없다"
        assert all(pos > judge_at for pos in consumes), (
            "소모 호출이 evaluate_board_answer 앞에 있다 — 통과한 시도에도 "
            "과금되는 구 계약의 잔존"
        )

    @pytest.mark.parametrize("rel", ["routers/session.py", "routers/board.py"])
    def test_계약12_구_consume_호출_잔존_금지(self, rel):
        """구 API `energy_service.consume(` 는 웨이브 1에서 제거된다."""
        source = _source(rel)
        assert not re.search(r"energy_service\.consume\(", source), (
            f"{rel}에 구 consume() 호출이 남아 있다 — 잔량 0에서 429로 "
            "채점을 막는 경로가 살아 있다는 뜻"
        )

    def test_계약12_구_consume_API_제거(self):
        """energy_service.consume은 consume_if_available로 대체·제거된다."""
        assert not hasattr(es, "consume"), (
            "구 consume()이 남아 있다 — 두 소모 경로 공존은 계약 드리프트의 원천"
        )


class TestEntryGateCallSites:
    """[계약 14] 진입 차단 호출 지점 3곳 + 무차단 지점 2곳."""

    def test_계약14_session_today_신규_발급_분기에서만_차단(self):
        block = _func_block(_source("routers/session.py"), "get_today_session")
        gates = _positions(block, "require_entry")
        assert gates, (
            "GET /session/today 신규 발급 경로에 require_entry가 없다 — "
            "잔량 0에서도 세션이 발급된다"
        )
        branch_at = block.index("if session is None:")
        assert all(pos > branch_at for pos in gates), (
            "require_entry가 `if session is None:` 앞에 있다 — 기존 세션 "
            "재조회까지 429가 되어 '풀던 것을 뺏기지 않는다' 불변식이 깨진다"
        )
        # 앵커에 괄호를 포함해 **실제 호출**만 잡는다 — 함수명만으로 찾으면 앞선
        # 주석의 언급이 먼저 걸려 게이트 위치가 옳은데도 실패한다(가드 취약성).
        create_at = block.index("create_daily_session(")
        assert min(gates) < create_at, (
            "require_entry가 create_daily_session 뒤에 있다 — 문항을 만든 뒤 "
            "차단하면 낭비 발급이 남는다"
        )

    def test_계약14_유닛_세션_발급도_차단(self):
        block = _func_block(_source("routers/curriculum.py"), "create_unit_session")
        assert "require_entry" in block, (
            "POST /units/{slug}/session에 require_entry가 없다 (§3.1 차단 지점 2)"
        )
        assert block.index("require_entry") < block.index(
            "curriculum_service.create_unit_session"
        ), "차단은 세션 생성 전에 일어나야 한다"

    def test_계약14_보드_퍼즐_목록은_무차단(self):
        """목록 조회(GET /board/puzzles)는 문항 진입이 아니므로 차단하지 않는다."""
        block = _func_block(_source("routers/board.py"), "list_puzzles")
        assert "require_entry" not in block, (
            "퍼즐 목록에 진입 차단을 걸면 잔량 0인 유저가 화면 자체를 못 본다"
        )

    def test_계약14_answer_경로는_무차단(self):
        """[계약 14·7] 발급된 세션의 문항 제출은 절대 차단하지 않는다."""
        block = _func_block(_source("routers/session.py"), "submit_session_answer")
        assert "require_entry" not in block, (
            "answer 경로에 진입 게이트가 있으면 진행 중 세션이 429로 끊긴다 "
            "(§3.1 각주 7 — 이번 전환의 핵심 불변식)"
        )


# ═══════════════════════════════════════════════════════════════
# 계약 13 · 신규 라우트 실재
# ═══════════════════════════════════════════════════════════════


class TestPuzzleDetailRoute:
    """[계약 13] 보드 퍼즐 상세 진입 엔드포인트가 실재한다(웨이브 1 신설).

    §3.1 차단 지점 3번은 `GET /api/v1/board/puzzles/{id}`인데 현재 라우터에는
    목록과 attempt만 있다 — 엔드포인트 자체가 신규다.
    """

    DETAIL_PATH = "/api/v1/board/puzzles/{content_item_id}"

    @staticmethod
    def _routes() -> set[tuple[str, str]]:
        from app.main import app

        return {
            (method, route.path)
            for route in app.routes
            for method in (getattr(route, "methods", None) or ())
        }

    @classmethod
    def _detail_route(cls):
        from app.main import app

        for route in app.routes:
            if route.path == cls.DETAIL_PATH and "GET" in (
                getattr(route, "methods", None) or ()
            ):
                return route
        return None

    def test_계약13_퍼즐_상세_GET_라우트_존재(self):
        routes = self._routes()
        assert ("GET", self.DETAIL_PATH) in routes, (
            f"GET {self.DETAIL_PATH} 라우트가 없다 — §3.1 차단 지점 3이 구현 불가. "
            f"현재 board 라우트: {sorted(p for _, p in routes if '/board/' in p)}"
        )

    def test_계약13_목록_attempt_라우트_회귀(self):
        routes = self._routes()
        assert ("GET", "/api/v1/board/puzzles") in routes
        assert ("POST", f"{self.DETAIL_PATH}/attempt") in routes

    def test_계약13_상세_핸들러가_진입_게이트_호출(self):
        """[계약 13·14] 게이트는 **상세 핸들러 안**에 있어야 한다.

        핸들러 함수명은 계약으로 고정한다: `async def get_puzzle_detail(...)`.
        (웨이브 1은 이 이름을 쓴다 — 이름을 못 박지 않으면 함수 스코프를 잡을 수
        없어 파일 전역 검색이 되고, 게이트를 엉뚱한 함수에 넣어도 통과한다.)
        """
        block = _func_block(_source("routers/board.py"), "get_puzzle_detail")
        assert "require_entry" in block, (
            "get_puzzle_detail 안에 require_entry 호출이 없다 — 퍼즐 상세 진입 "
            "차단이 이 핸들러에 걸려 있지 않다(§3.1 차단 지점 3)"
        )

    def test_계약13_응답_모델은_기존_BoardPuzzle_재사용(self):
        """[계약 13] 새 스키마를 만들지 않는다 (PM 판정) — 목록 원소와 동일 타입."""
        from app.schemas.board import BoardPuzzle

        route = self._detail_route()
        assert route is not None, f"GET {self.DETAIL_PATH} 라우트 부재"
        assert route.response_model is BoardPuzzle, (
            f"상세 응답 모델이 BoardPuzzle이 아니다 (got {route.response_model}) "
            "— 단건 전용 스키마 신설 금지(목록과 필드가 갈라진다)"
        )

    def test_계약13_BoardPuzzle_필드_불변(self):
        """[계약 13] 목록과 상세가 **한 스키마를 공유**한다(회귀).

        지키는 것은 "필드가 영원히 늘지 않는다"가 아니라 "상세 전용 필드가
        생기지 않는다"이다 — 둘이 갈라지면 목록에서 본 것과 들어가서 본 것이
        달라진다. 그래서 필드를 더할 때는 **양쪽이 다 채우는지 확인하고** 이
        목록을 갱신한다.
        """
        from app.schemas.board import BoardPuzzle

        assert set(BoardPuzzle.model_fields) == {
            "content_item_id",
            "template_json",
            "cleared",
            "difficulty",
            # 2026-08-10 추가(학습 수준 잠금). 이 독스트링의 절차대로 **양쪽이
            # 다 채우는지** 확인하고 늘렸다 — 목록은 locked_difficulties로 계산해
            # 넣고, 상세는 잠긴 퍼즐이 그 앞에서 403이라 항상 False를 넣는다.
            "locked",
            # MT-24 순차 잠금 — 목록은 compute_unlocked_ids로, 상세는 403 가드를
            # 통과했으므로 True로 **양쪽이 다 채운다**(이 테스트가 요구하는 조건).
            # 두 필드가 공존하는 것은 의도다: 축이 달라 서로를 대체하지 않는다.
            "unlocked",
        }, (
            f"BoardPuzzle 필드가 변경됐다: {sorted(BoardPuzzle.model_fields)} — "
            "목록·상세가 같은 스키마를 공유한다는 계약이 깨진다"
        )

    def test_계약13_목록과_상세가_같은_응답_모델(self):
        """목록의 원소 타입 == 상세의 응답 타입 (PM 판정: 단건 재사용)."""
        from app.main import app
        from app.schemas.board import BoardPuzzle

        list_route = next(
            r
            for r in app.routes
            if r.path == "/api/v1/board/puzzles"
            and "GET" in (getattr(r, "methods", None) or ())
        )
        assert list_route.response_model == list[BoardPuzzle], (
            f"목록 응답 모델이 list[BoardPuzzle]이 아니다 ({list_route.response_model})"
        )
