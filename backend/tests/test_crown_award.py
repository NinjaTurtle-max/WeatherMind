"""유닛 밖 활동 → 왕관 유입로 단위 테스트 — 스프린트 R8-01 §3.1·§3.4 (S1).

majority_concept·pick_crown_unit은 DB 의존이 없는 순수 함수라 최다 개념 선정
(동률: route target 우선→사전순)·잠금 통과·미클리어 필터·전체 순서 결정성을
DB 없이 검증한다 (test_curriculum_tree 관례). DB 결합부(find_crown_unit·
award_crown_for_activity·unit_result_for_session)는 로더를 monkeypatch한
FakeDB로 배선(unlock_floor 공급·grant 반환 노출)만 검증한다.

실행: backend 디렉토리에서 `python -m pytest tests/test_crown_award.py -q`.
"""
import asyncio
import inspect
import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace

from app.routers import board as board_router
from app.routers import session as session_router
from app.schemas.board import BoardAttemptRequest
from app.services import curriculum_service as cs


def make_unit(
    section, order, *, slug=None, prereq=None, kind="quiz", crown_target=1,
    title="U", concept_tag="pressure_front",
):
    return SimpleNamespace(
        id=uuid.uuid4(),
        slug=slug or f"{section}-{order}",
        section=section,
        unit_order=order,
        title=title,
        concept_tag=concept_tag,
        kind=kind,
        crown_target=crown_target,
        prereq_unit_id=prereq,
    )


def prog(crowns=0, cleared=False):
    return SimpleNamespace(
        crowns=crowns,
        cleared_at=datetime.now(timezone.utc) if cleared else None,
    )


class TestMajorityConcept:
    def test_최다_개념_선정(self):
        tags = ["air_mass", "typhoon", "air_mass", "humidity", "air_mass"]
        assert cs.majority_concept(tags) == "air_mass"

    def test_동률이면_route_target_우선(self):
        tags = ["typhoon", "air_mass", "typhoon", "air_mass"]
        assert cs.majority_concept(tags, route_target="typhoon") == "typhoon"

    def test_동률에_route_target이_없으면_사전순(self):
        tags = ["typhoon", "air_mass", "typhoon", "air_mass"]
        assert cs.majority_concept(tags) == "air_mass"
        # route target이 동률 후보 밖이면 무시하고 사전순
        assert cs.majority_concept(tags, route_target="humidity") == "air_mass"

    def test_route_target이_동률_아닌_소수면_무시(self):
        tags = ["typhoon", "typhoon", "air_mass"]
        assert cs.majority_concept(tags, route_target="air_mass") == "typhoon"

    def test_빈_입력은_None(self):
        assert cs.majority_concept([]) is None
        assert cs.majority_concept([None, None]) is None


