"""생성 문항 payload 계약 — 계약 G (`docs/team/CONTRACT_GEN_ITEM.md` §1).

> 생성 문항은 자기 `question_type`이 요구하는 payload 필드를 전부 갖춰야 한다.
> 갖추지 못한 문항은 생성 단계에서 탈락한다 — API까지 보내지 않는다.

**왜 quiz_gen_chain에서 분리했는가**: 계약을 읽는 쪽(PM의 교차 계약 테스트,
BE-1의 저작 배치)이 `quiz_gen_chain`을 실임포트하면 최상단 langchain import 때문에
langchain 미설치 환경에서 ERROR가 나고, `importorskip`으로 우회하면 계약 검사가
조용히 skip된다(게이트가 있는 척하고 안 도는 상태 — 이 스프린트에서 막은 패턴).
그래서 **이 모듈의 import는 stdlib + pydantic까지로 못박는다.** langchain 계열을
여기서 import하면 분리한 의미가 사라진다.

**왜 이 계약이 필요한가**: backend `_question_payload`(`backend/app/routers/session.py`)는
"저작된 키만" 담는 계약이라 `min`/`max`/`step`/`unit`이 없는 slider 문항은 payload=None으로
내려가고, 프론트(`QuestionCard.jsx`)가 0~100·step 1로 폴백한다. 채점기 관용오차
(`answer_service.SLIDER_TOLERANCE`)가 절대값 10이라 0~100 슬라이더는 사실상 공짜
정답이 된다. 저작 경로(R10-07)는 시드 수정으로 고쳤지만 생성 경로는 저작으로 막을 수
없다 — 스키마만이 막을 수 있다.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

# ── G-1. 유형별 필수 payload 필드 ──────────────────────────────────────────
# backend의 `QUESTION_PAYLOAD_FIELDS`(`backend/app/routers/session.py` — 유형별 필드
# 이름의 단일 소유자)와 값이 드리프트하면 안 되지만, ai-worker는 별도 빌드 컨텍스트라
# backend를 import할 수 없다. 드리프트 감시는 PM의 교차 계약 테스트가 맡는다(G-3).
#
# board·match·ordering·cloze는 생성 대상이 아니다(board는 board_rules.json 판정 구조가
# 필요하고 나머지는 저작 영역). 아래 키와 QuizQuestion의 Literal을 넓히지 말 것.
GENERATED_PAYLOAD_FIELDS: dict[str, tuple[str, ...]] = {
    "multiple_choice": ("options",),
    "short_answer": (),
    "slider": ("min", "max", "step", "unit"),
}

# multiple_choice 최소 보기 수 — 2지선다 미만은 고를 것이 없다. 1차 게이트
# (`validate_chain.OPTION_COUNT` = 4)는 더 좁게 4개를 요구하지만, 스키마 쪽은
# "플레이 자체가 불가능한 것"만 막는 하한이다.
MIN_OPTION_COUNT = 2

# slider 범위 상한 (G-2 규칙 6) — 관용오차가 상대값이 아니라 절대값 10이므로
# 범위가 넓어질수록 ±10이 차지하는 비율이 커지고, 어느 지점부터는 관용오차가
# "대충 맞으면 정답"이 된다. 200을 상한으로 둔다(±10 = 범위의 10% 이내).
SLIDER_MAX_SPAN = 200

# step 격자 판정 허용오차 — step 0.5·0.1처럼 실수 step에서 (값 - min)/step이 정확히
# 정수로 떨어지지 않는 이진 표현 오차만 흡수한다. 그보다 큰 어긋남은 격자 밖으로 본다.
_GRID_EPS = 1e-9


def on_grid(value: float, origin: float, step: float) -> bool:
    """value가 origin에서 step 간격 격자 위에 있는지 판정한다 (G-2 규칙 2·4)."""
    ticks = (value - origin) / step
    return abs(ticks - round(ticks)) <= _GRID_EPS


def check_slider_values(
    correct_answer: str,
    minimum: int | float,
    maximum: int | float,
    step: int | float,
    unit: str,
) -> None:
    """slider 값 정합 6규칙 (G-2). 위반 시 ValueError, 통과 시 None.

    순수 함수다 — 필수 필드가 모두 존재한다는 전제에서 값만 본다(필드 부재는
    `check_required_fields`가 먼저 걸러야 한다). 규칙 번호는 계약 문서의 번호다.

    **위반을 고쳐주지 않는다.** 범위를 추측해 채우면 결함이 조용해질 뿐이고 결국
    0~100 폴백과 같은 결과가 된다 — 탈락시키는 것이 계약이다.
    """
    lo, hi = minimum, maximum
    # 1. min < max
    if lo >= hi:
        raise ValueError(f"slider 범위가 뒤집혔다: min={lo} >= max={hi}")
    # 2. step > 0 이고 (max - min)이 step으로 나누어떨어진다 —
    #    마지막 눈금이 max에 닿지 않으면 상한을 짚을 수 없다.
    if step <= 0:
        raise ValueError(f"slider step이 {step}이다 — 0보다 커야 한다")
    if not on_grid(hi, lo, step):
        raise ValueError(
            f"slider 범위 {hi - lo}(min={lo}, max={hi})가 step {step}으로 "
            "나누어떨어지지 않는다"
        )
    # 3. correct_answer가 숫자로 파싱되고 min ≤ 값 ≤ max. 파싱 규칙은 채점기
    #    (backend `answer_service`의 float(answer.strip()))와 같게 맞춘다.
    try:
        answer = float(str(correct_answer).strip())
    except ValueError:
        raise ValueError(
            f"slider 정답 {correct_answer!r}이 숫자로 파싱되지 않는다"
        ) from None
    if not lo <= answer <= hi:
        raise ValueError(
            f"slider 정답 {answer:g}이 범위 밖이다(min={lo}, max={hi}) — "
            "도달 불가능한 문항"
        )
    # 4. 정답이 min 기준 step 격자 위에 있다 — 슬라이더로 짚을 수 없는 정답은 무의미.
    if not on_grid(answer, lo, step):
        raise ValueError(f"slider 정답 {answer:g}가 step {step} 격자에 없다(min={lo})")
    # 5. unit은 빈 문자열이 아니다 — UI가 값에 단위를 붙여 읽는다.
    if not str(unit).strip():
        raise ValueError("slider unit이 비어 있다 — UI가 값에 단위를 붙여 읽는다")
    # 6. 범위 상한 — SLIDER_MAX_SPAN 주석 참조.
    if hi - lo > SLIDER_MAX_SPAN:
        raise ValueError(
            f"slider 범위 {hi - lo}(min={lo}, max={hi})가 상한 {SLIDER_MAX_SPAN}을 "
            "넘는다 — 관용오차 ±10이 무의미해진다"
        )


def check_required_fields(question: dict) -> None:
    """유형이 요구하는 payload 필드가 존재하는지 본다 (G-1). 위반 시 ValueError.

    dict를 받는 순수 함수 — 배치 산출물(flat dict) 검사에도 쓸 수 있게 한다
    (계약 P-2 4단계 "배치가 다시 확인한다"). 값이 None이면 부재로 본다.
    0·False는 부재가 아니다(min=0은 정상값이다).
    """
    question_type = question.get("question_type")
    fields = GENERATED_PAYLOAD_FIELDS.get(question_type)
    if fields is None:
        raise ValueError(f"생성 대상이 아닌 question_type이다: {question_type!r}")
    missing = [name for name in fields if question.get(name) is None]
    if missing:
        raise ValueError(
            f"{question_type} 문항에 필수 payload 필드가 없다: {', '.join(missing)}"
        )


def check_payload(question: dict) -> None:
    """flat 문항 dict 하나에 대해 계약 G 전체(G-1 + G-2)를 검사한다.

    호출 순서가 계약의 일부다 — 필드 부재를 먼저 걸러야 값 검사가 None을 만나지
    않는다(`check_slider_values`만 단독 호출하면 부재 시 TypeError가 난다).
    **배치·교차 검사는 이 함수를 쓴다**(계약 P-2 4단계 "배치가 다시 확인한다").
    """
    check_required_fields(question)
    question_type = question["question_type"]
    if question_type == "multiple_choice":
        options = question["options"]
        if len(options) < MIN_OPTION_COUNT:
            raise ValueError(
                f"multiple_choice options가 {len(options)}개다 — "
                f"{MIN_OPTION_COUNT}개 이상이어야 한다"
            )
    elif question_type == "slider":
        check_slider_values(
            question["correct_answer"],
            question["min"],
            question["max"],
            question["step"],
            question["unit"],
        )


# ── 출력 스키마 (Pydantic 검증) ────────────────────────────────────────────
class QuizQuestion(BaseModel):
    """생성 문항 1건. 03번 스펙 출력 스키마 + 계약 G의 payload 필드.

    검증 위반은 pydantic ValueError로 올라가 `quiz_gen_chain._parse_output`의
    재시도(temperature 0.1) → 폴백 뱅크라는 현행 실패 의미론을 그대로 탄다.
    """

    concept_tag: str = Field(min_length=1)
    # 지식 수준 신고 (R13 3일차 — 스펙 03 §2 규칙 3). **필수다.**
    #
    # 선택으로 두면 모델이 빠뜨리고, 빠뜨린 문항은 `lint_seed_items` 검사 ⑤에서
    # "knowledge_level 미부여"로 전건 탈락한다(전환기 폴백은 R13 2일차에 만료됐다).
    # 즉 선택 필드는 "G1 배치 1,360건이 전부 탈락"과 같은 말이다. 여기서 필수로
    # 막으면 미신고는 pydantic ValueError → temperature 0.1 재시도 → 폴백 뱅크라는
    # **현행 실패 의미론**을 그대로 타므로, 실패해도 세션은 끊기지 않는다.
    #
    # 상한을 여기 박지 않는다 — 단계 수 N은 `level_vocabulary.json`의 `anchor`가
    # 소유하고(마이그레이션 0012가 상한 CHECK를 걸지 않은 것과 같은 이유), 신고값이
    # N 이내인지는 1차 게이트의 `knowledge_level_vocabulary`가 어휘표를 읽어 본다.
    # 이 모듈은 stdlib+pydantic까지가 계약이라 어휘표(파일 I/O)를 읽지 않는다.
    knowledge_level: int = Field(ge=1)
    question_type: Literal["multiple_choice", "short_answer", "slider"]
    question_text: str = Field(min_length=1)
    options: Optional[list[str]] = None
    correct_answer: str = Field(min_length=1)
    # slider 전용 payload (G-1). int|float 유니온은 정수 저작값의 정수성을 보존하기
    # 위한 것 — float 단일 선언이면 min 0이 0.0으로 바뀌어 시드 slider 항목
    # (`database/seed/content_items.json` 4건: 0~40/0~100/0~20)과 형태가 어긋난다.
    min: Optional[int | float] = None
    max: Optional[int | float] = None
    step: Optional[int | float] = None
    unit: Optional[str] = None

    @model_validator(mode="after")
    def _check_payload(self) -> "QuizQuestion":
        """유형별 필수 payload와 값 정합을 검증한다 (G-1·G-2).

        검사 본체는 `check_payload`가 단독 소유한다 — 스키마와 배치가 같은 규칙을
        각자 적으면 드리프트한다. 위반은 ValueError로 올라가
        `quiz_gen_chain._parse_output`의 재시도(temperature 0.1) → 폴백 뱅크라는
        현행 실패 의미론을 그대로 탄다.
        """
        check_payload(self.model_dump())
        return self
