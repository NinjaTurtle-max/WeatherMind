"""일일 세션 발급 서비스 — 스프린트 R2-01 §3.1~§3.3 (S1·S2·S3).

배합 규칙 (§3.2 → R11-01 §9.2 → R13-01 §2.10 개정):
recipe {"new": 5, "review": 4, "live": 1, "unit": 5} 합계 15문항.
- new: 뱅크 active 문항 중 해당 유저 미출제분 (level_group 일치, 슬롯 문항 제외)
- review: θ 파생 약점 개념(weatherbrain_service.weak_concepts — 학령 상대 임계,
  R8-01 §3.5) 태그의 뱅크 문항 우선, 없으면 new로 대체
- live: uses_live_slots=true 문항 + {today.*} 슬롯을 Redis weather 캐시 값으로 치환.
  **치환 불가분은 배합 단계에서 미리 걸러낸다**(CO-M1) — 남은 자리는 new가 메우고
  생성으로 새지 않는다.
- unit(진도 블록, R13-01 §2.10): **현재 진행 유닛의 다음 진도** 5문항을 세션
  마지막에 덧붙인다(기존 3종을 대체하지 않는다). 풀은 curriculum_service의
  `progress_block_pool`(= `_unit_content_pool` 재사용) — 유닛 잔여가 5 미만이면
  다음 열린 유닛으로 이어지고, 그래도 모자라면 부족분을 new로 메워 총합 15를 지킨다.

부족분 폴백 3단 (CO-H9 — Obs02:128 "뱅크 미스 → 온라인 생성 → 그것도 실패 시 공용
캐시 문항". 3단이 없어 지금까지 **503으로 끝났다**):
  1단 뱅크 — 위 4블록.
  2단 **재출제 풀**(`_fetch_reserve_pool`) — 미출제 제약만 푼 같은 뱅크. 이미 푼
      문항을 다시 내는 것이라 kind는 'review'다(거짓 '신규' 라벨 금지). 무료·무지연·
      결정적이라 **생성보다 먼저** 온다: 3단 폴백의 "공용 캐시 문항"이 곧 이것이고,
      덤으로 상시 과금 지점과 new 풀 고갈(대장 M8)을 함께 눌러 준다.
  3단 ai-worker quiz-generate — asyncio.gather 병렬. 개별 실패는 수집·로깅하고
      성공분으로 세션을 구성한다(웨이브 1 리뷰 3번).
  전부 실패해도 1·2단 산출물이 MIN_QUESTIONS 이상이면 **부분 세션으로 발급**한다
  (CO-H12 판정 — 상수 주석 참조). 그 아래일 때만 AIWorkerError(→503).
- 같은 question_type 3연속 금지 (enforce_type_variety)
- recipe와 router-decide 결과는 sessions 행 JSONB에 저장 (route 미로깅 부채 상환)

구조적 결정: 배합(plan_bank_picks)·순서(enforce_type_variety)·슬롯 추출/치환
(extract_slot_values, fill_live_slots)은 DB 의존이 없는 순수 함수로 분리해
pytest가 DB 없이 검증한다 (TEAM_PROCESS §1.2 테스트 피라미드).
new/review 풀에서 슬롯 문항을 제외하는 이유: 슬롯 치환 없이 서빙되면
"{today.temp_max}" 원문이 유저에게 노출되기 때문 (live 슬롯 전용 풀로만 사용).
"""
import asyncio
import copy
import logging
import re
import uuid
from collections import Counter
from datetime import date, datetime, timezone
from typing import Any, Callable, Sequence

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession as AsyncDBSession

from app.core.config import settings
from app.models.content_item import ContentItem
from app.models.duel import Duel
from app.models.item_param import ItemParam
from app.models.quiz_log import QuizLog
from app.models.session import Session
from app.models.user import User
from app.models.weak_tag import WeakTag
from app.services import ai_client, duel_service, weather_api, weatherbrain_service
from app.services.ai_client import AIWorkerError
from app.services.weather_api import KST, SKY_TEXT, get_today_weather, user_region

logger = logging.getLogger(__name__)

# ── 배합 계약 (§3.2) ── 기본값은 settings(env 튜닝, R5.5). SESSION_SIZE는 합에서 파생.
DEFAULT_RECIPE = settings.SESSION_RECIPE
SESSION_SIZE = sum(DEFAULT_RECIPE.values())
# new 풀 조회 한도 — new는 **다른 전 블록의 대체 공급원**이라(§3.2·R13-01 §2.10 ·
# CO-M1로 live까지 편입) 최악의 수요가 배합 전체다. 이보다 작으면 뱅크에 문항이
# 있어도 부족분이 quiz-generate 폴백으로 새어 비용이 된다.
NEW_POOL_LIMIT = SESSION_SIZE

# daily 풀 선취 배수 (CO-E-1) — θ 경로에서 SQL LIMIT을 배합 요구량의 이 배로 잡는다.
# 유닛 풀의 `UNIT_POOL_PREFETCH`와 **같은 이유·같은 값**이다: SQL은 밴드 해상도
# (|b−θ|)로만 자를 수 있어, 요구량에서 끊으면 `rank_by_knowledge_level`이 지식
# 수준으로 다시 세울 후보가 남지 않는다. 두 경로가 다른 값을 쓰면 "유닛에선 6단계,
# daily에선 4칸"이라는 지금의 결함이 형태만 바꿔 남으므로 값을 맞춘다.
# **계약 수치가 아니라 조회 여유분**이라 env 노브를 두지 않는다 — 조회 횟수는 불변.
DAILY_POOL_PREFETCH = 4
MODE_DAILY = "daily"

# 발급 하한 (CO-H12) — 이 아래로 떨어지면 세션을 발급하지 않고 실패시킨다.
# 배경: `plan_bank_picks`가 부분 배합을 낼 수 있다는 사실이 R2 이래 "부분 세션 허용
# 여부는 R3 검토"라는 **미결 마커**로만 남아 있었고(R3에 검토 흔적 없음), 그 사이
# 배합이 5→10→15로 세 번 커져 미결의 크기가 3배가 됐다. 여기서 닫는다:
#   **부분 세션은 허용한다** — 15문항을 못 채웠다고 학습 자체를 막는 것은 과하고,
#   뱅크 고갈·생성 실패는 유저 잘못이 아니다. 대신 두 가지를 계약으로 세운다.
#   ① **0문항 세션은 절대 발급하지 않는다.** 프론트 자동완료 이펙트에 `total > 0`
#      가드가 있어 0문항 세션은 화면에서 탈출구가 없다(대장 S-3).
#   ② 실제 발급 수를 세션 행에 남긴다(`recipe_json.issued_count`) — 부분 발급이
#      "조용히"가 아니라 **관측 가능하게** 일어나야 한다(대장 M11).
MIN_QUESTIONS = 1

# ── 예보 마감 단계 (R13 A-1) ────────────────────────────────────────────────
# 예보 대결을 일일 세션의 **마감 단계**로 붙인다. 문항이 아니라 단계인 이유:
# 예보의 정답은 **내일의 관측**이 정하므로 즉시 채점이 불가능하다. 15문항과 같은
# 파이프라인(채점기·XP·구름 에너지·만회 큐)에 넣으면 계약이 전부 깨진다.
# 그래서 SESSION_RECIPE에 넣지 않는다 — 배합은 15문항 그대로다.
# 제출·정산·보상은 기존 예보 대결 경로가 이미 소유한다(새 엔드포인트 없음):
#   제출  POST /api/v1/duel/today   (1일 1회, 재제출 409 ALREADY_SUBMITTED)
#   재료  GET  /api/v1/duel/briefing
#   회수  GET  /api/v1/duel/history (정산은 celery 일일 태스크)
DUEL_SUBMIT_PATH = "/api/v1/duel/today"