class TestPickCrownUnit:
    def _fixtures(self):
        """섹션1: quiz(pf)→board(pf), 섹션2: quiz(am, prereq=board).

        ⚠️ **2026-08-12: 섹션명을 `SECTION_ORDER`에서 뽑는다.** 종전엔
        `"하늘 읽기"`·`"공기의 힘"`을 리터럴로 썼는데, CO-G1 순환식 재구조화로
        그 둘이 `SECTION_ORDER` **미등재**가 되면서 `_section_key`의 폴백(알파벳
        정렬)을 탔다. 한글 정렬에서 `공기의 힘 < 하늘 읽기`라 전체 순서가
        **뒤집혔고**(`['공기의 힘/1', '하늘 읽기/1', '하늘 읽기/2']`),
        `unlock_floor=2`가 선해제하는 선두 2개가 board를 포함하지 않게 되어
        `test_unlock_floor_배치_선해제로_열린_유닛도_후보`가 실패했다.
        **기능 결함이 아니라 픽스처 노후화**였다 — 등재 섹션명으로 바꾸면
        의도한 순서(quiz → board → am)가 그대로 돌아온다.
        """
        sec1, sec2 = cs.SECTION_ORDER[0], cs.SECTION_ORDER[1]
        u_quiz = make_unit(sec1, 1, kind="quiz", concept_tag="pressure_front")
        u_board = make_unit(
            sec1, 2, kind="board", concept_tag="pressure_front",
            prereq=u_quiz.id, crown_target=2,
        )
        u_am = make_unit(
            sec2, 1, kind="quiz", concept_tag="air_mass", prereq=u_board.id
        )
        return u_quiz, u_board, u_am

    def test_concept과_kind가_모두_일치해야_한다(self):
        u_quiz, u_board, u_am = self._fixtures()
        units = [u_quiz, u_board, u_am]
        found = cs.pick_crown_unit(
            units, {}, concept_tag="pressure_front", kind="quiz"
        )
        assert found is u_quiz
        # board kind는 잠금(선행 crowns 0) → None
        assert (
            cs.pick_crown_unit(
                units, {}, concept_tag="pressure_front", kind="board"
            )
            is None
        )

    def test_잠금_통과_유닛만_후보(self):
        u_quiz, u_board, u_am = self._fixtures()
        units = [u_quiz, u_board, u_am]
        progress = {u_quiz.id: prog(crowns=1)}  # 선행 충족 → board 열림
        found = cs.pick_crown_unit(
            units, progress, concept_tag="pressure_front", kind="board"
        )
        assert found is u_board

    def test_unlock_floor_배치_선해제로_열린_유닛도_후보(self):
        u_quiz, u_board, u_am = self._fixtures()
        units = [u_quiz, u_board, u_am]
        # 선행 crowns 0이지만 전체 순서 선두 2개가 선해제되면 board가 열린다
        found = cs.pick_crown_unit(
            units, {}, concept_tag="pressure_front", kind="board", unlock_floor=2
        )
        assert found is u_board

    def test_uncleared_only는_왕관_가득_찬_유닛을_건너뛴다(self):
        u_quiz, u_board, u_am = self._fixtures()
        units = [u_quiz, u_board, u_am]
        progress = {u_quiz.id: prog(crowns=1, cleared=True)}  # target 1 도달
        assert (
            cs.pick_crown_unit(
                units, progress,
                concept_tag="pressure_front", kind="quiz", uncleared_only=True,
            )
            is None
        )
        # crown_target 2에 crowns 1이면 미클리어 → 여전히 후보
        progress[u_board.id] = prog(crowns=1)
        found = cs.pick_crown_unit(
            units, progress,
            concept_tag="pressure_front", kind="board", uncleared_only=True,
        )
        assert found is u_board

    def test_전체_순서상_첫_유닛_결정성(self):
        """같은 concept·kind가 여럿이면 ordered_units 선두가 뽑힌다."""
        a = make_unit("하늘 읽기", 1, concept_tag="humidity")
        b = make_unit("하늘 읽기", 2, concept_tag="humidity")
        # 입력 순서를 뒤집어도 전체 순서(섹션→unit_order) 선두 a가 뽑힌다
        found = cs.pick_crown_unit(
            [b, a], {}, concept_tag="humidity", kind="quiz"
        )
        assert found is a

    def test_대상_없으면_None(self):
        u_quiz, *_ = self._fixtures()
        assert (
            cs.pick_crown_unit(
                [u_quiz], {}, concept_tag="typhoon", kind="quiz"
            )
            is None
        )


class FakeDB:
    """로더가 전부 monkeypatch되는 배선 테스트용 — get만 유닛을 돌려준다.

    🔴 **2026-08-19: `execute`·`add`가 생겼다.** `unit_result_for_session`이
    `mark_unit_attempted`를 부르게 되면서(결함 ⑩ — 진행과 보상을 가른 것) 이
    대역물이 실제 쿼리를 한 번 받는다. `scalar_one_or_none()`이 None을 주므로
    그 함수는 **진도 행을 새로 만드는 경로**를 타고, `add`가 그것을 삼킨다.
    ⚠️ 여기서 진도 행을 흉내 내지 **않는** 것이 의도다 — 이 파일의 관심은
    **왕관 배선**이고, `attempted_at`이 실제로 채워지는지는
    `test_unit_unlock_on_complete.py`가 소유한다. 두 곳에서 같은 것을 확인하면
    한쪽이 낡아도 조용해진다.
    """

    def __init__(self, unit=None):
        self.unit = unit
        self.added: list = []

    async def get(self, model, pk):
        return self.unit

    async def execute(self, stmt):
        return SimpleNamespace(scalar_one_or_none=lambda: None)

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        pass


_FAKE_USER = SimpleNamespace(
    id=uuid.uuid4(), level_group="elementary", streak_count=3
)


