"""기후 탐정 API (/api/v1/detective) — R13 (대장 CO-N-2: 계획서 대비 미구현 해소).

| GET  | /cases                  | 케이스 목록(요약) |
| GET  | /cases/{case_id}        | 케이스 상세 — 시계열·단서·가설 텍스트 (**정답 없음**) |
| POST | /cases/{case_id}/solve  | {hypothesis_id, opened_clue_ids} → 판정·피드백(+정답이면 해설) |

설계 결정 3건:

1. **파일 소유·DB 없음.** 케이스는 `database/seed/detective_cases.json`이 단일
   진실원이고 프로세스 캐시로 읽는다(`board_regions`·`board_rules` 선례). 유저별
   상태가 없는 정적 콘텐츠라 테이블·마이그레이션을 만들 이유가 없다. 파일이
   없거나 깨져도 라우터는 빈 목록으로 동작한다(데이터 저작 대기 관례).

   ⤷ **그 뒤 이렇게 바뀌었다 (2026-08-20, XP 적립 판정).** 케이스 *정의*는 여전히
   파일 소유이고 테이블도 마이그레이션도 새로 만들지 않았다. 다만 「이 유저가 이
   케이스로 XP를 이미 받았다」는 **사실 한 줄**만 `quiz_logs`에 남는다 —
   `solve`가 유일한 DB 접점이고(`get_db_with_rls`), 목록·상세는 지금도 DB를 보지
   않는다. 마커의 모양과 그것이 왜 다른 계열을 오염시키지 않는지는
   `schemas/detective.py`의 `DetectiveSolveResult` 독스트링이 소유한다.

2. **채점 권위는 서버.** 상세 응답에는 `verdict`·`feedback`·`supporting_clues`·
   `solution`이 **구조적으로 없다** — `schemas/detective.py`의 모델이 그 필드를
   갖지 않는다(세션 `QUESTION_PAYLOAD_FIELDS` 화이트리스트와 같은 관례).
   클라이언트가 판정을 주입할 통로도 없다: 제출은 가설 id와 연 단서 id뿐이다.

3. **단서 조사가 서버 계약이다.** `min_clues` 미만의 단서만 열고 제출하면
   422 `NOT_ENOUGH_CLUES`다. 이게 없으면 「기후 탐정」은 보기 4개짜리 객관식
   한 문제로 붕괴한다(심사 배점 ②의 문면 "단순 퀴즈·정답 맞히기를 넘어").

LLM은 관여하지 않는다 — 피드백 문구는 케이스 데이터에 미리 저작돼 있다
(무키 전 기능 동작 계약).
"""
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db_with_rls
from app.core.rate_limit import LIMIT_ANSWER, limiter, user_or_ip_key
from app.models.quiz_log import QuizLog
from app.models.user import User
from app.schemas.detective import (
    DetectiveCaseDetail,
    DetectiveCaseSummary,
    DetectiveSolution,
    DetectiveSolveRequest,
    DetectiveSolveResult,
)
from app.services import xp_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/detective", tags=["detective"])

CASES_PATH = (
    Path(__file__).resolve().parents[3] / "database" / "seed" / "detective_cases.json"
)
_cases_cache: list[dict] | None = None


def load_cases() -> list[dict]:
    """detective_cases.json 로드(프로세스 캐시). 부재·파싱 실패 → 빈 배열 + 로그.

    board_regions.load_regions와 같은 관례다 — 데이터 저작이 병렬로 진행돼도
    라우터가 500으로 죽지 않는다. status != 'active'인 케이스는 제외한다.
    """
    global _cases_cache
    if _cases_cache is not None:
        return _cases_cache
    if not CASES_PATH.exists():
        logger.info("detective_cases.json 부재 — 빈 목록 (데이터 저작 대기): %s", CASES_PATH)
        _cases_cache = []
        return _cases_cache
    try:
        data = json.loads(CASES_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        logger.warning("detective_cases.json 파싱 실패 — 빈 목록: %s", exc)
        _cases_cache = []
        return _cases_cache
    if not isinstance(data, list):
        _cases_cache = []
        return _cases_cache
    _cases_cache = [c for c in data if isinstance(c, dict) and c.get("status", "active") == "active"]
    return _cases_cache


def find_case(case_id: str) -> dict:
    """케이스 단건 — 없으면 404 CASE_NOT_FOUND."""
    for case in load_cases():
        if case.get("case_id") == case_id:
            return case
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"detail": "케이스를 찾을 수 없습니다", "code": "CASE_NOT_FOUND"},
    )


