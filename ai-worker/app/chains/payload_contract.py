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
# ⚠️ **이 자리에 있던 "board·match·ordering·cloze는 생성 대상이 아니다 … Literal을
# 넓히지 말 것"은 2026-08-10 CO-O-13으로 뒤집혔다.** 낡은 주석이 감사 판단을 오염시킨
# 전례가 있는 리포라 지우지 않고 왜 뒤집는지를 남긴다.
#
# **종전 근거**: "나머지는 저작 영역"(= 사람이 손으로 쓰는 유형이므로 생성기가 낼 수
# 없다). 이 근거는 **유형의 성질이 아니라 당시 스키마의 부재**를 말한 것이었다 —
# match·ordering·cloze를 막고 있던 것은 "생성이 불가능해서"가 아니라 **payload 정합을
# 검사할 계약이 여기 없어서**였다. 그 결과 생성기는 7유형 중 3종만 내고, 뱅크 확장은
# 저작 속도에 묶였다(CO-O-13).
#
# **왜 지금 넓히는가**: 세 유형 모두 판정에 필요한 것이 **문항 자신 안에서 닫힌다** —
# 채점기(`answer_service._grade_match`·`_grade_ordering`·`_grade_text`)가 문항 밖의
# 어떤 자원도 읽지 않는다. 그래서 "정합한가"를 이 모듈이 순수 함수로 판정할 수 있고,
# 판정할 수 있으면 slider와 같은 이유로 **스키마가 막을 수 있다**.
#
# **board는 계속 제외한다 — 이 판단은 살아 있다.** board만은 채점이 문항 안에서 닫히지
# 않는다: `board_rules.json`을 로드해 재판정하는 구조(goal_conditions·palette·
# initial_state)가 필요하고, 그 정합은 stdlib+pydantic까지로 못박은 이 모듈이 판정할 수
# 없다(규칙 파일 I/O = 모듈 독스트링의 의존 규약 위반). 판정할 수 없으면 막을 수도
# 없으므로 넣지 않는다. **board를 여기 추가하지 말 것.**
#
# 값은 backend `QUESTION_PAYLOAD_FIELDS`와 이름이 같아야 한다(match→pairs,
# ordering→items·shuffled). cloze는 backend 쪽에도 항목이 없다 — 추가 payload 없이
# question_text의 빈칸 마커와 correct_answer만으로 성립하는 short_answer 구조다.
GENERATED_PAYLOAD_FIELDS: dict[str, tuple[str, ...]] = {
    "multiple_choice": ("options",),
    "short_answer": (),
    "slider": ("min", "max", "step", "unit"),
    "cloze": (),
    "match": ("pairs",),
    "ordering": ("items", "shuffled"),
}

# multiple_choice 최소 보기 수 — 2지선다 미만은 고를 것이 없다. 1차 게이트
# (`validate_chain.OPTION_COUNT` = 4)는 더 좁게 4개를 요구하지만, 스키마 쪽은
# "플레이 자체가 불가능한 것"만 막는 하한이다.
MIN_OPTION_COUNT = 2

# slider 범위 상한 (G-2 규칙 6) — 관용오차가 상대값이 아니라 절대값 10이므로
# 범위가 넓어질수록 ±10이 차지하는 비율이 커지고, 어느 지점부터는 관용오차가
# "대충 맞으면 정답"이 된다. 200을 상한으로 둔다(±10 = 범위의 10% 이내).
SLIDER_MAX_SPAN = 200

# cloze 빈칸 마커 (CO-O-13) — 본시드 cloze 35/35 전건이 밑줄 정확히 3개를 쓴다
# (2026-08-10 실측: 밑줄 연속 길이 분포가 (3,) 단일). 마커가 없는 cloze는 화면에서
# short_answer와 구분되지 않는데 정답만 "빈칸에 들어갈 말"이라 **풀 수 없는 문항**이
# 된다 — 채점기가 없는 결함이라 스키마만이 막을 수 있다(slider 0~100 폴백과 같은 구조).
CLOZE_BLANK = "___"

