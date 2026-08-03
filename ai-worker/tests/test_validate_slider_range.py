"""1차 게이트의 slider 범위 판정 — 문항 자신의 min/max를 쓴다.

## 왜 고쳤나 (2026-08-03)

`validate_chain`은 `SLIDER_MIN, SLIDER_MAX = 0, 100`을 하드코딩해 **모든** 슬라이더
정답을 0~100과 비교했다. 이는 슬라이더 척도가 암묵적으로 0~100이던 03번 스펙 최초
설계의 흔적이다(예시 3이 범위를 질문 텍스트 "(0~100%)"에만 적었다).

제품은 항목별 범위로 옮겨갔다 — 시드 slider는 0~40 m/s · 0~20 % 등을 갖고, 서버는
`QUESTION_PAYLOAD_FIELDS["slider"]`로 `min`·`max`·`step`·`unit`을 노출한다. 03번 스펙
개정으로 **생성 경로도** 4필드를 요구하게 되면서, 넓은 범위 문항이 실제로 만들어질 수
있게 됐다 — 예: 해면기압 900~1100 hPa, 정답 1008.

그 문항은 계약 G(`payload_contract.check_payload`)를 통과하는데 1차 게이트가
"정답이 0~100 범위를 벗어남"으로 **오탈락**시켰다(수정 전 실측 확인). 저작 배치가
1차 게이트를 P-2 2단계로 쓰므로, 이대로면 유효한 문항이 조용히 버려진다.

시드 4건은 모두 정답이 0~100 안이라 **당시에는 잠재적 결함**이었고, 스펙 개정이
그것을 살아 있는 경로로 바꿨다.

DB·네트워크·LLM 키 불필요. 실행: `cd ai-worker && python -m pytest tests -q`.
"""
import pytest

from app.chains.validate_chain import SLIDER_MAX, SLIDER_MIN, run_heuristic_checks

QUESTION_TEXT = "오늘 관측값을 슬라이더로 표시하세요. 충분히 긴 질문 텍스트입니다."


def _slider_range_check(**payload) -> dict:
    question = {
        "concept_tag": "pressure_front",
        "question_type": "slider",
        "question_text": QUESTION_TEXT,
        **payload,
    }
    for check in run_heuristic_checks(question, "pressure_front"):
        if check["name"] == "slider_range":
            return check
    pytest.fail("slider_range 체크가 결과에 없다 — 체크 이름이 바뀌었는지 확인")


class TestSliderRangeUsesItemRange:
    """정답 범위 판정은 문항이 선언한 범위를 기준으로 한다."""

    def test_넓은_범위_문항이_오탈락되지_않는다(self):
        """이 테스트가 생긴 이유 — 기압 900~1100 hPa, 정답 1008.

        수정 전에는 "슬라이더 정답이 0~100 범위를 벗어남: 1008"로 탈락했다.
        """
        check = _slider_range_check(
            min=900, max=1100, step=1, unit="hPa", correct_answer="1008"
        )
        assert check["passed"], check["reason"]
        assert "900~1100" in check["reason"], (
            f"판정 근거가 문항 범위를 보여주지 않는다: {check['reason']}"
        )

    def test_시드_범위_문항은_종전대로_통과한다(self):
        """시드 태풍 문항(0~40 m/s, 정답 17) — 회귀 0 확인."""
        assert _slider_range_check(
            min=0, max=40, step=1, unit="m/s", correct_answer="17"
        )["passed"]

    def test_문항_범위_밖_정답은_탈락한다(self):
        """넓히기만 하면 검사가 헐거워진다 — 좁은 범위에서 더 엄격해져야 한다.

        정답 99는 0~100 하드코딩에서는 **통과**했다. 문항 범위(0~40)를 쓰면 탈락이다.
        """
        check = _slider_range_check(
            min=0, max=40, step=1, unit="m/s", correct_answer="99"
        )
        assert not check["passed"]
        assert "0~40" in check["reason"]

    @pytest.mark.parametrize(
        "bad_range",
        [
            {},  # 구형 문항 — min/max 자체가 없다
            {"min": 40, "max": 0},  # 뒤집힘
            {"min": "낮음", "max": "높음"},  # 숫자가 아니다
            {"min": 10, "max": 10},  # 폭 0
        ],
        ids=["범위없음", "뒤집힘", "숫자아님", "폭0"],
    )
    def test_범위를_믿을_수_없으면_0_100로_폴백한다(self, bad_range):
        """계약 G 이전에 만들어진 문항·깨진 범위에서 게이트가 죽지 않아야 한다.

        1차 게이트는 **결정적이고 LLM과 무관**한 것이 계약이다(`validate_chain` §1단).
        범위가 이상하다는 이유로 예외를 내면 배치 전체가 멈춘다 — 판정을 종전 기준으로
        되돌리고, 범위 자체의 흠은 계약 G(`check_payload`)가 잡는다.
        """
        check = _slider_range_check(correct_answer="50", **bad_range)
        assert check["passed"], check["reason"]
        assert f"{SLIDER_MIN:g}~{SLIDER_MAX:g}" in check["reason"], (
            f"폴백 기준이 0~100이 아니다: {check['reason']}"
        )

    def test_숫자가_아닌_정답은_여전히_탈락한다(self):
        check = _slider_range_check(min=0, max=40, step=1, unit="m/s", correct_answer="약 17")
        assert not check["passed"]
        assert "숫자가 아님" in check["reason"]
