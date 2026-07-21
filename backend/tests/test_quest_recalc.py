"""일일 퀘스트 재계산 계약 테스트 — 스프린트 R4-01 §3.1 (R4-S1).

재계산 핵심(recompute_progress·plan_transitions)은 DB 의존이 없는 순수 함수라
DB 없이 검증한다. 핵심 불변식:
- 멱등: 같은 입력을 여러 번 재계산해도 같은 진행도 (이벤트 카운터 아님)
- 완료 전환 1회 지급: 미완료→완료에서만 xp_reward, 이후 재계산은 재지급 없음
- done은 sticky: 진행도가 내려가도 완료 유지
"""
from app.services import quest_service
from app.services.quest_service import (
    QUEST_DAILY_XP,
    QUEST_DEFS,
    QUEST_LIVE_ANSWERED,
    QUEST_WEAK_CORRECT,
    AnswerFact,
    plan_transitions,
    recompute_progress,
)


def _fact(correct=True, weak=False, live=False):
    return AnswerFact(is_correct=correct, is_weak=weak, is_live=live)


class TestRecomputeProgress:
    def test_daily_xp는_기본배율_합계(self):
        # 정답 첫시도 = 15, 오답 = 2. 약점 1.5배는 퀘스트 집계에서 제외(기본 배율).
        facts = [_fact(correct=True), _fact(correct=True), _fact(correct=False)]
        progress = recompute_progress(facts)
        assert progress[QUEST_DAILY_XP] == 15 + 15 + 2

    def test_약점_1_5배는_daily_xp에_반영_안됨(self):
        weak = recompute_progress([_fact(correct=True, weak=True)])
        plain = recompute_progress([_fact(correct=True, weak=False)])
        assert weak[QUEST_DAILY_XP] == plain[QUEST_DAILY_XP] == 15

    def test_weak_correct는_약점_정답만_카운트(self):
        facts = [
            _fact(correct=True, weak=True),    # 카운트
            _fact(correct=True, weak=False),   # 약점 아님
            _fact(correct=False, weak=True),   # 오답
        ]
        assert recompute_progress(facts)[QUEST_WEAK_CORRECT] == 1

    def test_live_answered는_정오답_무관_응답수(self):
        facts = [
            _fact(correct=True, live=True),
            _fact(correct=False, live=True),   # 오답이어도 '응답'
            _fact(correct=True, live=False),
        ]
        assert recompute_progress(facts)[QUEST_LIVE_ANSWERED] == 2

    def test_빈_로그는_전부_0(self):
        progress = recompute_progress([])
        assert progress == {
            QUEST_DAILY_XP: 0,
            QUEST_WEAK_CORRECT: 0,
            QUEST_LIVE_ANSWERED: 0,
        }

    def test_멱등_같은_입력_같은_출력(self):
        facts = [_fact(correct=True, weak=True), _fact(correct=True, live=True)]
        assert recompute_progress(facts) == recompute_progress(facts)


class TestPlanTransitions:
    def test_완료_전환시_보상_1회(self):
        # daily_xp 30 도달(15+15), weak 1, live 1 → 3종 모두 완료·보상
        progress = {QUEST_DAILY_XP: 30, QUEST_WEAK_CORRECT: 1, QUEST_LIVE_ANSWERED: 1}
        transitions = {t.code: t for t in plan_transitions(progress, prior_done={})}
        assert transitions[QUEST_DAILY_XP].newly_done is True
        assert transitions[QUEST_DAILY_XP].reward_xp == QUEST_DEFS[QUEST_DAILY_XP]["xp_reward"]
        assert transitions[QUEST_WEAK_CORRECT].reward_xp == 10
        assert transitions[QUEST_LIVE_ANSWERED].reward_xp == 5

    def test_이미_완료면_재지급_없음(self):
        progress = {QUEST_DAILY_XP: 30, QUEST_WEAK_CORRECT: 1, QUEST_LIVE_ANSWERED: 1}
        prior = {QUEST_DAILY_XP: True, QUEST_WEAK_CORRECT: True, QUEST_LIVE_ANSWERED: True}
        for t in plan_transitions(progress, prior):
            assert t.newly_done is False
            assert t.reward_xp == 0
            assert t.done is True  # 완료 유지

    def test_미달은_미완료_보상_없음(self):
        progress = {QUEST_DAILY_XP: 29, QUEST_WEAK_CORRECT: 0, QUEST_LIVE_ANSWERED: 0}
        transitions = {t.code: t for t in plan_transitions(progress, prior_done={})}
        assert transitions[QUEST_DAILY_XP].done is False
        assert transitions[QUEST_DAILY_XP].reward_xp == 0

    def test_경계_정확히_target이면_완료(self):
        progress = {QUEST_DAILY_XP: 30, QUEST_WEAK_CORRECT: 1, QUEST_LIVE_ANSWERED: 1}
        transitions = {t.code: t for t in plan_transitions(progress, prior_done={})}
        assert transitions[QUEST_DAILY_XP].done is True

    def test_done_sticky_진행도_내려가도_완료_유지(self):
        # 완료 후 재계산에서 진행도가 target 미만으로 떨어져도 done 유지, 재지급 없음
        progress = {QUEST_DAILY_XP: 0, QUEST_WEAK_CORRECT: 0, QUEST_LIVE_ANSWERED: 0}
        prior = {QUEST_DAILY_XP: True, QUEST_WEAK_CORRECT: True, QUEST_LIVE_ANSWERED: True}
        for t in plan_transitions(progress, prior):
            assert t.done is True
            assert t.newly_done is False
            assert t.reward_xp == 0

    def test_재계산_두번_호출_보상_총합_1회(self):
        """멱등 시뮬레이션: 1차에서 완료·지급, 2차(1차 결과를 prior로)에서는 미지급."""
        progress = {QUEST_DAILY_XP: 30, QUEST_WEAK_CORRECT: 1, QUEST_LIVE_ANSWERED: 1}
        first = plan_transitions(progress, prior_done={})
        prior_after = {t.code: t.done for t in first}
        second = plan_transitions(progress, prior_after)
        assert sum(t.reward_xp for t in first) == 10 + 10 + 5
        assert sum(t.reward_xp for t in second) == 0


class TestQuestDefsContract:
    def test_정의_3종_고정(self):
        assert set(QUEST_DEFS) == {QUEST_DAILY_XP, QUEST_WEAK_CORRECT, QUEST_LIVE_ANSWERED}

    def test_target과_보상_계약값(self):
        assert QUEST_DEFS[QUEST_DAILY_XP]["target"] == 30
        assert QUEST_DEFS[QUEST_DAILY_XP]["xp_reward"] == 10
        assert QUEST_DEFS[QUEST_WEAK_CORRECT]["target"] == 1
        assert QUEST_DEFS[QUEST_WEAK_CORRECT]["xp_reward"] == 10
        assert QUEST_DEFS[QUEST_LIVE_ANSWERED]["target"] == 1
        assert QUEST_DEFS[QUEST_LIVE_ANSWERED]["xp_reward"] == 5

    def test_응답_순서_고정(self):
        assert quest_service.QUEST_ORDER == (
            QUEST_DAILY_XP, QUEST_WEAK_CORRECT, QUEST_LIVE_ANSWERED,
        )
