"""보상 획득이 응답까지 닿는가 — R13 CO-T-4.

**무엇이 문제였나**: `quest_service.recalculate_quests`는 "무엇이 완료됐고 몇 XP인지"
(`list[QuestTransition]`)를 반환하는데 **호출부 둘(세션 complete·보드 attempt)이 모두
그 반환을 버렸다**. `badge_service.award_badge`의 bool도 마찬가지였다. 결과:

- 퀘스트 3종 최대 **+25 XP**가 지급은 되는데 획득 순간 **어느 화면에도 안 떴다**
- `perfect_session` 배지도 같은 방식으로 소리 없이 들어갔다
- 세션 요약의 "+N XP"는 문항 XP(`xp_total`)만이라 **표기가 실지급보다 최대 25 적었다**

**이 파일이 무는 것**은 "지급됐는가"가 아니라 **"지급 사실이 응답에 실리는가"**다.
지급 자체(멱등·sticky·락)는 `test_quest_recalc.py`·`test_quest_kst_day.py`가 소유한다.

경계 하나를 특히 세게 문다 — **완료 상태가 아니라 완료 *전환*만 실려야 한다.** done을
그대로 내보내면 멱등 재계산(같은 세션 재-complete, 보드 재도전)마다 "방금 완료!"가
되살아난다. 그래서 필터는 `done`이 아니라 `newly_done`이고, 재호출은 빈 리스트다.
"""
import re
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.routers import board as board_router
from app.routers import session as session_router
from app.schemas.board import BoardAttemptResult
from app.schemas.session import SessionCompleteResult
from app.services import quest_service

REPO_ROOT = Path(__file__).resolve().parents[2]


def _transition(code, *, newly_done, reward_xp, title=""):
    return quest_service.QuestTransition(
        code=code,
        progress=99,
        done=True,
        newly_done=newly_done,
        reward_xp=reward_xp,
        title=title,
    )


# ═══════════════════════════════════════════════════════════════
# 순수 — reward_events (DB 없음)
# ═══════════════════════════════════════════════════════════════


class TestRewardEvents:
    def test_완료_전환분만_실린다(self):
        events = quest_service.reward_events(
            [
                _transition(quest_service.QUEST_DAILY_XP, newly_done=True, reward_xp=10),
                # 이미 완료돼 있던 것 — 재계산으로 done은 True지만 전환은 아니다
                _transition(
                    quest_service.QUEST_WEAK_CORRECT, newly_done=False, reward_xp=0
                ),
            ]
        )
        assert [e["code"] for e in events] == [quest_service.QUEST_DAILY_XP]
        assert events[0]["reward_xp"] == 10

    def test_전환이_없으면_빈_리스트(self):
        """멱등 재호출의 모습 — 두 번째 complete는 여기로 떨어진다."""
        events = quest_service.reward_events(
            [
                _transition(code, newly_done=False, reward_xp=0)
                for code in quest_service.QUEST_ORDER
            ]
        )
        assert events == []

    def test_title은_DB_행_우선_없으면_상수_폴백(self):
        """`list_quests`와 같은 우선순위 — 두 곳이 다른 제목을 말하면 안 된다."""
        from_db = quest_service.reward_events(
            [
                _transition(
                    quest_service.QUEST_LIVE_ANSWERED,
                    newly_done=True,
                    reward_xp=5,
                    title="DB 제목",
                )
            ]
        )
        assert from_db[0]["title"] == "DB 제목"

        fallback = quest_service.reward_events(
            [
                _transition(
                    quest_service.QUEST_LIVE_ANSWERED, newly_done=True, reward_xp=5
                )
            ]
        )
        assert (
            fallback[0]["title"]
            == quest_service.QUEST_DEFS[quest_service.QUEST_LIVE_ANSWERED]["title"]
        )

    def test_보상_XP_합이_실지급과_같다(self):
        """3종 전건 동시 전환 = 10+10+5 = 25 — 표기가 그만큼 적었던 그 값."""
        events = quest_service.reward_events(
            [
                _transition(
                    code,
                    newly_done=True,
                    reward_xp=quest_service.QUEST_DEFS[code]["xp_reward"],
                )
                for code in quest_service.QUEST_ORDER
            ]
        )
        assert sum(e["reward_xp"] for e in events) == 25


