"""WeatherBrain 서비스 (backend 소유) — IRT 능력 θ 조립·영속화.

무상태 계약: IRT 수학은 ai-worker(app/weatherbrain)가 소유하고, backend는 quiz_logs·
item_params에서 응답을 조립해 추정을 요청하고 결과를 user_concept_ability에 영속화한다.
ai-worker 장애 시에는 저장된 θ(또는 빈 결과)로 폴백하므로 세션 발급은 항상 진행된다
(ai_client.router_decide의 "general" 폴백과 동일한 복원력 원칙).

흐름:
  가입      → seed_placement: level_group 사전으로 개념별 초기 θ 배정(행 생성).
  학령 재신고 → reseed_unmeasured_priors: **아직 측정되지 않은 개념(n=0)만** 새
                밴드 사전값으로 갈아탄다 — 측정된 행은 데이터가 이긴다.
  세션 발급 → refresh_abilities: 누적 응답으로 θ 재추정·upsert 후 Router에 공급.
  숙련 조회 → load_mastery: quiz_logs 시퀀스로 BKT P(숙련) 파생(저장 없음, R13 §5-1).
"""

from __future__ import annotations

import logging
import math
import uuid
from collections import defaultdict
from collections.abc import Sequence
from typing import Any

from sqlalchemy import case, func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession as AsyncDBSession

from app.models.content_item import ContentItem
from app.models.item_param import ItemParam
from app.models.quiz_log import QuizLog
from app.models.user import User
from app.models.user_concept_ability import UserConceptAbility
from app.services import ai_client
from app.services.ai_client import AIWorkerError

logger = logging.getLogger(__name__)

