"""§3.1 에러 코드 표준 계약 테스트 (S9) — 라우터 소스 ↔ frontend mock 문자열 일치.

웨이브 1 리뷰에서 mock↔실서버 코드 불일치 5종이 발견·수정된 뒤 §3.1에
표준 코드(SESSION_NOT_COMPLETED · ALREADY_ANSWERED · SESSION_NOT_FOUND ·
RATE_LIMITED)가 고정되었다. 이 테스트는 재발을 소스 텍스트 수준에서 가드한다:

- 표준 코드가 백엔드의 올바른 소스 파일에 존재하는가
- mock(frontend/mock/apiMockPlugin.js — 읽기 전용)이 발행하는 모든 코드가
  백엔드 코드 집합과 문자열로 정확히 일치하는가 (오타·표기 변형 방지)

mock은 QA 소유가 아니므로 읽기만 한다. mock에 RATE_LIMITED 핸들러가 없는
것은 mock이 레이트리밋을 시뮬레이션하지 않기 때문 — TEST_PLAN.md 결함
목록에 관찰 사항으로 기록한다 (여기서 실패시키지 않음).
"""
import re
from pathlib import Path

BACKEND_APP = Path(__file__).resolve().parents[1] / "app"
REPO_ROOT = Path(__file__).resolve().parents[2]
MOCK_PATH = REPO_ROOT / "frontend" / "mock" / "apiMockPlugin.js"

# 백엔드: HTTPException detail / JSONResponse content의 "code": "..." 리터럴
BACKEND_CODE_RE = re.compile(r'"code":\s*"([A-Z_]+)"')
# mock: [status, { detail, code: '...' }] 형태의 code: '...' 리터럴
MOCK_CODE_RE = re.compile(r"code:\s*'([A-Z_]+)'")

STANDARD_CODES = {
    "SESSION_NOT_COMPLETED",
    "ALREADY_ANSWERED",
    "SESSION_NOT_FOUND",
    "RATE_LIMITED",
}


def _codes_in(path: Path, pattern: re.Pattern) -> set[str]:
    return set(pattern.findall(path.read_text(encoding="utf-8")))


def _all_backend_codes() -> set[str]:
    codes: set[str] = set()
    for py in BACKEND_APP.rglob("*.py"):
        codes |= _codes_in(py, BACKEND_CODE_RE)
    return codes


class TestBackendStandardCodes:
    """§3.1 표준 코드가 담당 소스 파일에 실재한다."""

    def test_session_라우터_3종(self):
        codes = _codes_in(BACKEND_APP / "routers" / "session.py", BACKEND_CODE_RE)
        assert {"SESSION_NOT_COMPLETED", "ALREADY_ANSWERED", "SESSION_NOT_FOUND"} <= codes

    def test_quiz_라우터_재제출_409(self):
        codes = _codes_in(BACKEND_APP / "routers" / "quiz.py", BACKEND_CODE_RE)
        assert "ALREADY_ANSWERED" in codes

    def test_레이트리밋_429_핸들러(self):
        """§3.6: 초과 시 429 + code=RATE_LIMITED — main.py 전역 핸들러 담당."""
        codes = _codes_in(BACKEND_APP / "main.py", BACKEND_CODE_RE)
        assert "RATE_LIMITED" in codes

    def test_표준_4종_모두_백엔드에_존재(self):
        assert STANDARD_CODES <= _all_backend_codes()


class TestMockContractSync:
    """mock이 발행하는 코드는 백엔드 코드 집합의 부분집합 (문자열 일치)."""

    def test_mock_파일_존재(self):
        assert MOCK_PATH.exists(), "mock 경로 변경 시 이 테스트를 갱신할 것"

    def test_mock_코드는_전부_백엔드와_문자열_일치(self):
        mock_codes = _codes_in(MOCK_PATH, MOCK_CODE_RE)
        backend_codes = _all_backend_codes()
        assert mock_codes, "mock에서 에러 코드를 하나도 못 찾음 — 정규식/포맷 확인"
        unknown = mock_codes - backend_codes
        assert not unknown, (
            f"mock에만 존재하는(백엔드와 불일치) 코드: {sorted(unknown)} — "
            "웨이브 1 리뷰 8번(불일치 5종)의 재발"
        )

    def test_mock_세션_핸들러가_표준_3종_사용(self):
        """세션 플로우 코드 3종은 mock에도 있어야 프론트가 리허설 가능하다."""
        mock_codes = _codes_in(MOCK_PATH, MOCK_CODE_RE)
        assert {"SESSION_NOT_COMPLETED", "ALREADY_ANSWERED", "SESSION_NOT_FOUND"} <= mock_codes
