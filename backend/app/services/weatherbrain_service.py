"""WeatherBrain 서비스 (backend 소유) — IRT 능력 θ 조립·영속화.

무상태 계약: IRT 수학은 ai-worker(app/weatherbrain)가 소유하고, backend는 quiz_logs·
item_params에서 응답을 조립해 추정을 요청하고 결과를 user_concept_ability에 영속화한다.
ai-worker 장애 시에는 저장된 θ(또는 빈 결과)로 폴백하므로 세션 발급은 항상 진행된다
(ai_client.router_decide의 "general" 폴백과 동일한 복원력 원칙).

흐름:
  가입      → seed_placement: level_group 사전으로 개념별 초기 θ 배정(행 생성).
  세션 발급 → refresh_abilities: 누적 응답으로 θ 재추정·upsert 후 Router에 공급.
"""

from __future__ import annotations

import logging
import math
import uuid
from collections import defaultdict

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession as AsyncDBSession

from app.models.item_param import ItemParam
from app.models.quiz_log import QuizLog
from app.models.user import User
from app.models.user_concept_ability import UserConceptAbility
from app.services import ai_client
from app.services.ai_client import AIWorkerError

logger = logging.getLogger(__name__)

# 정본 개념 태그 — database/seed/content_items.json 과 일치(계약 테스트가 감시).
# 배치고사 6문항의 선별 도메인 — **기상 코스 6종만**(R12 §9 판정).
# CONCEPT_TAGS(아래, 12종)는 가입 시 θ를 초기화하는 전체 개념 목록이고, 배치 문항은
# PLACEMENT_SIZE=6으로 개념당 1을 만족해야 하므로 도메인을 기상 6종으로 한정한다.
# 기초과학 개념의 θ는 사전분포로 초기화되고 실제 응답으로 갱신된다(specs/11 §4).
PLACEMENT_QUIZ_TAGS: tuple[str, ...] = (
    "pressure_front",
    "typhoon",
    "air_mass",
    "heat_island",
    "co2_climate",
    "anomaly",
)

CONCEPT_TAGS: tuple[str, ...] = (
    "air_mass",
    "anomaly",
    "co2_climate",
    "heat_island",
    "pressure_front",
    "typhoon",
    # 기초과학 6종 (R12 §9 — specs/11 §4 판정: 배치가 bs 개념 θ도 초기화한다.
    # priors는 level_group 기반이라 태그 추가에 사전값 신설이 필요 없고,
    # θ가 코스를 가로지르는 단일 통화라는 §5.1.1 원칙이 여기서 성립한다)
    "temperature_heat",
    "radiation_budget",
    "pressure_basics",
    "phase_change",
    "density_buoyancy",
    "energy_transfer",
)

# θ → 사람이 읽는 난이도 라벨. 경계(-0.5, 0.5)는 ai-worker priors.theta_to_target_level_group
# 및 router_chain.THETA_FOCUS_THRESHOLD와 정합해야 한다(교차 서비스 의미론 — 계약 테스트가 감시).
_THETA_BEGINNER_MAX = -0.5
_THETA_INTERMEDIATE_MAX = 0.5


def _theta_bucket(theta: float, labels: tuple[str, str, str]) -> str:
    """θ 3구간 이산화 — 경계(-0.5, 0.5)는 하위 구간 제외·상위 구간 포함."""
    if theta < _THETA_BEGINNER_MAX:
        return labels[0]
    if theta < _THETA_INTERMEDIATE_MAX:
        return labels[1]
    return labels[2]


def theta_level_label(theta: float) -> str:
    """능력 θ를 초급/중급/고급 라벨로 이산화(표시용)."""
    return _theta_bucket(theta, ("beginner", "intermediate", "advanced"))


# ai-worker priors.LEVEL_GROUP_ITEM_B와 동일값의 backend 상수 — 뱅크 풀 정렬에서
# 보정 이력 없는 문항의 사전 난이도 b(coalesce 폴백 CASE)로 쓴다. backend는
# ai-worker를 임포트하지 않으므로 값을 여기 고정하고, 드리프트는
# test_weatherbrain_contract가 감시한다(교차 서비스 상수 이원화 관례).
LEVEL_GROUP_ITEM_B: dict[str, float] = {
    "elementary": -1.0,
    "middle_high": 0.0,
    "adult": 1.0,
}
# 미지 level_group 방어값 (ai-worker priors._DEFAULT_ITEM_B와 동일 — 중립).
DEFAULT_ITEM_B: float = 0.0

