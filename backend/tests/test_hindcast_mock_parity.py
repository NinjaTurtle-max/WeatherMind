"""과거 예보 회차의 목↔서버 패리티 (MT-30).

**왜 이 파일이 있는가.** detective는 목이 `database/seed/detective_cases.json`을
**직접 읽어** 사본을 만들지 않는다(그 파일 주석이 "사본 금지 — 사본은 시드가 바뀌면
조용히 갈라진다"고 적는다). hindcast의 회차는 **파이썬 모듈**
(`hindcast_service.HINDCAST_CASES`)이 소유해서 목이 같은 방식으로 읽을 수 없고,
그래서 `frontend/mock/apiMockPlugin.js`에 **손으로 맞춘 사본**이 있다.

사본을 둔 대가는 드리프트다. 이 저장소의 관례는 그 대가를 사람이 아니라 **계약
테스트**로 치르는 것이다(`test_ci_workflow_contract`가 워크플로 YAML을,
`test_prompt_spec_parity`가 프롬프트 문서를 파싱해 대조하는 선례). 여기서는 목 JS를
파싱해 회차 id·관측일·평년값·실측을 서버 픽스처와 대조한다.

값이 갈리면 무엇이 깨지는가: 목으로 도는 프론트 스모크가 **서버와 다른 점수·다른
승패**를 그리고, 그 화면을 근거로 UI를 고치면 실서버에서 어긋난다.

실행: backend 디렉토리에서 `python -m pytest tests/test_hindcast_mock_parity.py -q`.
"""
import json
import re
from pathlib import Path

import pytest

from app.services import hindcast_service

MOCK_PATH = (
    Path(__file__).resolve().parents[2] / "frontend" / "mock" / "apiMockPlugin.js"
)


def _mock_cases() -> list[dict]:
    """목 JS의 `const HINDCAST_CASES = [...]` 배열을 JSON으로 읽어낸다.

    JS 객체 리터럴은 키가 인용부호 없이 오고 뒤쪽 쉼표(trailing comma)가 허용되므로
    그 둘만 JSON 문법으로 고친 뒤 `json.loads`에 넘긴다. 정규식으로 값을 하나씩
    긁으면 필드를 추가할 때마다 이 파서를 고쳐야 하므로 배열 전체를 통째로 읽는다.
    """
    src = MOCK_PATH.read_text(encoding="utf-8")
    start = src.index("const HINDCAST_CASES = [")
    open_bracket = src.index("[", start)

    depth = 0
    for i in range(open_bracket, len(src)):
        if src[i] == "[":
            depth += 1
        elif src[i] == "]":
            depth -= 1
            if depth == 0:
                literal = src[open_bracket : i + 1]
                break
    else:  # pragma: no cover - 배열이 안 닫혔으면 목이 이미 깨져 있다
        raise AssertionError("목의 HINDCAST_CASES 배열이 닫히지 않았다")

    literal = re.sub(r"//[^\n]*", "", literal)  # 줄 주석 제거
    literal = re.sub(r"(\w+):", r'"\1":', literal)  # 키에 인용부호
    literal = re.sub(r",\s*([\]}])", r"\1", literal)  # trailing comma 제거
    literal = literal.replace("'", '"')
    return json.loads(literal)


@pytest.fixture(scope="module")
def mock_cases() -> list[dict]:
    return _mock_cases()


@pytest.fixture(scope="module")
def server_cases() -> tuple[dict, ...]:
    """**활성** 회차만 — 목이 담는 것과 같은 집합.

    보류(`enabled: false`) 회차는 목에 없어야 하므로 여기서도 뺀다. "목과 서버가
    같다"의 뜻은 *활성분이 같다*이고, 보류분이 목에 없는 것은 아래
    TestDisabledCase가 따로 문다.
    """
    return hindcast_service.list_cases()