def _patch_loaders(monkeypatch, *, units, progress, abilities=None):
    async def fake_units(db):
        return units

    async def fake_progress(db, user):
        return progress

    async def fake_abilities(db, user):
        return abilities or []

    monkeypatch.setattr(cs, "load_units", fake_units)
    monkeypatch.setattr(cs, "load_progress_by_unit", fake_progress)
    monkeypatch.setattr(cs.weatherbrain_service, "load_abilities", fake_abilities)


class TestFindCrownUnit:
    def test_잠금_맥락을_로드해_pick에_공급한다(self, monkeypatch):
        u1 = make_unit("하늘 읽기", 1, concept_tag="humidity", kind="board")
        _patch_loaders(monkeypatch, units=[u1], progress={})
        found = asyncio.run(
            cs.find_crown_unit(
                FakeDB(), _FAKE_USER, concept_tag="humidity", kind="board"
            )
        )
        assert found is u1

    def test_배치_선해제_unlock_floor가_적용된다(self, monkeypatch):
        u1 = make_unit("하늘 읽기", 1, concept_tag="humidity")
        u2 = make_unit("하늘 읽기", 2, concept_tag="typhoon", prereq=u1.id)
        # θ≥0.5·n>0 이 u1(humidity)·u2(typhoon) 연속 성립 → floor 2 → u2 열림
        abilities = [
            {"concept_tag": "humidity", "theta": 0.8, "se": 0.4, "n": 3},
            {"concept_tag": "typhoon", "theta": 0.8, "se": 0.4, "n": 3},
        ]
        _patch_loaders(
            monkeypatch, units=[u1, u2], progress={}, abilities=abilities
        )
        found = asyncio.run(
            cs.find_crown_unit(
                FakeDB(), _FAKE_USER, concept_tag="typhoon", kind="quiz"
            )
        )
        assert found is u2


class TestAwardCrownForActivity:
    def test_grant_반환을_crown_award_형태로_노출(self, monkeypatch):
        unit = make_unit("하늘 읽기", 1, slug="sky-1", title="구름 읽기")
        calls = {}

        async def fake_find(db, user, *, concept_tag, kind, uncleared_only=False):
            calls["find"] = (concept_tag, kind, uncleared_only)
            return unit

        async def fake_grant(db, user, unit_id):
            calls["grant"] = unit_id
            return {
                "crowns": 1, "cleared": True, "newly_cleared": True, "xp_earned": 20,
            }

        monkeypatch.setattr(cs, "find_crown_unit", fake_find)
        monkeypatch.setattr(cs, "grant_unit_crown", fake_grant)
        award = asyncio.run(
            cs.award_crown_for_activity(
                FakeDB(), _FAKE_USER, concept_tag="humidity", kind="board"
            )
        )
        assert award == {
            "unit_slug": "sky-1", "unit_title": "구름 읽기",
            "crowns": 1, "cleared": True,
        }
        assert calls["find"] == ("humidity", "board", True)  # 미클리어만 후보
        assert calls["grant"] == unit.id

    def test_대상_유닛_없으면_None_무동작(self, monkeypatch):
        async def fake_find(db, user, **kwargs):
            return None

        async def fail_grant(db, user, unit_id):
            raise AssertionError("대상이 없으면 grant를 호출하면 안 된다")

        monkeypatch.setattr(cs, "find_crown_unit", fake_find)
        monkeypatch.setattr(cs, "grant_unit_crown", fail_grant)
        award = asyncio.run(
            cs.award_crown_for_activity(
                FakeDB(), _FAKE_USER, concept_tag="humidity", kind="quiz"
            )
        )
        assert award is None