# 약점 판정 기대확률 계약 (R8-01 §3.5) — "학령 표준 문항(사전 b)을 맞힐 기대확률
# P = σ(θ − b)가 이 값 미만"이면 약점. 구 weak_tags의 정답률 60% 임계와 수치는
# 같지만 등가가 아니다 — P는 학령 사전 b에 상대적이므로 임계 θ가 학령별로 다르다.
WEAK_EXPECTED_P: float = 0.6


def weak_theta_threshold(level_group: str) -> float:
    """학령 상대 약점 θ 임계 (R8-01 §3.5) — 단일 공급원.

    P(정답) = σ(θ − b) < WEAK_EXPECTED_P  ⟺  θ < b(lg) + logit(WEAK_EXPECTED_P).
    b(lg)는 LEVEL_GROUP_ITEM_B 사전값(미지 학령은 DEFAULT_ITEM_B),
    logit(0.6) = ln(0.6/0.4) ≈ 0.405. 수치는 계약 테스트가 고정한다.
    """
    prior_b = LEVEL_GROUP_ITEM_B.get(level_group, DEFAULT_ITEM_B)
    return prior_b + math.log(WEAK_EXPECTED_P / (1.0 - WEAK_EXPECTED_P))


def weak_concepts(abilities: list, level_group: str) -> list[str]:
    """θ 파생 약점 개념 목록 (R8-01 §3.5) — weak 판정의 단일 공급원.

    num_responses > 0 AND θ < weak_theta_threshold(level_group).
    n=0(placement 사전값뿐)은 제외 — "한 번도 안 푼 태그는 약점 아님" 의미론 유지.
    abilities 원소는 load/refresh_abilities 반환 형식
    ({"concept_tag", "theta", "se", "n"}), 순서는 입력 순서를 보존한다.
    """
    threshold = weak_theta_threshold(level_group)
    return [
        ab["concept_tag"]
        for ab in abilities
        if int(ab["n"]) > 0 and float(ab["theta"]) < threshold
    ]


def theta_to_level_group(theta: float) -> str:
    """추정 θ → 출제 난이도 level_group (R7 §3.2 — θ→출제 난이도 연결).

    ai-worker priors.theta_to_target_level_group과 동일 의미·동일 경계.
    동일성은 계약 테스트가 감시한다.
    """
    return _theta_bucket(theta, ("elementary", "middle_high", "adult"))


def overall_theta(
    abilities: list, target_concept_tag: str | None = None
) -> float | None:
    """출제 난이도 산출용 대표 θ (R7 §3.2).

    - target_concept_tag가 지정되고 그 개념의 θ가 있으면 그 값(route 목표 개념 우선)
    - 아니면 num_responses(n) 가중 평균 — 전부 n=0이면 단순 평균
    - abilities가 비면 None (콜드스타트 — 소비자가 user.level_group으로 폴백)

    abilities 원소는 refresh_abilities 반환 형식
    ({"concept_tag", "theta", "se", "n"})과 동일하다.
    """
    if not abilities:
        return None
    if target_concept_tag is not None:
        for ab in abilities:
            if ab["concept_tag"] == target_concept_tag:
                return float(ab["theta"])
    total_n = sum(int(ab["n"]) for ab in abilities)
    if total_n <= 0:
        return sum(float(ab["theta"]) for ab in abilities) / len(abilities)
    return (
        sum(float(ab["theta"]) * int(ab["n"]) for ab in abilities) / total_n
    )


async def _load_calibrated_b(
    db: AsyncDBSession, content_item_ids: set[uuid.UUID]
) -> dict[uuid.UUID, float]:
    """보정 이력이 있는 문항의 난이도 b 조회 (없으면 소비자가 사전값 폴백)."""
    if not content_item_ids:
        return {}
    rows = (
        await db.execute(
            select(ItemParam.content_item_id, ItemParam.b).where(
                ItemParam.content_item_id.in_(content_item_ids)
            )
        )
    ).all()
    return {cid: b for cid, b in rows}