# ── 생성 문항 영속화 (R13 D 선행) ──────────────────────────────────────────
# content_items 컬럼으로 가는 키 — 적재 시 template_json 본문에서 뺀다.
# quiz_id는 발급 채번값이라 뱅크 문항의 속성이 아니다(컬럼도 없다).
GENERATED_COLUMN_KEYS = (
    "concept_tag",
    "question_type",
    "level_group",
    "knowledge_level",
    "quiz_id",
)
# source.origin 마커 — 생성분만 골라 은퇴·검수·통계 낼 수 있게 남긴다.
GENERATED_ITEM_ORIGIN = "session_generate"
# 적재 허용 유형 — ai-worker 생성 경로가 낼 수 있는 유형과 같다(payload_contract의
# QuizQuestion Literal). 교차 빌드 컨텍스트라 import로 묶을 수 없어 값을 여기 적는다.
#
# ⚠️ **2026-08-10: 3종 → 6종으로 넓혔다 (CO-O-13).** 종전 주석은 *"넓히지 말 것 —
# match·ordering은 채점에 template_json 밖의 구조(pairs·items)가 필요한데
# 시드 게이트(validate_entry)는 그 존재를 검사하지 않는다"*였다. **그 전제가
# 뒤집혔다**: `validate_entry`가 이제 match의 pairs(2쌍 이상·left 중복 금지)·
# ordering의 items와 항등 순열·`shuffled is True`·cloze의 빈칸 마커를 **채점기와
# 같은 규칙으로** 검사한다. 막을 수 있게 됐으므로 막을 이유가 사라졌다.
# 근거였던 문장을 지우지 않고 남기는 것은, 이 값을 다시 좁히려는 사람이 **무엇이
# 바뀌어서 넓혔는지** 알아야 하기 때문이다.
#
# **board는 계속 제외한다** — 판정에 `board_rules.json`(문항 밖 자원)이 필요해
# 순수 함수로 검사할 수 없다. 판정 못 하는 것은 막지도 못하므로 넣지 않는다.
# 뱅크에 "못 푸는 문항"을 넣지 않기 위한 하한이라는 목적은 그대로다.
GENERATED_ITEM_TYPES = (
    "multiple_choice",
    "short_answer",
    "slider",
    "cloze",
    "match",
    "ordering",
)

# ── 실황 슬롯 (§3.3 허용 5종) ──
ALLOWED_SLOTS = (
    "today.temp_max",
    "today.temp_min",
    "today.sky",
    "today.rain_prob",
    "today.region",
)
SLOT_RE = re.compile(r"\{(today\.[a-z_]+)\}")
# SKY_TEXT는 KMA 도메인 소유자 weather_api에서 import (중복 정의 제거, R5.5).


# ═══════════════════════════════════════════════════════════════
# 순수 함수 — DB·네트워크 의존 없음 (단위 테스트 대상)
# ═══════════════════════════════════════════════════════════════


def _fmt_num(value: float) -> str:
    """28.0 → '28', 27.5 → '27.5' (문항 텍스트 자연스러움)."""
    number = float(value)
    return str(int(number)) if number.is_integer() else str(round(number, 1))


def extract_slot_values(weather: dict) -> dict[str, str]:
    """weather 캐시(get_short_forecast 반환 형식)에서 §3.3 슬롯 값을 추출한다.

    - temp_max/temp_min: TMX/TMN(일 1회 값) 우선, 없으면 TMP의 최대/최소
    - rain_prob: POP 최대값
    - sky: 시간대별 SKY 최빈값 → 맑음/구름많음/흐림
    값을 구할 수 없는 슬롯은 결과 dict에서 빠진다 (호출측이 폴백 판단).
    """
    values: dict[str, str] = {}
    region = weather.get("region")
    if region:
        values["today.region"] = str(region)

    forecasts = weather.get("forecasts") or []

    temp_max = weather_api.forecast_temp_max(forecasts)
    if temp_max is not None:
        values["today.temp_max"] = _fmt_num(temp_max)

    tmn = weather_api.forecast_numbers(forecasts, "TMN")
    tmp = weather_api.forecast_numbers(forecasts, "TMP")
    if tmn:
        values["today.temp_min"] = _fmt_num(tmn[0])
    elif tmp:
        values["today.temp_min"] = _fmt_num(min(tmp))

    pop = weather_api.forecast_numbers(forecasts, "POP")
    if pop:
        values["today.rain_prob"] = _fmt_num(max(pop))

    sky = weather_api.forecast_numbers(forecasts, "SKY")
    if sky:
        most_common = Counter(int(v) for v in sky).most_common(1)[0][0]
        values["today.sky"] = SKY_TEXT.get(most_common, "맑음")

    return values


def fill_live_slots(
    template_json: dict[str, Any], slot_values: dict[str, str]
) -> tuple[dict[str, Any], bool]:
    """template_json의 문자열 필드에서 {today.*} 슬롯을 실황 값으로 치환한다.

    question_text·options·correct_answer 등 모든 문자열 필드를 재귀 치환한다
    (예: 슬라이더 정답이 {today.rain_prob}인 문항).
    반환: (치환된 사본, 모든 슬롯이 값으로 치환되었는지 — False면 호출측이
    quiz-generate 폴백해 미치환 원문이 유저에게 노출되지 않게 한다)
    """
    ok = True

    def render(value: Any) -> Any:
        if isinstance(value, str):
            def repl(match: re.Match) -> str:
                nonlocal ok
                key = match.group(1)
                if key in slot_values:
                    return slot_values[key]
                ok = False
                return match.group(0)

            return SLOT_RE.sub(repl, value)
        if isinstance(value, list):
            return [render(v) for v in value]
        if isinstance(value, dict):
            return {k: render(v) for k, v in value.items()}
        return value

    return render(copy.deepcopy(template_json)), ok


def _item_id(item: Any) -> Any:
    return item["id"] if isinstance(item, dict) else item.id


def plan_bank_picks(
    new_pool: Sequence[Any],
    review_pool: Sequence[Any],
    live_pool: Sequence[Any],
    recipe: dict[str, int] | None = None,
    unit_pool: Sequence[Any] | None = None,
) -> tuple[list[dict[str, Any]], int]:
    """뱅크 후보 풀에서 §3.2 배합대로 선택한다 (순수 함수 — 풀은 랜덤 정렬 전제).

    - review 부족분은 new 풀에서 대체 (§3.2 "없으면 new로 대체")
    - unit(진도 블록, R13-01 §2.10) 부족분도 같은 선례로 new 풀에서 대체 —
      열린 유닛이 없거나(신규 유저) 유닛 잔여가 5 미만이어도 총합은 배합 합계다.
    - **live 부족분도 new로 대체한다 (CO-M1)**. 예전에는 live만 대체 대상에서
      빠져 있어서, KMA 키가 없거나 장애면(→ 슬롯 치환 불가 → live 풀이 빈다)
      new 풀이 남아돌아도 그 한 자리가 **매 세션 quiz-generate 1콜**로 샜다.
      8/11~18 무키 실운영에서 상시 경로라 상시 과금이 된다. 실황 문항이 없는 날은
      "오늘의 발견"이 하나 더 나오는 것이 유료 생성보다 낫다 — 세 블록이 이미
      같은 판단을 하고 있었고 live만 예외였다.
    - **board 출제 상한 (CO-H5)**: 비진도 블록(new·review·live)에 들어가는 board는
      `DAILY_BOARD_CAP`까지다. R10.7이 daily 130문항을 실측해 "시드 22.6% → 실출제
      30.8%(1.36×)"를 남겼는데, 원인은 `build_pool_query`에 유형 조건이 없고
      `enforce_type_variety`는 **3연속만** 보고 비율을 안 보기 때문이다. 상한을
      넘는 board는 버리지 않고 뒤로 미뤄 대체 후보가 없을 때만 채운다.
      진도 블록은 면제다(board 유닛의 진도는 board가 정상).
    - 같은 문항 중복 선택 금지 (id 기준 — new/review/unit 풀이 겹칠 수 있음).
      **블록 간 중복 차단은 picked_ids 하나가 전담**한다: 신규 5와 유닛 5가 같은
      뱅크에서 뽑혀도 같은 문항이 두 번 나오지 않는다.
    반환: (picks: [{"kind": "new"|"review"|"live"|"unit", "item": ...}],
           generate_count — 뱅크가 못 채운 폴백 생성 문항 수)
    """
    recipe = recipe or DEFAULT_RECIPE
    picked_ids: set[Any] = set()
    board_taken = 0

    def _is_board(item: Any) -> bool:
        qt = item.get("question_type") if isinstance(item, dict) else getattr(
            item, "question_type", None
        )
        return qt == "board"

    def take(
        pool: Sequence[Any], count: int, kind: str, cap_board: bool = True
    ) -> list[dict[str, Any]]:
        """풀에서 count개를 뽑는다 — board는 상한까지만, 그리고 **뒤로 미룬다**.

        1차 통과에서 board 상한을 넘는 board는 건너뛰고, 그러고도 count를 못 채우면
        2차 통과에서 건너뛴 것들을 그대로 쓴다. **버리지 않는 이유**는 배합이 덜
        차면 그 자리가 quiz-generate로 새기 때문이다(CO-M1이 live에서 이미 겪은 것과
        같은 누수). 즉 이 상한은 "대체 후보가 있을 때만" 작동한다.
        """
        nonlocal board_taken
        taken: list[dict[str, Any]] = []
        deferred: list[Any] = []
        for item in pool:
            if len(taken) >= count:
                break
            item_id = _item_id(item)
            if item_id in picked_ids:
                continue
            if cap_board and _is_board(item) and board_taken >= settings.DAILY_BOARD_CAP:
                deferred.append(item)
                continue
            picked_ids.add(item_id)
            if _is_board(item):
                board_taken += 1
            taken.append({"kind": kind, "item": item})
        for item in deferred:
            if len(taken) >= count:
                break
            picked_ids.add(_item_id(item))
            board_taken += 1
            taken.append({"kind": kind, "item": item})
        return taken

    picks = take(new_pool, recipe["new"], "new")
    review_picks = take(review_pool, recipe["review"], "review")
    review_picks += take(new_pool, recipe["review"] - len(review_picks), "new")
    picks += review_picks
    live_picks = take(live_pool, recipe["live"], "live")
    live_picks += take(new_pool, recipe["live"] - len(live_picks), "new")
    picks += live_picks

    unit_count = recipe.get("unit", 0)
    if unit_count:
        # 진도 블록은 board 상한 **면제** — board 유닛의 진도가 board인 것은 편향이
        # 아니라 그 유닛의 정의다. 다만 유닛 부족분을 new 풀로 메우는 아래 줄은
        # 면제가 아니다(그 자리는 유닛 콘텐츠가 아니다).
        unit_picks = take(unit_pool or (), unit_count, "unit", cap_board=False)
        unit_picks += take(new_pool, unit_count - len(unit_picks), "new")
        picks += unit_picks

    total = sum(recipe.values())
    return picks, total - len(picks)


