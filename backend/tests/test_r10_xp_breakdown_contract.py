"""R10-01 §3.5 마감 3 — 약점 보너스 XP 분리 표기 계약 테스트.

**왜 이 파일이 있는가**
"약점 극복 +7" 분리 표기가 프론트의 **역산**으로 구현돼 있었다:
ResultBanner.jsx가 `xp_earned − 기본지급액`으로 보너스를 냈고, 그 기본지급액은
xp_service 상수(10·5·1.5)의 **사본**이었다. 결과는 두 가지 조용한 고장이다 —
① 백엔드가 XP 수치·배율을 바꾸면 프론트가 틀린 금액을 표기한다(CLAUDE.md
"계약 수치 변경 시 계약 테스트로 드리프트 감시" 위반), ② 목이 항상 15를 줘서
보너스 줄이 렌더되지 않아 기능이 검증 불가였다.

새 계약: **서버가 분해를 소유한다.**
- xp_service.quiz_xp_breakdown(is_correct, is_first_try, is_weak) -> (base, weak_bonus)
- 항상 base + weak_bonus == quiz_xp(...) == 응답 xp_earned (순수 additive —
  xp_earned의 값·의미는 불변)
- 배율·반올림(파이썬 round의 banker's rounding)은 이 함수만 안다
- 응답 스키마 AnswerResult/SessionAnswerResult가 xp_base·xp_weak_bonus를 싣는다
- 프론트(ResultBanner.jsx)에는 XP 상수 사본이 **없다** — 소스 텍스트로 가드

관례: DB·HTTP 하네스 없음 — 순수 함수 + 스키마 필드 + 소스 텍스트 가드
(test_error_code_contract가 frontend 소스를 읽는 선례와 동일).
"""
import math
import re
from itertools import product
from pathlib import Path

import pytest

from app.schemas.quiz import AnswerResult
from app.schemas.session import SessionAnswerResult
from app.services import xp_service
from app.services.xp_service import quiz_xp, quiz_xp_breakdown

REPO_ROOT = Path(__file__).resolve().parents[2]
RESULT_BANNER = REPO_ROOT / "frontend" / "src" / "modules" / "quiz" / "ResultBanner.jsx"
MOCK_PATH = REPO_ROOT / "frontend" / "mock" / "apiMockPlugin.js"

FLAGS = list(product([True, False], repeat=3))  # (is_correct, is_first_try, is_weak)


class TestBreakdownSumContract:
    """[계약 1] xp_base + xp_weak_bonus == xp_earned — 전 조합에서 성립."""

    @pytest.mark.parametrize("is_correct,is_first_try,is_weak", FLAGS)
    def test_분해합이_quiz_xp와_같다(self, is_correct, is_first_try, is_weak):
        base, bonus = quiz_xp_breakdown(is_correct, is_first_try, is_weak)
        assert base + bonus == quiz_xp(
            is_correct, is_first_try=is_first_try, is_weak=is_weak
        )

    @pytest.mark.parametrize("is_correct,is_first_try,is_weak", FLAGS)
    def test_분해값은_음수가_아니다(self, is_correct, is_first_try, is_weak):
        base, bonus = quiz_xp_breakdown(is_correct, is_first_try, is_weak)
        assert base >= 0 and bonus >= 0

    @pytest.mark.parametrize("is_correct,is_first_try", [(True, True), (True, False)])
    def test_base는_약점_여부와_무관(self, is_correct, is_first_try):
        """base = 배율 적용 **전** 금액이므로 약점/비약점이 같아야 한다."""
        weak_base, _ = quiz_xp_breakdown(is_correct, is_first_try, True)
        plain_base, _ = quiz_xp_breakdown(is_correct, is_first_try, False)
        assert weak_base == plain_base