def case_summary(case: dict) -> DetectiveCaseSummary:
    return DetectiveCaseSummary(
        case_id=case.get("case_id", ""),
        title=case.get("title", ""),
        concept_tag=case.get("concept_tag", ""),
        knowledge_level=case.get("knowledge_level"),
        level_group=case.get("level_group"),
        xp_reward=case.get("xp_reward", 0) or 0,
        min_clues=case.get("min_clues", 0) or 0,
        headline=(case.get("intro") or {}).get("headline", ""),
        clue_count=len(case.get("clues") or []),
        hypothesis_count=len(case.get("hypotheses") or []),
    )


@router.get("/cases")
async def list_cases(
    user: User = Depends(get_current_user),
) -> list[DetectiveCaseSummary]:
    """케이스 목록. 0건이어도 200 + 빈 배열 — 프론트가 빈 상태를 그린다."""
    return [case_summary(c) for c in load_cases()]


@router.get("/cases/{case_id}")
async def get_case(
    case_id: str,
    user: User = Depends(get_current_user),
) -> DetectiveCaseDetail:
    """케이스 상세 — 플레이에 필요한 전부. 가설은 텍스트만(판정·근거·해설 제외)."""
    case = find_case(case_id)
    return DetectiveCaseDetail(
        case_id=case.get("case_id", ""),
        title=case.get("title", ""),
        concept_tag=case.get("concept_tag", ""),
        knowledge_level=case.get("knowledge_level"),
        level_group=case.get("level_group"),
        xp_reward=case.get("xp_reward", 0) or 0,
        min_clues=case.get("min_clues", 0) or 0,
        intro=case.get("intro") or {},
        series=case.get("series") or [],
        clues=case.get("clues") or [],
        # ⚠️ 여기서 dict를 통째로 넘기면 verdict·feedback·supporting_clues가
        # 함께 나간다. 필드 2개만 뽑는다 — 모델이 나머지를 무시하는 데 기대지 않는다.
        hypotheses=[
            {"hypothesis_id": h.get("hypothesis_id", ""), "text": h.get("text", "")}
            for h in (case.get("hypotheses") or [])
        ],
    )


# ── XP 적립 멱등 마커 (2026-08-20) ─────────────────────────────────────────
# 케이스 최초 정답에만 `xp_reward`를 주려면 「이미 줬다」를 유저별로 기억해야
# 한다. 동결 전야라 **새 테이블·새 컬럼·새 마이그레이션은 금지**였으므로 기존
# `quiz_logs`에 마커 1행을 남긴다 — 보드 탭이 `session_id IS NULL` 로그로 최초
# 클리어를 판별하는 것과 같은 자리, 같은 방식이다(board.py `_cleared_item_ids`).
#
# 🔴 `is_correct`를 **NULL로 둔다.** 이 한 칸이 이 설계의 전부다: quiz_logs를
# 읽는 계열이 전부 `is_correct IS NOT NULL`로 거르기 때문에, 이 행은 복습 큐
# (review_schedule_service.history_stmt)·일일 퀘스트(quest_service)·일일 목표
# 카운트(progress._count_answered_today) 어디에도 들어가지 않는다. 탐정 케이스는
# `content_items` 행이 아니라서 그 계열이 가리킬 문항이 없다 — 정오를 신고하면
# **문항 없는 개념 태그**가 복습 사다리에 올라간다. 판정은 탐정 도메인이 갖고,
# quiz_logs는 「XP를 이미 지급했다」만 안다.
DETECTIVE_QUIZ_PREFIX = "detective-"


def detective_quiz_id(case_id: str) -> str:
    """마커 행의 `quiz_id` — (user_id, quiz_id)가 곧 멱등 키다.

    `quiz_id`는 String(50)이고 현행 최장 case_id가 31자라 접두사 10자를 더해도
    41자다. 보드처럼 일련번호를 붙이지 않는다 — 케이스당 **딱 한 행**이어야
    존재 조회가 곧 「이미 받았다」가 된다.
    """
    return f"{DETECTIVE_QUIZ_PREFIX}{case_id}"