# ═══════════════════════════════════════════════════════════════
# 스키마 기본값 — 필드가 없던 시절의 호출부를 깨지 않는다(additive)
# ═══════════════════════════════════════════════════════════════


class TestSchemaDefaults:
    def test_세션_응답_기본값은_전부_비어_있다(self):
        result = SessionCompleteResult(
            xp_total=30, correct_count=5, total=5, streak_count=1
        )
        assert result.quest_rewards == []
        assert result.badges_earned == []
        assert result.bonus_xp == 0

    def test_보드_응답_기본값은_전부_비어_있다(self):
        result = BoardAttemptResult(
            passed=True, phenomena=[], feedback="", xp_earned=5
        )
        assert result.quest_rewards == []
        assert result.bonus_xp == 0


# ═══════════════════════════════════════════════════════════════
# 배선 — POST /session/{id}/complete 응답에 실리는가
# ═══════════════════════════════════════════════════════════════


_USER = SimpleNamespace(id=uuid.uuid4(), level_group="elementary", streak_count=3)


class _DB:
    async def get(self, model, pk):
        return None  # streak 재조회 — user.streak_count 폴백으로 떨어진다

    async def flush(self):
        pass


def _make_session(*, completed=False, xp_total=50):
    return SimpleNamespace(
        id=uuid.uuid4(),
        user_id=_USER.id,
        mode="daily",
        unit_id=None,
        session_date=date(2026, 8, 10),
        completed_at=datetime.now(timezone.utc) if completed else None,
        xp_total=xp_total,
        route_decision=None,
    )


def _make_log(correct=True):
    return SimpleNamespace(
        concept_tag="air_mass",
        is_correct=correct,
        retry_correct=None,
        user_answer="답",
    )


def _run_complete(
    monkeypatch, session, logs, *, transitions=(), badge_granted=False
):
    async def fake_load(db, user, session_id):
        return session

    async def fake_logs(db, s):
        return logs

    async def fake_crown(db, user, *, concept_tag, kind):
        return None

    async def fake_quests(db, user, day):
        return list(transitions)

    async def fake_award(db, user_id, code):
        return badge_granted

    async def fake_detail(db, code):
        return {"code": code, "title": "무결점 세션", "description": "설명"}

    async def no_closing(db, s, user=None):
        return None

    monkeypatch.setattr(session_router, "_load_session_or_404", fake_load)
    monkeypatch.setattr(session_router, "_session_logs", fake_logs)
    monkeypatch.setattr(
        session_router.curriculum_service, "award_crown_for_activity", fake_crown
    )
    monkeypatch.setattr(session_router.quest_service, "recalculate_quests", fake_quests)
    monkeypatch.setattr(session_router.badge_service, "award_badge", fake_award)
    monkeypatch.setattr(session_router.badge_service, "badge_detail", fake_detail)
    monkeypatch.setattr(session_router, "_closing_step", no_closing)

    import asyncio

    return asyncio.run(session_router.complete_session(session.id, _USER, _DB()))


