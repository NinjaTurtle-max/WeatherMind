"""기후 탐정 API (/api/v1/detective) — R13 (대장 CO-N-2: 계획서 대비 미구현 해소).

| GET  | /cases                  | 케이스 목록(요약) |
| GET  | /cases/{case_id}        | 케이스 상세 — 시계열·단서·가설 텍스트 (**정답 없음**) |
| POST | /cases/{case_id}/solve  | {hypothesis_id, opened_clue_ids} → 판정·피드백(+정답이면 해설) |

설계 결정 3건:

1. **파일 소유·DB 없음.** 케이스는 `database/seed/detective_cases.json`이 단일
   진실원이고 프로세스 캐시로 읽는다(`board_regions`·`board_rules` 선례). 유저별
   상태가 없는 정적 콘텐츠라 테이블·마이그레이션을 만들 이유가 없다. 파일이
   없거나 깨져도 라우터는 빈 목록으로 동작한다(데이터 저작 대기 관례).

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
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core.dependencies import get_current_user
from app.core.rate_limit import LIMIT_ANSWER, limiter, user_or_ip_key
from app.models.user import User
from app.schemas.detective import (
    DetectiveCaseDetail,
    DetectiveCaseSummary,
    DetectiveSolution,
    DetectiveSolveRequest,
    DetectiveSolveResult,
)

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


@router.post("/cases/{case_id}/solve")
@limiter.limit(LIMIT_ANSWER, key_func=user_or_ip_key)
async def solve_case(
    request: Request,
    case_id: str,
    body: DetectiveSolveRequest,
    user: User = Depends(get_current_user),
) -> DetectiveSolveResult:
    """추리 제출 — 서버 권위 판정.

    422 두 갈래:
      - `NOT_ENOUGH_CLUES`: 연 단서가 min_clues 미만 (조사 과정 강제)
      - `UNKNOWN_HYPOTHESIS`: 케이스에 없는 가설 id
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
        xp_earned=0,  # 영속이 없어 적립하지 않는다 — 스키마 주석 참조
        opened_clue_count=len(opened),
        min_clues=min_clues,
    )
