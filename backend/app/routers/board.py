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


# ═══════════════════════════════════════════════════════════════
# 🔴 철거된 파생 축 — 경위만 남긴다 (2026-08-20)
# ═══════════════════════════════════════════════════════════════
#
# 여기 있던 것: `BAND_MAX_DIFFICULTY`(학령 → 열리는 최고 난이도 el 1 · mh 2 ·
# adult 3 · expert 3) · `DEFAULT_MAX_DIFFICULTY`(3, 미상 밴드는 잠그지 않는다) ·
# `BOARD_DIFFICULTIES`((1, 2, 3), 잠금 집합의 정의역).
#
# 왜 지웠나: 잠금·표기 축이 **학령 파생 난이도(3칸)에서 지식 단계(1~10)**로
# 갈아탔다(클라이언트 판정 — 유닛과 같은 축). 세 상수의 소비자는 `locked_difficulties`·
# `band_ceiling`·`board_difficulty` 셋뿐이었고 그 셋이 함께 철거됐다. 남겨 두면
# **같은 축에 이름이 둘**이 되고, 그것이 이 저장소가 `level_label`로 이미 치른 값이다.
#
# 각 상수가 지키던 성질이 어디로 갔나:
#   · 학령 → 천장 = `learner_tier()`. **DB 파생이라 상수표가 아니다.**
#     ⚠️ 여기 *"(θ 파생, 밴드 폴백)"*이라 적혀 있었고 **2026-08-20 판정 1로 거짓이
#     됐다** — 밴드 폴백은 천장 경로에서 철거됐다(경위는 `learner_tier` 독스트링).
#     정정만 하고 지우지 않는 이유: 이 줄이 「학령 잠금의 성질이 어디로 갔나」의
#     추적 경로로 인용됐다.
#   · 「미상은 잠그지 않는다」 = `locked_tiers(None) == set()`가 **그대로 이어받았다**
#     (그 함수 독스트링이 이 상수의 관례를 인용하며 승계를 밝힌다).
#   · 잠금 집합의 정의역 = `BOARD_TIERS`.
#
# ⚠️ 함께 사라진 경위 2건을 여기 보존한다(지운 주석이 유일 소유자였다):
#   ⑴ 이 표는 **첫 판의 「전건 클리어 사다리」를 대체한 것**이다(2026-08-10, 같은 날
#      뒤집혔다). 그쪽은 쉬움 23칸을 다 깨야 보통이 열려서, 심사위원이 로그인 없이
#      여는 데모에서 보통·어려움을 볼 방법이 없었다(HACKATHON_RULES). 새 축도 이
#      판단을 물려받는다 — **천장이 진도가 아니라 수준에서 온다.**
#   ⑵ 값 목록이 users.level_group CHECK 제약·schemas/auth.LevelGroup과 같아야 한다는
#      정합 요구. 새 축에서 그 정합의 짝은 `weatherbrain_service`의 밴드 → 단계 표다.
#
# 🔴 ⚠️ ~~**목이 아직 이 축으로 돌아간다.**~~ `frontend/mock/apiMockPlugin.js`가
# `BOARD_BAND_MAX_DIFFICULTY`·`BOARD_DIFFICULTIES`·`boardDifficulty` 사본을 들고
# 잠그고 `boardPuzzlePayload`가 `difficulty`를 싣는다 — 라고 적었다.
#
# ✅ **2026-08-20 정정: 이 기술은 커밋 시점에 이미 낡아 있었다.** 근거로 삼은 목
# 판독은 내 세션 앞부분 값이고, 그 뒤 리드의 `4cac129`(feat(mock): 목의 퍼즐 축도
# 지식 단계로)가 목을 갈아탔다 — 그 커밋이 **내 첫 커밋의 부모**라 내가 「아직
# 안 갈아탔다」고 쓴 순간 이미 갈아탄 뒤였다. 리드는 파리티도 새 축에 다시 물렸다
# (`97baa20` · `0b0b2e6`). ⇒ 「목↔서버가 지금 갈라져 있다」는 **거짓**이다.
#
# 지우지 않고 정정만 하는 이유(CLAUDE.md §0-5): 이 문장이 **내 보고의 최우선
# 에스컬레이션 근거로 이미 인용됐다.** 조용히 고치면 그 인용이 근거 없이 살아남는다.
# 남는 교훈은 목 상태가 아니라 **읽은 시점과 쓴 시점 사이에 트리가 움직였다**는 것이다
# — 공유 워크트리에서 남의 파일을 근거로 현재형을 쓰면 이렇게 낡는다.

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

    🔴 **2026-08-20 판정 2 — 층이 `None`인 퍼즐은 「열리되 줄에 서지 않는다」.**
    종전 동작을 경위로 남긴다: `below_ceiling_ids`가 `is not None`으로 가드하고
    `ceiling_tier`가 `== ceiling`으로 걸러서, 층이 미상인 퍼즐은 **어느 천장에서도
    열린 집합에 한 번도 들어가지 못했다** — 즉 `locked`는 False인데 `unlocked`도
    영원히 False라 **누구에게도, 영원히** 안 열렸다. **저작 실수 하나가 콘텐츠를
    소리 없이 증발시키는 구조**였다(실측 시드 board는 지금 미상 0건이라 아무도
    못 봤을 뿐이다 — 그래서 픽스처가 그 갈래를 밟는다).

    ⇒ 지금은 두 갈래로 명시 처리한다:
      · **잠금** — 미상은 **모든 천장에서 열림**. 근거는 `locked_tiers`가 이미
        이어받은 `DEFAULT_MAX_DIFFICULTY`의 미상-밴드 관례(*"못 여는 것이 열리는
        것보다 나쁘다"*)이고, **층이 미상인 퍼즐은 미상-밴드 학습자와 같은 형태**다.
      · **순차** — `tierless_ids`가 따로 열고 `sequenceable`·`ceiling_tier`에서는
        **빠진다**. 아무 층에나 끼우면 그 층의 순서 의미가 깨진다(미상-밴드 학습자
        쪽과 같은 처리).
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
    """🔴 **천장의 소유자는 이 함수 하나다** — 갈아끼울 수 있는 단일 이음매.

    보드 잠금이 천장을 묻는 자리는 넷(목록·단건 진입·채점·`_unlocked_ids_for`)이고
    **전부 이 함수만 부른다.** 천장을 정하는 규칙이 바뀔 때 고칠 곳이 하나여야
    하기 때문이다.

    🔴 **천장의 소유자 판정 = 갈래 A 확정**(2026-08-20 · 클라이언트·어드바이저).
    클라이언트 원문은 *「단계 10개로 하고 **추천 시스템으로 추천 단계에 맞게** 보드가
    열리도록」*이고, 그 「추천 시스템」이 가리키는 것은 **세션 문항을 골라 주는 적응형
    전체**다 — 즉 **θ 추정 자체**다(배치고사 + 매 응답 갱신). ⇒ 천장 = **θ에서 추정한
    학습자 단계**이고 그것이 지금 이 함수가 하는 일이다.

    🔴 ⚠️ **`route` 세 갈래(`focused|general|advanced`)를 천장에 쓰지 않는다.** 두 가지
    이유를 남긴다(*「`route`도 추천이니 쓰면 되지 않나」*가 반복될 자리다):
      ⑴ `route`는 태생이 **세션 라우팅** — 「이번 세션에 무엇을 낼까」의 **순간 판정**
         (3연속 정답 같은 단기 신호)이다. 천장은 「무엇이 열려 있나」의 **지속 상태**라,
         순간 신호로 정하면 **3연속 정답 한 번에 층이 열렸다 닫혔다** 한다 — 사용자에게
         잠금이 널뛰는 화면이다.
      ⑵ `focused` 트리거가 `focus_theta_threshold(level_group)`으로 **밴드 상대**라,
         `route`를 경유하면 **밴드가 뒷문으로 다시 들어온다**(그 밴드 상대성은 CO-U-3이
         수리한 것이라 걷어낼 수도 없다). 즉 A만이 「밴드 상관 쓰지 말라」와 동시에
         성립한다.

    ⚠️ **이 함수는 확장 지점이다** — 「`advanced`면 한 층 더 열어 준다」류는 **폐기가
    아니라 훗날 이 이음매 위에 얹을 것**이다. 지금 짓지 않는다.
    ⚠️ 계약은 **값(2·4·6·9 같은 숫자)을 박지 않는다** — 그것은 `seed_placement`
    사전값의 파생이라 사전값이 바뀌면 헛운다. 무는 것은 **이음매**다.

    지금 규칙(2026-08-20 판정 1 집행 후):
      ① `weatherbrain_service.overall_knowledge_level` — θ 파생.
      ② θ 행이 아예 없으면 `None` → **잠그지 않는다**(`locked_tiers(None) == set()`).

    🔴 **철거 경위 — 밴드 폴백을 뺐다.** 종전 ②는 *"θ 행이 없으면
    `knowledge_level_of_level_group(user.level_group)`"*이었고, 그래서 천장의 출처가
    **사다리 둘**(θ 파생 ↔ 밴드 최하)이었다. 클라이언트 지시는 *「상관 쓰지 말고
    그냥 10단계로 나누라」*이고, 두 사다리는 실측으로 값이 달랐다(초등 2↔1 ·
    중고등 4↔3 · 성인 6↔5 · expert 9↔7) — 층이 곧 **보이는 퍼즐 수**가 된 뒤로는
    그 어긋남이 「같은 학령인데 판수가 다르다」로 사용자에게 보였다. 축을 하나로
    줄이는 것이 그 어긋남을 없애는 길이다.

    ⚠️ **`knowledge_level_of_level_group` 함수 자체는 살아 있다** —
    `placement_service`(사전 θ 배정)와 `weatherbrain_service`(문항 b 파생·표기)가
    계속 쓴다. 여기 **천장 경로에서만** 빠졌다.
    ⚠️ **실제 노출 값은 거의 안 바뀐다**: `seed_placement`가 가입·게스트 발급 양쪽에서
    θ 행을 심으므로(`routers/auth.py`) 정상 유저는 ① 경로로 간다. 없어진 것은
    **θ 행이 아예 없는 유저의 폴백**뿐이고, 그 유저는 이제 **잠기지 않는다.**
    """
    level = await weatherbrain_service.overall_knowledge_level(db, user)
    return level if isinstance(level, int) else None


# ═══════════════════════════════════════════════════════════════
# 🔴 철거: `locked_difficulties` · `board_difficulty` (2026-08-20)
# ═══════════════════════════════════════════════════════════════
#
# ⑴ `locked_difficulties(level_group) -> set[int]` — 학습 수준 → 잠긴 난이도 집합.
#    **성질은 `locked_tiers(ceiling)`가 그대로 이어받았다**(그쪽 독스트링이 "형태가
#    같다"고 밝힌다). 바뀐 것은 층의 개수와 천장의 출처뿐이다.
#    ⚠️ 함께 사라지는 경위 하나를 보존한다: *"난이도 **안에서는** 순서가 없다 —
#    열린 묶음의 퍼즐은 아무거나 고른다"*(2026-08-06에 퍼즐 단위 순차 잠금을
#    걷어낸 결정). 새 축에서 그 성질은 **한 층 안의 순차**로 좁혀졌다
#    (`ceiling_tier` + `compute_unlocked_ids`) — 즉 **뒤집혔고**, 뒤집은 것은
#    MT-24와 결함 ⑨이지 이 철거가 아니다.
#
# ⑵ `board_difficulty(template_json, level_group) -> 1|2|3` — R7-02 §3.5 파생 라벨.
#    규칙: guided 1 / 그 외 2 기본 · `time_limit_sec` +1 · `palette`≥3 +1 ·
#    사전 b가 adult 이상 +1 · 1~3 클램프.
#    **대체자가 없다 — 퍼즐의 층은 파생이 아니라 저작값이다**(`board_tier` =
#    `content_items.knowledge_level`). 응답 필드도 `knowledge_level`로 교체됐다.
#
#    🔴 ⚠️ **다만 이 함수의 가중은 「저작 규율」이기도 했고 그쪽은 참으로 남는다.**
#    「팔레트가 많으면(배치 조합 공간이 넓으면) 어렵다」·「시간제한이 있으면 어렵다」는
#    축과 무관하게 맞다 — 조작 가지 수가 실제 난이도다. 파생으로 **자동 계산되던** 그
#    규율이 이제 **저작자가 `knowledge_level`을 손으로 정할 때 지켜야 하는 것**이 됐고,
#    그것을 무는 계약은 지금 **없다.** 감시자 공백이라 보고했다(리드 판정 대기).
#
#    ⚠️ 파급 하나 더 — **CARRYOVER Z-1의 차단이 풀린다.** 산불 규칙을 `sun>=70`
#    3조건으로 되돌리지 못한 유일한 사유가 *"팔레트가 3이 되면 `palette>=3` 가산이
#    board_order 9를 난이도 1→2로 올려 단조 증가 계약이 깨진다"*였다
#    (`board_rules.json` wildfire_risk_dry_gale `note_authoring` · CARRYOVER §Z-1).
#    가산이 없어졌으므로 그 사유가 소멸한다. 시드·규칙·문서는 이 세션 소유가
#    아니라 손대지 않고 보고했다 — Z-1 재개 판단은 데이터·커리큘럼 소관.
#
#    ⚠️ `weatherbrain_service.LEVEL_GROUP_ITEM_B`는 **계속 쓰인다**
#    (`order_puzzles_for_theta`의 θ 근접 정렬) — 이 철거로 죽는 상수가 아니다.


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

    🔴 **2026-08-20: 정렬 키가 `(층, board_order)`로 바뀌었다** (어드바이저 판정).

    배지가 지식 단계로 갈아탄 순간 **목록이 눈에 보이게 뒤섞인다** — 실측: 정렬을
    안 바꾸면 `board_order` 24번 「초등 5~6학년」이 「중학교」 12판 **뒤**에 온다.
    새 키로 세우면 **44/64칸이 자리를 옮긴다**(그만큼 어긋나 있었다는 뜻이다).
    「유닛과 **똑같이**」의 귀결이다 — 유닛은 섹션(=단계) 오름차순으로 제시된다.

    ⚠️ **시드는 한 줄도 안 건드린다.** 종전 계약이 강제하던 저작 규율(난이도 3짜리는
    말미에 append)은 이 정렬이 **흡수**한다 — 버리는 것이 아니라 **필요 없어진다.**
    저작자가 자리를 잘못 잡아도 화면 순서는 층부터 선다.

    ⚠️ **`board_order`는 2차 키로 그대로 산다** — 같은 층 안의 순서는 여전히 시드가
    소유한다(위 문단의 「순서를 서버가 파생하지 않는다」가 그 층 안에서 유지된다).
    """
    def order_of(item) -> tuple[int, int]:
        # `or`로 기본값을 주면 board_order=0이 "없음"으로 삼켜진다 — 명시 비교.
        value = (item.template_json or {}).get("board_order")
        tier = board_tier(item)
        return (
            tier if tier is not None else 10_000,
            value if isinstance(value, int) else 10_000,
        )

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


# 🔴 철거: `band_ceiling(level_group) -> int` (2026-08-20). `locked_difficulties`의
# 짝으로 같은 상수표를 읽어 **학령 → 천장 난이도**를 냈다. 성질은 `learner_tier()`가
# 이어받았다 — 다만 그쪽은 DB 조회를 타므로 순수 함수가 아니다(그래서 조회만
# 라우터로 올라갔다). 아래 잠금 헬퍼 셋이 `level_group` 대신 **정수 천장**을 받는
# 것이 그 분리의 자국이다.
# ⚠️ 여기 *"θ 파생이 1순위이고 밴드는 폴백"*이라 적혀 있었고 **2026-08-20 판정 1로
# 거짓이 됐다** — 폴백이 없으므로 「1순위」라는 말 자체가 뜻을 잃었다. 정정만 남긴다.


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


def tierless_ids(items: list) -> set:
    """**층이 미상인 퍼즐 id** — 모든 천장에서 열리고, 줄에는 서지 않는다 (판정 2).

    🔴 이 함수가 없으면 층이 `None`인 퍼즐이 **누구에게도, 영원히** 안 열린다:
    `locked_tiers`의 어느 층에도 안 걸려 `locked=False`인데(잠긴 것으로 표시되지도
    않는다) `below_ceiling_ids`는 `is not None`으로, `ceiling_tier`는 `== ceiling`으로
    걸러서 **열린 집합에 들어갈 통로가 하나도 없었다.** ⇒ 저작 실수 하나가 콘텐츠를
    **소리 없이** 증발시키는 구조였고, 「잠겼다」는 신호조차 없어 화면에서도 원인을
    알 수 없었다.

    ⚠️ **왜 「열림」이 옳은가**: 「못 여는 것이 열리는 것보다 나쁘다」 —
    `DEFAULT_MAX_DIFFICULTY`가 미상 밴드에 세워 둔 관례이고 `locked_tiers(None)`이
    이미 이어받았다. 층이 미상인 **퍼즐**은 그 미상-밴드 **학습자**와 같은 형태다.

    ⚠️ **왜 커서에는 안 끼우나**: 순차는 **한 층 안의 순서**에만 뜻이 있다
    (`ceiling_tier` 독스트링). 층을 모르는 퍼즐을 아무 층에 끼우면 그 층의 순서
    의미가 깨지고, 「다음에 할 것」이 미상 퍼즐로 밀려 층의 난이도 곡선이 흔들린다.
    미상-밴드 학습자를 「잠그지 않지만 사다리에도 안 세운다」로 처리하는 것과 같다.

    ⚠️ 실측(2026-08-20): 시드 board 64건 전건이 `knowledge_level` 정수이고 미상은
    **0건**이다. 즉 **이 함수는 지금 시드에서 아무 id도 내지 않는다** — 그래서
    계약은 시드가 아니라 **픽스처로 이 갈래를 밟는다**(시드만 보면 분기가 영원히
    실행되지 않아 「입력이 갈래를 안 밟아서 초록」이 된다).
    """
    return {item.id for item in items if board_tier(item) is None}


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

    🔴 **2026-08-20 판정 2: 층이 미상(`None`)인 퍼즐은 여기서 빠진다.** 종전에는
    `None not in locked`가 참이라 **미상 퍼즐이 줄에 섞여 들어왔다** — 어느 층에도
    속하지 않는 칸이 커서 앞에 서면 그 층의 순서 의미가 깨진다. 대신 그 퍼즐은
    `tierless_ids`가 순차와 무관하게 열어 준다(「열리되 줄에 서지 않는다」).
    ⚠️ 빼기만 하고 `tierless_ids`를 OR로 합치지 않으면 **그 퍼즐이 통째로 잠긴다** —
    두 변경은 한 쌍이다.
    """
    locked = locked_tiers(ceiling)
    return [
        item
        for item in items
        if (t := board_tier(item)) is not None and t not in locked
    ]


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
    # 🔴 세 갈래 OR (2026-08-20 판정 2로 하나 늘었다): 순차(내 층에서 어디까지) ·
    # 천장 아래 인정(내 층 아래는 이미 지났다) · **층 미상은 무조건 열림**.
    ceiling = await learner_tier(db, user)
    return (
        compute_unlocked_ids(
            ceiling_tier(order_puzzles_for_progress(items), ceiling), cleared
        )
        | below_ceiling_ids(items, ceiling)
        | tierless_ids(items)
    )


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

    ⑴ **학습 수준 잠금**(`locked`, 2026-08-10 지시) — 천장 위 층은 잠긴다. 규칙은
       `locked_tiers`가 소유하고 **천장은 `learner_tier` 하나가 소유**한다.
       ⚠️ 여기 *"초등은 쉬움만, 중·고등은 쉬움·보통, 성인은 전부. 규칙은
       `locked_difficulties`가 소유하고 열쇠는 `users.level_group`"*이라 적혀 있었고
       **전부 거짓이 됐다**(2026-08-20 정정): 「쉬움/보통」 3칸 라벨은 철거됐고,
       `locked_difficulties`도 철거됐고, **열쇠가 `users.level_group`이 아니다**
       (판정 1로 밴드가 천장 경로에서 빠졌다). 정정만 하고 지우지 않는 이유는
       이 문장이 두 잠금의 축이 다른 근거로 인용됐기 때문이다.
    ⑶ **층 미상은 어느 축에도 안 걸린다** — `locked=False`이고 `tierless_ids`가
       열어 준다(판정 2). 종전에는 `unlocked`도 영원히 False라 유령 칸이 됐다.
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
    # 🔴 판정 2: **층 미상은 무조건 열림**(`tierless_ids`) — 종전에는 열린 집합에
    # 들어갈 통로가 없어 `locked=False`인데 `unlocked=False`인 유령 칸이 됐다.
    unlocked = (
        compute_unlocked_ids(ceiling_tier(items, ceiling), cleared)
        | below_ceiling_ids(items, ceiling)
        | tierless_ids(items)
    )
    return [
        BoardPuzzle(
            content_item_id=item.id,
            template_json=item.template_json or {},
            cleared=done,
            knowledge_level=tier,
            # 층 미상은 **모든 천장에서 열림** — 명시 분기(판정 2). `None in set[int]`가
            # 우연히 False인 것에 기대지 않는다(정의역이 바뀌면 그 우연이 깨진다).
            locked=tier is not None and tier in locked,
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
    # 🔴 판정 2: **층 미상은 잠금 판정 앞의 명시 분기로 통과**시킨다.
    if difficulty is not None and difficulty in locked_tiers(ceiling):
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
    # 🔴 판정 2: **층 미상은 잠금 판정 앞의 명시 분기로 통과**시킨다.
    locked = locked_tiers(await learner_tier(db, user))
    tier = board_tier(item)
    if tier is not None and tier in locked:
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