def generation_tone(user_level_group: str | None) -> str:
    """생성 요청의 `level_group` — **표현 톤**이지 난이도가 아니다 (R13 CO-E-4).

    θ에서 파생하지 않는다. 스펙 03 §2 규칙 2와 `quiz_gen_chain`의 SYSTEM_PROMPT
    원문이 이 필드를 "난이도가 아니라 표현 톤이며 어휘 단계를 한 칸도 움직이지
    못한다"고 못박았으므로, θ를 여기 실으면 모델은 그것을 **말투**로 읽는다
    (θ 낮은 성인 → 어린이 톤). 난이도는 `knowledge_level`이 단독으로 나른다.
    유저가 신고한 학령을 그대로 쓰는 것이 스펙 12 §5.1("신고값은 처음부터
    톤이었다")과의 정합이다.

    두 가지만 접는다:
    - `expert` → `adult`. 가입 신고 축에 없는 값이지만(`schemas/auth.LevelGroup`
      3종) users 체크 제약은 허용한다. 스펙 12 §5.1 "폴백에서는 adult로 접는다".
    - 미설정 → `NEUTRAL_LEVEL_GROUP`. **θ 파생으로 되돌리지 않는 것이 요점이다**
      — 그것이 방금 고친 결함이고, 되돌리면 형태만 바꿔 같은 버그가 산다.
      중립값은 게스트 기본값(`routers.auth.GUEST_LEVEL_GROUP`)과 같은 값이라
      미지 유저가 게스트와 같은 자리로 떨어진다.

    (users.level_group은 DDL상 NOT NULL이라 두 번째 분기는 방어다 — 스텁·미래
    스키마 변경 대비. `weatherbrain_service.effective_*`가 같은 방어 관례를 쓴다.)
    """
    if user_level_group == "expert":
        return "adult"
    return user_level_group or weatherbrain_service.NEUTRAL_LEVEL_GROUP


def pool_level_groups(user_level_group: str, theta: float | None) -> list[str]:
    """뱅크 풀 level_group 필터 집합 (R7 §3.2 — θ→출제 난이도 연결).

    θ가 있으면 가입 그룹 ∪ θ 매핑 그룹(theta_to_level_group) — θ가 가입 학령을
    넘어서면 더 어려운(또는 쉬운) 그룹의 문항이 풀에 들어온다. θ None(콜드스타트)
    이면 기존과 동일하게 가입 그룹 하나만(동작 불변).
    """
    if theta is None:
        return [user_level_group]
    return sorted(
        {user_level_group, weatherbrain_service.theta_to_level_group(theta)}
    )


def kst_day_start_utc(day: date) -> datetime:
    """`day`(KST 달력일) 00:00 KST에 해당하는 UTC 시각 — R10-01 D2.

    세션 발급이 하루를 `datetime.now(KST).date()`로 정의하므로(session.py ·
    curriculum.py) 당일 중복 제외 경계도 같은 기준이어야 한다. UTC 자정을 쓰면
    KST 00:00~09:00 응답이 "어제"로 새어 중복 방지가 그 구간에서 무력해진다.
    반환값은 timestamptz 비교에 안전하도록 UTC로 정규화된 tz-aware datetime.
    """
    return datetime(day.year, day.month, day.day, tzinfo=KST).astimezone(timezone.utc)


def answered_today_subq(user_id: uuid.UUID, day_start_utc: datetime):
    """"오늘 이미 응답한 content_item_id" SELECT 구성 (실행 없음) — R10-01 D2.

    review·live 풀의 `NOT IN` 제외 대상. new 풀의 전기간 served 제외와 달리
    `answered_at >= day_start_utc`로 당일에 한정한다 — 복습·실황 문항은 다음
    날부터 재출제되는 것이 정상이고, 전기간 제외는 풀을 영구 고갈시킨다.
    `content_item_id IS NOT NULL` 조건은 필수다: NULL이 섞이면 SQL `NOT IN`이
    전건 UNKNOWN → false가 되어 풀이 통째로 비워진다(생성 문항·보드 로그는
    content_item_id가 NULL).
    """
    return select(QuizLog.content_item_id).where(
        QuizLog.user_id == user_id,
        QuizLog.content_item_id.is_not(None),
        QuizLog.answered_at >= day_start_utc,
    )


def build_pool_query(
    *,
    level_groups: Sequence[str],
    theta: float | None,
    live: bool,
    served_subq: Any | None = None,
    weak_concepts: Sequence[str] | None = None,
    limit: int,
):
    """new/review/live 풀 SELECT 구성 — 실행 없는 순수 구성이라 DB 없이 검증 가능.

    θ가 있으면 item_params를 outerjoin해 `abs(coalesce(보정 b, 사전 b CASE) − θ)`
    오름차순(동률은 random)으로 정렬한다 — θ에 가장 알맞은 난이도의 문항부터.
    사전 b CASE는 weatherbrain_service.LEVEL_GROUP_ITEM_B(ai-worker priors와
    동일값 — 계약 테스트 감시). θ None이면 기존 그대로 random 정렬만.
    """
    stmt = select(ContentItem)
    if theta is not None:
        stmt = stmt.outerjoin(
            ItemParam, ItemParam.content_item_id == ContentItem.id
        )
    stmt = stmt.where(
        ContentItem.status == "active",
        ContentItem.level_group.in_(list(level_groups)),
        ContentItem.uses_live_slots.is_(live),
    )
    if served_subq is not None:
        stmt = stmt.where(ContentItem.id.not_in(served_subq))
    if weak_concepts is not None:
        stmt = stmt.where(ContentItem.concept_tag.in_(list(weak_concepts)))
    if theta is None:
        return stmt.order_by(func.random()).limit(limit)
    prior_b = case(
        *(
            (ContentItem.level_group == lg, b)
            for lg, b in weatherbrain_service.LEVEL_GROUP_ITEM_B.items()
        ),
        else_=weatherbrain_service.DEFAULT_ITEM_B,
    )
    difficulty_distance = func.abs(func.coalesce(ItemParam.b, prior_b) - theta)
    return stmt.order_by(difficulty_distance, func.random()).limit(limit)