# match 최소 쌍 수 · ordering 최소 항목 수 — MIN_OPTION_COUNT와 같은 성격의 하한이다
# ("플레이 자체가 불가능한 것"만 막는다). 1쌍 매칭·1항목 정렬은 답이 하나뿐이라
# 고를 것도 옮길 것도 없다. 본시드 실측 하한은 match 3쌍·ordering 3항목이므로
# 이 값들은 시드를 오탈락시키지 않는다.
MIN_PAIR_COUNT = 2
MIN_ORDERING_ITEMS = 2

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


def check_cloze_text(question_text: str) -> None:
    """cloze 빈칸 마커 존재 (CO-O-13). 위반 시 ValueError.

    cloze는 추가 payload가 없어 `check_required_fields`가 걸 것이 없다 — 구조상
    short_answer와 같기 때문이다. cloze를 cloze이게 하는 유일한 것이 본문의 빈칸이고,
    그것이 없으면 "무엇을 묻는지 문장에 표시되지 않은 단답"이 된다.
    **마커를 대신 끼워 넣지 않는다** — 어디가 빈칸인지는 저작 의도라 추측할 수 없다.
    """
    if CLOZE_BLANK not in str(question_text or ""):
        raise ValueError(
            f"cloze 본문에 빈칸 마커 {CLOZE_BLANK!r}가 없다 — "
            "빈칸 없는 cloze는 화면에서 풀 수 없다"
        )


def parse_match_answer(correct_answer: str) -> set[tuple[str, str]]:
    """match 정답 문자열을 (left, right) 집합으로 판다. 형식 위반 시 ValueError.

    **파싱을 채점기와 글자 단위로 맞춘다** — backend `_grade_match`는
    `split("|")` → `split(":", 1)` → 양쪽 strip이다. 여기서 다르게 파싱하면
    "계약은 통과했는데 채점되지 않는" 문항이 생긴다(right에 공백이,
    left에 콜론이 들어갈 수 있어 분리 방식이 결과를 바꾼다).
    """
    parsed: set[tuple[str, str]] = set()
    for token in str(correct_answer).split("|"):
        if ":" not in token:
            raise ValueError(
                f"match 정답 토큰 {token!r}에 ':'가 없다 — "
                "형식은 'left:right|left:right'다"
            )
        left, right = token.split(":", 1)
        parsed.add((left.strip(), right.strip()))
    return parsed


def check_match_values(pairs: list, correct_answer: str) -> None:
    """match 값 정합 (CO-O-13). 위반 시 ValueError, 통과 시 None.

    `check_slider_values`와 같은 성격의 순수 함수다 — 필드 존재는
    `check_required_fields`가 먼저 본다는 전제에서 값만 본다.

    채점기(`_grade_match`)는 형식이 어긋나면 **예외 없이 그냥 오답**을 낸다. 즉
    pairs와 correct_answer가 어긋난 문항은 오류로 드러나지 않고 **아무도 맞힐 수 없는
    문항**으로 조용히 살아남는다. 그래서 여기서 "채점기가 이 정답을 정답으로 볼 것인가"를
    미리 돌려 본다.
    """
    if not isinstance(pairs, list) or len(pairs) < MIN_PAIR_COUNT:
        raise ValueError(
            f"match pairs가 {len(pairs) if isinstance(pairs, list) else pairs!r}다 — "
            f"{MIN_PAIR_COUNT}쌍 이상이어야 연결할 것이 생긴다"
        )
    expected: set[tuple[str, str]] = set()
    lefts: list[str] = []
    for pair in pairs:
        if not isinstance(pair, dict) or "left" not in pair or "right" not in pair:
            raise ValueError(
                f"match pair {pair!r}에 left·right 키가 없다 — "
                "채점기가 읽는 키 이름이다"
            )
        left, right = str(pair["left"]).strip(), str(pair["right"]).strip()
        if not left or not right:
            raise ValueError(f"match pair {pair!r}의 left·right가 비어 있다")
        lefts.append(left)
        expected.add((left, right))
    # 같은 left가 두 번 나오면 어느 right가 정답인지 화면에서 결정되지 않는다.
    # 채점기는 집합 비교라 이것을 잡지 못한다 — 여기서만 잡을 수 있다.
    if len(set(lefts)) != len(lefts):
        raise ValueError(f"match pairs의 left가 중복이다: {lefts} — 연결이 모호해진다")
    if parse_match_answer(correct_answer) != expected:
        raise ValueError(
            f"match correct_answer가 pairs와 다르다: {correct_answer!r} ≠ "
            f"{sorted(expected)} — 아무도 맞힐 수 없는 문항이 된다"
        )


