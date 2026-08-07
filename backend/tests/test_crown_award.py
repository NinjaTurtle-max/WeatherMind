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
        """하늘 읽기: quiz(pf)→board(pf), 공기의 힘: quiz(am, prereq=board)."""
        u_quiz = make_unit("하늘 읽기", 1, kind="quiz", concept_tag="pressure_front")
        u_board = make_unit(
            "하늘 읽기", 2, kind="board", concept_tag="pressure_front",
            prereq=u_quiz.id, crown_target=2,
        )
        u_am = make_unit(
            "공기의 힘", 1, kind="quiz", concept_tag="air_mass", prereq=u_board.id
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
    """로더가 전부 monkeypatch되는 배선 테스트용 — get만 유닛을 돌려준다."""

    def __init__(self, unit=None):
        self.unit = unit

    async def get(self, model, pk):
        return self.unit

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


def make_session(mode="daily", unit_id=None, completed=False, route_target=None):
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

    async def fake_quests(db, user, day):
        calls["quests"] = day

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

    def test_유닛_세션_만점_최초_완료도_grant_crown_False(self, monkeypatch):
        """R13-01 §2.10 왕관 소유권 이전 — 유닛 직접 진입은 **연습 전용**이다.

        개정 전에는 (unit_id, True, True)로 왕관을 가산했다. 왕관 유입로가 일일
        세션의 진도 블록으로 옮겨졌으므로 여기서 또 주면 하루 1왕관 상한이
        무너진다(같은 진도에 이중 수여). 진도 스냅샷 노출은 그대로다.
        """
        unit_id = uuid.uuid4()
        session = make_session(mode="unit", unit_id=unit_id)
        logs = [make_log("air_mass") for _ in range(5)]
        result, calls = run_complete(
            monkeypatch, session, logs, unit_payload=self.UNIT_PAYLOAD
        )
        assert calls["unit_result"] == (unit_id, True, False)
        assert result.unit_result is not None
        assert result.unit_result.all_correct is True
        assert result.unit_result.crowns == 1
        assert result.unit_result.crown_target == 1
        assert result.unit_result.cleared is True
        assert result.unit_result.unit_xp == 20
        # 데일리 유입로(mode 분기)는 유닛 세션에 미적용
        assert "award" not in calls and result.crown_award is None

    def test_오답_있으면_grant_crown_False_스냅샷(self, monkeypatch):
        unit_id = uuid.uuid4()
        session = make_session(mode="unit", unit_id=unit_id)
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

    def test_재완료_멱등도_스냅샷_grant_crown_False(self, monkeypatch):
        unit_id = uuid.uuid4()
        session = make_session(mode="unit", unit_id=unit_id, completed=True)
        logs = [make_log("air_mass") for _ in range(5)]
        result, calls = run_complete(
            monkeypatch, session, logs, unit_payload=self.UNIT_PAYLOAD
        )
        assert calls["unit_result"] == (unit_id, True, False)
        assert result.unit_result is not None  # 재완료에도 계약 필드는 노출

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
    return SimpleNamespace(
        id=uuid.uuid4(), concept_tag=concept_tag, template_json={"mode": "guided"}
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

    async def fake_quiz_id(db, user, content_item_id):
        return "board-테스트-001"

    async def fake_award(db, user, *, concept_tag, kind):
        calls["award"] = (concept_tag, kind)
        return award

    async def fake_quests(db, user, day):
        pass

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