def enforce_type_variety(
    items: Sequence[Any],
    type_of: Callable[[Any], Any] | None = None,
) -> list[Any]:
    """같은 question_type 3연속 금지 (§3.2) — 위반 지점을 뒤쪽의 다른 유형과 교환.

    구성상 불가능하면(예: 전 문항 동일 유형) 원 순서를 유지한다.
    """
    key = type_of or (lambda q: q.get("question_type"))
    result = list(items)
    for i in range(2, len(result)):
        if key(result[i]) == key(result[i - 1]) == key(result[i - 2]):
            for j in range(i + 1, len(result)):
                if key(result[j]) != key(result[i]):
                    result[i], result[j] = result[j], result[i]
                    break
    return result


# ═══════════════════════════════════════════════════════════════
# DB·외부 서비스 결합부
# ═══════════════════════════════════════════════════════════════


async def _load_weak_tag_rows(db: AsyncDBSession, user: User) -> list[WeakTag]:
    """유저의 weak_tags 전체 행 — decide_route와 review 풀 구성이 공유 (리뷰 6번)."""
    return list(
        (await db.execute(select(WeakTag).where(WeakTag.user_id == user.id)))
        .scalars()
        .all()
    )


async def decide_route(
    db: AsyncDBSession,
    user: User,
    weak_tag_rows: list[WeakTag] | None = None,
    abilities: list[dict] | None = None,
) -> dict:
    """weak_tags + 최근 정오답 + θ로 Router Chain 분기 (실패 시 general).

    routers/quiz.py에 있던 _decide_route를 세션 발급(S1)과 공유하도록 이동.
    weak_tag_rows를 넘기면 재조회를 생략한다 (세션 발급이 이미 조회한 결과 재사용).
    abilities도 같은 전례 — 넘기면 refresh_abilities를 생략한다 (세션 발급이
    이미 재추정한 θ 재사용, 이중 refresh 금지 — R7 §3.2). None이면 현행처럼
    내부에서 재추정한다 (quiz.py 등 레거시 호출부 하위 호환).
    """
    tags = (
        weak_tag_rows
        if weak_tag_rows is not None
        else await _load_weak_tag_rows(db, user)
    )
    weak_tags = [
        {"concept_tag": t.concept_tag, "accuracy_rate": float(t.accuracy_rate or 0)}
        for t in tags
        if t.total_count
    ]
    recent = (
        (
            await db.execute(
                select(QuizLog.is_correct)
                .where(QuizLog.user_id == user.id, QuizLog.is_correct.is_not(None))
                .order_by(QuizLog.answered_at.desc())
                .limit(5)
            )
        )
        .scalars()
        .all()
    )
    recent_results = [bool(v) for v in reversed(recent)]  # 시간순(과거 → 최근)
    # R6 WeatherBrain: 누적 응답으로 θ 재추정·영속화 후 Router 1순위 신호로 공급.
    # 실패해도 refresh_abilities가 저장된 θ(또는 빈 리스트)로 폴백 → 세션 발급 계속.
    if abilities is None:
        abilities = await weatherbrain_service.refresh_abilities(db, user)
    # R13 CO-V-1(=CO-U-3-A): θ "focused" 임계는 **학령 상대**다. 학령을 안 넘기면
    # ai-worker가 절대 임계(middle_high 값)로 폴백해 elementary는 맞혀도 항상
    # focused, adult는 8연속 오답까지 general이 된다(weatherbrain_service.
    # focus_theta_threshold 독스트링의 실측). 가입 학령을 그대로 넘긴다.
    return await ai_client.router_decide(
        str(user.id),
        weak_tags,
        recent_results,
        abilities,
        level_group=user.level_group,
    )


async def _fetch_pools(
    db: AsyncDBSession,
    user: User,
    weak_concepts: Sequence[str],
    theta: float | None = None,
) -> tuple[list[ContentItem], list[ContentItem], list[ContentItem]]:
    """new/review/live 후보 풀 조회 (active + level_group, θ 난이도 정렬).

    weak_concepts는 호출측이 θ(refresh_abilities 결과)에서 산출해 넘긴다
    (weatherbrain_service.weak_concepts — θ 파생 단일 공급원, R8-01 §3.5).
    theta는 호출측이 refresh_abilities 결과에서 산출해 넘긴다 (R7 §3.2 —
    풀 그룹 확장 + |b−θ| 정렬은 build_pool_query·pool_level_groups 참조.
    None이면 기존 단일 그룹·random 정렬 그대로 — 콜드스타트 동작 불변).
    풀 크기는 배합 요구량보다 넉넉히(new NEW_POOL_LIMIT · review 10 · live 5)
    가져와 중복 제거·치환 실패 시의 여유분으로 쓴다. new 한도가 배합에서 파생되는
    이유(R13-01 §2.10): new는 review·unit 부족분의 **대체 공급원**이라 최악의
    수요가 new+review+unit이다 — 10으로 고정하면 유닛·복습 풀이 빈 유저에게
    부족분 4건이 매 세션 quiz-generate로 새고, 그건 곧 상시 과금이다.

    중복 방지 (R10-01 D2): new는 **전기간** served 제외(한 번 본 문항은 다시
    '신규'가 아니다), review·live는 **당일** 제외(answered_today_subq) —
    배치고사 직후 첫 세션이 방금 푼 문항을 재출제하던 P0의 직접 원인이 두 풀에
    제외가 전달되지 않은 것이었다.
    """
    served_subq = select(QuizLog.content_item_id).where(
        QuizLog.user_id == user.id, QuizLog.content_item_id.is_not(None)
    )
    today_subq = answered_today_subq(
        user.id, kst_day_start_utc(datetime.now(KST).date())
    )
    groups = pool_level_groups(user.level_group, theta)

    # ── 6단계 해상도 재정렬 (CO-E-1) ────────────────────────────────────────
    # SQL이 자를 수 있는 최소 단위는 밴드(|b−θ|의 사전 b가 밴드당 한 값)다. 유닛
    # 세션은 그 위에 `rank_by_knowledge_level`로 한 겹을 더 세우는데(CO-L-F2)
    # **daily만 밴드에 멈춰 있었다** — 1·2단계가 한 칸, 3·4단계가 한 칸으로 뭉쳐
    # 나가는 것이 E-1이 "6단계는 데이터·lint·프롬프트에만 있고 서빙 해상도는
    # 여전히 4칸"이라 적은 상태다. 세션 15문항 중 10문항이 이 경로로 나가므로
    # 학습자가 실제로 겪는 해상도는 유닛이 아니라 여기서 정해진다.
    #
    # 유닛 경로와 **같은 함수·같은 배수**를 쓴다. 두 경로가 갈리면 "유닛에선
    # 6단계, daily에선 4칸"이라는 지금의 결함이 형태만 바꿔 남는다.
    #
    # 순환 import 회피: curriculum_service가 이 모듈을 import하므로 함수 안에서
    # 지연 import한다(`_fetch_unit_pool`이 같은 이유로 같은 일을 한다).
    from app.services import curriculum_service

    target_level = (
        None
        if theta is None
        else weatherbrain_service.theta_to_knowledge_level(theta)
    )
    prefetch = 1 if theta is None else DAILY_POOL_PREFETCH

    def _ranked(rows, limit: int) -> list[ContentItem]:
        """선취분을 지식 수준으로 다시 세우고 원래 요구량으로 자른다.

        `target_level`이 None(콜드스타트)이면 `rank_by_knowledge_level`이 입력
        순서를 그대로 돌려주고 prefetch도 1이라 **조회·결과 모두 종전과 동일**하다.
        """
        return curriculum_service.rank_by_knowledge_level(
            list(rows), target_level
        )[:limit]

    new_pool = (
        (
            await db.execute(
                build_pool_query(
                    level_groups=groups,
                    theta=theta,
                    live=False,
                    served_subq=served_subq,
                    limit=NEW_POOL_LIMIT * prefetch,
                )
            )
        )
        .scalars()
        .all()
    )

    review_pool: list[ContentItem] = []
    if weak_concepts:
        review_pool = (
            (
                await db.execute(
                    build_pool_query(
                        level_groups=groups,
                        theta=theta,
                        live=False,
                        served_subq=today_subq,
                        weak_concepts=weak_concepts,
                        limit=10 * prefetch,
                    )
                )
            )
            .scalars()
            .all()
        )

    # live 풀은 선취하지 않는다 — 실황 자산 자체가 소수(CO-M9: middle_high 1 ·
    # adult 1 · expert 0)라 선취해도 재정렬할 후보가 늘지 않고, 슬롯 치환이
    # 걸린 문항이라 난이도보다 **치환 가능 여부**가 먼저다.
    live_pool = (
        (
            await db.execute(
                build_pool_query(
                    level_groups=groups,
                    theta=theta,
                    live=True,
                    served_subq=today_subq,
                    limit=5,
                )
            )
        )
        .scalars()
        .all()
    )
    return (
        _ranked(new_pool, NEW_POOL_LIMIT),
        _ranked(review_pool, 10),
        list(live_pool),
    )


