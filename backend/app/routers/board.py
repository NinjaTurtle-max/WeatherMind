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
# 층의 개수는 **단독 소유자**가 있다 — 여기 다시 적으면 드리프트한다(§0-2).
from app.schemas.progress import KNOWLEDGE_LEVEL_MAX
from app.schemas.reward import QuestReward
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


# 학습 수준(users.level_group) → 열리는 **최고 난이도**. 2026-08-10 사용자 지시:
# 초등 쉬움 · 중고등 쉬움+보통 · 성인 전부. expert는 adult와 같다 — board_difficulty가
# 3에서 클램프하므로 그 위가 없다.
#
# ⚠️ **첫 판의 「전건 클리어 사다리」를 대체한 것이다**(같은 날 뒤집혔다). 그쪽은
# 쉬움 23칸을 다 깨야 보통이 열려서, 심사위원이 로그인 없이 여는 데모에서 보통·
# 어려움을 볼 방법이 없었다(HACKATHON_RULES). 지금은 열쇠가 **진도가 아니라 수준**
# 이라 「내 정보 → 학습 수준」 한 번으로 바뀐다.
#
# 값 목록은 users.level_group CHECK 제약(모델)·schemas/auth.LevelGroup과 같아야
# 한다. 목(apiMockPlugin `__mockPolicy().board_band_max_difficulty`)이 이 표의
# 사본을 들고 있고 test_r13_mock_policy_parity가 실값으로 대조한다.
BAND_MAX_DIFFICULTY: dict[str, int] = {
    "elementary": 1,
    "middle_high": 2,
    "adult": 3,
    "expert": 3,
}

# 미상 밴드는 **잠그지 않는다**. 밴드가 늘었는데 이 표를 안 고치면 그 밴드 유저가
# 보드를 통째로 잃는데, 못 여는 것이 열리는 것보다 나쁘다(board_difficulty의
# "상위 밴드가 늘어도 easy로 오분류되지 않는다"와 같은 방향).
DEFAULT_MAX_DIFFICULTY = 3

# board_difficulty가 내는 값의 전 범위(1~3 클램프). 잠금 집합의 정의역이다.
BOARD_DIFFICULTIES: tuple[int, ...] = (1, 2, 3)

# ═══════════════════════════════════════════════════════════════
# 🔴 퍼즐 층 = **유닛과 같은 축**(지식 단계 1~N) — 2026-08-20 클라이언트 판정
# ═══════════════════════════════════════════════════════════════
#
# 클라이언트 지시: *「보드는 난이도 세분화가 안 되어 있어 이것도 세분화 진행해」* →
# *「지금 유닛 난이도와 똑같이 세분화」*. ⇒ 잠금 축이 **학령(3칸)에서 지식 단계(N칸)**로
# 갈아탄다. 별도 파생 축(`board_difficulty` 1~3)은 **잠금에서 빠진다.**
#
# **왜 갈아타도 순서가 안 뒤집히나 — 실측**(2026-08-20, board 64판):
#   지식 단계 5~10은 파생 난이도가 **전건 3**이고, 1~3은 **3이 0건**이다(블록 대각).
#   역전 쌍이 4096 중 **52(1.3%)**이고 **전부 단계 4 행**에서 나온다(그 행만 1·2·3에 걸침).
#
# ⚠️ **규칙의 형태는 그대로다**(같은 판정): 「자기 단계 아래는 인정 · 순서는 자기 층
# 안에서 · 위층은 잠금」. 바뀐 것은 **층의 개수와 천장의 출처**뿐이다.
#
# ⚠️ 세 함수의 순수성을 지킨다 — 아래 헬퍼들은 `level_group` 대신 **정수 천장**을 받는다.
# 종전 주석이 *"DB를 타지 않는 순수 함수다 — 잠금 규칙만 따로 고정할 수 있어야 회귀를
# 싸게 잡는다"*고 못박았고, 천장의 새 출처는 DB 파생이라 **조회만 라우터로 올린다.**
#
# 층의 개수는 **여기서 정하지 않는다** — 소유자는 `schemas/progress.KNOWLEDGE_LEVEL_MAX`
# 하나이고(유닛·문항·표기가 같은 값을 읽는다) 여기 다시 적으면 드리프트한다.
BOARD_TIERS: tuple[int, ...] = tuple(range(1, KNOWLEDGE_LEVEL_MAX + 1))


