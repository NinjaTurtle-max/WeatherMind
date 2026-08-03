"""생성 문항 payload 계약 테스트 — 계약 G (`docs/team/CONTRACT_GEN_ITEM.md` §1).

검사 대상은 두 층이다.
1. `payload_contract` — langchain 없이 import되는 계약 본체(상수 + 6규칙).
2. `quiz_gen_chain` — 계약 위반이 재시도→폴백이라는 **현행 실패 의미론**을 타는지,
   그리고 **폴백 뱅크가 새 계약을 통과하는지**. 후자가 가장 위험한 회귀 지점이다
   (폴백이 계약에 걸리면 키 없는 환경의 전 세션이 깨진다).

정상 slider 값은 `database/seed/content_items.json`의 slider 4건 실측값을 쓴다 —
"정상이 어떤 모양인가"의 유일한 근거를 테스트가 임의로 만들지 않는다.
"""

from __future__ import annotations

import contextlib
import sys
import types

import pytest

from app.chains.payload_contract import (
    GENERATED_PAYLOAD_FIELDS,
    MIN_OPTION_COUNT,
    SLIDER_MAX_SPAN,
    QuizQuestion,
    check_payload,
    check_required_fields,
)

# ── 헬퍼 ───────────────────────────────────────────────────────────────────

# 시드 slider 4건의 실측 (min, max, step, unit, correct_answer).
SEED_SLIDERS = [
    (0, 40, 1, "m/s", "17"),  # typhoon
    (0, 40, 1, "℃", "25"),  # heat_island
    (0, 100, 5, "%", "50"),  # co2_climate
    (0, 20, 1, "%", "7"),  # anomaly
]


def _slider(**overrides) -> dict:
    """계약을 통과하는 slider 문항 dict — 위반 케이스는 여기서 한 필드만 바꾼다."""
    question = {
        "concept_tag": "typhoon",
        "question_type": "slider",
        "question_text": "열대 저기압이 태풍으로 분류되는 최대 풍속은 초속 몇 m인가?",
        "correct_answer": "17",
        "min": 0,
        "max": 40,
        "step": 1,
        "unit": "m/s",
    }
    question.update(overrides)
    return question


def _mc(**overrides) -> dict:
    question = {
        "concept_tag": "typhoon",
        "question_type": "multiple_choice",
        "question_text": "태풍이 에너지를 얻는 주된 원천은?",
        "options": ["따뜻한 바닷물의 수증기", "높은 산의 눈"],
        "correct_answer": "따뜻한 바닷물의 수증기",
    }
    question.update(overrides)
    return question


_LANGCHAIN_STUBS = (
    "langchain_core",
    "langchain_core.messages",
    "langchain_core.output_parsers",
    "langchain_core.runnables",
    "langchain_google_genai",
)


@contextlib.contextmanager
def _quiz_gen_chain():
    """langchain 미설치 환경에서도 `quiz_gen_chain`을 실임포트해 yield한다.

    왜 `importorskip`이 아닌가: 폴백 뱅크가 계약을 통과하는지는 **반드시 도는**
    검사여야 한다. importorskip으로 두면 langchain이 없는 이 환경에서 조용히 skip돼
    게이트가 있는 척만 하게 된다(CI SKIP 방어로 막은 바로 그 패턴).

    스텁이 안전한 근거: quiz_gen_chain이 langchain에서 쓰는 것은 import 시점의 이름
    4개뿐이고, 여기서 검사하는 폴백 경로는 `llm_configured()`가 False라 체인을 아예
    만들지 않는다. 끝나면 sys.modules를 원상복구해 다른 테스트의 importorskip
    판정(7 skipped)을 오염시키지 않는다.
    """

    class _Stub:
        """SystemMessage·StrOutputParser 등 이름 바인딩만 필요한 자리를 메운다."""

        def __init__(self, *args, **kwargs) -> None:
            self.args, self.kwargs = args, kwargs

    saved = {
        name: sys.modules.get(name)
        for name in (*_LANGCHAIN_STUBS, "app.chains.quiz_gen_chain")
    }
    try:
        for name in _LANGCHAIN_STUBS:
            sys.modules[name] = types.ModuleType(name)
        for attr in ("SystemMessage", "HumanMessage"):
            setattr(sys.modules["langchain_core.messages"], attr, _Stub)
        sys.modules["langchain_core.output_parsers"].StrOutputParser = _Stub
        sys.modules["langchain_core.runnables"].RunnableLambda = _Stub
        sys.modules["langchain_google_genai"].ChatGoogleGenerativeAI = _Stub
        sys.modules.pop("app.chains.quiz_gen_chain", None)
        from app.chains import quiz_gen_chain

        yield quiz_gen_chain
    finally:
        for name, module in saved.items():
            if module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module


