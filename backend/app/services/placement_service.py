"""배치고사(진단 퀴즈) 서비스 — 스프린트 R7-01 §3.1·§3.3.

온보딩에서 개념 커버리지(CONCEPT_TAGS 6개념당 1문항) × **지식 단계 전 구간 분산**
으로 PLACEMENT_SIZE개 문항을 뽑아 mode='placement' 세션을 발급하고, 완료 시 응답을
IRT 형식으로 조립해 ai-worker placement(사전+응답 결합 EAP)로 개인화된 초기 θ를
배정한다.

⚠️ **2026-08-12 클라이언트 확정으로 선발 축이 바뀌었다** — "무조건 배치고사에 따른
위치 배정이고, 말투만 선택 수준에 따른 변환이야". 배치고사는 학습자의 위치를
**측정하는** 도구이므로, 그 도구가 학습자의 신고 학령에 따라 달라지면 측정이
자기 전제를 되먹인다. 그래서 선발은 이제 `knowledge_level` 단독이고
(`target_level_sequence` — kl 전 구간 균등 분산), 신고 `level_group`은
**말투 축으로만** 남는다.

그 결과 **폐기된 계약이 하나 있다 — 서로소 배치(R7-02 §3.2)**. 종전에는 신고
그룹별 회전(k = 그룹 순위×2 % size)과 셀 내 그룹 순위 오프셋으로 세 신고 그룹의
픽을 쌍별 교집합 0으로 만들었는데, 그 성질은 **선발이 신고 그룹에 의존한다는
사실 자체**에서 나온 것이라 새 사양과 양립하지 않는다. 지금은 신고 학령과 무관하게
**모든 학습자가 같은 문항으로 진단**받는다(같은 자로 재야 위치가 비교 가능하다).
문항 노출 집중은 그 대가이며 PM 판정 사항으로 넘겼다.

구조적 결정 (session_service의 순수/결합 분리 관례 답습):
- 배합(plan_placement_picks)·응답 조립(assemble_placement_responses)은 DB 의존이
  없는 순수 함수 — pytest가 DB 없이 검증한다 (TEAM_PROCESS §1.2).
- session_service.py는 SA-2가 수정 중이므로 이 파일에 분리 신설한다. 그쪽 함수는
  호출만 하고(allocate_quiz_ids) 시그니처를 건드리지 않는다.

board 유형 제외: 배치고사는 IRT 채점 표본이 목적이라 판정 비용이 크고 응답 시간이
긴 board를 뺀다. uses_live_slots 문항 제외: placement는 슬롯 치환 파이프라인을 타지
않으므로 미치환 원문("{today.temp_max}") 노출을 구조적으로 차단한다
(session_service new/review 풀과 동일 근거).
"""

from __future__ import annotations

import logging
import uuid
from collections import defaultdict
from datetime import date, datetime
from typing import Any, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession as AsyncDBSession

from app.core.config import settings
from app.models.content_item import ContentItem
from app.models.quiz_log import QuizLog
from app.models.session import Session
from app.models.user import User
from app.services import ai_client, session_service, weatherbrain_service
from app.services.ai_client import AIWorkerError
from app.services.weather_api import KST

logger = logging.getLogger(__name__)

MODE_PLACEMENT = "placement"

# 배치고사 문항 수 계약(§3.1) — 기본값은 settings(env 튜닝). 6 = CONCEPT_TAGS 6개념당 1.
PLACEMENT_SIZE = settings.PLACEMENT_SIZE

# level_group 저작 순서(난이도 오름차순) — 교차 배치·서로소 회전·결정적 폴백의 순회 기준.
LEVEL_GROUPS: tuple[str, ...] = ("elementary", "middle_high", "adult")

