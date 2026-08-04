"""간격반복 복습 스케줄 read-model — 스프린트 R11-01 §3 C2 (AI-W).

quiz_logs만으로 개념별 "다음 복습 시점"을 재계산한다. 테이블·마이그레이션·celery
불요 — 응답 이력이 이미 다 있으므로 읽기 시점 파생값으로 충분하다(저장 없음).

weak_tags(θ 파생 약점 — quest_service·/weak-tags)와 **다른 축**이다:
- weak_tags = "θ가 낮은 개념" (능력 축 — 지금 못 하는 것)
- 복습 큐 = "마지막 학습 후 시간이 지나 복습할 때가 된 개념" (시간 축 —
  잘하더라도 잊기 전에 다시 볼 것). 두 목록은 독립적으로 소비된다.

간격 규칙 (단순 사다리 — SM-2 전체 이식 아님, 결정적·설명 가능):
- 개념별 **말미 연속 정답 횟수**(trailing streak — 마지막 오답 이후의 정답 수)가
  사다리 인덱스다. 오답이 나오면 스트릭이 0으로 리셋되어 이튿날 다시 복습.
- 다음 복습일 = 마지막 응답의 KST 달력일 + REVIEW_INTERVALS_DAYS[min(streak, 끝)].
  경계는 리포 관례(session_service.kst_day_start_utc — KST 자정의 UTC 환산)와
  동일해, "오늘" 정의가 세션 발급·일일 목표 카운트와 어긋나지 않는다.
- 배치고사(placement) 세션 응답은 **제외**한다 — 진단 스냅샷이지 학습이 아니고,
  포함하면 가입 직후 전 개념이 "학습됨"으로 잡혀 큐가 오염된다. 전례:
  progress._count_answered_today의 D10-2 제외와 같은 판단.

구조 (quest_service 관례 — TEAM_PROCESS §1.2 테스트 피라미드):
- 순수 함수(summarize_history·interval_days·next_review_at·build_review_queue)는
  DB 의존이 없어 pytest가 DB 없이 검증한다. 파라미터(사다리)는 계약 테스트로 고정.
- DB 결합부(load_history·get_review_queue)는 read-only SELECT 1회뿐이다.
  채점·에너지 로직 불가침 — 이 모듈은 어떤 상태도 쓰지 않는다.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.quiz_log import QuizLog
from app.models.session import Session
from app.models.user import User
from app.services import placement_service, session_service
from app.services.weather_api import KST

# ── 간격 사다리 (일 단위, 계약값 — test_review_schedule이 드리프트 감시) ──
# 인덱스 = 말미 연속 정답 횟수(오답 직후 0), 끝을 넘으면 마지막 값 유지(캡).
# streak 0(방금 틀림) → 1일 뒤, 1 → 3일, 2 → 7일, 3 → 14일, 4+ → 30일.
REVIEW_INTERVALS_DAYS: tuple[int, ...] = (1, 3, 7, 14, 30)


# ═══════════════════════════════════════════════════════════════
# 순수 함수 — DB 의존 없음 (단위 테스트 대상)
# ═══════════════════════════════════════════════════════════════


@dataclass(frozen=True)
class ReviewFact:
    """복습 스케줄 재계산용 응답 1건 — (개념, 정오, 응답 시각 tz-aware)."""

    concept_tag: str
    is_correct: bool
    answered_at: datetime


@dataclass(frozen=True)
class ConceptReviewState:
    """개념 1개의 이력 요약 — 마지막 응답 시각 + 말미 연속 정답 횟수."""

    concept_tag: str
    last_answered_at: datetime
    consecutive_correct: int


def summarize_history(facts: list[ReviewFact]) -> list[ConceptReviewState]:
    """응답 이력(answered_at 오름차순)을 개념별 요약으로 접는다 (순수·결정적).

    개념마다 마지막 응답 시각과 말미 연속 정답 횟수(정답 +1, 오답 리셋 0)를
    남긴다. 입력이 시간 오름차순이어야 스트릭이 맞다 — load_history가 보장.
    반환은 concept_tag 오름차순(결정적 순서).
    """
    streaks: dict[str, int] = {}
    last_at: dict[str, datetime] = {}
    for fact in facts:
        tag = fact.concept_tag
        streaks[tag] = streaks.get(tag, 0) + 1 if fact.is_correct else 0
        last_at[tag] = fact.answered_at
    return [
        ConceptReviewState(
            concept_tag=tag,
            last_answered_at=last_at[tag],
            consecutive_correct=streaks[tag],
        )
        for tag in sorted(last_at)
    ]


def interval_days(consecutive_correct: int) -> int:
    """말미 연속 정답 횟수 → 복습 간격(일). 사다리 끝을 넘으면 마지막 값(캡)."""
    index = min(consecutive_correct, len(REVIEW_INTERVALS_DAYS) - 1)
    return REVIEW_INTERVALS_DAYS[index]


def next_review_at(last_answered_at: datetime, consecutive_correct: int) -> datetime:
    """다음 복습 시점 = (마지막 응답의 KST 달력일 + 간격)의 KST 자정 (UTC 반환).

    시·분이 아니라 달력일 단위다 — "복습할 날"이 세션 발급의 하루 정의
    (datetime.now(KST).date())와 같은 축에 놓여, KST 00:00~09:00 응답이
    "어제"로 새는 문제(R10-01 D2)를 그대로 회피한다.
    """
    last_day = last_answered_at.astimezone(KST).date()
    due_day = last_day + timedelta(days=interval_days(consecutive_correct))
    return session_service.kst_day_start_utc(due_day)


def build_review_queue(
    states: list[ConceptReviewState], now: datetime
) -> list[dict]:
    """개념별 요약 → 복습 큐 항목 (순수·결정적).

    due = 다음 복습 시점 도래 여부(now ≥ next_review_at). 전 개념을 스케줄과
    함께 반환하고 next_review_at 오름차순(동률은 concept_tag)으로 정렬한다 —
    due(이미 도래)가 자연히 앞에 온다. 필터링은 소비자(프론트) 몫.
    """
    items = []
    for state in states:
        due_at = next_review_at(state.last_answered_at, state.consecutive_correct)
        items.append(
            {
                "concept_tag": state.concept_tag,
                "last_answered_at": state.last_answered_at,
                "consecutive_correct": state.consecutive_correct,
                "interval_days": interval_days(state.consecutive_correct),
                "next_review_at": due_at,
                "due": now >= due_at,
            }
        )
    items.sort(key=lambda it: (it["next_review_at"], it["concept_tag"]))
    return items


def history_stmt(user_id):
    """유저의 복습 대상 응답 이력 SELECT 구성 (실행 없음 — SQL 레벨 테스트 대상).

    - is_correct·answered_at 확정분만 (미응답 로그 제외)
    - 배치고사 세션 로그 제외 (모듈 독스트링 — 세션 밖 로그(보드 등)는 포함)
    - answered_at 오름차순 (summarize_history의 스트릭 전제)
    """
    return (
        select(QuizLog.concept_tag, QuizLog.is_correct, QuizLog.answered_at)
        .join(Session, QuizLog.session_id == Session.id, isouter=True)
        .where(
            QuizLog.user_id == user_id,
            QuizLog.is_correct.is_not(None),
            QuizLog.answered_at.is_not(None),
            or_(
                QuizLog.session_id.is_(None),
                Session.mode != placement_service.MODE_PLACEMENT,
            ),
        )
        .order_by(QuizLog.answered_at.asc(), QuizLog.id.asc())
    )


# ═══════════════════════════════════════════════════════════════
# DB 결합부 — read-only SELECT 1회 (저장·갱신 없음)
# ═══════════════════════════════════════════════════════════════


async def load_history(db: AsyncSession, user: User) -> list[ReviewFact]:
    """quiz_logs에서 복습 대상 응답 이력을 시간 오름차순으로 읽는다 (read-only)."""
    rows = (await db.execute(history_stmt(user.id))).all()
    return [
        ReviewFact(
            concept_tag=tag, is_correct=bool(correct), answered_at=answered
        )
        for tag, correct, answered in rows
    ]


async def get_review_queue(
    db: AsyncSession, user: User, now: datetime
) -> list[dict]:
    """GET /progress/review-queue 응답 — 이력 로드 + 순수 재계산 (저장 없음)."""
    facts = await load_history(db, user)
    return build_review_queue(summarize_history(facts), now)