# ── G-3. 상수 노출 ─────────────────────────────────────────────────────────
class TestGeneratedPayloadFields:
    """`GENERATED_PAYLOAD_FIELDS`는 PM의 교차 계약 테스트가 읽는 이름이다."""

    def test_계약_G1_표와_값이_같다(self):
        assert GENERATED_PAYLOAD_FIELDS == {
            "multiple_choice": ("options",),
            "short_answer": (),
            "slider": ("min", "max", "step", "unit"),
        }

    def test_생성_대상이_아닌_유형은_들어있지_않다(self):
        # board·match·ordering·cloze는 저작 영역 — 여기 넣으면 생성이 시도된다.
        assert not {"board", "match", "ordering", "cloze"} & set(
            GENERATED_PAYLOAD_FIELDS
        )

    def test_Literal_허용값과_키가_일치한다(self):
        allowed = QuizQuestion.model_fields["question_type"].annotation.__args__
        assert set(allowed) == set(GENERATED_PAYLOAD_FIELDS)

    def test_계약_모듈은_langchain을_끌어오지_않는다(self):
        # 계약을 읽으려고 langchain 전체를 적재해야 하면 분리가 무의미해진다.
        assert not [name for name in sys.modules if "langchain" in name]


# ── G-1. 유형별 필수 필드 ──────────────────────────────────────────────────
class TestRequiredFields:
    @pytest.mark.parametrize("field", ["min", "max", "step", "unit"])
    def test_slider에_필수_payload_필드가_없으면_거부(self, field):
        with pytest.raises(ValueError) as exc:
            QuizQuestion(**{k: v for k, v in _slider().items() if k != field})
        assert f"필수 payload 필드가 없다: {field}" in str(exc.value)

    def test_slider_필드가_전부_없으면_네_개_모두_보고한다(self):
        bare = {k: v for k, v in _slider().items() if k not in ("min", "max", "step", "unit")}
        with pytest.raises(ValueError) as exc:
            QuizQuestion(**bare)
        assert "min, max, step, unit" in str(exc.value)

    def test_short_answer는_payload_필드가_없어도_통과(self):
        question = QuizQuestion(
            concept_tag="pressure_front",
            question_type="short_answer",
            question_text="한랭전선 뒤에는 어떤 공기가 오는가?",
            correct_answer="찬 공기",
        )
        assert question.min is None and question.unit is None

    def test_multiple_choice에_options가_없으면_거부(self):
        with pytest.raises(ValueError) as exc:
            QuizQuestion(**{k: v for k, v in _mc().items() if k != "options"})
        assert "필수 payload 필드가 없다: options" in str(exc.value)

    @pytest.mark.parametrize("options", [[], ["하나뿐인 보기"]])
    def test_multiple_choice_보기가_두_개_미만이면_거부(self, options):
        with pytest.raises(ValueError) as exc:
            QuizQuestion(**_mc(options=options))
        message = str(exc.value)
        assert "필수 payload 필드가 없다: options" in message or (
            f"{MIN_OPTION_COUNT}개 이상이어야 한다" in message
        )

    def test_multiple_choice_보기_두_개는_통과(self):
        assert len(QuizQuestion(**_mc()).options) == MIN_OPTION_COUNT

    def test_check_required_fields는_생성_대상_아닌_유형을_거부(self):
        with pytest.raises(ValueError) as exc:
            check_required_fields({"question_type": "board"})
        assert "생성 대상이 아닌 question_type" in str(exc.value)


class TestCheckPayloadEntryPoint:
    """`check_payload`는 배치(계약 P-2 4단계)가 flat dict로 재검사하는 진입점이다."""

    @pytest.mark.parametrize("min_, max_, step, unit, answer", SEED_SLIDERS)
    def test_시드_slider는_통과(self, min_, max_, step, unit, answer):
        check_payload(
            _slider(min=min_, max=max_, step=step, unit=unit, correct_answer=answer)
        )

    def test_필드_부재는_TypeError가_아니라_ValueError로_탈락한다(self):
        # 값 검사만 단독 호출하면 None 비교로 TypeError가 난다 — 탈락 사유로
        # 집계되지 않는 예외는 배치 리포트에서 조용한 절삭이 된다.
        with pytest.raises(ValueError) as exc:
            check_payload({k: v for k, v in _slider().items() if k != "min"})
        assert "필수 payload 필드가 없다: min" in str(exc.value)

    def test_값_위반도_같은_진입점에서_탈락한다(self):
        with pytest.raises(ValueError) as exc:
            check_payload(_slider(correct_answer="17.5"))
        assert "step 1 격자에 없다(min=0)" in str(exc.value)

    def test_short_answer는_추가_필드_없이_통과(self):
        check_payload(
            {
                "question_type": "short_answer",
                "correct_answer": "한랭전선",
            }
        )