class TestBreakdownValues:
    """[계약 2] 계약 수치 고정 — 표기 금액이 조용히 바뀌면 실패한다."""

    def test_약점_첫시도_정답(self):
        """(10+5)*1.5 = 22.5 → round() 22. 표기는 "+15 XP, 약점 극복 +7"."""
        assert quiz_xp_breakdown(True, True, True) == (15, 7)

    def test_약점_재시도_정답(self):
        """10*1.5 = 15 → base 10 + bonus 5."""
        assert quiz_xp_breakdown(True, False, True) == (10, 5)

    def test_비약점_정답은_보너스_0(self):
        assert quiz_xp_breakdown(True, True, False) == (15, 0)
        assert quiz_xp_breakdown(True, False, False) == (10, 0)

    def test_오답은_base가_참여XP_보너스_0(self):
        """오답에는 배율이 없다 — 약점이어도 (2, 0)."""
        assert quiz_xp_breakdown(False, True, False) == (2, 0)
        assert quiz_xp_breakdown(False, True, True) == (2, 0)
        assert quiz_xp_breakdown(False, False, True) == (2, 0)

    def test_반올림은_banker_그대로(self):
        """올림(23)이 아니라 파이썬 round(22.5)=22를 유지한다 — 구현 방식 고정."""
        base, bonus = quiz_xp_breakdown(True, True, True)
        exact = base * xp_service.WEAK_TAG_XP_MULTIPLIER  # 22.5
        assert base + bonus == round(exact) == 22
        assert base + bonus != math.ceil(exact)  # 23이 되면 표기 금액이 바뀐다


class TestResponseSchemaAdditive:
    """[계약 3] 응답 스키마가 분해값을 싣는다 — 기존 필드는 그대로(additive)."""

    def test_필드_존재(self):
        for schema in (AnswerResult, SessionAnswerResult):
            assert {"xp_base", "xp_weak_bonus"} <= set(schema.model_fields), (
                f"{schema.__name__}에 XP 분해 필드가 없다"
            )

    def test_기존_필드_불변(self):
        assert {
            "is_correct",
            "correct_answer",
            "feedback",
            "xp_earned",
            "concept_tag",
            "phenomena",
        } <= set(AnswerResult.model_fields)
        assert {"session_progress", "clouds_spent", "clouds"} <= set(
            SessionAnswerResult.model_fields
        )

    def test_기본값은_0_이라_구_호출부_불변(self):
        """분해값 없이 생성해도 유효 — 순수 additive(기존 구성 경로 회귀 0)."""
        r = AnswerResult(
            is_correct=True, correct_answer="a", feedback="f", xp_earned=0, concept_tag="t"
        )
        assert (r.xp_base, r.xp_weak_bonus) == (0, 0)

    @pytest.mark.parametrize("is_correct,is_first_try,is_weak", FLAGS)
    def test_스키마_인스턴스도_합_계약(self, is_correct, is_first_try, is_weak):
        base, bonus = quiz_xp_breakdown(is_correct, is_first_try, is_weak)
        r = AnswerResult(
            is_correct=is_correct,
            correct_answer="a",
            feedback="f",
            xp_earned=base + bonus,
            xp_base=base,
            xp_weak_bonus=bonus,
            concept_tag="t",
        )
        assert r.xp_base + r.xp_weak_bonus == r.xp_earned


class TestAnswerServiceWiring:
    """[계약 4] answer_service가 분해값을 응답에 싣고, 가산은 합으로 한다."""

    SRC = (Path(__file__).resolve().parents[1] / "app" / "services" / "answer_service.py").read_text(
        encoding="utf-8"
    )

    def test_breakdown_호출(self):
        assert "quiz_xp_breakdown(" in self.SRC, (
            "answer_service가 분해 API를 쓰지 않는다 — 프론트가 역산으로 돌아간다"
        )

    def test_응답에_분해값_전달(self):
        assert "xp_base=xp_base" in self.SRC and "xp_weak_bonus=xp_weak_bonus" in self.SRC

    def test_xp_earned는_분해합(self):
        assert "xp_earned = xp_base + xp_weak_bonus" in self.SRC, (
            "xp_earned가 분해합과 다른 경로로 계산되면 합 계약이 깨질 수 있다"
        )

    def test_배치고사는_전부_0(self):
        """grant_xp=False 경로에서 세 값이 0으로 초기화된 채 유지된다."""
        assert "xp_base, xp_weak_bonus = 0, 0" in self.SRC