def check_ordering_values(items: list, shuffled, correct_answer: str) -> None:
    """ordering 값 정합 (CO-O-13). 위반 시 ValueError, 통과 시 None.

    계약은 **items를 정답 순서로 저작하고 correct_answer는 항등 순열**이다
    (`_grade_ordering`: 제출이 `list(range(len(items)))`와 완전 일치해야 정답).
    `"0,2,1,3"` 같은 비항등 순열은 채점기 기준으로 **영원한 오답**이므로 막는다.

    `shuffled`를 `is True`로 못박는 이유: `check_required_fields`는 False를 부재로
    보지 않으므로(0·False는 정상값이라는 기존 규약) 필드 검사만으로는
    `shuffled: false`가 통과한다. 그런데 false면 화면이 items를 **저작 순서 그대로**
    = 정답 순서 그대로 내놓는다 — 공짜 정답이다. 값 검사가 여기 있어야 하는 이유다.
    """
    if not isinstance(items, list) or len(items) < MIN_ORDERING_ITEMS:
        raise ValueError(
            f"ordering items가 {len(items) if isinstance(items, list) else items!r}다 — "
            f"{MIN_ORDERING_ITEMS}개 이상이어야 순서가 생긴다"
        )
    texts = [str(item).strip() for item in items]
    if any(not text for text in texts):
        raise ValueError(f"ordering items에 빈 항목이 있다: {items!r}")
    # 같은 문자열이 두 번 있으면 플레이어가 구분할 수 없는 두 배치가 생기는데
    # 채점기는 인덱스 항등만 정답으로 본다 — 운으로 갈리는 문항이 된다.
    if len(set(texts)) != len(texts):
        raise ValueError(
            f"ordering items가 중복이다: {texts} — 구분되지 않는 배치가 오답이 된다"
        )
    if shuffled is not True:
        raise ValueError(
            f"ordering shuffled가 {shuffled!r}다 — True가 아니면 화면이 정답 순서를 "
            "그대로 보여 준다"
        )
    try:
        submitted = [int(token) for token in str(correct_answer).split(",")]
    except ValueError:
        raise ValueError(
            f"ordering 정답 {correct_answer!r}이 인덱스 목록으로 파싱되지 않는다 — "
            "형식은 '0,1,2'다"
        ) from None
    identity = list(range(len(items)))
    if submitted != identity:
        raise ValueError(
            f"ordering 정답 {correct_answer!r}이 항등 순열이 아니다(기대 "
            f"{','.join(map(str, identity))}) — items를 정답 순서로 저작하는 계약이다"
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
    elif question_type == "cloze":
        check_cloze_text(question.get("question_text"))
    elif question_type == "match":
        check_match_values(question["pairs"], question.get("correct_answer"))
    elif question_type == "ordering":
        check_ordering_values(
            question["items"],
            question["shuffled"],
            question.get("correct_answer"),
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
    # 6종 — board만 제외한다(제외 근거는 GENERATED_PAYLOAD_FIELDS 위 주석, CO-O-13).
    # 이 Literal과 GENERATED_PAYLOAD_FIELDS의 키 집합은 항상 같아야 한다
    # (어긋나면 "필수 필드 선언 없이 생성되는 유형"이 생긴다 — slider가 그랬다).
    question_type: Literal[
        "multiple_choice",
        "short_answer",
        "slider",
        "cloze",
        "match",
        "ordering",
    ]
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
    # match 전용 payload (G-1, CO-O-13). 키 이름 left·right는 backend
    # `_grade_match`가 읽는 이름이라 바꿀 수 없다. 값 정합(쌍 수·중복 left·
    # correct_answer 대조)은 `check_match_values`가 단독 소유한다.
    pairs: Optional[list[dict[str, str]]] = None
    # ordering 전용 payload (G-1, CO-O-13). items는 **정답 순서로** 저작하고
    # correct_answer는 항등 순열이다 — 순서를 섞는 것은 화면의 몫(shuffled)이다.
    items: Optional[list[str]] = None
    shuffled: Optional[bool] = None

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
