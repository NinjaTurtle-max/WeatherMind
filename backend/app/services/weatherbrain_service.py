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
    # 재난 축 2종 (R13 §2.4 — 산불 기상·홍수 대응). θ 초기화 대상에는 넣되
    # PLACEMENT_QUIZ_TAGS(위)에는 넣지 않는다: 배치 6문항이 "개념당 1"을 만족해야
    # 하므로 진단 도메인은 기상 6종으로 고정한다(R12 §9 판정 준용).
    "wildfire_weather",
    "flood_response",
)

# ── 학령 밴드(level_group)와 θ 경계 — backend 단일 공급원 (R13 §2.2) ──────────
# 밴드는 난이도 오름차순, 경계는 **인접 밴드 사전평균의 중점**이다:
#   elementary −1.0 · middle_high 0.0 · adult 1.0 · expert 2.0
#   → 경계 −0.5 · 0.5 · 1.5
# 이 규칙(중점)은 R7부터의 기존 경계 −0.5·0.5를 그대로 재생산하므로, expert 추가가
# 기존 3밴드의 판정을 한 건도 바꾸지 않는다(순수 확장). ai-worker
# priors.LEVEL_GROUP_BANDS·THETA_BAND_BOUNDS와 값이 같아야 하고 드리프트는
# test_weatherbrain_contract가 감시한다. 하단 경계 −0.5는 router_chain.
# THETA_FOCUS_THRESHOLD와도 같은 값이어야 한다(교차 서비스 의미론).
#
# 주의: placement_service.LEVEL_GROUPS(3종)와 다른 상수다 — 배치고사 진단 도메인은
# 6문항·서로소 계약 때문에 3밴드로 고정한다(R12의 PLACEMENT_QUIZ_TAGS 분리와 동일 취지).
LEVEL_GROUP_BANDS: tuple[str, ...] = (
    "elementary",
    "middle_high",
    "adult",
    "expert",
)
THETA_BAND_BOUNDS: tuple[float, ...] = (-0.5, 0.5, 1.5)
# 표시용 라벨(밴드와 1:1, 같은 순서).
THETA_BAND_LABELS: tuple[str, ...] = (
    "beginner",
    "intermediate",
    "advanced",
    "expert",
)

# 기존 이름 유지(계약 테스트·독자 참조) — 경계 튜플에서 파생하므로 이원 정의가 아니다.
_THETA_BEGINNER_MAX = THETA_BAND_BOUNDS[0]
_THETA_INTERMEDIATE_MAX = THETA_BAND_BOUNDS[1]
_THETA_ADVANCED_MAX = THETA_BAND_BOUNDS[2]


def _theta_bucket(theta: float, labels: tuple[str, ...]) -> str:
    """θ 밴드 이산화 — 경계는 하위 밴드 제외·상위 밴드 포함(< 비교).

    labels는 THETA_BAND_BOUNDS보다 정확히 1개 많아야 한다(밴드 수 = 경계 수 + 1).
    """
    for bound, label in zip(THETA_BAND_BOUNDS, labels):
        if theta < bound:
            return label
    return labels[-1]


def theta_level_label(theta: float) -> str:
    """능력 θ를 초급/중급/고급/전문가 라벨로 이산화(표시용)."""
    return _theta_bucket(theta, THETA_BAND_LABELS)


# ai-worker priors.LEVEL_GROUP_ITEM_B와 동일값의 backend 상수 — 뱅크 풀 정렬에서
# 보정 이력 없는 문항의 사전 난이도 b(coalesce 폴백 CASE)로 쓴다. backend는
# ai-worker를 임포트하지 않으므로 값을 여기 고정하고, 드리프트는
# test_weatherbrain_contract가 감시한다(교차 서비스 상수 이원화 관례).
LEVEL_GROUP_ITEM_B: dict[str, float] = {
    "elementary": -1.0,
    "middle_high": 0.0,
    "adult": 1.0,
    # R13 §2.2 전문가 밴드 — 사전평균과 같은 값(로짓 정합: 밴드 내 기대 정답확률 0.5).
    "expert": 2.0,
}
# 미지 level_group 방어값 (ai-worker priors._DEFAULT_ITEM_B와 동일 — 중립).
DEFAULT_ITEM_B: float = 0.0

# ── 2축 분리: 지식 수준(난이도) · 표현 톤(말투) — R13-0 §1 ────────────────────
# `level_group` 하나가 겸하던 두 일을 가른다. 단계 정의값의 SSOT는 CU-1의 교육과정
# 조사(docs/specs/12_curriculum_levels.md)이고, 아래 표는 그 문서 **§5.3 파생 뷰
# 정의표를 코드로 옮긴 것**이다(골격 착지 시점의 초안을 2026-08-07 정정 — 초안은
# 3→middle_high·4→adult로 중학 유체 지구 영역을 성인 밴드에 붙여 놓았었다).
#
# 단계 수 N을 코드 어디에도 박지 않는다 — N은 오직 아래 튜플의 길이에서 나온다.
# 조사가 단계 수를 6→7로 바꿔도 이 튜플 한 줄만 고치면 되고, DB DDL은 열지 않는다
# (마이그레이션 0012가 knowledge_level에 상한 제약을 걸지 않은 이유).
#
# 색인 i(0-based)의 값 = 지식 수준 (KNOWLEDGE_LEVEL_MIN + i) 이 파생하는 학령 밴드.
# 밴드는 난이도 오름차순이어야 하고(LEVEL_GROUP_BANDS 순서), 모든 밴드가 최소 한 번
# 나와야 한다(그래야 level_group→knowledge_level→level_group 왕복이 항등이다).
# 두 성질 모두 test_two_axis_levels가 감시한다.
KNOWLEDGE_LEVEL_BANDS: tuple[str, ...] = (
    "elementary",   # 1 — 초등 3~4학년군
    "elementary",   # 2 — 초등 5~6학년군
    "middle_high",  # 3 — 중학교 과학 물질·에너지 영역
    "middle_high",  # 4 — 중학교 과학 유체 지구 영역
    "adult",        # 5 — 고교 정성 구간
    "expert",       # 6 — 힘·정량 구간 + 교육과정 밖
)
KNOWLEDGE_LEVEL_MIN: int = 1
KNOWLEDGE_LEVEL_MAX: int = KNOWLEDGE_LEVEL_MIN + len(KNOWLEDGE_LEVEL_BANDS) - 1