def board_tier(item) -> int | None:
    """퍼즐의 **층** = 그 문항의 지식 단계. 파생이 아니라 **저작값**이다.

    `board_difficulty`(조작 복잡도 파생)와 뜻이 다르다 — 이쪽은 **교과 단계**이고
    유닛·문항이 쓰는 그 축이다. 값이 없으면 `None`이고, 그때는 **잠그지 않는다**
    (아래 `locked_tiers`의 미상 처리와 같은 방향).
    """
    level = getattr(item, "knowledge_level", None)
    return level if isinstance(level, int) else None


def locked_tiers(ceiling: int | None) -> set[int]:
    """천장 → **잠긴 층 집합**. `locked_difficulties`의 새 축 판이고 형태가 같다.

    ⚠️ **천장이 미상이면 아무것도 잠그지 않는다.** 종전 `DEFAULT_MAX_DIFFICULTY`에
    붙어 있던 관례를 그대로 옮긴 것이다 — *"밴드가 늘었는데 이 표를 안 고치면 그
    밴드 유저가 보드를 통째로 잃는데, **못 여는 것이 열리는 것보다 나쁘다**"*.
    축이 바뀌어도 그 판단은 그대로다: 단계를 모를 때 잠그면 값이 비는 순간 퍼즐이
    통째로 사라진다.
    """
    if ceiling is None:
        return set()
    return {t for t in BOARD_TIERS if t > ceiling}


async def learner_tier(db: AsyncSession, user: User) -> int | None:
    """학습자의 **천장 층**. 유닛·`GET /progress/me`가 쓰는 그 값을 그대로 쓴다.

    우선순위와 그 근거(2026-08-20 실측):
      ① `weatherbrain_service.overall_knowledge_level` — θ 파생. **이것이 1순위인
         이유는 클라이언트가 승인한 노출 표가 이 경로의 값**이기 때문이다
         (진단 전 기본: 초등 **2** · 중고등 4 · 성인 **6** · expert 9).
      ② θ 행이 아예 없을 때만 **밴드 폴백**(`knowledge_level_of_level_group`).
      ③ 둘 다 없으면 `None` → **잠그지 않는다.**

    🔴 ⚠️ **①과 ②는 값이 다르다 — 선재 어긋남이고 이 변경이 그것을 사용자에게 보이게
    만든다.** 실측: 초등 2↔1 · 중고등 4↔3 · 성인 6↔5 · expert 9↔7. 지금까지는 그
    차이가 **표기**에만 나타나 눈에 안 띄었지만, 층이 곧 **보이는 퍼즐 수**가 되므로
    같은 학령인데 θ 행이 있는 학습자와 없는 학습자가 다른 판수를 본다.
    사다리 하나를 버리는 결정은 배치고사·표기까지 걸리는 별건이라 여기서 고치지
    않고 대장에 어긋남으로 남겼다(2026-08-20).
    """
    level = await weatherbrain_service.overall_knowledge_level(db, user)
    if isinstance(level, int):
        return level
    band = getattr(user, "level_group", None)
    if band:
        return weatherbrain_service.knowledge_level_of_level_group(band)
    return None


def locked_difficulties(level_group: str | None) -> set[int]:
    """학습 수준 → **잠긴 난이도 집합**.

    초등학생은 쉬움만, 중·고등학생은 쉬움·보통, 성인은 전부 열린다
    (2026-08-10 사용자 지시). 열쇠는 온보딩에서 정해진 `users.level_group`이고,
    「내 정보 → 학습 수준」(PATCH /auth/me)이 그것을 바꾸는 통로다.

    난이도 **안에서는 순서가 없다** — 열린 묶음의 퍼즐은 아무거나 고른다
    (2026-08-06에 퍼즐 단위 순차 잠금을 걷어낸 결정 그대로다).

    DB를 타지 않는 순수 함수다(board_difficulty·order_puzzles_for_progress 관례) —
    잠금 규칙만 따로 고정할 수 있어야 회귀를 싸게 잡는다.
    """
    ceiling = BAND_MAX_DIFFICULTY.get(level_group or "", DEFAULT_MAX_DIFFICULTY)
    return {d for d in BOARD_DIFFICULTIES if d > ceiling}


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


