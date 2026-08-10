"""일일 퀘스트 진행·완료 재계산 — 스프린트 R4-01 §3.1 (R4-S1).

정의 3종(코드 고정, quests 테이블 정적 시드와 일치):
- daily_xp_30: 오늘 획득 XP 합계 ≥ 30 → 보상 +10
- weak_correct_1: 약점 개념(θ < 학령 상대 임계 — R8-01 §3.5) 문항 정답 1회 → +10
- live_answered: 실황 문항(uses_live_slots) 1회 응답 → +5

갱신 시점(§3.1): 세션 complete·보드 attempt 성공 시 **당일 quiz_logs·XP 집계로
재계산**한다. 이벤트 카운터가 아니라 오늘 상태로부터의 재계산이므로 몇 번 호출해도
같은 진행도가 나오며(멱등), 완료 전환(미완료→완료) 시에만 xp_reward를 1회 지급한다.
done은 단조(sticky) — 한번 완료되면 이후 재계산에서 진행도가 내려가도 완료를 유지한다.

구조적 결정 (TEAM_PROCESS §1.2 테스트 피라미드):
- 진행도 재계산(recompute_progress)과 완료 전환·보상 산정(plan_transitions)은
  DB 의존이 없는 순수 함수로 분리해 pytest가 DB 없이 검증한다.
- daily_xp_30의 "오늘 XP"는 오늘 응답 로그를 quiz_xp 공식으로 재집계한 값이다.
  약점 1.5배 보너스는 지급 시점의 약점 스냅샷(비영속)에 의존하므로, 재집계를
  quiz_logs만의 순수 함수(멱등)로 유지하기 위해 기본 배율(is_weak=False)로 계산한다
  — 실제 유저 XP 잔액에는 보너스가 반영되나, 퀘스트 임계 집계는 하한값을 쓴다.
  임계 30 = 첫 시도 정답 2문항(15+15)으로 세션 내 도달 가능하다.

반환 소비 (R13 CO-T-4): `recalculate_quests`는 전환 목록을 반환하고 **호출부가 그것을
화면까지 내려보낸다**. 종전에는 두 호출부(세션 complete·보드 attempt)가 모두 버려서
퀘스트 3종 최대 +25 XP가 지급만 되고 획득 순간 어디에도 뜨지 않았다. 화면에 실리는
것은 `reward_events`로 거른 **newly_done**뿐이다 — 완료 상태를 그대로 내보내면
멱등 재계산 때마다 "방금 완료!"가 되살아난다.

하루 경계 · 귀속 기준 (R13 CO-T-1·T-2·T-3):
- **"오늘"은 언제나 KST 달력일의 UTC 구간**이다. `quiz_logs.answered_at`은 UTC 정규화
  timestamptz라 `.date()`로 날짜를 비교하면 **KST 00:00~09:00 응답이 어제로 샌다**
  (session_service.kst_day_start_utc 독스트링이 경고하는 바로 그 실패). 경계 계산은
  `session_service.kst_day_start_utc` 단일 공급원을 재사용한다 — 상수 사본 금지.
- 세션 로그도 `session_date`가 아니라 **응답 시각(answered_at)**으로 귀속한다.
  23:55 발급 → 00:05 완료한 세션의 자정 이후 응답은 "오늘"에 들어간다.
- 퀘스트 행(`quest_date`)도 **재계산 시각(KST)**의 날짜다. 호출부가 어제 날짜
  (`session.session_date`)를 넘겨도 어제 행을 되살리지 않는다 — 그래야 자정 직후
  "어제 세션 완료 + 오늘 유닛 세션 완료"로 일일 퀘스트를 두 세트 받지 못한다.
"""
import logging
import uuid
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.content_item import ContentItem
from app.models.quest import Quest, UserQuestProgress
from app.models.quiz_log import QuizLog
from app.models.user import User
from app.services import session_service, weatherbrain_service, xp_service
from app.services.weather_api import KST

logger = logging.getLogger(__name__)

# ── 퀘스트 정의 (코드 고정 — quests 정적 시드와 일치, §3.1) ──
QUEST_DAILY_XP = "daily_xp_30"
QUEST_WEAK_CORRECT = "weak_correct_1"
QUEST_LIVE_ANSWERED = "live_answered"