class TestUnitResultForSession:
    def test_grant_crown이면_grant_반환을_그대로_노출(self, monkeypatch):
        unit = make_unit("하늘 읽기", 1, crown_target=2)

        async def fake_grant(db, user, unit_id):
            return {
                "crowns": 2, "cleared": True, "newly_cleared": True, "xp_earned": 20,
            }

        monkeypatch.setattr(cs, "grant_unit_crown", fake_grant)
        result = asyncio.run(
            cs.unit_result_for_session(
                FakeDB(unit), _FAKE_USER, unit.id,
                all_correct=True, grant_crown=True,
            )
        )
        assert result == {
            "all_correct": True, "crowns": 2, "crown_target": 2,
            "cleared": True, "unit_xp": 20,
        }

    def test_grant_없는_경로는_저장된_진도_스냅샷(self, monkeypatch):
        unit = make_unit("하늘 읽기", 1, crown_target=2)

        async def fake_progress(db, user):
            return {unit.id: prog(crowns=1)}

        async def fail_grant(db, user, unit_id):
            raise AssertionError("grant_crown=False면 왕관을 가산하면 안 된다")

        monkeypatch.setattr(cs, "load_progress_by_unit", fake_progress)
        monkeypatch.setattr(cs, "grant_unit_crown", fail_grant)
        result = asyncio.run(
            cs.unit_result_for_session(
                FakeDB(unit), _FAKE_USER, unit.id,
                all_correct=False, grant_crown=False,
            )
        )
        assert result == {
            "all_correct": False, "crowns": 1, "crown_target": 2,
            "cleared": False, "unit_xp": 0,
        }

    def test_진도_행_없으면_0_스냅샷(self, monkeypatch):
        unit = make_unit("하늘 읽기", 1)

        async def fake_progress(db, user):
            return {}

        monkeypatch.setattr(cs, "load_progress_by_unit", fake_progress)
        result = asyncio.run(
            cs.unit_result_for_session(
                FakeDB(unit), _FAKE_USER, unit.id,
                all_correct=True, grant_crown=False,
            )
        )
        assert result["crowns"] == 0 and result["cleared"] is False

    def test_유닛_미존재면_None(self):
        result = asyncio.run(
            cs.unit_result_for_session(
                FakeDB(None), _FAKE_USER, uuid.uuid4(),
                all_correct=True, grant_crown=True,
            )
        )
        assert result is None


# ═══════════════════════════════════════════════════════════════
# POST /session/{id}/complete 응답 계약 (R8-01 §3.1·§3.4)
# — 라우터 헬퍼·서비스를 monkeypatch해 배선만 검증 (limiter 없는 endpoint)
# ═══════════════════════════════════════════════════════════════


def make_session(
    mode="daily",
    unit_id=None,
    completed=False,
    route_target=None,
    daily_first=None,
):
    """세션 대역.

    `daily_first`는 발급 시점에 찍히는 「오늘 첫 유닛 세션인가」 도장이다
    (2026-08-13 확정 — `curriculum_service.create_unit_session`이 `recipe_json`에
    적고 라우터는 **읽기만** 한다). None이면 키 자체를 넣지 않아 **개정 이전에
    발급된 세션**을 재현한다 — 그런 세션은 왕관이 나가면 안 된다.
    """
    return SimpleNamespace(
        id=uuid.uuid4(),
        user_id=_FAKE_USER.id,
        mode=mode,
        unit_id=unit_id,
        session_date=date(2026, 7, 30),
        completed_at=datetime.now(timezone.utc) if completed else None,
        xp_total=50,
        route_decision=(
            {"target_concept_tag": route_target} if route_target else None
        ),
        recipe_json=(
            {"kind": "unit"} if daily_first is None
            else {"kind": "unit", "daily_first": daily_first}
        ),
    )


def make_log(concept_tag, correct=True, retry_correct=None):
    # retry_correct는 R13-01 §2.1(0011)에서 추가된 만회 라운드 컬럼 —
    # 기본 None(만회 시도 없음)이면 왕관 판정이 개정 전과 동일하다.
    return SimpleNamespace(
        concept_tag=concept_tag,
        is_correct=correct,
        retry_correct=retry_correct,
        user_answer="답",
    )


async def _no_closing_step(db, user, today=None):
    """예보 마감 단계 대역 — "단계 없음"(R13 A-1). 배선 하네스 공용."""
    return None