async def _fetch_reserve_pool(
    db: AsyncDBSession,
    user: User,
    theta: float | None,
    exclude_ids: set,
    count: int,
) -> list[ContentItem]:
    """폴백 2단 — **미출제 제약만 푼** 재출제 풀 (CO-H9 "공용 캐시 문항").

    1단(new/review/live/unit)이 배합을 못 채웠을 때, 유료 생성으로 가기 **전에**
    같은 뱅크에서 이미 본 적 있는 문항을 다시 꺼낸다. new 풀과 다른 점은 전기간
    served 제외가 없다는 것 하나이며, level_group·status=active·비슬롯 조건은 같다.

    왜 생성보다 먼저인가:
    - Obs02:128의 3단 폴백이 정확히 이것("그것도 실패 시 공용 캐시 문항")인데,
      백엔드에는 2단 + 503만 있었다. ai-worker 내부 폴백 7건은 **LLM 실패 전용**이라
      ai-worker HTTP 자체가 죽으면 도달하지 못한다 — 무키 실운영의 상시 경로다.
    - 무료·무지연·결정적이다. 이미 푼 문항의 재출제는 열화이지 오류가 아니다.
    - 덤으로 new 풀 고갈(대장 M8 — 발급만 해도 영구히 '신규 아님')의 완충이 된다.

    `exclude_ids`로 이번 세션이 이미 고른 문항을 뺀다(같은 세션 안 중복 금지).
    한도를 넉넉히 잡는 이유는 제외분 때문에 실효 개수가 줄어들기 때문이다.
    """
    if count <= 0:
        return []
    rows = (
        (
            await db.execute(
                build_pool_query(
                    level_groups=pool_level_groups(user.level_group, theta),
                    theta=theta,
                    live=False,
                    limit=count + len(exclude_ids),
                )
            )
        )
        .scalars()
        .all()
    )
    return [row for row in rows if row.id not in exclude_ids][:count]


async def _fetch_unit_pool(
    db: AsyncDBSession, user: User, abilities: list, count: int
) -> tuple[list[ContentItem], Any | None]:
    """진도 블록(§2.10) 후보 풀 — curriculum_service.progress_block_pool 위임.

    curriculum_service가 session_service를 import하므로(풀 쿼리 재사용) 여기서는
    **함수 안에서 지연 import**한다 — 모듈 최상단에 두면 순환 import가 된다.
    반환: (문항 목록, 블록 유닛 or None). count<=0이면 조회 없이 빈 결과.
    """
    if count <= 0:
        return [], None
    from app.services import curriculum_service

    return await curriculum_service.progress_block_pool(
        db, user, abilities, count=count
    )


async def allocate_quiz_ids(
    db: AsyncDBSession, user_id: uuid.UUID, today_str: str, count: int
) -> list[str]:
    """오늘자 quiz_id 채번 — {YYYYMMDD}-{seq:03d} (리뷰 7번: quiz.py와 공용 헬퍼).

    유저의 오늘자 기존 발급 수를 세어 이어서 count개를 부여한다
    (기존 /quiz/today 채번 규칙 그대로).
    """
    existing = (
        await db.execute(
            select(func.count())
            .select_from(QuizLog)
            .where(QuizLog.user_id == user_id, QuizLog.quiz_id.like(f"{today_str}-%"))
        )
    ).scalar_one()
    return [f"{today_str}-{existing + 1 + offset:03d}" for offset in range(count)]


async def forecast_closing_step(
    db: AsyncDBSession, user: User, today: date | None = None
) -> dict[str, Any] | None:
    """일일 세션의 예보 마감 단계 — 필요하면 dict, 아니면 None (R13 A-1).

    None(= 마감 단계 없음)이 되는 경우는 **하나뿐이다**:
    1. **오늘 이미 제출했다** — 대상일(내일) duels 행이 있으면 미노출. 재노출하면
       프론트가 409 ALREADY_SUBMITTED로 끝나는 단계를 그리게 된다.

    **KMA 대상일 예보를 못 구해도 단계는 뜬다** (CO-M2 판정 — 개정 전에는 이것이
    2번째 None 사유였다). 개정 이유: `get_today_weather()`가 키 부재·장애면 빈 dict를
    돌려주므로 `base_forecast`는 **무키 환경에서 항상 None**이었고, 그래서 3일차에
    만든 R13 A-1이 8/11~18 실운영과 무키 데모에서 **영원히 도달 불가**였다. "판단
    재료 없이 예보를 요구하면 찍기"라는 원래 논거는 맞지만, 그 대가가 **기능 전체의
    소멸**이면 비용이 크게 어긋난다.
    타협은 **숫자를 지어내지 않는 것**이다: `base_forecast=None`을 그대로 내려보내고
    (스키마가 이미 Optional), 프론트는 기준 예보 배너만 숨긴 채 단계를 그린다 —
    `routers/duel._to_today_response`가 쓰는 것과 **같은 관례**다. 판단 재료가 더
    필요하면 기존 `GET /api/v1/duel/briefing`이 그 자리에 있다. 제출 자체는 키 없이도
    성립한다(캐스터가 _FALLBACK_BASE로 동작).

    **서울 고정**이다(R11-01 §8 계약 — 정산이 서울 실측). 세션 실황 슬롯이 유저
    지역을 쓰는 것과 다르며, get_today_weather()의 기본 지역과 대결 경로
    (routers/duel._base_forecast_for)의 지역이 같아야 같은 배너를 보게 된다.
    Redis 1h 캐시 뒤라 GET마다 KMA를 재호출하지는 않는다.

    구름 에너지·XP·스트릭에는 닿지 않는다 — 예보 보상은 리그·정산 경로 소유다.
    """
    duel_date = duel_service.duel_target_date(today)
    submitted = (
        await db.execute(
            select(Duel.id).where(
                Duel.user_id == user.id, Duel.duel_date == duel_date
            )
        )
    ).scalar_one_or_none()
    if submitted is not None:
        return None

    base_forecast = duel_service.extract_forecast_for_date(
        await get_today_weather(), duel_date
    )
    if base_forecast is None:
        logger.info(
            "KMA 대상일 예보 부재 — 기준 예보 없이 마감 단계 노출 (user=%s, date=%s)",
            user.id,
            duel_date,
        )

    return {
        "duel_date": duel_date,
        "submit_path": DUEL_SUBMIT_PATH,
        "base_forecast": base_forecast,
    }