async def already_awarded(db: AsyncSession, user_id, case_id: str) -> bool:
    """이 유저가 이 케이스로 이미 XP를 받았는가 (마커 행 존재 조회)."""
    row = (
        await db.execute(
            select(QuizLog.id)
            .where(
                QuizLog.user_id == user_id,
                QuizLog.quiz_id == detective_quiz_id(case_id),
            )
            .limit(1)
        )
    ).first()
    return row is not None


@router.post("/cases/{case_id}/solve")
@limiter.limit(LIMIT_ANSWER, key_func=user_or_ip_key)
async def solve_case(
    request: Request,
    case_id: str,
    body: DetectiveSolveRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> DetectiveSolveResult:
    """추리 제출 — 서버 권위 판정 + **최초 정답 1회** XP 적립.

    422 두 갈래:
      - `NOT_ENOUGH_CLUES`: 연 단서가 min_clues 미만 (조사 과정 강제)
      - `UNKNOWN_HYPOTHESIS`: 케이스에 없는 가설 id

    XP는 **맞혔고 아직 안 받은 케이스**일 때만 나간다(보드 최초 클리어와 같은
    조건). 오답·부분정답은 0이지만 마커를 남기지 않으므로 **다시 도전해서 받을
    수 있다** — 첫 제출을 태우는 규칙이면 한 번 헛짚은 사람은 영원히 0이다.
    """
    case = find_case(case_id)

    min_clues = case.get("min_clues", 0) or 0
    valid_clue_ids = {c.get("clue_id") for c in (case.get("clues") or [])}
    # 미지·중복 id로 하한을 우회할 수 없게 케이스 실재 단서와 교집합만 센다.
    opened = valid_clue_ids & set(body.opened_clue_ids or [])
    if len(opened) < min_clues:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "detail": f"단서를 {min_clues}개 이상 조사한 뒤에 추리할 수 있어요",
                "code": "NOT_ENOUGH_CLUES",
                "min_clues": min_clues,
                "opened_clue_count": len(opened),
            },
        )

    hypothesis = next(
        (
            h
            for h in (case.get("hypotheses") or [])
            if h.get("hypothesis_id") == body.hypothesis_id
        ),
        None,
    )
    if hypothesis is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"detail": "알 수 없는 가설이에요", "code": "UNKNOWN_HYPOTHESIS"},
        )

    verdict = hypothesis.get("verdict", "incorrect")
    correct = verdict == "correct"
    solution_raw = case.get("solution") or {}

    # 최초 정답만 적립 — 마커를 먼저 쓰고 XP를 준다(같은 트랜잭션이라 이후 예외 시
    # 둘 다 롤백된다. 한쪽만 남으면 무한 적립이거나 영구 미지급이다).
    xp_earned = 0
    if correct and not await already_awarded(db, user.id, case_id):
        xp_earned = case.get("xp_reward", 0) or 0
        db.add(
            QuizLog(
                user_id=user.id,
                quiz_id=detective_quiz_id(case_id),
                session_id=None,
                content_item_id=None,
                concept_tag=case.get("concept_tag") or "detective",
                question_type=None,
                question_json={
                    "kind": "detective",
                    "case_id": case_id,
                    "hypothesis_id": body.hypothesis_id,
                },
                user_answer=None,
                is_correct=None,  # 위 주석 참조 — 정오를 신고하면 계열이 오염된다
                answered_at=datetime.now(timezone.utc),
            )
        )
        await db.flush()
        if xp_earned:
            await xp_service.add_xp(db, user.id, xp_earned)

    return DetectiveSolveResult(
        verdict=verdict,
        correct=correct,
        feedback=hypothesis.get("feedback", ""),
        supporting_clues=hypothesis.get("supporting_clues") or [],
        # 해설은 정답을 맞혔을 때만 — 오답 제출을 반복해 해설을 긁어갈 수 없다.
        solution=DetectiveSolution(**{
            k: solution_raw.get(k, "")
            for k in ("title", "explanation", "takeaway", "next_step_hint")
        }) if correct else None,
        xp_earned=xp_earned,  # 최초 정답 1회만 xp_reward, 그 뒤 재제출은 0
        opened_clue_count=len(opened),
        min_clues=min_clues,
    )