class TestFrontendHasNoConstantCopy:
    """[계약 5] ResultBanner.jsx에 백엔드 XP 상수 사본이 없다.

    드리프트의 원인은 "프론트가 기본 지급액을 안다"는 것 자체였다. 그래서 값
    비교가 아니라 **코드 위치의 수치 리터럴 부재**를 가드한다: 주석·문자열
    (Tailwind 클래스 `py-1.5`·`bg-emerald-500` 등)을 제거한 뒤 남는 숫자는
    0(존재 비교)만 허용한다. 사본을 다시 넣을 방법이 없어야 재발이 막힌다.
    """

    @staticmethod
    def _code_only(src: str) -> str:
        """주석·문자열·템플릿 리터럴을 제거한 '코드부'만 남긴다."""
        src = re.sub(r"/\*.*?\*/", " ", src, flags=re.S)
        src = re.sub(r"//[^\n]*", " ", src)
        return re.sub(r"'[^']*'|\"[^\"]*\"|`[^`]*`", " ", src)

    def test_소스_존재(self):
        assert RESULT_BANNER.is_file(), f"{RESULT_BANNER} 없음"

    def test_코드부에_0_외의_수치_리터럴_없음(self):
        code = self._code_only(RESULT_BANNER.read_text(encoding="utf-8"))
        numbers = sorted(set(re.findall(r"\d+(?:\.\d+)?", code)))
        assert set(numbers) <= {"0"}, (
            f"ResultBanner.jsx 코드부에 수치 리터럴 {numbers} — XP 상수 사본"
            " 재발 가능(서버 xp_base·xp_weak_bonus만 읽어야 한다)"
        )

    def test_상수_사본_이름도_없음(self):
        src = RESULT_BANNER.read_text(encoding="utf-8")
        for banned in ("BASE_XP_CORRECT", "BASE_XP_WRONG", "MULTIPLIER"):
            assert banned not in src, f"ResultBanner.jsx에 상수 사본 {banned}이 남아 있다"

    def test_서버_분해값을_읽는다(self):
        src = RESULT_BANNER.read_text(encoding="utf-8")
        assert "xp_weak_bonus" in src and "xp_base" in src, (
            "ResultBanner가 서버 분해값을 읽지 않는다"
        )


class TestMockParity:
    """[계약 6] 목이 같은 의미의 분해값을 준다 (D10-1 — 서버와 같은 커밋).

    목은 프론트 소유지만 계약은 서버가 정한다. 목이 필드를 빠뜨리면 보너스 줄이
    영원히 렌더되지 않으므로(회귀 이전 상태) 소스 텍스트로 존재를 고정한다.
    수치 동등성은 frontend/tests/boardAssistRetention.smoke.test.mjs가 실측한다.
    """

    def test_목이_분해값을_응답한다(self):
        src = MOCK_PATH.read_text(encoding="utf-8")
        assert "xp_base:" in src and "xp_weak_bonus:" in src, (
            "목 세션 answer 응답에 XP 분해 필드가 없다"
        )

    def test_목도_banker_반올림을_쓴다(self):
        """JS Math.round(22.5)=23 ≠ 서버 22 — 목이 half-to-even을 구현해야 한다."""
        src = MOCK_PATH.read_text(encoding="utf-8")
        assert "roundHalfToEven" in src, (
            "목이 Math.round를 쓰면 약점 첫 시도 정답에서 서버(22)와 1 어긋난다"
        )