# ── G-2. slider 값 정합 6규칙 ───────────────────────────────────────────────
class TestSliderRules:
    """계약 문서 §1 G-2의 규칙 번호를 그대로 테스트 이름에 남긴다."""

    @pytest.mark.parametrize("min_, max_", [(40, 0), (40, 40)])
    def test_규칙1_min이_max보다_크거나_같으면_거부(self, min_, max_):
        with pytest.raises(ValueError) as exc:
            QuizQuestion(**_slider(min=min_, max=max_, correct_answer=str(min_)))
        assert "범위가 뒤집혔다" in str(exc.value)

    @pytest.mark.parametrize("step", [0, -1, -0.5])
    def test_규칙2_step이_0이하면_거부(self, step):
        with pytest.raises(ValueError) as exc:
            QuizQuestion(**_slider(step=step))
        assert "0보다 커야 한다" in str(exc.value)

    def test_규칙2_범위가_step으로_나누어떨어지지_않으면_거부(self):
        # 0~40 / step 3 → 마지막 눈금 39, max 40을 짚을 수 없다.
        with pytest.raises(ValueError) as exc:
            QuizQuestion(**_slider(step=3, correct_answer="15"))
        assert "나누어떨어지지 않는다" in str(exc.value)

    def test_규칙3_정답이_숫자가_아니면_거부(self):
        with pytest.raises(ValueError) as exc:
            QuizQuestion(**_slider(correct_answer="약 17m/s"))
        assert "숫자로 파싱되지 않는다" in str(exc.value)

    @pytest.mark.parametrize("answer", ["45", "-1"])
    def test_규칙3_정답이_범위_밖이면_거부(self, answer):
        with pytest.raises(ValueError) as exc:
            QuizQuestion(**_slider(correct_answer=answer))
        assert "범위 밖이다" in str(exc.value)
        assert "도달 불가능한 문항" in str(exc.value)

    def test_규칙4_정답이_step_격자에_없으면_거부(self):
        with pytest.raises(ValueError) as exc:
            QuizQuestion(**_slider(correct_answer="17.5"))
        assert "step 1 격자에 없다(min=0)" in str(exc.value)

    def test_규칙4_step_5_격자를_벗어난_정답도_거부(self):
        with pytest.raises(ValueError) as exc:
            QuizQuestion(**_slider(min=0, max=100, step=5, correct_answer="17"))
        assert "격자에 없다" in str(exc.value)

    @pytest.mark.parametrize("unit", ["", "   "])
    def test_규칙5_unit이_비어_있으면_거부(self, unit):
        with pytest.raises(ValueError) as exc:
            QuizQuestion(**_slider(unit=unit))
        assert "unit이 비어 있다" in str(exc.value)

    def test_규칙6_범위가_상한을_넘으면_거부(self):
        # 관용오차(SLIDER_TOLERANCE)가 절대값 10이라 넓은 범위에서는 무의미해진다.
        with pytest.raises(ValueError) as exc:
            QuizQuestion(**_slider(max=SLIDER_MAX_SPAN + 1, correct_answer="100"))
        assert f"상한 {SLIDER_MAX_SPAN}을 넘는다" in str(exc.value)

    def test_규칙6_상한과_같은_범위는_통과(self):
        question = QuizQuestion(**_slider(max=SLIDER_MAX_SPAN, correct_answer="100"))
        assert question.max - question.min == SLIDER_MAX_SPAN

    def test_실수_step도_격자_판정이_성립한다(self):
        # 이진 표현 오차로 정상값을 거부하면 실수 step 문항을 만들 수 없다.
        assert QuizQuestion(**_slider(max=2, step=0.1, correct_answer="0.3")).step == 0.1
        with pytest.raises(ValueError) as exc:
            QuizQuestion(**_slider(max=2, step=0.1, correct_answer="0.35"))
        assert "격자에 없다" in str(exc.value)