# 신고 그룹 → 교차 배치 대상(인접 그룹 포함, 난이도 오름차순). §3.1
# 예: middle_high 신고 → elementary 2·middle_high 2·adult 2 (6문항 기준).
#
# ⚠️ **이 표는 배치고사 선발 경로에서 내려왔다**(2026-08-12). `plan_placement_picks`가
# 이제 지식 단계(kl)로 뽑으므로 여기를 읽지 않는다 — `target_group_sequence`만이
# 소비자이고 그쪽도 선발 경로 밖이다. 표를 지우지 않고 남기는 이유는 두 가지다:
# 밴드 인접 관계가 **명시적으로 적힌 유일한 자리**이고(문서·검증 참조), 아래 expert
# 확장이 클라이언트 확정 항목(대장 CO-Y-11)이라 기록을 남겨야 한다.
#
# **expert 추가(CO-Y-11, 2026-08-12 클라이언트 확정)**: 종전 표에는 expert가 아예
# 없어서 `adult`의 인접이 (middle_high, adult)에 멈췄고, expert 자신의 항목도
# 없었다. 밴드×kl 격자가 1:1인 지금(expert = kl 7~10) 그것은 "어느 학령으로
# 신고해도 kl 7~10 문항 400건에 도달할 수 없다"는 뜻이었다.
# `LEVEL_GROUPS`(3종)는 **신고 축**이라 건드리지 않는다 — expert는 가입 화면에
# 없는 값이고, ai-worker 계약(test_author_batch)이 그 3종을 고정한다.
ADJACENT_GROUPS: dict[str, tuple[str, ...]] = {
    "elementary": ("elementary", "middle_high"),
    "middle_high": ("elementary", "middle_high", "adult"),
    "adult": ("middle_high", "adult", "expert"),
    "expert": ("adult", "expert"),
}

def to_progress_abilities(abilities: Sequence[dict]) -> list[dict[str, Any]]:
    """내부 θ 형식({theta, se, n}) → /progress/abilities 응답 형식 (§3.1 보강).

    배치고사 완료 응답의 abilities 원소는 ConceptAbilityOut과 동일 형식
    ({concept_tag, theta, theta_se, num_responses, level_label})이어야 한다 —
    프론트가 진단 화면과 같은 렌더러를 쓴다. level_label은
    weatherbrain_service.theta_level_label 재사용(경계 단일 소유).
    """
    return [
        {
            "concept_tag": ab["concept_tag"],
            "theta": float(ab["theta"]),
            "theta_se": float(ab["se"]),
            "num_responses": int(ab["n"]),
            "level_label": weatherbrain_service.theta_level_label(float(ab["theta"])),
        }
        for ab in abilities
    ]


# ═══════════════════════════════════════════════════════════════
# 순수 함수 — DB·네트워크 의존 없음 (단위 테스트 대상)
# ═══════════════════════════════════════════════════════════════


def _attr(item: Any, name: str) -> Any:
    """dict·ORM 객체 겸용 속성 접근 (session_service._item_id 관례)."""
    return item[name] if isinstance(item, dict) else getattr(item, name)


# `_group_rank`(신고 그룹 순위)는 2026-08-12에 삭제됐다 — 유일한 소비자가 서로소
# 배치의 회전·셀 오프셋이었고, 그 계약이 폐기됐다(모듈 독스트링). 남겨 두면
# "신고 학령으로 문항을 고르는 통로"가 코드에 계속 서 있게 된다.


def _optional_attr(item: Any, name: str) -> Any:
    """`_attr`의 결측 허용판 — dict에 키가 없거나 ORM/대역에 속성이 없으면 None.

    `_attr`는 dict에서 `item[name]`이라 **없는 키에 KeyError**를 낸다. 배치고사
    후보는 dict(테스트 대역)와 ORM(프로덕션)을 겸하고, `knowledge_level`은 대역에
    없는 것이 정상이라(미분류 폴백 계약) 결측을 값으로 다뤄야 한다.
    """
    if isinstance(item, dict):
        return item.get(name)
    return getattr(item, name, None)