# code → {title, target, xp_reward}. target은 rule_json에도 있으나 재계산 로직의
# 단일 공급원으로 여기 상수를 쓴다(quests 테이블은 id·title·xp_reward 제공).
QUEST_DEFS: dict[str, dict] = {
    QUEST_DAILY_XP: {"title": "오늘 XP 30 모으기", "target": 30, "xp_reward": 10},
    QUEST_WEAK_CORRECT: {"title": "약점 개념 1문제 정복", "target": 1, "xp_reward": 10},
    QUEST_LIVE_ANSWERED: {"title": "실황 문항에 답하기", "target": 1, "xp_reward": 5},
}
# 응답 순서 고정 — GET /progress/quests 응답 순서
QUEST_ORDER = (QUEST_DAILY_XP, QUEST_WEAK_CORRECT, QUEST_LIVE_ANSWERED)


# ═══════════════════════════════════════════════════════════════
# 순수 함수 — DB 의존 없음 (단위 테스트 대상)
# ═══════════════════════════════════════════════════════════════


def kst_today() -> date:
    """지금 시각의 KST 달력일 — 퀘스트 귀속일 단일 공급원 (CO-T-3)."""
    return datetime.now(KST).date()


def kst_day_window(day: date) -> tuple[datetime, datetime]:
    """KST 달력일 `day`에 해당하는 UTC 반열린 구간 [start, end) (CO-T-1).

    `answered_at`(UTC 정규화 timestamptz)을 `.date() == day`로 비교하면 KST
    00:00~09:00 응답이 전날로 새므로, 날짜 비교 대신 항상 이 구간을 쓴다.
    경계 계산 자체는 `session_service.kst_day_start_utc`가 단일 소유한다.
    """
    return (
        session_service.kst_day_start_utc(day),
        session_service.kst_day_start_utc(day + timedelta(days=1)),
    )


@dataclass(frozen=True)
class AnswerFact:
    """오늘 응답한 quiz_log 1건의 퀘스트 재계산용 사실.

    is_correct: 정답 여부, is_weak: 약점 개념 문항 여부(θ 파생 스냅샷 기준 —
    R8-01 §3.5), is_live: 실황 문항(uses_live_slots) 여부.
    """

    is_correct: bool
    is_weak: bool
    is_live: bool


def recompute_progress(facts: list[AnswerFact]) -> dict[str, int]:
    """오늘 응답 로그로부터 3종 퀘스트 진행도를 재집계한다 (§3.1, 순수·멱등).

    - daily_xp_30: 각 응답을 첫 시도·기본 배율로 quiz_xp 환산한 합계
    - weak_correct_1: 약점 태그 정답 응답 수
    - live_answered: 실황 문항 응답 수(정오답 무관 — "응답 1회")
    """
    daily_xp = sum(
        xp_service.quiz_xp(f.is_correct, is_first_try=True, is_weak=False)
        for f in facts
    )
    weak_correct = sum(1 for f in facts if f.is_correct and f.is_weak)
    live_answered = sum(1 for f in facts if f.is_live)
    return {
        QUEST_DAILY_XP: daily_xp,
        QUEST_WEAK_CORRECT: weak_correct,
        QUEST_LIVE_ANSWERED: live_answered,
    }


@dataclass(frozen=True)
class QuestTransition:
    """재계산 결과 1종 — 저장할 진행도/완료와 이번에 지급할 보상 XP.

    `title`은 DB 결합부(`recalculate_quests`)에서만 채운다. 순수
    `plan_transitions`는 quests 테이블을 모르므로 빈 문자열로 두고, 소비자는
    `reward_events`를 거쳐 QUEST_DEFS 폴백을 받는다 (CO-T-4).
    """

    code: str
    progress: int
    done: bool
    newly_done: bool
    reward_xp: int
    title: str = ""


def plan_transitions(
    progress_map: dict[str, int],
    prior_done: dict[str, bool],
) -> list[QuestTransition]:
    """진행도 + 직전 완료 상태로 저장 전환과 보상 지급을 산정한다 (순수·멱등).

    - done = 직전 done 또는 (진행도 ≥ target) — 단조(sticky), 재계산으로 내려가지 않음
    - newly_done = 미완료→완료 전환일 때만 True (이때만 xp_reward 1회 지급)
    prior_done에 없는 코드는 미완료(False)로 본다(첫 재계산).
    """
    transitions: list[QuestTransition] = []
    for code in QUEST_ORDER:
        definition = QUEST_DEFS[code]
        progress = progress_map.get(code, 0)
        was_done = prior_done.get(code, False)
        reached = progress >= definition["target"]
        done = was_done or reached
        newly_done = done and not was_done
        transitions.append(
            QuestTransition(
                code=code,
                progress=progress,
                done=done,
                newly_done=newly_done,
                reward_xp=definition["xp_reward"] if newly_done else 0,
            )
        )
    return transitions