class TestSeedSliderValues:
    """시드 실측값이 계약을 통과해야 한다 — 통과 못하면 계약이 과하게 좁은 것이다."""

    @pytest.mark.parametrize("min_, max_, step, unit, answer", SEED_SLIDERS)
    def test_시드_slider는_계약을_통과(self, min_, max_, step, unit, answer):
        question = QuizQuestion(
            **_slider(min=min_, max=max_, step=step, unit=unit, correct_answer=answer)
        )
        assert (question.min, question.max, question.step, question.unit) == (
            min_,
            max_,
            step,
            unit,
        )

    def test_정수_저작값의_정수성이_보존된다(self):
        # float 단일 선언이면 0 → 0.0이 되어 시드 항목과 형태가 어긋난다.
        question = QuizQuestion(**_slider())
        assert isinstance(question.min, int) and isinstance(question.step, int)


# ── quiz_gen_chain 연동: 실패 의미론 + 폴백 뱅크 ─────────────────────────────
class TestChainSemantics:
    def test_폴백_뱅크_전체가_계약을_통과(self):
        with _quiz_gen_chain() as chain:
            for raw in chain.FALLBACK_QUESTIONS:
                question = QuizQuestion(**raw)  # 위반이면 여기서 ValueError
                check_required_fields(question.model_dump())

    def test_fallback_question이_계약을_통과한_문항을_돌려준다(self):
        with _quiz_gen_chain() as chain:
            for tag in {q["concept_tag"] for q in chain.FALLBACK_QUESTIONS}:
                question = chain._fallback_question(tag)
                assert isinstance(question, QuizQuestion)
                assert question.concept_tag == tag

    def test_키_없이_generate_quiz는_계약을_통과한_payload를_돌려준다(self, monkeypatch):
        with _quiz_gen_chain() as chain:
            monkeypatch.setattr(chain, "llm_configured", lambda: False)
            monkeypatch.setattr(
                chain,
                "_build_chain",
                lambda *_: pytest.fail("키 미설정인데 LLM 체인을 호출했다"),
            )
            payload = chain.generate_quiz({}, "middle_high", "general", "typhoon")
        check_required_fields(payload)
        assert payload["quiz_id"]
        # 유형에 해당 없는 필드는 None으로 실려 나가지 않는다.
        assert None not in payload.values()
        assert "min" not in payload  # 폴백 뱅크에 slider가 없다(현행)

    def test_계약_위반_slider는_재시도를_거쳐_폴백으로_떨어진다(self, monkeypatch):
        """위반을 잡아 기본값으로 메우지 않고 현행 실패 의미론을 타는지 확인."""
        with _quiz_gen_chain() as chain:
            # min/max/step/unit이 없는 slider — 결함 ①의 실제 형태.
            bad = (
                '{"concept_tag":"typhoon","question_type":"slider",'
                '"question_text":"초속 몇 m 이상일 때 태풍인가?","correct_answer":"17"}'
            )
            temperatures: list[float] = []

            def _fake_chain(temperature: float):
                temperatures.append(temperature)
                return types.SimpleNamespace(invoke=lambda _: bad)

            monkeypatch.setattr(chain, "llm_configured", lambda: True)
            monkeypatch.setattr(chain, "_build_chain", _fake_chain)
            payload = chain.generate_quiz({}, "adult", "general", "typhoon")

            # 0.7 → 0.1 두 번 시도한 뒤 폴백 뱅크.
            assert temperatures == [0.7, 0.1]
            assert payload["concept_tag"] == "typhoon"
            assert payload["question_type"] != "slider"
            with pytest.raises(ValueError):
                chain._parse_output(bad)

    def test_계약을_갖춘_slider는_생성_결과로_통과한다(self, monkeypatch):
        with _quiz_gen_chain() as chain:
            good = (
                '{"concept_tag":"typhoon","question_type":"slider",'
                '"question_text":"초속 몇 m 이상일 때 태풍인가?","correct_answer":"17",'
                '"min":0,"max":40,"step":1,"unit":"m/s"}'
            )
            monkeypatch.setattr(chain, "llm_configured", lambda: True)
            monkeypatch.setattr(
                chain,
                "_build_chain",
                lambda *_: types.SimpleNamespace(invoke=lambda _: good),
            )
            payload = chain.generate_quiz({}, "adult", "general", "typhoon")
        check_required_fields(payload)
        assert (payload["min"], payload["max"], payload["step"], payload["unit"]) == (
            0,
            40,
            1,
            "m/s",
        )