def run_complete(monkeypatch, session, logs, *, award=None, unit_payload=None):
    """complete_session을 배선 검증용으로 실행 — 호출 인자를 수집해 돌려준다."""
    calls = {}

    async def fake_load(db, user, session_id):
        return session

    async def fake_logs(db, s):
        return logs

    async def fake_award(db, user, *, concept_tag, kind):
        calls["award"] = (concept_tag, kind)
        return award

    async def fake_unit_result(db, user, unit_id, *, all_correct, grant_crown):
        calls["unit_result"] = (unit_id, all_correct, grant_crown)
        return unit_payload

    async def fake_badge(db, user_id, badge):
        calls["badge"] = badge
        return False  # 신규 지급 아님 — 라우터가 bool로 분기한다 (CO-T-4)

    async def fake_quests(db, user, day):
        calls["quests"] = day
        return []  # 전환 목록(라우터가 소비) — CO-T-4

    # 예보 마감 단계(R13 A-1)는 duels 조회 + KMA 캐시를 타므로 이 배선 하네스의
    # 관심사가 아니다 — 단계 없음으로 고정한다. 판정 자체는
    # tests/test_forecast_closing_step.py가 단독으로 문다.
    monkeypatch.setattr(
        session_router.session_service, "forecast_closing_step", _no_closing_step
    )
    monkeypatch.setattr(session_router, "_load_session_or_404", fake_load)
    monkeypatch.setattr(session_router, "_session_logs", fake_logs)
    monkeypatch.setattr(cs, "award_crown_for_activity", fake_award)
    monkeypatch.setattr(cs, "unit_result_for_session", fake_unit_result)
    monkeypatch.setattr(
        session_router.badge_service, "award_badge", fake_badge
    )
    monkeypatch.setattr(
        session_router.quest_service, "recalculate_quests", fake_quests
    )
    result = asyncio.run(
        session_router.complete_session(session.id, _FAKE_USER, FakeDB())
    )
    return result, calls


AWARD = {"unit_slug": "sky-1", "unit_title": "구름 읽기", "crowns": 1, "cleared": True}


class TestCompleteSessionCrownAward:
    def test_데일리_만점_최초_완료는_최다_개념으로_crown_award(self, monkeypatch):
        session = make_session(route_target="typhoon")
        logs = [make_log(t) for t in
                ["air_mass", "typhoon", "typhoon", "humidity", "air_mass"]]
        result, calls = run_complete(monkeypatch, session, logs, award=AWARD)
        # 동률(air_mass 2·typhoon 2) → route target 우선
        assert calls["award"] == ("typhoon", "quiz")
        assert result.crown_award is not None
        assert result.crown_award.unit_slug == "sky-1"
        assert result.crown_award.crowns == 1
        assert result.unit_result is None  # 데일리엔 unit_result 없음
        assert session.completed_at is not None

    def test_대상_유닛_없으면_crown_award_null(self, monkeypatch):
        session = make_session()
        logs = [make_log("air_mass") for _ in range(3)]
        result, calls = run_complete(monkeypatch, session, logs, award=None)
        assert calls["award"] == ("air_mass", "quiz")
        assert result.crown_award is None

    def test_오답_있으면_왕관_미부여(self, monkeypatch):
        session = make_session()
        logs = [make_log("air_mass"), make_log("air_mass", correct=False)]
        result, calls = run_complete(monkeypatch, session, logs, award=AWARD)
        assert "award" not in calls
        assert result.crown_award is None

    def test_재완료_멱등_왕관_미부여(self, monkeypatch):
        session = make_session(completed=True)
        logs = [make_log("air_mass")]
        result, calls = run_complete(monkeypatch, session, logs, award=AWARD)
        assert "award" not in calls
        assert result.crown_award is None
        # 퀘스트 재계산은 재완료에도 수행(기존 동작 유지)
        assert calls["quests"] == session.session_date