async def _assemble_responses(
    db: AsyncDBSession, user: User
) -> dict[str, list[dict]]:
    """채점된 quiz_logs를 개념별 IRT 응답으로 조립한다.

    각 응답의 난이도 b는 보정값(item_params)이 있으면 그 값, 없으면 None을 보낸다
    (ai-worker가 level_group 사전 난이도로 대체 — 사전값 단일 소유 유지).
    """
    rows = (
        await db.execute(
            select(
                QuizLog.concept_tag, QuizLog.content_item_id, QuizLog.is_correct
            ).where(QuizLog.user_id == user.id, QuizLog.is_correct.is_not(None))
        )
    ).all()
    if not rows:
        return {}

    item_ids = {cid for _, cid, _ in rows if cid is not None}
    calibrated = await _load_calibrated_b(db, item_ids)

    by_concept: dict[str, list[dict]] = defaultdict(list)
    for concept_tag, content_item_id, is_correct in rows:
        b = calibrated.get(content_item_id) if content_item_id is not None else None
        by_concept[concept_tag].append(
            {"b": b, "a": 1.0, "correct": bool(is_correct)}
        )
    return dict(by_concept)


async def _upsert_abilities(
    db: AsyncDBSession, user: User, abilities: list[dict]
) -> None:
    """추정 θ를 user_concept_ability에 upsert (weak_tags upsert 패턴 복제)."""
    for ab in abilities:
        stmt = pg_insert(UserConceptAbility).values(
            user_id=user.id,
            concept_tag=ab["concept_tag"],
            theta=ab["theta"],
            theta_se=ab["se"],
            num_responses=ab["n"],
        ).on_conflict_do_update(
            constraint="uq_user_concept_ability_user_concept",
            set_={
                "theta": ab["theta"],
                "theta_se": ab["se"],
                "num_responses": ab["n"],
                "updated_at": text("now()"),
            },
        )
        await db.execute(stmt)


async def load_abilities(db: AsyncDBSession, user: User) -> list[dict]:
    """저장된 개념별 θ 조회 (Router 공급 형식). ai-worker 미호출."""
    rows = (
        await db.execute(
            select(
                UserConceptAbility.concept_tag,
                UserConceptAbility.theta,
                UserConceptAbility.theta_se,
                UserConceptAbility.num_responses,
            ).where(UserConceptAbility.user_id == user.id)
        )
    ).all()
    return [
        {"concept_tag": c, "theta": float(t), "se": float(se), "n": int(n)}
        for c, t, se, n in rows
    ]


async def refresh_abilities(db: AsyncDBSession, user: User) -> list[dict]:
    """누적 응답으로 θ를 재추정·영속화하고 Router 공급용 리스트를 반환한다.

    ai-worker 실패 시 저장된 θ로 폴백(세션 발급은 계속 진행). 응답이 없으면
    저장된 θ(placement 사전값 포함)를 그대로 반환한다.
    """
    by_concept = await _assemble_responses(db, user)
    if not by_concept:
        return await load_abilities(db, user)

    concepts_payload = [
        {"concept_tag": tag, "responses": resp} for tag, resp in by_concept.items()
    ]
    try:
        result = await ai_client.weatherbrain_estimate(
            level_group=user.level_group, concepts=concepts_payload
        )
    except AIWorkerError:
        logger.warning("weatherbrain estimate 실패 — 저장된 θ로 폴백 (user=%s)", user.id)
        return await load_abilities(db, user)

    abilities = result.get("abilities", [])
    await _upsert_abilities(db, user, abilities)
    return abilities


async def seed_placement(db: AsyncDBSession, user: User) -> list[dict]:
    """가입 직후 초기 난이도 배정 — level_group 사전으로 개념별 θ 행 생성.

    ai-worker placement(사전만) 호출 후 upsert. 실패해도 가입은 성공해야 하므로
    조용히 넘어간다(이후 세션 발급의 refresh_abilities가 사전값을 다시 채운다).
    """
    try:
        result = await ai_client.weatherbrain_placement(
            level_group=user.level_group, concept_tags=list(CONCEPT_TAGS)
        )
    except AIWorkerError:
        logger.warning("weatherbrain placement 실패 — 가입은 진행 (user=%s)", user.id)
        return []

    abilities = result.get("abilities", [])
    await _upsert_abilities(db, user, abilities)
    return abilities