# 정본 개념 태그 — database/seed/content_items.json 과 일치(계약 테스트가 감시).
# 배치고사의 선별 도메인 — **기상 코스 6종만**(R12 §9 판정).
# CONCEPT_TAGS(아래, 12종)는 가입 시 θ를 초기화하는 전체 개념 목록이다.
# ⚠️ **근거가 바뀌었다**(2026-08-12 PM 판정 `PLACEMENT_SIZE` 6 → 10):
# 종전 근거는 "PLACEMENT_SIZE=6으로 개념당 1을 만족해야 한다"였는데, 슬롯이 10칸이
# 되면서 「개념당 1」은 성립하지 않는다 — 슬롯은 지식 단계 1~10을 겨냥하고
# (`placement_service.target_level_sequence`) 개념은 이 6종을 **순환**한다.
# 도메인을 6종으로 유지하는 근거는 이제 「진단은 기상 코스만 잰다」(R12 §9)뿐이다.
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
# test_weatherbrain_contract가 감시한다.
#
# ⚠️ R13 CO-U-3: 하단 경계 −0.5가 router_chain.THETA_FOCUS_THRESHOLD와 "같은 값"인
# 것은 **middle_high 학습자에 한해서만** 옳다. 그 등식을 전 학령에 적용하면 판정이
# 의도와 반대로 뒤집힌다 — 아래 THETA_FOCUS_DELTA 주석 참조.
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
# ── 6 → 10단계 확장 (2026-08-10, R13-02 T2) ──────────────────────────────────
# 위 문단이 "조사가 단계 수를 바꿔도 이 튜플 한 줄만 고치면 된다"고 적어 둔 그 일이
# 실제로 일어났다. 확장 이유는 **상단이 뭉쳐 있었기 때문**이다 — 종전 6단계는
# 고교 전체가 5 하나, 진로선택부터 학부·실무 전부가 6 하나였다. 대학 전공까지
# 정박하려면 그 두 칸을 갈라야 한다.
#
# **하단 1~4는 한 칸도 건드리지 않았다.** 초·중등 성취기준 매핑은 이미 조사로
# 확정된 것이고, 건드리면 문항 190건이 전부 재분류 대상이 된다. 실제 재분류는
# 종전 5·6에 있던 **94건뿐**이다.
KNOWLEDGE_LEVEL_BANDS: tuple[str, ...] = (
    "elementary",   # 1 — 초등 3~4학년군
    "elementary",   # 2 — 초등 5~6학년군
    "middle_high",  # 3 — 중학교 과학 물질·에너지 영역
    "middle_high",  # 4 — 중학교 과학 유체 지구 영역
    "adult",        # 5 — 고1 통합과학 — 지구 규모 순환·기후를 정성적으로 종합
    "adult",        # 6 — 고2~3 일반선택(지구과학·기후변화와 환경생태) 정성 심화
    "expert",       # 7 — 고 진로선택 정량 입문 `[12지시…]` — 힘·감률이 처음 나온다
    "expert",       # 8 — 학부 대기과학 역학 기초(지균·정역학 균형)
    "expert",       # 9 — 학부 고학년 종관·수치예보 정량
    "expert",       # 10 — 기상청 현업 실무·연구 — 교육과정 밖
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
    미지 밴드는 **NEUTRAL_LEVEL_GROUP의 최하 단계**다(무정보 기본값 —
    DEFAULT_ITEM_B 중립 관례).

    ⚠️ 종전에는 `(MIN + MAX) // 2` 산술 중앙이었고 6단계에서 우연히 3(=중학)이라
    맞아 보였다. **10단계 확장에서 그 값이 5(=고교)로 조용히 올라간다** — 학령을
    모르는 학습자 전원이 갑자기 고교 문항을 받는다는 뜻이고, 같은 파일이
    `NEUTRAL_LEVEL_GROUP = "middle_high"`라고 못박은 것과도 어긋난다. 단계 수에
    따라 중립값이 움직이는 것 자체가 결함이었다(2026-08-10 정정).
    """
    if level_group in KNOWLEDGE_LEVEL_BANDS:
        return KNOWLEDGE_LEVEL_MIN + KNOWLEDGE_LEVEL_BANDS.index(level_group)
    return KNOWLEDGE_LEVEL_MIN + KNOWLEDGE_LEVEL_BANDS.index(NEUTRAL_LEVEL_GROUP)


# ── θ → 지식 수준(N단계) — R13 E-1 ─────────────────────────────────────────
# `THETA_BAND_BOUNDS`(4밴드)는 **건드리지 않는다**: 그 값을 단정하는 계약 테스트가
# 여러 파일에 있고, 4밴드는 라벨·라우터·출제 풀이 공유하는 기존 축이다. 대신 같은
# 축을 더 잘게 나눈 경계를 **파생**한다 — N단계를 4밴드로 접으면 기존 경계가 그대로
# 나와야 한다(정합 조건, test_weatherbrain_contract가 감시).
#
# 파생 규칙: 한 밴드가 k개 단계를 담으면 그 밴드의 **명목 구간**을 k등분한다.
# 명목 구간은 내부 경계가 THETA_BAND_BOUNDS 그대로이고 바깥 끝(−∞·+∞)만 밴드 폭
# 만큼 닫은 것이다(밴드 폭 = 경계 간격 = 인접 사전평균 차 1.0). 현재 표에서는
#   elementary [−1.5, −0.5] ÷2 → −1.0 · middle_high [−0.5, 0.5] ÷2 → 0.0
#   adult [0.5, 1.5] ÷1 · expert [1.5, 2.5] ÷1 → 내부 분할 없음
#   ⇒ (−1.0, −0.5, 0.0, 0.5, 1.5)  (경계 5 = 단계 6 − 1)
# 2단계 밴드의 분할점이 그 밴드의 θ 사전평균과 같아지는 것은 우연이 아니다 —
# 명목 구간이 사전평균 중심 ±반칸이기 때문이다(LEVEL_GROUP_ITEM_B와 정합).
#
# 단계 수 N을 여기 박지 않는다 — 전부 KNOWLEDGE_LEVEL_BANDS 길이에서 나온다
# (이 파일 상단의 "N은 오직 튜플 길이에서 나온다" 원칙).
def _derive_knowledge_level_bounds() -> tuple[float, ...]:
    """KNOWLEDGE_LEVEL_BANDS × THETA_BAND_BOUNDS → 단계 경계 (모듈 로드 시 1회)."""
    span = (
        THETA_BAND_BOUNDS[1] - THETA_BAND_BOUNDS[0]
        if len(THETA_BAND_BOUNDS) >= 2
        else 1.0
    )
    bounds: list[float] = []
    for index, band in enumerate(LEVEL_GROUP_BANDS):
        lo = THETA_BAND_BOUNDS[index - 1] if index > 0 else THETA_BAND_BOUNDS[0] - span
        hi = (
            THETA_BAND_BOUNDS[index]
            if index < len(THETA_BAND_BOUNDS)
            else THETA_BAND_BOUNDS[-1] + span
        )
        steps = KNOWLEDGE_LEVEL_BANDS.count(band)
        bounds.extend(lo + (hi - lo) * step / steps for step in range(1, steps))
        if index < len(LEVEL_GROUP_BANDS) - 1:
            bounds.append(hi)
    return tuple(bounds)


THETA_KNOWLEDGE_LEVEL_BOUNDS: tuple[float, ...] = _derive_knowledge_level_bounds()


def theta_to_knowledge_level(theta: float) -> int:
    """추정 θ → 지식 수준(KNOWLEDGE_LEVEL_MIN..MAX) — 출제 난이도의 N단계 해상도.

    theta_to_level_group과 **같은 축의 더 잘게 나눈 뷰**다. 모든 θ에서
    `level_group_of_knowledge_level(theta_to_knowledge_level(θ))
     == theta_to_level_group(θ)`가 성립한다(계약 테스트가 감시) — 즉 이 함수를
    쓰는 소비자와 기존 4밴드 소비자가 서로 다른 난이도를 보지 않는다.
    경계는 하위 단계 제외·상위 단계 포함(< 비교 — _theta_bucket과 같은 관례).
    """
    for index, bound in enumerate(THETA_KNOWLEDGE_LEVEL_BOUNDS):
        if theta < bound:
            return KNOWLEDGE_LEVEL_MIN + index
    return KNOWLEDGE_LEVEL_MAX


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
#
# ⚠️ R13 CO-U-2까지 이 문장은 **함수 경계에서만 참**이었다: 조립기가 미보정 문항의 b를
# 유저 사전 b로 채우는 바람에 θ̂ = 사전평균 + f(k,n)이 되어 임계의 사전 b가 양변에서
# 소거됐고, 세 학령 판정이 완전히 동일(= 정답률 60% 등가)했다. CO-U-1이 문항 b를
# 넣도록 고쳐 문장이 사실이 됐다 — 합성 수준의 증명은
# test_weatherbrain_theta_pipeline.TestWeakVerdictIsLevelRelativeEndToEnd가 갖는다.
#
# ⚠️ 그 문장은 **교차밴드 응답에서만** 참이다(2026-08-08 웨이브 2 재측). 출제가 학령
# 정합이면(오늘의 기본 경로 — 풀 필터가 level_group이고 정렬이 |b−θ|, 게다가
# item_params가 비어 있어 밴드 내 b가 상수다) 문항 b가 다시 유저 사전 b와 같아져
# m이 양변에서 소거되고, 판정은 여전히 "정답률 60%"와 등가다. 실측 — 학령 표준문항
# 응답의 상대 θ가 네 밴드에서 소수 셋째 자리까지 같다:
#   k/n = 1/1 → +0.336~+0.414 · 0/1 → −0.407~−0.423 · 1/2 → −0.018~+0.001
# 완전히 풀리려면 b 보정 가동(8/18, CO-U-13)이나 교차밴드 출제가 필요하다.
# ── 🔴 「정답률」로 검색해 여기 닿은 사람에게 — 축이 다르다 (R13 §5.26-b, 2026-08-20)
#
# 제안서 원문(`docs/team/PROPOSAL_REQUIREMENTS.md:154` §3-2)은 **「정답률 60% 미만」**
# 개념을 반복 학습 대상으로 적는다. 현행 코드는 그 수치를 **다른 축**에 쓴다:
#
#   제안서 문면 — 과거 **실측 정답률** < 60%
#   현행 코드   — **기대 정답률** P(정답) = σ(θ − b) < 0.6   ← 이 상수
#
# **같은 0.6인데 재는 것이 다르다.** 실측 정답률은 "무엇을 풀었나"에 좌우되고,
# 기대 정답률은 "그 사람의 실력이 학령 표준문항에 못 미치나"를 잰다.
#
# 왜 축을 바꿨나 (구현 개선이지 사양 이탈이 아니다):
#  ① **문항 난이도 차이를 흡수한다** — b가 학령별 사전값이라, 어려운 문항만 받아
#     정답률이 낮은 학습자를 약점으로 오분류하지 않는다. 실측 정답률에는 이 보정이 없다.
#  ② **한 번도 안 푼 개념을 약점으로 만들지 않는다** — weak_concepts()의 `n > 0`
#     조건. placement 사전 θ만 있는 태그(n=0)는 "약점"이 아니라 "정보 없음"이다.
#
# 🪦 **소거 기록 — 이 이름들을 grep해서 왔다면, 여기가 그 후임이다:**
#   `xp_service.WEAK_ACCURACY_THRESHOLD`(= 60) · `xp_service.is_weak_concept()`
#   구 실측 정답률 축의 폐기 shim이었다. **프로덕션 호출자 0**(테스트 1곳만)을
#   확인하고 2026-08-20 소거했다. 약점 판정의 소유자는 **이 파일이 단독**이다.
#
# ⚠️ 단, 실측 정답률 축이 저장소에서 완전히 사라진 것은 아니다 — 살아 있는 자리가
#   **하나** 있다: `ai-worker/app/chains/router_chain.py:27` `ACCURACY_FOCUS_THRESHOLD`
#   (= 60). 그것은 **약점 판정이 아니라 세션 라우팅**이고, θ가 없을 때(콜드스타트·
#   추정 실패)만 도는 **폴백**이다(같은 파일 `:95-107`). 약점 판정과 혼동하지 말 것.
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


# ── θ 임계의 기준점 — 절대가 아니라 **학령 상대** (R13 CO-U-3) ────────────────
# θ는 절대 스케일이지만 응답이 적을 때는 사전분포로 수축한다. 그리고 그 사전평균은
# 가입 시 **신고한** level_group에서 온다 — 측정값이 아니라 신고값이다. 그래서 θ에
# 절대 임계를 걸면 "무엇을 맞혔나"가 아니라 "가입할 때 무엇이라고 적었나"를 재게 된다.
#
# 실측(2026-08-08 재현, CO-U-1 수리 **후**에도 동일 — 출제가 학령 정합이라 문항 b가
# 다시 유저 사전 b와 같아지기 때문이다. 즉 U-1은 U-3을 닫지 않았다):
#
#   학령 표준문항 1문항, 절대 임계 기준
#     elementary  정답 → θ −0.5865  → focused(−0.5 미만) …맞혀도 항상 보강 대상
#     adult       오답 → θ +0.5865  → 선해금(0.5 이상)   …틀려도 유닛이 열린다
#     middle_high 정답 → θ +0.4131  → 선해금 안 됨       …맞혀도 영원히 0
#
# 고침: 임계를 **자기 밴드의 경계**로 둔다. 밴드 폭이 1.0(인접 사전평균 간격)이므로
# 자기 밴드 경계 = 사전평균 ± 0.5이고, 아래 두 델타는 그 반폭을 경계 튜플에서 파생한
# 것이다(새 매직넘버 0개). 의미론이 한 문장으로 말해진다 —
#   **focused = 자기 밴드 아래로 벗어났다 · 선해금 = 자기 밴드 위로 벗어났다.**
#
# 성질 셋(전부 test_weatherbrain_relative_thresholds가 고정한다):
#  ① middle_high에서는 값이 현행 절대 임계와 **정확히 같다**(−0.5·+0.5) — 순수 확장.
#  ② 판정이 학령에 균일하다: 학령 표준문항 전건정답 n=2부터 선해금(rel +0.599~+0.704),
#     n=1은 어느 학령도 아니다(+0.336~+0.414). 전건오답 n=2부터 focused(−0.695~−0.706),
#     n=1은 아니다(−0.407~−0.423). 최악 마진 0.077로 격자 해상도(0.1)와 같은 자릿수다.
#  ③ 사다리가 단조다: focus(−0.5) < weak(logit 0.6 ≈ +0.406) < unlock(+0.5).
#     "약점이 아니다"보다 "선해금"이 항상 엄격하다 — 두 판정이 모순될 수 없다.
#
# 왜 선해금 델타를 weak과 같은 logit(0.6)으로 두지 않았나: 학령 표준문항 1정답의
# 상대 θ가 +0.336~+0.414로 logit(0.6)=+0.4055에 **걸쳐 있다**(adult 마진 +0.0013,
# expert는 **−0.069로 음수**). 즉 그 값은 칼날이고 expert에서 이미 깨진다.
THETA_BAND_HALF_WIDTH: float = (
    (THETA_BAND_BOUNDS[1] - THETA_BAND_BOUNDS[0]) / 2.0
    if len(THETA_BAND_BOUNDS) >= 2
    else 0.5
)
# Router "focused"(보강 집중) — 자기 밴드 하단 경계 미만.
THETA_FOCUS_DELTA: float = -THETA_BAND_HALF_WIDTH
# 커리큘럼 배치 선해제(§3.4) — 자기 밴드 상단 경계 이상.
THETA_UNLOCK_DELTA: float = THETA_BAND_HALF_WIDTH


def band_prior_theta(level_group: str) -> float:
    """학령 밴드의 θ 사전평균 — 상대 임계의 기준점.

    ai-worker priors.LEVEL_GROUP_PRIORS[lg][0]과 같은 값이다(로짓 정합 설계상
    문항 사전 b와도 같다 — 밴드 내 기대 정답확률 0.5). backend는 ai-worker를
    임포트하지 않으므로 LEVEL_GROUP_ITEM_B를 그 단일 공급원으로 재사용한다.
    """
    return LEVEL_GROUP_ITEM_B.get(level_group, DEFAULT_ITEM_B)


def focus_theta_threshold(level_group: str) -> float:
    """Router "focused" 임계 — 학령 상대. θ가 이 값 **미만**이면 보강 집중.

    ai-worker router_chain.focus_theta_threshold와 같은 값이어야 하고 드리프트는
    test_weatherbrain_relative_thresholds가 감시한다(교차 서비스 상수 이원화 관례).

    **배선 완료** (R13 잔여 웨이브 CO-V-1). 호출측 3홉이 학령을 넘긴다 —
    `session_service` → `ai_client.router_decide(..., level_group=)` →
    `ai-worker/main.py RouterDecideRequest.level_group` → `router_chain.route()`.
    전부 기본값 None이라 값을 안 넘기면 종전 절대 임계로 되돌아간다(하위 호환).

    배선되면 test_weatherbrain_relative_thresholds.TestRouterChainParity의
    test_route가_학령을_받으면_판정이_뒤집힌다가 실경로에서도 참이 된다.
    """
    return band_prior_theta(level_group) + THETA_FOCUS_DELTA


def unlock_theta_threshold(level_group: str) -> float:
    """배치 선해제 임계 — 학령 상대. θ가 이 값 **이상**이고 n>0이면 선해제 후보.

    **배선 완료** (R13 잔여 웨이브 CO-V-2). `curriculum_service.placement_unlock_floor`가
    `_THETA_INTERMEDIATE_MAX`(절대 0.5)가 아니라 이 함수를 본다. 배선 전에는
    **성인은 틀려도 선해제되고 중고생·초등은 맞혀도 영영 안 됐다** — 절대 임계가
    학령별 사전평균과 어긋나서다. 지금은 학령 표준문항 2연속 정답이면 세 학령 모두
    선해제되고, 1문항으로는 아무도 안 된다.

    배선 후 기대 동작(test_weatherbrain_relative_thresholds가 이미 고정한 값):
    학령 표준문항 **2연속 정답**이면 세 학령 모두 선해제, **1문항**으로는 어느
    학령도 선해제되지 않는다. 게스트(영구 middle_high)도 이때 처음으로 열린다.
    """
    return band_prior_theta(level_group) + THETA_UNLOCK_DELTA


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


async def _load_item_level_groups(
    db: AsyncDBSession, content_item_ids: set[uuid.UUID]
) -> dict[uuid.UUID, str]:
    """문항의 **실효** 학령 밴드 조회 — 사전 b 폴백의 근거 (R13 CO-U-1).

    저장된 level_group이 아니라 effective_level_group(2축 파생 뷰)을 돌려준다:
    knowledge_level이 채워진 문항은 새 축에서 파생하고, 미분류(NULL)면 저장값
    그대로다. 시드 272건은 두 축이 정합하므로(2026-08-09 전건 재확인 — `level_group`
    과 `KNOWLEDGE_LEVEL_BANDS[knowledge_level-1]`이 어긋나는 문항 0건) 오늘의 값은
    한 건도 달라지지 않는다. 종전 표기 "237건"은 저작 배치 전 총량이었다.
    """
    if not content_item_ids:
        return {}
    rows = (
        await db.execute(
            select(
                ContentItem.id, ContentItem.level_group, ContentItem.knowledge_level
            ).where(ContentItem.id.in_(content_item_ids))
        )
    ).all()
    return {row.id: effective_level_group(row) for row in rows}


def assemble_responses(
    logs: Sequence[Any],
    calibrated_b: dict[Any, float],
    item_level_groups: dict[Any, str],
    default_level_group: str,
) -> dict[str, list[dict[str, Any]]]:
    """채점된 quiz_logs → 개념별 IRT 응답 조립 (순수 함수, R13 CO-U-1).

    **placement_service.assemble_placement_responses와 같은 규칙이어야 한다** —
    두 경로가 같은 응답 집합에 다른 b를 쓰면 배치가 만든 θ를 첫 세션 발급이
    덮어쓴다(CO-U-4의 실증: 배치 −0.718 → refresh −1.000). 동일성은
    test_weatherbrain_theta_pipeline.py::TestAssembleParityWithPlacement가 감시한다.

    난이도 b 규칙: 보정값(item_params)이 있으면 그 값, 없으면 **그 문항**
    level_group의 사전 b. 문항을 모를 때(content_item_id NULL — 생성 문항 등)만
    신고 그룹으로 폴백한다. 변별도 a는 1.0 고정(2PL 콜드스타트 관례).

    이전 구현은 미보정 문항에 b=None을 보내 ai-worker가 **유저의** 사전 b로
    채우게 했다. 그러면 θ 추정에 문항 난이도가 한 번도 들어가지 않고
    (θ̂ = 사전평균 + f(정답수, 응답수)), 약점 임계의 학령 상대성이 항등적으로
    상쇄된다(CO-U-2). b를 여기서 확정해 보내므로 그 두 결함이 함께 닫힌다.

    반환: {concept_tag: [{"b": float, "a": 1.0, "correct": bool}]}.
    """
    by_concept: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for log in logs:
        is_correct = getattr(log, "is_correct", None)
        if is_correct is None:
            continue  # 미채점 로그는 표본이 아님
        item_id = getattr(log, "content_item_id", None)
        b = calibrated_b.get(item_id) if item_id is not None else None
        if b is None:
            group = item_level_groups.get(item_id, default_level_group)
            b = LEVEL_GROUP_ITEM_B.get(group, DEFAULT_ITEM_B)
        by_concept[getattr(log, "concept_tag", None)].append(
            {"b": float(b), "a": 1.0, "correct": bool(is_correct)}
        )
    return dict(by_concept)


async def _assemble_responses(
    db: AsyncDBSession, user: User
) -> dict[str, list[dict]]:
    """채점된 quiz_logs를 개념별 IRT 응답으로 조립한다(DB 결합부).

    b 규칙은 assemble_responses(순수) 독스트링 참조 — placement 경로와 동일하다.
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
    item_level_groups = await _load_item_level_groups(db, item_ids)
    return assemble_responses(rows, calibrated, item_level_groups, user.level_group)


async def _upsert_abilities(
    db: AsyncDBSession,
    user: User,
    abilities: list[dict],
    *,
    only_unmeasured: bool = False,
) -> None:
    """추정 θ를 user_concept_ability에 upsert (weak_tags upsert 패턴 복제).

    `only_unmeasured=True`면 **충돌 행 중 `num_responses = 0`인 것만** 갱신한다
    (없는 행은 그대로 생성된다). 기본값 False는 종전 그대로 조건 없이 덮어쓴다 —
    `refresh_abilities`·`seed_placement`(가입)는 **측정 결과 자체를 쓰는 자리**라
    가드가 붙으면 안 된다.

    🔴 가드를 **파이썬이 아니라 SQL의 `DO UPDATE ... WHERE`에 두는 이유**: 읽고
    나서 쓰는 형태(측정된 태그를 SELECT로 걸러내고 나머지만 upsert)는 그 사이에
    들어온 채점 1건을 사전값으로 되돌린다. 조건을 같은 문장 안에 두면 그 창이 없다.
    """
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
            **(
                {"where": UserConceptAbility.num_responses == 0}
                if only_unmeasured
                else {}
            ),
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


async def overall_knowledge_level(db: AsyncDBSession, user: User) -> int | None:
    """사용자 전체를 대표하는 지식 수준 1칸 — `GET /progress/me` 노출용.

    **의미의 소유자는 `overall_theta`다**(target_concept_tag 없는 호출):
    n 가중 평균, 전부 n=0이면 단순 평균, 행이 없으면 None. 여기서 같은 규칙을
    SQL로 한 번 더 쓰는 이유는 순수 파이썬 재사용이 불가능해서가 아니라
    **집계 1행으로 끝내기 위해서**다 — /me는 이미 여러 서비스를 부르는 헤더
    엔드포인트라 개념 수만큼 행을 끌어올 이유가 없다. 두 구현의 드리프트는
    test_knowledge_level_exposure가 같은 입력으로 대조해 감시한다.

    None은 "θ 행이 아예 없다"는 뜻이다(가입 시 seed_placement가 실패한 경우 등).
    행이 있으면 n=0(신고 학령에서 온 사전값)이어도 값을 준다 —
    `/abilities`의 level_label이 n=0에서도 라벨을 주는 것과 같은 관례다.
    """
    total_n = func.sum(UserConceptAbility.num_responses)
    weighted = func.sum(UserConceptAbility.theta * UserConceptAbility.num_responses)
    theta = (
        await db.execute(
            select(
                case(
                    (
                        func.coalesce(total_n, 0) > 0,
                        weighted / func.nullif(total_n, 0),
                    ),
                    else_=func.avg(UserConceptAbility.theta),
                )
            ).where(UserConceptAbility.user_id == user.id)
        )
    ).scalar_one()
    if theta is None:
        return None
    return theta_to_knowledge_level(float(theta))


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


# ── BKT 숙련도 (R13-01 §5-1) — θ와 다른 축 ──────────────────────────────────
# θ는 "지금 이 개념의 실력"(로짓, 응답을 순서 없는 집합으로 봄)이고, 숙련도는
# "이 개념을 익혔을 확률"(0..1, 응답을 **시간 순서**로 봄)이다. 두 축은 서로를
# 읽지 않는다 — θ 경로(user_concept_ability)는 여기서 한 번도 건드리지 않고,
# 숙련도는 quiz_logs만 읽는 **파생 뷰**라 저장 테이블이 없다.
#
# **갱신 시점**: 답안 제출마다 계산하지 않는다. quiz_logs가 SSOT이므로 조회
# 시점에 조립해 ai-worker에 1콜 한다 — review-queue가 quiz_logs read-model인
# 것과 같은 관례이고, 답안 경로에 왕복을 추가하지 않는다(§5 불변 원칙).
# 순수 계산 엔드포인트라 LLM 과금이 없다.

# 표시용 숙련 밴드 경계 — theta_level_label과 같은 "서버가 라벨을 준다" 관례.
# 값은 확률이므로 학령에 상대적이지 않다(θ 임계와 달리 절대 기준).
MASTERY_MASTERED_MIN: float = 0.8
MASTERY_LEARNING_MIN: float = 0.5


def mastery_label(p_mastery: float, cold_start: bool) -> str:
    """숙련 확률 → 표시 라벨. 콜드스타트는 값보다 "데이터 부족"이 먼저다."""
    if cold_start:
        return "insufficient"
    if p_mastery >= MASTERY_MASTERED_MIN:
        return "mastered"
    if p_mastery >= MASTERY_LEARNING_MIN:
        return "learning"
    return "beginning"


async def _assemble_mastery_sequences(
    db: AsyncDBSession, user: User
) -> dict[str, list[bool]]:
    """채점된 quiz_logs를 개념별 **시간 오름차순** 정오답 시퀀스로 조립한다.

    is_correct(최초 응답)만 읽는다 — 만회 결과(retry_correct)는 넣지 않는다.
    BKT의 관측은 "그 시점에 스스로 맞혔는가"이고, 오답 직후의 재시도를 정답으로
    세면 숙련 전이가 위로 편향된다(is_correct를 θ 근거로 불변 보존하는 R13 §2.1의
    같은 이유).
    """
    rows = (
        await db.execute(
            select(QuizLog.concept_tag, QuizLog.is_correct)
            .where(QuizLog.user_id == user.id, QuizLog.is_correct.is_not(None))
            .order_by(QuizLog.answered_at.asc())
        )
    ).all()
    by_concept: dict[str, list[bool]] = defaultdict(list)
    for concept_tag, is_correct in rows:
        by_concept[concept_tag].append(bool(is_correct))
    return dict(by_concept)


async def load_mastery(db: AsyncDBSession, user: User) -> list[dict]:
    """개념별 BKT 숙련 확률 (숙련 낮은 순). 응답 없는 개념은 행이 없다.

    **콜드스타트 계약**: 관측 0건 개념은 목록에 넣지 않는다(추적할 이력이
    없으므로 사전값을 측정처럼 보여주지 않는다 — θ가 가입 시 사전 배정으로
    전 개념 행을 갖는 것과 의도적으로 다르다). 1~2건 개념은 행은 있되
    cold_start=true로 "데이터 부족"을 표시한다(경계는 ai-worker 소유).

    ai-worker 실패 시 빈 목록 — 숙련 패널만 비고 나머지 화면은 그대로 산다
    (refresh_abilities가 저장 θ로 폴백하는 것과 같은 복원력 원칙).
    """
    by_concept = await _assemble_mastery_sequences(db, user)
    if not by_concept:
        return []

    concepts_payload = [
        {"concept_tag": tag, "corrects": corrects}
        for tag, corrects in sorted(by_concept.items())
    ]
    try:
        result = await ai_client.weatherbrain_mastery(concepts=concepts_payload)
    except AIWorkerError:
        logger.warning("weatherbrain mastery 실패 — 빈 목록 폴백 (user=%s)", user.id)
        return []

    masteries = result.get("masteries", [])
    return sorted(masteries, key=lambda m: float(m["p_mastery"]))


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


async def reseed_unmeasured_priors(db: AsyncDBSession, user: User) -> list[dict]:
    """학령 **재신고** 시 θ 사전값 갈아타기 — `PATCH /auth/me`가 부른다.

    🔴 **왜 필요한가**: 천장(`routers/board.learner_tier`)의 유일한 입력은
    `overall_knowledge_level` = θ 파생인데, θ에 학령이 들어가는 통로는
    `seed_placement`(가입·게스트 발급) **한 번뿐**이었다. 그래서 재신고는
    `users.level_group`만 바꾸고 천장은 한 칸도 안 움직였고, 잠금 배너의
    「학습 수준 바꾸기」 CTA가 **못 지키는 약속**이었다. 이 함수가 그 구멍이다.

    🔴 **판정 A(천장은 학령 밴드를 읽지 않는다)와 부딪히지 않는 이유**:
    밴드는 여기서 **천장의 규칙**이 아니라 **θ의 입력**이다. 천장 계산은 여전히
    `overall_knowledge_level`(θ) 하나만 보고 `level_group`을 읽지 않는다 —
    `test_천장_계산이_학령_밴드를_읽지_않는다`가 무는 것은 그 자리이고, 이
    함수는 그 자리에 손대지 않는다. 바뀌는 것은 **θ 자신**이다.

    🔴 **측정된 행은 손대지 않는다**(`only_unmeasured=True`). 사전값은
    「아직 아무것도 모를 때의 추정」이라 실제 응답이 이긴다 — `decide_route`가
    *"n=0은 약점이 아니라 정보 없음"*이라 적은 것과 같은 원칙이다. 순진하게
    `seed_placement`를 다시 부르면 이미 푼 문항의 결과가 사전값으로 되돌아가고
    `num_responses`가 0이 된다(`_upsert_abilities`가 조건 없이 덮어쓰므로).

    ai-worker 장애 시 조용히 넘어간다 — `seed_placement`가 가입을 실패시키지
    않는 것과 같은 관례다. **재신고 자체(level_group 저장)는 성공해야 한다.**
    """
    try:
        result = await ai_client.weatherbrain_placement(
            level_group=user.level_group, concept_tags=list(CONCEPT_TAGS)
        )
    except AIWorkerError:
        logger.warning(
            "weatherbrain placement 실패 — 학령 재신고는 진행 (user=%s)", user.id
        )
        return []

    abilities = result.get("abilities", [])
    await _upsert_abilities(db, user, abilities, only_unmeasured=True)
    return abilities