def reward_events(transitions: list[QuestTransition]) -> list[dict]:
    """전환 목록 → **이번에 완료된 것만** 추린 화면용 이벤트 (CO-T-4, 순수).

    `recalculate_quests`는 3종 전건을 항상 반환한다(진행도 저장이 목적). 화면이
    필요한 것은 그중 `newly_done`뿐이다 — 완료 상태를 그대로 내보내면 재계산할
    때마다 "방금 완료!"가 다시 뜬다. 그래서 필터는 done이 아니라 **newly_done**이고,
    멱등 재호출(같은 세션 재-complete)에서는 자연히 빈 리스트가 된다.

    title은 DB 행 우선, 없으면 QUEST_DEFS 상수 — `list_quests`와 같은 우선순위다.
    """
    return [
        {
            "code": t.code,
            "title": t.title or QUEST_DEFS[t.code]["title"],
            "reward_xp": t.reward_xp,
        }
        for t in transitions
        if t.newly_done
    ]


# ═══════════════════════════════════════════════════════════════
# DB 결합부
# ═══════════════════════════════════════════════════════════════


async def _weak_concepts(db: AsyncSession, user: User) -> set[str]:
    """유저의 현재 약점 개념 집합 — θ 파생 단일 공급원 (R8-01 §3.5).

    저장 θ read-only(load_abilities) + weatherbrain_service.weak_concepts
    (num_responses>0 AND θ < 학령 상대 임계). ai-worker 미호출.
    """
    abilities = await weatherbrain_service.load_abilities(db, user)
    return set(weatherbrain_service.weak_concepts(abilities, user.level_group))


async def _today_facts(
    db: AsyncSession, user: User, today: date
) -> list[AnswerFact]:
    """오늘(KST) 응답한 quiz_logs를 퀘스트 재계산용 AnswerFact로 변환한다.

    - is_weak: 응답 태그가 현재 약점 스냅샷에 포함되는지
    - is_live: 응답 문항의 content_item이 uses_live_slots=true 인지
      (실황 문항은 뱅크의 live 콘텐츠에서만 나온다 — 생성 폴백은 실황 아님)

    "오늘" 판정은 **세션 로그·세션 밖 로그(보드 등)를 가리지 않고** `answered_at`이
    KST 당일 구간 [00:00, 익일 00:00) KST에 드는지 하나로 한다 (CO-T-1·T-3).
    이전 구현은 세션 로그를 `session_date`로, 나머지를 naive `.date()`로 갈라
    ⒜ KST 00:00~09:00 보드 응답을 전부 놓치고 ⒝ 자정을 넘긴 세션을 어제로 귀속했다.
    날짜 필터는 **SQL WHERE로** 내린다 — 유저 전체 quiz_logs를 로드한 뒤 파이썬에서
    거르면 실운영에서 선형 악화한다 (CO-T-14).
    """
    day_start, day_end = kst_day_window(today)
    today_logs = (
        (
            await db.execute(
                select(QuizLog).where(
                    QuizLog.user_id == user.id,
                    QuizLog.is_correct.is_not(None),  # 응답 완료분만
                    QuizLog.answered_at >= day_start,
                    QuizLog.answered_at < day_end,
                )
            )
        )
        .scalars()
        .all()
    )

    # 실황 문항 판정 — 오늘 로그가 참조하는 content_item 중 uses_live_slots=true
    content_ids = {log.content_item_id for log in today_logs if log.content_item_id}
    live_ids: set[uuid.UUID] = set()
    if content_ids:
        live_ids = set(
            (
                await db.execute(
                    select(ContentItem.id).where(
                        ContentItem.id.in_(content_ids),
                        ContentItem.uses_live_slots.is_(True),
                    )
                )
            )
            .scalars()
            .all()
        )

    weak = await _weak_concepts(db, user)
    return [
        AnswerFact(
            is_correct=bool(log.is_correct),
            is_weak=log.concept_tag in weak,
            is_live=log.content_item_id in live_ids,
        )
        for log in today_logs
    ]


async def _load_quests(db: AsyncSession) -> dict[str, Quest]:
    """quests 정적 정의를 code→행으로 로드 (FK quest_id 확보용)."""
    rows = (await db.execute(select(Quest))).scalars().all()
    return {q.code: q for q in rows}