class TestCompleteSessionUnitResult:
    UNIT_PAYLOAD = {
        "all_correct": True, "crowns": 1, "crown_target": 1,
        "cleared": True, "unit_xp": 20,
    }

    def test_하루_첫_유닛_세션_만점이면_왕관을_준다(self, monkeypatch):
        """**왕관은 「하루 첫 유닛 세션」에만**(2026-08-13 클라이언트 확정).

        경위(같은 자리가 세 번 뒤집혔다):
          · R13-01 §2.10이 왕관을 일일 세션의 **진도 블록**으로 옮기면서 여기를
            `grant_crown=False`(연습 전용)로 고정했다.
          · 2026-08-12 배합이 `{live:2,new:4,review:3,board:1}`이 되며 `unit`
            kind가 사라져 그 유입로가 죽자 `grant_crown=all_correct`로 되돌렸다.
          · 그러자 **하루에 유닛을 여러 개 열수록 왕관이 무제한**이 됐다 — daily의
            「하루 1세션 = 하루 1왕관」 상한이 유닛에는 없기 때문이다
            (`uq_sessions_daily`가 `unit_id IS NULL`에만 걸린다).
        확정 사양이 그 구멍을 닫는다: 하루의 첫 유닛 세션이 곧 데일리 세션이고,
        왕관은 그 세션에만 붙는다. 이중 수여를 막는 것은 이 분기가 아니라
        `grant_unit_crown`의 멱등 판정이다(같은 유닛 재클리어).
        """
        unit_id = uuid.uuid4()
        session = make_session(mode="unit", unit_id=unit_id, daily_first=True)
        logs = [make_log("air_mass") for _ in range(5)]
        result, calls = run_complete(
            monkeypatch, session, logs, unit_payload=self.UNIT_PAYLOAD
        )
        assert calls["unit_result"] == (unit_id, True, True)
        assert result.unit_result is not None
        assert result.unit_result.all_correct is True
        assert result.unit_result.crowns == 1
        assert result.unit_result.crown_target == 1
        assert result.unit_result.cleared is True
        assert result.unit_result.unit_xp == 20
        # 데일리 유입로(mode 분기)는 유닛 세션에 미적용
        assert "award" not in calls and result.crown_award is None

    def test_두_번째_이후_유닛_세션은_만점이어도_왕관_없음(self, monkeypatch):
        """확정 사양의 나머지 절반 — 두 번째 이후는 순수 학습이고 보상이 없다.

        `all_correct`는 **표기값이라 그대로 True**로 나간다(만점은 만점이다).
        갈리는 것은 `grant_crown` 하나뿐이다.
        """
        unit_id = uuid.uuid4()
        session = make_session(mode="unit", unit_id=unit_id, daily_first=False)
        logs = [make_log("air_mass") for _ in range(5)]
        _, calls = run_complete(
            monkeypatch, session, logs, unit_payload=self.UNIT_PAYLOAD
        )
        assert calls["unit_result"] == (unit_id, True, False)

    def test_도장_없는_옛_세션은_왕관을_주지_않는다(self, monkeypatch):
        """개정 이전에 발급된 세션에는 `daily_first` 키가 없다 —
        **모르는 세션은 안 주는 쪽으로 닫는다**(`.get` → None → False)."""
        unit_id = uuid.uuid4()
        session = make_session(mode="unit", unit_id=unit_id)  # daily_first 미기록
        logs = [make_log("air_mass") for _ in range(5)]
        _, calls = run_complete(
            monkeypatch, session, logs, unit_payload=self.UNIT_PAYLOAD
        )
        assert calls["unit_result"] == (unit_id, True, False)

    def test_오답_있으면_grant_crown_False_스냅샷(self, monkeypatch):
        unit_id = uuid.uuid4()
        session = make_session(mode="unit", unit_id=unit_id, daily_first=True)
        logs = [make_log("air_mass"), make_log("air_mass", correct=False)]
        payload = {
            "all_correct": False, "crowns": 0, "crown_target": 1,
            "cleared": False, "unit_xp": 0,
        }
        result, calls = run_complete(
            monkeypatch, session, logs, unit_payload=payload
        )
        assert calls["unit_result"] == (unit_id, False, False)
        assert result.unit_result.all_correct is False
        assert result.unit_result.unit_xp == 0

    def test_재완료는_왕관을_주지_않는다(self, monkeypatch):
        """**재완료 파밍 차단** — `grant_crown`의 세 번째 조건이 `is_first_complete`다.

        이 자리에는 「이중 수여를 막는 것은 이 분기가 아니다 · 이미 준 왕관을 다시
        주지 않는 판정은 `grant_unit_crown`이 멱등으로 갖고 있다」고 적힌
        `test_재완료도_같은_인자로_부른다`가 있었고, **그 전제가 거짓이었다**:
        `plan_crown`은 `crowns < crown_target`이면 +1 하므로 멱등은
        `crown_target == 1`에서만 성립한다. 시드의 `crown_target = 2` 유닛 6개
        (전부 board)는 같은 세션에 `complete`를 두 번 던지는 것만으로 만관·
        `cleared`·**+20 XP**까지 한 세션에서 났다.

        「판정이 두 곳에 생겨 갈린다」는 우려는 남지 않는다 — 라우터가 재완료를
        **따로 세지 않고**, 배지·데일리 왕관이 이미 쓰는 같은 변수
        (`is_first_complete = session.completed_at is None`)를 그대로 읽는다.
        """
        unit_id = uuid.uuid4()
        session = make_session(
            mode="unit", unit_id=unit_id, completed=True, daily_first=True
        )
        logs = [make_log("air_mass") for _ in range(5)]
        result, calls = run_complete(
            monkeypatch, session, logs, unit_payload=self.UNIT_PAYLOAD
        )
        assert calls["unit_result"] == (unit_id, True, False)
        assert result.unit_result is not None  # 재완료에도 계약 필드는 노출

    def test_재완료_파밍으로_crown_target_2_유닛이_만관되지_않는다(self):
        """결함의 실체를 서비스 층에서 못박는다 — 라우터 배선이 아니라 **결과**.

        `unit_result_for_session`을 `grant_crown=True`로 두 번 부르면
        `crown_target = 2` 유닛이 1회 세션에서 만관 + `cleared` + XP 20을 낸다.
        그래서 라우터가 두 번째 호출을 `grant_crown=False`로 내려야 한다.
        """
        unit = SimpleNamespace(id=uuid.uuid4(), crown_target=2)
        # `attempted_at` — 모델에 실제로 있는 컬럼이므로(0017) 대역물도 가진다.
        # 여기를 비우고 `mark_unit_attempted`를 `getattr`로 무르게 하는 반대편
        # 해법은 **컬럼이 없어도 조용히 통과**시켜, 진행 기록이 안 남는 회귀를
        # 이 테스트가 못 잡게 만든다.
        prog = SimpleNamespace(user_id=_FAKE_USER.id, unit_id=unit.id, crowns=0,
                               cleared_at=None, attempted_at=None)

        class _ProgDB:
            """grant_unit_crown이 만지는 3개(get·execute·flush)만 응답."""

            async def get(self, model, pk):
                return unit if pk == unit.id else None

            async def execute(self, stmt):
                return _Result(prog)

            def add(self, obj):
                pass

            async def flush(self):
                pass

        xp_calls: list[int] = []

        async def fake_add_xp(db, user_id, amount):
            xp_calls.append(amount)

        original = cs.xp_service.add_xp
        cs.xp_service.add_xp = fake_add_xp
        try:
            first = asyncio.run(
                cs.unit_result_for_session(
                    _ProgDB(), _FAKE_USER, unit.id,
                    all_correct=True, grant_crown=True,
                )
            )
            second = asyncio.run(
                cs.unit_result_for_session(
                    _ProgDB(), _FAKE_USER, unit.id,
                    all_correct=True, grant_crown=True,
                )
            )
        finally:
            cs.xp_service.add_xp = original

        assert first["crowns"] == 1 and first["cleared"] is False
        # ↓ 라우터가 막지 않으면 재완료 한 번으로 여기까지 간다
        assert second["crowns"] == 2 and second["cleared"] is True
        assert second["unit_xp"] == 20 and xp_calls == [20]

    def test_데일리_세션은_unit_result_null(self, monkeypatch):
        session = make_session()
        logs = [make_log("air_mass", correct=False)]
        result, calls = run_complete(monkeypatch, session, logs)
        assert "unit_result" not in calls
        assert result.unit_result is None