class TestMockParity:
    def test_회차_id_집합이_같다(self, mock_cases, server_cases):
        assert [c["case_id"] for c in mock_cases] == [
            c["case_id"] for c in server_cases
        ]

    def test_관측일이_같다(self, mock_cases, server_cases):
        for mock, server in zip(mock_cases, server_cases):
            assert mock["observed_date"] == server["observed_date"].isoformat(), (
                server["case_id"]
            )

    def test_지역과_관측소가_같다(self, mock_cases, server_cases):
        for mock, server in zip(mock_cases, server_cases):
            assert mock["region"] == server["region"], server["case_id"]
            assert mock["station"] == server["station"], server["case_id"]

    def test_평년값이_같다(self, mock_cases, server_cases):
        """캐스터 기준값이 갈리면 목과 실서버의 승패가 달라진다."""
        for mock, server in zip(mock_cases, server_cases):
            assert mock["climatology"] == server["caster_base"], server["case_id"]

    def test_실측이_같다(self, mock_cases, server_cases):
        """채점의 근거 — 갈리면 목이 다른 점수를 그린다."""
        for mock, server in zip(mock_cases, server_cases):
            assert mock["actual"]["temp_max"] == server["actual"]["temp_max"], (
                server["case_id"]
            )
            assert mock["actual"]["sum_rn"] == server["actual"]["sum_rn"], (
                server["case_id"]
            )

    def test_고지_문구가_같다(self):
        """「데모용 고정 날짜」 고지가 목에서 사라지면 그 화면은 사실을 숨긴다."""
        src = MOCK_PATH.read_text(encoding="utf-8")
        assert "HINDCAST_DISCLOSURE" in src
        # 서버 문구의 앞부분이 목에도 있어야 한다(줄바꿈 연결이라 전문 비교는 못 한다)
        assert "과거 관측을 서버에 적재하는 경로가 아직 없어" in src

    def test_목이_목록_응답에_실측을_넣지_않는다(self):
        """서버 스키마가 구조적으로 배제한 것과 같은 계약 — 목이 정답을 흘리면
        프론트가 목에서만 되는 로컬 판정을 짤 수 있게 된다."""
        src = MOCK_PATH.read_text(encoding="utf-8")
        start = src.index("'GET /hindcast/cases'")
        end = src.index("'GET /hindcast/attempts'")
        handler = src[start:end]
        for leaked in ("actual", "sources", "explanation"):
            assert leaked not in handler, f"목 회차 목록에 {leaked}가 샜다"

    def test_목의_이진화가_서버와_같은_규칙이다(self, mock_cases, server_cases):
        """sumRn>0 → 100. 목 JS의 식과 서버 함수가 같은 답을 내는지 값으로 확인."""
        src = MOCK_PATH.read_text(encoding="utf-8")
        assert "sum_rn > 0 ? 100 : 0" in src
        for server in server_cases:
            scoring = hindcast_service.scoring_actual(server)
            expected = 100.0 if server["actual"]["sum_rn"] > 0 else 0.0
            assert scoring["rain_prob"] == expected, server["case_id"]


# ═══════════════════════════════════════════════════════════════
# 보류 회차 (2026-08-19 PM 판정) — 지우지 않고 감춘다
# ═══════════════════════════════════════════════════════════════


class TestDisabledCase:
    """`seoul-2022-08-08` 보류가 **되돌릴 수 있는 형태**로 유지되는가.

    삭제가 아니라 보류인 이유: 기온축 공식값을 확인하면 곧바로 되살린다. 그래서
    값·출처를 지우지 않고 `enabled: False` + `disabled_reason`으로 둔다.
    """

    CASE_ID = "seoul-2022-08-08"

    def test_픽스처에_남아_있다(self):
        """지우면 되돌릴 수 없다 — 공식값을 찾았을 때 복구할 자리가 사라진다."""
        assert hindcast_service.find_case_meta(self.CASE_ID) is not None

    def test_활성_목록에는_없다(self):
        assert self.CASE_ID not in [c["case_id"] for c in hindcast_service.list_cases()]

    def test_get_case가_보류분을_열어_주지_않는다(self):
        """화면에서 감추는 것만으로는 URL을 직접 치는 경로가 남는다."""
        assert hindcast_service.get_case(self.CASE_ID) is None

    def test_사유가_데이터와_같은_자리에_있다(self):
        """근거가 딴 곳에 있으면 개정될 때 같이 고쳐지지 않는다
        (`level_vocabulary.json`의 `basis` 관례)."""
        case = hindcast_service.find_case_meta(self.CASE_ID)
        reason = case.get("disabled_reason", "")
        assert "기온축 공식값 미확인" in reason
        assert "확인되면 활성" in reason

    def test_강수축_공식값은_그대로_남는다(self):
        """활성 조건은 기온축뿐 — 강수 129.6mm는 이미 공식이라 손댈 것이 없다."""
        case = hindcast_service.find_case_meta(self.CASE_ID)
        assert case["actual"]["sum_rn"] == 129.6
        assert "공식 기록" in case["sources"]["sum_rn"]

    def test_목에도_없다(self, mock_cases):
        assert self.CASE_ID not in [c["case_id"] for c in mock_cases]

    def test_활성분이_하나_이상_남는다(self):
        """보류로 회차가 0건이 되면 「없음」과 같아진다 — 최소 착지가 무너진다."""
        assert len(hindcast_service.list_cases()) >= 1