# 진행 커서 앞으로 몇 칸을 함께 열어 둘 것인가 (MT-24).
# 0이면 "직전 칸을 깨야 다음이 열린다"는 엄격 순차이고, 그러면 어려운 칸 하나가
# **완전한 벽**이 된다 — 46퍼즐 중 하나에서 막히면 나머지 전부를 못 본다. 심사는
# 처음 보는 브라우저로 5분을 도는 동선이라(주최측 PC·URL만) 벽 하나가 곧 시연 실패다.
# 2면 "다음에 할 것"이 분명하면서도 막히지 않는다 — 순서는 보이고 벽은 없다.
#
# ⚠️ `Settings`가 아니라 여기 있는 이유: `core/config.py`가 지금 **다른 세션 소유**라
# 건드리면 충돌한다(2026-08-11 병렬 배정). 계약 수치는 env로 여는 것이 이 저장소의
# 관례이므로, 소유가 풀리면 `Settings.BOARD_UNLOCK_LOOKAHEAD`로 옮긴다.
BOARD_UNLOCK_LOOKAHEAD = 2


def compute_unlocked_ids(ordered_items: list, cleared: set) -> set:
    """진행 순서 목록 → **열린 퍼즐 id 집합** (MT-24, 순수·서버 권위).

    규칙 둘뿐이다:
    ⑴ **이미 깬 칸은 언제나 열린다.** 잠금 도입 이전에 뒤쪽 칸을 깬 유저가 있고
       (2026-08-06~08-11 내내 잠금이 없었다), 그 칸을 도로 잠그면 **자기가 푼 것을
       다시 못 여는** 상태가 된다. 진행 커서만으로 판정하면 이 경우가 새므로 별도 조항이다.
    ⑵ 미클리어 칸은 **진행 커서(첫 미클리어 위치)부터 LOOKAHEAD칸까지** 열린다.

    입력은 `order_puzzles_for_progress`를 통과한 **정렬된** 목록이어야 한다 — 순서가
    곧 코스이고, 잠금은 그 순서 위에서만 뜻이 있다. 정렬되지 않은 목록을 넣으면
    커서가 엉뚱한 곳을 가리키지만 예외를 던지지는 않는다(표시가 흔들릴 뿐 차단은
    여전히 서버 판정이다).
    """
    unlocked = {item.id for item in ordered_items if item.id in cleared}

    cursor = next(
        (i for i, item in enumerate(ordered_items) if item.id not in cleared),
        len(ordered_items),
    )
    for item in ordered_items[cursor : cursor + BOARD_UNLOCK_LOOKAHEAD + 1]:
        unlocked.add(item.id)
    return unlocked


def band_ceiling(level_group: str | None) -> int:
    """이 학습 수준의 **천장 난이도**. `locked_difficulties`의 짝(같은 표를 읽는다)."""
    return BAND_MAX_DIFFICULTY.get(level_group or "", DEFAULT_MAX_DIFFICULTY)


def below_ceiling_ids(items: list, ceiling: int | None) -> set:
    """**자기 천장보다 낮은 난이도의 퍼즐 id** — 순차와 무관하게 열린다.

    🔴 **2026-08-19 결함 ⑨.** 종전에는 수준이 **천장만** 올리고 시작 위치를 안 옮겨,
    성인도 1번부터 3칸씩 걸어야 했다(실서버: 49판 중 **01~04만 열림** · 진행도 1/49).
    `sequenceable`이 난이도로 먼저 거르는 것은 이미 맞았다(2026-08-12) — 원인은
    거른 목록의 **맨 앞부터** 센다는 것이었다. **⑧과 같은 뿌리**다(수준이 「열 수 있는
    최대치」만 정하고 실제 시작 위치는 언제나 1번).

    고침의 원리는 선행 학습 앱의 관례다 — **「수준을 인정받으면 그 아래는 열린다」**이지
    「순서를 없앤다」가 아니다. 그래서:
      · **천장보다 낮은** 난이도 → 전부 열림(이미 자기 수준 아래다)
      · **천장** 난이도 → **순차 그대로**(MT-24 유지 — 난이도 곡선이 거기서 산다)

    ⚠️ **초등은 아무것도 안 바뀐다** — 천장이 1이라 「아래」가 비어 있고 1층이 곧 자기
    층이라 순차다. 천장을 여는 수정이 **바닥을 무너뜨리지 않는다**는 뜻이고, 그것을
    테스트가 문다.

    🔴 **2026-08-20: 축이 학령(1~3)에서 지식 단계(1~N)로 갈아탔다.** 형태는 그대로다 —
    「아래층은 인정」이 3칸에서 N칸으로 넓어진 것뿐이다. 인자도 `level_group`에서
    **정수 천장**으로 바뀌어 이 함수가 계속 순수 함수로 남는다.
    ⚠️ 천장이 미상이면 **아무것도 「아래」가 아니다**(빈 집합) — 그때는 `locked_tiers`가
    아무것도 잠그지 않으므로 순차만 남고, 그것이 「못 여는 것이 열리는 것보다 나쁘다」와
    같은 방향이다.
    """
    if ceiling is None:
        return set()
    return {
        item.id
        for item in items
        if (t := board_tier(item)) is not None and t < ceiling
    }