def _band_for_generated(question: dict[str, Any], requested: str) -> str:
    """생성 문항의 적재 밴드 — **`knowledge_level`이 권위** (CO-O-5의 런타임 짝).

    저작 CLI는 `scripts/author_items.resolve_level_group`이 같은 규칙을 이미 쓴다.
    여기가 안 맞으면 **같은 결함이 런타임에만 남는다**: 종전 코드는
    `question.get("level_group") or level_group`이었는데 **생성기는 그 키를 내지
    않는다**(`QuizQuestion` 필드에 없다 — 2026-08-10 실측). 그래서 폴백이 항상
    이겼고, 위 호출부 주석이 약속한 "신고하면 그쪽이 우선"이 구현된 적이 없다.

    깨지는 경로: 콜드스타트 `elementary` 학습자는 θ가 없어 목표 단계를 안 보내므로
    모델이 스스로 판정한다. 거기서 `knowledge_level=9`가 신고되면 문항이
    `level_group="elementary"` · `status=active`로 뱅크에 적재되고, 이후
    `pool_level_groups`의 밴드 필터가 그 전문가 문항을 **모든 초등 학습자에게**
    다시 서빙한다. `validate_entry`는 두 축의 모순을 보지 않으므로 아무도 막지 않는다.

    미신고·비정수·범위 밖은 **파생하지 않고 요청 밴드를 유지**한다 — 범위 밖을
    파생시키면 `level_group_of_knowledge_level`의 클램프가 엉뚱한 밴드를 정상값처럼
    만들어, lint가 잡아야 할 미분류를 위장한다(저작 쪽과 같은 판단).
    """
    raw = question.get("knowledge_level")
    try:
        level = int(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return requested
    if not (
        weatherbrain_service.KNOWLEDGE_LEVEL_MIN
        <= level
        <= weatherbrain_service.KNOWLEDGE_LEVEL_MAX
    ):
        return requested
    return weatherbrain_service.level_group_of_knowledge_level(level)


def generated_item_entry(
    question: dict[str, Any], *, level_group: str
) -> dict[str, Any]:
    """생성 문항 → 시드 로더와 **같은 형식**의 적재 엔트리 (순수 함수).

    형식을 맞추는 이유: 품질 게이트(seed_content.validate_entry)와 멱등 키를
    사람 저작 시드와 공유하기 위해서다. 생성 경로 전용 규칙을 새로 쓰면 두 경로가
    갈라지고, 갈라진 쪽이 반드시 느슨해진다.

    knowledge_level은 **생성 문항의 신고값을 그대로 흘려보내는 자리**다(R13-0 §1).
    생성 경로가 신고를 시작했으므로(스펙 03 §2 규칙 3 — `QuizQuestion`이 필수로
    요구) 실제로 값이 들어온다. 신고를 그대로 믿는 것은 아니다: 어휘 대조는
    ai-worker의 생성 시점 검사(`_reject_if_level_overstated`)가 하고, 통과 못 한
    문항은 애초에 여기까지 오지 않는다(재시도 → 폴백 뱅크).

    신고가 없으면 None = 미분류로 적재된다 — 조용히 채우지 않는 것이 요점이다.
    단계 판정(docs/specs/12 §4 R2~R6)은 사람 몫이고 level_group에서 기계 복원하는
    것은 §5.3이 금지한다. 미분류는 lint가 잡아야 할 상태이지 정상값이 아니다.
    """
    return {
        "concept_tag": question.get("concept_tag"),
        "level_group": _band_for_generated(question, level_group),
        "knowledge_level": question.get("knowledge_level"),
        "question_type": question.get("question_type"),
        "template_json": {
            key: value
            for key, value in question.items()
            if key not in GENERATED_COLUMN_KEYS
        },
    }


async def persist_generated_items(
    db: AsyncDBSession,
    questions: Sequence[dict[str, Any]],
    *,
    level_group: str,
    route: str = "general",
    region: str | None = None,
    today: date | None = None,
) -> list[Any | None]:
    """quiz-generate 산출물을 content_items에 적재하고 행(또는 None)을 돌려준다.

    반환은 questions와 **같은 길이·같은 순서**다 — 적재되지 않은 자리는 None이고,
    호출측은 그 문항을 지금까지처럼 content_item_id 없이 일회용으로 서빙한다
    (버리지 않는다: 버리면 배합 총합 15가 깨진다).

    **왜 필요한가**: 지금까지 생성 문항은 `content_item_id=None`으로 버려졌다.
    그래서 θ·복습 큐·간격반복·문항 통계가 그 문항을 영원히 못 보고, 같은 문항이
    세션마다·유저마다 다시 생성됐다 — G1 배치(~1,360건) 이후에는 이것이 영구
    자산이 아니라 상시 트래픽 과금이 된다.

    **품질 게이트를 우회하지 않는다**: 사람 저작 시드가 통과하는 것과 **같은**
    결정적 휴리스틱(`seed_content.validate_entry` — concept_tag·level_group·
    question_type 화이트리스트, 객관식 보기 4개·중복·정답 포함, slider 범위,
    question_text 존재)을 통과한 것만 적재한다. LLM 2단 게이트는 부르지 않는다
    (문항당 유료 1콜 — 상시 과금 지점을 새로 여는 셈이다. 승격 검수에서 본다).
    탈락분은 **일회용 서빙**이고 사유를 warning으로 남긴다.

    **status 판단**(settings.GENERATED_ITEM_STATUS, 기본 'active'):
    'active'라야 다음 세션에서 뱅크로 재사용되고, 재사용돼야 생성 1회 비용이
    자산이 된다. 'draft'로 내리면 θ·복습 큐 배선은 남지만 재생성 누수는 그대로다.
    한 줄(env)로 되돌릴 수 있게 설정으로 뺐다 — 검수 정책이 서면 여기서 바꾼다.

    **멱등**: 시드 로더와 같은 키 `(concept_tag, template_json->>'question_text')`.
    조회는 세션당 **SELECT 1회**다(문항마다가 아니라 배치 1회) — 이 표현식에는
    인덱스가 없어 content_items 순차 스캔이고, 문항마다 돌리면 그 스캔이 최대
    15회가 된다. 생성 폴백이 안 나면(뱅크가 배합을 채우면) 조회 자체가 없다.
    """
    if not questions:
        return []
    # 시드 스키마 검증의 단일 소유자 — 사본을 만들지 않는다. 지연 import는
    # curriculum_service 선례(모듈 최상단이면 import 그래프가 스크립트를 끈다).
    from app.scripts.seed_content import validate_entry

    entries: list[dict[str, Any] | None] = []
    for index, question in enumerate(questions):
        entry = generated_item_entry(question, level_group=level_group)
        errors = validate_entry(entry, index)
        if entry["question_type"] not in GENERATED_ITEM_TYPES:
            errors.append(
                f"[{index}] 생성 적재 불허 유형: {entry['question_type']!r} "
                f"(허용 {list(GENERATED_ITEM_TYPES)})"
            )
        if SLOT_RE.search(str(entry["template_json"])):
            # uses_live_slots=False로 적재되면 new/review 풀에 들어가고, 그 풀은
            # 치환을 하지 않는다 — 유저에게 "{today.temp_max}" 원문이 보인다.
            errors.append(f"[{index}] 미치환 {{today.*}} 슬롯 포함 — 뱅크 적재 금지")
        if errors:
            logger.warning(
                "생성 문항 품질 게이트 탈락 — 영속화 생략, 일회용 서빙: %s",
                "; ".join(errors),
            )
            entries.append(None)
        else:
            entries.append(entry)

    texts = [
        e["template_json"]["question_text"] for e in entries if e is not None
    ]
    known: dict[tuple[str, str], Any] = {}
    if texts:
        rows = (
            (
                await db.execute(
                    select(ContentItem).where(
                        ContentItem.template_json["question_text"].astext.in_(texts)
                    )
                )
            )
            .scalars()
            .all()
        )
        known = {
            (row.concept_tag, (row.template_json or {}).get("question_text")): row
            for row in rows
        }

    source = {
        "origin": GENERATED_ITEM_ORIGIN,
        "route": route,
        # 생성 프롬프트가 "제공된 실제 기상 데이터의 수치를 반영"을 강제하므로
        # 문항 본문에 **그날의** 날씨가 박힌다. 언제·어느 지역의 날씨로 만든
        # 문항인지 남겨야 나중에 은퇴·재검수 대상을 골라낼 수 있다.
        "generated_on": (today or datetime.now(KST).date()).isoformat(),
        "region": region,
    }
    result: list[Any | None] = []
    for entry in entries:
        if entry is None:
            result.append(None)
            continue
        key = (entry["concept_tag"], entry["template_json"]["question_text"])
        item = known.get(key)
        if item is None:
            item = ContentItem(
                id=uuid.uuid4(),  # 채번을 앱이 해야 flush 없이 quiz_logs에 엮인다
                concept_tag=entry["concept_tag"],
                level_group=entry["level_group"],
                knowledge_level=entry["knowledge_level"],
                question_type=entry["question_type"],
                template_json=entry["template_json"],
                # 생성 문항에는 {today.*} 슬롯이 없다 — 값이 이미 본문에 박혀 있다.
                uses_live_slots=False,
                source=source,
                status=settings.GENERATED_ITEM_STATUS,
            )
            db.add(item)
            known[key] = item  # 같은 배치 안의 중복도 한 번만 적재
        result.append(item)
    return result


async def create_daily_session(
    db: AsyncDBSession, user: User, today: date | None = None
) -> tuple[Session, list[dict[str, Any]]]:
    """오늘의 daily 세션을 새로 발급한다 (§3.1 GET /today 신규 경로).

    반환: (Session 행, entries — [{"quiz_id", "question", "source", "slot_filled"}]).
    뱅크 0건이어도 quiz-generate 폴백으로 배합 총합(기본 10문항)을 채운다 (S2 AC).
    생성 폴백이 부분 실패하면 성공분으로 세션을 구성하고,
    전부 실패 시에만 AIWorkerError 전파 (라우터에서 503 처리).
    """
    now = datetime.now(KST)
    today = today or now.date()
    today_str = now.strftime("%Y%m%d")

    # weak_tags 조회는 라우터 폴백 payload 전용으로만 남는다 (decide_route —
    # ai-worker 장애 복원력 유지, R8-01 §3.5).
    weak_rows = await _load_weak_tag_rows(db, user)
    # θ 재추정도 정확히 1회 — 분기(decide_route)와 풀 난이도(_fetch_pools)·
    # quiz-generate 난이도가 공유한다 (weak_tag_rows 재사용과 같은 전례, R7 §3.2).
    abilities = await weatherbrain_service.refresh_abilities(db, user)
    route_decision = await decide_route(db, user, weak_rows, abilities=abilities)
    # review 풀의 약점 개념은 θ 파생 단일 공급원 (R8-01 §3.5, 학령 상대 임계)
    weak_concepts = weatherbrain_service.weak_concepts(abilities, user.level_group)

    # 실황은 유저 지역 기준 (R11-01 §8.2 — NULL=서울). 캐시 키(weather:{date}:{region})가
    # 지역별로 갈리므로 today.* 슬롯·생성 폴백 weather_data가 함께 지역화된다.
    weather = await get_today_weather(user_region(user))
    slot_values = extract_slot_values(weather)

    # 대표 θ — route 목표 개념 우선, 없으면 가중 평균 (콜드스타트면 None)
    theta = weatherbrain_service.overall_theta(
        abilities, route_decision.get("target_concept_tag")
    )
    new_pool, review_pool, live_pool = await _fetch_pools(
        db, user, weak_concepts, theta=theta
    )
    # 실황 풀에서 **치환 불가 문항을 배합 전에 걸러낸다** (CO-M1). 예전에는 배합
    # 뒤에 치환을 시도하고 실패하면 `generate_count += 1`로 넘겼는데, 그 자리는
    # 대체 대상이 아니라 **곧장 유료 생성**이었다. 여기서 미리 빼면 부족분이 배합
    # 단계에 보이고 plan_bank_picks가 new로 메운다 — KMA가 없는 날에도 생성 0.
    # 비용은 live 후보(최대 5건)의 사전 렌더 한 번이다.
    renderable_live = [
        item
        for item in live_pool
        if fill_live_slots(dict(item.template_json or {}), slot_values)[1]
    ]
    if len(renderable_live) < len(live_pool):
        logger.info(
            "live 슬롯 치환 불가 %d/%d건 제외 — 부족분은 new가 대체 (user=%s)",
            len(live_pool) - len(renderable_live),
            len(live_pool),
            user.id,
        )
    # 진도 블록(R13-01 §2.10) — 현재 진행 유닛의 다음 문항. 열린 유닛이 없으면
    # 빈 풀이고 부족분은 plan_bank_picks가 new로 메운다(총합 불변).
    unit_pool, block_unit = await _fetch_unit_pool(
        db, user, abilities, DEFAULT_RECIPE.get("unit", 0)
    )
    picks, generate_count = plan_bank_picks(
        new_pool, review_pool, renderable_live, unit_pool=unit_pool
    )

    # 폴백 2단 (CO-H9) — 유료 생성 **전에** 재출제 풀로 메운다.
    if generate_count:
        reserve = await _fetch_reserve_pool(
            db,
            user,
            theta,
            {_item_id(p["item"]) for p in picks},
            generate_count,
        )
        if reserve:
            logger.info(
                "뱅크 부족분 %d건 중 %d건을 재출제 풀로 충당 (user=%s)",
                generate_count,
                len(reserve),
                user.id,
            )
            # 진도 블록은 항상 마지막(§2.10)이라 재출제분을 그 앞에 끼운다.
            unit_at = len(picks) - sum(1 for p in picks if p["kind"] == "unit")
            picks[unit_at:unit_at] = [
                {"kind": "review", "item": item} for item in reserve
            ]
            generate_count -= len(reserve)

    entries: list[dict[str, Any]] = []
    for pick in picks:
        item: ContentItem = pick["item"]
        template = dict(item.template_json or {})
        slot_filled = False
        if pick["kind"] == "live":
            # 위에서 렌더 가능분만 남겼으므로 ok=False는 구조적으로 나오지 않는다.
            # 방어는 남기되 생성으로 보내지 않는다 — 그 자리가 CO-M1의 누수였다.
            rendered, ok = fill_live_slots(template, slot_values)
            if not ok:
                logger.warning("live 슬롯 치환 실패 (item=%s) — 문항 제외", item.id)
                continue
            template, slot_filled = rendered, True
        question = {
            **template,
            "concept_tag": item.concept_tag,
            "question_type": item.question_type,
        }
        entries.append(
            {
                "question": question,
                "source": "bank",
                "slot_filled": slot_filled,
                "content_item_id": item.id,
                "kind": pick["kind"],
            }
        )

    # 뱅크 부족분 — 현행 quiz-generate 경로로 병렬 폴백 (S2, 리뷰 3번)
    if generate_count:
        # 생성 난이도는 θ를 따르되 **난이도 축으로** 따른다 (R13 CO-E-4).
        #
        # 종전에는 θ 파생 밴드를 `level_group` 자리에 실어 보냈다. 그런데 스펙 03
        # §2 규칙 2와 프롬프트 원문이 `level_group`을 "난이도가 아니라 **표현 톤**,
        # 어휘 단계를 한 칸도 움직이지 못한다"고 못박고 있어서, 모델은 θ를 난이도가
        # 아니라 **말투**로 읽었다 — θ가 낮은 성인이 어린이 말투 문항을 받는다.
        # 이제 두 축을 갈라 보낸다: 난이도는 knowledge_level, 톤은 신고 학령.
        generate_knowledge_level = (
            weatherbrain_service.theta_to_knowledge_level(theta)
            if theta is not None
            else None  # 콜드스타트 — 모델이 스스로 판정해 신고한다(스펙 03 §2 규칙 3)
        )
        results = await asyncio.gather(
            *(
                ai_client.quiz_generate(
                    weather_data=weather,
                    level_group=generation_tone(user.level_group),
                    route=route_decision.get("route", "general"),
                    target_concept_tag=route_decision.get("target_concept_tag"),
                    knowledge_level=generate_knowledge_level,
                )
                for _ in range(generate_count)
            ),
            return_exceptions=True,
        )
        generated = [r for r in results if not isinstance(r, BaseException)]
        for exc in (r for r in results if isinstance(r, BaseException)):
            logger.warning("quiz-generate 폴백 실패 (수집): %s", exc)
        if not generated:
            # 3단까지 전부 실패 (CO-H9·CO-H12): 1·2단이 모은 것이 하한 이상이면
            # **부분 세션으로 발급한다** — ai-worker HTTP가 죽었다고 뱅크에 있는
            # 문항까지 못 풀게 하는 것이 지금까지의 503이었다. 하한 미만일 때만
            # 기존 실패 의미론을 유지한다(라우터에서 503 변환).
            if len(entries) < MIN_QUESTIONS:
                raise AIWorkerError(
                    f"quiz-generate 폴백 전부 실패 ({generate_count}건) — "
                    f"뱅크 산출물 {len(entries)}건이 하한 {MIN_QUESTIONS} 미만"
                )
            logger.warning(
                "quiz-generate 폴백 전부 실패 (%d건) — 뱅크 %d문항으로 부분 세션 발급"
                " (user=%s)",
                generate_count,
                len(entries),
                user.id,
            )
            generated = []
        # 생성 문항 영속화 (R13 D 선행) — 품질 게이트 통과분만 content_items에
        # 적재하고 그 id로 세션에 편성한다. 탈락분은 item=None이라 지금까지처럼
        # content_item_id 없이 일회용으로 서빙된다(배합 총합은 그대로 15).
        #
        # 여기 level_group은 **문항 쪽 밴드**(적재 컬럼의 폴백)이지 톤이 아니다 —
        # 위 tone_level_group과 다른 값이 들어가는 것이 맞다. θ 파생을 그대로 둔다:
        # `theta_to_knowledge_level` 독스트링이 보증하는 계약
        # (`level_group_of_knowledge_level(theta_to_knowledge_level(θ))
        #   == theta_to_level_group(θ)`)에 따라 위에서 보낸 난이도와 같은 축이고,
        # 생성 문항이 knowledge_level을 신고하면 그쪽이 우선이라 이 값은 폴백이다.
        # ⚠️ **그 우선순위는 2026-08-10까지 구현돼 있지 않았다** — `generated_item_entry`가
        # `question.get("level_group")`을 읽었는데 생성기는 그 키를 내지 않아 폴백이 항상
        # 이겼다(코드 리뷰 지적). 지금은 `_band_for_generated`가 신고값에서 파생하므로
        # 이 주석이 참이고, 여기 값은 **미신고·범위 밖일 때만** 쓰인다.
        persist_level_group = (
            weatherbrain_service.theta_to_level_group(theta)
            if theta is not None
            else user.level_group
        )
        persisted = await persist_generated_items(
            db,
            generated,
            level_group=persist_level_group,
            route=route_decision.get("route", "general"),
            region=weather.get("region"),
            today=today,
        )
        for question, item in zip(generated, persisted):
            entries.append(
                {
                    "question": question,
                    "source": "generated",
                    "slot_filled": False,
                    # id가 붙어야 θ·복습 큐·간격반복·문항 통계가 이 문항을 본다.
                    # None이면(게이트 탈락) 종전과 같은 일회용 문항이다.
                    "content_item_id": getattr(item, "id", None),
                    # 생성 폴백은 어느 블록의 부족분인지 구분이 없다 — "오늘의 발견"
                    # (new)으로 표기한다. 진도(unit)로 새면 왕관 판정 대상이 뱅크
                    # 유닛 문항이 아닌 것까지 포함되므로 절대 unit을 붙이지 않는다.
                    "kind": "new",
                }
            )

    # 같은 question_type 3연속 금지 (§3.2) — 단, 진도 블록(§2.10)은 **세션 끝에
    # 붙어 있는 것 자체가 계약**("마지막 5문항 = 내 진도")이라 두 구간을 각각
    # 정렬해 경계를 보존한다. 한 리스트로 섞으면 교환이 블록을 가로질러 진도가
    # 세션 중간으로 흩어진다.
    def _variety(block: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return enforce_type_variety(
            block, type_of=lambda e: e["question"].get("question_type")
        )

    entries = _variety([e for e in entries if e["kind"] != "unit"]) + _variety(
        [e for e in entries if e["kind"] == "unit"]
    )

    # 0문항 세션 금지 (CO-H12 ①) — 여기까지 오는 경로가 위 폴백 3단 말고도 생길 수
    # 있으므로(유닛 세션 전례) 발급 직전에 한 번 더 막는다. 프론트 자동완료 이펙트가
    # `total > 0` 가드라 0문항 세션은 화면에서 빠져나갈 수 없다(대장 S-3).
    if len(entries) < MIN_QUESTIONS:
        raise AIWorkerError(
            f"발급 가능 문항 {len(entries)}건 — 하한 {MIN_QUESTIONS} 미만이라 세션 미발급"
        )

    session = Session(
        user_id=user.id,
        session_date=today,
        mode=MODE_DAILY,
        route_decision=route_decision,
    )
    db.add(session)
    await db.flush()  # session.id 확보

    quiz_ids = await allocate_quiz_ids(db, user.id, today_str, len(entries))
    for quiz_id, entry in zip(quiz_ids, entries):
        entry["quiz_id"] = quiz_id
        db.add(
            QuizLog(
                user_id=user.id,
                quiz_id=quiz_id,
                session_id=session.id,
                content_item_id=entry["content_item_id"],
                concept_tag=entry["question"].get("concept_tag", "pressure_front"),
                question_type=entry["question"].get("question_type"),
                question_json=entry["question"],
            )
        )

    # recipe + 발급 문항 메타 저장 (§3.2 — 멱등 재조회 시 source/slot_filled 복원용).
    # kind(R13-01 §2.10)는 완료 화면 블록 표기("오늘의 발견/복습/실황/진도")와
    # **왕관 판정 범위**(진도 블록 5문항)의 유일한 근거다 — 세션 행에 남겨야
    # 멱등 재조회·complete 시점에도 블록 구분이 복원된다.
    session.recipe_json = {
        "recipe": DEFAULT_RECIPE,
        # **의도한 배합(recipe)과 실제 발급 수는 다를 수 있다** (CO-H12 ② · 대장 M11).
        # 부분 세션을 명시 계약으로 승격한 이상 그 흔적이 행에 남아야 한다 — 없으면
        # 13문항이 나가도 세션 행만으로는 알 수 없고, 전부 실패했을 때만(503) 보인다.
        "issued_count": len(entries),
        "generated_count": sum(1 for e in entries if e["source"] == "generated"),
        # 생성분 중 뱅크에 적재된 수 (R13 D 선행) — generated_count와 벌어진 만큼이
        # 품질 게이트 탈락분(일회용)이다. 게이트가 통째로 막히면 여기서 보인다.
        "persisted_count": sum(
            1
            for e in entries
            if e["source"] == "generated" and e["content_item_id"] is not None
        ),
        # 진도 블록 유닛 — 왕관 대상 선정의 근거 (CO-M6 / 대장 L3).
        # **concept_tag를 함께 적는 것이 수리의 핵심**이다. 예전에는 kind만 남기고
        # 개념은 complete 시점에 `majority_concept(블록 문항들의 태그)`로 되짚었는데,
        # 블록이 두 유닛에 걸치면 kind(블록 유닛)와 concept(최다 개념)이 **서로 다른
        # 유닛**을 가리켜 `pick_crown_unit`의 concept AND kind 요구가 깨졌다 —
        # 전건 정답에도 왕관이 증발했다(초등 하늘읽기3 board 시드 1건 경로가 실례).
        # 두 값을 **같은 유닛 하나에서** 뽑아 적으면 불일치가 구조적으로 사라진다.
        # 이 값이 없는 세션(개정 전 발급분)은 라우터가 종전 majority_concept로 폴백.
        "unit_block": (
            {
                "unit_id": str(block_unit.id),
                "unit_slug": block_unit.slug,
                "kind": block_unit.kind,
                "concept_tag": block_unit.concept_tag,
            }
            if block_unit is not None
            and any(e["kind"] == "unit" for e in entries)
            else None
        ),
        "items": [
            {
                "quiz_id": e["quiz_id"],
                "source": e["source"],
                "slot_filled": e["slot_filled"],
                "kind": e["kind"],
            }
            for e in entries
        ],
    }
    await db.flush()
    return session, entries