class TestSessionCompleteSurface:
    def test_완료_전환이_응답에_실리고_XP_표기가_실지급과_같아진다(self, monkeypatch):
        session = _make_session(xp_total=50)
        result = _run_complete(
            monkeypatch,
            session,
            [_make_log(), _make_log()],
            transitions=[
                _transition(
                    quest_service.QUEST_DAILY_XP,
                    newly_done=True,
                    reward_xp=10,
                    title="오늘 XP 30 모으기",
                ),
                _transition(
                    quest_service.QUEST_LIVE_ANSWERED,
                    newly_done=True,
                    reward_xp=5,
                    title="실황 문항에 답하기",
                ),
                _transition(
                    quest_service.QUEST_WEAK_CORRECT, newly_done=False, reward_xp=0
                ),
            ],
            badge_granted=True,
        )

        assert [r.code for r in result.quest_rewards] == [
            quest_service.QUEST_DAILY_XP,
            quest_service.QUEST_LIVE_ANSWERED,
        ]
        assert result.bonus_xp == 15
        # `xp_total`은 문항 XP 그대로(회귀 방지), 표기용 총합만 보정된다
        assert result.xp_total == 50
        assert result.xp_awarded == 65
        assert [b.code for b in result.badges_earned] == ["perfect_session"]

    def test_전환_없는_완료는_빈_목록이고_표기가_문항_XP와_같다(self, monkeypatch):
        session = _make_session(xp_total=40)
        result = _run_complete(
            monkeypatch,
            session,
            [_make_log()],
            transitions=[
                _transition(code, newly_done=False, reward_xp=0)
                for code in quest_service.QUEST_ORDER
            ],
        )
        assert result.quest_rewards == []
        assert result.bonus_xp == 0
        assert result.xp_awarded == result.xp_total == 40

    def test_이미_완료한_세션_재_complete는_배지를_다시_안_띄운다(self, monkeypatch):
        """재-complete는 `is_first_complete=False`라 배지 지급 자체가 안 돈다.

        지급이 안 도는 것과 **알림이 안 뜨는 것**은 다른 문제다 — 여기서 무는 것은
        후자다. 지급이 멱등이어도 알림이 매번 뜨면 화면이 거짓말을 한다.
        """
        session = _make_session(completed=True)
        result = _run_complete(
            monkeypatch,
            session,
            [_make_log()],
            badge_granted=True,  # 지급이 돌기만 하면 True를 주는 대역
        )
        assert result.badges_earned == []

    def test_배지가_이미_보유분이면_안_실린다(self, monkeypatch):
        """`award_badge`가 False(ON CONFLICT DO NOTHING) = 신규 획득이 아니다."""
        result = _run_complete(
            monkeypatch,
            _make_session(),
            [_make_log()],
            badge_granted=False,
        )
        assert result.badges_earned == []


# ═══════════════════════════════════════════════════════════════
# 배선 — 보드 attempt (미통과면 재계산 자체가 안 돈다)
# ═══════════════════════════════════════════════════════════════


class TestBoardAttemptSurface:
    def test_미통과_시도는_퀘스트_보상을_말하지_않는다(self):
        """`passed=False`면 `recalculate_quests`를 부르지 않는다 — 라우터 소스 계약.

        보드는 실패해도 응답이 나가는 경로라, 실패 응답에 보상이 실리면
        "틀렸는데 뭔가 받았다"가 된다. 호출 자체가 `if passed:` 안에 있는지를 문다.
        """
        source = (REPO_ROOT / "backend/app/routers/board.py").read_text(
            encoding="utf-8"
        )
        match = re.search(
            r"if passed:\n(?:.*\n)*?\s+transitions = await quest_service\.recalculate_quests",
            source,
        )
        assert match, "보드의 퀘스트 재계산이 `if passed:` 블록 밖으로 나왔다"


# ═══════════════════════════════════════════════════════════════
# 소스 계약 — "반환을 버린다"가 되살아나지 못하게
# ═══════════════════════════════════════════════════════════════


class TestNoDiscardedReturns:
    """이 결함의 형태는 **문법적으로 완전히 정상인 한 줄**이었다.

    `await quest_service.recalculate_quests(...)` — 에러도, 경고도, 실패하는 테스트도
    없다. 반환을 버렸다는 사실은 오직 "화면에 안 뜬다"로만 나타났고, 그래서 감사가
    전수로 읽기 전까지 아무도 몰랐다. 같은 줄이 다시 쓰이면 여기서 잡는다.
    """

    @pytest.mark.parametrize(
        "path", ["backend/app/routers/session.py", "backend/app/routers/board.py"]
    )
    def test_recalculate_quests_반환을_버리는_호출이_없다(self, path):
        source = (REPO_ROOT / path).read_text(encoding="utf-8")
        discarded = re.findall(
            r"^\s*await quest_service\.recalculate_quests\(", source, re.MULTILINE
        )
        assert not discarded, (
            f"{path}: 반환을 받지 않는 recalculate_quests 호출이 있다 (CO-T-4). "
            "`transitions = await ...` 로 받아 reward_events로 응답에 실을 것"
        )

    def test_award_badge_반환을_버리는_호출이_세션_라우터에_없다(self):
        source = (REPO_ROOT / "backend/app/routers/session.py").read_text(
            encoding="utf-8"
        )
        discarded = re.findall(
            r"^\s*await badge_service\.award_badge\(", source, re.MULTILINE
        )
        assert not discarded, (
            "session.py: 반환을 받지 않는 award_badge 호출이 있다 (CO-T-4)"
        )