def item_knowledge_level(item: Any) -> int:
    """문항의 지식 단계 — 미분류(NULL)면 밴드에서 파생 (0012 폴백 계약).

    `weatherbrain_service.effective_knowledge_level`과 **같은 규칙**이되 dict 후보를
    받는다(그쪽은 getattr 전용이라 dict에서 전건 NULL로 떨어진다). 파생값은
    `knowledge_level_of_level_group` 단일 소유 — 밴드의 최하 단계다.
    """
    level = _optional_attr(item, "knowledge_level")
    if level is None:
        return weatherbrain_service.knowledge_level_of_level_group(
            _optional_attr(item, "level_group")
        )
    return int(level)


def target_level_sequence(size: int) -> list[int]:
    """size개 슬롯의 목표 지식 단계 — kl 전 구간(MIN~MAX) 균등 분산 (2026-08-12).

    배치고사가 **10단계를 변별**하려면 표본이 전 구간에 걸쳐야 한다. 종전 배합은
    `knowledge_level`을 한 번도 보지 않고 4밴드 축으로만 골랐고, 밴드×kl가 1:1인
    지금 그것은 "신고 학령이 정한 2~4개 단계 안에서만 물어본다"는 뜻이었다 —
    자기 신고보다 아래·위에 있는 학습자의 위치는 원리적으로 측정되지 않는다.

    양 끝(MIN·MAX)을 반드시 포함하는 선형 분산이다. 구간을 size−1로 나누므로
    **size = 단계 수면 전 단계가 정확히 한 번씩** 나온다(오늘 10단계 → size 10).
    ✅ **그 PM 판정이 났다(2026-08-12): `PLACEMENT_SIZE` 6 → 10.** 그래서 기본
    size에서 이 함수는 [1, 2, …, 10]을 낸다. 종전 기본값 6에서는 [1, 3, 5, 6, 8, 10]
    으로 결번이 4개 있었고, 못 본 단계는 배치 결과가 추정으로만 채웠다.
    size < 단계 수여도 양 끝과 중단은 표본에 들어가므로 이 함수 자체는 불변이다.

    반환은 오름차순(결정적)이고, 소비자가 슬롯 순서 그대로 쓴다. 신고 학령을
    인자로 받지 않는 것이 이 함수의 요점이다.
    """
    if size <= 0:
        return []
    low = weatherbrain_service.KNOWLEDGE_LEVEL_MIN
    high = weatherbrain_service.KNOWLEDGE_LEVEL_MAX
    span = max(size - 1, 1)
    return [round(low + (high - low) * slot / span) for slot in range(size)]


def target_group_sequence(level_group: str, size: int) -> list[str]:
    """size개 슬롯의 목표 level_group 시퀀스 — 인접 그룹 교차 배치 (§3.1).

    ⚠️ **선발 경로에서 내려왔다**(2026-08-12 — 모듈 독스트링). `plan_placement_picks`는
    이제 `target_level_sequence`(kl 축)를 쓴다. 이 함수는 밴드 인접 배분 규칙의
    기술로만 남으며, 값이 필요한 곳(문서·검증)이 계속 참조한다.

    인접 그룹(ADJACENT_GROUPS)에 균등 분배하고, 나머지는 신고 그룹 우선으로
    배분한다(결정적). 시퀀스는 난이도 오름차순으로 나열한다 — 소비자
    (plan_placement_picks)가 신고 그룹별 회전을 얹는다(§3.2 서로소 배치).
    예: middle_high·6 → [elementary×2, middle_high×2, adult×2],
        elementary·6 → [elementary×3, middle_high×3].
    """
    allowed = ADJACENT_GROUPS.get(level_group, (level_group,))
    base, remainder = divmod(size, len(allowed))
    counts = {group: base for group in allowed}
    bonus_order = [level_group] + [g for g in allowed if g != level_group]
    for group in bonus_order[:remainder]:
        counts[group] += 1
    return [group for group in allowed for _ in range(counts[group])]