# ═══════════════════════════════════════════════════════════════
# POST /board/puzzles/{id}/attempt — 최초 클리어 왕관 유입 (R8-01 §3.4)
# — limiter는 inspect.unwrap으로 우회 (test_review_fix_regressions 관례)
# ═══════════════════════════════════════════════════════════════


class _Result:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class BoardFakeDB:
    """attempt_puzzle 배선 테스트용 — ContentItem 조회만 응답, 나머지는 noop."""

    def __init__(self, item):
        self.item = item

    async def execute(self, stmt):
        return _Result(self.item)

    async def get(self, model, pk):
        return None  # XP add_xp 경로 스킵 (db_user None 가드)

    def add(self, obj):
        pass

    async def flush(self):
        pass


def make_puzzle_item(concept_tag="humidity"):
    # level_group·mode=guided → board_difficulty 1(쉬움). _FAKE_USER가 elementary라
    # 난이도 2 이상이면 attempt가 403 PUZZLE_LOCKED로 끊겨 왕관 배선까지 못 간다
    # (2026-08-10 학습 수준 잠금이 채점에도 걸리면서 드러난 공백 —
    # 종전 페이크에는 level_group 자체가 없었다).
    return SimpleNamespace(
        id=uuid.uuid4(),
        concept_tag=concept_tag,
        level_group="elementary",
        template_json={"mode": "guided"},
    )


