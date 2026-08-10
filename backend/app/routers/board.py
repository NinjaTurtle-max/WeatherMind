"""대기 보드 연습 API (/api/v1/board) — 스프린트 R3-01 §3.5 (R3-S3).

세션 밖 단독 플레이. 규칙(§3.2)은 서버가 파일 캐시하는 단일 진실원이며,
퍼즐 판정은 서버가 board_state를 규칙 엔진으로 재판정하는 권위 채점이다(§3.4).

| GET  | /rules                        | board_rules.json 원문(서버 캐시) — 프론트 로컬 미리보기 |
| GET  | /puzzles                      | active board 문항 + cleared + 난이도(1~3), 저작 순서 정렬 |
| GET  | /puzzles/{content_item_id}    | 퍼즐 단건(플레이 진입) — 구름 진입 게이트 (R10-01 §3.1) |
| POST | /puzzles/{content_item_id}/attempt | {board_state} → {passed, phenomena, feedback, xp_earned} |

- cleared = quiz_logs에 해당 content_item_id로 is_correct=true 로그가 존재.
- 최초 클리어만 +5 XP(재도전 0). 클리어 판정 여부와 무관하게 시도는 quiz_logs
  (session_id NULL, quiz_id "board-{content_item_id 앞 8자}-{seq}")로 남긴다.
- 레이트리밋: attempt 30회/분/유저(§3.5 = LIMIT_ANSWER 재사용).
- 규칙 파일 부재/스키마 오류는 503(데이터 저작 대기·데이터 오류) — 판정 불가 시
  퍼즐 클리어를 기록하지 않는다.
"""
import json
import logging
from collections.abc import Iterable
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db_with_rls
from app.core.rate_limit import LIMIT_ANSWER, limiter, user_or_ip_key
from app.models.content_item import ContentItem
from app.models.quiz_log import QuizLog
from app.models.user import User
from app.schemas.board import BoardAttemptRequest, BoardAttemptResult, BoardPuzzle
from app.schemas.curriculum import CrownAward
from app.services import (
    board_engine,
    curriculum_service,
    energy_service,
    quest_service,
    weatherbrain_service,
    xp_service,
)
from app.services.answer_service import BoardStateRequiredError, evaluate_board_answer
from app.services.weather_api import KST

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/board", tags=["board"])

# 지도 지역 좌표 파일 (§3.1) — 판정 미사용, 프론트 렌더 전용. 프로세스 캐시.
REGIONS_PATH = (
    Path(__file__).resolve().parents[3] / "database" / "seed" / "board_regions.json"
)
_regions_cache: list[dict] | None = None