def plan_placement_picks(
    candidates: Sequence[Any],
    level_group: str,
    size: int | None = None,
    concept_tags: Sequence[str] | None = None,
) -> list[dict[str, Any]]:
    """배치고사 배합 — 개념 커버리지 × **지식 단계 전 구간** (순수 함수, 2026-08-12).

    candidates: 후보 문항(concept_tag·knowledge_level·level_group·question_type·
    uses_live_slots 속성 — dict/ORM 겸용). 필터·정렬을 내부에서 수행하므로 입력
    순서와 무관하게 결정적이다(셀 내 정렬 키: (question_type, str(id)) —
    question_type 1차 키가 콘텐츠 기반이라 DB 재적재로 id(UUID)가 바뀌어도 셀 내
    순서가 유지된다).

    규칙:
    - question_type != 'board' 그리고 uses_live_slots == false 만 선발.
    - 개념당 1문항 × size개 (size > 개념 수면 개념을 라운드로빈 재순회).
    - 각 슬롯의 목표 **지식 단계**는 `target_level_sequence(size)` — 신고 학령을
      보지 않는다. 배치고사는 위치를 재는 자이므로 신고값에 따라 눈금이 달라지면
      안 된다(모듈 독스트링).
    - 목표 단계에 그 개념 문항이 없으면 **가장 가까운 단계**로 내려앉는다
      (|kl − 목표| 오름차순, 동률이면 쉬운 쪽). 고정 창으로 자르지 않는 것은 이
      저장소의 실측 관례다 — `curriculum_service.rank_by_knowledge_level`과 **같은
      키**를 쓰므로 강등 방향의 정의가 두 곳으로 갈리지 않는다.
      개념에 문항이 전혀 없으면 그 슬롯은 생략된다(size 미만 반환 가능).

    `level_group` 인자는 **선발에 쓰이지 않는다.** 남겨 둔 이유는 호출부·테스트가
    위치 인자로 넘기고 있고(시그니처 안정), 학령이 진단 경로의 다른 지점
    (`assemble_placement_responses`의 b 폴백 기본값)에서는 여전히 쓰이기 때문이다.

    반환: [{"item", "concept_tag", "level_group", "knowledge_level",
    "target_level"}]. `level_group`은 **선택된 문항의** 밴드이고(사전 b 산출에
    쓰인다 — 유저 축이 아니다), 종전의 `target_group`은 `target_level`로 바뀌었다.
    """
    size = size if size is not None else PLACEMENT_SIZE
    # 진단 도메인은 기상 6종(PLACEMENT_QUIZ_TAGS) — 12종 전체(CONCEPT_TAGS)는
    # θ 초기화용이라 여기 쓰면 6문항이 개념당 1을 만족할 수 없다(R12 §9 분리).
    concepts = list(concept_tags or weatherbrain_service.PLACEMENT_QUIZ_TAGS)

    # (concept, knowledge_level) 버킷 — 결정적 소비 순서로 정렬(콘텐츠 기반 키)
    buckets: dict[tuple[str, int], list[Any]] = defaultdict(list)
    for item in candidates:
        if _attr(item, "question_type") == "board":
            continue
        if _attr(item, "uses_live_slots"):
            continue
        buckets[(_attr(item, "concept_tag"), item_knowledge_level(item))].append(item)
    for bucket in buckets.values():
        bucket.sort(key=lambda it: (_attr(it, "question_type"), str(_attr(it, "id"))))

    def take(concept: str, target: int) -> Any | None:
        """목표 단계 → 가장 가까운 단계 순으로 그 개념의 문항 1건.

        동률에서 쉬운 쪽을 먼저 보는 2차 키는 `rank_by_knowledge_level`과 같다
        ("한 단계 위 문항은 못 풀어서 막고, 한 단계 아래는 쉬워도 가르친다").
        """
        levels = sorted(
            (
                level
                for (tag, level), bucket in buckets.items()
                if tag == concept and bucket
            ),
            key=lambda level: (abs(level - target), 0 if level <= target else 1),
        )
        return buckets[(concept, levels[0])].pop(0) if levels else None

    picks: list[dict[str, Any]] = []
    for slot, target in enumerate(target_level_sequence(size)):
        concept = concepts[slot % len(concepts)]
        item = take(concept, target)
        if item is None:
            logger.warning("placement 후보 없음 — 개념 %s 슬롯 생략", concept)
            continue
        picks.append(
            {
                "item": item,
                "concept_tag": concept,
                "level_group": _attr(item, "level_group"),
                "knowledge_level": item_knowledge_level(item),
                "target_level": target,
            }
        )
    return picks