def ceiling_tier(items: list, ceiling: int | None) -> list:
    """순차가 **셀 대상** — 학습자의 **천장 난이도** 퍼즐만.

    🔴 **이 함수가 없으면 천장층이 하나도 안 열린다.** `sequenceable`(천장 이하 전부)
    위에서 순차를 세면 커서가 **1층 맨 앞**에 서고 LOOKAHEAD 창이 통째로 1층 안에
    떨어진다 — 그 1층은 `below_ceiling_ids`가 이미 열어 둔 곳이라 **창이 아무것도
    추가하지 못한다.** 성인의 3층이 0판이 되는 것이고, 이 결함을 **계약 테스트가
    먼저 잡았다**(내가 처음 쓴 수정이 그 상태였다).

    ⇒ 순차는 **자기 층 안에서** 센다. 아래층은 인정으로 열리고, 위층은 잠겨 있으며,
    **커서가 뜻을 갖는 곳은 자기 층뿐**이다.

    🔴 **2026-08-20: 축이 지식 단계로 갈아탔다.** 「자기 층」의 뜻이 **학령 천장**에서
    **지식 단계 천장**으로 바뀌었을 뿐, 위 문단의 논리는 그대로 성립한다.
    ⚠️ 천장이 미상이면 **자기 층이 정의되지 않는다** → 빈 목록. 그때는 `locked_tiers`가
    아무것도 안 잠그므로 목록 전체가 열린 상태로 남는다(못 여는 것보다 낫다).
    """
    if ceiling is None:
        return []
    return [item for item in items if board_tier(item) == ceiling]


def sequenceable(items: list, ceiling: int | None) -> list:
    """순차 잠금이 **셀 대상** — 난이도가 열린 퍼즐만 남긴 목록 (2026-08-12 병합 판정).

    ⚠️ **이 필터가 없으면 초등 학습자의 사슬이 영구히 끊긴다.** 두 잠금이 축이 달라
    합쳐 놓고 순서를 전체 목록 위에서 세면, 진행 커서 다음 칸이 「보통」인 순간
    거기서 멈춘다 — 그 칸은 난이도로 막혀 있어 영원히 못 깨고, 커서는 깨야만
    넘어간다. 난이도로 **먼저 거르고 그 안에서** 세면 사슬이 자기 수준 안에서
    끝까지 이어진다.

    학습 수준이 바뀌면(PATCH /auth/me) 대상 자체가 넓어지므로 재계산이 공짜로 따라온다.

    🔴 **2026-08-20: 축이 지식 단계로 갈아탔다.** 위 문단의 결함(축이 다른 두 잠금을
    합쳐 놓고 전체 목록에서 순서를 세면 사슬이 끊긴다)은 **층이 3칸이든 N칸이든
    같다** — 그래서 이 필터의 존재 이유가 바뀌지 않는다. 오히려 층이 촘촘해져
    「다음 칸이 잠긴 층」인 상황이 더 자주 생기므로 **더 필요해졌다.**
    """
    locked = locked_tiers(ceiling)
    return [item for item in items if board_tier(item) not in locked]