# 무정보 기본값 밴드 — routers.auth.GUEST_LEVEL_GROUP과 같은 값이어야 한다
# (게스트·미지 값이 같은 자리로 떨어져야 파생 결과가 갈라지지 않는다).
NEUTRAL_LEVEL_GROUP: str = "middle_high"

# 표현 톤 — 가입 신고값(users.tone). 지식 수준과 달리 조사 대상이 아니라 설계로
# 고정된 3종이다(§1 표: 어린이·청소년·성인).
TONES: tuple[str, ...] = ("child", "teen", "adult")
# users.tone이 NULL(미신고)일 때의 파생표 — 기존 level_group 신고값에서 톤을 읽는다.
# expert는 신고 학령이 아니지만(§5) 방어적으로 성인 톤에 붙인다.
LEVEL_GROUP_TONE: dict[str, str] = {
    "elementary": "child",
    "middle_high": "teen",
    "adult": "adult",
    "expert": "adult",
}


def level_group_of_knowledge_level(level: int) -> str:
    """지식 수준(1~N) → 학령 밴드 — **하위 호환 파생 뷰**의 핵심.

    범위 밖 값은 양 끝으로 클램프한다(미지 값에 중립 폴백을 주는 DEFAULT_ITEM_B
    관례). 상한을 DB가 아니라 여기서 보기 때문에 방어가 필요하다.
    """
    index = int(level) - KNOWLEDGE_LEVEL_MIN
    index = max(0, min(index, len(KNOWLEDGE_LEVEL_BANDS) - 1))
    return KNOWLEDGE_LEVEL_BANDS[index]


def knowledge_level_of_level_group(level_group: str) -> int:
    """학령 밴드 → 지식 수준 대표값 — knowledge_level이 NULL(미분류)일 때의 폴백.

    한 밴드가 여러 단계에 걸치므로 대표값이 필요하다. **밴드의 최하 단계**를 쓴다:
    미분류 문항을 실제보다 어렵게 보지 않는 쪽이 안전하고(과대평가는 학습자를
    막는다), 이 선택이 밴드→단계→밴드 왕복을 항등으로 만든다.
    미지 밴드는 표 중앙(무정보 기본값 — DEFAULT_ITEM_B 중립 관례).
    """
    if level_group in KNOWLEDGE_LEVEL_BANDS:
        return KNOWLEDGE_LEVEL_MIN + KNOWLEDGE_LEVEL_BANDS.index(level_group)
    return (KNOWLEDGE_LEVEL_MIN + KNOWLEDGE_LEVEL_MAX) // 2


def effective_knowledge_level(item) -> int:
    """문항의 지식 수준 — NULL(미분류)이면 level_group에서 파생 (0012 폴백 계약).

    weather_api.user_region과 같은 방어 관례: 속성이 없는 대역(SimpleNamespace
    스텁)도 폴백 경로로 떨어진다.
    """
    level = getattr(item, "knowledge_level", None)
    if level is None:
        return knowledge_level_of_level_group(getattr(item, "level_group", None))
    return int(level)


def effective_level_group(item) -> str:
    """문항의 학령 밴드 — **하위 호환 파생 뷰**(R13-0 §3.1-2).

    knowledge_level이 있으면 새 축에서 파생하고, 미분류(NULL)면 **저장된
    level_group을 그대로** 돌려준다. 후자를 정규화하지 않는 것이 요점이다 —
    기존 소비처(pool_level_groups·placement_service·저작 검증기)가 오늘 보는 값과
    한 글자도 달라지지 않아야 이 뷰가 무해한 추가가 된다.
    """
    level = getattr(item, "knowledge_level", None)
    if level is None:
        return getattr(item, "level_group", None)
    return level_group_of_knowledge_level(level)


def effective_tone(user) -> str:
    """사용자의 표현 톤 — NULL(미신고)이면 level_group에서 파생 (0012 폴백 계약).

    저장값이 톤 어휘 밖이면(과거 데이터·수동 조작) 파생 경로로 방어한다
    (weather_api.user_region의 화이트리스트 방어와 같은 취지).
    """
    tone = getattr(user, "tone", None)
    if tone in TONES:
        return tone
    return LEVEL_GROUP_TONE.get(
        getattr(user, "level_group", None), LEVEL_GROUP_TONE[NEUTRAL_LEVEL_GROUP]
    )

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
    return _theta_bucket(theta, LEVEL_GROUP_BANDS)


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