def assemble_placement_responses(
    logs: Sequence[Any],
    calibrated_b: dict[Any, float],
    item_level_groups: dict[Any, str],
    default_level_group: str,
) -> dict[str, list[dict[str, Any]]]:
    """채점된 배치고사 quiz_logs → placement IRT 응답 조립 (순수 함수, §3.3).

    난이도 b 규칙: 보정값(item_params — 호출측이 _load_calibrated_b로 조회)이
    있으면 그 값, 없으면 그 문항 level_group의 사전 b(prior_item_b). 문항의
    level_group을 모르면(content_item_id 없음 등) 신고 그룹으로 폴백한다.
    변별도 a는 1.0 고정(2PL의 backend 측 콜드스타트 관례 — _assemble_responses 동일).

    반환: {concept_tag: [{"b": float, "a": 1.0, "correct": bool}]}.
    """
    by_concept: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for log in logs:
        is_correct = _attr(log, "is_correct")
        if is_correct is None:
            continue  # 미채점 로그는 표본이 아님
        item_id = _attr(log, "content_item_id")
        b = calibrated_b.get(item_id) if item_id is not None else None
        if b is None:
            # 사전 b는 weatherbrain_service 단일 소유 (ai-worker priors 미러,
            # 드리프트는 test_weatherbrain_contract가 감시)
            group = item_level_groups.get(item_id, default_level_group)
            b = weatherbrain_service.LEVEL_GROUP_ITEM_B.get(
                group, weatherbrain_service.DEFAULT_ITEM_B
            )
        by_concept[_attr(log, "concept_tag")].append(
            {"b": float(b), "a": 1.0, "correct": bool(is_correct)}
        )
    return dict(by_concept)


# ═══════════════════════════════════════════════════════════════
# DB·외부 서비스 결합부
# ═══════════════════════════════════════════════════════════════


async def _placement_pool(db: AsyncDBSession) -> list[ContentItem]:
    """배치고사 후보 풀 — active 전 level_group, board·live 슬롯 제외.

    level_group으로 좁히지 않는다. 종전 사유는 "교차 배치가 인접 그룹 문항을
    요구"였고, 2026-08-12 사양에서는 더 강해졌다 — **배합이 kl 전 구간(1~10)을
    표본으로 요구**하므로 밴드를 좁히면 진단이 원리적으로 그 구간을 못 본다.
    랜덤 정렬도 하지 않는다 — 진단은 결정적 선발이 계약(§3.1).
    """
    return list(
        (
            await db.execute(
                select(ContentItem).where(
                    ContentItem.status == "active",
                    ContentItem.question_type != "board",
                    ContentItem.uses_live_slots.is_(False),
                )
            )
        )
        .scalars()
        .all()
    )


