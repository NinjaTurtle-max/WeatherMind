"""배치고사(진단 퀴즈) 서비스 — 스프린트 R7-01 §3.1·§3.3.

온보딩에서 개념 커버리지(CONCEPT_TAGS 6개념당 1문항) × 난이도 교차 배치(신고
level_group의 인접 그룹 분산)로 6문항을 뽑아 mode='placement' 세션을 발급하고,
완료 시 응답을 IRT 형식으로 조립해 ai-worker placement(사전+응답 결합 EAP)로
개인화된 초기 θ를 배정한다.

서로소 배치(R7-02 §3.2): 신고 그룹이 달라도 같은 문항이 겹치지 않도록
(1) 목표 그룹 시퀀스를 신고 그룹별로 회전(k = 그룹 순위×2 % size)해 개념→목표
그룹 매핑을 분산하고, (2) 셀((개념, 그룹) 버킷) 안에서도 그룹 순위 오프셋
(rank % len)으로 서로 다른 문항을 집게 한다. 실 시드 기준 세 신고 그룹의 픽이
쌍별 교집합 0 — test_placement의 실 시드 계약 테스트가 감시한다.

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
ADJACENT_GROUPS: dict[str, tuple[str, ...]] = {
    "elementary": ("elementary", "middle_high"),
    "middle_high": ("elementary", "middle_high", "adult"),
    "adult": ("middle_high", "adult"),
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


def _group_rank(group: str) -> int:
    """level_group 정렬 키이자 서로소 배치의 회전·오프셋 순위 (미지 그룹은 맨 뒤)."""
    return LEVEL_GROUPS.index(group) if group in LEVEL_GROUPS else len(LEVEL_GROUPS)


def target_group_sequence(level_group: str, size: int) -> list[str]:
    """size개 슬롯의 목표 level_group 시퀀스 — 인접 그룹 교차 배치 (§3.1).

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
    """배치고사 배합 — 개념 커버리지 × 난이도 교차 × 서로소 배치 (순수 함수, §3.1·§3.2).

    candidates: 후보 문항(concept_tag·level_group·question_type·uses_live_slots
    속성 — dict/ORM 겸용). 필터·정렬을 내부에서 수행하므로 입력 순서와 무관하게
    결정적이다(정렬 키: 그룹 난이도 순 → (question_type, str(id)) — question_type
    1차 키가 콘텐츠 기반이라 DB 재적재로 id(UUID)가 바뀌어도 셀 내 순서가 유지된다).

    규칙:
    - question_type != 'board' 그리고 uses_live_slots == false 만 선발.
    - 개념당 1문항 × size개 (size > 개념 수면 개념을 라운드로빈 재순회).
    - 각 슬롯의 목표 그룹은 target_group_sequence를 신고 그룹별로
      k = _group_rank(level_group)*2 % size 만큼 회전한 시퀀스 — 신고 그룹이
      달라지면 개념→목표 그룹 매핑이 어긋나 그룹 간 픽이 서로소가 된다(§3.2).
    - 셀 내 선택도 그룹 순위 오프셋(rank % len(bucket))으로 — 두 신고 그룹이
      같은 셀을 겨냥해도 서로 다른 문항을 집는다.
    - 목표 그룹에 그 개념 문항이 없으면 신고 그룹 폴백, 그래도 없으면 남은 그룹을
      난이도 오름차순으로 폴백(개념 커버리지 > 그룹 배치 우선순위).
      개념에 문항이 전혀 없으면 그 슬롯은 생략된다(size 미만 반환 가능).

    반환: [{"item", "concept_tag", "level_group", "target_group"}].
    """
    size = size if size is not None else PLACEMENT_SIZE
    # 진단 도메인은 기상 6종(PLACEMENT_QUIZ_TAGS) — 12종 전체(CONCEPT_TAGS)는
    # θ 초기화용이라 여기 쓰면 6문항이 개념당 1을 만족할 수 없다(R12 §9 분리).
    concepts = list(concept_tags or weatherbrain_service.PLACEMENT_QUIZ_TAGS)
    rank = _group_rank(level_group)

    # (concept, group) 버킷 — 결정적 소비 순서로 정렬(콘텐츠 기반 키)
    buckets: dict[tuple[str, str], list[Any]] = defaultdict(list)
    for item in candidates:
        if _attr(item, "question_type") == "board":
            continue
        if _attr(item, "uses_live_slots"):
            continue
        key = (_attr(item, "concept_tag"), _attr(item, "level_group"))
        buckets[key].append(item)
    for bucket in buckets.values():
        bucket.sort(key=lambda it: (_attr(it, "question_type"), str(_attr(it, "id"))))

    def take(concept: str, group: str) -> Any | None:
        bucket = buckets.get((concept, group))
        # 신고 그룹 순위 오프셋 — 같은 셀에서도 그룹마다 다른 문항 (§3.2 서로소)
        return bucket.pop(rank % len(bucket)) if bucket else None

    group_seq = target_group_sequence(level_group, size)
    # 신고 그룹별 회전(§3.2) — 배합비(그룹별 문항 수)는 순열이라 불변이고,
    # 개념(슬롯 위치 고정)→목표 그룹 매핑만 그룹마다 어긋난다.
    if group_seq:
        k = rank * 2 % len(group_seq)
        group_seq = group_seq[k:] + group_seq[:k]
    picks: list[dict[str, Any]] = []
    for slot, target in enumerate(group_seq):
        concept = concepts[slot % len(concepts)]
        # 목표 그룹 → 신고 그룹 → 남은 그룹(난이도 오름차순) 순 폴백
        fallback = [g for g in LEVEL_GROUPS if g not in (target, level_group)]
        item = None
        for group in [target, level_group, *fallback]:
            item = take(concept, group)
            if item is not None:
                break
        if item is None:
            logger.warning("placement 후보 없음 — 개념 %s 슬롯 생략", concept)
            continue
        picks.append(
            {
                "item": item,
                "concept_tag": concept,
                "level_group": _attr(item, "level_group"),
                "target_group": target,
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

    daily 풀과 달리 level_group을 신고 그룹으로 좁히지 않는다(교차 배치가 인접
    그룹 문항을 요구). 랜덤 정렬도 하지 않는다 — 진단은 결정적 선발이 계약(§3.1).
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