def load_regions() -> list[dict]:
    """board_regions.json 로드(프로세스 캐시). 부재·오류 시 빈 배열 + 로그 (§3.1).

    데이터 직군이 병렬 저작 중이므로 부재해도 라우터는 동작한다(seed_content 패턴).
    """
    global _regions_cache
    if _regions_cache is not None:
        return _regions_cache
    if not REGIONS_PATH.exists():
        logger.info("board_regions.json 부재 — 빈 배열 반환 (데이터 저작 대기): %s", REGIONS_PATH)
        _regions_cache = []
        return _regions_cache
    try:
        data = json.loads(REGIONS_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        logger.warning("board_regions.json 파싱 실패 — 빈 배열 반환: %s", exc)
        _regions_cache = []
        return _regions_cache
    _regions_cache = data if isinstance(data, list) else []
    return _regions_cache


@router.get("/regions")
async def get_regions(
    user: User = Depends(get_current_user),
) -> list[dict]:
    """지도 지역 좌표(board_regions.json) — 존↔지역 매핑 렌더 전용 (§3.1)."""
    return load_regions()


def board_clear_xp(passed: bool, already_cleared: bool) -> int:
    """§3.5 최초 클리어 보상 규칙: 통과 & 미클리어일 때만 +5 XP, 그 외 0(재도전 포함)."""
    return xp_service.XP_BOARD_CLEAR if (passed and not already_cleared) else 0


@router.get("/rules")
async def get_rules(
    user: User = Depends(get_current_user),
) -> list[dict]:
    """board_rules.json 반환 (서버 파일 캐시 — 프론트 로컬 미리보기 단일 진실원).

    ⚠️ **`note_*` 키는 벗겨서 내보낸다.** 저작 메모(`note_authoring` 등)는 규칙을 왜
    그렇게 썼는지 다음 저작자에게 남기는 글이지 화면이 쓰는 값이 아니다. 원문을 그대로
    내보내면 내부 메모가 브라우저 개발자 도구에 그대로 뜬다 — 판정에 안 쓰이므로
    벗겨도 프론트 미리보기는 서버와 같은 답을 낸다(공유 벡터가 그걸 검증한다).

    규칙 부재·스키마 오류(BoardRulesError) → 503은 main.py 전역 핸들러 담당.
    """
    return [
        {k: v for k, v in rule.items() if not k.startswith("note_")}
        for rule in board_engine.load_rules()
    ]


def locked_difficulties(items: Iterable[tuple[int, bool]]) -> set[int]:
    """난이도 묶음 잠금 — (난이도, 클리어여부) 목록 → **잠긴 난이도 집합**.

    규칙(2026-08-10 사용자 지시): 쉬움을 **전부** 깨야 보통이 열리고, 보통까지
    전부 깨야 어려움이 열린다. 난이도 **안에서는 순서가 없다** — 열린 묶음의
    퍼즐은 아무거나 고른다.

    ⚠️ 2026-08-06에 걷어낸 「순차 잠금」과 다른 것이다. 그때는 퍼즐 하나하나가
    앞 퍼즐을 요구해서 고를 자유가 없었고, 그래서 걷어냈다. 여기서 강제하는 것은
    **묶음 사이**뿐이라 그 결정과 어긋나지 않는다.

    DB를 타지 않는 순수 함수다(board_difficulty·order_puzzles_for_progress 관례) —
    잠금 규칙만 따로 고정할 수 있어야 회귀를 싸게 잡는다.

    빈 난이도는 건너뛴다(저작이 아직 없는 묶음이 다음 묶음을 영원히 잠그면 안 된다).
    """
    total: dict[int, int] = {}
    done: dict[int, int] = {}
    for difficulty, cleared in items:
        total[difficulty] = total.get(difficulty, 0) + 1
        if cleared:
            done[difficulty] = done.get(difficulty, 0) + 1

    locked: set[int] = set()
    blocked = False
    for difficulty in sorted(total):
        if blocked:
            locked.add(difficulty)
            continue
        # 아직 다 못 깬 묶음은 **열려 있다**(지금 푸는 중이다). 그 뒤가 잠긴다.
        if done.get(difficulty, 0) < total[difficulty]:
            blocked = True
    return locked

def board_difficulty(template_json: dict, level_group: str) -> int:
    """보드 퍼즐 난이도 라벨 1(쉬움)~3(어려움) — R7-02 §3.5 (표시 전용, 잠금 없음).

    규칙(순수 함수 — 가중은 시드 12건에서 1~3이 고루 나오도록 조정, 테스트 고정):
    - 기본점: mode == "guided"(단계 안내) → 1, 그 외(goal_only 등 목표만 제시) → 2
    - time_limit_sec 존재(양수) → +1 (시간 압박)
    - palette 요소 3개 이상 → +1 (배치 조합 공간 확대)
    - 사전 b가 adult 이상인 밴드(adult·expert) → +1 (서버측 유일 난이도 축 —
      content_items.level_group). R13 §2.2로 밴드가 4종이 되면서 "adult" 문자열
      비교에서 사전 b 임계로 바꿨다 — 상위 밴드가 늘어도 easy로 오분류되지 않는다.
      결과가 3에서 클램프되므로 adult/expert의 표시값은 여전히 같다.
    - 상한 3·하한 1 클램프
    """
    template = template_json or {}
    score = 1 if template.get("mode") == "guided" else 2
    if template.get("time_limit_sec"):
        score += 1
    palette = template.get("palette")
    if isinstance(palette, (list, dict)) and len(palette) >= 3:
        score += 1
    prior_b = weatherbrain_service.LEVEL_GROUP_ITEM_B.get(
        level_group, weatherbrain_service.DEFAULT_ITEM_B
    )
    if prior_b >= weatherbrain_service.LEVEL_GROUP_ITEM_B["adult"]:
        score += 1
    return max(1, min(3, score))


def order_puzzles_for_progress(items: list) -> list:
    """퍼즐을 **저작된 진행 순서**(template_json.board_order)로 세운다.

    순서를 서버가 파생하지 않고 **시드가 소유**한다(units.json의 `unit_order`와 같은
    관례). 난이도 배치(쉬움 → 보통 → 어려움)는 저작 결정이라 코드가 아니라 데이터에
    있어야 리뷰·수정이 된다. 잠금은 없고 순서는 권유다 — 학습자는 아무 칸이나 고른다.

    board_order가 없는 문항은 뒤로 보내고 입력 순서(created_at)를 유지한다 —
    구 시드·새로 생성된 문항이 섞여도 목록이 비지 않는다.

    ⚠️ θ 근접 정렬(order_puzzles_for_theta)을 **대체**한다. 화면이 난이도 순 격자라
    개인별로 순서가 흔들리면 "쉬움부터 차례로"가 성립하지 않는다. θ 함수는 세션
    문항 풀에서 계속 쓰이므로 남겨 둔다.
    """
    def order_of(item) -> int:
        # `or`로 기본값을 주면 board_order=0이 "없음"으로 삼켜진다 — 명시 비교.
        value = (item.template_json or {}).get("board_order")
        return value if isinstance(value, int) else 10_000

    return sorted(items, key=order_of)


def order_puzzles_for_theta(items: list, theta: float | None) -> list:
    """퍼즐 목록을 |사전 b(level_group) − θ| 오름차순으로 정렬 (R7-02 §3.5).

    사전 b는 weatherbrain_service.LEVEL_GROUP_ITEM_B(session_service 뱅크 풀
    정렬과 동일 상수 — 단일 소유) 재사용. θ가 None(콜드스타트: 능력 미배정)이면
    입력 순서(created_at) 그대로 반환하고, 동률도 입력 순서를 유지한다(안정 정렬).
    잠금 없음 — 순서만 바꾸고 전 퍼즐을 노출한다.
    """
    if theta is None:
        return list(items)

    def gap(item) -> float:
        b = weatherbrain_service.LEVEL_GROUP_ITEM_B.get(
            item.level_group, weatherbrain_service.DEFAULT_ITEM_B
        )
        return abs(b - theta)

    return sorted(items, key=gap)


async def _cleared_item_ids(db: AsyncSession, user: User) -> set[UUID]:
    """**보드 탭에서** 클리어한 content_item_id 집합 (R13 CO-K1).

    ⚠️ 조건이 두 개인 이유 — 여기가 좁혀지지 않으면 보드 탭 보상이 통째로 증발한다:

    `session_id IS NULL`
        보드 탭 attempt는 `session_id=None`으로 로그를 남기는 **유일한 경로**다
        (세션·유닛·배치고사 세 경로는 전부 `session_id=session.id`를 채운다 —
        session_service·curriculum_service·placement_service). daily 세션 풀은
        board 문항을 **제외하지 않으므로**(`build_pool_query`에 유형 조건 없음)
        이 조건이 없으면 **세션에서 맞힌 board가 보드 탭 칸을 미리 ✅로 만들고**,
        그 칸을 실제로 풀어도 `already_cleared`라 **XP 0·왕관 0이 영구 확정**된다.
        "안 눌러 본 퍼즐이 이미 깨져 있고 다시 풀어도 아무것도 안 준다."

    `question_type == 'board'`
        R2-01 이전 레거시 행도 `session_id`가 NULL이다(quiz_log 모델 주석 참조).
        유형까지 봐야 보드 탭 로그만 남는다.

    board 문항을 daily 풀에서 제외하는 **뿌리 수리는 session_service 소유**다.
    여기서는 보상 판정만 보드 탭 경로로 좁힌다 — 뿌리가 고쳐져도 이 조건은
    옳은 상태로 남는다(세션 board가 사라지면 걸러낼 것이 없어질 뿐).
    """
    rows = (
        (
            await db.execute(
                select(QuizLog.content_item_id).where(
                    QuizLog.user_id == user.id,
                    QuizLog.content_item_id.is_not(None),
                    QuizLog.is_correct.is_(True),
                    QuizLog.session_id.is_(None),
                    QuizLog.question_type == "board",
                )
            )
        )
        .scalars()
        .all()
    )
    return {row for row in rows if row is not None}


@router.get("/puzzles", response_model=list[BoardPuzzle])
async def list_puzzles(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> list[BoardPuzzle]:
    """active board 문항 목록 — template_json 전체 + cleared + 난이도.

    정렬: 시드가 저작한 진행 순서(template_json.board_order) — 난이도 오름차순으로
    저작돼 있다. θ 근접 정렬을 대체한다(2026-08-05).

    **난이도 묶음 잠금**(2026-08-10 사용자 지시): 쉬움을 전부 깨야 보통이, 보통까지
    전부 깨야 어려움이 열린다. 규칙은 `locked_difficulties`가 소유한다.
    묶음 **안에서는** 여전히 순서가 없다 — 2026-08-06에 걷어낸 퍼즐 단위 순차
    잠금(고를 자유가 없어 되돌렸다)과 강제하는 범위가 다르다.

    목록 자체는 **무차단**이다. 잠긴 퍼즐도 제목과 함께 내려보내고 `locked`만
    참으로 준다 — 무엇이 기다리는지 보이지 않으면 잠금이 동기가 아니라 벽이 된다.
    실제 차단은 진입(GET /puzzles/{id})이 한다.
    """
    items = list(
        (
            await db.execute(
                select(ContentItem)
                .where(
                    ContentItem.status == "active",
                    ContentItem.question_type == "board",
                )
                .order_by(ContentItem.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    items = order_puzzles_for_progress(items)
    cleared = await _cleared_item_ids(db, user)
    graded = [
        (item, board_difficulty(item.template_json, item.level_group), item.id in cleared)
        for item in items
    ]
    locked = locked_difficulties((difficulty, done) for _, difficulty, done in graded)
    return [
        BoardPuzzle(
            content_item_id=item.id,
            template_json=item.template_json or {},
            cleared=done,
            difficulty=difficulty,
            locked=difficulty in locked,
        )
        for item, difficulty, done in graded
    ]


async def _load_puzzle_or_404(db: AsyncSession, content_item_id: UUID) -> ContentItem:
    """active board 문항 단건 조회 — 부재 시 404 PUZZLE_NOT_FOUND."""
    item = (
        await db.execute(
            select(ContentItem).where(
                ContentItem.id == content_item_id,
                ContentItem.status == "active",
                ContentItem.question_type == "board",
            )
        )
    ).scalar_one_or_none()
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": "해당 보드 퍼즐을 찾을 수 없습니다.", "code": "PUZZLE_NOT_FOUND"},
        )
    return item


async def _locked_difficulties_for(db: AsyncSession, user: User) -> set[int]:
    """이 유저에게 잠긴 난이도 집합 — 목록과 **같은 규칙**을 진입에서도 쓴다.

    두 곳이 규칙을 따로 구현하면 화면에는 열린 퍼즐이 진입에서 403이 나거나
    그 반대가 된다. 계산은 `locked_difficulties`가 소유하고 여기는 재료만 모은다.
    """
    items = list(
        (
            await db.execute(
                select(ContentItem).where(
                    ContentItem.status == "active",
                    ContentItem.question_type == "board",
                )
            )
        )
        .scalars()
        .all()
    )
    cleared = await _cleared_item_ids(db, user)
    return locked_difficulties(
        (board_difficulty(i.template_json, i.level_group), i.id in cleared) for i in items
    )

@router.get("/puzzles/{content_item_id}", response_model=BoardPuzzle)
async def get_puzzle_detail(
    content_item_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> BoardPuzzle:
    """퍼즐 단건(플레이 진입) — 목록과 **같은 스키마**를 돌려준다 (R10-01 D1·D8-2).

    이 엔드포인트가 R10-01 §3.1의 보드측 진입 차단 지점이다: 잔량 부족이면 퍼즐을
    열기 전에 429 OUT_OF_CLOUDS(next_regen_sec 동봉)로 막는다. 목록
    (GET /puzzles)은 **무차단** — 차단하면 잔량 0인 유저가 보드 화면 자체를 못 보고
    cleared 표시도 사라진다.
    """
    item = await _load_puzzle_or_404(db, content_item_id)
    cleared = await _cleared_item_ids(db, user)
    difficulty = board_difficulty(item.template_json, item.level_group)

    # 난이도 잠금 — **구름 검사보다 먼저**다. 잠긴 퍼즐은 잔량이 있어도 못 여는데,
    # 순서를 바꾸면 잔량 0인 사람이 "구름이 없어서"라는 틀린 이유를 듣는다.
    # 화면도 막지만 여기서 다시 막는다 — 주소창으로 들어오면 화면 판정은 없다.
    if difficulty in await _locked_difficulties_for(db, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "detail": "앞 난이도를 모두 클리어하면 열려요.",
                "code": "PUZZLE_LOCKED",
            },
        )

    # 진입 게이트 — 무소모 검사. 404 판정 이후에 둔다(없는 퍼즐은 차단 대상이 아니다).
    await energy_service.require_entry(db, user)

    return BoardPuzzle(
        content_item_id=item.id,
        template_json=item.template_json or {},
        cleared=item.id in cleared,
        difficulty=difficulty,
        locked=False,
    )


async def _next_board_quiz_id(
    db: AsyncSession, user: User, content_item_id: UUID
) -> str:
    """quiz_id "board-{content_item_id 앞 8자}-{seq}" 채번 (유저·퍼즐별 이어붙임)."""
    prefix = f"board-{str(content_item_id)[:8]}-"
    existing = (
        await db.execute(
            select(func.count())
            .select_from(QuizLog)
            .where(QuizLog.user_id == user.id, QuizLog.quiz_id.like(f"{prefix}%"))
        )
    ).scalar_one()
    return f"{prefix}{existing + 1:03d}"


@router.post("/puzzles/{content_item_id}/attempt", response_model=BoardAttemptResult)
@limiter.limit(LIMIT_ANSWER, key_func=user_or_ip_key)
async def attempt_puzzle(
    request: Request,
    content_item_id: UUID,
    body: BoardAttemptRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_with_rls),
) -> BoardAttemptResult:
    item = await _load_puzzle_or_404(db, content_item_id)

    cleared = await _cleared_item_ids(db, user)
    template = item.template_json or {}
    question = {**template, "question_type": "board", "concept_tag": item.concept_tag}

    # board_state 필수·검증 (§3.4) — 422 변환은 main.py 전역 핸들러 담당
    if body.board_state is None:
        raise BoardStateRequiredError(f"content_item_id={item.id}")
    board_engine.validate_board(body.board_state)

    # 서버 권위 판정 (§3.4) — 규칙 파일 부재/오류(BoardRulesError→503)는 전역 핸들러
    phenomena, passed, rules = evaluate_board_answer(question, body.board_state)

    feedback = board_engine.select_feedback(question, phenomena, passed, rules)

    # 구름 에너지(R10-01 §3.1): 소모는 **판정 이후 · 미통과(passed=False)에만** 1.
    # 통과한 시도는 0 — 재도전 자체가 아니라 "틀린 시도"에만 과금한다. 보드 attempt에는
    # 멱등 가드도 placement 경로도 없어 판정 결과만이 소모를 결정한다(계약 5).
    # 잔량 0이면 consume_if_available이 소모를 생략하고 정상 응답한다(429 없음) —
    # 차단은 진입 게이트(GET /puzzles/{id})의 책임이다. 소모는 요청 트랜잭션을
    # 공유하므로 이후 예외 시 롤백된다(별도 커밋/예외 삼킴 금지).
    now = datetime.now(timezone.utc)
    state = await energy_service.get_state(db, user, now)
    clouds_spent, clouds_remaining = 0, state["clouds"]
    if energy_service.should_consume(is_correct=passed):
        clouds_remaining = await energy_service.consume_if_available(db, user, now)
        clouds_spent = max(
            0, min(energy_service.CLOUD_COST, state["clouds"] - clouds_remaining)
        )

    # 최초 클리어만 +5 XP (재도전 0). 클리어 여부는 기존 board 로그로 판별.
    # 위 잠금 검사에서 이미 조회했다 — 같은 트랜잭션에서 두 번 돌 이유가 없다.
    already_cleared = item.id in cleared
    xp_earned = board_clear_xp(passed, already_cleared)
    if xp_earned:
        await xp_service.add_xp(db, user.id, xp_earned)

    # 보드 탭 → 왕관 유입 (R8-01 §3.4): 그 퍼즐 **최초 클리어**(기존 XP+5와
    # 동일 조건)일 때만, 같은 concept_tag의 열린(잠금 통과) kind='board' 유닛에
    # 왕관 +1. 같은 퍼즐 재클리어는 불인정 — crown_target=2는 서로 다른 퍼즐
    # 2개로 달성한다. 대상 유닛이 없거나 이미 왕관이 가득이면 무동작(null).
    crown_award: CrownAward | None = None
    if passed and not already_cleared:
        award = await curriculum_service.award_crown_for_activity(
            db, user, concept_tag=item.concept_tag, kind="board"
        )
        if award is not None:
            crown_award = CrownAward(**award)

    # 시도 기록 (session_id NULL) — quiz_id "board-{앞8자}-{seq}"
    quiz_id = await _next_board_quiz_id(db, user, item.id)
    db.add(
        QuizLog(
            user_id=user.id,
            quiz_id=quiz_id,
            session_id=None,
            content_item_id=item.id,
            concept_tag=item.concept_tag,
            question_type="board",
            question_json=question,
            user_answer=None,
            is_correct=passed,
            answered_at=datetime.now(timezone.utc),
        )
    )
    await db.flush()

    # 보드 attempt 성공 시 일일 퀘스트 재계산 (당일 집계 멱등 재계산) (R4-01 §3.1)
    if passed:
        await quest_service.recalculate_quests(db, user, datetime.now(KST).date())

    return BoardAttemptResult(
        passed=passed,
        phenomena=phenomena,
        feedback=feedback,
        xp_earned=xp_earned,
        crown_award=crown_award,
        clouds_spent=clouds_spent,
        clouds=clouds_remaining,
    )