async def create_placement_session(
    db: AsyncDBSession, user: User, today: date | None = None
) -> tuple[Session, list[dict[str, Any]]]:
    """배치고사 세션 발급 — mode='placement', unit_id=NULL (§3.1).

    sessions의 daily 부분 유니크 인덱스((user_id, session_date, mode) WHERE
    unit_id IS NULL)가 placement에도 그대로 적용되어 당일 멱등 발급을 보장한다
    (동시 발급 IntegrityError는 라우터가 재조회 — get_today_session 패턴).
    문항 풀이 비면 0문항 세션이 발급된다(데이터 저작 대기 — 유닛 세션 관례).
    """
    now = datetime.now(KST)
    today = today or now.date()
    today_str = now.strftime("%Y%m%d")

    candidates = await _placement_pool(db)
    picks = plan_placement_picks(candidates, user.level_group)

    entries: list[dict[str, Any]] = []
    for pick in picks:
        item: ContentItem = pick["item"]
        question = {
            **dict(item.template_json or {}),
            "concept_tag": item.concept_tag,
            "question_type": item.question_type,
            # 배치고사에도 **같은 배지가 뜬다**(2026-08-12). daily·유닛만 뚫고 여기를
            # 빼면 "왜 이 화면만 안 보이나"가 다시 나온다 — 한 홉만 잇고 완료라고
            # 부른 것이 오늘 반복해서 문제가 됐다.
            # ⚠️ 진단 중 난이도 노출이 자기검열(「어려우니 못 풀어도 돼」)을 낳아 θ를
            # 오염시킬 수 있다는 반론이 있다. 실운영 로그로 정답률이 단계별로
            # 꺾이는지 관찰하고, 문제가 보이면 여기서 빼는 것이 가장 싼 수정이다.
            "knowledge_level": getattr(item, "knowledge_level", None),
        }
        entries.append(
            {
                "question": question,
                "source": "bank",
                "slot_filled": False,
                "content_item_id": item.id,
                "level_group": item.level_group,
            }
        )

    session = Session(
        user_id=user.id,
        session_date=today,
        mode=MODE_PLACEMENT,
    )
    db.add(session)
    await db.flush()  # session.id 확보

    quiz_ids = await session_service.allocate_quiz_ids(
        db, user.id, today_str, len(entries)
    )
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

    session.recipe_json = {
        "kind": "placement",
        "items": [
            {
                "quiz_id": e["quiz_id"],
                "source": e["source"],
                "slot_filled": e["slot_filled"],
                "level_group": e["level_group"],
            }
            for e in entries
        ],
    }
    await db.flush()
    return session, entries


async def finalize_placement(
    db: AsyncDBSession, user: User, logs: Sequence[QuizLog]
) -> list[dict]:
    """배치고사 완료 처리 — 응답 조립 → 개인화 θ 배정 → 영속화 (§3.3).

    b는 보정값(item_params) 우선, 없으면 문항 level_group의 사전 b. ai-worker
    장애 시 사전 θ(가입 시드값)를 유지한 채 저장된 θ를 반환한다 — 완료 기록은
    라우터가 그대로 진행하므로 유저에게 재시도를 강요하지 않는다(§3.3).
    """
    item_ids: set[uuid.UUID] = {
        log.content_item_id for log in logs if log.content_item_id is not None
    }
    calibrated = await weatherbrain_service._load_calibrated_b(db, item_ids)

    item_level_groups: dict[uuid.UUID, str] = {}
    if item_ids:
        rows = (
            await db.execute(
                select(ContentItem.id, ContentItem.level_group).where(
                    ContentItem.id.in_(item_ids)
                )
            )
        ).all()
        item_level_groups = {cid: group for cid, group in rows}

    responses = assemble_placement_responses(
        logs, calibrated, item_level_groups, user.level_group
    )

    try:
        result = await ai_client.weatherbrain_placement(
            level_group=user.level_group,
            concept_tags=list(weatherbrain_service.CONCEPT_TAGS),
            placement_responses=responses,
        )
    except AIWorkerError:
        logger.warning(
            "weatherbrain placement(응답 결합) 실패 — 사전 θ 유지, 완료는 기록 (user=%s)",
            user.id,
        )
        return await weatherbrain_service.load_abilities(db, user)

    abilities = result.get("abilities", [])
    await weatherbrain_service._upsert_abilities(db, user, abilities)
    return abilities
