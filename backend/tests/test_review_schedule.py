"""간격반복 복습 스케줄 계약 테스트 — 스프린트 R11-01 §3 C2 (AI-W).

핵심(summarize_history·interval_days·next_review_at·build_review_queue)은
DB 의존이 없는 순수 함수라 DB 없이 검증한다(quest_service 테스트 관례). 불변식:
- 결정적: 같은 이력이면 언제 몇 번을 재계산해도 같은 스케줄 (저장 상태 없음)
- 사다리 파라미터는 계약값 — 변경 시 이 테스트가 드리프트를 잡는다
- 오답 리셋: 오답 직후엔 항상 사다리 처음(1일)으로 돌아간다
- KST 달력일 축: 세션 발급의 하루 정의와 같은 경계(kst_day_start_utc — D2)
- 배치고사 응답 제외 (D10-2 전례) — SQL 레벨에서 성립해야 한다
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

from app.routers import progress as progress_router
from app.schemas.progress import ReviewQueueItem
from app.services import review_schedule_service as rs
from app.services.review_schedule_service import (
    REVIEW_INTERVALS_DAYS,
    ConceptReviewState,
    ReviewFact,
    build_review_queue,
    history_stmt,
    interval_days,
    next_review_at,
    summarize_history,
)
from app.services.weather_api import KST


def _fact(tag="pressure_front", correct=True, at=None):
    return ReviewFact(
        concept_tag=tag,
        is_correct=correct,
        answered_at=at or datetime(2026, 8, 4, 12, 0, tzinfo=KST),
    )


def _state(tag="pressure_front", at=None, streak=0):
    return ConceptReviewState(
        concept_tag=tag,
        last_answered_at=at or datetime(2026, 8, 4, 12, 0, tzinfo=KST),
        consecutive_correct=streak,
    )


class TestIntervalContract:
    def test_사다리_계약값_고정(self):
        # 계약 수치 — 바꾸려면 이 테스트와 함께 (드리프트 감시)
        assert REVIEW_INTERVALS_DAYS == (1, 3, 7, 14, 30)

    def test_사다리는_순증가(self):
        assert list(REVIEW_INTERVALS_DAYS) == sorted(set(REVIEW_INTERVALS_DAYS))

    def test_streak별_간격_매핑(self):
        assert interval_days(0) == 1   # 방금 틀림 → 이튿날
        assert interval_days(1) == 3
        assert interval_days(2) == 7
        assert interval_days(3) == 14
        assert interval_days(4) == 30

    def test_사다리_끝을_넘으면_캡(self):
        assert interval_days(10) == REVIEW_INTERVALS_DAYS[-1] == 30


class TestSummarizeHistory:
    def test_연속_정답이_스트릭으로_쌓인다(self):
        facts = [_fact(correct=True), _fact(correct=True), _fact(correct=True)]
        [state] = summarize_history(facts)
        assert state.consecutive_correct == 3

    def test_오답은_스트릭_리셋(self):
        facts = [
            _fact(correct=True),
            _fact(correct=True),
            _fact(correct=False),  # 리셋
            _fact(correct=True),
        ]
        [state] = summarize_history(facts)
        assert state.consecutive_correct == 1  # 말미 스트릭만 (오답 이후 1)

    def test_마지막_응답이_오답이면_스트릭_0(self):
        facts = [_fact(correct=True), _fact(correct=False)]
        [state] = summarize_history(facts)
        assert state.consecutive_correct == 0

    def test_개념별_독립_집계(self):
        t = datetime(2026, 8, 4, 12, 0, tzinfo=KST)
        facts = [
            _fact("humidity", correct=True, at=t),
            _fact("pressure_front", correct=False, at=t + timedelta(minutes=1)),
            _fact("humidity", correct=True, at=t + timedelta(minutes=2)),
        ]
        states = {s.concept_tag: s for s in summarize_history(facts)}
        assert states["humidity"].consecutive_correct == 2
        assert states["pressure_front"].consecutive_correct == 0

    def test_last_answered는_개념의_마지막_응답_시각(self):
        t = datetime(2026, 8, 4, 12, 0, tzinfo=KST)
        facts = [_fact(at=t), _fact(at=t + timedelta(hours=2))]
        [state] = summarize_history(facts)
        assert state.last_answered_at == t + timedelta(hours=2)

    def test_빈_이력은_빈_요약(self):
        assert summarize_history([]) == []

    def test_반환은_concept_tag_오름차순_결정적(self):
        facts = [_fact("zzz"), _fact("aaa"), _fact("mmm")]
        tags = [s.concept_tag for s in summarize_history(facts)]
        assert tags == ["aaa", "mmm", "zzz"]
        assert summarize_history(facts) == summarize_history(facts)  # 멱등


class TestNextReviewAt:
    def test_다음_복습은_KST_자정_경계(self):
        # 8/4 낮 응답·streak 0 → 8/5 00:00 KST = 8/4 15:00 UTC
        at = datetime(2026, 8, 4, 12, 0, tzinfo=KST)
        due = next_review_at(at, 0)
        assert due == datetime(2026, 8, 4, 15, 0, tzinfo=timezone.utc)
        assert due.tzinfo is not None

    def test_UTC_저녁_응답도_KST_달력일로_귀속(self):
        # 8/4 16:00 UTC = 8/5 01:00 KST → 기준일은 8/5 (UTC 자정 기준이면 8/4로 샜다 — D2)
        at_utc = datetime(2026, 8, 4, 16, 0, tzinfo=timezone.utc)
        due = next_review_at(at_utc, 0)
        assert due.astimezone(KST).date() == datetime(2026, 8, 6, tzinfo=KST).date()

    def test_KST_자정_직전_직후_경계(self):
        before = datetime(2026, 8, 4, 14, 59, tzinfo=timezone.utc)  # 23:59 KST 8/4
        after = datetime(2026, 8, 4, 15, 0, tzinfo=timezone.utc)    # 00:00 KST 8/5
        assert next_review_at(after, 0) - next_review_at(before, 0) == timedelta(days=1)

    def test_스트릭이_클수록_간격이_늘어난다(self):
        at = datetime(2026, 8, 4, 12, 0, tzinfo=KST)
        dues = [next_review_at(at, n) for n in range(5)]
        assert dues == sorted(dues)
        assert dues[-1] - dues[0] == timedelta(days=30 - 1)

    def test_결정적_같은_입력_같은_출력(self):
        at = datetime(2026, 8, 4, 12, 0, tzinfo=KST)
        assert next_review_at(at, 2) == next_review_at(at, 2)


class TestBuildReviewQueue:
    def test_도래한_개념은_due_true(self):
        at = datetime(2026, 8, 1, 12, 0, tzinfo=KST)
        now = datetime(2026, 8, 4, 12, 0, tzinfo=KST)  # streak 0 → 8/2 도래
        [item] = build_review_queue([_state(at=at, streak=0)], now)
        assert item["due"] is True
        assert item["interval_days"] == 1

    def test_미도래_개념은_due_false지만_큐에_실린다(self):
        at = datetime(2026, 8, 4, 12, 0, tzinfo=KST)
        now = datetime(2026, 8, 4, 13, 0, tzinfo=KST)  # streak 4 → 9/3 도래
        [item] = build_review_queue([_state(at=at, streak=4)], now)
        assert item["due"] is False
        assert item["next_review_at"] > now

    def test_도래_시각_정각이면_due(self):
        at = datetime(2026, 8, 4, 12, 0, tzinfo=KST)
        due_at = next_review_at(at, 0)
        [item] = build_review_queue([_state(at=at, streak=0)], now=due_at)
        assert item["due"] is True

    def test_next_review_at_오름차순_정렬_due가_앞(self):
        old = _state("humidity", at=datetime(2026, 8, 1, 12, 0, tzinfo=KST), streak=0)
        new = _state("radiation", at=datetime(2026, 8, 4, 12, 0, tzinfo=KST), streak=4)
        now = datetime(2026, 8, 4, 13, 0, tzinfo=KST)
        queue = build_review_queue([new, old], now)
        assert [it["concept_tag"] for it in queue] == ["humidity", "radiation"]
        assert [it["due"] for it in queue] == [True, False]

    def test_동률은_concept_tag_오름차순(self):
        at = datetime(2026, 8, 4, 12, 0, tzinfo=KST)
        states = [_state("zz", at=at), _state("aa", at=at)]
        queue = build_review_queue(states, at)
        assert [it["concept_tag"] for it in queue] == ["aa", "zz"]

    def test_빈_요약은_빈_큐(self):
        assert build_review_queue([], datetime.now(KST)) == []


class TestHistoryStmtSql:
    """배치고사 제외·미응답 제외가 SQL 레벨에서 성립하는지 (D10-2 전례 가드)."""

    def _sql(self):
        stmt = history_stmt(uuid.uuid4())
        return str(stmt.compile(compile_kwargs={"literal_binds": True}))

    def test_배치고사_세션_제외(self):
        sql = self._sql()
        assert "sessions.mode != 'placement'" in sql
        assert "quiz_logs.session_id IS NULL" in sql  # 세션 밖 로그(보드)는 포함

    def test_미응답_로그_제외(self):
        sql = self._sql()
        assert "quiz_logs.is_correct IS NOT NULL" in sql
        assert "quiz_logs.answered_at IS NOT NULL" in sql

    def test_시간_오름차순_정렬(self):
        # summarize_history의 스트릭 전제 — 오름차순이 깨지면 스트릭이 틀어진다
        assert "ORDER BY quiz_logs.answered_at ASC" in self._sql()


# ═══════════════════════════════════════════════════════════════
# 배관 — GET /progress/review-queue (read-only, 저장 없음)
# ═══════════════════════════════════════════════════════════════


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class FakeDB:
    """history_stmt SELECT 1회만 실행되는 read-only 대역 — 튜플 행 반환."""

    def __init__(self, rows):
        self._rows = rows
        self.execute_count = 0

    async def execute(self, stmt):
        self.execute_count += 1
        return _FakeResult(self._rows)


class _FakeUser:
    id = uuid.uuid4()


class TestReviewQueueEndpoint:
    def test_응답이_스키마로_직렬화되고_SELECT_1회(self):
        # 먼 과거 이력 — 최장 간격(30일)도 이미 도래해 due 판정이 시계에 안 흔들린다
        t = datetime(2020, 1, 1, 12, 0, tzinfo=KST)
        db = FakeDB(
            [
                ("humidity", True, t),
                ("humidity", True, t + timedelta(hours=1)),
                ("pressure_front", False, t + timedelta(hours=2)),
            ]
        )
        items = asyncio.run(
            progress_router.get_review_queue(user=_FakeUser(), db=db)
        )
        assert db.execute_count == 1  # read-only SELECT 1회 (저장·갱신 없음)
        assert all(isinstance(it, ReviewQueueItem) for it in items)
        by_tag = {it.concept_tag: it for it in items}
        assert by_tag["humidity"].consecutive_correct == 2
        assert by_tag["humidity"].interval_days == 7
        assert by_tag["pressure_front"].consecutive_correct == 0
        assert by_tag["pressure_front"].interval_days == 1
        # 먼 과거 응답이라 현재 시각 기준 둘 다 도래
        assert by_tag["humidity"].due and by_tag["pressure_front"].due

    def test_이력_없으면_빈_큐(self):
        items = asyncio.run(
            progress_router.get_review_queue(user=_FakeUser(), db=FakeDB([]))
        )
        assert items == []

    def test_get_review_queue_서비스는_저장_함수가_없다(self):
        """read-model 가드 — 모듈이 add/flush/commit류 쓰기를 일절 안 한다."""
        import inspect

        src = inspect.getsource(rs)
        for forbidden in ("db.add", ".flush(", ".commit(", "update(", "delete("):
            assert forbidden not in src