def run_attempt(
    monkeypatch, item, *, passed=True, already_cleared=False, award=None
):
    """attempt_puzzle을 배선 검증용으로 실행 — award 호출 인자를 수집한다."""
    calls = {}

    def fake_validate(board_state):
        pass

    # 에너지 대역 (R10-01 §3.1 API 전환 — 구 consume() 제거에 따른 배선 갱신).
    # 이 파일의 검증 대상은 왕관 배선이므로 에너지는 상태만 흉내내고 통과시킨다.
    async def fake_state(db, user, now=None):
        return {"clouds": 3, "max": 5, "next_regen_sec": 0, "updated_at": None}

    async def fake_consume_if_available(db, user, now=None):
        return 2

    def fake_evaluate(question, board_state):
        return [], passed, []

    def fake_feedback(question, phenomena, ok, rules):
        return "피드백"

    async def fake_cleared(db, user):
        return {item.id} if already_cleared else set()

    async def fake_unlocked(db, user, cleared):
        # MT-24: 이 하네스의 관심사는 왕관 배선이지 잠금이 아니다 — 열린 것으로 고정.
        # 잠금 판정 자체는 tests/test_board_progression.py가 단독으로 문다.
        return {item.id}

    async def fake_quiz_id(db, user, content_item_id):
        return "board-테스트-001"

    async def fake_award(db, user, *, concept_tag, kind):
        calls["award"] = (concept_tag, kind)
        return award

    async def fake_quests(db, user, day):
        return []  # 전환 목록(라우터가 소비) — CO-T-4

    monkeypatch.setattr(board_router.board_engine, "validate_board", fake_validate)
    monkeypatch.setattr(board_router.energy_service, "get_state", fake_state)
    monkeypatch.setattr(
        board_router.energy_service, "consume_if_available", fake_consume_if_available
    )
    monkeypatch.setattr(board_router, "evaluate_board_answer", fake_evaluate)
    monkeypatch.setattr(
        board_router.board_engine, "select_feedback", fake_feedback
    )
    monkeypatch.setattr(board_router, "_cleared_item_ids", fake_cleared)
    monkeypatch.setattr(board_router, "_unlocked_ids_for", fake_unlocked)
    monkeypatch.setattr(board_router, "_next_board_quiz_id", fake_quiz_id)
    monkeypatch.setattr(cs, "award_crown_for_activity", fake_award)
    monkeypatch.setattr(
        board_router.quest_service, "recalculate_quests", fake_quests
    )

    endpoint = inspect.unwrap(board_router.attempt_puzzle)
    result = asyncio.run(
        endpoint(
            None,  # request — limiter 우회로 미사용
            item.id,
            BoardAttemptRequest(board_state={"zones": [], "elements": []}),
            _FAKE_USER,
            BoardFakeDB(item),
        )
    )
    return result, calls


class TestBoardAttemptCrownAward:
    def test_최초_클리어는_같은_개념_board_유닛에_왕관(self, monkeypatch):
        item = make_puzzle_item(concept_tag="humidity")
        result, calls = run_attempt(monkeypatch, item, award=AWARD)
        assert calls["award"] == ("humidity", "board")
        assert result.crown_award is not None
        assert result.crown_award.unit_slug == "sky-1"
        assert result.crown_award.cleared is True
        assert result.xp_earned == 5  # 기존 XP+5 판정과 동일 조건 공유

    def test_같은_퍼즐_재클리어는_불인정(self, monkeypatch):
        item = make_puzzle_item()
        result, calls = run_attempt(
            monkeypatch, item, already_cleared=True, award=AWARD
        )
        assert "award" not in calls
        assert result.crown_award is None
        assert result.xp_earned == 0

    def test_실패_시도는_왕관_미부여(self, monkeypatch):
        item = make_puzzle_item()
        result, calls = run_attempt(monkeypatch, item, passed=False, award=AWARD)
        assert "award" not in calls
        assert result.crown_award is None

    def test_대상_유닛_없으면_crown_award_null(self, monkeypatch):
        item = make_puzzle_item()
        result, calls = run_attempt(monkeypatch, item, award=None)
        assert calls["award"] == ("humidity", "board")
        assert result.crown_award is None
        assert result.passed is True