async def recalculate_quests(
    db: AsyncSession, user: User, today: date | None = None
) -> list[QuestTransition]:
    """오늘 상태로 3종 퀘스트를 재계산·저장하고 완료 전환분 보상을 지급한다 (§3.1).

    멱등: 이벤트 카운터가 아니라 오늘 quiz_logs·XP 집계로부터 재계산하므로 몇 번
    호출해도 진행도가 같고, done은 sticky이며 보상은 미완료→완료 전환에만 1회 지급된다.
    quests 시드가 아직 없으면(마이그레이션 미적용) 조용히 건너뛴다.

    **귀속일은 항상 재계산 시각의 KST 달력일**이다 (CO-T-3). `today`는 하위호환용
    힌트일 뿐이며, 자정을 넘겨 끝난 세션의 `session_date`(어제)가 들어와도 어제 행을
    되살리지 않는다 — 되살리면 자정 직후 24시간 안에 일일 퀘스트를 두 세트 받는다.

    **동시성** (CO-T-7): 진입 즉시 유저 행을 잠근다. 진행도 SELECT → 보상 UPDATE
    사이에 두 번째 요청(완료 버튼 더블클릭)이 끼어들면 둘 다 prior_done=False를 읽어
    보상이 두 번 나간다. UNIQUE(user_id, quest_id, quest_date)는 INSERT만 막고
    UPDATE는 못 막으므로 행 락이 유일한 차단이며, 락을 첫 문장에 두어야 아직 행이
    없는 첫 재계산의 INSERT 경합까지 함께 직렬화된다.
    """
    quest_day = kst_today()
    if today is not None and today != quest_day:
        logger.info(
            "quest attribution: caller day %s -> KST today %s (CO-T-3)",
            today,
            quest_day,
        )
    today = quest_day

    # 유저 행 락 — 같은 유저의 재계산을 트랜잭션 단위로 직렬화 (CO-T-7).
    # 요청 1건 = 트랜잭션 1건(get_db_with_rls)이라 커밋까지 유지된다.
    await db.execute(select(User.id).where(User.id == user.id).with_for_update())

    quests = await _load_quests(db)
    if not quests:
        return []

    facts = await _today_facts(db, user, today)
    progress_map = recompute_progress(facts)

    existing = (
        (
            await db.execute(
                select(UserQuestProgress).where(
                    UserQuestProgress.user_id == user.id,
                    UserQuestProgress.quest_date == today,
                )
            )
        )
        .scalars()
        .all()
    )
    # quest_id → 행, code → 직전 done
    id_to_code = {q.id: code for code, q in quests.items()}
    rows_by_code = {
        id_to_code[row.quest_id]: row
        for row in existing
        if row.quest_id in id_to_code
    }
    prior_done = {code: row.done for code, row in rows_by_code.items()}

    transitions = plan_transitions(progress_map, prior_done)

    # 반환분에 표시용 제목을 실어 보낸다 (CO-T-4). 호출부가 "무엇이 완료됐는지"를
    # 화면에 띄우려면 code만으로는 부족한데, 여기서 이미 quests 행을 들고 있으므로
    # 라우터가 같은 테이블을 다시 조회할 이유가 없다.
    titled: list[QuestTransition] = []

    for transition in transitions:
        quest = quests.get(transition.code)
        titled.append(
            replace(transition, title=quest.title)
            if quest is not None
            else transition
        )
        if quest is None:
            continue
        row = rows_by_code.get(transition.code)
        if row is None:
            row = UserQuestProgress(
                user_id=user.id, quest_id=quest.id, quest_date=today
            )
            db.add(row)
            rows_by_code[transition.code] = row
        row.progress = transition.progress
        row.done = transition.done
        if transition.reward_xp:
            await xp_service.add_xp(db, user.id, transition.reward_xp)

    await db.flush()
    return titled


async def list_quests(db: AsyncSession, user: User, today: date) -> list[dict]:
    """GET /progress/quests 응답 — 오늘 진행도(읽기 재계산) + 저장된 완료 상태 (§3.1).

    보상 지급 없이 진행도만 재집계해 표시한다(완료 전환·지급은 recalculate_quests
    트리거에서만 일어난다). done은 저장 행 기준(없으면 False).
    """
    quests = await _load_quests(db)
    facts = await _today_facts(db, user, today)
    progress_map = recompute_progress(facts)

    existing = (
        (
            await db.execute(
                select(UserQuestProgress).where(
                    UserQuestProgress.user_id == user.id,
                    UserQuestProgress.quest_date == today,
                )
            )
        )
        .scalars()
        .all()
    )
    id_to_code = {q.id: code for code, q in quests.items()}
    done_by_code = {
        id_to_code[row.quest_id]: row.done
        for row in existing
        if row.quest_id in id_to_code
    }

    out: list[dict] = []
    for code in QUEST_ORDER:
        definition = QUEST_DEFS[code]
        quest = quests.get(code)
        out.append(
            {
                "code": code,
                "title": quest.title if quest is not None else definition["title"],
                "progress": progress_map.get(code, 0),
                "target": definition["target"],
                "done": done_by_code.get(code, False),
                "xp_reward": quest.xp_reward
                if quest is not None
                else definition["xp_reward"],
            }
        )
    return out