async def _unlocked_ids_for(db: AsyncSession, user: User, cleared: set) -> set:
    """유저의 열린 퍼즐 집합 — 단건 진입·attempt가 목록과 **같은 판정**을 쓰게 한다.

    단건 경로가 목록을 다시 세우는 비용을 치르는 이유: 잠금 판정을 두 곳에서
    따로 구현하면 반드시 갈라진다. 목록은 열렸다고 그리는데 진입은 막는(또는 그 반대)
    상태가 이 저장소가 반복해서 겪은 실패다(목↔서버 패리티 계열).
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
    # 순차(내 층에서 어디까지) **OR** 천장 아래 인정(내 층 아래는 이미 지났다) — 결함 ⑨.
    # 🔴 천장의 출처가 학령에서 **지식 단계**로 갈아탔다(2026-08-20) — 조회는 여기서
    # 한 번만 하고, 규칙 함수 셋은 정수만 받아 순수 함수로 남는다.
    ceiling = await learner_tier(db, user)
    return compute_unlocked_ids(
        ceiling_tier(order_puzzles_for_progress(items), ceiling), cleared
    ) | below_ceiling_ids(items, ceiling)


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

    **잠금이 둘이고 축이 다르다**(2026-08-12 병합 판정 — 둘 다 사용자 지시라
    어느 한쪽을 버리면 지시 하나를 되돌리게 된다):

    ⑴ **학습 수준 잠금**(`locked`, 2026-08-10 지시) — 초등은 쉬움만, 중·고등은
       쉬움·보통, 성인은 전부. 규칙은 `locked_difficulties`가 소유하고 열쇠는
       `users.level_group`이다.
    ⑵ **순차 잠금**(`unlocked`, MT-24 · 2026-08-11 멘토링 피드백) — ⑴로 열린
       난이도 **안에서** 어디까지 왔는가. 종전 기술 *"잠금 없다(2026-08-06 제품
       결정)"*는 **번복됐다.** 번복 사유를 지우지 않고 남긴다: 당시 걷어낸 이유는
       *"학습자가 원하는 퍼즐을 골라 푼다"*였고, 그 우려는
       `BOARD_UNLOCK_LOOKAHEAD`로 흡수한다 — 벽 하나에 막히지 않으면서 "다음에
       할 것"은 분명해진다.

    ⚠️ 순서는 `sequenceable`로 **난이도를 거른 뒤에** 센다. 전체 위에서 세면
    초등 학습자의 다음 칸이 「보통」인 순간 사슬이 영구히 끊긴다.

    목록은 두 축 모두 **차단하지 않는다** — 잠긴 칸도 내려보내고 표시만 다르게
    한다. 빼면 학습자가 앞으로 무엇이 있는지 못 보고 진도감 자체가 사라진다
    (에너지 게이트가 목록을 무차단으로 두는 것과 같은 이유).
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
    # 🔴 배지·잠금이 **같은 축**을 쓴다(2026-08-20) — 지식 단계. 종전에는 배지가
    # 파생 난이도(1~3, 학령 표기)였고 잠금도 그 축이었다. 이제 둘 다 층이다.
    ceiling = await learner_tier(db, user)
    graded = [(item, board_tier(item), item.id in cleared) for item in items]
    locked = locked_tiers(ceiling)
    # 순서는 **층으로 거른 뒤** 센다(`sequenceable`) + **천장 아래는 인정**한다
    # (`below_ceiling_ids` — 결함 ⑨). 두 축이 AND가 아니라 OR로 합쳐지는 자리다:
    # 순차는 「내 층에서 어디까지 왔나」를, 인정은 「내 층 아래는 이미 지났다」를 말한다.
    unlocked = compute_unlocked_ids(
        ceiling_tier(items, ceiling), cleared
    ) | below_ceiling_ids(items, ceiling)
    return [
        BoardPuzzle(
            content_item_id=item.id,
            template_json=item.template_json or {},
            cleared=done,
            knowledge_level=tier,
            locked=tier in locked,
            unlocked=item.id in unlocked,
        )
        for item, tier, done in graded
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
    # 🔴 축이 지식 단계로 갈아탔다(2026-08-20) — 목록과 **같은 판정**을 쓴다.
    ceiling = await learner_tier(db, user)
    difficulty = board_tier(item)

    # 난이도 잠금 — **구름 검사보다 먼저**다. 잠긴 퍼즐은 잔량이 있어도 못 여는데,
    # 순서를 바꾸면 잔량 0인 사람이 "구름이 없어서"라는 틀린 이유를 듣는다.
    # 화면도 막지만 여기서 다시 막는다 — 주소창으로 들어오면 화면 판정은 없다.
    if difficulty in locked_tiers(ceiling):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "detail": "내 정보에서 학습 수준을 올리면 열려요.",
                "code": "PUZZLE_LOCKED",
            },
        )

    # 순차 잠금 (MT-24) — **에너지보다 먼저** 본다. 순서가 뒤집히면 잠긴 퍼즐을
    # 딥링크로 열 때 429 OUT_OF_CLOUDS가 나가서, 학습자가 "구름이 없어서 못 한다"고
    # 읽고 20분을 기다린 뒤 다시 막힌다. 잠긴 칸은 구름을 써도 안 열린다.
    unlocked = await _unlocked_ids_for(db, user, cleared)
    if item.id not in unlocked:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "detail": "앞의 퍼즐을 먼저 풀면 열려요.",
                "code": "BOARD_LOCKED",
            },
        )

    # 진입 게이트 — 무소모 검사. 404 판정 이후에 둔다(없는 퍼즐은 차단 대상이 아니다).
    await energy_service.require_entry(db, user)

    return BoardPuzzle(
        content_item_id=item.id,
        template_json=item.template_json or {},
        cleared=item.id in cleared,
        knowledge_level=difficulty,
        # 여기 도달했다면 두 축 모두 열린 것 — 위 가드 둘을 지나야 온다.
        locked=False,
        unlocked=True,
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

    # 잠금은 **채점에도 걸린다**(2026-08-10 코드 리뷰). 진입(GET)만 막아 두면
    # attempt를 직접 POST해서 판정·XP·왕관·클리어 기록을 다 받아갈 수 있다 —
    # 진입 게이트가 지키려던 것이 통째로 새는 구멍이다. 판정 **전에** 막는다.
    # 🔴 축이 지식 단계로 갈아탔다(2026-08-20) — 목록·단건 진입과 **같은 판정**이다.
    locked = locked_tiers(await learner_tier(db, user))
    if board_tier(item) in locked:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "detail": "내 정보에서 학습 수준을 올리면 열려요.",
                "code": "PUZZLE_LOCKED",
            },
        )

    cleared = await _cleared_item_ids(db, user)

    # 순차 잠금 (MT-24) — 진입(GET)만 막으면 **POST로 우회된다.** 보드는 채점 권위가
    # 서버에 있다는 것이 설계의 뿌리인데(클라이언트가 결과를 주입할 통로 없음),
    # 잠금만 표시 계층에 두면 그 원칙이 잠금에서는 깨진다. 판정 전에 막는다 —
    # 통과했다면 XP·왕관·퀘스트가 전부 따라 움직이기 때문이다.
    unlocked = await _unlocked_ids_for(db, user, cleared)
    if item.id not in unlocked:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "detail": "앞의 퍼즐을 먼저 풀면 열려요.",
                "code": "BOARD_LOCKED",
            },
        )

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

    # 최초 클리어만 +5 XP (재도전 0). 클리어 여부는 기존 board 로그로 판별 —
    # 위에서 `_cleared_item_ids`로 한 번 조회했으니 같은 트랜잭션에서 두 번 돌지 않는다.
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
    # 반환을 버리지 않는다 (CO-T-4) — 보드 통과가 `daily_xp_30`을 넘겨 +10을
    # 지급하고도 보드 화면에는 그 사실이 한 글자도 안 떴다.
    quest_rewards: list[QuestReward] = []
    if passed:
        transitions = await quest_service.recalculate_quests(
            db, user, datetime.now(KST).date()
        )
        quest_rewards = [
            QuestReward(**event) for event in quest_service.reward_events(transitions)
        ]

    return BoardAttemptResult(
        quest_rewards=quest_rewards,
        bonus_xp=sum(reward.reward_xp for reward in quest_rewards),
        passed=passed,
        phenomena=phenomena,
        feedback=feedback,
        xp_earned=xp_earned,
        crown_award=crown_award,
        clouds_spent=clouds_spent,
        clouds=clouds_remaining,
    )
